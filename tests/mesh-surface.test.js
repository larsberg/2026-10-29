import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene } from 'three';
import { createFaceMetal } from '../src/face-metal.js';
import { createMeshSurface } from '../src/mesh-surface.js';
import { createMeshView } from '../src/mesh-view.js';
import { defaultMaterials, validateMaterials } from '../src/setup.js';
import { defaultMeshSetup, mergeMeshSetup, validateMeshSetup } from '../src/mesh-settings.js';

test('Blobby finish preserves its saved metalness, roughness, normal mix, and physical clearcoat',()=>{
  const values=defaultMaterials().mesh,material=createFaceMetal();
  assert.equal(material.isMeshPhysicalMaterial,true);assert.equal(material.clearcoat,.45);assert.equal(material.clearcoatRoughness,.16);
  assert.deepEqual(values,{metalness:.88,roughness:.37,emissiveIntensity:0,envMapIntensity:1,opacity:1,color:'#ffffff',emissive:'#ffffff',wireframe:false,flatShading:true,normalMix:.47});
  const old=defaultMaterials();delete old.mesh;assert.deepEqual(validateMaterials(old).mesh,values);
  const setup=defaultMeshSetup();delete setup.materials.mesh;delete setup.visibility.surface;
  assert.equal(validateMeshSetup(setup).visibility.surface,true);assert.deepEqual(validateMeshSetup(setup).materials.mesh,values);
  assert.throws(()=>mergeMeshSetup(defaultMeshSetup(),{materials:{mesh:{normalMix:2}}}),/normalMix/);
  material.dispose();
});

test('polygon surface keeps one normal range per n-gon and updates live corner data and smooth normals',()=>{
  const mesh={vertices:[[0,0,0],[2,0,0],[3,1,0],[1.5,2,0],[0,1,0],[0,0,2],[2,0,2]],faces:[[0,1,2,3,4],[1,0,5,6]]};
  const material=createFaceMetal();material.userData.normalMix=.47;const surface=createMeshSurface(mesh,material);
  try {
    const geometry=surface.mesh.geometry,range=geometry.attributes.polygonRange;
    assert.equal(geometry.attributes.position.count,9);assert.equal(geometry.index.count,15);
    for(let i=0;i<5;i++){assert.equal(range.getX(i),0);assert.equal(range.getY(i),5);}
    for(let i=5;i<9;i++){assert.equal(range.getX(i),5);assert.equal(range.getY(i),4);}
    const positions=new Float32Array(mesh.vertices.flat());positions[2*3+2]=.4;surface.update(positions);
    mesh.faces.flat().forEach((id,corner)=>{for(let axis=0;axis<3;axis++)assert.equal(geometry.attributes.position.array[corner*3+axis],positions[id*3+axis]);});
    assert.ok(geometry.attributes.normal.array.every(Number.isFinite));
    material.userData.normalMix=.8;surface.configure();assert.equal(surface.normalMix,.8);
    const shader={uniforms:{},vertexShader:'#include <defaultnormal_vertex>',fragmentShader:'#include <normal_fragment_begin>'};
    material.onBeforeCompile(shader,{});
    assert.equal(shader.uniforms.normalMix.value,.8);assert.match(shader.vertexShader,/polygonNormal/);assert.match(shader.fragmentShader,/mix\(flatNormal/);
    const pixels=shader.uniforms.dualCorners.value.image.data;
    mesh.faces.flat().forEach((id,corner)=>{for(let axis=0;axis<3;axis++)assert.equal(pixels[corner*4+axis],positions[id*3+axis]);});
    assert.equal(surface.mesh.castShadow,true);assert.equal(surface.mesh.receiveShadow,true);
  }finally{surface.dispose();material.dispose();}
});

test('shaded surface and wireframe visibility remain independent',()=>{
  const view=createMeshView(new Scene()),settings=mergeMeshSetup(defaultMeshSetup(),{pipeline:{enabled:false},visibility:{wireframe:false}});
  try {
    view.configure(settings);view.setMesh({vertices:[[-2,-2,0],[2,-2,0],[2,2,0],[-2,2,0]],faces:[[0,1,2,3]]},settings);
    assert.equal(view.surface.mesh.visible,true);assert.equal(view.object.material.visible,false);
    view.configure(mergeMeshSetup(settings,{visibility:{surface:false,wireframe:true}}));assert.equal(view.surface.mesh.visible,false);assert.equal(view.object.material.visible,true);
    view.configure(mergeMeshSetup(settings,{visibility:{surface:false,wireframe:false}}));assert.equal(view.object.visible,false);
  }finally{view.dispose();}
});
