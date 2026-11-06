const valve = new THREE.Group();

// Materials
const ironMat = new THREE.MeshStandardMaterial({ color: 0x2e353b, roughness: 0.75, metalness: 0.35 });
const stemMat = new THREE.MeshStandardMaterial({ color: 0x95a5a6, roughness: 0.3, metalness: 0.9 });
const redMat = new THREE.MeshStandardMaterial({ color: 0xcc2914, roughness: 0.4, metalness: 0.2 });

// T-Shaped Valve Body (Horizontal Pipe & Vertical Bonnet Neck)
const pipeGeo = new THREE.CylinderGeometry(0.06, 0.06, 0.34, 24);
const pipe = new THREE.Mesh(pipeGeo, ironMat);
pipe.rotation.z = Math.PI / 2;
valve.add(pipe);

const centerBodyGeo = new THREE.CylinderGeometry(0.075, 0.075, 0.12, 24);
const centerBody = new THREE.Mesh(centerBodyGeo, ironMat);
valve.add(centerBody);

const bonnetGeo = new THREE.CylinderGeometry(0.05, 0.065, 0.14, 20);
const bonnet = new THREE.Mesh(bonnetGeo, ironMat);
bonnet.position.y = 0.11;
valve.add(bonnet);

const stemGeo = new THREE.CylinderGeometry(0.012, 0.012, 0.18, 16);
const stem = new THREE.Mesh(stemGeo, stemMat);
stem.position.y = 0.22;
valve.add(stem);

// CSG Bolted Flanges: 2D Shape with Circular Cutout Holes extruded into 3D Flange Plates
function createFlange(isZAxis = false) {
  const flangeGroup = new THREE.Group();
  const shape = new THREE.Shape();
  shape.absarc(0, 0, 0.095, 0, Math.PI * 2, false);

  // CSG boolean hole cutouts for inner bore and 6 bolt holes
  const bore = new THREE.Path();
  bore.absarc(0, 0, 0.055, 0, Math.PI * 2, true);
  shape.holes.push(bore);

  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI * 2) / 6;
    const hole = new THREE.Path();
    hole.absarc(Math.cos(angle) * 0.078, Math.sin(angle) * 0.078, 0.007, 0, Math.PI * 2, true);
    shape.holes.push(hole);
  }

  const flangePlateGeo = new THREE.ExtrudeGeometry(shape, { depth: 0.02, bevelEnabled: false, curveSegments: 24 });
  const flangeMesh = new THREE.Mesh(flangePlateGeo, ironMat);
  flangeMesh.position.z = -0.01;
  flangeGroup.add(flangeMesh);

  // Bolt Studs
  const boltGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.028, 6);
  for (let i = 0; i < 6; i++) {
    const angle = (i * Math.PI * 2) / 6;
    const bolt = new THREE.Mesh(boltGeo, stemMat);
    bolt.rotation.x = Math.PI / 2;
    bolt.position.set(Math.cos(angle) * 0.078, Math.sin(angle) * 0.078, 0.004);
    flangeGroup.add(bolt);
  }
  return flangeGroup;
}

const flangeLeft = createFlange();
flangeLeft.rotation.y = Math.PI / 2;
flangeLeft.position.x = -0.17;
valve.add(flangeLeft);

const flangeRight = createFlange();
flangeRight.rotation.y = -Math.PI / 2;
flangeRight.position.x = 0.17;
valve.add(flangeRight);

// Red Spoked Handwheel on Top
const handwheelGroup = new THREE.Group();
const rimGeo = new THREE.TorusGeometry(0.08, 0.012, 16, 32);
const rim = new THREE.Mesh(rimGeo, redMat);
rim.rotation.x = Math.PI / 2;
handwheelGroup.add(rim);

const hubGeo = new THREE.CylinderGeometry(0.022, 0.022, 0.025, 16);
const hub = new THREE.Mesh(hubGeo, ironMat);
handwheelGroup.add(hub);

const spokeGeo = new THREE.CylinderGeometry(0.006, 0.006, 0.072, 12);
for (let i = 0; i < 4; i++) {
  const spoke = new THREE.Mesh(spokeGeo, redMat);
  spoke.rotation.y = (i * Math.PI) / 4;
  spoke.rotation.z = Math.PI / 2;
  handwheelGroup.add(spoke);
}
handwheelGroup.position.y = 0.30;
valve.add(handwheelGroup);

// Placement & Lighting
valve.position.set(0, 0.8, 0);
scene.add(valve);

const ambLight = new THREE.AmbientLight(0xffffff, 0.6);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.4);
dirLight.position.set(2, 3, 2);
scene.add(ambLight, dirLight);
