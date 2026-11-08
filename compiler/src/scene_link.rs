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

//! Playground scene links and QR codes (`three-live-cli link`, MCP `three_live_link`).
//!
//! A scene link opens a Three.js script in the web playground:
//! `https://google.github.io/three-live/three/#s=z:<base64url>`, where the payload is the
//! script compressed with raw DEFLATE (RFC 1951) and encoded as unpadded base64url. The
//! fragment never reaches the server. The playground decodes it with
//! `DecompressionStream('deflate-raw')` (`examples/three/index.html`).
//!
//! [`QrCode`] is a small, dependency-free QR Code Model 2 encoder (ISO/IEC 18004): byte
//! mode, error correction level M, versions 1-40.

/// The public playground the links open by default.
pub const DEFAULT_PLAYGROUND_URL: &str = "https://google.github.io/three-live/three/";

/// Longest link worth putting in a QR code: version 28 at level M (129 x 129 modules),
/// which a phone still scans from a laptop screen.
pub const MAX_QR_URL_LEN: usize = 1150;

/// Largest script a link may carry. The playground refuses larger payloads.
pub const MAX_LINK_SCRIPT_BYTES: usize = 128 * 1024;

const BASE64URL: &[u8; 64] = b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-_";

/// Unpadded base64url (RFC 4648 section 5).
pub fn encode_base64url(input: &[u8]) -> String {
    let mut out = String::with_capacity(input.len().div_ceil(3) * 4);
    for chunk in input.chunks(3) {
        let b = [chunk[0], *chunk.get(1).unwrap_or(&0), *chunk.get(2).unwrap_or(&0)];
        let n = (u32::from(b[0]) << 16) | (u32::from(b[1]) << 8) | u32::from(b[2]);
        let chars = chunk.len() + 1;
        for i in 0..chars {
            out.push(BASE64URL[((n >> (18 - 6 * i)) & 63) as usize] as char);
        }
    }
    out
}

/// The `s=z:<base64url>` fragment parameter carrying `script` compressed with raw DEFLATE.
pub fn encode_scene_param(script: &str) -> Result<String, String> {
    if script.len() > MAX_LINK_SCRIPT_BYTES {
        return Err(format!(
            "Script is {} bytes; a playground link carries at most {} bytes.",
            script.len(),
            MAX_LINK_SCRIPT_BYTES
        ));
    }
    let compressed = miniz_oxide::deflate::compress_to_vec(script.as_bytes(), 9);
    Ok(format!("s=z:{}", encode_base64url(&compressed)))
}

/// `base` (the playground page) with `script` in its fragment.
pub fn playground_url(base: &str, script: &str) -> Result<String, String> {
    let base = base.split('#').next().unwrap_or(base);
    Ok(format!("{base}#{}", encode_scene_param(script)?))
}

/// A validated scene's playground link, and its QR code when the link is short enough to scan.
pub struct SceneLink {
    pub url: String,
    pub qr: Option<QrCode>,
    pub report: crate::ValidationReport,
}

impl SceneLink {
    fn count(&self, severity: &str) -> usize {
        self.report.diagnostics.iter().filter(|d| d.severity == severity).count()
    }

    /// One line: how many warnings the validator found, and whether the link fits a QR code.
    pub fn summary(&self) -> String {
        let warnings = self.count("warning");
        format!(
            "Validated {} ({} warning{}, {} info). Link: {} characters{}.",
            self.report.input,
            warnings,
            if warnings == 1 { "" } else { "s" },
            self.count("info"),
            self.url.len(),
            match &self.qr {
                Some(qr) => format!(", QR version {}", qr.version()),
                None => ", too long for a QR code".to_string(),
            }
        )
    }

