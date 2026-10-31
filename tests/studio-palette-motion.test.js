import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, DirectionalLight, Fog, HemisphereLight, Scene, SpotLight } from 'three';
import { createStudioPaletteMotion } from '../src/studio-palette-motion.js';
import { defaultLighting } from '../src/lighting-settings.js';
import { applyStudioPalette } from '../src/studio-palettes.js';

test('studio colors stay constant during playback and only transition when the palette is changed',()=>{
  const lighting=defaultLighting(),before=structuredClone(lighting),scene=new Scene();scene.background=new Color();
  scene.fog = new Fog('#000000', 10, 30);
  const clearColor = new Color();
  const renderer = { setClearColor(color, alpha) { clearColor.copy(color); assert.equal(alpha, 1); } };
  let transitions=0;const environment={transition(){transitions++;},update(){}};
  const spotlight=new SpotLight();
  const palette=createStudioPaletteMotion({environment,scene,renderer,sun:new DirectionalLight(),hemisphere:new HemisphereLight(),spotlight,lighting});
  const initial=scene.background.getHexString();
  assert.equal(clearColor.getHexString(), initial);
  for(let i=0;i<120;i++)palette.update(1/60);
  assert.equal(scene.background.getHexString(),initial);assert.equal(transitions,0);assert.deepEqual(lighting,before);
  const next=applyStudioPalette(lighting,'glacier');
  palette.configure(next);palette.update(.25);assert.equal(transitions,1);assert.equal(palette.transitioning,true);
  assert.equal(clearColor.getHexString(), scene.background.getHexString(), 'Clear and background colors stay synchronized during the fade.');
  assert.equal(scene.fog.color.getHexString(), scene.background.getHexString());
  palette.update(.25);assert.equal(palette.transitioning,false);
  assert.equal(scene.background.getHexString(),new Color(next.environment.backgroundColor).getHexString());
  assert.equal(clearColor.getHexString(), new Color(next.environment.backgroundColor).getHexString());
  assert.equal(spotlight.color.getHexString(),new Color(next.spotlight.color).getHexString());
});
