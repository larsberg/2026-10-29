import { Box3, DoubleSide, Group, Vector3 } from 'three';
import { createMeshLayers, createSeededRandom } from './mesh-layers.js';
import { createMeshView } from './mesh-view.js';

export const SCULPTURE_COUNT = 3;

export function createSculptureGroup(scene, material, physics) {
  const object = new Group(); object.name = 'Three CSG sculptures'; scene.add(object);
  // Each skin needs its own polygon-normal texture uniforms. Keep the material
  // controls shared, but give each copy an independent material/shader binding.
  const materials = Array.from({ length: SCULPTURE_COUNT }, () => material.clone());
  const views = materials.map(value => createMeshView(object, value, physics));
  const primary = views[0], bounds = new Box3(), childBounds = new Box3();
  let activeRig;
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
    setMesh(mesh, settings, source) {
      rig.endDrag();
      const layers = createMeshLayers(mesh, settings.pipeline);
      const shapeBounds = new Box3().setFromPoints(layers.mesh.vertices.map(vertex => new Vector3(...vertex)));
      const size = shapeBounds.getSize(new Vector3()), center = shapeBounds.getCenter(new Vector3());
      const gap = Math.max(.35, size.length() * .04), x = (size.x + gap) / 2, z = (size.z + gap) / 2;
      const positions = [new Vector3(-x, 0, z), new Vector3(x, 0, z), new Vector3(0, 0, -z)];
      // Clear every old rig first so rebuilding never mixes old/new colliders.
      views.forEach(view => view.clear());
      views.forEach((view, i) => {
        view.object.position.copy(positions[i]).sub(center);
        view.setMesh(mesh, settings, source, structuredClone(layers));
        view.surface.mesh.name = `CSG sculpture ${i + 1} · seven boxes`;
      });
      configure(settings); return primary.topology;
    },
    clear() { rig.endDrag(); views.forEach(view => view.clear()); },
    triangulate(ids, { seed, ...options } = {}) {
      rig.endDrag();
      return views.map(view => view.triangulate(ids, { ...options,
        ...(seed === undefined ? {} : { random: createSeededRandom(seed) }) }))[0];
    },
    dispose() { rig.endDrag(); views.forEach(view => view.dispose()); materials.forEach(value => value.dispose()); object.removeFromParent(); },
  };
  for (const method of ['dualDiamond', 'hexelate', 'dualNSided', 'smooth', 'undo']) {
    group[method] = (...args) => {
      rig.endDrag();
      return views.map(view => view[method](...args))[0];
    };
  }
  return group;
}
