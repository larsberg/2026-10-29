import test from 'node:test';
import assert from 'node:assert/strict';
import { BufferGeometry, Float32BufferAttribute, Mesh, MeshBasicMaterial, NearestFilter, RepeatWrapping, Scene, ShaderLib, SRGBColorSpace, Vector3 } from 'three';
import { createProjectedLines, defaultProjectedLines, PROJECTED_LINE_COUNT } from '../src/projected-lines.js';
import { defaultStudioColors, studioPalettes } from '../src/studio-palettes.js';
import { createFaceMetal } from '../src/face-metal.js';
import { createHerdGround } from '../src/herd-ground.js';
import { createHerdSources, createSculptureGroup } from '../src/sculpture-group.js';
import { initCSG } from '../src/box-union.js';
import { initPhysics, createPhysics } from '../src/physics.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

await initCSG(); await initPhysics();

const pixelHex = (texture, x) => '#' + [...texture.image.data.slice(x * 4, x * 4 + 3)].map(v => v.toString(16).padStart(2, '0')).join('');

test('the 16-pixel repeat contains deterministic picks directly from each palette', () => {
  const settings = defaultProjectedLines();
  for (const preset of studioPalettes) {
    const projection = createProjectedLines(settings, preset.environment);
    const copy = createProjectedLines(settings, preset.environment);
    try {
      const { texture } = projection;
      assert.deepEqual(texture.image.data, copy.texture.image.data, 'A saved seed recreates the same colors.');
      const palette = new Set(Object.values(preset.environment));
      assert.equal(texture.image.data.length, PROJECTED_LINE_COUNT * 4);
      for (let x = 0; x < PROJECTED_LINE_COUNT; x++) {
        assert.ok(palette.has(pixelHex(texture, x)), `${preset.label} must use only its own swatches.`);
        assert.equal(texture.image.data[x * 4 + 3], 255);
      }
    } finally { projection.dispose(); copy.dispose(); }
  }
});

test('only seed and palette-color edits upload the nearest-sampled texture', () => {
  const settings = defaultProjectedLines(), projection = createProjectedLines(settings);
  try {
    const { texture, uniforms } = projection;
    assert.equal(texture.minFilter, NearestFilter); assert.equal(texture.magFilter, NearestFilter);
    assert.equal(texture.wrapS, RepeatWrapping); assert.equal(texture.wrapT, RepeatWrapping);
    assert.equal(texture.generateMipmaps, false);
    assert.equal(texture.colorSpace, SRGBColorSpace, 'Palette bytes must decode from sRGB before lighting.');
    assert.equal(texture.image.width, PROJECTED_LINE_COUNT);
    assert.ok(Array.from({ length: PROJECTED_LINE_COUNT }, (_, x) => pixelHex(texture, x)).includes('#fff1df'),
      'The lightest swatch can appear as a normal band.');
    const version = texture.version;
    projection.configure({ ...settings, spacing: 2, angle: 0, tilt: 0, offset: .2 });
    assert.equal(texture.version, version);
    assert.equal(uniforms.projectedLineScale.value, .5, 'Spacing scales distance in original world units.');
    assert.equal(uniforms.projectedLineOffset.value, .2);
    projection.configure({ ...settings, enabled: false });
    assert.equal(texture.version, version);
    assert.equal(uniforms.projectedLineStrength.value, 0);
    const before = texture.image.data.slice();
    projection.configure({ ...settings, seed: 2 });
    assert.equal(texture.version, version + 1);
    assert.notDeepEqual(texture.image.data, before);
    const monochrome = Object.fromEntries(Object.keys(defaultStudioColors()).map(key => [key, '#234567']));
    projection.configure(settings, monochrome);
    assert.equal(texture.version, version + 2);
    assert.equal(pixelHex(texture, 0), '#234567');
    assert.equal(pixelHex(texture, PROJECTED_LINE_COUNT - 1), '#234567');
    projection.configure({ ...settings, spacing: 3 }, { ...monochrome, intensity: 2 });
    assert.equal(texture.version, version + 2, 'Lighting intensity and uniform changes do not rewrite colors.');
  } finally { projection.dispose(); }
});

