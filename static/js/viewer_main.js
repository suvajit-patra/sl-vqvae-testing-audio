const BASE_PREFIX = (window.APP_ROOT || '').replace(/\/$/, '');
const socket = io({
    path: BASE_PREFIX ? `${BASE_PREFIX}/socket.io` : '/socket.io',
    transports: ['websocket', 'polling']
});

const currentIndexDisplay = document.getElementById('current-index');
const sampleTextDisplay = document.getElementById('sample-text');
const statusBar = document.getElementById('status-bar');
const recordButton = document.getElementById('record-btn');
const viewerStatus = document.getElementById('viewer-status');
const viewerAudio = document.getElementById('viewer-audio');

let currentIndex = 0;
let currentRow = { id: '', text: '', audio_url: '', recording_enabled: true };
let recordingEnabled = true;
let mediaRecorder;
let recorderStream;
let audioChunks = [];
let isRecording = false;

function setStatus(message, isError = false) {
    statusBar.textContent = message;
    statusBar.style.color = isError ? '#f87171' : '#9ca3af';
    viewerStatus.textContent = message;
    viewerStatus.style.color = isError ? '#f87171' : '#d1d5db';
}

function clearPlayback() {
    if (viewerAudio) {
        viewerAudio.pause();
        viewerAudio.currentTime = 0;
        viewerAudio.src = '';
        viewerAudio.load();
        viewerAudio.style.display = 'none';
    }
    currentRow.audio_url = '';
}

function applyAudioSource(audioElement, url) {
    if (!audioElement) return;
    audioElement.pause();
    audioElement.currentTime = 0;
    audioElement.src = window.APP_ROOT+url || '';
    audioElement.load();
    audioElement.style.display = url ? 'block' : 'none';
}

function setRecordState(enabled) {
    recordingEnabled = Boolean(enabled);
    recordButton.disabled = !recordingEnabled;
    recordButton.classList.toggle('enabled', recordingEnabled);
    recordButton.classList.toggle('pressed', false);
    recordButton.textContent = recordingEnabled ? 'Hold to Record' : 'Recording locked';
}

function updateRowState(data) {
    if (!data) return;

    currentIndex = Number(data.index || 0);
    currentIndexDisplay.textContent = String(currentIndex);
    sampleTextDisplay.textContent = data.text || 'No text available';
    currentRow = {
        ...currentRow,
        ...data,
        id: data.id || currentRow.id,
        text: data.text || currentRow.text,
        audio_url: data.audio_url || ''
    };

    if (currentRow.audio_url) {
        applyAudioSource(viewerAudio, currentRow.audio_url);
    } else {
        applyAudioSource(viewerAudio, '');
    }

    const enabled = data.recording_enabled !== undefined ? Boolean(data.recording_enabled) : true;
    setRecordState(enabled);
    setStatus(data.status || 'Ready for recording');
}

function writeWavHeader(view, sampleRate, channels, dataLength) {
    const bytesPerSample = 2;
    const blockAlign = channels * bytesPerSample;
    const byteRate = sampleRate * blockAlign;

    writeString(view, 0, 'RIFF');
    view.setUint32(4, 36 + dataLength, true);
    writeString(view, 8, 'WAVE');
    writeString(view, 12, 'fmt ');
    view.setUint32(16, 16, true);
    view.setUint16(20, 1, true);
    view.setUint16(22, channels, true);
    view.setUint32(24, sampleRate, true);
    view.setUint32(28, byteRate, true);
    view.setUint16(32, blockAlign, true);
    view.setUint16(34, 16, true);
    writeString(view, 36, 'data');
    view.setUint32(40, dataLength, true);
}

function writeString(view, offset, string) {
    for (let i = 0; i < string.length; i++) {
        view.setUint8(offset + i, string.charCodeAt(i));
    }
}

async function convertAudioBlobToWav(blob) {
    const arrayBuffer = await blob.arrayBuffer();
    const audioContext = new (window.AudioContext || window.webkitAudioContext)();
    const decoded = await audioContext.decodeAudioData(arrayBuffer.slice(0));

    const numberOfChannels = decoded.numberOfChannels;
    const sampleRate = decoded.sampleRate;
    const length = decoded.length * numberOfChannels;
    const wavBuffer = new ArrayBuffer(44 + length * 2);
    const view = new DataView(wavBuffer);

    writeWavHeader(view, sampleRate, numberOfChannels, length * 2);

    let offset = 44;
    for (let i = 0; i < decoded.length; i++) {
        for (let channel = 0; channel < numberOfChannels; channel++) {
            const sample = Math.max(-1, Math.min(1, decoded.getChannelData(channel)[i]));
            view.setInt16(offset, sample < 0 ? sample * 0x8000 : sample * 0x7fff, true);
            offset += 2;
        }
    }

    await audioContext.close();
    return new Blob([wavBuffer], { type: 'audio/wav' });
}

