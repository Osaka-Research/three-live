// Hands-Free Gaze-Dwell Surgical Anatomy Inspector (xr_05)
scene.background = new THREE.Color(0x06101e);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const surgicalKeyLight = new THREE.DirectionalLight(0xe0f2fe, 1.25);
surgicalKeyLight.name = "SurgicalOverheadLight";
surgicalKeyLight.position.set(1.8, 3.8, 2.5);
scene.add(surgicalKeyLight);

const rimLight = new THREE.PointLight(0x38bdf8, 1.1, 3.5);
rimLight.name = "HolographicRimLight";
rimLight.position.set(-1.2, 1.5, -1.0);
scene.add(rimLight);

// Materials
const boneMat = new THREE.MeshStandardMaterial({
  color: 0xf1f5f9,
  roughness: 0.35,
  metalness: 0.08
});
const cartilageMat = new THREE.MeshPhysicalMaterial({
  color: 0xbae6fd,
  transmission: 0.45,
  roughness: 0.25,
  transparent: true,
  opacity: 0.88
});
const tracheaMat = new THREE.MeshStandardMaterial({
  color: 0xfda4af,
  roughness: 0.45,
  metalness: 0.05
});
const holoRingMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.85,
  roughness: 0.2
});
const baseMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  metalness: 0.75,
  roughness: 0.28
});

// Surgical Floor Projector Pedestal (resting at y = 0)
const projectorBase = new THREE.Group();
projectorBase.name = "SurgicalProjectorPedestal";
projectorBase.userData.xr = { anchor: "Floor" };
scene.add(projectorBase);

const floorDisc = new THREE.Mesh(new THREE.CylinderGeometry(0.42, 0.48, 0.06, 32), baseMat);
floorDisc.name = "ProjectorFloorDisc";
floorDisc.position.y = 0.03;
projectorBase.add(floorDisc);

const emitterRing = new THREE.Mesh(new THREE.TorusGeometry(0.36, 0.012, 12, 32), holoRingMat);
emitterRing.name = "ProjectorEmitterRing";
emitterRing.rotation.x = Math.PI / 2;
emitterRing.position.y = 0.065;
projectorBase.add(emitterRing);

// Floating Hands-Free Head-Following Medical Inspection Rig
const inspectionRig = new THREE.Group();
inspectionRig.name = "MedicalInspectionRig";
inspectionRig.position.set(0, 1.05, 0);
inspectionRig.userData.xr = {
  follow: { mode: "head", distance: 1.4, stiffness: 5 },
  handles: { rotateAxis: "y", minScale: 0.75, maxScale: 1.75 },
  dimensions: { unit: "cm", axes: ["x", "y", "z"] }
};
inspectionRig.userData.state = {
  lazyFollow: true,
  holdToAskEnabled: true
};
scene.add(inspectionRig);

// Outer Gimbal Halo Ring
const gimbalRing = new THREE.Mesh(new THREE.TorusGeometry(0.46, 0.008, 12, 48), holoRingMat);
gimbalRing.name = "InspectionGimbalHalo";
gimbalRing.rotation.x = Math.PI / 2;
gimbalRing.position.y = -0.32;
inspectionRig.add(gimbalRing);

// Thoracic Spine & Sternum
const thoracicSpine = new THREE.Mesh(new THREE.CylinderGeometry(0.026, 0.03, 0.56, 16), boneMat);
thoracicSpine.name = "ThoracicVertebralColumn";
thoracicSpine.position.set(0, 0.02, -0.15);
inspectionRig.add(thoracicSpine);

const sternum = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.016, 0.34, 12), boneMat);
sternum.name = "SternumBreastbone";
sternum.position.set(0, 0.06, 0.16);
inspectionRig.add(sternum);

// 7 Pairs of Curved Thoracic Ribs (TorusGeometry arcs)
for (let r = 0; r < 7; r++) {
  const yOffset = 0.22 - r * 0.068;
  const ribRadius = 0.175 + Math.sin((r / 6) * Math.PI) * 0.065;

  [-1, 1].forEach((side) => {
    const ribArc = new THREE.Mesh(
      new THREE.TorusGeometry(ribRadius, 0.011, 10, 24, Math.PI * 0.86),
       r < 5 ? boneMat : cartilageMat
    );
    ribArc.name = `RibCageArc_${side < 0 ? "Right" : "Left"}_${r + 1}`;
    ribArc.rotation.x = Math.PI / 2 + 0.18;
    ribArc.rotation.z = side < 0 ? -Math.PI * 0.42 : Math.PI * 0.58;
    ribArc.position.set(side * 0.04, yOffset, 0.0);
    inspectionRig.add(ribArc);
  });
}

