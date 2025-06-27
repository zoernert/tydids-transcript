class GeminiClient {
  constructor() {
    this.apiKey = null;
    this.isAuthenticated = false;
    this.baseUrl = 'https://generativelanguage.googleapis.com/v1beta/models';
  }

  async authenticate(apiKey) {
    this.apiKey = apiKey;
    try {
      // Test the API key with a simple request using a known stable model
      const response = await fetch(`${this.baseUrl}/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: 'Test authentication' }]
          }]
        })
      });
      
      this.isAuthenticated = response.ok;
      return this.isAuthenticated;
    } catch (error) {
      console.error('Authentication failed:', error);
      this.isAuthenticated = false;
      return false;
    }
  }

  async transcribeText(text, previousContext = '') {
    if (!this.isAuthenticated || !this.apiKey) {
      throw new Error('Not authenticated');
    }

    const prompt = `
      You are a transcript processor. Process this raw text and format it as a clean transcript with speaker detection.
      
      Previous context: ${previousContext}
      New text to process: ${text}
      
      Rules:
      - Identify different speakers and label them as "Speaker 1", "Speaker 2", etc.
      - Maintain speaker consistency with previous context
      - Clean up grammar and remove filler words
      - Format as: "Speaker X: [clean text]"
      - If no clear speech, return "No speech detected"
      - Maximum 200 words per response
    `;

    try {
      const response = await fetch(`${this.baseUrl}/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.1,
            maxOutputTokens: 500
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Transcription error:', error);
      throw error;
    }
  }

  async summarizeTranscript(transcript) {
    if (!this.isAuthenticated || !this.apiKey) {
      throw new Error('Not authenticated');
    }

    const prompt = `
      Summarize this transcript in HTML format with proper structure:
      
      ${transcript}
      
      Include:
      - Main topics discussed
      - Key points from each speaker
      - Action items or decisions made
      - Timeline of discussion
      
      Use HTML tags like <h3>, <ul>, <li>, <p>, <strong> for formatting.
    `;

    try {
      const response = await fetch(`${this.baseUrl}/gemini-2.5-flash:generateContent`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'x-goog-api-key': this.apiKey
        },
        body: JSON.stringify({
          contents: [{
            parts: [{ text: prompt }]
          }],
          generationConfig: {
            temperature: 0.2,
            maxOutputTokens: 1000
          }
        })
      });

      if (!response.ok) {
        throw new Error(`API request failed: ${response.status}`);
      }

      const data = await response.json();
      return data.candidates[0].content.parts[0].text;
    } catch (error) {
      console.error('Summarization error:', error);
      throw error;
    }
  }
}

window.GeminiClient = GeminiClient;
