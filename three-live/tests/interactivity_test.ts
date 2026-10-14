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

import {mat3NormalFromMat4, mat4Create, resolveNodeWorldMatrices} from '../src/math';
import {registerPlugin} from '../src/plugin';
import {
  getInteractivityVM,
  interactivityPlugin,
  InteractivityVM,
  MAX_GRAPH_NODES,
  MAX_VARIABLES,
  parseSafeGltfPointer,
  sendInteractivityEvent,
} from '../src/plugins/interactivity';
import {
  BoxGeometry,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
} from '../src/three-author';
import {
  compileInteractivityGraph,
  sceneToCanvas3D,
  sceneToGLB,
} from '../src/three-convert';
import {parseGLB} from '../src/three-view';

registerPlugin(interactivityPlugin);

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

function approxEqual(a: number, b: number, eps = 1e-3): boolean {
  return Math.abs(a - b) <= eps;
}

// Helper to create a lightweight mock viewer from a GLBData payload
// tslint:disable-next-line:no-any
function createMockViewerFromGLBData(glbData: {gltf: any; bin: ArrayBuffer}) {
  const gltf = glbData.gltf;
  const worldMatrices = resolveNodeWorldMatrices(gltf);
  // tslint:disable-next-line:no-any
  const meshes: any[] = [];
  const nodes = gltf.nodes || [];
  for (let i = 0; i < nodes.length; i++) {
    const n = nodes[i];
    if (typeof n.mesh === 'number' && gltf.meshes?.[n.mesh]) {
      const mDef = gltf.meshes[n.mesh];
      const matIdx = mDef.primitives?.[0]?.material ?? 0;
      const matDef = gltf.materials?.[matIdx];
      const baseColor = matDef?.pbrMetallicRoughness?.baseColorFactor
        ? [...matDef.pbrMetallicRoughness.baseColorFactor]
        : [0.8, 0.8, 0.8, 1.0];
      const metallic = matDef?.pbrMetallicRoughness?.metallicFactor ?? 0.1;
      const roughness = matDef?.pbrMetallicRoughness?.roughnessFactor ?? 0.5;
      const transform = mat4Create();
      transform.set(worldMatrices[i]);
      const normalMatrix = new Float32Array(9);
      mat3NormalFromMat4(normalMatrix, transform);
      meshes.push({
        name: n.name || mDef.name || `Mesh_${meshes.length}`,
        nodeIndex: i,
        transform,
        normalMatrix,
        visible: true,
        primitives: [
          {
            materialIndex: matIdx,
            baseColor,
            metallic,
            roughness,
            pluginData: {
              morph: {
                weights: new Float32Array(8),
                numTargets: 8,
              },
            },
          },
        ],
      });
    }
  }

  // tslint:disable-next-line:no-any
  const dispatchedEvents: Array<{type: string; detail: any}> = [];
  let renderCalls = 0;
  let playingClip: string | null = null;
  let evaluatedTime: number | null = null;

  const viewer = {
    gltf,
    meshes,
    worldMatrices,
    animations: [{name: 'SpinClip', duration: 2.0, channels: []}],
    initialNodeTransforms: nodes.map(
      // tslint:disable-next-line:no-any
      (n: any) => ({
        t: n.translation ? [...n.translation] : [0, 0, 0],
        r: n.rotation ? [...n.rotation] : [0, 0, 0, 1],
        s: n.scale ? [...n.scale] : [1, 1, 1],
      }),
    ),
    container: {
      // tslint:disable-next-line:no-any
      dispatchEvent(ev: any) {
        dispatchedEvents.push({type: ev.type, detail: ev.detail});
        return true;
      },
    },
    render() {
      renderCalls++;
    },
    playAnimation(name?: string) {
      playingClip = name || 'SpinClip';
    },
    pauseAnimation() {
      playingClip = null;
    },
    evaluateAnimation(t: number) {
      evaluatedTime = t;
    },
    getRenderCalls: () => renderCalls,
    getPlayingClip: () => playingClip,
    getEvaluatedTime: () => evaluatedTime,
    dispatchedEvents,
  };

  interactivityPlugin.onLoadModel?.(viewer, gltf);
  return viewer;
}

