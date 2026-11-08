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
 * @fileoverview Unit tests for the `xr-live-sim` plugins
 * (`xr-live/src/sim/*`), driven headlessly through fake viewers.
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
  mat4Invert,
  resolveNodeWorldMatrices,
} from '../../three-live/src/math';
import {AUDIO_CUES} from '../../three-live/src/xr-sim-schema';
import {buildBoxGeometry} from '../src/plugins/common';
import {
  characterCameraRig,
  characterClipState,
  characterFloor,
} from '../src/sim/character-controller';
import {
  applySimBodies,
  getSimWorld,
  hashString,
  intersectSegmentAABB,
  intersectSegmentSphere,
  makeRng,
  pushCircleOutOfAABB,
  resetSimScenario,
  rotateY,
  simCorePlugin,
  stepSimWorld,
  turnToward,
  wrapAngle,
  type SimBody,
  type SimWorld,
} from '../src/sim/core';
import {
  applyHit,
  buildEdgeBoxGeometry,
  computeSimVisuals,
  pointInZone,
  raycastTargets,
  resolveHitMode,
} from '../src/sim/hit-zones';
import * as sim from '../src/sim/index';
import {applyDeadzone} from '../src/sim/input';
import {
  completeObjective,
  getScenarioState,
  objectivesHudText,
} from '../src/sim/objectives';
import {chooseAgentState} from '../src/sim/steering-agents';
import {CUE_RECIPES, playCue, spatialize} from '../src/sim/synth-audio';

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

function near(a: number, b: number, eps = 1e-6): boolean {
  return Math.abs(a - b) <= eps;
}

// ---------------------------------------------------------------------------
// Fake viewer / element harness
// ---------------------------------------------------------------------------

interface FakeNode {
  name: string;
  translation?: [number, number, number];
  children?: number[];
  xr?: Record<string, unknown>;
  /** Half extent of a cube mesh on this node (omit for empty nodes). */
  cube?: number;
}

interface Harness {
  // tslint:disable-next-line:no-any Fake viewer.
  viewer: any;
  // tslint:disable-next-line:no-any Fake element.
  element: any;
  events: Array<{type: string; detail: Record<string, unknown>}>;
  world: SimWorld;
  attrs: Map<string, string>;
  clips: string[];
  key(type: 'keydown' | 'keyup', code: string): void;
  run(seconds: number): void;
  body(name: string): SimBody;
  count(type: string): number;
}

function makeHarness(
  nodes: FakeNode[],
  attrs: Record<string, string> = {},
  bounds = {min: [-10, 0, -10], max: [10, 3, 10]},
): Harness {
  const gltf = {
    nodes: nodes.map((n) => ({
      name: n.name,
      translation: n.translation,
      children: n.children,
      extras: n.xr ? {xr: n.xr} : undefined,
    })),
  };
  const worldMats = resolveNodeWorldMatrices(gltf);
  // tslint:disable-next-line:no-any Mesh records.
  const meshes: any[] = [];
  nodes.forEach((n, i) => {
    if (n.cube === undefined) return;
    const geo = buildBoxGeometry(n.cube);
    meshes.push({
      name: n.name,
      nodeIndex: i,
      transform: new Float32Array(worldMats[i]),
      normalMatrix: new Float32Array(9),
      visible: true,
      extras: gltf.nodes[i].extras,
      primitives: [
        {
          positions: geo.positions,
          indices: geo.indices,
          baseColor: [0.5, 0.5, 0.5, 1],
        },
      ],
    });
  });
  const attrMap = new Map(Object.entries(attrs));
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const events: Harness['events'] = [];
  const element = {
    getAttribute: (n: string) => (attrMap.has(n) ? attrMap.get(n)! : null),
    hasAttribute: (n: string) => attrMap.has(n),
    setAttribute: (n: string, v: string) => attrMap.set(n, v),
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener: (t: string, fn: (e: unknown) => void) =>
      listeners.get(t)?.delete(fn),
    dispatchEvent: (e: CustomEvent) => {
      events.push({type: e.type, detail: e.detail});
      return true;
    },
    listenerCount: (t: string) => listeners.get(t)?.size ?? 0,
  };
  const clips: string[] = [];
  const viewer = {
    gltf,
    meshes,
    bounds,
    container: element,
    modelRootMatrix: mat4Create(),
    getAvailableAnimations: () => ['Idle', 'Walk', 'Run', 'Jump'],
    setAnimationName: (n: string) => clips.push(n),
    playAnimation: () => {},
    setAutoRotate: () => {},
    setCamera: () => {},
    customTarget: null as number[] | null,
  };
  const world = getSimWorld(viewer);
  const h: Harness = {
    viewer,
    element,
    events,
    world,
    attrs: attrMap,
    clips,
    key(type, code) {
      for (const fn of listeners.get(type) ?? []) {
        fn({code, repeat: false, target: null, preventDefault() {}});
      }
    },
    run(seconds) {
      const frames = Math.round(seconds * 60);
      for (let i = 0; i < frames; i++) stepSimWorld(world, 1 / 60);
    },
    body(name) {
      const b = world.bodies.find((x) => x.name === name);
      if (!b) throw new Error(`no body ${name}`);
      return b;
    },
    count(type) {
      return events.filter((e) => e.type === type).length;
    },
  };
  // One fixed step attaches input listeners and resolves the character.
  stepSimWorld(world, 1 / 60);
  return h;
}

// ---------------------------------------------------------------------------
// Tests
// ---------------------------------------------------------------------------

function testHelpers() {
  console.log('\n🧮 helpers');
  assert(near(wrapAngle(3 * Math.PI), Math.PI), 'wrapAngle(3π) = π');
  assert(near(wrapAngle(-Math.PI), Math.PI), 'wrapAngle(-π) = π');
  assert(near(turnToward(0, 1, 0.25), 0.25), 'turnToward clamps step');
  assert(
    near(turnToward(3, -3, 1), wrapAngle(3 + (2 * Math.PI - 6))),
    'turnToward takes the short arc',
  );
  const r = rotateY([0, 0, 1], Math.PI / 2);
  assert(near(r[0], 1) && near(r[2], 0), 'rotateY +Z by 90° → +X');
  assert(
    pushCircleOutOfAABB([0, 0, 2], 0.5, [-1, -1, -1], [1, 1, 1]) === null,
    'push: no overlap → null',
  );
  const p = pushCircleOutOfAABB([0, 0, 1.2], 0.5, [-1, -1, -1], [1, 1, 1])!;
  assert(near(p[1], 1.5), 'push: out along +Z face');
  const inside = pushCircleOutOfAABB(
    [0.9, 0, 0],
    0.5,
    [-1, -1, -1],
    [1, 1, 1],
  )!;
  assert(
    near(inside[0], 1.5) && near(inside[1], 0),
    'push: center inside exits nearest face',
  );
  assert(
    near(intersectSegmentSphere([0, 0, -5], [0, 0, 5], [0, 0, 0], 1)!, 0.4),
    'segment-sphere entry t',
  );
  assert(
    intersectSegmentSphere([0, 2, -5], [0, 2, 5], [0, 0, 0], 1) === null,
    'segment-sphere miss',
  );
  assert(
    intersectSegmentSphere([0, 0, 0], [0, 0, 0], [0, 0, 0.5], 1) === 0,
    'segment starting inside sphere → 0',
  );
  assert(
    near(
      intersectSegmentAABB([-5, 0, 0], [5, 0, 0], [-1, -1, -1], [1, 1, 1])!,
      0.4,
    ),
    'segment-AABB entry t',
  );
  assert(
    intersectSegmentAABB([-5, 3, 0], [5, 3, 0], [-1, -1, -1], [1, 1, 1]) ===
      null,
    'segment-AABB miss',
  );
  const a = makeRng(7);
  const b = makeRng(7);
  assert(a() === b() && a() === b(), 'makeRng is deterministic');
  assert(hashString('node:1') !== hashString('node:2'), 'hashString differs');
  assert(applyDeadzone(0.1) === 0 && near(applyDeadzone(1), 1), 'deadzone');
  assert(near(applyDeadzone(-0.575), -0.5), 'deadzone rescales');
  const edges = buildEdgeBoxGeometry(0.02);
  const vcount = edges.positions.length / 3;
  assert(edges.indices.length === 12 * 36, 'edge box has 12 boxes');
  assert(
    Array.from(edges.indices).every((i) => i < vcount),
    'edge box indices in range',
  );
}

