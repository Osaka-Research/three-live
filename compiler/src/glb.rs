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

//! Pure Rust glTF 2.0 Binary (.glb) Writer with zero external C-dependencies.

use crate::constants::{SECURITY_3D_MAX_HEAP_BYTES, SECURITY_3D_MAX_TEXTURES};
use crate::engine::MAX_SCENE_NODES;
use crate::scene::SceneGraph;
use serde_json::json;

const GLB_MAGIC: u32 = 0x46546C67; // "glTF"
const GLB_VERSION: u32 = 2;
const CHUNK_TYPE_JSON: u32 = 0x4E4F534A; // "JSON"
const CHUNK_TYPE_BIN: u32 = 0x004E4942; // "BIN\0"

const TARGET_ARRAY_BUFFER: u32 = 34962;
const TARGET_ELEMENT_ARRAY_BUFFER: u32 = 34963;
const COMPONENT_FLOAT: u32 = 5126;
const COMPONENT_UNSIGNED_INT: u32 = 5125;

const MAX_REUSABLE_BIN_CAPACITY: usize = 256 * 1024;

/// Longest prefix of a rejected texture URI echoed back in the error message.
const TEXTURE_URI_ERROR_PREVIEW_CHARS: usize = 64;

#[inline]
fn sanitize_finite(val: f32, fallback: f32) -> f32 {
    if val.is_finite() {
        val
    } else {
        fallback
    }
}

