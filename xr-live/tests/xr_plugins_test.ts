// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

/**
 * @fileoverview Unit tests for the seven optional XR Blocks `<xr-live>`
 * plugins (`xr-live/src/plugins/*`).
 */

import {
  mat4Create,
  mat4FromRotationTranslationScale,
} from '../../three-live/src/math';
import {getRegisteredPlugins, getSharedRegistry} from '../../three-live/src/plugin';
import {THREE} from '../../three-live/src/three-author';
import {sceneToCanvas3D} from '../../three-live/src/three-convert';
import {
  buildUsdXRLines,
  normalizeXRTraits,
  registerXRTraitSerializer,
  safeMediaUrl,
  upgradeGltfNodeXR,
} from '../../three-live/src/xr-trait-schema';
import {
  buildBoxGeometry,
  computeLocalBounds,
  createDynamicMesh,
  removeDynamicMesh,
  updateDynamicMesh,
} from '../src/plugins/common';
import {
  buildParticleTopology,
  isOccludedByDepth,
  ParticleEmitter,
  parseParticles,
  XRDepthParticlesController,
} from '../src/plugins/depth-particles';
import {
  buildHoldToAskPrompt,
  bytesToBase64,
  decodePcm16Base64,
  pcmRateFromMime,
  isAllowedLiveUrl,
  parseHoldToAsk,
  TranscriptionManager,
  XRGeminiLiveController,
  type GeminiLiveTransport,
} from '../src/plugins/gemini-live';
import {
  angleFromForwardDeg,
  computeOrbitPosition,
  parseLazyFollow,
  parseOrbit,
  stepCriticallyDampedSpring,
  XRHeadFollowController,
} from '../src/plugins/head-follow';
import * as xrLiveFull from '../src/full';
import {xrBlocksPlugins} from '../src/plugins/index';
import {
  computeHandleLayout,
  parseHandles,
  pickHandle,
  XRManipulationHandlesController,
} from '../src/plugins/manipulation-handles';
import {
  catmullRom,
  paintPointFor,
  parseHexColor,
  TubeStrokeBuilder,
  XRSpatialPaintController,
} from '../src/plugins/spatial-paint';
import {
  parseSplat,
  parseSpzPayload,
  resolveSplatUrl,
  sortSplatsByDepth,
} from '../src/plugins/splat-loader';
import {
  hitTestPlanes,
  normalizeBox,
  parseDetections,
  unprojectDetectionTo3D,
  XRTapeMeasure,
  XRWorldUnderstandingController,
  type TrackedPlane,
} from '../src/plugins/world-understanding';
import {extractPosition, extractScale, type XRPose6DoF, XRTraitSystem} from '../src/xr-traits';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

