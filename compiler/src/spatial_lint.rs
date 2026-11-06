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

//! Automated 3D Spatial, Frustum, Grounding, and Lighting Linter (`TL301–TL307`).

use crate::scene::{CameraConfig, Diagnostic, SceneGraph};
use serde::{Deserialize, Serialize};

/// Axis-aligned bounding box in world space (meters).
#[derive(Debug, Clone, Copy, Serialize, Deserialize, PartialEq)]
pub struct WorldAABB {
    pub min: [f32; 3],
    pub max: [f32; 3],
}

impl WorldAABB {
    pub fn empty() -> Self {
        Self { min: [f32::INFINITY; 3], max: [f32::NEG_INFINITY; 3] }
    }

    pub fn is_valid(&self) -> bool {
        self.min[0] <= self.max[0]
            && self.min[1] <= self.max[1]
            && self.min[2] <= self.max[2]
            && self.min.iter().all(|v| v.is_finite())
            && self.max.iter().all(|v| v.is_finite())
    }

    pub fn include_point(&mut self, p: [f32; 3]) {
        if !p[0].is_finite() || !p[1].is_finite() || !p[2].is_finite() {
            return;
        }
        for k in 0..3 {
            if p[k] < self.min[k] {
                self.min[k] = p[k];
            }
            if p[k] > self.max[k] {
                self.max[k] = p[k];
            }
        }
    }

    pub fn union(&mut self, other: &Self) {
        if !other.is_valid() {
            return;
        }
        self.include_point(other.min);
        self.include_point(other.max);
    }

    pub fn center(&self) -> [f32; 3] {
        [
            0.5 * (self.min[0] + self.max[0]),
            0.5 * (self.min[1] + self.max[1]),
            0.5 * (self.min[2] + self.max[2]),
        ]
    }

    pub fn size(&self) -> [f32; 3] {
        [
            (self.max[0] - self.min[0]).max(0.0),
            (self.max[1] - self.min[1]).max(0.0),
            (self.max[2] - self.min[2]).max(0.0),
        ]
    }

    pub fn diagonal(&self) -> f32 {
        let s = self.size();
        (s[0] * s[0] + s[1] * s[1] + s[2] * s[2]).sqrt()
    }

    pub fn volume(&self) -> f32 {
        let s = self.size();
        s[0] * s[1] * s[2]
    }

    pub fn contains_strictly(&self, p: [f32; 3]) -> bool {
        self.is_valid()
            && p[0] > self.min[0]
            && p[0] < self.max[0]
            && p[1] > self.min[1]
            && p[1] < self.max[1]
            && p[2] > self.min[2]
            && p[2] < self.max[2]
    }

    pub fn corners(&self) -> [[f32; 3]; 8] {
        let [x0, y0, z0] = self.min;
        let [x1, y1, z1] = self.max;
        [
            [x0, y0, z0],
            [x1, y0, z0],
            [x0, y1, z0],
            [x1, y1, z0],
            [x0, y0, z1],
            [x1, y0, z1],
            [x0, y1, z1],
            [x1, y1, z1],
        ]
    }

    pub fn rounded(&self) -> Self {
        Self { min: self.min.map(round3), max: self.max.map(round3) }
    }
}

/// Summary world bounds with `min`, `max`, `center`, and `size`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct SummaryWorldBounds {
    pub min: [f32; 3],
    pub max: [f32; 3],
    pub center: [f32; 3],
    pub size: [f32; 3],
}

/// Camera visibility summary in [`ValidationSummary`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct CameraSummary {
    pub fov: f32,
    pub position: [f32; 3],
    pub target: [f32; 3],
    pub visible_mesh_count: usize,
    pub occluded_or_offscreen_meshes: Vec<String>,
}

/// High-level scene summary in [`ValidationReport`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationSummary {
    pub mesh_count: usize,
    pub node_count: usize,
    pub vertex_count: usize,
    pub index_count: usize,
    pub material_count: usize,
    pub light_count: usize,
    pub has_interactivity: bool,
    pub world_bounds: Option<SummaryWorldBounds>,
    pub camera: CameraSummary,
}

/// Per-node spatial and trait report in [`ValidationReport`].
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct NodeSpatialReport {
    pub index: usize,
    pub name: String,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub mesh_index: Option<usize>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub world_bounds: Option<WorldAABB>,
    pub screen_coverage_pct: f32,
    pub in_frustum: bool,
    pub xr_traits: Vec<String>,
    pub interactivity_events: Vec<String>,
}

/// Full JSON output of `three-live-cli validate <input> --json`.
#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ValidationReport {
    pub valid: bool,
    pub input: String,
    pub execution_time_ms: f64,
    pub summary: Option<ValidationSummary>,
    pub nodes: Vec<NodeSpatialReport>,
    pub diagnostics: Vec<Diagnostic>,
}

#[inline]
fn round3(v: f32) -> f32 {
    if !v.is_finite() {
        return 0.0;
    }
    let r = (v * 1000.0).round() / 1000.0;
    if r == -0.0 {
        0.0
    } else {
        r
    }
}

#[inline]
fn round1(v: f32) -> f32 {
    if !v.is_finite() {
        return 0.0;
    }
    let r = (v * 10.0).round() / 10.0;
    if r == -0.0 {
        0.0
    } else {
        r
    }
}

