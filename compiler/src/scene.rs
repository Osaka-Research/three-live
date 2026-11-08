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

//! Intermediate 3D Scene Graph representation for Three-Live Transcoder.

use serde::{Deserialize, Serialize};

/// Structured compiler, schema, spatial, or HTML host diagnostic (`TL1xx–TL4xx`).
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq, Eq, Default)]
pub struct Diagnostic {
    pub code: String,
    pub severity: String,
    pub message: String,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub node: Option<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub line: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub column: Option<u32>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub hint: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, Default)]
pub struct SceneGraph {
    pub meshes: Vec<Mesh3D>,
    pub materials: Vec<Material3D>,
    pub lights: Vec<Light3D>,
    pub camera: Option<CameraConfig>,
    /// Compiled root `KHR_interactivity` extension (from `userData.interactivity`).
    #[serde(default)]
    pub interactivity: Option<serde_json::Value>,
    /// Root `KHR_materials_variants` extension (from `userData.variants`).
    #[serde(default)]
    pub variants: Option<serde_json::Value>,
    /// Full scene hierarchy (every `Object3D` below the scene root, in the web
    /// exporter's pre-order DFS order). When non-empty, the GLB writer emits
    /// exactly these nodes, with `meshes` referenced by index; when empty it
    /// falls back to the legacy one-flat-node-per-mesh layout.
    #[serde(default)]
    pub nodes: Vec<SceneNode>,
    /// Compiler, fallback, schema, and spatial diagnostics collected during evaluation.
    #[serde(default)]
    pub diagnostics: Vec<Diagnostic>,
}

/// One glTF node: a local transform, an optional mesh, and XR traits.
///
/// Invariants (enforced by the engine on extraction): `parent < own index`
/// (so the hierarchy is a forest with no cycles), finite TRS, and
/// `mesh < SceneGraph::meshes.len()`.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SceneNode {
    pub name: String,
    #[serde(default)]
    pub parent: Option<usize>,
    #[serde(default)]
    pub translation: [f32; 3],
    #[serde(default = "identity_rotation")]
    pub rotation: [f32; 4],
    #[serde(default = "unit_scale")]
    pub scale: [f32; 3],
    #[serde(default)]
    pub mesh: Option<usize>,
    #[serde(default)]
    pub xr_traits: Option<serde_json::Value>,
    #[serde(default)]
    pub xr_normalized: Option<serde_json::Value>,
    #[serde(default)]
    pub xr_scenecore: Option<serde_json::Value>,
    #[serde(default)]
    pub xr_hubs: Option<serde_json::Value>,
    #[serde(default)]
    pub instance_matrices: Vec<f32>,
    #[serde(default)]
    pub instance_colors: Vec<f32>,
    #[serde(default)]
    pub interactivity_events: Vec<String>,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub interactivity: Option<serde_json::Value>,
    /// Whether this node is initially visible (`KHR_node_visibility`). Defaults to `true`.
    #[serde(default = "default_true")]
    pub visible: bool,
}

fn default_true() -> bool {
    true
}

impl Default for SceneNode {
    fn default() -> Self {
        Self {
            name: String::new(),
            parent: None,
            translation: [0.0; 3],
            rotation: identity_rotation(),
            scale: unit_scale(),
            mesh: None,
            xr_traits: None,
            xr_normalized: None,
            xr_scenecore: None,
            xr_hubs: None,
            instance_matrices: Vec::new(),
            instance_colors: Vec::new(),
            interactivity_events: Vec::new(),
            interactivity: None,
            visible: true,
        }
    }
}