    /// `{url, length, valid, warnings, infos, qrVersion, fitsQr, diagnostics}`.
    pub fn to_json(&self) -> serde_json::Value {
        serde_json::json!({
            "url": self.url,
            "length": self.url.len(),
            "valid": self.report.valid,
            "warnings": self.count("warning"),
            "infos": self.count("info"),
            "fitsQr": self.qr.is_some(),
            "qrVersion": self.qr.as_ref().map(QrCode::version),
            "diagnostics": self.report.diagnostics,
        })
    }
}

/// Validates `script` (a Three.js scene script, not HTML or GLB) and builds its playground
/// link on `base`. Fails, with the errors, when the scene does not compile, so a link never
/// opens a broken scene.
pub fn build_scene_link(script: &str, filename: &str, base: &str) -> Result<SceneLink, String> {
    if crate::is_html_source(script, filename) {
        return Err(
            "Playground links carry a Three.js scene script; extract the script from the HTML \
             page first."
                .to_string(),
        );
    }
    if script.as_bytes().starts_with(b"glTF") {
        return Err("Playground links carry a Three.js scene script, not a GLB.".to_string());
    }
    let (scene, diagnostics) = crate::validate_scene_source(script, filename);
    let report = crate::build_validation_report(filename, 0.0, scene.as_ref(), diagnostics);
    if !report.valid {
        let errors: Vec<String> = report
            .diagnostics
            .iter()
            .filter(|d| d.severity == "error")
            .map(|d| format!("  {} {}", d.code, d.message))
            .collect();
        return Err(format!(
            "{filename} does not compile, so no link was made:\n{}",
            errors.join("\n")
        ));
    }
    let url = playground_url(base, script)?;
    let qr = if url.len() <= MAX_QR_URL_LEN { QrCode::encode(url.as_bytes()) } else { None };
    Ok(SceneLink { url, qr, report })
}

/// A QR code's modules, `true` for dark, row-major.
#[derive(Clone, Debug, PartialEq, Eq)]
pub struct QrCode {
    version: usize,
    size: usize,
    mask: u8,
    modules: Vec<bool>,
}

// Error correction level M, indexed by version (index 0 unused).
const ECC_CODEWORDS_PER_BLOCK_M: [usize; 41] = [
    0, 10, 16, 26, 18, 24, 16, 18, 22, 22, 26, 30, 22, 22, 24, 24, 28, 28, 26, 26, 26, 26, 28, 28,
    28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28, 28,
];
const NUM_BLOCKS_M: [usize; 41] = [
    0, 1, 1, 1, 2, 2, 4, 4, 4, 5, 5, 5, 8, 9, 9, 10, 10, 11, 13, 14, 16, 17, 17, 18, 20, 21, 23,
    25, 26, 28, 29, 31, 33, 35, 37, 38, 40, 43, 45, 47, 49,
];
// Format information for level M is `00`.
const FORMAT_BITS_M: u32 = 0;

fn num_raw_data_modules(ver: usize) -> usize {
    let mut result = (16 * ver + 128) * ver + 64;
    if ver >= 2 {
        let num_align = ver / 7 + 2;
        result -= (25 * num_align - 10) * num_align - 55;
        if ver >= 7 {
            result -= 36;
        }
    }
    result
}

fn num_data_codewords(ver: usize) -> usize {
    num_raw_data_modules(ver) / 8 - ECC_CODEWORDS_PER_BLOCK_M[ver] * NUM_BLOCKS_M[ver]
}

fn alignment_positions(ver: usize) -> Vec<usize> {
    if ver == 1 {
        return Vec::new();
    }
    let size = ver * 4 + 17;
    let num_align = ver / 7 + 2;
    let step = (ver * 8 + num_align * 3 + 5) / (num_align * 4 - 4) * 2;
    let mut result = vec![0; num_align];
    result[0] = 6;
    let mut pos = size - 7;
    for i in (1..num_align).rev() {
        result[i] = pos;
        pos -= step;
    }
    result
}