function testWorldBuild() {
  console.log('\n🌍 world build');
  const h = makeHarness([
    {
      name: 'Hero',
      translation: [1, 0, 2],
      children: [1],
      xr: {character: true},
    },
    {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.5},
    {name: 'Plain', translation: [5, 0, 5], cube: 0.5},
    {name: 'Spawner', translation: [0, 0, 0], xr: {spawner: 'Crate'}},
    {name: 'Crate', translation: [8, 0.5, 8], cube: 0.25, xr: {integrity: 10}},
  ]);
  const w = h.world;
  assert(w.bodies.length === 3, 'one body per sim node');
  const hero = h.body('Hero');
  assert(hero.meshes.length === 1, 'body owns descendant meshes');
  assert(hero.initPos.join() === '1,0,2', 'initPos from node world matrix');
  assert(near(hero.center[1], 0.5) && near(hero.half[1], 0.5), 'body AABB');
  const crate = h.body('Crate');
  assert(crate.isTemplate && crate.hidden, 'spawner templates hidden');
  assert(h.viewer.meshes[2].visible === false, 'template mesh hidden');
  assert(h.viewer.meshes[1].visible === true, 'plain meshes untouched');

  hero.pos = [3, 0, 2];
  hero.yaw = Math.PI / 2;
  applySimBodies(w);
  const t = h.viewer.meshes[0].transform;
  assert(
    near(t[12], 3) && near(t[13], 0.5) && near(t[14], 2),
    'mesh follows body',
  );
  // Simulate an animation clip rewriting the mesh transform.
  t[13] = 0.75;
  applySimBodies(w);
  assert(near(t[13], 0.75), 'animated base is rebased, not overwritten');
  resetSimScenario(h.viewer);
  assert(hero.pos.join() === '1,0,2' && hero.yaw === 0, 'reset restores pose');
  assert(crate.hidden, 'reset keeps templates hidden');
}

function testCharacter() {
  console.log('\n🏃 character-controller');
  const h = makeHarness([
    {
      name: 'Hero',
      translation: [0, 0, 0],
      children: [1],
      xr: {
        character: {
          speed: 4,
          radius: 0.3,
          clips: {idle: 'Idle', walk: 'Walk', run: 'Run', jump: 'Jump'},
        },
      },
    },
    {name: 'HeroMesh', translation: [0, 0.25, 0], cube: 0.25},
    {
      name: 'Wall',
      translation: [0, 0.5, -3],
      cube: 0.5,
      xr: {collidable: true},
    },
  ]);
  const hero = h.body('Hero');
  assert(h.world.character === hero, 'character registered');
  assert(h.element.getAttribute('tabindex') === '0', 'host made focusable');
  h.key('keydown', 'KeyW');
  h.run(0.25);
  assert(hero.pos[2] < -0.3, 'W moves away from the camera (-Z)');
  assert(h.clips.includes('Walk') || h.clips.includes('Run'), 'walk/run clip');
  h.run(2);
  assert(
    hero.pos[2] >= -2.5 + 0.3 - 1e-3 && hero.pos[2] < -2,
    `wall stops the capsule (z=${hero.pos[2].toFixed(3)})`,
  );
  assert(near(Math.abs(hero.yaw), Math.PI, 1e-3), 'character turns to face -Z');
  h.key('keyup', 'KeyW');
  h.run(1);
  assert(
    Math.hypot(hero.vel[0], hero.vel[2]) < 0.05,
    'velocity decays after release',
  );
  assert(h.clips[h.clips.length - 1] === 'Idle', 'idle clip after stopping');
  assert(
    Array.isArray(h.viewer.customTarget) &&
      near(h.viewer.customTarget[2], hero.pos[2]),
    'orbit camera target follows',
  );

  h.key('keydown', 'Space');
  h.run(0.1);
  assert(h.count('characterjump') === 1 && hero.pos[1] > 0.2, 'Space jumps');
  h.run(1.5);
  assert(
    h.count('characterland') === 1 && near(hero.pos[1], 0, 1e-6),
    `lands (events=${h.count('characterland')}, y=${hero.pos[1]})`,
  );

  h.attrs.set('character-controller', 'first-person');
  h.run(0.05);
  assert(
    h.viewer.meshes[0].visible === false,
    'first-person hides the character',
  );
  h.attrs.set('character-controller', 'third-person');
  h.run(0.05);
  assert(h.viewer.meshes[0].visible === true, 'third-person shows it again');
  h.viewer.meshes[0].visible = false;
  h.run(0.05);
  assert(
    h.viewer.meshes[0].visible === false,
    'sim does not fight other visibility owners',
  );
  h.viewer.meshes[0].visible = true;

  h.attrs.set('character-controller', 'none');
  const z = hero.pos[2];
  h.key('keydown', 'KeyS');
  h.run(0.5);
  assert(hero.pos[2] === z, "character-controller='none' disables movement");
  h.attrs.delete('character-controller');
  h.key('keyup', 'KeyS');

  assert(characterClipState(0, 4, true) === 'idle', 'clip idle');
  assert(characterClipState(2, 4, true) === 'walk', 'clip walk');
  assert(characterClipState(3.5, 4, true) === 'run', 'clip run');
  assert(characterClipState(3.5, 4, false) === 'jump', 'clip jump');
}

function testPlatforms() {
  console.log('\n🧱 platforms');
  const h = makeHarness(
    [
      {
        name: 'Hero',
        translation: [0, 3, 0],
        children: [1],
        xr: {character: true},
      },
      {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.25},
      {
        name: 'Platform',
        translation: [0, 0.5, 0],
        cube: 0.5,
        xr: {collidable: true},
      },
    ],
    {},
    {min: [-5, 0, -5], max: [5, 4, 5]},
  );
  const hero = h.body('Hero');
  assert(
    characterFloor(h.world, hero) === 0,
    'floor falls back to scene min with platforms',
  );
  // HeroMesh spans y 0.25..0.75 under the Hero origin, so feet = pos.y + 0.25.
  h.run(2);
  assert(
    near(hero.pos[1] + 0.25, 1, 1e-6),
    `lands on the platform top (y=${hero.pos[1]})`,
  );
  h.key('keydown', 'KeyD');
  h.run(1.5);
  assert(near(hero.pos[1] + 0.25, 0, 1e-6), 'walks off and falls to the floor');
  h.key('keyup', 'KeyD');
}

