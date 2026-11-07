// anim_05: Clockwork Brass Solar System Orrery
const orreryGroup = new THREE.Group();
orreryGroup.name = "ClockworkBrassOrrery";
scene.add(orreryGroup);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xfff1d0, 1.3);
keyLight.name = "OrreryKeyLight";
keyLight.position.set(2.5, 3.5, 2.5);
scene.add(keyLight);

// Glowing Central Sun PointLight
const sunPointLight = new THREE.PointLight(0xffb703, 2.4, 4.5);
sunPointLight.name = "CentralSunLight";
sunPointLight.position.set(0, 0.42, 0);
scene.add(sunPointLight);

// Materials
const brassMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.24,
  metalness: 0.9
});
const agedBrassMat = new THREE.MeshStandardMaterial({
  color: 0x9c7a23,
  roughness: 0.38,
  metalness: 0.85
});
const walnutMat = new THREE.MeshStandardMaterial({
  color: 0x3b2314,
  roughness: 0.45,
  metalness: 0.1
});
const sunMat = new THREE.MeshStandardMaterial({
  color: 0xffd166,
  emissive: 0xff9f1c,
  emissiveIntensity: 1.4,
  roughness: 0.2
});

// Table-Top Walnut & Brass Base (~1.2m diameter -> radius 0.6m) resting at y = 0
const baseTable = new THREE.Mesh(new THREE.CylinderGeometry(0.58, 0.62, 0.06, 48), walnutMat);
baseTable.name = "OrreryWalnutBase";
baseTable.position.set(0, 0.03, 0);
orreryGroup.add(baseTable);

const calendarRim = new THREE.Mesh(new THREE.TorusGeometry(0.59, 0.018, 12, 64), brassMat);
calendarRim.name = "EngravedCalendarRim";
calendarRim.rotation.x = Math.PI / 2;
calendarRim.position.set(0, 0.062, 0);
orreryGroup.add(calendarRim);

// Engraved Concentric Gear Rings & Central Column
const centralColumn = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.045, 0.36, 24), brassMat);
centralColumn.name = "CentralSpindleColumn";
centralColumn.position.set(0, 0.21, 0);
orreryGroup.add(centralColumn);

// Central Glowing Sun Sphere
const sunMesh = new THREE.Mesh(new THREE.SphereGeometry(0.085, 28, 20), sunMat);
sunMesh.name = "CentralGlowingSun";
sunMesh.position.set(0, 0.42, 0);
orreryGroup.add(sunMesh);

// 6 Planets (Mercury, Venus, Earth+Moon, Mars, Jupiter, Saturn+Rings)
const planetsConfig = [
  { name: "Mercury", radius: 0.15, size: 0.016, color: 0xa1a1aa, speed: 4.15, height: 0.33 },
  { name: "Venus", radius: 0.22, size: 0.024, color: 0xeab308, speed: 1.62, height: 0.35 },
  { name: "Earth", radius: 0.31, size: 0.026, color: 0x2563eb, speed: 1.0, height: 0.37, hasMoon: true },
  { name: "Mars", radius: 0.39, size: 0.020, color: 0xdc2626, speed: 0.53, height: 0.39 },
  { name: "Jupiter", radius: 0.48, size: 0.046, color: 0xd97706, speed: 0.28, height: 0.41 },
  { name: "Saturn", radius: 0.57, size: 0.038, color: 0xfde047, speed: 0.18, height: 0.43, hasRings: true }
];

const planetPivots = [];
let moonPivot = null;

