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

//! Pure-Rust Headless PBR Software Rasterizer, 4-Up Quad Contact Sheet,
//! Temporal Filmstrip PNG, and Animated GIF89a Encoder (`three-live-cli render`).

use crate::scene::{CameraConfig, Light3D, Material3D, SceneGraph};
use crate::spatial_lint::{
    compute_effective_node_visibility, compute_node_world_aabbs, compute_node_world_matrices,
    mat4_look_at, mat4_mul, mat4_perspective, mat4_transform_point, mat4_transform_vec4, WorldAABB,
};
use crate::usdz::calculate_crc32;

/// Camera / viewport selection for headless rendering.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum RenderViewMode {
    Camera,
    Front,
    Top,
    Right,
    Iso,
    Quad,
}

/// Options for rendering a single frame or quad contact sheet.
#[derive(Debug, Clone)]
pub struct RenderOptions {
    pub width: u32,
    pub height: u32,
    pub view: RenderViewMode,
    pub show_grid: bool,
    pub show_annotations: bool,
    pub label_override: Option<String>,
}

impl Default for RenderOptions {
    fn default() -> Self {
        Self {
            width: 512,
            height: 512,
            view: RenderViewMode::Quad,
            show_grid: false,
            show_annotations: false,
            label_override: None,
        }
    }
}

/// Builds a right-handed orthographic projection matrix (`NDC x,y,z in [-1, 1]`).
pub fn mat4_ortho(left: f32, right: f32, bottom: f32, top: f32, near: f32, far: f32) -> [f32; 16] {
    let rl = (right - left).max(1e-5);
    let tb = (top - bottom).max(1e-5);
    let fn_diff = (far - near).max(1e-5);
    [
        2.0 / rl,
        0.0,
        0.0,
        0.0,
        0.0,
        2.0 / tb,
        0.0,
        0.0,
        0.0,
        0.0,
        -2.0 / fn_diff,
        0.0,
        -(right + left) / rl,
        -(top + bottom) / tb,
        -(far + near) / fn_diff,
        1.0,
    ]
}

#[inline]
fn normalize3(v: [f32; 3]) -> [f32; 3] {
    let len = (v[0] * v[0] + v[1] * v[1] + v[2] * v[2]).sqrt();
    if len > 1e-7 && len.is_finite() {
        [v[0] / len, v[1] / len, v[2] / len]
    } else {
        [0.0, 1.0, 0.0]
    }
}

#[inline]
fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

#[inline]
fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

#[inline]
fn mat4_normal_cofactor_and_det(m: &[f32; 16]) -> ([f32; 9], f32) {
    let c0 = [m[0], m[1], m[2]];
    let c1 = [m[4], m[5], m[6]];
    let c2 = [m[8], m[9], m[10]];
    let n0 = cross3(c1, c2);
    let n1 = cross3(c2, c0);
    let n2 = cross3(c0, c1);
    let det = dot3(c0, n0);
    let sign = if det < 0.0 { -1.0 } else { 1.0 };
    if det.abs() > 1e-8 && det.is_finite() {
        (
            [
                n0[0] * sign,
                n0[1] * sign,
                n0[2] * sign,
                n1[0] * sign,
                n1[1] * sign,
                n1[2] * sign,
                n2[0] * sign,
                n2[1] * sign,
                n2[2] * sign,
            ],
            sign,
        )
    } else {
        ([c0[0], c0[1], c0[2], c1[0], c1[1], c1[2], c2[0], c2[1], c2[2]], 1.0)
    }
}

#[inline]
fn mat3_transform_normal(nmat: &[f32; 9], d: [f32; 3]) -> [f32; 3] {
    normalize3([
        nmat[0] * d[0] + nmat[3] * d[1] + nmat[6] * d[2],
        nmat[1] * d[0] + nmat[4] * d[1] + nmat[7] * d[2],
        nmat[2] * d[0] + nmat[5] * d[1] + nmat[8] * d[2],
    ])
}

/// Evaluates Cook-Torrance metallic-roughness PBR + hemisphere studio lighting.
#[allow(clippy::too_many_arguments)]
fn shade_pbr_ext(
    world_pos: [f32; 3],
    normal: [f32; 3],
    view_pos: [f32; 3],
    mat: &Material3D,
    base_tex_linear: Option<[f32; 4]>,
    rough_scale: f32,
    metal_scale: f32,
    ao_factor: f32,
    emissive_add: [f32; 3],
    instance_tint: Option<[f32; 3]>,
    lights: &[Light3D],
) -> [u8; 4] {
    let mut base = [mat.base_color[0], mat.base_color[1], mat.base_color[2]];
    let mut base_alpha = mat.base_color[3];
    if let Some(bt) = base_tex_linear {
        base[0] *= bt[0];
        base[1] *= bt[1];
        base[2] *= bt[2];
        base_alpha *= bt[3];
    }
    if let Some(tint) = instance_tint {
        base[0] *= tint[0];
        base[1] *= tint[1];
        base[2] *= tint[2];
    }
    let metallic = (mat.metallic * metal_scale).clamp(0.0, 1.0);
    let roughness = (mat.roughness * rough_scale).clamp(0.08, 1.0);
    let ao = ao_factor.clamp(0.0, 1.0);
    let v = normalize3([
        view_pos[0] - world_pos[0],
        view_pos[1] - world_pos[1],
        view_pos[2] - world_pos[2],
    ]);
    let mut n = normal;
    if mat.double_sided && dot3(n, v) < 0.0 {
        n = [-n[0], -n[1], -n[2]];
    }
    let n_dot_v = dot3(n, v).max(0.001);

    // F0 dielectric = 0.04 blended with base_color for metals
    let f0 = [
        0.04 * (1.0 - metallic) + base[0] * metallic,
        0.04 * (1.0 - metallic) + base[1] * metallic,
        0.04 * (1.0 - metallic) + base[2] * metallic,
    ];
    let diffuse_albedo =
        [base[0] * (1.0 - metallic), base[1] * (1.0 - metallic), base[2] * (1.0 - metallic)];

    // Hemisphere ambient fill (sky +Z/+Y cool blue-white, ground warm slate)
    let hemi_t = (0.5 * (n[1] + 1.0)).clamp(0.0, 1.0);
    let sky_amb = [0.38f32, 0.44, 0.54];
    let gnd_amb = [0.16f32, 0.18, 0.22];
    let amb_scale = if lights.is_empty() { 0.85 } else { 0.45 };
    let mut lo = [0.0f32; 3];
    let headlight = 0.28 * n_dot_v;
    for c in 0..3 {
        let env = gnd_amb[c] + hemi_t * (sky_amb[c] - gnd_amb[c]) + headlight;
        // Metallic environment reflection approximation so metals aren't black
        let spec_env =
            f0[c] * (1.0 - 0.5 * roughness) * (0.45 + 0.55 * hemi_t + 0.35 * n_dot_v.powi(4));
        lo[c] = (diffuse_albedo[c] * env * ao + spec_env * (0.5 + 0.5 * ao)) * amb_scale;
    }

    let default_lights: [Light3D; 2] = [
        Light3D {
            light_type: "directional".to_string(),
            color: [1.0, 0.98, 0.95],
            ground_color: None,
            intensity: 1.35,
            position: [4.0, 7.0, 5.0],
            direction: None,
            range: 0.0,
            inner_cone_angle: 0.0,
            outer_cone_angle: 0.0,
        },
        Light3D {
            light_type: "directional".to_string(),
            color: [0.55, 0.70, 0.95],
            ground_color: None,
            intensity: 0.55,
            position: [-4.0, 3.0, -3.0],
            direction: None,
            range: 0.0,
            inner_cone_angle: 0.0,
            outer_cone_angle: 0.0,
        },
    ];
    let active_lights: &[Light3D] = if lights.is_empty() { &default_lights } else { lights };

    let alpha = roughness * roughness;
    let alpha2 = (alpha * alpha).max(0.0001);
    let k = ((roughness + 1.0) * (roughness + 1.0)) / 8.0;

    for light in active_lights {
        let lt = light.light_type.as_str();
        if lt == "ambient" {
            for c in 0..3 {
                lo[c] += diffuse_albedo[c] * light.color[c] * (light.intensity * 0.35);
            }
            continue;
        }
        if lt == "hemisphere" {
            let gnd = light.ground_color.unwrap_or([0.2, 0.2, 0.2]);
            let dir = if dot3(light.position, light.position) > 1e-12 {
                normalize3(light.position)
            } else {
                [0.0, 1.0, 0.0]
            };
            let w = (0.5 * (dot3(n, dir) + 1.0)).clamp(0.0, 1.0);
            for c in 0..3 {
                let irr = gnd[c] + w * (light.color[c] - gnd[c]);
                lo[c] += diffuse_albedo[c] * irr * (light.intensity * 0.55) * ao;
            }
            continue;
        }
        let (l, atten) = if lt == "point" {
            let dx = light.position[0] - world_pos[0];
            let dy = light.position[1] - world_pos[1];
            let dz = light.position[2] - world_pos[2];
            let d2 = (dx * dx + dy * dy + dz * dz).max(0.05);
            (normalize3([dx, dy, dz]), 1.0 / (1.0 + 0.08 * d2))
        } else if lt == "spot" {
            let dx = light.position[0] - world_pos[0];
            let dy = light.position[1] - world_pos[1];
            let dz = light.position[2] - world_pos[2];
            let d2 = (dx * dx + dy * dy + dz * dz).max(0.05);
            let l_dir = normalize3([dx, dy, dz]);
            let mut dist_atten = 1.0 / (1.0 + 0.08 * d2);
            if light.range > 0.0 {
                let d = d2.sqrt();
                let r_ratio = (d / light.range).clamp(0.0, 1.0);
                let r2 = r_ratio * r_ratio;
                let window = (1.0 - r2 * r2).max(0.0);
                dist_atten *= window * window;
            }
            let spot_dir = light.direction.map(normalize3).unwrap_or([0.0, -1.0, 0.0]);
            let cos_theta = dot3([-l_dir[0], -l_dir[1], -l_dir[2]], spot_dir);
            let outer = if light.outer_cone_angle > 0.0 {
                light.outer_cone_angle
            } else {
                std::f32::consts::FRAC_PI_3
            };
            let inner = light.inner_cone_angle.clamp(0.0, outer);
            let cos_outer = outer.cos();
            let cos_inner = inner.cos();
            let t = ((cos_theta - cos_outer) / (cos_inner - cos_outer).max(1e-4)).clamp(0.0, 1.0);
            let cone_atten = t * t * (3.0 - 2.0 * t);
            (l_dir, dist_atten * cone_atten)
        } else {
            (normalize3(light.position), 1.0)
        };

        let n_dot_l = dot3(n, l).max(0.0);
        if n_dot_l <= 0.0 {
            continue;
        }
        let h = normalize3([v[0] + l[0], v[1] + l[1], v[2] + l[2]]);
        let n_dot_h = dot3(n, h).max(0.0);
        let v_dot_h = dot3(v, h).max(0.0);

        // GGX D
        let denom = n_dot_h * n_dot_h * (alpha2 - 1.0) + 1.0;
        let d_ggx = alpha2 / (std::f32::consts::PI * denom * denom + 1e-5);
        // Smith G
        let g_v = n_dot_v / (n_dot_v * (1.0 - k) + k);
        let g_l = n_dot_l / (n_dot_l * (1.0 - k) + k);
        let g = g_v * g_l;

        let one_minus_vh5 = (1.0 - v_dot_h).clamp(0.0, 1.0).powi(5);
        let radiance_scale = light.intensity * atten * n_dot_l;

        for c in 0..3 {
            let f = f0[c] + (1.0 - f0[c]) * one_minus_vh5;
            let spec = (d_ggx * g * f) / (4.0 * n_dot_v * n_dot_l + 1e-4);
            let kd = (1.0 - f) * (1.0 - metallic);
            let diff = kd * diffuse_albedo[c] / std::f32::consts::PI;
            lo[c] += (diff + spec) * light.color[c] * radiance_scale;
        }
    }

    for c in 0..3 {
        if emissive_add[c].is_finite() && emissive_add[c] > 0.0 {
            lo[c] += emissive_add[c];
        }
    }

    // ACES / Neutral tone map + gamma 2.2
    let mut rgb = [0u8; 3];
    for c in 0..3 {
        let x = lo[c].max(0.0);
        let mapped = (x * (2.51 * x + 0.03)) / (x * (2.43 * x + 0.59) + 0.14);
        let srgb = mapped.clamp(0.0, 1.0).powf(1.0 / 2.2);
        rgb[c] = (srgb * 255.0).round() as u8;
    }
    let alpha_u8 = (base_alpha.clamp(0.15, 1.0) * 255.0).round() as u8;
    [rgb[0], rgb[1], rgb[2], alpha_u8]
}

