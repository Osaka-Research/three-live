// Vanilla Three.js Lexical Scene Shadowing Trap (const scene = new THREE.Scene())
// In compiler/src/engine.rs, scripts are wrapped in a block { ... }, so const scene
// shadows globalThis.scene and causes TL301: "Scene contains 0 meshes"!
const scene = new THREE.Scene();
const camera = new THREE.PerspectiveCamera(45, 16 / 9, 0.1, 100);
scene.add(new THREE.AmbientLight(0xffffff, 0.6));
const mesh = new THREE.Mesh(
  new THREE.BoxGeometry(0.6, 0.4, 0.4),
  new THREE.MeshStandardMaterial({ color: 0x64748b, metalness: 0.8, roughness: 0.3 })
);
mesh.name = 'cnc_pillow_block';
mesh.position.y = 0.2;
scene.add(mesh);
camera.position.set(0, 0.8, 1.8);
camera.lookAt(0, 0.2, 0);
