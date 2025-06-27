<script lang="ts">
  import { GoogleGenerativeAI } from "@google/generative-ai";
  import { onMount } from "svelte";

  let transcript = "";
  let summary = "";
  let isSummarizing = false;
  let isRecording = false;
  let isTranscribing = false;
  let apiKey = "";
  let mediaRecorder: MediaRecorder | null = null;
  let audioChunks: Blob[] = [];
  let stream: MediaStream | null = null;
  let speakerColors = new Map<string, string>();
  let colorIndex = 0;
  let audioContext: AudioContext | null = null;
  let analyser: AnalyserNode | null = null;
  let lastSoundTime = 0;
  let currentChunkStartTime = 0;
  let isRestartingRecorder = false;
  let copyButtonText = "Copy as Markdown";

  // Strict rate limiting - maximum 5 calls per minute
  let geminiCallCount = 0;
  let rateLimitWindow = Date.now();
  let isRateLimited = false;
  let nextCallAllowed = 0;

  const availableColors = ['#007acc', '#28a745', '#dc3545', '#ffc107', '#6f42c1', '#fd7e14'];
  const SILENCE_THRESHOLD = 30;
  const SILENCE_DURATION = 2500; // Reduced for faster chunking
  const MIN_CHUNK_DURATION = 5000; // Reduced for faster chunking
  const MAX_CHUNK_DURATION = 60000; // Increased to 60 seconds maximum
  const MAX_CALLS_PER_MINUTE = 5; // Strict limit
  const RATE_LIMIT_WINDOW = 60000; // 1 minute

  // Queue system for failed chunks
  let processingQueue: Array<{
    id: string;
    audioBlob: Blob;
    timestamp: string;
    retryCount: number;
    maxRetries: number;
  }> = [];
  let isProcessingQueue = false;
  let queueProcessingInterval: number | null = null;

  const MAX_RETRIES = 3; // Reduced for faster failure
  const RETRY_DELAY_BASE = 2000; // Base delay in ms
  const QUEUE_PROCESS_INTERVAL = 5000; // Check queue every 5 seconds
  let previousContext = "";

  onMount(() => {
    const savedApiKey = localStorage.getItem('gemini-api-key');
    if (savedApiKey) {
      apiKey = savedApiKey;
    }
    const savedTranscript = localStorage.getItem('tydids-transcript');
    if (savedTranscript) {
      transcript = savedTranscript;
    }
    const savedContext = localStorage.getItem('tydids-transcript-context');
    if (savedContext) {
      previousContext = savedContext;
    }
  });

  $: if (apiKey) {
    localStorage.setItem('gemini-api-key', apiKey);
  }

  $: if (transcript) {
    localStorage.setItem('tydids-transcript', transcript);
    localStorage.setItem('tydids-transcript-context', previousContext);
  } else {
    // Also clear from storage when transcript is cleared
    localStorage.removeItem('tydids-transcript');
    localStorage.removeItem('tydids-transcript-context');
  }

  function getSpeakerColor(speaker: string): string {
    if (!speakerColors.has(speaker)) {
      speakerColors.set(speaker, availableColors[colorIndex % availableColors.length]);
      colorIndex++;
    }
    return speakerColors.get(speaker)!;
  }

  function formatTranscript(text: string): string {
    if (!text) return '';

    return text.split('\n\n').filter(line => line.trim()).map(line => {
      const speakerMatch = line.match(/\[(.*?)\]\s*(Speaker \d+):\s*(.*)/s);
      if (speakerMatch) {
        const [, timestamp, speaker, content] = speakerMatch;
        const color = getSpeakerColor(speaker);
        return `
          <div class="transcript-entry">
            <div class="speaker-info">
              <span class="speaker-dot" style="background-color: ${color};"></span>
              <span class="speaker-name" style="color: ${color};">${speaker}</span>
              <span class="timestamp">${timestamp}</span>
            </div>
            <p class="content">${content.trim()}</p>
          </div>
        `;
      }
      const errorMatch = line.match(/\[(.*?)\]\s*\[ERROR\]\s*(.*)/s);
      if (errorMatch) {
        const [, timestamp, message] = errorMatch;
        return `
          <div class="transcript-entry error-entry">
            <div class="speaker-info">
              <span class="speaker-dot" style="background-color: #dc3545;"></span>
              <span class="speaker-name" style="color: #dc3545;">SYSTEM ERROR</span>
              <span class="timestamp">${timestamp}</span>
            </div>
            <p class="content">${message.trim()}</p>
          </div>
        `;
      }
      return `<div class="transcript-entry"><p class="content">${line}</p></div>`;
    }).join('');
  }

  function formatTranscriptAsMarkdown(text: string): string {
    if (!text) return '';

    return text.split('\n\n').filter(line => line.trim()).map(line => {
      const speakerMatch = line.match(/\[(.*?)\]\s*(Speaker \d+):\s*(.*)/s);
      if (speakerMatch) {
        const [, timestamp, speaker, content] = speakerMatch;
        return `**${speaker.trim()}** (*${timestamp.trim()}*): ${content.trim()}`;
      }
      const errorMatch = line.match(/\[(.*?)\]\s*\[ERROR\]\s*(.*)/s);
      if (errorMatch) {
        const [, timestamp, message] = errorMatch;
        return `> **ERROR** (*${timestamp.trim()}*): ${message.trim()}`;
      }
      return line;
    }).join('\n\n');
  }

  async function copyAsMarkdown() {
    if (!transcript.trim()) return;

    const markdown = formatTranscriptAsMarkdown(transcript);
    try {
      await navigator.clipboard.writeText(markdown);
      copyButtonText = "Copied!";
      setTimeout(() => {
        copyButtonText = "Copy as Markdown";
      }, 2000);
    } catch (err) {
      console.error('Failed to copy text: ', err);
      copyButtonText = "Copy Failed";
      setTimeout(() => {
        copyButtonText = "Copy as Markdown";
      }, 2000);
    }
  }

  async function summarize() {
    if (!apiKey) {
      summary = "Error: Please enter your Gemini API key.";
      return;
    }

    if (!transcript.trim()) {
      summary = "Error: No transcript available to summarize.";
      return;
    }

    isSummarizing = true;
    summary = "";

    try {
      const genAI = new GoogleGenerativeAI(apiKey);
      const model = genAI.getGenerativeModel({ model: "gemini-2.5-flash" });

      const prompt = `
        Summarize the following transcript in a well-structured HTML format.
        Use headings (h3, h4), lists (ul, li), and bold text (strong) to organize the information clearly.
        The summary should include:
        - A concise overview of the main topics.
        - Key points and decisions made.
        - Action items assigned to speakers, if any.
        
        Transcript:
        ${transcript}
      `;

      const result = await model.generateContent(prompt);
      const response = await result.response;
      summary = response.text();

    } catch (error: any) {
      summary = `<div class="summary-error"><strong>Error:</strong> ${error.message}</div>`;
    } finally {
      isSummarizing = false;
    }
  }

  function canMakeGeminiCall(): boolean {
    const now = Date.now();
    
    // Reset rate limit window if minute has passed
    if (now - rateLimitWindow >= RATE_LIMIT_WINDOW) {
      geminiCallCount = 0;
      rateLimitWindow = now;
      isRateLimited = false;
    }
    
    // Check if we can make a call
    if (geminiCallCount >= MAX_CALLS_PER_MINUTE) {
      isRateLimited = true;
      nextCallAllowed = rateLimitWindow + RATE_LIMIT_WINDOW;
      return false;
    }
    
    return true;
  }

  function detectSilence() {
    if (!analyser || !isRecording) return;

    const bufferLength = analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
    const volume = 20 * Math.log10(average + 1);

    const currentTime = Date.now();
    const chunkDuration = currentTime - currentChunkStartTime;

    if (volume > SILENCE_THRESHOLD) {
      lastSoundTime = currentTime;
    } else if (currentTime - lastSoundTime > SILENCE_DURATION && !isTranscribing && !isRestartingRecorder) {
      // Only process if we have enough content and can make API call
      if (chunkDuration > MIN_CHUNK_DURATION && audioChunks.length > 0 && canMakeGeminiCall()) {
        processCurrentChunk();
      }
    }

    // Force processing if chunk is too long and we can make API call
    if (chunkDuration > MAX_CHUNK_DURATION && !isTranscribing && !isRestartingRecorder && canMakeGeminiCall()) {
      processCurrentChunk();
    }

    if (isRecording) {
      requestAnimationFrame(detectSilence);
    }
  }

  async function processCurrentChunk() {
    if (isTranscribing || audioChunks.length === 0 || !canMakeGeminiCall() || isRestartingRecorder) return;

    // Stop the recorder. The onstop event will handle the blob and restart if needed.
    if (mediaRecorder && mediaRecorder.state === 'recording') {
      mediaRecorder.stop();
    }
  }

  const handleRecorderStop = () => {
    if (audioChunks.length > 0) {
        const audioBlob = new Blob(audioChunks, { type: 'audio/webm' });
        audioChunks = []; // Clear for next recording session

        if (audioBlob.size < 10000) {
            console.log('Skipping small audio chunk on stop:', audioBlob.size);
        } else {
            addToProcessingQueue(audioBlob);
        }
    }

    // If we are still supposed to be recording, restart it.
    if (isRecording) {
        console.log("Restarting MediaRecorder...");
        isRestartingRecorder = true;
        try {
            // Re-creating the MediaRecorder ensures we get a new header for the next chunk.
            mediaRecorder = new MediaRecorder(stream, {
                mimeType: 'audio/webm'
            });
            mediaRecorder.ondataavailable = (event) => {
                if (event.data.size > 0) {
                    audioChunks.push(event.data);
                }
            };
            mediaRecorder.onstop = handleRecorderStop;
            
            mediaRecorder.start(2000);
            currentChunkStartTime = Date.now();
            lastSoundTime = Date.now();
        } catch (e) {
            console.error("Error restarting recorder:", e);
            isRecording = false; // Stop recording if restart fails
        } finally {
            setTimeout(() => isRestartingRecorder = false, 500); // Give it a moment to stabilize
        }
    }
  };

  async function startRecording() {
    try {
      stream = await navigator.mediaDevices.getUserMedia({
        audio: {
          sampleRate: 16000,
          channelCount: 1,
          echoCancellation: true,
          noiseSuppression: true
        }
      });

      audioContext = new AudioContext();
      const source = audioContext.createMediaStreamSource(stream);
      analyser = audioContext.createAnalyser();
      analyser.fftSize = 256;
      source.connect(analyser);

      mediaRecorder = new MediaRecorder(stream, {
        mimeType: 'audio/webm'
      });

      audioChunks = [];
      currentChunkStartTime = Date.now();
      lastSoundTime = Date.now();

      mediaRecorder.ondataavailable = (event) => {
        if (event.data.size > 0) {
          audioChunks.push(event.data);
        }
      };

      mediaRecorder.onstop = handleRecorderStop;

      mediaRecorder.start(2000); // Larger intervals to reduce chunks
      isRecording = true;
      requestAnimationFrame(detectSilence);

    } catch (error: any) {
      console.error('Error starting recording:', error);
      transcript += `\nError: ${error.message}`;
    }
  }

  function stopRecording() {
    if (mediaRecorder && isRecording) {
      isRecording = false; // Set this first to prevent restart in onstop

      if (mediaRecorder.state === 'recording') {
        mediaRecorder.stop();
      }

      if (stream) {
        stream.getTracks().forEach(track => track.stop());
        stream = null;
      }

      if (audioContext) {
        audioContext.close();
        audioContext = null;
        analyser = null;
      }
      
      // Queue processing continues even after recording stops
      console.log(`Recording stopped. ${processingQueue.length} items remaining in queue.`);
    }
  }

  function getRateLimitStatus(): string {
    if (isRateLimited) {
      const timeLeft = Math.ceil((nextCallAllowed - Date.now()) / 1000);
      return `Rate limited - ${timeLeft}s remaining`;
    }
    return `${geminiCallCount}/${MAX_CALLS_PER_MINUTE} calls used`;
  }

  function clearTranscript() {
    transcript = "";
    summary = "";
    audioChunks = [];
    speakerColors.clear();
    colorIndex = 0;
    geminiCallCount = 0;
    rateLimitWindow = Date.now();
    isRateLimited = false;
    
    // Clear the processing queue
    processingQueue = [];
    stopQueueProcessing();
    console.log('Cleared transcript and processing queue');
  }

  function clearApiKey() {
    apiKey = "";
    localStorage.removeItem('gemini-api-key');
  }

  function addToProcessingQueue(audioBlob: Blob) {
    const queueItem = {
      id: Date.now().toString() + Math.random().toString(36).substr(2, 9),
      audioBlob,
      timestamp: new Date().toLocaleTimeString(),
      retryCount: 0,
      maxRetries: MAX_RETRIES
    };
    
    processingQueue.push(queueItem);
    console.log(`Added item to queue. Queue length: ${processingQueue.length}`);
    
    // Start queue processing if not already running
    if (!queueProcessingInterval) {
      startQueueProcessing();
    }
    
    // Try to process immediately if not rate limited
    if (canMakeGeminiCall() && !isTranscribing) {
      processQueueItem(queueItem);
    }
  }

  function startQueueProcessing() {
    if (queueProcessingInterval) return;
    
    queueProcessingInterval = setInterval(() => {
      processNextQueueItem();
    }, QUEUE_PROCESS_INTERVAL);
    
    console.log('Started queue processing');
  }

  function stopQueueProcessing() {
    if (queueProcessingInterval) {
      clearInterval(queueProcessingInterval);
      queueProcessingInterval = null;
      console.log('Stopped queue processing');
    }
  }

  async function processNextQueueItem() {
    if (processingQueue.length === 0) {
      stopQueueProcessing();
      return;
    }
    
    if (!canMakeGeminiCall() || isTranscribing) {
      console.log('Cannot process queue item - rate limited or already processing');
      return;
    }
    
    const item = processingQueue[0];
    await processQueueItem(item);
  }

  async function processQueueItem(item: typeof processingQueue[0]) {
    if (!canMakeGeminiCall()) {
      console.log(`Skipping queue item ${item.id} - rate limited`);
      return;
    }
    
    isTranscribing = true;
    geminiCallCount++;
    
    try {
      console.log(`Processing queue item ${item.id}, attempt ${item.retryCount + 1}/${item.maxRetries + 1}`);
      
      const transcriptText = await transcribeAudioBlob(item.audioBlob);
      
      if (transcriptText && 
          !transcriptText.toLowerCase().includes("no speech detected") &&
          !transcriptText.toLowerCase().includes("no clear speech") &&
          transcriptText.trim().length > 0) {
        
        transcript += `[${item.timestamp}] ${transcriptText}\n\n`;
        
        setTimeout(() => {
          const textareas = document.querySelectorAll('textarea');
          if (textareas.length > 0) {
            textareas[0].scrollTop = textareas[0].scrollHeight;
          }
        }, 100);
      }
      
      // Success - remove from queue
      removeFromQueue(item.id);
      console.log(`Successfully processed queue item ${item.id}`);
      
    } catch (error: any) {
      console.error(`Error processing queue item ${item.id}:`, error);
      
      // Handle different types of errors
      if (error.message.includes('rate limit') || error.message.includes('quota')) {
        console.log('Hit rate limit, backing off');
        isRateLimited = true;
        geminiCallCount = MAX_CALLS_PER_MINUTE;
      } else if (error.message.includes('Internal Server Error') || 
                 error.message.includes('500') ||
                 error.message.includes('503') ||
                 error.message.includes('502')) {
        // Server errors - retry with exponential backoff
        await handleRetryableError(item, error);
      } else {
        // Other errors - log and remove from queue
        console.error(`Non-retryable error for item ${item.id}:`, error);
        addErrorToTranscript(item.timestamp, error.message);
        removeFromQueue(item.id);
      }
    } finally {
      isTranscribing = false;
    }
  }

  async function handleRetryableError(item: typeof processingQueue[0], error: any) {
    item.retryCount++;
    
    if (item.retryCount > item.maxRetries) {
      console.error(`Max retries exceeded for item ${item.id}`);
      addErrorToTranscript(item.timestamp, `Failed after ${item.maxRetries} retries: ${error.message}`);
      removeFromQueue(item.id);
      return;
    }
    
    // Calculate exponential backoff delay
    const delay = RETRY_DELAY_BASE * Math.pow(2, item.retryCount - 1);
    console.log(`Retrying item ${item.id} in ${delay}ms (attempt ${item.retryCount}/${item.maxRetries})`);
    
    // Schedule retry
    setTimeout(() => {
      if (processingQueue.find(qi => qi.id === item.id)) {
        console.log(`Retrying item ${item.id} now`);
        processQueueItem(item);
      }
    }, delay);
  }

  function removeFromQueue(itemId: string) {
    const index = processingQueue.findIndex(item => item.id === itemId);
    if (index !== -1) {
      processingQueue.splice(index, 1);
      console.log(`Removed item ${itemId} from queue. Queue length: ${processingQueue.length}`);
    }
  }

  function addErrorToTranscript(timestamp: string, errorMessage: string) {
    transcript += `[${timestamp}] [ERROR] ${errorMessage}\n\n`;
  }

  async function transcribeAudioBlob(audioBlob: Blob): Promise<string> {
    const base64Audio = await new Promise<string>((resolve, reject) => {
      const reader = new FileReader();
      reader.onload = () => {
        const result = reader.result as string;
        if (!result || !result.includes(',')) {
          reject(new Error('Invalid FileReader result'));
          return;
        }
        const base64 = result.split(',')[1];
        if (!base64 || base64.length === 0) {
          reject(new Error('Empty base64 data'));
          return;
        }
        resolve(base64);
      };
      reader.onerror = () => reject(new Error('FileReader error'));
      reader.readAsDataURL(audioBlob);
    });

    if (!base64Audio || base64Audio.length < 100) {
      throw new Error('Invalid base64 audio data');
    }

    const genAI = new GoogleGenerativeAI(apiKey);
    
    // Use specified model names
    const models = ["gemini-2.5-flash", "gemini-2.0-flash"];
    let lastError: any;
    
    for (const modelName of models) {
      try {
        const model = genAI.getGenerativeModel({ 
          model: modelName,
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500
          }
        });

        const prompt = `
          Transcribe this audio and identify different speakers. 
          Format the response as a transcript with speaker labels (Speaker 1, Speaker 2, etc.).
          Only include actual speech, ignore background noise or silence.
          Be concise and accurate. If no clear speech is detected, respond with "No speech detected."
          Separate each speaker's contribution on a new line.
        `;

        const result = await model.generateContent([
          {
            inlineData: {
              data: base64Audio,
              mimeType: "audio/webm"
            }
          },
          prompt
        ]);

        const response = await result.response;
        return response.text();
        
      } catch (error: any) {
        console.error(`Model ${modelName} failed:`, error);
        lastError = error;
        
        // If it's a 500 error, try the next model
        if (error.message.includes('500') || error.message.includes('Internal Server Error')) {
          continue;
        } else {
          // For other errors, don't try other models
          throw error;
        }
      }
    }
    
    // If all models failed, throw the last error
    throw lastError;
  }

  function getQueueStatus(): string {
    if (processingQueue.length === 0) {
      return "Queue empty";
    }
    
    const processing = isTranscribing ? 1 : 0;
    const waiting = processingQueue.length - processing;
    const failed = processingQueue.filter(item => item.retryCount > 0).length;
    
    return `Queue: ${waiting} waiting${processing ? ', 1 processing' : ''}${failed ? `, ${failed} retrying` : ''}`;
  }
