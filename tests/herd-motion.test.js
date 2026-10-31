import test from 'node:test';
import assert from 'node:assert/strict';
import { Quaternion, Scene, Vector3 } from 'three';
import { initCSG } from '../src/box-union.js';
import { initPhysics, createPhysics } from '../src/physics.js';
import { createFaceMetal } from '../src/face-metal.js';
import { createHerdSources, createSculptureGroup } from '../src/sculpture-group.js';
import { createHerdGround } from '../src/herd-ground.js';
import { createHerdMotion } from '../src/herd-motion.js';
import { createHerdScore } from '../src/herd-score.js';
import { HERD_BPM, JUMP_BEATS } from '../src/herd-rhythm.js';
import { defaultMeshSetup, mergeMeshSetup } from '../src/mesh-settings.js';

await initCSG(); await initPhysics();
function fixture(gravity = 18, spread = 2.6, jumpPower = 1, getGroove, smallJumpPercent = 0) {
  const settings = mergeMeshSetup(defaultMeshSetup(), { rigidBody: { gravity, friction: .55 },
    pipeline: { seed: 732233, initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true }, boxes: { spread } });
  const scene = new Scene(), physics = createPhysics(settings.rigidBody), material = createFaceMetal();
  const group = createSculptureGroup(scene, material, physics), ground = createHerdGround(scene, physics, settings.floor);
  group.setSources(createHerdSources(settings.pipeline.seed, settings.boxes.spread), settings);
  const score = createHerdScore(settings.pipeline.seed);
  const motion = createHerdMotion(physics, group, ground, { jumpPower, smallJumpPercent, getGroove: getGroove ?? score.motionAt });
  return { settings, physics, group, ground, motion, dispose() { motion.dispose(); group.dispose(); ground.dispose(); material.dispose(); physics.dispose(); } };
}

for (const [gravity, spread] of [[18, 2.6], [100, 2]]) test(`seven rear-to-front somersaults stay rhythmic and grounded at takeoff (gravity ${gravity})`, () => {
  const { physics, group, ground, motion, dispose } = fixture(gravity, spread);
  try {
    const start = group.getCenter(new Vector3()), baseJoints = physics.joints.length;
    const counts = Array(7).fill(0), clearance = Array(7).fill(0), lands = Array(7).fill(0), kickBeats = [];
    let minRelativeY = 0, maxSpan = 0, frontLandings = 0, totalLandings = 0;
    for (let frame = 0; frame < 1800; frame++) {
      physics.step(1 / 30);
      const projections = motion.states.map(state => state.supportCenter.dot(motion.direction));
      maxSpan = Math.max(maxSpan, Math.max(...projections) - Math.min(...projections));
      for (const [i, state] of motion.states.entries()) {
        for (const leg of state.legs) if (leg.plant) assert.equal(leg.plant.a, ground.anchor, 'Foot plants stay fixed when the floor follows.');
        clearance[i] = Math.max(clearance[i], Math.min(...state.supportFeet.map(foot => foot.contact.y)));
        minRelativeY = Math.min(minRelativeY, ...state.supportFeet.map(foot => foot.contact.y / state.bodyLength));
        assert.ok(state.rig.positions.every(Number.isFinite));
        if (state.hop.kicks > counts[i]) {
          counts[i] = state.hop.kicks;
          const kick = state.hop.lastKick; kickBeats.push(kick.beat);
          assert.equal(kick.beat % JUMP_BEATS, 0);
          assert.ok(Math.abs(kick.actualBeat - kick.beat) < HERD_BPM / 60 / 120 + 1e-6, 'Takeoff must land on the shared beat.');
          assert.equal(kick.eligibleRear[0].index, i, 'Choose the rearmost available grounded animal.');
          assert.ok(Math.abs(kick.target.dot(motion.direction) - kick.front - kick.bodyLength) < 1e-6, 'Aim one body length beyond the leading hull edge.');
          assert.ok(kick.target.clone().sub(kick.start).dot(motion.direction) > 0);
          assert.ok(kick.contactY < .06 && kick.feet.length > 0);
          assert.ok(state.legs.every(leg => !leg.plant && !leg.muscle));
          assert.ok(kick.turns >= .8 && kick.turns <= 1.15);
          assert.ok(kick.clench > .9, 'Every takeoff must follow a completed clench.');
        }
        const landing = state.hop.lastLanding;
        if (landing && landing.kick > lands[i]) {
          lands[i] = landing.kick; totalLandings++;
          if (landing.center.dot(motion.direction) > state.hop.lastKick.front - state.bodyLength) frontLandings++;
        }
      }
      assert.ok(physics.joints.length <= baseJoints + 4 * motion.states.length, 'Each animal has at most two foot anchors and two muscles.');
    }
    assert.ok(counts.every(count => count >= 2), `All seven must take turns: ${counts}`);
    assert.ok(kickBeats.every((beat, i) => i === 0 || (beat - kickBeats[i - 1]) % JUMP_BEATS === 0));
    assert.ok(kickBeats.filter((beat, i) => i > 0 && beat - kickBeats[i - 1] === 1).length > kickBeats.length * .8,
      'Successive kicks must launch successive bodies, rather than only every other kick.');
    assert.ok(clearance.every((value, i) => value > motion.states[i].bodyLength), `Every animal must clear its neighbors: ${clearance}`);
    assert.ok(frontLandings / totalLandings >= .8, `Land near the front after crossing: ${frontLandings}/${totalLandings}`);
    assert.ok(minRelativeY > -.08, `No body should tunnel through the ground: ${minRelativeY}`);
    assert.ok(maxSpan < 65, `The herd should stay together: ${maxSpan}`);
    assert.ok(group.getCenter(new Vector3()).sub(start).dot(motion.direction) > 20);
    assert.equal(physics.entries.length, 37); motion.reset(); assert.equal(physics.joints.length, baseJoints);
  } finally { dispose(); }
});