console.log('=== Running KHR_interactivity Plugin Tests ===');

// ---------------------------------------------------------------------------
// 1. Authoring Sugar (`userData.interactivity`) -> GLB Round-Trip & Toggle
// ---------------------------------------------------------------------------
{
  const scene = new Scene();
  const box = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0xff0000}),
  );
  box.name = 'InteractiveDoor';
  box.userData.interactivity = {
    onStart: {
      action: 'setProperty',
      property: 'scale',
      value: [1.2, 1.2, 1.2],
    },
    onSelect: [
      {
        action: 'toggleTransform',
        property: 'translation',
        from: [0, 0, 0],
        to: [0, 2, 0],
        duration: 0.4,
      },
      {
        action: 'cycleMaterialColor',
        colors: [
          [1, 0, 0, 1],
          [0, 1, 0, 1],
          [0, 0, 1, 1],
        ],
        duration: 0,
      },
    ],
  };
  scene.add(box);

  // Serialize to binary GLB and parse back
  const glbBytes = sceneToGLB(scene);
  const parsed = parseGLB(glbBytes);

  assert(
    Array.isArray(parsed.gltf.extensionsUsed) &&
      parsed.gltf.extensionsUsed.includes('KHR_interactivity'),
    'sceneToGLB includes KHR_interactivity in extensionsUsed',
  );
  assert(
    Boolean(parsed.gltf.extensions?.KHR_interactivity?.graphs?.[0]?.nodes?.length),
    'sceneToGLB populates gltf.extensions.KHR_interactivity.graphs[0]',
  );

  const viewer = createMockViewerFromGLBData(parsed);

  // Verify onStart ran immediately on model load
  assert(
    approxEqual(viewer.gltf.nodes[0].scale[0], 1.2) &&
      approxEqual(viewer.meshes[0].transform[0], 1.2),
    'event/onStart sets initial node scale and syncs GPU mesh transform',
  );

  // First click: toggleTransform interpolates toward [0, 2, 0] and cycleMaterialColor switches to index 1 ([0, 1, 0, 1])
  interactivityPlugin.onMeshSelect?.(viewer, {
    meshIndex: 0,
    meshName: 'InteractiveDoor',
    nodeIndex: 0,
    distance: 2.5,
    hitPoint: [0, 0.5, 0.5],
    normal: [0, 0, 1],
    screenX: 100,
    screenY: 100,
  });

  assert(
    approxEqual(viewer.meshes[0].primitives[0].baseColor[1], 1.0) &&
      approxEqual(viewer.meshes[0].primitives[0].baseColor[0], 0.0),
    'cycleMaterialColor advances material baseColorFactor to green on first select',
  );

  // Advance tween halfway (0.2s of 0.4s -> smoothstep(0.5) = 0.5 -> y = 1.0)
  interactivityPlugin.onUpdate?.(viewer, 0.2);
  assert(
    approxEqual(viewer.gltf.nodes[0].translation[1], 1.0) &&
      approxEqual(viewer.meshes[0].transform[13], 1.0),
    'pointer/interpolate smoothly tweens node translation at midpoint (t=0.5)',
  );

  // Advance tween to completion (another 0.2s -> y = 2.0)
  interactivityPlugin.onUpdate?.(viewer, 0.25);
  assert(
    approxEqual(viewer.gltf.nodes[0].translation[1], 2.0) &&
      approxEqual(viewer.meshes[0].transform[13], 2.0),
    'pointer/interpolate reaches target translation [0, 2, 0] on completion',
  );

  // Second click: toggleTransform interpolates back toward [0, 0, 0] and color cycles to blue ([0, 0, 1, 1])
  interactivityPlugin.onMeshSelect?.(viewer, {
    meshIndex: 0,
    meshName: 'InteractiveDoor',
    nodeIndex: 0,
    distance: 2.5,
    hitPoint: [0, 2.0, 0.5],
    normal: [0, 0, 1],
    screenX: 100,
    screenY: 100,
  });
  interactivityPlugin.onUpdate?.(viewer, 0.25);
  interactivityPlugin.onUpdate?.(viewer, 0.25);

  assert(
    approxEqual(viewer.gltf.nodes[0].translation[1], 0.0) &&
      approxEqual(viewer.meshes[0].primitives[0].baseColor[2], 1.0),
    'Second select toggles translation back to [0, 0, 0] and cycles color to blue',
  );
}

