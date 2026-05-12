const tempoStartInput = document.getElementById('tempo-start');
const tempoStepInput = document.getElementById('tempo-step');
const mainSoundSelect = document.getElementById('main-sound');
const markerSoundSelect = document.getElementById('marker-sound');
const toggleButton = document.getElementById('toggle-button');
const tempoDisplay = document.getElementById('tempo-display');
const elapsedMinutes = document.getElementById('elapsed-minutes');
const rhythmStatus = document.getElementById('rhythm-status');

let audioContext;
let isRunning = false;
let currentBpm = Number(tempoStartInput.value) || 80;
let tempoIncrement = Number(tempoStepInput.value) || 3;
let beatTimeout = null;
let minuteInterval = null;
let elapsedCount = 0;

function createAudioContext() {
  if (!audioContext || audioContext.state === 'closed') {
    audioContext = new (window.AudioContext || window.webkitAudioContext)();
  }
  return audioContext;
}

async function playMainBeat(soundType) {
  const context = createAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }
  const now = context.currentTime;
  const gain = context.createGain();
  gain.gain.setValueAtTime(0.0001, now);
  gain.gain.exponentialRampToValueAtTime(0.7, now + 0.008);
  gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.24);
  gain.connect(context.destination);

  const oscillator = context.createOscillator();
  oscillator.type = soundType === 'sub-kick' ? 'sine' : 'triangle';
  oscillator.frequency.value = soundType === 'deep-pulse' ? 80 : soundType === 'sub-kick' ? 50 : 72;

  if (soundType === 'thud') {
    oscillator.frequency.setValueAtTime(72, now);
    oscillator.frequency.exponentialRampToValueAtTime(44, now + 0.06);
  }

  oscillator.connect(gain);
  oscillator.start(now);
  oscillator.stop(now + 0.26);
}

async function playMarkerSound(soundType) {
  const context = createAudioContext();
  if (context.state === 'suspended') {
    await context.resume();
  }
  const now = context.currentTime;

  if (soundType === 'sub-snap') {
    // Snare drum sound: white noise + tone
    const bufferSize = context.sampleRate * 0.15; // 0.15s
    const buffer = context.createBuffer(1, bufferSize, context.sampleRate);
    const output = buffer.getChannelData(0);
    for (let i = 0; i < bufferSize; i++) {
      output[i] = (Math.random() * 2 - 1) * (1 - i / bufferSize); // fade out
    }
    const noiseSource = context.createBufferSource();
    noiseSource.buffer = buffer;
    const noiseFilter = context.createBiquadFilter();
    noiseFilter.type = 'highpass';
    noiseFilter.frequency.value = 1000;
    const noiseGain = context.createGain();
    noiseGain.gain.setValueAtTime(1.0, now);
    noiseGain.gain.exponentialRampToValueAtTime(0.01, now + 0.15);
    noiseSource.connect(noiseFilter);
    noiseFilter.connect(noiseGain);
    noiseGain.connect(context.destination);
    noiseSource.start(now);

    // Snare tone
    const toneOsc = context.createOscillator();
    toneOsc.type = 'sawtooth';
    toneOsc.frequency.setValueAtTime(180, now);
    toneOsc.frequency.exponentialRampToValueAtTime(120, now + 0.1);
    const toneGain = context.createGain();
    toneGain.gain.setValueAtTime(0.6, now);
    toneGain.gain.exponentialRampToValueAtTime(0.01, now + 0.1);
    toneOsc.connect(toneGain);
    toneGain.connect(context.destination);
    toneOsc.start(now);
    toneOsc.stop(now + 0.1);
  } else {
    const gain = context.createGain();
    gain.gain.setValueAtTime(0.0001, now);
    gain.gain.exponentialRampToValueAtTime(1.0, now + 0.05);
    gain.gain.exponentialRampToValueAtTime(0.0001, now + 0.9);
    gain.connect(context.destination);

    const oscillator = context.createOscillator();
    oscillator.type = soundType === 'low-bell' ? 'triangle' : 'sine';
    oscillator.frequency.setValueAtTime(soundType === 'bass-gong' ? 112 : soundType === 'low-bell' ? 220 : 60, now);

    if (soundType === 'bass-gong') {
      oscillator.frequency.exponentialRampToValueAtTime(52, now + 0.8);
    }

    oscillator.connect(gain);
    oscillator.start(now);
    oscillator.stop(now + 1);
  }
}

function updateDisplay() {
  tempoDisplay.textContent = `${Math.round(currentBpm)} BPM`;
  elapsedMinutes.textContent = `${elapsedCount}`;
}

function stopSchedule() {
  if (beatTimeout) {
    clearTimeout(beatTimeout);
    beatTimeout = null;
  }
  if (minuteInterval) {
    clearInterval(minuteInterval);
    minuteInterval = null;
  }
}

async function scheduleBeat() {
  if (!isRunning) return;

  await playMainBeat(mainSoundSelect.value);
  const intervalMs = Math.max(120, 60000 / currentBpm);

  beatTimeout = setTimeout(scheduleBeat, intervalMs);
}

function startTempo() {
  if (isRunning) return;

  currentBpm = Number(tempoStartInput.value) || 80;
  tempoIncrement = Number(tempoStepInput.value) || 0;
  elapsedCount = 0;
  isRunning = true;

  toggleButton.textContent = 'Stop';
  toggleButton.classList.remove('action-start');
  toggleButton.classList.add('action-stop');
  rhythmStatus.textContent = 'Pulse live. Marker will sound every minute.';
  updateDisplay();

  scheduleBeat();

  minuteInterval = setInterval(async () => {
    elapsedCount += 1;
    currentBpm += tempoIncrement;
    // Stop the current beat schedule to play marker instead
    if (beatTimeout) {
      clearTimeout(beatTimeout);
      beatTimeout = null;
    }
    await playMarkerSound(markerSoundSelect.value);
    updateDisplay();
    // Restart the beat schedule after marker sound
    setTimeout(() => {
      if (isRunning) scheduleBeat();
    }, 1000);
  }, 60000);
}

function stopTempo() {
  isRunning = false;
  toggleButton.textContent = 'Start';
  toggleButton.classList.remove('action-stop');
  toggleButton.classList.add('action-start');
  rhythmStatus.textContent = 'Tempo stopped. Ready to start again.';
  stopSchedule();
}

toggleButton.addEventListener('click', () => {
  if (!isRunning) {
    startTempo();
  } else {
    stopTempo();
  }
});

tempoStartInput.addEventListener('input', () => {
  if (!isRunning) {
    currentBpm = Number(tempoStartInput.value) || 80;
    updateDisplay();
  }
});

tempoStepInput.addEventListener('input', () => {
  tempoIncrement = Number(tempoStepInput.value) || 0;
});

window.addEventListener('load', updateDisplay);
