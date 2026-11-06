const loungeSet = new THREE.Group();

// Materials
const walnutMat = new THREE.MeshStandardMaterial({ color: 0x543219, roughness: 0.35, metalness: 0.1 });
const leatherMat = new THREE.MeshStandardMaterial({ color: 0x181818, roughness: 0.6, metalness: 0.05 });
const aluMat = new THREE.MeshStandardMaterial({ color: 0xcccccc, metalness: 0.9, roughness: 0.25 });

// Helper: 5-Star Cast Aluminum Swivel Base
function create5StarBase(numLegs = 5, legLength = 0.32) {
  const base = new THREE.Group();
  const column = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.22, 16), aluMat);
  column.position.y = 0.11;
  base.add(column);

  for (let i = 0; i < numLegs; i++) {
    const angle = (i * Math.PI * 2) / numLegs;
    const leg = new THREE.Mesh(new THREE.BoxGeometry(0.025, 0.02, legLength), aluMat);
    leg.position.set(Math.sin(angle) * (legLength * 0.45), 0.04, Math.cos(angle) * (legLength * 0.45));
    leg.rotation.y = angle;
    base.add(leg);
  }
  return base;
}

// Helper: Curved Molded Plywood Shell (Extruded Profile)
function createCurvedShell(w, d, curvature) {
  const shape = new THREE.Shape();
  shape.moveTo(-w / 2, -d / 2);
  shape.quadraticCurveTo(0, -d / 2 + curvature, w / 2, -d / 2);
  shape.lineTo(w / 2, d / 2);
  shape.quadraticCurveTo(0, d / 2 + curvature, -w / 2, d / 2);
  shape.closePath();
  return new THREE.Mesh(new THREE.ExtrudeGeometry(shape, { depth: 0.018, bevelEnabled: true, bevelThickness: 0.003, bevelSize: 0.003 }), walnutMat);
}

// Helper: Tufted Leather Cushion
function createCushion(w, h, d) {
  const cushion = new THREE.Mesh(new THREE.BoxGeometry(w, h, d), leatherMat);
  // Add tufting buttons
  const buttonGeo = new THREE.CylinderGeometry(0.008, 0.008, 0.004, 12);
  [-w * 0.25, w * 0.25].forEach(x => {
    [-d * 0.25, d * 0.25].forEach(z => {
      const btn = new THREE.Mesh(buttonGeo, leatherMat);
      btn.position.set(x, h / 2 + 0.002, z);
      cushion.add(btn);
    });
  });
  return cushion;
}

// Lounge Chair Assembly
const chair = new THREE.Group();
chair.add(create5StarBase(5, 0.35));

// Seat Section
const seatShell = createCurvedShell(0.55, 0.52, 0.04);
seatShell.rotation.x = Math.PI / 2 - 0.12;
seatShell.position.set(0, 0.36, -0.02);
chair.add(seatShell);

const seatCushion = createCushion(0.52, 0.09, 0.48);
seatCushion.rotation.x = -0.12;
seatCushion.position.set(0, 0.41, -0.02);
chair.add(seatCushion);

// Backrest Section
const backShell = createCurvedShell(0.52, 0.38, 0.035);
backShell.rotation.x = -0.32;
backShell.position.set(0, 0.62, -0.22);
chair.add(backShell);

const backCushion = createCushion(0.48, 0.34, 0.08);
backCushion.rotation.x = -0.32;
backCushion.position.set(0, 0.62, -0.18);
chair.add(backCushion);

// Headrest Section
const headShell = createCurvedShell(0.48, 0.26, 0.03);
headShell.rotation.x = -0.36;
headShell.position.set(0, 0.88, -0.31);
chair.add(headShell);

const headCushion = createCushion(0.44, 0.22, 0.08);
headCushion.rotation.x = -0.36;
headCushion.position.set(0, 0.88, -0.27);
chair.add(headCushion);

// Padded Armrests
[-0.29, 0.29].forEach(x => {
  const arm = new THREE.Mesh(new THREE.BoxGeometry(0.1, 0.04, 0.28), leatherMat);
  arm.position.set(x, 0.53, -0.02);
  arm.rotation.x = -0.1;
  chair.add(arm);
});

chair.position.set(-0.15, 0, 0.15);
chair.rotation.y = 0.2;
loungeSet.add(chair);

// Matching Ottoman Assembly
const ottoman = new THREE.Group();
ottoman.add(create5StarBase(4, 0.28));

const ottoShell = createCurvedShell(0.54, 0.44, 0.025);
ottoShell.rotation.x = Math.PI / 2;
ottoShell.position.set(0, 0.35, 0);
ottoman.add(ottoShell);

const ottoCushion = createCushion(0.50, 0.08, 0.40);
ottoCushion.position.set(0, 0.40, 0);
ottoman.add(ottoCushion);

ottoman.position.set(0.45, 0, 0.55);
ottoman.rotation.y = -0.15;
loungeSet.add(ottoman);

// Placement & Lighting
scene.add(loungeSet);

const ambLight = new THREE.AmbientLight(0xffffff, 0.7);
const dirLight = new THREE.DirectionalLight(0xfff3e0, 1.3);
dirLight.position.set(2.5, 4.0, 3.0);
scene.add(ambLight, dirLight);