fn shade_pbr(
    world_pos: [f32; 3],
    normal: [f32; 3],
    view_pos: [f32; 3],
    mat: &Material3D,
    instance_tint: Option<[f32; 3]>,
    lights: &[Light3D],
) -> [u8; 4] {
    shade_pbr_ext(
        world_pos,
        normal,
        view_pos,
        mat,
        None,
        1.0,
        1.0,
        1.0,
        mat.emissive_factor,
        instance_tint,
        lights,
    )
}

#[derive(Clone)]
struct DecodedTexture {
    width: usize,
    height: usize,
    rgba: Vec<[u8; 4]>,
    avg_srgb: [u8; 4],
}

impl DecodedTexture {
    #[inline]
    fn sample_srgb(&self, uv: [f32; 2]) -> [u8; 4] {
        if self.width == 0 || self.height == 0 || self.rgba.is_empty() {
            return [255, 255, 255, 255];
        }
        let u = if uv[0].is_finite() { uv[0].rem_euclid(1.0) } else { 0.0 };
        let v = if uv[1].is_finite() { uv[1].rem_euclid(1.0) } else { 0.0 };
        let x = ((u * self.width as f32) as usize).min(self.width - 1);
        let y = ((v * self.height as f32) as usize).min(self.height - 1);
        self.rgba[y * self.width + x]
    }
}

fn decode_base64_str(s: &str, max_bytes: usize) -> Option<Vec<u8>> {
    let mut out = Vec::with_capacity((s.len() * 3) / 4);
    let mut buf = 0u32;
    let mut bits = 0u8;
    for b in s.bytes() {
        let val = match b {
            b'A'..=b'Z' => b - b'A',
            b'a'..=b'z' => b - b'a' + 26,
            b'0'..=b'9' => b - b'0' + 52,
            b'+' => 62,
            b'/' => 63,
            b'=' => break,
            b' ' | b'\t' | b'\r' | b'\n' => continue,
            _ => return None,
        };
        buf = (buf << 6) | (val as u32);
        bits += 6;
        if bits >= 8 {
            bits -= 8;
            out.push(((buf >> bits) & 0xff) as u8);
            if out.len() > max_bytes {
                return None;
            }
        }
    }
    Some(out)
}

/// Decodes an inline stored-DEFLATE `data:image/png;base64,...` URI (as emitted by
/// `THREE.DataTexture`) into raw RGBA8 texels for software rasterization.
fn decode_stored_png_data_uri(uri: &str) -> Option<DecodedTexture> {
    let trimmed = uri.trim();
    let b64 = trimmed.strip_prefix("data:image/png;base64,")?;
    let png = decode_base64_str(b64, 2 * 1024 * 1024)?;
    if png.len() < 33 || &png[0..8] != b"\x89PNG\r\n\x1a\n" {
        return None;
    }

    let mut pos = 8usize;
    let mut width = 0usize;
    let mut height = 0usize;
    let mut color_type = 0u8;
    let mut idat = Vec::new();

    while pos + 12 <= png.len() {
        let len = u32::from_be_bytes([png[pos], png[pos + 1], png[pos + 2], png[pos + 3]]) as usize;
        let ctype = &png[pos + 4..pos + 8];
        let data_start = pos + 8;
        let data_end = data_start.checked_add(len)?;
        if data_end + 4 > png.len() {
            return None;
        }
        let data = &png[data_start..data_end];
        if ctype == b"IHDR" {
            if len != 13 {
                return None;
            }
            width = u32::from_be_bytes([data[0], data[1], data[2], data[3]]) as usize;
            height = u32::from_be_bytes([data[4], data[5], data[6], data[7]]) as usize;
            let bit_depth = data[8];
            color_type = data[9];
            let interlace = data[12];
            if width == 0
                || height == 0
                || width > 2048
                || height > 2048
                || bit_depth != 8
                || (color_type != 6 && color_type != 2)
                || interlace != 0
            {
                return None;
            }
        } else if ctype == b"IDAT" {
            idat.extend_from_slice(data);
        } else if ctype == b"IEND" {
            break;
        }
        pos = data_end + 4;
    }

    if width == 0 || height == 0 || idat.len() < 6 {
        return None;
    }

    let channels = if color_type == 6 { 4usize } else { 3usize };
    let row_bytes = width * channels;
    let stride = 1 + row_bytes;
    let expected_raw = height * stride;
    let mut raw = Vec::with_capacity(expected_raw);

    let mut zpos = 2usize; // skip 2-byte zlib header
    while zpos + 5 <= idat.len() {
        let hdr = idat[zpos];
        let bfinal = (hdr & 1) != 0;
        let btype = (hdr >> 1) & 3;
        if btype != 0 {
            return None;
        }
        let len = u16::from_le_bytes([idat[zpos + 1], idat[zpos + 2]]) as usize;
        let nlen = u16::from_le_bytes([idat[zpos + 3], idat[zpos + 4]]);
        if (len as u16) != !nlen {
            return None;
        }
        let block_start = zpos + 5;
        let block_end = block_start.checked_add(len)?;
        if block_end > idat.len() || raw.len() + len > expected_raw + 64 {
            return None;
        }
        raw.extend_from_slice(&idat[block_start..block_end]);
        zpos = block_end;
        if bfinal {
            break;
        }
    }

    if raw.len() < expected_raw {
        return None;
    }

    let total_pixels = width * height;
    let mut rgba = Vec::with_capacity(total_pixels);
    let mut sum_r = 0u64;
    let mut sum_g = 0u64;
    let mut sum_b = 0u64;
    let mut sum_a = 0u64;

    for y in 0..height {
        let row_start = y * stride;
        let filter = raw[row_start];
        if filter != 0 {
            return None;
        }
        let scan = &raw[row_start + 1..row_start + 1 + row_bytes];
        for x in 0..width {
            let p = x * channels;
            let r = scan[p];
            let g = scan[p + 1];
            let b = scan[p + 2];
            let a = if channels == 4 { scan[p + 3] } else { 255 };
            rgba.push([r, g, b, a]);
            sum_r += r as u64;
            sum_g += g as u64;
            sum_b += b as u64;
            sum_a += a as u64;
        }
    }

    let cnt = (total_pixels.max(1)) as u64;
    let avg_srgb =
        [(sum_r / cnt) as u8, (sum_g / cnt) as u8, (sum_b / cnt) as u8, (sum_a / cnt) as u8];

    Some(DecodedTexture { width, height, rgba, avg_srgb })
}

#[derive(Clone, Copy)]
struct ClipVertex {
    clip: [f32; 4],
    world_pos: [f32; 3],
    world_norm: [f32; 3],
    uv: [f32; 2],
}

impl ClipVertex {
    fn lerp(a: &Self, b: &Self, t: f32) -> Self {
        Self {
            clip: [
                a.clip[0] + t * (b.clip[0] - a.clip[0]),
                a.clip[1] + t * (b.clip[1] - a.clip[1]),
                a.clip[2] + t * (b.clip[2] - a.clip[2]),
                a.clip[3] + t * (b.clip[3] - a.clip[3]),
            ],
            world_pos: [
                a.world_pos[0] + t * (b.world_pos[0] - a.world_pos[0]),
                a.world_pos[1] + t * (b.world_pos[1] - a.world_pos[1]),
                a.world_pos[2] + t * (b.world_pos[2] - a.world_pos[2]),
            ],
            world_norm: normalize3([
                a.world_norm[0] + t * (b.world_norm[0] - a.world_norm[0]),
                a.world_norm[1] + t * (b.world_norm[1] - a.world_norm[1]),
                a.world_norm[2] + t * (b.world_norm[2] - a.world_norm[2]),
            ]),
            uv: [a.uv[0] + t * (b.uv[0] - a.uv[0]), a.uv[1] + t * (b.uv[1] - a.uv[1])],
        }
    }
}

