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

//! Reference-driven authoring (`three_live_render` / `three-live-cli render --reference`).
//!
//! Decodes a reference photo, product shot, mockup, sketch, or blueprint (PNG or JPEG),
//! renders the scene at the reference's aspect ratio, and composites
//! `REFERENCE | RENDER | OVERLAY | SILHOUETTE DIFF` panels plus scale- and
//! translation-invariant silhouette metrics so coding agents can converge on the target's
//! proportions in a few turns.

use crate::render::{
    decode_base64_str, draw_label_badge, render_viewport_rgba_with_mask, RenderViewMode,
};
use crate::scene::SceneGraph;
use serde::Serialize;

/// Maximum encoded reference size accepted from disk or a data URI.
pub const MAX_REFERENCE_BYTES: usize = 32 * 1024 * 1024;
/// Maximum decoded reference dimension (per side) before downscaling.
pub const MAX_REFERENCE_DIM: u32 = 8192;
/// Maximum decoded reference pixel count before downscaling.
const MAX_REFERENCE_PIXELS: u64 = 40_000_000;
/// Decoded references are box-downscaled so their longest side is at most this.
pub const REFERENCE_WORKING_DIM: u32 = 1024;
/// Side length of the normalized silhouette comparison grid.
const SIL_GRID: usize = 256;
/// Maximum composite sheet width in pixels.
const MAX_SHEET_WIDTH: u32 = 2560;

/// A decoded RGBA8 reference image.
#[derive(Debug, Clone)]
pub struct ReferenceImage {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
}

/// Silhouette and proportion metrics comparing the render to the reference.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct ReferenceMetrics {
    /// Reference size after decoding (and EXIF orientation), before downscaling.
    pub reference_size: [u32; 2],
    /// Size of each composite panel (`[width, height]`, matching the reference aspect).
    pub panel_size: [u32; 2],
    pub view: String,
    /// How the reference foreground was isolated: `alpha`, `background`, or `none`.
    pub reference_segmentation: String,
    /// True when silhouette metrics are trustworthy (clean cutout or uniform background,
    /// solid subject, render not empty). For photos with busy backgrounds or line-art sketches,
    /// compare visually using the OVERLAY panel instead.
    pub silhouette_reliable: bool,
    /// Scale/translation-invariant intersection-over-union of the two silhouettes (0..1).
    pub silhouette_iou: Option<f64>,
    /// Bounding-box width / height of the reference silhouette.
    pub reference_aspect: Option<f64>,
    /// Bounding-box width / height of the rendered silhouette.
    pub render_aspect: Option<f64>,
    /// `render_aspect / reference_aspect - 1` (positive = render relatively wider).
    pub aspect_error: Option<f64>,
    /// Fraction of each panel covered by the reference / rendered silhouette.
    pub reference_coverage: f64,
    pub render_coverage: f64,
    /// Human-readable hints for the next iteration.
    pub guidance: Vec<String>,
}

/// Composite comparison sheet plus metrics.
#[derive(Debug, Clone)]
pub struct ReferenceComparison {
    pub width: u32,
    pub height: u32,
    pub rgba: Vec<u8>,
    pub metrics: ReferenceMetrics,
}

/// Loads reference bytes from a `data:image/...;base64,` URI or a local file path.
pub fn load_reference_bytes(spec: &str) -> Result<Vec<u8>, String> {
    let s = spec.trim();
    if s.is_empty() {
        return Err(
            "`reference` is empty: pass a PNG/JPEG file path or a data:image/... URI.".to_string()
        );
    }
    let lower = s.get(..8).unwrap_or(s).to_ascii_lowercase();
    if lower.starts_with("http://") || lower.starts_with("https:/") {
        return Err(
            "Remote reference URLs are not fetched (the renderer never touches the \
                    network). Download the image and pass its local path or a data:image/... URI."
                .to_string(),
        );
    }
    if lower.starts_with("data:") {
        let comma = s.find(',').ok_or("Malformed data URI: missing ','")?;
        let header = &s[5..comma];
        if !header.to_ascii_lowercase().ends_with(";base64") {
            return Err("Reference data URIs must be base64-encoded (data:image/png;base64,...)."
                .to_string());
        }
        let bytes = decode_base64_str(&s[comma + 1..], MAX_REFERENCE_BYTES)
            .ok_or("Reference data URI has invalid base64 or exceeds 32 MB")?;
        if bytes.is_empty() {
            return Err("Reference data URI is empty".to_string());
        }
        return Ok(bytes);
    }
    // Accept `file:///abs/path` URIs as plain paths.
    let s = if lower.starts_with("file://") { &s[7..] } else { s };
    let meta =
        std::fs::metadata(s).map_err(|e| format!("Failed reading reference {:?}: {}", s, e))?;
    if !meta.is_file() {
        return Err(format!("Reference {:?} is not a file", s));
    }
    if meta.len() > MAX_REFERENCE_BYTES as u64 {
        return Err(format!("Reference {:?} is larger than 32 MB", s));
    }
    std::fs::read(s).map_err(|e| format!("Failed reading reference {:?}: {}", s, e))
}

/// Decodes PNG or JPEG bytes into RGBA8, applies JPEG EXIF orientation, and downscales so the
/// longest side is at most [`REFERENCE_WORKING_DIM`]. Returns the working image and the
/// oriented, pre-downscale size.
pub fn decode_reference_image(bytes: &[u8]) -> Result<(ReferenceImage, [u32; 2]), String> {
    let img = if bytes.len() >= 8 && &bytes[0..8] == b"\x89PNG\r\n\x1a\n" {
        decode_png(bytes)?
    } else if bytes.len() >= 3 && bytes[0] == 0xFF && bytes[1] == 0xD8 && bytes[2] == 0xFF {
        decode_jpeg(bytes)?
    } else {
        let kind = if bytes.starts_with(b"GIF8") {
            "GIF"
        } else if bytes.len() >= 12 && &bytes[0..4] == b"RIFF" && &bytes[8..12] == b"WEBP" {
            "WebP"
        } else if bytes.len() >= 12 && &bytes[4..8] == b"ftyp" {
            "HEIC/AVIF"
        } else {
            "unknown"
        };
        return Err(format!("Unsupported reference image format ({}). Use PNG or JPEG.", kind));
    };
    let orig = [img.width, img.height];
    Ok((downscale_to(img, REFERENCE_WORKING_DIM), orig))
}

fn check_dims(w: u64, h: u64) -> Result<(), String> {
    if w == 0 || h == 0 {
        return Err("Reference image has zero width or height".to_string());
    }
    if w > MAX_REFERENCE_DIM as u64 || h > MAX_REFERENCE_DIM as u64 || w * h > MAX_REFERENCE_PIXELS
    {
        return Err(format!(
            "Reference image {}x{} is too large (max {} px per side, 40 MP total)",
            w, h, MAX_REFERENCE_DIM
        ));
    }
    Ok(())
}

