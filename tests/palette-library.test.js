import test from 'node:test';
import assert from 'node:assert/strict';
import { Color } from 'three';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { defaultPaletteLibrary, validatePaletteLibrary, libraryPalettes, paletteSwatches, paletteStatus, reviewPalette, nextApprovedPalette, generatePalette, MAX_GENERATED_PALETTES } from '../src/palette-library.js';
import { studioPalettes, applyStudioPalette, matchingStudioPalette } from '../src/studio-palettes.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { createSetupHandler } from '../server/setup-api.js';
import { requestStaticSetup } from '../src/static-setup.js';

test('older setups enable every existing palette; reviews are reversible without modifying presets', () => {
  const old = defaultMeshSetup(); delete old.paletteLibrary;
  const library = validateMeshSetup(old).paletteLibrary, id = studioPalettes[0].id;
  assert.deepEqual(library.approved, studioPalettes.map(p => p.id));
  assert.equal(library.generated.length, 0);
  const rejected = reviewPalette(library, id, 'rejected');
  assert.equal(paletteStatus(rejected, id), 'rejected');
  assert.equal(paletteStatus(library, id), 'approved');
  assert.equal(paletteStatus(reviewPalette(rejected, id, 'approved'), id), 'approved');
  assert.deepEqual(libraryPalettes(rejected), studioPalettes);
});

test('new palettes and variations are deterministic, brightness ordered, and pending until approved', () => {
  const brightness = hex => { const c = new Color(hex); return .2126 * c.r + .7152 * c.g + .0722 * c.b; };
  const ids = new Set();
  for (let seed = 1; seed <= 40; seed++) {
    for (const source of [undefined, studioPalettes[seed % studioPalettes.length]]) {
      const before = source && structuredClone(source), candidate = generatePalette(seed, source);
      assert.deepEqual(candidate, generatePalette(seed, source));
      assert.ok(!ids.has(candidate.id)); ids.add(candidate.id);
      assert.equal(candidate.colors.length, source ? paletteSwatches(source).length : 5);
      assert.deepEqual(candidate.colors, [...candidate.colors].sort((a, b) => brightness(a) - brightness(b)));
      const library = validatePaletteLibrary({ ...defaultPaletteLibrary(), generated: [candidate] });
      assert.equal(paletteStatus(library, candidate.id), 'pending');
      assert.deepEqual(new Set(paletteSwatches(libraryPalettes(library).at(-1))), new Set(candidate.colors));
      assert.equal(paletteStatus(reviewPalette(library, candidate.id, 'approved'), candidate.id), 'approved');
      if (source) assert.deepEqual(source, before);
    }
  }
});

test('rotation skips rejected and pending palettes in either direction, wraps, and holds when all are rejected', () => {
  const candidate = generatePalette(123), library = { approved: [studioPalettes[1].id, studioPalettes[3].id], rejected: [], generated: [candidate] };
  const palettes = libraryPalettes(library), next = (id, steps = 1) => nextApprovedPalette(palettes, library, id, steps)?.id;
  assert.equal(next(studioPalettes[1].id), studioPalettes[3].id);
  assert.equal(next(studioPalettes[3].id), studioPalettes[1].id);
  assert.equal(next(studioPalettes[1].id, -1), studioPalettes[3].id);
  assert.equal(next(studioPalettes[1].id, 3), studioPalettes[3].id);
  assert.equal(next(studioPalettes[1].id, -2), studioPalettes[1].id);
  assert.equal(next(studioPalettes[2].id), studioPalettes[3].id);
  assert.equal(next(studioPalettes[2].id, -1), studioPalettes[1].id);
  assert.equal(next(candidate.id), studioPalettes[1].id);
  assert.equal(next(candidate.id, -1), studioPalettes[3].id);
  assert.equal(next('custom'), studioPalettes[1].id);
  assert.equal(next('custom', -1), studioPalettes[3].id);
  assert.equal(nextApprovedPalette(palettes, { ...library, approved: [] }, candidate.id), null);
  const approved = reviewPalette(library, candidate.id, 'approved');
  assert.equal(nextApprovedPalette(palettes, approved, studioPalettes[3].id).id, candidate.id);
});

