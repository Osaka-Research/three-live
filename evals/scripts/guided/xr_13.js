// Museum T-Rex Skeleton Exhibit with Teleport Waypoints (xr_13)
scene.background = new THREE.Color(0x18181b);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const skylight = new THREE.DirectionalLight(0xfef3c7, 1.25);
skylight.name = "MuseumAtriumSkylight";
skylight.position.set(2.5, 5.5, 3.0);
scene.add(skylight);

const exhibitSpot = new THREE.PointLight(0xfde68a, 1.4, 5.0);
exhibitSpot.name = "ExhibitWarmSpotlight";
exhibitSpot.position.set(0, 2.6, 0.5);
scene.add(exhibitSpot);

// Materials
const marbleFloorMat = new THREE.MeshStandardMaterial({ color: 0xd4d4d8, roughness: 0.3, metalness: 0.1 });
const podiumStoneMat = new THREE.MeshStandardMaterial({ color: 0x3f3f46, roughness: 0.6, metalness: 0.15 });
const fossilBoneMat = new THREE.MeshStandardMaterial({ color: 0xe7e5e4, roughness: 0.55, metalness: 0.08 });
const brassStanchionMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.88, roughness: 0.22 });
const velvetRopeMat = new THREE.MeshStandardMaterial({ color: 0x991b1b, roughness: 0.75 });
const audioKioskMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.6, roughness: 0.35 });
const screenGlowMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.85
});

// Walkable Natural History Museum Hall Floor (at y = 0)
const museumFloor = new THREE.Mesh(new THREE.BoxGeometry(4.8, 0.04, 4.0), marbleFloorMat);
museumFloor.name = "MuseumWalkableFloor";
museumFloor.position.set(0, 0.02, 0);
museumFloor.userData.xr = {
  navigable: true,
  anchor: "Floor",
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.85 }
};
scene.add(museumFloor);

// Central Display Podium
const exhibitPodium = new THREE.Mesh(new THREE.BoxGeometry(2.3, 0.22, 1.15), podiumStoneMat);
exhibitPodium.name = "TRexExhibitPodium";
exhibitPodium.position.set(0, 0.13, 0);
exhibitPodium.userData.xr = {
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.8 }
};
scene.add(exhibitPodium);

// Stylized Tyrannosaurus Rex Fossil Skeleton on Podium
const trexSkeleton = new THREE.Group();
trexSkeleton.name = "TRexFossilSkeleton";
trexSkeleton.position.set(0, 0.24, 0);
scene.add(trexSkeleton);

// Pelvis & Sacrum Hub
const pelvis = new THREE.Mesh(new THREE.SphereGeometry(0.15, 16, 12), fossilBoneMat);
pelvis.name = "TRexPelvisFossil";
pelvis.scale.set(1.3, 0.85, 0.85);
pelvis.position.set(-0.08, 0.92, 0);
trexSkeleton.add(pelvis);

// Articulated Vertebral Spine & Ribcage
for (let v = 0; v < 9; v++) {
  const frac = v / 8;
  const vx = -0.05 + frac * 0.68;
  const vy = 0.94 + Math.sin(frac * Math.PI) * 0.14 + frac * 0.18;
  const vertebra = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.075, 12), fossilBoneMat);
  vertebra.name = `TRexSpineVertebra_${v + 1}`;
  vertebra.rotation.z = Math.PI / 2 - 0.25;
  vertebra.position.set(vx, vy, 0);
  trexSkeleton.add(vertebra);

  if (v >= 2 && v <= 7) {
    const ribLen = 0.28 - Math.abs(v - 4.5) * 0.035;
    [-0.11, 0.11].forEach((zSide, sIdx) => {
      const rib = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.008, ribLen, 10), fossilBoneMat);
      rib.name = `TRexThoracicRib_${v}_${sIdx + 1}`;
      rib.position.set(vx, vy - ribLen * 0.45, zSide);
      rib.rotation.x = zSide < 0 ? 0.35 : -0.35;
      trexSkeleton.add(rib);
    });
  }
}

// Sculpted T-Rex Skull & Mandible Jaw
const skullGroup = new THREE.Group();
skullGroup.name = "TRexFossilSkull";
skullGroup.position.set(0.76, 1.22, 0);
skullGroup.rotation.z = -0.18;
trexSkeleton.add(skullGroup);

const cranium = new THREE.Mesh(new THREE.BoxGeometry(0.36, 0.16, 0.17), fossilBoneMat);
cranium.name = "TRexCraniumMaxilla";
skullGroup.add(cranium);

const lowerJaw = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.05, 0.14), fossilBoneMat);
lowerJaw.name = "TRexMandibleJaw";
lowerJaw.position.set(-0.01, -0.11, 0);
lowerJaw.rotation.z = -0.22;
skullGroup.add(lowerJaw);

