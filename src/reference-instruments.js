// Procedural voices fitted to the locally separated reference. These are
// synthesis parameters, not PCM from the recording or a sample-bank dependency.
export const referenceSounds = ['suuns-kick', 'suuns-snare', 'suuns-hat', 'suuns-bass', 'suuns-guitar', 'suuns-voice'];
const TAU = Math.PI * 2;
const clamp = (x, a, b) => Math.max(a, Math.min(b, x));
const interpolate = (points, t) => {
  for (let i = 1; i < points.length; i++) {
    if (t <= points[i][0]) {
      const [a, b] = [points[i - 1], points[i]];
      return a[1] + (b[1] - a[1]) * clamp((t - a[0]) / (b[0] - a[0]), 0, 1);
    }
  }
  return points.at(-1)[1];
};
function noiseFilter(sampleRate, frequency) {
  const a = 1 - Math.exp(-TAU * Math.min(frequency, sampleRate * .4) / sampleRate);
  let previous = 0;
  return x => (previous += a * (x - previous));
}
const bassPitch = [[0, 1.27], [.04, 1.18], [.12, 1.153], [.25, 1.117], [.4, 1.045], [.65, 1], [1.2, .994]];
const bassEnvelope = [[0, 0], [.008, .82], [.06, 1], [.2, .95], [.35, .84], [.5, .59], [.65, .34], [.8, .18], [.95, .065], [1.12, .018], [1.42, 0]];