// Trachea & Bifurcated Main Bronchi
const trachea = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.022, 0.24, 16), tracheaMat);
trachea.name = "TracheaWindpipe";
trachea.position.set(0, 0.29, -0.02);
inspectionRig.add(trachea);

for (let c = 0; c < 6; c++) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.023, 0.003, 8, 16), cartilageMat);
  ring.name = `TrachealCartilageRing_${c + 1}`;
  ring.rotation.x = Math.PI / 2;
  ring.position.set(0, 0.20 + c * 0.032, -0.02);
  inspectionRig.add(ring);
}

// 5 Gaze-Dwell Interactive Pulmonary Lung Lobes (3 Right, 2 Left)
const lobeSpecs = [
  {
    name: "RightSuperiorLobe",
    pos: [-0.115, 0.13, 0.01],
    scale: [0.85, 1.15, 0.95],
    radius: 0.095,
    color: 0xfb7185,
    explodeDir: [-1, 0.6, 0.2],
    prompt: "Inspect Right Superior Pulmonary Lobe apical and anterior segments"
  },
  {
    name: "RightMiddleLobe",
    pos: [-0.125, 0.01, 0.035],
    scale: [0.88, 0.78, 0.92],
    radius: 0.088,
    color: 0xf43f5e,
    explodeDir: [-1, 0.0, 0.5],
    prompt: "Inspect Right Middle Pulmonary Lobe lateral and medial bronchopulmonary segments"
  },
  {
    name: "RightInferiorLobe",
    pos: [-0.12, -0.11, -0.015],
    scale: [0.95, 1.12, 1.0],
    radius: 0.102,
    color: 0xe11d48,
    explodeDir: [-1, -0.6, -0.2],
    prompt: "Inspect Right Inferior Pulmonary Lobe basal perfusion and ventilation"
  },
  {
    name: "LeftSuperiorLobe",
    pos: [0.115, 0.10, 0.015],
    scale: [0.86, 1.25, 0.96],
    radius: 0.10,
    color: 0xfb7185,
    explodeDir: [1, 0.5, 0.2],
    prompt: "Inspect Left Superior Pulmonary Lobe and cardiac notch clearance"
  },
  {
    name: "LeftInferiorLobe",
    pos: [0.12, -0.09, -0.01],
    scale: [0.92, 1.18, 0.98],
    radius: 0.102,
    color: 0xe11d48,
    explodeDir: [1, -0.5, -0.2],
    prompt: "Inspect Left Inferior Pulmonary Lobe oblique fissure and diaphragmatic surface"
  }
];

lobeSpecs.forEach((spec) => {
  const lobeMat = new THREE.MeshPhysicalMaterial({
    color: spec.color,
    roughness: 0.35,
    metalness: 0.05,
    clearcoat: 0.4,
    clearcoatRoughness: 0.25,
    transmission: 0.2,
    transparent: true,
    opacity: 0.92
  });

  const lobeMesh = new THREE.Mesh(new THREE.SphereGeometry(spec.radius, 24, 20), lobeMat);
  lobeMesh.name = spec.name;
  lobeMesh.position.set(spec.pos[0], spec.pos[1], spec.pos[2]);
  lobeMesh.scale.set(spec.scale[0], spec.scale[1], spec.scale[2]);
  lobeMesh.userData.xr = {
    gaze: { dwellMs: 1000, action: "select" },
    outline: { color: "#38bdf8", thickness: 0.016 },
    explode: { distance: 0.09, direction: spec.explodeDir }
  };
  lobeMesh.userData.state = {
    holdToAsk: spec.prompt
  };
  lobeMesh.userData.interactivity = {
    onSelect: [
      {
        action: "toggleTransform",
        target: spec.name,
        property: "scale",
        to: [spec.scale[0] * 1.14, spec.scale[1] * 1.14, spec.scale[2] * 1.14],
        duration: 0.45
      }
    ]
  };
  inspectionRig.add(lobeMesh);
});

// Floating Gaze-Dwell Hold-to-Ask Voice Prompt Banner
const promptBanner = new THREE.Mesh(
  new THREE.BoxGeometry(0.48, 0.09, 0.012),
  holoRingMat
);
promptBanner.name = "HoldToAskPromptBanner";
promptBanner.position.set(0, 0.44, 0);
promptBanner.userData.xr = {
  billboard: "y",
  gaze: { dwellMs: 1000, action: "select" }
};
inspectionRig.add(promptBanner);

function animate(t) {
  const breath = 1.0 + Math.sin(t * 2.2) * 0.035;
  inspectionRig.scale.set(breath, breath, breath);
  gimbalRing.rotation.z = t * 0.6;
}

camera.position.set(1.35, 1.38, 1.75);
camera.lookAt(0, 0.82, 0);
