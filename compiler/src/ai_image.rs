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

//! Runtime Image -> Scene (`compileFromImage`, roadmap item B4).
//!
//! Shared prompt construction, metric spatial-prior formatting (`AISpatialPriors`),
//! candidate validation (compiler + spatial linter `TL100-TL402`), and repair message
//! builders for converting a reference photo, sketch, or AR camera frame into a
//! validated `<script type="text/three">` scene across Web, Android, iOS, CLI, and MCP.
//!
//! Mirrors `three-live/src/plugins/ai-image.ts` and is verified against the shared
//! fixture `three-live/tests/fixtures/image_cases.json`.

use crate::ai_edit::MAX_SCRIPT_BYTES;
use crate::spatial_lint::build_validation_report;
use serde::{Deserialize, Serialize};
use serde_json::{json, Value};

/// Maximum planes formatted into a prompt.
pub const MAX_PRIOR_PLANES: usize = 32;
/// Maximum 3D objects formatted into a prompt.
pub const MAX_PRIOR_OBJECTS: usize = 32;
/// Maximum characters in a plane or object label.
pub const MAX_PRIOR_LABEL_CHARS: usize = 80;
/// Maximum characters in a user prompt instruction.
pub const MAX_IMAGE_PROMPT_CHARS: usize = 2000;
const MAX_WARNINGS: usize = 20;

/// System prompt for reconstructing a 3D scene from a reference image.
/// Kept in sync with `IMAGE_SYSTEM_PROMPT` in `three-live/src/plugins/ai-image.ts` (tested below).
pub const IMAGE_SYSTEM_PROMPT: &str = "You reconstruct a 3D scene from a reference image into a Three.js script for Three-Live, which compiles it to glTF for Web, Android, and iOS.\n\
Reply with the COMPLETE script in a single ```js code block and nothing else.\n\
Rules:\n\
- Use the pre-defined globals `THREE`, `scene`, and `camera`. No imports, renderer, loaders, DOM, network, or timers.\n\
- Decompose visible objects into `THREE.Group` and `THREE.Mesh` hierarchies with a unique, descriptive `.name` on every Mesh and Group (for example `Table`, `Chair_Left`, `Desk_Lamp`) before attaching `userData.xr` or `userData.interactivity`.\n\
- Use real-world meters (1 unit = 1 m), +Y up, with the floor or resting surface at y = 0 (or the given metric floorY).\n\
- When metric spatial priors (floor height, camera pose, planes, or 3D object boxes) are provided, place meshes at those exact metric [x, y, z] coordinates, dimensions, and yaw angles, and set `mesh.userData.xr = { grab: true }` on movable props.\n\
- Supported: core geometries (`BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `CapsuleGeometry`, `PlaneGeometry`, `TorusGeometry`, `LatheGeometry`, `ExtrudeGeometry`, `TubeGeometry`, `Shape`, `Path`), `THREE.CSG`, `MeshStandardMaterial` / `MeshPhysicalMaterial`, `THREE.CanvasTexture`, `THREE.ProceduralTexture` presets (`wood`, `marble`, `brick`, `concrete`, `brushedMetal`, `rust`, `leather`, `fabric`, `carbonFiber`, `checkerboard`, `grid`), lights (`AmbientLight`, `HemisphereLight`, `DirectionalLight`, `PointLight`, `SpotLight`), and canonical `node.userData.xr` traits (`grab`, `anchor`, `physics`, `joint`, `handles`, `dimensions`, `billboard`, `orbit`, `follow`).\n\
- Always include balanced lighting (`AmbientLight` or `HemisphereLight` plus a `DirectionalLight` or `PointLight`) and frame `camera.position.set(x, y, z)` and `camera.lookAt(tx, ty, tz)` so 100% of meshes are inside the camera frustum.";

/// Result of [`validate_image_scene`].
#[derive(Debug, Clone, PartialEq, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct ImageSceneValidation {
    pub ok: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub mesh_names: Vec<String>,
    pub mesh_count: usize,
}

