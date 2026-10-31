import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createViewportMesh, polygonEdges } from '../src/polygon-mesh.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';
import { pure } from '@strudel/core';
import { createMarchAudio } from '../src/march-audio.js';

for (const [width, height, columns, rows] of [[10,10,4,4],[16,9,7,4],[9,16,4,7],[20,5,16,4]]) {
  test(`${width} × ${height} grid spans the view with shared quad vertices`, () => {
    const mesh = createViewportMesh(width,height);
    assert.equal(mesh.columns, columns); assert.equal(mesh.rows, rows);
    assert.equal(mesh.vertices.length,(columns+1)*(rows+1));
    assert.equal(mesh.faces.length,columns*rows);
    assert.deepEqual(mesh.vertices[0],[-width/2,-height/2,0]);
    assert.deepEqual(mesh.vertices.at(-1),[width/2,height/2,0]);
    assert.equal(polygonEdges(mesh.faces).length, columns*(rows+1)+rows*(columns+1));
    for (const face of mesh.faces) {
      assert.equal(new Set(face).size,4);
      const [a,b,c] = face.map(id => new Vector3(...mesh.vertices[id]));
      assert.ok(b.sub(a).cross(c.sub(a)).z > 0);
    }
    const ratio=(width/columns)/(height/rows);
    assert.ok(ratio >= 0.875 && ratio <= 1.125);
  });
}

test('n-sided boundaries close and shared edges draw only once, without triangulation', () => {
  const faces=[[0,1,2,3,4],[4,3,5]];
  const edges=polygonEdges(faces);
  assert.equal(edges.length,7);
  assert.ok(edges.some(([a,b]) => a===4 && b===0));
  assert.ok(!edges.some(([a,b]) => a===0 && b===2));
});

test('the editor stays empty through configuration and repeated regeneration', () => {
  const scene=new Scene(),view=createMeshView(scene),settings=defaultMeshSetup();
  view.configure(settings);
  for (let i=0;i<3;i++) view.regenerate(undefined,settings);
  assert.equal(view.topology,undefined);assert.equal(view.surface,undefined);
  assert.equal(view.generation,0);assert.deepEqual(view.edges,[]);
  assert.deepEqual(view.getCenter(new Vector3()).toArray(),[0,0,0]);
  assert.equal(view.undo(),false);
  assert.throws(()=>view.triangulate(),/No surface/);
  view.dispose();assert.equal(scene.children.length,0);
});

test('supplied topology regenerates in either viewport orientation and disposes old buffers', () => {
  const camera=new PerspectiveCamera(42,1,0.1,1000),scene=new Scene(),view=createMeshView(scene);
  const settings=defaultMeshSetup();settings.pipeline.enabled=false;
  const base=createViewportMesh(4,4,2);view.configure(settings);view.setMesh(base,settings);
  let disposed=0;
  for (const aspect of [16/9,9/16,1]) {
    const previous=view.object.geometry;
    previous.addEventListener('dispose',()=>disposed++);
    camera.aspect=aspect;camera.updateProjectionMatrix();view.regenerate(camera,settings);
    assert.notEqual(previous,view.object.geometry);assert.deepEqual(view.topology,base);
  }
  assert.equal(disposed,3);assert.equal(view.generation,4);
  view.dispose();assert.equal(scene.children.length,0);
});

test('empty Strudel score never creates audio, even when enabled', async () => {
  let contexts=0;
  const audio=createMarchAudio({createContext:()=>{contexts++;throw new Error('Unexpected audio context');}});
  audio.configure({...defaultMeshSetup().audio,enabled:true});
  audio.play(); await audio.retry();audio.restart();
  assert.equal(contexts,0); assert.equal(audio.playing,false);assert.equal(audio.diagnostics.scheduledEvents,0);
  audio.dispose();
});

test('a supplied Strudel pattern stays silent while paused or explicitly muted', async () => {
  let contexts=0;
  const audio=createMarchAudio({pattern:pure({layer:'bass',note:48,gain:.5}),createContext:()=>{contexts++;throw new Error('Unexpected audio context');}});
  audio.configure({...defaultMeshSetup().audio,enabled:true});await audio.retry();assert.equal(contexts,0);
  audio.configure({...defaultMeshSetup().audio,enabled:false});audio.play();await audio.retry();audio.restart();
  assert.equal(contexts,0);assert.equal(audio.playing,false);assert.equal(audio.diagnostics.scheduledEvents,0);
  audio.dispose();
});
