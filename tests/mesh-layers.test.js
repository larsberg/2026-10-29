import test from 'node:test';
import assert from 'node:assert/strict';
import { PerspectiveCamera, Scene, Vector3 } from 'three';
import { createViewportMesh, polygonEdges } from '../src/polygon-mesh.js';
import { createMeshLayers as buildMeshLayers, createSeededRandom } from '../src/mesh-layers.js';
import { averageVertices, dualDiamond, dualNSided, faceFrame, triangulateFace, triangulateFaces, validatePolygonMesh } from '../src/mesh-operations.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

const near=(a,b)=>assert.ok(Math.abs(a-b)<1e-9,`${a} != ${b}`);
// Isolate the original stages unless a test explicitly enables Hexelate.
const createMeshLayers=(base,options)=>buildMeshLayers(base,{hexelateTriangulateEnabled:false,hexelateEnabled:false,finalAverageVerticesEnabled:false,...options});
function manifold(mesh) {
  validatePolygonMesh(mesh);
  const edges=new Map();
  for(const face of mesh.faces) {
    assert.equal(triangulateFace(mesh,face).length,face.length-2);
    face.forEach((a,i)=>{const b=face[(i+1)%face.length],key=a<b?`${a}:${b}`:`${b}:${a}`,list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);});
  }
  for(const list of edges.values()) {
    assert.ok(list.length<=2);
    if(list.length===2)assert.deepEqual(list[0],[list[1][1],list[1][0]]);
  }
  assert.equal(mesh.vertices.length-edges.size+mesh.faces.length,1);
}

test('seeded triangulation chooses both quad diagonals independently and reproduces them',()=>{
  const base=createViewportMesh(12,12,6);
  const first=triangulateFaces(base,undefined,{random:createSeededRandom(42)}).mesh;
  const second=triangulateFaces(base,undefined,{random:createSeededRandom(42)}).mesh;
  assert.deepEqual(first,second);assert.equal(first.faces.length,base.faces.length*2);
  const directions=new Set();
  for(let i=0;i<base.faces.length;i++) {
    const [a,b,c,d]=base.faces[i],edges=polygonEdges(first.faces.slice(i*2,i*2+2));
    const has=(x,y)=>edges.some(([u,v])=>u===x&&v===y||u===y&&v===x);
    directions.add(has(a,c)?0:1);assert.notEqual(has(a,c),has(b,d));
  }
  assert.equal(directions.size,2);
  assert.notDeepEqual(triangulateFaces(base,undefined,{random:createSeededRandom(43)}).mesh.faces,first.faces);
  manifold(first);assert.throws(()=>createSeededRandom(-1),/unsigned/);
  assert.throws(()=>triangulateFaces(base,undefined,{random:()=>1}),/Random samples/);
});

test('random triangulation remains valid on a concave polygon for every starting corner',()=>{
  const mesh={vertices:[[0,0,0],[3,0,0],[3,1,0],[1,1,0],[1,3,0],[0,3,0]],faces:[[0,1,2,3,4,5]]};
  for(let i=0;i<6;i++) {
    const result=triangulateFaces(mesh,undefined,{random:()=>i/6}).mesh;
    let area=0;
    for(const face of result.faces){const [a,b,c]=face.map(id=>new Vector3(...result.vertices[id]));const cross=b.sub(a).cross(c.sub(a));assert.ok(cross.z>0);area+=cross.z/2;}
    near(area,5);manifold(result);
  }
});