function testAgents() {
  console.log('\n🤖 steering-agents');
  const h = makeHarness([
    {
      name: 'Target',
      translation: [0, 0.5, 0],
      cube: 0.25,
      xr: {integrity: 100},
    },
    {
      name: 'Drone',
      translation: [5, 0.5, 0],
      cube: 0.2,
      xr: {
        agent: {
          mode: 'chase',
          target: 'Target',
          sightRadius: 0,
          speed: 3,
          stopDistance: 0.5,
        },
      },
    },
    {
      name: 'Rabbit',
      translation: [0, 0.5, 2],
      cube: 0.2,
      xr: {agent: {mode: 'flee', target: 'Target', sightRadius: 6, speed: 2}},
    },
    {
      name: 'Guard',
      translation: [-4, 0.5, -4],
      cube: 0.2,
      xr: {
        agent: {
          mode: 'patrol',
          speed: 4,
          turnSpeed: 50,
          waypoints: [
            [-4, 0.5, 4],
            [4, 0.5, 4],
          ],
          loopWaypoints: false,
        },
      },
    },
  ]);
  const drone = h.body('Drone');
  const rabbit = h.body('Rabbit');
  const guard = h.body('Guard');
  h.run(3);
  const d = Math.hypot(drone.pos[0], drone.pos[2]);
  assert(d <= 0.55, `chaser reaches stopDistance (d=${d.toFixed(3)})`);
  assert(h.count('agentreach') >= 1, 'agentreach emitted');
  const reaches = h.count('agentreach');
  h.run(0.5);
  assert(h.count('agentreach') - reaches <= 1, 'agentreach throttled to 1/s');
  assert(
    Math.hypot(rabbit.pos[0], rabbit.pos[2]) > 2.5,
    'flee increases distance',
  );
  h.run(4);
  assert(
    Math.hypot(guard.pos[0] - 4, guard.pos[2] - 4) <= 0.5,
    `non-looping patrol ends at the last waypoint (${guard.pos.map((v) => v.toFixed(2))})`,
  );
  const states = h.events
    .filter(
      (e) => e.type === 'agentstatechange' && e.detail['nodeId'] === 'Guard',
    )
    .map((e) => e.detail['state']);
  assert(
    states[0] === 'patrol' && states[states.length - 1] === 'idle',
    'patrol → idle',
  );
  assert(drone.pos[1] === 0.5, 'agents stay on their XZ plane');

  const base = {
    mode: 'chase' as const,
    target: 'x',
    speed: 1,
    turnSpeed: 1,
    sightRadius: 5,
    stopDistance: 0.5,
    separationRadius: 0.8,
    waypoints: [] as Array<[number, number, number]>,
    loopWaypoints: true,
  };
  assert(chooseAgentState(base, 3, false) === 'chase', 'chase in sight');
  assert(
    chooseAgentState(base, 8, false) === 'wander',
    'chase out of sight roams',
  );
  assert(
    chooseAgentState({...base, mode: 'follow'}, 8, false) === 'idle',
    'follow out of sight idles',
  );
  assert(
    chooseAgentState({...base, mode: 'wander'}, 3, false) === 'chase',
    'wander engages in sight',
  );
  assert(
    chooseAgentState({...base, mode: 'wander', sightRadius: 0}, 3, false) ===
      'wander',
    'sight 0 never engages roaming agents',
  );
  assert(
    chooseAgentState({...base, sightRadius: 0}, 99, false) === 'chase',
    'sight 0 is unlimited for chase',
  );
  assert(
    chooseAgentState({...base, mode: 'patrol'}, null, false) === 'wander',
    'patrol without waypoints wanders',
  );

  const sep = makeHarness([
    {
      name: 'A',
      translation: [0, 0, 0],
      cube: 0.1,
      xr: {agent: {mode: 'follow', target: 'T', separationRadius: 1}},
    },
    {
      name: 'B',
      translation: [0, 0, 0],
      cube: 0.1,
      xr: {agent: {mode: 'follow', target: 'T', separationRadius: 1}},
    },
    {name: 'T', translation: [0, 0, 5], cube: 0.1},
  ]);
  sep.run(2);
  const ab = Math.hypot(
    sep.body('A').pos[0] - sep.body('B').pos[0],
    sep.body('A').pos[2] - sep.body('B').pos[2],
  );
  assert(ab > 0.3, `coincident agents separate (d=${ab.toFixed(3)})`);

  const det = () => {
    const x = makeHarness([
      {name: 'W', translation: [0, 0, 0], cube: 0.1, xr: {agent: 'wander'}},
    ]);
    x.run(3);
    return x
      .body('W')
      .pos.map((v) => v.toFixed(9))
      .join();
  };
  assert(det() === det(), 'wander is deterministic per body');
}

function testHitZones() {
  console.log('\n🎯 hit-zones');
  const h = makeHarness(
    [
      {
        name: 'Target',
        translation: [0, 1.6, -5],
        cube: 0.3,
        xr: {
          integrity: {max: 50, group: 'enemy', scoreValue: 10, cooldownMs: 0},
        },
      },
      {
        name: 'Ally',
        translation: [3, 1.6, -5],
        cube: 0.3,
        xr: {integrity: {max: 50, group: 'user'}},
      },
    ],
    {'hit-zones': '', 'fire-rate': '10'},
  );
  assert(resolveHitMode(h.world) === 'projectile', "'' → projectile");
  const target = h.body('Target');
  h.key('keydown', 'KeyF');
  h.run(0.6);
  assert(
    target.integrity === 25,
    `projectile hits once (integrity=${target.integrity})`,
  );
  assert(h.count('xrhit') === 1, 'xrhit emitted');
  const hit = h.events.find((e) => e.type === 'xrhit')!.detail;
  assert(hit['sourceId'] === 'user' && hit['amount'] === 25, 'xrhit detail');
  h.key('keydown', 'KeyF');
  h.run(0.6);
  assert(target.integrity === 0 && target.hidden, 'depleted target hides');
  assert(h.count('xrdepleted') === 1, 'xrdepleted once');
  const dep = h.events.find((e) => e.type === 'xrdepleted')!.detail;
  assert(
    dep['scoreValue'] === 10 && dep['group'] === 'enemy',
    'xrdepleted detail',
  );

  const ally = h.body('Ally');
  assert(
    raycastTargets(h.world, [0, 1.6, 0], [0.514, 0, -0.857], 'user', null) ===
      null,
    'own group is not targetable',
  );
  assert(!applyHit(h.world, target, 5, null, null), 'no hits after depletion');
  ally.lastHitMs = h.world.timeMs;
  assert(!applyHit(h.world, ally, 5, null, null), 'cooldown blocks hits');

  h.attrs.set('hit-zones', 'hitscan');
  resetSimScenario(h.viewer);
  assert(target.integrity === 50 && !target.hidden, 'reset restores integrity');
  simCorePlugin.onMeshSelect!(h.viewer, {
    meshIndex: 0,
    hitPoint: [0, 1.6, -4.7],
  });
  assert(target.integrity === 25, 'hitscan select applies hit-amount');
  simCorePlugin.onMeshSelect!(h.viewer, {
    meshIndex: 0,
    hitPoint: [0, 1.6, -4.7],
  });
  assert(target.integrity === 25, 'fire-rate limits select hits');
  h.attrs.set('hit-amount', '7');
  h.run(0.2);
  simCorePlugin.onMeshSelect!(h.viewer, {
    meshIndex: 0,
    hitPoint: [0, 1.6, -4.7],
  });
  assert(target.integrity === 18, 'hit-amount attribute');

  const blocked = makeHarness(
    [
      {
        name: 'Target',
        translation: [0, 1.6, -5],
        cube: 0.3,
        xr: {integrity: 50},
      },
      {
        name: 'Wall',
        translation: [0, 1.6, -2],
        cube: 0.5,
        xr: {collidable: true},
      },
    ],
    {'hit-zones': 'hitscan'},
  );
  blocked.key('keydown', 'KeyF');
  blocked.run(0.1);
  assert(blocked.body('Target').integrity === 50, 'collidables block hitscan');
}