// ---------------------------------------------------------------------------------------------
// PNG (all color types, bit depths 1/2/4/8/16, tRNS, Adam7)
// ---------------------------------------------------------------------------------------------

fn decode_png(png: &[u8]) -> Result<ReferenceImage, String> {
    let bad = |m: &str| format!("Invalid PNG reference: {}", m);
    let mut pos = 8usize;
    let mut ihdr: Option<(u32, u32, u8, u8, u8)> = None;
    let mut idat = Vec::new();
    let mut plte: Vec<[u8; 3]> = Vec::new();
    let mut trns: Vec<u8> = Vec::new();
    while pos + 12 <= png.len() {
        let len = u32::from_be_bytes([png[pos], png[pos + 1], png[pos + 2], png[pos + 3]]) as usize;
        let ctype = &png[pos + 4..pos + 8];
        let start = pos + 8;
        let end = start.checked_add(len).ok_or_else(|| bad("chunk length overflow"))?;
        if end + 4 > png.len() {
            return Err(bad("truncated chunk"));
        }
        let data = &png[start..end];
        match ctype {
            b"IHDR" => {
                if len != 13 {
                    return Err(bad("IHDR length"));
                }
                let w = u32::from_be_bytes([data[0], data[1], data[2], data[3]]);
                let h = u32::from_be_bytes([data[4], data[5], data[6], data[7]]);
                ihdr = Some((w, h, data[8], data[9], data[12]));
            }
            b"PLTE" => {
                plte = data.chunks_exact(3).map(|c| [c[0], c[1], c[2]]).collect();
            }
            b"tRNS" => trns = data.to_vec(),
            b"IDAT" => {
                if idat.len() + data.len() > MAX_REFERENCE_BYTES {
                    return Err(bad("IDAT too large"));
                }
                idat.extend_from_slice(data);
            }
            b"IEND" => break,
            _ => {}
        }
        pos = end + 4;
    }
    let (w, h, depth, ctype, interlace) = ihdr.ok_or_else(|| bad("missing IHDR"))?;
    check_dims(w as u64, h as u64)?;
    let channels: usize = match ctype {
        0 => 1,
        2 => 3,
        3 => 1,
        4 => 2,
        6 => 4,
        _ => return Err(bad("unknown color type")),
    };
    let depth_ok = match ctype {
        0 => matches!(depth, 1 | 2 | 4 | 8 | 16),
        3 => matches!(depth, 1 | 2 | 4 | 8),
        _ => matches!(depth, 8 | 16),
    };
    if !depth_ok {
        return Err(bad("invalid bit depth for color type"));
    }
    if ctype == 3 && plte.is_empty() {
        return Err(bad("palette image without PLTE"));
    }
    if interlace > 1 {
        return Err(bad("unknown interlace method"));
    }
    let (wu, hu) = (w as usize, h as usize);
    let bits_pp = channels * depth as usize;
    let bpp = bits_pp.div_ceil(8).max(1);
    let passes: Vec<(usize, usize, usize, usize)> = if interlace == 1 {
        vec![
            (0, 0, 8, 8),
            (4, 0, 8, 8),
            (0, 4, 4, 8),
            (2, 0, 4, 4),
            (0, 2, 2, 4),
            (1, 0, 2, 2),
            (0, 1, 1, 2),
        ]
    } else {
        vec![(0, 0, 1, 1)]
    };
    let pass_dims: Vec<(usize, usize)> = passes
        .iter()
        .map(|&(x0, y0, dx, dy)| {
            let pw = if wu > x0 { (wu - x0).div_ceil(dx) } else { 0 };
            let ph = if hu > y0 { (hu - y0).div_ceil(dy) } else { 0 };
            (pw, ph)
        })
        .collect();
    let expected: usize = pass_dims
        .iter()
        .filter(|(pw, ph)| *pw > 0 && *ph > 0)
        .map(|&(pw, ph)| ph * (1 + (pw * bits_pp).div_ceil(8)))
        .sum();
    let raw = miniz_oxide::inflate::decompress_to_vec_zlib_with_limit(&idat, expected + 4096)
        .map_err(|_| bad("corrupt or oversized zlib stream"))?;
    if raw.len() < expected {
        return Err(bad("image data is truncated"));
    }

    let max_v = (1u32 << depth) - 1;
    let mut out = vec![0u8; wu * hu * 4];
    let mut off = 0usize;
    for (pi, &(x0, y0, dx, dy)) in passes.iter().enumerate() {
        let (pw, ph) = pass_dims[pi];
        if pw == 0 || ph == 0 {
            continue;
        }
        let row_len = (pw * bits_pp).div_ceil(8);
        let mut prev = vec![0u8; row_len];
        let mut cur = vec![0u8; row_len];
        for ry in 0..ph {
            let ft = raw[off];
            cur.copy_from_slice(&raw[off + 1..off + 1 + row_len]);
            off += 1 + row_len;
            unfilter_row(ft, &mut cur, &prev, bpp).map_err(|e| bad(&e))?;
            for rx in 0..pw {
                let px = convert_png_pixel(&cur, rx, ctype, depth, channels, max_v, &plte, &trns);
                let (x, y) = (x0 + rx * dx, y0 + ry * dy);
                let o = (y * wu + x) * 4;
                out[o..o + 4].copy_from_slice(&px);
            }
            std::mem::swap(&mut prev, &mut cur);
        }
    }
    Ok(ReferenceImage { width: w, height: h, rgba: out })
}

fn unfilter_row(ft: u8, cur: &mut [u8], prev: &[u8], bpp: usize) -> Result<(), String> {
    match ft {
        0 => {}
        1 => {
            for i in bpp..cur.len() {
                cur[i] = cur[i].wrapping_add(cur[i - bpp]);
            }
        }
        2 => {
            for i in 0..cur.len() {
                cur[i] = cur[i].wrapping_add(prev[i]);
            }
        }
        3 => {
            for i in 0..cur.len() {
                let a = if i >= bpp { cur[i - bpp] as u16 } else { 0 };
                cur[i] = cur[i].wrapping_add(((a + prev[i] as u16) / 2) as u8);
            }
        }
        4 => {
            for i in 0..cur.len() {
                let a = if i >= bpp { cur[i - bpp] as i16 } else { 0 };
                let b = prev[i] as i16;
                let c = if i >= bpp { prev[i - bpp] as i16 } else { 0 };
                let p = a + b - c;
                let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                let pred = if pa <= pb && pa <= pc {
                    a
                } else if pb <= pc {
                    b
                } else {
                    c
                };
                cur[i] = cur[i].wrapping_add(pred as u8);
            }
        }
        _ => return Err(format!("unknown filter type {}", ft)),
    }
    Ok(())
}

