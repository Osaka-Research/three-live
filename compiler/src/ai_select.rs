// Copyright 2026 Google LLC
// SPDX-License-Identifier: Apache-2.0

//! Talk-to-Select tier 1 (roadmap B2b-4): resolves a spoken reference such as "the two red
//! chairs on the left" to mesh names without a model call, and parses push-to-talk commands
//! ("select the lamp and make it blue").
//!
//! The web plugin (`three-live/src/plugins/ai-select.ts`) implements the same algorithm;
//! both are checked against `three-live/tests/fixtures/select_cases.json`.

use crate::scene::SceneGraph;
use serde_json::{json, Value};

/// Most names one match returns (same as the selection cap).
pub const MAX_MATCH: usize = 50;
/// Most names offered back when a reference is ambiguous.
pub const MAX_CANDIDATES: usize = 10;

/// One mesh as the matcher sees it: a world-space box and an optional linear RGB color.
#[derive(Debug, Clone, PartialEq)]
pub struct RawEntry {
    pub name: String,
    pub min: [f64; 3],
    pub max: [f64; 3],
    pub color: Option<[f64; 3]>,
}

/// An indexed mesh.
#[derive(Debug, Clone)]
pub struct IndexEntry {
    pub id: usize,
    pub name: String,
    pub words: Vec<String>,
    pub color_name: Option<&'static str>,
    pub size: f64,
    pub height: f64,
    pub center: [f64; 3],
}

/// The viewpoint "left", "front", etc. are relative to.
#[derive(Debug, Clone, Copy, PartialEq)]
pub struct Camera {
    pub eye: [f64; 3],
    pub target: [f64; 3],
}

impl Default for Camera {
    fn default() -> Self {
        Camera { eye: [0.0, 1.6, 5.0], target: [0.0, 0.8, 0.0] }
    }
}

/// How sure tier 1 is.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum Confidence {
    High,
    Ambiguous,
    None,
}

impl Confidence {
    pub fn as_str(self) -> &'static str {
        match self {
            Confidence::High => "high",
            Confidence::Ambiguous => "ambiguous",
            Confidence::None => "none",
        }
    }
}

/// Result of [`match_query`].
#[derive(Debug, Clone)]
pub struct MatchResult {
    /// Index positions, in index order.
    pub ids: Vec<usize>,
    /// Distinct mesh names of `ids`, in index order.
    pub names: Vec<String>,
    pub confidence: Confidence,
    /// Names to offer back when ambiguous (at most [`MAX_CANDIDATES`]).
    pub candidates: Vec<String>,
    /// `exact`, `match`, `multiple`, `count_mismatch`, `relation`, `no_match`, `empty`, `except`.
    pub reason: &'static str,
}

impl MatchResult {
    pub fn to_json(&self) -> Value {
        json!({
            "ids": self.ids,
            "names": self.names,
            "confidence": self.confidence.as_str(),
            "candidates": self.candidates,
            "reason": self.reason,
        })
    }
}

// ---------------------------------------------------------------------------------------------
// Vocabulary (keep identical to ai-select.ts).

const FILLER: &[&str] = &[
    "the",
    "a",
    "an",
    "please",
    "can",
    "could",
    "would",
    "you",
    "will",
    "i",
    "want",
    "wanna",
    "to",
    "me",
    "my",
    "that",
    "this",
    "those",
    "these",
    "of",
    "one",
    "ones",
    "object",
    "objects",
    "thing",
    "things",
    "item",
    "items",
    "mesh",
    "meshes",
    "piece",
    "pieces",
    "part",
    "parts",
    "just",
    "only",
    "also",
    "too",
    "is",
    "are",
    "there",
    "here",
    "which",
    "select",
    "pick",
    "choose",
    "highlight",
    "grab",
    "focus",
    "on",
    "in",
    "at",
    "by",
    "some",
    "most",
    "side",
    "hand",
    "them",
    "it",
    "its",
    "and",
    "s",
    "now",
    "again",
    "as",
    "well",
    "other",
    "others",
];

const SYNONYMS: &[&[&str]] = &[
    &["sofa", "couch", "settee"],
    &["lamp", "light", "lantern"],
    &["door", "gate", "doorway"],
    &["table", "desk"],
    &["chair", "seat", "stool"],
    &["rug", "carpet", "mat"],
    &["cup", "mug"],
    &["tv", "television", "screen", "monitor"],
    &["car", "vehicle", "automobile"],
    &["box", "crate", "cube"],
    &["ball", "sphere", "orb"],
    &["floor", "ground"],
    &["plant", "tree", "bush"],
    &["cabinet", "cupboard", "closet"],
];

/// Reference sRGB colors (0-255) and the family a query word also matches.
const PALETTE: &[(&str, [f64; 3], &str)] = &[
    ("red", [220.0, 40.0, 40.0], "red"),
    ("orange", [245.0, 140.0, 30.0], "orange"),
    ("yellow", [240.0, 220.0, 40.0], "yellow"),
    ("gold", [212.0, 175.0, 55.0], "yellow"),
    ("green", [50.0, 170.0, 60.0], "green"),
    ("teal", [0.0, 128.0, 128.0], "green"),
    ("cyan", [40.0, 200.0, 220.0], "blue"),
    ("blue", [40.0, 80.0, 220.0], "blue"),
    ("navy", [20.0, 30.0, 100.0], "blue"),
    ("purple", [130.0, 50.0, 180.0], "purple"),
    ("magenta", [220.0, 40.0, 200.0], "pink"),
    ("pink", [240.0, 120.0, 180.0], "pink"),
    ("brown", [130.0, 80.0, 40.0], "brown"),
    ("beige", [225.0, 205.0, 160.0], "brown"),
    ("white", [245.0, 245.0, 245.0], "white"),
    ("silver", [192.0, 192.0, 192.0], "gray"),
    ("gray", [128.0, 128.0, 128.0], "gray"),
    ("black", [20.0, 20.0, 20.0], "black"),
];

const COLOR_ALIASES: &[(&str, &str)] = &[
    ("grey", "gray"),
    ("golden", "gold"),
    ("crimson", "red"),
    ("maroon", "red"),
    ("violet", "purple"),
    ("aqua", "cyan"),
    ("turquoise", "cyan"),
    ("tan", "beige"),
];

#[derive(Debug, Clone, Copy, PartialEq)]
enum Axis {
    Right,
    Depth,
    Up,
    Size,
    Height,
}

#[derive(Debug, Clone, Copy, PartialEq)]
enum Modifier {
    Extreme(Axis, bool), // (axis, true = max)
    Middle,
}

fn modifier_word(w: &str) -> Option<Modifier> {
    use Axis::*;
    use Modifier::*;
    Some(match w {
        "left" | "leftmost" => Extreme(Right, false),
        "right" | "rightmost" => Extreme(Right, true),
        "front" | "nearest" | "closest" | "frontmost" => Extreme(Depth, false),
        "back" | "farthest" | "furthest" | "rear" | "far" | "backmost" => Extreme(Depth, true),
        "top" | "highest" | "upper" | "topmost" => Extreme(Up, true),
        "bottom" | "lowest" | "lower" | "bottommost" => Extreme(Up, false),
        "biggest" | "largest" | "big" | "large" | "huge" | "bigger" | "larger" => {
            Extreme(Size, true)
        }
        "smallest" | "small" | "tiny" | "little" | "smaller" => Extreme(Size, false),
        "tallest" | "tall" | "taller" => Extreme(Height, true),
        "shortest" | "short" | "shorter" => Extreme(Height, false),
        "middle" | "center" | "centre" | "central" => Middle,
        _ => return None,
    })
}

fn ordinal_word(w: &str) -> Option<i64> {
    Some(match w {
        "first" => 0,
        "second" => 1,
        "third" => 2,
        "fourth" => 3,
        "fifth" => 4,
        "last" => -1,
        _ => return None,
    })
}