</script>

<div class="app-container">
  <header class="app-header">
    <div class="logo">
      <svg width="32" height="32" viewBox="0 0 24 24" fill="none" xmlns="http://www.w3.org/2000/svg">
        <path d="M12 2C6.48 2 2 6.48 2 12C2 17.52 6.48 22 12 22C17.52 22 22 17.52 22 12C22 6.48 17.52 2 12 2ZM12 20C7.59 20 4 16.41 4 12C4 7.59 7.59 4 12 4C16.41 4 20 7.59 20 12C20 16.41 16.41 20 12 20Z" fill="var(--primary-color)"/>
        <path d="M12 15C13.66 15 15 13.66 15 12C15 10.34 13.66 9 12 9C10.34 9 9 10.34 9 12C9 13.66 10.34 15 12 15Z" fill="var(--secondary-color)"/>
      </svg>
      <h1>Tydids Transcript</h1>
    </div>
    <div class="status-indicator">
      {#if isRecording}
        <span class="pulse active"></span>
        <span>Recording</span>
      {:else if isTranscribing || processingQueue.length > 0}
        <span class="pulse processing"></span>
        <span>Processing</span>
      {:else}
        <span class="pulse"></span>
        <span>Idle</span>
      {/if}
    </div>
  </header>

  <main class="main-content">
    <div class="controls-panel">
      <section class="api-section">
        <h2>API Configuration</h2>
        <div class="input-group">
          <input 
            type="password" 
            bind:value={apiKey} 
            placeholder="Enter your Google Gemini API key" 
            disabled={isRecording}
          />
          {#if apiKey}
            <button 
              on:click={clearApiKey}
              disabled={isRecording}
              class="clear-api-btn"
              title="Clear API key"
            >
              &#x2715;
            </button>
          {/if}
        </div>
        <p class="api-help">
          Get your key from <a href="https://aistudio.google.com/app/apikey" target="_blank" rel="noopener noreferrer">Google AI Studio</a>.
        </p>
      </section>

      <section class="actions-section">
        <h2>Controls</h2>
        <div class="main-actions">
          {#if !isRecording}
            <button on:click={startRecording} disabled={!apiKey.trim()} class="btn-primary">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>
              Start Recording
            </button>
          {:else}
            <button on:click={stopRecording} class="btn-danger">
              <svg xmlns="http://www.w3.org/2000/svg" width="20" height="20" viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="6" width="12" height="12"></rect></svg>
              Stop Recording
            </button>
          {/if}
        </div>
        <div class="secondary-actions">
          <button on:click={summarize} disabled={isSummarizing || !transcript.trim() || isRecording || processingQueue.length > 0} class="btn-secondary">
            {isSummarizing ? 'Summarizing...' : 'Summarize'}
          </button>
          <button on:click={copyAsMarkdown} disabled={!transcript.trim() || isRecording || processingQueue.length > 0} class="btn-secondary">
            {copyButtonText}
          </button>
          <button on:click={clearTranscript} disabled={isRecording || processingQueue.length > 0 || (!transcript.trim() && !summary.trim())} class="btn-tertiary">
            Clear All
          </button>
        </div>
      </section>
      
      {#if isRecording || processingQueue.length > 0}
        <section class="status-details">
          <h2>Live Status</h2>
          <div class="status-item">
            <span>API Calls:</span>
            <strong>{getRateLimitStatus()}</strong>
          </div>
          <div class="status-item">
            <span>Processing Queue:</span>
            <strong>{getQueueStatus()}</strong>
          </div>
        </section>
      {/if}
    </div>

    <div class="transcript-panel">
      {#if transcript.trim() === '' && summary.trim() === ''}
        <div class="placeholder">
          <svg xmlns="http://www.w3.org/2000/svg" width="64" height="64" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1" stroke-linecap="round" stroke-linejoin="round"><path d="M12 1a3 3 0 0 0-3 3v8a3 3 0 0 0 6 0V4a3 3 0 0 0-3-3z"></path><path d="M19 10v2a7 7 0 0 1-14 0v-2"></path><line x1="12" y1="19" x2="12" y2="23"></line></svg>
          <h2>Ready to Transcribe</h2>
          <p>Click "Start Recording" to begin.</p>
        </div>
      {:else}
        <div class="transcript-container">
          <h2>Transcript</h2>
          <div class="transcript-display">
            {@html formatTranscript(transcript)}
          </div>
        </div>
        {#if summary}
          <div class="summary-container">
            <h2>Summary</h2>
            <div class="summary-display">
              {@html summary}
            </div>
          </div>
        {/if}
      {/if}
    </div>
  </main>
</div>

<style>
  .app-container {
    display: flex;
    flex-direction: column;
    height: 100vh;
    width: 100%;
    background-color: var(--background);
  }

  .app-header {
    display: flex;
    justify-content: space-between;
    align-items: center;
    padding: 1rem 2rem;
    background-color: var(--surface);
    border-bottom: 1px solid var(--border-color);
    flex-shrink: 0;
  }

  .logo {
    display: flex;
    align-items: center;
    gap: 0.75rem;
  }

  .logo h1 {
    font-size: 1.25rem;
    font-weight: 600;
    color: var(--text-primary);
  }

  .status-indicator {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }

  .pulse {
    width: 10px;
    height: 10px;
    border-radius: 50%;
    background-color: #6c757d; /* Grey for idle */
    transition: background-color 0.3s;
  }

  .pulse.active {
    background-color: var(--primary-color);
    animation: pulse-animation 1.5s infinite;
  }
  
  .pulse.processing {
    background-color: var(--secondary-color);
    animation: pulse-animation 1.5s infinite;
  }

  @keyframes pulse-animation {
    0% { box-shadow: 0 0 0 0 rgba(var(--primary-color-rgb), 0.7); }
    70% { box-shadow: 0 0 0 10px rgba(var(--primary-color-rgb), 0); }
    100% { box-shadow: 0 0 0 0 rgba(var(--primary-color-rgb), 0); }
  }

  .main-content {
    display: grid;
    grid-template-columns: 320px 1fr;
    gap: 2rem;
    padding: 2rem;
    flex-grow: 1;
    overflow: hidden;
  }

  .controls-panel {
    display: flex;
    flex-direction: column;
    gap: 2rem;
  }

  section h2 {
    font-size: 1rem;
    font-weight: 600;
    margin-bottom: 1rem;
    color: var(--text-secondary);
    text-transform: uppercase;
    letter-spacing: 0.05em;
  }

  .input-group {
    position: relative;
  }

  input[type="password"] {
    width: 100%;
    padding: 0.75rem;
    padding-right: 2.5rem;
    border: 1px solid var(--border-color);
    border-radius: 6px;
    background-color: var(--surface);
    color: var(--text-primary);
    font-size: 0.9rem;
    transition: border-color 0.2s, box-shadow 0.2s;
  }

  input[type="password"]:focus {
    outline: none;
    border-color: var(--primary-color);
    box-shadow: 0 0 0 3px rgba(20, 122, 80, 0.2);
  }

  .clear-api-btn {
    position: absolute;
    right: 0.5rem;
    top: 50%;
    transform: translateY(-50%);
    background: none;
    border: none;
    color: var(--text-secondary);
    cursor: pointer;
    font-size: 1.2rem;
    padding: 0.25rem;
  }

  .api-help {
    font-size: 0.8rem;
    color: var(--text-secondary);
    margin-top: 0.5rem;
  }
  .api-help a {
    color: var(--primary-color);
    text-decoration: none;
  }
  .api-help a:hover {
    text-decoration: underline;
  }

  .main-actions {
    display: flex;
    flex-direction: column;
    gap: 1rem;
  }

  button {
    display: flex;
    align-items: center;
    justify-content: center;
    gap: 0.5rem;
    padding: 0.75rem 1rem;
    border-radius: 6px;
    border: none;
    font-size: 1rem;
    font-weight: 500;
    cursor: pointer;
    transition: all 0.2s;
  }
  button:disabled {
    opacity: 0.5;
    cursor: not-allowed;
  }

  .btn-primary {
    background-color: var(--primary-color);
    color: white;
  }
  .btn-primary:hover:not(:disabled) {
    background-color: var(--primary-color-light);
  }

  .btn-danger {
    background-color: #dc3545;
    color: white;
  }
  .btn-danger:hover:not(:disabled) {
    background-color: #c82333;
  }

  .secondary-actions {
    display: grid;
    grid-template-columns: repeat(auto-fit, minmax(100px, 1fr));
    gap: 0.5rem;
    margin-top: 1rem;
  }

  .btn-secondary {
    background-color: var(--secondary-color);
    color: white;
  }
  .btn-secondary:hover:not(:disabled) {
    background-color: var(--secondary-color-light);
  }

  .btn-tertiary {
    background-color: transparent;
    color: var(--text-secondary);
    border: 1px solid var(--border-color);
  }
  .btn-tertiary:hover:not(:disabled) {
    background-color: var(--surface);
    border-color: var(--text-secondary);
  }

  .status-details {
    background-color: var(--surface);
    padding: 1rem;
    border-radius: 8px;
    border: 1px solid var(--border-color);
  }
  .status-item {
    display: flex;
    justify-content: space-between;
    font-size: 0.9rem;
    color: var(--text-secondary);
  }
  .status-item + .status-item {
    margin-top: 0.5rem;
  }
  .status-item strong {
    color: var(--text-primary);
    font-weight: 500;
  }

  .transcript-panel {
    background-color: var(--surface);
    border-radius: 8px;
    border: 1px solid var(--border-color);
    display: flex;
    flex-direction: column;
    overflow: hidden;
  }

  .placeholder {
    display: flex;
    flex-direction: column;
    align-items: center;
    justify-content: center;
    text-align: center;
    height: 100%;
    color: var(--text-secondary);
    padding: 2rem;
  }
  .placeholder svg {
    color: var(--border-color);
    margin-bottom: 1rem;
  }
  .placeholder h2 {
    color: var(--text-primary);
  }

  .transcript-container, .summary-container {
    padding: 1.5rem;
    overflow-y: auto;
  }
  .transcript-container {
    flex-grow: 1;
    border-bottom: 1px solid var(--border-color);
  }
  .summary-container {
    flex-shrink: 0;
    max-height: 40%;
  }

  .transcript-display, .summary-display {
    margin-top: 1rem;
  }

  .transcript-entry {
    margin-bottom: 1.5rem;
  }
  .speaker-info {
    display: flex;
    align-items: center;
    gap: 0.5rem;
    margin-bottom: 0.25rem;
  }
  .speaker-dot {
    width: 8px;
    height: 8px;
    border-radius: 50%;
  }
  .speaker-name {
    font-weight: 600;
    font-size: 0.9rem;
  }
  .timestamp {
    font-size: 0.8rem;
    color: var(--text-secondary);
  }
  .content {
    margin: 0;
    padding-left: 1.25rem;
    color: var(--text-primary);
    white-space: pre-wrap;
  }
  .error-entry .content {
    color: #e53e3e;
  }

  .summary-display :global(h3) {
    font-size: 1.1rem;
    margin-top: 1rem;
    margin-bottom: 0.5rem;
  }
  .summary-display :global(ul) {
    padding-left: 1.5rem;
  }

  /* Responsive */
  @media (max-width: 768px) {
    .app-header {
      padding: 1rem;
    }
    .main-content {
      grid-template-columns: 1fr;
      padding: 1rem;
      gap: 1rem;
    }
    .transcript-panel {
      min-height: 400px;
    }
  }
</style>
