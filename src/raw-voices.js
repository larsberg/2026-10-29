import { noteToMidi } from '@strudel/core';

export const rawSounds = ['raw-bass', 'raw-chord', 'raw-glide'];
const clamp = x => Math.max(0, Math.min(1, x));
// Absolute sixteenth position keeps the 6-against-16 phase across chord changes.
export function rawGateAt(step, mode = 'flow', depth = 1) {
  const tick = Math.floor(step + 1e-8), phase = step - Math.floor(step);
  let gate;
  if (mode === 'six') {
    const rest = ((tick % 6) + 6) % 6 === 3;
    gate = rest ? 0 : Math.min(clamp(phase / .045), clamp((1 - phase) / .16));
  } else if (mode === 'cuts') {
    gate = tick % 16 >= 14 ? 0 : 1 - .15 * Math.sin(Math.PI * phase) ** 2;
  } else gate = 1 - .5 * (1 - Math.cos(step * Math.PI / 2));
  return 1 - depth + depth * gate;
}

// Band-limited oscillators do the synthesis on Web Audio's rendering thread.
// Every note in the harmony feeds the same saturating instrument channel.
export function createRawVoice({ context, value, sound, at, duration, bpm, decay, envelope, node, source }) {
  const bass = sound === 'raw-bass', lead = sound === 'raw-glide';
  const freq = value.freq ?? 440 * 2 ** ((noteToMidi(value.note) - 69) / 12);
  if (!(Number.isFinite(freq) && freq > 0)) throw new Error('Invalid raw-synth frequency.');
  const elapsed = value.elapsedSeconds ?? 0, tail = Math.min(bass ? .035 : .065, duration * .15);
  const length = Math.max(.02, (duration + elapsed) * decay - elapsed) + tail;
  const brightness = value.brightness ?? .8;
  const filter = node(context.createBiquadFilter()); filter.type = 'lowpass'; filter.Q.value = lead ? .65 : .5;
  const cutoff = Math.min(context.sampleRate * .43, (bass ? 450 + 1100 * brightness : lead ? 1300 + 6500 * brightness : 700 + 4800 * brightness));
  filter.frequency.setValueAtTime(cutoff * .65, at);
  filter.frequency.exponentialRampToValueAtTime(cutoff, at + Math.min(.12, length * .25));
  filter.frequency.exponentialRampToValueAtTime(cutoff * .72, at + length);
  let target = envelope;
  if (!bass && context.createStereoPanner) {
    const pan = node(context.createStereoPanner()); pan.pan.value = value.pan ?? 0; pan.connect(envelope); target = pan;
    // A short opposite-side reflection gives the upper register width while
    // the bass remains mono. Filter out lows from the reflected signal.
    const reflection = node(context.createDelay(.04)), high = node(context.createBiquadFilter());
    const side = node(context.createStereoPanner()), wet = node(context.createGain());
    reflection.delayTime.value = .011 + .005 * ((value.pan ?? 0) + 1) / 2;
    high.type = 'highpass'; high.frequency.value = 210; high.Q.value = .5;
    side.pan.value = (value.pan ?? 0) < 0 ? 1 : -1; wet.gain.value = lead ? .22 : .48;
    filter.connect(high).connect(reflection).connect(side).connect(wet).connect(envelope);
  }
  filter.connect(target);
  const partials = bass ? [0, 1, .24, .09, .025] : lead ? [0, 1, .3, .22, .12, .18, .07, .04] : [0, 1, .5, .31, .19, .12, .08, .045, .025];
  const wave = context.createPeriodicWave(new Float32Array(partials.length), Float32Array.from(partials));
  const osc = source(context.createOscillator()); osc.setPeriodicWave(wave);
  osc.frequency.setValueAtTime(freq, at);
  if (lead && value.fromFreq && !value.resumed) {
    osc.frequency.setValueAtTime(value.fromFreq, at);
    osc.frequency.exponentialRampToValueAtTime(freq, at + Math.min(value.glideTime ?? .4, length * .65));
  }
  if (lead) {
    const vibrato = source(context.createOscillator()), amount = node(context.createGain());
    vibrato.frequency.value = .7; amount.gain.value = 3.5;
    vibrato.connect(amount).connect(osc.detune); vibrato.start(at); vibrato.stop(at + length);
  }
  osc.connect(filter); osc.start(at); osc.stop(at + length);
  const curve = new Float32Array(Math.max(2, Math.ceil(length / .002)));
  const stepRate = bpm / 15, startStep = (value.cycle ?? 0) * 16 + elapsed * stepRate;
  for (let i = 0; i < curve.length; i++) {
    const t = i / (curve.length - 1) * length;
    const attack = clamp(t / (value.resumed ? .012 : bass ? .012 : .023));
    const release = clamp((length - t) / tail);
    curve[i] = attack * release * rawGateAt(startStep + t * stepRate, value.gateMode, value.gateDepth ?? .1);
  }
  envelope.gain.setValueCurveAtTime(curve, at, length);
  return bass ? .42 : lead ? .21 : .2;
}