/// Decomposes a column-major 4x4 matrix into `(translation, rotation_quat, scale)`.
fn decompose_mat4(m: &[f32]) -> ([f32; 3], [f32; 4], [f32; 3]) {
    if m.len() < 16 {
        return ([0.0, 0.0, 0.0], [0.0, 0.0, 0.0, 1.0], [1.0, 1.0, 1.0]);
    }
    let tx = sanitize_finite(m[12], 0.0);
    let ty = sanitize_finite(m[13], 0.0);
    let tz = sanitize_finite(m[14], 0.0);

    let m00 = sanitize_finite(m[0], 1.0);
    let m01 = sanitize_finite(m[1], 0.0);
    let m02 = sanitize_finite(m[2], 0.0);
    let m10 = sanitize_finite(m[4], 0.0);
    let m11 = sanitize_finite(m[5], 1.0);
    let m12 = sanitize_finite(m[6], 0.0);
    let m20 = sanitize_finite(m[8], 0.0);
    let m21 = sanitize_finite(m[9], 0.0);
    let m22 = sanitize_finite(m[10], 1.0);

    let mut sx = (m00 * m00 + m01 * m01 + m02 * m02).sqrt();
    let sy = (m10 * m10 + m11 * m11 + m12 * m12).sqrt();
    let sz = (m20 * m20 + m21 * m21 + m22 * m22).sqrt();

    let det = m00 * (m11 * m22 - m21 * m12) - m10 * (m01 * m22 - m21 * m02)
        + m20 * (m01 * m12 - m11 * m02);
    if det < 0.0 {
        sx = -sx;
    }

    let inv_sx = if sx.abs() > 1e-8 { 1.0 / sx } else { 0.0 };
    let inv_sy = if sy.abs() > 1e-8 { 1.0 / sy } else { 0.0 };
    let inv_sz = if sz.abs() > 1e-8 { 1.0 / sz } else { 0.0 };

    let r00 = m00 * inv_sx;
    let r01 = m01 * inv_sx;
    let r02 = m02 * inv_sx;
    let r10 = m10 * inv_sy;
    let r11 = m11 * inv_sy;
    let r12 = m12 * inv_sy;
    let r20 = m20 * inv_sz;
    let r21 = m21 * inv_sz;
    let r22 = m22 * inv_sz;

    let trace = r00 + r11 + r22;
    let (mut qx, mut qy, mut qz, mut qw) = if trace > 0.0 {
        let s = 0.5 / (trace + 1.0).sqrt();
        ((r12 - r21) * s, (r20 - r02) * s, (r01 - r10) * s, 0.25 / s)
    } else if r00 > r11 && r00 > r22 {
        let s = 2.0 * (1.0 + r00 - r11 - r22).max(0.0).sqrt();
        if s > 1e-8 {
            (0.25 * s, (r10 + r01) / s, (r20 + r02) / s, (r12 - r21) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    } else if r11 > r22 {
        let s = 2.0 * (1.0 + r11 - r00 - r22).max(0.0).sqrt();
        if s > 1e-8 {
            ((r10 + r01) / s, 0.25 * s, (r12 + r21) / s, (r20 - r02) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    } else {
        let s = 2.0 * (1.0 + r22 - r00 - r11).max(0.0).sqrt();
        if s > 1e-8 {
            ((r20 + r02) / s, (r12 + r21) / s, 0.25 * s, (r01 - r10) / s)
        } else {
            (0.0, 0.0, 0.0, 1.0)
        }
    };
    let qlen = (qx * qx + qy * qy + qz * qz + qw * qw).sqrt();
    if qlen > 1e-8 && qlen.is_finite() {
        qx /= qlen;
        qy /= qlen;
        qz /= qlen;
        qw /= qlen;
    } else {
        qx = 0.0;
        qy = 0.0;
        qz = 0.0;
        qw = 1.0;
    }
    ([tx, ty, tz], [qx, qy, qz, qw], [sx, sy, sz])
}

/// Serializes an `f32` as JSON without the artifacts of a naive `f32 as f64` widening.
///
/// `serde_json` stores every float as `f64`, so `json!(0.1f32)` emits
/// `0.10000000149011612`. Round-tripping through the `f32` shortest decimal
/// representation instead emits `0.1`, which is both the value the author wrote
/// and a materially smaller JSON chunk across a large scene.
///
/// The input is expected to have been through [`sanitize_finite`]; a non-finite
/// value degrades to `0.0` rather than producing invalid JSON.
#[inline]
fn jnum(val: f32) -> serde_json::Value {
    let shortest = format!("{}", val).parse::<f64>().unwrap_or(val as f64);
    serde_json::Number::from_f64(shortest)
        .map(serde_json::Value::Number)
        .unwrap_or_else(|| json!(0.0))
}

/// Validates texture URIs to prevent SSRF (`http://`, `https://`), Local File Inclusion (`file://`, `/etc/passwd`),
/// and path traversal (`..`). Only `data:image/` data URIs or safe relative asset filenames are
/// permitted.
fn validate_texture_uri(uri: &str) -> Result<(), String> {
    if uri.len() > 2 * 1024 * 1024 {
        return Err(format!(
            "Texture URI length ({} bytes) exceeds maximum allowed (2 MB)",
            uri.len()
        ));
    }
    if uri.contains('\0') {
        return Err("Texture URI contains null byte".to_string());
    }
    let trimmed = uri.trim_start();
    if trimmed.starts_with("data:") {
        if !trimmed.starts_with("data:image/") {
            return Err("Data URI must be an image (data:image/*)".to_string());
        }
        return Ok(());
    }
    let lower = trimmed.to_ascii_lowercase();
    if lower.contains(':')
        || trimmed.starts_with("//")
        || uri.contains('\\')
        || uri.contains("..")
        || uri.contains('%')
    {
        // Truncate by characters, not bytes: a byte-index slice would panic if the
        // cut landed inside a multi-byte code point, turning this security error
        // path into a crash.
        let preview: String = uri.chars().take(TEXTURE_URI_ERROR_PREVIEW_CHARS).collect();
        return Err(format!("Disallowed texture URI scheme or path traversal: {:?}", preview));
    }
    Ok(())
}

thread_local! {
    static REUSABLE_BIN_BUFFER: std::cell::RefCell<Vec<u8>> = std::cell::RefCell::new(Vec::with_capacity(MAX_REUSABLE_BIN_CAPACITY));
}

/// Builds a node's `extras.xr` value and its `MOZ_hubs_components` /
/// `ANDROID_xr_scenecore` extensions from the engine's trait payloads.
///
/// With canonical normalized traits (`xr_normalized`, from `xr-trait-schema.ts`)
/// and `web_parity`, the output matches `sceneToCanvas3D` with the canonical
/// serializer registered: `extras.xr` is the normalized set and both
/// extensions are always present (possibly empty). Without `web_parity` (the
/// legacy flat layout) empty extension maps are omitted and Hubs components are
/// derived from the raw traits, exactly as before the hierarchy rewrite.
fn build_xr_payload(
    xr_traits: Option<&serde_json::Value>,
    xr_normalized: Option<&serde_json::Value>,
    xr_scenecore: Option<&serde_json::Value>,
    xr_hubs: Option<&serde_json::Value>,
    web_parity: bool,
) -> Option<(serde_json::Value, serde_json::Map<String, serde_json::Value>)> {
    if web_parity {
        if let Some(normalized) = xr_normalized {
            let as_map = |v: Option<&serde_json::Value>| match v {
                Some(serde_json::Value::Object(m)) => m.clone(),
                _ => serde_json::Map::new(),
            };
            let mut exts = serde_json::Map::new();
            exts.insert(
                "MOZ_hubs_components".to_string(),
                serde_json::Value::Object(as_map(xr_hubs)),
            );
            exts.insert(
                "ANDROID_xr_scenecore".to_string(),
                serde_json::Value::Object(as_map(xr_scenecore)),
            );
            return Some((normalized.clone(), exts));
        }
    }

    let empty_xr = serde_json::Value::Object(serde_json::Map::new());
    let xr = xr_traits.or(xr_normalized.map(|_| &empty_xr))?;
    let mut normalized_xr = xr.clone();
    let traits_arr = xr.get("traits").and_then(|v| v.as_array());
    let has_trait = |name: &str| -> bool {
        traits_arr.map(|arr| arr.iter().any(|item| item.as_str() == Some(name))).unwrap_or(false)
    };
    let is_grabbable =
        xr.get("grabbable").and_then(|v| v.as_bool()).unwrap_or(false) || has_trait("grab");
    let is_scalable = xr
        .get("scalable")
        .and_then(|v| v.as_bool())
        .unwrap_or_else(|| xr.get("scalable").is_some())
        || has_trait("scale");
    if let Some(obj) = normalized_xr.as_object_mut() {
        if is_grabbable {
            obj.insert("grabbable".to_string(), json!(true));
        }
        if is_scalable {
            obj.insert("scalable".to_string(), json!(true));
        }
        if has_trait("billboard") && !obj.contains_key("billboard") {
            obj.insert("billboard".to_string(), json!("capsule"));
        }
    }

    // Prefer the canonical normalized traits computed by the shared
    // `xr-trait-schema.ts` (identical on web, Android and iOS).
    let extras_xr = xr_normalized.cloned().unwrap_or(normalized_xr.clone());
    let mut hubs_ext = serde_json::Map::new();
    let mut android_ext = serde_json::Map::new();
    if is_grabbable {
        hubs_ext.insert("grabbable".to_string(), json!({ "cursor": true, "hand": true }));
        android_ext.insert(
            "movable".to_string(),
            json!({
                "systemMovable": true,
                "scaleInZ": is_scalable,
            }),
        );
    }
    if let Some(bb) = normalized_xr.get("billboard") {
        if !bb.is_null() && bb.as_bool() != Some(false) {
            let only_y = bb.as_str() == Some("cylindrical") || bb.as_str() == Some("capsule");
            hubs_ext.insert("billboard".to_string(), json!({ "onlyY": only_y }));
            android_ext.insert("billboard".to_string(), json!({ "mode": bb }));
        }
    }
    if let Some(anchor_str) = xr.get("anchor").and_then(|a| a.as_str()) {
        let plane_type = if anchor_str == "vertical" { "VERTICAL" } else { "HORIZONTAL" };
        android_ext.insert(
            "anchor".to_string(),
            json!({ "planeType": plane_type, "semanticType": anchor_str.to_uppercase() }),
        );
    }
    if let Some(serde_json::Value::Object(canonical)) = xr_scenecore {
        android_ext = canonical.clone();
    }
    let mut node_exts = serde_json::Map::new();
    if !hubs_ext.is_empty() {
        node_exts.insert("MOZ_hubs_components".to_string(), serde_json::Value::Object(hubs_ext));
    }
    if !android_ext.is_empty() {
        node_exts
            .insert("ANDROID_xr_scenecore".to_string(), serde_json::Value::Object(android_ext));
    }
    Some((extras_xr, node_exts))
}

/// Serializes a SceneGraph into a complete, valid glTF 2.0 Binary (.glb) byte vector.
pub fn write_glb(scene: &SceneGraph) -> Result<Vec<u8>, String> {
    // Check the pooled scratch buffer out of the thread-local and put it back on
    // *every* exit path. Bailing out early with `?` (texture validation, JSON
    // serialization) used to drop the buffer on the floor, silently degrading the
    // pool to a fresh allocation for the remaining life of the thread.
    let mut bin_data = REUSABLE_BIN_BUFFER.with(|cell| std::mem::take(&mut *cell.borrow_mut()));
    bin_data.clear();

    let result = write_glb_into(scene, &mut bin_data);

    // Recycle with bounded high-watermark retention so one huge scene doesn't pin
    // its peak allocation for the lifetime of the thread.
    bin_data.clear();
    bin_data.shrink_to(MAX_REUSABLE_BIN_CAPACITY);
    REUSABLE_BIN_BUFFER.with(|cell| {
        *cell.borrow_mut() = bin_data;
    });

    result
}

/// Builds the GLB into `bin_data`, which the caller owns and recycles.
fn write_glb_into(scene: &SceneGraph, bin_data: &mut Vec<u8>) -> Result<Vec<u8>, String> {
    let mut buffer_views = Vec::new();

    let mut accessors = Vec::new();
    let mut meshes = Vec::new();
    let mut nodes = Vec::new();
    let mut materials = Vec::new();
    let mut textures = Vec::new();
    let mut images = Vec::new();
    let mut samplers = Vec::new();
    let mut texture_lookup = std::collections::HashMap::new();

    let mut extensions_used: Vec<&str> = Vec::new();
    let mut add_ext = |ext: &'static str| {
        if !extensions_used.contains(&ext) {
            extensions_used.push(ext);
        }
    };

    // 1. Process Materials
    for (i, mat) in scene.materials.iter().enumerate() {
        let mut pbr = json!({
            "baseColorFactor": [
                jnum(sanitize_finite(mat.base_color[0], 0.8)),
                jnum(sanitize_finite(mat.base_color[1], 0.8)),
                jnum(sanitize_finite(mat.base_color[2], 0.8)),
                jnum(sanitize_finite(mat.base_color[3], 1.0)),
            ],
            "metallicFactor": jnum(sanitize_finite(mat.metallic, 0.1)),
            "roughnessFactor": jnum(sanitize_finite(mat.roughness, 0.5)),
        });

        if let Some(ref uri) = mat.base_color_texture {
            if !uri.is_empty() {
                validate_texture_uri(uri)?;
                let tex_idx = if let Some(&idx) = texture_lookup.get(uri) {
                    idx
                } else {
                    if images.len() >= SECURITY_3D_MAX_TEXTURES {
                        return Err(format!(
                            "Scene exceeds SECURITY_3D_MAX_TEXTURES ({})",
                            SECURITY_3D_MAX_TEXTURES
                        ));
                    }
                    let img_idx = images.len();
                    images.push(json!({ "uri": uri }));
                    if samplers.is_empty() {
                        samplers.push(json!({
                            "magFilter": 9729,
                            "minFilter": 9987,
                            "wrapS": 10497,
                            "wrapT": 10497,
                        }));
                    }
                    let t_idx = textures.len();
                    textures.push(json!({
                        "sampler": 0,
                        "source": img_idx,
                    }));
                    texture_lookup.insert(uri.clone(), t_idx);
                    t_idx
                };
                pbr["baseColorTexture"] = json!({ "index": tex_idx });
            }
        }

        let mut mat_json = json!({
            "name": if mat.name.is_empty() { format!("Material_{}", i) } else { mat.name.clone() },
            "pbrMetallicRoughness": pbr,
            "doubleSided": mat.double_sided,
        });

        let mut mat_exts = serde_json::Map::new();
        let clearcoat = sanitize_finite(mat.clearcoat, 0.0);
        if clearcoat > 0.0 {
            add_ext("KHR_materials_clearcoat");
            mat_exts.insert(
                "KHR_materials_clearcoat".to_string(),
                json!({
                    "clearcoatFactor": jnum(clearcoat),
                    "clearcoatRoughnessFactor": jnum(sanitize_finite(mat.clearcoat_roughness, 0.0)),
                }),
            );
        }
        let transmission = sanitize_finite(mat.transmission, 0.0);
        if transmission > 0.0 {
            add_ext("KHR_materials_transmission");
            mat_exts.insert(
                "KHR_materials_transmission".to_string(),
                json!({
                    "transmissionFactor": jnum(transmission),
                }),
            );
        }
        let ior = sanitize_finite(mat.ior, 1.5);
        if (ior - 1.5).abs() > 1e-4 {
            add_ext("KHR_materials_ior");
            mat_exts.insert(
                "KHR_materials_ior".to_string(),
                json!({
                    "ior": jnum(ior),
                }),
            );
        }
        let thickness = sanitize_finite(mat.thickness, 0.0);
        if thickness > 0.0 {
            add_ext("KHR_materials_volume");
            mat_exts.insert(
                "KHR_materials_volume".to_string(),
                json!({
                    "thicknessFactor": jnum(thickness),
                }),
            );
        }
        if !mat_exts.is_empty() {
            mat_json["extensions"] = serde_json::Value::Object(mat_exts);
        }

        materials.push(mat_json);
    }

    if materials.is_empty() && !scene.meshes.is_empty() {
        // Create default material
        materials.push(json!({
            "name": "DefaultMaterial",
            "pbrMetallicRoughness": {
                "baseColorFactor": [0.8, 0.8, 0.8, 1.0],
                "metallicFactor": 0.1,
                "roughnessFactor": 0.5,
            },
            "doubleSided": true,
        }));
    }

    // Helper to align bin_data to 4-byte boundary
    fn align_bin_data(bin_data: &mut Vec<u8>) {
        while !bin_data.len().is_multiple_of(4) {
            bin_data.push(0);
        }
    }

    // With an explicit hierarchy (`scene.nodes`), meshes are written here and
    // referenced from the node pass below; otherwise (legacy engine assets) every
    // scene mesh becomes one flat node, in order.
    let hierarchical = !scene.nodes.is_empty();
    if scene.nodes.len() > MAX_SCENE_NODES {
        return Err(format!(
            "Scene exceeds maximum allowed nodes ({}/{})",
            scene.nodes.len(),
            MAX_SCENE_NODES
        ));
    }
    // Scene mesh index -> glTF mesh index (`None` for empty geometry).
    let mut mesh_map: Vec<Option<usize>> = Vec::with_capacity(scene.meshes.len());

    // 2. Process Meshes
    for (mesh_idx, mesh) in scene.meshes.iter().enumerate() {
        if mesh.positions.is_empty() {
            mesh_map.push(None);
            if !hierarchical {
                // Keep glTF node index == scene mesh index (KHR_interactivity
                // pointers and `nodeIndex` rely on it): emit a mesh-less node.
                nodes.push(json!({
                    "name": if mesh.name.is_empty() { format!("Node_{}", mesh_idx) } else { mesh.name.clone() },
                }));
            }
            continue;
        }

        let vertex_count = mesh.positions.len();

        // Attribute: POSITION
        align_bin_data(bin_data);
        let pos_offset = bin_data.len();
        let mut min_pos = [f32::MAX, f32::MAX, f32::MAX];
        let mut max_pos = [f32::MIN, f32::MIN, f32::MIN];

        for pos in &mesh.positions {
            for c in 0..3 {
                let val = sanitize_finite(pos[c], 0.0);
                if val < min_pos[c] {
                    min_pos[c] = val;
                }
                if val > max_pos[c] {
                    max_pos[c] = val;
                }
                bin_data.extend_from_slice(&val.to_le_bytes());
            }
        }
        for c in 0..3 {
            if !min_pos[c].is_finite() || min_pos[c] > max_pos[c] {
                min_pos[c] = 0.0;
                max_pos[c] = 0.0;
            }
        }
        let pos_len = bin_data.len() - pos_offset;
        let pos_bv_idx = buffer_views.len();
        buffer_views.push(json!({
            "buffer": 0,
            "byteOffset": pos_offset,
            "byteLength": pos_len,
            "target": TARGET_ARRAY_BUFFER,
        }));
        let pos_acc_idx = accessors.len();
        accessors.push(json!({
            "bufferView": pos_bv_idx,
            "byteOffset": 0,
            "componentType": COMPONENT_FLOAT,
            "count": vertex_count,
            "type": "VEC3",
            "min": [jnum(min_pos[0]), jnum(min_pos[1]), jnum(min_pos[2])],
            "max": [jnum(max_pos[0]), jnum(max_pos[1]), jnum(max_pos[2])],
        }));

        let mut attributes = json!({
            "POSITION": pos_acc_idx,
        });

        // glTF 2.0 requires every attribute accessor within a primitive to share the
        // same `count`. Trusting the raw JS array length here is what let a geometry
        // with a short `normal` attribute emit POSITION count=3 alongside NORMAL
        // count=2 — an asset that parses but is rejected by strict loaders
        // (Filament's gltfio, RealityKit, the Khronos validator).
        //
        // So: a longer attribute array is truncated to the vertex count, and a
        // shorter one drops the attribute altogether. Losing shading or texturing on
        // a malformed mesh degrades gracefully; emitting invalid glTF does not.

        // Attribute: NORMAL
        if mesh.normals.len() >= vertex_count {
            align_bin_data(bin_data);
            let norm_offset = bin_data.len();
            for norm in &mesh.normals[..vertex_count] {
                for &val in norm {
                    bin_data.extend_from_slice(&sanitize_finite(val, 0.0).to_le_bytes());
                }
            }
            let norm_len = bin_data.len() - norm_offset;
            let norm_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": norm_offset,
                "byteLength": norm_len,
                "target": TARGET_ARRAY_BUFFER,
            }));
            let norm_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": norm_bv_idx,
                "byteOffset": 0,
                "componentType": COMPONENT_FLOAT,
                "count": vertex_count,
                "type": "VEC3",
            }));
            attributes.as_object_mut().unwrap().insert("NORMAL".to_string(), json!(norm_acc_idx));
        }

        // Attribute: TEXCOORD_0
        if mesh.uvs.len() >= vertex_count {
            align_bin_data(bin_data);
            let uv_offset = bin_data.len();
            for uv in &mesh.uvs[..vertex_count] {
                for &val in uv {
                    bin_data.extend_from_slice(&sanitize_finite(val, 0.0).to_le_bytes());
                }
            }
            let uv_len = bin_data.len() - uv_offset;
            let uv_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": uv_offset,
                "byteLength": uv_len,
                "target": TARGET_ARRAY_BUFFER,
            }));
            let uv_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": uv_bv_idx,
                "byteOffset": 0,
                "componentType": COMPONENT_FLOAT,
                "count": vertex_count,
                "type": "VEC2",
            }));
            attributes.as_object_mut().unwrap().insert("TEXCOORD_0".to_string(), json!(uv_acc_idx));
        }

        // Indices
        let mut primitive = json!({
            "attributes": attributes,
        });

        if !mesh.indices.is_empty() {
            align_bin_data(bin_data);
            let idx_offset = bin_data.len();
            for idx in &mesh.indices {
                bin_data.extend_from_slice(&idx.to_le_bytes());
            }
            let idx_len = bin_data.len() - idx_offset;
            let idx_bv_idx = buffer_views.len();
            buffer_views.push(json!({
                "buffer": 0,
                "byteOffset": idx_offset,
                "byteLength": idx_len,
                "target": TARGET_ELEMENT_ARRAY_BUFFER,
            }));
            let idx_acc_idx = accessors.len();
            accessors.push(json!({
                "bufferView": idx_bv_idx,
                "byteOffset": 0,
                "componentType": COMPONENT_UNSIGNED_INT,
                "count": mesh.indices.len(),
                "type": "SCALAR",
            }));
            primitive.as_object_mut().unwrap().insert("indices".to_string(), json!(idx_acc_idx));
        }

        let mat_idx = mesh.material_index.unwrap_or(0);
        if mat_idx < materials.len() {
            primitive.as_object_mut().unwrap().insert("material".to_string(), json!(mat_idx));
        }
        if let Some(ref vm) = mesh.variant_mappings {
            if vm.is_object() {
                add_ext("KHR_materials_variants");
                primitive
                    .as_object_mut()
                    .unwrap()
                    .insert("extensions".to_string(), json!({ "KHR_materials_variants": vm }));
            }
        }

        let mesh_obj_idx = meshes.len();
        meshes.push(json!({
            "name": if mesh.name.is_empty() { format!("Mesh_{}", mesh_idx) } else { mesh.name.clone() },
            "primitives": [primitive],
        }));
        mesh_map.push(Some(mesh_obj_idx));
        if hierarchical {
            continue;
        }

        let mut node_json = json!({
            "name": if mesh.name.is_empty() { format!("Node_{}", mesh_idx) } else { mesh.name.clone() },
            "mesh": mesh_obj_idx,
        });
        let finite3 = |v: &[f32; 3]| v.iter().all(|c| c.is_finite());
        if finite3(&mesh.translation) && mesh.translation != [0.0, 0.0, 0.0] {
            node_json["translation"] = json!(mesh.translation);
        }
        if finite3(&mesh.scale) && mesh.scale != [1.0, 1.0, 1.0] {
            node_json["scale"] = json!(mesh.scale);
        }
        if let Some((extras_xr, node_exts)) = build_xr_payload(
            mesh.xr_traits.as_ref(),
            mesh.xr_normalized.as_ref(),
            mesh.xr_scenecore.as_ref(),
            mesh.xr_hubs.as_ref(),
            false,
        ) {
            node_json["extras"] = json!({ "xr": extras_xr });
            if node_exts.contains_key("MOZ_hubs_components") {
                add_ext("MOZ_hubs_components");
            }
            if node_exts.contains_key("ANDROID_xr_scenecore") {
                add_ext("ANDROID_xr_scenecore");
            }
            if !node_exts.is_empty() {
                node_json["extensions"] = serde_json::Value::Object(node_exts);
            }
        }
        nodes.push(node_json);
    }

    // 2b. Scene hierarchy: one glTF node per scene node, local TRS, children.
    let mut root_nodes: Vec<usize> = Vec::new();
    if hierarchical {
        let mut children: Vec<Vec<usize>> = vec![Vec::new(); scene.nodes.len()];
        for (i, node) in scene.nodes.iter().enumerate() {
            // `parent < i` is validated on extraction; re-check so a hand-built
            // SceneGraph can never describe a cycle.
            match node.parent {
                Some(p) if p < i => children[p].push(i),
                _ => root_nodes.push(i),
            }
        }
        for (i, node) in scene.nodes.iter().enumerate() {
            let mut node_json = json!({ "name": node.name });
            let t = node.translation.map(|c| sanitize_finite(c, 0.0));
            if t != [0.0, 0.0, 0.0] {
                node_json["translation"] = json!([jnum(t[0]), jnum(t[1]), jnum(t[2])]);
            }
            let r = if node.rotation.iter().all(|c| c.is_finite()) {
                node.rotation
            } else {
                [0.0, 0.0, 0.0, 1.0]
            };
            if r != [0.0, 0.0, 0.0, 1.0] {
                node_json["rotation"] = json!([jnum(r[0]), jnum(r[1]), jnum(r[2]), jnum(r[3])]);
            }
            let s = node.scale.map(|c| sanitize_finite(c, 1.0));
            if s != [1.0, 1.0, 1.0] {
                node_json["scale"] = json!([jnum(s[0]), jnum(s[1]), jnum(s[2])]);
            }
            if let Some(gltf_mesh) = node.mesh.and_then(|m| mesh_map.get(m).copied().flatten()) {
                node_json["mesh"] = json!(gltf_mesh);
            }
            if !children[i].is_empty() {
                node_json["children"] = json!(children[i]);
            }
            let mut merged_node_exts = serde_json::Map::new();
            if let Some((extras_xr, node_exts)) = build_xr_payload(
                node.xr_traits.as_ref(),
                node.xr_normalized.as_ref(),
                node.xr_scenecore.as_ref(),
                node.xr_hubs.as_ref(),
                true,
            ) {
                node_json["extras"] = json!({ "xr": extras_xr });
                if node_exts.contains_key("MOZ_hubs_components") {
                    add_ext("MOZ_hubs_components");
                }
                if node_exts.contains_key("ANDROID_xr_scenecore") {
                    add_ext("ANDROID_xr_scenecore");
                }
                for (k, v) in node_exts {
                    merged_node_exts.insert(k, v);
                }
            }
            let inst_count = node.instance_matrices.len() / 16;
            if inst_count > 0 {
                add_ext("EXT_mesh_gpu_instancing");
                align_bin_data(bin_data);
                let t_offset = bin_data.len();
                let mut rotations = Vec::with_capacity(inst_count);
                let mut scales = Vec::with_capacity(inst_count);
                for inst in 0..inst_count {
                    let (it, ir, is) =
                        decompose_mat4(&node.instance_matrices[inst * 16..(inst + 1) * 16]);
                    for &c in &it {
                        bin_data.extend_from_slice(&c.to_le_bytes());
                    }
                    rotations.push(ir);
                    scales.push(is);
                }
                let t_len = bin_data.len() - t_offset;
                let t_bv_idx = buffer_views.len();
                buffer_views.push(json!({
                    "buffer": 0,
                    "byteOffset": t_offset,
                    "byteLength": t_len,
                }));
                let t_acc_idx = accessors.len();
                accessors.push(json!({
                    "bufferView": t_bv_idx,
                    "byteOffset": 0,
                    "componentType": COMPONENT_FLOAT,
                    "count": inst_count,
                    "type": "VEC3",
                }));

                align_bin_data(bin_data);
                let r_offset = bin_data.len();
                for ir in &rotations {
                    for &c in ir {
                        bin_data.extend_from_slice(&c.to_le_bytes());
                    }
                }
                let r_len = bin_data.len() - r_offset;
                let r_bv_idx = buffer_views.len();
                buffer_views.push(json!({
                    "buffer": 0,
                    "byteOffset": r_offset,
                    "byteLength": r_len,
                }));
                let r_acc_idx = accessors.len();
                accessors.push(json!({
                    "bufferView": r_bv_idx,
                    "byteOffset": 0,
                    "componentType": COMPONENT_FLOAT,
                    "count": inst_count,
                    "type": "VEC4",
                }));

                align_bin_data(bin_data);
                let s_offset = bin_data.len();
                for is in &scales {
                    for &c in is {
                        bin_data.extend_from_slice(&c.to_le_bytes());
                    }
                }
                let s_len = bin_data.len() - s_offset;
                let s_bv_idx = buffer_views.len();
                buffer_views.push(json!({
                    "buffer": 0,
                    "byteOffset": s_offset,
                    "byteLength": s_len,
                }));
                let s_acc_idx = accessors.len();
                accessors.push(json!({
                    "bufferView": s_bv_idx,
                    "byteOffset": 0,
                    "componentType": COMPONENT_FLOAT,
                    "count": inst_count,
                    "type": "VEC3",
                }));

                let mut inst_attrs = json!({
                    "TRANSLATION": t_acc_idx,
                    "ROTATION": r_acc_idx,
                    "SCALE": s_acc_idx,
                });
                if node.instance_colors.len() >= inst_count * 3 {
                    align_bin_data(bin_data);
                    let c_offset = bin_data.len();
                    for c in &node.instance_colors[..inst_count * 3] {
                        bin_data.extend_from_slice(&sanitize_finite(*c, 1.0).to_le_bytes());
                    }
                    let c_len = bin_data.len() - c_offset;
                    let c_bv_idx = buffer_views.len();
                    buffer_views.push(json!({
                        "buffer": 0,
                        "byteOffset": c_offset,
                        "byteLength": c_len,
                    }));
                    let c_acc_idx = accessors.len();
                    accessors.push(json!({
                        "bufferView": c_bv_idx,
                        "byteOffset": 0,
                        "componentType": COMPONENT_FLOAT,
                        "count": inst_count,
                        "type": "VEC3",
                    }));
                    inst_attrs
                        .as_object_mut()
                        .unwrap()
                        .insert("_COLOR_0".to_string(), json!(c_acc_idx));
                }
                merged_node_exts.insert(
                    "EXT_mesh_gpu_instancing".to_string(),
                    json!({ "attributes": inst_attrs }),
                );
            }
            if !merged_node_exts.is_empty() {
                node_json["extensions"] = serde_json::Value::Object(merged_node_exts);
            }
            nodes.push(node_json);
        }
    } else {
        root_nodes.extend(0..nodes.len());
    }

    align_bin_data(bin_data);

    // The glTF 2.0 schema sets `minItems: 1` on every top-level array and requires
    // `buffer.byteLength >= 1`, so an empty collection has to be omitted rather than
    // written as `[]`. A script that threw early, produced no geometry, or was just a
    // comment would otherwise yield a GLB that parses as JSON but fails validation —
    // with AI-generated input that is a routine outcome, not an exotic one.
    let mut scene_obj = json!({ "name": "Scene" });
    if !root_nodes.is_empty() {
        scene_obj["nodes"] = json!(root_nodes);
    }

    let mut gltf_json = json!({
        "asset": {
            "version": "2.0",
            "generator": "Three-Live Compiler",
        },
        "scene": 0,
        "scenes": [scene_obj],
    });

    {
        let root = gltf_json
            .as_object_mut()
            .ok_or_else(|| "glTF root is not a JSON object".to_string())?;
        if !nodes.is_empty() {
            root.insert("nodes".to_string(), json!(nodes));
        }
        if !meshes.is_empty() {
            root.insert("meshes".to_string(), json!(meshes));
        }
        if !materials.is_empty() {
            root.insert("materials".to_string(), json!(materials));
        }
        if !accessors.is_empty() {
            root.insert("accessors".to_string(), json!(accessors));
        }
        if !buffer_views.is_empty() {
            root.insert("bufferViews".to_string(), json!(buffer_views));
        }
        if !bin_data.is_empty() {
            root.insert("buffers".to_string(), json!([{ "byteLength": bin_data.len() }]));
        }
        if !textures.is_empty() {
            root.insert("textures".to_string(), json!(textures));
            root.insert("images".to_string(), json!(images));
            root.insert("samplers".to_string(), json!(samplers));
        }
        let mut root_exts = serde_json::Map::new();
        if let Some(interactivity) = scene.interactivity.as_ref().filter(|v| v.is_object()) {
            if !extensions_used.contains(&"KHR_interactivity") {
                extensions_used.insert(0, "KHR_interactivity");
            }
            if interactivity.to_string().contains("KHR_node_visibility")
                && !extensions_used.contains(&"KHR_node_visibility")
            {
                extensions_used.push("KHR_node_visibility");
            }
            root_exts.insert("KHR_interactivity".to_string(), interactivity.clone());
        }
        if let Some(variants) = scene.variants.as_ref().filter(|v| v.is_object()) {
            if !extensions_used.contains(&"KHR_materials_variants") {
                extensions_used.push("KHR_materials_variants");
            }
            root_exts.insert("KHR_materials_variants".to_string(), variants.clone());
        }
        if !root_exts.is_empty() {
            root.insert("extensions".to_string(), serde_json::Value::Object(root_exts));
        }
        if !extensions_used.is_empty() {
            root.insert("extensionsUsed".to_string(), json!(extensions_used));
        }
    }

    // 3. Serialize JSON chunk with 4-byte space padding
    let mut padded_json = serde_json::to_vec(&gltf_json).map_err(|e| e.to_string())?;
    while !padded_json.len().is_multiple_of(4) {
        padded_json.push(0x20); // ASCII space
    }

    // 4. BIN chunk is already 4-byte aligned by `align_bin_data` above.
    debug_assert!(bin_data.len().is_multiple_of(4));

    // 5. Calculate total GLB size with checked arithmetic and heap ceiling
    let header_size = 12usize;
    let json_chunk_header_size = 8usize;
    let bin_chunk_header_size = if bin_data.is_empty() { 0 } else { 8usize };
    let total_size = header_size
        .checked_add(json_chunk_header_size)
        .and_then(|s| s.checked_add(padded_json.len()))
        .and_then(|s| s.checked_add(bin_chunk_header_size))
        .and_then(|s| s.checked_add(bin_data.len()))
        .ok_or_else(|| "GLB total size overflow".to_string())?;

    if total_size > SECURITY_3D_MAX_HEAP_BYTES {
        return Err(format!(
            "GLB output size ({} bytes) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
            total_size, SECURITY_3D_MAX_HEAP_BYTES
        ));
    }

    let total_size_u32 =
        u32::try_from(total_size).map_err(|_| "GLB total size exceeds u32::MAX".to_string())?;
    let json_len_u32 = u32::try_from(padded_json.len())
        .map_err(|_| "GLB JSON chunk size exceeds u32::MAX".to_string())?;

    let mut glb = Vec::with_capacity(total_size);

    // GLB Header (12 bytes)
    glb.extend_from_slice(&GLB_MAGIC.to_le_bytes());
    glb.extend_from_slice(&GLB_VERSION.to_le_bytes());
    glb.extend_from_slice(&total_size_u32.to_le_bytes());

    // JSON Chunk (8 bytes + payload)
    glb.extend_from_slice(&json_len_u32.to_le_bytes());
    glb.extend_from_slice(&CHUNK_TYPE_JSON.to_le_bytes());
    glb.extend_from_slice(&padded_json);

    // BIN Chunk (8 bytes + payload)
    if !bin_data.is_empty() {
        let bin_len_u32 = u32::try_from(bin_data.len())
            .map_err(|_| "GLB BIN chunk size exceeds u32::MAX".to_string())?;
        glb.extend_from_slice(&bin_len_u32.to_le_bytes());
        glb.extend_from_slice(&CHUNK_TYPE_BIN.to_le_bytes());
        glb.extend_from_slice(bin_data);
    }

    Ok(glb)
}