// ---------------------------------------------------------------------------
// 2. Hierarchy Ancestry Matching, Visibility Propagation & Custom Events
// ---------------------------------------------------------------------------
{
  const scene = new Scene();
  const group = new Group();
  group.name = 'CabinetGroup';
  const childMesh = new Mesh(
    new BoxGeometry(0.5, 0.5, 0.5),
    new MeshStandardMaterial({color: 0xffffff}),
  );
  childMesh.name = 'CabinetHandle';
  group.add(childMesh);

  const indicatorMesh = new Mesh(
    new BoxGeometry(0.2, 0.2, 0.2),
    new MeshStandardMaterial({color: 0xffff00}),
  );
  indicatorMesh.name = 'StatusLight';

  // Attach onSelect to the PARENT group and send a custom event to hide StatusLight
  group.userData.interactivity = {
    onSelect: {
      action: 'sendEvent',
      event: 'cabinetClicked',
      values: {sourceNode: 0},
    },
  };
  indicatorMesh.userData.interactivity = {
    onReceive: {
      cabinetClicked: [
        {
          action: 'toggleVisibility',
        },
        {
          action: 'playAnimation',
          animation: 'SpinClip',
        },
      ],
    },
  };

  scene.add(group);
  scene.add(indicatorMesh);

  const canvas3d = sceneToCanvas3D(scene);
  const viewer = createMockViewerFromGLBData(canvas3d);

  // Clicking childMesh (nodeIndex 1, child of group nodeIndex 0) should trigger group's pointer/onSelect!
  interactivityPlugin.onMeshSelect?.(viewer, {
    meshIndex: 0,
    meshName: 'CabinetHandle',
    nodeIndex: 1,
    distance: 1.5,
    hitPoint: [0, 0, 0],
    normal: [0, 0, 1],
    screenX: 50,
    screenY: 50,
  });

  assert(
    viewer.dispatchedEvents.some(
      (e) =>
        e.type === 'interactivityEvent' && e.detail?.id === 'cabinetClicked',
    ),
    'Clicking child mesh triggers parent group pointer/onSelect and dispatches DOM interactivityEvent',
  );
  assert(
    viewer.meshes[1].visible === false,
    'event/receive triggers toggleVisibility on StatusLight mesh',
  );
  assert(
    viewer.getPlayingClip() === 'SpinClip',
    'event/receive triggers animation/start for SpinClip',
  );

  // Trigger custom event externally via sendInteractivityEvent to toggle visibility back on
  const sent = sendInteractivityEvent(viewer, 'cabinetClicked');
  assert(
    sent && viewer.meshes[1].visible === true,
    'sendInteractivityEvent(viewer, eventId) re-triggers event/receive and restores visibility',
  );
}