fn number_word(w: &str) -> Option<usize> {
    let n = match w {
        "two" | "pair" => 2,
        "three" => 3,
        "four" => 4,
        "five" => 5,
        "six" => 6,
        "seven" => 7,
        "eight" => 8,
        "nine" => 9,
        "ten" => 10,
        _ => {
            if !w.is_empty() && w.len() <= 3 && w.bytes().all(|b| b.is_ascii_digit()) {
                w.parse::<usize>().ok()?
            } else {
                return None;
            }
        }
    };
    if (1..=MAX_MATCH).contains(&n) {
        Some(n)
    } else {
        None
    }
}

fn color_word(w: &str) -> Option<&'static str> {
    if let Some((_, c)) = COLOR_ALIASES.iter().find(|(a, _)| *a == w) {
        return Some(c);
    }
    PALETTE.iter().find(|(n, _, _)| *n == w).map(|(n, _, _)| *n)
}

fn is_relation(tokens: &[String]) -> bool {
    let t: Vec<&str> = tokens.iter().map(String::as_str).collect();
    for (i, w) in t.iter().enumerate() {
        let next = t.get(i + 1).copied().unwrap_or("");
        match *w {
            "near" | "nearby" | "beside" | "behind" | "under" | "underneath" | "beneath"
            | "above" | "below" | "between" | "inside" | "within" | "against" | "with"
            | "beyond" | "around" => return true,
            "next" | "close" if next == "to" => return true,
            "front" | "top" if next == "of" => return true,
            "on" | "by" => {
                // "on the left" is spatial; "on the table" is a relation.
                let mut j = i + 1;
                while j < t.len() && matches!(t[j], "the" | "a" | "an" | "its" | "my") {
                    j += 1;
                }
                match t.get(j) {
                    Some(n) if modifier_word(n).is_none() && !matches!(*n, "side" | "end") => {
                        return true
                    }
                    _ => {}
                }
            }
            _ => {}
        }
    }
    false
}

// ---------------------------------------------------------------------------------------------
// Words.

/// Lowercases and splits on anything that is not `a-z` / `0-9`.
pub fn tokenize(text: &str) -> Vec<String> {
    let lower = text.to_lowercase();
    lower
        .split(|c: char| !(c.is_ascii_lowercase() || c.is_ascii_digit()))
        .filter(|s| !s.is_empty())
        .map(str::to_string)
        .collect()
}

/// Crude English singular: `boxes` → `box`, `shelves` → `shelf`, `chairs` → `chair`.
pub fn singular(w: &str) -> String {
    let n = w.len();
    if n > 4 && w.ends_with("ies") {
        return format!("{}y", &w[..n - 3]);
    }
    if n > 4 && w.ends_with("ves") {
        return format!("{}f", &w[..n - 3]);
    }
    for suffix in ["ches", "shes", "xes", "sses", "zes"] {
        if n > suffix.len() + 1 && w.ends_with(suffix) {
            return w[..n - 2].to_string();
        }
    }
    if n > 3 && w.ends_with('s') && !w.ends_with("ss") && !w.ends_with("us") {
        return w[..n - 1].to_string();
    }
    w.to_string()
}

/// Words of a mesh name: split on separators, camelCase, and letter/digit boundaries;
/// lowercased and singularized. `"RedChair_02"` → `["red", "chair", "02"]`.
pub fn name_words(name: &str) -> Vec<String> {
    let mut words = Vec::new();
    let mut cur = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if !c.is_ascii_alphanumeric() {
            if !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
            prev = None;
            continue;
        }
        if let Some(p) = prev {
            let boundary = (p.is_ascii_lowercase() && c.is_ascii_uppercase())
                || (p.is_ascii_digit() != c.is_ascii_digit());
            if boundary && !cur.is_empty() {
                words.push(std::mem::take(&mut cur));
            }
        }
        cur.push(c.to_ascii_lowercase());
        prev = Some(c);
    }
    if !cur.is_empty() {
        words.push(cur);
    }
    words.iter().map(|w| singular(w)).collect()
}

fn normalized(s: &str) -> String {
    s.chars().filter(|c| c.is_ascii_alphanumeric()).collect::<String>().to_lowercase()
}

fn synonyms(a: &str, b: &str) -> bool {
    SYNONYMS.iter().any(|g| g.contains(&a) && g.contains(&b))
}

/// Whether a (singular) query noun names a (singular) mesh-name word.
pub fn noun_matches(word: &str, noun: &str) -> bool {
    word == noun
        || synonyms(word, noun)
        || (noun.len() >= 4
            && word.len() >= 4
            && (word.starts_with(noun) || noun.starts_with(word)))
}

// ---------------------------------------------------------------------------------------------
// Colors.

fn linear_to_srgb(c: f64) -> f64 {
    let c = c.clamp(0.0, 1.0);
    let s = if c <= 0.0031308 { 12.92 * c } else { 1.055 * c.powf(1.0 / 2.4) - 0.055 };
    s * 255.0
}

/// Nearest palette name for a linear RGB color (glTF `baseColorFactor`).
pub fn color_name(linear: [f64; 3]) -> &'static str {
    let s = [linear_to_srgb(linear[0]), linear_to_srgb(linear[1]), linear_to_srgb(linear[2])];
    let mut best = PALETTE[0].0;
    let mut best_d = f64::INFINITY;
    for (name, rgb, _) in PALETTE {
        let d = (s[0] - rgb[0]).powi(2) + (s[1] - rgb[1]).powi(2) + (s[2] - rgb[2]).powi(2);
        if d < best_d {
            best_d = d;
            best = name;
        }
    }
    best
}

fn color_family(name: &str) -> &'static str {
    PALETTE.iter().find(|(n, _, _)| *n == name).map(|(_, _, f)| *f).unwrap_or("")
}

fn entry_has_color(e: &IndexEntry, q: &str) -> bool {
    if e.words.iter().any(|w| w == q) {
        return true;
    }
    match e.color_name {
        Some(c) => c == q || color_family(c) == q,
        None => false,
    }
}

// ---------------------------------------------------------------------------------------------
// Index.

/// Indexes raw entries (names, world boxes, linear colors).
pub fn build_index(raw: &[RawEntry]) -> Vec<IndexEntry> {
    raw.iter()
        .enumerate()
        .map(|(id, r)| {
            let ext = [
                (r.max[0] - r.min[0]).abs(),
                (r.max[1] - r.min[1]).abs(),
                (r.max[2] - r.min[2]).abs(),
            ];
            IndexEntry {
                id,
                name: r.name.clone(),
                words: name_words(&r.name),
                color_name: r.color.map(color_name),
                size: ext[0].max(0.01) * ext[1].max(0.01) * ext[2].max(0.01),
                height: ext[1],
                center: [
                    (r.min[0] + r.max[0]) / 2.0,
                    (r.min[1] + r.max[1]) / 2.0,
                    (r.min[2] + r.max[2]) / 2.0,
                ],
            }
        })
        .collect()
}

type Mat4 = [f64; 16]; // column-major

fn mat_mul(a: &Mat4, b: &Mat4) -> Mat4 {
    let mut o = [0.0; 16];
    for c in 0..4 {
        for r in 0..4 {
            o[c * 4 + r] = (0..4).map(|k| a[k * 4 + r] * b[c * 4 + k]).sum();
        }
    }
    o
}

fn trs(t: [f32; 3], q: [f32; 4], s: [f32; 3]) -> Mat4 {
    let (x, y, z, w) = (q[0] as f64, q[1] as f64, q[2] as f64, q[3] as f64);
    let (sx, sy, sz) = (s[0] as f64, s[1] as f64, s[2] as f64);
    [
        (1.0 - 2.0 * (y * y + z * z)) * sx,
        (2.0 * (x * y + z * w)) * sx,
        (2.0 * (x * z - y * w)) * sx,
        0.0,
        (2.0 * (x * y - z * w)) * sy,
        (1.0 - 2.0 * (x * x + z * z)) * sy,
        (2.0 * (y * z + x * w)) * sy,
        0.0,
        (2.0 * (x * z + y * w)) * sz,
        (2.0 * (y * z - x * w)) * sz,
        (1.0 - 2.0 * (x * x + y * y)) * sz,
        0.0,
        t[0] as f64,
        t[1] as f64,
        t[2] as f64,
        1.0,
    ]
}

