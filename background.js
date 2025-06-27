import { AudioProcessor } from './lib/audio-processor.js';
import { GeminiClient } from './lib/gemini-client.js';
import { StorageManager } from './lib/storage-manager.js';

console.log("Background service worker started.");

let audioProcessor = null;
let geminiClient = null;
const storageManager = new StorageManager();
let segmentCounter = 0;

async function handleAudioChunk(chunk) {
  console.log("Received audio chunk in background script", chunk);
  if (!geminiClient) {
    console.error("Gemini client not initialized. Cannot process audio chunk.");
    return;
  }

  try {
    const transcriptText = await geminiClient.transcribeAudio(chunk);
    console.log("Transcript received:", transcriptText);

    const lines = transcriptText.split('\n').filter(line => line.trim() !== '');
    const chunkStartTime = segmentCounter * 5; // 5 seconds per chunk

    if (lines.length === 0 && transcriptText.trim()) {
        // Handle case where transcript is a single line without speaker tags
        lines.push(transcriptText.trim());
    }

    for (const line of lines) {
        const match = line.match(/^(Speaker\s+[\d\w]+):\s*(.*)$/);
        let speaker = 'Speaker';
        let text = line;

        if (match) {
            speaker = match[1];
            text = match[2];
        }

        const segment = {
            speaker: speaker,
            text: text,
            startTime: chunkStartTime, // Note: Time is approximate for the whole chunk
            endTime: chunkStartTime + 5,
        };

        await storageManager.appendSegment(segment);
        const currentTranscript = await storageManager.getCurrentTranscript();
        const displayName = currentTranscript.speakerMap?.[segment.speaker] || segment.speaker;

        chrome.runtime.sendMessage({
          type: 'TRANSCRIPT_UPDATE',
          data: { ...segment, speaker: displayName }
        });
    }
    segmentCounter++;

  } catch (error) {
    console.error("Error during transcription:", error);
    chrome.runtime.sendMessage({
        type: 'RECORDING_ERROR',
        data: { message: error.message }
    });
    stopRecording();
  }
}

chrome.runtime.onInstalled.addListener(() => {
  console.log("tydids transcript extension installed.");
  // Initialize the recording state on installation.
  chrome.storage.local.set({ recordingState: 'idle' });
});

// Reset state on startup in case of crash
chrome.runtime.onStartup.addListener(() => {
    console.log("Extension startup.");
    chrome.storage.local.set({ recordingState: 'idle' });
});

// Function to start the recording process
async function startRecording() {
  const { recordingState } = await chrome.storage.local.get('recordingState');
  if (recordingState === 'recording') {
    console.log('Request to start, but already recording.');
    return;
  }

  const { geminiApiKey } = await chrome.storage.sync.get('geminiApiKey');
  if (!geminiApiKey) {
    console.error("Gemini API key not found. Please set it in the options page.");
    chrome.runtime.sendMessage({
        type: 'RECORDING_ERROR',
        data: { message: 'API key is not set. Please configure it in the options.' }
    });
    await chrome.storage.local.set({ recordingState: 'idle' });
    return;
  }
  geminiClient = new GeminiClient(geminiApiKey);
  await storageManager.startNewTranscript();
  segmentCounter = 0;

  try {
    const streamId = await new Promise(resolve => 
      chrome.desktopCapture.chooseDesktopMedia(['tab', 'audio'], resolve)
    );

    if (!streamId) {
      console.log("User cancelled desktop capture.");
      await chrome.storage.local.set({ recordingState: 'idle' });
      return;
    }

    const stream = await navigator.mediaDevices.getUserMedia({
      audio: {
        mandatory: {
          chromeMediaSource: 'desktop',
          chromeMediaSourceId: streamId
        }
      }
    });

    // When the stream ends (e.g., tab closed), stop recording
    stream.getAudioTracks()[0].onended = () => {
        console.log("Audio stream ended, stopping recording.");
        stopRecording();
    };

    audioProcessor = new AudioProcessor(handleAudioChunk);
    audioProcessor.startRecording(stream);
    await chrome.storage.local.set({ recordingState: 'recording' });
    console.log("Recording has started.");

  } catch (err) {
    console.error("Error starting recording:", err);
    await chrome.storage.local.set({ recordingState: 'idle' });
  }
}

// Function to stop the recording
async function stopRecording() {
  if (audioProcessor) {
    audioProcessor.stopRecording();
    audioProcessor = null;
  }
  geminiClient = null;
  await storageManager.finalizeCurrentTranscript();
  await chrome.storage.local.set({ recordingState: 'idle' });
  console.log("Recording has been stopped.");
}

chrome.runtime.onMessage.addListener((request, sender, sendResponse) => {
  if (request.type === "START_RECORDING") {
    startRecording().then(() => sendResponse({ status: "ok" }));
    return true; // Indicates async response
  } else if (request.type === "STOP_RECORDING") {
    stopRecording().then(() => sendResponse({ status: "ok" }));
    return true; // Indicates async response
  } else if (request.type === "GET_CURRENT_TRANSCRIPT") {
    storageManager.getCurrentTranscript().then(transcript => {
        sendResponse({ transcript });
    });
    return true;
  } else if (request.type === "GET_ALL_TRANSCRIPTS") {
    storageManager.getAllTranscripts().then(transcripts => {
        sendResponse({ transcripts });
    });
    return true;
  } else if (request.type === "DELETE_TRANSCRIPT") {
    storageManager.deleteTranscript(request.transcriptId).then(() => {
        sendResponse({ status: 'ok' });
    });
    return true;
  } else if (request.type === "CLEAR_ALL_TRANSCRIPTS") {
    storageManager.clearAll().then(() => {
        sendResponse({ status: 'ok' });
    });
    return true;
  } else if (request.type === "UPDATE_SPEAKER_NAME") {
    storageManager.updateSpeakerName(request.transcriptId, request.originalName, request.newName).then(() => {
        sendResponse({ status: 'ok' });
    });
    return true;
  }
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === "toggle-recording") {
    console.log("Toggle recording command received.");
    const { recordingState } = await chrome.storage.local.get('recordingState');
    if (recordingState === 'recording') {
      await stopRecording();
    } else {
      await startRecording();
    }
  }
});
