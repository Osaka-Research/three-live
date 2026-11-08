/**
 * @license
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 *
 * @fileoverview Tests for the `xr-live-sim` trait schema: parsing, clamping,
 * and glTF / USDZ serialization of `character`, `agent`, `integrity`, `zone`,
 * `spawner`, `objective`, `audioCues`, and `collidable`.
 */

import THREE from '../src/three-author';
import {generateUSDA, sceneToCanvas3D} from '../src/three-convert';
import {
  AGENT_TARGET_USER,
  JOINT_TYPES,
  MAX_AGENT_WAYPOINTS,
  MAX_SPAWNER_ACTIVE,
  MAX_ZONE_WATCH_GROUPS,
  parseAgent,
  parseAudioCues,
  parseCharacter,
  parseIntegrity,
  parseJoint,
  parseObjective,
  parsePhysicsBody,
  parseRigidBody,
  parseSpawner,
  parseZone,
  registerSimTraitSchema,
  safeSimId,
} from '../src/xr-sim-schema';
import {
  buildUsdXRLines,
  buildXRSceneCoreExtension,
  flattenXRTraitsForUsd,
  normalizeXRTraits,
  registerXRTraitSerializer,
  validateXRTraits,
  XR_TRAIT_SCHEMA_VERSION,
} from '../src/xr-trait-schema';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string) {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

function near(a: number, b: number, eps = 1e-9): boolean {
  return Math.abs(a - b) <= eps;
}

function testSafeSimId() {
  console.log('\n🔤 safeSimId');
  assert(safeSimId('red-team_1') === 'red-team_1', 'accepts plain ids');
  assert(safeSimId('  operator ') === 'operator', 'trims whitespace');
  assert(safeSimId('a,b') === undefined, 'rejects commas');
  assert(safeSimId('has space') === undefined, 'rejects inner spaces');
  assert(safeSimId('') === undefined, 'rejects empty');
  assert(safeSimId('x'.repeat(65)) === undefined, 'rejects ids over 64 chars');
  assert(safeSimId('__proto__') === undefined, 'rejects __proto__');
  assert(safeSimId('constructor') === undefined, 'rejects constructor');
  assert(safeSimId(42) === undefined, 'rejects non-strings');
}

function testCharacter() {
  console.log('\n🏃 character');
  assert(parseCharacter(undefined) === null, 'absent → null');
  assert(parseCharacter(false) === null, 'false → null');
  assert(parseCharacter({enabled: false}) === null, 'enabled:false → null');
  const d = parseCharacter(true)!;
  assert(
    d.speed === 4 &&
      d.runMultiplier === 1.6 &&
      d.jumpVelocity === 5.5 &&
      d.gravity === 15 &&
      d.radius === 0.35 &&
      d.height === 1.4 &&
      d.cameraMode === 'third-person' &&
      d.cameraDistance === 3.5 &&
      d.cameraHeight === 1.8 &&
      Object.keys(d.clips).length === 0,
    'true → defaults',
  );
  const c = parseCharacter({
    speed: 999,
    runMultiplier: 0,
    jumpVelocity: -3,
    gravity: NaN,
    radius: 2,
    height: 1,
    cameraMode: 'orbit',
    clips: {idle: 'Idle', walk: '', run: 7, jump: 'J'.repeat(300), dance: 'D'},
  })!;
  assert(c.speed === 20, 'speed clamped to 20');
  assert(c.runMultiplier === 1, 'runMultiplier clamped to 1');
  assert(c.jumpVelocity === 0, 'negative jump clamped to 0');
  assert(c.gravity === 15, 'NaN gravity → default');
  assert(c.height === 4, 'height raised to capsule diameter');
  assert(c.cameraMode === 'third-person', 'unknown camera mode → default');
  assert(c.clips.idle === 'Idle', 'idle clip kept');
  assert(c.clips.walk === undefined, 'empty clip name dropped');
  assert(c.clips.run === undefined, 'non-string clip dropped');
  assert(c.clips.jump?.length === 128, 'clip name truncated to 128');
  assert(!('dance' in c.clips), 'unknown clip state ignored');
  assert(
    parseCharacter('first-person')!.cameraMode === 'first-person',
    'camera-mode string shorthand',
  );
  assert(
    parseCharacter('sideways')!.cameraMode === 'third-person',
    'unknown camera-mode string → default',
  );
  const big = parseCharacter({radius: 5})!;
  assert(big.height === 10, 'max radius keeps a valid height');
}

function testAgent() {
  console.log('\n🤖 agent');
  assert(parseAgent(null) === null, 'absent → null');
  assert(parseAgent({enabled: false}) === null, 'enabled:false → null');
  const s = parseAgent('patrol')!;
  assert(s.mode === 'patrol' && s.target === '', 'mode string shorthand');
  assert(parseAgent(true)!.mode === 'wander', 'true → wander');
  assert(
    parseAgent({mode: 'teleport'})!.mode === 'wander',
    'bad mode → wander',
  );
  for (const m of ['chase', 'flee', 'follow'] as const) {
    assert(
      parseAgent({mode: m})!.target === AGENT_TARGET_USER,
      `${m} without target defaults to the user`,
    );
  }
  assert(
    parseAgent({mode: 'chase', target: 'camera'})!.target === AGENT_TARGET_USER,
    "'camera' target normalizes to 'user'",
  );
  assert(
    parseAgent({mode: 'chase', target: 'Hero'})!.target === 'Hero',
    'node-name target kept',
  );
  const wps = Array.from({length: 40}, (_, i) => [i, 0, -i]);
  const a = parseAgent({
    mode: 'patrol',
    waypoints: [[1, 2], [NaN, 0, 0], [1e9, -1e9, 0], ...wps],
    speed: 0,
    turnSpeed: 1000,
    sightRadius: -1,
    stopDistance: 0,
    separationRadius: 50,
    loopWaypoints: false,
  })!;
  assert(a.waypoints.length === MAX_AGENT_WAYPOINTS, 'waypoints capped at 32');
  assert(
    a.waypoints[0][0] === 1e4 && a.waypoints[0][1] === -1e4,
    'malformed waypoints skipped and coords clamped',
  );
  assert(a.speed === 0.1, 'speed floor 0.1');
  assert(a.turnSpeed === 50, 'turnSpeed ceiling 50');
  assert(a.sightRadius === 0, 'sightRadius floor 0');
  assert(a.stopDistance === 0.01, 'stopDistance floor 0.01');
  assert(a.separationRadius === 10, 'separationRadius ceiling 10');
  assert(a.loopWaypoints === false, 'loopWaypoints false kept');
  assert(parseAgent({})!.loopWaypoints === true, 'loopWaypoints defaults true');
}

function testIntegrity() {
  console.log('\n🛡️ integrity');
  assert(parseIntegrity(undefined) === null, 'absent → null');
  assert(parseIntegrity(0) === null, '0 → null');
  const n = parseIntegrity(250)!;
  assert(n.max === 250 && n.current === 250, 'number shorthand sets max');
  const d = parseIntegrity(true)!;
  assert(
    d.max === 100 &&
      d.current === 100 &&
      d.group === 'neutral' &&
      d.showBar === false &&
      d.cooldownMs === 250 &&
      d.hideOnDepleted === true &&
      d.scoreValue === 0 &&
      d.contactAmount === 0,
    'true → defaults',
  );
  const c = parseIntegrity({
    max: 50,
    current: 80,
    group: 'bad group',
    cooldownMs: 12.7,
    hideOnDepleted: false,
    contactAmount: -5,
    scoreValue: -20,
  })!;
  assert(c.current === 50, 'current clamped to max');
  assert(c.group === 'neutral', 'invalid group → neutral');
  assert(c.cooldownMs === 13, 'cooldownMs rounded');
  assert(c.hideOnDepleted === false, 'hideOnDepleted false kept');
  assert(c.contactAmount === 0, 'negative contactAmount → 0');
  assert(c.scoreValue === -20, 'negative scoreValue allowed (penalties)');
  assert(parseIntegrity({current: -1})!.current === 0, 'current floor 0');
  assert(parseIntegrity({max: -10})!.max === 1, 'max floor 1');
}

function testZone() {
  console.log('\n🟧 zone');
  assert(parseZone(undefined) === null, 'absent → null');
  const d = parseZone(true)!;
  assert(
    d.shape === 'box' &&
      d.size.join() === '1,1,1' &&
      d.radius === 0.5 &&
      d.watchGroups.length === 0 &&
      d.color === undefined,
    'true → hidden 1 m box watching everything',
  );
  const sph = parseZone({shape: 'sphere', size: 3})!;
  assert(sph.shape === 'sphere' && sph.radius === 3, 'numeric size → radius');
  assert(parseZone('sphere')!.shape === 'sphere', 'shape string shorthand');
  assert(parseZone({shape: 'cone'})!.shape === 'box', 'bad shape → box');
  const z = parseZone({
    size: [2, 0, 5000],
    watchGroups: ['operator', 'operator', 'bad,id', 7, 'robot'],
    color: 'F59E0B',
  })!;
  assert(z.size.join() === '2,0.01,1000', 'box size clamped per axis');
  assert(
    z.watchGroups.join() === 'operator,robot',
    'groups deduped and sanitized',
  );
  assert(z.color === '#f59e0b', 'color normalized');
  assert(
    parseZone({watchGroups: 'operator'})!.watchGroups[0] === 'operator',
    'single group string',
  );
  const many = parseZone({
    watchGroups: Array.from({length: 30}, (_, i) => `g${i}`),
  })!;
  assert(
    many.watchGroups.length === MAX_ZONE_WATCH_GROUPS,
    'watchGroups capped at 16',
  );
  assert(
    parseZone({color: 'red'})!.color === undefined,
    'invalid color hides the zone',
  );
}

function testSpawner() {
  console.log('\n🏭 spawner');
  assert(parseSpawner(undefined) === null, 'absent → null');
  assert(parseSpawner(true) === null, 'true without template → null');
  assert(parseSpawner({template: '   '}) === null, 'blank template → null');
  assert(
    parseSpawner({template: 'Pallet', enabled: false}) === null,
    'enabled:false → null',
  );
  const s = parseSpawner('Pallet')!;
  assert(
    s.template === 'Pallet' &&
      s.intervalSec === 3 &&
      s.maxActive === 8 &&
      s.totalCount === 0 &&
      s.spawnRadius === 0,
    'template string shorthand with defaults',
  );
  const c = parseSpawner({
    template: ' Drone ',
    intervalSec: 0,
    maxActive: 500,
    totalCount: 2.6,
    spawnRadius: -1,
  })!;
  assert(c.template === 'Drone', 'template trimmed');
  assert(c.intervalSec === 0.05, 'interval floor 0.05 s');
  assert(c.maxActive === MAX_SPAWNER_ACTIVE, 'maxActive capped at 32');
  assert(c.totalCount === 3, 'totalCount rounded');
  assert(c.spawnRadius === 0, 'spawnRadius floor 0');
}

function testObjective() {
  console.log('\n🎯 objective');
  assert(parseObjective(undefined) === null, 'absent → null');
  const p = parseObjective(true)!;
  assert(
    p.type === 'pickup' &&
      p.amount === 10 &&
      p.radius === 0.65 &&
      p.required === false &&
      p.order === 0 &&
      p.spinSpeed === 2.5 &&
      p.bobAmplitude === 0.08 &&
      p.respawnSec === 0 &&
      p.tag === '',
    'true → animated pickup defaults',
  );
  const cp = parseObjective('checkpoint')!;
  assert(
    cp.type === 'checkpoint' && cp.spinSpeed === 0 && cp.bobAmplitude === 0,
    'checkpoints do not animate by default',
  );
  assert(
    parseObjective({type: 'boss'})!.type === 'pickup',
    'bad type → pickup',
  );
  assert(
    parseObjective({points: 25})!.amount === 25,
    'points alias for amount',
  );
  const o = parseObjective({
    type: 'key',
    amount: 5,
    tag: 'bolt-m8',
    required: true,
    order: 3.4,
    radius: 0,
    respawnSec: 9999,
    spinSpeed: 1,
  })!;
  assert(
    o.tag === 'bolt-m8' && o.required && o.order === 3,
    'tag, required, order',
  );
  assert(o.radius === 0.05, 'radius floor 0.05');
  assert(o.respawnSec === 3600, 'respawn ceiling 1 h');
  assert(o.spinSpeed === 1, 'explicit spin on a key kept');
  assert(parseObjective({tag: 'bad tag'})!.tag === '', 'invalid tag dropped');
}

function testAudioCues() {
  console.log('\n🔊 audioCues');
  assert(parseAudioCues(undefined) === null, 'absent → null');
  assert(parseAudioCues({onTap: 'kazoo'}) === null, 'no valid cue → null');
  assert(parseAudioCues('confirm') === null, 'string is not a cue map');
  const a = parseAudioCues({
    onTap: 'confirm',
    onZoneEnter: 'alarm',
    onHit: 'explosion',
    onSomething: 'beam',
    pitchJitter: 2,
    volume: -1,
    spatial: false,
  })!;
  assert(
    a.cues.onTap === 'confirm' && a.cues.onZoneEnter === 'alarm',
    'valid cues kept',
  );
  assert(a.cues.onHit === undefined, 'renamed legacy cue rejected');
  assert(!('onSomething' in a.cues), 'unknown event ignored');
  assert(a.pitchJitter === 0.5, 'pitchJitter ceiling 0.5');
  assert(a.volume === 0, 'volume floor 0');
  assert(a.spatial === false, 'spatial false kept');
  const d = parseAudioCues({onObjective: 'pickup'})!;
  assert(near(d.pitchJitter, 0.08) && d.volume === 1 && d.spatial, 'defaults');
}

function testRigidBody() {
  console.log('\n🧱 rigidBody / physics');
  assert(parsePhysicsBody(undefined) === null, 'absent → null');
  assert(parsePhysicsBody(false) === null, 'false → null');
  assert(parsePhysicsBody({enabled: false}) === null, 'enabled:false → null');
  const d = parsePhysicsBody(true)!;
  assert(
    d.body === 'dynamic' &&
      d.shape === 'auto' &&
      d.mass === 1 &&
      near(d.restitution, 0.35) &&
      near(d.friction, 0.5) &&
      near(d.linearDamping, 0.05) &&
      near(d.angularDamping, 0.1) &&
      d.gravityScale === 1 &&
      d.velocity.join() === '0,0,0' &&
      d.angularVelocity.join() === '0,0,0' &&
      d.lockRotation === false,
    'true → dynamic defaults',
  );
  const st = parseRigidBody('static')!;
  assert(st.body === 'static' && st.mass === 0, 'static string shorthand');
  const c = parsePhysicsBody({
    body: 'dynamic',
    shape: 'sphere',
    mass: 99999,
    restitution: 2,
    friction: -1,
    linearDamping: 50,
    angularDamping: -5,
    gravityScale: 20,
    velocity: [500, -500, 10],
    angularVelocity: [200, -200, 5],
    lockRotation: true,
  })!;
  assert(c.shape === 'sphere', 'shape kept');
  assert(c.mass === 1000, 'mass clamped to 1000');
  assert(c.restitution === 1, 'restitution clamped to 1');
  assert(c.friction === 0, 'friction clamped to 0');
  assert(c.linearDamping === 20, 'linearDamping clamped to 20');
  assert(c.angularDamping === 0, 'angularDamping clamped to 0');
  assert(c.gravityScale === 5, 'gravityScale clamped to 5');
  assert(c.velocity.join() === '200,-200,10', 'velocity clamped to [-200,200]');
  assert(
    c.angularVelocity.join() === '100,-100,5',
    'angularVelocity clamped to [-100,100]',
  );
  assert(c.lockRotation === true, 'lockRotation true kept');
}

function testNormalizeAndExtensions() {
  console.log('\n🧩 normalizeXRTraits + SceneCore + USD');
  assert(
    normalizeXRTraits({collidable: true, spawner: 'Pallet'}) === null,
    'sim traits are ignored until registerSimTraitSchema() runs',
  );
  registerSimTraitSchema();
  registerSimTraitSchema();
  const n = normalizeXRTraits({
    character: {clips: {idle: 'Idle'}},
    agent: {
      mode: 'patrol',
      waypoints: [
        [0, 0, 0],
        [1, 0, 1],
      ],
    },
    integrity: {max: 40, group: 'equipment'},
    zone: {watchGroups: ['operator'], size: [2, 2, 2]},
    spawner: 'Pallet',
    objective: {type: 'checkpoint', order: 1},
    audioCues: {onTap: 'confirm'},
    collidable: true,
    rigidBody: {body: 'dynamic', shape: 'sphere', mass: 2.5, restitution: 0.8},
    joint: {type: 'hinge', anchor: [0.2, 0, 0], limits: [-30, 60]},
  })!;
  assert(
    !!n.character &&
      !!n.agent &&
      !!n.integrity &&
      !!n.zone &&
      !!n.spawner &&
      !!n.objective &&
      !!n.audioCues &&
      n.collidable === true &&
      n.rigidBody?.mass === 2.5 &&
      n.joint?.type === 'hinge',
    'all sim traits normalized',
  );
  assert(
    normalizeXRTraits({constraint: 'ball'})?.joint?.type === 'ball',
    'constraint synonym normalized to joint',
  );
  const physObj = normalizeXRTraits({
    physics: {body: 'dynamic', mass: 4, restitution: 0.6},
  })!;
  assert(
    physObj.physics === 'dynamic' && physObj.rigidBody?.mass === 4,
    'object physics populates both physics mode and rigidBody options',
  );
  assert(
    normalizeXRTraits({spawner: 'Pallet'})!.spawner!.template === 'Pallet',
    'double registration is harmless',
  );
  assert(
    normalizeXRTraits({collidable: 'yes'}) === null,
    'non-boolean collidable ignored',
  );
  assert(
    normalizeXRTraits({audio: {onTap: 'confirm'}}) === null,
    'cue map under `audio` is not mistaken for spatial audio',
  );

  const sc = buildXRSceneCoreExtension(n);
  const scAgent = sc['agent'] as {waypoints: number[][]};
  assert(scAgent.waypoints.length === 2, 'SceneCore agent waypoints');
  scAgent.waypoints[0][0] = 99;
  assert(n.agent!.waypoints[0][0] === 0, 'SceneCore copies waypoints');
  const scZone = sc['zone'] as {watchGroups: string[]; size: number[]};
  scZone.watchGroups.push('x');
  scZone.size[0] = 50;
  assert(
    n.zone!.watchGroups.length === 1 && n.zone!.size[0] === 2,
    'SceneCore copies zone arrays',
  );
  assert(
    (sc['collidable'] as {enabled: boolean}).enabled === true,
    'SceneCore collidable',
  );

  const flat = flattenXRTraitsForUsd(n);
  assert(flat['character'] === true, 'USD character flag');
  assert(flat['characterClipIdle'] === 'Idle', 'USD clip key');
  assert(flat['characterSpeed'] === 4, 'USD character scalar');
  assert(flat['agentMode'] === 'patrol', 'USD agent mode');
  assert(flat['agentWaypointCount'] === 2, 'USD waypoint count');
  assert(
    Array.isArray(flat['agentWaypoint1']) &&
      (flat['agentWaypoint1'] as number[]).join() === '1,0,1',
    'USD waypoint vector',
  );
  assert(
    flat['integrity'] === true && flat['integrityMax'] === 40,
    'USD integrity',
  );
  assert(flat['integrityGroup'] === 'equipment', 'USD integrity group');
  assert(flat['zoneWatchGroups'] === 'operator', 'USD zone groups joined');
  assert(
    (flat['zoneSize'] as number[]).join() === '2,2,2',
    'USD zone size vector',
  );
  assert(!('zoneColor' in flat), 'hidden zone emits no color');
  assert(flat['spawnerTemplate'] === 'Pallet', 'USD spawner template');
  assert(
    flat['objectiveType'] === 'checkpoint' && flat['objectiveOrder'] === 1,
    'USD objective',
  );
  assert(flat['audioCuesOnTap'] === 'confirm', 'USD cue key');
  assert(flat['audioCuesVolume'] === 1, 'USD cue volume');
  assert(flat['collidable'] === true, 'USD collidable');
  assert(
    flat['rigidBody'] === true &&
      flat['rigidBodyShape'] === 'sphere' &&
      flat['rigidBodyMass'] === 2.5,
    'USD rigidBody fields',
  );

  const lines = buildUsdXRLines(
    {agent: {mode: 'patrol', target: 'A"B', waypoints: [[1, 2, 3]]}},
    (v) => String(v).replace(/"/g, ''),
  );
  assert(
    lines.includes('double3 agentWaypoint0 = (1, 2, 3)'),
    'USD waypoint line',
  );
  assert(lines.includes('string agentTarget = "AB"'), 'USD strings sanitized');
  assert(lines.includes('double agentWaypointCount = 1'), 'USD count line');
}

function testExportPipelines() {
  console.log('\n📦 glTF + USDA export');
  registerXRTraitSerializer();
  const scene = new THREE.Scene();
  const hero = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 1.4, 0.5),
    new THREE.MeshStandardMaterial(),
  );
  hero.name = 'Hero';
  hero.userData.xr = {
    character: {speed: 50, clips: {walk: 'Walk'}},
    integrity: {max: 3, group: 'player'},
    customKey: 'kept',
  };
  scene.add(hero);
  const drone = new THREE.Mesh(
    new THREE.SphereGeometry(0.2),
    new THREE.MeshStandardMaterial(),
  );
  drone.name = 'Drone';
  drone.userData.xr = {
    agent: {mode: 'chase', target: 'Hero'},
    audioCues: {onHit: 'impact'},
    rigidBody: {body: 'dynamic', mass: 3.5, restitution: 0.75},
  };
  scene.add(drone);

  const door = new THREE.Mesh(
    new THREE.BoxGeometry(0.8, 2.0, 0.06),
    new THREE.MeshStandardMaterial(),
  );
  door.name = 'Door';
  door.userData.xr = {
    joint: {
      type: 'hinge',
      anchor: [-0.4, 0, 0],
      axis: 'y',
      limits: [-10, 95],
      motorSpeed: 1.5,
    },
  };
  scene.add(door);
  const drawer = new THREE.Mesh(
    new THREE.BoxGeometry(0.5, 0.2, 0.5),
    new THREE.MeshStandardMaterial(),
  );
  drawer.name = 'Drawer';
  drawer.userData.xr = {
    joint: {type: 'slider', axis: 'z', limits: [0, 0.45]},
  };
  scene.add(drawer);
  const bob = new THREE.Mesh(
    new THREE.SphereGeometry(0.15),
    new THREE.MeshStandardMaterial(),
  );
  bob.name = 'SpringBob';
  bob.userData.xr = {
    joint: {
      type: 'spring',
      target: 'Hero',
      restLength: 0.6,
      limits: [0.2, 1.2],
    },
  };
  scene.add(bob);
  const lamp = new THREE.Mesh(
    new THREE.SphereGeometry(0.12),
    new THREE.MeshStandardMaterial(),
  );
  lamp.name = 'PendantLamp';
  lamp.userData.xr = {
    joint: {type: 'ball', anchor: [0, 0.5, 0], limits: [-35, 35]},
  };
  scene.add(lamp);

  const {gltf} = sceneToCanvas3D(scene);
  // tslint:disable-next-line:no-any glTF node JSON.
  const nodes = (gltf.nodes ?? []) as any[];
  const heroNode = nodes.find((x) => x.name === 'Hero');
  const droneNode = nodes.find((x) => x.name === 'Drone');
  const doorNode = nodes.find((x) => x.name === 'Door');
  assert(!!heroNode && !!droneNode && !!doorNode, 'nodes exported');
  assert(
    doorNode?.extras?.xr?.joint?.type === 'hinge' &&
      doorNode?.extensions?.ANDROID_xr_scenecore?.joint?.limits?.[1] === 95,
    'glTF extras + ANDROID_xr_scenecore carry joint',
  );
  assert(
    heroNode?.extras?.xr?.character?.speed === 20,
    'glTF extras carry clamped character',
  );
  assert(heroNode?.extras?.xr?.customKey === 'kept', 'glTF keeps unknown keys');
  assert(
    XR_TRAIT_SCHEMA_VERSION === 1,
    'XR_TRAIT_SCHEMA_VERSION is 1',
  );
  assert(
    heroNode?.extensions?.ANDROID_xr_scenecore?.schemaVersion === 1,
    'ANDROID_xr_scenecore stamps schemaVersion = 1',
  );
  assert(
    heroNode?.extensions?.ANDROID_xr_scenecore?.integrity?.group === 'player',
    'ANDROID_xr_scenecore carries integrity',
  );
  assert(
    droneNode?.extensions?.ANDROID_xr_scenecore?.agent?.target === 'Hero',
    'ANDROID_xr_scenecore carries agent',
  );
  assert(
    droneNode?.extras?.xr?.audioCues?.cues?.onHit === 'impact',
    'glTF extras carry audio cues',
  );

  const usda = generateUSDA(scene);
  assert(
    usda.includes('double schemaVersion = 1'),
    'USDA customData stamps schemaVersion = 1',
  );
  assert(usda.includes('double characterSpeed = 20'), 'USDA character speed');
  assert(usda.includes('string characterClipWalk = "Walk"'), 'USDA clip name');
  assert(usda.includes('string agentTarget = "Hero"'), 'USDA agent target');
  assert(usda.includes('string audioCuesOnHit = "impact"'), 'USDA cue');
  assert(
    usda.includes(
      'prepend apiSchemas = ["MaterialBindingAPI", "PhysicsBodyAPI", "PhysicsRigidBodyAPI", "PhysicsCollisionAPI", "PhysicsMassAPI"]',
    ),
    'USDA PhysicsRigidBodyAPI + PhysicsMassAPI schemas',
  );
  assert(
    usda.includes('float physics:mass = 3.5'),
    'USDA physics:mass attribute',
  );
  assert(
    usda.includes('def PhysicsRevoluteJoint "Joint"') &&
      usda.includes('float physics:lowerLimit = -10') &&
      usda.includes('float physics:upperLimit = 95'),
    'USDA PhysicsRevoluteJoint emitted with limits',
  );
  assert(
    usda.includes('def PhysicsPrismaticJoint "Joint"') &&
      usda.includes('uniform token physics:axis = "Z"'),
    'USDA PhysicsPrismaticJoint emitted',
  );
  assert(
    usda.includes('def PhysicsDistanceJoint "Joint"') &&
      usda.includes('float physics:minDistance = 0.2') &&
      usda.includes('float physics:maxDistance = 1.2'),
    'USDA PhysicsDistanceJoint emitted',
  );
  assert(
    usda.includes('def PhysicsSphericalJoint "Joint"') &&
      usda.includes('float physics:coneAngle0Limit = 35'),
    'USDA PhysicsSphericalJoint emitted',
  );
}