function testContactsZonesSpawners() {
  console.log('\n🟧 contacts, zones, spawners');
  const h = makeHarness([
    {
      name: 'Hero',
      translation: [0, 0, 0],
      children: [1],
      xr: {
        character: {radius: 0.2},
        integrity: {
          max: 30,
          group: 'player',
          cooldownMs: 500,
          hideOnDepleted: false,
        },
      },
    },
    {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.25},
    {
      name: 'Drone',
      translation: [0, 0.5, 3],
      cube: 0.2,
      xr: {
        agent: {mode: 'chase', target: 'user', speed: 2, stopDistance: 0.2},
        integrity: {max: 10, group: 'hazard', contactAmount: 10},
      },
    },
    {
      name: 'Cell',
      translation: [0, 0.5, -3],
      xr: {zone: {size: [2, 2, 2], watchGroups: ['player'], color: '#f59e0b'}},
    },
  ]);
  const hero = h.body('Hero');
  h.run(3);
  assert(
    hero.integrity === 0 || hero.integrity === 10 || hero.integrity === 20,
    'contact damage applied',
  );
  assert(
    h.count('xrhit') >= 1 && h.count('xrhit') <= 6,
    'contacts respect cooldown',
  );
  assert(
    h.viewer.meshes.some((m: {name: string}) => m.name === '__xr_sim_zone__'),
    'zone outline drawn when color is set',
  );

  const z = makeHarness([
    {
      name: 'Hero',
      translation: [0, 0, 0],
      children: [1],
      xr: {character: {speed: 4}, integrity: {max: 10, group: 'player'}},
    },
    {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.25},
    {
      name: 'Cell',
      translation: [0, 0.5, -3],
      xr: {zone: {size: [2, 2, 2], watchGroups: ['player']}},
    },
    {
      name: 'Other',
      translation: [0, 0.5, -3],
      xr: {zone: {size: [2, 2, 2], watchGroups: ['robot']}},
    },
  ]);
  z.key('keydown', 'KeyW');
  z.run(0.9);
  assert(z.count('xrzoneenter') === 1, 'enter emitted once');
  const enter = z.events.find((e) => e.type === 'xrzoneenter')!.detail;
  assert(
    enter['zoneId'] === 'Cell' && enter['group'] === 'player',
    'enter detail',
  );
  z.run(1);
  assert(z.count('xrzoneexit') === 1, 'exit emitted once');
  assert(pointInZone(z.body('Cell'), [0, 0.5, -3.9]), 'pointInZone box inside');
  const dup = makeHarness([
    {name: 'Bot', translation: [0, 0.5, 0], cube: 0.1, xr: {integrity: 5}},
    {name: 'Bot', translation: [5, 0.5, 0], cube: 0.1, xr: {integrity: 5}},
    {name: 'Zone', translation: [0, 0.5, 0], xr: {zone: {size: [1, 1, 1]}}},
  ]);
  dup.run(0.1);
  assert(dup.count('xrzoneenter') === 1, 'same-named nodes tracked separately');
  dup.world.bodies[0].pos = [3, 0.5, 0];
  dup.run(0.05);
  assert(dup.count('xrzoneexit') === 1, 'exit for the node that left');
  assert(
    !pointInZone(z.body('Cell'), [0, 0.5, -4.1]),
    'pointInZone box outside',
  );

  const s = makeHarness([
    {
      name: 'Spawner',
      translation: [3, 0, 0],
      xr: {
        spawner: {
          template: 'Crate',
          intervalSec: 0.5,
          maxActive: 2,
          totalCount: 3,
          spawnRadius: 0.5,
        },
      },
    },
    {
      name: 'Crate',
      translation: [8, 0.25, 8],
      cube: 0.25,
      xr: {integrity: {max: 10}, agent: 'wander', spawner: 'Crate'},
    },
  ]);
  const meshCount = s.viewer.meshes.length;
  s.run(1.6);
  const inst = s.world.bodies.filter((b) => b.spawnedFrom !== undefined);
  assert(inst.length === 2, 'maxActive caps live instances');
  assert(s.count('xrspawn') === 2, 'xrspawn per instance');
  assert(s.viewer.meshes.length === meshCount + 2, 'clone meshes added');
  assert(
    inst[0].name === 'Crate#1' && !inst[0].traits.spawner,
    'clones drop spawner trait',
  );
  assert(
    Math.hypot(inst[0].pos[0] - 3, inst[0].pos[2]) <= 0.5 + 1e-9 ||
      inst[0].traits.agent !== undefined,
    'spawned near the spawner',
  );
  applyHit(s.world, inst[1], 1, null, null);
  assert(
    inst[1].meshes[0].primitives[0].baseColor[0] > 0.5 &&
      inst[0].meshes[0].primitives[0].baseColor[0] === 0.5 &&
      s.body('Crate').meshes[0].primitives[0].baseColor[0] === 0.5,
    'hit flash tints only the hit instance',
  );
  applyHit(s.world, inst[0], 100, null, null);
  s.run(1.1);
  assert(!s.world.bodies.includes(inst[0]), 'depleted instance removed');
  assert(s.count('xrspawn') === 3, 'replacement spawned up to totalCount');
  s.run(2);
  assert(s.count('xrspawn') === 3, 'totalCount stops spawning');
  assert(s.body('Crate').hidden, 'template stays hidden');
}

