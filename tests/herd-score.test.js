import test from 'node:test';
import assert from 'node:assert/strict';
import { createHerdScore, herdAudioSettings, HERD_LOOP_BARS } from '../src/herd-score.js';
import { createMarchAudio } from '../src/march-audio.js';
import { validateInstruments } from '../src/instrument-settings.js';
import { noteToMidi } from '@strudel/core';

const onsets = (score, a, b) => score.queryArc(a, b).filter(hap => hap.hasOnset());
const signature = events => events.map(hap => JSON.stringify([Number(hap.whole.begin), hap.value])).sort();

test('every kick cues a leap, with a deep on-beat bass and light arranged keys', () => {
  const score = createHerdScore(732233), bars = [];
  const originalHarmony = [
    { bass: 'd1', chord: ['f4', 'a4', 'b4'], tune: ['d5', 'a4', 'f5', 'e5'] },
    { bass: 'f1', chord: ['e4', 'a4', 'c5'], tune: ['c5', 'a4', 'e5', 'g5'] },
    { bass: 'g1', chord: ['e4', 'bb4', 'd5'], tune: ['d5', 'bb4', 'g5', 'e5'] },
    { bass: 'a1', chord: ['g4', 'a4', 'c#5'], tune: ['e5', 'c#5', 'a4', 'c#5'] },
  ];
  for (let bar = 0; bar < HERD_LOOP_BARS; bar++) {
    const phrase = originalHarmony[Math.floor(bar / 2) % 4];
    const hits = onsets(score, bar, bar + 1); bars.push(hits.map(hap => hap.value));
    assert.ok(hits.length >= 4 && hits.length <= 26);
    assert.ok(hits.every(hap => ['kick', 'snare', 'hat', 'bass', 'keys', 'melody'].includes(hap.value.layer) && hap.value.gain > 0));
    const bass = hits.filter(hap => hap.value.layer === 'bass');
    assert.ok(bass.length === 0 || bass.length === 4);
    for (const hap of bass) assert.equal(hap.value.note, phrase.bass, 'Keep the original root progression.');
    for (const hap of bass) assert.ok(noteToMidi(hap.value.note) >= 26 && noteToMidi(hap.value.note) <= 33, 'Keep the fundamental between 36 and 55 Hz.');
    const pitched = hits.filter(hap => ['bass', 'keys', 'melody'].includes(hap.value.layer));
    for (const hap of pitched) assert.ok(Number.isFinite(noteToMidi(hap.value.note)), 'Notes must be playable by the synth.');
    const keys = hits.filter(hap => hap.value.layer === 'keys');
    assert.ok([0, 3, 6].includes(keys.length), 'Chord answers can drop out during breakdowns.');
    assert.ok(keys.every(hap => noteToMidi(hap.value.note) >= 64));
    for (const onset of new Set(keys.map(hap => Number(hap.whole.begin)))) {
      assert.deepEqual(keys.filter(hap => Number(hap.whole.begin) === onset).map(hap => hap.value.note), phrase.chord,
        'The original chord voicing and progression must remain intact.');
    }
    for (const hap of hits.filter(hap => hap.value.layer === 'melody')) {
      const steps = bar % 2 === 0 ? [2, 7, 10] : [2, 6, 11, 14];
      const index = steps.indexOf((Number(hap.whole.begin) - bar) * 16);
      assert.ok(index >= 0); assert.equal(hap.value.note, phrase.tune[(index + bar % 2) % 4]);
    }
    const pulses = hits.filter(hap => hap.value.leap);
    assert.deepEqual(pulses.map(hap => Number(hap.whole.begin) * 4), [0, 1, 2, 3].map(beat => bar * 4 + beat));
    assert.deepEqual(pulses, hits.filter(hap => hap.value.layer === 'kick'), 'There must be no extra kicks without a matching jump cue.');
    if (bass.length) assert.deepEqual(bass.map(hap => Number(hap.whole.begin)), pulses.map(hap => Number(hap.whole.begin)), 'Bass accents reinforce each kick.');
    assert.ok(pulses.every(hap => hap.value.layer === 'kick' && hap.value.gain > .4));
  }
  assert.ok(new Set(bars.map(JSON.stringify)).size > 100);
  assert.notDeepEqual(signature(onsets(score, 0, 8)), signature(onsets(createHerdScore(732234), 0, 8)));
  const settings = herdAudioSettings();
  assert.doesNotThrow(() => validateInstruments(settings.instruments));
  assert.equal(settings.bpm, 128); assert.ok(settings.bass > .8 && settings.keys > 0 && settings.melody > 0);
  assert.equal(settings.instruments.bass.sound, 'sub'); assert.ok(settings.instruments.bass.cutoff < 250);
  assert.equal(score.loopBars, HERD_LOOP_BARS);
  assert.equal(HERD_LOOP_BARS * 4 * 60 / settings.bpm, 360);
  assert.equal(score.sectionAt(0).name, score.sectionAt(HERD_LOOP_BARS).name);
});

