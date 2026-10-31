import { Hap, Pattern, TimeSpan } from '@strudel/core';
import { createSeededRandom } from './mesh-layers.js';
import { HERD_BPM, JUMP_BEATS } from './herd-rhythm.js';
import { defaultInstruments } from './instrument-settings.js';

export function herdAudioSettings() {
  const instruments = defaultInstruments();
  Object.assign(instruments.kick, { sound: 'sub', level: .95, decay: .46, cutoff: 850, drive: .1 });
  Object.assign(instruments.snare, { sound: 'rim', level: .58, decay: .65, cutoff: 2800, reverb: .08, delay: .045, delayBeats: .75, feedback: .16 });
  Object.assign(instruments.hat, { sound: 'closed', level: .38, decay: .65, cutoff: 6200, reverb: .04 });
  Object.assign(instruments.bass, { sound: 'sub', level: 1.1, decay: .8, cutoff: 190, drive: .035, reverb: 0 });
  Object.assign(instruments.keys, { sound: 'electric', level: 1, decay: .62, cutoff: 4300, reverb: .18, delay: .035, delayBeats: .75, feedback: .12 });
  Object.assign(instruments.melody, { sound: 'pluck', level: .72, decay: .7, cutoff: 3600, reverb: .2 });
  return { enabled: true, bpm: HERD_BPM, volume: .55, drums: .7, bass: .92, keys: .72, melody: .4, instruments };
}

// A two-minute arrangement at 128 BPM: a deep, steady low pulse under small
// chamber-pop chord stabs and a playful plucked-key question/answer motif.
const sections = [
  { start: 0, end: 8, name: 'Gather', energy: .65 },
  { start: 8, end: 24, name: 'Romp', energy: .9 },
  { start: 24, end: 32, name: 'Lift', energy: 1 },
  { start: 32, end: 40, name: 'Prowl', energy: .5 },
  { start: 40, end: 56, name: 'Full romp', energy: 1 },
  { start: 56, end: 64, name: 'Turnaround', energy: .8 },
];
const sectionAt = cycle => sections.find(section => ((Math.floor(cycle) % 64) + 64) % 64 < section.end);
const harmony = [
  { bass: 'd1', chord: ['f4', 'a4', 'b4'], tune: ['d5', 'a4', 'f5', 'e5'] }, // D minor 6
  { bass: 'f1', chord: ['e4', 'a4', 'c5'], tune: ['c5', 'a4', 'e5', 'g5'] }, // F major 7
  { bass: 'g1', chord: ['e4', 'bb4', 'd5'], tune: ['d5', 'bb4', 'g5', 'e5'] }, // G minor 6
  { bass: 'a1', chord: ['g4', 'a4', 'c#5'], tune: ['e5', 'c#5', 'a4', 'c#5'] }, // A7, then home
];

// Randomness depends on seed + absolute bar, never scheduler query order.
// Audio and physical motion read these same events, with no per-frame FFT.
export function createHerdScore(seed = 1) {
  const cache = new Map();
  function eventsAt(bar) {
    if (cache.has(bar)) return cache.get(bar);
    const random = createSeededRandom((seed + Math.imul(bar, 104729) + 65537) >>> 0), events = [];
    const section = sectionAt(bar), energy = section.energy, local = bar % 64;
    const add = (layer, step, gain, extra = {}, length = 1) => {
      const whole = new TimeSpan(`${bar * 16 + step}/16`, `${bar * 16 + step + length}/16`);
      events.push({ whole, beat: bar * 4 + step / 4, duration: length / 4,
        value: { layer, s: layer === 'hat' ? 'hh' : layer, gain,
          timbreSeed: Math.floor(random() * 0xffffffff), ...extra } });
    };
    const phrase = harmony[Math.floor(local / 2) % harmony.length];
    for (let beat = 0; beat < 4; beat += JUMP_BEATS) {
      const accent = beat % 2 === 0;
      add('kick', beat * 4, (accent ? .87 : .77) + random() * .05, { leap: true });
      // Repeat one low root on the kicks. No octave runs, slides or offbeat
      // bass fills: the harmonic character lives in the upper instruments.
      add('bass', beat * 4, (accent ? .85 : .72) + random() * .04,
        { note: phrase.bass, clip: .72, detune: 0, wow: .1 }, 2);
    }
    for (const step of [4, 12]) if (step === 12 || energy > .6) add('snare', step, .4 + energy * .2 + random() * .08);
    for (const step of [2, 6, 10, 14]) if (energy >= .8 || step === 6 || step === 14) add('hat', step, .25 + random() * .13);
    if (energy >= .9 && bar % 4 === 3) {
      add('hat', 15, .2 + random() * .1);
      if (random() < .65) add('snare', 11, .18);
    }
    // Light, clipped chord answers leave the deep downbeats open. Thin out
    // the middle section, then bring the toy-like melody back for the return.
    for (const step of section.name === 'Prowl' ? [12] : [4, 12]) {
      for (const note of phrase.chord) add('keys', step, .48 + energy * .12 + random() * .04,
        { note, clip: .65, detune: -3, wow: .3 }, section.name === 'Prowl' ? 3 : 2);
    }
    if (section.name !== 'Prowl' || bar % 2 === 1) {
      const steps = bar % 2 === 0 ? [2, 7, 10] : [2, 6, 11, 14];
      for (const [index, step] of steps.entries()) {
        if (local < 4 && index > 1) continue;
        add('melody', step, .4 + random() * .09,
          { note: phrase.tune[(index + bar % 2) % phrase.tune.length], clip: .7, detune: 2, wow: .25 }, 1);
      }
    }
    events.sort((a, b) => a.beat - b.beat);
    cache.set(bar, events);
    if (cache.size > 32) cache.delete(cache.keys().next().value);
    return events;
  }
  const pattern = new Pattern(state => {
    const result = [];
    for (let bar = Math.max(0, Math.floor(Number(state.span.begin))); bar < Math.ceil(Number(state.span.end)); bar++) {
      for (const event of eventsAt(bar)) {
        const part = event.whole.intersection(state.span);
        if (part) result.push(new Hap(event.whole, part, event.value));
      }
    }
    return result;
  });
  pattern.title = 'Herd · Night romp';
  pattern.sectionAt = sectionAt;
  pattern.motionAt = beat => {
    const bar = Math.max(0, Math.floor(beat / 4)), section = sectionAt(bar);
    let bass = 0, kick = 0;
    for (let index = Math.max(0, bar - 1); index <= bar; index++) for (const event of eventsAt(index)) {
      const age = beat - event.beat;
      if (age < 0 || age > 1) continue;
      if (event.value.layer === 'bass') {
        const envelope = Math.min(1, age / .045) * Math.exp(-age / .28);
        bass = Math.max(bass, envelope * event.value.gain);
      } else if (event.value.layer === 'kick') kick = Math.max(kick, Math.exp(-age / .16) * event.value.gain);
    }
    return { bass, kick, energy: section.energy };
  };
  return pattern;
}