/// Clips a triangle against the near plane `clip.z + clip.w >= 0` (`ndc_z >= -1`).
fn clip_triangle_near(tri: [ClipVertex; 3], out: &mut Vec<[ClipVertex; 3]>) {
    let dist = |v: &ClipVertex| v.clip[2] + v.clip[3];
    let mut inside = Vec::with_capacity(4);
    let mut prev = tri[2];
    let mut prev_d = dist(&prev);

    for &curr in &tri {
        let curr_d = dist(&curr);
        if curr_d >= 0.0 {
            if prev_d < 0.0 {
                let denom = prev_d - curr_d;
                let t = if denom.abs() > 1e-6 { (prev_d / denom).clamp(0.0, 1.0) } else { 0.5 };
                inside.push(ClipVertex::lerp(&prev, &curr, t));
            }
            inside.push(curr);
        } else if prev_d >= 0.0 {
            let denom = prev_d - curr_d;
            let t = if denom.abs() > 1e-6 { (prev_d / denom).clamp(0.0, 1.0) } else { 0.5 };
            inside.push(ClipVertex::lerp(&prev, &curr, t));
        }
        prev = curr;
        prev_d = curr_d;
    }

    if inside.len() >= 3 {
        out.push([inside[0], inside[1], inside[2]]);
        if inside.len() == 4 {
            out.push([inside[0], inside[2], inside[3]]);
        }
    }
}

struct RasterBuffer {
    w: usize,
    h: usize,
    color: Vec<[u8; 4]>,
    depth: Vec<f32>,
}

impl RasterBuffer {
    fn new_with_studio_gradient(w: usize, h: usize) -> Self {
        let mut color = vec![[15u8, 23, 42, 255]; w * h];
        for y in 0..h {
            let t = y as f32 / (h.max(1) as f32);
            let r = (13.0 + t * 15.0) as u8;
            let g = (19.0 + t * 20.0) as u8;
            let b = (34.0 + t * 26.0) as u8;
            let row = &mut color[y * w..(y + 1) * w];
            for px in row {
                *px = [r, g, b, 255];
            }
        }
        Self { w, h, color, depth: vec![f32::INFINITY; w * h] }
    }

    #[inline]
    fn blend_pixel(&mut self, x: usize, y: usize, z: f32, rgba: [u8; 4]) {
        if x >= self.w || y >= self.h {
            return;
        }
        let idx = y * self.w + x;
        if z <= self.depth[idx] {
            let a = rgba[3] as u32;
            if a >= 250 {
                self.color[idx] = [rgba[0], rgba[1], rgba[2], 255];
                self.depth[idx] = z;
            } else {
                let dst = self.color[idx];
                let inv_a = 255 - a;
                self.color[idx] = [
                    ((rgba[0] as u32 * a + dst[0] as u32 * inv_a) / 255) as u8,
                    ((rgba[1] as u32 * a + dst[1] as u32 * inv_a) / 255) as u8,
                    ((rgba[2] as u32 * a + dst[2] as u32 * inv_a) / 255) as u8,
                    255,
                ];
            }
        }
    }

    /// Draws a 3D line segment clipped against `clip.z + clip.w >= 0`.
    fn draw_line_3d(
        &mut self,
        vp: &[f32; 16],
        p0: [f32; 3],
        p1: [f32; 3],
        rgba: [u8; 4],
        depth_bias: f32,
        thickness: i32,
    ) {
        let mut c0 = mat4_transform_vec4(vp, p0);
        let mut c1 = mat4_transform_vec4(vp, p1);
        let d0 = c0[2] + c0[3];
        let d1 = c1[2] + c1[3];
        if d0 < 0.0 && d1 < 0.0 {
            return;
        }
        if d0 < 0.0 {
            let t = (d0 / (d0 - d1)).clamp(0.0, 1.0);
            for k in 0..4 {
                c0[k] += t * (c1[k] - c0[k]);
            }
        } else if d1 < 0.0 {
            let t = (d0 / (d0 - d1)).clamp(0.0, 1.0);
            for k in 0..4 {
                c1[k] = c0[k] + t * (c1[k] - c0[k]);
            }
        }
        let w0 = c0[3].abs().max(1e-5);
        let w1 = c1[3].abs().max(1e-5);
        let nx0 = c0[0] / w0;
        let ny0 = c0[1] / w0;
        let nz0 = c0[2] / w0 + depth_bias;
        let nx1 = c1[0] / w1;
        let ny1 = c1[1] / w1;
        let nz1 = c1[2] / w1 + depth_bias;
        if !nx0.is_finite()
            || !ny0.is_finite()
            || !nz0.is_finite()
            || !nx1.is_finite()
            || !ny1.is_finite()
            || !nz1.is_finite()
        {
            return;
        }

        let sx0 = ((nx0 * 0.5 + 0.5) * (self.w as f32)) as i32;
        let sy0 = ((0.5 - ny0 * 0.5) * (self.h as f32)) as i32;
        let sx1 = ((nx1 * 0.5 + 0.5) * (self.w as f32)) as i32;
        let sy1 = ((0.5 - ny1 * 0.5) * (self.h as f32)) as i32;

        let dx = (sx1 - sx0).abs();
        let dy = (sy1 - sy0).abs();
        let steps = dx.max(dy).clamp(1, (self.w.max(self.h) * 2) as i32);
        for s in 0..=steps {
            let t = s as f32 / (steps as f32);
            let x = sx0 + ((sx1 - sx0) as f32 * t).round() as i32;
            let y = sy0 + ((sy1 - sy0) as f32 * t).round() as i32;
            let z = nz0 + t * (nz1 - nz0);
            for oy in -thickness..=thickness {
                for ox in -thickness..=thickness {
                    let px = x + ox;
                    let py = y + oy;
                    if px >= 0 && py >= 0 && (px as usize) < self.w && (py as usize) < self.h {
                        self.blend_pixel(px as usize, py as usize, z, rgba);
                    }
                }
            }
        }
    }
}

/// Computes `(view_matrix, proj_matrix, eye_pos, is_ortho)` for the requested view mode.
fn compute_view_camera(
    scene: &SceneGraph,
    scene_aabb: &WorldAABB,
    mode: RenderViewMode,
    aspect: f32,
) -> ([f32; 16], [f32; 16], [f32; 3], bool) {
    let authored = scene.camera.clone().unwrap_or(CameraConfig {
        fov: 45.0,
        position: [0.0, 2.0, 5.0],
        target: [0.0, 0.0, 0.0],
    });

    if mode == RenderViewMode::Camera {
        let view = mat4_look_at(authored.position, authored.target, [0.0, 1.0, 0.0]);
        let proj = mat4_perspective(authored.fov, aspect, 0.1, 1000.0);
        return (view, proj, authored.position, false);
    }

    let mut bounds = if scene_aabb.is_valid() {
        *scene_aabb
    } else {
        WorldAABB { min: [-1.0, 0.0, -1.0], max: [1.0, 1.5, 1.0] }
    };
    // Include y = 0.0 in elevation views so the ground floor reference is always framed
    if mode == RenderViewMode::Front || mode == RenderViewMode::Right || mode == RenderViewMode::Iso
    {
        bounds.include_point([bounds.center()[0], 0.0, bounds.center()[2]]);
    }
    let center = bounds.center();
    let size = bounds.size();
    let max_span = size[0].max(size[1]).max(size[2]).max(0.25);
    let half = max_span * 0.68;
    let dist = max_span * 2.5 + 1.0;

    match mode {
        RenderViewMode::Front => {
            let eye = [center[0], center[1], center[2] + dist];
            let view = mat4_look_at(eye, center, [0.0, 1.0, 0.0]);
            let proj = mat4_ortho(-half * aspect, half * aspect, -half, half, 0.05, dist * 4.0);
            (view, proj, eye, true)
        }
        RenderViewMode::Top => {
            // Also include authored camera position in top-down view if reasonably close
            let mut top_bounds = bounds;
            let cam_dist = ((authored.position[0] - center[0]).powi(2)
                + (authored.position[2] - center[2]).powi(2))
            .sqrt();
            if cam_dist < max_span * 3.5 {
                top_bounds.include_point(authored.position);
            }
            let tc = top_bounds.center();
            let ts = top_bounds.size();
            let thalf = (ts[0].max(ts[2]).max(0.6)) * 0.68;
            let tdist = max_span * 2.5 + 4.0;
            let eye = [tc[0], tc[1] + tdist, tc[2]];
            let view = mat4_look_at(eye, tc, [0.0, 0.0, -1.0]);
            let proj =
                mat4_ortho(-thalf * aspect, thalf * aspect, -thalf, thalf, 0.05, tdist * 4.0);
            (view, proj, eye, true)
        }
        RenderViewMode::Right => {
            let eye = [center[0] + dist, center[1], center[2]];
            let view = mat4_look_at(eye, center, [0.0, 1.0, 0.0]);
            let proj = mat4_ortho(-half * aspect, half * aspect, -half, half, 0.05, dist * 4.0);
            (view, proj, eye, true)
        }
        RenderViewMode::Iso | RenderViewMode::Quad | RenderViewMode::Camera => {
            let iso_dist = max_span * 1.45 + 0.15;
            let eye = [
                center[0] + iso_dist * 0.78,
                center[1] + iso_dist * 0.62,
                center[2] + iso_dist * 0.78,
            ];
            let view = mat4_look_at(eye, center, [0.0, 1.0, 0.0]);
            let proj = mat4_perspective(38.0, aspect, 0.05, iso_dist * 8.0 + 100.0);
            (view, proj, eye, false)
        }
    }
}

fn draw_ground_grid(buf: &mut RasterBuffer, vp: &[f32; 16], extent_m: i32) {
    let ext = extent_m.clamp(3, 20) as f32;
    let minor_col = [42u8, 56, 78, 150];
    let major_col = [71u8, 85, 105, 210];

    // 0.25m minor lines within [-3m, 3m]
    for step in -12..=12 {
        if step % 4 == 0 {
            continue;
        }
        let v = step as f32 * 0.25;
        buf.draw_line_3d(vp, [v, 0.0, -3.0], [v, 0.0, 3.0], minor_col, 0.0005, 0);
        buf.draw_line_3d(vp, [-3.0, 0.0, v], [3.0, 0.0, v], minor_col, 0.0005, 0);
    }

    // 1.0m major lines
    for m in -extent_m.clamp(3, 20)..=extent_m.clamp(3, 20) {
        if m == 0 {
            continue;
        }
        let v = m as f32;
        buf.draw_line_3d(vp, [v, 0.0, -ext], [v, 0.0, ext], major_col, 0.0003, 0);
        buf.draw_line_3d(vp, [-ext, 0.0, v], [ext, 0.0, v], major_col, 0.0003, 0);
    }

    // Origin axes: X (Red), Y (Green), Z (Blue)
    buf.draw_line_3d(vp, [-ext, 0.0, 0.0], [0.0, 0.0, 0.0], major_col, 0.0002, 0);
    buf.draw_line_3d(vp, [0.0, 0.0, -ext], [0.0, 0.0, 0.0], major_col, 0.0002, 0);
    buf.draw_line_3d(vp, [0.0, 0.0, 0.0], [ext, 0.0, 0.0], [239, 68, 68, 240], -0.0002, 1);
    buf.draw_line_3d(vp, [0.0, 0.0, 0.0], [0.0, 1.5, 0.0], [34, 197, 94, 240], -0.0002, 1);
    buf.draw_line_3d(vp, [0.0, 0.0, 0.0], [0.0, 0.0, ext], [56, 189, 248, 240], -0.0002, 1);
}