fn clean_label(raw: Option<&str>) -> String {
    let Some(s) = raw else {
        return String::new();
    };
    let mut out = String::new();
    let mut prev_space = true;
    for ch in s.chars() {
        let code = ch as u32;
        let is_ctrl_or_space = code <= 0x20 || code == 0x7f || ch == '"' || ch.is_whitespace();
        if is_ctrl_or_space {
            if !prev_space {
                out.push(' ');
                prev_space = true;
            }
        } else {
            out.push(ch);
            prev_space = false;
        }
    }
    out.trim().chars().take(MAX_PRIOR_LABEL_CHARS).collect()
}

/// JS-identical half-away-from-zero / positive-infinity rounding for 2 decimal places (`Math.round(v * 100) / 100`).
fn js_round(v: f64) -> f64 {
    (v + 0.5).floor()
}

fn fmt_meters(v: f64) -> String {
    let rounded = js_round(v * 100.0) / 100.0;
    let norm = if rounded.abs() < 1e-9 { 0.0 } else { rounded };
    format!("{:.2}", norm)
}

fn fmt_deg(v: f64) -> String {
    let rounded = js_round(v);
    let norm = if rounded.abs() < 1e-9 { 0.0 } else { rounded };
    format!("{:.0}", norm)
}

fn as_vec3(v: Option<&Value>) -> Option<[f64; 3]> {
    let arr = v?.as_array()?;
    if arr.len() < 3 {
        return None;
    }
    let x = arr[0].as_f64()?;
    let y = arr[1].as_f64()?;
    let z = arr[2].as_f64()?;
    if !x.is_finite() || !y.is_finite() || !z.is_finite() {
        return None;
    }
    Some([x, y, z])
}

fn as_pos_vec2(v: Option<&Value>) -> Option<[f64; 2]> {
    let arr = v?.as_array()?;
    if arr.len() < 2 {
        return None;
    }
    let w = arr[0].as_f64()?;
    let h = arr[1].as_f64()?;
    if !w.is_finite() || !h.is_finite() || w <= 0.0 || h <= 0.0 {
        return None;
    }
    Some([w, h])
}

fn as_pos_vec3(v: Option<&Value>) -> Option<[f64; 3]> {
    let v = as_vec3(v)?;
    if v[0] <= 0.0 || v[1] <= 0.0 || v[2] <= 0.0 {
        return None;
    }
    Some(v)
}

fn fmt_vec3(v: &[f64; 3]) -> String {
    format!("[{}, {}, {}]", fmt_meters(v[0]), fmt_meters(v[1]), fmt_meters(v[2]))
}