/// Reads sample `idx` (in samples, not bytes) from a scanline at `depth` bits per sample.
#[inline]
fn read_sample(row: &[u8], idx: usize, depth: u8) -> u32 {
    match depth {
        8 => row[idx] as u32,
        16 => ((row[idx * 2] as u32) << 8) | row[idx * 2 + 1] as u32,
        _ => {
            let bit = idx * depth as usize;
            let byte = row[bit / 8];
            let shift = 8 - depth as usize - (bit % 8);
            ((byte >> shift) as u32) & ((1u32 << depth) - 1)
        }
    }
}

#[allow(clippy::too_many_arguments)]
fn convert_png_pixel(
    row: &[u8],
    x: usize,
    ctype: u8,
    depth: u8,
    channels: usize,
    max_v: u32,
    plte: &[[u8; 3]],
    trns: &[u8],
) -> [u8; 4] {
    let to8 = |v: u32| -> u8 {
        if depth == 16 {
            (v >> 8) as u8
        } else if depth == 8 {
            v as u8
        } else {
            ((v * 255 + max_v / 2) / max_v) as u8
        }
    };
    let base = x * channels;
    match ctype {
        0 => {
            let v = read_sample(row, base, depth);
            let key = (trns.len() >= 2).then(|| u16::from_be_bytes([trns[0], trns[1]]) as u32);
            let g = to8(v);
            [g, g, g, if key == Some(v) { 0 } else { 255 }]
        }
        2 => {
            let (r, g, b) = (
                read_sample(row, base, depth),
                read_sample(row, base + 1, depth),
                read_sample(row, base + 2, depth),
            );
            let keyed = trns.len() >= 6
                && r == u16::from_be_bytes([trns[0], trns[1]]) as u32
                && g == u16::from_be_bytes([trns[2], trns[3]]) as u32
                && b == u16::from_be_bytes([trns[4], trns[5]]) as u32;
            [to8(r), to8(g), to8(b), if keyed { 0 } else { 255 }]
        }
        3 => {
            let i = read_sample(row, base, depth) as usize;
            let c = plte.get(i).copied().unwrap_or([0, 0, 0]);
            [c[0], c[1], c[2], trns.get(i).copied().unwrap_or(255)]
        }
        4 => {
            let g = to8(read_sample(row, base, depth));
            [g, g, g, to8(read_sample(row, base + 1, depth))]
        }
        _ => [
            to8(read_sample(row, base, depth)),
            to8(read_sample(row, base + 1, depth)),
            to8(read_sample(row, base + 2, depth)),
            to8(read_sample(row, base + 3, depth)),
        ],
    }
}

// ---------------------------------------------------------------------------------------------
// JPEG (baseline + progressive via `jpeg-decoder`, EXIF orientation)
// ---------------------------------------------------------------------------------------------

fn decode_jpeg(bytes: &[u8]) -> Result<ReferenceImage, String> {
    let result = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| {
        let mut dec = jpeg_decoder::Decoder::new(bytes);
        dec.read_info().map_err(|e| format!("Invalid JPEG reference: {}", e))?;
        let info = dec.info().ok_or("Invalid JPEG reference: missing frame header")?;
        check_dims(info.width as u64, info.height as u64)?;
        dec.set_max_decoding_buffer_size(MAX_REFERENCE_PIXELS as usize * 4);
        let pixels = dec.decode().map_err(|e| format!("Invalid JPEG reference: {}", e))?;
        let orientation = dec.exif_data().map(exif_orientation).unwrap_or(1);
        Ok::<_, String>((info, pixels, orientation))
    }));
    let (info, pixels, orientation) =
        result.map_err(|_| "Invalid JPEG reference: decoder rejected the file".to_string())??;
    let (w, h) = (info.width as usize, info.height as usize);
    let n = w * h;
    let mut rgba = vec![255u8; n * 4];
    use jpeg_decoder::PixelFormat;
    let ok = match info.pixel_format {
        PixelFormat::L8 if pixels.len() >= n => {
            for i in 0..n {
                rgba[i * 4..i * 4 + 3].fill(pixels[i]);
            }
            true
        }
        PixelFormat::L16 if pixels.len() >= n * 2 => {
            for i in 0..n {
                rgba[i * 4..i * 4 + 3].fill(pixels[i * 2]);
            }
            true
        }
        PixelFormat::RGB24 if pixels.len() >= n * 3 => {
            for i in 0..n {
                rgba[i * 4..i * 4 + 3].copy_from_slice(&pixels[i * 3..i * 3 + 3]);
            }
            true
        }
        PixelFormat::CMYK32 if pixels.len() >= n * 4 => {
            // Adobe CMYK JPEGs store inverted ink values.
            for i in 0..n {
                let k = pixels[i * 4 + 3] as u32;
                for c in 0..3 {
                    rgba[i * 4 + c] = ((pixels[i * 4 + c] as u32 * k + 127) / 255) as u8;
                }
            }
            true
        }
        _ => false,
    };
    if !ok {
        return Err("Invalid JPEG reference: decoded buffer is truncated".to_string());
    }
    Ok(apply_orientation(ReferenceImage { width: w as u32, height: h as u32, rgba }, orientation))
}

/// Parses the EXIF `Orientation` tag (0x0112) from a TIFF-header EXIF blob. Returns 1..=8.
fn exif_orientation(tiff: &[u8]) -> u8 {
    if tiff.len() < 8 {
        return 1;
    }
    let le = match &tiff[0..2] {
        b"II" => true,
        b"MM" => false,
        _ => return 1,
    };
    let u16_at = |o: usize| -> Option<u16> {
        let b = tiff.get(o..o + 2)?;
        Some(if le { u16::from_le_bytes([b[0], b[1]]) } else { u16::from_be_bytes([b[0], b[1]]) })
    };
    let u32_at = |o: usize| -> Option<u32> {
        let b = tiff.get(o..o + 4)?;
        Some(if le {
            u32::from_le_bytes([b[0], b[1], b[2], b[3]])
        } else {
            u32::from_be_bytes([b[0], b[1], b[2], b[3]])
        })
    };
    let Some(ifd) = u32_at(4).map(|v| v as usize) else { return 1 };
    let Some(count) = u16_at(ifd) else { return 1 };
    for i in 0..count.min(256) as usize {
        let e = ifd + 2 + i * 12;
        if u16_at(e) == Some(0x0112) {
            let v = u16_at(e + 8).unwrap_or(1);
            return if (1..=8).contains(&v) { v as u8 } else { 1 };
        }
    }
    1
}

