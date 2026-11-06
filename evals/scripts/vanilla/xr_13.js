const hallGroup = new THREE.Group();
scene.add(hallGroup);

scene.add(new THREE.AmbientLight(0xfff0dd, 0.5));
const spotLight = new THREE.DirectionalLight(0xfffaed, 1.2);
spotLight.position.set(2, 4, 3);
scene.add(spotLight);

// Walkable floor
const floor = new THREE.Mesh(
  new THREE.BoxGeometry(4.0, 0.05, 4.0),
  new THREE.MeshStandardMaterial({ color: 0x2b2b2e, roughness: 0.4 })
);
floor.position.set(0, 0, 0);
floor.userData.xr = { navigable: 'walkable' };
hallGroup.add(floor);

// Central T-Rex Podium & Fossil Skeleton
const skeletonGroup = new THREE.Group();
skeletonGroup.position.set(0, 0.05, -0.3);

const podium = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.2, 1.0), new THREE.MeshStandardMaterial({ color: 0x403833, roughness: 0.7 }));
podium.position.y = 0.1;
skeletonGroup.add(podium);

const boneMat = new THREE.MeshStandardMaterial({ color: 0xe3d9c6, roughness: 0.6 });
const spine = new THREE.Mesh(new THREE.CylinderGeometry(0.04, 0.04, 1.1, 8), boneMat);
spine.rotation.z = Math.PI / 2.6;
spine.position.set(0, 0.65, 0);
const skull = new THREE.Mesh(new THREE.SphereGeometry(0.12, 16, 12), boneMat);
skull.scale.set(1.4, 0.9, 0.9);
skull.position.set(0.48, 0.9, 0);
const rib = new THREE.Mesh(new THREE.BoxGeometry(0.03, 0.22, 0.35), boneMat);
rib.position.set(0.1, 0.6, 0);
skeletonGroup.add(spine, skull, rib);
hallGroup.add(skeletonGroup);

// Velvet rope barriers
const postGeo = new THREE.CylinderGeometry(0.02, 0.02, 0.5, 12);
const postMat = new THREE.MeshStandardMaterial({ color: 0xd4af37, metalness: 0.8, roughness: 0.3 });
const ballGeo = new THREE.SphereGeometry(0.035, 12, 12);
const ropeGeo = new THREE.CylinderGeometry(0.015, 0.015, 0.7, 8);
const ropeMat = new THREE.MeshStandardMaterial({ color: 0x800a18, roughness: 0.8 });

[[-0.9, 0.5], [0, 0.6], [0.9, 0.5]].forEach(([x, z]) => {
  const barrier = new THREE.Group();
  barrier.position.set(x, 0.05, z);
  const post = new THREE.Mesh(postGeo, postMat);
  post.position.y = 0.25;
  const ball = new THREE.Mesh(ballGeo, postMat);
  ball.position.y = 0.52;
  const rope = new THREE.Mesh(ropeGeo, ropeMat);
  rope.rotation.z = Math.PI / 2;
  rope.position.set(0.35, 0.42, 0);
  barrier.add(post, ball, rope);
  barrier.userData.xr = { navigable: 'blocked' };
  hallGroup.add(barrier);
});

// 3 Spatial Audio Guide Pedestals
const pedGeo = new THREE.BoxGeometry(0.15, 0.6, 0.15);
const pedMat = new THREE.MeshStandardMaterial({ color: 0x1f2421, roughness: 0.5 });
const guides = [
  { pos: [-1.2, 0.3, 0.6], topic: 'Discovery & Anatomy' },
  { pos: [0.0, 0.3, 1.1], topic: 'Late Cretaceous Habitat' },
  { pos: [1.2, 0.3, 0.6], topic: 'Extinction Event' }
];

guides.forEach(({ pos, topic }) => {
  const ped = new THREE.Mesh(pedGeo, pedMat);
  ped.position.set(...pos);
  ped.userData.xr = {
    audioEmitter: { clip: `tour_${topic.toLowerCase().replace(/\\s+/g, '_')}`, refDistance: 0.8, maxDistance: 3.0 },
    gaze: { trigger: 'highlight', prompt: topic }
  };
  hallGroup.add(ped);
});
