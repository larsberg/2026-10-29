import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { studioPalettes, studioColorFields, applyStudioPalette, matchingStudioPalette } from '../src/studio-palettes.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { referencePalettes } from '../src/sketchbook-palettes.js';

test('all presets order their unchanged swatches by brightness and have distinct descriptive names', () => {
  const luminance = hex => { const c = new Color(hex); return .2126 * c.r + .7152 * c.g + .0722 * c.b; };
  assert.equal(new Set(studioPalettes.map(p => p.label)).size, studioPalettes.length);
  for (const palette of studioPalettes) {
    const colors = studioColorFields.map(([key]) => palette.environment[key]);
    assert.deepEqual([...colors].sort(), Object.values(palette.legacyEnvironment).sort(), 'Sorting must preserve every swatch.');
    const brightness = colors.map(luminance);
    assert.equal(luminance(palette.environment.backgroundColor), Math.min(...brightness));
    for (let i = 1; i < brightness.length; i++) assert.ok(brightness[i] >= brightness[i - 1], palette.label);
    assert.ok(typeof palette.label === 'string' && palette.label.length > 2);
    assert.doesNotMatch(palette.label, /^Sketchbook\s+\d+/);
  }
  assert.deepEqual(studioPalettes.slice(8).map(p => p.id), [...new Set(referencePalettes)].map(p => `sketchbook-${p}`),
    'Renaming and sorting preserve the IDs and dropdown order.');
});

test('all studio palettes preserve reflection settings and roundtrip their environment colors',()=>{
  assert.deepEqual(studioPalettes.slice(0,8).map(p=>p.id),['copper-blue','glacier','solar','orchid','citrus','ember','ink','pearl']);
  const original=mergeMeshSetup(defaultMeshSetup(),{lighting:{environment:{rotation:35,intensity:1.7}}});
  for(const palette of studioPalettes){
    const lighting=applyStudioPalette(original.lighting,palette.id),saved=validateMeshSetup({...original,lighting});
    assert.equal(matchingStudioPalette(saved.lighting),palette.id);assert.equal(saved.lighting.environment.rotation,35);assert.equal(saved.lighting.environment.intensity,1.7);
    assert.deepEqual(saved.lighting.spotlight, original.lighting.spotlight, 'Every palette preserves the spotlight color and shadow settings.');
    for(const [key,color] of Object.entries(palette.environment))assert.equal(saved.lighting.environment[key],color);
  }
  assert.equal(original.lighting.environment.backgroundColor,'#000000');
});

test('known older presets load in brightness order while custom colors and light settings stay intact', () => {
  const original = defaultMeshSetup();
  for (const preset of studioPalettes) {
    const lighting = applyStudioPalette(original.lighting, preset.id);
    Object.assign(lighting.environment, preset.legacyEnvironment, { rotation: 35, intensity: 1.7 });
    Object.assign(lighting.spotlight, { color: '#e6daca', penumbra: .7, softness: 4, intensity: 1700 });
    const saved = validateMeshSetup({ ...original, lighting });
    assert.equal(matchingStudioPalette(saved.lighting), preset.id);
    assert.deepEqual(saved.lighting.spotlight, lighting.spotlight);
    assert.deepEqual(saved.lighting.directional, lighting.directional);
    assert.deepEqual(saved.lighting.hemisphere, lighting.hemisphere);
    assert.equal(saved.lighting.environment.rotation, 35);
    assert.equal(saved.lighting.environment.intensity, 1.7);
    for (const [key, color] of Object.entries(preset.environment)) assert.equal(saved.lighting.environment[key], color);
  }
  const custom = applyStudioPalette(original.lighting, studioPalettes[0].id);
  Object.assign(custom.environment, studioPalettes[0].legacyEnvironment, { keyColor: '#123456' });
  assert.deepEqual(validateMeshSetup({ ...original, lighting: custom }).lighting, custom);
});
