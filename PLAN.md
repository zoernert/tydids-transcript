# tydids transcript - Chrome Extension Entwicklungsplan

## Projekt-Übersicht
Eine Chrome Extension für Live-Audio-Transkription mit Sprechererkennung über Google Gemini API.

## Projektstruktur
```
tydids-transcript/
├── manifest.json
├── background.js
├── content.js
├── popup/
│   ├── popup.html
│   ├── popup.js
│   └── popup.css
├── options/
│   ├── options.html
│   ├── options.js
│   └── options.css
├── lib/
│   ├── audio-processor.js
│   ├── gemini-client.js
│   └── storage-manager.js
├── assets/
│   ├── icon16.png
│   ├── icon48.png
│   └── icon128.png
└── README.md
```

## Phase 1: Grundgerüst und Manifest
### Aufgaben:
1. **manifest.json erstellen**
   - Manifest V3 Format
   - Permissions: `activeTab`, `storage`, `scripting`, `desktopCapture`, `tabCapture`
   - Background script konfigurieren
   - Content security policy für externe API-Calls

2. **Basis-Dateien anlegen**
   - Leere HTML-Dateien für Popup und Options
   - Basis-JavaScript-Dateien
   - CSS-Dateien mit grundlegendem Styling

3. **Icon-Set erstellen**
   - 16x16, 48x48, 128x128 Pixel
   - Einfaches Mikrofon-Symbol als Placeholder

## Phase 2: Audio-Erfassung implementieren
### Aufgaben:
1. **audio-processor.js entwickeln**
   - Klasse `AudioProcessor` mit Methoden:
     - `startRecording()` - Startet Audio-Erfassung
     - `stopRecording()` - Stoppt Audio-Erfassung
     - `processAudioChunk(chunk)` - Verarbeitet Audio-Daten
     - `getAudioStream()` - Zugriff auf MediaStream

2. **Desktop Audio Capture**
   - `chrome.desktopCapture.chooseDesktopMedia()` implementieren
   - Audio-Stream von ausgewählter Quelle erfassen
   - Fehlerbehandlung für abgelehnte Berechtigungen

3. **Audio-Format-Konvertierung**
   - MediaRecorder API nutzen
   - Audio in für Gemini geeignetes Format konvertieren (WebM/MP3)
   - Chunk-basierte Verarbeitung für Live-Streaming

## Phase 3: Google Gemini Integration
### Aufgaben:
1. **gemini-client.js entwickeln**
   - Klasse `GeminiClient` mit Methoden:
     - `authenticate(apiKey)` - API-Key Validierung
     - `transcribeAudio(audioBlob)` - Audio-Transkription
     - `processWithSpeakerDetection(audioBlob)` - Sprechererkennung
     - `handleResponse(response)` - Response-Verarbeitung

2. **API-Konfiguration**
   - Gemini API Endpoints definieren
   - Request-Header und Authentifizierung
   - Rate limiting und Fehlerbehandlung

3. **Streaming-Transkription**
   - Real-time Audio-Chunks an API senden
   - Partial results verarbeiten
   - Speaker diarization konfigurieren

## Phase 4: UI/UX Implementation
### Aufgaben:
1. **popup.html & popup.js**
   - Start/Stop Recording Button
   - Live-Transkript-Anzeige
   - Sprecher-Farbkodierung
   - Status-Anzeigen (Recording, Processing, Error)

2. **options.html & options.js**
   - Gemini API Key Eingabe
   - Audio-Quellen-Auswahl
   - Sprach-Einstellungen
   - Export-Optionen (TXT, JSON, SRT)

3. **CSS-Styling**
   - Moderne, responsive UI
   - Dark/Light Theme
   - Animations für Recording-Status
   - Accessibility-konforme Farben

## Phase 5: Datenmanagement
### Aufgaben:
1. **storage-manager.js entwickeln**
   - Klasse `StorageManager` mit Methoden:
     - `saveTranscript(transcript)` - Transkript speichern
     - `loadTranscripts()` - Gespeicherte Transkripte laden
     - `exportTranscript(format)` - Export-Funktionalität
     - `clearStorage()` - Daten löschen

2. **Chrome Storage API**
   - `chrome.storage.sync` für Einstellungen
   - `chrome.storage.local` für Transkripte
   - Quota-Management implementieren

3. **Datenstrukturen**
   ```javascript
   const transcriptFormat = {
     id: 'unique-id',
     timestamp: Date.now(),
     duration: 0,
     speakers: ['Speaker 1', 'Speaker 2'],
     segments: [
       {
         speaker: 'Speaker 1',
         text: 'Transkript-Text',
         startTime: 0,
         endTime: 5.2
       }
     ]
   }
   ```

