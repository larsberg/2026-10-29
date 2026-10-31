import { Color } from 'three';
import { referencePalettes, referencePaletteNames } from './sketchbook-palettes.js';

const copperColors = ['#160e1b', '#ffad83', '#fff1df', '#147aff', '#5ed5ff', '#d997aa', '#ffac8c', '#a99cb7'];
const brightness = hex => { const c = new Color(hex); return .2126 * c.r + .7152 * c.g + .0722 * c.b; };
const sortColors = colors => [...colors].sort((a, b) => brightness(a) - brightness(b));
const defaultColors = sortColors(copperColors);

// The same color roles drive the studio bake, saved settings, and color pickers.
// Intensities, positions, material properties, floor, and fog remain independent.
export const studioColorFields = [
  ['backgroundColor', 'Studio background'],
  ['keyColor', 'Broad front panel'],
  ['stripColor', 'Highlight strip'],
  ['fillColor', 'Side panel'],
  ['rimColor', 'Rim panel'],
  ['accentColor', 'Accent panel'],
  ['bounceColor', 'Lower panel'],
  ['backColor', 'Back panel'],
].map(([key, label], i) => [key, label, defaultColors[i]]);
export const defaultStudioColors = () => Object.fromEntries(studioColorFields.map(([key, , color]) => [key, color]));

function palette(id, label, colors, directional, sky, ground) {
  const sorted = sortColors(colors);
  return { id, label, environment: Object.fromEntries(studioColorFields.map(([key], i) => [key, sorted[i]])),
    legacyEnvironment: Object.fromEntries(studioColorFields.map(([key], i) => [key, colors[i]])),
    directional: { color: directional }, hemisphere: { skyColor: sky, groundColor: ground } };
}

export const studioPalettes = [
  palette('copper-blue', 'Copper / blue', copperColors, '#ffd5bc', '#8bc7ff', '#51303b'),
  palette('glacier', 'Glacier', ['#071823','#a8e6ed','#f0ffff','#2164cc','#6affdf','#889fda','#7bcae5','#54728f'], '#d4faff','#a3e9ff','#1d3d55'),
  palette('solar', 'Solar', ['#271017','#ff8b35','#fff3bb','#de284b','#ffc855','#f06569','#eb5b27','#865478'], '#ffe0a1','#ffc066','#532032'),
  palette('orchid', 'Orchid', ['#180b29','#d693ed','#fff0fc','#5831ca','#94bfff','#f362b3','#b267b9','#5964b1'], '#f4c7ff','#b8b1ff','#402245'),
  palette('citrus', 'Citrus', ['#111e17','#d6ef68','#fffed1','#159a87','#86e8be','#f3c04e','#b2c944','#608977'], '#f0ffd0','#a5e7c1','#34402a'),
  palette('ember', 'Ember / teal', ['#101c20','#ff914e','#fff0d6','#087f8c','#51d4cc','#d3584b','#e1ac69','#4c6f78'], '#ffdbb4','#80ddd9','#4e302b'),
  palette('ink', 'Ink / silver', ['#080b12','#c3ccd7','#ffffff','#526881','#9daec8','#919baa','#c8c0b6','#485568'], '#f2f4fa','#c4d1e5','#292e38'),
  palette('pearl', 'Pearl', ['#27222a','#edcfc1','#fff8ed','#9eb6cf','#c5e6dd','#dcb5cf','#e0c69f','#9f96b4'], '#fff0e4','#d9e8f2','#69515f'),
  ...[...new Set(referencePalettes)].map(value => {
    const [background, key, strip, fill, rim] = value.split('-').map(color => `#${color}`);
    // Reuse all five original swatches across the existing studio/light roles.
    // Color-based IDs stay stable if the collection's order changes.
    return palette(`sketchbook-${value}`, referencePaletteNames[value],
      [background, key, strip, fill, rim, key, fill, rim], strip, rim, background);
  }),
];

export function studioColorKey(environment) {
  return studioColorFields.map(([key]) => environment[key]).join(',');
}

// Reorder known saved presets once; leave individually edited colors alone.
const legacyEnvironments = new Map(studioPalettes.map(p => [studioColorKey(p.legacyEnvironment), p.environment]));
export function migrateStudioColors(environment) {
  const preset = legacyEnvironments.get(studioColorKey(environment));
  return preset ? { ...environment, ...preset } : environment;
}

export function matchingStudioPalette(lighting) {
  return studioPalettes.find(p => studioColorKey(p.environment) === studioColorKey(lighting.environment)
    && p.directional.color === lighting.directional.color
    && (!lighting.spotlight || p.directional.color === lighting.spotlight.color)
    && p.hemisphere.skyColor === lighting.hemisphere.skyColor
    && p.hemisphere.groundColor === lighting.hemisphere.groundColor)?.id ?? 'custom';
}

export function applyStudioPalette(lighting, id) {
  const preset = studioPalettes.find(p => p.id === id);
  if (!preset) throw new Error('Unknown studio palette.');
  return { ...lighting, environment: { ...lighting.environment, ...preset.environment },
    ...(lighting.spotlight ? { spotlight: { ...lighting.spotlight, color: preset.directional.color } } : {}),
    directional: { ...lighting.directional, ...preset.directional }, hemisphere: { ...lighting.hemisphere, ...preset.hemisphere } };
}