/// Formats an `AISpatialPriors` JSON object into a deterministic, sanitized prompt block.
/// Returns `""` when no valid priors are present.
pub fn format_spatial_priors(priors: Option<&Value>) -> String {
    let Some(obj) = priors.and_then(Value::as_object) else {
        return String::new();
    };
    let mut body: Vec<String> = Vec::new();

    if let Some(fy) = obj.get("floorY").and_then(Value::as_f64).filter(|v| v.is_finite()) {
        body.push(format!("- Floor height: y = {} m", fmt_meters(fy)));
    }

    if let Some(cam) = obj.get("camera").and_then(Value::as_object) {
        if let (Some(eye), Some(target)) = (as_vec3(cam.get("eye")), as_vec3(cam.get("target"))) {
            let mut cam_line =
                format!("- Camera: eye {}, target {}", fmt_vec3(&eye), fmt_vec3(&target));
            if let Some(fov) = cam
                .get("fovDeg")
                .and_then(Value::as_f64)
                .filter(|v| v.is_finite() && *v >= 1.0 && *v <= 179.0)
            {
                cam_line.push_str(&format!(", fov {} deg", fmt_deg(fov)));
            }
            body.push(cam_line);
        }
    }

    if let Some(planes) = obj.get("planes").and_then(Value::as_array) {
        let mut plane_lines: Vec<String> = Vec::new();
        for p in planes {
            if plane_lines.len() >= MAX_PRIOR_PLANES {
                break;
            }
            let Some(p_obj) = p.as_object() else { continue };
            let Some(center) = as_vec3(p_obj.get("center")) else { continue };
            let orient = if p_obj
                .get("orientation")
                .and_then(Value::as_str)
                .map(|s| s.eq_ignore_ascii_case("vertical"))
                .unwrap_or(false)
            {
                "vertical"
            } else {
                "horizontal"
            };
            let label = clean_label(p_obj.get("label").and_then(Value::as_str));
            let extent = as_pos_vec2(p_obj.get("extent"));
            let normal = as_vec3(p_obj.get("normal"));
            let mut line = format!("  {}. {}", plane_lines.len() + 1, orient);
            if !label.is_empty() {
                line.push_str(&format!(" \"{}\"", label));
            }
            line.push_str(&format!(" at {}", fmt_vec3(&center)));
            if let Some(ext) = extent {
                line.push_str(&format!(
                    ", extent {}m x {}m",
                    fmt_meters(ext[0]),
                    fmt_meters(ext[1])
                ));
            }
            if let Some(n) = normal {
                line.push_str(&format!(", normal {}", fmt_vec3(&n)));
            }
            plane_lines.push(line);
        }
        if !plane_lines.is_empty() {
            body.push("- Planes:".to_string());
            body.extend(plane_lines);
        }
    }

    if let Some(objects) = obj.get("objects").and_then(Value::as_array) {
        let mut obj_lines: Vec<String> = Vec::new();
        for o in objects {
            if obj_lines.len() >= MAX_PRIOR_OBJECTS {
                break;
            }
            let Some(o_obj) = o.as_object() else { continue };
            let label = clean_label(o_obj.get("label").and_then(Value::as_str));
            let Some(center) = as_vec3(o_obj.get("center")) else { continue };
            if label.is_empty() {
                continue;
            }
            let size = as_pos_vec3(o_obj.get("size"));
            let yaw = o_obj.get("yawDeg").and_then(Value::as_f64).filter(|v| v.is_finite());
            let mut line =
                format!("  {}. \"{}\" at {}", obj_lines.len() + 1, label, fmt_vec3(&center));
            if let Some(sz) = size {
                line.push_str(&format!(
                    ", size {}m x {}m x {}m",
                    fmt_meters(sz[0]),
                    fmt_meters(sz[1]),
                    fmt_meters(sz[2])
                ));
            }
            if let Some(y) = yaw {
                line.push_str(&format!(", yaw {} deg", fmt_deg(y)));
            }
            obj_lines.push(line);
        }
        if !obj_lines.is_empty() {
            body.push("- Detected 3D objects (place meshes at these metric bounds):".to_string());
            body.extend(obj_lines);
        }
    }

    if body.is_empty() {
        return String::new();
    }
    format!("Metric spatial priors (world meters, +Y up):\n{}\n", body.join("\n"))
}

/// Checks whether `raw` is a permitted `data:image/(png|jpeg|jpg|webp);base64,...` or `https:` / loopback `http:` URL.
pub fn is_allowed_image_url(raw: &str) -> bool {
    let s = raw.trim();
    if s.is_empty() {
        return false;
    }
    for prefix in [
        "data:image/png;base64,",
        "data:image/jpeg;base64,",
        "data:image/jpg;base64,",
        "data:image/webp;base64,",
    ] {
        if s.get(..prefix.len()).map(|p| p.eq_ignore_ascii_case(prefix)).unwrap_or(false) {
            let payload = &s[prefix.len()..];
            return !payload.trim().is_empty()
                && payload.bytes().all(|b| {
                    b.is_ascii_alphanumeric()
                        || b == b'+'
                        || b == b'/'
                        || b == b'='
                        || b.is_ascii_whitespace()
                });
        }
    }
    if s.bytes().any(|b| b <= 0x20 || b == 0x7f) {
        return false;
    }
    if s.get(..8).map(|p| p.eq_ignore_ascii_case("https://")).unwrap_or(false) {
        let rest = &s[8..];
        let host = rest.split(&['/', '?', '#'][..]).next().unwrap_or("");
        return !host.is_empty();
    }
    if s.get(..7).map(|p| p.eq_ignore_ascii_case("http://")).unwrap_or(false) {
        let rest = &s[7..];
        let authority = rest.split(&['/', '?', '#'][..]).next().unwrap_or("");
        let host = if authority.starts_with('[') {
            authority.split(']').next().map(|h| format!("{}]", h)).unwrap_or_default()
        } else {
            authority.split(':').next().unwrap_or("").to_ascii_lowercase()
        };
        return matches!(host.as_str(), "localhost" | "127.0.0.1" | "[::1]");
    }
    false
}