## Phase 6: Background Script und Kommunikation
### Aufgaben:
1. **background.js implementieren**
   - Service Worker für Manifest V3
   - Message passing zwischen Components
   - Tab-Management für Audio-Capture
   - Lifecycle-Management

2. **Message-System**
   - Events definieren: `START_RECORDING`, `STOP_RECORDING`, `TRANSCRIPT_UPDATE`
   - Cross-component communication
   - Error-Propagation

3. **Performance-Optimierung**
   - Memory-Management für Audio-Buffers
   - Batch-Processing für API-Calls
   - Cleanup-Mechanismen

## Phase 7: Fehlerbehandlung und Sicherheit
### Aufgaben:
1. **Comprehensive Error Handling**
   - API-Fehler (Rate limits, Auth failures)
   - Audio-Fehler (Device not found, Permission denied)
   - Network-Fehler (Offline, Timeout)
   - User-friendly Error Messages

2. **Sicherheitsmaßnahmen**
   - API-Key sichere Speicherung
   - Input-Validierung
   - CSP-Compliance
   - Privacy-Mode (keine Daten-Speicherung)

3. **Logging und Debugging**
   - Console-Logging mit Log-Levels
   - Debug-Modus für Entwicklung
   - Performance-Metriken

## Phase 8: Testing und Deployment
### Aufgaben:
1. **Unit Tests**
   - Audio-Processing-Tests
   - API-Integration-Tests
   - Storage-Tests
   - Jest oder ähnliches Framework

2. **Integration Tests**
   - End-to-End-Szenarien
   - Browser-Kompatibilität
   - Permission-Handling

3. **Chrome Web Store Vorbereitung**
   - Store-Listing erstellen
   - Screenshots und Beschreibung
   - Privacy Policy
   - Manifest-Validierung

## Technische Spezifikationen

### Gemini API Integration
```javascript
// Beispiel API-Call
const response = await fetch('https://generativelanguage.googleapis.com/v1/models/gemini-pro:generateContent', {
  method: 'POST',
  headers: {
    'Content-Type': 'application/json',
    'Authorization': `Bearer ${apiKey}`
  },
  body: JSON.stringify({
    contents: [{
      parts: [{
        inlineData: {
          mimeType: 'audio/wav',
          data: base64AudioData
        }
      }]
    }],
    generationConfig: {
      temperature: 0.1,
      maxOutputTokens: 1000
    }
  })
});
```

### Audio-Erfassung
```javascript
// Desktop Capture
chrome.desktopCapture.chooseDesktopMedia(['screen', 'window', 'tab'], (streamId) => {
  navigator.mediaDevices.getUserMedia({
    audio: {
      mandatory: {
        chromeMediaSource: 'desktop',
        chromeMediaSourceId: streamId
      }
    }
  }).then(stream => {
    // Audio-Stream verarbeiten
  });
});
```

### Message Passing
```javascript
// Background -> Content
chrome.tabs.sendMessage(tabId, {
  type: 'TRANSCRIPT_UPDATE',
  data: transcriptSegment
});

// Content -> Background
chrome.runtime.sendMessage({
  type: 'START_RECORDING',
  audioSource: 'desktop'
});
```

## Entwicklungsreihenfolge
1. **Woche 1**: Phase 1-2 (Grundgerüst + Audio-Erfassung)
2. **Woche 2**: Phase 3-4 (Gemini Integration + UI)
3. **Woche 3**: Phase 5-6 (Datenmanagement + Background)
4. **Woche 4**: Phase 7-8 (Fehlerbehandlung + Testing)

## Zusätzliche Features (Optional)
- Keyboard Shortcuts für Start/Stop
- Transcript-Export als PDF
- Custom Speaker-Namen
- Audio-Playback mit Transcript-Sync
- Multi-Language Support
- Cloud-Sync für Transkripte

## Hilfreiche Ressourcen
- [Chrome Extension Manifest V3](https://developer.chrome.com/docs/extensions/mv3/)
- [Google Gemini API Documentation](https://ai.google.dev/docs)
- [Web Audio API](https://developer.mozilla.org/en-US/docs/Web/API/Web_Audio_API)
- [Chrome Desktop Capture API](https://developer.chrome.com/docs/extensions/reference/desktopCapture/)

## Getting Started
1. Repository erstellen: `git init tydids-transcript`
2. Grundstruktur anlegen: `mkdir -p popup options lib assets`
3. Mit Phase 1 beginnen: `manifest.json` erstellen
4. GitHub Co-Pilot für Code-Generierung nutzen mit diesem Plan als Kontext