fn draw_aabb_wireframe(buf: &mut RasterBuffer, vp: &[f32; 16], aabb: &WorldAABB, rgba: [u8; 4]) {
    let c = aabb.corners();
    const EDGES: [(usize, usize); 12] = [
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
    for &(i0, i1) in &EDGES {
        buf.draw_line_3d(vp, c[i0], c[i1], rgba, -0.001, 1);
    }
}

/// Renders a single viewport of size `width x height` into an RGBA8 buffer.
pub fn render_viewport_rgba(
    scene: &SceneGraph,
    width: u32,
    height: u32,
    mode: RenderViewMode,
    show_grid: bool,
    show_annotations: bool,
    header_label: Option<&str>,
) -> Vec<u8> {
    let w = width.clamp(32, 2048) as usize;
    let h = height.clamp(32, 2048) as usize;
    // 2x2 SSAA
    let ss_w = w * 2;
    let ss_h = h * 2;
    let mut ss_buf = RasterBuffer::new_with_studio_gradient(ss_w, ss_h);

    let world_matrices = compute_node_world_matrices(scene);
    let node_aabbs = compute_node_world_aabbs(scene, &world_matrices);
    let mut scene_aabb = WorldAABB::empty();
    for (idx, aabb_opt) in node_aabbs.iter().enumerate() {
        let init_vis = scene.nodes.get(idx).map(|n| n.visible).unwrap_or(true);
        if init_vis {
            if let Some(aabb) = aabb_opt {
                scene_aabb.union(aabb);
            }
        }
    }
    if !scene_aabb.is_valid() {
        for aabb in node_aabbs.iter().flatten() {
            scene_aabb.union(aabb);
        }
    }

    let aspect = (w as f32) / (h as f32);
    let (view, proj, eye_pos, _is_ortho) = compute_view_camera(scene, &scene_aabb, mode, aspect);
    let vp = mat4_mul(&proj, &view);
    let effective_vis = compute_effective_node_visibility(scene, &world_matrices, eye_pos);

    // Optional reference ground grid (or automatic floor line on Front/Top views)
    if show_grid || mode == RenderViewMode::Top || mode == RenderViewMode::Iso {
        let span = if scene_aabb.is_valid() {
            (scene_aabb.diagonal().ceil() as i32).clamp(4, 16)
        } else {
            5
        };
        draw_ground_grid(&mut ss_buf, &vp, span);
    } else if mode == RenderViewMode::Front || mode == RenderViewMode::Right {
        // Draw y = 0.0m reference floor line
        let span = if scene_aabb.is_valid() { scene_aabb.diagonal().max(4.0) } else { 4.0 };
        ss_buf.draw_line_3d(
            &vp,
            [-span, 0.0, 0.0],
            [span, 0.0, 0.0],
            [34, 197, 94, 210],
            -0.0005,
            1,
        );
        ss_buf.draw_line_3d(
            &vp,
            [0.0, 0.0, -span],
            [0.0, 0.0, span],
            [34, 197, 94, 210],
            -0.0005,
            1,
        );
    }

    // In Top view, draw camera frustum indicator so agents see where the camera is looking
    if mode == RenderViewMode::Top {
        let cam = scene.camera.clone().unwrap_or(CameraConfig {
            fov: 45.0,
            position: [0.0, 2.0, 5.0],
            target: [0.0, 0.0, 0.0],
        });
        let fx = cam.target[0] - cam.position[0];
        let fz = cam.target[2] - cam.position[2];
        let flen = (fx * fx + fz * fz).sqrt();
        if flen > 1e-3 {
            let dx = fx / flen;
            let dz = fz / flen;
            let rx = -dz;
            let rz = dx;
            let half_fov = (cam.fov * 0.5).to_radians().tan();
            let cone_len = flen.clamp(1.2, 4.0);
            let left_pt = [
                cam.position[0] + (dx - rx * half_fov) * cone_len,
                cam.position[1],
                cam.position[2] + (dz - rz * half_fov) * cone_len,
            ];
            let right_pt = [
                cam.position[0] + (dx + rx * half_fov) * cone_len,
                cam.position[1],
                cam.position[2] + (dz + rz * half_fov) * cone_len,
            ];
            let cam_col = [245u8, 158, 11, 240];
            ss_buf.draw_line_3d(&vp, cam.position, left_pt, cam_col, -0.002, 1);
            ss_buf.draw_line_3d(&vp, cam.position, right_pt, cam_col, -0.002, 1);
            ss_buf.draw_line_3d(&vp, left_pt, right_pt, [245, 158, 11, 140], -0.002, 0);
        }
    }

    // Rasterize all meshes
    #[derive(Default)]
    struct DecodedMaterialMaps {
        base_color: Option<DecodedTexture>,
        metallic_roughness: Option<DecodedTexture>,
        normal: Option<DecodedTexture>,
        emissive: Option<DecodedTexture>,
        occlusion: Option<DecodedTexture>,
    }
    let default_mat = Material3D::default();
    let default_maps = DecodedMaterialMaps::default();
    let decoded_maps: Vec<DecodedMaterialMaps> = scene
        .materials
        .iter()
        .map(|m| DecodedMaterialMaps {
            base_color: m.base_color_texture.as_deref().and_then(decode_stored_png_data_uri),
            metallic_roughness: m
                .metallic_roughness_texture
                .as_deref()
                .and_then(decode_stored_png_data_uri),
            normal: m.normal_texture.as_deref().and_then(decode_stored_png_data_uri),
            emissive: m.emissive_texture.as_deref().and_then(decode_stored_png_data_uri),
            occlusion: m.occlusion_texture.as_deref().and_then(decode_stored_png_data_uri),
        })
        .collect();
    let mut clipped_tris = Vec::with_capacity(2);

    let node_count = if !scene.nodes.is_empty() { scene.nodes.len() } else { scene.meshes.len() };

    for node_idx in 0..node_count {
        if !effective_vis.get(node_idx).copied().unwrap_or(true) {
            continue;
        }
        let (mesh_idx_opt, mut base_world, inst_matrices, inst_colors) = if !scene.nodes.is_empty()
        {
            let n = &scene.nodes[node_idx];
            let mut bw = world_matrices[node_idx];
            let bb_mode = n
                .xr_normalized
                .as_ref()
                .and_then(|v| v.get("billboard"))
                .or_else(|| n.xr_traits.as_ref().and_then(|v| v.get("billboard")));
            let bb_str = match bb_mode {
                Some(serde_json::Value::String(s)) if !s.is_empty() && s != "false" => {
                    Some(s.as_str())
                }
                Some(serde_json::Value::Bool(true)) => Some("capsule"),
                _ => None,
            };
            if let Some(mode_s) = bb_str {
                let sx = ((bw[0] * bw[0] + bw[1] * bw[1] + bw[2] * bw[2]).sqrt()).max(1e-6);
                let sy = ((bw[4] * bw[4] + bw[5] * bw[5] + bw[6] * bw[6]).sqrt()).max(1e-6);
                let sz = ((bw[8] * bw[8] + bw[9] * bw[9] + bw[10] * bw[10]).sqrt()).max(1e-6);
                let y_only = mode_s == "y" || mode_s == "cylindrical" || mode_s == "capsule";
                if y_only {
                    let dx = eye_pos[0] - bw[12];
                    let dz = eye_pos[2] - bw[14];
                    let dl = (dx * dx + dz * dz).sqrt();
                    let (bx, bz) = if dl > 1e-5 { (dx / dl, dz / dl) } else { (0.0, 1.0) };
                    bw[0] = bz * sx;
                    bw[1] = 0.0;
                    bw[2] = -bx * sx;
                    bw[4] = 0.0;
                    bw[5] = sy;
                    bw[6] = 0.0;
                    bw[8] = bx * sz;
                    bw[9] = 0.0;
                    bw[10] = bz * sz;
                } else {
                    bw[0] = view[0] * sx;
                    bw[1] = view[4] * sx;
                    bw[2] = view[8] * sx;
                    bw[4] = view[1] * sy;
                    bw[5] = view[5] * sy;
                    bw[6] = view[9] * sy;
                    bw[8] = view[2] * sz;
                    bw[9] = view[6] * sz;
                    bw[10] = view[10] * sz;
                }
            }
            (n.mesh, bw, n.instance_matrices.as_slice(), n.instance_colors.as_slice())
        } else {
            (Some(node_idx), world_matrices[node_idx], &[][..], &[][..])
        };
        let _ = &mut base_world;

        let Some(mesh_idx) = mesh_idx_opt else {
            continue;
        };
        let Some(mesh) = scene.meshes.get(mesh_idx) else {
            continue;
        };
        if mesh.positions.is_empty() {
            continue;
        }
        let mat =
            mesh.material_index.and_then(|mi| scene.materials.get(mi)).unwrap_or(&default_mat);
        let maps = mesh.material_index.and_then(|mi| decoded_maps.get(mi)).unwrap_or(&default_maps);
        let tex_opt = maps.base_color.as_ref();
        let has_uvs = !mesh.uvs.is_empty();
        let has_pbr_maps = has_uvs
            && (maps.metallic_roughness.is_some()
                || maps.normal.is_some()
                || maps.emissive.is_some()
                || maps.occlusion.is_some());

        let inst_count = (inst_matrices.len() / 16).max(1);
        let has_inst = inst_matrices.len() >= 16;

        for inst in 0..inst_count {
            let model_mat = if has_inst {
                let mut im = [0.0f32; 16];
                im.copy_from_slice(&inst_matrices[inst * 16..(inst + 1) * 16]);
                mat4_mul(&base_world, &im)
            } else {
                base_world
            };
            let (normal_mat, det_sign) = mat4_normal_cofactor_and_det(&model_mat);
            let inst_tint = if has_inst && (inst + 1) * 3 <= inst_colors.len() {
                Some([inst_colors[inst * 3], inst_colors[inst * 3 + 1], inst_colors[inst * 3 + 2]])
            } else {
                None
            };

            let tri_count = if !mesh.indices.is_empty() {
                mesh.indices.len() / 3
            } else {
                mesh.positions.len() / 3
            };

            for t_idx in 0..tri_count {
                let (i0, i1, i2) = if !mesh.indices.is_empty() {
                    (
                        mesh.indices[t_idx * 3] as usize,
                        mesh.indices[t_idx * 3 + 1] as usize,
                        mesh.indices[t_idx * 3 + 2] as usize,
                    )
                } else {
                    (t_idx * 3, t_idx * 3 + 1, t_idx * 3 + 2)
                };
                if i0 >= mesh.positions.len()
                    || i1 >= mesh.positions.len()
                    || i2 >= mesh.positions.len()
                {
                    continue;
                }

                let wp0 = mat4_transform_point(&model_mat, mesh.positions[i0]);
                let wp1 = mat4_transform_point(&model_mat, mesh.positions[i1]);
                let wp2 = mat4_transform_point(&model_mat, mesh.positions[i2]);

                let raw_face = cross3(
                    [wp1[0] - wp0[0], wp1[1] - wp0[1], wp1[2] - wp0[2]],
                    [wp2[0] - wp0[0], wp2[1] - wp0[1], wp2[2] - wp0[2]],
                );
                let face_n = normalize3([
                    raw_face[0] * det_sign,
                    raw_face[1] * det_sign,
                    raw_face[2] * det_sign,
                ]);
                let wn0 = mesh
                    .normals
                    .get(i0)
                    .copied()
                    .filter(|n| n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-4)
                    .map(|n| mat3_transform_normal(&normal_mat, n))
                    .unwrap_or(face_n);
                let wn1 = mesh
                    .normals
                    .get(i1)
                    .copied()
                    .filter(|n| n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-4)
                    .map(|n| mat3_transform_normal(&normal_mat, n))
                    .unwrap_or(face_n);
                let wn2 = mesh
                    .normals
                    .get(i2)
                    .copied()
                    .filter(|n| n[0] * n[0] + n[1] * n[1] + n[2] * n[2] > 1e-4)
                    .map(|n| mat3_transform_normal(&normal_mat, n))
                    .unwrap_or(face_n);

                let uv0 = mesh.uvs.get(i0).copied().unwrap_or([0.0, 0.0]);
                let uv1 = mesh.uvs.get(i1).copied().unwrap_or([0.0, 0.0]);
                let uv2 = mesh.uvs.get(i2).copied().unwrap_or([0.0, 0.0]);

                let v0 = ClipVertex {
                    clip: mat4_transform_vec4(&vp, wp0),
                    world_pos: wp0,
                    world_norm: wn0,
                    uv: uv0,
                };
                let v1 = ClipVertex {
                    clip: mat4_transform_vec4(&vp, wp1),
                    world_pos: wp1,
                    world_norm: wn1,
                    uv: uv1,
                };
                let v2 = ClipVertex {
                    clip: mat4_transform_vec4(&vp, wp2),
                    world_pos: wp2,
                    world_norm: wn2,
                    uv: uv2,
                };

                clipped_tris.clear();
                clip_triangle_near([v0, v1, v2], &mut clipped_tris);

                for ctri in &clipped_tris {
                    let inv_w0 = 1.0 / ctri[0].clip[3].abs().max(1e-5);
                    let inv_w1 = 1.0 / ctri[1].clip[3].abs().max(1e-5);
                    let inv_w2 = 1.0 / ctri[2].clip[3].abs().max(1e-5);

                    let sx0 = (ctri[0].clip[0] * inv_w0 * 0.5 + 0.5) * (ss_w as f32);
                    let sy0 = (0.5 - ctri[0].clip[1] * inv_w0 * 0.5) * (ss_h as f32);
                    let sz0 = ctri[0].clip[2] * inv_w0;

                    let sx1 = (ctri[1].clip[0] * inv_w1 * 0.5 + 0.5) * (ss_w as f32);
                    let sy1 = (0.5 - ctri[1].clip[1] * inv_w1 * 0.5) * (ss_h as f32);
                    let sz1 = ctri[1].clip[2] * inv_w1;

                    let sx2 = (ctri[2].clip[0] * inv_w2 * 0.5 + 0.5) * (ss_w as f32);
                    let sy2 = (0.5 - ctri[2].clip[1] * inv_w2 * 0.5) * (ss_h as f32);
                    let sz2 = ctri[2].clip[2] * inv_w2;

                    if !sx0.is_finite()
                        || !sy0.is_finite()
                        || !sz0.is_finite()
                        || !sx1.is_finite()
                        || !sy1.is_finite()
                        || !sz1.is_finite()
                        || !sx2.is_finite()
                        || !sy2.is_finite()
                        || !sz2.is_finite()
                    {
                        continue;
                    }

                    let area = (sx1 - sx0) * (sy2 - sy0) - (sy1 - sy0) * (sx2 - sx0);
                    if area.abs() < 1e-4 {
                        continue;
                    }
                    if !mat.double_sided && (area * det_sign) > 0.0 {
                        // In screen coords (+Y down), CCW in NDC has negative signed area
                        continue;
                    }

                    let min_x_f = sx0.min(sx1).min(sx2).floor();
                    let max_x_f = sx0.max(sx1).max(sx2).ceil();
                    let min_y_f = sy0.min(sy1).min(sy2).floor();
                    let max_y_f = sy0.max(sy1).max(sy2).ceil();
                    if max_x_f < 0.0
                        || min_x_f >= ss_w as f32
                        || max_y_f < 0.0
                        || min_y_f >= ss_h as f32
                    {
                        continue;
                    }
                    let min_x = min_x_f.max(0.0) as usize;
                    let max_x = (max_x_f as usize).min(ss_w - 1);
                    let min_y = min_y_f.max(0.0) as usize;
                    let max_y = (max_y_f as usize).min(ss_h - 1);
                    if min_x > max_x || min_y > max_y {
                        continue;
                    }

                    // Per-triangle world tangent/bitangent frame when normal mapping is active
                    let (tri_t, tri_b) = if maps.normal.is_some() && has_uvs {
                        let dp1 = [
                            ctri[1].world_pos[0] - ctri[0].world_pos[0],
                            ctri[1].world_pos[1] - ctri[0].world_pos[1],
                            ctri[1].world_pos[2] - ctri[0].world_pos[2],
                        ];
                        let dp2 = [
                            ctri[2].world_pos[0] - ctri[0].world_pos[0],
                            ctri[2].world_pos[1] - ctri[0].world_pos[1],
                            ctri[2].world_pos[2] - ctri[0].world_pos[2],
                        ];
                        let du1 = ctri[1].uv[0] - ctri[0].uv[0];
                        let dv1 = ctri[1].uv[1] - ctri[0].uv[1];
                        let du2 = ctri[2].uv[0] - ctri[0].uv[0];
                        let dv2 = ctri[2].uv[1] - ctri[0].uv[1];
                        let uv_det = du1 * dv2 - dv1 * du2;
                        if uv_det.abs() > 1e-7 {
                            let inv = 1.0 / uv_det;
                            let t = normalize3([
                                (dp1[0] * dv2 - dp2[0] * dv1) * inv,
                                (dp1[1] * dv2 - dp2[1] * dv1) * inv,
                                (dp1[2] * dv2 - dp2[2] * dv1) * inv,
                            ]);
                            let b = normalize3([
                                (dp2[0] * du1 - dp1[0] * du2) * inv,
                                (dp2[1] * du1 - dp1[1] * du2) * inv,
                                (dp2[2] * du1 - dp1[2] * du2) * inv,
                            ]);
                            (t, b)
                        } else {
                            let ref_up = if face_n[1].abs() < 0.9 {
                                [0.0, 1.0, 0.0]
                            } else {
                                [1.0, 0.0, 0.0]
                            };
                            let t = normalize3(cross3(ref_up, face_n));
                            let b = normalize3(cross3(face_n, t));
                            (t, b)
                        }
                    } else {
                        ([1.0, 0.0, 0.0], [0.0, 1.0, 0.0])
                    };

                    // Per-vertex shading (fast Gouraud path when no per-pixel PBR maps are present)
                    let (c0, c1, c2) = if !has_pbr_maps {
                        (
                            shade_pbr(
                                ctri[0].world_pos,
                                ctri[0].world_norm,
                                eye_pos,
                                mat,
                                inst_tint,
                                &scene.lights,
                            ),
                            shade_pbr(
                                ctri[1].world_pos,
                                ctri[1].world_norm,
                                eye_pos,
                                mat,
                                inst_tint,
                                &scene.lights,
                            ),
                            shade_pbr(
                                ctri[2].world_pos,
                                ctri[2].world_norm,
                                eye_pos,
                                mat,
                                inst_tint,
                                &scene.lights,
                            ),
                        )
                    } else {
                        ([0; 4], [0; 4], [0; 4])
                    };

                    let inv_area = 1.0 / area;
                    for py in min_y..=max_y {
                        let fy = py as f32 + 0.5;
                        for px in min_x..=max_x {
                            let fx = px as f32 + 0.5;
                            let w0 = ((sx1 - fx) * (sy2 - fy) - (sy1 - fy) * (sx2 - fx)) * inv_area;
                            let w1 = ((sx2 - fx) * (sy0 - fy) - (sy2 - fy) * (sx0 - fx)) * inv_area;
                            let w2 = 1.0 - w0 - w1;
                            if w0 >= -1e-4 && w1 >= -1e-4 && w2 >= -1e-4 {
                                let z = w0 * sz0 + w1 * sz1 + w2 * sz2;
                                if z >= -1.0 && z <= 1.0 {
                                    let pw0 = (w0 * inv_w0).max(0.0);
                                    let pw1 = (w1 * inv_w1).max(0.0);
                                    let pw2 = (w2 * inv_w2).max(0.0);
                                    let psum = (pw0 + pw1 + pw2).max(1e-6);
                                    let b0 = pw0 / psum;
                                    let b1 = pw1 / psum;
                                    let b2 = pw2 / psum;
                                    let u = b0 * ctri[0].uv[0]
                                        + b1 * ctri[1].uv[0]
                                        + b2 * ctri[2].uv[0];
                                    let v = b0 * ctri[0].uv[1]
                                        + b1 * ctri[1].uv[1]
                                        + b2 * ctri[2].uv[1];
                                    let rgba = if has_pbr_maps {
                                        let wp = [
                                            b0 * ctri[0].world_pos[0]
                                                + b1 * ctri[1].world_pos[0]
                                                + b2 * ctri[2].world_pos[0],
                                            b0 * ctri[0].world_pos[1]
                                                + b1 * ctri[1].world_pos[1]
                                                + b2 * ctri[2].world_pos[1],
                                            b0 * ctri[0].world_pos[2]
                                                + b1 * ctri[1].world_pos[2]
                                                + b2 * ctri[2].world_pos[2],
                                        ];
                                        let mut n = normalize3([
                                            b0 * ctri[0].world_norm[0]
                                                + b1 * ctri[1].world_norm[0]
                                                + b2 * ctri[2].world_norm[0],
                                            b0 * ctri[0].world_norm[1]
                                                + b1 * ctri[1].world_norm[1]
                                                + b2 * ctri[2].world_norm[1],
                                            b0 * ctri[0].world_norm[2]
                                                + b1 * ctri[1].world_norm[2]
                                                + b2 * ctri[2].world_norm[2],
                                        ]);
                                        if let Some(ref norm_tex) = maps.normal {
                                            let ns = mat.normal_scale.max(0.0);
                                            let tn = norm_tex.sample_srgb([u, v]);
                                            let tx = ((tn[0] as f32 / 255.0) * 2.0 - 1.0) * ns;
                                            let ty = ((tn[1] as f32 / 255.0) * 2.0 - 1.0) * ns;
                                            let tz = ((tn[2] as f32 / 255.0) * 2.0 - 1.0).max(0.05);
                                            n = normalize3([
                                                tri_t[0] * tx + tri_b[0] * ty + n[0] * tz,
                                                tri_t[1] * tx + tri_b[1] * ty + n[1] * tz,
                                                tri_t[2] * tx + tri_b[2] * ty + n[2] * tz,
                                            ]);
                                        }
                                        let (rough_scale, metal_scale) =
                                            if let Some(ref mr_tex) = maps.metallic_roughness {
                                                let mr = mr_tex.sample_srgb([u, v]);
                                                (mr[1] as f32 / 255.0, mr[2] as f32 / 255.0)
                                            } else {
                                                (1.0, 1.0)
                                            };
                                        let ao_factor = if let Some(ref occ_tex) = maps.occlusion {
                                            let occ = occ_tex.sample_srgb([u, v]);
                                            let os = mat.occlusion_strength.clamp(0.0, 1.0);
                                            1.0 + os * ((occ[0] as f32 / 255.0) - 1.0)
                                        } else {
                                            1.0
                                        };
                                        let emissive_add = if let Some(ref em_tex) = maps.emissive {
                                            let em = em_tex.sample_srgb([u, v]);
                                            [
                                                mat.emissive_factor[0]
                                                    * ((em[0] as f32 / 255.0).powf(2.2)),
                                                mat.emissive_factor[1]
                                                    * ((em[1] as f32 / 255.0).powf(2.2)),
                                                mat.emissive_factor[2]
                                                    * ((em[2] as f32 / 255.0).powf(2.2)),
                                            ]
                                        } else {
                                            mat.emissive_factor
                                        };
                                        let base_tex_lin = tex_opt.map(|tex| {
                                            let ts = tex.sample_srgb([u, v]);
                                            [
                                                (ts[0] as f32 / 255.0).powf(2.2),
                                                (ts[1] as f32 / 255.0).powf(2.2),
                                                (ts[2] as f32 / 255.0).powf(2.2),
                                                ts[3] as f32 / 255.0,
                                            ]
                                        });
                                        shade_pbr_ext(
                                            wp,
                                            n,
                                            eye_pos,
                                            mat,
                                            base_tex_lin,
                                            rough_scale,
                                            metal_scale,
                                            ao_factor,
                                            emissive_add,
                                            inst_tint,
                                            &scene.lights,
                                        )
                                    } else {
                                        let mut out = [
                                            (b0 * c0[0] as f32
                                                + b1 * c1[0] as f32
                                                + b2 * c2[0] as f32)
                                                .round()
                                                as u8,
                                            (b0 * c0[1] as f32
                                                + b1 * c1[1] as f32
                                                + b2 * c2[1] as f32)
                                                .round()
                                                as u8,
                                            (b0 * c0[2] as f32
                                                + b1 * c1[2] as f32
                                                + b2 * c2[2] as f32)
                                                .round()
                                                as u8,
                                            c0[3],
                                        ];
                                        if let Some(tex) = tex_opt {
                                            let texel = if has_uvs {
                                                tex.sample_srgb([u, v])
                                            } else {
                                                tex.avg_srgb
                                            };
                                            out[0] = ((out[0] as u32 * texel[0] as u32 + 127) / 255)
                                                as u8;
                                            out[1] = ((out[1] as u32 * texel[1] as u32 + 127) / 255)
                                                as u8;
                                            out[2] = ((out[2] as u32 * texel[2] as u32 + 127) / 255)
                                                as u8;
                                            out[3] = ((out[3] as u32 * texel[3] as u32 + 127) / 255)
                                                as u8;
                                        }
                                        out
                                    };
                                    ss_buf.blend_pixel(px, py, z, rgba);
                                }
                            }
                        }
                    }
                }
            }
        }
    }

    // Optional AABB wireframes (de-cluttered: top 6 largest nodes + overall scene AABB)
    let mut ranked_aabbs: Vec<(usize, &WorldAABB, f32)> = Vec::new();
    if show_annotations {
        for (idx, aabb_opt) in node_aabbs.iter().enumerate() {
            if effective_vis.get(idx).copied().unwrap_or(true) {
                if let Some(aabb) = aabb_opt {
                    let diag = aabb.diagonal();
                    if diag > 1e-4 && diag.is_finite() {
                        ranked_aabbs.push((idx, aabb, diag));
                    }
                }
            }
        }
        ranked_aabbs.sort_by(|a, b| b.2.partial_cmp(&a.2).unwrap_or(std::cmp::Ordering::Equal));
        if ranked_aabbs.len() > 6 && scene_aabb.is_valid() {
            draw_aabb_wireframe(&mut ss_buf, &vp, &scene_aabb, [56, 189, 248, 150]);
        }
        for &(_idx, aabb, _diag) in ranked_aabbs.iter().take(6) {
            draw_aabb_wireframe(&mut ss_buf, &vp, aabb, [56, 189, 248, 200]);
        }
    }

    // Downsample 2x2 SSAA -> w x h
    let mut out_rgba = vec![0u8; w * h * 4];
    for y in 0..h {
        for x in 0..w {
            let p00 = ss_buf.color[(y * 2) * ss_w + (x * 2)];
            let p10 = ss_buf.color[(y * 2) * ss_w + (x * 2 + 1)];
            let p01 = ss_buf.color[(y * 2 + 1) * ss_w + (x * 2)];
            let p11 = ss_buf.color[(y * 2 + 1) * ss_w + (x * 2 + 1)];
            let dst = (y * w + x) * 4;
            out_rgba[dst] =
                ((p00[0] as u32 + p10[0] as u32 + p01[0] as u32 + p11[0] as u32 + 2) >> 2) as u8;
            out_rgba[dst + 1] =
                ((p00[1] as u32 + p10[1] as u32 + p01[1] as u32 + p11[1] as u32 + 2) >> 2) as u8;
            out_rgba[dst + 2] =
                ((p00[2] as u32 + p10[2] as u32 + p01[2] as u32 + p11[2] as u32 + 2) >> 2) as u8;
            out_rgba[dst + 3] = 255;
        }
    }

    // Draw non-overlapping 2D node name labels (up to 6 largest nodes) if annotations enabled
    if show_annotations {
        let mut placed_boxes: Vec<[i32; 4]> = vec![[0, 0, 180, 26]];
        for &(i, aabb, _diag) in &ranked_aabbs {
            if placed_boxes.len() >= 7 {
                break;
            }
            let label_name = if !scene.nodes.is_empty() {
                let n = &scene.nodes[i];
                if !n.name.is_empty() {
                    n.name.as_str()
                } else if let Some(mi) = n.mesh {
                    scene.meshes.get(mi).map(|m| m.name.as_str()).unwrap_or("")
                } else {
                    ""
                }
            } else {
                scene.meshes.get(i).map(|m| m.name.as_str()).unwrap_or("")
            };
            if label_name.is_empty() {
                continue;
            }
            let top_center = [aabb.center()[0], aabb.max[1], aabb.center()[2]];
            let clip = mat4_transform_vec4(&vp, top_center);
            if clip[3] > 0.05 {
                let nx = clip[0] / clip[3];
                let ny = clip[1] / clip[3];
                if (-0.98..=0.98).contains(&nx) && (-0.98..=0.98).contains(&ny) {
                    let sx = ((nx * 0.5 + 0.5) * (w as f32)) as i32;
                    let sy = ((0.5 - ny * 0.5) * (h as f32)) as i32 - 10;
                    let truncated: String = label_name.chars().take(18).collect();
                    let text_w = (truncated.len() as i32) * 6;
                    let box_w = text_w + 8;
                    let box_h = 15;
                    let lx = (sx - text_w / 2).clamp(4, (w as i32 - box_w - 4).max(4));
                    let ly = sy.clamp(24, (h as i32 - box_h - 4).max(24));
                    let candidate = [lx - 4, ly - 3, lx + box_w + 4, ly + box_h + 3];
                    let overlaps = placed_boxes.iter().any(|b| {
                        candidate[0] < b[2]
                            && candidate[2] > b[0]
                            && candidate[1] < b[3]
                            && candidate[3] > b[1]
                    });
                    if !overlaps {
                        placed_boxes.push(candidate);
                        draw_label_badge(
                            &mut out_rgba,
                            w,
                            h,
                            lx as usize,
                            ly as usize,
                            &truncated,
                            [56, 189, 248, 255],
                            1,
                        );
                    }
                }
            }
        }
    }

    if let Some(hdr) = header_label {
        draw_label_badge(&mut out_rgba, w, h, 8, 8, hdr, [248, 250, 252, 255], 1);
    }

    out_rgba
}

/// Renders the scene according to [`RenderOptions`] (Single View or 4-Up Quad Contact Sheet)
/// and returns `(final_width, final_height, rgba_bytes)`.
pub fn render_scene_rgba(scene: &SceneGraph, opts: &RenderOptions) -> (u32, u32, Vec<u8>) {
    if opts.view == RenderViewMode::Quad {
        let cell_w = (opts.width / 2).max(128);
        let cell_h = (opts.height / 2).max(128);
        let full_w = (cell_w * 2) as usize;
        let full_h = (cell_h * 2) as usize;

        let q_cam = render_viewport_rgba(
            scene,
            cell_w,
            cell_h,
            RenderViewMode::Camera,
            opts.show_grid,
            opts.show_annotations,
            Some("CAMERA"),
        );
        let q_front = render_viewport_rgba(
            scene,
            cell_w,
            cell_h,
            RenderViewMode::Front,
            opts.show_grid,
            opts.show_annotations,
            Some("FRONT +Z (Y=0 FLOOR)"),
        );
        let q_top = render_viewport_rgba(
            scene,
            cell_w,
            cell_h,
            RenderViewMode::Top,
            true,
            opts.show_annotations,
            Some("TOP +Y (FRUSTUM)"),
        );
        let q_iso = render_viewport_rgba(
            scene,
            cell_w,
            cell_h,
            RenderViewMode::Iso,
            true,
            opts.show_annotations,
            Some("ISO 45 DEG"),
        );

        let mut canvas = vec![0u8; full_w * full_h * 4];
        let cw = cell_w as usize;
        let ch = cell_h as usize;

        let blit = |dst: &mut [u8], src: &[u8], ox: usize, oy: usize| {
            for y in 0..ch {
                let dst_row = ((oy + y) * full_w + ox) * 4;
                let src_row = y * cw * 4;
                dst[dst_row..dst_row + cw * 4].copy_from_slice(&src[src_row..src_row + cw * 4]);
            }
        };
        blit(&mut canvas, &q_cam, 0, 0);
        blit(&mut canvas, &q_front, cw, 0);
        blit(&mut canvas, &q_top, 0, ch);
        blit(&mut canvas, &q_iso, cw, ch);

        // Draw crisp 2px divider crosshairs between the 4 viewports
        for y in 0..full_h {
            for dx in [cw.saturating_sub(1), cw] {
                let idx = (y * full_w + dx) * 4;
                canvas[idx..idx + 4].copy_from_slice(&[51, 65, 85, 255]);
            }
        }
        for x in 0..full_w {
            for dy in [ch.saturating_sub(1), ch] {
                let idx = (dy * full_w + x) * 4;
                canvas[idx..idx + 4].copy_from_slice(&[51, 65, 85, 255]);
            }
        }

        (full_w as u32, full_h as u32, canvas)
    } else {
        let default_hdr = match opts.view {
            RenderViewMode::Camera => "CAMERA",
            RenderViewMode::Front => "FRONT +Z",
            RenderViewMode::Top => "TOP +Y",
            RenderViewMode::Right => "RIGHT +X",
            RenderViewMode::Iso => "ISO 45 DEG",
            RenderViewMode::Quad => "QUAD",
        };
        let hdr = opts.label_override.as_deref().unwrap_or(default_hdr);
        let rgba = render_viewport_rgba(
            scene,
            opts.width,
            opts.height,
            opts.view,
            opts.show_grid,
            opts.show_annotations,
            Some(hdr),
        );
        (opts.width, opts.height, rgba)
    }
}

/// Stitches multiple `(width, height, rgba)` frames horizontally into a single Filmstrip RGBA
/// image.
pub fn stitch_filmstrip_horizontal(
    frame_w: u32,
    frame_h: u32,
    frames: &[Vec<u8>],
) -> (u32, u32, Vec<u8>) {
    if frames.is_empty() {
        return (1, 1, vec![0, 0, 0, 255]);
    }
    let fw = frame_w as usize;
    let fh = frame_h as usize;
    let count = frames.len();
    let total_w = fw * count;
    let mut strip = vec![0u8; total_w * fh * 4];

    for (k, frame) in frames.iter().enumerate() {
        let ox = k * fw;
        for y in 0..fh {
            let dst_start = (y * total_w + ox) * 4;
            let src_start = y * fw * 4;
            if src_start + fw * 4 <= frame.len() {
                strip[dst_start..dst_start + fw * 4]
                    .copy_from_slice(&frame[src_start..src_start + fw * 4]);
            }
        }
        if k > 0 {
            for y in 0..fh {
                let idx = (y * total_w + ox) * 4;
                strip[idx..idx + 4].copy_from_slice(&[56, 189, 248, 255]);
            }
        }
    }

    (total_w as u32, frame_h, strip)
}

/// 5x7 crisp ASCII bitmap font for viewport badges and node callouts.
fn glyph_5x7(ch: char) -> [u8; 7] {
    match ch.to_ascii_uppercase() {
        'A' => [0b01110, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'B' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10001, 0b10001, 0b11110],
        'C' => [0b01110, 0b10001, 0b10000, 0b10000, 0b10000, 0b10001, 0b01110],
        'D' => [0b11100, 0b10010, 0b10001, 0b10001, 0b10001, 0b10010, 0b11100],
        'E' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b11111],
        'F' => [0b11111, 0b10000, 0b10000, 0b11110, 0b10000, 0b10000, 0b10000],
        'G' => [0b01110, 0b10001, 0b10000, 0b10111, 0b10001, 0b10001, 0b01110],
        'H' => [0b10001, 0b10001, 0b10001, 0b11111, 0b10001, 0b10001, 0b10001],
        'I' => [0b01110, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        'J' => [0b00111, 0b00010, 0b00010, 0b00010, 0b10010, 0b10010, 0b01100],
        'K' => [0b10001, 0b10010, 0b10100, 0b11000, 0b10100, 0b10010, 0b10001],
        'L' => [0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b10000, 0b11111],
        'M' => [0b10001, 0b11011, 0b10101, 0b10101, 0b10001, 0b10001, 0b10001],
        'N' => [0b10001, 0b11001, 0b10101, 0b10011, 0b10001, 0b10001, 0b10001],
        'O' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'P' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10000, 0b10000, 0b10000],
        'Q' => [0b01110, 0b10001, 0b10001, 0b10001, 0b10101, 0b10010, 0b01101],
        'R' => [0b11110, 0b10001, 0b10001, 0b11110, 0b10100, 0b10010, 0b10001],
        'S' => [0b01111, 0b10000, 0b10000, 0b01110, 0b00001, 0b00001, 0b11110],
        'T' => [0b11111, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00100],
        'U' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01110],
        'V' => [0b10001, 0b10001, 0b10001, 0b10001, 0b10001, 0b01010, 0b00100],
        'W' => [0b10001, 0b10001, 0b10001, 0b10101, 0b10101, 0b11011, 0b10001],
        'X' => [0b10001, 0b10001, 0b01010, 0b00100, 0b01010, 0b10001, 0b10001],
        'Y' => [0b10001, 0b10001, 0b01010, 0b00100, 0b00100, 0b00100, 0b00100],
        'Z' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b10000, 0b11111],
        '0' => [0b01110, 0b10001, 0b10011, 0b10101, 0b11001, 0b10001, 0b01110],
        '1' => [0b00100, 0b01100, 0b00100, 0b00100, 0b00100, 0b00100, 0b01110],
        '2' => [0b01110, 0b10001, 0b00001, 0b00110, 0b01000, 0b10000, 0b11111],
        '3' => [0b11110, 0b00001, 0b00001, 0b01110, 0b00001, 0b00001, 0b11110],
        '4' => [0b00010, 0b00110, 0b01010, 0b10010, 0b11111, 0b00010, 0b00010],
        '5' => [0b11111, 0b10000, 0b11110, 0b00001, 0b00001, 0b10001, 0b01110],
        '6' => [0b00110, 0b01000, 0b10000, 0b11110, 0b10001, 0b10001, 0b01110],
        '7' => [0b11111, 0b00001, 0b00010, 0b00100, 0b01000, 0b01000, 0b01000],
        '8' => [0b01110, 0b10001, 0b10001, 0b01110, 0b10001, 0b10001, 0b01110],
        '9' => [0b01110, 0b10001, 0b10001, 0b01111, 0b00001, 0b00010, 0b01100],
        '+' => [0b00000, 0b00100, 0b00100, 0b11111, 0b00100, 0b00100, 0b00000],
        '-' => [0b00000, 0b00000, 0b00000, 0b11111, 0b00000, 0b00000, 0b00000],
        '=' => [0b00000, 0b00000, 0b11111, 0b00000, 0b11111, 0b00000, 0b00000],
        '.' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b01100, 0b01100],
        ':' => [0b00000, 0b01100, 0b01100, 0b00000, 0b01100, 0b01100, 0b00000],
        '(' => [0b00010, 0b00100, 0b01000, 0b01000, 0b01000, 0b00100, 0b00010],
        ')' => [0b01000, 0b00100, 0b00010, 0b00010, 0b00010, 0b00100, 0b01000],
        '_' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b00000, 0b11111],
        '/' => [0b00001, 0b00010, 0b00100, 0b00100, 0b01000, 0b10000, 0b00000],
        ',' => [0b00000, 0b00000, 0b00000, 0b00000, 0b00110, 0b00100, 0b01000],
        '%' => [0b11001, 0b11010, 0b00010, 0b00100, 0b01000, 0b01011, 0b10011],
        '[' => [0b01110, 0b01000, 0b01000, 0b01000, 0b01000, 0b01000, 0b01110],
        ']' => [0b01110, 0b00010, 0b00010, 0b00010, 0b00010, 0b00010, 0b01110],
        '#' => [0b01010, 0b11111, 0b01010, 0b01010, 0b11111, 0b01010, 0b00000],
        '!' => [0b00100, 0b00100, 0b00100, 0b00100, 0b00100, 0b00000, 0b00100],
        '?' => [0b01110, 0b10001, 0b00010, 0b00100, 0b00100, 0b00000, 0b00100],
        _ => [0; 7],
    }
}