fn world_box(positions: &[[f32; 3]], m: &Mat4) -> Option<([f64; 3], [f64; 3])> {
    let mut lo = [f64::INFINITY; 3];
    let mut hi = [f64::NEG_INFINITY; 3];
    for p in positions {
        for k in 0..3 {
            lo[k] = lo[k].min(p[k] as f64);
            hi[k] = hi[k].max(p[k] as f64);
        }
    }
    if !lo[0].is_finite() {
        return None;
    }
    let mut wlo = [f64::INFINITY; 3];
    let mut whi = [f64::NEG_INFINITY; 3];
    for i in 0..8 {
        let p = [
            if i & 1 == 0 { lo[0] } else { hi[0] },
            if i & 2 == 0 { lo[1] } else { hi[1] },
            if i & 4 == 0 { lo[2] } else { hi[2] },
        ];
        for k in 0..3 {
            let v = m[k] * p[0] + m[4 + k] * p[1] + m[8 + k] * p[2] + m[12 + k];
            wlo[k] = wlo[k].min(v);
            whi[k] = whi[k].max(v);
        }
    }
    Some((wlo, whi))
}

/// Raw entries for every visible mesh of a compiled scene.
pub fn entries_from_scene(scene: &SceneGraph) -> Vec<RawEntry> {
    let color_of = |mi: Option<usize>| {
        mi.and_then(|i| scene.materials.get(i))
            .map(|m| [m.base_color[0] as f64, m.base_color[1] as f64, m.base_color[2] as f64])
    };
    let mut out = Vec::new();
    if scene.nodes.is_empty() {
        const IDENTITY: Mat4 =
            [1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0, 0.0, 0.0, 0.0, 0.0, 1.0];
        for m in &scene.meshes {
            if let Some((min, max)) = world_box(&m.positions, &IDENTITY) {
                out.push(RawEntry {
                    name: m.name.clone(),
                    min,
                    max,
                    color: color_of(m.material_index),
                });
            }
        }
        return out;
    }
    let mut world: Vec<Mat4> = Vec::with_capacity(scene.nodes.len());
    let mut visible: Vec<bool> = Vec::with_capacity(scene.nodes.len());
    for (i, n) in scene.nodes.iter().enumerate() {
        let local = trs(n.translation, n.rotation, n.scale);
        let (m, vis) = match n.parent.filter(|&p| p < i) {
            Some(p) => (mat_mul(&world[p], &local), visible[p] && n.visible),
            None => (local, n.visible),
        };
        world.push(m);
        visible.push(vis);
        if !vis {
            continue;
        }
        let Some(mesh) = n.mesh.and_then(|mi| scene.meshes.get(mi)) else { continue };
        if let Some((min, max)) = world_box(&mesh.positions, &world[i]) {
            let name = if n.name.is_empty() { mesh.name.clone() } else { n.name.clone() };
            out.push(RawEntry { name, min, max, color: color_of(mesh.material_index) });
        }
    }
    out
}

// ---------------------------------------------------------------------------------------------
// Matching.

fn sub(a: [f64; 3], b: [f64; 3]) -> [f64; 3] {
    [a[0] - b[0], a[1] - b[1], a[2] - b[2]]
}
fn dot(a: [f64; 3], b: [f64; 3]) -> f64 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}
fn norm(a: [f64; 3]) -> Option<[f64; 3]> {
    let l = dot(a, a).sqrt();
    if l < 1e-9 {
        None
    } else {
        Some([a[0] / l, a[1] / l, a[2] / l])
    }
}

struct View {
    eye: [f64; 3],
    right: [f64; 3],
}

fn view_of(cam: &Camera) -> View {
    let f = norm(sub(cam.target, cam.eye)).unwrap_or([0.0, 0.0, -1.0]);
    // right = forward × worldUp
    let r = [-f[2], 0.0, f[0]];
    View { eye: cam.eye, right: norm(r).unwrap_or([1.0, 0.0, 0.0]) }
}

fn axis_value(e: &IndexEntry, axis: Axis, v: &View) -> f64 {
    match axis {
        Axis::Right => dot(sub(e.center, v.eye), v.right),
        Axis::Depth => dot(sub(e.center, v.eye), sub(e.center, v.eye)).sqrt(),
        Axis::Up => e.center[1],
        Axis::Size => e.size,
        Axis::Height => e.height,
    }
}

const EPS: f64 = 1e-6;

fn mean(xs: &[f64]) -> f64 {
    if xs.is_empty() {
        0.0
    } else {
        xs.iter().sum::<f64>() / xs.len() as f64
    }
}

/// Keeps the half of `set` on the modifier's side of the mean (all of it when tied).
fn half_space<'a>(set: Vec<&'a IndexEntry>, m: Modifier, v: &View) -> Vec<&'a IndexEntry> {
    match m {
        Modifier::Extreme(axis, max) => {
            let vals: Vec<f64> = set.iter().map(|e| axis_value(e, axis, v)).collect();
            let mu = mean(&vals);
            let kept: Vec<&IndexEntry> = set
                .iter()
                .zip(&vals)
                .filter(|(_, &x)| if max { x > mu + EPS } else { x < mu - EPS })
                .map(|(e, _)| *e)
                .collect();
            if kept.is_empty() {
                set
            } else {
                kept
            }
        }
        Modifier::Middle => {
            if set.len() < 3 {
                return set;
            }
            let vals: Vec<f64> = set.iter().map(|e| axis_value(e, Axis::Right, v)).collect();
            let lo = vals.iter().cloned().fold(f64::INFINITY, f64::min);
            let hi = vals.iter().cloned().fold(f64::NEG_INFINITY, f64::max);
            let kept: Vec<&IndexEntry> = set
                .iter()
                .zip(&vals)
                .filter(|(_, &x)| x > lo + EPS && x < hi - EPS)
                .map(|(e, _)| *e)
                .collect();
            if kept.is_empty() {
                set
            } else {
                kept
            }
        }
    }
}

/// Sorts `set` best-first for the modifier (stable, so ties keep index order).
fn rank<'a>(mut set: Vec<&'a IndexEntry>, m: Modifier, v: &View) -> Vec<(&'a IndexEntry, f64)> {
    let key = |e: &IndexEntry| -> f64 {
        match m {
            Modifier::Extreme(axis, true) => -axis_value(e, axis, v),
            Modifier::Extreme(axis, false) => axis_value(e, axis, v),
            Modifier::Middle => {
                0.0 // replaced below
            }
        }
    };
    if m == Modifier::Middle {
        let vals: Vec<f64> = set.iter().map(|e| axis_value(e, Axis::Right, v)).collect();
        let mu = mean(&vals);
        let mut keyed: Vec<(&IndexEntry, f64)> =
            set.drain(..).map(|e| (e, (axis_value(e, Axis::Right, v) - mu).abs())).collect();
        keyed.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
        return keyed;
    }
    let mut keyed: Vec<(&IndexEntry, f64)> = set.drain(..).map(|e| (e, key(e))).collect();
    keyed.sort_by(|a, b| a.1.partial_cmp(&b.1).unwrap_or(std::cmp::Ordering::Equal));
    keyed
}

fn result(set: &[&IndexEntry], confidence: Confidence, reason: &'static str) -> MatchResult {
    let mut ids: Vec<usize> = set.iter().map(|e| e.id).collect();
    ids.sort_unstable();
    ids.dedup();
    let mut names: Vec<String> = Vec::new();
    let mut ordered: Vec<&IndexEntry> = set.to_vec();
    ordered.sort_by_key(|e| e.id);
    for e in &ordered {
        if !names.contains(&e.name) && names.len() < MAX_MATCH {
            names.push(e.name.clone());
        }
    }
    match confidence {
        Confidence::High => MatchResult { ids, names, confidence, candidates: Vec::new(), reason },
        Confidence::Ambiguous => {
            let candidates = names.iter().take(MAX_CANDIDATES).cloned().collect();
            MatchResult { ids: Vec::new(), names: Vec::new(), confidence, candidates, reason }
        }
        Confidence::None => MatchResult {
            ids: Vec::new(),
            names: Vec::new(),
            confidence,
            candidates: Vec::new(),
            reason,
        },
    }
}