test('grabbing pauses that blob’s drive and resets replay the same seeded movement', () => {
  const { settings, physics, group, motion, dispose } = fixture();
  try {
    const capture = () => group.views.flatMap(view => view.rig.entries.map(({ body }) => body.getPosition()));
    for (let i = 0; i < 180; i++) physics.step(1 / 120);
    const first = capture(); physics.reset(); group.setSources(group.sources, settings); motion.reset();
    for (let i = 0; i < 180; i++) physics.step(1 / 120);
    const replay = capture();
    first.forEach((point, i) => assert.ok(new Vector3().copy(point).distanceTo(new Vector3().copy(replay[i])) < .02));
    const rig = group.views[0].rig, entry = rig.entries[0], point = new Vector3().copy(entry.body.getWorldCenterOfMass());
    assert.equal(rig.beginDrag(entry, point), true);
    for (let i = 0; i < 120; i++) {
      physics.step(1 / 120); assert.equal(motion.states[0].active.length, 0);
      assert.ok(motion.states[0].legs.every(leg => !leg.plant && !leg.muscle));
    }
    rig.endDrag();
    let resumed = false;
    for (let i = 0; i < 750; i++) { physics.step(1 / 30); resumed ||= motion.states[0].hop.kicks > 0; }
    assert.ok(resumed);
  } finally { dispose(); }
});

test('grabbing or resetting during a leap restores normal drag and collision settings', () => {
  const { physics, motion, dispose } = fixture(100, 2);
  try {
    const waitForLeap = () => {
      for (let i = 0; i < 1200; i++) {
        physics.step(1 / 120);
        const state = motion.states.find(state => state.hop.phase === 'flight');
        if (state) return state;
      }
      assert.fail('Expected a leap within ten seconds.');
    };
    const assertRestored = state => state.supportFeet.forEach(foot => {
      assert.equal(foot.entry.body.getLinearDamping(), foot.damping);
      assert.equal(foot.entry.body.isBullet(), foot.bullet);
    });
    const grabbed = waitForLeap();
    assert.ok(grabbed.supportFeet.every(foot => foot.entry.body.getLinearDamping() < .1 && foot.entry.body.isBullet()));
    const foot = grabbed.supportFeet[0];
    grabbed.rig.beginDrag(foot.entry, new Vector3().copy(foot.entry.body.getWorldCenterOfMass()));
    physics.step(1 / 120); assertRestored(grabbed); grabbed.rig.endDrag();
    waitForLeap(); const oldStates = motion.states;
    motion.reset(); oldStates.forEach(assertRestored);
  } finally { dispose(); }
});

