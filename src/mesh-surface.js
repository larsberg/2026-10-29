import { BufferAttribute, BufferGeometry, DataTexture, DoubleSide, DynamicDrawUsage, FloatType, Mesh, MeshNormalMaterial, RGBAFormat, SkinnedMesh } from 'three';
import { triangulateFace } from './mesh-operations.js';
import { bindPolygonNormals } from './polygon-normals.js';

// The same polygon-flat/smooth-normal blend used by 2026-10-08-blobby,
// applied to the editable polygon surface.
export function createMeshSurface(topology, material, { skinned = false } = {}) {
  const corners = [], ranges = [], indices = [], sharedIndices = [];
  for (const face of topology.faces) {
    const start = corners.length, local = new Map(face.map((id, i) => [id, start + i]));
    corners.push(...face);
    face.forEach(() => ranges.push(start, face.length));
    for (const triangle of triangulateFace(topology, face)) { indices.push(...triangle.map(id => local.get(id))); sharedIndices.push(...triangle); }
  }
  const geometry = new BufferGeometry(), smooth = new BufferGeometry();
  const position = new BufferAttribute(new Float32Array(corners.length * 3), 3).setUsage(DynamicDrawUsage);
  const normal = new BufferAttribute(new Float32Array(corners.length * 3), 3).setUsage(DynamicDrawUsage);
  geometry.setAttribute('position', position); geometry.setAttribute('normal', normal);
  geometry.setAttribute('polygonRange', new BufferAttribute(new Float32Array(ranges), 2)); geometry.setIndex(indices);
  smooth.setAttribute('position', new BufferAttribute(new Float32Array(topology.vertices.flat()), 3)); smooth.setIndex(sharedIndices);
  const width = Math.max(1, Math.ceil(Math.sqrt(corners.length))), height = Math.max(1, Math.ceil(corners.length / width));
  const pixels = new Float32Array(width * height * 4), texture = new DataTexture(pixels, width, height, RGBAFormat, FloatType);
  const normals = bindPolygonNormals(material, texture);
  const mesh = skinned ? new SkinnedMesh(geometry, material) : new Mesh(geometry, material); mesh.name = 'Blobby material · polygon surface';
  mesh.castShadow = mesh.receiveShadow = true; mesh.frustumCulled = false; mesh.layers.enable(1);
  const aoMaterial = new MeshNormalMaterial({ side: DoubleSide, flatShading: material.flatShading }); aoMaterial.allowOverride = false;
  const aoNormals = bindPolygonNormals(aoMaterial, texture, normals.normalMix); mesh.userData.aoNormalMaterial = aoMaterial;
  function configure() { normals.normalMix.value = material.userData.normalMix ?? 0.47; }
  function update(positions) {
    smooth.attributes.position.array.set(positions); smooth.computeVertexNormals();
    const smoothNormals = smooth.attributes.normal.array;
    corners.forEach((id, corner) => {
      for (let axis = 0; axis < 3; axis++) {
        position.array[corner * 3 + axis] = pixels[corner * 4 + axis] = positions[id * 3 + axis];
        normal.array[corner * 3 + axis] = smoothNormals[id * 3 + axis];
      }
    });
    texture.needsUpdate = position.needsUpdate = normal.needsUpdate = true;
  }
  configure(); update(smooth.attributes.position.array);
  function updateDeformed(positions) {
    // GPU skinning handles surface positions and smooth normals. The polygon
    // normal shader needs the same deformed ring, without skinning it twice.
    corners.forEach((id, corner) => {
      for (let axis = 0; axis < 3; axis++) pixels[corner * 4 + axis] = positions[id * 3 + axis];
    });
    texture.needsUpdate = true;
    mesh.boundingBox = mesh.boundingSphere = null;
  }
  return { mesh, corners, configure, update, updateDeformed, get normalMix() { return normals.normalMix.value; },
    dispose() { mesh.removeFromParent(); normals.dispose(); aoNormals.dispose(); aoMaterial.dispose(); texture.dispose(); geometry.dispose(); smooth.dispose(); } };
}
