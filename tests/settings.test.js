import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { Readable } from 'node:stream';
import { createSetupHandler } from '../server/setup-api.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';
import { requestStaticSetup } from '../src/static-setup.js';

test('local Save/Reload roundtrips mesh settings and rejects invalid writes atomically', async () => {
  const directory=await mkdtemp(join(tmpdir(),'mesh-settings-')), file=join(directory,'setup.json');
  const handler=createSetupHandler(file);
  async function request(method,value) {
    const req=Readable.from(value ? [JSON.stringify(value)] : []);
    req.url='/api/setup';req.method=method;req.headers={'content-type':'application/json',host:'localhost:1234',origin:'http://localhost:1234'};
    const res={statusCode:0,setHeader(){},end(body){this.body=JSON.parse(body);}};
    await handler(req,res,()=>assert.fail('Unexpected route fallback'));
    return res;
  }
  try {
    const setup=mergeMeshSetup(defaultMeshSetup(),{pipeline:{seed:42,insetScale:.75,triangulateEnabled:false,faceCenterDualEnabled:false,averageVerticesEnabled:false,insetEnabled:false,excludeInitialBorderTriangles:false},rigidBody:{gravity:780.5,friction:1.25},appearance:{wireframeColor:'#aabbcc'},camera:{yaw:30},audio:{bpm:128}});
    assert.equal((await request('PUT',setup)).statusCode,200);
    assert.deepEqual((await request('GET')).body,setup);
    const editedSetup=mergeMeshSetup(setup,{pipeline:{hexelateEnabled:false,insetScale:.25},materials:{mesh:{normalMix:.8,roughness:.6,color:'#aabbcc'}},visibility:{surface:true,wireframe:true},lines:{spacing:2.5,angle:20,seed:16384}});
    assert.equal((await request('PUT',editedSetup)).statusCode,200);
    assert.deepEqual((await request('GET')).body,editedSetup);
    assert.equal((await request('PUT',{...setup,pipeline:{...setup.pipeline,insetScale:0}})).statusCode,400);
    assert.deepEqual(JSON.parse(await readFile(file,'utf8')),editedSetup);
  } finally {await rm(directory,{recursive:true,force:true});}
});

test('production settings use the embedded setup and isolate device saves by URL',async()=>{
  const data=new Map(),storage={getItem:key=>data.get(key)??null,setItem:(key,value)=>data.set(key,value),removeItem:key=>data.delete(key)};
  const bundledSetup=defaultMeshSetup(),url='https://example.test/2026-10-29/setup.json';
  const options={url,storage,bundledSetup,validate:validateMeshSetup,fetcher:()=>assert.fail('Unexpected setup fetch')};
  assert.deepEqual(await requestStaticSetup(options),bundledSetup);
  const saved=mergeMeshSetup(bundledSetup,{appearance:{wireframeColor:'#00aaff'}});
  await requestStaticSetup({...options,method:'PUT',value:saved});
  assert.deepEqual(await requestStaticSetup(options),saved);
  assert.deepEqual(await requestStaticSetup({...options,url:'https://example.test/another/setup.json'}),bundledSetup);
});

test('loading and saving older setups drops the removed wall settings while preserving the box seed', () => {
  const current = defaultMeshSetup(), old = { ...current, mesh: { enabled: true, width: 14, height: 11, widthSegments: 21, heightSegments: 19 } };
  old.pipeline.seed = 450725;
  delete old.boxes; delete old.visibility.colliders;
  const migrated = validateMeshSetup(old);
  assert.equal('mesh' in migrated, false); assert.equal(migrated.pipeline.seed, 450725);
  assert.equal(migrated.boxes.spread, 2); assert.equal(migrated.visibility.colliders, false);
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(migrated))), migrated);
  assert.equal('mesh' in mergeMeshSetup(migrated, { mesh: old.mesh }), false);
  const edited = mergeMeshSetup(migrated, { boxes: { spread: 1.25 }, visibility: { colliders: true } });
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(edited))), edited);
  for (const spread of [-1, 4.1, NaN, '2']) assert.throws(() => mergeMeshSetup(edited, { boxes: { spread } }), /spread/);
});

test('spotlight settings migrate once and retain independent saved controls',()=>{
  const old=defaultMeshSetup();delete old.lighting.spotlight;
  old.lighting.directional.enabled=true;old.lighting.directional.color='#123456';
  const migrated=validateMeshSetup(old);
  assert.equal(migrated.lighting.spotlight.enabled,true);assert.equal(migrated.lighting.spotlight.color,'#123456');
  assert.equal(migrated.lighting.directional.enabled,false);
  const custom=mergeMeshSetup(migrated,{lighting:{spotlight:{enabled:false,angle:65},directional:{enabled:true}}});
  assert.deepEqual(validateMeshSetup(custom),custom);
  assert.throws(()=>mergeMeshSetup(custom,{lighting:{spotlight:{angle:90}}}));
});