/// Applies an EXIF orientation (1..=8) so the image appears upright.
fn apply_orientation(img: ReferenceImage, orientation: u8) -> ReferenceImage {
    if orientation <= 1 || orientation > 8 {
        return img;
    }
    let (w, h) = (img.width as usize, img.height as usize);
    let swap = orientation >= 5;
    let (ow, oh) = if swap { (h, w) } else { (w, h) };
    let mut out = vec![0u8; ow * oh * 4];
    for y in 0..oh {
        for x in 0..ow {
            // Map each output pixel back to its source pixel.
            let (sx, sy) = match orientation {
                2 => (w - 1 - x, y),
                3 => (w - 1 - x, h - 1 - y),
                4 => (x, h - 1 - y),
                5 => (y, x),
                6 => (y, h - 1 - x),
                7 => (w - 1 - y, h - 1 - x),
                _ => (w - 1 - y, x),
            };
            let s = (sy * w + sx) * 4;
            let d = (y * ow + x) * 4;
            out[d..d + 4].copy_from_slice(&img.rgba[s..s + 4]);
        }
    }
    ReferenceImage { width: ow as u32, height: oh as u32, rgba: out }
}

// ---------------------------------------------------------------------------------------------
// Resampling, segmentation, and metrics
// ---------------------------------------------------------------------------------------------

/// Box-filter downscale so the longest side is at most `max_dim` (never upscales).
fn downscale_to(img: ReferenceImage, max_dim: u32) -> ReferenceImage {
    let longest = img.width.max(img.height);
    if longest <= max_dim {
        return img;
    }
    let scale = max_dim as f64 / longest as f64;
    let ow = ((img.width as f64 * scale).round() as u32).max(1);
    let oh = ((img.height as f64 * scale).round() as u32).max(1);
    ReferenceImage { width: ow, height: oh, rgba: resample_area(&img, ow, oh) }
}

/// Area-average resample (used for downscaling; falls back to nearest when upscaling).
fn resample_area(img: &ReferenceImage, ow: u32, oh: u32) -> Vec<u8> {
    let (sw, sh) = (img.width as usize, img.height as usize);
    let (ow, oh) = (ow as usize, oh as usize);
    let mut out = vec![0u8; ow * oh * 4];
    for y in 0..oh {
        let sy0 = y * sh / oh;
        let sy1 = ((y + 1) * sh / oh).max(sy0 + 1).min(sh);
        for x in 0..ow {
            let sx0 = x * sw / ow;
            let sx1 = ((x + 1) * sw / ow).max(sx0 + 1).min(sw);
            let mut acc = [0u32; 4];
            let mut cnt = 0u32;
            for yy in sy0..sy1 {
                for xx in sx0..sx1 {
                    let s = (yy * sw + xx) * 4;
                    for (c, a) in acc.iter_mut().enumerate() {
                        *a += img.rgba[s + c] as u32;
                    }
                    cnt += 1;
                }
            }
            let d = (y * ow + x) * 4;
            for c in 0..4 {
                out[d + c] = ((acc[c] + cnt / 2) / cnt.max(1)) as u8;
            }
        }
    }
    out
}

/// Scales the reference uniformly to fit a `pw x ph` panel (centered), padding any leftover
/// area with the reference's median border color so letterboxing reads as background.
fn fit_reference_into_panel(img: &ReferenceImage, pw: u32, ph: u32) -> Vec<u8> {
    let s = (pw as f64 / img.width as f64).min(ph as f64 / img.height as f64);
    let fw = ((img.width as f64 * s).round() as u32).clamp(1, pw);
    let fh = ((img.height as f64 * s).round() as u32).clamp(1, ph);
    let fitted = resample_area(img, fw, fh);
    if fw == pw && fh == ph {
        return fitted;
    }
    let (w, h) = (img.width as usize, img.height as usize);
    let mut border: Vec<[u8; 4]> = Vec::new();
    for y in 0..h {
        for x in 0..w {
            if x == 0 || y == 0 || x + 1 == w || y + 1 == h {
                let o = (y * w + x) * 4;
                border.push([img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]]);
            }
        }
    }
    let mut pad = [0u8; 4];
    for (c, slot) in pad.iter_mut().enumerate() {
        let mut v: Vec<u8> = border.iter().map(|p| p[c]).collect();
        v.sort_unstable();
        *slot = v[v.len() / 2];
    }
    let (pwu, phu, fwu, fhu) = (pw as usize, ph as usize, fw as usize, fh as usize);
    let (ox, oy) = ((pwu - fwu) / 2, (phu - fhu) / 2);
    let mut out = Vec::with_capacity(pwu * phu * 4);
    for _ in 0..pwu * phu {
        out.extend_from_slice(&pad);
    }
    for y in 0..fhu {
        let d = ((y + oy) * pwu + ox) * 4;
        out[d..d + fwu * 4].copy_from_slice(&fitted[y * fwu * 4..(y + 1) * fwu * 4]);
    }
    out
}

struct Segmentation {
    mask: Vec<u8>,
    method: &'static str,
    uniform: bool,
}

/// Separates the reference subject from its background: via alpha when the image is a
/// cutout, otherwise by distance from the median border color.
fn segment_reference(rgba: &[u8], w: usize, h: usize) -> Segmentation {
    let n = w * h;
    let ring = (w.min(h) / 50).max(2).min(w.min(h) / 2).max(1);
    let mut border: Vec<usize> = Vec::new();
    for y in 0..h {
        for x in 0..w {
            if x < ring || y < ring || x + ring >= w || y + ring >= h {
                border.push(y * w + x);
            }
        }
    }
    let transparent_border =
        border.iter().filter(|&&i| rgba[i * 4 + 3] < 128).count() * 2 > border.len();
    if transparent_border {
        let mask = (0..n).map(|i| if rgba[i * 4 + 3] >= 128 { 255 } else { 0 }).collect();
        return Segmentation { mask, method: "alpha", uniform: true };
    }
    let mut bg = [0u8; 3];
    for (c, slot) in bg.iter_mut().enumerate() {
        let mut v: Vec<u8> = border.iter().map(|&i| rgba[i * 4 + c]).collect();
        v.sort_unstable();
        *slot = v[v.len() / 2];
    }
    let dist = |i: usize| -> u32 {
        (0..3).map(|c| (rgba[i * 4 + c] as i32 - bg[c] as i32).unsigned_abs()).max().unwrap_or(0)
    };
    let mut bd: Vec<u32> = border.iter().map(|&i| dist(i)).collect();
    bd.sort_unstable();
    let p90 = bd[(bd.len() * 9) / 10];
    let uniform = p90 <= 24;
    let threshold = (p90 * 2 + 16).clamp(48, 160);
    let mask = (0..n).map(|i| if dist(i) > threshold { 255 } else { 0 }).collect();
    Segmentation { mask, method: "background", uniform }
}

