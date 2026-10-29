import { createCanvasRecorder } from './canvas-recorder.js';

export function recordingControlsMarkup() {
  return `<details class="material-group" open><summary>Record video &amp; audio</summary>
    <p class="camera-hint">Records the scene and its final audio mix, including effects. Controls are excluded. Enable audio to include the music. Keep this tab visible while recording.</p>
    <label>Frame rate <select data-record-fps><option value="60">60 fps</option><option value="30">30 fps</option></select></label>
    <button type="button" data-record-toggle>Start recording</button>
    <p class="camera-hint" data-record-status role="status">Up to 1920 pixels on the long side. Press R to start or stop.</p>
  </details>`;
}
export function bindRecordingControls(root, canvas, audio) {
  const button = root.querySelector('[data-record-toggle]'), fps = root.querySelector('[data-record-fps]'), status = root.querySelector('[data-record-status]');
  const badge = document.createElement('div'); badge.className = 'recording-badge'; badge.hidden = true;
  badge.innerHTML = '<span role="status"></span><button type="button" data-record-stop>Stop</button><a data-record-download hidden>Download video</a><button type="button" data-record-dismiss aria-label="Dismiss recording status" hidden>×</button>';
  root.append(badge);
  const label = badge.querySelector('span'), stopButton = badge.querySelector('[data-record-stop]'), download = badge.querySelector('a'), dismiss = badge.querySelector('[data-record-dismiss]');
  let dismissed = false;
  const recorder = createCanvasRecorder({ canvas, captureAudio: () => audio.createRecordingOutput(), onChange: update });
  function update() {
    const state = recorder.state, active = state.phase !== 'idle';
    const seconds = Math.max(0, Math.floor(state.seconds || 0)), time = `${Math.floor(seconds / 60)}:${String(seconds % 60).padStart(2, '0')}`;
    button.disabled = state.phase === 'starting' || state.phase === 'stopping'; fps.disabled = active;
    button.textContent = active ? 'Stop recording' : 'Start recording';
    const message = state.error || (state.phase === 'starting' ? 'Starting recorder…' : state.phase === 'stopping' ? 'Finishing video…'
      : active ? `Recording ${time}${state.audioEnabled ? ' · video + audio' : ' · audio is off'}`
        : state.result ? `${state.result.reason ? state.result.reason + ' · ' : ''}Video ready · ${(state.result.blob.size / 1048576).toFixed(1)} MB` : 'Up to 1920 pixels on the long side. Press R to start or stop.');
    status.textContent = label.textContent = message;
    badge.hidden = dismissed || (!active && !state.result && !state.error);
    stopButton.hidden = !active; stopButton.disabled = button.disabled;
    download.hidden = !state.result || active; dismiss.hidden = active;
    if (state.result) { download.href = state.result.url; download.download = state.result.filename; }
  }
  async function toggle() {
    dismissed = false;
    try { if (recorder.state.phase === 'idle') await recorder.start({ fps: Number(fps.value) }); else await recorder.stop(); }
    catch (error) { status.textContent = label.textContent = error.message; badge.hidden = false; }
  }
  const stop = () => { void recorder.stop(); };
  const hide = () => { dismissed = true; update(); };
  const keyboard = event => {
    if (event.code !== 'KeyR' || event.repeat || event.metaKey || event.ctrlKey || event.altKey || event.target.closest?.('input,textarea,select,[contenteditable="true"]')) return;
    event.preventDefault(); void toggle();
  };
  const visibility = () => { if (document.hidden) void recorder.stop('Stopped when the tab was hidden'); };
  button.addEventListener('click', toggle); stopButton.addEventListener('click', stop); dismiss.addEventListener('click', hide);
  document.addEventListener('keydown', keyboard); document.addEventListener('visibilitychange', visibility);
  const timer = setInterval(update, 250); update();
  return { recorder,
    dispose() { clearInterval(timer); recorder.dispose(); badge.remove(); button.removeEventListener('click', toggle);
      document.removeEventListener('keydown', keyboard); document.removeEventListener('visibilitychange', visibility); },
  };
}
