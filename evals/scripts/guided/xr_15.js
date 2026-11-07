// Spatial Weather Table with Depth-Colliding Particles (xr_15)
scene.background = new THREE.Color(0x0b132b);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const stormSunLight = new THREE.DirectionalLight(0xe0f2fe, 1.15);
stormSunLight.name = "WeatherTableSunLight";
stormSunLight.position.set(2.5, 4.5, 3.0);
scene.add(stormSunLight);

const beaconPointLight = new THREE.PointLight(0xfef08a, 1.6, 3.5);
beaconPointLight.name = "LighthouseBeaconPointLight";
beaconPointLight.position.set(0.55, 0.62, 0.32);
scene.add(beaconPointLight);

// Materials
const basinRimMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.7, roughness: 0.35 });
const valleyTerrainMat = new THREE.MeshStandardMaterial({ color: 0x166534, roughness: 0.85, metalness: 0.05 });
const graniteMountainMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.78 });
const snowCapMat = new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.4 });
const cityBuildingMat = new THREE.MeshStandardMaterial({
  color: 0x334155,
  emissive: 0x38bdf8,
  emissiveIntensity: 0.25,
  metalness: 0.6,
  roughness: 0.3
});
const rainCloudMat = new THREE.MeshStandardMaterial({ color: 0x64748b, roughness: 0.9 });
const snowCloudMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.85 });

// Tabletop Terrain Basin Root (resting at y = 0)
const terrainBasin = new THREE.Group();
terrainBasin.name = "TabletopWeatherTerrainBasin";
terrainBasin.userData.xr = {
  anchor: "Table",
  grab: "2-hand",
  handles: { rotateAxis: "y", minScale: 0.6, maxScale: 1.8 }
};
scene.add(terrainBasin);

// Basin Table Frame & Valley Floor PlaneGeometry
const basinBox = new THREE.Mesh(new THREE.BoxGeometry(1.55, 0.08, 1.15), basinRimMat);
basinBox.name = "TerrainBasinFrame";
basinBox.position.set(0, 0.04, 0);
terrainBasin.add(basinBox);

const valleyPlane = new THREE.Mesh(new THREE.PlaneGeometry(1.46, 1.06, 16, 12), valleyTerrainMat);
valleyPlane.name = "ValleyFloorTerrainPlane";
valleyPlane.rotation.x = -Math.PI / 2;
valleyPlane.position.set(0, 0.082, 0);
terrainBasin.add(valleyPlane);

// Alpine Mountain Range with Snow Caps (`ConeGeometry`)
const mountainSpecs = [
  { pos: [-0.46, 0.08, -0.28], r: 0.24, h: 0.46 },
  { pos: [-0.18, 0.08, -0.34], r: 0.20, h: 0.38 },
  { pos: [0.16, 0.08, -0.30], r: 0.26, h: 0.52 },
  { pos: [0.46, 0.08, -0.24], r: 0.19, h: 0.35 }
];

mountainSpecs.forEach((m, idx) => {
  const mNum = idx + 1;
  const peak = new THREE.Mesh(new THREE.ConeGeometry(m.r, m.h, 16), graniteMountainMat);
  peak.name = `GraniteMountainPeak_${mNum}`;
  peak.position.set(m.pos[0], m.pos[1] + m.h * 0.5, m.pos[2]);
  terrainBasin.add(peak);

  const snowCap = new THREE.Mesh(new THREE.ConeGeometry(m.r * 0.44, m.h * 0.42, 16), snowCapMat);
  snowCap.name = `MountainSnowCap_${mNum}`;
  snowCap.position.set(m.pos[0], m.pos[1] + m.h * 0.80, m.pos[2]);
  terrainBasin.add(snowCap);
});

// Valley Micro-City Towers
const cityOffsets = [
  [-0.26, 0.16, 0.15, 0.16],
  [-0.14, 0.20, 0.18, 0.24],
  [-0.02, 0.18, 0.12, 0.20],
  [0.10, 0.22, 0.16, 0.28],
  [-0.08, 0.15, 0.28, 0.14]
];
cityOffsets.forEach((c, idx) => {
  const tower = new THREE.Mesh(new THREE.BoxGeometry(0.075, c[3], 0.075), cityBuildingMat);
  tower.name = `ValleyCityTower_${idx + 1}`;
  tower.position.set(c[0], 0.08 + c[3] * 0.5, c[2]);
  terrainBasin.add(tower);
});

// Coastal Lighthouse Beacon with Spatial `audioEmitter`
const lighthouse = new THREE.Group();
lighthouse.name = "CoastalLighthouseBeacon";
lighthouse.position.set(0.52, 0.08, 0.30);
lighthouse.userData.xr = {
  audioEmitter: { src: "lighthouse_foghorn.ogg", refDistance: 1.5, loop: true },
  bloom: { strength: 0.9 }
};
terrainBasin.add(lighthouse);

const lighthouseTower = new THREE.Mesh(
  new THREE.CylinderGeometry(0.035, 0.055, 0.32, 16),
  snowCapMat
);
lighthouseTower.name = "LighthouseTowerColumn";
lighthouseTower.position.y = 0.16;
lighthouse.add(lighthouseTower);

