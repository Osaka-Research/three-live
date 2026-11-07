// Interactive Planetarium with Orbiting Moons & Hold-to-Ask (xr_09)
scene.background = new THREE.Color(0x030712);

const ambientLight = new THREE.AmbientLight(0xffffff, 0.55);
ambientLight.name = "AmbientLight";
scene.add(ambientLight);

const dirFillLight = new THREE.DirectionalLight(0x93c5fd, 0.7);
dirFillLight.name = "GalacticFillLight";
dirFillLight.position.set(3.0, 5.0, 3.0);
scene.add(dirFillLight);

const solarPointLight = new THREE.PointLight(0xfef08a, 2.4, 8.0);
solarPointLight.name = "SolarCorePointLight";
solarPointLight.position.set(0, 1.05, 0);
scene.add(solarPointLight);

// Planetarium Floor Projector Pedestal (resting at y = 0)
const projectorBaseMat = new THREE.MeshStandardMaterial({ color: 0x1e293b, metalness: 0.8, roughness: 0.25 });
const ringGuideMat = new THREE.MeshStandardMaterial({
  color: 0x38bdf8,
  emissive: 0x0369a1,
  emissiveIntensity: 0.55,
  roughness: 0.3
});

const planetariumBase = new THREE.Group();
planetariumBase.name = "PlanetariumProjectorBase";
planetariumBase.userData.xr = { anchor: "Floor" };
scene.add(planetariumBase);

const baseCylinder = new THREE.Mesh(new THREE.CylinderGeometry(0.45, 0.56, 0.14, 32), projectorBaseMat);
baseCylinder.name = "PlanetariumFloorPlinth";
baseCylinder.position.y = 0.07;
planetariumBase.add(baseCylinder);

// Central Glowing Sun Node
const sunMat = new THREE.MeshStandardMaterial({
  color: 0xfacc15,
  emissive: 0xf59e0b,
  emissiveIntensity: 1.6,
  roughness: 0.2
});
const sunNode = new THREE.Mesh(new THREE.SphereGeometry(0.21, 32, 32), sunMat);
sunNode.name = "Sun";
sunNode.position.set(0, 1.05, 0);
sunNode.userData.xr = {
  grab: "2-hand",
  scale: { min: 0.6, max: 2.2 },
  bloom: { strength: 1.0 },
  gaze: { dwellMs: 800, action: "select" }
};
sunNode.userData.state = {
  holdToAsk: "Explain nuclear fusion and solar corona dynamics in our G-type main-sequence star",
  textLabel: "THE SUN (SOL)"
};
scene.add(sunNode);

// Helper to create 3D Text Label Plaque above each Celestial Body
function attachPlanetLabel(parentGroup, labelId, yOffset, badgeColor) {
  const plaque = new THREE.Mesh(
    new THREE.BoxGeometry(0.18, 0.048, 0.008),
    new THREE.MeshStandardMaterial({
      color: badgeColor,
      emissive: badgeColor,
      emissiveIntensity: 0.65,
      roughness: 0.25
    })
  );
  plaque.name = `LabelPlaque_${labelId}`;
  plaque.position.set(0, yOffset, 0);
  plaque.userData.xr = { billboard: "y" };
  parentGroup.add(plaque);
}

// Planetary Specifications
const planets = [
  {
    name: "Mercury",
    radius: 0.045,
    orbitRadius: 0.44,
    speed: 1.45,
    angle: 0.3,
    color: 0x94a3b8,
    prompt: "Ask about Mercury's extreme day-night surface temperatures and iron core"
  },
  {
    name: "Venus",
    radius: 0.068,
    orbitRadius: 0.66,
    speed: 1.1,
    angle: 1.8,
    color: 0xfbbf24,
    prompt: "Ask about Venus's runaway greenhouse atmosphere and retrograde rotation"
  },
  {
    name: "Earth",
    radius: 0.076,
    orbitRadius: 0.94,
    speed: 0.85,
    angle: 3.4,
    color: 0x2563eb,
    prompt: "Ask about Earth's magnetosphere, liquid oceans, and orbital obliquity",
    hasMoon: true
  },
  {
    name: "Mars",
    radius: 0.058,
    orbitRadius: 1.22,
    speed: 0.68,
    angle: 4.9,
    color: 0xea580c,
    prompt: "Ask about Olympus Mons, Valles Marineris, and polar ice caps on Mars"
  },
  {
    name: "Saturn",
    radius: 0.115,
    orbitRadius: 1.58,
    speed: 0.45,
    angle: 0.9,
    color: 0xfde68a,
    prompt: "Ask about Saturn's icy ring system and hexagonal polar storm",
    hasRings: true
  }
];