/// Composes a column-major 4x4 matrix from translation, unit quaternion `[x, y, z, w]`, and scale.
pub fn mat4_from_trs(t: [f32; 3], q: [f32; 4], s: [f32; 3]) -> [f32; 16] {
    let [x, y, z, w] = q;
    let x2 = x + x;
    let y2 = y + y;
    let z2 = z + z;
    let xx = x * x2;
    let xy = x * y2;
    let xz = x * z2;
    let yy = y * y2;
    let yz = y * z2;
    let zz = z * z2;
    let wx = w * x2;
    let wy = w * y2;
    let wz = w * z2;

    let [sx, sy, sz] = s;
    [
        (1.0 - (yy + zz)) * sx,
        (xy + wz) * sx,
        (xz - wy) * sx,
        0.0,
        (xy - wz) * sy,
        (1.0 - (xx + zz)) * sy,
        (yz + wx) * sy,
        0.0,
        (xz + wy) * sz,
        (yz - wx) * sz,
        (1.0 - (xx + yy)) * sz,
        0.0,
        t[0],
        t[1],
        t[2],
        1.0,
    ]
}

/// Multiplies two column-major 4x4 matrices `a * b`.
pub fn mat4_mul(a: &[f32; 16], b: &[f32; 16]) -> [f32; 16] {
    let mut out = [0.0f32; 16];
    for col in 0..4 {
        for row in 0..4 {
            out[col * 4 + row] = a[row] * b[col * 4]
                + a[4 + row] * b[col * 4 + 1]
                + a[8 + row] * b[col * 4 + 2]
                + a[12 + row] * b[col * 4 + 3];
        }
    }
    out
}

/// Transforms a 3D point `[x, y, z, 1.0]` by a column-major 4x4 matrix.
#[inline]
pub fn mat4_transform_point(m: &[f32; 16], p: [f32; 3]) -> [f32; 3] {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
    ]
}

/// Transforms a 3D point `[x, y, z, 1.0]` into homogeneous clip coordinates `[cx, cy, cz, cw]`.
#[inline]
pub fn mat4_transform_vec4(m: &[f32; 16], p: [f32; 3]) -> [f32; 4] {
    [
        m[0] * p[0] + m[4] * p[1] + m[8] * p[2] + m[12],
        m[1] * p[0] + m[5] * p[1] + m[9] * p[2] + m[13],
        m[2] * p[0] + m[6] * p[1] + m[10] * p[2] + m[14],
        m[3] * p[0] + m[7] * p[1] + m[11] * p[2] + m[15],
    ]
}

/// Builds a right-handed view matrix looking from `eye` to `target`.
pub fn mat4_look_at(eye: [f32; 3], target: [f32; 3], up_hint: [f32; 3]) -> [f32; 16] {
    let mut fx = target[0] - eye[0];
    let mut fy = target[1] - eye[1];
    let mut fz = target[2] - eye[2];
    let flen = (fx * fx + fy * fy + fz * fz).sqrt();
    if flen > 1e-6 {
        fx /= flen;
        fy /= flen;
        fz /= flen;
    } else {
        fx = 0.0;
        fy = 0.0;
        fz = -1.0;
    }

    // Choose non-collinear up vector
    let mut ux = up_hint[0];
    let mut uy = up_hint[1];
    let mut uz = up_hint[2];
    let dot_up = fx * ux + fy * uy + fz * uz;
    if dot_up.abs() > 0.999 {
        ux = 0.0;
        uy = 0.0;
        uz = if fz > 0.0 { 1.0 } else { -1.0 };
    }

    // s = normalize(cross(f, up))
    let mut sx = fy * uz - fz * uy;
    let mut sy = fz * ux - fx * uz;
    let mut sz = fx * uy - fy * ux;
    let slen = (sx * sx + sy * sy + sz * sz).sqrt();
    if slen > 1e-6 {
        sx /= slen;
        sy /= slen;
        sz /= slen;
    } else {
        sx = 1.0;
        sy = 0.0;
        sz = 0.0;
    }

    // u = cross(s, f)
    let upx = sy * fz - sz * fy;
    let upy = sz * fx - sx * fz;
    let upz = sx * fy - sy * fx;

    [
        sx,
        upx,
        -fx,
        0.0,
        sy,
        upy,
        -fy,
        0.0,
        sz,
        upz,
        -fz,
        0.0,
        -(sx * eye[0] + sy * eye[1] + sz * eye[2]),
        -(upx * eye[0] + upy * eye[1] + upz * eye[2]),
        fx * eye[0] + fy * eye[1] + fz * eye[2],
        1.0,
    ]
}

/// Builds a right-handed OpenGL/glTF perspective projection matrix (`NDC z in [-1, 1]`).
pub fn mat4_perspective(fov_y_deg: f32, aspect: f32, near: f32, far: f32) -> [f32; 16] {
    let fov_rad = fov_y_deg.clamp(5.0, 175.0).to_radians();
    let f = 1.0 / (0.5 * fov_rad).tan();
    let a = if aspect.abs() > 1e-4 { aspect } else { 1.0 };
    let nf = 1.0 / (near - far);
    [
        f / a,
        0.0,
        0.0,
        0.0,
        0.0,
        f,
        0.0,
        0.0,
        0.0,
        0.0,
        (far + near) * nf,
        -1.0,
        0.0,
        0.0,
        2.0 * far * near * nf,
        0.0,
    ]
}