fn draw_label_badge(
    rgba: &mut [u8],
    w: usize,
    h: usize,
    x0: usize,
    y0: usize,
    text: &str,
    fg: [u8; 4],
    scale: usize,
) {
    let sc = scale.max(1);
    let pad_x = 4 * sc;
    let pad_y = 3 * sc;
    let text_w = text.chars().count() * 6 * sc;
    let box_w = text_w + pad_x * 2;
    let box_h = 7 * sc + pad_y * 2;

    for by in y0..(y0 + box_h).min(h) {
        for bx in x0..(x0 + box_w).min(w) {
            let idx = (by * w + bx) * 4;
            let is_border = bx == x0 || bx + 1 == x0 + box_w || by == y0 || by + 1 == y0 + box_h;
            if is_border {
                rgba[idx] = 51;
                rgba[idx + 1] = 65;
                rgba[idx + 2] = 85;
                rgba[idx + 3] = 255;
            } else {
                // Dark translucent backdrop
                rgba[idx] = ((rgba[idx] as u32 + 15 * 3) >> 2) as u8;
                rgba[idx + 1] = ((rgba[idx + 1] as u32 + 23 * 3) >> 2) as u8;
                rgba[idx + 2] = ((rgba[idx + 2] as u32 + 42 * 3) >> 2) as u8;
                rgba[idx + 3] = 255;
            }
        }
    }

    for (ci, ch) in text.chars().enumerate() {
        let rows = glyph_5x7(ch);
        let cx = x0 + pad_x + ci * 6 * sc;
        let cy = y0 + pad_y;
        for (ry, &bits) in rows.iter().enumerate() {
            for rx in 0..5 {
                if (bits >> (4 - rx)) & 1 != 0 {
                    for sy in 0..sc {
                        for sx in 0..sc {
                            let px = cx + rx * sc + sx;
                            let py = cy + ry * sc + sy;
                            if px < w && py < h {
                                let idx = (py * w + px) * 4;
                                rgba[idx..idx + 4].copy_from_slice(&fg);
                            }
                        }
                    }
                }
            }
        }
    }
}

