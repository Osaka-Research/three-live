// Carved Limestone Gothic Cathedral Rose Window Frame (2.4m diameter) on y = 0
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff5e0, 1.4);
sunLight.name = "sun_directional_light";
sunLight.position.set(2.5, 3.8, 3.5);
scene.add(sunLight);

const backLight = new THREE.DirectionalLight(0xffdf99, 1.2);
backLight.name = "stained_glass_backlight";
backLight.position.set(-1.5, 2.5, -3.5);
scene.add(backLight);

const roseWindowGroup = new THREE.Group();
roseWindowGroup.name = "gothic_cathedral_rose_window";
scene.add(roseWindowGroup);

// Materials
const limestoneMat = new THREE.MeshStandardMaterial({
  color: 0xd8cdb8,
  metalness: 0.05,
  roughness: 0.72
});

const darkLimestoneMat = new THREE.MeshStandardMaterial({
  color: 0xb8ab94,
  metalness: 0.06,
  roughness: 0.78
});

const leadCameMat = new THREE.MeshStandardMaterial({
  color: 0x2c3035,
  metalness: 0.65,
  roughness: 0.4
});

// Jewel-toned stained glass materials (MeshPhysicalMaterial with transmission)
const rubyGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xd91b38,
  emissive: 0x44050e,
  emissiveIntensity: 0.35,
  transmission: 0.86,
  ior: 1.52,
  thickness: 0.015,
  roughness: 0.08,
  transparent: true,
  opacity: 0.92
});

const cobaltGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x1648c8,
  emissive: 0x051544,
  emissiveIntensity: 0.35,
  transmission: 0.86,
  ior: 1.52,
  thickness: 0.015,
  roughness: 0.08,
  transparent: true,
  opacity: 0.92
});

const amberGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0xf2a81d,
  emissive: 0x442b04,
  emissiveIntensity: 0.35,
  transmission: 0.86,
  ior: 1.52,
  thickness: 0.015,
  roughness: 0.08,
  transparent: true,
  opacity: 0.92
});

const emeraldGlassMat = new THREE.MeshPhysicalMaterial({
  color: 0x149654,
  emissive: 0x042e18,
  emissiveIntensity: 0.35,
  transmission: 0.86,
  ior: 1.52,
  thickness: 0.015,
  roughness: 0.08,
  transparent: true,
  opacity: 0.92
});

const glassPalette = [rubyGlassMat, cobaltGlassMat, amberGlassMat, emeraldGlassMat];

// Center of the 2.4m rose window is at y = 1.32m above a carved stone sill base on y = 0
const centerY = 1.32;
const outerRadius = 1.2;

// 1. Carved Stone Sill Plinth at y = 0
const stoneSill = new THREE.Mesh(
  new THREE.BoxGeometry(2.55, 0.14, 0.42),
  darkLimestoneMat
);
stoneSill.name = "carved_limestone_window_sill";
stoneSill.position.set(0, 0.07, 0);
roseWindowGroup.add(stoneSill);

// 2. Deep Beveled Outer Arch Molding & Extruded Stone Surround
const surroundShape = new THREE.Shape();
surroundShape.absarc(0, 0, outerRadius, 0, Math.PI * 2, false);
const innerOpeningPath = new THREE.Path();
innerOpeningPath.absarc(0, 0, 1.02, 0, Math.PI * 2, true);
surroundShape.holes.push(innerOpeningPath);

const surroundGeo = new THREE.ExtrudeGeometry(surroundShape, {
  depth: 0.24,
  bevelEnabled: true,
  bevelThickness: 0.04,
  bevelSize: 0.04,
  bevelSegments: 3
});
surroundGeo.translate(0, 0, -0.12);

const outerStoneRing = new THREE.Mesh(surroundGeo, limestoneMat);
outerStoneRing.name = "extruded_limestone_arch_surround";
outerStoneRing.position.set(0, centerY, 0);
roseWindowGroup.add(outerStoneRing);

// Concentric Torus moldings for deep Gothic splay profile
const moldingRadii = [1.16, 1.06, 0.62, 0.26];
for (let m = 0; m < moldingRadii.length; m++) {
  const torusMolding = new THREE.Mesh(
    new THREE.TorusGeometry(moldingRadii[m], m < 2 ? 0.048 : 0.028, 16, 48),
    m % 2 === 0 ? limestoneMat : darkLimestoneMat
  );
  torusMolding.name = `stone_arch_molding_ring_${m + 1}`;
  torusMolding.position.set(0, centerY, 0);
  roseWindowGroup.add(torusMolding);
}