// Sweeping Tail Vertebrae
for (let t = 0; t < 10; t++) {
  const frac = t / 9;
  const tx = -0.22 - frac * 0.85;
  const ty = 0.90 - Math.sin(frac * Math.PI * 0.7) * 0.16;
  const r = 0.042 * (1 - frac * 0.65);
  const tailBone = new THREE.Mesh(new THREE.CylinderGeometry(r, r * 0.85, 0.08, 10), fossilBoneMat);
  tailBone.name = `TRexTailVertebra_${t + 1}`;
  tailBone.rotation.z = Math.PI / 2;
  tailBone.position.set(tx, ty, 0);
  trexSkeleton.add(tailBone);
}

// Left & Right Hind Legs (Femur, Tibia, Foot Claws)
[-0.16, 0.16].forEach((zLeg, lIdx) => {
  const sideTag = lIdx === 0 ? "Right" : "Left";
  const femur = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.035, 0.46, 12), fossilBoneMat);
  femur.name = `TRexFemur_${sideTag}`;
  femur.position.set(-0.04, 0.68, zLeg);
  femur.rotation.z = 0.32;
  trexSkeleton.add(femur);

  const tibia = new THREE.Mesh(new THREE.CylinderGeometry(0.032, 0.024, 0.46, 12), fossilBoneMat);
  tibia.name = `TRexTibia_${sideTag}`;
  tibia.position.set(-0.08, 0.28, zLeg);
  tibia.rotation.z = -0.22;
  trexSkeleton.add(tibia);

  const foot = new THREE.Mesh(new THREE.BoxGeometry(0.22, 0.04, 0.10), fossilBoneMat);
  foot.name = `TRexFoot_${sideTag}`;
  foot.position.set(0.02, 0.02, zLeg);
  trexSkeleton.add(foot);
});

// Velvet Rope Perimeter Barriers (Blocked Navigation Boundary)
const barrierGroup = new THREE.Group();
barrierGroup.name = "VelvetRopeBarrierPerimeter";
barrierGroup.userData.xr = {
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.8 }
};
barrierGroup.userData.state = {
  navigable: "blocked"
};
scene.add(barrierGroup);

const postCoords = [
  [-1.35, -0.78], [0.0, -0.78], [1.35, -0.78],
  [1.35, 0.78], [0.0, 0.78], [-1.35, 0.78]
];

postCoords.forEach((pt, idx) => {
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.82, 14), brassStanchionMat);
  post.name = `BarrierStanchionPost_${idx + 1}`;
  post.position.set(pt[0], 0.43, pt[1]);
  barrierGroup.add(post);

  const finial = new THREE.Mesh(new THREE.SphereGeometry(0.036, 14, 14), brassStanchionMat);
  finial.name = `BarrierStanchionBall_${idx + 1}`;
  finial.position.set(pt[0], 0.86, pt[1]);
  barrierGroup.add(finial);

  const nextPt = postCoords[(idx + 1) % postCoords.length];
  const dx = nextPt[0] - pt[0];
  const dz = nextPt[1] - pt[1];
  const dist = Math.sqrt(dx * dx + dz * dz);
  const rope = new THREE.Mesh(new THREE.CylinderGeometry(0.016, 0.016, dist, 12), velvetRopeMat);
  rope.name = `VelvetBarrierRope_${idx + 1}`;
  rope.position.set((pt[0] + nextPt[0]) * 0.5, 0.72, (pt[1] + nextPt[1]) * 0.5);
  rope.rotation.z = Math.PI / 2;
  rope.rotation.y = -Math.atan2(dz, dx);
  barrierGroup.add(rope);
});

// 3 Spatial Audio Guide Pedestals with Gaze-Dwell Selection
const kioskSpecs = [
  { id: 1, pos: [-1.45, 0.04, 1.35], src: "cretaceous_predator.ogg" },
  { id: 2, pos: [0.0, 0.04, 1.48], src: "bite_force_biomechanics.ogg" },
  { id: 3, pos: [1.45, 0.04, 1.35], src: "hell_creek_excavation.ogg" }
];

kioskSpecs.forEach((spec) => {
  const kiosk = new THREE.Group();
  kiosk.name = `AudioGuidePedestal_${spec.id}`;
  kiosk.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  kiosk.userData.xr = {
    audioEmitter: { src: spec.src, refDistance: 1.5, loop: true },
    gaze: { dwellMs: 800, action: "select" },
    outline: { color: "#38bdf8", thickness: 0.014 }
  };

  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.09, 0.92, 16), audioKioskMat);
  column.name = `AudioPedestalColumn_${spec.id}`;
  column.position.y = 0.46;
  kiosk.add(column);

  const lecternPlaque = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.22, 0.03), screenGlowMat);
  lecternPlaque.name = `AudioPedestalScreen_${spec.id}`;
  lecternPlaque.position.set(0, 0.96, 0);
  lecternPlaque.rotation.x = -0.45;
  kiosk.add(lecternPlaque);

  scene.add(kiosk);
});

camera.position.set(2.65, 2.05, 3.25);
camera.lookAt(0, 0.75, 0);