/// Pure-Rust PNG encoder (RGBA8, uncompressed DEFLATE store blocks + Adler32 + IEEE CRC32).
pub fn encode_png_rgba(width: u32, height: u32, rgba: &[u8]) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("PNG dimensions must be >= 1x1".to_string());
    }
    let w = width as usize;
    let h = height as usize;
    if rgba.len() < w * h * 4 {
        return Err(format!(
            "RGBA buffer too small for {}x{} PNG ({} < {})",
            w,
            h,
            rgba.len(),
            w * h * 4
        ));
    }

    // Build raw filtered scanlines: 1 byte filter (0 = None) + w*4 bytes per row
    let row_bytes = w * 4;
    let raw_len = h * (1 + row_bytes);
    let mut raw = Vec::with_capacity(raw_len);
    for y in 0..h {
        raw.push(0u8);
        let start = y * row_bytes;
        raw.extend_from_slice(&rgba[start..start + row_bytes]);
    }

    // Zlib stream: CMF=0x78, FLG=0x01 + uncompressed DEFLATE blocks (max 65535 B each) + Adler32
    let num_blocks = (raw.len() / 65535) + 1;
    let mut zlib = Vec::with_capacity(2 + raw.len() + num_blocks * 5 + 4);
    zlib.push(0x78);
    zlib.push(0x01);

    let mut offset = 0usize;
    while offset < raw.len() || offset == 0 {
        let rem = raw.len() - offset;
        let chunk_len = rem.min(65535);
        let is_final = offset + chunk_len >= raw.len();
        zlib.push(if is_final { 0x01 } else { 0x00 });
        let len_u16 = chunk_len as u16;
        let nlen_u16 = !len_u16;
        zlib.extend_from_slice(&len_u16.to_le_bytes());
        zlib.extend_from_slice(&nlen_u16.to_le_bytes());
        zlib.extend_from_slice(&raw[offset..offset + chunk_len]);
        offset += chunk_len;
        if offset >= raw.len() {
            break;
        }
    }

    // Adler-32 checksum
    let mut s1: u32 = 1;
    let mut s2: u32 = 0;
    for chunk in raw.chunks(5552) {
        for &b in chunk {
            s1 += b as u32;
            s2 += s1;
        }
        s1 %= 65521;
        s2 %= 65521;
    }
    let adler = (s2 << 16) | s1;
    zlib.extend_from_slice(&adler.to_be_bytes());

    let mut png = Vec::with_capacity(64 + zlib.len());
    png.extend_from_slice(b"\x89PNG\r\n\x1a\n");

    let write_chunk = |out: &mut Vec<u8>, chunk_type: &[u8; 4], data: &[u8]| {
        out.extend_from_slice(&(data.len() as u32).to_be_bytes());
        let crc_start = out.len();
        out.extend_from_slice(chunk_type);
        out.extend_from_slice(data);
        let crc = calculate_crc32(&out[crc_start..]);
        out.extend_from_slice(&crc.to_be_bytes());
    };

    let mut ihdr = [0u8; 13];
    ihdr[0..4].copy_from_slice(&width.to_be_bytes());
    ihdr[4..8].copy_from_slice(&height.to_be_bytes());
    ihdr[8] = 8; // bit depth 8
    ihdr[9] = 6; // color type 6 = RGBA
    ihdr[10] = 0;
    ihdr[11] = 0;
    ihdr[12] = 0;
    write_chunk(&mut png, b"IHDR", &ihdr);
    write_chunk(&mut png, b"IDAT", &zlib);
    write_chunk(&mut png, b"IEND", &[]);

    Ok(png)
}

