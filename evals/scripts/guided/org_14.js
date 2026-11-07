const mouseRoot = new THREE.Group();
mouseRoot.name = "ergonomic_vertical_wireless_mouse_root";
scene.add(mouseRoot);

// Lighting
const ambientLight = new THREE.AmbientLight(0xffffff, 0.65);
ambientLight.name = "ambient_light";
scene.add(ambientLight);

const studioKeyLight = new THREE.DirectionalLight(0xfff8f0, 1.35);
studioKeyLight.name = "studio_key_light";
studioKeyLight.position.set(0.8, 1.4, 1.0);
scene.add(studioKeyLight);

const studioRimLight = new THREE.PointLight(0x60a5fa, 0.85, 3.0);
studioRimLight.name = "cool_product_rim_light";
studioRimLight.position.set(-0.7, 0.6, -0.6);
scene.add(studioRimLight);

// Materials
const matteGripMat = new THREE.MeshStandardMaterial({
  color: 0x272a30,
  roughness: 0.62,
  metalness: 0.08
});

const clickPaddleMat = new THREE.MeshStandardMaterial({
  color: 0x1c1e22,
  roughness: 0.35,
  metalness: 0.15
});

const brushedMetalBaseMat = new THREE.MeshStandardMaterial({
  color: 0xb8c0cc,
  roughness: 0.26,
  metalness: 0.88
});

const knurledAluminumMat = new THREE.MeshStandardMaterial({
  color: 0xdbe2ec,
  roughness: 0.22,
  metalness: 0.92
});

const accentCyanLedMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0284c7,
  emissiveIntensity: 0.9,
  roughness: 0.2
});

// 1. Brushed Metal Base Plate (~0.25m long along Z, ~0.155m wide, resting at y = 0)
const baseGroup = new THREE.Group();
baseGroup.name = "brushed_metal_base_group";
mouseRoot.add(baseGroup);

// Custom indexed BufferGeometry for the contoured ergonomic footprint base plate
function createContouredBaseGeometry(height, scaleMargin) {
  const segs = 36;
  const positions = [];
  const indices = [];

  function getFootprintPoint(theta) {
    // Ergonomic asymmetric bean/teardrop footprint with flared left thumb wing (-X)
    const z = Math.sin(theta) * 0.122 * scaleMargin;
    let x = Math.cos(theta) * 0.068 * scaleMargin;
    // Flare out left thumb wing (-X) in mid-rear region
    if (x < 0) {
      const thumbWing = Math.exp(-Math.pow(Math.sin(theta) + 0.15, 2) * 3.5);
      x -= 0.022 * thumbWing * scaleMargin;
    }
    // Taper front nose (+Z) slightly narrower
    if (z > 0) {
      x *= 1.0 - 0.18 * (z / 0.125);
    }
    return { x, z };
  }

  // Bottom center (idx 0) and top center (idx 1)
  positions.push(0, 0, 0);
  positions.push(0, height, 0);

  for (let i = 0; i <= segs; i++) {
    const theta = (i / segs) * Math.PI * 2.0;
    const { x, z } = getFootprintPoint(theta);
    positions.push(x, 0, z);      // bottom ring: 2 + i * 2
    positions.push(x, height, z); // top ring: 3 + i * 2
  }

  for (let i = 0; i < segs; i++) {
    const b0 = 2 + i * 2;
    const t0 = 3 + i * 2;
    const b1 = 2 + (i + 1) * 2;
    const t1 = 3 + (i + 1) * 2;

    // Bottom cap
    indices.push(0, b0, b1);
    // Top cap
    indices.push(1, t1, t0);
    // Outer wall
    indices.push(b0, t0, b1);
    indices.push(t0, t1, b1);
  }

  const geo = new THREE.BufferGeometry();
  geo.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geo.setIndex(indices);
  geo.computeVertexNormals();
  return geo;
}

const metalBasePlate = new THREE.Mesh(
  createContouredBaseGeometry(0.012, 1.0),
  brushedMetalBaseMat
);
metalBasePlate.name = "mouse_brushed_metal_base_plate";
baseGroup.add(metalBasePlate);

// Thin cyan LED wireless status accent strip above the metal base
const ledAccentPlate = new THREE.Mesh(
  createContouredBaseGeometry(0.003, 0.97),
  accentCyanLedMat
);
ledAccentPlate.name = "mouse_wireless_status_led_strip";
ledAccentPlate.position.y = 0.012;
baseGroup.add(ledAccentPlate);

// 2. Sculpted Vertical Ergonomic Body with CSG-Carved Contoured Thumb Rest Trough
// Keep CSG input segments <= 20 so triangle count stays well below 4096
const rawBodyShell = new THREE.Mesh(
  new THREE.SphereGeometry(0.118, 20, 16),
  matteGripMat
);
rawBodyShell.scale.set(0.68, 0.65, 1.02);
rawBodyShell.position.set(0.004, 0.058, -0.002);
rawBodyShell.rotation.z = -0.32; // 57-degree vertical handshake tilt
rawBodyShell.updateMatrix();

// Swept cylindrical cutter for the deep contoured thumb rest trough on the left (-X) side
const thumbTroughCutter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.046, 0.054, 0.24, 16),
  matteGripMat
);
thumbTroughCutter.rotation.x = Math.PI / 2 - 0.12;
thumbTroughCutter.rotation.z = 0.18;
thumbTroughCutter.position.set(-0.072, 0.064, -0.008);
thumbTroughCutter.updateMatrix();

// Flat bottom plane cutter so the sculpted body sits flush at y = 0.015 on top of the metal base
const bottomTrimCutter = new THREE.Mesh(
  new THREE.CylinderGeometry(0.18, 0.18, 0.10, 16),
  matteGripMat
);
bottomTrimCutter.position.set(0, -0.035, 0);
bottomTrimCutter.updateMatrix();

