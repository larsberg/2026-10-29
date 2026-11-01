import test from 'node:test';
import assert from 'node:assert/strict';
import { Color, DirectionalLight, Fog, HemisphereLight, Scene, SpotLight } from 'three';
import { createStudioPaletteMotion } from '../src/studio-palette-motion.js';
import { defaultLighting } from '../src/lighting-settings.js';
import { applyStudioPalette } from '../src/studio-palettes.js';
import { createMarchClock } from '../src/march-clock.js';

test('background, clear and fog stay black while palette changes still fade the lights',()=>{
  const lighting=defaultLighting(),before=structuredClone(lighting),scene=new Scene();scene.background=new Color();
  scene.fog = new Fog('#000000', 10, 30);
  const clearColor = new Color();
  const renderer = { setClearColor(color, alpha) { clearColor.copy(color); assert.equal(alpha, 1); } };
  let transitions=0;const environment={transition(){transitions++;},update(){}};
  const spotlight=new SpotLight();
  const palette=createStudioPaletteMotion({environment,scene,renderer,sun:new DirectionalLight(),hemisphere:new HemisphereLight(),spotlight,lighting});
  const initial=scene.background.getHexString();
  assert.equal(initial, '000000', 'Even a colored initial studio palette leaves the scene background black.');
  assert.equal(clearColor.getHexString(), initial);
  assert.equal(scene.fog.color.getHexString(), initial);
  for(let i=0;i<120;i++)palette.update(1/60);
  assert.equal(scene.background.getHexString(),initial);assert.equal(transitions,0);assert.deepEqual(lighting,before);
  const next=applyStudioPalette(lighting,'glacier');
  palette.configure(next);palette.update(.25);assert.equal(transitions,1);assert.equal(palette.transitioning,true);
  assert.equal(scene.background.getHexString(), '000000', 'The background does not take part in the palette fade.');
  assert.equal(clearColor.getHexString(), scene.background.getHexString());
  assert.equal(scene.fog.color.getHexString(), scene.background.getHexString());
  palette.update(.25);assert.equal(palette.transitioning,false);
  assert.equal(scene.background.getHexString(), '000000');
  assert.equal(clearColor.getHexString(), '000000');
  assert.equal(scene.fog.color.getHexString(), '000000');
  assert.equal(spotlight.color.getHexString(),new Color(next.spotlight.color).getHexString());
});

test('palette advances once every two four-beat bars across pause, tempo edits, skipped frames and restart', () => {
  let now = 0;
  const clock = createMarchClock({ now: () => now, bpm: 120 });
  const scene = new Scene(); scene.background = new Color();
  const advances = [], palette = createStudioPaletteMotion({
    environment: { update() {}, transition() {} }, scene,
    sun: new DirectionalLight(), hemisphere: new HemisphereLight(), lighting: defaultLighting(),
    onAdvance: steps => advances.push(steps),
  });
  const tick = () => palette.update(1 / 60, clock.beat);
  clock.play(); tick(); now = 3.999; tick();
  assert.deepEqual(advances, [], 'Keep the selected palette throughout the first two bars.');
  now = 4; tick(); tick();
  assert.deepEqual(advances, [1], 'The boundary triggers once, even across repeated frames.');
  clock.pause(); now = 100; tick(); palette.update(1);
  assert.deepEqual(advances, [1], 'Pause does not advance the palette.');
  clock.setTempo(60); clock.play(); now = 108; tick();
  assert.deepEqual(advances, [1, 1], 'Tempo changes stay aligned to the musical clock.');
  now = 132; tick();
  assert.deepEqual(advances, [1, 1, 3], 'Skip directly to the correct palette after missed bars.');
  palette.update(0, 768); palette.update(0, 776);
  assert.deepEqual(advances.slice(-2), [91, 1], 'The 192-bar song loop keeps the palette sequence moving.');
  clock.restart(); palette.resetBeat(); tick();
  assert.equal(advances.length, 5, 'Restart begins a fresh two-bar interval without changing the current palette.');
  now += 8; tick();
  assert.equal(advances.at(-1), 1);
  palette.update(0, 0); palette.update(0, 8);
  assert.equal(advances.at(-1), 1, 'A rewound song clock also starts a fresh interval.');
  assert.equal(scene.background.getHexString(), '000000');
});
