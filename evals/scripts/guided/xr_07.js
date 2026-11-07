// Spatial 3D Audio Soundstage & Synthesizer Console (xr_07)
scene.background = new THREE.Color(0x070a14);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const studioDirLight = new THREE.DirectionalLight(0xe0e7ff, 1.0);
studioDirLight.name = "StudioKeyLight";
studioDirLight.position.set(2.0, 4.0, 2.5);
scene.add(studioDirLight);

const consoleGlowLight = new THREE.PointLight(0x818cf8, 1.5, 4.0);
consoleGlowLight.name = "SynthesizerConsolePointLight";
consoleGlowLight.position.set(0, 1.25, 0);
scene.add(consoleGlowLight);

// Materials
const acousticFloorMat = new THREE.MeshStandardMaterial({ color: 0x111827, roughness: 0.75, metalness: 0.15 });
const chassisMat = new THREE.MeshStandardMaterial({ color: 0x1f2937, metalness: 0.78, roughness: 0.28 });
const brushedMetalMat = new THREE.MeshStandardMaterial({ color: 0x9ca3af, metalness: 0.9, roughness: 0.2 });
const faderCapMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.85
});

// Soundstage Acoustic Floor Platform & Central Reference Hub (at y = 0)
const stagePlatform = new THREE.Mesh(new THREE.CylinderGeometry(1.75, 1.85, 0.06, 48), acousticFloorMat);
stagePlatform.name = "SoundstageAcousticPlatform";
stagePlatform.position.set(0, 0.03, 0);
stagePlatform.userData.xr = {
  anchor: "Floor",
  navigable: true
};
scene.add(stagePlatform);

// Central Listener Reference Hub (target for orbiting sound orbs)
const centerHub = new THREE.Group();
centerHub.name = "SoundstageCenterHub";
centerHub.position.set(0, 0.06, 0);
scene.add(centerHub);

const hubRing = new THREE.Mesh(
  new THREE.CylinderGeometry(0.32, 0.36, 0.03, 32),
  new THREE.MeshStandardMaterial({ color: 0x4f46e5, emissive: 0x3730a3, emissiveIntensity: 0.7 })
);
hubRing.name = "ListenerSweetSpotDisc";
hubRing.position.y = 0.015;
centerHub.add(hubRing);

// Semi-Circular Spatial Audio Synthesizer Mixing Deck
const mixerConsole = new THREE.Group();
mixerConsole.name = "SynthesizerMixingConsole";
mixerConsole.position.set(0, 0.06, 0);
mixerConsole.userData.xr = {
  anchor: "Floor",
  handles: { rotateAxis: "y", minScale: 0.8, maxScale: 1.3 }
};
scene.add(mixerConsole);

const consoleRadius = 0.92;
const segmentCount = 7;
for (let i = 0; i < segmentCount; i++) {
  const angle = Math.PI * 0.8 + (i / (segmentCount - 1)) * Math.PI * 0.85;
  const segX = Math.cos(angle) * consoleRadius;
  const segZ = Math.sin(angle) * consoleRadius;

  const bayGroup = new THREE.Group();
  bayGroup.name = `MixerChannelBay_${i + 1}`;
  bayGroup.position.set(segX, 0, segZ);
  bayGroup.rotation.y = -angle + Math.PI / 2;

  const pedestalLeg = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.055, 0.76, 12), chassisMat);
  pedestalLeg.name = `MixerBayPedestal_${i + 1}`;
  pedestalLeg.position.y = 0.38;
  bayGroup.add(pedestalLeg);

  const deskUnit = new THREE.Mesh(new THREE.BoxGeometry(0.38, 0.12, 0.34), chassisMat);
  deskUnit.name = `MixerBayDesk_${i + 1}`;
  deskUnit.position.y = 0.80;
  deskUnit.rotation.x = 0.28;
  bayGroup.add(deskUnit);

  // Motorized Faders & Rotary Encoder Knobs on each Bay
  [-0.1, 0.0, 0.1].forEach((xOffset, fIdx) => {
    const faderCap = new THREE.Mesh(new THREE.BoxGeometry(0.032, 0.024, 0.045), faderCapMat);
    faderCap.name = `MixerFaderCap_${i + 1}_${fIdx + 1}`;
    faderCap.position.set(xOffset, 0.87, 0.04 - (fIdx % 2) * 0.05);
    faderCap.rotation.x = 0.28;
    bayGroup.add(faderCap);

    const encoderKnob = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.02, 0.025, 16), brushedMetalMat);
    encoderKnob.name = `MixerRotaryKnob_${i + 1}_${fIdx + 1}`;
    encoderKnob.position.set(xOffset, 0.90, -0.09);
    encoderKnob.rotation.x = 0.28;
    bayGroup.add(encoderKnob);
  });

  mixerConsole.add(bayGroup);
}

