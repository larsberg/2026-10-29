import { Bone, BufferGeometry, EdgesGeometry, Float32BufferAttribute, Group, LineBasicMaterial, LineSegments, Matrix4, Quaternion, Skeleton, Uint16BufferAttribute, Vector3 } from 'three';
import { fitBoxColliders, MAX_COLLIDER_VERTICES } from './collider-fit.js';

// Connect each overlapping cluster with a sparse tree, preferring its largest
// shared regions. Separate clusters and isolated boxes get no connecting joint.
export function boxConnections({ boxes, overlaps }) {
  const candidates = [...overlaps];
  candidates.sort((a, b) => b.volume - a.volume || a.a - b.a || a.b - b.b);
  const components = boxes.map((_, i) => i), connections = [];
  for (const edge of candidates) {
    const a = components[edge.a], b = components[edge.b];
    if (a === b) continue;
    connections.push(edge);
    for (let i = 0; i < components.length; i++) if (components[i] === b) components[i] = a;
    if (connections.length === boxes.length - 1) break;
  }
  return connections;
}

export function boxSkinWeights(vertices, boxes) {
  const frames = boxes.map(box => ({
    center: new Vector3(...box.position), inverse: new Quaternion(...box.quaternion).invert(), half: box.size.map(size => size / 2),
  }));
  const point = new Vector3(), local = new Vector3();
  // Distance to each oriented box (including its interior), rather than just
  // its center, keeps projecting lobes attached to their source collider.
  return vertices.map(vertex => {
    point.fromArray(vertex);
    const distances = frames.map(({ center, inverse, half }, index) => {
      local.copy(point).sub(center).applyQuaternion(inverse);
      const q = [Math.abs(local.x) - half[0], Math.abs(local.y) - half[1], Math.abs(local.z) - half[2]];
      const distance = Math.hypot(...q.map(value => Math.max(0, value))) + Math.min(Math.max(...q), 0);
      return { index, distance };
    }).sort((a, b) => a.distance - b.distance || a.index - b.index).slice(0, 4);
    const weights = distances.map(({ distance }) => Math.exp(-(distance - distances[0].distance) / .4));
    const total = weights.reduce((sum, weight) => sum + weight, 0);
    return distances.map(({ index }, i) => [index, weights[i] / total]);
  });
}

