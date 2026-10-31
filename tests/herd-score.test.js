import test from 'node:test';
import assert from 'node:assert/strict';
import { createHerdScore, herdAudioSettings } from '../src/herd-score.js';
import { createMarchAudio } from '../src/march-audio.js';
import { validateInstruments } from '../src/instrument-settings.js';
import { noteToMidi } from '@strudel/core';

const onsets = (score, a, b) => score.queryArc(a, b).filter(hap => hap.hasOnset());
const signature = events => events.map(hap => JSON.stringify([Number(hap.whole.begin), hap.value])).sort();

test('every kick cues a leap, with a deep on-beat bass and light arranged keys', () => {
  const score = createHerdScore(732233), bars = [];
  for (let bar = 0; bar < 128; bar++) {
    const hits = onsets(score, bar, bar + 1); bars.push(hits.map(hap => hap.value));
    assert.ok(hits.length >= 14 && hits.length <= 26);
    assert.ok(hits.every(hap => ['kick', 'snare', 'hat', 'bass', 'keys', 'melody'].includes(hap.value.layer) && hap.value.gain > 0));
    const bass = hits.filter(hap => hap.value.layer === 'bass');
    assert.equal(bass.length, 4);
    assert.equal(new Set(bass.map(hap => hap.value.note)).size, 1, 'The low end repeats a root rather than a melodic riff.');
    for (const hap of bass) assert.ok(noteToMidi(hap.value.note) >= 26 && noteToMidi(hap.value.note) <= 33, 'Keep the fundamental between 36 and 55 Hz.');
    const pitched = hits.filter(hap => ['bass', 'keys', 'melody'].includes(hap.value.layer));
    for (const hap of pitched) assert.ok(Number.isFinite(noteToMidi(hap.value.note)), 'Notes must be playable by the synth.');
    const keys = hits.filter(hap => hap.value.layer === 'keys');
    assert.ok(keys.length === 3 || keys.length === 6, 'One or two three-note chord answers per bar.');
    assert.ok(keys.every(hap => noteToMidi(hap.value.note) >= 64));
    const pulses = hits.filter(hap => hap.value.leap);
    assert.deepEqual(pulses.map(hap => Number(hap.whole.begin) * 4), [0, 1, 2, 3].map(beat => bar * 4 + beat));
    assert.deepEqual(pulses, hits.filter(hap => hap.value.layer === 'kick'), 'There must be no extra kicks without a matching jump cue.');
    assert.deepEqual(bass.map(hap => Number(hap.whole.begin)), pulses.map(hap => Number(hap.whole.begin)), 'Bass accents reinforce each kick.');
    assert.ok(pulses.every(hap => hap.value.layer === 'kick' && hap.value.gain > .7));
  }
  assert.ok(new Set(bars.map(JSON.stringify)).size > 100);
  assert.notDeepEqual(signature(onsets(score, 0, 8)), signature(onsets(createHerdScore(732234), 0, 8)));
  const settings = herdAudioSettings();
  assert.doesNotThrow(() => validateInstruments(settings.instruments));
  assert.equal(settings.bpm, 128); assert.ok(settings.bass > .8 && settings.keys > 0 && settings.melody > 0);
  assert.equal(settings.instruments.bass.sound, 'sub'); assert.ok(settings.instruments.bass.cutoff < 250);
  assert.equal(64 * 4 * 60 / settings.bpm, 120);
  assert.equal(new Set(Array.from({ length: 64 }, (_, bar) => score.sectionAt(bar).name)).size, 6);
  assert.equal(score.sectionAt(0).name, score.sectionAt(64).name);
  assert.ok(onsets(score, 40, 41).length > onsets(score, 32, 33).length, 'The break leaves room before the full return.');
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
  assert.ok(score.motionAt(40 * 4).energy > score.motionAt(32 * 4).energy);
});

test('scheduler windows, seeking, and cache eviction do not reroll or duplicate drum notes', () => {
  const score = createHerdScore(91), all = onsets(score, 0, 64), slices = [];
  for (let tick = 0; tick < 64 * 32; tick++) slices.push(...onsets(score, tick / 32, (tick + 1) / 32));
  assert.deepEqual(signature(slices), signature(all));
  onsets(score, 99999, 100040);
  assert.deepEqual(signature(onsets(score, 0, 64)), signature(all));
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