test('each harmony chord advances the shared offset once over 250 ms with signed speed', () => {
  const settings = { ...defaultProjectedLines(), offset: .3 };
  const projection = createProjectedLines(settings), offset = () => projection.uniforms.projectedLineOffset.value;
  const chord = beat => ['f4', 'a4', 'b4'].map(note => ({ layer: 'keys', beat, note }));
  try {
    const version = projection.texture.version;
    projection.updateMotion(.1, ['kick', 'bass', 'snare', 'hat', 'melody'].map(layer => ({ layer, beat: 0 })));
    assert.equal(offset(), .3, 'Only harmony advances the texture.');
    projection.updateMotion(0, chord(4));
    assert.equal(offset(), .3, 'A chord starts an animation without an immediate jump.');
    projection.updateMotion(.125, chord(4).slice(1));
    assert.ok(Math.abs(offset() - .425) < 1e-12, 'At 125 ms the chord has applied half one increment, even if its notes arrive across frames.');
    projection.updateMotion(.124, []);
    assert.ok(offset() < .55, 'The animation is still in progress at 249 ms.');
    projection.updateMotion(.001, []);
    assert.equal(offset(), .55, 'The full increment is applied at 250 ms.');
    for (let i = 0; i < 120; i++) projection.updateMotion(1 / 120, []);
    assert.equal(offset(), .55, 'There is no tail after the 250 ms animation.');
    projection.configure({ ...settings, offset: .6 });
    assert.equal(offset(), .85, 'Manual edits preserve the musical contribution.');
    projection.configure({ ...settings, offset: .6, offsetSpeed: -.125 });
    assert.equal(offset(), .85, 'Changing speed does not change the existing position.');
    projection.updateMotion(0, chord(8));
    projection.updateMotion(.25, []);
    assert.equal(offset(), .725, 'Negative speed reverses each increment.');
    projection.configure({ ...settings, offset: .6, offsetSpeed: 0 });
    projection.updateMotion(0, [...chord(12), ...chord(16)]);
    projection.updateMotion(.25, []);
    assert.equal(offset(), .725, 'Zero speed holds the offset.');
    projection.configure({ ...settings, offset: .6, offsetSpeed: .001 });
    projection.updateMotion(0, chord(20));
    projection.updateMotion(.25, []);
    assert.ok(Math.abs(offset() - .726) < 1e-12);
    assert.equal(projection.texture.version, version);
    projection.configure({ ...settings, offset: .6 });
    for (const fps of [60, 120]) {
      projection.resetMotion();
      projection.updateMotion(0, chord(4));
      for (let frame = 0; frame < fps * .25; frame++) projection.updateMotion(1 / fps, []);
      assert.ok(Math.abs(offset() - .85) < 1e-12, 'Duration is independent of frame rate, and Reset allows the same opening chord again.');
    }
    projection.resetMotion();
    assert.equal(offset(), .6);
    projection.updateMotion(0, Array.from({ length: 65 }, (_, beat) => chord(beat)).flat());
    projection.updateMotion(.25, []);
    assert.ok(Math.abs(offset() - .85) < 1e-12, 'The accumulated offset wraps seamlessly through the 16-band repeat.');
  } finally { projection.dispose(); }
});

test('equal radii have equal texture coordinates regardless of axis, body translation, or rotation', () => {
  const projection = createProjectedLines(), geometry = new BufferGeometry(), material = new MeshBasicMaterial();
  geometry.setAttribute('position', new Float32BufferAttribute([1, 0, 0, 0, 1, 0, 0, 0, 1, -1, 0, 0, 0, 2, 0, 0, 0, 3], 3));
  const mesh = new Mesh(geometry, material);
  try {
    for (const shift of [0, 17]) {
      mesh.position.set(shift + 8, 15, -6); mesh.rotation.set(.4, .5 + shift, 1);
      mesh.updateWorldMatrix(true, false);
      projection.capture(mesh, mesh.localToWorld(new Vector3()));
      const distances = geometry.attributes.projectedLineRestDistance;
      [1, 1, 1, 1, 2, 3].forEach((expected, i) => assert.ok(Math.abs(distances.getX(i) - expected) < 1e-6));
    }
  } finally { projection.dispose(); geometry.dispose(); material.dispose(); }
});

