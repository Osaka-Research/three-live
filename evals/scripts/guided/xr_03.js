// AR Living Room Furniture Configurator with Surface Anchors (xr_03)
scene.background = new THREE.Color(0x1e293b);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const sunLight = new THREE.DirectionalLight(0xfff7ed, 0.9);
sunLight.name = "WindowSunLight";
sunLight.position.set(3.5, 4.5, 2.5);
scene.add(sunLight);

const warmLampPointLight = new THREE.PointLight(0xffedd5, 1.6, 4.5);
warmLampPointLight.name = "FloorLampWarmPointLight";
warmLampPointLight.position.set(1.25, 1.52, -0.75);
scene.add(warmLampPointLight);

// Materials
const floorWoodMat = new THREE.MeshStandardMaterial({ color: 0x78350f, roughness: 0.65, metalness: 0.05 });
const wallMat = new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.85, metalness: 0.02 });
const rugMat = new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.92, metalness: 0.0 });
const rugBorderMat = new THREE.MeshStandardMaterial({ color: 0x475569, roughness: 0.9, metalness: 0.0 });
const sofaFabricMat = new THREE.MeshPhysicalMaterial({
  color: 0x0f766e,
  roughness: 0.78,
  sheen: 0.85,
  sheenRoughness: 0.5,
  sheenColor: new THREE.Color(0x5eead4)
});
const cushionAccentMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, roughness: 0.7 });
const walnutMat = new THREE.MeshStandardMaterial({ color: 0x451a03, roughness: 0.4, metalness: 0.1 });
const brassMat = new THREE.MeshStandardMaterial({ color: 0xd97706, metalness: 0.88, roughness: 0.2 });
const lampShadeMat = new THREE.MeshStandardMaterial({
  color: 0xfef3c7,
  emissive: 0xfbbf24,
  emissiveIntensity: 0.75,
  roughness: 0.4
});

// Room Reference Floor & Accent Wall (lowest surface at y = 0)
const roomFloor = new THREE.Mesh(new THREE.BoxGeometry(3.6, 0.04, 3.0), floorWoodMat);
roomFloor.name = "LivingRoomFloor";
roomFloor.position.set(0, 0.02, 0);
roomFloor.userData.xr = {
  anchor: "Floor",
  navigable: true,
  physics: { body: "static", collider: "box", mass: 0, restitution: 0.1, friction: 0.8 }
};
scene.add(roomFloor);

const accentWall = new THREE.Mesh(new THREE.BoxGeometry(3.6, 2.2, 0.08), wallMat);
accentWall.name = "LivingRoomAccentWall";
accentWall.position.set(0, 1.12, -1.46);
accentWall.userData.xr = { anchor: "Wall" };
scene.add(accentWall);

// 1. Woven Area Rug (snaps to floor with Y-rotation handles)
const areaRug = new THREE.Group();
areaRug.name = "WovenAreaRug";
areaRug.position.set(-0.15, 0.04, 0.1);
areaRug.userData.xr = {
  anchor: "Floor",
  handles: { rotateAxis: "y", minScale: 0.75, maxScale: 1.4 }
};
scene.add(areaRug);

const rugCenter = new THREE.Mesh(new THREE.BoxGeometry(2.2, 0.015, 1.6), rugMat);
rugCenter.name = "RugInnerWeave";
rugCenter.position.y = 0.008;
areaRug.add(rugCenter);

const rugFrame = new THREE.Mesh(new THREE.BoxGeometry(2.32, 0.01, 1.72), rugBorderMat);
rugFrame.name = "RugBorderTrim";
rugFrame.position.y = 0.005;
areaRug.add(rugFrame);

// 2. Modern L-Shaped Sectional Sofa (snaps to floor with handles & 2-hand grab)
const sectionalSofa = new THREE.Group();
sectionalSofa.name = "ModernLSectionalSofa";
sectionalSofa.position.set(-0.25, 0.055, -0.35);
sectionalSofa.userData.xr = {
  anchor: "Floor",
  grab: "2-hand",
  handles: { rotateAxis: "y", minScale: 0.8, maxScale: 1.25 },
  dimensions: { unit: "m", axes: ["x", "y", "z"] }
};
scene.add(sectionalSofa);

// Sofa Base Frame & Tapered Legs
const mainDeck = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.14, 0.82), walnutMat);
mainDeck.name = "SofaMainPlinth";
mainDeck.position.set(0, 0.19, 0);
sectionalSofa.add(mainDeck);

const chaiseDeck = new THREE.Mesh(new THREE.BoxGeometry(0.76, 0.14, 0.72), walnutMat);
chaiseDeck.name = "SofaChaisePlinth";
chaiseDeck.position.set(-0.57, 0.19, 0.77);
sectionalSofa.add(chaiseDeck);

const legCoords = [
  [-0.88, 0.06, -0.35],
  [0.88, 0.06, -0.35],
  [0.88, 0.06, 0.35],
  [-0.22, 0.06, 1.08],
  [-0.88, 0.06, 1.08]
];
legCoords.forEach((pt, idx) => {
  const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.015, 0.12, 12), walnutMat);
  leg.name = `SofaTaperedLeg_${idx + 1}`;
  leg.position.set(pt[0], pt[1], pt[2]);
  sectionalSofa.add(leg);
});

// Cushions, Backrest & Armrests
const chaiseSeat = new THREE.Mesh(new THREE.BoxGeometry(0.74, 0.16, 1.48), sofaFabricMat);
chaiseSeat.name = "ChaiseLoungeCushion";
chaiseSeat.position.set(-0.57, 0.34, 0.36);
sectionalSofa.add(chaiseSeat);

