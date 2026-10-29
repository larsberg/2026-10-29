import { MathUtils, MOUSE, Spherical, TOUCH, Vector3 } from "three";

export const MIN_CAMERA_DISTANCE = 1;
export const DEFAULT_FOLLOW_SMOOTHING = 0.45;
export function configureOrbitInputs(controls) {
  controls.minDistance = MIN_CAMERA_DISTANCE;
  controls.enablePan = false;
  controls.zoomToCursor = false;
  controls.mouseButtons = { LEFT: MOUSE.ROTATE, MIDDLE: MOUSE.DOLLY, RIGHT: null };
  controls.touches = { ONE: TOUCH.ROTATE, TWO: TOUCH.DOLLY_ROTATE };
  controls.stopListenToKeyEvents();
}

// Clear pending orbit/pan inertia without moving the view or changing follow.
export function stopCameraMotion(camera, controls) {
  const origin = new Vector3(), absolute = captureCameraView(camera, controls, origin);
  applyCameraView(absolute, camera, controls, origin);
}

// A critically damped follow anchor eases both position and velocity. A new
// spawn can move the group center abruptly without jolting the camera speed.
export function createCameraFollow(initial = new Vector3()) {
  const position = initial.clone(), velocity = new Vector3(), delta = new Vector3();
  return {
    position,
    reset(target = position) { position.copy(target); velocity.set(0, 0, 0); },
    update(camera, controls, target, enabled, dragging = false, dt = Infinity, smoothing = DEFAULT_FOLLOW_SMOOTHING) {
      // Freeze anchor and view together; release resumes without stored inertia.
      if (dragging) { velocity.set(0, 0, 0); return; }
      if (!enabled) { position.copy(target); velocity.set(0, 0, 0); return; }
      if (!(dt > 0)) return;
      delta.copy(position).negate();
      for (const axis of ['x', 'y', 'z']) {
        const seconds = smoothing * (axis === 'y' ? 1.8 : 1);
        if (seconds <= 0 || !Number.isFinite(dt)) { position[axis] = target[axis]; velocity[axis] = 0; continue; }
        const omega = 1 / seconds, offset = position[axis] - target[axis];
        const c = velocity[axis] + omega * offset, decay = Math.exp(-omega * dt);
        position[axis] = target[axis] + (offset + c * dt) * decay;
        velocity[axis] = (velocity[axis] - omega * c * dt) * decay;
      }
      delta.add(position); camera.position.add(delta); controls.target.add(delta);
    },
  };
}

const roundedView = view => Object.fromEntries(Object.entries(view).map(([key, value]) => [key, Number(value.toFixed(10)) || 0]));

// Pointer input may update orbit/zoom, never the configured focal-point offsets.
export function captureCameraOrbit(camera, controls) {
  const orbit = new Spherical().setFromVector3(camera.position.clone().sub(controls.target));
  return roundedView({
    yaw: MathUtils.radToDeg(orbit.theta),
    elevation: MathUtils.radToDeg(Math.PI / 2 - orbit.phi),
    distance: orbit.radius,
  });
}

// Capture complete views for explicit restore and legacy camera workflows.
export function captureCameraView(camera, controls, follow) {
  const offset = controls.target.clone().sub(follow);
  // Remove floating-point noise from follow translations and angular limits.
  return { ...captureCameraOrbit(camera, controls), ...roundedView({ offsetX: offset.x, offsetY: offset.y, offsetZ: offset.z }) };
}

export function applyCameraView(view, camera, controls, follow) {
  // Flush pending orbit/pan inertia so reloading a view lands exactly on it.
  const damping = controls.enableDamping;
  controls.enableDamping = false;
  controls.update();
  controls.target.copy(follow).add(new Vector3(view.offsetX, view.offsetY, view.offsetZ));
  camera.position.copy(controls.target).add(new Vector3().setFromSpherical(
    new Spherical(view.distance, MathUtils.degToRad(90 - view.elevation), MathUtils.degToRad(view.yaw)),
  ));
  controls.update();
  controls.enableDamping = damping;
}
