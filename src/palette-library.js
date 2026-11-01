import { Color, SRGBColorSpace } from 'three';
import { createSeededRandom } from './mesh-layers.js';
import { palette, studioPalettes, studioColorFields } from './studio-palettes.js';

export const MAX_GENERATED_PALETTES = 256;
export const defaultPaletteLibrary = () => ({ approved: studioPalettes.map(p => p.id), rejected: [], generated: [] });
export const paletteSwatches = preset => [...new Set(studioColorFields.map(([key]) => preset.environment[key]))];
export const paletteStatus = (library, id) => library.approved.includes(id) ? 'approved' : library.rejected.includes(id) ? 'rejected' : 'pending';

export function validatePaletteLibrary(value = defaultPaletteLibrary()) {
  const fail = () => { throw new Error('Invalid palette library.'); };
  if (!value || !Array.isArray(value.generated) || value.generated.length > MAX_GENERATED_PALETTES) fail();
  const ids = new Set(studioPalettes.map(p => p.id));
  const generated = value.generated.map(item => {
    if (!item || typeof item.id !== 'string' || !/^generated-[a-z0-9-]{1,80}$/.test(item.id) || ids.has(item.id)
      || typeof item.label !== 'string' || !item.label.trim() || item.label.length > 64
      || !Array.isArray(item.colors) || item.colors.length < 2 || item.colors.length > 8
      || item.colors.some(c => typeof c !== 'string' || !/^#[0-9a-f]{6}$/i.test(c))) fail();
    ids.add(item.id);
    return { id: item.id, label: item.label.trim(), colors: item.colors.map(c => c.toLowerCase()) };
  });
  const readIds = list => {
    if (!Array.isArray(list) || list.some(id => !ids.has(id)) || new Set(list).size !== list.length) fail();
    return [...list];
  };
  const approved = readIds(value.approved), rejected = readIds(value.rejected);
  if (approved.some(id => rejected.includes(id))) fail();
  return { approved, rejected, generated };
}

export function libraryPalettes(library) {
  return [...studioPalettes, ...library.generated.map(({ id, label, colors }) => {
    const ordered = [...colors].sort((a, b) => luminance(a) - luminance(b));
    // Fill the existing eight studio roles without inventing extra swatches.
    const expanded = [...ordered];
    while (expanded.length < 8) expanded.push(ordered[(expanded.length - ordered.length) % ordered.length]);
    return palette(id, label, expanded, ordered.at(-1), ordered.at(-2), ordered[0]);
  })];
}

function luminance(hex) {
  const c = new Color(hex);
  return .2126 * c.r + .7152 * c.g + .0722 * c.b;
}

export function reviewPalette(library, id, status) {
  if (!['approved', 'rejected'].includes(status) || !libraryPalettes(library).some(p => p.id === id)) throw new Error('Unknown palette review.');
  const next = { ...library, approved: library.approved.filter(value => value !== id), rejected: library.rejected.filter(value => value !== id) };
  next[status].push(id);
  return next;
}

export function nextApprovedPalette(palettes, library, currentId, steps = 1) {
  const approved = new Set(library.approved), available = palettes.filter(p => approved.has(p.id));
  if (!available.length) return null;
  const wrap = (i, n) => ((i % n) + n) % n;
  let index = available.findIndex(p => p.id === currentId);
  if (index < 0) {
    const current = palettes.findIndex(p => p.id === currentId), direction = steps < 0 ? -1 : 1;
    if (current < 0) index = direction > 0 ? 0 : available.length - 1;
    else {
      for (let offset = 1; offset <= palettes.length; offset++) {
        const candidate = palettes[wrap(current + offset * direction, palettes.length)];
        if (approved.has(candidate.id)) { index = available.indexOf(candidate); break; }
      }
    }
    steps -= direction;
  }
  return available[wrap(index + steps, available.length)];
}

const clamp = (value, low, high) => Math.max(low, Math.min(high, value));
const hueName = hue => ['Coral', 'Amber', 'Citron', 'Moss', 'Mint', 'Lagoon', 'Azure', 'Cobalt', 'Iris', 'Plum', 'Orchid', 'Rose'][Math.floor(((hue % 1 + 1) % 1) * 12)];

export function generatePalette(seed, source) {
  const random = createSeededRandom(seed), base = random(), accent = (base + .35 + random() * .25) % 1;
  const hueShift = (random() - .5) * .14, saturationShift = (random() - .5) * .18;
  const colors = source ? paletteSwatches(source).map(hex => {
    const hsl = new Color(hex).getHSL({}, SRGBColorSpace);
    return '#' + new Color().setHSL(hsl.h + hueShift, clamp(hsl.s + saturationShift, .08, .85),
      clamp(hsl.l + (random() - .5) * .06, .025, .96), SRGBColorSpace).getHexString();
  }) : [.065, .27, .48, .66, .91].map((lightness, i) => {
    const hue = i === 2 || i === 3 ? accent : base + (random() - .5) * .06;
    const saturation = i === 0 ? .25 : i === 4 ? .25 + random() * .2 : .38 + random() * .36;
    return '#' + new Color().setHSL(hue, saturation, lightness, SRGBColorSpace).getHexString();
  });
  colors.sort((a, b) => luminance(a) - luminance(b));
  const id = `generated-${colors.map(c => c.slice(1)).join('-')}`;
  const label = source ? `${source.label.replace(/ · variation$/, '').slice(0, 49)} · variation` : `${hueName(base)} & ${hueName(accent).toLowerCase()}`;
  return { id, label, colors };
}
