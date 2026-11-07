// mat_01: Brilliant-Cut Diamond & Dispersion Prism Studio
const root = new THREE.Group();
root.name = "DiamondPrismStudioRoot";
scene.add(root);

// Lighting: Ambient + Directional + 3 colored key/rim PointLights
const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "StudioAmbientLight";
scene.add(ambientLight);

const keyDirLight = new THREE.DirectionalLight(0xffffff, 1.4);
keyDirLight.name = "OverheadKeyDirectionalLight";
keyDirLight.position.set(1.2, 2.5, 1.5);
scene.add(keyDirLight);

const warmRimLight = new THREE.PointLight(0xffaa55, 2.0, 4.0);
warmRimLight.name = "WarmAmberRimLight";
warmRimLight.position.set(-0.6, 0.65, -0.5);
scene.add(warmRimLight);

const coolBlueKeyLight = new THREE.PointLight(0x55aaff, 2.2, 4.0);
coolBlueKeyLight.name = "CoolBlueKeyLight";
coolBlueKeyLight.position.set(0.65, 0.55, 0.5);
scene.add(coolBlueKeyLight);

const magentaAccentLight = new THREE.PointLight(0xff44cc, 1.8, 4.0);
magentaAccentLight.name = "MagentaSpectralLight";
magentaAccentLight.position.set(0.0, 0.8, -0.65);
scene.add(magentaAccentLight);

// Black Velvet Pedestal (y = 0 to y = 0.14m, radius ~0.42m)
const pedestalGroup = new THREE.Group();
pedestalGroup.name = "VelvetPedestalGroup";
root.add(pedestalGroup);

const brassTrimMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  metalness: 0.9,
  roughness: 0.2
});

const blackVelvetMat = new THREE.MeshPhysicalMaterial({
  color: 0x0d0d12,
  roughness: 0.9,
  metalness: 0.0,
  sheen: 1.0,
  sheenColor: 0x2a2a3d,
  sheenRoughness: 0.8
});

const basePlinth = new THREE.Mesh(
  new THREE.CylinderGeometry(0.42, 0.45, 0.04, 32),
  brassTrimMat
);
basePlinth.name = "BrassBasePlinth";
basePlinth.position.set(0, 0.02, 0);
pedestalGroup.add(basePlinth);

const velvetTier1 = new THREE.Mesh(
  new THREE.CylinderGeometry(0.39, 0.41, 0.06, 32),
  blackVelvetMat
);
velvetTier1.name = "VelvetLowerTier";
velvetTier1.position.set(0, 0.07, 0);
pedestalGroup.add(velvetTier1);

const brassInlayRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.365, 0.365, 0.012, 32),
  brassTrimMat
);
brassInlayRing.name = "BrassInlayRing";
brassInlayRing.position.set(0, 0.106, 0);
pedestalGroup.add(brassInlayRing);

const velvetTopPad = new THREE.Mesh(
  new THREE.CylinderGeometry(0.35, 0.36, 0.035, 32),
  blackVelvetMat
);
velvetTopPad.name = "VelvetDisplayPad";
velvetTopPad.position.set(0, 0.128, 0);
pedestalGroup.add(velvetTopPad);

// Brilliant-Cut Diamond (left of center on pedestal)
const diamondGroup = new THREE.Group();
diamondGroup.name = "BrilliantCutDiamondGroup";
diamondGroup.position.set(-0.14, 0.145, 0.02);
root.add(diamondGroup);

const diamondMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.02,
  metalness: 0.0,
  transmission: 0.98,
  ior: 2.418,
  thickness: 0.22,
  dispersion: 0.08,
  attenuationColor: 0xeef6ff,
  attenuationDistance: 0.8,
  clearcoat: 1.0,
  clearcoatRoughness: 0.01
});

// Prong holder cradle in platinum
const platinumMat = new THREE.MeshStandardMaterial({
  color: 0xe5e7eb,
  metalness: 0.95,
  roughness: 0.12
});

const ringCollar = new THREE.Mesh(
  new THREE.CylinderGeometry(0.065, 0.055, 0.012, 16),
  platinumMat
);
ringCollar.name = "DiamondStandCollar";
ringCollar.position.set(0, 0.006, 0);
diamondGroup.add(ringCollar);

for (let i = 0; i < 6; i++) {
  const angle = (i / 6) * Math.PI * 2;
  const prong = new THREE.Mesh(
    new THREE.CylinderGeometry(0.005, 0.007, 0.13, 8),
    platinumMat
  );
  prong.name = "PlatinumProng_" + i;
  prong.position.set(Math.cos(angle) * 0.075, 0.065, Math.sin(angle) * 0.075);
  prong.rotation.z = -Math.cos(angle) * 0.35;
  prong.rotation.x = Math.sin(angle) * 0.35;
  diamondGroup.add(prong);
}

// Diamond Pavilion (inverted faceted cone, 16 facets)
const pavilionHeight = 0.11;
const girdleRadius = 0.115;
const pavilionGeo = new THREE.ConeGeometry(girdleRadius, pavilionHeight, 16, 1);
const pavilionMesh = new THREE.Mesh(pavilionGeo, diamondMat);
pavilionMesh.name = "DiamondPavilion";
pavilionMesh.rotation.x = Math.PI;
pavilionMesh.position.set(0, 0.02 + pavilionHeight * 0.5, 0);
diamondGroup.add(pavilionMesh);