fn gf_mul(x: u8, y: u8) -> u8 {
    let mut z: u32 = 0;
    for i in (0..8).rev() {
        z = (z << 1) ^ ((z >> 7) * 0x11D);
        z ^= ((u32::from(y) >> i) & 1) * u32::from(x);
    }
    z as u8
}

fn rs_divisor(degree: usize) -> Vec<u8> {
    let mut result = vec![0u8; degree];
    result[degree - 1] = 1;
    let mut root: u8 = 1;
    for _ in 0..degree {
        for j in 0..degree {
            result[j] = gf_mul(result[j], root);
            if j + 1 < degree {
                result[j] ^= result[j + 1];
            }
        }
        root = gf_mul(root, 0x02);
    }
    result
}

fn rs_remainder(data: &[u8], divisor: &[u8]) -> Vec<u8> {
    let mut result = vec![0u8; divisor.len()];
    for &b in data {
        let factor = b ^ result[0];
        result.remove(0);
        result.push(0);
        for (r, &d) in result.iter_mut().zip(divisor) {
            *r ^= gf_mul(d, factor);
        }
    }
    result
}

fn bit(value: u32, i: u32) -> bool {
    (value >> i) & 1 != 0
}

struct Grid {
    size: usize,
    modules: Vec<bool>,
    function: Vec<bool>,
}

impl Grid {
    fn set_function(&mut self, x: usize, y: usize, dark: bool) {
        self.modules[y * self.size + x] = dark;
        self.function[y * self.size + x] = true;
    }

    fn draw_finder(&mut self, cx: isize, cy: isize) {
        for dy in -4isize..=4 {
            for dx in -4isize..=4 {
                let (x, y) = (cx + dx, cy + dy);
                if x >= 0 && y >= 0 && (x as usize) < self.size && (y as usize) < self.size {
                    let dist = dx.abs().max(dy.abs());
                    self.set_function(x as usize, y as usize, dist != 2 && dist != 4);
                }
            }
        }
    }

    fn draw_format_bits(&mut self, mask: u8) {
        let data = (FORMAT_BITS_M << 3) | u32::from(mask);
        let mut rem = data;
        for _ in 0..10 {
            rem = (rem << 1) ^ ((rem >> 9) * 0x537);
        }
        let bits = ((data << 10) | rem) ^ 0x5412;
        let size = self.size;
        for i in 0..=5 {
            self.set_function(8, i, bit(bits, i as u32));
        }
        self.set_function(8, 7, bit(bits, 6));
        self.set_function(8, 8, bit(bits, 7));
        self.set_function(7, 8, bit(bits, 8));
        for i in 9..15 {
            self.set_function(14 - i, 8, bit(bits, i as u32));
        }
        for i in 0..8 {
            self.set_function(size - 1 - i, 8, bit(bits, i as u32));
        }
        for i in 8..15 {
            self.set_function(8, size - 15 + i, bit(bits, i as u32));
        }
        self.set_function(8, size - 8, true);
    }

    fn draw_version(&mut self, ver: usize) {
        if ver < 7 {
            return;
        }
        let mut rem = ver as u32;
        for _ in 0..12 {
            rem = (rem << 1) ^ ((rem >> 11) * 0x1F25);
        }
        let bits = ((ver as u32) << 12) | rem;
        for i in 0..18 {
            let dark = bit(bits, i as u32);
            let a = self.size - 11 + i % 3;
            let b = i / 3;
            self.set_function(a, b, dark);
            self.set_function(b, a, dark);
        }
    }

    fn draw_function_patterns(&mut self, ver: usize) {
        let size = self.size;
        for i in 0..size {
            self.set_function(6, i, i % 2 == 0);
            self.set_function(i, 6, i % 2 == 0);
        }
        self.draw_finder(3, 3);
        self.draw_finder(size as isize - 4, 3);
        self.draw_finder(3, size as isize - 4);
        let positions = alignment_positions(ver);
        let n = positions.len();
        for i in 0..n {
            for j in 0..n {
                if (i == 0 && j == 0) || (i == 0 && j == n - 1) || (i == n - 1 && j == 0) {
                    continue;
                }
                for dy in -2isize..=2 {
                    for dx in -2isize..=2 {
                        let x = (positions[i] as isize + dx) as usize;
                        let y = (positions[j] as isize + dy) as usize;
                        self.set_function(x, y, dx.abs().max(dy.abs()) != 1);
                    }
                }
            }
        }
        self.draw_format_bits(0);
        self.draw_version(ver);
    }

