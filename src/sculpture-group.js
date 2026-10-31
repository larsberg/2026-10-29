import { Box3, DoubleSide, Group, Vector3 } from 'three';
import { createMeshLayers, createSeededRandom } from './mesh-layers.js';
import { createMeshView } from './mesh-view.js';
import { createBoxUnion } from './box-union.js';

export const SCULPTURE_COUNT = 7;

// One saved herd seed reproducibly gives every member its own shape seed.
export function createHerdSources(seed, spread) {
  return Array.from({ length: SCULPTURE_COUNT }, (_, i) => createBoxUnion((seed + i * 104729) % 1000001, spread));
}

export function createSculptureGroup(scene, material, physics, projection) {
  const object = new Group(); object.name = 'Seven CSG sculptures'; scene.add(object);
  // Each skin needs its own polygon-normal texture uniforms. Keep the material
  // controls shared, but give each copy an independent material/shader binding.
  const materials = Array.from({ length: SCULPTURE_COUNT }, () => material.clone());
  const unbindProjection = materials.map(value => projection?.bind(value));
  const views = materials.map(value => createMeshView(object, value, physics, projection));
  const primary = views[0], bounds = new Box3(), childBounds = new Box3();
  let activeRig, sources = [];
  const rig = {
    pickCollider(caster) {
      let closest = null;
      for (const view of views) {
        if (!view.object.visible) continue;
        const hit = view.rig?.pickCollider(caster);
        if (hit && (!closest || hit.distance < closest.distance)) closest = hit;
      }
      return closest;
    },
    beginDrag(link, point) {
      this.endDrag();
      const selected = views.find(view => view.rig?.entries.includes(link))?.rig;
      if (!selected?.beginDrag(link, point)) return false;
      activeRig = selected; return true;
    },
    moveDrag(point) { activeRig?.moveDrag(point); },
    endDrag() { activeRig?.endDrag(); activeRig = undefined; },
    get dragging() { return !!activeRig?.dragging; },
  };
  function getBounds(target) {
    target.makeEmpty();
    for (const view of views) target.union(view.getBounds(childBounds));
    return target;
  }
  function configure(settings) {
    object.visible = settings.visibility.surface || settings.visibility.wireframe || settings.visibility.colliders;
    views.forEach((view, i) => {
      const copy = materials[i];
      const recompile = copy.flatShading !== material.flatShading || copy.transparent !== material.transparent;
      copy.copy(material);
      copy.side = DoubleSide; copy.polygonOffset = true; copy.polygonOffsetFactor = copy.polygonOffsetUnits = 1;
      if (recompile) copy.needsUpdate = true;
      view.configure(settings);
    });
  }
  const group = {
    object, views, rig, configure, getBounds,
    getCenter(target) { return getBounds(bounds).getCenter(target); },
    get topology() { return primary.topology; },
    get surface() { return primary.surface; },
    get surfaces() { return views.map(view => view.surface?.mesh).filter(Boolean); },
    get edges() { return primary.edges; },
    get generation() { return primary.generation; },
    get layers() { return primary.layers; },
    get canUndo() { return views.every(view => view.canUndo); },
    get sources() { return sources; },
    setSources(nextSources, settings) {
      rig.endDrag();
      sources = nextSources;
      const layers = sources.map(source => createMeshLayers(source.mesh, { ...settings.pipeline, seed: source.seed }));
      const shapes = layers.map(layer => new Box3().setFromPoints(layer.mesh.vertices.map(vertex => new Vector3(...vertex))));
      const sizes = shapes.map(shape => shape.getSize(new Vector3()));
      // Compact rows, sized from the finished meshes so every seed starts clear
      // of its neighbors. The last row forms the rear of the herd.
      const gap = .55, positions = [];
      let depth = 0;
      for (let start = 0; start < sizes.length; start += 3) {
        const row = sizes.slice(start, start + 3);
        const rowDepth = Math.max(...row.map(size => size.z));
        let x = -(row.reduce((sum, size) => sum + size.x, 0) + gap * (row.length - 1)) / 2;
        for (const size of row) {
          positions.push(new Vector3(x + size.x / 2, 0, depth + rowDepth / 2));
          x += size.x + gap;
        }
        depth += rowDepth + gap;
      }
      for (const position of positions) position.z -= (depth - gap) / 2;
      // Clear every old rig first so rebuilding never mixes old/new colliders.
      views.forEach(view => view.clear());
      views.forEach((view, i) => {
        const center = shapes[i].getCenter(new Vector3());
        view.object.position.copy(positions[i]).sub(center);
        view.object.position.y = .2 - shapes[i].min.y;
        view.setMesh(sources[i].mesh, settings, sources[i], layers[i]);
        view.surface.mesh.name = `Herd blob ${i + 1} · seed ${sources[i].seed}`;
      });
      configure(settings); return primary.topology;
    },
    clear() { rig.endDrag(); views.forEach(view => view.clear()); },
    triangulate(ids, { seed, ...options } = {}) {
      rig.endDrag();
      return views.map((view, i) => view.triangulate(ids, { ...options,
        ...(seed === undefined ? {} : { random: createSeededRandom((seed + i * 104729) % 1000001) }) }))[0];
    },
    dispose() { rig.endDrag(); views.forEach(view => view.dispose()); unbindProjection.forEach(unbind => unbind?.()); materials.forEach(value => value.dispose()); object.removeFromParent(); },
  };
  for (const method of ['dualDiamond', 'hexelate', 'dualNSided', 'smooth', 'undo']) {
    group[method] = (...args) => {
      rig.endDrag();
      return views.map(view => view[method](...args))[0];
    };
  }
  return group;
}