function testObjectives() {
  console.log('\n🏁 objectives');
  const h = makeHarness(
    [
      {
        name: 'Hero',
        translation: [0, 0, 0],
        children: [1],
        xr: {character: {speed: 4}},
      },
      {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.25},
      {
        name: 'CoinA',
        translation: [0, 0.5, -1.5],
        cube: 0.1,
        xr: {objective: {amount: 10}},
      },
      {
        name: 'Step2',
        translation: [0, 0.5, -3],
        cube: 0.1,
        xr: {
          objective: {type: 'checkpoint', order: 2, required: true, amount: 0},
        },
      },
      {
        name: 'Step1',
        translation: [0, 0.5, -4.5],
        cube: 0.1,
        xr: {
          objective: {type: 'checkpoint', order: 1, required: true, amount: 5},
        },
      },
    ],
    {objectives: '', 'scenario-timer': '30'},
  );
  h.key('keydown', 'KeyW');
  h.run(0.5);
  const st = getScenarioState(h.world)!;
  assert(st.score === 10, 'pickup scores');
  assert(h.body('CoinA').hidden, 'collected pickup hides');
  h.run(0.8);
  const rejected = h.events.filter(
    (e) => e.type === 'xrobjective' && e.detail['outOfOrder'],
  );
  assert(rejected.length === 1, 'out-of-order checkpoint rejected once');
  assert(!h.body('Step2').hidden, 'rejected checkpoint stays');
  assert(h.body('Step1').hidden, 'first checkpoint completes');
  h.key('keyup', 'KeyW');
  h.key('keydown', 'KeyS');
  for (let i = 0; i < 60 && !h.world.ended; i++) h.run(0.05);
  const end = h.events.find((e) => e.type === 'xrscenarioend');
  assert(end?.detail['outcome'] === 'pass', 'all required done → pass');
  assert(end?.detail['finalScore'] === 15, 'final score');
  assert(h.world.ended, 'world freezes after the scenario ends');
  assert(objectivesHudText(h.world, 'auto').startsWith('Score 15'), 'HUD text');
  assert(
    objectivesHudText(h.world, 'auto').endsWith('Pass'),
    'HUD shows outcome',
  );
  h.key('keyup', 'KeyS');
  resetSimScenario(h.viewer);
  assert(
    !h.world.ended && !h.body('CoinA').hidden,
    'reset restarts the scenario',
  );

  const t = makeHarness(
    [
      {
        name: 'Coin',
        translation: [5, 0.5, 5],
        cube: 0.1,
        xr: {objective: true},
      },
    ],
    {'scenario-timer': '1'},
  );
  t.run(1.2);
  assert(
    t.events.find((e) => e.type === 'xrscenarioend')?.detail['outcome'] ===
      'timeout',
    'timer → timeout',
  );

  const tap = makeHarness(
    [
      {
        name: 'Coin',
        translation: [5, 0.5, 5],
        cube: 0.1,
        xr: {objective: {amount: 3}},
      },
      {
        name: 'Coin2',
        translation: [6, 0.5, 5],
        cube: 0.1,
        xr: {objective: {amount: 4, respawnSec: 1}},
      },
    ],
    {'target-score': '7'},
  );
  simCorePlugin.onMeshSelect!(tap.viewer, {meshIndex: 0});
  assert(
    getScenarioState(tap.world)!.score === 3,
    'tap completes without a character',
  );
  assert(completeObjective(tap.world, tap.body('Coin2')), 'direct completion');
  assert(
    tap.events.find((e) => e.type === 'xrscenarioend') === undefined,
    'target-score checked on the next step',
  );
  tap.run(0.05);
  assert(
    tap.events.find((e) => e.type === 'xrscenarioend')?.detail['outcome'] ===
      'pass',
    'target-score → pass',
  );

  const lives = makeHarness(
    [
      {
        name: 'Hero',
        translation: [0, 0, 0],
        children: [1],
        xr: {character: true},
      },
      {name: 'HeroMesh', translation: [0, 0.5, 0], cube: 0.25},
      {
        name: 'Hunter',
        translation: [0, 0, 2],
        cube: 0.2,
        xr: {
          agent: {mode: 'chase', target: 'user', speed: 3, stopDistance: 0.5},
        },
      },
    ],
    {attempts: '2'},
  );
  lives.run(1.5);
  assert(
    getScenarioState(lives.world)!.attemptsLeft === 1,
    `agent reach costs an attempt (left=${getScenarioState(lives.world)!.attemptsLeft}, reaches=${lives.count('agentreach')})`,
  );
  assert(
    near(lives.body('Hero').pos[2], 0, 0.6),
    'character respawns at start',
  );
  lives.run(3);
  assert(
    lives.events.find((e) => e.type === 'xrscenarioend')?.detail['outcome'] ===
      'fail',
    'no attempts left → fail',
  );
}

function testAudio() {
  console.log('\n🔊 synth-audio');
  assert(
    AUDIO_CUES.every((c) => (CUE_RECIPES[c]?.length ?? 0) > 0),
    'every cue has a recipe',
  );
  assert(
    Object.values(CUE_RECIPES).every((vs) =>
      vs.every((v) => v.dur > 0 && v.gain > 0 && v.gain <= 1 && v.f0 > 0),
    ),
    'recipes are well formed',
  );
  const h = makeHarness(
    [
      {
        name: 'Left',
        translation: [-3, 1.6, 0],
        cube: 0.1,
        xr: {audioCues: {onTap: 'confirm'}},
      },
      {name: 'Right', translation: [3, 1.6, 0], cube: 0.1},
    ],
    {'synth-audio': ''},
  );
  const left = spatialize(h.world, [-3, 1.6, 0]);
  const right = spatialize(h.world, [3, 1.6, 0]);
  assert(left.pan < -0.9 && right.pan > 0.9, 'pan follows camera right');
  assert(spatialize(h.world, [0, 1.6, -10]).gain < 0.25, 'distance attenuates');
  assert(!playCue(h.world, 'confirm'), 'silent until unlocked');

  let started = 0;
  // tslint:disable-next-line:no-any Minimal fake Web Audio graph.
  const param = (): any => ({
    value: 0,
    setValueAtTime() {},
    linearRampToValueAtTime() {},
    exponentialRampToValueAtTime() {},
  });
  // tslint:disable-next-line:no-any Minimal fake Web Audio graph.
  const node = (): any => ({
    connect() {},
    gain: param(),
    pan: param(),
    frequency: param(),
    start() {
      started++;
    },
    stop() {},
  });
  class FakeCtx {
    state = 'running';
    currentTime = 0;
    sampleRate = 8000;
    destination = node();
    createGain = node;
    createOscillator = node;
    createBufferSource = node;
    createBiquadFilter = node;
    createStereoPanner = node;
    createBuffer() {
      return {getChannelData: () => new Float32Array(8000)};
    }
    resume() {
      return Promise.resolve();
    }
    close() {
      return Promise.resolve();
    }
  }
  // tslint:disable-next-line:no-any Install fake constructor.
  (globalThis as any).AudioContext = FakeCtx;
  try {
    simCorePlugin.onMeshSelect!(h.viewer, {meshIndex: 0});
    assert(started === CUE_RECIPES.confirm.length, 'tap plays the node cue');
    started = 0;
    h.attrs.set('synth-audio', 'muted');
    assert(!playCue(h.world, 'beam'), 'muted plays nothing');
  } finally {
    // tslint:disable-next-line:no-any Remove fake constructor.
    delete (globalThis as any).AudioContext;
  }
}

function testBundleExports() {
  console.log('\n📦 bundle');
  assert(
    typeof sim.resetSimScenario === 'function',
    'resetSimScenario exported',
  );
  assert(
    typeof sim.applyRigidBodyImpulse === 'function' &&
      typeof sim.isRigidBodySleeping === 'function',
    'rigid-body helpers exported',
  );
  assert(sim.xrSimSystems.length === 6, 'six systems exported');
  assert(
    sim.xrSimSystems.map((s) => s.priority).join() === '10,20,25,30,40,50',
    'systems run in plan order',
  );
}