test('body texture coordinates capture original center distance and survive physical skinning and mesh edits', () => {
  const settings = mergeMeshSetup(defaultMeshSetup(), { rigidBody: { gravity: 0 },
    pipeline: { initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true } });
  const scene = new Scene(), physics = createPhysics(settings.rigidBody), material = createFaceMetal();
  const projection = createProjectedLines(settings.lines), group = createSculptureGroup(scene, material, physics, projection);
  const ground = createHerdGround(scene, physics, settings.floor, projection);
  const compile = mesh => {
    const shader = { uniforms: {}, vertexShader: ShaderLib.physical.vertexShader, fragmentShader: ShaderLib.physical.fragmentShader };
    mesh.material.onBeforeCompile(shader, {}); return shader;
  };
  const checkOriginal = mesh => {
    mesh.updateWorldMatrix(true, false);
    const { position, projectedLineRestDistance: rest } = mesh.geometry.attributes;
    assert.equal(rest.count, position.count);
    assert.equal(rest.itemSize, 1);
    const rig = group.views.find(view => view.surface.mesh === mesh).rig;
    const center = new Vector3(); let mass = 0;
    for (const { body } of rig.entries) {
      const weight = body.getMass(); mass += weight; center.addScaledVector(body.getWorldCenterOfMass(), weight);
    }
    center.divideScalar(mass);
    for (let i = 0; i < position.count; i++) {
      const expected = new Vector3().fromBufferAttribute(position, i).applyMatrix4(mesh.matrixWorld).distanceTo(center);
      assert.ok(Math.abs(expected - rest.getX(i)) < 2e-6);
    }
  };
  try {
    group.object.position.set(2, 0, -3);
    group.setSources(createHerdSources(450725, 2), settings);
    const meshes = [...group.surfaces, ground.mesh]; group.surfaces.forEach(checkOriginal);
    const rest = group.surfaces.map(mesh => mesh.geometry.attributes.projectedLineRestDistance);
    const copies = rest.map(attribute => attribute.array.slice());
    const versions = rest.map(attribute => attribute.version);
    const initial = group.views.map(view => view.rig.positions.slice());
    for (const view of group.views) {
      const body = view.rig.entries[0].body;
      body.applyLinearImpulseToCenter({ x: body.getMass() * 3, y: body.getMass(), z: 0 }, true);
    }
    for (let i = 0; i < 90; i++) physics.step(1 / 120);
    assert.ok(group.views.some((view, i) => view.rig.positions.some((value, j) => Math.abs(value - initial[i][j]) > .1)));
    rest.forEach((attribute, i) => {
      assert.deepEqual(attribute.array, copies[i], 'Deformation must not slide the pattern through the body.');
      assert.equal(attribute.version, versions[i], 'Original distances require no per-frame uploads.');
    });
    group.configure(settings);
    const shaders = meshes.map(compile);
    for (const shader of shaders) {
      assert.equal(shader.uniforms.projectedLineMap.value, projection.texture);
      assert.equal(shader.uniforms.projectedLineScale, projection.uniforms.projectedLineScale);
    }
    for (const shader of shaders.slice(0, 7)) assert.match(shader.vertexShader, /vProjectedLineDistance = projectedLineRestDistance/);
    projection.configure({ ...settings.lines, offset: .3 });
    projection.updateMotion(0, [{ layer: 'keys', beat: 4 }]);
    projection.updateMotion(.125, []);
    for (const shader of shaders) {
      assert.equal(shader.uniforms.projectedLineOffset, projection.uniforms.projectedLineOffset);
      assert.ok(shader.uniforms.projectedLineOffset.value > .3);
    }
    assert.equal(shaders.at(-1).uniforms.projectedLineOffset, projection.uniforms.projectedLineOffset, 'Ground shares the exact body offset uniform.');
    assert.equal(new Set(shaders.slice(0, 7).map(shader => shader.uniforms.dualCorners.value)).size, 7,
      'Each body still has independent animated polygon normals.');
    const previous = group.surfaces[0].geometry.attributes.projectedLineRestDistance;
    group.smooth({ iterations: 1, strength: .3 });
    assert.notEqual(group.surfaces[0].geometry.attributes.projectedLineRestDistance, previous);
    group.surfaces.forEach(mesh => { checkOriginal(mesh); assert.equal(compile(mesh).uniforms.projectedLineMap.value, projection.texture); });
  } finally { group.dispose(); ground.dispose(); projection.dispose(); material.dispose(); physics.dispose(); }
});

test('line controls migrate older setups, roundtrip, and reject invalid projections', () => {
  const old = defaultMeshSetup(); delete old.lines;
  assert.deepEqual(validateMeshSetup(old).lines, defaultProjectedLines());
  const binary = defaultMeshSetup(); delete binary.lines.seed;
  delete binary.lines.offsetSpeed;
  Object.assign(binary.lines, { ink: '#19202a', paper: '#eee8da', width: 90, spacing: 2 });
  assert.deepEqual(validateMeshSetup(binary).lines, { ...defaultProjectedLines(), spacing: 2 });
  const next = mergeMeshSetup(defaultMeshSetup(), { lines: { spacing: 2.4, angle: -80, tilt: 15, seed: 42, offsetSpeed: -.127 } });
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(next))), next);
  for (const offsetSpeed of [-1, 0, 1]) assert.equal(mergeMeshSetup(next, { lines: { offsetSpeed } }).lines.offsetSpeed, offsetSpeed);
  for (const lines of [{ spacing: 0 }, { tilt: 90 }, { seed: -1 }, { seed: 1.2 }, { seed: null }, { offsetSpeed: -1.001 }, { offsetSpeed: 1.001 }, { offsetSpeed: null }, { enabled: 1 }]) {
    assert.throws(() => mergeMeshSetup(next, { lines }), /Invalid/);
  }
});
