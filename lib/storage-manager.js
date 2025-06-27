class StorageManager {
  constructor() {
    this.storage = chrome.storage;
  }

  async saveApiKey(apiKey) {
    return new Promise((resolve, reject) => {
      this.storage.sync.set({ 'gemini-api-key': apiKey }, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async getApiKey() {
    return new Promise((resolve, reject) => {
      this.storage.sync.get(['gemini-api-key'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result['gemini-api-key'] || null);
        }
      });
    });
  }

  async saveTranscript(transcript) {
    const transcriptData = {
      id: Date.now().toString(),
      timestamp: new Date().toISOString(),
      content: transcript,
      duration: 0 // Will be calculated
    };

    return new Promise((resolve, reject) => {
      this.storage.local.get(['transcripts'], (result) => {
        const transcripts = result.transcripts || [];
        transcripts.unshift(transcriptData);
        
        // Keep only last 10 transcripts
        if (transcripts.length > 10) {
          transcripts.splice(10);
        }

        this.storage.local.set({ transcripts }, () => {
          if (chrome.runtime.lastError) {
            reject(chrome.runtime.lastError);
          } else {
            resolve(transcriptData);
          }
        });
      });
    });
  }

  async getTranscripts() {
    return new Promise((resolve, reject) => {
      this.storage.local.get(['transcripts'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve(result.transcripts || []);
        }
      });
    });
  }

  async clearTranscripts() {
    return new Promise((resolve, reject) => {
      this.storage.local.remove(['transcripts'], () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async saveSettings(settings) {
    return new Promise((resolve, reject) => {
      this.storage.sync.set(settings, () => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve();
        }
      });
    });
  }

  async getSettings() {
    return new Promise((resolve, reject) => {
      this.storage.sync.get(['audioSource', 'language', 'autoSave'], (result) => {
        if (chrome.runtime.lastError) {
          reject(chrome.runtime.lastError);
        } else {
          resolve({
            audioSource: result.audioSource || 'microphone',
            language: result.language || 'en',
            autoSave: result.autoSave !== false
          });
        }
      });
    });
  }
}

window.StorageManager = StorageManager;