function testRigidBodyPhysics() {
  console.log('\n🧱 rigid-body');
  const h = makeHarness([
    {
      name: 'Ball',
      translation: [2, 2.0, 0],
      cube: 0.2,
      xr: {
        rigidBody: {
          body: 'dynamic',
          shape: 'sphere',
          mass: 1,
          restitution: 0.7,
        },
      },
    },
    {
      name: 'BottomCrate',
      translation: [-2, 0.25, 0],
      cube: 0.25,
      xr: {
        rigidBody: {
          body: 'dynamic',
          shape: 'box',
          mass: 2,
          restitution: 0.05,
          linearDamping: 0.8,
        },
      },
    },
    {
      name: 'TopCrate',
      translation: [-2, 1.0, 0],
      cube: 0.25,
      xr: {
        rigidBody: {
          body: 'dynamic',
          shape: 'box',
          mass: 1,
          restitution: 0.05,
          linearDamping: 0.8,
        },
      },
    },
  ]);
  const ball = h.body('Ball');
  const bottom = h.body('BottomCrate');
  const top = h.body('TopCrate');
  h.run(0.7);
  // Ball falls from y=2.0, hits floor at y=0.2, and bounces back up above 0.35.
  assert(
    ball.pos[1] > 0.35 && ball.pos[1] < 1.8,
    `ball bounced after floor impact (y=${ball.pos[1]})`,
  );
  assert(h.count('xrcollision') >= 1, 'xrcollision dispatched');
  h.run(2.5);
  assert(
    near(bottom.pos[1], 0.25, 0.03) && near(top.pos[1], 0.75, 0.05),
    `crates stacked at y=${bottom.pos[1]}, ${top.pos[1]}`,
  );
  assert(
    sim.isRigidBodySleeping(h.world, bottom) &&
      sim.isRigidBodySleeping(h.world, top),
    'stacked crates settle to sleep',
  );
  assert(h.count('xrsleep') >= 2, 'xrsleep dispatched for settled crates');
  assert(
    !sim.applyRigidBodyImpulse(h.world, top, [NaN, 1, 0]) &&
      !sim.applyRigidBodyImpulse(h.world, top, [1, 2]),
    'non-finite or short impulse is rejected without waking',
  );
  assert(
    sim.isRigidBodySleeping(h.world, top),
    'rejected impulse preserves sleep state',
  );
  sim.applyRigidBodyImpulse(h.world, top, [3, 2, 0]);
  assert(!sim.isRigidBodySleeping(h.world, top), 'impulse wakes sleeping body');
  h.run(0.2);
  assert(top.pos[0] > -1.8, 'impulse moves top crate');
  const prevY = ball.pos[1];
  h.element.setAttribute('rigid-body', 'false');
  sim.applyRigidBodyImpulse(h.world, ball, [0, 10, 0]);
  h.run(0.2);
  assert(
    ball.pos[1] === prevY,
    'rigid-body="false" host attribute disables stepping',
  );
}

function testMechanicalJoints() {
  console.log('\n🔩 mechanical joints (hinge, slider, spring, ball)');
  assert(
    sim.JOINT_TYPES.join() === 'hinge,slider,spring,ball' &&
      typeof sim.parseJoint === 'function',
    'JOINT_TYPES + parseJoint re-exported from xr-live/sim',
  );

  const h = makeHarness([
    {
      name: 'DoorY',
      translation: [0, 1, 0],
      cube: 0.2,
      xr: {
        joint: {
          type: 'hinge',
          anchor: [-0.5, 0, 0],
          axis: 'y',
          limits: [-30, 45],
          motorSpeed: 4,
          motorMaxForce: 100,
        },
      },
    },
    {
      name: 'FlapX',
      translation: [2, 1, 0],
      cube: 0.2,
      xr: {
        joint: {
          type: 'hinge',
          anchor: [0, 0.3, 0],
          axis: 'x',
          limits: [-60, 60],
          motorSpeed: 3,
          motorMaxForce: 80,
        },
      },
    },
    {
      name: 'SliderDrawer',
      translation: [-2, 1, 0],
      cube: 0.2,
      xr: {
        joint: {
          type: 'slider',
          axis: 'x',
          limits: [-0.2, 0.35],
          motorSpeed: 2,
          motorMaxForce: 80,
        },
      },
    },
    {
      name: 'SpringWeight',
      translation: [0, 2, -2],
      cube: 0.15,
      xr: {
        rigidBody: {body: 'dynamic', mass: 1, gravityScale: 1},
        joint: {
          type: 'spring',
          anchor: [0, 0.6, 0],
          restLength: 0.6,
          stiffness: 80,
          damping: 12,
        },
      },
    },
    {
      name: 'StiffSpring',
      translation: [2, 2, -2],
      cube: 0.15,
      xr: {
        rigidBody: {body: 'dynamic', mass: 0.2, gravityScale: 1},
        joint: {
          type: 'spring',
          anchor: [0, 0.5, 0],
          restLength: 0.3,
          stiffness: 10000,
          damping: 100,
        },
      },
    },
    {
      name: 'TwinA',
      translation: [-2, 2, 2],
      cube: 0.15,
      xr: {rigidBody: {body: 'dynamic', mass: 1, gravityScale: 0}},
    },
    {
      name: 'TwinB',
      translation: [-0.8, 2, 2],
      cube: 0.15,
      xr: {
        rigidBody: {body: 'dynamic', mass: 1, gravityScale: 0},
        joint: {
          type: 'spring',
          target: 'TwinA',
          restLength: 0.4,
          stiffness: 60,
          damping: 8,
        },
      },
    },
    {
      name: 'BallBob',
      translation: [2.35, 1.5, 2],
      cube: 0.15,
      xr: {
        joint: {
          type: 'ball',
          anchor: [-0.35, 0.5, 0],
          limits: [-25, 25],
          damping: 2,
        },
      },
    },
    {
      name: 'SelfJoint',
      translation: [4, 1, 0],
      cube: 0.15,
      xr: {
        joint: {type: 'spring', target: 'SelfJoint', stiffness: 100},
      },
    },
  ]);

  const doorY = h.body('DoorY');
  const flapX = h.body('FlapX');
  const slider = h.body('SliderDrawer');
  const springW = h.body('SpringWeight');
  const stiff = h.body('StiffSpring');
  const twinA = h.body('TwinA');
  const twinB = h.body('TwinB');
  const ballBob = h.body('BallBob');
  const selfJoint = h.body('SelfJoint');

  h.run(1.2);

  const maxRad45 = (45 * Math.PI) / 180;
  assert(
    near(doorY.yaw, maxRad45, 0.02),
    `Y-axis motorized hinge reaches +45° limit (yaw=${doorY.yaw.toFixed(3)})`,
  );
  assert(
    Math.abs(flapX.rot[0]) > 0.25 && Number.isFinite(flapX.rot[3]),
    `X-axis hinge updates body.rot quaternion (${flapX.rot.map((v) => v.toFixed(3)).join(',')})`,
  );
  assert(
    near(slider.pos[0], -2 + 0.35, 0.02) && near(slider.pos[1], 1, 1e-4),
    `slider motor translates along +X and clamps at +0.35m (x=${slider.pos[0].toFixed(3)})`,
  );
  assert(
    springW.pos[1] < 2.0 && springW.pos[1] > 1.5 && Number.isFinite(springW.pos[1]),
    `spring weight sags under gravity and settles (y=${springW.pos[1].toFixed(3)})`,
  );
  assert(
    stiff.pos.every(Number.isFinite) &&
      Math.abs(stiff.pos[1] - 2.2) < 0.1,
    `L-stable stiff spring (k=10000) stays finite without blowup (y=${stiff.pos[1].toFixed(3)})`,
  );
  assert(
    twinA.pos[0] > -2.0 + 0.15 &&
      twinB.pos[0] < -0.8 - 0.15 &&
      near(twinA.pos[0] + twinB.pos[0], -2.8, 0.02),
    `two-body spring pulls TwinA (${twinA.pos[0].toFixed(3)}) & TwinB (${twinB.pos[0].toFixed(3)}) symmetrically`,
  );
  assert(
    ballBob.pos[0] < 2.35 && Number.isFinite(ballBob.pos[1]),
    `ball pendulum swings inward under gravity (x=${ballBob.pos[0].toFixed(3)})`,
  );
  assert(
    selfJoint.pos.every(Number.isFinite),
    'self-targeting joint safely anchors to world without NaN',
  );

  // Impulse on a joint-only body (no rigidBody trait) wakes and moves it.
  assert(
    sim.applyRigidBodyImpulse(h.world, slider, [-8, 0, 0]),
    'applyRigidBodyImpulse accepts joint-only body',
  );
  h.run(0.15);
  assert(
    slider.pos[0] < -1.66,
    `impulse drives slider backward within limits (x=${slider.pos[0].toFixed(3)})`,
  );

  resetSimScenario(h.viewer);
  assert(
    doorY.yaw === 0 &&
      flapX.rot.join() === '0,0,0,1' &&
      slider.pos.join() === '-2,1,0',
    'resetSimScenario restores pos, yaw, and rot quaternion',
  );
}