test('breakdowns remove parts and rebuild them in different orders before the loop returns to its opening', () => {
  const score = createHerdScore(732233);
  const layers = bar => [...new Set(onsets(score, bar, bar + 1).map(hap => hap.value.layer))].sort();
  assert.deepEqual(layers(56), ['keys', 'kick']);
  assert.deepEqual(layers(120), ['bass', 'kick']);
  assert.deepEqual(layers(136), ['hat', 'keys', 'kick', 'melody']);
  assert.ok(layers(72).includes('hat') && !layers(72).includes('bass'), 'First rebuild starts with hats.');
  assert.ok(layers(80).includes('bass') && !layers(80).includes('melody'));
  assert.ok(layers(88).includes('melody'));
  assert.ok(layers(152).includes('bass') && !layers(152).includes('hat'), 'Last rebuild starts with bass.');
  assert.ok(layers(160).includes('hat') && !layers(160).includes('melody'));
  assert.deepEqual(layers(176), ['bass', 'hat', 'keys', 'kick', 'melody', 'snare']);
  assert.deepEqual(score.sectionAt(191).levels, score.sectionAt(0).levels, 'The turnaround hands back to the opening mix.');
  assert.ok(onsets(score, 176, 177).length > onsets(score, 56, 57).length * 2);
  for (let bar = 0; bar < HERD_LOOP_BARS; bar++) {
    const section = score.sectionAt(bar);
    assert.ok(section.start <= bar && section.end > bar);
  }
});

test('the complete arrangement repeats exactly with continuous absolute event times at the loop seam', () => {
  const score = createHerdScore(91);
  const loop = start => onsets(score, start, start + HERD_LOOP_BARS).map(hap =>
    JSON.stringify([Number(hap.whole.begin) - start, Number(hap.whole.end) - start, hap.value]));
  const first = loop(0);
  assert.deepEqual(loop(HERD_LOOP_BARS), first);
  assert.deepEqual(loop(HERD_LOOP_BARS * 2), first);
  const seam = onsets(score, HERD_LOOP_BARS - 1, HERD_LOOP_BARS + 1);
  assert.deepEqual(seam.filter(hap => hap.value.layer === 'kick').map(hap => Number(hap.whole.begin) * 4),
    Array.from({ length: 8 }, (_, i) => (HERD_LOOP_BARS - 1) * 4 + i));
});

test('the motion envelope follows the bass and kick accents and the arrangement, independent of queries', () => {
  const score = createHerdScore(91);
  const notes = onsets(score, 8, 9).filter(hap => hap.value.layer === 'bass');
  for (const hap of notes) {
    const beat = Number(hap.whole.begin) * 4;
    assert.ok(score.motionAt(beat + .05).bass > score.motionAt(beat - .05).bass + .2);
    assert.ok(score.motionAt(beat + .5).bass < score.motionAt(beat + .05).bass);
  }
  const before = score.motionAt(32.8);
  onsets(score, 99999, 100040);
  assert.deepEqual(score.motionAt(32.8), before);
  assert.ok(score.motionAt(176 * 4).energy > score.motionAt(56 * 4).energy);
});

test('scheduler windows, seeking, and cache eviction do not reroll or duplicate drum notes', () => {
  const score = createHerdScore(91), all = onsets(score, 0, HERD_LOOP_BARS + 2), slices = [];
  for (let tick = 0; tick < (HERD_LOOP_BARS + 2) * 32; tick++) slices.push(...onsets(score, tick / 32, (tick + 1) / 32));
  assert.deepEqual(signature(slices), signature(all));
  onsets(score, 99999, 100040);
  assert.deepEqual(signature(onsets(score, 0, HERD_LOOP_BARS + 2)), signature(all));
});

test('audio and movement transport preserve phase on tempo, mute and pause, and reset together', () => {
  const param = () => ({ value: 0, setValueAtTime() {}, setTargetAtTime() {}, cancelScheduledValues() {} });
  const node = () => ({ connect(next) { return next; }, disconnect() {}, gain: param(), threshold: param(),
    knee: param(), ratio: param(), attack: param(), release: param() });
  const context = new EventTarget();
  Object.assign(context, { state: 'running', currentTime: 0, createGain: node, createDynamicsCompressor: node,
    createWaveShaper: node, destination: {}, close() { this.state = 'closed'; return Promise.resolve(); } });
  const events = []; let timer;
  const audio = createMarchAudio({ pattern: createHerdScore(91), now: () => context.currentTime,
    createContext: () => context, createVoices: () => ({ trigger(value, at) { events.push({ value, at }); },
      configure() {}, stop() {}, dispose() {} }),
    setTimer: fn => (timer = fn, 1), clearTimer: () => { timer = undefined; } });
  let settings = herdAudioSettings();
  const tick = count => { for (let i = 0; i < count; i++) { context.currentTime += .025; timer?.(); } };
  try {
    audio.configure(settings); audio.play(); tick(200);
    assert.ok(events.filter(event => event.value.leap).length >= 4);
    const beat = audio.beat; settings = { ...settings, bpm: 120 }; audio.configure(settings);
    assert.equal(audio.beat, beat); tick(40); assert.ok(Math.abs(audio.beat - beat - 2) < 1e-8);
    settings = { ...settings, enabled: false }; audio.configure(settings);
    assert.deepEqual(audio.readMotion(beat), createHerdScore(91).motionAt(beat), 'Muting preserves score-driven motion.');
    const muted = audio.beat, count = events.length; tick(40);
    assert.equal(events.length, count); assert.ok(Math.abs(audio.beat - muted - 2) < 1e-8);
    audio.pause(); const paused = audio.beat; tick(40); assert.equal(audio.beat, paused);
    audio.play(); tick(40); assert.ok(audio.beat > paused);
    audio.restart(); assert.equal(audio.beat, 0);
    audio.configure({ ...settings, enabled: true }); tick(80); assert.ok(events.length > count);
  } finally { audio.dispose(); }
});