test('an airborne herd has no planted feet or forward propulsion', () => {
  const { physics, group, motion, dispose } = fixture();
  try {
    physics.configure({ gravity: 0 });
    for (const view of group.views) for (const { body } of view.rig.entries) {
      body.setTransform(new Vector3().copy(body.getPosition()).add(new Vector3(0, 30, 0)), body.getRotation());
    }
    physics.sync(); motion.reset(); const start = group.getCenter(new Vector3());
    for (let i = 0; i < 360; i++) {
      physics.step(1 / 120);
      assert.ok(motion.states.every(state => state.active.length === 0 && state.hop.kicks === 0 && state.hop.phase !== 'crouch' && state.clench.amount === 0));
    }
    const end = group.getCenter(new Vector3()); assert.ok(Math.hypot(end.x-start.x, end.z-start.z) < .001);
  } finally { dispose(); }
});

test('rebuilding a crouching herd removes old foot anchors and safely binds the new rigs', () => {
  const { settings, physics, group, ground, motion, dispose } = fixture();
  try {
    for (let cycle = 0; cycle < 3; cycle++) {
      let crouched = false;
      for (let i = 0; i < 90; i++) { physics.step(1 / 30); crouched ||= motion.states.some(state => state.legs.some(leg => leg.plant || leg.muscle)); }
      assert.ok(crouched);
      const oldEntries = group.views.flatMap(view => view.rig.entries);
      group.setSources(createHerdSources(settings.pipeline.seed + cycle + 1, settings.boxes.spread), settings);
      assert.equal(physics.entries.length, 37);
      assert.ok(physics.joints.every(joint => !oldEntries.includes(joint.a) && !oldEntries.includes(joint.b)));
      physics.step(1 / 120);
      motion.states.forEach((state, i) => assert.equal(state.rig, group.views[i].rig));
    }
    motion.dispose();
    assert.equal(physics.joints.length, group.views.reduce((sum, view) => sum + view.rig.joints.length, 0));
    for (const view of group.views) for (const { shapes } of view.rig.entries) for (const shape of shapes) {
      assert.ok(Math.abs(shape.getFriction() - ground.entry.shapes[0].getFriction()) < 1e-6);
    }
  } finally { dispose(); }
});

test('jump power scales takeoff strength and zero disables both launch and crouch', () => {
  const launches = [], heights = [];
  for (const power of [1, 1 / 3, 0]) {
    const { physics, motion, dispose } = fixture(100, 2, power);
    try {
      let jumper, peak = 0;
      for (let frame = 0; frame < 65; frame++) {
        physics.step(1 / 30);
        jumper ??= motion.states.find(state => state.hop.kicks > 0);
        if (jumper) peak = Math.max(peak, jumper.supportCenter.y - jumper.hop.lastKick.start.y);
        if (power === 0) assert.ok(motion.states.every(state => state.hop.kicks === 0 && state.hop.phase !== 'crouch' && state.clench.amount === 0));
      }
      if (power > 0) { assert.ok(jumper); launches.push(jumper.hop.lastKick); heights.push(peak); }
      else {
        assert.equal(jumper, undefined);
        motion.configure({ jumpPower: 1 / 3 });
        for (let frame = 0; frame < 40; frame++) physics.step(1 / 30);
        assert.ok(motion.states.some(state => state.hop.kicks > 0), 'Raising the slider resumes jumps on the beat.');
      }
    } finally { dispose(); }
  }
  assert.equal(launches[0].beat, launches[1].beat);
  assert.ok(Math.abs(launches[1].impulse.length() / launches[0].impulse.length() - 1 / 3) < 1e-6);
  assert.ok(heights[1] > 0 && heights[1] < heights[0] * .3, `Lower power must visibly lower the arc: ${heights}`);
});