const midSeat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.76), sofaFabricMat);
midSeat.name = "CenterSeatCushion";
midSeat.position.set(0.09, 0.34, 0.0);
sectionalSofa.add(midSeat);

const rightSeat = new THREE.Mesh(new THREE.BoxGeometry(0.56, 0.16, 0.76), sofaFabricMat);
rightSeat.name = "RightSeatCushion";
rightSeat.position.set(0.66, 0.34, 0.0);
sectionalSofa.add(rightSeat);

const backrest = new THREE.Mesh(new THREE.BoxGeometry(1.9, 0.44, 0.16), sofaFabricMat);
backrest.name = "SofaBackrest";
backrest.position.set(0, 0.56, -0.33);
sectionalSofa.add(backrest);

const leftArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 1.52), sofaFabricMat);
leftArm.name = "SofaLeftArmrest";
leftArm.position.set(-0.98, 0.43, 0.35);
sectionalSofa.add(leftArm);

const rightArm = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.34, 0.82), sofaFabricMat);
rightArm.name = "SofaRightArmrest";
rightArm.position.set(0.98, 0.43, 0.0);
sectionalSofa.add(rightArm);

// Accent Throw Pillows
const throwPillow1 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), cushionAccentMat);
throwPillow1.name = "AccentThrowPillow_1";
throwPillow1.scale.set(1.1, 1.0, 0.45);
throwPillow1.position.set(-0.65, 0.52, -0.18);
sectionalSofa.add(throwPillow1);

const throwPillow2 = new THREE.Mesh(new THREE.SphereGeometry(0.14, 16, 12), cushionAccentMat);
throwPillow2.name = "AccentThrowPillow_2";
throwPillow2.scale.set(1.1, 1.0, 0.45);
throwPillow2.position.set(0.72, 0.52, -0.18);
sectionalSofa.add(throwPillow2);

// 3. Framed Abstract Painting (anchors to Wall)
const framedPainting = new THREE.Group();
framedPainting.name = "FramedAbstractPainting";
framedPainting.position.set(-0.15, 1.42, -1.39);
framedPainting.userData.xr = {
  anchor: "Wall",
  grab: "1-hand",
  outline: { color: "#f59e0b", thickness: 0.015 }
};
scene.add(framedPainting);

const outerFrame = new THREE.Mesh(new THREE.BoxGeometry(1.15, 0.78, 0.04), walnutMat);
outerFrame.name = "PaintingWoodFrame";
framedPainting.add(outerFrame);

const canvasBacking = new THREE.Mesh(
  new THREE.BoxGeometry(1.06, 0.69, 0.045),
  new THREE.MeshStandardMaterial({ color: 0xf8fafc, roughness: 0.8 })
);
canvasBacking.name = "PaintingCanvasMatte";
framedPainting.add(canvasBacking);

const geoSunDisc = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.18, 0.052, 24),
  new THREE.MeshStandardMaterial({ color: 0xea580c, roughness: 0.4 })
);
geoSunDisc.name = "PaintingAbstractSun";
geoSunDisc.rotation.x = Math.PI / 2;
geoSunDisc.position.set(-0.18, 0.06, 0.002);
framedPainting.add(geoSunDisc);

const geoArchBlock = new THREE.Mesh(
  new THREE.BoxGeometry(0.38, 0.42, 0.052),
  new THREE.MeshStandardMaterial({ color: 0x0284c7, roughness: 0.5 })
);
geoArchBlock.name = "PaintingAbstractBlock";
geoArchBlock.position.set(0.2, -0.05, 0.002);
framedPainting.add(geoArchBlock);

// 4. Interactive Floor Lamp (toggles warm lighting on select)
const floorLamp = new THREE.Group();
floorLamp.name = "InteractiveFloorLamp";
floorLamp.position.set(1.25, 0.04, -0.75);
floorLamp.userData.xr = {
  anchor: "Floor",
  grab: "1-hand",
  handles: { rotateAxis: "y", minScale: 0.85, maxScale: 1.2 },
  bloom: { strength: 0.65 }
};
floorLamp.userData.interactivity = {
  onSelect: [
    { action: "cycleMaterialColor", target: "FloorLampShade", duration: 0.4 },
    { action: "toggleTransform", target: "LampBulbSphere", property: "scale", to: [1.3, 1.3, 1.3], duration: 0.35 }
  ]
};
scene.add(floorLamp);

const lampBase = new THREE.Mesh(new THREE.CylinderGeometry(0.19, 0.21, 0.035, 24), brassMat);
lampBase.name = "FloorLampWeightedBase";
lampBase.position.y = 0.018;
floorLamp.add(lampBase);

const lampStem = new THREE.Mesh(new THREE.CylinderGeometry(0.018, 0.022, 1.38, 16), brassMat);
lampStem.name = "FloorLampBrassColumn";
lampStem.position.y = 0.71;
floorLamp.add(lampStem);

const lampShade = new THREE.Mesh(new THREE.CylinderGeometry(0.17, 0.25, 0.32, 24, 1, true), lampShadeMat);
lampShade.name = "FloorLampShade";
lampShade.position.y = 1.42;
floorLamp.add(lampShade);

const lampBulb = new THREE.Mesh(
  new THREE.SphereGeometry(0.055, 16, 16),
  new THREE.MeshStandardMaterial({ color: 0xffffff, emissive: 0xfef08a, emissiveIntensity: 1.8 })
);
lampBulb.name = "LampBulbSphere";
lampBulb.position.y = 1.38;
floorLamp.add(lampBulb);

camera.position.set(2.9, 2.15, 3.35);
camera.lookAt(0, 0.75, -0.2);