test('layer order insets every dual face to 0.5 and retains its inner face before smoothing',()=>{
  const base=createViewportMesh(10,8,4),before=structuredClone(base),seed=7;
  const dual=dualNSided(triangulateFaces(base,undefined,{random:createSeededRandom(seed)}).mesh).mesh;
  const result=createMeshLayers(base,{seed,subdivisionEnabled:false,initialDiamondDualEnabled:false,diamondDualEnabled:false,averageVerticesEnabled:false});
  assert.deepEqual(result.stages.map(s=>s.name),['Random triangulate','Face-center dual','Inset caps']);
  assert.equal(result.stages[0].faces,base.faces.length*2);
  assert.equal(result.stages[1].faces,base.vertices.length);
  assert.equal(result.faceIds.length,dual.faces.length);
  assert.equal(result.stages[2].selected,dual.faces.length);
  const sideFaces=dual.faces.reduce((sum,f)=>sum+f.length,0);
  assert.equal(result.mesh.faces.length,dual.faces.length+sideFaces);
  assert.equal(new Set(result.faceIds).size,dual.faces.length);
  for(let i=0;i<dual.faces.length;i++) {
    const original=dual.faces[i],frame=faceFrame(dual,original),cap=result.mesh.faces[result.faceIds[i]];
    assert.equal(cap.length,original.length);
    for(let corner=0;corner<cap.length;corner++){
      const expected=new Vector3(...dual.vertices[original[corner]]).sub(frame.center).multiplyScalar(.5).add(frame.center);
      assert.ok(expected.distanceTo(new Vector3(...result.mesh.vertices[cap[corner]]))<1e-9);
    }
  }
  assert.ok(result.mesh.vertices.every(v=>v[2]===0));
  assert.deepEqual(result,createMeshLayers(base,{seed,subdivisionEnabled:false,initialDiamondDualEnabled:false,diamondDualEnabled:false,averageVerticesEnabled:false}));
  assert.deepEqual(base,before);manifold(result.mesh);
});

test('layering retains valid boundaries on square, portrait, and landscape grids across seeds',()=>{
  for(const [width,height] of [[8,8],[5,12],[12,5]])for(const seed of [0,1,19,1000000]) {
    const result=createMeshLayers(createViewportMesh(width,height,4),{seed});
    manifold(result.mesh);assert.ok(result.mesh.vertices.every(v=>v[2]===0));
  }
});

test('resize rebuilds the wall operation layers and clears manual edit history',()=>{
  const view=createMeshView(new Scene()),camera=new PerspectiveCamera(42,1,.1,1000),settings=defaultMeshSetup();
  Object.assign(settings.pipeline,{initialDiamondDualEnabled:true,hexelateEnabled:true,finalAverageVerticesEnabled:true});
  camera.position.set(0,0,7);camera.lookAt(0,0,0);camera.updateMatrixWorld();
  view.setMesh(createViewportMesh(8,8,4),settings);const original=structuredClone(view.topology);
  assert.equal(view.layers.stages.length,4);
  assert.ok(original.faces.some(face=>face.length===6));
  assert.equal(view.layers.stages.at(-1).name,'Smooth mesh · fixed boundary');
  view.triangulate();assert.equal(view.canUndo,true);
  view.regenerate(camera,settings);assert.equal(view.canUndo,false);assert.deepEqual(view.topology,original);
  camera.aspect=.6;camera.updateProjectionMatrix();view.regenerate(camera,settings);
  assert.deepEqual(view.topology,original);
  assert.ok(view.topology.vertices.flat().every(Number.isFinite));
  view.dispose();
});