for (const gravity of [18, 100]) test(`small beat jumps aim at the herd center without replacing the prepared leaps (gravity ${gravity})`, () => {
  const { physics, motion, dispose } = fixture(gravity, 2.3, .762, undefined, 20);
  try {
    const counts = Array(7).fill(0), bigCounts = Array(7).fill(0), bigBeats = new Set();
    let raised = false, minRelativeY = 0;
    for (let tick = 0; tick < 2400; tick++) {
      physics.step(1 / 120);
      for (const state of motion.states) {
        assert.ok(state.rig.positions.every(Number.isFinite));
        minRelativeY = Math.min(minRelativeY, ...state.supportFeet.map(foot => foot.contact.y / state.bodyLength));
        if (state.hop.kicks > bigCounts[state.index]) {
          bigCounts[state.index] = state.hop.kicks;
          assert.ok(!bigBeats.has(state.hop.lastKick.beat), 'Only the prepared rear body makes a big jump.');
          bigBeats.add(state.hop.lastKick.beat);
          assert.ok(state.hop.lastKick.clench > .9);
        }
        if (state.hop.smallJumps > counts[state.index]) {
          counts[state.index] = state.hop.smallJumps;
          const hop = state.hop.lastSmallJump;
          assert.equal(hop.beat % JUMP_BEATS, 0);
          assert.ok(Math.abs(hop.actualBeat - hop.beat) < HERD_BPM / 60 / 120 + 1e-6);
          assert.ok(Math.abs(hop.power - .762 * .2) < 1e-10);
          assert.ok(hop.contactY < .06 && hop.feet.length > 0);
          const center = motion.states.reduce((sum, other) => sum.add(other.supportCenter), new Vector3()).divideScalar(motion.states.length);
          assert.ok(Math.hypot(hop.target.x - center.x, hop.target.z - center.z) < 1e-6, 'Small hops gather toward the current herd center.');
          assert.notEqual(state.hop.lastKick?.beat, hop.beat, 'Never give one body both impulses on a beat.');
          assert.ok(state.legs.every(leg => !leg.plant && !leg.muscle));
        }
        if (state.hop.phase === 'flight' && state.hop.lastLaunch.small)
          raised ||= state.supportCenter.y > state.hop.lastSmallJump.start.y + .05;
      }
    }
    assert.ok(counts.every(count => count > 0), `Each body should join the small jumps: ${counts}`);
    assert.ok(bigBeats.size > 10, `Small hops must leave room for big jumps: ${bigBeats.size}`);
    assert.ok(raised, 'Small jumps must physically lift the bodies.');
    assert.ok(minRelativeY > -.1, `No tunneling during shared beat jumps: ${minRelativeY}`);
    motion.configure({ smallJumpPercent: 0 });
    for (let tick = 0; tick < 240; tick++) physics.step(1 / 120);
    assert.deepEqual(motion.states.map(state => state.hop.smallJumps), counts, 'Zero disables only new small jumps.');
    assert.equal(motion.jumpPower, .762);
    motion.reset();
    assert.ok(motion.states.every(state => state.hop.smallJumps === 0 && state.hop.lastSmallJump === null));
  } finally { dispose(); }
});

test('small hops cannot take the next rear jumper or make a forward body take its long jump', () => {
  const { physics, motion, dispose } = fixture(100, 2.55, .762, undefined, 20);
  let preparations = 0, smallHops = 0;
  const previousPhases = Array(7).fill('settle'), counts = Array(7).fill(0);
  // Observe the exact decision before integration moves the bodies again.
  const unsubscribe = physics.onBeforeStep(() => {
    const rear = motion.states.filter(state => !state.rig.dragging && state.supportMass > 0
      && (!['flight', 'land'].includes(state.hop.phase) || state.hop.lastLaunch?.small))
      .sort((a, b) => a.supportCenter.dot(motion.direction) - b.supportCenter.dot(motion.direction) || a.index - b.index)[0];
    for (const state of motion.states) {
      if (state.hop.phase === 'crouch' && previousPhases[state.index] !== 'crouch') {
        preparations++;
        assert.equal(state.index, rear.index, 'Choose the rear body even when it is still recovering from a small hop.');
      }
      if (state.hop.smallJumps > counts[state.index]) {
        smallHops++;
        assert.notEqual(state.index, rear?.index, 'Keep the next rear jumper out of the small-hop group.');
      }
      previousPhases[state.index] = state.hop.phase;
      counts[state.index] = state.hop.smallJumps;
    }
  });
  try {
    for (let tick = 0; tick < 1800; tick++) physics.step(1 / 120);
    assert.ok(preparations > 10 && smallHops > 20);
  } finally { unsubscribe(); dispose(); }
});