fn none(reason: &'static str) -> MatchResult {
    result(&[], Confidence::None, reason)
}

/// Resolves a spoken reference against the index. `within` (e.g. the current selection, for
/// "deselect the red one") limits the search to those names.
pub fn match_query(
    index: &[IndexEntry],
    query: &str,
    camera: &Camera,
    within: Option<&[String]>,
) -> MatchResult {
    let scope: Vec<&IndexEntry> = match within {
        Some(names) => index.iter().filter(|e| names.contains(&e.name)).collect(),
        None => index.iter().collect(),
    };
    let tokens = tokenize(query);
    // "all chairs except the red one" / "but not" / "excluding" / "other than".
    let mut cut = None;
    for i in 0..tokens.len() {
        let t = tokens[i].as_str();
        let next = tokens.get(i + 1).map(String::as_str).unwrap_or("");
        if t == "except"
            || t == "excluding"
            || (t == "but" && next == "not")
            || (t == "other" && next == "than")
        {
            let skip = if t == "except" || t == "excluding" { 1 } else { 2 };
            cut = Some((i, i + skip));
            break;
        }
    }
    if let Some((at, rest)) = cut {
        let base = match_tokens(&scope, &tokens[..at], camera);
        if base.confidence != Confidence::High {
            return base;
        }
        let base_set: Vec<&IndexEntry> =
            scope.iter().copied().filter(|e| base.ids.contains(&e.id)).collect();
        let ex = match_tokens(&base_set, &tokens[rest..], camera);
        if ex.confidence != Confidence::High {
            let mut r = result(&base_set, Confidence::Ambiguous, "except");
            r.candidates.truncate(MAX_CANDIDATES);
            return r;
        }
        let kept: Vec<&IndexEntry> =
            base_set.into_iter().filter(|e| !ex.ids.contains(&e.id)).collect();
        if kept.is_empty() {
            return none("no_match");
        }
        return result(&kept, Confidence::High, "match");
    }
    match_tokens(&scope, &tokens, camera)
}

fn is_noun_token(w: &str) -> bool {
    !(FILLER.contains(&w)
        || matches!(w, "all" | "every" | "everything" | "each" | "everybody" | "both")
        || number_word(w).is_some()
        || ordinal_word(w).is_some()
        || color_word(w).is_some()
        || modifier_word(w).is_some()
        || w.bytes().all(|b| b.is_ascii_digit()))
}

/// "the lamp and the sofa" → two references, unioned. "red and blue chairs" stays one (its
/// first part names nothing).
fn match_tokens(scope: &[&IndexEntry], tokens: &[String], camera: &Camera) -> MatchResult {
    let parts: Vec<&[String]> = tokens.split(|t| t == "and").filter(|p| !p.is_empty()).collect();
    if parts.len() < 2 || !parts.iter().all(|p| p.iter().any(|t| is_noun_token(t))) {
        return match_simple(scope, tokens, camera);
    }
    let mut union: Vec<&IndexEntry> = Vec::new();
    let mut ambiguous = false;
    for part in parts {
        let r = match_simple(scope, part, camera);
        match r.confidence {
            Confidence::None => return r,
            Confidence::Ambiguous => {
                ambiguous = true;
                union.extend(scope.iter().copied().filter(|e| r.candidates.contains(&e.name)));
            }
            Confidence::High => {
                union.extend(scope.iter().copied().filter(|e| r.ids.contains(&e.id)))
            }
        }
    }
    union.sort_by_key(|e| e.id);
    union.dedup_by_key(|e| e.id);
    if ambiguous {
        result(&union, Confidence::Ambiguous, "multiple")
    } else {
        result(&union, Confidence::High, "match")
    }
}

fn match_simple(scope: &[&IndexEntry], tokens: &[String], camera: &Camera) -> MatchResult {
    if scope.is_empty() {
        return none("no_match");
    }
    // Exact name ("select Chair_02").
    let mut stripped: Vec<&str> = tokens.iter().map(String::as_str).collect();
    while let Some(first) = stripped.first() {
        if matches!(
            *first,
            "select"
                | "pick"
                | "choose"
                | "highlight"
                | "grab"
                | "the"
                | "a"
                | "an"
                | "just"
                | "only"
        ) {
            stripped.remove(0);
        } else {
            break;
        }
    }
    let joined: String = stripped.concat();
    if !joined.is_empty() {
        let exact: Vec<&IndexEntry> =
            scope.iter().copied().filter(|e| normalized(&e.name) == joined).collect();
        if !exact.is_empty() {
            return result(&exact, Confidence::High, "exact");
        }
    }
    if is_relation(tokens) {
        return none("relation");
    }

    let mut nouns: Vec<String> = Vec::new();
    let mut plural = false;
    let mut all = false;
    let mut quantity: Option<usize> = None;
    let mut ordinal: Option<i64> = None;
    let mut colors: Vec<&str> = Vec::new();
    let mut mods: Vec<Modifier> = Vec::new();
    let mut prev_noun = false;
    for t in tokens {
        let w = t.as_str();
        if prev_noun && w.bytes().all(|b| b.is_ascii_digit()) {
            nouns.push(w.to_string()); // "chair 2" names a mesh
            continue;
        }
        prev_noun = false;
        if matches!(w, "all" | "every" | "everything" | "each" | "everybody") {
            all = true;
            plural = true;
        } else if w == "both" {
            quantity = Some(2);
            plural = true;
        } else if let Some(n) = number_word(w) {
            quantity = Some(n);
            plural |= n > 1;
        } else if let Some(o) = ordinal_word(w) {
            ordinal = Some(o);
        } else if let Some(c) = color_word(w) {
            colors.push(c);
        } else if let Some(m) = modifier_word(w) {
            mods.push(m);
        } else if !FILLER.contains(&w) {
            let s = singular(w);
            if s != w {
                plural = true;
            }
            nouns.push(s);
            prev_noun = true;
        }
    }
    if nouns.is_empty()
        && colors.is_empty()
        && mods.is_empty()
        && ordinal.is_none()
        && !all
        && quantity.is_none()
    {
        return none("empty");
    }
    let view = view_of(camera);

    // Nouns: keep the entries naming the most of them.
    let mut set: Vec<&IndexEntry> = scope.to_vec();
    if !nouns.is_empty() {
        let scored: Vec<(&IndexEntry, usize)> = set
            .iter()
            .map(|e| {
                (*e, nouns.iter().filter(|n| e.words.iter().any(|w| noun_matches(w, n))).count())
            })
            .collect();
        let best = scored.iter().map(|s| s.1).max().unwrap_or(0);
        if best == 0 {
            return none("no_match");
        }
        set = scored.into_iter().filter(|s| s.1 == best).map(|s| s.0).collect();
        // Prefer meshes the nouns describe fully: "the floor" → `Floor`, not `FloorLamp`.
        let unmatched = |e: &IndexEntry| {
            e.words
                .iter()
                .filter(|w| !w.bytes().all(|b| b.is_ascii_digit()))
                .filter(|w| !nouns.iter().any(|n| noun_matches(w, n)))
                .count()
        };
        let fewest = set.iter().map(|e| unmatched(e)).min().unwrap_or(0);
        set.retain(|e| unmatched(e) == fewest);
    }
    if !colors.is_empty() {
        set.retain(|e| colors.iter().any(|c| entry_has_color(e, c)));
    }
    if set.is_empty() {
        return none("no_match");
    }

    // Ordinals count left to right.
    if let Some(o) = ordinal {
        for m in &mods {
            set = half_space(set, *m, &view);
        }
        let ranked = rank(set, Modifier::Extreme(Axis::Right, false), &view);
        let n = quantity.unwrap_or(1).min(ranked.len());
        let picked: Vec<&IndexEntry> = if o < 0 {
            ranked[ranked.len() - n..].iter().map(|r| r.0).collect()
        } else {
            let start = o as usize * if quantity.is_some() { n } else { 1 };
            if start >= ranked.len() {
                return none("no_match");
            }
            ranked[start..(start + n).min(ranked.len())].iter().map(|r| r.0).collect()
        };
        return result(&picked, Confidence::High, "match");
    }

    let singular_ref = !plural && quantity.is_none();
    let take = if singular_ref {
        Some(1)
    } else if all {
        None
    } else {
        quantity
    };
    if let (Some(n), Some((last, rest))) = (take, mods.split_last()) {
        for m in rest {
            set = half_space(set, *m, &view);
        }
        let ranked = rank(set, *last, &view);
        if ranked.len() < n {
            let names: Vec<&IndexEntry> = ranked.iter().map(|r| r.0).collect();
            return result(&names, Confidence::Ambiguous, "count_mismatch");
        }
        // A tie at the cut-off means the reference doesn't decide.
        if ranked.len() > n && (ranked[n].1 - ranked[n - 1].1).abs() <= EPS {
            let tied: Vec<&IndexEntry> = ranked
                .iter()
                .filter(|r| (r.1 - ranked[n - 1].1).abs() <= EPS)
                .map(|r| r.0)
                .collect();
            return result(&tied, Confidence::Ambiguous, "multiple");
        }
        let picked: Vec<&IndexEntry> = ranked[..n].iter().map(|r| r.0).collect();
        return result(&picked, Confidence::High, "match");
    }
    for m in &mods {
        set = half_space(set, *m, &view);
    }
    if singular_ref {
        return if set.len() == 1 {
            result(&set, Confidence::High, "match")
        } else {
            result(&set, Confidence::Ambiguous, "multiple")
        };
    }
    if let Some(n) = quantity {
        if set.len() != n {
            return result(&set, Confidence::Ambiguous, "count_mismatch");
        }
    }
    result(&set, Confidence::High, "match")
}

