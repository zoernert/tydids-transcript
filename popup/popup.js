class TranscriptPopup {
  constructor() {
    this.audioProcessor = new AudioProcessor();
    this.geminiClient = new GeminiClient();
    this.storageManager = new StorageManager();
    this.recognition = null;
    this.isRecording = false;
    this.transcript = '';
    this.interimTranscript = '';
    this.previousContext = '';
    
    this.initializeElements();
    this.setupEventListeners();
    this.loadApiKey();
  }

  initializeElements() {
    this.elements = {
      apiStatus: document.getElementById('apiStatus'),
      apiIndicator: document.getElementById('apiIndicator'),
      apiText: document.getElementById('apiText'),
      startBtn: document.getElementById('startBtn'),
      stopBtn: document.getElementById('stopBtn'),
      clearBtn: document.getElementById('clearBtn'),
      recordingStatus: document.getElementById('recordingStatus'),
      statusText: document.getElementById('statusText'),
      transcript: document.getElementById('transcript'),
      summarizeBtn: document.getElementById('summarizeBtn'),
      copyBtn: document.getElementById('copyBtn'),
      optionsBtn: document.getElementById('optionsBtn'),
      summary: document.getElementById('summary')
    };
  }

  setupEventListeners() {
    this.elements.startBtn.addEventListener('click', () => this.startRecording());
    this.elements.stopBtn.addEventListener('click', () => this.stopRecording());
    this.elements.clearBtn.addEventListener('click', () => this.clearTranscript());
    this.elements.summarizeBtn.addEventListener('click', () => this.summarizeTranscript());
    this.elements.copyBtn.addEventListener('click', () => this.copyTranscript());
    this.elements.optionsBtn.addEventListener('click', () => this.openOptions());
  }

  async loadApiKey() {
    try {
      const apiKey = await this.storageManager.getApiKey();
      if (apiKey) {
        const isValid = await this.geminiClient.authenticate(apiKey);
        this.updateApiStatus(isValid);
      }
    } catch (error) {
      console.error('Error loading API key:', error);
    }
  }

  updateApiStatus(isValid) {
    if (isValid) {
      this.elements.apiIndicator.textContent = '✅';
      this.elements.apiText.textContent = 'API Connected';
      this.elements.startBtn.disabled = false;
    } else {
      this.elements.apiIndicator.textContent = '❌';
      this.elements.apiText.textContent = 'API Key Required';
      this.elements.startBtn.disabled = true;
    }
  }

  async startRecording() {
    try {
      // Use Web Speech API for real-time transcription
      if (!('webkitSpeechRecognition' in window) && !('SpeechRecognition' in window)) {
        throw new Error('Speech recognition not supported');
      }

      const SpeechRecognition = window.SpeechRecognition || window.webkitSpeechRecognition;
      this.recognition = new SpeechRecognition();
      
      this.recognition.continuous = true;
      this.recognition.interimResults = true;
      this.recognition.lang = 'en-US';

      this.recognition.onstart = () => {
        this.isRecording = true;
        this.updateRecordingUI(true);
      };

      this.recognition.onresult = (event) => {
        this.handleSpeechResult(event);
      };

      this.recognition.onerror = (error) => {
        console.error('Speech recognition error:', error);
        this.stopRecording();
      };

      this.recognition.onend = () => {
        if (this.isRecording) {
          // Restart recognition for continuous listening
          setTimeout(() => {
            if (this.isRecording) {
              this.recognition.start();
            }
          }, 100);
        }
      };

      this.recognition.start();
      
    } catch (error) {
      console.error('Error starting recording:', error);
      alert('Error starting recording: ' + error.message);
    }
  }

  async handleSpeechResult(event) {
    let interimTranscript = '';
    let finalTranscript = '';

    for (let i = event.resultIndex; i < event.results.length; i++) {
      const transcript = event.results[i][0].transcript;
      if (event.results[i].isFinal) {
        finalTranscript += transcript;
      } else {
        interimTranscript += transcript;
      }
    }

    // Update display with interim results
    this.displayTranscript(this.transcript + finalTranscript + interimTranscript);

    // Process final results with Gemini
    if (finalTranscript) {
      try {
        const processedText = await this.geminiClient.transcribeText(
          finalTranscript, 
          this.previousContext
        );
        
        if (processedText && !processedText.toLowerCase().includes('no speech detected')) {
          const timestamp = new Date().toLocaleTimeString();
          const newEntry = `[${timestamp}] ${processedText}\n\n`;
          this.transcript += newEntry;
          this.previousContext = this.transcript.slice(-500); // Keep last 500 chars for context
          
          this.displayTranscript(this.transcript);
          this.updateButtons();
        }
      } catch (error) {
        console.error('Error processing transcript:', error);
      }
    }
  }

  stopRecording() {
    this.isRecording = false;
    
    if (this.recognition) {
      this.recognition.stop();
      this.recognition = null;
    }
    
    this.updateRecordingUI(false);
    
    // Auto-save transcript
    if (this.transcript.trim()) {
      this.storageManager.saveTranscript(this.transcript);
    }
  }

  updateRecordingUI(recording) {
    if (recording) {
      this.elements.startBtn.disabled = true;
      this.elements.stopBtn.disabled = false;
      this.elements.recordingStatus.classList.remove('hidden');
      this.elements.statusText.textContent = 'Listening...';
    } else {
      this.elements.startBtn.disabled = false;
      this.elements.stopBtn.disabled = true;
      this.elements.recordingStatus.classList.add('hidden');
    }
  }

  displayTranscript(text) {
    if (text.trim()) {
      this.elements.transcript.innerHTML = this.formatTranscript(text);
      this.elements.transcript.scrollTop = this.elements.transcript.scrollHeight;
    } else {
      this.elements.transcript.innerHTML = `
        <div class="placeholder">
          Your live transcript will appear here...
          <br><small>Click "Start Recording" to begin</small>
        </div>
      `;
    }
  }

  formatTranscript(text) {
    const speakerColors = ['speaker-1', 'speaker-2', 'speaker-3', 'speaker-4', 'speaker-5', 'speaker-6'];
    const speakerMap = new Map();
    let colorIndex = 0;

    return text.split('\n\n').map(line => {
      if (!line.trim()) return '';
      
      const speakerMatch = line.match(/\[(.*?)\]\s*(Speaker \d+):\s*(.*)/);
      if (speakerMatch) {
        const [, timestamp, speaker, content] = speakerMatch;
        
        if (!speakerMap.has(speaker)) {
          speakerMap.set(speaker, speakerColors[colorIndex % speakerColors.length]);
          colorIndex++;
        }
        
        const colorClass = speakerMap.get(speaker);
        return `
          <div class="transcript-entry">
            <span class="timestamp">${timestamp}</span>
            <span class="speaker ${colorClass}">${speaker}:</span>
            ${content}
          </div>
        `;
      }
      
      return `<div class="transcript-entry">${line}</div>`;
    }).join('');
  }

  formatTranscriptAsMarkdown(text) {
    return text.split('\n\n').map(line => {
      if (!line.trim()) return '';
      
      const speakerMatch = line.match(/\[(.*?)\]\s*(Speaker \d+):\s*(.*)/);
      if (speakerMatch) {
        const [, timestamp, speaker, content] = speakerMatch;
        return `**${speaker.trim()}** (*${timestamp.trim()}*): ${content.trim()}`;
      }
      
      return line.trim();
    }).join('\n\n');
  }

  updateButtons() {
    const hasTranscript = this.transcript.trim().length > 0;
    this.elements.summarizeBtn.disabled = !hasTranscript || this.isRecording;
    this.elements.copyBtn.disabled = !hasTranscript;
    this.elements.clearBtn.disabled = !hasTranscript || this.isRecording;
  }

  clearTranscript() {
    this.transcript = '';
    this.previousContext = '';
    this.displayTranscript('');
    this.elements.summary.classList.add('hidden');
    this.updateButtons();
  }

  async summarizeTranscript() {
    if (!this.transcript.trim()) return;

    try {
      this.elements.summarizeBtn.disabled = true;
      this.elements.summarizeBtn.textContent = '🔄 Summarizing...';
      
      const summary = await this.geminiClient.summarizeTranscript(this.transcript);
      
      this.elements.summary.innerHTML = summary;
      this.elements.summary.classList.remove('hidden');
      
    } catch (error) {
      console.error('Error summarizing:', error);
      alert('Error creating summary: ' + error.message);
    } finally {
      this.elements.summarizeBtn.disabled = false;
      this.elements.summarizeBtn.textContent = '📋 Summarize';
    }
  }

  async copyTranscript() {
    if (!this.transcript.trim()) return;

    const markdown = this.formatTranscriptAsMarkdown(this.transcript);
    
    try {
      await navigator.clipboard.writeText(markdown);
      const originalText = this.elements.copyBtn.textContent;
      this.elements.copyBtn.textContent = 'Copied!';
      setTimeout(() => {
        this.elements.copyBtn.textContent = originalText;
      }, 2000);
    } catch (err) {
      console.error('Failed to copy transcript: ', err);
      alert('Failed to copy transcript.');
    }
  }

  openOptions() {
    chrome.runtime.openOptionsPage();
  }
}

// Initialize popup when DOM is loaded
document.addEventListener('DOMContentLoaded', () => {
  new TranscriptPopup();
});
