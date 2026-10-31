import test from 'node:test';
import assert from 'node:assert/strict';
import { Scene, Vector3 } from 'three';
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
function fixture(gravity = 18, spread = 2.6, jumpPower = 1, getGroove) {
  const settings = mergeMeshSetup(defaultMeshSetup(), { rigidBody: { gravity, friction: .55 },
    pipeline: { seed: 732233, initialDiamondDualEnabled: true, hexelateEnabled: true, finalAverageVerticesEnabled: true }, boxes: { spread } });
  const scene = new Scene(), physics = createPhysics(settings.rigidBody), material = createFaceMetal();
  const group = createSculptureGroup(scene, material, physics), ground = createHerdGround(scene, physics, settings.floor);
  group.setSources(createHerdSources(settings.pipeline.seed, settings.boxes.spread), settings);
  const score = createHerdScore(settings.pipeline.seed);
  const motion = createHerdMotion(physics, group, ground, { jumpPower, getGroove: getGroove ?? score.motionAt });
  return { settings, physics, group, ground, motion, dispose() { motion.dispose(); group.dispose(); ground.dispose(); material.dispose(); physics.dispose(); } };
}

for (const [gravity, spread] of [[18, 2.6], [100, 2]]) test(`seven rear-to-front somersaults stay rhythmic and grounded at takeoff (gravity ${gravity})`, () => {
  const { physics, group, motion, dispose } = fixture(gravity, spread);
  try {
    const start = group.getCenter(new Vector3()), baseJoints = physics.joints.length;
    const counts = Array(7).fill(0), clearance = Array(7).fill(0), lands = Array(7).fill(0), kickBeats = [];
    let minRelativeY = 0, maxSpan = 0, frontLandings = 0, totalLandings = 0;
    for (let frame = 0; frame < 1800; frame++) {
      physics.step(1 / 30);
      const projections = motion.states.map(state => state.supportCenter.dot(motion.direction));
      maxSpan = Math.max(maxSpan, Math.max(...projections) - Math.min(...projections));
      for (const [i, state] of motion.states.entries()) {
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
    assert.equal(physics.entries.length, 36); motion.reset(); assert.equal(physics.joints.length, baseJoints);
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
      assert.equal(physics.entries.length, 36);
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
