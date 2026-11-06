const pagoda = new THREE.Group();
pagoda.position.set(0, 0, 0);
scene.add(pagoda);

const sun = new THREE.DirectionalLight(0xfff1db, 1.25);
sun.position.set(2.5, 4.5, 3);
const skyLight = new THREE.AmbientLight(0xd9e5ff, 0.7);
scene.add(sun, skyLight);

// Authentic traditional materials
const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8a8e, roughness: 0.85 });
const timberMat = new THREE.MeshStandardMaterial({ color: 0x422116, roughness: 0.7 });
const vermilionMat = new THREE.MeshStandardMaterial({ color: 0xa9231c, roughness: 0.45 });
const roofTileMat = new THREE.MeshStandardMaterial({ color: 0x2b3036, roughness: 0.35, metalness: 0.1 });
const bronzeMat = new THREE.MeshStandardMaterial({ color: 0x98733a, roughness: 0.3, metalness: 0.85 });

// Foundation stone platform with entry stairs
const basePlatform = new THREE.Mesh(new THREE.BoxGeometry(1.3, 0.14, 1.3), stoneMat);
basePlatform.position.y = 0.07;
const steps = new THREE.Mesh(new THREE.BoxGeometry(0.35, 0.07, 0.2), stoneMat);
steps.position.set(0, 0.035, 0.7);
pagoda.add(basePlatform, steps);

let currentY = 0.14;
const tierWidths = [0.82, 0.74, 0.66, 0.58, 0.5];
const storyHeights = [0.38, 0.34, 0.3, 0.27, 0.24];

for (let i = 0; i < 5; i++) {
  const w = tierWidths[i];
  const h = storyHeights[i];
  const tier = new THREE.Group();
  tier.position.y = currentY;

  // Timber core body & columns
  const body = new THREE.Mesh(new THREE.BoxGeometry(w * 0.7, h, w * 0.7), timberMat);
  body.position.y = h / 2;
  tier.add(body);

  // Red perimeter railing & balcony walk
  const balcony = new THREE.Mesh(new THREE.BoxGeometry(w * 0.94, 0.024, w * 0.94), vermilionMat);
  balcony.position.y = 0.012;
  const railingPost = new THREE.Mesh(new THREE.CylinderGeometry(0.007, 0.007, 0.07), vermilionMat);
  for (let sx = -1; sx <= 1; sx += 2) {
    for (let sz = -1; sz <= 1; sz += 2) {
      const p = railingPost.clone();
      p.position.set((sx * w * 0.9) / 2, 0.045, (sz * w * 0.9) / 2);
      tier.add(p);
    }
  }
  const railBar = new THREE.Mesh(new THREE.BoxGeometry(w * 0.92, 0.008, 0.008), vermilionMat);
  railBar.position.set(0, 0.08, (w * 0.9) / 2);
  const railBarBack = railBar.clone();
  railBarBack.position.z = (-w * 0.9) / 2;
  tier.add(balcony, railBar, railBarBack);

  // Corner rafters (bracket system dougong)
  for (let r = 0; r < 4; r++) {
    const rafter = new THREE.Mesh(new THREE.BoxGeometry(w * 0.28, 0.016, 0.024), timberMat);
    rafter.rotation.y = (r * Math.PI) / 2 + Math.PI / 4;
    rafter.position.set(0, h * 0.88, 0);
    tier.add(rafter);
  }

  // Sweeping upturned roof eaves
  const roof = new THREE.Mesh(new THREE.ConeGeometry(w * 0.82, 0.12, 4), roofTileMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = h + 0.05;
  const eaveFlare = new THREE.Mesh(new THREE.TorusGeometry(w * 0.58, 0.016, 6, 4), roofTileMat);
  eaveFlare.rotation.x = Math.PI / 2;
  eaveFlare.rotation.z = Math.PI / 4;
  eaveFlare.position.y = h;
  tier.add(roof, eaveFlare);

  pagoda.add(tier);
  currentY += h + 0.08;
}

// Bronze finial spire (Sorin) on pagoda apex
const sorin = new THREE.Group();
sorin.position.y = currentY;

// Spire shaft (Roban & Fukubachi base)
const sorinBase = new THREE.Mesh(new THREE.BoxGeometry(0.18, 0.06, 0.18), bronzeMat);
const sacredBowl = new THREE.Mesh(new THREE.ConeGeometry(0.09, 0.07, 16), bronzeMat);
sacredBowl.rotation.x = Math.PI;
sacredBowl.position.y = 0.06;
const centerMast = new THREE.Mesh(new THREE.CylinderGeometry(0.012, 0.012, 0.72, 16), bronzeMat);
centerMast.position.y = 0.4;
sorin.add(sorinBase, sacredBowl, centerMast);

// Nine sacred bronze rings (Kuruma / Kurin)
for (let k = 0; k < 9; k++) {
  const ring = new THREE.Mesh(new THREE.TorusGeometry(0.048 - k * 0.002, 0.007, 12, 24), bronzeMat);
  ring.rotation.x = Math.PI / 2;
  ring.position.y = 0.18 + k * 0.038;
  sorin.add(ring);
}

// Flame ornament (Suien) & sacred jewel (Hoju)
const flameJewel = new THREE.Mesh(new THREE.ConeGeometry(0.032, 0.09, 8), bronzeMat);
flameJewel.position.y = 0.65;
sorin.add(flameJewel);

pagoda.add(sorin);
pagoda.userData.xr = { inspect: true, target: 'pagoda' };

function animate(dt) {
  pagoda.rotation.y += (dt || 0.016) * 0.04;
}
