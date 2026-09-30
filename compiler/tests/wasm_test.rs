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

//! WebAssembly smoke tests.
//!
//! The suite had no WASM coverage at all, which is why nothing caught that
//! `std::time::Instant::now()` panics on `wasm32-unknown-unknown` — the execution
//! ceiling is consulted on every compile path, so *every* call through the WASM
//! package aborted with "time not implemented on this platform". These tests exercise
//! the real entry points on the real target so that regression cannot recur silently.
//!
//! Run with:
//!
//! ```sh
//! wasm-pack test --node compiler
//! ```

#![cfg(target_arch = "wasm32")]

use three_live_compiler::time::Stopwatch;
use three_live_compiler::wasm::{compile_three_to_glb, three_compiler_version, validate_three};
use wasm_bindgen_test::wasm_bindgen_test;

/// The clock must work at all. This is the direct regression test for the panic.
#[wasm_bindgen_test]
fn stopwatch_does_not_panic_on_wasm() {
    let clock = Stopwatch::start();
    let elapsed = clock.elapsed_ms();
    assert!(elapsed >= 0.0, "elapsed must be non-negative, got {}", elapsed);
    assert!(elapsed < 60_000.0, "a freshly started clock cannot read {} ms", elapsed);
}

/// End-to-end compile through the public WASM binding. Previously this aborted the
/// module instance before producing a single byte.
#[wasm_bindgen_test]
fn compile_box_geometry_to_glb() {
    let script = r#"
        const geo = new THREE.BoxGeometry(2, 3, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.3 });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let glb = compile_three_to_glb(script).expect("WASM compile must succeed");
    assert!(glb.len() > 20, "GLB should not be trivially short, got {} bytes", glb.len());

    let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
    let version = u32::from_le_bytes([glb[4], glb[5], glb[6], glb[7]]);
    let length = u32::from_le_bytes([glb[8], glb[9], glb[10], glb[11]]);
    assert_eq!(magic, 0x4654_6C67, "GLB magic mismatch");
    assert_eq!(version, 2, "GLB version mismatch");
    assert_eq!(length as usize, glb.len(), "GLB header length mismatch");
}

#[wasm_bindgen_test]
fn validate_reports_scene_contents() {
    let script = r#"
        scene.add(new THREE.Mesh(new THREE.SphereGeometry(1, 8, 6), new THREE.MeshStandardMaterial()));
        scene.add(new THREE.DirectionalLight(0xffffff, 1.0));
    "#;

    let summary = validate_three(script).expect("WASM validate must succeed");
    let parsed: serde_json::Value =
        serde_json::from_str(&summary).expect("validate_three must return JSON");
    assert_eq!(parsed["valid"], true);
    assert_eq!(parsed["mesh_count"], 1);
    assert_eq!(parsed["light_count"], 1);
}

/// A syntactically broken script must return an error rather than trapping the module.
#[wasm_bindgen_test]
fn invalid_script_returns_error_without_trapping() {
    let result = compile_three_to_glb("this is not valid javascript {{{");
    assert!(result.is_err(), "A malformed script must produce an error");
}

#[wasm_bindgen_test]
fn version_is_reported() {
    assert!(!three_compiler_version().is_empty(), "Version must not be empty");
}
