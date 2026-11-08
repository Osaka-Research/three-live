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

//! Deterministic, seamlessly tiling PBR material presets (`THREE.ProceduralTexture.*`).
//!
//! Native accelerator for the JS kernels in `three-live/src/plugins/procedural.ts`. Both
//! implementations use only integer hashing and IEEE-754 `+ - * / floor sqrt` in the same
//! operation order, so their RGBA output is byte-identical across Web workers (V8), the Rust
//! CLI / MCP server, Android, and iOS (Boa). Keep the two in lockstep.

use boa_engine::object::builtins::JsArray;
use boa_engine::{js_string, Context, JsResult, JsValue, NativeFunction};

/// Preset names in kernel-index order (shared with the JS side).
pub const MATERIAL_PRESETS: [&str; 11] = [
    "checkerboard",
    "grid",
    "wood",
    "marble",
    "brushedMetal",
    "carbonFiber",
    "concrete",
    "brick",
    "fabric",
    "leather",
    "rust",
];

/// Canonicalized kernel parameters (validated and clamped by the JS caller).
#[derive(Debug, Clone, Copy)]
pub struct PresetParams {
    pub kind: u32,
    pub size: usize,
    pub scale: i64,
    pub seed: u32,
    pub color: [f64; 3],
    pub color2: [f64; 3],
    pub roughness: f64,
    pub normal_strength: f64,
}

/// RGBA8 outputs: base color (sRGB), tangent-space normal (glTF / OpenGL convention), and
/// packed occlusion-roughness-metalness (R = 1, G = roughness, B = metalness).
pub struct PresetMaps {
    pub albedo: Vec<u8>,
    pub normal: Vec<u8>,
    pub orm: Vec<u8>,
}

#[inline]
fn hash(ix: i64, iy: i64, seed: u32) -> u32 {
    let mut h = (ix as u32).wrapping_mul(0x27d4_eb2d)
        ^ (iy as u32).wrapping_mul(0x1656_67b1)
        ^ seed.wrapping_mul(0x9e37_79b9);
    h ^= h >> 15;
    h = h.wrapping_mul(0x85eb_ca6b);
    h ^= h >> 13;
    h = h.wrapping_mul(0xc2b2_ae35);
    h ^= h >> 16;
    h
}

#[inline]
fn rnd(ix: i64, iy: i64, seed: u32) -> f64 {
    hash(ix, iy, seed) as f64 / 4294967296.0
}

/// Periodic value noise on an integer lattice with periods `px` x `py`.
fn value_noise(x: f64, y: f64, px: i64, py: i64, seed: u32) -> f64 {
    let xf0 = x.floor();
    let yf0 = y.floor();
    let fx = x - xf0;
    let fy = y - yf0;
    let x0 = (xf0 as i64).rem_euclid(px);
    let y0 = (yf0 as i64).rem_euclid(py);
    let x1 = (x0 + 1).rem_euclid(px);
    let y1 = (y0 + 1).rem_euclid(py);
    let u = fx * fx * (3.0 - 2.0 * fx);
    let v = fy * fy * (3.0 - 2.0 * fy);
    let a = rnd(x0, y0, seed);
    let b = rnd(x1, y0, seed);
    let c = rnd(x0, y1, seed);
    let d = rnd(x1, y1, seed);
    a + (b - a) * u + (c - a) * v + (a - b - c + d) * u * v
}

/// Seamless fractal sum of `oct` octaves of periodic value noise over the unit square.
fn fbm(u: f64, v: f64, px: i64, py: i64, oct: u32, seed: u32) -> f64 {
    let mut sum = 0.0;
    let mut amp = 0.5;
    let mut norm = 0.0;
    let mut f = 1i64;
    for o in 0..oct {
        let pfx = px * f;
        let pfy = py * f;
        sum += amp * value_noise(u * pfx as f64, v * pfy as f64, pfx, pfy, seed.wrapping_add(o));
        norm += amp;
        amp *= 0.5;
        f *= 2;
    }
    sum / norm
}

#[inline]
fn frac(x: f64) -> f64 {
    x - x.floor()
}

#[inline]
fn tri(x: f64) -> f64 {
    (frac(x) * 2.0 - 1.0).abs()
}

#[inline]
fn smooth(e0: f64, e1: f64, x: f64) -> f64 {
    let t = ((x - e0) / (e1 - e0)).clamp(0.0, 1.0);
    t * t * (3.0 - 2.0 * t)
}

#[inline]
fn mix(a: f64, b: f64, t: f64) -> f64 {
    a + (b - a) * t
}