    fn draw_codewords(&mut self, data: &[u8]) {
        let size = self.size;
        let mut i = 0usize;
        let mut right = size as isize - 1;
        while right >= 1 {
            if right == 6 {
                right = 5;
            }
            for vert in 0..size {
                for j in 0..2 {
                    let x = (right - j) as usize;
                    let upward = ((right + 1) & 2) == 0;
                    let y = if upward { size - 1 - vert } else { vert };
                    if !self.function[y * size + x] && i < data.len() * 8 {
                        self.modules[y * size + x] = (data[i >> 3] >> (7 - (i & 7))) & 1 != 0;
                        i += 1;
                    }
                }
            }
            right -= 2;
        }
    }

    fn apply_mask(&mut self, mask: u8) {
        let size = self.size;
        for y in 0..size {
            for x in 0..size {
                let invert = match mask {
                    0 => (x + y) % 2 == 0,
                    1 => y % 2 == 0,
                    2 => x % 3 == 0,
                    3 => (x + y) % 3 == 0,
                    4 => (x / 3 + y / 2) % 2 == 0,
                    5 => x * y % 2 + x * y % 3 == 0,
                    6 => (x * y % 2 + x * y % 3) % 2 == 0,
                    _ => ((x + y) % 2 + x * y % 3) % 2 == 0,
                };
                if invert && !self.function[y * size + x] {
                    self.modules[y * size + x] ^= true;
                }
            }
        }
    }

    /// Penalty rules N1 (runs), N2 (2x2 blocks), N3 (finder-like 1:1:3:1:1 patterns with
    /// four light modules on one side) and N4 (dark/light balance) from ISO/IEC 18004.
    fn penalty(&self) -> usize {
        let size = self.size;
        let at = |x: usize, y: usize| self.modules[y * size + x];
        let mut score = 0usize;
        for horizontal in [true, false] {
            for a in 0..size {
                let mut run = 1usize;
                for b in 1..size {
                    let (cur, prev) = if horizontal {
                        (at(b, a), at(b - 1, a))
                    } else {
                        (at(a, b), at(a, b - 1))
                    };
                    if cur == prev {
                        run += 1;
                    } else {
                        if run >= 5 {
                            score += run - 2;
                        }
                        run = 1;
                    }
                }
                if run >= 5 {
                    score += run - 2;
                }
                const PATTERN: [bool; 11] =
                    [true, false, true, true, true, false, true, false, false, false, false];
                for b in 0..=size.saturating_sub(11) {
                    let line = |k: usize| if horizontal { at(b + k, a) } else { at(a, b + k) };
                    let forward = (0..11).all(|k| line(k) == PATTERN[k]);
                    let backward = (0..11).all(|k| line(k) == PATTERN[10 - k]);
                    if forward || backward {
                        score += 40;
                    }
                }
            }
        }
        for y in 0..size - 1 {
            for x in 0..size - 1 {
                let c = at(x, y);
                if c == at(x + 1, y) && c == at(x, y + 1) && c == at(x + 1, y + 1) {
                    score += 3;
                }
            }
        }
        let dark = self.modules.iter().filter(|&&m| m).count();
        let total = size * size;
        let k = ((dark * 20).abs_diff(total * 10)).div_ceil(total).saturating_sub(1);
        score + k * 10
    }
}

