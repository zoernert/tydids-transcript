class AudioProcessor {
  constructor() {
    this.mediaRecorder = null;
    this.audioStream = null;
    this.audioContext = null;
    this.analyser = null;
    this.isRecording = false;
    this.audioChunks = [];
    this.onAudioData = null;
    this.silenceThreshold = 30;
    this.silenceDuration = 2000;
    this.lastSoundTime = 0;
    this.chunkStartTime = 0;
  }

  async startRecording(source = 'microphone') {
    try {
      if (source === 'desktop') {
        const streamId = await this.getDesktopStream();
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            mandatory: {
              chromeMediaSource: 'desktop',
              chromeMediaSourceId: streamId
            }
          }
        });
      } else {
        this.audioStream = await navigator.mediaDevices.getUserMedia({
          audio: {
            sampleRate: 16000,
            channelCount: 1,
            echoCancellation: true,
            noiseSuppression: true
          }
        });
      }

      this.setupAudioAnalysis();
      this.setupMediaRecorder();
      
      this.mediaRecorder.start(500);
      this.isRecording = true;
      this.chunkStartTime = Date.now();
      this.lastSoundTime = Date.now();
      
      this.detectSilence();
      
      return true;
    } catch (error) {
      console.error('Error starting recording:', error);
      throw error;
    }
  }

  async getDesktopStream() {
    return new Promise((resolve, reject) => {
      chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (streamId) => {
        if (streamId) {
          resolve(streamId);
        } else {
          reject(new Error('Desktop capture cancelled'));
        }
      });
    });
  }

  setupAudioAnalysis() {
    this.audioContext = new AudioContext();
    const source = this.audioContext.createMediaStreamSource(this.audioStream);
    this.analyser = this.audioContext.createAnalyser();
    this.analyser.fftSize = 256;
    source.connect(this.analyser);
  }

  setupMediaRecorder() {
    this.mediaRecorder = new MediaRecorder(this.audioStream, {
      mimeType: 'audio/webm;codecs=opus'
    });

    this.audioChunks = [];

    this.mediaRecorder.ondataavailable = (event) => {
      if (event.data.size > 0) {
        this.audioChunks.push(event.data);
      }
    };

    this.mediaRecorder.onstop = () => {
      if (!this.isRecording && this.audioChunks.length > 0) {
        const audioBlob = new Blob(this.audioChunks, { type: 'audio/webm' });
        this.processAudioChunk(audioBlob);
      }
    };
  }

  detectSilence() {
    if (!this.analyser || !this.isRecording) return;

    const bufferLength = this.analyser.frequencyBinCount;
    const dataArray = new Uint8Array(bufferLength);
    this.analyser.getByteFrequencyData(dataArray);

    const average = dataArray.reduce((sum, value) => sum + value, 0) / bufferLength;
    const volume = 20 * Math.log10(average + 1);

    const currentTime = Date.now();
    const chunkDuration = currentTime - this.chunkStartTime;

    if (volume > this.silenceThreshold) {
      this.lastSoundTime = currentTime;
    } else if (currentTime - this.lastSoundTime > this.silenceDuration && chunkDuration > 3000) {
      this.processCurrentChunk();
    }

    if (chunkDuration > 30000) {
      this.processCurrentChunk();
    }

    if (this.isRecording) {
      requestAnimationFrame(() => this.detectSilence());
    }
  }

  processCurrentChunk() {
    if (this.audioChunks.length === 0) return;

    const chunksToProcess = [...this.audioChunks];
    this.audioChunks = [];
    this.chunkStartTime = Date.now();

    const audioBlob = new Blob(chunksToProcess, { type: 'audio/webm' });
    this.processAudioChunk(audioBlob);
  }

  async processAudioChunk(audioBlob) {
    if (audioBlob.size < 5000) return;

    if (this.onAudioData) {
      this.onAudioData(audioBlob);
    }
  }

  stopRecording() {
    this.isRecording = false;

    if (this.mediaRecorder && this.mediaRecorder.state === 'recording') {
      this.mediaRecorder.stop();
    }

    if (this.audioStream) {
      this.audioStream.getTracks().forEach(track => track.stop());
      this.audioStream = null;
    }

    if (this.audioContext) {
      this.audioContext.close();
      this.audioContext = null;
      this.analyser = null;
    }
  }

  setAudioDataCallback(callback) {
    this.onAudioData = callback;
  }
}

window.AudioProcessor = AudioProcessor;
