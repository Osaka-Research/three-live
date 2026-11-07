// mat_11: Damascus Steel Chef Knife on Magnetic Walnut Block
const root = new THREE.Group();
root.name = "DamascusChefKnifeRoot";
scene.add(root);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "KnifeAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xffffff, 1.5);
keyDirLight.name = "KnifeKeyDirectionalLight";
keyDirLight.position.set(1.0, 1.8, 1.4);
scene.add(keyDirLight);

const bladeRimLight = new THREE.PointLight(0xdbeeff, 1.6, 2.0);
bladeRimLight.name = "BladeSpecularPointLight";
bladeRimLight.position.set(-0.25, 0.35, 0.25);
scene.add(bladeRimLight);

// Procedural Damascus Wave Pattern DataTexture (128x128 RGBA)
const damW = 128;
const damH = 128;
const damData = new Uint8Array(damW * damH * 4);
for (let y = 0; y < damH; y++) {
  for (let x = 0; x < damW; x++) {
    const idx = (y * damW + x) * 4;
    const u = x / damW;
    const v = y / damH;
    // Layered raindrop + wavy folded steel Damascus interference pattern
    const wave1 = Math.sin(v * 52.0 + Math.sin(u * 26.0) * 3.2 + Math.cos(u * 13.0) * 1.8);
    const eyeDist = Math.hypot(((u * 6.0) % 1.0) - 0.5, ((v * 3.0) % 1.0) - 0.5);
    const wave2 = Math.sin(eyeDist * 36.0 + wave1 * 2.4);
    const band = (wave2 * 0.5 + 0.5) > 0.48 ? 1.0 : 0.25;
    const smoothVal = (wave2 * 0.5 + 0.5) * 0.55 + band * 0.45;

    const c = Math.round(95 + smoothVal * 145);
    damData[idx + 0] = c;
    damData[idx + 1] = Math.min(255, c + 4);
    damData[idx + 2] = Math.min(255, c + 10);
    damData[idx + 3] = 255;
  }
}
const damascusTex = new THREE.DataTexture(damData, damW, damH, THREE.RGBAFormat);
damascusTex.wrapS = THREE.RepeatWrapping;
damascusTex.wrapT = THREE.RepeatWrapping;
damascusTex.needsUpdate = true;

// Procedural Burl-Wood DataTexture (64x64 RGBA)
const burlW = 64;
const burlH = 64;
const burlData = new Uint8Array(burlW * burlH * 4);
for (let y = 0; y < burlH; y++) {
  for (let x = 0; x < burlW; x++) {
    const idx = (y * burlW + x) * 4;
    const u = x / burlW;
    const v = y / burlH;
    const swirl = Math.sin(u * 24.0 + Math.cos(v * 18.0) * 2.5) * 0.5 + 0.5;
    burlData[idx + 0] = Math.round(82 + swirl * 78);
    burlData[idx + 1] = Math.round(42 + swirl * 42);
    burlData[idx + 2] = Math.round(24 + swirl * 28);
    burlData[idx + 3] = 255;
  }
}
const burlTex = new THREE.DataTexture(burlData, burlW, burlH, THREE.RGBAFormat);
burlTex.needsUpdate = true;

// Materials
const damascusBladeMat = new THREE.MeshStandardMaterial({
  color: 0xffffff,
  map: damascusTex,
  metalness: 0.92,
  roughness: 0.16
});

const mirrorEdgeMat = new THREE.MeshStandardMaterial({
  color: 0xf4f8fc,
  metalness: 0.98,
  roughness: 0.06
});

const brassBolsterMat = new THREE.MeshStandardMaterial({
  color: 0xe0b243,
  metalness: 0.92,
  roughness: 0.15
});

const burlHandleMat = new THREE.MeshStandardMaterial({
  color: 0xd8a888,
  map: burlTex,
  roughness: 0.25,
  metalness: 0.05
});

const darkHornFerruleMat = new THREE.MeshStandardMaterial({
  color: 0x1a1817,
  roughness: 0.2,
  metalness: 0.08
});

const walnutBlockMat = new THREE.MeshStandardMaterial({
  color: 0x4f331f,
  roughness: 0.42,
  metalness: 0.04
});

const brushedSteelBaseMat = new THREE.MeshStandardMaterial({
  color: 0x3b4046,
  metalness: 0.85,
  roughness: 0.28
});

// Tilted Magnetic Walnut Knife Block (resting at y = 0)
const blockGroup = new THREE.Group();
blockGroup.name = "TiltedWalnutMagneticBlockGroup";
root.add(blockGroup);

const steelBaseFoot = new THREE.Mesh(
  new THREE.BoxGeometry(0.30, 0.022, 0.14),
  brushedSteelBaseMat
);
steelBaseFoot.name = "KnifeBlockSteelBase";
steelBaseFoot.position.set(-0.02, 0.011, 0);
blockGroup.add(steelBaseFoot);

// Tilted easel walnut board (~15 deg backward tilt)
const tiltedBoardGroup = new THREE.Group();
tiltedBoardGroup.name = "TiltedWalnutBoardPivot";
tiltedBoardGroup.position.set(-0.02, 0.022, 0.01);
tiltedBoardGroup.rotation.x = -0.24;
blockGroup.add(tiltedBoardGroup);

const walnutSlab = new THREE.Mesh(
  new THREE.BoxGeometry(0.28, 0.26, 0.032),
  walnutBlockMat
);
walnutSlab.name = "WalnutMagneticBlockSlab";
walnutSlab.position.set(0, 0.13, 0);
tiltedBoardGroup.add(walnutSlab);