impl QrCode {
    /// Encodes `data` in byte mode at error correction level M, in the smallest version that
    /// fits, with the mask that has the lowest penalty. `None` when it exceeds version 40.
    pub fn encode(data: &[u8]) -> Option<QrCode> {
        Self::encode_with_mask(data, None)
    }

    /// [`QrCode::encode`] with a fixed `mask` (0-7) instead of the lowest-penalty one.
    pub fn encode_with_mask(data: &[u8], mask: Option<u8>) -> Option<QrCode> {
        let version = (1..=40).find(|&v| {
            let count_bits = if v <= 9 { 8 } else { 16 };
            4 + count_bits + data.len() * 8 <= num_data_codewords(v) * 8
        })?;
        let capacity_bits = num_data_codewords(version) * 8;
        let count_bits = if version <= 9 { 8 } else { 16 };

        // Data bits: mode, character count, bytes, terminator, byte padding, pad codewords.
        let mut bits: Vec<bool> = Vec::with_capacity(capacity_bits);
        let mut push = |value: u32, len: usize| {
            for i in (0..len).rev() {
                bits.push((value >> i) & 1 != 0);
            }
        };
        push(0b0100, 4);
        push(data.len() as u32, count_bits);
        for &b in data {
            push(u32::from(b), 8);
        }
        let terminator = (capacity_bits - bits.len()).min(4);
        bits.extend(std::iter::repeat_n(false, terminator));
        while bits.len() % 8 != 0 {
            bits.push(false);
        }
        let mut codewords: Vec<u8> = bits
            .chunks(8)
            .map(|c| c.iter().fold(0u8, |acc, &b| (acc << 1) | u8::from(b)))
            .collect();
        let mut pad = 0xECu8;
        while codewords.len() < capacity_bits / 8 {
            codewords.push(pad);
            pad ^= 0xEC ^ 0x11;
        }

        // Error correction per block, then interleave.
        let num_blocks = NUM_BLOCKS_M[version];
        let ecc_len = ECC_CODEWORDS_PER_BLOCK_M[version];
        let raw_codewords = num_raw_data_modules(version) / 8;
        let num_short_blocks = num_blocks - raw_codewords % num_blocks;
        let short_block_len = raw_codewords / num_blocks;
        let divisor = rs_divisor(ecc_len);
        let mut blocks: Vec<Vec<u8>> = Vec::with_capacity(num_blocks);
        let mut k = 0usize;
        for i in 0..num_blocks {
            let len = short_block_len - ecc_len + usize::from(i >= num_short_blocks);
            let mut block = codewords[k..k + len].to_vec();
            k += len;
            let ecc = rs_remainder(&block, &divisor);
            if i < num_short_blocks {
                block.push(0);
            }
            block.extend(ecc);
            blocks.push(block);
        }
        let mut interleaved = Vec::with_capacity(raw_codewords);
        for i in 0..blocks[0].len() {
            for (j, block) in blocks.iter().enumerate() {
                if i != short_block_len - ecc_len || j >= num_short_blocks {
                    interleaved.push(block[i]);
                }
            }
        }

        let size = version * 4 + 17;
        let mut grid =
            Grid { size, modules: vec![false; size * size], function: vec![false; size * size] };
        grid.draw_function_patterns(version);
        grid.draw_codewords(&interleaved);

        let mask = match mask {
            Some(m) => m.min(7),
            None => (0..8u8)
                .min_by_key(|&m| {
                    grid.apply_mask(m);
                    grid.draw_format_bits(m);
                    let score = grid.penalty();
                    grid.apply_mask(m);
                    score
                })
                .unwrap_or(0),
        };
        grid.apply_mask(mask);
        grid.draw_format_bits(mask);
        Some(QrCode { version, size, mask, modules: grid.modules })
    }

    pub fn version(&self) -> usize {
        self.version
    }

    pub fn size(&self) -> usize {
        self.size
    }

    pub fn mask(&self) -> u8 {
        self.mask
    }

