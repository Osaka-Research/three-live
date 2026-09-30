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

//! WebAssembly bindings for three-compiler.
//!
//! Provides WebAssembly compilation of procedural Three.js scene scripts
//! into binary glTF 2.0 (.glb) containers for web browsers, Web Workers,
//! edge runtimes, and Node.js via wasm-bindgen.

#![cfg(target_arch = "wasm32")]

use crate::{transcode_three_to_glb, validate_three_script};
use wasm_bindgen::prelude::*;

/// Compiles a procedural Three.js scene script into a binary glTF 2.0 (GLB) Uint8Array.
///
/// # Arguments
/// * `script` - JavaScript source code constructing a Three.js scene (using `THREE.Scene`, etc.)
///
/// # Returns
/// A `Uint8Array` containing the complete binary GLB container with 4-byte aligned accessors.
#[wasm_bindgen]
pub fn compile_three_to_glb(script: &str) -> Result<Vec<u8>, JsValue> {
    transcode_three_to_glb(script)
        .map_err(|err| JsValue::from_str(&format!("ThreeCompilerError: {}", err)))
}

/// Validates a Three.js scene script and returns a JSON summary of the scene graph.
///
/// # Arguments
/// * `script` - JavaScript source code constructing a Three.js scene.
///
/// # Returns
/// A JSON string containing `valid`, `mesh_count`, `light_count`, and `material_count`.
#[wasm_bindgen]
pub fn validate_three(script: &str) -> Result<String, JsValue> {
    let scene = validate_three_script(script)
        .map_err(|err| JsValue::from_str(&format!("ThreeCompilerError: {}", err)))?;
    let summary = serde_json::json!({
        "valid": true,
        "mesh_count": scene.meshes.len(),
        "light_count": scene.lights.len(),
        "material_count": scene.materials.len(),
    });
    Ok(summary.to_string())
}

/// Returns the current version of the three-compiler engine.
#[wasm_bindgen]
pub fn three_compiler_version() -> String {
    env!("CARGO_PKG_VERSION").to_string()
}