test('one and eleven bodies rebuild their motion states and keep finite beat-driven jumps', () => {
  const { physics, group, settings, motion, dispose } = fixture(100, 2.3, .762, undefined, 20);
  try {
    for (const count of [1, 11, 1]) {
      group.setSources(createHerdSources(settings.pipeline.seed, settings.boxes.spread, count), settings);
      motion.reset();
      assert.equal(motion.states.length, count);
      for (let tick = 0; tick < 1200; tick++) {
        physics.step(1 / 120);
        for (const state of motion.states) {
          assert.ok(state.rig.positions.every(Number.isFinite));
          if (state.hop.lastKick) {
            const kick = state.hop.lastKick;
            assert.ok(kick.target.toArray().every(Number.isFinite));
            assert.ok(Math.abs(kick.target.dot(motion.direction) - kick.front - kick.bodyLength) < 1e-6);
          }
        }
      }
      assert.equal(physics.entries.length, count * 5 + 2);
      assert.ok(motion.states.some(state => state.hop.kicks > 0));
      if (count === 11) assert.ok(motion.states.some(state => state.hop.smallJumps > 0));
      else assert.equal(motion.states[0].hop.smallJumps, 0, 'The only body retains the long-jump turn.');
    }
  } finally { dispose(); }
});

test('the selected animal physically clenches its connected body before releasing on the beat', () => {
  const { physics, motion, dispose } = fixture(100, 2.3, .679);
  try {
    let compacted = false, charged = false, released = false;
    for (let frame = 0; frame < 180; frame++) {
      physics.step(1 / 60);
      for (const state of motion.states) {
        if (state.clench.amount > .95 && state.clench.links.length) {
          const radius = state.supportFeet.reduce((sum, foot) => sum + foot.center.distanceToSquared(state.supportCenter) * foot.mass, 0) / state.supportMass;
          compacted ||= radius < state.clench.startRadius * .85;
          charged = true;
        }
        if (state.hop.phase === 'flight') {
          assert.ok(state.hop.lastKick.clench > .9);
          assert.equal(state.clench.amount, 0); assert.equal(state.clench.links.length, 0);
          assert.ok(state.legs.every(leg => !leg.plant && !leg.muscle));
          released = true;
        }
      }
    }
    assert.ok(charged && compacted && released, 'Clench must change the physical body, then release its anchors.');
  } finally { dispose(); }
});

test('bass accents change physical motion and increase stepping without relying on jumps', () => {
  const results = [];
  for (const groove of [() => ({ bass: 0, kick: 0, energy: 0 }), undefined]) {
    const { physics, motion, dispose } = fixture(100, 2.3, 0, groove);
    try {
      for (let frame = 0; frame < 300; frame++) physics.step(1 / 30);
      results.push({ steps: motion.states.reduce((sum, state) => sum + state.gait.steps, 0),
        positions: motion.states.map(state => state.supportCenter.clone()) });
      assert.ok(motion.states.every(state => state.hop.kicks === 0 && state.rig.positions.every(Number.isFinite)));
    } finally { dispose(); }
  }
  assert.ok(results[1].steps > results[0].steps * 1.1, `The bass should quicken the herd: ${results.map(result => result.steps)}`);
  assert.ok(results[0].positions.some((position, i) => position.distanceTo(results[1].positions[i]) > 1), 'The score changes physical poses, not only bookkeeping.');
});