test('the herd loads its bass and drum defaults and the editable bundled setup validates',async()=>{
  const bundled=JSON.parse(await readFile(new URL('../public/setup.json',import.meta.url),'utf8'));
  assert.equal(bundled.sketch,'2026-10-29');assert.equal(typeof bundled.audio.enabled,'boolean');
  const defaults=defaultMeshSetup();assert.equal(defaults.audio.enabled,true);
  assert.equal(defaults.audio.bpm,128);assert.equal(defaults.audio.instruments.kick.sound,'sub');
  assert.ok(defaults.audio.bass>0 && defaults.audio.keys>0 && defaults.audio.melody>0);
  assert.equal(bundled.rig,undefined);
  // Saved rich text is editable and may differ from the reset defaults.
  assert.deepEqual(validateMeshSetup(bundled),bundled);
});


test('rigid gravity migrates separately, persists independently, and drops retired spectrum settings',()=>{
  const old=defaultMeshSetup();delete old.rigidBody;old.fft={preview:true,multiplyNoise:true};
  const migrated=validateMeshSetup(old);assert.equal(migrated.rigidBody.gravity,98);assert.equal('fft' in migrated,false);
  const edited=mergeMeshSetup(migrated,{rigidBody:{gravity:980}});
  assert.equal(edited.rigidBody.gravity,980);assert.equal('softBody' in edited,false);assert.equal('pinNoise' in edited,false);
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(edited))),edited);
  for(const rigidBody of [null,[],{gravity:-1},{gravity:981},{gravity:NaN},{gravity:'98'}])assert.throws(()=>mergeMeshSetup(edited,{rigidBody}));
});


test('rigid friction migrates older saves and roundtrips without changing gravity',()=>{
  const old=defaultMeshSetup();delete old.rigidBody.friction;old.rigidBody.gravity=196;
  const migrated=validateMeshSetup(old);assert.equal(migrated.rigidBody.friction,.55);
  const edited=mergeMeshSetup(migrated,{rigidBody:{friction:2}});
  assert.deepEqual(edited.rigidBody,{gravity:196,friction:2});
  assert.deepEqual(validateMeshSetup(JSON.parse(JSON.stringify(edited))),edited);
  for(const friction of [-1,2.01,NaN,null,'1'])assert.throws(()=>mergeMeshSetup(edited,{rigidBody:{friction}}));
});

test('jump power defaults to one-third, migrates old saves, and preserves its endpoints', () => {
  const setup = defaultMeshSetup();
  assert.equal(setup.herd.jumpPower, 1 / 3);
  const old = structuredClone(setup); delete old.herd;
  assert.equal(validateMeshSetup(old).herd.jumpPower, 1 / 3);
  for (const jumpPower of [0, 1 / 3, 1]) {
    const saved = mergeMeshSetup(setup, { herd: { jumpPower } });
    assert.equal(validateMeshSetup(JSON.parse(JSON.stringify(saved))).herd.jumpPower, jumpPower);
  }
  for (const jumpPower of [-.1, 1.01, NaN, '0.3']) assert.throws(() => mergeMeshSetup(setup, { herd: { jumpPower } }));
});

test('small jump percentage defaults to 20, migrates existing herd settings, and roundtrips its range', () => {
  const setup = defaultMeshSetup();
  assert.equal(setup.herd.smallJumpPercent, 20);
  const old = structuredClone(setup); delete old.herd.smallJumpPercent; old.herd.jumpPower = .762;
  assert.deepEqual(validateMeshSetup(old).herd, { count: 7, jumpPower: .762, smallJumpPercent: 20 });
  for (const smallJumpPercent of [0, 20, 100]) {
    const saved = mergeMeshSetup(setup, { herd: { smallJumpPercent } });
    assert.equal(validateMeshSetup(JSON.parse(JSON.stringify(saved))).herd.smallJumpPercent, smallJumpPercent);
  }
  for (const smallJumpPercent of [-1, 101, NaN, '20']) assert.throws(() => mergeMeshSetup(setup, { herd: { smallJumpPercent } }));
});

test('body count migrates to seven and saves integer counts from one to eleven', () => {
  const setup = defaultMeshSetup(), old = structuredClone(setup); delete old.herd.count;
  assert.equal(setup.herd.count, 7); assert.equal(validateMeshSetup(old).herd.count, 7);
  for (const count of [1, 7, 11]) {
    const saved = mergeMeshSetup(setup, { herd: { count } });
    assert.equal(validateMeshSetup(JSON.parse(JSON.stringify(saved))).herd.count, count);
  }
  for (const count of [0, 12, 2.5, NaN, '7']) assert.throws(() => mergeMeshSetup(setup, { herd: { count } }));
});
