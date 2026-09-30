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

import {
  BoxGeometry,
  Color,
  DirectionalLight,
  Group,
  Mesh,
  MeshStandardMaterial,
  Scene,
  SphereGeometry,
} from '../src/three-author';
import {
  buildUSDZZip,
  calculateCRC32,
  generateUSDA,
  generateUSDZ,
  glbToUSDZ,
  sanitizeUsdStringLiteral,
  sceneToCanvas3D,
  sceneToGLB,
  sceneToUSDZ,
} from '../src/three-convert';

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

function verifyUSDZAlignment(usdzBytes: Uint8Array, label: string): boolean {
  const dv = new DataView(
    usdzBytes.buffer,
    usdzBytes.byteOffset,
    usdzBytes.byteLength,
  );
  let offset = 0;
  let entryCount = 0;

  while (offset < usdzBytes.byteLength) {
    const sig = dv.getUint32(offset, true);
    if (sig === 0x04034b50) {
      // Local file header
      entryCount++;
      const fnLen = dv.getUint16(offset + 26, true);
      const extraLen = dv.getUint16(offset + 28, true);
      const compressedSize = dv.getUint32(offset + 18, true);
      const payloadOffset = offset + 30 + fnLen + extraLen;

      if (payloadOffset % 64 !== 0) {
        console.error(
          `      ❌ Alignment failure in ${label}: payload offset ${payloadOffset} is not a multiple of 64 (remainder: ${payloadOffset % 64})`,
        );
        return false;
      }
      offset = payloadOffset + compressedSize;
    } else if (sig === 0x02014b50 || sig === 0x06054b50) {
      // Central directory or EOCD reached
      break;
    } else {
      offset++;
    }
  }

  return entryCount > 0;
}