// Diamond Girdle (thin faceted cylinder)
const girdleHeight = 0.008;
const girdleGeo = new THREE.CylinderGeometry(girdleRadius, girdleRadius, girdleHeight, 16, 1);
const girdleMesh = new THREE.Mesh(girdleGeo, diamondMat);
girdleMesh.name = "DiamondGirdle";
girdleMesh.position.set(0, 0.02 + pavilionHeight + girdleHeight * 0.5, 0);
diamondGroup.add(girdleMesh);

// Diamond Crown (frustum cylinder with 16 facets tapering up to the flat table)
const crownHeight = 0.042;
const tableRadius = 0.066;
const crownGeo = new THREE.CylinderGeometry(tableRadius, girdleRadius, crownHeight, 16, 1);
const crownMesh = new THREE.Mesh(crownGeo, diamondMat);
crownMesh.name = "DiamondCrown";
crownMesh.position.set(0, 0.02 + pavilionHeight + girdleHeight + crownHeight * 0.5, 0);
diamondGroup.add(crownMesh);

// Star facets overlay ring for extra brilliance
const starCrownGeo = new THREE.CylinderGeometry(tableRadius * 0.98, girdleRadius * 0.99, crownHeight * 0.96, 8, 1);
const starCrownMesh = new THREE.Mesh(starCrownGeo, diamondMat);
starCrownMesh.name = "DiamondStarFacets";
starCrownMesh.rotation.y = Math.PI / 16;
starCrownMesh.position.set(0, 0.02 + pavilionHeight + girdleHeight + crownHeight * 0.5, 0);
diamondGroup.add(starCrownMesh);

// Diamond Table (top flat octagonal facet cap)
const tableGeo = new THREE.CylinderGeometry(tableRadius, tableRadius, 0.003, 8);
const tableMesh = new THREE.Mesh(tableGeo, diamondMat);
tableMesh.name = "DiamondTableFacet";
tableMesh.position.set(0, 0.02 + pavilionHeight + girdleHeight + crownHeight + 0.0015, 0);
diamondGroup.add(tableMesh);

// Optical Triangular Glass Prism (right of center on pedestal)
const prismGroup = new THREE.Group();
prismGroup.name = "OpticalPrismGroup";
prismGroup.position.set(0.13, 0.145, -0.01);
prismGroup.rotation.y = -0.35;
root.add(prismGroup);

const flintGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xffffff,
  roughness: 0.03,
  metalness: 0.0,
  transmission: 0.97,
  ior: 1.72,
  thickness: 0.18,
  dispersion: 0.065,
  attenuationColor: 0xf4f9ff,
  attenuationDistance: 0.9,
  clearcoat: 1.0,
  clearcoatRoughness: 0.02
});

// Brass cradle ends for the triangular prism
const prismLength = 0.22;
const prismRadius = 0.085;

const prismGeo = new THREE.CylinderGeometry(prismRadius, prismRadius, prismLength, 3, 1);
const prismMesh = new THREE.Mesh(prismGeo, flintGlassMat);
prismMesh.name = "TriangularOpticalPrism";
prismMesh.position.set(0, prismLength * 0.5 + 0.012, 0);
prismGroup.add(prismMesh);

const prismBaseCapBottom = new THREE.Mesh(
  new THREE.CylinderGeometry(prismRadius * 1.06, prismRadius * 1.08, 0.014, 3),
  brassTrimMat
);
prismBaseCapBottom.name = "PrismBrassBaseHolder";
prismBaseCapBottom.position.set(0, 0.007, 0);
prismGroup.add(prismBaseCapBottom);

const prismTopCap = new THREE.Mesh(
  new THREE.CylinderGeometry(prismRadius * 1.04, prismRadius * 1.04, 0.01, 3),
  brassTrimMat
);
prismTopCap.name = "PrismBrassTopBezel";
prismTopCap.position.set(0, prismLength + 0.015, 0);
prismGroup.add(prismTopCap);

// Dispersed rainbow spectrum light strips cast onto the velvet pad near prism
const spectrumColors = [0xff2222, 0xff8811, 0xffee22, 0x22dd44, 0x2288ff, 0x8833ff];
for (let i = 0; i < spectrumColors.length; i++) {
  const beamMat = new THREE.MeshPhysicalMaterial({
    color: spectrumColors[i],
    emissive: spectrumColors[i],
    emissiveIntensity: 0.85,
    roughness: 0.2,
    transmission: 0.6,
    transparent: true,
    opacity: 0.75
  });
  const beamPatch = new THREE.Mesh(
    new THREE.CylinderGeometry(0.008, 0.014, 0.11, 8),
    beamMat
  );
  beamPatch.name = "DispersedSpectrumRay_" + i;
  beamPatch.rotation.z = Math.PI / 2;
  beamPatch.rotation.y = -0.25 + (i - 2.5) * 0.09;
  beamPatch.position.set(0.22, 0.151, 0.03 + (i - 2.5) * 0.018);
  root.add(beamPatch);
}

// Camera framing (~2.2x scene bounding radius ~0.48m -> distance ~1.1m)
camera.position.set(0.0, 0.58, 1.05);
camera.lookAt(0, 0.18, 0);