let sculptedBody = THREE.CSG.subtract(rawBodyShell, thumbTroughCutter);
sculptedBody = THREE.CSG.subtract(sculptedBody, bottomTrimCutter);
sculptedBody.material = matteGripMat;
sculptedBody.name = "mouse_sculpted_vertical_shell_csg";
mouseRoot.add(sculptedBody);

// Soft-touch contoured thumb wing lip cradling the bottom of the thumb trough
const thumbWingLip = new THREE.Mesh(
  createContouredBaseGeometry(0.010, 0.96),
  matteGripMat
);
thumbWingLip.name = "mouse_thumb_rest_lower_cradle_lip";
thumbWingLip.position.y = 0.015;
mouseRoot.add(thumbWingLip);

// 3. Angled Left & Right Click Paddles, Knurled Aluminum Scroll Wheel & Navigation Buttons
// Orient the click deck assembly along the 57-degree ergonomic handshake slope (+X / +Y face)
const clickDeckGroup = new THREE.Group();
clickDeckGroup.name = "ergonomic_click_deck_group";
clickDeckGroup.position.set(0.025, 0.088, 0.048);
clickDeckGroup.rotation.z = -0.62; // Angled ergonomic vertical plane
clickDeckGroup.rotation.x = 0.34;  // Sloping downward toward front nose (+Z)
mouseRoot.add(clickDeckGroup);

// Left Click Paddle (Upper ridge button in vertical handshake orientation)
const leftClickPaddle = new THREE.Mesh(
  new THREE.SphereGeometry(0.048, 18, 14),
  clickPaddleMat
);
leftClickPaddle.name = "mouse_angled_left_click_paddle";
leftClickPaddle.scale.set(0.42, 0.14, 1.15);
leftClickPaddle.position.set(-0.022, 0.008, 0.005);
clickDeckGroup.add(leftClickPaddle);

// Right Click Paddle (Lower ridge button in vertical handshake orientation)
const rightClickPaddle = new THREE.Mesh(
  new THREE.SphereGeometry(0.048, 18, 14),
  clickPaddleMat
);
rightClickPaddle.name = "mouse_angled_right_click_paddle";
rightClickPaddle.scale.set(0.42, 0.14, 1.15);
rightClickPaddle.position.set(0.022, 0.008, 0.005);
clickDeckGroup.add(rightClickPaddle);

// Recessed Scroll Wheel Housing Slot between the left and right paddles
const wheelRecess = new THREE.Mesh(
  new THREE.CylinderGeometry(0.006, 0.006, 0.065, 12),
  clickPaddleMat
);
wheelRecess.name = "mouse_scroll_wheel_channel_recess";
wheelRecess.rotation.x = Math.PI / 2;
wheelRecess.position.set(0, 0.009, 0.012);
clickDeckGroup.add(wheelRecess);

// Knurled Aluminum Scroll Wheel Assembly
const scrollWheelGroup = new THREE.Group();
scrollWheelGroup.name = "knurled_aluminum_scroll_wheel_group";
scrollWheelGroup.position.set(0, 0.012, 0.018);
clickDeckGroup.add(scrollWheelGroup);

const wheelDrum = new THREE.Mesh(
  new THREE.CylinderGeometry(0.016, 0.016, 0.010, 24),
  knurledAluminumMat
);
wheelDrum.name = "scroll_wheel_aluminum_drum";
wheelDrum.rotation.z = Math.PI / 2;
scrollWheelGroup.add(wheelDrum);

// 16 Tactile Knurl Ridges around the circumference of the scroll wheel
for (let k = 0; k < 16; k++) {
  const kAngle = (k / 16) * Math.PI * 2.0;
  const knurlRib = new THREE.Mesh(
    new THREE.CylinderGeometry(0.0014, 0.0014, 0.0105, 6),
    brushedMetalBaseMat
  );
  knurlRib.name = `scroll_wheel_knurl_rib_${k + 1}`;
  knurlRib.rotation.z = Math.PI / 2;
  knurlRib.position.set(0, Math.sin(kAngle) * 0.016, Math.cos(kAngle) * 0.016);
  scrollWheelGroup.add(knurlRib);
}

// Brushed metal DPI selector button behind the scroll wheel
const dpiButton = new THREE.Mesh(
  new THREE.CylinderGeometry(0.005, 0.005, 0.018, 12),
  brushedMetalBaseMat
);
dpiButton.name = "mouse_dpi_selector_button";
dpiButton.rotation.x = Math.PI / 2;
dpiButton.position.set(0, 0.013, -0.022);
clickDeckGroup.add(dpiButton);

// Forward & Back Thumb Buttons nestled above the contoured thumb rest trough
const thumbForwardBtn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.005, 0.005, 0.032, 12),
  brushedMetalBaseMat
);
thumbForwardBtn.name = "mouse_thumb_forward_button";
thumbForwardBtn.rotation.x = Math.PI / 2 - 0.18;
thumbForwardBtn.position.set(-0.040, 0.095, 0.025);
mouseRoot.add(thumbForwardBtn);

const thumbBackBtn = new THREE.Mesh(
  new THREE.CylinderGeometry(0.005, 0.005, 0.032, 12),
  brushedMetalBaseMat
);
thumbBackBtn.name = "mouse_thumb_back_button";
thumbBackBtn.rotation.x = Math.PI / 2 - 0.05;
thumbBackBtn.position.set(-0.042, 0.098, -0.014);
mouseRoot.add(thumbBackBtn);

// Camera Framing (0.25m display scale length, height ~0.14m, bounding radius ~0.16m)
camera.position.set(-0.24, 0.18, 0.32);
camera.lookAt(0, 0.065, 0);