const animatedBodies = [];

planets.forEach((p) => {
  // Visible Orbital Track Ring
  const trackRing = new THREE.Mesh(
    new THREE.TorusGeometry(p.orbitRadius, 0.0035, 10, 64),
    ringGuideMat
  );
  trackRing.name = `OrbitTrack_${p.name}`;
  trackRing.rotation.x = Math.PI / 2;
  trackRing.position.set(0, 1.05, 0);
  scene.add(trackRing);

  // Planet Group Node
  const planetGroup = new THREE.Group();
  planetGroup.name = p.name;
  planetGroup.position.set(
    Math.cos(p.angle) * p.orbitRadius,
    1.05,
    Math.sin(p.angle) * p.orbitRadius
  );
  planetGroup.userData.xr = {
    orbit: { target: "Sun", radius: p.orbitRadius, speed: p.speed, height: 0 },
    grab: "2-hand",
    scale: { min: 0.5, max: 2.5 },
    gaze: { dwellMs: 800, action: "select" },
    outline: { color: "#38bdf8", thickness: 0.012 }
  };
  planetGroup.userData.state = {
    holdToAsk: p.prompt,
    text: p.name.toUpperCase()
  };

  const planetMesh = new THREE.Mesh(
    new THREE.SphereGeometry(p.radius, 24, 24),
    new THREE.MeshStandardMaterial({ color: p.color, roughness: 0.45, metalness: 0.15 })
  );
  planetMesh.name = `${p.name}_Sphere`;
  planetGroup.add(planetMesh);

  attachPlanetLabel(planetGroup, p.name, p.radius + 0.08, p.color);

  // Saturn Ring System
  if (p.hasRings) {
    const saturnRing = new THREE.Mesh(
      new THREE.TorusGeometry(p.radius * 1.65, 0.022, 8, 40),
      new THREE.MeshStandardMaterial({ color: 0xfef3c7, roughness: 0.5 })
    );
    saturnRing.name = "SaturnPlanetaryRing";
    saturnRing.rotation.x = Math.PI * 0.42;
    saturnRing.scale.z = 0.25;
    planetGroup.add(saturnRing);
  }

  // Earth's Orbiting Moon
  if (p.hasMoon) {
    const moonNode = new THREE.Mesh(
      new THREE.SphereGeometry(0.022, 16, 16),
      new THREE.MeshStandardMaterial({ color: 0xe2e8f0, roughness: 0.7 })
    );
    moonNode.name = "LunarMoon";
    moonNode.position.set(0.14, 0.02, 0);
    moonNode.userData.xr = {
      orbit: { target: "Earth", radius: 0.14, speed: 2.6, height: 0.02 },
      grab: "2-hand",
      scale: { min: 0.5, max: 2.0 }
    };
    moonNode.userData.state = {
      holdToAsk: "Ask about synchronous tidal locking of Earth's Moon",
      text: "LUNA"
    };
    planetGroup.add(moonNode);
  }

  scene.add(planetGroup);
  animatedBodies.push({ group: planetGroup, spec: p });
});

function animate(t) {
  sunNode.rotation.y = t * 0.3;
  animatedBodies.forEach(({ group, spec }) => {
    const theta = spec.angle + t * spec.speed * 0.5;
    group.position.x = Math.cos(theta) * spec.orbitRadius;
    group.position.z = Math.sin(theta) * spec.orbitRadius;
    group.rotation.y = t * 0.8;
  });
}

camera.position.set(2.55, 2.35, 2.85);
camera.lookAt(0, 0.95, 0);
