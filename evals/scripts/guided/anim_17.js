// anim_17: Interactive Submarine Control Console
const consoleRoot = new THREE.Group();
consoleRoot.name = "SubmarineControlConsole";
scene.add(consoleRoot);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const keyLight = new THREE.DirectionalLight(0xe2e8f0, 1.5);
keyLight.name = "ControlRoomKeyLight";
keyLight.position.set(2.0, 3.5, 3.0);
scene.add(keyLight);

const alarmLight = new THREE.PointLight(0xef4444, 1.6, 4.0);
alarmLight.name = "ConsoleWarningPointLight";
alarmLight.position.set(0.28, 1.05, 0.25);
scene.add(alarmLight);

// Materials
const hullSteelMat = new THREE.MeshStandardMaterial({
  color: 0x334155,
  roughness: 0.45,
  metalness: 0.78
});
const darkPanelMat = new THREE.MeshStandardMaterial({
  color: 0x1e293b,
  roughness: 0.5,
  metalness: 0.65
});
const brassRimMat = new THREE.MeshStandardMaterial({
  color: 0xd4af37,
  roughness: 0.24,
  metalness: 0.9
});
const dialFaceMat = new THREE.MeshStandardMaterial({
  color: 0xfef3c7,
  roughness: 0.35,
  metalness: 0.05
});
const chromeMat = new THREE.MeshStandardMaterial({
  color: 0xe2e8f0,
  roughness: 0.18,
  metalness: 0.94
});
const emergencyRedMat = new THREE.MeshStandardMaterial({
  color: 0xef4444,
  emissive: 0xb91c1c,
  emissiveIntensity: 0.65,
  roughness: 0.25,
  metalness: 0.2
});

// Steel Pedestal Cabinet grounded at y = 0
const baseFootprint = new THREE.Mesh(new THREE.BoxGeometry(1.18, 0.08, 0.72), darkPanelMat);
baseFootprint.name = "ConsoleFloorBase";
baseFootprint.position.set(0, 0.04, 0);
consoleRoot.add(baseFootprint);

const cabinetBody = new THREE.Mesh(new THREE.BoxGeometry(1.10, 0.72, 0.62), hullSteelMat);
cabinetBody.name = "ConsoleLowerCabinet";
cabinetBody.position.set(0, 0.44, 0);
consoleRoot.add(cabinetBody);

// Angled Control Deck Group (tilted 28 degrees toward the operator)
const controlDeck = new THREE.Group();
controlDeck.name = "AngledControlDeck";
controlDeck.position.set(0, 0.84, 0.02);
controlDeck.rotation.x = 0.48;
consoleRoot.add(controlDeck);

const slopedPanel = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.08, 0.58), darkPanelMat);
slopedPanel.name = "SlopedInstrumentPanel";
controlDeck.add(slopedPanel);

// Upper Instrument Hood & Backboard for 3 Analog Pressure Dials
const dialBackboard = new THREE.Mesh(new THREE.BoxGeometry(1.12, 0.28, 0.08), hullSteelMat);
dialBackboard.name = "UpperDialBackboard";
dialBackboard.position.set(0, 0.16, -0.25);
dialBackboard.rotation.x = -0.35;
controlDeck.add(dialBackboard);

// 3 Analog Pressure Dials with Rotating Needles
const dialNeedles = [];
const dialXOffsets = [-0.34, 0.0, 0.34];

for (let i = 0; i < 3; i++) {
  const dx = dialXOffsets[i];
  const dialGroup = new THREE.Group();
  dialGroup.name = `PressureDial_${i + 1}`;
  dialGroup.position.set(dx, 0.17, -0.20);
  dialGroup.rotation.x = -0.35;
  controlDeck.add(dialGroup);

  const bezel = new THREE.Mesh(new THREE.CylinderGeometry(0.115, 0.115, 0.03, 28), brassRimMat);
  bezel.name = `DialBrassBezel_${i + 1}`;
  bezel.rotation.x = Math.PI / 2;
  dialGroup.add(bezel);

  const face = new THREE.Mesh(new THREE.CylinderGeometry(0.098, 0.098, 0.034, 28), dialFaceMat);
  face.name = `DialFaceplate_${i + 1}`;
  face.rotation.x = Math.PI / 2;
  dialGroup.add(face);

  // Rotating Needle Pivot
  const needleName = `DialNeedle_${i + 1}`;
  const needlePivot = new THREE.Group();
  needlePivot.name = needleName;
  needlePivot.position.set(0, 0, 0.022);
  needlePivot.rotation.z = -0.6 + i * 0.45;
  dialGroup.add(needlePivot);

  const needleCap = new THREE.Mesh(new THREE.SphereGeometry(0.014, 12, 10), brassRimMat);
  needleCap.name = `DialNeedleCap_${i + 1}`;
  needlePivot.add(needleCap);

  const needlePointer = new THREE.Mesh(new THREE.BoxGeometry(0.008, 0.078, 0.006), emergencyRedMat);
  needlePointer.name = `DialNeedlePointer_${i + 1}`;
  needlePointer.position.set(0, 0.034, 0);
  needlePivot.add(needlePointer);

  // Wire onSelect interactivity to sweep needle
  dialGroup.userData.interactivity = {
    onSelect: [
      {
        action: "toggleTransform",
        target: needleName,
        property: "rotation",
        to: [0, 0, 1.15],
        duration: 0.6
      }
    ]
  };

  dialNeedles.push(needlePivot);
}

