const socketPath = (window.APP_ROOT || '') + '/socket.io';
const socket = io({ path: socketPath, transports: ['websocket', 'polling'] });

const indexInput = document.getElementById('admin-index');
const adminText = document.getElementById('admin-text');
const adminStatus = document.getElementById('admin-status');
const adminAudio = document.getElementById('admin-audio');
const adminError = document.getElementById('admin-error');
const playExistingBtn = document.getElementById('play-existing');

let currentIndex = 0;
let currentRow = { id: '', text: '', audio_url: '', audio_exists: false };

function setStatus(message, isError = false) {
    adminStatus.textContent = message;
    adminStatus.style.color = isError ? '#f87171' : '#facc15';
}

function showError(message) {
    adminError.textContent = message || '';
}

function updateAudioPreview(audioUrl) {
    if (adminAudio) {
        adminAudio.pause();
        adminAudio.currentTime = 0;
        adminAudio.src = audioUrl || '';
        adminAudio.load();
    }

    if (!audioUrl) {
        adminAudio.classList.add('hidden');
        adminAudio.removeAttribute('src');
        playExistingBtn.disabled = true;
        return;
    }

    adminAudio.classList.remove('hidden');
    playExistingBtn.disabled = false;
}

function renderRow(data) {
    if (!data || data.error) {
        showError(data ? data.error : 'Unable to load row.');
        return;
    }

    currentIndex = Number(data.index || 0);
    currentRow = data;
    indexInput.value = currentIndex;
    adminText.textContent = data.text || 'No prompt available.';
    showError('');

    if (data.audio_exists && data.audio_url) {
        updateAudioPreview(data.audio_url);
        setStatus('Audio available');
    } else {
        updateAudioPreview('');
        setStatus('No audio yet');
    }

    socket.emit('admin_sync_row', data);
}

function fetchRow(index) {
    fetch(`get_data?index=${index}`)
        .then((res) => res.json())
        .then((data) => renderRow(data))
        .catch((err) => {
            console.error(err);
            showError('Could not fetch row data.');
            setStatus('Fetch failed', true);
        });
}

document.getElementById('get-row').addEventListener('click', () => {
    const value = Number(indexInput.value || 0);
    fetchRow(value);
});

document.getElementById('next-row').addEventListener('click', () => {
    const nextIndex = currentIndex + 1;
    indexInput.value = nextIndex;
    fetchRow(nextIndex);
});

document.getElementById('rerecord-btn').addEventListener('click', async () => {
    if (!currentRow.id) {
        showError('No row selected.');
        return;
    }

    try {
        const res = await fetch('api/rerecord', {
            method: 'POST',
            headers: { 'Content-Type': 'application/json' },
            body: JSON.stringify({ id: currentRow.id })
        });
        const payload = await res.json();
        if (!res.ok || payload.status !== 'success') {
            throw new Error(payload.message || 'Unable to delete previous recording');
        }
        currentRow.audio_url = '';
        currentRow.audio_exists = false;
        updateAudioPreview('');
        showError('');
        setStatus('Rerecord requested');
        socket.emit('admin_rerecord', {
            index: currentIndex,
            id: currentRow.id,
            text: currentRow.text
        });
    } catch (error) {
        console.error(error);
        showError(error.message || 'Failed to reset recording.');
        setStatus('Rerecord failed', true);
    }
});

playExistingBtn.addEventListener('click', () => {
    if (currentRow.audio_url) {
        adminAudio.play();
    }
});

socket.on('admin_recording_ready', (data) => {
    if (Number(data.index) !== currentIndex) return;
    currentRow.audio_url = data.audio_url || '';
    currentRow.audio_exists = Boolean(data.audio_url);
    updateAudioPreview(currentRow.audio_url);
    showError('');
    setStatus('Recording received');
});

socket.on('admin_recording_error', (data) => {
    if (Number(data.index) !== currentIndex && data.index !== undefined) return;
    showError(data.message || 'A recording error was detected.');
    setStatus('Recording failed', true);
    updateAudioPreview('');
});

socket.on('admin_recording_status', (data) => {
    if (Number(data.index) !== currentIndex) return;
    setStatus(data.message || 'Waiting');
});

fetchRow(currentIndex);