// ---------------------------------------------------------------------------------------------
// Push-to-talk grammar.

/// Verbs that start an edit instruction.
pub const EDIT_VERBS: &[&str] = &[
    "make",
    "paint",
    "color",
    "colour",
    "turn",
    "move",
    "rotate",
    "scale",
    "resize",
    "delete",
    "remove",
    "change",
    "set",
    "add",
    "put",
    "give",
    "raise",
    "lower",
    "shrink",
    "enlarge",
    "hide",
    "show",
    "swap",
    "replace",
    "spin",
    "flip",
    "double",
    "halve",
    "duplicate",
    "copy",
    "animate",
    "brighten",
    "darken",
];

/// A parsed push-to-talk utterance.
#[derive(Debug, Clone, PartialEq)]
pub enum VoiceCommand {
    /// Clear the selection.
    Clear,
    /// Change the selection (`mode`: replace / add / remove) by `query`.
    Select { mode: &'static str, query: String },
    /// Select, then run `instruction` as an edit.
    Mixed { mode: &'static str, query: String, instruction: String },
    /// An edit of the current selection.
    Edit { instruction: String },
}

impl VoiceCommand {
    pub fn to_json(&self) -> Value {
        match self {
            VoiceCommand::Clear => json!({"kind": "clear", "mode": "clear"}),
            VoiceCommand::Select { mode, query } => {
                json!({"kind": "select", "mode": mode, "query": query})
            }
            VoiceCommand::Mixed { mode, query, instruction } => {
                json!({"kind": "mixed", "mode": mode, "query": query, "instruction": instruction})
            }
            VoiceCommand::Edit { instruction } => {
                json!({"kind": "edit", "instruction": instruction})
            }
        }
    }
}

fn starts_with_edit_verb(s: &str) -> bool {
    let first = s.split_whitespace().next().unwrap_or("");
    EDIT_VERBS.contains(&first)
}

/// Splits "the chairs and make them red" into ("the chairs", "make them red").
fn split_mixed(q: &str) -> (String, Option<String>) {
    let words: Vec<&str> = q.split(' ').collect();
    for i in 0..words.len() {
        let comma = words[i].ends_with(',');
        let joiner = i > 0 && matches!(words[i], "and" | "then");
        if !(comma || joiner) {
            continue;
        }
        let mut j = i + 1;
        while j < words.len() && matches!(words[j], "then" | "and") {
            j += 1;
        }
        if j >= words.len() || !EDIT_VERBS.contains(&words[j]) {
            continue;
        }
        let before = if joiner { words[..i].join(" ") } else { words[..=i].join(" ") };
        let before = before.trim_end_matches(',').trim().to_string();
        if !before.is_empty() {
            return (before, Some(words[j..].join(" ")));
        }
    }
    (q.to_string(), None)
}

fn strip_prefix_any<'a>(s: &'a str, prefixes: &[&str]) -> Option<&'a str> {
    prefixes.iter().find_map(|p| s.strip_prefix(p)).map(str::trim).filter(|r| !r.is_empty())
}

fn strip_suffix_any<'a>(s: &'a str, suffixes: &[&str]) -> Option<&'a str> {
    suffixes.iter().find_map(|p| s.strip_suffix(p)).map(str::trim).filter(|r| !r.is_empty())
}

/// The last `k` words of the original utterance (keeps the user's casing for the edit).
fn tail_words(original: &str, k: usize) -> String {
    let mut words: Vec<&str> = original.split_whitespace().collect();
    if let Some(last) = words.last() {
        if last.trim_end_matches(['.', '!', '?', ',']).eq_ignore_ascii_case("please") {
            words.pop();
        }
    }
    let start = words.len().saturating_sub(k);
    let mut out = words[start..].join(" ");
    while out.ends_with(['.', '!', '?', ',']) {
        out.pop();
    }
    out
}

fn finish(mode: &'static str, q: &str, original: &str) -> VoiceCommand {
    let (query, instruction) = split_mixed(q);
    let (mode, query) = match strip_suffix_any(&query, &[" too", " as well", " also"]) {
        Some(stripped) if mode == "replace" => ("add", stripped.to_string()),
        _ => (mode, query),
    };
    match instruction {
        Some(instruction) => {
            let k = instruction.split_whitespace().count();
            VoiceCommand::Mixed { mode, query, instruction: tail_words(original, k) }
        }
        None => VoiceCommand::Select { mode, query },
    }
}

/// Parses one push-to-talk utterance into a selection change, a mixed select-and-edit, or an
/// edit.
pub fn parse_voice_command(text: &str) -> VoiceCommand {
    let original = text.trim().to_string();
    let mut s: String = text
        .to_lowercase()
        .replace(['\u{2019}', '\u{2018}'], "'")
        .split_whitespace()
        .collect::<Vec<_>>()
        .join(" ");
    while s.ends_with(['.', '!', '?', ',']) {
        s.pop();
    }
    loop {
        let before = s.len();
        for lead in [
            "please ", "ok ", "ok, ", "okay ", "okay, ", "now ", "now, ", "hey ", "um ", "um, ",
            "uh ", "uh, ", "so ", "so, ", "and ",
        ] {
            if let Some(r) = s.strip_prefix(lead) {
                s = r.to_string();
            }
        }
        if let Some(r) = s.strip_suffix(" please") {
            s = r.trim_end_matches(',').to_string();
        }
        if s.len() == before {
            break;
        }
    }
    let s = s.trim().to_string();
    const CLEAR: &[&str] = &[
        "clear selection",
        "clear the selection",
        "reset selection",
        "reset the selection",
        "select nothing",
        "select none",
        "deselect",
        "deselect all",
        "deselect everything",
        "unselect",
        "unselect all",
        "unselect everything",
        "clear",
        "clear all",
    ];
    if CLEAR.contains(&s.as_str()) {
        return VoiceCommand::Clear;
    }
    if let Some(r) =
        strip_prefix_any(&s, &["deselect ", "unselect ", "don't select ", "do not select "])
    {
        return finish("remove", r, &original);
    }
    for verb in ["remove ", "take "] {
        if let Some(r) = s.strip_prefix(verb) {
            let tails = [" from the selection", " from selection", " out of the selection"];
            if let Some(q) = strip_suffix_any(r, &tails) {
                return VoiceCommand::Select { mode: "remove", query: q.to_string() };
            }
        }
    }
    if let Some(r) =
        strip_prefix_any(&s, &["also select ", "also pick ", "also choose ", "also add "])
    {
        return finish("add", r, &original);
    }
    if let Some(r) = s.strip_prefix("add ") {
        if let Some(q) = strip_suffix_any(r, &[" to the selection", " to selection"]) {
            return VoiceCommand::Select { mode: "add", query: q.to_string() };
        }
    }
    const SELECT: &[&str] = &[
        "select only ",
        "select just ",
        "only select ",
        "just select ",
        "select ",
        "pick ",
        "choose ",
        "highlight ",
        "grab ",
        "focus on ",
    ];
    if let Some(r) = strip_prefix_any(&s, SELECT) {
        return finish("replace", r, &original);
    }
    if let Some(r) = strip_prefix_any(&s, &["just ", "only "]) {
        if !starts_with_edit_verb(r) {
            return finish("replace", r, &original);
        }
    }
    VoiceCommand::Edit { instruction: tail_words(&original, usize::MAX) }
}