export function createBoxRig(source, topology, surface, physics, onDeform) {
  const skin = surface.mesh, weights = boxSkinWeights(topology.vertices, source.boxes);
  const colliders = fitBoxColliders(topology, source.boxes);
  const bones = source.boxes.map((box, i) => {
    const bone = new Bone(); bone.name = `Source box ${i + 1}`;
    bone.position.fromArray(box.position); bone.quaternion.fromArray(box.quaternion); skin.add(bone); return bone;
  });
  skin.updateWorldMatrix(true, true);
  const colliderGroup = new Group(); colliderGroup.name = 'Fitted hull colliders'; colliderGroup.visible = false;
  skin.parent.add(colliderGroup);
  const colliderMaterial = new LineBasicMaterial({ color: '#62f1af', transparent: true, opacity: .8,
    depthTest: false, depthWrite: false, toneMapped: false, fog: false });
  const colliderLines = colliders.map((collider, i) => {
    const geometry = collider ? new EdgesGeometry(collider.geometry) : new BufferGeometry();
    const line = new LineSegments(geometry, colliderMaterial); line.name = `Bone ${i + 1} fitted collider`;
    line.visible = !!collider;
    line.matrixAutoUpdate = false; line.frustumCulled = false; line.renderOrder = 20; colliderGroup.add(line); return line;
  });
  const entries = [], joints = [];
  let skeleton, unsubscribe, unsubscribeStep, drag, disposed = false;
  const rayOrigin = new Vector3(), rayTranslation = new Vector3();
  const bodyPosition = new Vector3(), bodyRotation = new Quaternion(), unitScale = new Vector3(1, 1, 1);
  function pickCollider(caster) {
    if (disposed) return null;
    let closest = null;
    const near = Math.max(0, caster.near), far = Number.isFinite(caster.far) ? caster.far : 1e6;
    if (far <= near) return null;
    rayOrigin.copy(caster.ray.origin).addScaledVector(caster.ray.direction, near);
    rayTranslation.copy(caster.ray.direction).multiplyScalar(far - near);
    for (const link of entries) for (const shape of link.shapes) {
      const hit = shape.rayCast(rayOrigin, rayTranslation);
      if (!hit.hit) continue;
      const point = new Vector3().copy(hit.point), distance = caster.ray.origin.distanceTo(point);
      if (closest && distance >= closest.distance) continue;
      closest = { link, point, distance };
    }
    return closest;
  }
  function endDrag() {
    if (!drag) return;
    const previous = drag; drag = undefined;
    physics.removeJoint(previous.joint); physics.removeBody(previous.anchor);
  }
  function beginDrag(link, worldPoint) {
    if (disposed || !entries.includes(link)) return false;
    endDrag();
    const anchor = physics.addBody({ body: { type: 'kinematic', position: worldPoint } });
    try {
      const mass = entries.reduce((sum, entry) => sum + entry.body.getMass(), 0);
      // Pull the picked point without locking rotation. The existing joints
      // transmit the pull through the cluster and its seven skinning bones.
      const joint = physics.addMotorJoint(anchor, link, {
        localFrameB: { position: link.body.getLocalPoint(worldPoint) },
        linearHertz: 30, linearDampingRatio: .85,
        maxSpringForce: Math.max(1, mass) * 10000,
        maxSpringTorque: 0, maxVelocityForce: 0, maxVelocityTorque: 0, collideConnected: false,
      });
      drag = { link, anchor, joint, target: worldPoint.clone() };
      for (const { body } of entries) body.setAwake(true);
      return true;
    } catch (error) { physics.removeBody(anchor); throw error; }
  }
  function dispose() {
    if (disposed) return; endDrag(); disposed = true; unsubscribe?.(); unsubscribeStep?.();
    joints.forEach(entry => physics.removeJoint(entry));
    entries.forEach(entry => physics.removeBody(entry));
    bones.forEach(bone => bone.removeFromParent()); skeleton?.dispose();
    colliderGroup.removeFromParent(); colliderLines.forEach(line => line.geometry.dispose());
    colliders.forEach(collider => collider?.geometry.dispose()); colliderMaterial.dispose();
  }
  try {
    for (const [i] of source.boxes.entries()) entries.push(physics.addBody({
      object: bones[i], body: { linearDamping: 1.5, angularDamping: 2 },
      shapes: colliders[i] ? [{ type: 'hull', points: colliders[i].points, maxVertices: MAX_COLLIDER_VERTICES,
        // These bone regions deliberately intersect. Contacts within the rig
        // would fight its rest pose; they still collide with outside bodies.
        filter: { groupIndex: -1 } }] : [],
    }));
    const connections = boxConnections(source);
    for (const { a, b, anchor } of connections) {
      const worldAnchor = skin.localToWorld(new Vector3(...anchor));
      const frame = entry => ({ position: entry.body.getLocalPoint(worldAnchor), rotation: new Quaternion().copy(entry.body.getRotation()).invert() });
      joints.push(physics.addSphericalJoint(entries[a], entries[b], {
        localFrameA: frame(entries[a]), localFrameB: frame(entries[b]), collideConnected: false,
        enableSpring: true, hertz: 2, dampingRatio: .8,
        enableConeLimit: true, coneAngle: Math.PI / 6,
        enableTwistLimit: true, lowerTwistAngle: -Math.PI / 6, upperTwistAngle: Math.PI / 6,
      }));
    }
    const indices = [], values = [];
    for (const id of surface.corners) for (let slot = 0; slot < 4; slot++) {
      indices.push(weights[id][slot]?.[0] ?? 0); values.push(weights[id][slot]?.[1] ?? 0);
    }
    skin.geometry.setAttribute('skinIndex', new Uint16BufferAttribute(indices, 4));
    skin.geometry.setAttribute('skinWeight', new Float32BufferAttribute(values, 4));
    skin.updateWorldMatrix(true, true); skeleton = new Skeleton(bones); skin.bind(skeleton); skin.normalizeSkinWeights();
    const positions = new Float32Array(topology.vertices.length * 3);
    const matrices = bones.map(() => new Matrix4()), point = new Vector3(), blended = new Vector3(), transformed = new Vector3();
    const colliderParentInverse = new Matrix4(), colliderMatrix = new Matrix4();
    function sync() {
      skin.updateWorldMatrix(true, true); skeleton.update();
      colliderGroup.updateWorldMatrix(true, false); colliderParentInverse.copy(colliderGroup.matrixWorld).invert();
      entries.forEach(({ body }, i) => {
        colliderMatrix.compose(bodyPosition.copy(body.getPosition()), bodyRotation.copy(body.getRotation()).normalize(), unitScale);
        colliderLines[i].matrix.multiplyMatrices(colliderParentInverse, colliderMatrix);
        colliderLines[i].matrixWorldNeedsUpdate = true;
      });
      bones.forEach((bone, i) => matrices[i].multiplyMatrices(bone.matrixWorld, skeleton.boneInverses[i]));
      topology.vertices.forEach((vertex, i) => {
        point.fromArray(vertex).applyMatrix4(skin.bindMatrix); blended.set(0, 0, 0);
        for (const [bone, weight] of weights[i]) blended.addScaledVector(transformed.copy(point).applyMatrix4(matrices[bone]), weight);
        blended.applyMatrix4(skin.bindMatrixInverse).toArray(positions, i * 3);
      });
      surface.updateDeformed(positions); onDeform(positions);
    }
    unsubscribe = physics.onSync(sync);
    unsubscribeStep = physics.onBeforeStep(dt => {
      // A short target approach avoids a kinematic teleport on sparse pointer
      // events and supplies velocity to the solver for a natural release.
      if (drag) drag.anchor.body.setTargetTransform({ position: drag.target }, Math.max(dt, .02), true);
    });
    sync();
    return { bones, skeleton, skin, entries, joints, connections, weights, positions, colliders, colliderGroup, colliderLines, sync, dispose,
      setCollidersVisible(value) { colliderGroup.visible = !!value; },
      pickCollider, beginDrag, endDrag, get dragging() { return !!drag; },
      moveDrag(point) { if (drag && !disposed) drag.target.copy(point); },
    };
  } catch (error) { dispose(); throw error; }
}
