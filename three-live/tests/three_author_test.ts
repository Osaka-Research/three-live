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

import {registerPlugin} from '../src/plugin';
import {cadPlugin} from '../src/plugins/cad';
import {
  applyMeshoptFilter,
  decodeMeshoptBuffer,
  decodeMeshoptGLB,
  encodeMeshoptBuffer,
  MAX_MESHOPT_COUNT,
} from '../src/plugins/meshopt';
import {
  extractMaterialVariants,
  extractPrimitiveVariantMappings,
  selectMaterialVariant,
} from '../src/plugins/variants';
import THREE, {
  AmbientLight,
  BoxGeometry,
  Color,
  CylinderGeometry,
  DirectionalLight,
  Group,
  InstancedMesh,
  Matrix4,
  Mesh,
  MeshStandardMaterial,
  PerspectiveCamera,
  PointLight,
  Scene,
  SphereGeometry,
  TorusGeometry,
  TorusKnotGeometry,
  Vector3,
  WebGLRenderer,
} from '../src/three-author';

registerPlugin(cadPlugin);
const {Path, Shape, ShapeGeometry, ExtrudeGeometry, TextGeometry, CSG} = THREE;

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

function runThreeAuthorTests() {
  console.log('🤖 Running three-author Unit Tests...\n');

  // 1. Math and Vectors
  const v1 = new Vector3(1, 2, 3);
  const v2 = new Vector3(4, 5, 6);
  v1.add(v2);
  assert(v1.x === 5 && v1.y === 7 && v1.z === 9, 'Vector3 addition');
  assert(v1.dot(v2) === 5 * 4 + 7 * 5 + 9 * 6, 'Vector3 dot product');

  const c = new Color(0xff0000);
  assert(c.r === 1 && c.g === 0 && c.b === 0, 'Color hex parsing');
  c.setRGB(0.5, 0.5, 0.5);
  assert(c.getHex() === 0x808080, 'Color getHex');

  // 2. Geometries
  const box = new BoxGeometry(2, 2, 2);
  assert(box.attributes.position.count === 24, 'BoxGeometry vertex count');
  assert(box.index!.count === 36, 'BoxGeometry index count');

  const cyl = new CylinderGeometry(1, 1, 2, 16);
  assert(
    cyl.attributes.position.count === (16 + 1) * 4 + 2,
    'CylinderGeometry capped vertex count',
  );
  assert(
    cyl.index!.count === 16 * 6 + 16 * 3 * 2,
    'CylinderGeometry capped index count',
  );

  const sphere = new SphereGeometry(1, 16, 16);
  assert(sphere.attributes.position.count > 0, 'SphereGeometry vertices');

  const torus = new TorusGeometry(10, 3, 16, 32);
  assert(torus.attributes.position.count > 0, 'TorusGeometry vertices');

  const knot = new TorusKnotGeometry(10, 3, 32, 8);
  assert(knot.attributes.position.count > 0, 'TorusKnotGeometry vertices');

  // 3. Scene graph & Lights
  const scene = new Scene();
  const group = new Group();
  const mat = new MeshStandardMaterial({
    color: 0x00ff00,
    roughness: 0.3,
    metalness: 0.7,
  });
  const mesh = new Mesh(box, mat);
  mesh.name = 'MyBox';
  mesh.position.set(3, 4, 5);
  group.add(mesh);
  scene.add(group);

  const dirLight = new DirectionalLight(0xffffff, 1.5);
  dirLight.position.set(5, 10, 7);
  scene.add(dirLight);

  const ambLight = new AmbientLight(0x404040, 0.5);
  scene.add(ambLight);

  const ptLight = new PointLight(0xff8800, 2.0, 50);
  ptLight.position.set(-2, 4, 1);
  scene.add(ptLight);

  // 4. Exporters
  const payload = scene.toCanvas3D();
  assert(payload.lights!.length === 3, 'toCanvas3D includes 3 dynamic lights');
  assert(
    payload.gltf.asset.version === '2.0',
    'toCanvas3D generates valid glTF 2.0 AST',
  );
  assert(
    payload.bin instanceof ArrayBuffer,
    'toCanvas3D generates binary buffer',
  );

  const glb = scene.toGLB();
  assert(glb instanceof Uint8Array, 'toGLB generates binary GLB');
  const dv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  assert(dv.getUint32(0, true) === 0x46546c67, 'GLB magic check 0x46546c67');
  assert(dv.getUint32(4, true) === 2, 'GLB version 2 check');

  // 5. Option B Matrix-Only 60 FPS Reactive Transforms
  const transforms = scene.getMeshTransforms();
  assert(transforms instanceof Map, 'getMeshTransforms returns Map');
  assert(transforms.has('MyBox'), 'getMeshTransforms contains mesh by name');
  assert(
    transforms.get('MyBox')![12] === 3,
    'Transform contains X translation',
  );

  // 6. WebGLRenderer Reactive Handoff
  let loadModelCalls = 0;
  let updateTransformCalls = 0;
  const mockViewer = {
    loadModel: () => {
      loadModelCalls++;
    },
    updateMeshTransforms: () => {
      updateTransformCalls++;
    },
  };
  const renderer = new WebGLRenderer({viewer: mockViewer});
  const camera = new PerspectiveCamera(60, 1, 0.1, 1000);

  renderer.render(scene, camera);
  assert(
    loadModelCalls === 1 && updateTransformCalls === 0,
    'Renderer triggers loadModel on frame 1',
  );

  mesh.position.x = 10;
  renderer.render(scene, camera);
  assert(
    loadModelCalls === 1 && updateTransformCalls === 1,
    'Renderer triggers updateMeshTransforms on frame 2',
  );

  // 7. Permissive Chaining Proxy & LLM Fallback Shims for Unsupported APIs
  THREE.clearAuthorWarnings();
  const controls = new (THREE as any).OrbitControls(camera, null);
  controls.enableDamping = true;
  controls.update();

  const axes = new (THREE as any).AxesHelper(5);
  scene.add(axes);

  const spot = new THREE.SpotLight(0xff0000, 1.5);
  scene.add(spot);

  const hemi = new THREE.HemisphereLight(0xffffff, 0x333333, 0.8);
  scene.add(hemi);

  const shaderMat = new THREE.ShaderMaterial({
    uniforms: {color: {value: new THREE.Color(0x00ff88)}},
  });
  const icosa = new THREE.Mesh(
    new THREE.IcosahedronGeometry(0.4, 1),
    shaderMat,
  );
  scene.add(icosa);

  const capsule = new THREE.Mesh(
    new THREE.CapsuleGeometry(0.2, 0.6),
    new THREE.MeshStandardMaterial({color: 0x3b82f6}),
  );
  scene.add(capsule);

  // Even a Mesh passed completely unknown proxy geometry/material must degrade safely and export to GLB
  const unknownMesh = new THREE.Mesh(
    new (THREE as any).CompletelyInventedGeometry(1, 2, 3),
    new (THREE as any).CompletelyInventedMaterial({foo: 'bar'}),
  );
  scene.add(unknownMesh);

  (THREE as any).NonExistentModule.Deeply.Nested.Call('foo', 123).chain();

  const fallbackGlb = scene.toGLB();
  const warnings = THREE.getAuthorWarnings();
  assert(
    fallbackGlb.byteLength > 100 &&
      warnings.some((w: string) => w.includes('ShaderMaterial')) &&
      warnings.some((w: string) => w.includes('IcosahedronGeometry')) &&
      warnings.some((w: string) => w.includes('CapsuleGeometry')),
    'Permissive fallback shims degrade unsupported LLM geometries/materials to valid GLB meshes and record warnings',
  );

  // 8. EXT_meshopt_compression (ATTRIBUTES, TRIANGLES, INDICES + Filters + Caps)
  {
    const attrCount = 20;
    const attrStride = 8;
    const attrOrig = new Uint8Array(attrCount * attrStride);
    for (let i = 0; i < attrOrig.length; i++) {
      attrOrig[i] = (i * 13 + 7) & 0xff;
    }
    const attrCompressed = encodeMeshoptBuffer(
      attrOrig,
      attrCount,
      attrStride,
      'ATTRIBUTES',
    );
    const attrDecoded = decodeMeshoptBuffer(
      attrCompressed,
      attrCount,
      attrStride,
      'ATTRIBUTES',
    );
    let attrMatch = attrDecoded.length === attrOrig.length;
    for (let i = 0; i < attrOrig.length && attrMatch; i++) {
      if (attrDecoded[i] !== attrOrig[i]) attrMatch = false;
    }
    assert(attrMatch, 'meshopt ATTRIBUTES encode/decode round-trip');

    const triIndices = [0, 1, 2, 0, 2, 3, 2, 1, 4, 3, 2, 5];
    const triRaw = new Uint8Array(new Uint16Array(triIndices).buffer);
    const triComp = encodeMeshoptBuffer(
      triRaw,
      triIndices.length,
      2,
      'TRIANGLES',
    );
    const triDec = new Uint16Array(
      decodeMeshoptBuffer(triComp, triIndices.length, 2, 'TRIANGLES').buffer,
    );
    assert(
      triDec.length === triIndices.length &&
        triDec[0] === 0 &&
        triDec[5] === 3 &&
        triDec[8] === 4 &&
        triDec[11] === 5,
      'meshopt TRIANGLES 16-bit FIFO/edge round-trip',
    );

    const idxValues = [0, 1, 2, 3, 10, 11, 12, 50];
    const idxRaw = new Uint8Array(new Uint32Array(idxValues).buffer);
    const idxComp = encodeMeshoptBuffer(idxRaw, idxValues.length, 4, 'INDICES');
    const idxDec = new Uint32Array(
      decodeMeshoptBuffer(idxComp, idxValues.length, 4, 'INDICES').buffer,
    );
    assert(
      idxDec.length === idxValues.length &&
        idxDec[4] === 10 &&
        idxDec[7] === 50,
      'meshopt INDICES 32-bit varint delta round-trip',
    );

    // Filters: OCTAHEDRAL, QUATERNION, EXPONENTIAL
    const octBuf = new Uint8Array(4);
    const octView = new Int8Array(octBuf.buffer);
    octView[0] = 0;
    octView[1] = 0;
    octView[2] = 100;
    octView[3] = 127;
    applyMeshoptFilter(octBuf, 1, 4, 'OCTAHEDRAL');
    assert(
      octView[0] === 0 && octView[1] === 0 && octView[2] === 127,
      'meshopt OCTAHEDRAL 4-byte filter decodes +Z unit vector',
    );

    const quatBuf = new Uint8Array(8);
    const quatView = new Int16Array(quatBuf.buffer);
    quatView[0] = 0;
    quatView[1] = 0;
    quatView[2] = 0;
    quatView[3] = 0x4000 | 3; // maxComponent = 3 (w = 1)
    applyMeshoptFilter(quatBuf, 1, 8, 'QUATERNION');
    assert(
      quatView[0] === 0 &&
        quatView[1] === 0 &&
        quatView[2] === 0 &&
        quatView[3] === 32767,
      'meshopt QUATERNION 8-byte filter reconstructs identity quaternion',
    );

    const expBuf = new Uint8Array(4);
    const expIn = new DataView(expBuf.buffer);
    // e = -1, m = 1 -> 2^-1 * 1 = 0.5
    expIn.setInt32(0, (-1 << 24) | 1, true);
    applyMeshoptFilter(expBuf, 1, 4, 'EXPONENTIAL');
    assert(
      Math.abs(expIn.getFloat32(0, true) - 0.5) < 1e-6,
      'meshopt EXPONENTIAL filter reconstructs IEEE-754 float',
    );

    let bombCaught = false;
    try {
      decodeMeshoptBuffer(
        new Uint8Array([0xba, 1]),
        MAX_MESHOPT_COUNT + 1,
        4,
        'ATTRIBUTES',
      );
    } catch {
      bombCaught = true;
    }
    assert(bombCaught, 'meshopt rejects count exceeding MAX_MESHOPT_COUNT');

    // decodeMeshoptGLB end-to-end
    const fakeGltf: {
      bufferViews: Array<{
        byteLength: number;
        _decoded?: Uint8Array;
        extensions?: Record<string, unknown>;
      }>;
    } = {
      bufferViews: [
        {
          byteLength: attrOrig.byteLength,
          extensions: {
            EXT_meshopt_compression: {
              buffer: 0,
              byteOffset: 0,
              byteLength: attrCompressed.byteLength,
              byteStride: attrStride,
              count: attrCount,
              mode: 'ATTRIBUTES',
            },
          },
        },
      ],
    };
    const fakeGlb = {
      gltf: fakeGltf,
      bin: attrCompressed.buffer.slice(
        attrCompressed.byteOffset,
        attrCompressed.byteOffset + attrCompressed.byteLength,
      ),
    };
    decodeMeshoptGLB(fakeGltf, fakeGlb);
    assert(
      fakeGltf.bufferViews[0]._decoded instanceof Uint8Array &&
        fakeGltf.bufferViews[0]._decoded.length === attrOrig.length &&
        fakeGltf.bufferViews[0]._decoded[5] === attrOrig[5],
      'decodeMeshoptGLB populates bufferView._decoded in-place',
    );
  }

  // 9. KHR_materials_variants (Product Configurator) & GPU Instancing (EXT_mesh_gpu_instancing)
  {
    const cfgScene = new Scene();
    const midnightMat = new MeshStandardMaterial({
      name: 'Midnight',
      color: 0x111827,
      roughness: 0.2,
    });
    const goldMat = new MeshStandardMaterial({
      name: 'SolarGold',
      color: 0xf59e0b,
      roughness: 0.3,
      metalness: 0.9,
    });
    const watchBody = new Mesh(new BoxGeometry(1, 1, 0.2), midnightMat);
    watchBody.name = 'WatchCase';
    watchBody.userData.variants = {
      Midnight: midnightMat,
      'Solar Gold': goldMat,
    };
    cfgScene.add(watchBody);

    // Add an InstancedMesh with 3 instances + per-instance colors
    const studGeo = new CylinderGeometry(0.05, 0.05, 0.1, 8);
    const studMat = new MeshStandardMaterial({color: 0xffffff});
    const studs = new InstancedMesh(studGeo, studMat, 3);
    studs.name = 'BezelStuds';
    for (let i = 0; i < 3; i++) {
      const m = new Matrix4().makeTranslation(i * 0.5, 0.2, 0);
      studs.setMatrixAt(i, m);
      studs.setColorAt(i, new Color(i === 0 ? 0xff0000 : 0x00ff00));
    }
    cfgScene.add(studs);

    const outM = new Matrix4();
    studs.getMatrixAt(2, outM);
    const outC = new Color();
    studs.getColorAt(0, outC);
    assert(
      Math.abs(outM.elements[12] - 1.0) < 1e-6 && outC.r === 1 && outC.g === 0,
      'InstancedMesh setMatrixAt/getMatrixAt and setColorAt/getColorAt',
    );

    const cfgPayload = cfgScene.toCanvas3D();
    const variantsList = extractMaterialVariants(cfgPayload.gltf);
    assert(
      variantsList.length === 2 &&
        variantsList.includes('Midnight') &&
        variantsList.includes('Solar Gold'),
      'KHR_materials_variants emitted in root extensions and extracted by extractMaterialVariants',
    );

    const mappings = extractPrimitiveVariantMappings(
      cfgPayload.gltf.meshes[0].primitives[0],
    );
    assert(
      mappings !== null &&
        mappings.length === 2 &&
        selectMaterialVariant(cfgPayload.gltf, mappings, 'Solar Gold', 0) === 1,
      'KHR_materials_variants primitive mappings resolve variant name to material index',
    );

    const instNode = (
      cfgPayload.gltf.nodes as Array<{
        name?: string;
        extensions?: {
          EXT_mesh_gpu_instancing?: {
            attributes?: Record<string, number>;
          };
        };
      }>
    ).find((n) => n.name === 'BezelStuds');
    assert(
      Boolean(
        instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
          ?.TRANSLATION !== undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
            ?.ROTATION !== undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes?.SCALE !==
            undefined &&
          instNode?.extensions?.EXT_mesh_gpu_instancing?.attributes
            ?._COLOR_0 !== undefined &&
          cfgPayload.gltf.extensionsUsed?.includes('EXT_mesh_gpu_instancing'),
      ),
      'InstancedMesh emits EXT_mesh_gpu_instancing with TRANSLATION, ROTATION, SCALE, _COLOR_0',
    );

    const usdzBytes = cfgScene.toUSDZ();
    assert(
      usdzBytes instanceof Uint8Array && usdzBytes.byteLength > 200,
      'InstancedMesh expands cleanly during USDZ export',
    );

    let instQuotaCaught = false;
    try {
      const tooMany = new InstancedMesh(studGeo, studMat, 10001);
      assert(tooMany.count <= 10000, 'unreachable');
    } catch {
      instQuotaCaught = true;
    }
    assert(
      instQuotaCaught,
      'InstancedMesh enforces MAX_INSTANCES_PER_MESH = 10000 quota',
    );
  }

  // =========================================================================
  // 10. Phase 2: Shape, ExtrudeGeometry, CSG Booleans, and 3D Vector Text
  // =========================================================================
  {
    const bracketShape = new Shape();
    bracketShape.moveTo(-1, -1);
    bracketShape.lineTo(1, -1);
    bracketShape.lineTo(1, 1);
    bracketShape.quadraticCurveTo(0, 1.3, -1, 1);
    bracketShape.closePath();

    const boltHole = new Path();
    boltHole.absarc(0, 0, 0.35, 0, Math.PI * 2, false);
    bracketShape.holes.push(boltHole);

    const shapeGeo = new ShapeGeometry(bracketShape, 8);
    assert(
      Boolean(
        shapeGeo.attributes.position &&
          shapeGeo.attributes.position.count >= 10 &&
          shapeGeo.index &&
          shapeGeo.index.count >= 18,
      ),
      'ShapeGeometry triangulates outer contour with interior circular hole',
    );

    const extrudeGeo = new ExtrudeGeometry(bracketShape, {
      depth: 0.4,
      bevelEnabled: true,
      bevelThickness: 0.05,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 8,
    });
    extrudeGeo.center();
    assert(
      Boolean(
        extrudeGeo.attributes.position &&
          extrudeGeo.attributes.position.count >
            shapeGeo.attributes.position.count &&
          extrudeGeo.boundingBox &&
          Math.abs(
            extrudeGeo.boundingBox.min.z + extrudeGeo.boundingBox.max.z,
          ) < 1e-4,
      ),
      'ExtrudeGeometry generates front/back caps, bevels, and side walls and centers cleanly',
    );

    // CSG subtract, union, intersect
    const cubeA = new Mesh(
      new BoxGeometry(1, 1, 1),
      new MeshStandardMaterial({color: 0x3b82f6}),
    );
    const cubeB = new Mesh(
      new BoxGeometry(0.6, 0.6, 1.4),
      new MeshStandardMaterial({color: 0xef4444}),
    );
    cubeB.position.set(0.1, 0.1, 0);

    const subMesh = CSG.subtract(cubeA, cubeB);
    const unionMesh = CSG.union(cubeA, cubeB);
    const interMesh = CSG.intersect(cubeA, cubeB);
    assert(
      Boolean(
        subMesh.geometry.attributes.position.count > 24 &&
          unionMesh.geometry.attributes.position.count > 24 &&
          interMesh.geometry.attributes.position.count > 0,
      ),
      'CSG.subtract, CSG.union, and CSG.intersect produce valid non-empty boolean meshes',
    );

    // Declarative userData.csg
    const plate = new Mesh(
      new BoxGeometry(1, 1, 0.2),
      new MeshStandardMaterial({color: 0x94a3b8}),
    );
    const punch = new Mesh(new BoxGeometry(0.4, 0.4, 0.5));
    plate.userData.csg = {op: 'subtract', target: punch};

    // TextGeometry & declarative userData.xr.text
    const textGeo = new TextGeometry('XR-2026', {
      size: 0.2,
      depth: 0.04,
    });
    assert(
      Boolean(
        textGeo.attributes.position &&
          textGeo.attributes.position.count > 40 &&
          textGeo.index &&
          textGeo.index.count > 60,
      ),
      'TextGeometry extrudes 3D vector glyph strokes without external font files',
    );

    const cadScene = new Scene();
    cadScene.add(subMesh);
    cadScene.add(plate);
    const labelNode = new Mesh();
    labelNode.name = 'PartNumber';
    labelNode.userData.xr = {
      text: {text: 'PART #42', size: 0.12, depth: 0.02, color: '#38bdf8'},
    };
    cadScene.add(labelNode);

    const cadGlb = cadScene.toGLB();
    assert(
      cadGlb instanceof Uint8Array &&
        cadGlb.byteLength > 1000 &&
        labelNode.geometry.attributes.position.count > 20,
      'Scene with CSG, declarative userData.csg, and userData.xr.text compiles to GLB',
    );

    // Regression test: high-segment beveled ExtrudeGeometry with interior bore
    // hole + cross-slot CSG.subtract must clip cutter top caps above the flange
    // surface (no stray inverted cap triangles at y = 0.25 that would paint
    // solid during inverted-hull outline rendering).
    const flangeShape = new Shape();
    flangeShape.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
    const centerBore = new Path();
    centerBore.absarc(0, 0, 0.48, 0, Math.PI * 2, true);
    flangeShape.holes.push(centerBore);

    const flangeGeo = new ExtrudeGeometry(flangeShape, {
      depth: 0.38,
      bevelEnabled: true,
      bevelThickness: 0.04,
      bevelSize: 0.04,
      bevelSegments: 2,
      curveSegments: 36,
    });
    flangeGeo.center();

    const rawBlank = new Mesh(
      flangeGeo,
      new MeshStandardMaterial({color: 0x94a3b8}),
    );
    rawBlank.rotation.x = -Math.PI / 2;

    const slotX = new Mesh(new BoxGeometry(2.8, 0.26, 0.32));
    slotX.position.set(0, 0.12, 0);
    const slotZ = new Mesh(new BoxGeometry(0.32, 0.26, 2.8));
    slotZ.position.set(0, 0.12, 0);

    const step1 = CSG.subtract(rawBlank, slotX);
    const machinedFlange = CSG.subtract(step1, slotZ);
    const flangePos = machinedFlange.geometry.attributes.position
      .array as Float32Array;
    let minZ = Infinity;
    let maxZ = -Infinity;
    for (let i = 2; i < flangePos.length; i += 3) {
      if (flangePos[i] < minZ) minZ = flangePos[i];
      if (flangePos[i] > maxZ) maxZ = flangePos[i];
    }
    assert(
      Boolean(
        maxZ <= 0.231 &&
          minZ >= -0.231 &&
          machinedFlange.geometry.attributes.position.count > 500,
      ),
      'CSG.subtract on 36-segment beveled ExtrudeGeometry clips all cutter caps above top surface',
    );
  }

  console.log(
    `\n🏆 three-author Test Results: ${passed} Passed, ${failed} Failed.`,
  );
  if (failed > 0) process.exit(1);
}

runThreeAuthorTests();