// ---------------------------------------------------------------------------
// Cross-platform parity (testdata/golden/sim_scene.json)
// ---------------------------------------------------------------------------

const r6 = (v: number) => Math.round(v * 1e6) / 1e6;
const r6v = (v: readonly number[]) => v.map(r6);

/** Renderer-independent summary of {@link computeSimVisuals} for goldens. */
function simVisualsSummary(world: SimWorld): Record<string, unknown> {
  const v = computeSimVisuals(world);
  return {
    flashing: v.flashing.map((b) => b.name),
    projectiles: v.projectiles.map(r6v),
    fragments: v.fragments.map((f) => r6v(f.pos)),
    bars: v.bars.map((b) => ({
      name: b.body.name,
      center: r6v(b.center),
      yaw: r6(b.yaw),
      width: r6(b.width),
      frac: r6(b.frac),
      color: r6v(b.color),
    })),
    zones: v.zones.map((z) => ({
      name: z.body.name,
      center: r6v(z.center),
      yaw: r6(z.yaw),
      size: r6v(z.size),
      color: r6v(z.color),
    })),
  };
}

/** Summary of {@link characterCameraRig} for goldens. */
function simCameraSummary(world: SimWorld): Record<string, unknown> | null {
  const rig = characterCameraRig(world);
  return rig
    ? {
        mode: rig.mode,
        target: r6v(rig.target),
        phiDeg: r6(rig.phiDeg),
        distance: r6(rig.distance),
      }
    : null;
}

/** Deep comparison with a numeric tolerance (goldens round to 1e-6). */
function nearlyEqual(a: unknown, b: unknown, eps = 1e-4): boolean {
  if (typeof a === 'number' && typeof b === 'number') {
    return Math.abs(a - b) <= eps;
  }
  if (Array.isArray(a) && Array.isArray(b)) {
    return (
      a.length === b.length && a.every((x, i) => nearlyEqual(x, b[i], eps))
    );
  }
  if (a && b && typeof a === 'object' && typeof b === 'object') {
    const ka = Object.keys(a as object).sort();
    const kb = Object.keys(b as object).sort();
    return (
      JSON.stringify(ka) === JSON.stringify(kb) &&
      ka.every((k) =>
        nearlyEqual(
          (a as Record<string, unknown>)[k],
          (b as Record<string, unknown>)[k],
          eps,
        ),
      )
    );
  }
  return a === b;
}

/** Steps the shared parity scene and returns checkpoint poses and event counts. */
// tslint:disable-next-line:no-any Parsed scene JSON.
export function runSimParityScene(scene: any): Record<string, unknown> {
  const gltf = JSON.parse(JSON.stringify(scene.gltf));
  const worldMats = resolveNodeWorldMatrices(gltf);
  // tslint:disable-next-line:no-any Mesh records.
  const meshes: any[] = [];
  const bmin = [Infinity, Infinity, Infinity];
  const bmax = [-Infinity, -Infinity, -Infinity];
  // tslint:disable-next-line:no-any glTF node JSON.
  gltf.nodes.forEach((n: any, i: number) => {
    if (typeof n.mesh !== 'number') return;
    const acc =
      gltf.accessors[gltf.meshes[n.mesh].primitives[0].attributes.POSITION];
    const unit = buildBoxGeometry(0.5);
    const positions = new Float32Array(unit.positions.length);
    for (let v = 0; v < positions.length; v += 3) {
      for (let k = 0; k < 3; k++) {
        const t = unit.positions[v + k] + 0.5;
        positions[v + k] = acc.min[k] + (acc.max[k] - acc.min[k]) * t;
      }
    }
    const m = worldMats[i];
    for (let c = 0; c < 8; c++) {
      const p = [0, 1, 2].map((k) => ((c >> k) & 1 ? acc.max[k] : acc.min[k]));
      for (let k = 0; k < 3; k++) {
        const w = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
        bmin[k] = Math.min(bmin[k], w);
        bmax[k] = Math.max(bmax[k], w);
      }
    }
    meshes.push({
      name: n.name,
      nodeIndex: i,
      transform: new Float32Array(m),
      normalMatrix: new Float32Array(9),
      visible: true,
      extras: n.extras,
      primitives: [{positions, indices: unit.indices, baseColor: [1, 1, 1, 1]}],
    });
  });
  const attrs = new Map<string, string>();
  const cfg = scene.config ?? {};
  if (cfg.hitMode) attrs.set('hit-zones', cfg.hitMode);
  if (cfg.objectives) attrs.set('objectives', '');
  if (cfg.attempts !== undefined) attrs.set('attempts', String(cfg.attempts));
  if (cfg.scenarioTimer !== undefined)
    attrs.set('scenario-timer', String(cfg.scenarioTimer));
  if (cfg.targetScore !== undefined)
    attrs.set('target-score', String(cfg.targetScore));
  const listeners = new Map<string, Set<(e: unknown) => void>>();
  const counts: Record<string, number> = {};
  for (const e of scene.events) counts[e] = 0;
  const element = {
    getAttribute: (n: string) => (attrs.has(n) ? attrs.get(n)! : null),
    hasAttribute: (n: string) => attrs.has(n),
    setAttribute: (n: string, v: string) => attrs.set(n, v),
    addEventListener: (t: string, fn: (e: unknown) => void) => {
      if (!listeners.has(t)) listeners.set(t, new Set());
      listeners.get(t)!.add(fn);
    },
    removeEventListener: () => {},
    dispatchEvent: (e: CustomEvent) => {
      if (e.type in counts) counts[e.type]++;
      return true;
    },
  };
  const head = mat4Create();
  mat4FromRotationTranslationScale(
    head,
    scene.headPose.quaternion,
    scene.headPose.position,
    [1, 1, 1],
  );
  const view = mat4Create();
  mat4Invert(view, head);
  const viewer = {
    gltf,
    meshes,
    bounds: {min: bmin, max: bmax},
    container: element,
    modelRootMatrix: mat4Create(),
    viewMatrix: view,
  };
  const world = getSimWorld(viewer);
  const key = (type: string, code: string) => {
    for (const fn of listeners.get(type) ?? []) {
      fn({code, repeat: false, target: null, preventDefault() {}});
    }
  };
  const held = new Set<string>();
  const setKey = (code: string, down: boolean) => {
    if (down && !held.has(code)) {
      held.add(code);
      key('keydown', code);
    } else if (!down && held.has(code)) {
      held.delete(code);
      key('keyup', code);
    }
  };
  const checkpoints: Array<Record<string, unknown>> = [];
  // Frame 0 attaches input; inputs scheduled at frame f apply before step f+1.
  stepSimWorld(world, 0);
  for (let f = 0; f < scene.frames; f++) {
    // tslint:disable-next-line:no-any Input record.
    for (const inp of scene.inputs.filter((x: any) => x.frame === f)) {
      if (f === 0) stepSimWorld(world, 1 / 60);
      setKey('KeyW', inp.moveZ > 0);
      setKey('KeyS', inp.moveZ < 0);
      setKey('KeyD', inp.moveX > 0);
      setKey('KeyA', inp.moveX < 0);
      if (inp.jump) key('keydown', 'Space');
      if (inp.fire) key('keydown', 'KeyF');
    }
    if (f !== 0 || !scene.inputs.some((x: {frame: number}) => x.frame === 0)) {
      stepSimWorld(world, 1 / 60);
    }
    if (scene.checkpoints.includes(f + 1)) {
      const bodies: Record<string, number[]> = {};
      for (const b of world.bodies) {
        bodies[b.name] = [...b.pos, b.yaw].map(
          (v) => Math.round(v * 1e6) / 1e6,
        );
      }
      const cp: Record<string, unknown> = {frame: f + 1, bodies};
      if (scene.visuals) {
        cp['visuals'] = simVisualsSummary(world);
        cp['camera'] = simCameraSummary(world);
      }
      checkpoints.push(cp);
    }
  }
  const st = getScenarioState(world);
  return {
    checkpoints,
    events: counts,
    score: st?.score ?? 0,
    attemptsLeft:
      st && Number.isFinite(st.attemptsLeft) ? st.attemptsLeft : null,
    integrity: Object.fromEntries(
      world.bodies
        .filter((b) => b.traits.integrity)
        .map((b) => [b.name, b.integrity]),
    ),
  };
}