test('one harmony chord creates one physical flex and releases its free joints within 200 ms', () => {
  const poses = [];
  for (const enabled of [false, true]) {
    const { physics, motion, dispose } = fixture(100, 2.3, 0, () => ({ bass: 0, kick: 0, energy: 0 }));
    try {
      for (let i = 0; i < 240; i++) physics.step(1 / 120);
      const chord = ['f4', 'a4', 'b4'].map(note => ({ layer: 'keys', beat: 4, gain: .6, note }));
      motion.triggerHarmony([{ layer: 'hat', beat: 4, gain: .6 }]);
      assert.equal(motion.harmony.chords, 0);
      if (enabled) {
        motion.triggerHarmony(chord);
        assert.equal(motion.harmony.chords, 1, 'Three notes trigger one gesture.');
      }
      let flexed = 0;
      for (let i = 0; i < 24; i++) {
        if (enabled && i === 6) motion.triggerHarmony(chord.slice(1));
        physics.step(1 / 120);
        for (const state of motion.states) {
          flexed += state.harmony.active.length;
          for (const link of state.harmony.active) {
            assert.ok(!state.legs.some(leg => leg.link === link), 'Walking retains ownership of its leg joints.');
            assert.equal(state.hop.phase, 'settle');
          }
        }
      }
      if (enabled) { assert.ok(flexed > 0); assert.equal(motion.harmony.chords, 1, 'Late chord notes must not retrigger the flex.'); }
      else assert.equal(flexed, 0);
      poses.push(motion.states.flatMap(state => state.entries.map(entry => new Quaternion().copy(entry.body.getRotation()).normalize())));
      assert.equal(motion.harmony.amount, 0);
      assert.ok(motion.states.every(state => state.harmony.active.length === 0 && state.harmony.amount === 0));
      assert.equal(physics.entries.length, 37);
      motion.reset(); assert.equal(motion.harmony.chords, 0);
    } finally { dispose(); }
  }
  assert.ok(poses[0].some((rotation, i) => rotation.angleTo(poses[1][i]) > .01), 'Harmony must move the physical bodies, not just a visual parameter.');
});

test('harmony gestures yield to jumping, landing and grabbing while the herd stays finite', () => {
  const { physics, motion, dispose } = fixture(100, 2.3, .679);
  try {
    let flexed = false, jumped = false;
    for (let frame = 0; frame < 600; frame++) {
      if (frame % 30 === 0) motion.triggerHarmony(['f4', 'a4', 'b4'].map(note => ({ layer: 'keys', beat: frame / 30, gain: .6, note })));
      const grabbed = motion.states[0];
      if (frame === 120) {
        const foot = grabbed.supportFeet[0];
        grabbed.rig.beginDrag(foot.entry, new Vector3().copy(foot.entry.body.getWorldCenterOfMass()));
      }
      if (frame === 180) grabbed.rig.endDrag();
      physics.step(1 / 60);
      for (const state of motion.states) {
        assert.ok(state.rig.positions.every(Number.isFinite));
        flexed ||= state.harmony.active.length > 0;
        if (state.rig.dragging || state.hop.phase !== 'settle') {
          assert.equal(state.harmony.active.length, 0);
          assert.equal(state.harmony.amount, 0);
        }
        if (state.hop.lastKick) { jumped = true; assert.ok(state.hop.lastKick.clench > .9); }
      }
    }
    assert.ok(flexed && jumped);
    motion.reset();
    assert.ok(motion.states.every(state => state.harmony.active.length === 0));
  } finally { dispose(); }
});

test('all seven shuffle and bump their neighbors even when jump force is zero', () => {
  const { physics, group, motion, dispose } = fixture(100, 2.3, 0);
  try {
    const owners = new Map();
    for (const [i, state] of motion.states.entries()) for (const foot of state.supportFeet) for (const shape of foot.entry.shapes) {
      shape.enableContactEvents(true); owners.set(shape.getUserData(), i);
    }
    const start = group.views.map(view => view.getCenter(new Vector3()));
    const travel = Array(7).fill(0), stances = Array(7).fill(0), bumps = new Set();
    for (let frame = 0; frame < 900; frame++) {
      physics.step(1 / 30);
      for (const event of physics.world.getContactEvents().begin) {
        const a = owners.get(event.shapeUserDataA), b = owners.get(event.shapeUserDataB);
        if (a !== undefined && b !== undefined && a !== b) bumps.add([a, b].sort().join(':'));
      }
      for (const [i, state] of motion.states.entries()) {
        assert.equal(state.hop.kicks, 0); assert.equal(state.clench.amount, 0);
        travel[i] = Math.max(travel[i], state.supportCenter.clone().sub(start[i]).setY(0).length());
        stances[i] += state.active.length > 0 ? 1 : 0;
        assert.ok(state.rig.positions.every(Number.isFinite));
      }
    }
    assert.ok(stances.every(count => count > 20), `Every member needs an active gait: ${stances}`);
    assert.ok(motion.states.every(state => state.gait.steps > 10));
    assert.ok(travel.every(distance => distance > .5), `Every member should move between jumps: ${travel}`);
    assert.ok(bumps.size >= 3, `Neighbors should make physical contact: ${[...bumps]}`);
  } finally { dispose(); }
});