fn identity_rotation() -> [f32; 4] {
    [0.0, 0.0, 0.0, 1.0]
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Mesh3D {
    pub name: String,
    pub positions: Vec<[f32; 3]>,
    pub normals: Vec<[f32; 3]>,
    pub uvs: Vec<[f32; 2]>,
    pub indices: Vec<u32>,
    pub material_index: Option<usize>,
    #[serde(default)]
    pub variant_mappings: Option<serde_json::Value>,
    #[serde(default)]
    pub xr_traits: Option<serde_json::Value>,
    /// Canonical normalized traits (`xr-trait-schema.ts`), emitted as `extras.xr`.
    #[serde(default)]
    pub xr_normalized: Option<serde_json::Value>,
    /// Canonical `ANDROID_xr_scenecore` component map.
    #[serde(default)]
    pub xr_scenecore: Option<serde_json::Value>,
    /// Canonical `MOZ_hubs_components` map.
    #[serde(default)]
    pub xr_hubs: Option<serde_json::Value>,
    /// Node translation (world offset accumulated through the hierarchy).
    /// Legacy flat layout only; ignored when `SceneGraph::nodes` is non-empty.
    #[serde(default)]
    pub translation: [f32; 3],
    /// Node scale (accumulated through the hierarchy).
    /// Legacy flat layout only; ignored when `SceneGraph::nodes` is non-empty.
    #[serde(default = "unit_scale")]
    pub scale: [f32; 3],
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Material3D {
    pub name: String,
    pub base_color: [f32; 4],
    pub metallic: f32,
    pub roughness: f32,
    pub double_sided: bool,
    #[serde(default)]
    pub base_color_texture: Option<String>,
    #[serde(default)]
    pub metallic_roughness_texture: Option<String>,
    #[serde(default)]
    pub normal_texture: Option<String>,
    #[serde(default = "default_one")]
    pub normal_scale: f32,
    #[serde(default)]
    pub emissive_factor: [f32; 3],
    #[serde(default)]
    pub emissive_texture: Option<String>,
    #[serde(default)]
    pub occlusion_texture: Option<String>,
    #[serde(default = "default_one")]
    pub occlusion_strength: f32,
    #[serde(default)]
    pub clearcoat: f32,
    #[serde(default)]
    pub clearcoat_roughness: f32,
    #[serde(default)]
    pub transmission: f32,
    /// Index of refraction. Defaults to 1.5 (the glTF `KHR_materials_ior` default)
    /// on both deserialization and `Default::default()` so the two never disagree.
    #[serde(default = "default_ior")]
    pub ior: f32,
    #[serde(default)]
    pub thickness: f32,
}

/// Default index of refraction, shared by `serde` and `Default`.
fn default_ior() -> f32 {
    1.5
}

fn default_one() -> f32 {
    1.0
}

impl Default for Material3D {
    fn default() -> Self {
        Self {
            name: "DefaultMaterial".to_string(),
            base_color: [0.8, 0.8, 0.8, 1.0],
            metallic: 0.1,
            roughness: 0.5,
            double_sided: true,
            base_color_texture: None,
            metallic_roughness_texture: None,
            normal_texture: None,
            normal_scale: default_one(),
            emissive_factor: [0.0, 0.0, 0.0],
            emissive_texture: None,
            occlusion_texture: None,
            occlusion_strength: default_one(),
            clearcoat: 0.0,
            clearcoat_roughness: 0.0,
            transmission: 0.0,
            ior: default_ior(),
            thickness: 0.0,
        }
    }
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct Light3D {
    #[serde(alias = "type")]
    pub light_type: String, // "ambient", "directional", "point", "spot", "hemisphere"
    #[serde(default = "unit_scale")]
    pub color: [f32; 3],
    #[serde(default, alias = "groundColor", skip_serializing_if = "Option::is_none")]
    pub ground_color: Option<[f32; 3]>,
    #[serde(default = "default_one")]
    pub intensity: f32,
    #[serde(default)]
    pub position: [f32; 3],
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub direction: Option<[f32; 3]>,
    #[serde(default)]
    pub range: f32,
    #[serde(default, alias = "innerConeAngle")]
    pub inner_cone_angle: f32,
    #[serde(default, alias = "outerConeAngle")]
    pub outer_cone_angle: f32,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct CameraConfig {
    pub fov: f32,
    pub position: [f32; 3],
    pub target: [f32; 3],
}

fn unit_scale() -> [f32; 3] {
    [1.0, 1.0, 1.0]
}