// ---------------------------------------------------------------------------------------------
// JSON ops (via `ai_call`).

fn vec3(v: Option<&Value>) -> Option<[f64; 3]> {
    let a = v?.as_array()?;
    if a.len() < 3 {
        return None;
    }
    let mut o = [0.0; 3];
    for k in 0..3 {
        let x = a[k].as_f64()?;
        if !x.is_finite() {
            return None;
        }
        o[k] = x;
    }
    Some(o)
}

/// Parses `[{name, min, max, color?}]`; drops malformed entries.
pub fn entries_from_json(v: &Value) -> Vec<RawEntry> {
    v.as_array()
        .map(|a| {
            a.iter()
                .take(5000)
                .filter_map(|e| {
                    let name = e.get("name")?.as_str()?.chars().take(200).collect::<String>();
                    if name.is_empty() {
                        return None;
                    }
                    Some(RawEntry {
                        name,
                        min: vec3(e.get("min"))?,
                        max: vec3(e.get("max"))?,
                        color: vec3(e.get("color")),
                    })
                })
                .collect()
        })
        .unwrap_or_default()
}

/// Parses `{eye, target}` (falls back to `fallback`).
pub fn camera_from_json(v: Option<&Value>, fallback: Camera) -> Camera {
    match v {
        Some(c) => Camera {
            eye: vec3(c.get("eye")).unwrap_or(fallback.eye),
            target: vec3(c.get("target")).unwrap_or(fallback.target),
        },
        None => fallback,
    }
}

/// Compact index for the tier-2 prompt: `[{id, name, color, center, size}]`.
pub fn index_json(index: &[IndexEntry]) -> Value {
    let r = |x: f64| (x * 100.0).round() / 100.0;
    Value::Array(
        index
            .iter()
            .take(300)
            .map(|e| {
                json!({
                    "id": e.id,
                    "name": e.name,
                    "color": e.color_name,
                    "center": [r(e.center[0]), r(e.center[1]), r(e.center[2])],
                    "size": r(e.size.cbrt()),
                })
            })
            .collect(),
    )
}

/// Scene entries and default camera from `{entries}` or `{source}` (runs the scene).
fn load_scene(req: &Value) -> Result<(Vec<RawEntry>, Camera), Value> {
    let mut fallback = Camera::default();
    let raw = if let Some(entries) = req.get("entries") {
        entries_from_json(entries)
    } else if let Some(src) = req.get("source").and_then(Value::as_str) {
        let script = crate::extract_script_from_source(src).0;
        match crate::validate_three_script(&script) {
            Ok(scene) => {
                if let Some(c) = &scene.camera {
                    fallback = Camera {
                        eye: [c.position[0] as f64, c.position[1] as f64, c.position[2] as f64],
                        target: [c.target[0] as f64, c.target[1] as f64, c.target[2] as f64],
                    };
                }
                entries_from_scene(&scene)
            }
            Err(e) => return Err(json!({"error": format!("scene failed to run: {}", e)})),
        }
    } else {
        return Err(json!({"error": "needs 'entries' or 'source'"}));
    };
    Ok((raw, camera_from_json(req.get("camera"), fallback)))
}

fn strings(v: Option<&Value>) -> Option<Vec<String>> {
    v.and_then(Value::as_array)
        .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect())
}

/// `select` op: `{source | entries, camera?, query, within?, withIndex?}` → match result.
pub fn select_call(req: &Value) -> Value {
    let (raw, camera) = match load_scene(req) {
        Ok(v) => v,
        Err(e) => return e,
    };
    let index = build_index(&raw);
    let within = strings(req.get("within"));
    let query = req.get("query").and_then(Value::as_str).unwrap_or("");
    let mut out = match_query(&index, query, &camera, within.as_deref()).to_json();
    if req.get("withIndex").and_then(Value::as_bool).unwrap_or(false) {
        out["index"] = index_json(&index);
    }
    out
}

/// System prompt for tier-2 selection (keep identical to `SELECT_PROMPT` in `ai-select.ts`).
pub const SELECT_PROMPT: &str = "You find the objects a user means in a 3D scene. Reply with JSON only: {\"ids\": [numbers], \"confidence\": \"high\" or \"low\", \"question\": \"text\"}. Use only ids from the objects list. Left and right are as seen from the camera: \"right\" is the camera's right direction. If several objects fit equally, or none fits, set confidence to \"low\" and ask one short question that names the options.";

/// Chat messages for tier 2 (index, camera, current selection, request).
pub fn select_messages(
    index: &[IndexEntry],
    query: &str,
    camera: &Camera,
    selected: &[String],
) -> Value {
    let r = |x: f64| (x * 100.0).round() / 100.0;
    let f = sub(camera.target, camera.eye);
    let rl = (f[2] * f[2] + f[0] * f[0]).sqrt();
    let rl = if rl == 0.0 { 1.0 } else { rl };
    let payload = json!({
        "camera": {
            "eye": camera.eye.map(r),
            "target": camera.target.map(r),
            "right": [r(-f[2] / rl), 0.0, r(f[0] / rl)],
        },
        "objects": index_json(index),
        "selected": selected.iter().take(50).collect::<Vec<_>>(),
        "request": query.chars().take(500).collect::<String>(),
    });
    json!([
        {"role": "system", "content": SELECT_PROMPT},
        {"role": "user", "content": payload.to_string()},
    ])
}

/// Parses a tier-2 reply; `names[i]` is the mesh with id `i`. Unknown ids are dropped.
pub fn parse_select_reply(reply: &str, names: &[String]) -> Value {
    let v: Value = match (reply.find('{'), reply.rfind('}')) {
        (Some(a), Some(b)) if b > a => serde_json::from_str(&reply[a..=b]).unwrap_or(Value::Null),
        _ => Value::Null,
    };
    let mut picked: Vec<String> = Vec::new();
    for id in v.get("ids").and_then(Value::as_array).into_iter().flatten() {
        if let Some(name) = id.as_u64().and_then(|i| names.get(i as usize)) {
            if !picked.contains(name) && picked.len() < MAX_MATCH {
                picked.push(name.clone());
            }
        }
    }
    let mut question = String::new();
    let mut in_ctrl = false;
    for c in v.get("question").and_then(Value::as_str).unwrap_or("").chars() {
        if c.is_control() && (c as u32) < 0x80 {
            if !in_ctrl {
                question.push(' ');
            }
            in_ctrl = true;
        } else {
            question.push(c);
            in_ctrl = false;
        }
    }
    let question: String = question.trim().chars().take(300).collect();
    let high = v.get("confidence").and_then(Value::as_str) == Some("high") && !picked.is_empty();
    json!({"names": picked, "confidence": if high { "high" } else { "low" }, "question": question})
}