function near(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

function pose(pos: [number, number, number], yaw = 0): XRPose6DoF {
  const q: [number, number, number, number] = [0, Math.sin(yaw / 2), 0, Math.cos(yaw / 2)];
  const m = mat4Create();
  mat4FromRotationTranslationScale(m, q, pos, [1, 1, 1]);
  return {position: pos, quaternion: q, matrix: m};
}

// tslint:disable-next-line:no-any Test mesh records.
function meshAt(name: string, pos: [number, number, number], xr: Record<string, unknown>, scale = 1): any {
  const transform = mat4Create();
  mat4FromRotationTranslationScale(transform, [0, 0, 0, 1], pos, [scale, scale, scale]);
  const box = buildBoxGeometry(0.5);
  return {
    name,
    transform,
    normalMatrix: new Float32Array(9),
    extras: {xr},
    userData: {xr},
    primitives: [{positions: box.positions, indices: box.indices}],
  };
}

function testRegistration(): void {
  console.log('\n🧩 Plugin registration');
  assert(xrBlocksPlugins.length === 7, 'exports seven plugins');
  assert(
    xrLiveFull.xrBlocksPlugins === xrBlocksPlugins && typeof xrLiveFull.connectGeminiLive === 'function',
    'xr-live-full includes the XR Blocks plugins',
  );
  const names = getRegisteredPlugins().map((p) => p.name);
  for (const n of [
    'xr-live-head-follow',
    'xr-live-manipulation-handles',
    'xr-live-world-understanding',
    'xr-live-gemini-live',
    'xr-live-spatial-paint',
    'xr-live-depth-particles',
    'xr-live-splat-loader',
  ]) {
    assert(names.includes(n), `registers ${n}`);
  }
}

function testCommon(): void {
  console.log('\n🧱 Common dynamic meshes');
  const viewer = {meshes: [] as unknown[]};
  const m = createDynamicMesh(viewer, buildBoxGeometry(0.5), {name: 'box', pickable: false});
  assert(viewer.meshes.length === 1 && m.extras.xr.pointerEvents === 'none', 'unpickable mesh appended with pointerEvents none');
  const b = computeLocalBounds(m);
  assert(near(b.min[0], -0.5) && near(b.max[1], 0.5), 'computeLocalBounds spans box');
  m.primitives[0]._boundingSphere = {cx: 0, cy: 0, cz: 0, r: 1};
  updateDynamicMesh(viewer, m, buildBoxGeometry(2));
  assert(m.primitives[0]._boundingSphere === undefined, 'updateDynamicMesh invalidates ray-cast sphere cache');
  assert(near(computeLocalBounds(m).max[0], 2), 'updateDynamicMesh swaps geometry');
  removeDynamicMesh(viewer, m);
  assert(viewer.meshes.length === 0, 'removeDynamicMesh detaches mesh');
  assert(near(computeLocalBounds({primitives: []}).max[0], 0.5), 'empty mesh falls back to unit bounds');
}

function testHeadFollow(): void {
  console.log('\n🎯 head-follow');
  assert(parseLazyFollow('head') === null, 'string follow stays with XRTraitSystem');
  const opts = parseLazyFollow({distance: 99, deadzoneDeg: -5, stiffness: NaN})!;
  assert(opts.distance === 10 && opts.deadzoneDeg === 0 && opts.stiffness === 6, 'lazy follow options clamp');

  const s = {position: [1, 0, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number]};
  for (let i = 0; i < 600; i++) stepCriticallyDampedSpring(s, [0, 0, 0], 6, 1 / 60);
  assert(Math.abs(s.position[0]) < 1e-4, 'critically damped spring converges');
  const s2 = {position: [1, 0, 0] as [number, number, number], velocity: [0, 0, 0] as [number, number, number]};
  let overshoot = false;
  for (let i = 0; i < 600; i++) {
    stepCriticallyDampedSpring(s2, [0, 0, 0], 10, 0.1);
    if (s2.position[0] < -1e-6) overshoot = true;
  }
  assert(!overshoot, 'spring is stable and does not overshoot with large dt');

  assert(near(angleFromForwardDeg(pose([0, 1.6, 0]), [0, 1.6, -1]), 0), 'object straight ahead is 0°');
  assert(near(angleFromForwardDeg(pose([0, 1.6, 0]), [1, 1.6, 0]), 90), 'object to the right is 90°');

  const ctrl = new XRHeadFollowController();
  const hud = meshAt('hud', [0, 0, 0], {follow: {distance: 1, deadzoneDeg: 20, height: 0}});
  ctrl.update([hud], pose([0, 1.6, 0]), {}, 1 / 60);
  let p = extractPosition(hud.transform);
  assert(near(p[2], -1) && near(p[1], 1.6), 'snapOnStart places HUD in front of head');
  ctrl.update([hud], pose([0, 1.6, 0], (10 * Math.PI) / 180), {}, 1 / 60);
  p = extractPosition(hud.transform);
  assert(near(p[2], -1) && !ctrl.isFollowing(hud), 'small head turn inside deadzone keeps HUD still');
  const wide = meshAt('wide', [0, 0, 0], {follow: {distance: 1, deadzoneDeg: 60, height: 0}});
  ctrl.update([wide], pose([0, 1.6, 0]), {}, 1 / 60);
  ctrl.update([wide], pose([0, 1.6, 0], (45 * Math.PI) / 180), {}, 1 / 60);
  assert(!ctrl.isFollowing(wide), 'large deadzone (60°) is honored for a 45° head turn');
  for (let i = 0; i < 240; i++) ctrl.update([hud], pose([0, 1.6, 0], Math.PI / 2), {}, 1 / 60);
  p = extractPosition(hud.transform);
  assert(near(p[0], -1, 0.02) && near(p[2], 0, 0.02), 'large head turn re-centers HUD after spring settles');
  const scaleBefore = extractScale(hud.transform)[0];
  assert(near(scaleBefore, 1), 'follow preserves mesh scale');

  const grabbed = meshAt('g', [5, 5, 5], {follow: {}});
  ctrl.update([grabbed], pose([0, 1.6, 0]), {}, 1 / 60, () => true);
  assert(near(extractPosition(grabbed.transform)[0], 5), 'grabbed meshes are not moved');

  const orbitOpts = parseOrbit({radius: 2, speed: Math.PI, target: [1, 0, 0]})!;
  const op = computeOrbitPosition([1, 0, 0], orbitOpts, 0.5);
  assert(near(op[0], 1) && near(op[2], 2), 'orbit position after quarter turn');
  const planet = meshAt('planet', [3, 0, 0], {});
  const moon = meshAt('moon', [0, 0, 0], {orbit: {target: 'planet', radius: 1, speed: 0}});
  ctrl.update([planet, moon], pose([0, 1.6, 0]), {}, 1 / 60);
  assert(near(extractPosition(moon.transform)[0], 4), 'orbit follows named target mesh');
  const self = meshAt('self', [0, 0, 0], {orbit: {target: 'self'}});
  ctrl.update([self], pose([0, 1.6, 0]), {}, 1 / 60);
  assert(near(extractPosition(self.transform)[0], 0), 'self-referential orbit target is ignored');
  assert(parseOrbit({target: 'x'.repeat(300)})!.target instanceof Array, 'over-long orbit target names rejected');

  const ts = new XRTraitSystem();
  const lazy = meshAt('lazy', [0, 0, -3], {follow: {mode: 'head'}});
  ts.update([lazy], pose([0, 1.6, 0]), {}, 1 / 60);
  assert(near(extractPosition(lazy.transform)[2], -3), 'XRTraitSystem defers object follow to plugin');
}

function testHandles(): void {
  console.log('\n🔲 manipulation-handles');
  assert(parseHandles(false) === null, 'handles disabled by false');
  const o = parseHandles({minScale: 5, maxScale: 1})!;
  assert(o.maxScale >= o.minScale, 'maxScale never below minScale');
  const chair = meshAt('chair', [0, 0, -2], {handles: {minScale: 0.5, maxScale: 2}});
  const layout = computeHandleLayout(chair);
  assert(layout.corners.length === 4 && near(layout.corners[2][1], 0.5), 'four top corners at bbox top');
  const opts = parseHandles(chair.extras.xr.handles)!;
  const hit = pickHandle(layout, [0.5, 0.5, 0], [0, 0, -1], opts);
  assert(hit?.kind === 'corner', 'ray picks corner handle');
  assert(pickHandle(layout, [10, 10, 0], [0, 0, -1], opts) === null, 'ray misses handles');

  const ctrl = new XRManipulationHandlesController();
  const c = layout.corners[2];
  ctrl.beginDrag([chair], [c[0], c[1], 0], [0, 0, -1], 'right');
  assert(ctrl.activeMesh === chair, 'beginDrag selects mesh');
  ctrl.updateDrag([c[0] * 10, c[1] * 10, 0], [0, 0, -1], 'right');
  assert(near(extractScale(chair.transform)[0], 2), 'corner drag scale clamps to maxScale');
  ctrl.updateDrag([c[0], c[1], 0], [0, 0, -1], 'left');
  assert(near(extractScale(chair.transform)[0], 2), 'other hand cannot hijack drag');
  const summary = ctrl.endDrag('right');
  assert(summary?.mesh === 'chair' && near(summary.scale, 2), 'endDrag summary');

  const table = meshAt('table', [0, 0, -2], {handles: true});
  const tl = computeHandleLayout(table);
  const ped = tl.pedestalStart;
  const h2 = ctrl.beginDrag([table], [ped[0] + 0.25, ped[1] + 1, ped[2]], [0, -1, 0]);
  assert(h2?.kind === 'rotate', 'ray picks pedestal rotate bar');
  // Start point is on the bar left of the pivot (-x); drag to +z (toward the
  // viewer): a +90° yaw about +Y.
  ctrl.updateDrag([0, ped[1] + 1, -2 + 0.5], [0, -1, 0]);
  const yawDeg = ctrl.endDrag()!.yawDeg;
  assert(near(Math.abs(yawDeg), 90, 1), 'pedestal drag yaws the mesh by the pointer angle');
  ctrl.beginDrag([table], [ped[0] + 0.25, ped[1] + 1, ped[2]], [0, -1, 0]);
  const p = extractPosition(table.transform);
  assert(near(p[0], 0) && near(p[2], -2), 'rotation keeps pivot fixed');
  assert(near(extractScale(table.transform)[0], 1), 'rotation keeps scale');
  ctrl.endDrag();

  // modelRootMatrix != identity: picking must use the drawn world matrix.
  const placed = meshAt('placed', [0, 0, 0], {handles: true});
  const root = mat4Create();
  mat4FromRotationTranslationScale(root, [0, 0, 0, 1], [5, 0, 0], [1, 1, 1]);
  const rootViewer = {meshes: [placed] as unknown[], modelRootMatrix: root};
  const pl = computeHandleLayout(placed, rootViewer);
  assert(near(pl.corners[0][0], 4.5), 'handle layout includes modelRootMatrix');
  const rh = ctrl.beginDrag([placed], [pl.corners[2][0], pl.corners[2][1], 3], [0, 0, -1], 'right', rootViewer);
  assert(rh?.kind === 'corner', 'handles pick in world space under a root placement');
  ctrl.endDrag();
  ctrl.syncVisuals(rootViewer);
  const corner = rootViewer.meshes[1] as {transform: Float32Array};
  assert(near(corner.transform[12], pl.corners[0][0] - 5), 'handle visuals compensate for root placement');

  const viewer = {meshes: [table] as unknown[]};
  ctrl.syncVisuals(viewer);
  assert(viewer.meshes.length === 6, 'syncVisuals adds 4 corners + rotate bar');
  table.extras.xr.handles = false;
  table.userData.xr.handles = false;
  ctrl.syncVisuals(viewer);
  assert(viewer.meshes.length === 1, 'visuals removed when trait cleared');
}

function testWorldUnderstanding(): void {
  console.log('\n🌍 world-understanding');
  assert(normalizeBox([100, 200, 300, 400])![1] === 0.2, 'Gemini 0..1000 boxes normalized');
  assert(normalizeBox([0.5, 0.1, 0.2, 0.3])![0] === 0.2, 'inverted boxes reordered');
  assert(normalizeBox([NaN, 0, 1, 1]) === null, 'non-finite boxes rejected');
  {
    const parsed = parseDetections('[{"label":"cup","box":[100,200,300,400]},{"label":"x","box_2d":[0,0,1,1]},{"box":[1,2]},7]');
    assert(parsed.length === 2 && parsed[0].label === 'cup' && parsed[1].box[3] === 1, 'detections JSON parsed (box / box_2d)');
    const many = JSON.stringify(Array.from({length: 40}, () => ({label: 'a', box: [0, 0, 1, 1]})));
    assert(parseDetections(many).length === 32, 'detections capped at 32');
    assert(parseDetections('not json').length === 0 && parseDetections('{}').length === 0, 'malformed detections ignored');
    assert(parseDetections('[' + '{"box":[0,0,1,1]},'.repeat(2000) + '{}]').length === 0, 'oversized detections JSON rejected');
    assert(parseDetections(JSON.stringify([{label: 'y'.repeat(500), box: [0, 0, 1, 1]}]))[0].label.length === 256, 'labels clipped');
  }

  const proj = mat4Create();
  proj[0] = 1;
  proj[5] = 1;
  proj[10] = -1;
  proj[11] = -1;
  proj[14] = -0.2;
  proj[15] = 0;
  const cam = pose([0, 1.6, 0]).matrix;
  const center = unprojectDetectionTo3D({label: 'cup', box: [400, 400, 600, 600]}, cam, proj, [], () => 2);
  assert(center !== null && near(center.z, -2) && near(center.y, 1.6) && near(center.x, 0), 'center box at 2 m depth');
  assert(center!.depthSource === 'depth' && near(center!.widthMeters, 0.8), 'size estimate from depth');
  const floor: TrackedPlane = {orientation: 'horizontal', center: [0, 0, 0], normal: [0, 1, 0], radius: 10};
  const low = unprojectDetectionTo3D({label: 'rug', box: [900, 450, 1000, 550]}, cam, proj, [floor]);
  assert(low?.depthSource === 'plane' && near(low.y, 0, 0.01), 'falls back to plane hit on floor');
  const none = unprojectDetectionTo3D({label: 'x', box: [0, 0, 1, 1]}, cam, proj, []);
  assert(none?.depthSource === 'fallback' && near(none.z, -1.5), 'falls back to fixed depth');

  assert(hitTestPlanes([floor], [0, 1, 0], [0, 1, 0]) === null, 'ray away from plane misses');
  const tape = new XRTapeMeasure();
  tape.addPoint([0, 0, 0]);
  const seg = tape.addPoint([3, 4, 0]);
  assert(near(seg, 5) && near(tape.totalMeters, 5), 'tape measure segment length');
  assert(tape.addPoint([NaN, 0, 0]) === 0 && tape.pointList.length === 2, 'tape ignores invalid points');

  const ctrl = new XRWorldUnderstandingController();
  const planeMatrix = mat4Create();
  planeMatrix[13] = 0.75;
  ctrl.updateFromXRFrame(
    {
      detectedPlanes: new Set([{planeSpace: {}, orientation: 'horizontal', polygon: [{x: 1, z: 0}, {x: 0, z: 2}]}]),
      detectedMeshes: new Set([{}, {}]),
      getPose: () => ({transform: {matrix: planeMatrix}}),
    },
    {},
  );
  assert(ctrl.planes.length === 1 && near(ctrl.planes[0].center[1], 0.75) && near(ctrl.planes[0].radius, 2), 'tracks WebXR planes');
  assert(ctrl.meshCount === 2, 'counts WebXR meshes');
  const viewer = {meshes: [] as unknown[]};
  const head = pose([0, 1.6, 0]);
  head.matrix.set(mat4Create());
  const look = mat4Create();
  // Looking straight down.
  mat4FromRotationTranslationScale(look, [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], [0, 1.6, 0], [1, 1, 1]);
  ctrl.updateReticle(viewer, {position: [0, 1.6, 0], quaternion: [-Math.SQRT1_2, 0, 0, Math.SQRT1_2], matrix: look});
  assert(ctrl.reticleHit !== null && near(ctrl.reticleHit.point[1], 0.75), 'reticle lands on table plane');
  ctrl.dispose(viewer);
  assert(viewer.meshes.length === 0, 'dispose removes reticle');
}

async function testGeminiLive(): Promise<void> {
  console.log('\n✨ gemini-live');
  assert(isAllowedLiveUrl('wss://example.com/live'), 'wss allowed');
  assert(isAllowedLiveUrl('ws://localhost:8080'), 'loopback ws allowed');
  assert(!isAllowedLiveUrl('ws://evil.example.com'), 'remote ws rejected');
  assert(!isAllowedLiveUrl('javascript:alert(1)'), 'javascript: rejected');
  assert(bytesToBase64(new Uint8Array([104, 105])) === 'aGk=', 'base64 encoding');
  assert(bytesToBase64(new Uint8Array(100000)).length === 133336, 'base64 encodes large buffers in chunks');

  const tm = new TranscriptionManager();
  tm.append('user', 'hel');
  assert(tm.append('user', 'lo').text === 'hello', 'transcripts accumulate');
  const fin = tm.finalize();
  assert(fin.length === 1 && fin[0].isFinal && fin[0].text === 'hello', 'finalize emits final segment');

  const sent: Array<Record<string, unknown>> = [];
  const events: Array<{type: string; detail: unknown}> = [];
  const element = {
    dispatchEvent(e: Event) {
      events.push({type: e.type, detail: (e as CustomEvent).detail});
      return true;
    },
    captureViewFrame: async () => ({base64: 'AAA', mimeType: 'image/jpeg'}),
  };
  const transport: GeminiLiveTransport = {send: (m) => sent.push(m), close: () => transport.onClose?.()};
  const ctrl = new XRGeminiLiveController(element);
  ctrl.connect({transport, setup: {model: 'm'}, streamFrames: false});
  assert(ctrl.connected && 'setup' in sent[0], 'connect sends setup');
  assert(await ctrl.sendFrame(), 'sendFrame streams viewport');
  ctrl.sendAudioChunk(new Int16Array([1, 2]), 99999);
  const audio = JSON.stringify(sent[sent.length - 1]);
  assert(audio.includes('audio/pcm;rate=48000'), 'audio sample rate clamped');
  ctrl.sendText('x'.repeat(10000));
  const turn = sent[sent.length - 1] as {clientContent: {turns: Array<{parts: Array<{text: string}>}>}};
  assert(turn.clientContent.turns[0].parts[0].text.length === 4000, 'text turns clipped');
  ctrl.handleServerMessage({serverContent: {inputTranscription: {text: 'hi'}}});
  ctrl.handleServerMessage({serverContent: {interrupted: true}});
  ctrl.handleServerMessage({serverContent: {modelTurn: {parts: [{text: 'Hello'}]}, turnComplete: true}});
  assert(events.some((e) => e.type === 'xr-gemini-interrupted'), 'barge-in event emitted');
  const finals = events.filter((e) => e.type === 'xr-transcription' && (e.detail as {isFinal: boolean}).isFinal);
  assert(finals.length === 2, 'turnComplete finalizes user + model transcripts');
  ctrl.handleServerMessage({serverContent: 'nope'} as unknown as Record<string, unknown>);
  ctrl.handleServerMessage({serverContent: {outputTranscription: {text: 'Hi'}}});
  ctrl.handleServerMessage({serverContent: {modelTurn: {parts: [{text: 'Hi'}]}, turnComplete: true}});
  const lastFinal = events.filter((e) => e.type === 'xr-transcription').pop()!.detail as {text: string};
  assert(lastFinal.text === 'Hi', 'output transcription and text parts are not double-counted');
  assert(pcmRateFromMime('audio/pcm;rate=24000') === 24000 && pcmRateFromMime('x') === 24000, 'PCM rate parsing');
  const pcm = decodePcm16Base64(bytesToBase64(new Uint8Array([0x00, 0x80, 0xff, 0x7f])));
  assert(pcm[0] === -1 && near(pcm[1], 32767 / 32768), 'PCM16 decode is signed little-endian');
  ctrl.disconnect();
  assert(!ctrl.connected, 'disconnect closes transport');
  assert(!(await ctrl.sendFrame()), 'sendFrame no-ops when disconnected');

  assert(parseHoldToAsk(undefined) === null, 'holdToAsk absent');
  const h = parseHoldToAsk({holdMs: 1})!;
  assert(h.holdMs === 100 && h.prompt === 'What is this?', 'holdToAsk defaults/clamps');
  assert(buildHoldToAskPrompt('lamp', h, 'how bright?').includes('"lamp". how bright?'), 'hold-to-ask prompt includes object');
}

function testSpatialPaint(): void {
  console.log('\n🖌️ spatial-paint');
  const mid = catmullRom([0, 0, 0], [1, 0, 0], [2, 0, 0], [3, 0, 0], 0.5);
  assert(near(mid[0], 1.5), 'Catmull-Rom interpolates collinear points linearly');
  const b = new TubeStrokeBuilder({radius: 0.01, radialSegments: 6, samplesPerSpan: 2});
  assert(b.build() === null, 'empty stroke has no geometry');
  b.addPoint([0, 0, 0]);
  assert(!b.addPoint([0.0001, 0, 0]), 'points below min spacing rejected');
  assert(!b.addPoint([NaN, 0, 0]), 'non-finite points rejected');
  b.addPoint([0.1, 0, 0]);
  b.addPoint([0.2, 0.1, 0]);
  const g = b.build()!;
  const n = b.smoothedPoints().length;
  assert(n === 5, 'smoothed point count = (points-1)*samples+1');
  assert(g.positions.length === (n * 6 + 6 * 2 + 2) * 3, 'tube vertex count includes duplicated cap rings');
  assert(g.indices.length === ((n - 1) * 6 * 2 + 12) * 3, 'tube index count includes caps');
  let maxIndex = 0;
  for (const i of g.indices) maxIndex = Math.max(maxIndex, i);
  assert(maxIndex < g.positions.length / 3, 'indices within vertex range');
  // Ring 0 vertex distance from centerline equals the radius.
  assert(near(Math.hypot(g.positions[1], g.positions[2]), 0.01), 'tube radius respected');
  // First side triangle faces outward.
  const tri = [g.indices[0], g.indices[1], g.indices[2]].map((i) => [g.positions[i * 3], g.positions[i * 3 + 1], g.positions[i * 3 + 2]]);
  const e1 = tri[1].map((v, k) => v - tri[0][k]);
  const e2 = tri[2].map((v, k) => v - tri[0][k]);
  const cross = [e1[1] * e2[2] - e1[2] * e2[1], e1[2] * e2[0] - e1[0] * e2[2], e1[0] * e2[1] - e1[1] * e2[0]];
  const out = [g.normals[g.indices[0] * 3], g.normals[g.indices[0] * 3 + 1], g.normals[g.indices[0] * 3 + 2]];
  assert(cross[0] * out[0] + cross[1] * out[1] + cross[2] * out[2] > 0, 'side triangles wind outward (CCW)');
  const capIdx = g.indices[g.indices.length - 3];
  const sm = b.smoothedPoints();
  const endDir = [0, 1, 2].map((k) => sm[sm.length - 1][k] - sm[sm.length - 3][k]);
  const endLen = Math.hypot(endDir[0], endDir[1], endDir[2]);
  const capDot = [0, 1, 2].reduce((acc, k) => acc + g.normals[capIdx * 3 + k] * endDir[k] / endLen, 0);
  assert(capDot > 0.99, 'end cap uses an axial (tangent) normal');
  const rev = new TubeStrokeBuilder({radius: 0.01, samplesPerSpan: 1});
  for (const pt of [[0, 0, 0], [0.1, 0, 0], [0.2, 0, 0], [0.1, 0.0001, 0], [0, 0.0002, 0]]) rev.addPoint(pt);
  const rg = rev.build()!;
  assert(Array.from(rg.normals).every((v) => Number.isFinite(v)), 'RMF frames stay finite through a 180° reversal');
  assert(paintPointFor({hand: 'screen', rayOrigin: [0, 1, 0], rayDirection: [0, 0, -2]})![2] === -0.4, 'screen rays paint in front of the camera');
  assert(parseHexColor('#f00')[0] === 1 && parseHexColor('nope')[1] === 0.25, 'hex color parsing with fallback');

  const viewer = {meshes: [] as unknown[]};
  const ctrl = new XRSpatialPaintController();
  ctrl.begin(viewer, [0, 0, 0], 'right');
  assert(ctrl.end(viewer, 'right') === null && ctrl.strokes.length === 0, 'tap without movement leaves nothing');
  ctrl.begin(viewer, [0, 0, 0], 'right');
  ctrl.extend(viewer, [0.1, 0, 0], 'left');
  assert(viewer.meshes.length === 0, 'other hand cannot extend stroke');
  ctrl.extend(viewer, [0.1, 0, 0], 'right', 1);
  ctrl.extend(viewer, [0.2, 0, 0], 'right', 1);
  const s = ctrl.end(viewer, 'right');
  assert(s !== null && near(s.lengthMeters, 0.2) && viewer.meshes.length === 1, 'stroke mesh created');
  assert(ctrl.geometries().length === 1, 'geometries() exports strokes');
  ctrl.undo(viewer);
  assert(viewer.meshes.length === 0 && ctrl.strokes.length === 0, 'undo removes stroke');
}

function testParticles(): void {
  console.log('\n🌧️ depth-particles');
  assert(parseParticles(null) === null, 'particles absent');
  const o = parseParticles({preset: 'snow', count: 1e9, area: 999})!;
  assert(o.count === 2000 && o.area[0] === 50, 'particle count/area clamp');
  assert(parseParticles({preset: 'bogus'})!.preset === 'rain', 'unknown preset falls back to rain');

  const em = new ParticleEmitter({preset: 'rain', count: 50, area: [1, 1, 1], speed: 1}, 7);
  em.reset([0, 1, 0]);
  let inside = true;
  for (let i = 0; i < 50; i++) {
    if (Math.abs(em.positions[i * 3]) > 0.5 || em.positions[i * 3 + 1] < 0.5 || em.positions[i * 3 + 1] > 1.5) inside = false;
  }
  assert(inside, 'particles spawn inside volume');
  for (let i = 0; i < 120; i++) em.step(1 / 60, [0, 1, 0], 0);
  assert(em.collisions > 0, 'rain collides with floor and respawns');
  let above = true;
  for (let i = 0; i < 50; i++) if (em.positions[i * 3 + 1] < 0.4) above = false;
  assert(above, 'particles never sink below volume bottom');

  const proj = mat4Create();
  proj[0] = 1;
  proj[5] = 1;
  proj[10] = -1;
  proj[11] = -1;
  proj[15] = 0;
  const view = mat4Create();
  assert(isOccludedByDepth([0, 0, -3], {view, proj, sample: () => 2}), 'point behind real surface is occluded');
  assert(!isOccludedByDepth([0, 0, -1], {view, proj, sample: () => 2}), 'point in front of surface is visible');
  assert(!isOccludedByDepth([0, 0, 1], {view, proj, sample: () => 2}), 'point behind camera ignored');

  const topo = buildParticleTopology(3);
  assert(topo.indices.length === 36 && Math.max(...topo.indices) === 23, 'particle topology');

  const viewer = {meshes: [meshAt('cloud', [0, 2, 0], {particles: {preset: 'sparks', count: 10}})] as unknown[]};
  const ctrl = new XRDepthParticlesController();
  ctrl.update(viewer, 1 / 60, 0);
  assert(viewer.meshes.length === 2 && ctrl.emitterCount === 1, 'emitter mesh created');
  ctrl.update(viewer, 1 / 60, 0);
  assert(viewer.meshes.length === 2, 'emitter mesh reused across frames');
  viewer.meshes.splice(0, 1);
  ctrl.update(viewer, 1 / 60, 0);
  assert(viewer.meshes.length === 0 && ctrl.emitterCount === 0, 'emitter removed with its mesh');
}

function testSplats(): void {
  console.log('\n💠 splat-loader');
  const buf = new ArrayBuffer(64);
  const dv = new DataView(buf);
  const u8 = new Uint8Array(buf);
  dv.setFloat32(0, 1, true);
  dv.setFloat32(12, 0.1, true);
  u8.set([255, 0, 0, 200], 24);
  u8.set([255, 128, 128, 128], 28);
  dv.setFloat32(32 + 8, -5, true);
  dv.setFloat32(32 + 12, NaN, true);
  u8.set([128, 128, 128, 128], 60);
  const d = parseSplat(buf);
  assert(d.count === 2 && d.positions[0] === 1 && d.colors[0] === 255, '.splat records decoded');
  assert(near(d.rotations[3], 1) && near(d.rotations[0], 0), '.splat quaternion decoded (w first)');
  assert(d.scales[3] === 0 && d.rotations[7] === 1, 'non-finite / zero quaternions sanitized');
  let threw = false;
  try {
    parseSplat(new ArrayBuffer(33));
  } catch {
    threw = true;
  }
  assert(threw, '.splat size validation');

  // Minimal .spz v2 payload with 1 point.
  const count = 1;
  const spz = new Uint8Array(16 + count * (9 + 1 + 3 + 3 + 3));
  const sv = new DataView(spz.buffer);
  sv.setUint32(0, 0x5053474e, true);
  sv.setUint32(4, 2, true);
  sv.setUint32(8, count, true);
  spz[13] = 12;
  // x = 1.0 (4096 at 12 fractional bits), y = -1.0, z = 0.
  spz.set([0x00, 0x10, 0x00], 16);
  spz.set([0x00, 0xf0, 0xff], 19);
  spz[25] = 255;
  spz.set([128, 128, 128], 26);
  spz.set([160, 160, 160], 29);
  spz.set([128, 128, 128], 32);
  const sd = parseSpzPayload(spz);
  assert(near(sd.positions[0], 1) && near(sd.positions[1], -1), '.spz 24-bit fixed-point positions');
  assert(sd.colors[3] === 255 && near(sd.scales[0], Math.exp(0)), '.spz alpha and log scale');
  const truncated = spz.subarray(0, 20);
  threw = false;
  try {
    parseSpzPayload(truncated);
  } catch {
    threw = true;
  }
  assert(threw, '.spz truncation detected');
  sv.setUint32(8, 0xffffffff, true);
  threw = false;
  try {
    parseSpzPayload(spz);
  } catch {
    threw = true;
  }
  assert(threw, '.spz splat count cap enforced');

  const persp = mat4Create();
  persp[11] = -1;
  persp[15] = 0;
  const order = sortSplatsByDepth({count: 3, positions: new Float32Array([0, 0, -1, 0, 0, -5, 0, 0, -3])}, persp);
  assert(order[0] === 1 && order[1] === 2 && order[2] === 0, 'splats sorted back-to-front');

  assert(resolveSplatUrl('https://a.com/x.spz') !== null, 'https splat URL allowed');
  assert(resolveSplatUrl('javascript:alert(1)') === null, 'javascript: splat URL rejected');
  assert(resolveSplatUrl('data:application/octet-stream;base64,AA') === null, 'data: splat URL rejected');
  assert(resolveSplatUrl('http://evil.com/x.splat') === null, 'remote http splat URL rejected');
  assert(resolveSplatUrl('/scans/room.spz', 'https://site.test/app/') === 'https://site.test/scans/room.spz', 'relative URL resolved');
  assert(resolveSplatUrl('https://cdn.test/x.spz', 'https://site.test/', false) === null, 'cross-origin splat rejected without opt-in');
  assert(resolveSplatUrl('https://site.test/x.spz', 'https://site.test/', false) !== null, 'same-origin splat allowed without opt-in');

  // .spz v3 smallest-three rotation: largest = w (index 3), x = +0.5 -> mag 361.
  const v3 = new Uint8Array(16 + 9 + 1 + 3 + 3 + 4);
  const v3v = new DataView(v3.buffer);
  v3v.setUint32(0, 0x5053474e, true);
  v3v.setUint32(4, 3, true);
  v3v.setUint32(8, 1, true);
  v3[13] = 12;
  v3.set([128, 128, 128], 16 + 9 + 1);
  const mag = Math.round((0.5 / Math.SQRT1_2) * 511);
  // Loop order k=2,1,0 consumes the low bits first: z, y, then x.
  const comp = ((3 << 30) | (mag << 20)) >>> 0;
  v3v.setUint32(16 + 9 + 1 + 3 + 3, comp, true);
  const r3 = parseSpzPayload(v3);
  assert(near(r3.rotations[0], 0.5, 0.01) && near(r3.rotations[3], Math.sqrt(0.75), 0.01), '.spz v3 smallest-three rotation');
  const badBits = new Uint8Array(v3);
  badBits[13] = 31;
  threw = false;
  try {
    parseSpzPayload(badBits);
  } catch {
    threw = true;
  }
  assert(threw, '.spz fractional bits > 24 rejected');
  // Color decode: DC byte 128 -> ~0.5 gray.
  assert(Math.abs(r3.colors[0] - 128) <= 2, '.spz SH DC color decode');
}

function testSchema(): void {
  console.log('\n📐 xr-trait-schema');
  const n = normalizeXRTraits({grab: true, scale: true, follow: {lazy: false, mode: 'hand-left'}})!;
  assert(n.follow === 'hand-left', 'follow {lazy:false} normalizes to an eager string');
  assert(n.scale!.min === 0.05 && n.scale!.max === 5, 'scale defaults match the web runtime (0.05–5)');
  assert(n.grabbable === true && n.grab === '2-hand', 'legacy grabbable alias emitted');
  assert(normalizeXRTraits({restitution: 1}) === null, 'unknown-only traits normalize to null');
  assert(safeMediaUrl('https://a.test/x.spz') === 'https://a.test/x.spz', 'https media allowed');
  assert(safeMediaUrl('scans/room.spz') === 'scans/room.spz', 'relative media allowed');
  for (const bad of ['file:///etc/passwd', 'http://169.254.169.254/x', '//evil/x', '../x', 'a/%2e%2e/x', 'a\\b']) {
    assert(safeMediaUrl(bad) === undefined, `media URL rejected: ${bad}`);
  }
  assert(normalizeXRTraits({splatUrl: 'file:///x'}) === null, 'unsafe splatUrl dropped');
  const node: Record<string, any> = {extras: {xr: {grab: true, restitution: 0.5}}};
  upgradeGltfNodeXR(node, node['extras'].xr);
  assert(node['extras'].xr.restitution === 0.5 && node['extras'].xr.grab === '2-hand', 'gltf node keeps unknown keys');
  assert(node['extensions'].MOZ_hubs_components.grabbable.hand === true, 'Hubs shape emitted');
  assert(node['extensions'].ANDROID_xr_scenecore.movable.maxScale === 5, 'scenecore movable defaults');
  const lines = buildUsdXRLines({handles: true, particles: {preset: 'snow'}}, (v) => String(v));
  assert(lines.includes('bool handles = true') && lines.includes('string particlesPreset = "snow"'), 'USD lines typed');
  registerXRTraitSerializer();
  const before = getSharedRegistry().xrTraitSerializer;
  try {
    (getSharedRegistry() as {xrTraitSerializer?: unknown}).xrTraitSerializer = {};
  } catch {
    // Strict-mode assignment to a read-only property throws.
  }
  assert(getSharedRegistry().xrTraitSerializer === before, 'serializer registration is locked');
  const scene = new THREE.Scene();
  const mesh = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
  mesh.userData.xr = {follow: {distance: 2}};
  scene.add(mesh);
  const glb = sceneToCanvas3D(scene);
  const gNode = glb.gltf.nodes.find((x: any) => x.extras?.xr);
  assert(gNode?.extras.xr.follow.lazy === true && gNode.extensions.ANDROID_xr_scenecore.follow.distance === 2, 'web exporter emits canonical traits');
  assert(glb.gltf.extensionsUsed?.includes('ANDROID_xr_scenecore'), 'node extensions declared in extensionsUsed');
}

async function main(): Promise<void> {
  console.log('🧪 Running XR Blocks plugin unit tests...');
  testSchema();
  testRegistration();
  testCommon();
  testHeadFollow();
  testHandles();
  testWorldUnderstanding();
  await testGeminiLive();
  testSpatialPaint();
  testParticles();
  testSplats();
  console.log(`\n📊 XR Blocks plugins: ${passed} passed, ${failed} failed`);
  if (failed > 0) process.exit(1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