/// Pure-Rust Animated GIF89a encoder (256-color palette + 12-bit LZW).
pub fn encode_gif_frames(
    width: u32,
    height: u32,
    frames_rgba: &[Vec<u8>],
    delay_cs: u16,
) -> Result<Vec<u8>, String> {
    if width == 0 || height == 0 {
        return Err("GIF dimensions must be >= 1x1".to_string());
    }
    if frames_rgba.is_empty() {
        return Err("encode_gif_frames requires at least 1 frame".to_string());
    }
    let w = width.clamp(1, 4096) as u16;
    let h = height.clamp(1, 4096) as u16;
    let pixel_count = (w as usize) * (h as usize);

    let mut out = Vec::with_capacity(1024 + frames_rgba.len() * pixel_count / 2);
    out.extend_from_slice(b"GIF89a");
    out.extend_from_slice(&w.to_le_bytes());
    out.extend_from_slice(&h.to_le_bytes());
    // Packed field: Global Color Table Flag (1) | Color Resolution (7) | Sort (0) | Size of GCT (7
    // -> 256 colors)
    out.push(0xF7);
    out.push(0); // Background color index
    out.push(0); // Pixel aspect ratio

    // Global Color Table: 216 (6x6x6 RGB cube) + 40 studio slate/gray ramp entries = 256 colors
    for r in 0..6u8 {
        for g in 0..6u8 {
            for b in 0..6u8 {
                out.push(r * 51);
                out.push(g * 51);
                out.push(b * 51);
            }
        }
    }
    for i in 0..40u8 {
        let v = (i as u32 * 255 / 39) as u8;
        out.push(v);
        out.push(v);
        out.push(v);
    }

    // Netscape 2.0 infinite loop extension
    out.extend_from_slice(&[
        0x21, 0xFF, 0x0B, b'N', b'E', b'T', b'S', b'C', b'A', b'P', b'E', b'2', b'.', b'0', 0x03,
        0x01, 0x00, 0x00, 0x00,
    ]);

    let mut indices = vec![0u8; pixel_count];
    for frame in frames_rgba {
        if frame.len() < pixel_count * 4 {
            return Err("GIF frame RGBA buffer smaller than width*height*4".to_string());
        }
        // Quantize RGBA8 -> 256-color index with subtle 2x2 Bayer dither
        let w_usize = w as usize;
        for i in 0..pixel_count {
            let x = i % w_usize;
            let y = i / w_usize;
            let dither: i32 = match (x & 1, y & 1) {
                (0, 0) => -6,
                (1, 1) => 2,
                (1, 0) => 6,
                _ => -2,
            };
            let r = (frame[i * 4] as i32 + dither).clamp(0, 255) as u8;
            let g = (frame[i * 4 + 1] as i32 + dither).clamp(0, 255) as u8;
            let b = (frame[i * 4 + 2] as i32 + dither).clamp(0, 255) as u8;
            let ri = ((r as u16 + 25) / 51) as u8;
            let gi = ((g as u16 + 25) / 51) as u8;
            let bi = ((b as u16 + 25) / 51) as u8;
            indices[i] = ri * 36 + gi * 6 + bi;
        }

        // Graphic Control Extension
        out.extend_from_slice(&[0x21, 0xF9, 0x04, 0x04]);
        out.extend_from_slice(&delay_cs.max(2).to_le_bytes());
        out.push(0x00);
        out.push(0x00);

        // Image Descriptor
        out.push(0x2C);
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&0u16.to_le_bytes());
        out.extend_from_slice(&w.to_le_bytes());
        out.extend_from_slice(&h.to_le_bytes());
        out.push(0x00);

        // LZW Minimum Code Size = 8
        out.push(8);
        let lzw_bytes = gif_lzw_encode_8bit(&indices);
        for sub in lzw_bytes.chunks(255) {
            out.push(sub.len() as u8);
            out.extend_from_slice(sub);
        }
        out.push(0x00); // Block terminator
    }

    out.push(0x3B); // GIF Trailer
    Ok(out)
}