function testJoint() {
  console.log('\n🔩 joint');
  assert(JOINT_TYPES.join() === 'hinge,slider,spring,ball', 'JOINT_TYPES');
  assert(parseJoint(undefined) === null, 'absent → null');
  assert(parseJoint(false) === null, 'false → null');
  assert(parseJoint('none') === null, 'none → null');
  assert(parseJoint('unknown') === null, 'unknown type → null');
  assert(parseJoint({enabled: false}) === null, 'enabled:false → null');

  const d = parseJoint(true)!;
  assert(
    d.type === 'hinge' &&
      d.target === '' &&
      d.anchor.join() === '0,0,0' &&
      d.axis.join() === '0,1,0' &&
      d.limits === null &&
      d.stiffness === 0 &&
      d.damping === 0.5 &&
      d.restLength === 0 &&
      d.motorSpeed === 0 &&
      d.motorMaxForce === 0,
    'true → hinge defaults',
  );

  assert(parseJoint('revolute')!.type === 'hinge', 'revolute → hinge');
  assert(
    parseJoint('prismatic')!.type === 'slider' &&
      parseJoint('slider')!.axis.join() === '0,0,1',
    'prismatic → slider with +Z default axis',
  );
  const sp = parseJoint('distance')!;
  assert(
    sp.type === 'spring' &&
      sp.axis.join() === '0,-1,0' &&
      sp.stiffness === 40 &&
      sp.damping === 4,
    'distance → spring with -Y default axis and spring k=40/c=4',
  );
  assert(parseJoint('spherical')!.type === 'ball', 'spherical → ball');

  const custom = parseJoint({
    kind: 'hinge',
    connectedBody: 'FrameNode',
    pivot: [0.5, 0, -0.25],
    axis: '-x',
    limits: [90, -45],
    motorSpeed: 3,
  })!;
  assert(custom.target === 'FrameNode', 'connectedBody alias');
  assert(custom.anchor.join() === '0.5,0,-0.25', 'pivot alias');
  assert(custom.axis.join() === '-1,0,0', 'axis shorthand -x');
  assert(
    custom.limits?.[0] === -45 && custom.limits?.[1] === 90,
    'reversed limits sorted to [-45, 90]',
  );
  assert(
    custom.motorSpeed === 3 && custom.motorMaxForce === 50,
    'nonzero motorSpeed defaults motorMaxForce to 50',
  );

  const vecAxis = parseJoint({
    type: 'slider',
    target: ' WORLD ',
    axis: [3, 4, 0],
    limits: [-200, 10],
  })!;
  assert(vecAxis.target === '', '"world" target normalized to empty string');
  assert(
    Math.abs(vecAxis.axis[0] - 0.6) < 1e-6 &&
      Math.abs(vecAxis.axis[1] - 0.8) < 1e-6,
    'non-unit axis vector normalized',
  );
  assert(
    vecAxis.limits?.[0] === -100 && vecAxis.limits?.[1] === 10,
    'slider limits clamped to [-100, 100]',
  );

  const zeroAxis = parseJoint({
    type: 'spring',
    target: '__proto__',
    axis: [0, 0, 0],
    limits: [-5, 2],
  })!;
  assert(zeroAxis.target === '', 'forbidden target sanitized to empty');
  assert(zeroAxis.axis.join() === '0,-1,0', 'zero-length axis falls back');
  assert(
    zeroAxis.limits?.[0] === 0 && zeroAxis.limits?.[1] === 2,
    'spring lower limit clamped >= 0',
  );
}

