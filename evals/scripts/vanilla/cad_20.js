const excavator = new THREE.Group();
excavator.position.set(0, 0.35, 0);
scene.add(excavator);

const light = new THREE.DirectionalLight(0xfff5ea, 1.4);
light.position.set(3, 4, 2);
const amb = new THREE.AmbientLight(0xd5e1e8, 0.75);
scene.add(light, amb);

// Construction equipment materials
const yellowMat = new THREE.MeshStandardMaterial({ color: 0xebb205, roughness: 0.35, metalness: 0.2 });
const darkMetal = new THREE.MeshStandardMaterial({ color: 0x24272a, roughness: 0.7, metalness: 0.6 });
const chromeMat = new THREE.MeshStandardMaterial({ color: 0xf0f2f5, roughness: 0.1, metalness: 0.95 });
const cabGlass = new THREE.MeshStandardMaterial({ color: 0x112233, roughness: 0.1, metalness: 0.9, opacity: 0.75, transparent: true });

// Track undercarriage & crawler chassis (~1.8m length)
const trackBase = new THREE.Group();
for (let side = -1; side <= 1; side += 2) {
  const crawler = new THREE.Group();
  crawler.position.set(side * 0.42, -0.15, 0);
  const frame = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.22, 1.6), darkMetal);
  crawler.add(frame);
  for (let r = -0.7; r <= 0.7; r += 0.28) {
    const roller = new THREE.Mesh(new THREE.CylinderGeometry(0.11, 0.11, 0.2, 16), darkMetal);
    roller.rotation.z = Math.PI / 2;
    roller.position.set(0, 0, r);
    crawler.add(roller);
  }
  trackBase.add(crawler);
}
const centralChassis = new THREE.Mesh(new THREE.BoxGeometry(0.72, 0.16, 0.8), darkMetal);
centralChassis.position.y = -0.1;
trackBase.add(centralChassis);
excavator.add(trackBase);

// Rotating superstructure (cab and engine deck)
const superstructure = new THREE.Group();
superstructure.position.y = 0.08;
excavator.add(superstructure);

const slewingRing = new THREE.Mesh(new THREE.CylinderGeometry(0.32, 0.32, 0.06, 24), darkMetal);
superstructure.add(slewingRing);

// Operator cab with tinted glass windows
const cab = new THREE.Mesh(new THREE.BoxGeometry(0.34, 0.52, 0.56), yellowMat);
cab.position.set(-0.24, 0.32, 0.12);
const windowFront = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.32, 0.04), cabGlass);
windowFront.position.set(-0.24, 0.38, 0.4);
const windowSide = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.32, 0.44), cabGlass);
windowSide.position.set(-0.41, 0.38, 0.12);
superstructure.add(cab, windowFront, windowSide);

// Counterweight and engine compartment
const engineDeck = new THREE.Mesh(new THREE.BoxGeometry(0.78, 0.42, 0.72), yellowMat);
engineDeck.position.set(0.04, 0.27, -0.32);
const counterWeight = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.44, 0.28), darkMetal);
counterWeight.position.set(0.04, 0.27, -0.74);
superstructure.add(engineDeck, counterWeight);

// Three-segment articulated arm (Boom, Stick, Bucket)
const boomGroup = new THREE.Group();
boomGroup.position.set(0.12, 0.26, 0.32);
superstructure.add(boomGroup);

// Curved boom
const boom = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.95, 0.16), yellowMat);
boom.position.set(0, 0.42, 0.22);
boom.rotation.x = -0.65;
boomGroup.add(boom);

// Chrome boom hydraulic cylinder
const boomCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.024, 0.024, 0.45, 16), darkMetal);
boomCyl.rotation.x = -0.35;
boomCyl.position.set(0, 0.24, 0.06);
const boomPiston = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.35, 16), chromeMat);
boomPiston.position.set(0, 0.16, 0);
boomCyl.add(boomPiston);
boomGroup.add(boomCyl);

// Stick (Dipper arm)
const stickGroup = new THREE.Group();
stickGroup.position.set(0, 0.78, 0.52);
boomGroup.add(stickGroup);

const stick = new THREE.Mesh(new THREE.BoxGeometry(0.12, 0.65, 0.14), yellowMat);
stick.position.set(0, -0.25, 0.18);
stick.rotation.x = 0.85;
stickGroup.add(stick);

const stickCyl = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.35, 16), chromeMat);
stickCyl.position.set(0, 0.06, 0.12);
stickCyl.rotation.x = 0.5;
stickGroup.add(stickCyl);

// Toothed digging bucket
const bucketGroup = new THREE.Group();
bucketGroup.position.set(0, -0.52, 0.42);
stickGroup.add(bucketGroup);

const bucketShape = new THREE.Shape();
bucketShape.moveTo(-0.14, 0);
bucketShape.lineTo(0.18, 0);
bucketShape.lineTo(0.24, -0.22);
bucketShape.lineTo(-0.06, -0.28);
bucketShape.closePath();
const bucketGeo = new THREE.ExtrudeGeometry(bucketShape, { depth: 0.26, bevelEnabled: false });
bucketGeo.center();
const bucket = new THREE.Mesh(bucketGeo, darkMetal);
bucketGroup.add(bucket);

// Digging teeth
for (let t = -0.1; t <= 0.1; t += 0.05) {
  const tooth = new THREE.Mesh(new THREE.ConeGeometry(0.016, 0.07, 4), chromeMat);
  tooth.rotation.z = Math.PI;
  tooth.rotation.y = Math.PI / 4;
  tooth.position.set(t, -0.15, 0.15);
  bucketGroup.add(tooth);
}

function animate(dt) {
  const time = Date.now() * 0.0015;
  superstructure.rotation.y = Math.sin(time * 0.6) * 0.45;
  boomGroup.rotation.x = Math.sin(time) * 0.15;
  stickGroup.rotation.x = Math.cos(time) * 0.22;
  bucketGroup.rotation.x = Math.sin(time * 1.2) * 0.25;
}
