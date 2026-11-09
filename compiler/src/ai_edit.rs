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

//! Shared AI scene-editing core for Android and iOS (roadmap B2b-2/3).
//!
//! The web `three-live-ai` plugin (`three-live/src/plugins/ai.ts`) and the native editors
//! (`ThreeLiveAIEditor` on Android, `AIEditor` on iOS) must behave the same way: the same prompt,
//! the same reply parsing, and the same rules for rejecting an edit. Mobile apps get that logic
//! from here through one JSON call ([`ai_call`]), exposed as `three_live_ai_call` (C) and
//! `ThreeCompiler.nativeAiCall` (JNI). The voice protocols live in [`crate::ai_voice`].
//!
//! Requests are `{"op": "...", ...}`; responses are JSON objects, with `{"error": "..."}` for
//! malformed requests.

use serde_json::{json, Value};

/// System prompt for the code model (keep in sync with `SYSTEM_PROMPT` in `ai.ts`; a test checks).
pub const SYSTEM_PROMPT: &str = "You edit Three.js scene scripts for Three-Live, which compiles them to glTF for Web, Android, and iOS.\n\
Reply with the COMPLETE updated script in a single ```js code block and nothing else.\n\
Rules:\n\
- Use the pre-defined globals `THREE`, `scene`, and `camera`. No imports, renderer, loaders, DOM, network, or timers.\n\
- Change only what the instruction asks; keep every other object, name, and value as it is.\n\
- Give new meshes and groups descriptive `.name` values; keep existing names stable.\n\
- Keep objects resting on y = 0 and within view of the camera.\n\
- Supported: core geometries and materials (MeshStandardMaterial / MeshPhysicalMaterial with PBR maps), lights,\n\
  Group, InstancedMesh, THREE.CSG, THREE.CanvasTexture, THREE.ProceduralTexture presets\n\
  (wood, marble, brick, concrete, brushedMetal, rust, leather, fabric, carbonFiber, checkerboard, grid),\n\
  and declarative mesh.userData.xr traits. Optional per-frame motion: function animate(t) { ... }.";

/// Largest script accepted from a model (matches `SECURITY_3D_MAX_SCRIPT_BYTES`).
pub const MAX_SCRIPT_BYTES: usize = 1_048_576;
/// Longest instruction forwarded.
pub const MAX_INSTRUCTION_CHARS: usize = 2000;
const MAX_SELECTION_CHARS: usize = 200;
const MAX_WARNINGS: usize = 20;

fn truncate_chars(s: &str, max: usize) -> String {
    s.chars().take(max).collect()
}

/// Builds the chat messages for one edit (same wording as the web plugin).
pub fn build_messages(source: &str, selection: Option<&str>, instruction: &str) -> Value {
    let instruction = truncate_chars(instruction.trim(), MAX_INSTRUCTION_CHARS);
    let mut user = format!("Current scene script:\n```js\n{}\n```\n", source);
    if let Some(sel) = selection.filter(|s| !s.is_empty()) {
        user.push_str(&format!(
            "The user selected the mesh named \"{}\"; the instruction refers to it.\n",
            truncate_chars(sel, MAX_SELECTION_CHARS)
        ));
    }
    user.push_str(&format!("Instruction: {}", instruction));
    json!([
        {"role": "system", "content": SYSTEM_PROMPT},
        {"role": "user", "content": user},
    ])
}

/// The follow-up turn asking the model to fix a rejected script.
pub fn repair_message(error: &str) -> String {
    format!(
        "That script was rejected by the Three-Live sandbox: {}\nReturn the complete corrected script in a single ```js code block.",
        error
    )
}

/// Extracts the script from a model reply: the first `js`/`ts` fenced block, else the first
/// fenced block, else an unterminated fence, else the raw reply when it mentions `scene`.
pub fn extract_script(reply: &str) -> String {
    let mut first: Option<String> = None;
    let mut rest = reply;
    while let Some(start) = rest.find("```") {
        let after = &rest[start + 3..];
        let Some(nl) = after.find('\n') else { break };
        let info = after[..nl].trim();
        let lang: String = info
            .chars()
            .take_while(|c| c.is_ascii_alphanumeric() || *c == '_' || *c == '+' || *c == '-')
            .collect::<String>()
            .to_ascii_lowercase();
        let body_start = &after[nl + 1..];
        let Some(end) = body_start.find("```") else {
            // Unterminated fence (truncated reply): take everything after it.
            if first.is_none() {
                return body_start.trim().to_string();
            }
            break;
        };
        let body = &body_start[..end];
        if matches!(lang.as_str(), "js" | "javascript" | "ts" | "typescript" | "mjs") {
            return body.trim().to_string();
        }
        if first.is_none() {
            first = Some(body.trim().to_string());
        }
        rest = &body_start[end + 3..];
    }
    if let Some(f) = first {
        return f;
    }
    let has_scene_word = reply
        .split(|c: char| !(c.is_ascii_alphanumeric() || c == '_' || c == '$'))
        .any(|w| w == "scene");
    if has_scene_word {
        reply.trim().to_string()
    } else {
        String::new()
    }
}