#[inline]
fn to_byte(v: f64) -> u8 {
    if v <= 0.0 {
        0
    } else if v >= 1.0 {
        255
    } else {
        (v * 255.0 + 0.5).floor() as u8
    }
}

/// Evaluates one texel: returns `(r, g, b, height, roughness, metalness)`.
fn shade(p: &PresetParams, u: f64, v: f64, xi: i64, yi: i64) -> [f64; 6] {
    let s = p.scale;
    let sf = s as f64;
    let c = p.color;
    let c2 = p.color2;
    let seed = p.seed;
    let rough = p.roughness;
    let k = |m: f64| [c[0] * m, c[1] * m, c[2] * m];
    match p.kind {
        // checkerboard
        0 => {
            let cx = (u * sf).floor() as i64;
            let cy = (v * sf).floor() as i64;
            let col = if (cx + cy).rem_euclid(2) == 1 { c2 } else { c };
            [col[0], col[1], col[2], 0.5, rough, 0.0]
        }
        // grid
        1 => {
            let fu = frac(u * sf);
            let fv = frac(v * sf);
            let d = fu.min(1.0 - fu).min(fv).min(1.0 - fv);
            let lw = 0.035f64.max(sf / p.size as f64);
            let line = 1.0 - smooth(lw * 0.5, lw, d);
            [
                mix(c[0], c2[0], line),
                mix(c[1], c2[1], line),
                mix(c[2], c2[2], line),
                0.3 + 0.4 * line,
                rough,
                0.0,
            ]
        }
        // wood
        2 => {
            let n = fbm(u, v, 4, 4, 4, seed);
            let t = v * sf + n * 1.5;
            let ring = tri(t);
            let grain = fbm(u, v, 2, 96, 2, seed.wrapping_add(7));
            let w = ring * 0.7 + grain * 0.3;
            let m = mix(0.55, 1.0, w);
            [c[0] * m, c[1] * m, c[2] * m, w, rough + (1.0 - w) * 0.15, 0.0]
        }
        // marble
        3 => {
            let n = fbm(u, v, 3, 3, 5, seed);
            let t = (u + v) * sf + n * 2.5;
            let v1 = tri(t);
            let v2 = v1 * v1;
            let v4 = v2 * v2;
            let vein = v4 * v4;
            let cloud = 0.92 + 0.08 * n;
            let a = vein * 0.85;
            [
                mix(c[0], c2[0], a) * cloud,
                mix(c[1], c2[1], a) * cloud,
                mix(c[2], c2[2], a) * cloud,
                0.5 - vein * 0.2,
                rough + vein * 0.1,
                0.0,
            ]
        }
        // brushedMetal
        4 => {
            let n = fbm(u, v, 2, 192 * s, 2, seed);
            let fine = rnd(xi, yi, seed.wrapping_add(3));
            let m = 0.85 + 0.12 * n + 0.03 * fine;
            let col = k(m);
            [col[0], col[1], col[2], 0.35 + n * 0.3, rough + (n - 0.5) * 0.12, 1.0]
        }
        // carbonFiber
        5 => {
            let g = sf * 2.0;
            let gu = u * g;
            let gv = v * g;
            let i = gu.floor() as i64;
            let j = gv.floor() as i64;
            let fu = gu - gu.floor();
            let fv = gv - gv.floor();
            let horizontal = (i + j).rem_euclid(2) == 0;
            let q = if horizontal { fv * 2.0 - 1.0 } else { fu * 2.0 - 1.0 };
            let bump = 1.0 - q * q;
            let fibers = if horizontal { tri(fv * 8.0) } else { tri(fu * 8.0) };
            let m = 0.6 + 0.4 * bump;
            let sheen = 0.08 * fibers;
            [
                c[0] * m + sheen,
                c[1] * m + sheen,
                c[2] * m + sheen,
                bump * 0.8,
                rough + 0.1 * (1.0 - bump),
                0.0,
            ]
        }
        // concrete
        6 => {
            let n = fbm(u, v, s, s, 5, seed);
            let sp = rnd(xi, yi, seed.wrapping_add(31));
            let s16 = s * 16;
            let pit = smooth(
                0.82,
                0.9,
                value_noise(u * s16 as f64, v * s16 as f64, s16, s16, seed.wrapping_add(17)),
            );
            let m = (0.82 + 0.25 * n + 0.06 * (sp - 0.5)) * (1.0 - 0.35 * pit);
            let col = k(m);
            [col[0], col[1], col[2], 0.5 + 0.25 * (n - 0.5) - 0.3 * pit, rough - 0.05 * n, 0.0]
        }
        // brick
        7 => {
            let half = s / 2;
            let gv = v * sf;
            let row = gv.floor() as i64;
            let fv = gv - gv.floor();
            let off = if row.rem_euclid(2) == 1 { 0.5 } else { 0.0 };
            let bu = u * half as f64 + off;
            let bi = bu.floor() as i64;
            let fu = bu - bu.floor();
            let dx = fu.min(1.0 - fu) * 2.0;
            let dy = fv.min(1.0 - fv);
            let d = dx.min(dy);
            let mw = 0.06f64.max(1.5 * sf / p.size as f64);
            let mortar = 1.0 - smooth(mw * 0.5, mw, d);
            let var = rnd(bi.rem_euclid(half), row.rem_euclid(s), seed);
            let n = fbm(u, v, s, s, 3, seed.wrapping_add(5));
            let bm = 0.8 + 0.25 * var + 0.15 * (n - 0.5);
            let mm = 0.9 + 0.1 * n;
            [
                mix(c[0] * bm, c2[0] * mm, mortar),
                mix(c[1] * bm, c2[1] * mm, mortar),
                mix(c[2] * bm, c2[2] * mm, mortar),
                (1.0 - mortar) * (0.75 + 0.1 * n) + mortar * 0.2,
                mix(rough, 0.95, mortar),
                0.0,
            ]
        }
        // fabric
        8 => {
            let gu = u * sf;
            let gv = v * sf;
            let i = gu.floor() as i64;
            let j = gv.floor() as i64;
            let qu = (gu - gu.floor()) * 2.0 - 1.0;
            let qv = (gv - gv.floor()) * 2.0 - 1.0;
            let over = (i + j).rem_euclid(2) == 0;
            let h = if over { 1.0 - qu * qu } else { 1.0 - qv * qv };
            let n = fbm(u, v, 4, 4, 2, seed);
            let m = (0.75 + 0.25 * h) * (0.95 + 0.1 * (n - 0.5));
            let col = k(m);
            [col[0], col[1], col[2], h, rough, 0.0]
        }
        // leather
        9 => {
            let gu = u * sf;
            let gv = v * sf;
            let cx = gu.floor() as i64;
            let cy = gv.floor() as i64;
            let mut f1 = 1e9f64;
            let mut f2 = 1e9f64;
            for dy in -1..=1i64 {
                for dx in -1..=1i64 {
                    let nx = cx + dx;
                    let ny = cy + dy;
                    let wx = nx.rem_euclid(s);
                    let wy = ny.rem_euclid(s);
                    let fx = nx as f64 + rnd(wx, wy, seed) - gu;
                    let fy = ny as f64 + rnd(wx, wy, seed.wrapping_add(1)) - gv;
                    let d = fx * fx + fy * fy;
                    if d < f1 {
                        f2 = f1;
                        f1 = d;
                    } else if d < f2 {
                        f2 = d;
                    }
                }
            }
            let crease = 1.0 - smooth(0.0, 0.12, f2.sqrt() - f1.sqrt());
            let n = fbm(u, v, 4, 4, 3, seed.wrapping_add(3));
            let m = (0.85 + 0.2 * (n - 0.5)) * (1.0 - 0.3 * crease);
            let col = k(m);
            [
                col[0],
                col[1],
                col[2],
                0.6 - 0.4 * crease + 0.1 * (n - 0.5),
                rough + 0.15 * crease,
                0.0,
            ]
        }
        // rust
        _ => {
            let n = fbm(u, v, s, s, 5, seed);
            let patch = smooth(0.45, 0.6, n);
            let detail = fbm(u, v, s * 8, s * 8, 3, seed.wrapping_add(9));
            let mm = 0.9 + 0.1 * detail;
            let rm = 0.7 + 0.5 * detail;
            [
                mix(c2[0] * mm, c[0] * rm, patch),
                mix(c2[1] * mm, c[1] * rm, patch),
                mix(c2[2] * mm, c[2] * rm, patch),
                0.4 + 0.4 * patch * detail + 0.1 * patch,
                mix(0.35, rough, patch),
                1.0 - patch,
            ]
        }
    }
}