test('layer controls roundtrip, validate retained controls, and migrate old saves',()=>{
  const defaults=defaultMeshSetup(),old=structuredClone(defaults);delete old.pipeline;
  assert.deepEqual(validateMeshSetup(old).pipeline,defaults.pipeline);
  const previous=structuredClone(defaults);delete previous.pipeline.subdivisionEnabled;delete previous.pipeline.subdivisionIterations;delete previous.pipeline.diamondDualEnabled;delete previous.pipeline.initialDiamondDualEnabled;
  for(const key of ['triangulateEnabled','faceCenterDualEnabled','insetEnabled'])delete previous.pipeline[key];
  delete previous.pipeline.excludeInitialBorderTriangles;
  delete previous.pipeline.averageVerticesEnabled;delete previous.pipeline.hexelateEnabled;delete previous.pipeline.hexelateTriangulateEnabled;delete previous.pipeline.finalAverageVerticesEnabled;
  assert.deepEqual(validateMeshSetup(previous).pipeline,defaults.pipeline);
  assert.equal(defaults.pipeline.diamondDualEnabled,false);
  assert.equal(defaults.pipeline.initialDiamondDualEnabled,false);
  assert.equal(defaults.pipeline.excludeInitialBorderTriangles,true);
  assert.equal(defaults.pipeline.averageVerticesEnabled,false);
  assert.equal(defaults.pipeline.triangulateEnabled,true);
  assert.equal(defaults.pipeline.hexelateTriangulateEnabled,true);assert.equal(defaults.pipeline.hexelateEnabled,false);
  assert.equal(defaults.pipeline.insetScale,.5);assert.equal(defaults.pipeline.subdivisionEnabled,false);assert.equal(defaults.pipeline.subdivisionIterations,1);
  const saved=mergeMeshSetup(defaults,{pipeline:{seed:123,insetScale:.75}});
  assert.deepEqual(validateMeshSetup(saved),saved);
  assert.equal(mergeMeshSetup(defaults,{pipeline:{finalAverageVerticesEnabled:false}}).pipeline.finalAverageVerticesEnabled,false);
  assert.throws(()=>mergeMeshSetup(defaults,{pipeline:{finalAverageVerticesEnabled:'false'}}),/Smooth mesh/);
  assert.throws(()=>mergeMeshSetup(defaults,{pipeline:{subdivisionIterations:1.5}}),/Subdivision passes/);
  assert.throws(()=>createMeshLayers(createViewportMesh(4,4,2),{insetScale:1}),/Inset scale/);
});

test('diamond dual is applied to the smoothed surface as the final layer',()=>{
  const base=createViewportMesh(10,8,4),before=structuredClone(base);
  const smooth=createMeshLayers(base,{diamondDualEnabled:false}),result=createMeshLayers(base);
  assert.deepEqual(result.mesh,dualDiamond(smooth.mesh).mesh);
  assert.deepEqual(result.stages.slice(0,-1),smooth.stages);
  assert.equal(result.stages.at(-1).name,'Diamond dual');
  assert.equal(result.mesh.faces.length,polygonEdges(smooth.mesh.faces).length);
  assert.ok(result.mesh.faces.some(face=>face.length===4));
  assert.ok(result.mesh.faces.some(face=>face.length===3));
  assert.deepEqual(result.faceIds,[]);
  for(const position of smooth.mesh.vertices)assert.ok(result.mesh.vertices.some(v=>v.every((value,axis)=>value===position[axis])));
  assert.deepEqual(base,before);manifold(result.mesh);
  assert.deepEqual(result,createMeshLayers(base));
});

test('Hexelate applies the face-center dual last',()=>{
  const base=createViewportMesh(8,8,4),previous=createMeshLayers(base),result=createMeshLayers(base,{hexelateEnabled:true});
  assert.deepEqual(result.mesh,dualNSided(previous.mesh).mesh);
  assert.deepEqual(result.stages.slice(0,-1),previous.stages);
  assert.equal(result.stages.at(-1).name,'Hexelate · face-center dual');assert.equal(result.stages.length,8);
  assert.ok(result.mesh.faces.some(face=>face.length>=5));assert.deepEqual(result.faceIds,[]);
  manifold(result.mesh);rectangularBoundary(result.mesh,8,8);
});

test('Hexelate internally triangulates the preceding diamonds before creating polygon cells',()=>{
  for(const diamondDualEnabled of [false,true])for(const [width,height] of [[8,8],[5,12],[12,5]]) {
    const base=createViewportMesh(width,height,4),before=structuredClone(base);
    const options={diamondDualEnabled,hexelateTriangulateEnabled:true};
    const previous=createMeshLayers(base,options),result=createMeshLayers(base,{...options,hexelateEnabled:true});
    const triangles=triangulateFaces(previous.mesh,undefined,{shortestDiagonal:true}).mesh;
    assert.deepEqual(result.mesh,dualNSided(triangles).mesh);
    assert.deepEqual(result.stages.slice(0,-1),previous.stages);
    const cells=result.mesh.faces.filter(face=>face.length>=5&&face.length<=7);
    assert.ok(cells.length/result.mesh.faces.length>.7,'most cells should have five to seven sides');
    assert.ok(result.mesh.faces.filter(f=>f.length===6).length>result.mesh.faces.filter(f=>f.length===4).length);
    assert.deepEqual(result.faceIds,[]);
    manifold(result.mesh);rectangularBoundary(result.mesh,width,height);assert.deepEqual(base,before);
    assert.deepEqual(result,createMeshLayers(base,{...options,hexelateEnabled:true}));
  }
});