fn mentions_removal(instruction: &str) -> bool {
    instruction
        .to_lowercase()
        .split(|c: char| !c.is_alphanumeric())
        .any(|w| matches!(w, "remove" | "delete" | "rename"))
}

/// Result of [`validate_edit`].
#[derive(Debug, Clone, PartialEq)]
pub struct EditValidation {
    pub ok: bool,
    pub error: Option<String>,
    pub warnings: Vec<String>,
    pub mesh_names: Vec<String>,
    pub mesh_count: usize,
}

/// Compiles `code` with the warm sandboxed engine and applies the web plugin's acceptance
/// rules: the script must compile, contain at least one mesh, and keep the selected mesh
/// (unless the instruction removes or renames something).
pub fn validate_edit(code: &str, selection: Option<&str>, instruction: &str) -> EditValidation {
    let fail = |error: String| EditValidation {
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
    let scene = match crate::validate_three_script(code) {
        Ok(s) => s,
        Err(e) => return fail(e),
    };
    let warnings: Vec<String> = scene
        .diagnostics
        .iter()
        .filter(|d| d.severity == "warning")
        .take(MAX_WARNINGS)
        .map(|d| d.message.clone())
        .collect();
    let names: Vec<String> = if scene.nodes.is_empty() {
        scene.meshes.iter().map(|m| m.name.clone()).collect()
    } else {
        scene.nodes.iter().map(|n| n.name.clone()).collect()
    };
    let mesh_count = if scene.nodes.is_empty() {
        scene.meshes.len()
    } else {
        scene.nodes.iter().filter(|n| n.mesh.is_some()).count()
    };
    let error = if mesh_count == 0 {
        Some("The edited scene contains no meshes.".to_string())
    } else if let Some(sel) = selection.filter(|s| !s.is_empty()) {
        if !names.iter().any(|n| n == sel) && !mentions_removal(instruction) {
            Some(format!("The edited scene no longer contains the selected mesh \"{}\".", sel))
        } else {
            None
        }
    } else {
        None
    };
    EditValidation { ok: error.is_none(), error, warnings, mesh_names: names, mesh_count }
}

/// Short spoken summary of an edit result (matches `describeEditResult` on the web).
pub fn describe_result(applied: bool, error: Option<&str>) -> String {
    if applied {
        return "Done.".to_string();
    }
    let reason: String =
        error.unwrap_or("the edit was rejected").split_whitespace().collect::<Vec<_>>().join(" ");
    format!("Sorry, I couldn't apply that: {}", truncate_chars(&reason, 160))
}

fn str_arg<'a>(req: &'a Value, key: &str) -> Option<&'a str> {
    req.get(key).and_then(Value::as_str)
}

/// One JSON request → one JSON response; the single entry point mobile apps call.
///
/// Ops: `messages`, `repair`, `extract`, `validate`, `describe`, plus the voice ops handled by
/// [`crate::ai_voice::voice_call`] (`voice_setup`, `voice_parse`, `voice_audio`, `voice_text`,
/// `voice_tool_result`, `voice_tools`).
pub fn ai_call(request: &str) -> String {
    let req: Value = match serde_json::from_str(request) {
        Ok(v) => v,
        Err(e) => return json!({"error": format!("invalid request JSON: {}", e)}).to_string(),
    };
    let op = str_arg(&req, "op").unwrap_or("");
    let out = match op {
        "messages" => json!({
            "messages": build_messages(
                str_arg(&req, "source").unwrap_or(""),
                str_arg(&req, "selection"),
                str_arg(&req, "instruction").unwrap_or(""),
            )
        }),
        "repair" => json!({"message": repair_message(str_arg(&req, "error").unwrap_or(""))}),
        "extract" => json!({"code": extract_script(str_arg(&req, "reply").unwrap_or(""))}),
        "validate" => {
            let v = validate_edit(
                str_arg(&req, "code").unwrap_or(""),
                str_arg(&req, "selection"),
                str_arg(&req, "instruction").unwrap_or(""),
            );
            let mut out = json!({
                "ok": v.ok,
                "warnings": v.warnings,
                "meshNames": v.mesh_names,
                "meshCount": v.mesh_count,
            });
            if let Some(e) = v.error {
                out["error"] = json!(e);
            }
            out
        }
        "describe" => json!({
            "text": describe_result(
                req.get("applied").and_then(Value::as_bool).unwrap_or(false),
                str_arg(&req, "error"),
            )
        }),
        _ if op.starts_with("voice_") => crate::ai_voice::voice_call(op, &req),
        _ => json!({"error": format!("unknown op '{}'", op)}),
    };
    out.to_string()
}

#[cfg(test)]
mod tests {
    use super::*;

    const BASE: &str = "const roof = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 2), new THREE.MeshStandardMaterial());\nroof.name = 'Roof';\nroof.position.y = 2;\nscene.add(roof);";