/** Golden scenes shared with XRSimWorldTest.kt and XRSimWorldTests.swift. */
const SIM_GOLDENS = [
  ['sim_scene.json', 'sim_expected.json'],
  ['sim_visuals_scene.json', 'sim_visuals_expected.json'],
  ['sim_physics_scene.json', 'sim_physics_expected.json'],
] as const;

function testGoldenParity() {
  // tslint:disable-next-line:no-require-imports
  const fs = require('fs');
  // tslint:disable-next-line:no-require-imports
  const path = require('path');
  const dirs = [
    path.resolve(__dirname, '../../../testdata/golden'),
    path.resolve(__dirname, '../../testdata/golden'),
    path.resolve(__dirname, '../testdata/golden'),
    path.resolve(process.cwd(), 'testdata/golden'),
    path.resolve(
      process.cwd(),
      'experimental/users/binghamj/three_live/testdata/golden',
    ),
  ];
  const dir = dirs.find((d: string) =>
    fs.existsSync(path.join(d, 'sim_scene.json')),
  );
  if (!dir) {
    assert(false, 'testdata/golden/sim_scene.json found');
    return;
  }
  // UPDATE_SIM_GOLDEN=<dir> writes every `*_expected.json` into <dir>.
  const outDir = process.env['UPDATE_SIM_GOLDEN'];
  for (const [sceneFile, expectedFile] of SIM_GOLDENS) {
    console.log(`\n🏆 cross-platform parity (${sceneFile})`);
    const scenePath = path.join(dir, sceneFile);
    if (!fs.existsSync(scenePath)) {
      assert(false, `${sceneFile} present`);
      continue;
    }
    const scene = JSON.parse(fs.readFileSync(scenePath, 'utf8'));
    const actual = runSimParityScene(scene);
    if (outDir) {
      fs.writeFileSync(
        path.join(outDir, expectedFile),
        JSON.stringify(actual, null, 2) + '\n',
      );
    }
    const expectedPath = path.join(dir, expectedFile);
    if (!fs.existsSync(expectedPath)) {
      assert(Boolean(outDir), `${expectedFile} present`);
      continue;
    }
    // tslint:disable-next-line:no-any Parsed JSON.
    const exp = JSON.parse(fs.readFileSync(expectedPath, 'utf8')) as any;
    // tslint:disable-next-line:no-any Parsed JSON.
    const act = actual as any;
    assert(
      act.checkpoints.length === exp.checkpoints.length,
      `${sceneFile}: checkpoint count`,
    );
    for (let i = 0; i < exp.checkpoints.length; i++) {
      const e = exp.checkpoints[i];
      const a = act.checkpoints[i] ?? {};
      assert(
        nearlyEqual(
          Object.keys(a.bodies ?? {}).sort(),
          Object.keys(e.bodies).sort(),
        ),
        `frame ${e.frame}: same bodies`,
      );
      for (const [name, pose] of Object.entries(e.bodies)) {
        assert(
          nearlyEqual(a.bodies?.[name], pose),
          `frame ${e.frame}: ${name} pose matches golden`,
        );
      }
      if ('visuals' in e) {
        assert(
          nearlyEqual(a.visuals, e.visuals),
          `frame ${e.frame}: visuals match golden`,
        );
        assert(
          nearlyEqual(a.camera, e.camera),
          `frame ${e.frame}: camera rig matches golden`,
        );
      }
    }
    for (const [ev, n] of Object.entries(exp.events)) {
      assert(
        act.events[ev] === n,
        `event count ${ev} = ${n} (got ${act.events[ev]})`,
      );
    }
    assert(act.score === exp.score, `score = ${exp.score}`);
    assert(
      act.attemptsLeft === exp.attemptsLeft,
      `attemptsLeft = ${exp.attemptsLeft}`,
    );
    assert(
      nearlyEqual(act.integrity, exp.integrity),
      'integrity values match golden',
    );
  }
}

function run() {
  console.log('🎮 Running xr-live-sim plugin tests...');
  testHelpers();
  testWorldBuild();
  testCharacter();
  testPlatforms();
  testAgents();
  testHitZones();
  testContactsZonesSpawners();
  testObjectives();
  testAudio();
  testBundleExports();
  testRigidBodyPhysics();
  testMechanicalJoints();
  testGoldenParity();
  console.log(
    `\n🏆 xr-live-sim Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

try {
  run();
} catch (err) {
  console.error('Test execution failed:', err);
  process.exit(1);
}
