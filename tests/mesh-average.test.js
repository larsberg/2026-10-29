import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { averageVertices, dualDiamond, dualNSided, faceFrame, triangulateFaces } from '../src/mesh-operations.js';
import { createViewportMesh, polygonEdges } from '../src/polygon-mesh.js';
import { createMeshLayers, createSeededRandom } from '../src/mesh-layers.js';

function adjacency(mesh) {
  const counts=new Map(),neighbors=mesh.vertices.map(()=>new Set()),boundary=new Set();
  for(const [a,b] of polygonEdges(mesh.faces)){neighbors[a].add(b);neighbors[b].add(a);}
  for(const face of mesh.faces)face.forEach((a,i)=>{const b=face[(i+1)%face.length],key=a<b?a+':'+b:b+':'+a;counts.set(key,(counts.get(key)??0)+1);});
  for(const [key,count] of counts)if(count===1)for(const id of key.split(':').map(Number))boundary.add(id);
  return {neighbors,boundary};
}

test('averaging uses unique connected neighbors from the original positions and fixes all boundary XYZ coordinates',()=>{
  const mesh=createViewportMesh(6,4,2);
  mesh.vertices[5]=[-.7,.2,1];mesh.vertices[6]=[.8,-.1,2];
  const before=structuredClone(mesh),{neighbors,boundary}=adjacency(mesh),result=averageVertices(mesh,[1,4]);
  mesh.vertices.forEach((position,id)=>{
    const expected=boundary.has(id)?position:[...neighbors[id]].reduce((sum,neighbor)=>sum.add(new Vector3(...mesh.vertices[neighbor])),new Vector3()).divideScalar(neighbors[id].size).toArray();
    assert.deepEqual(result.mesh.vertices[id],expected);
  });
  assert.equal(result.mesh.vertices[5][2],.5);assert.equal(result.mesh.vertices[6][2],.25);
  assert.deepEqual(result.faceIds,[1,4]);assert.deepEqual(result.mesh.faces,mesh.faces);
  assert.equal(result.mesh.vertices.length,mesh.vertices.length);assert.deepEqual(mesh,before);
  const ngon={vertices:[[0,0,1],[3,0,0],[4,1,2],[2,3,1],[0,2,0]],faces:[[0,1,2,3,4]]};
  assert.deepEqual(averageVertices(ngon).mesh,ngon);
  assert.throws(()=>averageVertices(mesh,[100]),/invalid face ID/);
});

test('a closed cube averages its three edge neighbors without introducing face diagonals',()=>{
  const mesh={vertices:[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],faces:[[3,2,1,0],[4,5,6,7],[0,1,5,4],[7,6,2,3],[0,4,7,3],[1,2,6,5]]};
  const result=averageVertices(mesh);
  mesh.vertices.forEach((position,id)=>assert.deepEqual(result.mesh.vertices[id],position.map(value=>value/3)));
  assert.deepEqual(result.mesh.faces,mesh.faces);
  assert.equal(polygonEdges(result.mesh.faces).length,12);
  for(const face of result.mesh.faces){const {normal,center}=faceFrame(result.mesh,face);assert.ok(normal.dot(center)>0);}
});

test('Average vertices runs after the face-center dual and before inset, preserving boundary and cap eligibility',()=>{
  const base=createViewportMesh(10,8,4),seed=7;
  const dual=dualNSided(dualDiamond(triangulateFaces(base,undefined,{random:createSeededRandom(seed)}).mesh).mesh).mesh;
  const onlyAverage={seed,insetEnabled:false,subdivisionEnabled:false,diamondDualEnabled:false,hexelateTriangulateEnabled:false,hexelateEnabled:false,finalAverageVerticesEnabled:false};
  const averaged=createMeshLayers(base,onlyAverage),unchanged=createMeshLayers(base,{...onlyAverage,averageVerticesEnabled:false});
  assert.deepEqual(unchanged.mesh,dual);
  assert.deepEqual(averaged.mesh,averageVertices(dual).mesh);
  assert.deepEqual(averaged.stages.map(stage=>stage.name),['Random triangulate','Dialate · diamond dual · keep boundary','Face-center dual','Average vertices · fixed boundary']);
  assert.notDeepEqual(averaged.mesh.vertices,unchanged.mesh.vertices);
  for(const id of adjacency(dual).boundary)assert.deepEqual(averaged.mesh.vertices[id],dual.vertices[id]);
  const enabled=createMeshLayers(base,{seed}),disabled=createMeshLayers(base,{seed,averageVerticesEnabled:false});
  const names=enabled.stages.map(stage=>stage.name);
  assert.ok(names.indexOf('Face-center dual')<names.indexOf('Average vertices · fixed boundary'));
  assert.ok(names.indexOf('Average vertices · fixed boundary')<names.indexOf('Inset caps'));
  assert.equal(enabled.stages.find(stage=>stage.name==='Inset caps').selected,disabled.stages.find(stage=>stage.name==='Inset caps').selected);
  assert.deepEqual(enabled,createMeshLayers(base,{seed}));
});

test('final averaging runs after Hexelate with fixed boundary, unchanged faces, selection',()=>{
  for(const diamondDualEnabled of [false,true]) {
    const base=createViewportMesh(8,8,4),raw=createMeshLayers(base,{diamondDualEnabled,finalAverageVerticesEnabled:false});
    const result=createMeshLayers(base,{diamondDualEnabled,finalAverageVerticesEnabled:true});
    assert.equal(result.stages.at(-2).name,'Hexelate · face-center dual');
    assert.equal(result.stages.at(-1).name,'Smooth mesh · fixed boundary');
    assert.deepEqual(result.mesh,averageVertices(raw.mesh,raw.faceIds).mesh);
    assert.notDeepEqual(result.mesh.vertices,raw.mesh.vertices);assert.deepEqual(result.mesh.faces,raw.mesh.faces);
    assert.deepEqual(result.faceIds,raw.faceIds);
    for(const id of adjacency(raw.mesh).boundary)assert.deepEqual(result.mesh.vertices[id],raw.mesh.vertices[id]);
  }
});