const lanternRoom = new THREE.Mesh(
  new THREE.CylinderGeometry(0.04, 0.04, 0.06, 16),
  new THREE.MeshStandardMaterial({ color: 0xfef08a, emissive: 0xfacc15, emissiveIntensity: 1.8 })
);
lanternRoom.name = "LighthouseLanternLens";
lanternRoom.position.y = 0.35;
lighthouse.add(lanternRoom);

const lighthouseRoof = new THREE.Mesh(
  new THREE.ConeGeometry(0.048, 0.055, 16),
  new THREE.MeshStandardMaterial({ color: 0xdc2626, roughness: 0.4 })
);
lighthouseRoof.name = "LighthouseConicalRoof";
lighthouseRoof.position.y = 0.405;
lighthouse.add(lighthouseRoof);

// Storm Cloud 1: Valley Rain Cloud Cluster (`preset: 'rain'`)
const rainCloudGroup = new THREE.Group();
rainCloudGroup.name = "RainStormCloudCluster";
rainCloudGroup.position.set(-0.22, 0.78, 0.16);
rainCloudGroup.userData.xr = {
  grab: "1-hand",
  audioEmitter: { src: "thunder_rain.ogg", refDistance: 1.4, loop: true }
};
rainCloudGroup.userData.state = {
  particles: { preset: "rain", rate: 120, depthCollide: true }
};
terrainBasin.add(rainCloudGroup);

[
  [0, 0, 0, 0.13],
  [-0.11, -0.02, 0.03, 0.10],
  [0.11, -0.01, -0.02, 0.11],
  [0.03, 0.05, 0.04, 0.09]
].forEach((puff, idx) => {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(puff[3], 16, 14), rainCloudMat);
  sphere.name = `RainCloudPuff_${idx + 1}`;
  sphere.position.set(puff[0], puff[1], puff[2]);
  rainCloudGroup.add(sphere);
});

// Storm Cloud 2: Alpine Snow Cloud Cluster (`preset: 'snow'`)
const snowCloudGroup = new THREE.Group();
snowCloudGroup.name = "SnowBlizzardCloudCluster";
snowCloudGroup.position.set(0.22, 0.86, -0.26);
snowCloudGroup.userData.xr = {
  grab: "1-hand",
  audioEmitter: { src: "alpine_wind.ogg", refDistance: 1.4, loop: true }
};
snowCloudGroup.userData.state = {
  particles: { preset: "snow", rate: 90, depthCollide: true }
};
terrainBasin.add(snowCloudGroup);

[
  [0, 0, 0, 0.13],
  [-0.12, -0.01, -0.02, 0.10],
  [0.12, -0.02, 0.02, 0.10]
].forEach((puff, idx) => {
  const sphere = new THREE.Mesh(new THREE.SphereGeometry(puff[3], 16, 14), snowCloudMat);
  sphere.name = `SnowCloudPuff_${idx + 1}`;
  sphere.position.set(puff[0], puff[1], puff[2]);
  snowCloudGroup.add(sphere);
});

// Physical Falling Rain Streaks & Snowflakes for 3D Depth-Colliding Precipitation
const rainDropMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.8
});
const rainDrops = [];
for (let i = 0; i < 12; i++) {
  const drop = new THREE.Mesh(new THREE.CylinderGeometry(0.003, 0.003, 0.045, 6), rainDropMat);
  drop.name = `FallingRainDrop_${i + 1}`;
  const angle = (i / 12) * Math.PI * 2;
  const rad = 0.05 + (i % 3) * 0.04;
  drop.position.set(Math.cos(angle) * rad, -0.15 - (i % 4) * 0.12, Math.sin(angle) * rad);
  rainCloudGroup.add(drop);
  rainDrops.push({ mesh: drop, phase: i * 0.25 });
}

const snowFlakes = [];
for (let i = 0; i < 12; i++) {
  const flake = new THREE.Mesh(new THREE.SphereGeometry(0.008, 8, 8), snowCapMat);
  flake.name = `FallingSnowFlake_${i + 1}`;
  const angle = (i / 12) * Math.PI * 2;
  const rad = 0.05 + (i % 3) * 0.04;
  flake.position.set(Math.cos(angle) * rad, -0.12 - (i % 4) * 0.10, Math.sin(angle) * rad);
  snowCloudGroup.add(flake);
  snowFlakes.push({ mesh: flake, phase: i * 0.3 });
}

function animate(t) {
  rainDrops.forEach((d) => {
    const cycle = (t * 1.8 + d.phase) % 1.0;
    d.mesh.position.y = -0.08 - cycle * 0.48;
  });
  snowFlakes.forEach((f) => {
    const cycle = (t * 0.75 + f.phase) % 1.0;
    f.mesh.position.y = -0.08 - cycle * 0.36;
  });
}

camera.position.set(1.45, 1.35, 1.65);
camera.lookAt(0, 0.38, 0);
