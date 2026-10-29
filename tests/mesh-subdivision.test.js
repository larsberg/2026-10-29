import test from 'node:test';
import assert from 'node:assert/strict';
import { Vector3 } from 'three';
import { createViewportMesh } from '../src/polygon-mesh.js';
import { faceFrame, insetFaces, subdivideSmooth, triangulateFace, validatePolygonMesh } from '../src/mesh-operations.js';
import { createMeshLayers } from '../src/mesh-layers.js';

function boundaryEdges(mesh) {
  const edges=new Map();
  for(const face of mesh.faces)face.forEach((a,i)=>{const b=face[(i+1)%face.length],key=a<b? a+':'+b:b+':'+a;
    const list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);});
  for(const list of edges.values()) {
    assert.ok(list.length<=2);
    if(list.length===2)assert.deepEqual(list[0],[...list[1]].reverse());
  }
  return [...edges.values()].filter(list=>list.length===1).map(list=>list[0]);
}
const near=(a,b)=>assert.ok(new Vector3(...a).distanceTo(new Vector3(...b))<1e-10,JSON.stringify([a,b]));

test('concave face insets stay inside the source and subdivide without folded quads',()=>{
  const mesh={vertices:[[0,0,0],[3,0,0],[3,1,0],[1,1,0],[1,3,0],[0,3,0]],faces:[[0,1,2,3,4,5]]},before=structuredClone(mesh);
  const inset=insetFaces(mesh,[0],.5);
  for(const id of inset.mesh.faces[inset.faceIds[0]]) {
    const [x,y]=inset.mesh.vertices[id];assert.ok(x<=1||y<=1);
  }
  for(const face of inset.mesh.faces)assert.ok(faceFrame(inset.mesh,face).normal.z>0);
  const smooth=subdivideSmooth(inset.mesh,inset.faceIds);
  for(const face of smooth.mesh.faces) {
    assert.equal(triangulateFace(smooth.mesh,face).length,2);
    assert.ok(faceFrame(smooth.mesh,face).normal.z>0);
  }
  for(const id of new Set(boundaryEdges(inset.mesh).flat()))assert.deepEqual(smooth.mesh.vertices[id],inset.mesh.vertices[id]);
  assert.deepEqual(mesh,before);
});

test('Catmull–Clark smooths the interior while boundary vertices and split edges remain exact',()=>{
  const mesh=createViewportMesh(4,4,2);mesh.vertices[4][2]=4;
  const before=structuredClone(mesh),edges=boundaryEdges(mesh),result=subdivideSmooth(mesh,[0]);
  assert.equal(result.mesh.faces.length,16);assert.equal(result.faceIds.length,4);
  near(result.mesh.vertices[4],[0,0,2.25]);
  for(const id of new Set(edges.flat()))assert.deepEqual(result.mesh.vertices[id],mesh.vertices[id]);
  const refined=boundaryEdges(result.mesh);
  assert.equal(refined.length,edges.length*2);
  for(const [a,b] of edges) {
    const mid=mesh.vertices[a].map((value,axis)=>(value+mesh.vertices[b][axis])/2);
    const id=result.mesh.vertices.findIndex(position=>position.every((value,axis)=>value===mid[axis]));
    assert.ok(refined.some(edge=>edge.includes(a)&&edge.includes(id)));
    assert.ok(refined.some(edge=>edge.includes(b)&&edge.includes(id)));
  }
  assert.deepEqual(mesh,before);validatePolygonMesh(result.mesh);
});

test('closed cube uses the Catmull–Clark weights and retains outward quad winding',()=>{
  const mesh={vertices:[[-1,-1,-1],[1,-1,-1],[1,1,-1],[-1,1,-1],[-1,-1,1],[1,-1,1],[1,1,1],[-1,1,1]],faces:[[3,2,1,0],[4,5,6,7],[0,1,5,4],[7,6,2,3],[0,4,7,3],[1,2,6,5]]};
  const result=subdivideSmooth(mesh,[0]).mesh;
  assert.equal(result.vertices.length,26);assert.equal(result.faces.length,24);
  near(result.vertices[0],[-5/9,-5/9,-5/9]);
  assert.ok(result.vertices.some(position=>position.every((value,axis)=>Math.abs(value-[0,-.75,-.75][axis])<1e-10)));
  assert.equal(boundaryEdges(result).length,0);
  for(const face of result.faces) {
    assert.equal(face.length,4);assert.equal(triangulateFace(result,face).length,2);
    const [a,b,c]=face.map(id=>new Vector3(...result.vertices[id]));
    assert.ok(b.clone().sub(a).cross(c.clone().sub(a)).dot(a)>0);
  }
});

test('n-sided faces become quads and cap selection propagates through multiple passes',()=>{
  const mesh={vertices:Array.from({length:7},(_,i)=>[Math.cos(i*Math.PI*2/7),Math.sin(i*Math.PI*2/7),0]),faces:[[0,1,2,3,4,5,6]]};
  const result=subdivideSmooth(mesh,[0],{iterations:2});
  assert.equal(result.mesh.faces.length,28);assert.equal(result.faceIds.length,28);
  assert.ok(result.mesh.faces.every(face=>face.length===4));
  assert.ok(result.sourceFaces.every(id=>id===0));assert.equal(boundaryEdges(result.mesh).length,28);
  for(let id=0;id<7;id++)assert.deepEqual(result.mesh.vertices[id],mesh.vertices[id]);
  assert.deepEqual(subdivideSmooth(mesh,[]).faceIds,[]);
  assert.throws(()=>subdivideSmooth(mesh,[1]),/invalid face ID/);
  assert.throws(()=>subdivideSmooth(mesh,undefined,{iterations:0}),/Subdivision passes/);
  const bad=createViewportMesh(4,4,2);bad.faces[0].reverse();
  assert.throws(()=>subdivideSmooth(bad),/consistently wound/);
});

test('final smoothing layer preserves the complete mesh outline and only selects refined cap descendants',()=>{
  const base=createViewportMesh(10,8,4),raw=createMeshLayers(base,{subdivisionEnabled:false,diamondDualEnabled:false,hexelateTriangulateEnabled:false,hexelateEnabled:false,finalAverageVerticesEnabled:false}),smooth=createMeshLayers(base,{diamondDualEnabled:false,hexelateTriangulateEnabled:false,hexelateEnabled:false,finalAverageVerticesEnabled:false});
  assert.equal(smooth.stages.at(-1).name,'Subdivide & smooth · fixed boundary');
  assert.equal(smooth.mesh.faces.length,raw.mesh.faces.reduce((sum,face)=>sum+face.length,0));
  const expected=subdivideSmooth(raw.mesh,raw.faceIds);
  assert.deepEqual(smooth.mesh,expected.mesh);assert.deepEqual(smooth.faceIds,expected.faceIds);
  for(const id of new Set(boundaryEdges(raw.mesh).flat()))assert.deepEqual(smooth.mesh.vertices[id],raw.mesh.vertices[id]);
  assert.equal(boundaryEdges(smooth.mesh).length,boundaryEdges(raw.mesh).length*2);
  assert.throws(()=>createMeshLayers(createViewportMesh(8,8,6),{subdivisionIterations:3}),/50,000-face/);
});