    #[test]
    fn prompt_matches_the_web_plugin() {
        let ts = include_str!("../../three-live/src/plugins/ai.ts");
        for line in SYSTEM_PROMPT.lines() {
            let escaped = line.replace('\'', "\\'");
            assert!(ts.contains(&escaped), "ai.ts SYSTEM_PROMPT is missing: {}", line);
        }
    }

    #[test]
    fn messages_include_source_selection_and_instruction() {
        let m = build_messages(BASE, Some("Roof"), "  make it red  ");
        assert_eq!(m[0]["role"], "system");
        let user = m[1]["content"].as_str().unwrap();
        assert!(user.contains("```js\nconst roof"));
        assert!(user.contains("The user selected the mesh named \"Roof\""));
        assert!(user.ends_with("Instruction: make it red"));
        let no_sel = build_messages(BASE, Some(""), "x");
        assert!(!no_sel[1]["content"].as_str().unwrap().contains("selected"));
        let long = build_messages(BASE, None, &"a".repeat(5000));
        assert!(long[1]["content"].as_str().unwrap().len() < BASE.len() + 2100);
    }

    #[test]
    fn extract_script_handles_fences_and_fallbacks() {
        assert_eq!(extract_script("Here:\n```js\nscene.add(a);\n```\nDone."), "scene.add(a);");
        assert_eq!(
            extract_script("```text\nnotes\n```\n```javascript\nscene.add(b);\n```"),
            "scene.add(b);"
        );
        assert_eq!(extract_script("```\nscene.add(c);\n```"), "scene.add(c);");
        assert_eq!(
            extract_script("```js\nscene.add(d);\n// truncated"),
            "scene.add(d);\n// truncated"
        );
        assert_eq!(extract_script("scene.add(e);"), "scene.add(e);");
        assert_eq!(extract_script("I can't do that."), "");
        assert_eq!(extract_script("scenery only"), "");
    }

    #[test]
    fn validate_accepts_good_edits_and_rejects_bad_ones() {
        let red =
            BASE.replace("MeshStandardMaterial()", "MeshStandardMaterial({ color: 0xff0000 })");
        let ok = validate_edit(&red, Some("Roof"), "make it red");
        assert!(ok.ok, "{:?}", ok.error);
        assert_eq!(ok.mesh_count, 1);
        assert!(ok.mesh_names.contains(&"Roof".to_string()));

        let broken = validate_edit("scene.add(new THREE.Mesh(", None, "x");
        assert!(!broken.ok && broken.error.unwrap().to_lowercase().contains("syntax"));

        let empty = validate_edit("const g = new THREE.Group(); scene.add(g);", None, "x");
        assert_eq!(empty.error.as_deref(), Some("The edited scene contains no meshes."));

        let renamed = BASE.replace("'Roof'", "'Top'");
        let lost = validate_edit(&renamed, Some("Roof"), "make it red");
        assert!(lost.error.unwrap().contains("no longer contains the selected mesh \"Roof\""));
        assert!(validate_edit(&renamed, Some("Roof"), "Rename the roof to Top").ok);

        assert!(!validate_edit("", None, "x").ok);
        assert!(validate_edit(&"x".repeat(MAX_SCRIPT_BYTES + 1), None, "x")
            .error
            .unwrap()
            .contains("1 MB"));
    }

    #[test]
    fn describe_is_short() {
        assert_eq!(describe_result(true, None), "Done.");
        let long = describe_result(false, Some(&"bad\n".repeat(200)));
        assert!(long.starts_with("Sorry, I couldn't apply that: bad bad"));
        assert!(long.chars().count() < 200);
    }

    #[test]
    fn ai_call_dispatches_ops() {
        let r: Value = serde_json::from_str(&ai_call(
            &json!({"op": "messages", "source": BASE, "selection": "Roof", "instruction": "red"})
                .to_string(),
        ))
        .unwrap();
        assert_eq!(r["messages"].as_array().unwrap().len(), 2);
        let r: Value = serde_json::from_str(&ai_call(
            &json!({"op": "extract", "reply": "```js\nscene.add(x)\n```"}).to_string(),
        ))
        .unwrap();
        assert_eq!(r["code"], "scene.add(x)");
        let r: Value = serde_json::from_str(&ai_call(
            &json!({"op": "validate", "code": BASE, "selection": "Roof", "instruction": "x"})
                .to_string(),
        ))
        .unwrap();
        assert_eq!(r["ok"], true);
        assert!(r.get("error").is_none());
        let r: Value =
            serde_json::from_str(&ai_call(&json!({"op": "repair", "error": "E"}).to_string()))
                .unwrap();
        assert!(r["message"].as_str().unwrap().starts_with("That script was rejected"));
        assert!(ai_call("{").contains("invalid request JSON"));
        assert!(ai_call("{\"op\":\"nope\"}").contains("unknown op"));
    }
}