/// Generates the three RGBA8 maps for a canonicalized preset.
pub fn generate_material_preset(p: &PresetParams) -> PresetMaps {
    let n = p.size;
    let nf = n as f64;
    let mut albedo = vec![0u8; n * n * 4];
    let mut orm = vec![0u8; n * n * 4];
    let mut height = vec![0f64; n * n];
    for y in 0..n {
        let v = (y as f64 + 0.5) / nf;
        for x in 0..n {
            let u = (x as f64 + 0.5) / nf;
            let t = shade(p, u, v, x as i64, y as i64);
            let o = (y * n + x) * 4;
            albedo[o] = to_byte(t[0]);
            albedo[o + 1] = to_byte(t[1]);
            albedo[o + 2] = to_byte(t[2]);
            albedo[o + 3] = 255;
            orm[o] = 255;
            orm[o + 1] = to_byte(t[4]);
            orm[o + 2] = to_byte(t[5]);
            orm[o + 3] = 255;
            height[y * n + x] = t[3];
        }
    }
    let mut normal = vec![0u8; n * n * 4];
    let sscale = p.normal_strength * nf * 0.0625;
    for y in 0..n {
        let yu = (y + n - 1) % n;
        let yd = (y + 1) % n;
        for x in 0..n {
            let xl = (x + n - 1) % n;
            let xr = (x + 1) % n;
            let dx = height[y * n + xr] - height[y * n + xl];
            let dy = height[yd * n + x] - height[yu * n + x];
            let nx = -dx * sscale;
            let ny = dy * sscale;
            let inv = 1.0 / (nx * nx + ny * ny + 1.0).sqrt();
            let o = (y * n + x) * 4;
            normal[o] = to_byte(nx * inv * 0.5 + 0.5);
            normal[o + 1] = to_byte(ny * inv * 0.5 + 0.5);
            normal[o + 2] = to_byte(inv * 0.5 + 0.5);
            normal[o + 3] = 255;
        }
    }
    PresetMaps { albedo, normal, orm }
}