/// `select_messages` op: `{source | entries, camera?, query, within?, selection?}` →
/// `{messages, names}` (`names[i]` is id `i`, for `select_parse`).
pub fn select_messages_call(req: &Value) -> Value {
    let (mut raw, camera) = match load_scene(req) {
        Ok(v) => v,
        Err(e) => return e,
    };
    if let Some(within) = strings(req.get("within")) {
        raw.retain(|e| within.contains(&e.name));
    }
    let index = build_index(&raw);
    let selected = strings(req.get("selection")).unwrap_or_default();
    let query = req.get("query").and_then(Value::as_str).unwrap_or("");
    let names: Vec<&str> = index.iter().take(300).map(|e| e.name.as_str()).collect();
    json!({"messages": select_messages(&index, query, &camera, &selected), "names": names})
}

/// `select_parse` op: `{reply, names}` → `{names, confidence, question}`.
pub fn select_parse_call(req: &Value) -> Value {
    let names = strings(req.get("names")).unwrap_or_default();
    parse_select_reply(req.get("reply").and_then(Value::as_str).unwrap_or(""), &names)
}

// ---------------------------------------------------------------------------------------------
// Spoken wording (keep identical to `describeVoiceSelection` / `describeSelection` /
// `speakableName` in the web plugin; checked by the shared fixture).

/// A mesh name as it should be spoken: `"FloorLamp_2"` → `"Floor Lamp 2"`.
pub fn speakable_name(name: &str) -> String {
    let mut out = String::new();
    let mut prev: Option<char> = None;
    for c in name.chars() {
        if let Some(p) = prev {
            if (p.is_ascii_lowercase() && c.is_ascii_uppercase())
                || (p.is_ascii_alphabetic() && c.is_ascii_digit())
            {
                out.push(' ');
            }
        }
        out.push(if matches!(c, '_' | '-' | '.') { ' ' } else { c });
        prev = Some(c);
    }
    out.split_whitespace().collect::<Vec<_>>().join(" ")
}

fn speak_list(names: &[String], joiner: &str) -> String {
    let shown: Vec<String> = names.iter().take(5).map(|n| speakable_name(n)).collect();
    let more = names.len() - shown.len();
    if more > 0 {
        return format!("{} {} {} more", shown.join(", "), joiner, more);
    }
    if shown.len() < 2 {
        return shown.concat();
    }
    format!("{} {} {}", shown[..shown.len() - 1].join(", "), joiner, shown[shown.len() - 1])
}

/// What to say back after a selection request. `matched` is a match JSON
/// (`{confidence, reason, names, candidates}`) or `None` (no match was attempted).
pub fn describe_voice_selection(
    mode: &str,
    matched: Option<&Value>,
    meshes: &[String],
    query: &str,
) -> String {
    if mode == "clear" {
        return "Selection cleared.".into();
    }
    let Some(m) = matched else { return "Which object?".into() };
    let list = |k: &str| strings(m.get(k)).unwrap_or_default();
    let names = list("names");
    let candidates = list("candidates");
    let reason = m.get("reason").and_then(Value::as_str).unwrap_or("");
    match m.get("confidence").and_then(Value::as_str).unwrap_or("none") {
        "high" => match mode {
            "remove" if meshes.is_empty() => {
                format!("Removed {}. Nothing is selected.", speak_list(&names, "and"))
            }
            "remove" => {
                format!("Removed {}. {} selected.", speak_list(&names, "and"), meshes.len())
            }
            "add" => format!("Added {}. {} selected.", speak_list(&names, "and"), meshes.len()),
            _ if names.len() == 1 => format!("Selected {}.", speakable_name(&names[0])),
            _ => format!("Selected {}: {}.", names.len(), speak_list(&names, "and")),
        },
        "ambiguous" if reason == "count_mismatch" => {
            format!("I found {}: {}. Which ones?", candidates.len(), speak_list(&candidates, "and"))
        }
        "ambiguous" => format!("Which one: {}?", speak_list(&candidates, "or")),
        _ => {
            let q: String = query.split_whitespace().collect::<Vec<_>>().join(" ");
            let q: String = q.chars().take(80).collect();
            match reason {
                "relation" => format!(
                    "I can't tell which one \"{}\" is yet. Try its name or color, or tap it.",
                    q
                ),
                "empty" => "Which object?".into(),
                _ => format!("I couldn't find \"{}\".", q),
            }
        }
    }
}

/// Describes a selection for a voice model (`describeSelection` on the web).
pub fn describe_selection_context(meshes: &[String]) -> String {
    match meshes.len() {
        0 => "The user cleared the selection.".into(),
        1 => format!(
            "The user selected the mesh \"{}\". \"This\" or \"it\" now refers to it.",
            meshes[0]
        ),
        n => {
            let shown: Vec<String> = meshes.iter().take(20).map(|m| format!("\"{}\"", m)).collect();
            let more = if n > 20 { format!(" and {} more", n - 20) } else { String::new() };
            format!(
                "The user selected {} meshes: {}{}. \"These\", \"them\", or \"it\" refer to them.",
                n,
                shown.join(", "),
                more
            )
        }
    }
}

/// `select_say` op: `{mode, match?, meshes, query}` → `{text}`.
pub fn select_say_call(req: &Value) -> Value {
    let meshes = strings(req.get("meshes")).unwrap_or_default();
    let matched = req.get("match").filter(|m| m.is_object());
    let text = describe_voice_selection(
        req.get("mode").and_then(Value::as_str).unwrap_or("replace"),
        matched,
        &meshes,
        req.get("query").and_then(Value::as_str).unwrap_or(""),
    );
    json!({"text": text})
}

/// `select_context` op: `{meshes}` → `{text}`.
pub fn select_context_call(req: &Value) -> Value {
    json!({"text": describe_selection_context(&strings(req.get("meshes")).unwrap_or_default())})
}

#[cfg(test)]
mod tests {
    use super::*;

    fn fixture() -> Value {
        serde_json::from_str(include_str!("../../three-live/tests/fixtures/select_cases.json"))
            .unwrap()
    }

    #[test]
    fn shared_match_cases() {
        let f = fixture();
        let raw = entries_from_json(&f["scene"]);
        let index = build_index(&raw);
        let cam = camera_from_json(f.get("camera"), Camera::default());
        let mut failures = Vec::new();
        for case in f["match"].as_array().unwrap() {
            let q = case["query"].as_str().unwrap();
            let within: Option<Vec<String>> = case
                .get("within")
                .and_then(Value::as_array)
                .map(|a| a.iter().filter_map(Value::as_str).map(str::to_string).collect());
            let r = match_query(&index, q, &cam, within.as_deref());
            let want_conf = case["confidence"].as_str().unwrap();
            let mut ok = r.confidence.as_str() == want_conf;
            if let Some(names) = case.get("names").and_then(Value::as_array) {
                let want: Vec<&str> = names.iter().filter_map(Value::as_str).collect();
                let got: Vec<&str> = if r.confidence == Confidence::Ambiguous {
                    r.candidates.iter().map(String::as_str).collect()
                } else {
                    r.names.iter().map(String::as_str).collect()
                };
                ok &= got == want;
            }
            if let Some(reason) = case.get("reason").and_then(Value::as_str) {
                ok &= r.reason == reason;
            }
            if !ok {
                failures.push(format!("{:?} → {:?}", q, r.to_json()));
            }
        }
        assert!(failures.is_empty(), "failing cases:\n{}", failures.join("\n"));
    }

    #[test]
    fn shared_command_cases() {
        let f = fixture();
        let mut failures = Vec::new();
        for case in f["commands"].as_array().unwrap() {
            let text = case["text"].as_str().unwrap();
            let got = parse_voice_command(text).to_json();
            let want = &case["want"];
            if &got != want {
                failures.push(format!("{:?} → {} (want {})", text, got, want));
            }
        }
        assert!(failures.is_empty(), "failing commands:\n{}", failures.join("\n"));
    }

    /// Words inside the single-quoted strings of a TS `'...' + '...'` list after `start`.
    fn ts_words(ts: &str, start: &str) -> Vec<String> {
        let body = ts.split(start).nth(1).unwrap().split(".split(").next().unwrap();
        let (mut out, mut quoted) = (String::new(), false);
        for c in body.chars() {
            if c == '\'' {
                quoted = !quoted;
                out.push(' ');
            } else if quoted {
                out.push(c);
            }
        }
        let mut words: Vec<String> = out.split_whitespace().map(str::to_string).collect();
        words.sort();
        words
    }