/// Computes world-space 4x4 matrices for every node in `scene.nodes` (or one per mesh for legacy
/// flat scenes).
pub fn compute_node_world_matrices(scene: &SceneGraph) -> Vec<[f32; 16]> {
    if !scene.nodes.is_empty() {
        let mut world = Vec::with_capacity(scene.nodes.len());
        for (i, n) in scene.nodes.iter().enumerate() {
            let local = mat4_from_trs(n.translation, n.rotation, n.scale);
            let w = match n.parent {
                Some(p) if p < i => mat4_mul(&world[p], &local),
                _ => local,
            };
            world.push(w);
        }
        world
    } else {
        scene
            .meshes
            .iter()
            .map(|m| mat4_from_trs(m.translation, [0.0, 0.0, 0.0, 1.0], m.scale))
            .collect()
    }
}

/// Computes the exact world-space AABB for each node that has a mesh.
pub fn compute_node_world_aabbs(
    scene: &SceneGraph,
    world_matrices: &[[f32; 16]],
) -> Vec<Option<WorldAABB>> {
    if !scene.nodes.is_empty() {
        let mut aabbs = Vec::with_capacity(scene.nodes.len());
        for (i, node) in scene.nodes.iter().enumerate() {
            let Some(m_idx) = node.mesh else {
                aabbs.push(None);
                continue;
            };
            let Some(mesh) = scene.meshes.get(m_idx) else {
                aabbs.push(None);
                continue;
            };
            if mesh.positions.is_empty() {
                aabbs.push(None);
                continue;
            }
            let mut aabb = WorldAABB::empty();
            let base_world = &world_matrices[i];
            let inst_count = node.instance_matrices.len() / 16;
            if inst_count > 0 {
                for inst in 0..inst_count {
                    let slice = &node.instance_matrices[inst * 16..(inst + 1) * 16];
                    let mut im = [0.0f32; 16];
                    im.copy_from_slice(slice);
                    let m = mat4_mul(base_world, &im);
                    for &p in &mesh.positions {
                        aabb.include_point(mat4_transform_point(&m, p));
                    }
                }
            } else {
                for &p in &mesh.positions {
                    aabb.include_point(mat4_transform_point(base_world, p));
                }
            }
            aabbs.push(if aabb.is_valid() { Some(aabb) } else { None });
        }
        aabbs
    } else {
        scene
            .meshes
            .iter()
            .enumerate()
            .map(|(i, mesh)| {
                if mesh.positions.is_empty() {
                    return None;
                }
                let mut aabb = WorldAABB::empty();
                let m = &world_matrices[i];
                for &p in &mesh.positions {
                    aabb.include_point(mat4_transform_point(m, p));
                }
                if aabb.is_valid() {
                    Some(aabb)
                } else {
                    None
                }
            })
            .collect()
    }
}

const AABB_EDGES: [(usize, usize); 12] = [
    (0, 1),
    (2, 3),
    (4, 5),
    (6, 7),
    (0, 2),
    (1, 3),
    (4, 6),
    (5, 7),
    (0, 4),
    (1, 5),
    (2, 6),
    (3, 7),
];

/// Projects a [`WorldAABB`] through `vp = proj * view`, clipping AABB edges against the
/// near plane `w = near` so large meshes (such as floors extending behind the camera)
/// are accurately classified. Returns `(in_frustum, screen_coverage_pct, offscreen_directions)`.
pub fn project_aabb_frustum(
    aabb: &WorldAABB,
    vp: &[f32; 16],
    near: f32,
) -> (bool, f32, Vec<&'static str>) {
    let corners = aabb.corners();
    let clip_corners: [[f32; 4]; 8] = corners.map(|c| mat4_transform_vec4(vp, c));

    let mut ndc_min_x = f32::INFINITY;
    let mut ndc_max_x = f32::NEG_INFINITY;
    let mut ndc_min_y = f32::INFINITY;
    let mut ndc_max_y = f32::NEG_INFINITY;
    let mut ndc_min_z = f32::INFINITY;
    let mut ndc_max_z = f32::NEG_INFINITY;
    let mut any_in_front = false;

    let mut add_clip_pt = |c: [f32; 4]| {
        if c[3] >= near {
            any_in_front = true;
            let inv_w = 1.0 / c[3];
            let nx = c[0] * inv_w;
            let ny = c[1] * inv_w;
            let nz = c[2] * inv_w;
            ndc_min_x = ndc_min_x.min(nx);
            ndc_max_x = ndc_max_x.max(nx);
            ndc_min_y = ndc_min_y.min(ny);
            ndc_max_y = ndc_max_y.max(ny);
            ndc_min_z = ndc_min_z.min(nz);
            ndc_max_z = ndc_max_z.max(nz);
        }
    };

    for &cc in &clip_corners {
        add_clip_pt(cc);
    }

    // Clip the 12 AABB edges against w = near so edges crossing the camera plane contribute
    for &(i0, i1) in &AABB_EDGES {
        let a = clip_corners[i0];
        let b = clip_corners[i1];
        if (a[3] < near && b[3] >= near) || (b[3] < near && a[3] >= near) {
            let denom = b[3] - a[3];
            if denom.abs() > 1e-6 {
                let t = ((near - a[3]) / denom).clamp(0.0, 1.0);
                let interp = [
                    a[0] + t * (b[0] - a[0]),
                    a[1] + t * (b[1] - a[1]),
                    a[2] + t * (b[2] - a[2]),
                    near,
                ];
                add_clip_pt(interp);
            }
        }
    }

    if !any_in_front {
        return (false, 0.0, vec!["behind"]);
    }

    let mut dirs = Vec::new();
    if ndc_max_x < -1.0 {
        dirs.push("left");
    }
    if ndc_min_x > 1.0 {
        dirs.push("right");
    }
    if ndc_max_y < -1.0 {
        dirs.push("below");
    }
    if ndc_min_y > 1.0 {
        dirs.push("above");
    }
    if ndc_min_z > 1.0 {
        dirs.push("beyond-far");
    }

    if !dirs.is_empty() {
        return (false, 0.0, dirs);
    }

    let clamped_w = (ndc_max_x.min(1.0) - ndc_min_x.max(-1.0)).max(0.0);
    let clamped_h = (ndc_max_y.min(1.0) - ndc_min_y.max(-1.0)).max(0.0);
    let coverage_pct = ((clamped_w * clamped_h) / 4.0) * 100.0;

    (true, round1(coverage_pct), dirs)
}