export function renderReferenceVoice({ sound, hz = 75, fromHz, duration = 1, sampleRate = 44100,
  decay = 1, seed = 173, vowel = 0, open = false, detune = 0, glideTime = .65 } = {}) {
  if (!referenceSounds.includes(sound)) throw new Error('Unknown reference instrument.');
  if (!(sampleRate >= 8000 && sampleRate <= 192000 && Number.isFinite(duration) && duration > 0 && Number.isFinite(hz) && hz > 0)) throw new Error('Invalid synthesis parameters.');
  decay = clamp(decay, .25, 3);
  const bass = sound === 'suuns-bass', guitar = sound === 'suuns-guitar', vocal = sound === 'suuns-voice';
  const pitched = bass || guitar || vocal;
  const tail = bass ? 1.42 : guitar ? 1.1 : vocal ? duration + .11 : sound === 'suuns-kick' ? .55 : sound === 'suuns-snare' ? .36 : open ? .22 : .085;
  const length = Math.min(12, pitched ? Math.min(tail * decay, duration * decay + (bass ? .04 : .12)) : tail * decay);
  const samples = new Float32Array(Math.ceil(sampleRate * length));
  let state = seed >>> 0 || 173, phase = 0, kickPhase = 0;
  const random = () => { state ^= state << 13; state ^= state >>> 17; state ^= state << 5; return (state >>> 0) / 2147483648 - 1; };
  const low = noiseFilter(sampleRate, sound === 'suuns-hat' ? 7500 : 4700);
  const high = noiseFilter(sampleRate, sound === 'suuns-hat' ? 3000 : vocal ? 1800 : 700);
  const thud = noiseFilter(sampleRate, 900);
  const cabinet = noiseFilter(sampleRate, 5100);
  hz *= 2 ** (detune / 1200);
  const highBass = hz > 60;
  const stringPartials = [1, .55, .11, 1.32, 1.1, .85, .61, .16, .08];
  // Tilted glottal spectrum plus broad, moving formants: a breathy low voice,
  // rather than the bright saw/formant lead used by the first approximation.
  const formants = [[350, 900, 2400], [600, 1100, 2600], [450, 1750, 2500]][Math.abs(vowel) % 3];
  const vocalPartials = Array.from({ length: 18 }, (_, i) => {
    const h = i + 1, f = h * hz;
    return h ** -1.7 * (1 + formants.reduce((sum, center, j) => sum + (j ? .6 : .85) * Math.exp(-.5 * ((f - center) / (j ? 230 : 130)) ** 2), 0));
  });
  for (let i = 0; i < samples.length; i++) {
    const t = i / sampleRate, d = t / decay, n = random(), noise = low(n) - high(n);
    let x = 0;
    if (bass) {
      const sweep = interpolate(bassPitch, d * .65 / glideTime);
      const interval = fromHz ? (fromHz / (hz / 2 ** (detune / 1200)) - 1) / .18 : 1;
      phase += TAU * hz * (1 + (sweep - 1) * interval) / sampleRate;
      const second = highBass ? .18 + .22 / (1 + Math.exp((d - .22) / .035)) : .25 + .33 * Math.exp(-d / .35);
      const third = .008 + .16 / (1 + Math.exp((d - .34) / .08)), fourth = .02 * Math.exp(-d / .1);
      x = .76 * (Math.sin(phase) + second * Math.sin(phase * 2 + .3) + third * Math.sin(phase * 3 + .7) + fourth * Math.sin(phase * 4)) * interpolate(bassEnvelope, d);
    } else if (sound === 'suuns-kick') {
      // Two low shell/head resonances; no EDM-style 185 Hz laser sweep.
      phase += TAU * (53.8 + 39 * Math.exp(-d / .012)) / sampleRate;
      kickPhase += TAU * (64.6 + 12 * Math.exp(-d / .009)) / sampleRate;
      x = .88 * Math.sin(phase) * (.65 * Math.exp(-d / .043) + .35 * Math.exp(-d / .14));
      x += .58 * Math.sin(kickPhase + .4) * Math.exp(-d / .095);
      x += (.25 * Math.sin(TAU * 295 * t) + .12 * Math.sin(TAU * 153 * t)) * Math.exp(-d / .065);
      x += thud(n) * .55 * Math.exp(-d / .012) + noise * .12 * Math.exp(-d / .007);
      x *= 1 - Math.exp(-d / .001);
    } else if (sound === 'suuns-snare') {
      for (const [f, a, tau] of [[183, .55, .053], [294.7, .32, .067], [428, .33, .04], [219.4, .35, .035], [677, .09, .035]]) x += a * Math.sin(TAU * f * t) * Math.exp(-d / tau);
      x += noise * (.88 * Math.exp(-d / .022) + .22 * Math.exp(-d / .075));
      x *= 1 - Math.exp(-d / .0007);
    } else if (sound === 'suuns-hat') {
      const tau = open ? .048 : .014;
      x = noise * .32;
      for (const f of [3120, 4130, 5270, 6580]) if (f < sampleRate * .45) x += .018 * Math.sin(TAU * f * t);
      x *= Math.exp(-d / tau) * (1 - Math.exp(-d / .0005));
    } else if (guitar) {
      phase += TAU * hz * (1 + .018 * Math.exp(-d / .018) + .0007 * Math.sin(TAU * 4.1 * t)) / sampleRate;
      for (let h = 1; h <= stringPartials.length; h++) {
        if (hz * h >= sampleRate * .45) continue;
        x += .16 * stringPartials[h - 1] * Math.sin(phase * h + h * .4) * Math.exp(-d / (.3 / (1 + h * .045)));
      }
      x += noise * .08 * Math.exp(-d / .008);
      x = cabinet(Math.tanh(x * 1.7) / 1.7) * (1 - Math.exp(-d / .001));
    } else {
      const scoop = -.025 * Math.exp(-d / .035), vibrato = .0025 * Math.sin(TAU * 5.2 * t) * clamp((d - .14) / .15, 0, 1);
      const glide = fromHz ? (fromHz / hz - 1) * Math.exp(-d / .065) : 0;
      phase += TAU * hz * (1 + scoop + vibrato + glide) / sampleRate;
      for (let h = 1; h <= vocalPartials.length; h++) if (h * hz < sampleRate * .45) x += .27 * vocalPartials[h - 1] * Math.sin(phase * h + h * .12);
      x += noise * .025;
      const syllable = 1 - .12 * Math.sin(TAU * d * 3.7) ** 4;
      x *= (1 - Math.exp(-d / .022)) * syllable * Math.exp(-d / 3);
    }
    // Every note ends at zero, including truncated notes and altered decay.
    const fade = clamp((length - t) / (vocal ? .09 : .015), 0, 1);
    samples[i] = x * fade;
  }
  return samples;
}