fn arg_f64(args: &[JsValue], i: usize, ctx: &mut Context) -> JsResult<f64> {
    Ok(args.get(i).map(|v| v.to_number(ctx)).transpose()?.unwrap_or(0.0))
}

/// `__three_live_native_material_preset__(kind, size, scale, seed, r, g, b, r2, g2, b2,
/// roughness, normalStrength)` -> `[albedo, normal, orm]` RGBA8 `Uint8Array`s, or `null` when
/// the parameters are out of range (the JS caller then uses its own kernels).
pub fn native_material_preset(
    _this: &JsValue,
    args: &[JsValue],
    context: &mut Context,
) -> JsResult<JsValue> {
    let mut a = [0f64; 12];
    for (i, slot) in a.iter_mut().enumerate() {
        *slot = arg_f64(args, i, context)?;
    }
    if a.iter().any(|v| !v.is_finite())
        || a[0] < 0.0
        || a[0] >= MATERIAL_PRESETS.len() as f64
        || !(4.0..=512.0).contains(&a[1])
        || !(1.0..=256.0).contains(&a[2])
        || a[0].fract() != 0.0
        || a[1].fract() != 0.0
        || a[2].fract() != 0.0
        || a[3] < 0.0
        || a[3] > u32::MAX as f64
        || a[3].fract() != 0.0
    {
        return Ok(JsValue::null());
    }
    let p = PresetParams {
        kind: a[0] as u32,
        size: a[1] as usize,
        scale: a[2] as i64,
        seed: a[3] as u32,
        color: [a[4], a[5], a[6]],
        color2: [a[7], a[8], a[9]],
        roughness: a[10],
        normal_strength: a[11],
    };
    let maps = generate_material_preset(&p);
    let mk = |bytes: &[u8], ctx: &mut Context| -> JsResult<JsValue> {
        Ok(crate::usdz::js_uint8_array_from_slice(bytes, ctx)?.into())
    };
    let albedo = mk(&maps.albedo, context)?;
    let normal = mk(&maps.normal, context)?;
    let orm = mk(&maps.orm, context)?;
    Ok(JsArray::from_iter([albedo, normal, orm], context).into())
}

/// Registers `__three_live_native_material_preset__` on the global object.
pub fn register_native_material_callables(context: &mut Context) -> JsResult<()> {
    context.register_global_builtin_callable(
        js_string!("__three_live_native_material_preset__"),
        12,
        NativeFunction::from_fn_ptr(native_material_preset),
    )
}

/// FNV-1a 32-bit checksum used by the cross-language parity tests.
pub fn fnv1a32(bytes: &[u8]) -> u32 {
    let mut h = 0x811c_9dc5u32;
    for &b in bytes {
        h ^= b as u32;
        h = h.wrapping_mul(0x0100_0193);
    }
    h
}

#[cfg(test)]
mod tests {
    use super::*;

    pub(crate) fn params(kind: u32, size: usize, scale: i64) -> PresetParams {
        PresetParams {
            kind,
            size,
            scale,
            seed: 1,
            color: [0.55, 0.35, 0.17],
            color2: [0.9, 0.9, 0.88],
            roughness: 0.6,
            normal_strength: 1.0,
        }
    }