fn is_environment_or_container_name(name: &str) -> bool {
    let lower = name.to_ascii_lowercase();
    const ENV_KEYWORDS: &[&str] = &[
        "sky",
        "room",
        "env",
        "dome",
        "bounds",
        "zone",
        "trigger",
        "corridor",
        "hall",
        "interior",
        "warehouse",
        "arena",
        "stage",
        "background",
        "shell",
    ];
    ENV_KEYWORDS.iter().any(|kw| lower.contains(kw))
}

/// Pure function that selects the active 0-based LOD child index for a given distance,
/// or `-1` when culled beyond `cull_distance`.
///
/// Supports both:
/// - `distances[0] == 0.0` (`[0.0, 3.0, 8.0]` for 3 children: `<3 -> 0`, `[3,8) -> 1`, `>=8 -> 2`)
/// - `distances[0] > 0.0` (`[3.0, 8.0]` switch thresholds for 3 children: `<3 -> 0`, `[3,8) -> 1`,
///   `>=8 -> 2`)
pub fn select_lod_level_index(
    distance: f32,
    distances: &[f32],
    cull_distance: Option<f32>,
) -> isize {
    if distances.is_empty() {
        return -1;
    }
    if let Some(cull) = cull_distance {
        if cull > 0.0 && distance > cull {
            return -1;
        }
    }
    let starts_at_zero = distances[0] <= 1e-4;
    if starts_at_zero {
        let mut active: isize = 0;
        for (i, &d) in distances.iter().enumerate() {
            if distance >= d {
                active = i as isize;
            } else {
                break;
            }
        }
        active
    } else {
        let mut active: isize = 0;
        for (i, &d) in distances.iter().enumerate() {
            if distance >= d {
                active = (i + 1) as isize;
            } else {
                break;
            }
        }
        active
    }
}

/// Returns `Some((distances, cull_distance))` when `node` carries an `xr.lod` trait.
pub fn extract_node_lod_config(node: &crate::scene::SceneNode) -> Option<(Vec<f32>, Option<f32>)> {
    let xr = node.xr_normalized.as_ref().or(node.xr_traits.as_ref())?.as_object()?;
    let lod = xr.get("lod")?.as_object()?;
    let mut distances = Vec::new();
    if let Some(arr) = lod.get("distances").and_then(|v| v.as_array()) {
        for item in arr {
            if let Some(d) = item.as_f64() {
                let df = d as f32;
                if df.is_finite() && df >= 0.0 {
                    distances.push(df);
                }
            }
        }
    } else if let Some(levels) = lod.get("levels").and_then(|v| v.as_array()) {
        for item in levels {
            if let Some(d) =
                item.as_object().and_then(|o| o.get("distance")).and_then(|v| v.as_f64())
            {
                let df = d as f32;
                if df.is_finite() && df >= 0.0 {
                    distances.push(df);
                }
            }
        }
    }
    let cull_distance = lod
        .get("cullDistance")
        .or_else(|| lod.get("cull_distance"))
        .and_then(|v| v.as_f64())
        .map(|d| d as f32)
        .filter(|d| d.is_finite() && *d > 0.0);
    Some((distances, cull_distance))
}