/// Returns `(min_x, min_y, max_x, max_y, count)` of non-zero mask pixels.
fn mask_bbox(mask: &[u8], w: usize, h: usize) -> Option<(usize, usize, usize, usize, usize)> {
    let (mut x0, mut y0, mut x1, mut y1, mut cnt) =
        (usize::MAX, usize::MAX, 0usize, 0usize, 0usize);
    for y in 0..h {
        for x in 0..w {
            if mask[y * w + x] != 0 {
                x0 = x0.min(x);
                y0 = y0.min(y);
                x1 = x1.max(x);
                y1 = y1.max(y);
                cnt += 1;
            }
        }
    }
    (cnt > 0).then_some((x0, y0, x1, y1, cnt))
}

/// Maps a mask into a `SIL_GRID x SIL_GRID` canvas: bbox centered, scaled so its area is a
/// fixed fraction of the canvas (scale/translation invariant, aspect preserved).
fn normalize_silhouette(
    mask: &[u8],
    w: usize,
    bbox: (usize, usize, usize, usize, usize),
) -> Vec<bool> {
    let (x0, y0, x1, y1, _) = bbox;
    let bw = (x1 - x0 + 1) as f64;
    let bh = (y1 - y0 + 1) as f64;
    let target = SIL_GRID as f64 * 0.45;
    let mut s = target / (bw * bh).sqrt();
    // Keep extreme aspect ratios inside the canvas.
    s = s.min((SIL_GRID as f64 * 0.95) / bw).min((SIL_GRID as f64 * 0.95) / bh);
    let cx = (x0 as f64 + x1 as f64 + 1.0) * 0.5;
    let cy = (y0 as f64 + y1 as f64 + 1.0) * 0.5;
    let g = SIL_GRID as f64;
    let mut out = vec![false; SIL_GRID * SIL_GRID];
    for gy in 0..SIL_GRID {
        let sy = cy + (gy as f64 + 0.5 - g * 0.5) / s;
        if sy < y0 as f64 || sy >= (y1 + 1) as f64 {
            continue;
        }
        for gx in 0..SIL_GRID {
            let sx = cx + (gx as f64 + 0.5 - g * 0.5) / s;
            if sx < x0 as f64 || sx >= (x1 + 1) as f64 {
                continue;
            }
            out[gy * SIL_GRID + gx] = mask[(sy as usize) * w + sx as usize] != 0;
        }
    }
    out
}

