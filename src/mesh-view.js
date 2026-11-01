import { createMeshLayers } from './mesh-layers.js';
import { createMeshSurface } from './mesh-surface.js';
import { createFaceMetal } from './face-metal.js';
import { createBoxRig } from './box-rig.js';
import { Box3, BufferGeometry, DoubleSide, Float32BufferAttribute, LineBasicMaterial, LineSegments, Vector3 } from 'three';
import { polygonEdges } from './polygon-mesh.js';
import { averageVertices, dualDiamond, dualNSided, triangulateFaces, validatePolygonMesh } from './mesh-operations.js';

export function createMeshView(scene, sharedSurfaceMaterial, physics, projection) {
  const surfaceMaterial = sharedSurfaceMaterial ?? createFaceMetal(); surfaceMaterial.side = DoubleSide;
  surfaceMaterial.polygonOffset = true; surfaceMaterial.polygonOffsetFactor = surfaceMaterial.polygonOffsetUnits = 1;
  let surface, rig, bindingSource, deformedPositions, wireframeDirty = false;
  const material = new LineBasicMaterial({ color: '#ffffff' });
  const object = new LineSegments(new BufferGeometry(), material);
  object.name = 'Polygon mesh wireframe'; scene.add(object);
  let base, configured;
  const bounds = new Box3();
  const point = new Vector3();
  object.frustumCulled = false;
  let topology, edges = [], generation = 0, layers = { stages: [] };
  const history = [];
  const geometryForEdges = (mesh, values) => {
    const geometry = new BufferGeometry();
    geometry.setAttribute('position', new Float32BufferAttribute(values.flatMap(edge => edge.flatMap(id => mesh.vertices[id])), 3));
    if (values.length) geometry.computeBoundingSphere();
    return geometry;
  };
  function updateWireframe() {
    if (!material.visible || !wireframeDirty || !deformedPositions) return;
    const attribute = object.geometry.attributes.position, values = attribute.array;
    let offset = 0;
    for (const edge of edges) for (const id of edge) {
      const start = id * 3;
      values[offset++] = deformedPositions[start]; values[offset++] = deformedPositions[start + 1]; values[offset++] = deformedPositions[start + 2];
    }
    attribute.needsUpdate = true; wireframeDirty = false;
  }
  function install(next) {
    validatePolygonMesh(next);
    const nextEdges = polygonEdges(next.faces);
    bounds.makeEmpty();
    for (const vertex of next.vertices) bounds.expandByPoint(point.fromArray(vertex));
    const wireframe = geometryForEdges(next, nextEdges);
    rig?.dispose(); rig = undefined;
    surface?.dispose(); surface = undefined;
    object.geometry.dispose(); object.geometry = wireframe;
    topology = next; edges = nextEdges;
    deformedPositions = undefined; wireframeDirty = false;
    surface = createMeshSurface(next, surfaceMaterial, { skinned: !!(physics && bindingSource) }); object.add(surface.mesh);
    surface.mesh.visible = configured?.visibility.surface !== false;
    if (physics && bindingSource) rig = createBoxRig(bindingSource, next, surface, physics, positions => {
      deformedPositions = positions; wireframeDirty = true; updateWireframe();
      bounds.copy(surface.mesh.boundingBox);
    });
    if (projection) {
      // Capture distance to this body's original mass centroid before motion.
      let mass = 0; point.set(0, 0, 0);
      for (const { body } of rig?.entries ?? []) {
        const weight = body.getMass(); mass += weight;
        point.addScaledVector(body.getWorldCenterOfMass(), weight);
      }
      if (mass > 0) point.divideScalar(mass);
      else { bounds.getCenter(point); object.localToWorld(point); }
      projection.capture(surface.mesh, point);
    }
    rig?.setCollidersVisible(configured?.visibility.colliders);
    rig?.setGrabForce(configured?.interaction?.grabForce);
  }
  function operate(operation) {
    if (!topology) throw new Error('No surface loaded.');
    const result = operation();
    if (result.mesh.faces.length > 50000) throw new Error('This operation exceeds the 50,000-face editing limit.');
    const previous = structuredClone(topology);
    install(result.mesh);
    history.push(previous); if (history.length > 20) history.shift();
    return topology;
  }
  return {
    object,
    clear() {
      rig?.dispose(); rig = undefined; bindingSource = undefined;
      surface?.dispose(); surface = undefined;
      object.geometry.dispose(); object.geometry = new BufferGeometry();
      base = topology = undefined; edges = []; layers = { stages: [] };
      deformedPositions = undefined; wireframeDirty = false;
      bounds.makeEmpty(); history.length = 0; generation++;
    },
    getCenter(target) {
      // Deformed bounds keep camera follow centered on the simulated surface.
      object.updateWorldMatrix(true, false); return object.localToWorld(bounds.getCenter(target));
    },
    getBounds(target) {
      object.updateWorldMatrix(true, false); return target.copy(bounds).applyMatrix4(object.matrixWorld);
    },
    get surface() { return surface; },
    get rig() { return rig; },
    get topology() { return topology; },
    get edges() { return edges; },
    get generation() { return generation; },
    get layers() { return layers; },
    get canUndo() { return history.length > 0; },
    setMesh(mesh, settings = configured, source, preparedLayers) {
      validatePolygonMesh(mesh);
      const previous = base, previousSource = bindingSource;
      base = structuredClone(mesh); bindingSource = source;
      try { return this.regenerate(undefined, settings, preparedLayers); }
      catch (error) { base = previous; bindingSource = previousSource; throw error; }
    },
    regenerate(camera, settings = configured, preparedLayers) {
      if (!base) return;
      const next = preparedLayers ?? createMeshLayers(base, settings?.pipeline ?? { enabled: false });
      configured = settings;
      install(next.mesh); layers = { stages: next.stages };
      history.length = 0; generation++;
      return topology;
    },
    refresh() { if (topology) install(topology); },
    triangulate(ids, options) { return operate(() => triangulateFaces(topology, ids, options)); },
    dualDiamond() { return operate(() => dualDiamond(topology)); },
    hexelate({ triangulate = true } = {}) { return operate(() => dualNSided(triangulate ? triangulateFaces(topology, undefined, { shortestDiagonal: true }).mesh : topology)); },
    dualNSided() { return operate(() => dualNSided(topology)); },
    smooth(options) { return operate(() => averageVertices(topology, undefined, options)); },
    undo() {
      const previous = history.at(-1); if (!previous) return false;
      install(previous); history.pop(); return true;
    },
    configure(settings) {
      configured = settings;
      material.color.set(settings.appearance.wireframeColor);
      material.visible = settings.visibility.wireframe;
      updateWireframe();
      object.visible = settings.visibility.surface || settings.visibility.wireframe || settings.visibility.colliders;
      rig?.setCollidersVisible(settings.visibility.colliders);
      rig?.setGrabForce(settings.interaction?.grabForce);
      if (surface) { surface.mesh.visible = settings.visibility.surface; surface.configure(); }
    },
    dispose() {
      rig?.dispose(); rig = undefined;
      surface?.dispose(); if (!sharedSurfaceMaterial) surfaceMaterial.dispose();
      object.removeFromParent(); object.geometry.dispose(); material.dispose();
    },
  };
}