/// Builds the user text prompt for [`build_image_messages`].
pub fn build_image_user_text(prompt: &str, priors: Option<&Value>) -> String {
    let mut out =
        "Reconstruct the 3D scene shown in this reference image as a complete Three-Live script.\n"
            .to_string();
    out.push_str(&format_spatial_priors(priors));
    let clean_prompt: String = prompt.trim().chars().take(MAX_IMAGE_PROMPT_CHARS).collect();
    if !clean_prompt.is_empty() {
        out.push_str(&format!("Additional instructions: {}\n", clean_prompt));
    }
    out.push_str("Return only the complete script in a single ```js code block.");
    out
}

/// Builds the multimodal Chat Completions messages for converting `image_url` into a Three-Live script.
pub fn build_image_messages(
    image_url: &str,
    prompt: &str,
    priors: Option<&Value>,
) -> Result<Value, String> {
    let url = image_url.trim();
    if !is_allowed_image_url(url) {
        return Err(
            "compileFromImage: imageUrl must be a base64 data:image/(png|jpeg|webp) URI or an https:// URL."
                .to_string(),
        );
    }
    let user_text = build_image_user_text(prompt, priors);
    Ok(json!([
        {"role": "system", "content": IMAGE_SYSTEM_PROMPT},
        {
            "role": "user",
            "content": [
                {"type": "image_url", "image_url": {"url": url}},
                {"type": "text", "text": user_text},
            ],
        },
    ]))
}

/// Builds the follow-up repair message when a candidate script fails compilation or produces
/// repairable compiler/spatial warnings (mirrors `imageRepairMessage` in `ai-image.ts`).
pub fn image_repair_message(error: Option<&str>, warnings: &[String]) -> String {
    let err_text = error.unwrap_or("").trim();
    let warn_list: Vec<String> = warnings
        .iter()
        .map(|w| w.trim().to_string())
        .filter(|w| !w.is_empty())
        .take(MAX_WARNINGS)
        .collect();
    if !err_text.is_empty() {
        let mut msg = format!("That script was rejected by the Three-Live sandbox: {}\n", err_text);
        if !warn_list.is_empty() {
            msg.push_str("Additional diagnostics:\n");
            for w in &warn_list {
                msg.push_str(&format!("- {}\n", w));
            }
        }
        msg.push_str("Return the complete corrected script in a single ```js code block.");
        return msg;
    }
    if !warn_list.is_empty() {
        let mut msg = "The script compiled, but the Three-Live linter reported warnings that should be fixed:\n"
            .to_string();
        for w in &warn_list {
            msg.push_str(&format!("- {}\n", w));
        }
        msg.push_str(
            "Fix every warning above (assign unique `.name` values before attaching `userData.xr`, use only canonical `userData.xr` traits, replace unsupported classes with supported Three-Live primitives, and frame `camera.position` and `camera.lookAt` so all meshes are inside the frustum) while keeping the full scene intact.\n\
             Return the complete corrected script in a single ```js code block.",
        );
        return msg;
    }
    "Return the complete corrected script in a single ```js code block.".to_string()
}

