import { Plane, Raycaster, Vector2, Vector3 } from 'three';

export function bindColliderDrag({ element, camera, controls, getRig, canInteract, onDragChange = () => {}, blurTarget = window, documentTarget = document }) {
  const abort = new AbortController(), caster = new Raycaster(), pointer = new Vector2(), plane = new Plane(), point = new Vector3();
  let drag;
  function cast(event) {
    const rect = element.getBoundingClientRect();
    if (!rect.width || !rect.height) return false;
    pointer.set((event.clientX - rect.left) / rect.width * 2 - 1, 1 - (event.clientY - rect.top) / rect.height * 2);
    camera.updateMatrixWorld(); caster.setFromCamera(pointer, camera); return true;
  }
  function end() {
    if (!drag) return;
    const previous = drag; drag = undefined; previous.rig.endDrag(); controls.enabled = previous.orbitEnabled;
    element.style.cursor = previous.cursor;
    if (element.hasPointerCapture?.(previous.id)) element.releasePointerCapture(previous.id);
    onDragChange(false);
  }
  function down(event) {
    if (drag) { if (event.pointerId !== drag.id) { event.preventDefault(); event.stopImmediatePropagation(); } return; }
    if (!event.isPrimary || event.button !== 0 || event.shiftKey || !canInteract() || !cast(event)) return;
    const rig = getRig(), hit = rig?.pickCollider(caster);
    if (!hit || !rig.beginDrag(hit.link, hit.point)) return;
    plane.setFromNormalAndCoplanarPoint(camera.getWorldDirection(new Vector3()), hit.point);
    drag = { id: event.pointerId, rig, orbitEnabled: controls.enabled, cursor: element.style.cursor };
    controls.enabled = false; element.style.cursor = 'grabbing';
    element.setPointerCapture(event.pointerId); event.preventDefault(); event.stopImmediatePropagation(); onDragChange(true);
  }
  function move(event) {
    if (!drag || event.pointerId !== drag.id) return;
    event.preventDefault(); event.stopImmediatePropagation();
    if (!canInteract() || drag.rig !== getRig() || !drag.rig.dragging || event.buttons === 0) { end(); return; }
    if (cast(event) && caster.ray.intersectPlane(plane, point)) drag.rig.moveDrag(point);
  }
  function up(event) { if (drag && event.pointerId === drag.id) { event.preventDefault(); event.stopImmediatePropagation(); end(); } }
  const options = { capture: true, signal: abort.signal };
  element.addEventListener('pointerdown', down, options); element.addEventListener('pointermove', move, options);
  for (const name of ['pointerup', 'pointercancel', 'lostpointercapture']) element.addEventListener(name, up, options);
  blurTarget.addEventListener('blur', end, { signal: abort.signal });
  documentTarget.addEventListener('visibilitychange', () => { if (documentTarget.hidden) end(); }, { signal: abort.signal });
  return { end, get active() { return !!drag; }, update() { if (drag && (!canInteract() || getRig() !== drag.rig || !drag.rig.dragging)) end(); }, dispose() { end(); abort.abort(); } };
}