/// Computes effective visibility for every node in `scene` from camera position `eye_pos`,
/// evaluating `xr.lod` distance thresholds on LOD parent containers and propagating parent
/// visibility down the hierarchy.
pub fn compute_effective_node_visibility(
    scene: &SceneGraph,
    world_matrices: &[[f32; 16]],
    eye_pos: [f32; 3],
) -> Vec<bool> {
    if scene.nodes.is_empty() {
        return vec![true; scene.meshes.len()];
    }
    let n_len = scene.nodes.len();
    let mut vis: Vec<bool> = scene.nodes.iter().map(|n| n.visible).collect();
    let mut children: Vec<Vec<usize>> = vec![Vec::new(); n_len];
    for (i, node) in scene.nodes.iter().enumerate() {
        if let Some(p) = node.parent {
            if p < i {
                children[p].push(i);
            }
        }
    }

    for i in 0..n_len {
        if let Some((distances, cull_distance)) = extract_node_lod_config(&scene.nodes[i]) {
            if !distances.is_empty() {
                let m = &world_matrices[i];
                let dx = m[12] - eye_pos[0];
                let dy = m[13] - eye_pos[1];
                let dz = m[14] - eye_pos[2];
                let dist = (dx * dx + dy * dy + dz * dz).sqrt();
                let active_idx = select_lod_level_index(dist, &distances, cull_distance);
                if children[i].is_empty() {
                    if scene.nodes[i].mesh.is_some() {
                        vis[i] = active_idx >= 0;
                    }
                } else if active_idx < 0 {
                    for &child_idx in &children[i] {
                        vis[child_idx] = false;
                    }
                } else {
                    let clamped = (active_idx as usize).min(children[i].len() - 1);
                    for (k, &child_idx) in children[i].iter().enumerate() {
                        vis[child_idx] = k == clamped;
                    }
                }
            }
        }
    }

    for i in 0..n_len {
        if let Some(p) = scene.nodes[i].parent {
            if p < i && !vis[p] {
                vis[i] = false;
            }
        }
    }
    vis
}