// ---------------------------------------------------------------------------
// 3. Quaternion Slerp Tween, Delays, doN, for-loop, and Math Opcodes
// ---------------------------------------------------------------------------
{
  const scene = new Scene();
  const rotor = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0x00ffff}),
  );
  scene.add(rotor);

  // Author a raw KHR_interactivity graph on scene.userData.interactivity
  // testing: pointer/interpolate on /nodes/0/rotation (slerp) -> done -> flow/delay(0.2s) -> flow/for(3) -> math/add -> variable/set
  scene.userData.interactivity = {
    declarations: [
      {op: 'event/onStart'}, // 0
      {op: 'pointer/interpolate'}, // 1
      {op: 'flow/delay'}, // 2
      {op: 'flow/for'}, // 3
      {op: 'variable/get'}, // 4
      {op: 'math/add'}, // 5
      {op: 'variable/set'}, // 6
      {op: 'animation/resetAt'}, // 7
    ],
    variables: [{id: 'accum', type: 'int', value: 0}],
    nodes: [
      {
        declaration: 0,
        flows: {out: {node: 1}},
      },
      {
        declaration: 1,
        configuration: {pointer: '/nodes/0/rotation'},
        values: {
          // 90 deg around Y axis: [0, sin(45deg), 0, cos(45deg)]
          value: {value: [0, Math.SQRT1_2, 0, Math.SQRT1_2]},
          duration: {value: 0.2},
        },
        flows: {done: {node: 2}},
      },
      {
        declaration: 2,
        values: {duration: {value: 0.1}},
        flows: {done: {node: 3}},
      },
      {
        declaration: 3,
        values: {
          startIndex: {value: 1},
          endIndex: {value: 5},
          step: {value: 1},
        },
        flows: {
          body: {node: 6},
          completed: {node: 7},
        },
      },
      {
        declaration: 4,
        configuration: {variable: 'accum'},
      },
      {
        declaration: 5,
        values: {
          a: {node: 4, socket: 'value'},
          b: {node: 3, socket: 'index'},
        },
      },
      {
        declaration: 6,
        configuration: {variable: 'accum'},
        values: {value: {node: 5, socket: 'value'}},
      },
      {
        declaration: 7,
        values: {time: {value: 1.25}},
      },
    ],
  };

  const canvas3d = sceneToCanvas3D(scene);
  const viewer = createMockViewerFromGLBData(canvas3d);
  const vm = getInteractivityVM(viewer);
  assert(Boolean(vm), 'getInteractivityVM retrieves active VM for viewer');

  // Step 0.1s: rotation slerp is at t=0.5 (45 deg around Y: sin(22.5deg) ~= 0.38268)
  interactivityPlugin.onUpdate?.(viewer, 0.1);
  const rotMid = viewer.gltf.nodes[0].rotation;
  assert(
    approxEqual(rotMid[1], Math.sin(Math.PI / 8), 1e-2) &&
      approxEqual(Math.hypot(rotMid[0], rotMid[1], rotMid[2], rotMid[3]), 1.0),
    'pointer/interpolate uses unit-quaternion slerp on /nodes/0/rotation',
  );

  // Step 0.15s: rotation tween completes and schedules 0.1s delay
  interactivityPlugin.onUpdate?.(viewer, 0.15);
  // Step 0.15s: delay completes -> runs flow/for(1..4) summing 1+2+3+4 = 10 -> animation/resetAt(1.25)
  interactivityPlugin.onUpdate?.(viewer, 0.15);

  assert(
    viewer.getEvaluatedTime() === 1.25,
    'pointer/interpolate done -> flow/delay -> flow/for -> animation/resetAt chain completes',
  );
}