test('Dialate runs after random triangulation and preserves the original wall corners',()=>{
  for(const [width,height] of [[8,8],[5,12],[12,5]]) {
    const base=createViewportMesh(width,height,4),before=structuredClone(base);
    const triangles=triangulateFaces(base,undefined,{random:createSeededRandom(1)}).mesh;
    const initial=dualDiamond(triangles).mesh;
    const quads=initial.faces.filter(face=>face.length===4).length,border=initial.faces.filter(face=>face.length===3).length;
    assert.equal(quads,polygonEdges(triangles.faces).length-2*(base.columns+base.rows));
    assert.equal(border,2*(base.columns+base.rows));
    const corners=base.vertices.filter(v=>Math.abs(v[0])===width/2&&Math.abs(v[1])===height/2);
    for(const corner of corners)assert.ok(initial.vertices.some(v=>v.every((value,axis)=>value===corner[axis])));
    manifold(initial);
    const options={excludeInitialBorderTriangles:false};
    const result=createMeshLayers(base,options),expected=createMeshLayers(initial,{...options,triangulateEnabled:false,initialDiamondDualEnabled:false});
    assert.deepEqual(result.stages.slice(0,2).map(stage=>stage.name),['Random triangulate','Dialate · diamond dual · keep boundary']);
    assert.equal(result.stages[1].faces,initial.faces.length);
    assert.deepEqual(result.mesh,expected.mesh);assert.deepEqual(result.stages.slice(2),expected.stages);
    assert.equal(result.stages.at(-1).name,'Diamond dual');
    assert.deepEqual(base,before);
  }
});

const passKeys=['initialDiamondDualEnabled','triangulateEnabled','faceCenterDualEnabled','averageVerticesEnabled','insetEnabled','subdivisionEnabled','diamondDualEnabled','hexelateTriangulateEnabled','hexelateEnabled'];
function rectangularBoundary(mesh,width,height) {
  const edges=new Map();
  for(const face of mesh.faces)face.forEach((a,i)=>{const b=face[(i+1)%face.length],key=a<b?`${a}:${b}`:`${b}:${a}`,list=edges.get(key)??[];list.push([a,b]);edges.set(key,list);});
  let length=0;
  for(const list of edges.values())if(list.length===1) {
    const [a,b]=list[0].map(id=>new Vector3(...mesh.vertices[id]));
    near(a.z,0);near(b.z,0);
    assert.ok([[-width/2,0],[width/2,0],[-height/2,1],[height/2,1]].some(([value,axis])=>Math.abs(a.getComponent(axis)-value)<1e-9&&Math.abs(b.getComponent(axis)-value)<1e-9));
    length+=a.distanceTo(b);
  }
  near(length,2*(width+height));
}

test('every pass toggles independently, retaining the boundary or rejecting folded cells',()=>{
  const base=createViewportMesh(4,4,2);
  for(let mask=0;mask<2**passKeys.length;mask++) {
    const options=Object.fromEntries(passKeys.map((key,i)=>[key,!!(mask&(1<<i))]));
    let result;
    try { result=createMeshLayers(base,{seed:7,...options}); }
    catch(error) {
      assert.match(error.message,/(Hexelate|Diamond dual) produced a folded polygon/);
      assert.ok(options.hexelateEnabled||options.diamondDualEnabled);
      continue;
    }
    assert.equal(result.stages.length,passKeys.filter(key=>options[key]&&key!=='hexelateTriangulateEnabled').length,JSON.stringify(options));
    manifold(result.mesh);rectangularBoundary(result.mesh,4,4);
    if(mask===0)assert.deepEqual(result.mesh,base);
  }
  assert.deepEqual(createMeshLayers(base,{enabled:false}).mesh,base);
  for(const [w,h] of [[8,8],[5,12],[12,5]])rectangularBoundary(createMeshLayers(createViewportMesh(w,h,4)).mesh,w,h);
});