    #[test]
    fn presets_are_deterministic_seamless_and_in_range() {
        for kind in 0..MATERIAL_PRESETS.len() as u32 {
            let scale = if kind == 7 { 8 } else { 4 };
            let a = generate_material_preset(&params(kind, 32, scale));
            let b = generate_material_preset(&params(kind, 32, scale));
            assert_eq!(
                fnv1a32(&a.albedo),
                fnv1a32(&b.albedo),
                "{}",
                MATERIAL_PRESETS[kind as usize]
            );
            assert!(a.albedo.chunks_exact(4).all(|p| p[3] == 255));
            assert!(a.orm.chunks_exact(4).all(|p| p[0] == 255 && p[3] == 255));
            // Normals point outward (blue >= 128) everywhere.
            assert!(a.normal.chunks_exact(4).all(|p| p[2] >= 128));
            // Seamless: shading is exactly periodic with period 1 in u and v.
            let p = params(kind, 32, scale);
            for (u, v) in [(0.013, 0.37), (0.37, 0.81), (0.81, 0.013), (0.5, 0.5)] {
                let base = shade(&p, u, v, 3, 5);
                let du = shade(&p, u + 1.0, v, 3, 5);
                let dv = shade(&p, u, v + 1.0, 3, 5);
                for c in 0..6 {
                    assert!(
                        (base[c] - du[c]).abs() < 1e-6 && (base[c] - dv[c]).abs() < 1e-6,
                        "{} not periodic on channel {} at ({}, {})",
                        MATERIAL_PRESETS[kind as usize],
                        c,
                        u,
                        v
                    );
                }
            }
            // Seeds change the result (checkerboard, grid, and carbonFiber are seed-free).
            let mut q = params(kind, 32, scale);
            q.seed = 2;
            let c = generate_material_preset(&q);
            if kind >= 2 && kind != 5 {
                assert_ne!(fnv1a32(&a.albedo), fnv1a32(&c.albedo));
            }
        }
    }

    #[test]
    fn rust_preset_metalness_tracks_patches_and_brushed_metal_is_metal() {
        let m = generate_material_preset(&params(4, 16, 1));
        assert!(m.orm.chunks_exact(4).all(|p| p[2] == 255));
        let r = generate_material_preset(&params(10, 64, 4));
        let metal: Vec<u8> = r.orm.chunks_exact(4).map(|p| p[2]).collect();
        assert!(metal.iter().any(|&b| b > 200) && metal.iter().any(|&b| b < 50));
    }
}

/// FNV-1a hashes of `[albedo, normal, orm]` for [`parity_params`]. The JS kernels in
/// `three-live/tests/three_procedural_test.ts` assert the same constants, proving the Web
/// worker and Boa outputs are byte-identical.
#[cfg(test)]
pub(crate) const PARITY_HASHES: [[u32; 3]; 11] = [
    [1790197189, 3455663557, 2500509125],
    [1478526405, 1444740549, 2500509125],
    [1443984829, 2558384049, 135696830],
    [3324647719, 2659050445, 2746743098],
    [107901172, 1108293677, 658875471],
    [1265016261, 4205602757, 4063555013],
    [2375540222, 4017094934, 479134790],
    [4050570107, 1948544486, 3373758917],
    [2095234875, 3455663557, 2500509125],
    [716167143, 2720860795, 1956285490],
    [1433902205, 225922196, 1140331227],
];

#[cfg(test)]
mod parity {
    use super::*;
    #[test]
    fn native_kernels_match_pinned_cross_language_hashes() {
        for kind in 0..11u32 {
            let m = generate_material_preset(&parity_params(kind));
            let got = [fnv1a32(&m.albedo), fnv1a32(&m.normal), fnv1a32(&m.orm)];
            assert_eq!(got, PARITY_HASHES[kind as usize], "{}", MATERIAL_PRESETS[kind as usize]);
        }
    }
}

/// Fixed parameters shared with `three-live/tests/three_procedural_test.ts`
/// (`color: 0x996633`, `color2: 0xd9d9cc`, `seed: 7`, `size: 64`).
#[cfg(test)]
pub(crate) fn parity_params(kind: u32) -> PresetParams {
    PresetParams {
        kind,
        size: 64,
        scale: [8, 8, 10, 3, 1, 8, 4, 8, 32, 12, 4][kind as usize],
        seed: 7,
        color: [153.0 / 255.0, 102.0 / 255.0, 51.0 / 255.0],
        color2: [217.0 / 255.0, 217.0 / 255.0, 204.0 / 255.0],
        roughness: 0.5,
        normal_strength: 1.25,
    }
}
