// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Cross-exporter parity scene. Compiled by both the web exporter
// (three-live/tests/hierarchy_parity_test.ts -> sceneToCanvas3D) and the native
// compiler (compiler/tests/three_compiler_test.rs -> transcode_three_to_glb);
// both projections must equal hierarchy_parity.expected.json.
const mat = new THREE.MeshStandardMaterial({ color: 0x3366ff });
const accent = new THREE.MeshStandardMaterial({ color: 0xff6633 });

const rig = new THREE.Group();
rig.name = "Rig";
rig.position.set(1, 2, 0);
rig.rotation.set(0, Math.PI / 4, 0);
rig.scale.set(2, 2, 2);
rig.userData.xr = { grab: true, billboard: "spherical" };
rig.userData.interactivity = {
  onSelect: [
    { action: "toggleTransform", property: "rotation", to: [0, 0, 0, 1] },
    { action: "toggleVisibility", target: "Lamp" },
  ],
};
scene.add(rig);

const arm = new THREE.Group();
arm.name = "Arm";
arm.position.set(0, 1, 0);
arm.rotation.set(Math.PI / 2, 0, 0);
rig.add(arm);

const lamp = new THREE.Mesh(new THREE.BoxGeometry(0.2, 0.2, 0.2), accent);
lamp.name = "Lamp";
lamp.position.set(0, 0, 0.5);
lamp.userData.xr = { follow: "hand-left", restitution: 0.25 };
lamp.userData.interactivity = {
  onHoverIn: { action: "cycleMaterialColor", colors: [[1, 0, 0], [0, 1, 0]] },
  onSelect: { action: "toggleVisibility", targetNode: 0 },
};
arm.add(lamp);

const placeholder = new THREE.Mesh(new THREE.BufferGeometry(), mat);
placeholder.name = "Placeholder";
rig.add(placeholder);

const light = new THREE.PointLight(0xffffff, 2);
light.name = "KeyLight";
light.position.set(0, 3, 0);
rig.add(light);

const floor = new THREE.Mesh(new THREE.PlaneGeometry(4, 4), mat);
floor.name = "Floor";
floor.rotation.set(-Math.PI / 2, 0, 0);
floor.userData.interactivity = {
  onSelect: { action: "setProperty", property: "visible", value: false, target: "Arm" },
};
scene.add(floor);

const empty = new THREE.Object3D();
empty.name = "Marker";
empty.position.set(-1, 0, 0);
scene.add(empty);
