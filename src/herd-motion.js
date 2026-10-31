import { Box3, Quaternion, Vector3 } from 'three';
import { createSeededRandom } from './mesh-layers.js';
import { HERD_BPM, JUMP_BEATS, CROUCH_BEATS, HERD_HEADING, DEFAULT_JUMP_POWER, DEFAULT_SMALL_JUMP_PERCENT } from './herd-rhythm.js';

const HARMONY_DURATION = .2;

// A shared pulse chooses a grounded rear member, crouches it, and launches its
// connected rig over the pack. Flight is ballistic: no midair propulsion or
// pose animation. Contacts and the original joints handle tumble and landing.
export function createHerdMotion(physics, group, ground, { getBeat, getGroove, bpm = HERD_BPM, jumpPower = DEFAULT_JUMP_POWER, smallJumpPercent = DEFAULT_SMALL_JUMP_PERCENT } = {}) {
  let states = [], random, elapsed = 0, previousBeat = 0, scheduledBeat = JUMP_BEATS, queued = null;
  let harmonyAge = HARMONY_DURATION, harmonyStrength = 0, harmonyAmount = 0, harmonyBeat, harmonyChords = 0;
  const pack = new Vector3(), direction = new Vector3(Math.sin(HERD_HEADING), 0, -Math.cos(HERD_HEADING));
  const sideways = new Vector3(-direction.z, 0, direction.x), spin = new Vector3(), velocity = new Vector3();
  const desired = new Vector3(), curl = new Quaternion(), frameA = new Quaternion(), frameB = new Quaternion();
  const point = new Vector3(), anchor = new Vector3(), impulse = new Vector3(), identity = new Quaternion();
  const rockAxis = new Vector3(0, 0, 1), nodAxis = new Vector3(1, 0, 0), nod = new Quaternion();
  const baseFriction = () => ground?.entry.shapes[0].getFriction() ?? .55;
  function restoreFlight(state) {
    for (const foot of state.supportFeet) {
      foot.entry.body.setLinearDamping(foot.damping); foot.entry.body.setAngularDamping(foot.angularDamping); foot.entry.body.setBullet(foot.bullet);
    }
  }
  function releaseHarmony(state) {
    for (const link of state.harmony.active) {
      link.joint.setTargetRotation(identity);
      link.joint.setSpringHertz(link.options.hertz); link.joint.setSpringDampingRatio(link.options.dampingRatio);
    }
    state.harmony.active.length = 0; state.harmony.amount = 0;
  }
  function flexHarmony(state) {
    if (harmonyAmount <= 0) return;
    for (const { link, axis } of state.harmony.joints) {
      // Walking owns its leg joints; flex the remaining body connections.
      if (state.legs.some(leg => leg.link === link)) continue;
      link.joint.setTargetRotation(curl.setFromAxisAngle(axis, harmonyAmount * .28));
      link.joint.setSpringHertz(4); link.joint.setSpringDampingRatio(1);
      link.a.body.setAwake(true); link.b.body.setAwake(true);
      state.harmony.active.push(link);
    }
    if (state.harmony.active.length) state.harmony.amount = harmonyAmount;
  }
  function triggerHarmony(events) {
    for (const event of events) if (event.layer === 'keys') {
      // A three-note chord is one gesture, even if notes arrive in separate frames.
      if (event.beat !== harmonyBeat) {
        harmonyBeat = event.beat; harmonyAge = 0; harmonyStrength = 0; harmonyChords++;
      }
      harmonyStrength = Math.max(harmonyStrength, Math.min(1, event.gain / .65));
    }
  }
  function relax(state) {
    restoreFlight(state); releaseClench(state); releaseHarmony(state);
    for (const leg of state.legs) if (leg.plant) { physics.removeJoint(leg.plant); leg.plant = null; }
    for (const leg of state.legs) if (leg.muscle) { physics.removeJoint(leg.muscle); leg.muscle = null; }
    for (const link of state.rig?.joints ?? []) {
      link.joint.setTargetRotation(identity);
      link.joint.setSpringHertz(link.options.hertz); link.joint.setSpringDampingRatio(link.options.dampingRatio);
      link.joint.setConeLimit(link.options.coneAngle); link.joint.setTwistLimits(link.options.lowerTwistAngle, link.options.upperTwistAngle);
    }
    for (const foot of state.feet) for (const shape of foot.entry.shapes) shape.setFriction(baseFriction());
  }
  function reset(seed = group.sources[0]?.seed ?? 1) {
    for (const [i, state] of states.entries()) if (state.rig === group.views[i]?.rig) relax(state);
    random = createSeededRandom(seed + 7919); elapsed = 0; previousBeat = getBeat?.() ?? 0;
    harmonyAge = HARMONY_DURATION; harmonyStrength = harmonyAmount = harmonyChords = 0; harmonyBeat = undefined;
    scheduledBeat = (Math.floor(previousBeat / JUMP_BEATS) + 1) * JUMP_BEATS; queued = null;
    states = group.views.map((view, i) => {
      const rig = view.rig;
      const feet = (rig?.entries ?? []).flatMap((entry, index) => rig.colliders[index] ? [{ entry, index,
        mass: entry.body.getMass(), position: new Vector3(), rotation: new Quaternion(), contact: new Vector3(),
        center: new Vector3(), velocity: new Vector3(), damping: entry.body.getLinearDamping(), angularDamping: entry.body.getAngularDamping(), bullet: entry.body.isBullet() }] : []);
      const masses = new Map();
      for (const foot of feet) {
        const component = rig.components[foot.index];
        masses.set(component, (masses.get(component) ?? 0) + foot.mass);
      }
      const mainComponent = [...masses].sort((a, b) => b[1] - a[1])[0]?.[0];
      const supportFeet = feet.filter(foot => rig.components[foot.index] === mainComponent);
      const bounds = new Box3();
      for (const foot of supportFeet) for (const vertex of rig.colliders[foot.index].points) {
        bounds.expandByPoint(point.copy(foot.entry.body.getWorldPoint(vertex)));
      }
      const size = bounds.getSize(new Vector3()), bodyLength = Math.max(1, size.x, size.y, size.z);
      const harmonyRandom = createSeededRandom(((group.sources[i]?.seed ?? seed + i * 104729) + 982451653) >>> 0);
      const harmonyJoints = (rig?.joints ?? []).filter(link => [link.a, link.b].every(entry => supportFeet.some(foot => foot.entry === entry)))
        .map(link => ({ link, axis: new Vector3(harmonyRandom() - .5, .3, harmonyRandom() - .5).normalize() }));
      return { rig, feet, entries: feet.map(foot => foot.entry), center: new Vector3(), velocity: new Vector3(), mass: 0,
        supportFeet, bodyLength, front: 0, supportMass: masses.get(mainComponent) ?? 0, supportCenter: new Vector3(), supportVelocity: new Vector3(),
        index: i, random: createSeededRandom(((group.sources[i]?.seed ?? seed + i * 104729) + 3571) >>> 0),
        clench: { amount: 0, links: [], selectedRear: [], startRadius: 0 },
        harmony: { joints: harmonyJoints, active: [], amount: 0 },
        gait: { phase: i * 2.399, swayRate: .65 + random() * .35, steps: 0, pulse: 0, drive: 1 },
        hop: { phase: 'settle', remaining: .6, kicks: 0, smallJumps: 0, lastKick: null, lastSmallJump: null, lastLaunch: null, lastLanding: null },
        direction: direction.clone(), active: [], legs: [0, 1].map(j => ({ phase: (i * .17 + j * .5) % 1,
          duration: 1.3 + random() * .4, foot: null, link: null, stage: 'search' })) };
    });
  }
  function measure(state) {
    state.center.set(0, 0, 0); state.velocity.set(0, 0, 0); state.mass = 0;
    state.front = -Infinity;
    for (const foot of state.feet) {
      const body = foot.entry.body;
      foot.position.copy(body.getPosition()); foot.rotation.copy(body.getRotation()).normalize();
      foot.center.copy(body.getWorldCenterOfMass()); foot.velocity.copy(body.getLinearVelocity());
      foot.contact.set(0, Infinity, 0);
      const supported = state.supportFeet.includes(foot);
      for (const vertex of state.rig.colliders[foot.index].points) {
        point.copy(vertex).applyQuaternion(foot.rotation).add(foot.position);
        if (point.y < foot.contact.y) foot.contact.copy(point);
        if (supported) state.front = Math.max(state.front, point.dot(direction));
      }
      state.mass += foot.mass; state.center.addScaledVector(foot.center, foot.mass); state.velocity.addScaledVector(foot.velocity, foot.mass);
    }
    if (state.mass) { state.center.divideScalar(state.mass); state.velocity.divideScalar(state.mass); }
    state.supportCenter.set(0, 0, 0); state.supportVelocity.set(0, 0, 0);
    for (const foot of state.supportFeet) {
      state.supportCenter.addScaledVector(foot.center, foot.mass); state.supportVelocity.addScaledVector(foot.velocity, foot.mass);
    }
    if (state.supportMass) { state.supportCenter.divideScalar(state.supportMass); state.supportVelocity.divideScalar(state.supportMass); }
  }
  function release(state, leg) {
    if (leg.plant) { physics.removeJoint(leg.plant); leg.plant = null; }
    if (leg.muscle) { physics.removeJoint(leg.muscle); leg.muscle = null; }
    if (leg.link) {
      leg.link.joint.setTargetRotation(identity); leg.link.joint.setSpringHertz(leg.link.options.hertz);
      leg.link.joint.setSpringDampingRatio(leg.link.options.dampingRatio);
      leg.link.joint.setConeLimit(leg.link.options.coneAngle); leg.link.joint.setTwistLimits(leg.link.options.lowerTwistAngle, leg.link.options.upperTwistAngle);
    }
    if (leg.foot) for (const shape of leg.foot.entry.shapes) shape.setFriction(baseFriction());
    leg.foot = leg.link = null; leg.stage = 'search';
  }
  function chooseFoot(state, leg) {
    release(state, leg);
    const taken = state.legs.filter(other => other !== leg).map(other => other.foot);
    const candidates = state.supportFeet.filter(foot => !taken.includes(foot) && foot.contact.y < .04).map(foot => {
      const links = state.rig.joints.filter(link => link.a === foot.entry || link.b === foot.entry)
        .filter(link => !state.legs.some(other => other !== leg && other.link === link));
      links.sort((a, b) => {
        const height = link => (link.a === foot.entry ? link.b : link.a).body.getWorldCenterOfMass().y;
        return height(b) - height(a);
      });
      return { foot, link: links[0], score: foot.contact.y + random() * .18 };
    }).filter(candidate => candidate.link).sort((a, b) => a.score - b.score);
    if (!candidates.length) return;
    Object.assign(leg, { foot: candidates[0].foot, link: candidates[0].link,
      duration: 1.15 + random() * .55, stride: .5 + random() * .25 });
  }
  function releaseClench(state) {
    for (const { link } of state.clench.links) {
      link.joint.setTargetRotation(identity);
      link.joint.setSpringHertz(link.options.hertz); link.joint.setSpringDampingRatio(link.options.dampingRatio);
      link.joint.setConeLimit(link.options.coneAngle); link.joint.setTwistLimits(link.options.lowerTwistAngle, link.options.upperTwistAngle);
    }
    state.clench.links = []; state.clench.amount = 0;
  }
  function beginClench(state) {
    releaseClench(state);
    state.clench.selectedRear = candidates().map(other => ({ index: other.index, position: other.supportCenter.dot(direction) }));
    state.clench.startRadius = state.supportFeet.reduce((sum, foot) => sum + foot.center.distanceToSquared(state.supportCenter) * foot.mass, 0) / state.supportMass;
    for (const link of state.rig.joints) {
      if (![link.a, link.b].every(entry => state.supportFeet.some(foot => foot.entry === entry))) continue;
      anchor.copy(link.a.body.getWorldPoint(link.options.localFrameA.position));
      point.copy(link.b.body.getWorldCenterOfMass()).sub(anchor);
      desired.copy(state.supportCenter).sub(anchor);
      if (point.lengthSq() < 1e-5 || desired.lengthSq() < 1e-5) continue;
      curl.setFromUnitVectors(point.normalize(), desired.normalize());
      const angle = 2 * Math.acos(Math.min(1, Math.abs(curl.w)));
      if (angle > 1.05) curl.slerp(identity, 1 - 1.05 / angle);
      frameA.copy(link.a.body.getRotation()).multiply(new Quaternion().copy(link.options.localFrameA.rotation));
      frameB.copy(link.b.body.getRotation()).multiply(new Quaternion().copy(link.options.localFrameB.rotation));
      const from = frameA.clone().invert().multiply(frameB);
      const to = frameA.clone().invert().multiply(curl).multiply(frameB);
      state.clench.links.push({ link, from, to });
    }
    state.hop.phase = 'crouch';
  }
  function updateClench(state, beat) {
    const progress = Math.max(0, Math.min(1, (beat - scheduledBeat + CROUCH_BEATS) / (CROUCH_BEATS * .8)));
    state.clench.amount = progress * progress * (3 - 2 * progress);
    for (const { link, from, to } of state.clench.links) {
      link.joint.setConeLimit(Math.PI * .4); link.joint.setTwistLimits(-Math.PI * .4, Math.PI * .4);
      link.joint.setSpringHertz(8); link.joint.setSpringDampingRatio(1);
      link.joint.setTargetRotation(curl.copy(from).slerp(to, state.clench.amount));
      link.a.body.setAwake(true); link.b.body.setAwake(true);
    }
  }
  function steer(state, dt) {
    const lateral = (pack.x - state.supportCenter.x) * sideways.x + (pack.z - state.supportCenter.z) * sideways.z;
    const longitudinal = (pack.x - state.supportCenter.x) * direction.x + (pack.z - state.supportCenter.z) * direction.z;
    const sway = Math.sin(elapsed * state.gait.swayRate + state.gait.phase) * .55
      + Math.sin(elapsed * .23 + state.gait.phase * 1.7) * .2;
    // When jumps are disabled, lateral gathering supplies the mixing that
    // rear-to-front crossings otherwise provide.
    const cohesion = jumpPower === 0 ? .18 : .15;
    desired.copy(direction).multiplyScalar(.65 * state.gait.drive + Math.max(-.45, Math.min(.65, longitudinal * .1)))
      .addScaledVector(sideways, Math.max(-1, Math.min(1, lateral * cohesion)) + sway * (1 + state.gait.pulse * .7));
    state.direction.lerp(desired.normalize(), Math.min(1, dt * 2.5)).normalize();
  }
  const contactsOf = state => state.supportFeet.filter(foot => foot.contact.y < .06);
  const readyToJump = state => state.hop.phase === 'settle' && state.hop.remaining <= 0 && contactsOf(state).length;
  const rearOrder = (a, b) => a.supportCenter.dot(direction) - b.supportCenter.dot(direction) || a.index - b.index;
  function candidates() {
    return states.filter(state => state.supportMass > 0 && !state.rig.dragging
      && readyToJump(state)).sort(rearOrder);
  }
  function nextRear() {
    // A short hop or recovery must not hand the rear body's long jump to a
    // forward neighbor. Only an ongoing long leap or a grab removes its turn.
    return states.filter(state => state.supportMass > 0 && !state.rig.dragging
      && (!['flight', 'land'].includes(state.hop.phase) || state.hop.lastLaunch?.small))
      .sort(rearOrder)[0];
  }
  function launch(state, beat, gravity, small = false) {
    const contacts = contactsOf(state);
    const power = jumpPower * (small ? smallJumpPercent / 100 : 1);
    if (!contacts.length || gravity <= 0 || power <= 0 || state.rig.dragging) return false;
    const eligibleRear = small ? [] : state.clench.selectedRear;
    const clench = state.clench.amount;
    releaseClench(state); releaseHarmony(state);
    for (const leg of state.legs) release(state, leg);
    // Measure the actual leading hull edge, including bodies already crossing.
    // Future landing targets are not positions and must not extend this bound.
    const front = Math.max(...states.filter(other => !other.rig.dragging && other.supportMass > 0).map(other => other.front));
    const length = states.reduce((sum, other) => sum + other.bodyLength, 0) / states.length;
    const start = state.supportCenter.clone();
    let target = pack.clone();
    if (!small) {
      const laneWidth = length * .85, lateralCenter = pack.dot(sideways);
      const neighbors = states.filter(other => other !== state);
      const lanes = (neighbors.length ? [-1, 0, 1] : [0]).map(lane => {
        const target = direction.clone().multiplyScalar(front + state.bodyLength)
          .addScaledVector(sideways, lateralCenter + lane * laneWidth);
        const clearance = neighbors.length ? Math.min(...neighbors.map(other => {
          const p = other.hop.phase === 'flight' ? other.hop.lastLaunch.target : other.supportCenter;
          return Math.hypot(p.x - target.x, p.z - target.z);
        })) : 0;
        // Prefer a clear continuation of the animal's lane. Crossing diagonally
        // through another launch path can knock both bodies out of their arcs.
        const lateralTravel = Math.abs(target.clone().sub(state.supportCenter).dot(sideways));
        return { target, clearance: clearance - lateralTravel * .65 };
      }).sort((a, b) => b.clearance - a.clearance);
      target = lanes[0].target;
    }
    target.y = start.y;
    const distance = Math.hypot(target.x - start.x, target.z - start.z);
    // Tall enough to pass above another body while rotating, even on a short
    // crossing; longer crossings get more hang time without faster cadence.
    const height = Math.max(state.bodyLength * 1.65, length * 1.55, distance * .46);
    const launchSpeed = Math.sqrt(2 * gravity * height), flightTime = 2 * launchSpeed / gravity;
    velocity.copy(target).sub(start).divideScalar(flightTime); velocity.y = launchSpeed;
    const turns = small ? 0 : .8 + state.random() * .35;
    spin.copy(sideways).multiplyScalar(-Math.PI * 2 * turns / flightTime);
    // A contact-gated push-off is transmitted across the connected hulls. The
    // coherent linear + angular impulse avoids tearing one foot off the rig.
    // Power scales the launch impulse and added spin; 1 preserves the original
    // strength. It happens once at takeoff, leaving transforms to the solver.
    impulse.copy(velocity).sub(state.supportVelocity).multiplyScalar(state.supportMass * power);
    for (const foot of state.supportFeet) {
      const body = foot.entry.body;
      body.setLinearDamping(.015); body.setAngularDamping(.03); body.setBullet(true);
      point.copy(foot.center).sub(start).crossVectors(spin, point).add(velocity).sub(foot.velocity).multiplyScalar(foot.mass * power);
      body.applyLinearImpulse(point, foot.center, true);
      body.setAngularVelocity(point.copy(body.getAngularVelocity()).lerp(spin, power)); body.setAwake(true);
    }
    state.hop.phase = 'flight'; state.hop.remaining = small ? Math.min(.15, flightTime * power * .5) : .15;
    const launch = { time: elapsed, beat, actualBeat: getBeat?.() ?? elapsed * bpm / 60,
      small, front, target, start, flightTime, turns, power, clench, bodyLength: state.bodyLength, targetHeight: height,
      contactY: Math.max(...contacts.map(foot => foot.contact.y)), impulse: impulse.clone(),
      feet: contacts.map(foot => ({ index: foot.index, contactY: foot.contact.y })),
      eligibleRear, direction: direction.clone() };
    state.hop.lastLaunch = launch;
    if (small) { state.hop.smallJumps++; state.hop.lastSmallJump = launch; }
    else { state.hop.kicks++; state.hop.lastKick = launch; }
    return true;
  }
  function updateHop(state, dt) {
    const hop = state.hop;
    hop.remaining -= dt;
    if (hop.phase === 'flight') {
      if (hop.remaining <= 0 && contactsOf(state).length && state.supportVelocity.y <= .5) {
        // Absorb the impact before restoring ordinary drag. Otherwise the
        // forward somersault becomes a long roll that stretches the pack.
        for (const foot of state.supportFeet) {
          foot.entry.body.setLinearDamping(8); foot.entry.body.setAngularDamping(10);
          foot.entry.body.setBullet(foot.bullet);
        }
        if (!hop.lastLaunch.small) hop.lastLanding = { time: elapsed, center: state.supportCenter.clone(), kick: hop.kicks };
        hop.phase = 'land'; hop.remaining = hop.lastLaunch.small ? .08 : .35;
      }
      return true;
    }
    if (hop.phase === 'land') {
      if (hop.remaining > 0) return true;
      restoreFlight(state); hop.phase = 'settle'; hop.remaining = hop.lastLaunch.small ? 0 : .2;
    }
    return hop.phase !== 'crouch';
  }
  function scheduleJump(beat, gravity) {
    // Audio unlock/restart may rewind the transport. Frame stalls skip missed
    // beats instead of firing a rapid catch-up burst off the rhythmic grid.
    if (beat < previousBeat - .01 || beat > scheduledBeat + .3) {
      if (queued) { queued.hop.phase = 'settle'; releaseClench(queued); for (const leg of queued.legs) release(queued, leg); }
      queued = null; scheduledBeat = (Math.floor(beat / JUMP_BEATS) + 1) * JUMP_BEATS;
    }
    previousBeat = beat;
    if (jumpPower === 0) {
      if (queued) {
        queued.hop.phase = 'settle'; releaseClench(queued);
        for (const leg of queued.legs) release(queued, leg);
        queued = null;
      }
      scheduledBeat = (Math.floor(beat / JUMP_BEATS) + 1) * JUMP_BEATS;
      return;
    }
    if (!queued && beat >= scheduledBeat - CROUCH_BEATS && beat < scheduledBeat && gravity > 0) {
      const rear = smallJumpPercent > 0 ? nextRear() : candidates()[0];
      queued = rear && readyToJump(rear) ? rear : null;
      if (queued) beginClench(queued);
    }
    if (beat + 1e-7 >= scheduledBeat) {
      // Commit to the animal that visibly prepared the jump. If a grab or
      // collision interrupts it, rest this pulse instead of launching an
      // unprepared neighbor without anticipation.
      if (queued) {
        if (!launch(queued, scheduledBeat, gravity)) {
          queued.hop.phase = 'settle'; releaseClench(queued);
          for (const leg of queued.legs) release(queued, leg);
        }
      }
      // Reserve the next rear body before assigning small hops, so it can
      // plant and prepare the following long leap instead of hopping again.
      const rear = nextRear();
      if (smallJumpPercent > 0) for (const state of candidates()) {
        if (state !== queued && state !== rear) launch(state, scheduledBeat, gravity, true);
      }
      queued = null; scheduledBeat += JUMP_BEATS;
    }
  }
  const unsubscribe = physics.onBeforeStep(dt => {
    if (states.some((state, i) => state.rig !== group.views[i]?.rig)) reset();
    if (!states.length) return;
    elapsed += dt;
    const friction = baseFriction(), gravity = Math.abs(physics.world.getGravity().y), muscleGravity = Math.max(1, gravity);
    pack.set(0, 0, 0);
    for (const state of states) { measure(state); pack.add(state.supportCenter); }
    pack.divideScalar(states.length);
    // Restore last tick's free joints before walking or clenching claims them.
    for (const state of states) { releaseHarmony(state); updateHop(state, dt); }
    harmonyAge = Math.min(HARMONY_DURATION, harmonyAge + dt);
    harmonyAmount = harmonyAge < HARMONY_DURATION - 1e-9 ? Math.sin(Math.PI * harmonyAge / HARMONY_DURATION) * harmonyStrength : 0;
    const beat = getBeat?.() ?? elapsed * bpm / 60;
    const groove = getGroove?.(beat);
    const bass = Math.max(0, Math.min(1, groove?.bass ?? 0)), kick = Math.max(0, Math.min(1, groove?.kick ?? 0));
    const energy = Math.max(0, Math.min(1, groove?.energy ?? 0));
    scheduleJump(beat, gravity);
    for (const state of states) {
      state.active = [];
      // The same short bass notes that are heard push the gait forward. A small
      // individual phase offset keeps the herd from marching in lockstep.
      state.gait.pulse += (bass * .85 + kick * .3 - state.gait.pulse) * Math.min(1, dt * 22);
      state.gait.drive = 1 + energy * .45 + state.gait.pulse * .8;
      if (!state.mass) continue;
      if (state.rig.dragging) {
        for (const leg of state.legs) release(state, leg);
        restoreFlight(state); releaseClench(state);
        state.hop.phase = 'settle'; state.hop.remaining = .5;
        if (queued === state) queued = null;
        for (const foot of state.feet) for (const shape of foot.entry.shapes) shape.setFriction(friction);
        continue;
      }
      // Grounded members keep taking small, unsynchronized steps. Launching,
      // landing and airborne bodies release every drive/anchor.
      const compressedContact = state.supportFeet.some(foot => foot.contact.y < -state.bodyLength * .025);
      if (['flight', 'land'].includes(state.hop.phase) || !contactsOf(state).length || (state.hop.phase === 'settle' && (state.hop.remaining > 0 || compressedContact))) {
        for (const leg of state.legs) release(state, leg);
        for (const foot of state.feet) for (const shape of foot.entry.shapes) shape.setFriction(friction * (state.hop.phase === 'land' ? 2.5 : 1));
        continue;
      }
      steer(state, dt);
      for (const foot of state.feet) for (const shape of foot.entry.shapes) shape.setFriction(friction * .25);
      for (const leg of state.legs) {
        const crouching = state.hop.phase === 'crouch';
        if (!crouching) leg.phase += dt * state.gait.drive / leg.duration;
        if (leg.phase >= 1) {
          leg.phase %= 1; state.gait.steps++;
          if (!leg.foot || leg.foot.contact.y > .5) chooseFoot(state, leg);
          else leg.duration = 1.1 + random() * .65;
        }
        if (!leg.foot) { chooseFoot(state, leg); if (!leg.foot) continue; }
        const stance = crouching || leg.phase < .62, grounded = leg.foot.contact.y < .04;
        leg.stage = stance ? (grounded ? (crouching ? 'crouch' : 'stance') : 'airborne') : 'swing';
        if (leg.muscle && leg.stroke !== leg.stage) { physics.removeJoint(leg.muscle); leg.muscle = null; }
        if ((!stance || !grounded) && leg.plant) { physics.removeJoint(leg.plant); leg.plant = null; }
        if (stance && !grounded) { release(state, leg); leg.phase = .62; continue; }
        if (stance && ground && !leg.plant) {
          leg.plant = physics.addMotorJoint(ground.entry, leg.foot.entry, {
            localFrameA: { position: ground.entry.body.getLocalPoint(point.copy(leg.foot.contact).setY(0)) },
            localFrameB: { position: leg.foot.entry.body.getLocalPoint(leg.foot.contact) },
            linearHertz: 18, linearDampingRatio: 1,
            maxSpringForce: state.mass * muscleGravity * 1.5,
            maxSpringTorque: 0, maxVelocityForce: 0, maxVelocityTorque: 0, collideConnected: true,
          });
        }
        if (!leg.muscle) {
          const hip = leg.link.a === leg.foot.entry ? leg.link.b : leg.link.a;
          const a = stance ? leg.foot.entry : hip, b = stance ? hip : leg.foot.entry;
          point.copy(b.body.getWorldCenterOfMass()).addScaledVector(state.direction, crouching ? .1 : leg.stride * state.gait.drive * (stance ? 1 : 1.3));
          const hipClearance = state.feet.find(foot => foot.entry === hip)?.contact.y ?? 0;
          // Crouch only as far as the hip's hull can clear the ground.
          point.y += crouching ? -Math.min(.65, Math.max(0, hipClearance - .04)) : (stance ? .22 : .48) * (1 + state.gait.pulse);
          leg.muscle = physics.addMotorJoint(a, b, {
            localFrameA: { position: a.body.getLocalPoint(point) },
            localFrameB: { position: b.body.getLocalCenterOfMass() },
            linearHertz: stance ? 10 : 8, linearDampingRatio: 1,
            maxSpringForce: state.supportMass * muscleGravity * (crouching ? 1.5 : stance ? .9 : .55),
            maxSpringTorque: 0, maxVelocityForce: 0, maxVelocityTorque: 0, collideConnected: false,
          });
          leg.stroke = leg.stage;
        }
        curl.setFromAxisAngle(rockAxis, Math.sin(beat * Math.PI + state.gait.phase) * state.gait.pulse * .24);
        nod.setFromAxisAngle(nodAxis, state.gait.pulse * .2);
        // A planted foot bears weight; rocking acts through the free leg so
        // the beat does not torque a supporting hull down into the floor.
        leg.link.joint.setTargetRotation(stance ? identity : curl.multiply(nod));
        leg.link.joint.setConeLimit(Math.PI / 3); leg.link.joint.setTwistLimits(-Math.PI / 3, Math.PI / 3);
        leg.link.joint.setSpringHertz(2 + state.gait.pulse * 2); leg.link.joint.setSpringDampingRatio(.9);
        for (const shape of leg.foot.entry.shapes) shape.setFriction(friction * (stance ? 2.5 : .2));
        if (stance) { state.active.push(leg.foot.entry); leg.foot.entry.body.setAwake(true); }
      }
      if (state.hop.phase === 'crouch') updateClench(state, beat);
      else flexHarmony(state);
    }
    return { substeps: states.some(state => ['crouch', 'flight', 'land'].includes(state.hop.phase) || state.supportVelocity.lengthSq() > 225) ? 8 : 4 };
  });
  const unsubscribeSync = physics.onSync(() => {
    for (const [i, state] of states.entries()) {
      if (state.rig !== group.views[i]?.rig) continue;
      for (const leg of state.legs) if (leg.plant) {
        const { a, b, options } = leg.plant;
        anchor.copy(a.body.getWorldPoint(options.localFrameA.position));
        point.copy(b.body.getWorldPoint(options.localFrameB.position));
        // A landing or another blob can overpower the grip. Let that foot
        // slip and recover instead of tethering the animal to an old contact.
        if (anchor.distanceToSquared(point) > .25 ** 2) {
          state.active = state.active.filter(entry => entry !== leg.foot.entry);
          release(state, leg); leg.phase = .62;
        }
      }
    }
  });
  reset();
  return { reset, triggerHarmony,
    configure({ jumpPower: value = jumpPower, smallJumpPercent: percent = smallJumpPercent }) {
      if (!Number.isFinite(value) || value < 0 || value > 1) throw new Error('Invalid Jump power.');
      if (!Number.isFinite(percent) || percent < 0 || percent > 100) throw new Error('Invalid Small jump force.');
      jumpPower = value; smallJumpPercent = percent;
    },
    get jumpPower() { return jumpPower; },
    get smallJumpPercent() { return smallJumpPercent; },
    get harmony() { return { chords: harmonyChords, beat: harmonyBeat, amount: harmonyAmount }; },
    get states() { return states; }, get elapsed() { return elapsed; },
    get direction() { return direction.clone(); }, get scheduledBeat() { return scheduledBeat; },
    dispose() { unsubscribe(); unsubscribeSync(); for (const [i, state] of states.entries()) if (state.rig === group.views[i]?.rig) relax(state); states = []; },
  };
}
