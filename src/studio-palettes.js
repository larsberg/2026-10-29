// The same color roles drive the studio bake, saved settings, and color pickers.
// Intensities, positions, material properties, floor, and fog remain independent.
export const studioColorFields = [
  ['backgroundColor', 'Studio background', '#160e1b'],
  ['keyColor', 'Broad front panel', '#ffad83'],
  ['stripColor', 'Highlight strip', '#fff1df'],
  ['fillColor', 'Side panel', '#147aff'],
  ['rimColor', 'Rim panel', '#5ed5ff'],
  ['accentColor', 'Accent panel', '#d997aa'],
  ['bounceColor', 'Lower panel', '#ffac8c'],
  ['backColor', 'Back panel', '#a99cb7'],
];
export const defaultStudioColors = () => Object.fromEntries(studioColorFields.map(([key, , color]) => [key, color]));

function palette(id, label, colors, directional, sky, ground) {
  return { id, label, environment: Object.fromEntries(studioColorFields.map(([key], i) => [key, colors[i]])),
    directional: { color: directional }, hemisphere: { skyColor: sky, groundColor: ground } };
}

export const studioPalettes = [
  palette('copper-blue', 'Copper / blue', studioColorFields.map(([, , color]) => color), '#ffd5bc', '#8bc7ff', '#51303b'),
  palette('glacier', 'Glacier', ['#071823','#a8e6ed','#f0ffff','#2164cc','#6affdf','#889fda','#7bcae5','#54728f'], '#d4faff','#a3e9ff','#1d3d55'),
  palette('solar', 'Solar', ['#271017','#ff8b35','#fff3bb','#de284b','#ffc855','#f06569','#eb5b27','#865478'], '#ffe0a1','#ffc066','#532032'),
  palette('orchid', 'Orchid', ['#180b29','#d693ed','#fff0fc','#5831ca','#94bfff','#f362b3','#b267b9','#5964b1'], '#f4c7ff','#b8b1ff','#402245'),
  palette('citrus', 'Citrus', ['#111e17','#d6ef68','#fffed1','#159a87','#86e8be','#f3c04e','#b2c944','#608977'], '#f0ffd0','#a5e7c1','#34402a'),
  palette('ember', 'Ember / teal', ['#101c20','#ff914e','#fff0d6','#087f8c','#51d4cc','#d3584b','#e1ac69','#4c6f78'], '#ffdbb4','#80ddd9','#4e302b'),
  palette('ink', 'Ink / silver', ['#080b12','#c3ccd7','#ffffff','#526881','#9daec8','#919baa','#c8c0b6','#485568'], '#f2f4fa','#c4d1e5','#292e38'),
  palette('pearl', 'Pearl', ['#27222a','#edcfc1','#fff8ed','#9eb6cf','#c5e6dd','#dcb5cf','#e0c69f','#9f96b4'], '#fff0e4','#d9e8f2','#69515f'),
];

export function studioColorKey(environment) {
  return studioColorFields.map(([key]) => environment[key]).join(',');
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