fn gif_lzw_encode_8bit(indices: &[u8]) -> Vec<u8> {
    const CLEAR_CODE: u16 = 256;
    const EOI_CODE: u16 = 257;
    const MAX_CODE: u16 = 4095;

    // Flat dictionary table `[prefix_code * 256 + byte] -> code`
    let mut table = vec![u16::MAX; 4096 * 256];
    let mut next_code: u16 = 258;
    let mut code_size: u32 = 9;

    let mut out = Vec::with_capacity(indices.len());
    let mut bit_buf: u32 = 0;
    let mut bit_cnt: u32 = 0;

    let emit = |code: u16, bits: u32, out: &mut Vec<u8>, buf: &mut u32, cnt: &mut u32| {
        *buf |= (code as u32) << *cnt;
        *cnt += bits;
        while *cnt >= 8 {
            out.push((*buf & 0xFF) as u8);
            *buf >>= 8;
            *cnt -= 8;
        }
    };

    emit(CLEAR_CODE, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
    if indices.is_empty() {
        emit(EOI_CODE, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
        if bit_cnt > 0 {
            out.push((bit_buf & 0xFF) as u8);
        }
        return out;
    }

    let mut prefix: u16 = indices[0] as u16;
    for &k in &indices[1..] {
        let slot = (prefix as usize) * 256 + (k as usize);
        let existing = table[slot];
        if existing != u16::MAX {
            prefix = existing;
        } else {
            emit(prefix, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
            if next_code <= MAX_CODE {
                table[slot] = next_code;
                if next_code == (1u16 << code_size) && code_size < 12 {
                    code_size += 1;
                }
                next_code += 1;
            } else {
                emit(CLEAR_CODE, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
                table.fill(u16::MAX);
                next_code = 258;
                code_size = 9;
            }
            prefix = k as u16;
        }
    }

    emit(prefix, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
    emit(EOI_CODE, code_size, &mut out, &mut bit_buf, &mut bit_cnt);
    if bit_cnt > 0 {
        out.push((bit_buf & 0xFF) as u8);
    }
    out
}