test('generated palettes roundtrip through saved lighting without changing spotlight, material, or intensity controls', () => {
  const candidate = generatePalette(800), library = reviewPalette({ ...defaultPaletteLibrary(), generated: [candidate] }, candidate.id, 'approved');
  const palettes = libraryPalettes(library), setup = defaultMeshSetup();
  setup.lighting.spotlight.color = '#e6daca';
  const lighting = applyStudioPalette(setup.lighting, candidate.id, palettes);
  const saved = validateMeshSetup(JSON.parse(JSON.stringify({ ...setup, lighting, paletteLibrary: library })));
  assert.equal(matchingStudioPalette(saved.lighting, libraryPalettes(saved.paletteLibrary)), candidate.id);
  assert.deepEqual(saved.lighting.spotlight, setup.lighting.spotlight);
  assert.equal(saved.lighting.environment.intensity, setup.lighting.environment.intensity);
  assert.deepEqual(saved.materials, setup.materials);
  assert.deepEqual(mergeMeshSetup(saved, { camera: { yaw: 40 } }).paletteLibrary, library);
  assert.deepEqual(mergeMeshSetup(saved, { paletteLibrary: { approved: [] } }).paletteLibrary.approved, []);
});

test('invalid palette data and contradictory reviews fail validation; validated data is independent', () => {
  const candidate = generatePalette(44), valid = { ...defaultPaletteLibrary(), generated: [candidate] };
  const result = validatePaletteLibrary(valid); result.generated[0].colors[0] = '#000000'; result.approved.pop();
  assert.notDeepEqual(result.generated[0].colors, valid.generated[0].colors);
  assert.equal(valid.approved.length, studioPalettes.length);
  for (const value of [null, {}, { ...valid, approved: ['missing'] }, { ...valid, rejected: [valid.approved[0]] },
    { ...valid, generated: [candidate, candidate] }, { ...valid, generated: [{ ...candidate, colors: ['red', '#abcdef'] }] },
    { ...valid, generated: [{ ...candidate, label: '  ' }] }, { ...valid, generated: [{ ...candidate, id: '../invalid' }] },
    { ...valid, generated: Array.from({ length: MAX_GENERATED_PALETTES + 1 }, (_, i) => generatePalette(i)) }]) {
    assert.throws(() => validatePaletteLibrary(value), /Invalid palette library/);
  }
});

test('Save/Reload retains a full reviewed library on the dev server and in production storage', async () => {
  const directory = await mkdtemp(join(tmpdir(), 'palette-library-')), file = join(directory, 'setup.json');
  const handler = createSetupHandler(file);
  const generated = Array.from({ length: MAX_GENERATED_PALETTES }, (_, i) => ({ ...generatePalette(i, studioPalettes[0]), label: `Candidate ${i}` }));
  let library = { ...defaultPaletteLibrary(), generated };
  library.approved.push(...generated.slice(0, 128).map(p => p.id));
  library.rejected.push(...generated.slice(128).map(p => p.id));
  library = reviewPalette(reviewPalette(library, studioPalettes[0].id, 'rejected'), generated[0].id, 'approved');
  const setup = mergeMeshSetup(defaultMeshSetup(), { paletteLibrary: library });
  assert.ok(Buffer.byteLength(JSON.stringify(setup)) > 65536, 'A full library must fit beyond the old request limit.');
  async function request(method, value) {
    const req = Readable.from(value ? [JSON.stringify(value)] : []);
    req.url = '/api/setup'; req.method = method;
    req.headers = { 'content-type': 'application/json', host: 'localhost:1234', origin: 'http://localhost:1234' };
    const res = { statusCode: 0, setHeader() {}, end(body) { this.body = JSON.parse(body); } };
    await handler(req, res, () => assert.fail('Unexpected route fallback')); return res;
  }
  try {
    assert.equal((await request('PUT', setup)).statusCode, 200);
    assert.deepEqual((await request('GET')).body, setup);
    assert.equal((await request('PUT', { ...setup, paletteLibrary: { ...library, generated: [...generated, generatePalette(1000)] } })).statusCode, 400);
    assert.deepEqual(JSON.parse(await readFile(file, 'utf8')), setup, 'Invalid saves leave the previous library intact.');
    const data = new Map(), storage = { getItem: key => data.get(key) ?? null, setItem: (key, value) => data.set(key, value) };
    const options = { url: 'https://example.test/2026-10-29/setup.json', storage, bundledSetup: defaultMeshSetup(), validate: validateMeshSetup };
    await requestStaticSetup({ ...options, method: 'PUT', value: setup });
    assert.deepEqual(await requestStaticSetup(options), setup);
  } finally { await rm(directory, { recursive: true, force: true }); }
});