async function stopRecording() {
    if (!isRecording || !mediaRecorder) return;

    isRecording = false;
    recordButton.classList.remove('pressed');
    setRecordState(false);
    setStatus('Saving recording...');

    mediaRecorder.stop();

    const stream = recorderStream;
    if (stream && stream.getTracks) {
        stream.getTracks().forEach((track) => track.stop());
    }
}

async function beginRecording() {
    if (!recordingEnabled || isRecording) return;

    clearPlayback();
    setStatus('Preparing microphone...');

    if (!navigator.mediaDevices || !navigator.mediaDevices.getUserMedia) {
        setStatus('Microphone not supported by this browser.', true);
        return;
    }

    try {
        recorderStream = await navigator.mediaDevices.getUserMedia({ audio: true });
        audioChunks = [];
        mediaRecorder = new MediaRecorder(recorderStream, { mimeType: 'audio/webm' });

        mediaRecorder.ondataavailable = (event) => {
            if (event.data && event.data.size > 0) {
                audioChunks.push(event.data);
            }
        };

        mediaRecorder.onstop = async () => {
            const capturedBlob = new Blob(audioChunks, { type: mediaRecorder.mimeType || 'audio/webm' });
            try {
                const wavFile = await convertAudioBlobToWav(capturedBlob);
                const formData = new FormData();
                formData.append('id', currentRow.id || String(currentIndex));
                formData.append('audio', wavFile, `${currentRow.id || currentIndex}.wav`);

                const response = await fetch('api/upload_recording', {
                    method: 'POST',
                    body: formData
                });
                const payload = await response.json();

                if (!response.ok || payload.status !== 'success') {
                    throw new Error(payload.message || 'Recording upload failed.');
                }

                const savedAudioUrl = payload.audio_url || '';
                setStatus('Saving complete. Sending audio...');
                currentRow.audio_url = savedAudioUrl;

                if (savedAudioUrl) {
                    applyAudioSource(viewerAudio, savedAudioUrl);
                }

                socket.emit('viewer_recording_complete', {
                    index: currentIndex,
                    id: currentRow.id || String(currentIndex),
                    text: currentRow.text,
                    audio_url: savedAudioUrl
                });

                setStatus('Recording received by admin');
            } catch (error) {
                console.error(error);
                const message = error.message || 'The recording file is invalid or corrupted.';
                setStatus(message, true);
                socket.emit('viewer_recording_error', {
                    index: currentIndex,
                    id: currentRow.id || String(currentIndex),
                    message
                });
            }
        };

        mediaRecorder.start();
        isRecording = true;
        recordButton.classList.add('pressed');
        setStatus('Recording...');
    } catch (error) {
        console.error(error);
        setStatus('Microphone permission denied.', true);
    }
}

recordButton.addEventListener('pointerdown', (event) => {
    event.preventDefault();
    beginRecording();
});

recordButton.addEventListener('pointerup', stopRecording);
recordButton.addEventListener('pointerleave', stopRecording);
recordButton.addEventListener('pointercancel', stopRecording);

document.addEventListener('pointerup', () => {
    if (isRecording) stopRecording();
});

socket.on('sync_recording', (data) => {
    if (!data) return;
    updateRowState({
        index: data.index,
        id: data.id,
        text: data.text,
        audio_url: data.audio_url,
        audio_exists: data.audio_exists,
        recording_enabled: data.recording_enabled,
        status: data.status
    });
});

socket.on('viewer_recording_state', (data) => {
    updateRowState({
        index: data.index,
        id: data.id,
        text: data.text,
        audio_url: data.audio_url,
        audio_exists: data.audio_exists,
        recording_enabled: data.recording_enabled,
        status: data.status
    });
});

socket.on('admin_recording_ready', (data) => {
    if (Number(data.index) !== currentIndex) return;
    currentRow.audio_url = data.audio_url || '';
    if (currentRow.audio_url) {
        applyAudioSource(viewerAudio, currentRow.audio_url);
    }
    setStatus('Recording complete');
    setRecordState(false);
});

socket.on('admin_recording_error', (data) => {
    if (Number(data.index) !== currentIndex && data.index !== undefined) return;
    setStatus(data.message || 'Problem detected; please re-record.', true);
    setRecordState(false);
});

updateRowState({
    index: 0,
    id: '',
    text: 'Loading...',
    audio_url: '',
    audio_exists: false,
    recording_enabled: true,
    status: 'Waiting for admin'
});