// 3. Central Stained-Glass Rosette Medallion
const centerMedallion = new THREE.Mesh(
  new THREE.CylinderGeometry(0.25, 0.25, 0.018, 24),
  amberGlassMat
);
centerMedallion.name = "central_stained_glass_medallion";
centerMedallion.rotation.x = Math.PI / 2;
centerMedallion.position.set(0, centerY, 0);
roseWindowGroup.add(centerMedallion);

// 4. 12 Radial Stone Mullions, Colonnette Capitals, Quatrefoil Tracery & Jewel Stained Glass Sectors
const numPetals = 12;
for (let i = 0; i < numPetals; i++) {
  const angle = (i / numPetals) * Math.PI * 2;
  const midSectorAngle = angle + Math.PI / numPetals;

  // Radial stone mullion column (from r = 0.26 to r = 1.02)
  const mullionLen = 0.76;
  const mullionMidR = 0.26 + mullionLen / 2;
  const mullion = new THREE.Mesh(
    new THREE.CylinderGeometry(0.022, 0.028, mullionLen, 12),
    limestoneMat
  );
  mullion.name = `radial_stone_mullion_${i + 1}`;
  mullion.position.set(
    Math.cos(angle) * mullionMidR,
    centerY + Math.sin(angle) * mullionMidR,
    0
  );
  mullion.rotation.z = angle - Math.PI / 2;
  roseWindowGroup.add(mullion);

  // Inner lancet stained glass panel (between r = 0.27 and r = 0.61)
  const innerGlassMat = glassPalette[i % glassPalette.length];
  const innerGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.014, 16, 1, false, angle, (Math.PI * 2) / numPetals),
    innerGlassMat
  );
  innerGlass.name = `inner_stained_glass_sector_${i + 1}`;
  innerGlass.rotation.x = Math.PI / 2;
  innerGlass.rotation.y = Math.PI / 2;
  innerGlass.position.set(0, centerY, -0.005);
  roseWindowGroup.add(innerGlass);

  // Outer stained glass petal & carved Quatrefoil / Trefoil Tracery Ring at r = 0.82
  const qx = Math.cos(midSectorAngle) * 0.82;
  const qy = centerY + Math.sin(midSectorAngle) * 0.82;

  const traceryCircle = new THREE.Mesh(
    new THREE.TorusGeometry(0.14, 0.022, 12, 24),
    limestoneMat
  );
  traceryCircle.name = `outer_tracery_oculus_${i + 1}`;
  traceryCircle.position.set(qx, qy, 0.01);
  roseWindowGroup.add(traceryCircle);

  // 4-cusp quatrefoil foils inside each outer oculus
  for (let f = 0; f < 4; f++) {
    const fAng = midSectorAngle + (f * Math.PI) / 2;
    const foilArc = new THREE.Mesh(
      new THREE.TorusGeometry(0.055, 0.012, 10, 16),
      darkLimestoneMat
    );
    foilArc.name = `quatrefoil_cusp_${i + 1}_${f + 1}`;
    foilArc.position.set(
      qx + Math.cos(fAng) * 0.055,
      qy + Math.sin(fAng) * 0.055,
      0.015
    );
    roseWindowGroup.add(foilArc);
  }

  // Jewel-toned glass disc filling each quatrefoil oculus
  const oculusGlassMat = glassPalette[(i + 1) % glassPalette.length];
  const oculusGlass = new THREE.Mesh(
    new THREE.CylinderGeometry(0.135, 0.135, 0.014, 20),
    oculusGlassMat
  );
  oculusGlass.name = `quatrefoil_stained_glass_${i + 1}`;
  oculusGlass.rotation.x = Math.PI / 2;
  oculusGlass.position.set(qx, qy, 0);
  roseWindowGroup.add(oculusGlass);

  // Trefoil spandrel ring at r = 0.96 between adjacent oculi
  const tx = Math.cos(angle) * 0.94;
  const ty = centerY + Math.sin(angle) * 0.94;
  const spandrelTrefoil = new THREE.Mesh(
    new THREE.TorusGeometry(0.052, 0.014, 10, 18),
    leadCameMat
  );
  spandrelTrefoil.name = `spandrel_trefoil_ring_${i + 1}`;
  spandrelTrefoil.position.set(tx, ty, 0.01);
  roseWindowGroup.add(spandrelTrefoil);
}

// Frame camera at ~2.2x bounding radius
camera.position.set(1.6, 1.45, 2.75);
camera.lookAt(0, 1.28, 0);