// 4 Metallic Toggle Switches on Left Half of Deck
const toggleSwitches = [];
for (let s = 0; s < 4; s++) {
  const sx = -0.42 + s * 0.14;
  const switchBase = new THREE.Mesh(new THREE.CylinderGeometry(0.022, 0.026, 0.02, 14), brassRimMat);
  switchBase.name = `ToggleSwitchCollar_${s + 1}`;
  switchBase.position.set(sx, 0.048, 0.08);
  controlDeck.add(switchBase);

  const switchPivotName = `ToggleSwitch_${s + 1}`;
  const switchPivot = new THREE.Group();
  switchPivot.name = switchPivotName;
  switchPivot.position.set(sx, 0.055, 0.08);
  switchPivot.rotation.x = s % 2 === 0 ? -0.45 : 0.45;
  controlDeck.add(switchPivot);

  const batStem = new THREE.Mesh(new THREE.CylinderGeometry(0.006, 0.009, 0.065, 10), chromeMat);
  batStem.name = `ToggleSwitchStem_${s + 1}`;
  batStem.position.set(0, 0.032, 0);
  switchPivot.add(batStem);

  const batTip = new THREE.Mesh(new THREE.SphereGeometry(0.012, 12, 10), chromeMat);
  batTip.name = `ToggleSwitchTip_${s + 1}`;
  batTip.position.set(0, 0.065, 0);
  switchPivot.add(batTip);

  switchPivot.userData.interactivity = {
    onSelect: [
      {
        action: "toggleTransform",
        target: switchPivotName,
        property: "rotation",
        to: [0.45, 0, 0],
        duration: 0.35
      },
      {
        action: "interpolate",
        target: `DialNeedle_${(s % 3) + 1}`,
        property: "rotation",
        to: [0, 0, 0.95],
        duration: 0.6
      }
    ]
  };

  toggleSwitches.push(switchPivot);
}

// Red Emergency Pushbutton with Yellow Safety Guard Collar
const buttonCollar = new THREE.Mesh(new THREE.CylinderGeometry(0.062, 0.068, 0.03, 24), brassRimMat);
buttonCollar.name = "EmergencyButtonCollar";
buttonCollar.position.set(0.14, 0.052, 0.08);
controlDeck.add(buttonCollar);

const emergencyButton = new THREE.Mesh(new THREE.CylinderGeometry(0.048, 0.048, 0.04, 24), emergencyRedMat);
emergencyButton.name = "EmergencyPushbutton";
emergencyButton.position.set(0.14, 0.072, 0.08);
controlDeck.add(emergencyButton);

emergencyButton.userData.interactivity = {
  onSelect: [
    {
      action: "toggleTransform",
      target: "EmergencyPushbutton",
      property: "translation",
      to: [0.14, 0.056, 0.08],
      duration: 0.25
    },
    {
      action: "interpolate",
      target: "DialNeedle_1",
      property: "rotation",
      to: [0, 0, 1.35],
      duration: 0.5
    },
    {
      action: "interpolate",
      target: "DialNeedle_2",
      property: "rotation",
      to: [0, 0, 1.35],
      duration: 0.5
    },
    {
      action: "interpolate",
      target: "DialNeedle_3",
      property: "rotation",
      to: [0, 0, 1.35],
      duration: 0.5
    }
  ]
};

// Ballast / Engine Throttle Lever on Right Side of Deck
const throttleHousing = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.05, 0.22), brassRimMat);
throttleHousing.name = "ThrottleQuadrantHousing";
throttleHousing.position.set(0.38, 0.055, 0.06);
controlDeck.add(throttleHousing);

const throttleLever = new THREE.Group();
throttleLever.name = "ThrottleLever";
throttleLever.position.set(0.38, 0.065, 0.06);
throttleLever.rotation.x = -0.35;
controlDeck.add(throttleLever);

const throttleShaft = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.014, 0.18, 12), chromeMat);
throttleShaft.name = "ThrottleShaftRod";
throttleShaft.position.set(0, 0.09, 0);
throttleLever.add(throttleShaft);

const throttleGrip = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.11, 16), emergencyRedMat);
throttleGrip.name = "ThrottleTBarGrip";
throttleGrip.rotation.z = Math.PI / 2;
throttleGrip.position.set(0, 0.18, 0);
throttleLever.add(throttleGrip);

throttleLever.userData.interactivity = {
  onSelect: [
    {
      action: "toggleTransform",
      target: "ThrottleLever",
      property: "rotation",
      to: [0.55, 0, 0],
      duration: 0.6
    },
    {
      action: "interpolate",
      target: "DialNeedle_3",
      property: "rotation",
      to: [0, 0, 1.2],
      duration: 0.6
    }
  ]
};

function animate(t) {
  for (let i = 0; i < dialNeedles.length; i++) {
    dialNeedles[i].rotation.z = Math.sin(t * 1.8 + i * 1.2) * 0.75;
  }
  throttleLever.rotation.x = Math.sin(t * 0.9) * 0.42;
}

// Scene bounds: width ~1.2m, height ~1.18m, depth ~0.72m -> radius ~0.85m around centerY = 0.58m
camera.position.set(0.0, 1.28, 1.75);
camera.lookAt(0, 0.62, 0);
