import { defaultInstruments } from './instrument-settings.js';

export function rawAudioSettings() {
  const instruments = defaultInstruments();
  Object.assign(instruments.kick, { sound: 'sub', level: .7, decay: .45, cutoff: 1000 });
  Object.assign(instruments.snare, { sound: 'brush', level: .58, decay: .5, cutoff: 5500, reverb: .06 });
  Object.assign(instruments.hat, { sound: 'closed', level: .42, decay: .7, cutoff: 6500, reverb: .03 });
  Object.assign(instruments.bass, { sound: 'raw-bass', level: .9, cutoff: 1250, drive: .08, reverb: 0 });
  Object.assign(instruments.keys, { sound: 'raw-chord', level: .8, cutoff: 3800, drive: .22,
    reverb: .1, delay: .055, delayBeats: .75, feedback: .19 });
  Object.assign(instruments.melody, { sound: 'raw-glide', level: .8, cutoff: 5500, drive: .1,
    reverb: .17, delay: .15, delayBeats: .75, feedback: .28 });
  return { enabled: false, bpm: 120, volume: .6, drums: .42, bass: .86, keys: .7, melody: .64, instruments };
}