test('pass toggle settings roundtrip and reject malformed toggle values',()=>{
  const value=mergeMeshSetup(defaultMeshSetup(),{pipeline:Object.fromEntries(passKeys.map(key=>[key,false]))});
  assert.deepEqual(validateMeshSetup(value),value);
  for(const key of passKeys)assert.throws(()=>mergeMeshSetup(value,{pipeline:{[key]:'false'}}),/Invalid/);
  assert.throws(()=>mergeMeshSetup(value,{pipeline:{excludeInitialBorderTriangles:'true'}}),/Invalid/);
});

test('original diamond border triangles and their dual cells are kept out of inset',()=>{
  const base=createViewportMesh(8,8,4);
  const polygonPositions=(mesh,face)=>face.map(id=>mesh.vertices[id]);
  for(const triangulateEnabled of [false,true])for(const faceCenterDualEnabled of [false,true])for(const insetEnabled of [false,true]) {
    const input=triangulateEnabled?triangulateFaces(base,undefined,{random:createSeededRandom(7)}).mesh:base;
    const source=dualDiamond(input).mesh;
    const originalTriangles=source.faces.filter(face=>face.length===3);
    const borderVertices=new Set(originalTriangles.flat());
    const triangleKeys=new Set(originalTriangles.map(face=>[...face].sort((a,b)=>a-b).join(':')));
    const working=averageVertices(faceCenterDualEnabled?dualNSided(source).mesh:source).mesh;
    // A dual cell belongs to its original vertex. Any vertex in a border
    // triangle produces a cell sharing that triangle, even if the cell is an n-gon.
    const protectedIds=faceCenterDualEnabled?[...borderVertices]:working.faces.flatMap((face,id)=>triangleKeys.has([...face].sort((a,b)=>a-b).join(':'))?[id]:[]);
    const options={seed:7,triangulateEnabled,faceCenterDualEnabled,insetEnabled,subdivisionEnabled:false,diamondDualEnabled:false};
    const result=createMeshLayers(base,options);
    assert.equal(result.faceIds.length,working.faces.length-protectedIds.length);
    assert.ok(result.faceIds.length>0);
    for(const id of protectedIds) {
      const positions=JSON.stringify(polygonPositions(working,working.faces[id]));
      assert.ok(result.mesh.faces.some(face=>JSON.stringify(polygonPositions(result.mesh,face))===positions));
    }
    assert.ok(result.mesh.vertices.every(v=>v[2]===0));
    const included=createMeshLayers(base,{...options,excludeInitialBorderTriangles:false});
    assert.equal(included.faceIds.length,working.faces.length);
    assert.ok(included.faceIds.length>=result.faceIds.length);
    manifold(result.mesh);rectangularBoundary(result.mesh,8,8);
  }
  assert.deepEqual(createMeshLayers(base,{initialDiamondDualEnabled:false}),createMeshLayers(base,{initialDiamondDualEnabled:false,excludeInitialBorderTriangles:false}));
});

test('triangulation and face-center dual report source faces for reliable border ancestry',()=>{
  const base=createViewportMesh(4,4,2),tri=triangulateFaces(base,[0]);
  assert.deepEqual(tri.faceSources,[[0],[0],[1],[2],[3]]);
  const result=dualNSided(tri.mesh);
  result.faceSources.forEach((sources,vertex)=>{
    const incident=tri.mesh.faces.flatMap((face,id)=>face.includes(vertex)?[id]:[]);
    assert.deepEqual([...sources].sort((a,b)=>a-b),incident);
  });
});