async function runTests() {
  console.log('🔄 Running three-convert Universal 3D Transcoding Tests...\n');

  // -------------------------------------------------------------------------
  // 1. In-Memory Canvas3D Serialization
  // -------------------------------------------------------------------------
  const scene = new Scene();
  const boxMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({
      color: new Color(0xff0000),
      roughness: 0.2,
      metalness: 0.8,
    }),
  );
  boxMesh.name = 'RedBox';
  scene.add(boxMesh);

  const light = new DirectionalLight(0xffffff, 2.0);
  light.position.set(5, 10, 5);
  scene.add(light);

  const canvas3d = sceneToCanvas3D(scene);
  assert(!!canvas3d.gltf, 'sceneToCanvas3D produces glTF document');
  assert(
    canvas3d.bin instanceof ArrayBuffer,
    'sceneToCanvas3D produces BIN ArrayBuffer',
  );
  assert(
    canvas3d.gltf.meshes.length >= 1,
    'sceneToCanvas3D registers mesh primitive',
  );
  assert(
    canvas3d.lights.length >= 1,
    'sceneToCanvas3D preserves dynamic lights',
  );

  // -------------------------------------------------------------------------
  // 2. Binary GLB Serialization
  // -------------------------------------------------------------------------
  const glb = sceneToGLB(scene);
  assert(glb instanceof Uint8Array, 'sceneToGLB returns Uint8Array');
  assert(glb.byteLength > 100, 'sceneToGLB produces non-trivial binary');

  const glbDv = new DataView(glb.buffer, glb.byteOffset, glb.byteLength);
  const glbMagic = glbDv.getUint32(0, true);
  const glbVersion = glbDv.getUint32(4, true);
  const glbTotalLength = glbDv.getUint32(8, true);
  assert(glbMagic === 0x46546c67, 'GLB magic matches "glTF" (0x46546c67)');
  assert(glbVersion === 2, 'GLB version is 2');
  assert(
    glbTotalLength === glb.byteLength,
    'GLB header length matches actual byte length',
  );

  // -------------------------------------------------------------------------
  // 3. Direct Scene to USDZ Compilation (Single Pass, Zero-Intermediate)
  // -------------------------------------------------------------------------
  const sceneUSDZ = sceneToUSDZ(scene);
  assert(sceneUSDZ instanceof Uint8Array, 'sceneToUSDZ returns Uint8Array');
  assert(sceneUSDZ.byteLength > 200, 'sceneToUSDZ output is non-empty');
  assert(
    verifyUSDZAlignment(sceneUSDZ, 'sceneToUSDZ'),
    'sceneToUSDZ complies strictly with Apple 64-byte payload offset alignment',
  );

  // -------------------------------------------------------------------------
  // 4. Binary GLB to USDZ Transcoding
  // -------------------------------------------------------------------------
  const glbUSDZ = glbToUSDZ(glb);
  assert(glbUSDZ instanceof Uint8Array, 'glbToUSDZ returns Uint8Array');
  assert(glbUSDZ.byteLength > 200, 'glbToUSDZ output is non-empty');
  assert(
    verifyUSDZAlignment(glbUSDZ, 'glbToUSDZ'),
    'glbToUSDZ complies strictly with Apple 64-byte payload offset alignment',
  );

  // -------------------------------------------------------------------------
  // 5. Polymorphic generateUSDZ API
  // -------------------------------------------------------------------------
  const usdzFromScene = generateUSDZ(scene);
  const usdzFromGLB = generateUSDZ(glb);
  const usdzFromCanvas3D = generateUSDZ(canvas3d);
  assert(usdzFromScene.byteLength > 0, 'generateUSDZ(Scene) succeeds');
  assert(usdzFromGLB.byteLength > 0, 'generateUSDZ(GLB Uint8Array) succeeds');
  assert(usdzFromCanvas3D.byteLength > 0, 'generateUSDZ(GLBData) succeeds');

  // -------------------------------------------------------------------------
  // 6. Scene Instance Convenience Methods
  // -------------------------------------------------------------------------
  const sceneMethodCanvas3D = scene.toCanvas3D();
  const sceneMethodGLB = scene.toGLB();
  const sceneMethodUSDZ = scene.toUSDZ();
  assert(sceneMethodCanvas3D.bin.byteLength > 0, 'scene.toCanvas3D() works');
  assert(
    sceneMethodGLB.byteLength === glb.byteLength,
    'scene.toGLB() matches sceneToGLB',
  );
  assert(
    verifyUSDZAlignment(sceneMethodUSDZ, 'scene.toUSDZ()'),
    'scene.toUSDZ() returns 64-byte aligned package',
  );

  // -------------------------------------------------------------------------
  // 7. Nested Hierarchy & Transform Baking in USDZ
  // -------------------------------------------------------------------------
  const hierarchyScene = new Scene();
  const parentGroup = new Group();
  parentGroup.position.set(10, 0, 0);
  parentGroup.scale.set(2, 2, 2);

  const childSphere = new Mesh(
    new SphereGeometry(0.5, 8, 8),
    new MeshStandardMaterial({color: new Color(0x00ff00)}),
  );
  childSphere.position.set(0, 5, 0);
  parentGroup.add(childSphere);
  hierarchyScene.add(parentGroup);

  const hierarchyUSDZ = sceneToUSDZ(hierarchyScene);
  assert(
    verifyUSDZAlignment(hierarchyUSDZ, 'hierarchyUSDZ'),
    'Hierarchical scene compiles to 64-byte aligned USDZ',
  );

  const usdaText = generateUSDA(hierarchyScene);
  assert(
    usdaText.includes('#usda 1.0'),
    'USDA contains standard "#usda 1.0" header',
  );
  assert(usdaText.includes('def Xform "Root"'), 'USDA defines Root Xform');
  assert(
    usdaText.includes('UsdPreviewSurface'),
    'USDA defines UsdPreviewSurface material',
  );
  assert(
    usdaText.includes('point3f[] points'),
    'USDA contains point definitions',
  );

  // -------------------------------------------------------------------------
  // 8. Custom buildUSDZZip Multi-file Alignment
  // -------------------------------------------------------------------------
  const file1 = new TextEncoder().encode('File 1 sample payload');
  const file2 = new TextEncoder().encode(
    'File 2 longer sample payload for alignment test',
  );
  const multiZip = buildUSDZZip([
    {filename: 'model.usda', data: file1},
    {filename: 'texture.png', data: file2},
  ]);
  assert(
    verifyUSDZAlignment(multiZip, 'multi-file buildUSDZZip'),
    'Multi-file archive maintains 64-byte alignment for all member entries',
  );

  // -------------------------------------------------------------------------
  // 9. CRC32 Integrity
  // -------------------------------------------------------------------------
  const testBytes = new TextEncoder().encode('123456789');
  const crc = calculateCRC32(testBytes);
  // -------------------------------------------------------------------------
  // 10. Physical PBR Material Transcoding (GLB Extensions & UsdPreviewSurface)
  // -------------------------------------------------------------------------
  const luxuryScene = new Scene();
  const glassMat = new MeshStandardMaterial({
    color: new Color(0xffffff),
    roughness: 0.05,
    metalness: 0.0,
    clearcoat: 0.9,
    clearcoatRoughness: 0.1,
    transmission: 0.95,
    ior: 1.52,
    thickness: 0.8,
    emissive: new Color(0.1, 0.2, 0.3),
    emissiveIntensity: 2.0,
  });
  const glassMesh = new Mesh(new SphereGeometry(1, 8, 8), glassMat);
  luxuryScene.add(glassMesh);

  const luxuryCanvas = sceneToCanvas3D(luxuryScene);
  const gltfMat = luxuryCanvas.gltf.materials[0];
  assert(
    gltfMat?.extensions?.KHR_materials_clearcoat?.clearcoatFactor === 0.9,
    'sceneToCanvas3D emits KHR_materials_clearcoat extension',
  );
  assert(
    gltfMat?.extensions?.KHR_materials_transmission?.transmissionFactor ===
      0.95,
    'sceneToCanvas3D emits KHR_materials_transmission extension',
  );
  assert(
    gltfMat?.extensions?.KHR_materials_ior?.ior === 1.52,
    'sceneToCanvas3D emits KHR_materials_ior extension',
  );
  assert(
    gltfMat?.extensions?.KHR_materials_volume?.thicknessFactor === 0.8,
    'sceneToCanvas3D emits KHR_materials_volume extension',
  );

  const luxuryUSDA = generateUSDA(luxuryScene);
  assert(
    luxuryUSDA.includes('float inputs:clearcoat = 0.9'),
    'USDA emits UsdPreviewSurface inputs:clearcoat',
  );
  assert(
    luxuryUSDA.includes('float inputs:ior = 1.52'),
    'USDA emits UsdPreviewSurface inputs:ior',
  );
  assert(
    luxuryUSDA.includes('float inputs:opacity = 0.05'),
    'USDA derives UsdPreviewSurface inputs:opacity from transmission (1 - 0.95 = 0.05)',
  );

  // -------------------------------------------------------------------------
  // 11. P1-5 (WEB-11): USDA String Literal Sanitization for userData.xr
  // -------------------------------------------------------------------------
  const escapedLiteral = sanitizeUsdStringLiteral(
    'free"\n}\ndef Xform "Injected" {\n\\payload',
  );
  assert(
    !escapedLiteral.includes('\n') &&
      escapedLiteral.includes('\\"') &&
      escapedLiteral.includes('\\\\'),
    'sanitizeUsdStringLiteral escapes quotes/backslashes and strips newlines',
  );

  const injectionScene = new Scene();
  const injectedMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial(),
  );
  injectedMesh.userData = {
    xr: {
      grab: 'free"\n}\ndef Xform "InjectedPrim" {\nstring x = "',
    },
  };
  injectionScene.add(injectedMesh);
  const injectedUSDA = generateUSDA(injectionScene);
  assert(
    !injectedUSDA.includes('\ndef Xform "InjectedPrim"') &&
      injectedUSDA.includes('\\"InjectedPrim\\"'),
    'generateUSDA escapes userData.xr traits and prevents USDA block injection',
  );

  // Summary
  console.log(`\n========================================`);
  console.log(`Tests finished: ${passed} passed, ${failed} failed`);
  console.log(`========================================\n`);

  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error('Unhandled error in three_convert_test:', err);
  process.exit(1);
});