// Dual concealed magnetic inlay strips on the walnut face
for (let mRow of [0.10, 0.18]) {
  const magStrip = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.008, 0.034),
    brassBolsterMat
  );
  magStrip.name = "WalnutMagneticInlayStrip_" + Math.round(mRow * 100);
  magStrip.position.set(0, mRow, 0);
  tiltedBoardGroup.add(magStrip);
}

// Rear support strut behind the walnut board
const rearStrut = new THREE.Mesh(
  new THREE.CylinderGeometry(0.01, 0.012, 0.18, 12),
  brushedSteelBaseMat
);
rearStrut.name = "KnifeBlockRearSupportStrut";
rearStrut.rotation.x = 0.45;
rearStrut.position.set(-0.02, 0.09, -0.045);
blockGroup.add(rearStrut);

// Japanese Gyuto Chef Knife (~0.45m total length: 0.28m blade + 0.03m bolster + 0.14m octagonal wa-handle)
// Positioned magnetically against the front face of the walnut block
const knifeGroup = new THREE.Group();
knifeGroup.name = "JapaneseGyutoChefKnifeGroup";
knifeGroup.position.set(0.0, 0.165, 0.021);
knifeGroup.rotation.x = -0.24;
knifeGroup.rotation.z = -0.08;
root.add(knifeGroup);

// 2D Gyuto Blade Profile extruded with ExtrudeGeometry (from x = -0.22 tip to x = +0.06 heel)
const bladeShape = new THREE.Shape();
bladeShape.moveTo(0.06, -0.032); // Sharp heel (ago)
bladeShape.quadraticCurveTo(-0.04, -0.031, -0.14, -0.018); // Gentle belly curve
bladeShape.quadraticCurveTo(-0.19, -0.008, -0.22, 0.008); // Upswept Gyuto point (kissaki)
bladeShape.lineTo(-0.16, 0.022); // Spine drop toward point
bladeShape.lineTo(0.06, 0.024); // Straight spine (mune)
bladeShape.lineTo(0.06, 0.002); // Machi neck
bladeShape.quadraticCurveTo(0.048, -0.005, 0.06, -0.032); // Finger choil curve

const bladeGeo = new THREE.ExtrudeGeometry(bladeShape, {
  depth: 0.0035,
  bevelEnabled: true,
  bevelSegments: 2,
  steps: 1,
  bevelSize: 0.0008,
  bevelThickness: 0.0008
});
const bladeMesh = new THREE.Mesh(bladeGeo, damascusBladeMat);
bladeMesh.name = "DamascusGyutoBlade";
bladeMesh.position.set(0, 0, -0.00175);
knifeGroup.add(bladeMesh);

// Polished cutting edge bevel highlight strip along bottom curve
const edgeStrip = new THREE.Mesh(
  new THREE.BoxGeometry(0.26, 0.003, 0.0022),
  mirrorEdgeMat
);
edgeStrip.name = "PolishedCuttingEdgeBevel";
edgeStrip.position.set(-0.075, -0.021, 0);
edgeStrip.rotation.z = -0.12;
knifeGroup.add(edgeStrip);

// Polished Brass Bolster & Dark Buffalo-Horn Ferrule Spacer (x = 0.06 to x = 0.095)
const brassBolster = new THREE.Mesh(
  new THREE.CylinderGeometry(0.012, 0.0135, 0.018, 8),
  brassBolsterMat
);
brassBolster.name = "PolishedBrassBolster";
brassBolster.rotation.z = Math.PI / 2;
brassBolster.rotation.x = Math.PI / 8;
brassBolster.position.set(0.069, 0.009, 0);
knifeGroup.add(brassBolster);

const hornFerrule = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0135, 0.014, 0.016, 8),
  darkHornFerruleMat
);
hornFerrule.name = "BuffaloHornFerrule";
hornFerrule.rotation.z = Math.PI / 2;
hornFerrule.rotation.x = Math.PI / 8;
hornFerrule.position.set(0.086, 0.009, 0);
knifeGroup.add(hornFerrule);

const brassSpacerRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0142, 0.0142, 0.003, 8),
  brassBolsterMat
);
brassSpacerRing.name = "HandleBrassAccentSpacer";
brassSpacerRing.rotation.z = Math.PI / 2;
brassSpacerRing.rotation.x = Math.PI / 8;
brassSpacerRing.position.set(0.0955, 0.009, 0);
knifeGroup.add(brassSpacerRing);

// Octagonal Stabilized Burl-Wood Wa-Handle (8-sided CylinderGeometry from x = 0.097 to x = 0.232)
const waHandle = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0155, 0.014, 0.135, 8),
  burlHandleMat
);
waHandle.name = "OctagonalBurlWoodWaHandle";
waHandle.rotation.z = -Math.PI / 2;
waHandle.rotation.x = Math.PI / 8;
waHandle.position.set(0.1645, 0.009, 0);
knifeGroup.add(waHandle);

// Brass butt cap on the end of the octagonal handle
const buttCap = new THREE.Mesh(
  new THREE.CylinderGeometry(0.0155, 0.015, 0.005, 8),
  brassBolsterMat
);
buttCap.name = "BrassHandleButtCap";
buttCap.rotation.z = -Math.PI / 2;
buttCap.rotation.x = Math.PI / 8;
buttCap.position.set(0.2345, 0.009, 0);
knifeGroup.add(buttCap);

// Camera framing (~0.46m wide -> distance ~0.68m)
camera.position.set(0.05, 0.25, 0.64);
camera.lookAt(0.0, 0.14, 0.0);