function testValidateXRTraits() {
  console.log('\n🩺 validateXRTraits (TL201, TL202, TL203)');
  const clean = validateXRTraits(
    {
      schemaVersion: 1,
      grab: '2-hand',
      gaze: {dwellMs: 1200},
      splatUrl: 'https://example.com/room.splat',
    },
    'CleanNode',
  );
  assert(clean.length === 0, 'clean traits produce 0 diagnostics');

  const syn = validateXRTraits(
    {
      grabbable: true,
      health: 100,
      collides: true,
      billbord: 'capsule',
    },
    'BotNode',
  );
  assert(
    syn.some(
      (d) =>
        d.code === 'TL201' &&
        d.message.includes('grabbable') &&
        d.hint?.includes('grab'),
    ),
    'TL201 synonym suggestion for grabbable',
  );
  assert(
    syn.some(
      (d) =>
        d.code === 'TL201' &&
        d.message.includes('health') &&
        d.message.includes('integrity'),
    ),
    'TL201 synonym suggestion for health -> integrity',
  );
  assert(
    syn.some(
      (d) =>
        d.code === 'TL201' &&
        d.message.includes('collides') &&
        d.message.includes('collidable'),
    ),
    'TL201 synonym suggestion for collides -> collidable',
  );
  assert(
    syn.some(
      (d) =>
        d.code === 'TL201' &&
        d.message.includes('billbord') &&
        d.message.includes('billboard'),
    ),
    'TL201 Levenshtein suggestion for billbord -> billboard',
  );

  const clamped = validateXRTraits(
    {
      gaze: {dwellMs: 50},
      particles: {count: 9999, speed: -5},
    },
    'GazeNode',
  );
  assert(
    clamped.some(
      (d) =>
        d.code === 'TL202' &&
        d.message.includes('gaze.dwellMs') &&
        d.message.includes('250'),
    ),
    'TL202 reports gaze.dwellMs clamped to 250',
  );
  assert(
    clamped.some(
      (d) => d.code === 'TL202' && d.message.includes('particles.count'),
    ),
    'TL202 reports particles.count clamped to 2000',
  );

  const unsafe = validateXRTraits(
    {
      splatUrl: 'javascript:alert(1)',
      audio: 'http://insecure.example.com/a.mp3',
      anchor: {id: '__proto__', persist: true},
      integrity: {group: 'bad group!'},
      zone: {watchGroups: ['__proto__']},
    },
    'UnsafeNode',
  );
  assert(
    unsafe.filter((d) => d.code === 'TL203' && d.severity === 'error')
      .length === 5,
    'TL203 flags unsafe splatUrl, http audio URL, __proto__ anchor.id, and invalid sim IDs',
  );

  const confusedAudio = validateXRTraits(
    {
      audio: {onTap: 'confirm'},
    },
    'ButtonNode',
  );
  assert(
    confusedAudio.some(
      (d) => d.code === 'TL201' && d.message.includes('audioCues'),
    ),
    'TL201 suggests audioCues when audio has event keys without src',
  );

  const jointDiags = validateXRTraits(
    {
      constraint: 'hinge',
      joint: {
        type: 'hinge',
        target: '__proto__',
        stiffness: 99999,
        limits: [-500, 500],
      },
    },
    'DoorNode',
  );
  assert(
    jointDiags.some(
      (d) => d.code === 'TL201' && d.message.includes('constraint'),
    ),
    'TL201 flags constraint synonym -> joint',
  );
  assert(
    jointDiags.some(
      (d) => d.code === 'TL202' && d.message.includes('joint.stiffness'),
    ),
    'TL202 flags out-of-range joint.stiffness',
  );
  assert(
    jointDiags.some(
      (d) => d.code === 'TL202' && d.message.includes('joint.limits'),
    ),
    'TL202 flags out-of-range joint.limits',
  );
  assert(
    jointDiags.some(
      (d) => d.code === 'TL203' && d.message.includes('joint.target'),
    ),
    'TL203 flags unsafe __proto__ joint.target',
  );
}

function run() {
  console.log('🎮 Running xr-live-sim trait schema tests...');
  testSafeSimId();
  testCharacter();
  testAgent();
  testIntegrity();
  testZone();
  testSpawner();
  testObjective();
  testAudioCues();
  testRigidBody();
  testJoint();
  testNormalizeAndExtensions();
  testExportPipelines();
  testValidateXRTraits();
  console.log(
    `\n🏆 xr-live-sim schema Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

try {
  run();
} catch (err) {
  console.error('Test execution failed:', err);
  process.exit(1);
}