/// Compiles `code` with the warm sandboxed engine and runs the spatial linter (`TL100-TL402`).
/// Returns `ok = true` when the script compiles and contains at least one mesh, along with any
/// repairable warnings (`TL102`, `TL2xx`, `TL3xx`, `TL4xx`).
pub fn validate_image_scene(code: &str) -> ImageSceneValidation {
    let fail = |error: String| ImageSceneValidation {
        ok: false,
        error: Some(error),
        warnings: Vec::new(),
        mesh_names: Vec::new(),
        mesh_count: 0,
    };
    if code.trim().is_empty() {
        return fail("The model reply did not contain a scene script.".to_string());
    }
    if code.len() > MAX_SCRIPT_BYTES {
        return fail("The generated script exceeds the 1 MB script limit.".to_string());
    }
    let mut scene = match crate::validate_three_script(code) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    crate::push_texture_quota_diagnostic(&mut scene);
    let names: Vec<String> = if scene.nodes.is_empty() {
        scene.meshes.iter().map(|m| m.name.clone()).filter(|n| !n.is_empty()).collect()
    } else {
        scene.nodes.iter().map(|n| n.name.clone()).filter(|n| !n.is_empty()).collect()
    };
    let mesh_count = if scene.nodes.is_empty() {
        scene.meshes.len()
    } else {
        scene.nodes.iter().filter(|n| n.mesh.is_some()).count()
    };
    if mesh_count == 0 {
        return fail("The generated scene contains no meshes.".to_string());
    }
    let report =
        build_validation_report("image-scene.js", 0.0, Some(&scene), scene.diagnostics.clone());
    if let Some(err_diag) = report.diagnostics.iter().find(|d| d.severity == "error") {
        return fail(format!("[{}] {}", err_diag.code, err_diag.message));
    }
    let warnings: Vec<String> = report
        .diagnostics
        .iter()
        .filter(|d| d.severity == "warning")
        .take(MAX_WARNINGS)
        .map(|d| {
            if d.code.is_empty() || d.message.starts_with('[') {
                d.message.clone()
            } else {
                format!("[{}] {}", d.code, d.message)
            }
        })
        .collect();
    ImageSceneValidation { ok: true, error: None, warnings, mesh_names: names, mesh_count }
}

/// `ai_call` handler for `{"op": "image_messages", "imageUrl": "...", "prompt"?: "...", "priors"?: {...}}`.
pub fn image_messages_call(req: &Value) -> Value {
    let image_url = req.get("imageUrl").and_then(Value::as_str).unwrap_or("");
    let prompt = req.get("prompt").and_then(Value::as_str).unwrap_or("");
    let priors = req.get("priors");
    match build_image_messages(image_url, prompt, priors) {
        Ok(messages) => json!({ "messages": messages }),
        Err(e) => json!({ "error": e }),
    }
}

/// `ai_call` handler for `{"op": "image_validate", "code": "..."}`.
pub fn image_validate_call(req: &Value) -> Value {
    let code = req.get("code").and_then(Value::as_str).unwrap_or("");
    let v = validate_image_scene(code);
    serde_json::to_value(v).unwrap_or_else(|e| json!({"error": e.to_string()}))
}

