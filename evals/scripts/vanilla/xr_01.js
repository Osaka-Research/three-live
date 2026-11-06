const ambientLight = new THREE.AmbientLight(0xffffff, 0.7);
const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
dirLight.position.set(1.5, 3, 2);
scene.add(ambientLight, dirLight);

const workbench = new THREE.Group();
workbench.position.set(0, 0, 0);
workbench.userData.xr = { anchor: 'table', live: true };

// Workbench table surface
const tableGeo = new THREE.CylinderGeometry(0.7, 0.7, 0.05, 32);
const tableMat = new THREE.MeshStandardMaterial({ color: 0x2c3437, roughness: 0.4 });
const tableMesh = new THREE.Mesh(tableGeo, tableMat);
tableMesh.position.set(0, 0.75, 0);
workbench.add(tableMesh);

// Bunsen burner with snapSocket
const burnerGroup = new THREE.Group();
burnerGroup.position.set(0, 0.775, 0);
const burnerBase = new THREE.Mesh(new THREE.CylinderGeometry(0.08, 0.09, 0.02, 24), new THREE.MeshStandardMaterial({ color: 0x555555, metalness: 0.9, roughness: 0.2 }));
const burnerTube = new THREE.Mesh(new THREE.CylinderGeometry(0.015, 0.015, 0.18, 16), new THREE.MeshStandardMaterial({ color: 0x888888, metalness: 0.8, roughness: 0.3 }));
burnerTube.position.y = 0.09;
const flameCone = new THREE.Mesh(new THREE.ConeGeometry(0.025, 0.09, 16), new THREE.MeshBasicMaterial({ color: 0x3388ff, transparent: true, opacity: 0.85 }));
flameCone.position.y = 0.22;
burnerGroup.add(burnerBase, burnerTube, flameCone);
burnerGroup.userData.xr = { snapSocket: { tag: 'burner', radius: 0.12 } };
workbench.add(burnerGroup);

// Spark particles
const sparkCount = 40;
const sparkGeo = new THREE.BufferGeometry();
const sparkPositions = new Float32Array(sparkCount * 3);
for (let i = 0; i < sparkCount; i++) {
  sparkPositions[i * 3] = (Math.random() - 0.5) * 0.06;
  sparkPositions[i * 3 + 1] = 0.96 + Math.random() * 0.15;
  sparkPositions[i * 3 + 2] = (Math.random() - 0.5) * 0.06;
}
sparkGeo.setAttribute('position', new THREE.BufferAttribute(sparkPositions, 3));
const sparkMat = new THREE.PointsMaterial({ color: 0xffee44, size: 0.015, transparent: true });
const sparks = new THREE.Points(sparkGeo, sparkMat);
workbench.add(sparks);

// 3 grabbable reagent flasks
const flaskColors = [0x22eeaa, 0xff4433, 0xffbb22];
const flaskPositions = [[-0.3, 0.775, 0.1], [0.3, 0.775, 0.1], [0.0, 0.775, -0.3]];
for (let i = 0; i < 3; i++) {
  const flask = new THREE.Group();
  flask.position.set(...flaskPositions[i]);
  const bodyGeo = new THREE.ConeGeometry(0.07, 0.14, 24);
  const neckGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.06, 16);
  neckGeo.translate(0, 0.09, 0);
  const glassMat = new THREE.MeshPhysicalMaterial({
    color: flaskColors[i],
    transmission: 0.85,
    roughness: 0.1,
    ior: 1.5,
    thickness: 0.04,
    transparent: true,
    opacity: 0.95
  });
  flask.add(new THREE.Mesh(bodyGeo, glassMat), new THREE.Mesh(neckGeo, glassMat));
  flask.userData.xr = { grab: '1-hand', snapTo: { socketTag: 'burner' } };
  workbench.add(flask);
}

// Floating spatial label
const labelMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.18, 0.18, 0.01, 32), new THREE.MeshBasicMaterial({ color: 0x112233 }));
labelMesh.rotation.x = Math.PI / 2;
labelMesh.position.set(0, 1.25, -0.2);
labelMesh.userData.xr = { spatialLabel: true, text: 'Reagent Prep Station', billboard: true };
workbench.add(labelMesh);

scene.add(workbench);

function animate(dt) {
  flameCone.scale.y = 1 + Math.sin(Date.now() * 0.015) * 0.15;
  const pos = sparkGeo.attributes.position.array;
  for (let i = 1; i < pos.length; i += 3) {
    pos[i] += (dt || 0.016) * 0.2;
    if (pos[i] > 1.15) pos[i] = 0.96;
  }
  sparkGeo.attributes.position.needsUpdate = true;
}