for (let i = 0; i < planetsConfig.length; i++) {
  const cfg = planetsConfig[i];

  // Concentric Engraved Brass Gear Ring on the Base Deck
  const gearRing = new THREE.Mesh(new THREE.TorusGeometry(cfg.radius, 0.005, 8, 48), agedBrassMat);
  gearRing.name = `ConcentricGearTrack_${cfg.name}`;
  gearRing.rotation.x = Math.PI / 2;
  gearRing.position.set(0, 0.066, 0);
  orreryGroup.add(gearRing);

  // Rotating Radial Arm Group
  const armPivot = new THREE.Group();
  armPivot.name = `PlanetArmPivot_${cfg.name}`;
  armPivot.position.set(0, 0, 0);
  armPivot.rotation.y = i * 1.05;
  orreryGroup.add(armPivot);

  // Collar Gear around Central Column
  const collarY = 0.10 + i * 0.038;
  const collarGear = new THREE.Mesh(new THREE.CylinderGeometry(0.055 + (5 - i) * 0.008, 0.055 + (5 - i) * 0.008, 0.016, 24), agedBrassMat);
  collarGear.name = `CollarGear_${cfg.name}`;
  collarGear.position.set(0, collarY, 0);
  armPivot.add(collarGear);

  // Horizontal Brass Arm Rod
  const armRod = new THREE.Mesh(new THREE.CylinderGeometry(0.005, 0.005, cfg.radius, 10), brassMat);
  armRod.name = `RadialArmRod_${cfg.name}`;
  armRod.rotation.z = Math.PI / 2;
  armRod.position.set(cfg.radius * 0.5, collarY, 0);
  armPivot.add(armRod);

  // Vertical Riser Stem holding the Planet
  const riserHeight = cfg.height - collarY;
  const riserStem = new THREE.Mesh(new THREE.CylinderGeometry(0.004, 0.004, riserHeight, 10), brassMat);
  riserStem.name = `VerticalStem_${cfg.name}`;
  riserStem.position.set(cfg.radius, collarY + riserHeight * 0.5, 0);
  armPivot.add(riserStem);

  // Planet Sphere
  const planetMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    roughness: 0.45,
    metalness: 0.25
  });
  const planetMesh = new THREE.Mesh(new THREE.SphereGeometry(cfg.size, 20, 16), planetMat);
  planetMesh.name = `Planet_${cfg.name}`;
  planetMesh.position.set(cfg.radius, cfg.height, 0);
  armPivot.add(planetMesh);

  // Earth's Moon sub-assembly
  if (cfg.hasMoon) {
    moonPivot = new THREE.Group();
    moonPivot.name = "EarthMoonPivot";
    moonPivot.position.set(cfg.radius, cfg.height, 0);
    armPivot.add(moonPivot);

    const moonArm = new THREE.Mesh(new THREE.CylinderGeometry(0.002, 0.002, 0.048, 8), brassMat);
    moonArm.name = "EarthMoonArm";
    moonArm.rotation.z = Math.PI / 2;
    moonArm.position.set(0.024, 0, 0);
    moonPivot.add(moonArm);

    const moonMat = new THREE.MeshStandardMaterial({ color: 0xe4e4e7, roughness: 0.6 });
    const moonMesh = new THREE.Mesh(new THREE.SphereGeometry(0.008, 12, 10), moonMat);
    moonMesh.name = "EarthMoonSphere";
    moonMesh.position.set(0.048, 0.008, 0);
    moonPivot.add(moonMesh);
  }

  // Saturn's Rings
  if (cfg.hasRings) {
    const saturnRing = new THREE.Mesh(new THREE.TorusGeometry(cfg.size * 1.75, 0.007, 10, 36), brassMat);
    saturnRing.name = "SaturnBrassRing";
    saturnRing.rotation.x = Math.PI / 2.4;
    saturnRing.position.set(cfg.radius, cfg.height, 0);
    armPivot.add(saturnRing);
  }

  planetPivots.push({ group: armPivot, speed: cfg.speed, initialAngle: i * 1.05 });
}

function animate(t) {
  sunMesh.rotation.y = t * 0.5;
  for (let i = 0; i < planetPivots.length; i++) {
    const p = planetPivots[i];
    p.group.rotation.y = p.initialAngle + t * p.speed * 0.6;
  }
  if (moonPivot) {
    moonPivot.rotation.y = t * 4.5;
  }
}

// Scene bounds: radius ~0.65m in XZ, height 0.52m -> camera distance ~1.6m
camera.position.set(0.0, 0.95, 1.45);
camera.lookAt(0, 0.25, 0);