    #[test]
    fn vocabulary_matches_the_web_plugin() {
        let ts = include_str!("../../three-live/src/plugins/ai-select-match.ts");
        let sorted = |w: &[&str]| {
            let mut v: Vec<String> = w.iter().map(|s| s.to_string()).collect();
            v.sort();
            v
        };
        assert_eq!(ts_words(ts, "const FILLER"), sorted(FILLER), "FILLER differs");
        assert_eq!(
            ts_words(ts, "export const EDIT_VERBS"),
            sorted(EDIT_VERBS),
            "EDIT_VERBS differ"
        );
        for g in SYNONYMS {
            assert!(ts.contains(&format!("'{}'", g.join(" "))), "synonym group {:?}", g);
        }
        for (name, rgb, family) in PALETTE {
            let row = format!("['{}', [{}, {}, {}], '{}']", name, rgb[0], rgb[1], rgb[2], family);
            assert!(ts.contains(&row), "palette row {}", row);
        }
    }

    #[test]
    fn select_prompt_matches_the_web_plugin() {
        let ts = include_str!("../../three-live/src/plugins/ai-select.ts");
        for sentence in SELECT_PROMPT.split(". ") {
            let escaped = sentence.trim_end_matches('.').replace('\'', "\\'");
            assert!(ts.contains(&escaped), "ai-select.ts SELECT_PROMPT is missing: {}", sentence);
        }
    }

    #[test]
    fn tier_two_messages_and_parse() {
        let entries = json!([
            {"name": "Lamp", "min": [0, 0, 0], "max": [1, 2, 1], "color": [1, 0, 0]},
            {"name": "Sofa", "min": [2, 0, 0], "max": [4, 1, 1]}
        ]);
        let r = select_messages_call(
            &json!({"entries": entries, "query": "the lamp near the sofa", "selection": ["Sofa"]}),
        );
        assert_eq!(r["names"], json!(["Lamp", "Sofa"]));
        assert_eq!(r["messages"][0]["content"], SELECT_PROMPT);
        let payload: Value =
            serde_json::from_str(r["messages"][1]["content"].as_str().unwrap()).unwrap();
        assert_eq!(payload["objects"][0]["color"], "red");
        assert_eq!(payload["camera"]["right"], json!([1.0, 0.0, 0.0]));
        assert_eq!(payload["selected"], json!(["Sofa"]));
        assert_eq!(payload["request"], "the lamp near the sofa");
        let names = vec!["Lamp".to_string(), "Sofa".to_string()];
        let p =
            parse_select_reply("ok {\"ids\": [0, 0, 7, \"x\"], \"confidence\": \"high\"}", &names);
        assert_eq!(p, json!({"names": ["Lamp"], "confidence": "high", "question": ""}));
        let p = parse_select_reply(
            "{\"ids\": [], \"confidence\": \"high\", \"question\": \"a\\u0007b\"}",
            &names,
        );
        assert_eq!(p, json!({"names": [], "confidence": "low", "question": "a b"}));
        assert_eq!(parse_select_reply("nope", &names)["confidence"], "low");
        let p = select_parse_call(
            &json!({"reply": "{\"ids\":[1],\"confidence\":\"high\"}", "names": names}),
        );
        assert_eq!(p["names"], json!(["Sofa"]));
    }

    #[test]
    fn shared_wording_cases() {
        let f = fixture();
        for case in f["say"].as_array().unwrap() {
            let got = select_say_call(case);
            assert_eq!(got["text"], case["want"], "say case {}", case);
        }
        for case in f["context"].as_array().unwrap() {
            let got = select_context_call(case);
            assert_eq!(got["text"], case["want"], "context case {}", case);
        }
        for case in f["speakable"].as_array().unwrap() {
            assert_eq!(speakable_name(case[0].as_str().unwrap()), case[1].as_str().unwrap());
        }
    }

    #[test]
    fn words_and_colors() {
        assert_eq!(name_words("RedChair_02"), vec!["red", "chair", "02"]);
        assert_eq!(name_words("bookShelves"), vec!["book", "shelf"]);
        assert_eq!(singular("boxes"), "box");
        assert_eq!(singular("glass"), "glass");
        assert_eq!(color_name([1.0, 0.0, 0.0]), "red");
        assert_eq!(color_name([0.5, 0.5, 0.5]), "silver"); // linear 0.5 ≈ sRGB 188
        assert_eq!(color_name([0.2158, 0.2158, 0.2158]), "gray"); // sRGB 128
        assert!(noun_matches("couch", "sofa"));
        assert!(noun_matches("lampshade", "lamp"));
        assert!(!noun_matches("cat", "car"));
    }

    #[test]
    fn index_from_scene_graph_uses_node_transforms() {
        use crate::scene::{Material3D, Mesh3D, SceneNode};
        let mut scene = SceneGraph::default();
        scene.meshes.push(
            serde_json::from_value::<Mesh3D>(json!({
                "name": "geo", "positions": [[-0.5, -0.5, -0.5], [0.5, 0.5, 0.5]],
                "normals": [], "uvs": [], "indices": [], "material_index": 0
            }))
            .unwrap(),
        );
        scene.materials.push(
            serde_json::from_value::<Material3D>(json!({
                "name": "m", "base_color": [0.0, 0.0, 1.0, 1.0], "metallic": 0.0,
                "roughness": 1.0, "double_sided": false
            }))
            .unwrap(),
        );
        scene.nodes.push(SceneNode {
            name: "Group".into(),
            translation: [2.0, 0.0, 0.0],
            ..Default::default()
        });
        scene.nodes.push(SceneNode {
            name: "BlueBox".into(),
            parent: Some(0),
            translation: [0.0, 1.0, 0.0],
            scale: [2.0, 2.0, 2.0],
            mesh: Some(0),
            ..Default::default()
        });
        scene.nodes.push(SceneNode {
            name: "Hidden".into(),
            mesh: Some(0),
            visible: false,
            ..Default::default()
        });
        let e = entries_from_scene(&scene);
        assert_eq!(e.len(), 1);
        assert_eq!(e[0].name, "BlueBox");
        assert_eq!(e[0].min, [1.0, 0.0, -1.0]);
        assert_eq!(e[0].max, [3.0, 2.0, 1.0]);
        let index = build_index(&e);
        assert_eq!(index[0].color_name, Some("blue"));
    }

    #[test]
    fn engine_colors_are_linear_and_classified() {
        let src = "const mk = (name, x, color) => { const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1.2, 1), new THREE.MeshStandardMaterial({ color })); m.name = name; m.position.set(x, 0.6, 0); scene.add(m); };\nmk('Chair_Left', -2, 0xd93025); mk('Chair_Middle', 0, 0x1a73e8); mk('Chair_Right', 2, 0xd93025);";
        let r = select_call(&json!({"source": src, "query": "the red chairs", "withIndex": true}));
        // MeshStandardMaterial hex colors are sRGB; the engine stores linear factors.
        assert_eq!(r["names"], json!(["Chair_Left", "Chair_Right"]), "{}", r);
        assert_eq!(r["index"][1]["color"], "blue");
    }

    #[test]
    fn select_op_runs_a_scene() {
        let src = "const a = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color: 0xff0000}));\na.name = 'Crate_A'; a.position.x = -2; scene.add(a);\nconst b = new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial({color: 0x0000ff}));\nb.name = 'Crate_B'; b.position.x = 2; scene.add(b);";
        let r = select_call(&json!({"source": src, "query": "the red box", "withIndex": true}));
        assert_eq!(r["confidence"], "high", "{}", r);
        assert_eq!(r["names"], json!(["Crate_A"]));
        assert_eq!(r["index"].as_array().unwrap().len(), 2);
        let r = select_call(&json!({"source": src, "query": "the right crate"}));
        assert_eq!(r["names"], json!(["Crate_B"]), "{}", r);
        let r = select_call(&json!({"query": "x"}));
        assert!(r["error"].is_string());
    }
}