/// Runs the Phase 2 spatial, frustum, grounding, and lighting linter (`TL301–TL307`) on `scene`
/// and produces the full [`ValidationReport`].
pub fn build_validation_report(
    input: &str,
    execution_time_ms: f64,
    scene_opt: Option<&SceneGraph>,
    base_diagnostics: Vec<Diagnostic>,
) -> ValidationReport {
    let mut diagnostics = base_diagnostics;

    let Some(scene) = scene_opt else {
        return ValidationReport {
            valid: false,
            input: input.to_string(),
            execution_time_ms,
            summary: None,
            nodes: Vec::new(),
            diagnostics,
        };
    };

    let cam = scene.camera.clone().unwrap_or(CameraConfig {
        fov: 45.0,
        position: [0.0, 2.0, 5.0],
        target: [0.0, 0.0, 0.0],
    });

    // TL301: Empty Scene
    if scene.meshes.is_empty() {
        diagnostics.push(Diagnostic {
            code: "TL301".to_string(),
            severity: "error".to_string(),
            message: "Scene contains 0 meshes.".to_string(),
            node: None,
            line: None,
            column: None,
            hint: Some("No meshes were added to scene. Call scene.add(mesh).".to_string()),
        });
    }

    let world_matrices = compute_node_world_matrices(scene);
    let node_aabbs = compute_node_world_aabbs(scene, &world_matrices);
    let effective_vis = compute_effective_node_visibility(scene, &world_matrices, cam.position);

    let mut scene_aabb = WorldAABB::empty();
    for (idx, aabb_opt) in node_aabbs.iter().enumerate() {
        if effective_vis.get(idx).copied().unwrap_or(true) {
            if let Some(aabb) = aabb_opt {
                scene_aabb.union(aabb);
            }
        }
    }
    // Fallback if all nodes were culled at cam.position
    if !scene_aabb.is_valid() {
        for aabb in node_aabbs.iter().flatten() {
            scene_aabb.union(aabb);
        }
    }

    let view = mat4_look_at(cam.position, cam.target, [0.0, 1.0, 0.0]);
    let proj = mat4_perspective(cam.fov, 1.0, 0.1, 1000.0);
    let vp = mat4_mul(&proj, &view);

    let mut visible_mesh_count = 0usize;
    let mut offscreen_meshes = Vec::new();
    let mut node_reports = Vec::new();

    let node_len = if !scene.nodes.is_empty() { scene.nodes.len() } else { scene.meshes.len() };

    for i in 0..node_len {
        let (node_name, mesh_idx, xr_traits_val, inter_events, parent_idx) =
            if !scene.nodes.is_empty() {
                let n = &scene.nodes[i];
                let fallback_name = if !n.name.is_empty() {
                    n.name.clone()
                } else if let Some(m_idx) = n.mesh {
                    scene
                        .meshes
                        .get(m_idx)
                        .map(|m| m.name.clone())
                        .unwrap_or_else(|| format!("Node_{}", i))
                } else {
                    format!("Node_{}", i)
                };
                (
                    fallback_name,
                    n.mesh,
                    n.xr_normalized.as_ref().or(n.xr_traits.as_ref()),
                    n.interactivity_events.clone(),
                    n.parent,
                )
            } else {
                let m = &scene.meshes[i];
                (
                    m.name.clone(),
                    Some(i),
                    m.xr_normalized.as_ref().or(m.xr_traits.as_ref()),
                    Vec::new(),
                    None,
                )
            };

        let xr_keys: Vec<String> = xr_traits_val
            .and_then(|v| v.as_object())
            .map(|obj| {
                let mut keys: Vec<String> = obj
                    .keys()
                    .filter(|k| *k != "grabbable" && *k != "scalable" && *k != "traits")
                    .cloned()
                    .collect();
                keys.sort();
                keys
            })
            .unwrap_or_default();

        let has_zone_trait = xr_keys.iter().any(|k| k == "zone" || k == "navigable");
        let is_explicit_floor_grounded = xr_traits_val
            .and_then(|v| v.as_object())
            .map(|obj| {
                let has_char = obj.contains_key("character");
                let has_walkable =
                    obj.get("navigable").and_then(|v| v.as_str()) == Some("walkable");
                let anchor_floor = match obj.get("anchor") {
                    Some(serde_json::Value::String(s)) => {
                        s.eq_ignore_ascii_case("floor") || s.eq_ignore_ascii_case("horizontal")
                    }
                    Some(serde_json::Value::Object(a)) => a
                        .get("target")
                        .and_then(|t| t.as_str())
                        .map(|s| {
                            s.eq_ignore_ascii_case("floor") || s.eq_ignore_ascii_case("horizontal")
                        })
                        .unwrap_or(false),
                    _ => false,
                };
                has_char || has_walkable || anchor_floor
            })
            .unwrap_or(false);

        if let Some(aabb) = node_aabbs.get(i).and_then(|a| *a) {
            let is_vis = effective_vis.get(i).copied().unwrap_or(true);
            let (in_frustum, coverage_pct, off_dirs) = project_aabb_frustum(&aabb, &vp, 0.1);
            if mesh_idx.is_some() && is_vis {
                if in_frustum {
                    visible_mesh_count += 1;
                } else {
                    offscreen_meshes.push(node_name.clone());
                    let dir_str = off_dirs.join(", ");
                    let c = aabb.center();
                    diagnostics.push(Diagnostic {
                        code: "TL303".to_string(),
                        severity: "warning".to_string(),
                        message: format!(
                            "Mesh '{}' (center [{:.2}, {:.2}, {:.2}]) is completely outside the camera frustum ({}).",
                            node_name, c[0], c[1], c[2], dir_str
                        ),
                        node: Some(node_name.clone()),
                        line: None,
                        column: None,
                        hint: Some(format!(
                            "Adjust '{}'.position or camera.position / camera.lookAt() to bring the mesh into view (currently {}).",
                            node_name, dir_str
                        )),
                    });
                }

                // TL302: Camera strictly inside opaque non-environment mesh AABB
                let is_opaque = mesh_idx
                    .and_then(|m_idx| scene.meshes.get(m_idx))
                    .and_then(|m| m.material_index)
                    .and_then(|mat_idx| scene.materials.get(mat_idx))
                    .map(|mat| mat.base_color[3] >= 0.95 && mat.transmission < 0.1)
                    .unwrap_or(true);

                if is_opaque
                    && !has_zone_trait
                    && !is_environment_or_container_name(&node_name)
                    && aabb.contains_strictly(cam.position)
                {
                    diagnostics.push(Diagnostic {
                        code: "TL302".to_string(),
                        severity: "warning".to_string(),
                        message: format!(
                            "Camera at [{:.2}, {:.2}, {:.2}] is inside mesh '{}' (AABB [{:.2}..{:.2}, {:.2}..{:.2}, {:.2}..{:.2}]).",
                            cam.position[0],
                            cam.position[1],
                            cam.position[2],
                            node_name,
                            aabb.min[0],
                            aabb.max[0],
                            aabb.min[1],
                            aabb.max[1],
                            aabb.min[2],
                            aabb.max[2]
                        ),
                        node: Some(node_name.clone()),
                        line: None,
                        column: None,
                        hint: Some(
                            "Move the mesh to -Z or move camera.position back so the camera is outside the mesh."
                                .to_string(),
                        ),
                    });
                }

                // Per-node TL307 check for explicitly floor-grounded traits (character, walkable,
                // anchor: floor)
                if is_explicit_floor_grounded && aabb.min[1].abs() > 0.03 {
                    let min_y = aabb.min[1];
                    let state = if min_y > 0.0 {
                        format!("floating {:.3}m above", min_y)
                    } else {
                        format!("buried {:.3}m below", -min_y)
                    };
                    diagnostics.push(Diagnostic {
                        code: "TL307".to_string(),
                        severity: "info".to_string(),
                        message: format!(
                            "Floor-grounded node '{}' has base at y = {:.3}m ({} the y = 0.0m floor plane).",
                            node_name, min_y, state
                        ),
                        node: Some(node_name.clone()),
                        line: None,
                        column: None,
                        hint: Some(format!(
                            "Set '{}'.position.y so its bottom rests on y = 0.0m.",
                            node_name
                        )),
                    });
                }
            }

            node_reports.push(NodeSpatialReport {
                index: i,
                name: node_name,
                mesh_index: mesh_idx,
                world_bounds: Some(aabb.rounded()),
                screen_coverage_pct: if is_vis { coverage_pct } else { 0.0 },
                in_frustum: is_vis && in_frustum,
                xr_traits: xr_keys,
                interactivity_events: inter_events,
            });
        } else {
            let _ = parent_idx;
            node_reports.push(NodeSpatialReport {
                index: i,
                name: node_name,
                mesh_index: mesh_idx,
                world_bounds: None,
                screen_coverage_pct: 0.0,
                in_frustum: false,
                xr_traits: xr_keys,
                interactivity_events: inter_events,
            });
        }
    }

    // TL304: Sub-Pixel / Giant Scale Mismatch
    if scene_aabb.is_valid() {
        let diag = scene_aabb.diagonal();
        if diag > 0.0 && diag < 0.01 {
            diagnostics.push(Diagnostic {
                code: "TL304".to_string(),
                severity: "warning".to_string(),
                message: format!(
                    "Total scene AABB diagonal is {:.4}m (< 0.01m / 1cm microscopic scale).",
                    diag
                ),
                node: None,
                line: None,
                column: None,
                hint: Some(format!(
                    "WebXR and Three-Live use 1 unit = 1 meter. Scene diagonal is {:.4}m; scale up to meter units.",
                    diag
                )),
            });
        } else if diag > 200.0 {
            diagnostics.push(Diagnostic {
                code: "TL304".to_string(),
                severity: "warning".to_string(),
                message: format!(
                    "Total scene AABB diagonal is {:.1}m (> 200m, likely authored in millimeters instead of meters).",
                    diag
                ),
                node: None,
                line: None,
                column: None,
                hint: Some(format!(
                    "WebXR and Three-Live use 1 unit = 1 meter. Scene diagonal is {:.1}m; scale down by 0.001 if authored in millimeters.",
                    diag
                )),
            });
        }
    }

    // TL305: Unlit Metallic / Dark PBR Scene
    if scene.lights.is_empty() && !scene.meshes.is_empty() {
        let mut dark_or_metallic_mesh: Option<String> = None;
        for m in &scene.meshes {
            let mat = m
                .material_index
                .and_then(|idx| scene.materials.get(idx))
                .cloned()
                .unwrap_or_default();
            let lum = 0.2126 * mat.base_color[0]
                + 0.7152 * mat.base_color[1]
                + 0.0722 * mat.base_color[2];
            if mat.metallic > 0.5 || lum < 0.18 {
                dark_or_metallic_mesh = Some(m.name.clone());
                break;
            }
        }
        if let Some(m_name) = dark_or_metallic_mesh {
            diagnostics.push(Diagnostic {
                code: "TL305".to_string(),
                severity: "warning".to_string(),
                message: format!(
                    "Scene contains metallic or dark PBR material (on mesh '{}') with 0 lights in scene.",
                    m_name
                ),
                node: Some(m_name),
                line: None,
                column: None,
                hint: Some(
                    "Add a THREE.DirectionalLight and THREE.AmbientLight so PBR materials are visible."
                        .to_string(),
                ),
            });
        }
    }

    // TL306: Unintended Sibling Mesh Interpenetration or Coplanar Z-Fighting
    for i in 0..node_len {
        if !effective_vis.get(i).copied().unwrap_or(true) {
            continue;
        }
        let Some(aabb_a) = node_aabbs.get(i).and_then(|a| *a) else {
            continue;
        };
        let Some(mesh_a_idx) = node_reports[i].mesh_index else {
            continue;
        };
        if node_reports[i].xr_traits.iter().any(|k| k == "zone") {
            continue;
        }
        let parent_a = scene.nodes.get(i).and_then(|n| n.parent);
        if parent_a.and_then(|p| scene.nodes.get(p)).and_then(extract_node_lod_config).is_some() {
            continue;
        }
        let mat_a = scene.meshes.get(mesh_a_idx).and_then(|m| m.material_index);
        let is_opaque_a = mat_a
            .and_then(|m_idx| scene.materials.get(m_idx))
            .map(|mat| mat.base_color[3] >= 0.95 && mat.transmission < 0.1)
            .unwrap_or(true);
        if !is_opaque_a {
            continue;
        }
        let vol_a = aabb_a.volume();
        let sa = aabb_a.size();
        let ca = aabb_a.center();

        for j in (i + 1)..node_len {
            if !effective_vis.get(j).copied().unwrap_or(true) {
                continue;
            }
            let Some(aabb_b) = node_aabbs.get(j).and_then(|a| *a) else {
                continue;
            };
            let Some(mesh_b_idx) = node_reports[j].mesh_index else {
                continue;
            };
            if node_reports[j].xr_traits.iter().any(|k| k == "zone") {
                continue;
            }
            let parent_b = scene.nodes.get(j).and_then(|n| n.parent);
            if parent_a != parent_b {
                continue;
            }
            let mat_b = scene.meshes.get(mesh_b_idx).and_then(|m| m.material_index);
            let is_opaque_b = mat_b
                .and_then(|m_idx| scene.materials.get(m_idx))
                .map(|mat| mat.base_color[3] >= 0.95 && mat.transmission < 0.1)
                .unwrap_or(true);
            if !is_opaque_b {
                continue;
            }

            let ix = (aabb_a.max[0].min(aabb_b.max[0]) - aabb_a.min[0].max(aabb_b.min[0])).max(0.0);
            let iy = (aabb_a.max[1].min(aabb_b.max[1]) - aabb_a.min[1].max(aabb_b.min[1])).max(0.0);
            let iz = (aabb_a.max[2].min(aabb_b.max[2]) - aabb_a.min[2].max(aabb_b.min[2])).max(0.0);
            if ix <= 0.0 || iy <= 0.0 || iz <= 0.0 {
                continue;
            }

            let inter_vol = ix * iy * iz;
            let vol_b = aabb_b.volume();
            let min_vol = vol_a.min(vol_b);
            let max_vol = vol_a.max(vol_b);
            let sb = aabb_b.size();
            let cb = aabb_b.center();
            let same_proportion = (0..3).all(|k| {
                let mx = sa[k].max(sb[k]);
                mx > 1e-5 && (sa[k].min(sb[k]) / mx) >= 0.70
            });
            let center_dist =
                ((ca[0] - cb[0]).powi(2) + (ca[1] - cb[1]).powi(2) + (ca[2] - cb[2]).powi(2))
                    .sqrt();
            let min_diag = aabb_a.diagonal().min(aabb_b.diagonal());
            if min_vol > 1e-6
                && max_vol > 1e-6
                && (min_vol / max_vol) >= 0.50
                && same_proportion
                && center_dist <= min_diag * 0.15
                && (inter_vol / min_vol) > 0.80
            {
                let pct = ((inter_vol / min_vol) * 100.0).min(100.0);
                diagnostics.push(Diagnostic {
                    code: "TL306".to_string(),
                    severity: "info".to_string(),
                    message: format!(
                        "Sibling meshes '{}' and '{}' have {:.0}% volumetric AABB overlap.",
                        node_reports[i].name, node_reports[j].name, pct
                    ),
                    node: Some(node_reports[i].name.clone()),
                    line: None,
                    column: None,
                    hint: Some(
                        "Separate overlapping sibling meshes or use THREE.CSG boolean operations if intentional."
                            .to_string(),
                    ),
                });
                continue;
            }

            if mat_a != mat_b && same_proportion && center_dist <= min_diag * 0.15 {
                let max_yz = (sa[1] * sa[2]).max(sb[1] * sb[2]).max(1e-6);
                let max_xz = (sa[0] * sa[2]).max(sb[0] * sb[2]).max(1e-6);
                let max_xy = (sa[0] * sa[1]).max(sb[0] * sb[1]).max(1e-6);

                let coplanar_x = (aabb_a.min[0] - aabb_b.min[0]).abs() < 1e-4
                    && (aabb_a.max[0] - aabb_b.max[0]).abs() < 1e-4
                    && sa[0].max(sb[0]) <= 0.02
                    && (iy * iz) / max_yz > 0.80;
                let coplanar_y = (aabb_a.min[1] - aabb_b.min[1]).abs() < 1e-4
                    && (aabb_a.max[1] - aabb_b.max[1]).abs() < 1e-4
                    && sa[1].max(sb[1]) <= 0.02
                    && (ix * iz) / max_xz > 0.80;
                let coplanar_z = (aabb_a.min[2] - aabb_b.min[2]).abs() < 1e-4
                    && (aabb_a.max[2] - aabb_b.max[2]).abs() < 1e-4
                    && sa[2].max(sb[2]) <= 0.02
                    && (ix * iy) / max_xy > 0.80;
                if (coplanar_x && iy > 0.01 && iz > 0.01)
                    || (coplanar_y && ix > 0.01 && iz > 0.01)
                    || (coplanar_z && ix > 0.01 && iy > 0.01)
                {
                    diagnostics.push(Diagnostic {
                        code: "TL306".to_string(),
                        severity: "info".to_string(),
                        message: format!(
                            "Sibling meshes '{}' and '{}' share coplanar faces within 0.1mm with different materials (potential z-fighting).",
                            node_reports[i].name, node_reports[j].name
                        ),
                        node: Some(node_reports[i].name.clone()),
                        line: None,
                        column: None,
                        hint: Some(
                            "Offset decals, trim, or sub-panels by >= 0.002m (2mm) to avoid z-fighting."
                                .to_string(),
                        ),
                    });
                }
            }
        }
    }

    // TL307: Ground Plane Alignment (y = 0.0)
    if scene_aabb.is_valid() {
        let min_y = scene_aabb.min[1];
        if min_y.abs() > 0.02 {
            let state = if min_y > 0.0 {
                format!("floating {:.3}m above", min_y)
            } else {
                format!("buried {:.3}m below", -min_y)
            };
            diagnostics.push(Diagnostic {
                code: "TL307".to_string(),
                severity: "info".to_string(),
                message: format!(
                    "Scene lowest point is at y = {:.3}m ({} the y = 0.0m floor plane).",
                    min_y, state
                ),
                node: None,
                line: None,
                column: None,
                hint: Some(
                    "Align grounded props, characters, and walkable floors so their base rests at y = 0.0m."
                        .to_string(),
                ),
            });
        }
    }

    let world_bounds_summary = if scene_aabb.is_valid() {
        let r = scene_aabb.rounded();
        let c = scene_aabb.center().map(round3);
        let s = scene_aabb.size().map(round3);
        Some(SummaryWorldBounds { min: r.min, max: r.max, center: c, size: s })
    } else {
        None
    };

    let vertex_count: usize = scene.meshes.iter().map(|m| m.positions.len()).sum();
    let index_count: usize = scene.meshes.iter().map(|m| m.indices.len()).sum();
    let has_errors = diagnostics.iter().any(|d| d.severity == "error");

    ValidationReport {
        valid: !has_errors,
        input: input.to_string(),
        execution_time_ms,
        summary: Some(ValidationSummary {
            mesh_count: scene.meshes.len(),
            node_count: node_len,
            vertex_count,
            index_count,
            material_count: scene.materials.len(),
            light_count: scene.lights.len(),
            has_interactivity: scene.interactivity.is_some(),
            world_bounds: world_bounds_summary,
            camera: CameraSummary {
                fov: round1(cam.fov),
                position: cam.position.map(round3),
                target: cam.target.map(round3),
                visible_mesh_count,
                occluded_or_offscreen_meshes: offscreen_meshes,
            },
        }),
        nodes: node_reports,
        diagnostics,
    }
}
