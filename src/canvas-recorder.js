export const recordingTypes = [
  'video/mp4;codecs=avc1.42E01E,mp4a.40.2',
  'video/webm;codecs=vp9,opus', 'video/webm;codecs=vp8,opus', 'video/webm', 'video/mp4',
];
export function recordingSize(width, height, limit = 1920) {
  const scale = Math.min(1, limit / Math.max(width, height));
  return { width: Math.max(2, Math.floor(width * scale / 2) * 2), height: Math.max(2, Math.floor(height * scale / 2) * 2) };
}

// Copy the rendered WebGL frame immediately, before its drawing buffer can be
// discarded. A separate canvas fixes the recording dimensions across resizes.
export function createCanvasRecorder({ canvas, captureAudio, onChange = () => {},
  Recorder = globalThis.MediaRecorder, Stream = globalThis.MediaStream,
  makeCanvas = () => canvas.ownerDocument.createElement('canvas'),
  now = () => performance.now(), urls = URL, maxBytes = 256 * 1024 * 1024 } = {}) {
  let session, result, phase = 'idle', error = '', generation = 0, disposed = false;
  const notify = () => { if (!disposed) onChange(api.state); };
  function release(item) {
    item.video?.getTracks().forEach(track => track.stop()); item.audio?.dispose();
  }
  async function start({ fps = 60 } = {}) {
    if (disposed) throw new Error('Recorder has been closed.');
    if (phase !== 'idle') return;
    const token = ++generation, item = { fps, chunks: [], bytes: 0, lastFrame: -Infinity };
    phase = 'starting'; error = ''; notify();
    try {
      if (!Recorder || !canvas.captureStream) throw new Error('Canvas recording is unavailable in this browser.');
      if (![30, 60].includes(fps)) throw new Error('Choose 30 or 60 fps.');
      if (!canvas.width || !canvas.height) throw new Error('Wait for the sketch to appear.');
      item.canvas = makeCanvas(); Object.assign(item.canvas, recordingSize(canvas.width, canvas.height));
      item.context = item.canvas.getContext('2d', { alpha: false });
      if (!item.context) throw new Error('Could not create the recording canvas.');
      // Prime the first captured frame before the stream/encoder starts.
      item.context.drawImage(canvas,0,0,item.canvas.width,item.canvas.height);
      item.video = item.canvas.captureStream(fps);
      item.audio = await captureAudio();
      if (disposed || token !== generation) { release(item); return; }
      const stream = new Stream([...item.video.getVideoTracks(), ...item.audio.stream.getAudioTracks()]);
      for (const mimeType of recordingTypes.filter(type => Recorder.isTypeSupported(type))) {
        try { item.recorder = new Recorder(stream, { mimeType, videoBitsPerSecond: 12000000, audioBitsPerSecond: 256000 }); break; }
        catch { /* A supported codec can still lack an available encoder. */ }
      }
      if (!item.recorder) throw new Error('No supported video-and-audio recorder is available.');
      item.recorder.addEventListener('dataavailable', event => {
        if (event.data.size) { item.chunks.push(event.data); item.bytes += event.data.size; }
        if (item.bytes >= maxBytes && phase === 'recording') { item.reason = 'Clip reached 256 MB'; void stop(); }
      });
      item.recorder.addEventListener('error', event => {
        error = event.error?.message || 'Video encoder stopped unexpectedly.'; void stop();
      });
      item.finished = new Promise(resolve => { item.resolve = resolve; });
      item.recorder.addEventListener('stop', () => {
        release(item);
        if (result?.url) urls.revokeObjectURL(result.url);
        result = null;
        if (!disposed && item.bytes) {
          const mimeType = item.recorder.mimeType, extension = mimeType.includes('mp4') ? 'mp4' : 'webm';
          const blob = new Blob(item.chunks, { type: mimeType });
          const stamp = new Date().toISOString().replace(/[:.]/g, '-');
          result = { blob, mimeType, url: urls.createObjectURL(blob), filename: `2026-10-29-${stamp}.${extension}`,
            width: item.canvas.width, height: item.canvas.height, seconds: (now() - item.started) / 1000,
            reason: item.reason, audioEnabled: item.audio.enabled };
        }
        item.chunks.length = 0; session = null; phase = 'idle'; item.resolve(result); notify();
      }, { once: true });
      session = item; item.started = now(); item.recorder.start(1000); phase = 'recording'; captureFrame(); notify();
    } catch (failure) {
      release(item);
      if (disposed || token !== generation) return;
      session = null; phase = 'idle'; error = failure.message; notify(); throw failure;
    }
  }
  function captureFrame() {
    const item = session;
    if (phase !== 'recording' || !item || !canvas.width || !canvas.height) return;
    const time = now(); if (time - item.lastFrame < 1000 / item.fps - .5) return;
    item.lastFrame = time;
    const { width, height } = item.canvas, scale = Math.min(width / canvas.width, height / canvas.height);
    item.context.fillStyle = '#000'; item.context.fillRect(0, 0, width, height);
    item.context.drawImage(canvas, (width - canvas.width * scale) / 2, (height - canvas.height * scale) / 2, canvas.width * scale, canvas.height * scale);
  }
  function stop(reason) {
    if (phase === 'starting') { generation++; phase = 'idle'; notify(); return Promise.resolve(null); }
    if (!session) return Promise.resolve(result);
    if (reason) session.reason = reason;
    const finished = session.finished;
    if (phase !== 'stopping') { phase = 'stopping'; if (session.recorder.state !== 'inactive') session.recorder.stop(); notify(); }
    return finished;
  }
  const api = { start, stop, captureFrame,
    get result() { return result; },
    get state() { return { phase, error, seconds: session ? (now() - session.started) / 1000 : 0,
      audioEnabled: session?.audio.enabled, result }; },
    dispose() { if (disposed) return; disposed = true; void stop(); if (result?.url) urls.revokeObjectURL(result.url); result = null; },
  };
  return api;
}
