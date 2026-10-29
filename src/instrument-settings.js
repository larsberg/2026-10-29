export const instrumentGroups = [
  { key: 'kick', label: 'Kick', sounds: [['suuns-kick', 'Reference · low drum'], ['original', 'Hammock kick'], ['sub', 'Deep sub'], ['tight', 'Tight kick'], ['punch', 'Punch kick']] },
  { key: 'snare', label: 'Snare', sounds: [['suuns-snare', 'Reference · dry snare'], ['original', 'Hammock snare'], ['brush', 'Brush'], ['clap', 'Handclap'], ['rim', 'Rimshot']] },
  { key: 'hat', label: 'Hats', sounds: [['suuns-hat', 'Reference · loose hat'], ['original', 'Hammock hat'], ['closed', 'Tight closed hat'], ['open', 'Open hat'], ['metal', 'Metallic hat']] },
  { key: 'bass', label: 'Bass', sounds: [['raw-bass', 'Raw · rounded harmonic bass'], ['suuns-bass', 'Reference · rounded slide'], ['original', 'Hammock bass'], ['sub', 'Sine sub'], ['reese', 'Detuned saws'], ['pluck', 'Plucked bass'], ['pulse', 'Pulse bass']] },
  { key: 'keys', label: 'Harmony', sounds: [['raw-chord', 'Raw · saturated ratio chords'], ['suuns-guitar', 'Reference · wiry guitar'], ['original', 'Hammock keys'], ['electric', 'Electric keys'], ['bell', 'Bells'], ['pad', 'Soft pad'], ['guitar', 'Muted electric guitar']] },
  { key: 'melody', label: 'Lead / texture', sounds: [['raw-glide', 'Raw · gliding overtone lead'], ['suuns-voice', 'Reference · breathy low voice'], ['original', 'Hammock melody'], ['flute', 'Flute'], ['pluck', 'Pluck'], ['lead', 'Saw lead'], ['vowel', 'Vowel synth']] },
];

export const instrumentFields = [
  ['level', 'Instrument level', 1, 0, 1.5, .01],
  ['decay', 'Note decay ×', 1, .25, 3, .01],
  ['cutoff', 'Filter cutoff (Hz)', 20000, 40, 20000, 10],
  ['resonance', 'Filter resonance', .45, 0, 8, .05],
  ['drive', 'Distortion', 0, 0, 1, .01],
  ['reverb', 'Reverb', 0, 0, 1, .01],
  ['delay', 'Delay level', 0, 0, 1, .01],
  ['delayBeats', 'Delay time (beats)', .5, .125, 2, .125],
  ['feedback', 'Delay feedback', .3, 0, .8, .01],
];

export function defaultInstruments() {
  return Object.fromEntries(instrumentGroups.map(({ key }) => [key, {
    sound: 'original', ...Object.fromEntries(instrumentFields.map(([name,,value]) => [name,value])),
    cutoff: { bass: 700, keys: 3400, melody: 2800 }[key] ?? 20000,
    reverb: ['keys','melody'].includes(key) ? .17 : 0,
  }]));
}

const object = value => value && typeof value === 'object' && !Array.isArray(value);
export function validateInstruments(value, { allowMissing = false } = {}) {
  const result = defaultInstruments();
  if (value === undefined && allowMissing) return result;
  if (!object(value)) throw new Error('Invalid instrument settings.');
  for (const { key, label, sounds } of instrumentGroups) {
    const part = value[key];
    if (part === undefined && allowMissing) continue;
    if (!object(part)) throw new Error(`Invalid ${label} settings.`);
    const next = allowMissing ? { ...result[key], ...part } : part;
    if (!sounds.some(([id]) => id === next.sound)) throw new Error(`Invalid ${label} sound.`);
    result[key].sound = next.sound;
    for (const [name, title,,min,max] of instrumentFields) {
      if (!Number.isFinite(next[name]) || next[name] < min || next[name] > max) throw new Error(`Invalid ${label} ${title}.`);
      result[key][name] = next[name];
    }
  }
  return result;
}

export function mergeInstruments(current, patch) {
  if (!object(patch)) throw new Error('Invalid instrument settings.');
  const next = structuredClone(current);
  for (const [key, value] of Object.entries(patch)) {
    if (!instrumentGroups.some(group => group.key === key) || !object(value)) throw new Error('Invalid instrument settings.');
    next[key] = { ...next[key], ...value };
  }
  return validateInstruments(next);
}

export const instrumentLevel = (settings, layer) => settings.instruments?.[layer]?.level ?? 1;
