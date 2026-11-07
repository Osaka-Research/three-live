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
  DataTexture,
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

  // -------------------------------------------------------------------------
  // 12. Issue #13: USDZ Hierarchy & Local Mesh Coordinates (Scene & GLB)
  // -------------------------------------------------------------------------
  const armScene = new Scene();
  const armGroup = new Group();
  armGroup.name = 'Arm';
  armGroup.position.set(1, 0, 0);
  armGroup.rotation.y = Math.PI / 2;

  const handMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0xffffff}),
  );
  handMesh.name = 'Hand';
  handMesh.position.set(0, 2, 0);

  const fingerMesh = new Mesh(
    new BoxGeometry(0.2, 0.2, 0.2),
    new MeshStandardMaterial({color: 0xff0000}),
  );
  fingerMesh.name = 'Finger';
  fingerMesh.position.set(0, 0.6, 0);
  handMesh.add(fingerMesh);
  armGroup.add(handMesh);
  armScene.add(armGroup);

  const armUSDA = generateUSDA(armScene);
  assert(
    armUSDA.includes('def Xform "Arm"') &&
      armUSDA.includes('double3 xformOp:translate = (1.0, 0, 0)'),
    'Issue #13: generateUSDA(scene) preserves parent Group as Xform with local translate',
  );
  assert(
    armUSDA.includes('def Xform "Hand"') &&
      armUSDA.includes('def Mesh "Hand_mesh"') &&
      armUSDA.includes('double3 xformOp:translate = (0, 2.0, 0)') &&
      armUSDA.includes('def Mesh "Finger"'),
    'Issue #13: Mesh with child Mesh wraps in Xform + sibling _mesh (no nested Gprims)',
  );
  assert(
    armUSDA.includes('(-0.5, -0.5, 0.5)') ||
      armUSDA.includes('(-0.5, -0.5, -0.5)'),
    'Issue #13: Mesh vertices stay in local space instead of baked world space',
  );

  const armGlbUSDA = generateUSDA(sceneToGLB(armScene));
  assert(
    armGlbUSDA.includes('def Xform "Arm"') &&
      armGlbUSDA.includes('double3 xformOp:translate = (1.0, 0, 0)') &&
      armGlbUSDA.includes('double3 xformOp:translate = (0, 2.0, 0)'),
    'Issue #13: glbToUSDZ / generateUSDA(glb) preserves node hierarchy and local TRS',
  );

  // -------------------------------------------------------------------------
  // 13. Issue #14 & #15: USDZ Parent Group Animation & No Double-Transform
  // -------------------------------------------------------------------------
  const animScene = new Scene();
  const orbit = new Group();
  orbit.name = 'Orbit';
  const moon = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0xcccccc}),
  );
  moon.name = 'Moon';
  moon.position.set(3, 0, 0);
  orbit.add(moon);

  const slider = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0x00ccff}),
  );
  slider.name = 'Slider';
  slider.position.set(2, 0, 0);
  animScene.add(orbit);
  animScene.add(slider);
  animScene.userData.animate = (t: number) => {
    orbit.rotation.y = t;
    slider.position.x = 2 + Math.sin(t);
  };

  const animUSDA = generateUSDA(animScene, {duration: 1.0, fps: 4});
  const orbitBlock = animUSDA.split('def Xform "Orbit"')[1]?.split('def Mesh "Moon"')[0] || '';
  const moonBlock = animUSDA.split('def Mesh "Moon"')[1]?.split('def Mesh "Slider"')[0] || '';
  const sliderBlock = animUSDA.split('def Mesh "Slider"')[1] || '';
  assert(
    orbitBlock.includes('quatf xformOp:orient.timeSamples'),
    'Issue #14: Animated parent Group exports xformOp:orient.timeSamples in USDZ',
  );
  assert(
    moonBlock.includes('double3 xformOp:translate = (3.0, 0, 0)') &&
      !moonBlock.includes('timeSamples'),
    'Issue #14: Unanimated child under animated Group keeps static local xformOp',
  );
  assert(
    sliderBlock.includes('0: (2.0, 0, 0)') &&
      (sliderBlock.includes('(-0.5, -0.5, 0.5)') ||
        sliderBlock.includes('(-0.5, -0.5, -0.5)')),
    'Issue #15: Self-animated Mesh keeps local points and starts timeSamples at (2, 0, 0) without double transform',
  );

  // -------------------------------------------------------------------------
  // 14. Issue #17: MaterialBindingAPI Schema Applied on USDZ Meshes
  // -------------------------------------------------------------------------
  const schemaScene = new Scene();
  const plainMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0xff8800}),
  );
  plainMesh.name = 'PlainCrate';
  const physMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({color: 0x0088ff}),
  );
  physMesh.name = 'DynamicCrate';
  physMesh.userData = {xr: {physics: 'dynamic'}};
  schemaScene.add(plainMesh);
  schemaScene.add(physMesh);

  const schemaUSDA = generateUSDA(schemaScene);
  assert(
    schemaUSDA.includes('prepend apiSchemas = ["MaterialBindingAPI"]'),
    'Issue #17: Standard Mesh applies prepend apiSchemas = ["MaterialBindingAPI"]',
  );
  assert(
    schemaUSDA.includes(
      'prepend apiSchemas = ["MaterialBindingAPI", "PhysicsBodyAPI", "PhysicsCollisionAPI"]',
    ),
    'Issue #17: Physics Mesh merges MaterialBindingAPI with PhysicsBodyAPI and PhysicsCollisionAPI',
  );

  // -------------------------------------------------------------------------
  // 15. Issue #18: sRGB-to-Linear Hex/CSS Color & Default Metalness = 0.0
  // -------------------------------------------------------------------------
  const colorScene = new Scene();
  const grayMat = new MeshStandardMaterial({color: 0x808080});
  grayMat.name = 'MidGray';
  const blueMat = new MeshStandardMaterial({color: 0x3366ff});
  blueMat.name = 'BrandBlue';
  colorScene.add(new Mesh(new BoxGeometry(1, 1, 1), grayMat));
  colorScene.add(new Mesh(new BoxGeometry(1, 1, 1), blueMat));

  const colorCanvas = sceneToCanvas3D(colorScene);
  const grayGltf = colorCanvas.gltf.materials[0].pbrMetallicRoughness;
  const blueGltf = colorCanvas.gltf.materials[1].pbrMetallicRoughness;
  assert(
    Math.abs(grayGltf.baseColorFactor[0] - 0.21586) < 1e-4 &&
      grayGltf.metallicFactor === 0,
    'Issue #18: GLB exports 0x808080 as linear ~0.21586 and default metallicFactor = 0',
  );
  assert(
    Math.abs(blueGltf.baseColorFactor[0] - 0.0331) < 1e-4 &&
      Math.abs(blueGltf.baseColorFactor[1] - 0.13287) < 1e-4 &&
      Math.abs(blueGltf.baseColorFactor[2] - 1.0) < 1e-4,
    'Issue #18: GLB exports 0x3366ff as linear (0.03310, 0.13287, 1.0)',
  );

  const colorUSDA = generateUSDA(colorScene);
  assert(
    colorUSDA.includes('color3f inputs:diffuseColor = (0.21586, 0.21586, 0.21586)') &&
      colorUSDA.includes('color3f inputs:diffuseColor = (0.0331, 0.13287, 1.0)') &&
      colorUSDA.includes('float inputs:metallic = 0'),
    'Issue #18: USDZ UsdPreviewSurface exports linear diffuseColor and default metallic = 0',
  );

  // -------------------------------------------------------------------------
  // 16. Issue #16: glbToUSDZ & sceneToUSDZ Texture Packaging & UsdUVTexture
  // -------------------------------------------------------------------------
  const parseZipEntries = (
    zipBytes: Uint8Array,
  ): Array<{filename: string; data: Uint8Array; extraLen: number}> => {
    const dv = new DataView(
      zipBytes.buffer,
      zipBytes.byteOffset,
      zipBytes.byteLength,
    );
    const out: Array<{filename: string; data: Uint8Array; extraLen: number}> =
      [];
    let off = 0;
    const dec = new TextDecoder();
    while (off + 30 <= zipBytes.byteLength) {
      const sig = dv.getUint32(off, true);
      if (sig !== 0x04034b50) break;
      const compSize = dv.getUint32(off + 18, true);
      const fnLen = dv.getUint16(off + 26, true);
      const extraLen = dv.getUint16(off + 28, true);
      const filename = dec.decode(zipBytes.subarray(off + 30, off + 30 + fnLen));
      const payloadStart = off + 30 + fnLen + extraLen;
      const data = zipBytes.subarray(payloadStart, payloadStart + compSize);
      out.push({filename, data, extraLen});
      off = payloadStart + compSize;
    }
    return out;
  };

  // 16a. Construct a Khronos BoxTextured-style binary GLB with an embedded PNG
  //      in bufferViews[3] and NO baseColorFactor on pbrMetallicRoughness.
  const baseScene = new Scene();
  baseScene.add(new Mesh(new BoxGeometry(1, 1, 1), new MeshStandardMaterial()));
  const baseCanvas = sceneToCanvas3D(baseScene);
  const fakePng = new Uint8Array([
    0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d,
    0x49, 0x48, 0x44, 0x52,
  ]);
  const fakeJpg = new Uint8Array([
    0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01,
  ]);
  const origBin = new Uint8Array(baseCanvas.bin);
  const combinedBin = new Uint8Array(
    origBin.byteLength + fakePng.byteLength + fakeJpg.byteLength,
  );
  combinedBin.set(origBin, 0);
  combinedBin.set(fakePng, origBin.byteLength);
  combinedBin.set(fakeJpg, origBin.byteLength + fakePng.byteLength);

  const gltfDoc = JSON.parse(JSON.stringify(baseCanvas.gltf));
  const pngBvIdx = gltfDoc.bufferViews.length;
  gltfDoc.bufferViews.push({
    buffer: 0,
    byteOffset: origBin.byteLength,
    byteLength: fakePng.byteLength,
  });
  const jpgBvIdx = gltfDoc.bufferViews.length;
  gltfDoc.bufferViews.push({
    buffer: 0,
    byteOffset: origBin.byteLength + fakePng.byteLength,
    byteLength: fakeJpg.byteLength,
  });
  gltfDoc.buffers[0].byteLength = combinedBin.byteLength;
  gltfDoc.samplers = [{wrapS: 33071, wrapT: 33648}]; // CLAMP_TO_EDGE, MIRRORED_REPEAT
  gltfDoc.images = [
    {bufferView: pngBvIdx, mimeType: 'image/png'},
    {bufferView: jpgBvIdx, mimeType: 'image/jpeg'},
  ];
  gltfDoc.textures = [
    {sampler: 0, source: 0},
    {source: 1},
  ];
  gltfDoc.materials = [
    {
      name: 'TexturedMat',
      // Omit baseColorFactor on purpose (glTF 2.0 default is [1, 1, 1, 1])
      pbrMetallicRoughness: {
        baseColorTexture: {index: 0},
        metallicRoughnessTexture: {index: 0},
        metallicFactor: 0.4,
        roughnessFactor: 0.6,
      },
      normalTexture: {index: 1},
      emissiveTexture: {index: 0},
      emissiveFactor: [0.5, 0.25, 1.0],
      occlusionTexture: {index: 1},
    },
  ];

  const texturedUsdz = glbToUSDZ({gltf: gltfDoc, bin: combinedBin.buffer});
  assert(
    verifyUSDZAlignment(texturedUsdz, 'Issue #16 textured glbToUSDZ'),
    'Issue #16: Textured glbToUSDZ archive maintains 64-byte payload alignment across all entries',
  );
  const zipEntries = parseZipEntries(texturedUsdz);
  assert(
    zipEntries.length === 3 &&
      zipEntries[0].filename === 'model.usda' &&
      zipEntries[1].filename === 'texture_0.png' &&
      zipEntries[2].filename === 'texture_1.jpg',
    `Issue #16: glbToUSDZ packages model.usda + texture_0.png + texture_1.jpg (got ${zipEntries.map((e) => e.filename).join(', ')})`,
  );
  assert(
    zipEntries.every((e) => e.extraLen === 0 || e.extraLen >= 4),
    'Issue #16: Every USDZ ZIP entry has valid extra field length (0 or >= 4 bytes)',
  );
  assert(
    zipEntries[1].data.byteLength === fakePng.byteLength &&
      zipEntries[1].data[0] === 0x89 &&
      zipEntries[1].data[1] === 0x50 &&
      zipEntries[2].data.byteLength === fakeJpg.byteLength &&
      zipEntries[2].data[0] === 0xff &&
      zipEntries[2].data[1] === 0xd8,
    'Issue #16: Extracted texture_0.png and texture_1.jpg match embedded GLB bufferView bytes',
  );

  const texturedUsda = new TextDecoder().decode(zipEntries[0].data);
  assert(
    texturedUsda.includes('uniform token info:id = "UsdPrimvarReader_float2"') &&
      texturedUsda.includes('string inputs:varname = "st"') &&
      texturedUsda.includes('uniform token info:id = "UsdUVTexture"') &&
      texturedUsda.includes('asset inputs:file = @texture_0.png@') &&
      texturedUsda.includes('asset inputs:file = @texture_1.jpg@'),
    'Issue #16: USDA emits UsdPrimvarReader_float2 and UsdUVTexture shader nodes',
  );
  assert(
    texturedUsda.includes(
      'color3f inputs:diffuseColor.connect = </Root/Materials/TexturedMat/DiffuseTexture.outputs:rgb>',
    ) &&
      texturedUsda.includes(
        'float inputs:metallic.connect = </Root/Materials/TexturedMat/MetallicRoughnessTexture.outputs:b>',
      ) &&
      texturedUsda.includes(
        'float inputs:roughness.connect = </Root/Materials/TexturedMat/MetallicRoughnessTexture.outputs:g>',
      ) &&
      texturedUsda.includes(
        'normal3f inputs:normal.connect = </Root/Materials/TexturedMat/NormalTexture.outputs:rgb>',
      ) &&
      texturedUsda.includes(
        'color3f inputs:emissiveColor.connect = </Root/Materials/TexturedMat/EmissiveTexture.outputs:rgb>',
      ) &&
      texturedUsda.includes(
        'float inputs:occlusion.connect = </Root/Materials/TexturedMat/OcclusionTexture.outputs:r>',
      ),
    'Issue #16: UsdPreviewSurface connects diffuseColor, metallic, roughness, normal, emissiveColor, and occlusion',
  );
  assert(
    texturedUsda.includes('token inputs:wrapS = "clamp"') &&
      texturedUsda.includes('token inputs:wrapT = "mirror"') &&
      texturedUsda.includes('float4 inputs:scale = (2.0, 2.0, 2.0, 1.0)') &&
      texturedUsda.includes('float4 inputs:bias = (-1.0, -1.0, -1.0, 0)'),
    'Issue #16: UsdUVTexture preserves glTF sampler wrap modes and normal map scale/bias',
  );

  // 16b. Untextured GLB material omitting baseColorFactor defaults to (1, 1, 1) per glTF 2.0 spec
  const defaultFactorDoc = JSON.parse(JSON.stringify(baseCanvas.gltf));
  defaultFactorDoc.materials = [{name: 'NoFactorMat', pbrMetallicRoughness: {}}];
  const defaultFactorUsda = generateUSDA({
    gltf: defaultFactorDoc,
    bin: baseCanvas.bin,
  });
  assert(
    defaultFactorUsda.includes('color3f inputs:diffuseColor = (1.0, 1.0, 1.0)'),
    'Issue #16: glTF material without baseColorFactor defaults to diffuseColor = (1.0, 1.0, 1.0)',
  );

  // 16c. sceneToUSDZ with THREE.DataTexture packages texture_0.png and connects UsdUVTexture
  const dtScene = new Scene();
  const dtPixels = new Uint8Array(4 * 4 * 4);
  for (let i = 0; i < dtPixels.length; i += 4) {
    dtPixels[i] = 240;
    dtPixels[i + 1] = 120;
    dtPixels[i + 2] = 30;
    dtPixels[i + 3] = 255;
  }
  const dataTex = new DataTexture(dtPixels, 4, 4);
  const dtMesh = new Mesh(
    new BoxGeometry(1, 1, 1),
    new MeshStandardMaterial({map: dataTex, normalMap: dataTex}),
  );
  dtScene.add(dtMesh);
  const dtUsdz = sceneToUSDZ(dtScene);
  assert(
    verifyUSDZAlignment(dtUsdz, 'Issue #16 DataTexture sceneToUSDZ'),
    'Issue #16: sceneToUSDZ with THREE.DataTexture maintains 64-byte alignment',
  );
  const dtEntries = parseZipEntries(dtUsdz);
  assert(
    dtEntries.length === 2 &&
      dtEntries[0].filename === 'model.usda' &&
      dtEntries[1].filename === 'texture_0.png' &&
      dtEntries[1].data[0] === 0x89 &&
      dtEntries[1].data[1] === 0x50,
    'Issue #16: sceneToUSDZ with THREE.DataTexture embeds texture_0.png in USDZ archive',
  );
  const dtUsdaStr = new TextDecoder().decode(dtEntries[0].data);
  assert(
    dtUsdaStr.includes('DiffuseTexture.outputs:rgb') &&
      dtUsdaStr.includes('NormalTexture.outputs:rgb'),
    'Issue #16: sceneToUSDZ with THREE.DataTexture wires DiffuseTexture and NormalTexture shaders',
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