/// `ai_call` handler for `{"op": "image_repair", "error"?: "...", "warnings"?: [...]}`.
pub fn image_repair_call(req: &Value) -> Value {
    let error = req.get("error").and_then(Value::as_str);
    let warnings: Vec<String> = req
        .get("warnings")
        .and_then(Value::as_array)
        .map(|arr| arr.iter().filter_map(Value::as_str).map(String::from).collect())
        .unwrap_or_default();
    json!({ "message": image_repair_message(error, &warnings) })
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn image_prompt_matches_the_web_plugin() {
        let ts = include_str!("../../three-live/src/plugins/ai-image.ts");
        for line in IMAGE_SYSTEM_PROMPT.lines() {
            let escaped = line.replace('\'', "\\'");
            assert!(ts.contains(&escaped), "ai-image.ts IMAGE_SYSTEM_PROMPT is missing: {}", line);
        }
    }

    #[test]
    fn shared_fixture_cases_match() {
        let raw = include_str!("../../three-live/tests/fixtures/image_cases.json");
        let fixture: Value = serde_json::from_str(raw).expect("valid image_cases.json");

        for case in fixture["priors"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let got = format_spatial_priors(case.get("priors"));
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(got, expected, "priors case failed: {}", name);
        }

        for case in fixture["messages"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let image_url = case["imageUrl"].as_str().unwrap();
            let prompt = case["prompt"].as_str().unwrap_or("");
            let priors = case.get("priors");
            let msgs = build_image_messages(image_url, prompt, priors).expect(name);
            assert_eq!(msgs[0]["role"], "system", "{}", name);
            assert_eq!(msgs[0]["content"], IMAGE_SYSTEM_PROMPT, "{}", name);
            let content = msgs[1]["content"].as_array().unwrap();
            assert_eq!(content[0]["type"], "image_url", "{}", name);
            assert_eq!(content[0]["image_url"]["url"], image_url, "{}", name);
            assert_eq!(content[1]["type"], "text", "{}", name);
            assert_eq!(
                content[1]["text"].as_str().unwrap(),
                case["expectedUserText"].as_str().unwrap(),
                "messages case failed: {}",
                name
            );
        }

        for case in fixture["repairs"].as_array().unwrap() {
            let name = case["name"].as_str().unwrap();
            let error = case["error"].as_str();
            let warnings: Vec<String> = case["warnings"]
                .as_array()
                .unwrap()
                .iter()
                .map(|v| v.as_str().unwrap().to_string())
                .collect();
            let got = image_repair_message(error, &warnings);
            let expected = case["expected"].as_str().unwrap();
            assert_eq!(got, expected, "repairs case failed: {}", name);
        }
    }

    #[test]
    fn url_validation_and_bounds() {
        assert!(is_allowed_image_url("data:image/png;base64,iVBORw0KGgo="));
        assert!(is_allowed_image_url("data:image/jpeg;base64,/9j/4AAQ"));
        assert!(is_allowed_image_url("data:image/webp;base64,UklGRg=="));
        assert!(is_allowed_image_url("https://example.com/photo.jpg"));
        assert!(is_allowed_image_url("http://localhost:8080/photo.jpg"));
        assert!(is_allowed_image_url("http://127.0.0.1:11434/img.png"));
        assert!(is_allowed_image_url("http://[::1]:8000/img.png"));
        assert!(!is_allowed_image_url(""));
        assert!(!is_allowed_image_url("http://example.com/photo.jpg"));
        assert!(!is_allowed_image_url("javascript:alert(1)"));
        assert!(!is_allowed_image_url("data:text/html;base64,PHNjcmlwdD4="));
        assert!(!is_allowed_image_url("data:image/png;base64,not valid base64!!!"));
    }

    #[test]
    fn validate_image_scene_reports_compile_errors_and_spatial_warnings() {
        let clean = "\
            const light = new THREE.AmbientLight(0xffffff, 0.8);\n\
            scene.add(light);\n\
            const dir = new THREE.DirectionalLight(0xffffff, 1.0);\n\
            dir.position.set(2, 4, 3);\n\
            scene.add(dir);\n\
            const table = new THREE.Mesh(new THREE.BoxGeometry(1, 0.8, 1), new THREE.MeshStandardMaterial({ color: 0x8b5a2b }));\n\
            table.name = 'Table';\n\
            table.position.set(0, 0.4, 0);\n\
            scene.add(table);\n\
            camera.position.set(0, 1.2, 3);\n\
            camera.lookAt(0, 0.4, 0);\n";
        let res = validate_image_scene(clean);
        assert!(res.ok, "{:?}", res.error);
        assert!(res.warnings.is_empty(), "expected 0 warnings, got: {:?}", res.warnings);
        assert_eq!(res.mesh_count, 1);
        assert_eq!(res.mesh_names, vec!["Table".to_string()]);

        // Missing lights + offscreen camera triggers spatial linter warnings while still ok=true.
        let warn_scene = "\
            const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());\n\
            box.position.set(0, 0.5, 50);\n\
            scene.add(box);\n\
            camera.position.set(0, 1, 3);\n\
            camera.lookAt(0, 0.5, 0);\n";
        let wres = validate_image_scene(warn_scene);
        assert!(wres.ok);
        assert!(!wres.warnings.is_empty(), "expected spatial warnings for unlit/offscreen scene");

        // Empty or broken scenes fail with ok=false.
        assert!(!validate_image_scene("").ok);
        assert!(!validate_image_scene("const g = new THREE.Group(); scene.add(g);").ok);
        assert!(!validate_image_scene("scene.add(new THREE.Mesh(").ok);
    }
}