// ---------------------------------------------------------------------------
// 4. Security & Sandbox Quotas (ISE Compliance)
// ---------------------------------------------------------------------------
{
  // 4a. Prototype pollution rejection in parseSafeGltfPointer and writeScenePointer
  assert(
    parseSafeGltfPointer('/__proto__/polluted') === null &&
      parseSafeGltfPointer('/nodes/0/constructor/prototype') === null &&
      parseSafeGltfPointer('/nodes/0/__proto__/x') === null &&
      parseSafeGltfPointer('nodes/0/translation') === null,
    'parseSafeGltfPointer blocks __proto__, constructor, prototype, and non-rooted paths',
  );

  // 4b. Infinite flow cycle protection (MAX_STEPS_PER_INVOCATION)
  const cyclicGltf = {
    nodes: [{name: 'N0', translation: [0, 0, 0]}],
    extensions: {
      KHR_interactivity: {
        declarations: [
          {op: 'event/onStart'},
          {op: 'flow/sequence'},
          {op: 'flow/sequence'},
        ],
        nodes: [
          {declaration: 0, flows: {out: {node: 1}}},
          {declaration: 1, flows: {'0': {node: 2}}},
          {declaration: 2, flows: {'0': {node: 1}}},
        ],
      },
    },
  };
  const startMs = Date.now();
  const cyclicViewer = createMockViewerFromGLBData({
    gltf: cyclicGltf,
    bin: new ArrayBuffer(0),
  });
  const elapsedMs = Date.now() - startMs;
  assert(
    elapsedMs < 500 && Boolean(cyclicViewer),
    `Cyclic flow graph halts safely at MAX_STEPS_PER_INVOCATION (${elapsedMs}ms)`,
  );

  // 4c. Cyclic value socket evaluation protection
  const cyclicValGltf = {
    nodes: [{name: 'N0', scale: [1, 1, 1]}],
    extensions: {
      KHR_interactivity: {
        declarations: [
          {op: 'event/onStart'},
          {op: 'math/add'},
          {op: 'math/add'},
          {op: 'pointer/set'},
        ],
        nodes: [
          {declaration: 0, flows: {out: {node: 3}}},
          {
            declaration: 1,
            values: {a: {node: 2, socket: 'value'}, b: {value: 1}},
          },
          {
            declaration: 2,
            values: {a: {node: 1, socket: 'value'}, b: {value: 1}},
          },
          {
            declaration: 3,
            configuration: {pointer: '/nodes/0/scale'},
            values: {value: {node: 1, socket: 'value'}},
          },
        ],
      },
    },
  };
  createMockViewerFromGLBData({
    gltf: cyclicValGltf,
    bin: new ArrayBuffer(0),
  });
  assert(true, 'Cyclic value socket graph terminates without stack overflow');

  // 4d. MAX_GRAPH_NODES and MAX_VARIABLES quota enforcement
  let threwMaxNodes = false;
  try {
    const oversizedNodes = new Array(MAX_GRAPH_NODES + 1).fill({
      op: 'flow/sequence',
    });
    // tslint:disable-next-line:no-unused-expression
    new InteractivityVM({}, {}, {nodes: oversizedNodes});
  } catch (e) {
    threwMaxNodes = String(e).includes('MAX_GRAPH_NODES');
  }
  assert(
    threwMaxNodes,
    `InteractivityVM rejects graphs exceeding MAX_GRAPH_NODES (${MAX_GRAPH_NODES})`,
  );

  let threwMaxVars = false;
  try {
    const oversizedVars = new Array(MAX_VARIABLES + 1).fill({
      id: 'v',
      value: 0,
    });
    // tslint:disable-next-line:no-unused-expression
    new InteractivityVM({}, {}, {nodes: [], variables: oversizedVars});
  } catch (e) {
    threwMaxVars = String(e).includes('MAX_VARIABLES');
  }
  assert(
    threwMaxVars,
    `InteractivityVM rejects graphs exceeding MAX_VARIABLES (${MAX_VARIABLES})`,
  );

  // 4e. Nested flow/for amplification bomb shares global MAX_STEPS_PER_INVOCATION budget
  const nestedForBombGltf = {
    nodes: [{name: 'N0', scale: [1, 1, 1]}],
    extensions: {
      KHR_interactivity: {
        declarations: [
          {op: 'event/onStart'},
          {op: 'flow/for'},
          {op: 'flow/for'},
          {op: 'flow/for'},
          {op: 'variable/get'},
          {op: 'math/add'},
          {op: 'variable/set'},
        ],
        variables: [{id: 'ticks', type: 'int', value: 0}],
        nodes: [
          {declaration: 0, flows: {out: {node: 1}}},
          {
            declaration: 1,
            values: {startIndex: {value: 0}, endIndex: {value: 1000}, step: {value: 1}},
            flows: {body: {node: 2}},
          },
          {
            declaration: 2,
            values: {startIndex: {value: 0}, endIndex: {value: 1000}, step: {value: 1}},
            flows: {body: {node: 3}},
          },
          {
            declaration: 3,
            values: {startIndex: {value: 0}, endIndex: {value: 1000}, step: {value: 1}},
            flows: {body: {node: 6}},
          },
          {declaration: 4, configuration: {variable: 'ticks'}},
          {declaration: 5, values: {a: {node: 4, socket: 'value'}, b: {value: 1}}},
          {declaration: 6, configuration: {variable: 'ticks'}, values: {value: {node: 5, socket: 'value'}}},
        ],
      },
    },
  };
  const bombStart = Date.now();
  createMockViewerFromGLBData({gltf: nestedForBombGltf, bin: new ArrayBuffer(0)});
  const bombElapsed = Date.now() - bombStart;
  assert(
    bombElapsed < 500,
    `Nested 1000^3 flow/for bomb halts safely under shared MAX_STEPS_PER_INVOCATION (${bombElapsed}ms)`,
  );
}

console.log(
  `\n=== KHR_interactivity Tests Summary: ${passed} passed, ${failed} failed ===`,
);
if (failed > 0) {
  process.exit(1);
}