    /// Whether the module at column `x`, row `y` is dark.
    pub fn module(&self, x: usize, y: usize) -> bool {
        x < self.size && y < self.size && self.modules[y * self.size + x]
    }

    /// Two rows per line with half-block characters and a quiet zone of `border` modules,
    /// drawn light-on-dark so it scans from a dark terminal: dark modules print as spaces.
    pub fn to_terminal_string(&self, border: usize) -> String {
        let full = self.size + 2 * border;
        let dark = |x: usize, y: usize| -> bool {
            x >= border && y >= border && self.module(x - border, y - border)
        };
        let mut out = String::new();
        for y in (0..full).step_by(2) {
            for x in 0..full {
                let top = !dark(x, y);
                let bottom = y + 1 < full && !dark(x, y + 1);
                out.push(match (top, bottom) {
                    (true, true) => '\u{2588}',
                    (true, false) => '\u{2580}',
                    (false, true) => '\u{2584}',
                    (false, false) => ' ',
                });
            }
            out.push('\n');
        }
        out
    }

    /// A standalone SVG with a quiet zone of `border` modules.
    pub fn to_svg(&self, border: usize) -> String {
        let full = self.size + 2 * border;
        let mut path = String::new();
        for y in 0..self.size {
            for x in 0..self.size {
                if self.module(x, y) {
                    path.push_str(&format!("M{},{}h1v1h-1z", x + border, y + border));
                }
            }
        }
        format!(
            "<svg xmlns=\"http://www.w3.org/2000/svg\" viewBox=\"0 0 {full} {full}\" \
             shape-rendering=\"crispEdges\"><rect width=\"100%\" height=\"100%\" fill=\"#fff\"/>\
             <path d=\"{path}\" fill=\"#000\"/></svg>"
        )
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn base64url_matches_rfc4648_without_padding() {
        assert_eq!(encode_base64url(b""), "");
        assert_eq!(encode_base64url(b"f"), "Zg");
        assert_eq!(encode_base64url(b"fo"), "Zm8");
        assert_eq!(encode_base64url(b"foo"), "Zm9v");
        assert_eq!(encode_base64url(b"foob"), "Zm9vYg");
        assert_eq!(encode_base64url(&[0xfb, 0xff]), "-_8");
    }

    #[test]
    fn scene_links_round_trip_through_raw_deflate() {
        let script = "const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1));\nscene.add(m);\n";
        let url = playground_url("https://example.test/three/#old", script).unwrap();
        let payload = url.strip_prefix("https://example.test/three/#s=z:").unwrap();
        assert!(payload.bytes().all(|b| BASE64URL.contains(&b)));
        // Decode base64url and inflate with miniz_oxide to recover the script.
        let mut bytes = Vec::new();
        let vals: Vec<u32> = payload
            .bytes()
            .map(|b| BASE64URL.iter().position(|&c| c == b).unwrap() as u32)
            .collect();
        for chunk in vals.chunks(4) {
            let n = chunk.iter().enumerate().fold(0u32, |acc, (i, v)| acc | (v << (18 - 6 * i)));
            for i in 0..chunk.len() - 1 {
                bytes.push((n >> (16 - 8 * i)) as u8);
            }
        }
        let inflated = miniz_oxide::inflate::decompress_to_vec(&bytes).unwrap();
        assert_eq!(String::from_utf8(inflated).unwrap(), script);
        assert!(encode_scene_param(&"x".repeat(MAX_LINK_SCRIPT_BYTES + 1)).is_err());
    }

    #[test]
    fn version_tables_match_the_level_m_capacities() {
        // Byte-mode capacities at level M from ISO/IEC 18004 Table 7.
        let expected = [(1, 14), (2, 26), (5, 84), (7, 122), (10, 213), (25, 997), (40, 2331)];
        for (ver, bytes) in expected {
            let count_bits = if ver <= 9 { 8 } else { 16 };
            assert_eq!((num_data_codewords(ver) * 8 - 4 - count_bits) / 8, bytes, "v{ver}");
        }
        assert_eq!(alignment_positions(2), vec![6, 18]);
        assert_eq!(alignment_positions(7), vec![6, 22, 38]);
        assert_eq!(alignment_positions(32), vec![6, 34, 60, 86, 112, 138]);
    }

    // Reference matrices from qrcodejs (davidshimjs/qrcodejs 1.0.0) with the same version and
    // mask, as row strings ('#' dark): an independent implementation of the same standard.
    const URL_V1_MASK2: [&str; 21] = [
        "#######..#.#..#######",
        "#.....#..###..#.....#",
        "#.###.#.#..##.#.###.#",
        "#.###.#.#####.#.###.#",
        "#.###.#.#...#.#.###.#",
        "#.....#.###.#.#.....#",
        "#######.#.#.#.#######",
        "........#.#.#........",
        "#.#####.......#####..",
        "#.#.....#..#.########",
        ".########..#####..##.",
        "##..#...#..#.#..###..",
        "..#...###..#..#.##..#",
        "........###..#.####.#",
        "#######.....####..##.",
        "#.....#.#..#...####.#",
        "#.###.#.####..####.##",
        "#.###.#.#....##.#.#..",
        "#.###.#.##.##.##..#..",
        "#.....#....#.#..###..",
        "#######.#.#.#.##.#.#.",
    ];

    #[test]
    fn matches_an_independent_encoder_for_version_1() {
        let qr = QrCode::encode_with_mask(b"https://g.co/x", Some(2)).unwrap();
        assert_eq!(qr.version(), 1);
        for (y, row) in URL_V1_MASK2.iter().enumerate() {
            let got: String = (0..21).map(|x| if qr.module(x, y) { '#' } else { '.' }).collect();
            assert_eq!(&got, row, "row {y}");
        }
    }

    #[test]
    fn matches_an_independent_encoder_for_multi_block_versions() {
        // FNV-1a over the module bits of qrcodejs's matrices for the same inputs.
        for (text_len, mask, version, expected_hash) in [
            (30usize, 0u8, 3usize, 0xad080a3ef09082ffu64),
            (70, 3, 5, 0x7a0b0805b7d57bb9),
            (150, 5, 8, 0xf7f491092c9a392e),
            (260, 6, 12, 0x23f5ffa154c21a68),
            (600, 1, 19, 0xe93d3cfb3785ae48),
            (1000, 7, 26, 0x74cb1b7215fcb3b5),
            (1150, 4, 28, 0x8e6c31372b4860f8),
            (2000, 2, 38, 0x839e4bf083be8349),
            (2331, 3, 40, 0xe8056816f37bef3b),
        ] {
            let text: String = (0..text_len).map(|i| (b'a' + (i % 26) as u8) as char).collect();
            let qr = QrCode::encode_with_mask(text.as_bytes(), Some(mask)).unwrap();
            assert_eq!(qr.version(), version, "len {text_len}");
            let mut hash: u64 = 0xcbf29ce484222325;
            for y in 0..qr.size() {
                for x in 0..qr.size() {
                    hash ^= u64::from(qr.module(x, y));
                    hash = hash.wrapping_mul(0x100000001b3);
                }
            }
            assert_eq!(hash, expected_hash, "len {text_len} mask {mask}");
        }
    }

    #[test]
    fn picks_a_mask_and_renders() {
        let qr = QrCode::encode(DEFAULT_PLAYGROUND_URL.as_bytes()).unwrap();
        assert!(qr.mask() < 8);
        let text = qr.to_terminal_string(2);
        assert_eq!(text.lines().count(), (qr.size() + 4).div_ceil(2));
        assert!(qr.to_svg(4).starts_with("<svg"));
        assert!(QrCode::encode(&vec![b'a'; 2332]).is_none());
        assert!(QrCode::encode(&vec![b'a'; 2331]).is_some());
    }
}
