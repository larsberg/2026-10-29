import Box3D from 'box3d-wasm/standard';
import { Quaternion, Vector3 } from 'three';
import { validateRigidBody } from './rigid-body-settings.js';

export const PHYSICS_STEP = 1 / 120;
let engine, initialization;
export function initPhysics() {
  return initialization ??= Box3D().then(module => { engine = module; });
}

// A managed rigid-body world; no implicit floor or scene objects.
export function createPhysics(value) {
  if (!engine) throw new Error('Initialize Box3D before creating the physics world.');
  let settings = validateRigidBody(value), accumulator = 0, disposed = false;
  // Firm, damped contacts keep the hopping hulls close to the floor surface
  // on landing, including at the sketch's stronger gravity settings.
  const world = new engine.World({ gravity: { x: 0, y: -settings.gravity, z: 0 }, enableSleep: true, enableContinuous: true,
    contactHertz: 60, contactDampingRatio: 1, contactSpeed: 10 });
  const entries = [], joints = [], syncListeners = new Set(), stepListeners = new Set();
  const position = new Vector3(), rotation = new Quaternion(), parentRotation = new Quaternion();
  const creators = { box: 'createBox', sphere: 'createSphere', capsule: 'createCapsule', hull: 'createHull' };
  function sync() {
    for (const { body, object } of entries) {
      if (!object) continue;
      position.copy(body.getPosition()); rotation.copy(body.getRotation()).normalize();
      if (object.parent) {
        object.parent.updateWorldMatrix(true, false);
        object.parent.worldToLocal(position);
        object.parent.getWorldQuaternion(parentRotation).invert();
        rotation.premultiply(parentRotation);
      }
      object.position.copy(position); object.quaternion.copy(rotation);
      object.updateMatrixWorld(true);
    }
    for (const listener of syncListeners) listener();
  }
  function addJoint(method, a, b, options) {
    if (disposed) throw new Error('Physics has been closed.');
    const entry = { a, b, joint: world[method](a.body, b.body, options), options };
    joints.push(entry); return entry;
  }
  return {
    world, entries, joints,
    onSync(listener) { syncListeners.add(listener); return () => syncListeners.delete(listener); },
    onBeforeStep(listener) { stepListeners.add(listener); return () => stepListeners.delete(listener); },
    addBody({ object, body: options = {}, shapes = [] } = {}) {
      if (disposed) throw new Error('Physics has been closed.');
      for (const shape of shapes) if (!creators[shape.type]) throw new Error(`Unknown collider: ${shape.type}`);
      const pose = object ? { position: object.getWorldPosition(new Vector3()), rotation: object.getWorldQuaternion(new Quaternion()) } : {};
      const body = world.createBody({ type: 'dynamic', ...pose, ...options });
      const colliders = [];
      try {
        for (const { type, ...shape } of shapes) {
          const collider = body[creators[type]]({ density: 1, ...shape, friction: settings.friction });
          colliders.push(collider);
          if (!collider.isValid()) throw new Error(`Box3D could not create the ${type} collider.`);
        }
      } catch (error) {
        body.destroy(); colliders.forEach(shape => shape.delete()); body.delete(); throw error;
      }
      const entry = { body, object, shapes: colliders, initial: body.getTransform() };
      entries.push(entry); sync(); return entry;
    },
    addSphericalJoint(a, b, options) { return addJoint('createSphericalJoint', a, b, options); },
    addMotorJoint(a, b, options) { return addJoint('createMotorJoint', a, b, options); },
    removeJoint(entry) {
      const index = joints.indexOf(entry); if (index < 0) return;
      entry.joint.destroy(); entry.joint.delete(); joints.splice(index, 1);
    },
    removeBody(entry) {
      const index = entries.indexOf(entry); if (index < 0) return;
      for (const joint of [...joints]) if (joint.a === entry || joint.b === entry) this.removeJoint(joint);
      entry.body.destroy(); entry.shapes.forEach(shape => shape.delete()); entry.body.delete(); entries.splice(index, 1);
    },
    configure(value) {
      if (disposed) return;
      settings = validateRigidBody({ ...settings, ...value });
      world.setGravity({ x: 0, y: -settings.gravity, z: 0 });
      for (const entry of entries) {
        for (const shape of entry.shapes) shape.setFriction(settings.friction);
        entry.body.setAwake(true);
      }
    },
    step(dt) {
      if (disposed || !Number.isFinite(dt) || dt <= 0) return false;
      accumulator += Math.min(dt, PHYSICS_STEP * 8);
      let steps = 0;
      while (accumulator + 1e-12 >= PHYSICS_STEP && steps < 8) {
        // Fast launches/landings may request extra solver substeps for this
        // tick only; the ordinary grounded gait retains its lower cost.
        let substeps = 4;
        for (const listener of stepListeners) if (listener(PHYSICS_STEP)?.substeps === 8) substeps = 8;
        world.step(PHYSICS_STEP, substeps);
        accumulator = Math.max(0, accumulator - PHYSICS_STEP); steps++;
      }
      if (steps) sync();
      return steps > 0;
    },
    reset() {
      if (disposed) return;
      accumulator = 0;
      for (const { body, initial } of entries) {
        body.setTransform(initial.position, initial.rotation);
        body.setLinearVelocity({ x: 0, y: 0, z: 0 });
        body.setAngularVelocity({ x: 0, y: 0, z: 0 });
        body.setAwake(true);
      }
      sync();
    },
    sync,
    dispose() {
      if (disposed) return;
      disposed = true; world.destroy();
      joints.forEach(({ joint }) => joint.delete()); joints.length = 0; syncListeners.clear(); stepListeners.clear();
      for (const { body, shapes } of entries) { shapes.forEach(shape => shape.delete()); body.delete(); }
      entries.length = 0; world.delete();
    },
  };
}
