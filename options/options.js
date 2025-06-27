const apiKeyInput = document.getElementById('apiKey');
const saveButton = document.getElementById('save');
const statusDiv = document.getElementById('status');
const transcriptsListDiv = document.getElementById('transcriptsList');
const refreshButton = document.getElementById('refreshTranscripts');
const clearAllButton = document.getElementById('clearAllTranscripts');

function formatTranscriptAsTxt(transcript) {
    let txt = `Transcript from: ${new Date(transcript.timestamp).toLocaleString()}\n`;
    txt += `Duration: ${Math.round(transcript.duration)}s\n`;
    const speakers = transcript.speakers.map(s => transcript.speakerMap?.[s] || s);
    txt += `Speakers: ${speakers.join(', ')}\n\n`;
    transcript.segments.forEach(segment => {
        const displayName = transcript.speakerMap?.[segment.speaker] || segment.speaker;
        txt += `[${displayName}] ${segment.text}\n\n`;
    });
    return txt;
}

function toSrtTime(seconds) {
    const date = new Date(0);
    date.setSeconds(seconds);
    const timeString = date.toISOString().substring(11, 23); // HH:mm:ss.SSS
    return timeString.replace('.', ',');
}

function formatTranscriptAsSrt(transcript) {
    return transcript.segments.map((segment, index) => {
        const startTime = toSrtTime(segment.startTime);
        const endTime = toSrtTime(segment.endTime);
        const displayName = transcript.speakerMap?.[segment.speaker] || segment.speaker;
        return `${index + 1}\n${startTime} --> ${endTime}\n[${displayName}] ${segment.text}\n`;
    }).join('\n');
}

function downloadFile(content, fileName, contentType) {
    const a = document.createElement("a");
    const file = new Blob([content], { type: contentType });
    a.href = URL.createObjectURL(file);
    a.download = fileName;
    a.click();
    URL.revokeObjectURL(a.href);
}

function renderTranscripts(transcripts) {
    transcriptsListDiv.innerHTML = '';
    if (!transcripts || transcripts.length === 0) {
        transcriptsListDiv.innerHTML = '<p>No transcripts saved yet.</p>';
        return;
    }

    transcripts.forEach(transcript => {
        const item = document.createElement('div');
        item.className = 'transcript-item';
        
        const date = new Date(transcript.timestamp).toLocaleString();
        const snippet = transcript.segments.length > 0 ? transcript.segments[0].text.substring(0, 100) + '...' : 'Empty transcript';

        let speakerHtml = '';
        if (transcript.speakers && transcript.speakers.length > 0) {
            speakerHtml = '<div class="speaker-management"><h4>Speakers</h4><ul>';
            transcript.speakers.forEach(speaker => {
                const customName = transcript.speakerMap?.[speaker] || '';
                speakerHtml += `
                    <li>
                        <label for="speaker_${transcript.id}_${speaker}">${speaker}:</label>
                        <input type="text" id="speaker_${transcript.id}_${speaker}" class="speaker-name-input" 
                               value="${customName}" placeholder="Enter custom name"
                               data-transcript-id="${transcript.id}" data-original-name="${speaker}">
                    </li>
                `;
            });
            speakerHtml += '</ul></div>';
        }

        item.innerHTML = `
            <h3>Transcript - ${date}</h3>
            <p>${snippet}</p>
            <div class="actions">
                <button data-id="${transcript.id}" class="export-txt">Export TXT</button>
                <button data-id="${transcript.id}" class="export-json">Export JSON</button>
                <button data-id="${transcript.id}" class="export-srt">Export SRT</button>
                <button data-id="${transcript.id}" class="delete danger">Delete</button>
            </div>
            ${speakerHtml}
        `;
        transcriptsListDiv.appendChild(item);
    });
}

function loadTranscripts() {
    chrome.runtime.sendMessage({ type: 'GET_ALL_TRANSCRIPTS' }, (response) => {
        if (response && response.transcripts) {
            renderTranscripts(response.transcripts);
        }
    });
}

// Load saved API key and transcripts
document.addEventListener('DOMContentLoaded', () => {
  chrome.storage.sync.get(['geminiApiKey'], (result) => {
    if (result.geminiApiKey) {
      apiKeyInput.value = result.geminiApiKey;
    }
  });
  loadTranscripts();
});

// Save API key
saveButton.addEventListener('click', () => {
  const apiKey = apiKeyInput.value;
  chrome.storage.sync.set({ geminiApiKey: apiKey }, () => {
    statusDiv.textContent = 'Options saved.';
    setTimeout(() => {
      statusDiv.textContent = '';
    }, 1500);
  });
});

refreshButton.addEventListener('click', loadTranscripts);

clearAllButton.addEventListener('click', () => {
    if (confirm('Are you sure you want to delete ALL transcripts? This cannot be undone.')) {
        chrome.runtime.sendMessage({ type: 'CLEAR_ALL_TRANSCRIPTS' }, () => {
            loadTranscripts();
        });
    }
});

transcriptsListDiv.addEventListener('change', (e) => {
    if (e.target.classList.contains('speaker-name-input')) {
        const transcriptId = e.target.dataset.transcriptId;
        const originalName = e.target.dataset.originalName;
        const newName = e.target.value.trim();

        chrome.runtime.sendMessage({
            type: 'UPDATE_SPEAKER_NAME',
            transcriptId,
            originalName,
            newName
        }, () => {
            statusDiv.textContent = 'Speaker name updated.';
            setTimeout(() => { statusDiv.textContent = ''; }, 1500);
        });
    }
});

transcriptsListDiv.addEventListener('click', (e) => {
    const target = e.target;
    const transcriptId = target.dataset.id;
    if (!transcriptId) return;

    // We need to get the full transcript data again for export
    chrome.runtime.sendMessage({ type: 'GET_ALL_TRANSCRIPTS' }, (response) => {
        if (!response || !response.transcripts) return;
        const transcript = response.transcripts.find(t => t.id === transcriptId);
        if (!transcript) return;

        if (target.classList.contains('export-txt')) {
            const txtContent = formatTranscriptAsTxt(transcript);
            downloadFile(txtContent, `${transcript.id}.txt`, 'text/plain');
        } else if (target.classList.contains('export-json')) {
            const jsonContent = JSON.stringify(transcript, null, 2);
            downloadFile(jsonContent, `${transcript.id}.json`, 'application/json');
        } else if (target.classList.contains('export-srt')) {
            const srtContent = formatTranscriptAsSrt(transcript);
            downloadFile(srtContent, `${transcript.id}.srt`, 'application/x-subrip');
        } else if (target.classList.contains('delete')) {
            if (confirm(`Are you sure you want to delete the transcript from ${new Date(transcript.timestamp).toLocaleString()}?`)) {
                chrome.runtime.sendMessage({ type: 'DELETE_TRANSCRIPT', transcriptId }, () => {
                    loadTranscripts();
                });
            }
        }
    });
});