// 4 Glowing Directional Sound Orbs Orbiting the User
const orbConfigs = [
  {
    name: "SoundOrb_Hum",
    preset: "hum",
    src: "hum.ogg",
    color: 0x38bdf8,
    angle: 0.0,
    radius: 1.18,
    height: 1.25,
    speed: 0.65
  },
  {
    name: "SoundOrb_Reactor",
    preset: "reactor",
    src: "reactor.ogg",
    color: 0xf43f5e,
    angle: Math.PI * 0.5,
    radius: 1.28,
    height: 1.42,
    speed: 0.85
  },
  {
    name: "SoundOrb_Wind",
    preset: "wind",
    src: "wind.ogg",
    color: 0x34d399,
    angle: Math.PI,
    radius: 1.15,
    height: 1.18,
    speed: 0.55
  },
  {
    name: "SoundOrb_ChimeLoop",
    preset: "chimeLoop",
    src: "chimeLoop.ogg",
    color: 0xc084fc,
    angle: Math.PI * 1.5,
    radius: 1.32,
    height: 1.36,
    speed: 0.95
  }
];

const orbNodes = [];
orbConfigs.forEach((cfg, idx) => {
  const orbGroup = new THREE.Group();
  orbGroup.name = cfg.name;
  orbGroup.position.set(
    Math.cos(cfg.angle) * cfg.radius,
    cfg.height,
    Math.sin(cfg.angle) * cfg.radius
  );
  orbGroup.userData.xr = {
    grab: "1-hand",
    orbit: {
      target: "SoundstageCenterHub",
      radius: cfg.radius,
      speed: cfg.speed,
      height: cfg.height
    },
    audioEmitter: {
      src: cfg.src,
      refDistance: 1.2,
      loop: true
    },
    bloom: { strength: 0.95 },
    outline: { color: "#38bdf8", thickness: 0.014 }
  };
  orbGroup.userData.state = {
    preset: cfg.preset,
    coneInnerAngle: 60,
    coneOuterAngle: 120
  };

  const orbCoreMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: 1.4,
    roughness: 0.15,
    metalness: 0.2
  });
  const orbCore = new THREE.Mesh(new THREE.SphereGeometry(0.105, 24, 24), orbCoreMat);
  orbCore.name = `${cfg.name}_CoreSphere`;
  orbGroup.add(orbCore);

  // Directional Audio Projection Horn Nozzle
  const coneHornMat = new THREE.MeshStandardMaterial({
    color: cfg.color,
    emissive: cfg.color,
    emissiveIntensity: 0.5,
    transparent: true,
    opacity: 0.45,
    roughness: 0.2
  });
  const directionalHorn = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.14, 0.18, 20, 1, true),
    coneHornMat
  );
  directionalHorn.name = `${cfg.name}_DirectionalCone`;
  directionalHorn.rotation.x = Math.PI / 2;
  directionalHorn.position.z = 0.14;
  orbGroup.add(directionalHorn);

  const orbPointLight = new THREE.PointLight(cfg.color, 0.85, 2.2);
  orbPointLight.name = `${cfg.name}_PointLight`;
  orbGroup.add(orbPointLight);

  scene.add(orbGroup);
  orbNodes.push({ group: orbGroup, cfg });
});

function animate(t) {
  orbNodes.forEach(({ group, cfg }) => {
    const theta = cfg.angle + t * cfg.speed;
    group.position.x = Math.cos(theta) * cfg.radius;
    group.position.z = Math.sin(theta) * cfg.radius;
    group.position.y = cfg.height + Math.sin(t * 2.4 + cfg.angle) * 0.06;
    group.lookAt(0, 1.2, 0);
  });
}

camera.position.set(2.45, 2.15, 2.75);
camera.lookAt(0, 0.85, 0);
