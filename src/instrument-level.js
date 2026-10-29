// Lazy post-effects waveform envelope. Only the bass requests this tap.
export function createInstrumentLevel(context, output) {
  let analyser, waveform, disposed = false;
  return { readLevel() {
    if (disposed || !context.createAnalyser) return 0;
    if (!analyser) {
      analyser = context.createAnalyser();
      analyser.fftSize = 4096;
      waveform = new Float32Array(analyser.fftSize);
      output.connect(analyser);
    }
    analyser.getFloatTimeDomainData(waveform);
    const count = Math.min(waveform.length, Math.ceil(context.sampleRate * .025));
    let energy = 0;
    for (let i = waveform.length - count; i < waveform.length; i++) energy += waveform[i] ** 2;
    return Math.sqrt(energy / count);
  }, dispose() {
    if (disposed) return;disposed = true;
    if (analyser) { output.disconnect(analyser); analyser.disconnect(); }
  } };
}