/// Renders `scene` at the reference's aspect ratio and builds the comparison sheet.
///
/// `panel_height` is clamped to `128..=1024`; panel width follows the reference aspect.
/// `view` must be a single view (`Quad` is treated as `Camera`).
pub fn compare_scene_to_reference(
    scene: &SceneGraph,
    reference: &ReferenceImage,
    reference_size: [u32; 2],
    view: RenderViewMode,
    panel_height: u32,
    show_grid: bool,
    show_annotations: bool,
) -> ReferenceComparison {
    let view = if view == RenderViewMode::Quad { RenderViewMode::Camera } else { view };
    let view_name = match view {
        RenderViewMode::Front => "front",
        RenderViewMode::Top => "top",
        RenderViewMode::Right => "right",
        RenderViewMode::Iso => "iso",
        _ => "camera",
    };
    let aspect = reference.width as f64 / reference.height.max(1) as f64;
    // Keep the whole sheet (3 aspect panels + a square diff panel) within MAX_SHEET_WIDTH so
    // vision models see it without heavy downscaling. Extreme aspect ratios are letterboxed
    // (never stretched) by `fit_reference_into_panel`, so metrics stay undistorted.
    let ph = panel_height.clamp(128, 1024) as f64;
    let max_ph = (MAX_SHEET_WIDTH as f64 - 6.0) / (3.0 * aspect + 1.0);
    let mut ph = ph.min(max_ph).max(96.0).floor() as u32;
    let pw_for = |ph: u32| ((ph as f64 * aspect).round() as u32).clamp(64, 2048);
    while ph > 96 && pw_for(ph) * 3 + ph + 6 > MAX_SHEET_WIDTH {
        ph -= 1;
    }
    let pw = pw_for(ph);
    let (pwu, phu) = (pw as usize, ph as usize);

    let (render_rgba, render_mask) =
        render_viewport_rgba_with_mask(scene, pw, ph, view, show_grid, show_annotations, None);
    let ref_panel = fit_reference_into_panel(reference, pw, ph);
    // Flatten any reference transparency onto the studio background color for display.
    let mut ref_disp = ref_panel.clone();
    for px in ref_disp.chunks_exact_mut(4) {
        let a = px[3] as u32;
        if a < 255 {
            let bgc = [30u32, 41, 59];
            for c in 0..3 {
                px[c] = ((px[c] as u32 * a + bgc[c] * (255 - a) + 127) / 255) as u8;
            }
            px[3] = 255;
        }
    }

    let seg = segment_reference(&ref_panel, pwu, phu);
    let ref_bbox = mask_bbox(&seg.mask, pwu, phu);
    let ren_bbox = mask_bbox(&render_mask, pwu, phu);
    let total = (pwu * phu) as f64;
    let ref_cov = ref_bbox.map(|b| b.4 as f64 / total).unwrap_or(0.0);
    let ren_cov = ren_bbox.map(|b| b.4 as f64 / total).unwrap_or(0.0);
    let ref_fill = ref_bbox
        .map(|(x0, y0, x1, y1, c)| c as f64 / (((x1 - x0 + 1) * (y1 - y0 + 1)) as f64))
        .unwrap_or(0.0);

    let aspect_of =
        |b: (usize, usize, usize, usize, usize)| (b.2 - b.0 + 1) as f64 / (b.3 - b.1 + 1) as f64;
    let reference_aspect = ref_bbox.map(aspect_of);
    let render_aspect = ren_bbox.map(aspect_of);
    let aspect_error = match (reference_aspect, render_aspect) {
        (Some(a), Some(b)) if a > 0.0 => Some(b / a - 1.0),
        _ => None,
    };

    let mut guidance = Vec::new();
    let line_art = ref_bbox.is_some() && ref_fill < 0.18;
    let render_tiny = ren_bbox.is_some_and(|b| b.4 < 64);
    let reliable = seg.uniform
        && !line_art
        && !render_tiny
        && ref_bbox.is_some()
        && ren_bbox.is_some()
        && (0.005..=0.95).contains(&ref_cov);

    let (iou, diff_grid) = match (ref_bbox, ren_bbox) {
        (Some(rb), Some(nb)) => {
            let a = normalize_silhouette(&seg.mask, pwu, rb);
            let b = normalize_silhouette(&render_mask, pwu, nb);
            let inter = a.iter().zip(&b).filter(|(x, y)| **x && **y).count();
            let uni = a.iter().zip(&b).filter(|(x, y)| **x || **y).count();
            let iou = if uni > 0 { inter as f64 / uni as f64 } else { 0.0 };
            (Some(iou), Some((a, b)))
        }
        _ => (None, None),
    };

    if ren_bbox.is_none() {
        guidance.push(
            "The render is empty in this view: check that meshes are visible and the camera \
             (or view) frames the scene."
                .to_string(),
        );
    }
    if render_tiny {
        guidance.push(
            "The rendered subject covers only a few pixels: move the camera closer (or pick a \
             view that frames it) before comparing proportions."
                .to_string(),
        );
    }
    if ref_bbox.is_none() {
        guidance.push(if seg.uniform {
            "Could not isolate a subject in the reference (nothing differs from its border \
             color). Compare visually using the OVERLAY panel."
                .to_string()
        } else {
            "Could not isolate a subject from the reference's busy background (e.g. a photo). \
             Compare visually using the OVERLAY panel, and tune cameraPosition/cameraTarget/\
             cameraFov to match the photo's perspective. A cutout (transparent PNG) or a shot on a \
             plain background enables silhouette metrics."
                .to_string()
        });
    } else if line_art {
        guidance.push(
            "The reference looks like line art (thin strokes, little solid fill), so silhouette \
             metrics are unreliable. Compare outlines in the OVERLAY panel."
                .to_string(),
        );
    } else if !seg.uniform {
        guidance.push(
            "The reference background is busy (e.g. a photo), so silhouette metrics are \
             approximate. Prefer the OVERLAY panel, and tune cameraPosition/cameraTarget/cameraFov \
             to match the photo's perspective."
                .to_string(),
        );
    }
    if let Some(err) = aspect_error {
        if err.abs() >= 0.05 {
            guidance.push(format!(
                "The rendered silhouette is {:.0}% {} (width relative to height) than the reference: {} \
                 the horizontal extent or {} the vertical extent.",
                err.abs() * 100.0,
                if err > 0.0 { "wider" } else { "narrower" },
                if err > 0.0 { "shrink" } else { "grow" },
                if err > 0.0 { "grow" } else { "shrink" },
            ));
        }
    }
    if let (Some(v), true) = (iou, reliable) {
        if v >= 0.9 {
            guidance.push("Silhouette closely matches the reference (IoU >= 0.90).".to_string());
        } else if v < 0.75 {
            guidance.push(
                "Silhouette differs noticeably: in the DIFF panel, orange marks render-only areas \
                 (remove or shrink geometry there) and cyan marks reference-only areas (add or \
                 extend geometry there)."
                    .to_string(),
            );
        }
    }
    if view == RenderViewMode::Camera && seg.uniform && !line_art {
        guidance.push(
            "For orthographic blueprints or elevation drawings, use view: front, right, or top \
             for a distortion-free comparison."
                .to_string(),
        );
    }

    // ---- Composite: REFERENCE | RENDER | OVERLAY | DIFF ----
    let sep = 2usize;
    let diff_w = if diff_grid.is_some() { phu } else { 0 };
    let n_aspect_panels = 3usize;
    let sheet_w = pwu * n_aspect_panels
        + sep * (n_aspect_panels - 1)
        + if diff_w > 0 { sep + diff_w } else { 0 };
    let sheet_h = phu;
    let mut sheet = vec![0u8; sheet_w * sheet_h * 4];
    for px in sheet.chunks_exact_mut(4) {
        px.copy_from_slice(&[71, 85, 105, 255]);
    }
    let blit = |sheet: &mut [u8], src: &[u8], sw: usize, sh: usize, ox: usize| {
        for y in 0..sh {
            let d = (y * sheet_w + ox) * 4;
            sheet[d..d + sw * 4].copy_from_slice(&src[y * sw * 4..(y + 1) * sw * 4]);
        }
    };
    blit(&mut sheet, &ref_disp, pwu, phu, 0);
    blit(&mut sheet, &render_rgba, pwu, phu, pwu + sep);
    // OVERLAY: when both silhouettes exist, align the render to the reference with a
    // similarity transform (bbox centers matched, sqrt-area scale, render aspect preserved) so
    // proportion differences read directly. Busy (photo) backgrounds make the reference bbox
    // unreliable, so those are blended as-is and matched by tuning the camera instead.
    let align = match (ref_bbox, ren_bbox) {
        (Some(rb), Some(nb)) if seg.uniform => {
            let area =
                |b: (usize, usize, usize, usize, usize)| ((b.2 - b.0 + 1) * (b.3 - b.1 + 1)) as f64;
            let k = (area(rb) / area(nb)).sqrt();
            let rc = ((rb.0 + rb.2 + 1) as f64 * 0.5, (rb.1 + rb.3 + 1) as f64 * 0.5);
            let nc = ((nb.0 + nb.2 + 1) as f64 * 0.5, (nb.1 + nb.3 + 1) as f64 * 0.5);
            Some((k, rc, nc))
        }
        _ => None,
    };
    let mut overlay = vec![0u8; pwu * phu * 4];
    for y in 0..phu {
        for x in 0..pwu {
            let i = y * pwu + x;
            let src = match align {
                Some((k, rc, nc)) => {
                    let sx = nc.0 + (x as f64 + 0.5 - rc.0) / k;
                    let sy = nc.1 + (y as f64 + 0.5 - rc.1) / k;
                    let sxi = (sx.floor().max(0.0) as usize).min(pwu - 1);
                    let syi = (sy.floor().max(0.0) as usize).min(phu - 1);
                    syi * pwu + sxi
                }
                None => i,
            };
            for c in 0..3 {
                overlay[i * 4 + c] = (ref_disp[i * 4 + c] as u32 + render_rgba[src * 4 + c] as u32)
                    .div_ceil(2) as u8;
            }
            overlay[i * 4 + 3] = 255;
        }
    }
    blit(&mut sheet, &overlay, pwu, phu, 2 * (pwu + sep));
    if let Some((a, b)) = &diff_grid {
        let mut diff = vec![0u8; diff_w * phu * 4];
        for y in 0..phu {
            let gy = (y * SIL_GRID / phu).min(SIL_GRID - 1);
            for x in 0..diff_w {
                let gx = (x * SIL_GRID / diff_w).min(SIL_GRID - 1);
                let gi = gy * SIL_GRID + gx;
                let col = match (a[gi], b[gi]) {
                    (true, true) => [203u8, 213, 225, 255],
                    (false, true) => [249, 115, 22, 255],
                    (true, false) => [34, 211, 238, 255],
                    _ => [15, 23, 42, 255],
                };
                let d = (y * diff_w + x) * 4;
                diff[d..d + 4].copy_from_slice(&col);
            }
        }
        blit(&mut sheet, &diff, diff_w, phu, 3 * (pwu + sep));
    }
    let white = [248u8, 250, 252, 255];
    let ls = if phu >= 320 { 2 } else { 1 };
    draw_label_badge(&mut sheet, sheet_w, sheet_h, 6, 6, "REFERENCE", white, ls);
    let render_label = format!("RENDER ({})", view_name.to_ascii_uppercase());
    draw_label_badge(&mut sheet, sheet_w, sheet_h, pwu + sep + 6, 6, &render_label, white, ls);
    let overlay_label = if align.is_some() { "OVERLAY (ALIGNED)" } else { "OVERLAY 50/50" };
    draw_label_badge(
        &mut sheet,
        sheet_w,
        sheet_h,
        2 * (pwu + sep) + 6,
        6,
        overlay_label,
        white,
        ls,
    );
    if diff_w > 0 {
        let label = match (iou, reliable) {
            (Some(v), true) => format!("SILHOUETTE IOU {:.2}", v),
            (Some(v), false) => format!("IOU {:.2} (APPROX)", v),
            _ => "SILHOUETTE".to_string(),
        };
        draw_label_badge(&mut sheet, sheet_w, sheet_h, 3 * (pwu + sep) + 6, 6, &label, white, ls);
    }

    let round3 = |v: f64| (v * 1000.0).round() / 1000.0;
    ReferenceComparison {
        width: sheet_w as u32,
        height: sheet_h as u32,
        rgba: sheet,
        metrics: ReferenceMetrics {
            reference_size,
            panel_size: [pw, ph],
            view: view_name.to_string(),
            reference_segmentation: if ref_bbox.is_some() { seg.method } else { "none" }
                .to_string(),
            silhouette_reliable: reliable,
            silhouette_iou: iou.map(round3),
            reference_aspect: reference_aspect.map(round3),
            render_aspect: render_aspect.map(round3),
            aspect_error: aspect_error.map(round3),
            reference_coverage: round3(ref_cov),
            render_coverage: round3(ren_cov),
            guidance,
        },
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[allow(clippy::too_many_arguments)]
    /// Minimal PNG writer for tests: arbitrary color type / depth, filter per row, optional
    /// PLTE/tRNS. `rows` are already-packed scanline bytes (without filter bytes).
    fn png_bytes(
        w: u32,
        h: u32,
        depth: u8,
        ctype: u8,
        rows: &[Vec<u8>],
        filters: &[u8],
        plte: Option<&[u8]>,
        trns: Option<&[u8]>,
    ) -> Vec<u8> {
        let bpp = {
            let ch = match ctype {
                0 | 3 => 1,
                2 => 3,
                4 => 2,
                _ => 4,
            };
            (ch * depth as usize).div_ceil(8)
        };
        let mut raw = Vec::new();
        let mut prev = vec![0u8; rows[0].len()];
        for (y, row) in rows.iter().enumerate() {
            let ft = filters[y % filters.len()];
            raw.push(ft);
            for i in 0..row.len() {
                let a = if i >= bpp { row[i - bpp] as i16 } else { 0 };
                let b = prev[i] as i16;
                let c = if i >= bpp { prev[i - bpp] as i16 } else { 0 };
                let pred = match ft {
                    0 => 0,
                    1 => a,
                    2 => b,
                    3 => (a + b) / 2,
                    _ => {
                        let p = a + b - c;
                        let (pa, pb, pc) = ((p - a).abs(), (p - b).abs(), (p - c).abs());
                        if pa <= pb && pa <= pc {
                            a
                        } else if pb <= pc {
                            b
                        } else {
                            c
                        }
                    }
                };
                raw.push((row[i] as i16 - pred) as u8);
            }
            prev = row.clone();
        }
        let z = miniz_oxide::deflate::compress_to_vec_zlib(&raw, 6);
        let mut out = b"\x89PNG\r\n\x1a\n".to_vec();
        let mut chunk = |t: &[u8; 4], d: &[u8]| {
            out.extend_from_slice(&(d.len() as u32).to_be_bytes());
            out.extend_from_slice(t);
            out.extend_from_slice(d);
            out.extend_from_slice(&[0, 0, 0, 0]); // CRC is not verified by the decoder.
        };
        let mut ihdr = Vec::new();
        ihdr.extend_from_slice(&w.to_be_bytes());
        ihdr.extend_from_slice(&h.to_be_bytes());
        ihdr.extend_from_slice(&[depth, ctype, 0, 0, 0]);
        chunk(b"IHDR", &ihdr);
        if let Some(p) = plte {
            chunk(b"PLTE", p);
        }
        if let Some(t) = trns {
            chunk(b"tRNS", t);
        }
        chunk(b"IDAT", &z);
        chunk(b"IEND", &[]);
        out
    }

    #[test]
    fn decodes_rgba8_with_every_filter_type() {
        let (w, h) = (5u32, 6u32);
        let rows: Vec<Vec<u8>> =
            (0..h).map(|y| (0..w * 4).map(|i| ((i * 37 + y * 11) % 256) as u8).collect()).collect();
        let png = png_bytes(w, h, 8, 6, &rows, &[0, 1, 2, 3, 4], None, None);
        let img = decode_png(&png).unwrap();
        assert_eq!((img.width, img.height), (w, h));
        for (y, row) in rows.iter().enumerate() {
            assert_eq!(&img.rgba[y * 20..y * 20 + 20], &row[..]);
        }
    }

    #[test]
    fn decodes_palette_low_bit_depth_gray_and_16_bit() {
        // 2-bit palette with tRNS on index 1.
        let rows = vec![vec![0b00_01_10_11u8], vec![0b11_10_01_00u8]];
        let plte = [255, 0, 0, 0, 255, 0, 0, 0, 255, 9, 9, 9];
        let png = png_bytes(4, 2, 2, 3, &rows, &[0, 1], Some(&plte), Some(&[255, 0]));
        let img = decode_png(&png).unwrap();
        assert_eq!(&img.rgba[0..4], &[255, 0, 0, 255]);
        assert_eq!(&img.rgba[4..8], &[0, 255, 0, 0]);
        assert_eq!(&img.rgba[28..32], &[255, 0, 0, 255]);

        // 1-bit grayscale scales 1 -> 255.
        let png = png_bytes(3, 1, 1, 0, &[vec![0b1010_0000]], &[0], None, None);
        let img = decode_png(&png).unwrap();
        assert_eq!(&img.rgba[0..12], &[255, 255, 255, 255, 0, 0, 0, 255, 255, 255, 255, 255]);

        // 16-bit RGB keeps the high byte; tRNS color key makes the matching pixel transparent.
        let row = vec![0x12, 0x34, 0x56, 0x78, 0x9a, 0xbc, 0, 1, 0, 2, 0, 3];
        let png = png_bytes(2, 1, 16, 2, &[row], &[4], None, Some(&[0, 1, 0, 2, 0, 3]));
        let img = decode_png(&png).unwrap();
        assert_eq!(&img.rgba[0..4], &[0x12, 0x56, 0x9a, 255]);
        assert_eq!(img.rgba[7], 0);
    }

    #[test]
    fn rejects_malformed_and_unsupported_inputs() {
        assert!(decode_reference_image(b"GIF89a....").unwrap_err().contains("GIF"));
        assert!(decode_reference_image(b"not an image").unwrap_err().contains("Unsupported"));
        let mut huge = png_bytes(1, 1, 8, 6, &[vec![0, 0, 0, 0]], &[0], None, None);
        huge[16..20].copy_from_slice(&100_000u32.to_be_bytes());
        assert!(decode_png(&huge).unwrap_err().contains("too large"));
        let mut trunc = png_bytes(8, 8, 8, 6, &vec![vec![7u8; 32]; 8], &[0], None, None);
        trunc.truncate(trunc.len() - 20);
        assert!(decode_png(&trunc).is_err());
        assert!(load_reference_bytes("https://example.com/a.png").unwrap_err().contains("network"));
        assert!(load_reference_bytes("data:image/png,abc").unwrap_err().contains("base64"));
        assert!(load_reference_bytes("/definitely/not/here.png").is_err());
        let tmp = std::env::temp_dir().join(format!("tl_ref_uri_{}.png", std::process::id()));
        std::fs::write(&tmp, b"\x89PNG").unwrap();
        let uri = format!("file://{}", tmp.display());
        assert_eq!(load_reference_bytes(&uri).unwrap(), b"\x89PNG");
        let _ = std::fs::remove_file(&tmp);
        assert!(decode_jpeg(&[0xFF, 0xD8, 0xFF, 0xE0, 0, 0]).is_err());
    }

    #[test]
    fn compressed_png_encoder_round_trips_through_decoder() {
        let (w, h) = (37u32, 23u32);
        let rgba: Vec<u8> = (0..w * h * 4)
            .map(|i| (i.wrapping_mul(2654435761u32) >> 13) as u8 ^ (i as u8))
            .collect();
        let png = crate::render::encode_png_rgba_compressed(w, h, &rgba).unwrap();
        let img = decode_png(&png).unwrap();
        assert_eq!((img.width, img.height), (w, h));
        assert_eq!(img.rgba, rgba);
        assert!(crate::render::encode_png_rgba_compressed(0, 1, &[]).is_err());
        assert!(crate::render::encode_png_rgba_compressed(2, 2, &[0; 8]).is_err());
    }

    #[test]
    fn extreme_aspect_references_are_letterboxed_not_stretched() {
        // 40:1 white strip with a dark 4:1 block in the middle.
        let (w, h) = (800u32, 20u32);
        let mut rgba = vec![255u8; (w * h * 4) as usize];
        for y in 5..15usize {
            for x in 380..420usize {
                let o = (y * w as usize + x) * 4;
                rgba[o..o + 3].copy_from_slice(&[10, 10, 10]);
            }
        }
        let img = ReferenceImage { width: w, height: h, rgba };
        let panel = fit_reference_into_panel(&img, 2048, 128);
        let seg = segment_reference(&panel, 2048, 128);
        let bb = mask_bbox(&seg.mask, 2048, 128).unwrap();
        let aspect = (bb.2 - bb.0 + 1) as f64 / (bb.3 - bb.1 + 1) as f64;
        assert!((aspect - 4.0).abs() < 0.3, "aspect {}", aspect);
        // Padding uses the border color, so it never counts as foreground.
        assert_eq!(seg.mask[0], 0);
        assert_eq!(seg.mask[2048 * 127 + 2047], 0);
    }

    #[test]
    fn exif_orientation_parsing_and_rotation() {
        // Big-endian TIFF with one IFD entry: Orientation = 6.
        let tiff =
            [b'M', b'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0];
        assert_eq!(exif_orientation(&tiff), 6);
        assert_eq!(exif_orientation(b"junk"), 1);
        // 2x1 image [A, B] rotated 90 CW (orientation 6) becomes 1x2 [A; B].
        let img = ReferenceImage { width: 2, height: 1, rgba: vec![1, 1, 1, 255, 2, 2, 2, 255] };
        let r = apply_orientation(img.clone(), 6);
        assert_eq!((r.width, r.height), (1, 2));
        assert_eq!((r.rgba[0], r.rgba[4]), (1, 2));
        let r8 = apply_orientation(img, 8);
        assert_eq!((r8.rgba[0], r8.rgba[4]), (2, 1));
    }

    #[test]
    fn downscales_large_references_and_segments_backgrounds() {
        let (w, h) = (2000u32, 1000u32);
        let mut rgba = vec![255u8; (w * h * 4) as usize];
        for y in 300..700usize {
            for x in 500..1500usize {
                let o = (y * w as usize + x) * 4;
                rgba[o..o + 3].copy_from_slice(&[20, 20, 20]);
            }
        }
        let img = downscale_to(ReferenceImage { width: w, height: h, rgba }, 1024);
        assert_eq!((img.width, img.height), (1024, 512));
        let seg = segment_reference(&img.rgba, 1024, 512);
        assert!(seg.uniform && seg.method == "background");
        let bb = mask_bbox(&seg.mask, 1024, 512).unwrap();
        let aspect = (bb.2 - bb.0 + 1) as f64 / (bb.3 - bb.1 + 1) as f64;
        assert!((aspect - 2.5).abs() < 0.05, "aspect {}", aspect);
    }

    #[test]
    fn normalized_silhouette_iou_is_scale_and_translation_invariant() {
        let (w, h) = (200usize, 100usize);
        let mut a = vec![0u8; w * h];
        let mut b = vec![0u8; w * h];
        for y in 10..30 {
            for x in 10..50 {
                a[y * w + x] = 255;
            }
        }
        for y in 40..80 {
            for x in 100..180 {
                b[y * w + x] = 255;
            }
        }
        let na = normalize_silhouette(&a, w, mask_bbox(&a, w, h).unwrap());
        let nb = normalize_silhouette(&b, w, mask_bbox(&b, w, h).unwrap());
        let inter = na.iter().zip(&nb).filter(|(x, y)| **x && **y).count() as f64;
        let uni = na.iter().zip(&nb).filter(|(x, y)| **x || **y).count() as f64;
        assert!(inter / uni > 0.97, "iou {}", inter / uni);
    }
}
