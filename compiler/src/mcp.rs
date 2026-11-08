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

//! Model Context Protocol (MCP) stdio server (`three-live-cli mcp`).
//!
//! Exposes Three-Live's headless compiler, 3D spatial linter (`TL100`–`TL402`),
//! pure-Rust 4-up PBR contact-sheet rasterizer, and 60 Hz simulation engine over
//! JSON-RPC 2.0 (`stdin`/`stdout`) for AI coding agents (Claude Code, Cursor,
//! Gemini CLI, Windsurf, Zed, Cline, and MCP Inspector).

use crate::glb::read_glb;
use crate::render::{
    encode_gif_frames, encode_png_rgba, render_scene_rgba, render_viewport_rgba,
    stitch_filmstrip_horizontal, RenderOptions, RenderViewMode,
};
use crate::scene::{CameraConfig, Diagnostic, SceneGraph};
use crate::sim::{
    evaluate_temporal_keyframes, simulate_scenario_from_source, SimAction, SIM_DT_SEC,
};
use crate::spatial_lint::{
    build_validation_report, compute_node_world_aabbs, compute_node_world_matrices, WorldAABB,
};
use crate::time::Stopwatch;
use crate::{
    extract_and_lint_html, is_html_source, transcode_glb_to_usdz, transcode_three_to_glb,
    transcode_three_to_usdz, validate_scene_source,
};
use serde_json::{json, Map, Value};
use std::fs;
use std::io::{self, BufRead, BufReader, Write};
use std::path::Path;

/// Default MCP protocol version advertised by the server when the client does not specify one.
pub const DEFAULT_MCP_PROTOCOL_VERSION: &str = "2024-11-05";

/// Supported MCP protocol versions.
const SUPPORTED_PROTOCOL_VERSIONS: &[&str] = &["2025-06-18", "2025-03-26", "2024-11-05"];

const BASE64_ALPHABET: &[u8; 64] =
    b"ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";

/// Encodes binary bytes as standard RFC 4648 Base64.
pub fn encode_base64(input: &[u8]) -> String {
    if input.is_empty() {
        return String::new();
    }
    let mut out = Vec::with_capacity(input.len().div_ceil(3) * 4);
    let mut chunks = input.chunks_exact(3);
    for chunk in &mut chunks {
        let b0 = chunk[0] as usize;
        let b1 = chunk[1] as usize;
        let b2 = chunk[2] as usize;
        out.push(BASE64_ALPHABET[b0 >> 2]);
        out.push(BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]);
        out.push(BASE64_ALPHABET[((b1 & 0x0f) << 2) | (b2 >> 6)]);
        out.push(BASE64_ALPHABET[b2 & 0x3f]);
    }
    let rem = chunks.remainder();
    if rem.len() == 1 {
        let b0 = rem[0] as usize;
        out.push(BASE64_ALPHABET[b0 >> 2]);
        out.push(BASE64_ALPHABET[(b0 & 0x03) << 4]);
        out.push(b'=');
        out.push(b'=');
    } else if rem.len() == 2 {
        let b0 = rem[0] as usize;
        let b1 = rem[1] as usize;
        out.push(BASE64_ALPHABET[b0 >> 2]);
        out.push(BASE64_ALPHABET[((b0 & 0x03) << 4) | (b1 >> 4)]);
        out.push(BASE64_ALPHABET[(b1 & 0x0f) << 2]);
        out.push(b'=');
    }
    String::from_utf8(out).unwrap_or_default()
}

const AUTHORING_GUIDE_RESOURCE_URI: &str = "three-live://docs/authoring-guide";

const AUTHORING_GUIDE_MARKDOWN: &str = r#"# Three-Live Authoring Guide for AI Coding Agents

- **Execution Model**: `THREE` and `scene` (`THREE.Scene`) are pre-defined globals in a sandboxed VM. Build your scene and attach root objects with `scene.add(...)`.
- **Target Parity**: The exact same Three.js script compiles on-device to native **Android (Google Filament & Jetpack XR SceneCore)**, **iOS & visionOS (Apple RealityKit & Quick Look `.usdz`)**, **headless CLI/MCP (`three-live-cli`)**, and **Web (`<three-live>` / `<xr-live>`)**.
- **Allowed Three.js Primitives**:
  - Geometries: `BoxGeometry`, `SphereGeometry`, `CylinderGeometry`, `ConeGeometry`, `PlaneGeometry`, `TorusGeometry`, `TorusKnotGeometry`, `CapsuleGeometry`, `CircleGeometry`, `RingGeometry`, `IcosahedronGeometry`, `OctahedronGeometry`, `TetrahedronGeometry`, `DodecahedronGeometry`, `LatheGeometry`, `TubeGeometry`, `ExtrudeGeometry`, `ShapeGeometry`, `TextGeometry`, `BufferGeometry`.
  - CAD & CSG: `THREE.Shape`, `THREE.Path`, `THREE.CSG.union(a, b)`, `THREE.CSG.subtract(a, b)`, `THREE.CSG.intersect(a, b)`.
  - Materials: `MeshStandardMaterial`, `MeshPhysicalMaterial` (`clearcoat`, `transmission`, `ior`, `thickness`, `sheen`, `iridescence`, `anisotropy`), `MeshBasicMaterial`, `MeshLambertMaterial`, `MeshPhongMaterial`.
  - Scene & Instancing: `Group`, `Object3D`, `Mesh`, `InstancedMesh`, `LOD`, `Box3`, `Sphere`, `DirectionalLight`, `PointLight`, `SpotLight`, `AmbientLight`, `HemisphereLight`, `DataTexture`, `CanvasTexture` (`document.createElement("canvas").getContext("2d")`).
- **Spatial Traits (`mesh.userData.xr`)**:
  - Manipulation & Follow: `grab` (`"1-hand"` | `"2-hand"`), `scale` (`{ min, max }`), `billboard` (`"y"` | `"full"` | `"capsule"`), `follow` (`{ distance, speed }`), `orbit` (`{ radius, speed, axis }`), `handles` (`true`).
  - CAD & World: `dimensions` (`{ unit: "mm"|"cm"|"m"|"in" }`), `explode` (`{ layer, direction }`), `snapTo` (`{ grid, angle, socket }`), `gaze` (`{ action: "select"|"ask", dwellMs }`), `anchor` (`{ plane: "horizontal"|"vertical", persist: true }`).
  - 60 Hz Simulation (`xr-live-sim`): `rigidBody` (`{ type: "dynamic"|"static"|"kinematic", collider: "box"|"sphere"|"cylinder", mass, restitution, friction }`), `character`, `agent` (`{ behavior: "patrol"|"chase"|"flee"|"wander", speed, waypoints }`), `integrity`, `zone`, `spawner`, `objective`, `audioEmitter`, `audioCues`.
- **Verification Loop**:
  1. Call `three_live_validate` to check for compiler errors (`TL1xx`), schema warnings (`TL2xx`), and spatial/frustum/grounding diagnostics (`TL301`–`TL308`).
  2. Call `three_live_render` (`view: "quad"`, `grid: true`, `annotations: true`) to inspect the 4-up orthographic/camera contact sheet (`CAMERA`, `FRONT +Z`, `TOP +Y FRUSTUM`, `ISO 45°`).
  3. Call `three_live_sim` to verify interactive `KHR_interactivity` and 60 Hz physics trajectories.
"#;

/// Wire framing detected from the incoming MCP stream.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum WireFraming {
    /// Standard MCP newline-delimited JSON (`\n`).
    NewlineDelimited,
    /// Content-Length HTTP-style header framing (`Content-Length: <N>\r\n\r\n<payload>`).
    ContentLength,
}

/// Runs the MCP server over process `stdin` and `stdout`.
pub fn run_mcp_stdio_server() -> Result<(), String> {
    let stdin = io::stdin();
    let stdout = io::stdout();
    let mut reader = BufReader::new(stdin.lock());
    let mut writer = stdout.lock();
    run_mcp_io(&mut reader, &mut writer)
}

/// Runs the MCP request loop over any buffered reader and writer (used by both stdio and tests).
pub fn run_mcp_io<R: BufRead, W: Write>(reader: &mut R, writer: &mut W) -> Result<(), String> {
    while let Some((framing, raw_json)) = read_next_mcp_message(reader)? {
        let trimmed = raw_json.trim();
        if trimmed.is_empty() {
            continue;
        }
        let parsed: Value = match serde_json::from_str(trimmed) {
            Ok(v) => v,
            Err(err) => {
                let err_resp = jsonrpc_error_response(
                    Value::Null,
                    -32700,
                    format!("Parse error: {}", err),
                    None,
                );
                write_mcp_message(writer, framing, &err_resp)?;
                continue;
            }
        };

        if let Some(arr) = parsed.as_array() {
            let mut batch_responses = Vec::new();
            for item in arr {
                if let Some(resp) = handle_mcp_request(item) {
                    batch_responses.push(resp);
                }
            }
            if !batch_responses.is_empty() {
                write_mcp_message(writer, framing, &Value::Array(batch_responses))?;
            }
        } else if let Some(resp) = handle_mcp_request(&parsed) {
            write_mcp_message(writer, framing, &resp)?;
        }
    }
    Ok(())
}

fn read_next_mcp_message<R: BufRead>(
    reader: &mut R,
) -> Result<Option<(WireFraming, String)>, String> {
    let mut line = String::new();
    loop {
        line.clear();
        let bytes_read =
            reader.read_line(&mut line).map_err(|e| format!("Failed reading stdin: {}", e))?;
        if bytes_read == 0 {
            return Ok(None);
        }
        let trimmed = line.trim();
        if trimmed.is_empty() {
            continue;
        }
        if trimmed.to_ascii_lowercase().starts_with("content-length:") {
            let mut content_length: Option<usize> = parse_content_length_header(trimmed);
            // Consume remaining headers until blank line.
            loop {
                let mut hdr = String::new();
                let n = reader
                    .read_line(&mut hdr)
                    .map_err(|e| format!("Failed reading MCP header line: {}", e))?;
                if n == 0 {
                    return Ok(None);
                }
                let h_trim = hdr.trim();
                if h_trim.is_empty() {
                    break;
                }
                if content_length.is_none() {
                    content_length = parse_content_length_header(h_trim);
                }
            }
            let len =
                content_length.ok_or_else(|| "Missing valid Content-Length header".to_string())?;
            if len > 32 * 1024 * 1024 {
                return Err(format!(
                    "MCP message Content-Length ({} bytes) exceeds 32 MB ceiling",
                    len
                ));
            }
            let mut buf = vec![0u8; len];
            reader
                .read_exact(&mut buf)
                .map_err(|e| format!("Failed reading MCP message body of {} bytes: {}", len, e))?;
            let body = String::from_utf8(buf)
                .map_err(|e| format!("MCP message body is not valid UTF-8: {}", e))?;
            return Ok(Some((WireFraming::ContentLength, body)));
        }
        return Ok(Some((WireFraming::NewlineDelimited, trimmed.to_string())));
    }
}

fn parse_content_length_header(line: &str) -> Option<usize> {
    let (name, val) = line.split_once(':')?;
    if name.trim().eq_ignore_ascii_case("content-length") {
        val.trim().parse::<usize>().ok()
    } else {
        None
    }
}

fn write_mcp_message<W: Write>(
    writer: &mut W,
    framing: WireFraming,
    msg: &Value,
) -> Result<(), String> {
    let serialized = serde_json::to_string(msg)
        .map_err(|e| format!("Failed serializing MCP response: {}", e))?;
    match framing {
        WireFraming::NewlineDelimited => {
            writer
                .write_all(serialized.as_bytes())
                .and_then(|_| writer.write_all(b"\n"))
                .and_then(|_| writer.flush())
                .map_err(|e| format!("Failed writing MCP newline response: {}", e))?;
        }
        WireFraming::ContentLength => {
            let header = format!("Content-Length: {}\r\n\r\n", serialized.len());
            writer
                .write_all(header.as_bytes())
                .and_then(|_| writer.write_all(serialized.as_bytes()))
                .and_then(|_| writer.flush())
                .map_err(|e| format!("Failed writing MCP Content-Length response: {}", e))?;
        }
    }
    Ok(())
}

fn jsonrpc_success_response(id: Value, result: Value) -> Value {
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "result": result,
    })
}

fn jsonrpc_error_response(id: Value, code: i64, message: String, data: Option<Value>) -> Value {
    let mut err_obj = Map::new();
    err_obj.insert("code".to_string(), json!(code));
    err_obj.insert("message".to_string(), json!(message));
    if let Some(d) = data {
        err_obj.insert("data".to_string(), d);
    }
    json!({
        "jsonrpc": "2.0",
        "id": id,
        "error": Value::Object(err_obj),
    })
}

/// Processes a single JSON-RPC 2.0 request or notification and returns `Some(response)` for
/// requests or `None` for notifications.
pub fn handle_mcp_request(req: &Value) -> Option<Value> {
    let Some(obj) = req.as_object() else {
        return Some(jsonrpc_error_response(
            Value::Null,
            -32600,
            "Invalid Request: expected JSON object".to_string(),
            None,
        ));
    };

    let id_opt = obj.get("id").cloned();
    let Some(method) = obj.get("method").and_then(Value::as_str) else {
        // If there is an id, report invalid request; otherwise ignore malformed notification.
        return id_opt.map(|id| {
            jsonrpc_error_response(
                id,
                -32600,
                "Invalid Request: missing string 'method'".to_string(),
                None,
            )
        });
    };

    // Notifications do not have an `id` field and must not produce a response.
    let Some(id) = id_opt else {
        return None;
    };

    let params = obj.get("params").cloned().unwrap_or_else(|| json!({}));

    match method {
        "initialize" => {
            let requested_version = params
                .get("protocolVersion")
                .and_then(Value::as_str)
                .unwrap_or(DEFAULT_MCP_PROTOCOL_VERSION);
            let negotiated_version = if SUPPORTED_PROTOCOL_VERSIONS.contains(&requested_version) {
                requested_version
            } else {
                DEFAULT_MCP_PROTOCOL_VERSION
            };
            Some(jsonrpc_success_response(
                id,
                json!({
                    "protocolVersion": negotiated_version,
                    "capabilities": {
                        "tools": {
                            "listChanged": false
                        },
                        "resources": {
                            "subscribe": false,
                            "listChanged": false
                        },
                        "prompts": {
                            "listChanged": false
                        }
                    },
                    "serverInfo": {
                        "name": "three-live-mcp",
                        "version": env!("CARGO_PKG_VERSION"),
                    },
                    "instructions": "Three-Live 3D, CAD & Spatial XR compiler, headless 4-up contact sheet renderer, spatial linter (TL100-TL402), and 60 Hz simulation engine. Use three_live_validate and three_live_render to verify Three.js scenes visually and spatially, three_live_convert to export .glb or Apple .usdz, three_live_sim to step KHR_interactivity and 60 Hz physics, and three_live_link to give the user a playground link (or QR code) that opens the scene on any phone or desktop browser."
                }),
            ))
        }
        "ping" => Some(jsonrpc_success_response(id, json!({}))),
        "tools/list" => Some(jsonrpc_success_response(
            id,
            json!({
                "tools": mcp_tool_definitions()
            }),
        )),
        "tools/call" => Some(handle_tools_call(id, &params)),
        "resources/list" => Some(jsonrpc_success_response(
            id,
            json!({
                "resources": [
                    {
                        "uri": AUTHORING_GUIDE_RESOURCE_URI,
                        "name": "Three-Live & XR-Live Authoring Guide",
                        "description": "Concise Three.js primitives allowlist, userData.xr spatial traits, CAD/CSG helpers, and visual verification workflow.",
                        "mimeType": "text/markdown"
                    }
                ]
            }),
        )),
        "resources/templates/list" => Some(jsonrpc_success_response(
            id,
            json!({
                "resourceTemplates": []
            }),
        )),
        "resources/read" => {
            let uri = params.get("uri").and_then(Value::as_str).unwrap_or("");
            if uri == AUTHORING_GUIDE_RESOURCE_URI {
                Some(jsonrpc_success_response(
                    id,
                    json!({
                        "contents": [
                            {
                                "uri": AUTHORING_GUIDE_RESOURCE_URI,
                                "mimeType": "text/markdown",
                                "text": AUTHORING_GUIDE_MARKDOWN
                            }
                        ]
                    }),
                ))
            } else {
                Some(jsonrpc_error_response(
                    id,
                    -32602,
                    format!("Unknown resource URI: {}", uri),
                    None,
                ))
            }
        }
        "prompts/list" => Some(jsonrpc_success_response(
            id,
            json!({
                "prompts": [
                    {
                        "name": "author_three_live_scene",
                        "description": "Author and visually verify a cross-platform Three.js 3D, CAD, or Spatial XR scene for Android (Filament/SceneCore), iOS/visionOS (RealityKit), and Web.",
                        "arguments": [
                            {
                                "name": "description",
                                "description": "What 3D model, CAD part, or spatial XR scene to build.",
                                "required": true
                            },
                            {
                                "name": "target",
                                "description": "Primary target platform (android, ios, web, or xr).",
                                "required": false
                            }
                        ]
                    }
                ]
            }),
        )),
        "prompts/get" => {
            let name = params.get("name").and_then(Value::as_str).unwrap_or("");
            if name == "author_three_live_scene" {
                let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));
                let desc = args
                    .get("description")
                    .and_then(Value::as_str)
                    .unwrap_or("an interactive 3D scene");
                let target =
                    args.get("target").and_then(Value::as_str).unwrap_or("android, ios, and web");
                let prompt_text = format!(
                    "Create a Three-Live scene for `{}` targeting `{}`.\n\n\
                     Follow this verification workflow:\n\
                     1. Write standard Three.js code adding named meshes to the pre-defined `scene` global.\n\
                     2. Run `three_live_validate` on your code and resolve any `TL1xx`–`TL3xx` diagnostics (such as off-screen meshes, AABB collisions, or missing lighting).\n\
                     3. Run `three_live_render` with `view: \"quad\"`, `grid: true`, and `annotations: true` to inspect the 4-up orthographic/camera contact sheet.\n\
                     4. If interactive traits or physics are used, run `three_live_sim` to verify the 60 Hz trajectory.\n\n\
                     Reference Rules:\n{}",
                    desc, target, AUTHORING_GUIDE_MARKDOWN
                );
                Some(jsonrpc_success_response(
                    id,
                    json!({
                        "description": "Three-Live scene authoring & visual verification prompt",
                        "messages": [
                            {
                                "role": "user",
                                "content": {
                                    "type": "text",
                                    "text": prompt_text
                                }
                            }
                        ]
                    }),
                ))
            } else {
                Some(jsonrpc_error_response(
                    id,
                    -32602,
                    format!("Unknown prompt name: {}", name),
                    None,
                ))
            }
        }
        _ => {
            Some(jsonrpc_error_response(id, -32601, format!("Method not found: {}", method), None))
        }
    }
}

fn mcp_tool_definitions() -> Value {
    json!([
        {
            "name": "three_live_validate",
            "description": "Validate a Three.js script (.js), HTML document (<three-live>/<xr-live>), or .glb binary and run the 3D spatial, camera frustum, grounding, AABB collision, and lighting linter (TL100-TL402).",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Inline Three.js scene script (using pre-defined `THREE` and `scene` globals) or HTML document. Provide either `code` or `inputPath`."
                    },
                    "inputPath": {
                        "type": "string",
                        "description": "Path to a .js, .html, or .glb file on disk when `code` is not provided."
                    },
                    "cameraPosition": {
                        "type": "array",
                        "items": { "type": "number" },
                        "minItems": 3,
                        "maxItems": 3,
                        "description": "Optional camera eye position override [x, y, z] in meters for frustum and visibility checks."
                    },
                    "cameraTarget": {
                        "type": "array",
                        "items": { "type": "number" },
                        "minItems": 3,
                        "maxItems": 3,
                        "description": "Optional camera look-at target override [x, y, z] in meters."
                    },
                    "cameraFov": {
                        "type": "number",
                        "description": "Optional vertical field of view in degrees (default 45)."
                    }
                }
            },
            "annotations": {
                "title": "Validate Three.js Scene & Spatial Layout",
                "readOnlyHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "three_live_render",
            "description": "Render a Three.js script, HTML document, or .glb headlessly (zero GPU required) into a 4-up orthographic/camera contact sheet PNG (CAMERA, FRONT +Z, TOP +Y FRUSTUM, ISO 45 deg), single viewport PNG, or temporal filmstrip / 360-degree turntable GIF. Returns the base64 image directly to vision-capable agents along with spatial diagnostics.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Inline Three.js scene script or HTML document. Provide either `code` or `inputPath`."
                    },
                    "inputPath": {
                        "type": "string",
                        "description": "Path to a .js, .html, or .glb file on disk when `code` is not provided."
                    },
                    "view": {
                        "type": "string",
                        "enum": ["quad", "camera", "front", "top", "right", "iso"],
                        "default": "quad",
                        "description": "Viewport mode: `quad` (default 4-up contact sheet) or single view (`camera`, `front`, `top`, `right`, `iso`)."
                    },
                    "grid": {
                        "type": "boolean",
                        "default": true,
                        "description": "Draw 1.0m / 0.25m reference ground grid and X/Y/Z origin axes."
                    },
                    "annotations": {
                        "type": "boolean",
                        "default": true,
                        "description": "Draw 3D AABB wireframes and 2D node name callouts."
                    },
                    "width": {
                        "type": "integer",
                        "minimum": 64,
                        "maximum": 2048,
                        "description": "Output image width in pixels (defaults to 1024 for `quad`, 512 for single view)."
                    },
                    "height": {
                        "type": "integer",
                        "minimum": 64,
                        "maximum": 2048,
                        "description": "Output image height in pixels (defaults to 1024 for `quad`, 512 for single view)."
                    },
                    "turntable": {
                        "type": "boolean",
                        "default": false,
                        "description": "Render a 360-degree turntable orbit across multiple frames."
                    },
                    "frames": {
                        "type": "integer",
                        "minimum": 1,
                        "maximum": 60,
                        "description": "Number of frames for temporal filmstrip or turntable capture."
                    },
                    "duration": {
                        "type": "number",
                        "default": 2.0,
                        "description": "Duration in seconds for multi-frame temporal capture."
                    },
                    "triggerSelect": {
                        "type": "string",
                        "description": "Optional interactive node name to trigger `onSelect` at t = 0."
                    },
                    "outputPath": {
                        "type": "string",
                        "description": "Optional file path (.png or .gif) to also save the rendered image on disk."
                    }
                }
            },
            "annotations": {
                "title": "Render Headless 3D Contact Sheet",
                "readOnlyHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "three_live_convert",
            "description": "Compile a Three.js script, HTML document, or .glb into a binary glTF 2.0 (.glb) or Apple 64-byte-aligned Universal Scene Description (.usdz) asset for Android (Filament / Jetpack XR SceneCore), iOS/visionOS (RealityKit / Quick Look), and Web.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Inline Three.js scene script or HTML document. Provide either `code` or `inputPath`."
                    },
                    "inputPath": {
                        "type": "string",
                        "description": "Path to an input .js, .html, or .glb file on disk."
                    },
                    "outputPath": {
                        "type": "string",
                        "description": "Optional destination path to write the compiled .glb or .usdz binary on disk."
                    },
                    "format": {
                        "type": "string",
                        "enum": ["glb", "usdz"],
                        "description": "Target container format (`glb` or `usdz`). Inferred from `outputPath` extension when omitted (defaults to `glb`)."
                    }
                }
            },
            "annotations": {
                "title": "Compile Three.js to GLB or USDZ",
                "readOnlyHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "three_live_sim",
            "description": "Simulate interactive KHR_interactivity behavior graphs, orbit/explode traits, and 60 Hz xr-live-sim rigid-body physics, character controllers, steering agents, hit zones, and objectives deterministically at 60 Hz.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Inline Three.js scene script or HTML document. Provide either `code` or `inputPath`."
                    },
                    "inputPath": {
                        "type": "string",
                        "description": "Path to a .js, .html, or .glb file on disk when `code` is not provided."
                    },
                    "duration": {
                        "type": "number",
                        "default": 2.0,
                        "description": "Simulation duration in seconds (default 2.0s, max 60.0s)."
                    },
                    "actions": {
                        "type": "array",
                        "description": "Optional timed interaction events (e.g. `[{\"at\": 0.2, \"type\": \"select\", \"target\": \"crystal\"}]`).",
                        "items": {
                            "type": "object",
                            "properties": {
                                "at": { "type": "number", "description": "Timestamp in seconds (>= 0)." },
                                "type": {
                                    "type": "string",
                                    "enum": ["select", "explode", "moveCharacter", "sendEvent", "damage", "heal"]
                                },
                                "target": { "type": "string", "description": "Target node name." },
                                "factor": { "type": "number", "description": "Explosion factor (0.0..1.0) for `explode`." },
                                "direction": {
                                    "type": "array",
                                    "items": { "type": "number" },
                                    "minItems": 3,
                                    "maxItems": 3
                                },
                                "duration": { "type": "number" },
                                "jump": { "type": "boolean" },
                                "eventId": { "type": "string" },
                                "amount": { "type": "number" }
                            },
                            "required": ["type"]
                        }
                    },
                    "snapshotFrames": {
                        "type": "array",
                        "items": { "type": "integer" },
                        "description": "Optional 60 Hz tick indices (e.g. [0, 30, 60, 120]) to render into a horizontal filmstrip."
                    },
                    "includeFilmstrip": {
                        "type": "boolean",
                        "default": false,
                        "description": "When true, renders a keyframe filmstrip PNG and includes it as an image content block."
                    },
                    "outputStripPath": {
                        "type": "string",
                        "description": "Optional file path (.png or .gif) to write the rendered keyframe strip on disk."
                    }
                }
            },
            "annotations": {
                "title": "Run 60 Hz Spatial & Physics Simulation",
                "readOnlyHint": false,
                "idempotentHint": true,
                "openWorldHint": false
            }
        },
        {
            "name": "three_live_link",
            "description": "Validate a Three.js scene script and return a web playground link that opens it on any desktop or phone browser (with View in AR on iPhone and Android). The scene rides in the URL fragment (raw DEFLATE + base64url), so nothing is uploaded. Optionally returns the link as a QR code (terminal text and SVG) for the user to scan with a phone. Fails, listing the errors, when the scene does not compile.",
            "inputSchema": {
                "type": "object",
                "properties": {
                    "code": {
                        "type": "string",
                        "description": "Inline Three.js scene script (using pre-defined `THREE` and `scene` globals). Provide either `code` or `inputPath`."
                    },
                    "inputPath": {
                        "type": "string",
                        "description": "Path to a .js scene script on disk when `code` is not provided."
                    },
                    "qr": {
                        "type": "boolean",
                        "default": false,
                        "description": "Also return the link as a QR code (`qrText` for terminals, `qrSvg`) when it is short enough to scan."
                    },
                    "base": {
                        "type": "string",
                        "description": "Playground page the link opens (default https://google.github.io/three-live/three/)."
                    }
                }
            },
            "annotations": {
                "title": "Share Three.js Scene as a Playground Link",
                "readOnlyHint": true,
                "idempotentHint": true,
                "openWorldHint": false
            }
        }
    ])
}

struct LoadedSource {
    raw_bytes: Vec<u8>,
    filename: String,
    is_glb: bool,
}

fn load_source_from_args(args: &Value, default_name: &str) -> Result<LoadedSource, String> {
    let inline_code = args
        .get("code")
        .or_else(|| args.get("source"))
        .or_else(|| args.get("script"))
        .and_then(Value::as_str);
    if let Some(code) = inline_code {
        let filename = args
            .get("inputPath")
            .or_else(|| args.get("path"))
            .and_then(Value::as_str)
            .unwrap_or(default_name)
            .to_string();
        let raw_bytes = code.as_bytes().to_vec();
        let is_glb = raw_bytes.len() >= 4 && &raw_bytes[0..4] == b"glTF";
        return Ok(LoadedSource { raw_bytes, filename, is_glb });
    }
    let path_arg = args.get("inputPath").or_else(|| args.get("path")).and_then(Value::as_str);
    if let Some(path_str) = path_arg {
        let raw_bytes = fs::read(path_str)
            .map_err(|e| format!("Failed reading inputPath {:?}: {}", path_str, e))?;
        let is_glb = raw_bytes.len() >= 4 && &raw_bytes[0..4] == b"glTF";
        return Ok(LoadedSource { raw_bytes, filename: path_str.to_string(), is_glb });
    }
    Err("Either `code` (string) or `inputPath` (file path) must be provided.".to_string())
}

fn parse_vec3_opt(val: Option<&Value>) -> Option<[f32; 3]> {
    let arr = val?.as_array()?;
    if arr.len() != 3 {
        return None;
    }
    let x = arr[0].as_f64()? as f32;
    let y = arr[1].as_f64()? as f32;
    let z = arr[2].as_f64()? as f32;
    if x.is_finite() && y.is_finite() && z.is_finite() {
        Some([x, y, z])
    } else {
        None
    }
}

fn apply_camera_overrides(scene: &mut SceneGraph, args: &Value) {
    let pos_override = parse_vec3_opt(args.get("cameraPosition"));
    let target_override = parse_vec3_opt(args.get("cameraTarget"));
    let fov_override =
        args.get("cameraFov").and_then(Value::as_f64).map(|v| (v as f32).clamp(10.0, 150.0));

    if pos_override.is_none() && target_override.is_none() && fov_override.is_none() {
        return;
    }
    let existing = scene.camera.clone().unwrap_or(CameraConfig {
        fov: 45.0,
        position: [0.0, 1.4, 3.2],
        target: [0.0, 0.5, 0.0],
    });
    scene.camera = Some(CameraConfig {
        fov: fov_override.unwrap_or(existing.fov),
        position: pos_override.unwrap_or(existing.position),
        target: target_override.unwrap_or(existing.target),
    });
}

fn decode_scene_with_diags(src: &LoadedSource) -> (Option<SceneGraph>, Vec<Diagnostic>) {
    if src.is_glb {
        match read_glb(&src.raw_bytes) {
            Ok(scene) => (Some(scene), Vec::new()),
            Err(e) => (
                None,
                vec![Diagnostic {
                    code: "TL100".to_string(),
                    severity: "error".to_string(),
                    message: e,
                    ..Default::default()
                }],
            ),
        }
    } else {
        match String::from_utf8(src.raw_bytes.clone()) {
            Ok(source_str) => validate_scene_source(&source_str, &src.filename),
            Err(_) => (
                None,
                vec![Diagnostic {
                    code: "TL100".to_string(),
                    severity: "error".to_string(),
                    message: "Input source is not valid UTF-8".to_string(),
                    ..Default::default()
                }],
            ),
        }
    }
}

fn tool_error_result(message: String) -> Value {
    json!({
        "content": [
            {
                "type": "text",
                "text": message
            }
        ],
        "isError": true
    })
}

fn handle_tools_call(id: Value, params: &Value) -> Value {
    let Some(tool_name) = params.get("name").and_then(Value::as_str) else {
        return jsonrpc_error_response(
            id,
            -32602,
            "Invalid params: missing string `name` in tools/call".to_string(),
            None,
        );
    };
    let args = params.get("arguments").cloned().unwrap_or_else(|| json!({}));

    let result = match tool_name {
        "three_live_validate" => call_tool_validate(&args),
        "three_live_render" => call_tool_render(&args),
        "three_live_convert" => call_tool_convert(&args),
        "three_live_sim" => call_tool_sim(&args),
        "three_live_link" => call_tool_link(&args),
        _ => {
            return jsonrpc_error_response(
                id,
                -32602,
                format!("Unknown tool name: {}", tool_name),
                None,
            );
        }
    };

    jsonrpc_success_response(id, result)
}

fn call_tool_link(args: &Value) -> Value {
    let src = match load_source_from_args(args, "inline.js") {
        Ok(s) => s,
        Err(e) => return tool_error_result(e),
    };
    if src.is_glb {
        return tool_error_result(
            "three_live_link takes a Three.js scene script, not a GLB.".to_string(),
        );
    }
    let Ok(script) = String::from_utf8(src.raw_bytes) else {
        return tool_error_result("Input source is not valid UTF-8".to_string());
    };
    let base = args
        .get("base")
        .and_then(Value::as_str)
        .unwrap_or(crate::scene_link::DEFAULT_PLAYGROUND_URL);
    match crate::scene_link::build_scene_link(&script, &src.filename, base) {
        Ok(link) => {
            let mut value = link.to_json();
            if args.get("qr").and_then(Value::as_bool).unwrap_or(false) {
                if let Some(code) = link.qr.as_ref() {
                    value["qrText"] = json!(code.to_terminal_string(2));
                    value["qrSvg"] = json!(code.to_svg(4));
                }
            }
            let text = serde_json::to_string_pretty(&value).unwrap_or_else(|_| "{}".to_string());
            json!({
                "content": [
                    {
                        "type": "text",
                        "text": text
                    }
                ],
                "isError": false
            })
        }
        Err(e) => tool_error_result(e),
    }
}

fn call_tool_validate(args: &Value) -> Value {
    let src = match load_source_from_args(args, "inline.js") {
        Ok(s) => s,
        Err(e) => return tool_error_result(e),
    };
    let sw = Stopwatch::start();
    let (mut scene_opt, base_diags) = decode_scene_with_diags(&src);
    if let Some(ref mut scene) = scene_opt {
        apply_camera_overrides(scene, args);
    }
    let elapsed_ms = (sw.elapsed_ms() * 10.0).round() / 10.0;
    let report = build_validation_report(&src.filename, elapsed_ms, scene_opt.as_ref(), base_diags);
    let json_text = serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string());
    json!({
        "content": [
            {
                "type": "text",
                "text": json_text
            }
        ],
        "isError": !report.valid
    })
}

fn parse_render_view_mode(view_str: Option<&str>) -> RenderViewMode {
    match view_str.unwrap_or("quad").to_ascii_lowercase().as_str() {
        "camera" => RenderViewMode::Camera,
        "front" => RenderViewMode::Front,
        "top" => RenderViewMode::Top,
        "right" => RenderViewMode::Right,
        "iso" => RenderViewMode::Iso,
        _ => RenderViewMode::Quad,
    }
}

fn call_tool_render(args: &Value) -> Value {
    let src = match load_source_from_args(args, "inline.js") {
        Ok(s) => s,
        Err(e) => return tool_error_result(e),
    };
    let sw = Stopwatch::start();
    let (mut scene_opt, base_diags) = decode_scene_with_diags(&src);
    if let Some(ref mut scene) = scene_opt {
        apply_camera_overrides(scene, args);
    }
    let elapsed_ms = (sw.elapsed_ms() * 10.0).round() / 10.0;
    let validation =
        build_validation_report(&src.filename, elapsed_ms, scene_opt.as_ref(), base_diags);
    let Some(scene) = scene_opt else {
        let diag_json =
            serde_json::to_string_pretty(&validation).unwrap_or_else(|_| "{}".to_string());
        return tool_error_result(format!("Scene failed to compile for rendering:\n{}", diag_json));
    };

    let render_view = parse_render_view_mode(args.get("view").and_then(Value::as_str));
    let default_dim = if render_view == RenderViewMode::Quad { 1024 } else { 512 };
    let w = args
        .get("width")
        .and_then(Value::as_u64)
        .map(|v| v as u32)
        .unwrap_or(default_dim)
        .clamp(64, 2048);
    let h = args
        .get("height")
        .and_then(Value::as_u64)
        .map(|v| v as u32)
        .unwrap_or(default_dim)
        .clamp(64, 2048);
    let grid = args.get("grid").and_then(Value::as_bool).unwrap_or(true);
    let annotations = args.get("annotations").and_then(Value::as_bool).unwrap_or(true);
    let turntable = args.get("turntable").and_then(Value::as_bool).unwrap_or(false);
    let duration = args.get("duration").and_then(Value::as_f64).unwrap_or(2.0).clamp(0.1, 60.0);
    let trigger_select = args.get("triggerSelect").and_then(Value::as_str).map(str::to_string);
    let out_path_opt = args.get("outputPath").and_then(Value::as_str).map(str::to_string);

    let is_gif = out_path_opt
        .as_deref()
        .and_then(|p| Path::new(p).extension())
        .and_then(|e| e.to_str())
        .map(|e| e.eq_ignore_ascii_case("gif"))
        .unwrap_or(turntable);

    let frame_count = args
        .get("frames")
        .and_then(Value::as_u64)
        .map(|v| v as usize)
        .unwrap_or(if turntable || is_gif {
            12
        } else if trigger_select.is_some() {
            8
        } else {
            1
        })
        .clamp(1, 60);

    let (img_bytes, mime_type, final_w, final_h) = if turntable
        || frame_count > 1
        || trigger_select.is_some()
    {
        let world_matrices = compute_node_world_matrices(&scene);
        let node_aabbs = compute_node_world_aabbs(&scene, &world_matrices);
        let mut bounds = WorldAABB::empty();
        for aabb in node_aabbs.iter().flatten() {
            bounds.union(aabb);
        }
        if !bounds.is_valid() {
            bounds.min = [-1.0, 0.0, -1.0];
            bounds.max = [1.0, 1.5, 1.0];
        }
        let center = bounds.center();
        let radius = (bounds.diagonal() * 1.35).max(2.5);
        let mut captured = Vec::with_capacity(frame_count);
        let frame_view =
            if render_view == RenderViewMode::Quad { RenderViewMode::Camera } else { render_view };

        let temporal_keyframes = if !turntable {
            evaluate_temporal_keyframes(
                &src.raw_bytes,
                src.is_glb,
                frame_count,
                duration,
                trigger_select.as_deref(),
            )
            .ok()
        } else {
            None
        };

        for k in 0..frame_count {
            let (t_sec, mut frame_scene) = if let Some(ref kf) = temporal_keyframes {
                kf.get(k).cloned().unwrap_or((0.0, scene.clone()))
            } else {
                let t = if frame_count > 1 {
                    (k as f64) * duration / ((frame_count - 1) as f64)
                } else {
                    0.0
                };
                (t, scene.clone())
            };
            if turntable {
                let angle = (k as f32) * std::f32::consts::TAU / (frame_count as f32);
                frame_scene.camera = Some(CameraConfig {
                    fov: 40.0,
                    position: [
                        center[0] + radius * angle.sin(),
                        center[1] + radius * 0.45,
                        center[2] + radius * angle.cos(),
                    ],
                    target: center,
                });
            }
            let label = if turntable {
                format!("TURNTABLE {:03} DEG", ((k * 360) / frame_count.max(1)))
            } else {
                format!("T={:.2}S", t_sec)
            };
            let rgba = render_viewport_rgba(
                &frame_scene,
                w,
                h,
                frame_view,
                grid,
                annotations,
                Some(&label),
            );
            captured.push(rgba);
        }

        if is_gif {
            let delay_cs = ((duration * 100.0 / (frame_count as f64)).round() as u16).max(4);
            match encode_gif_frames(w, h, &captured, delay_cs) {
                Ok(bytes) => (bytes, "image/gif", w, h),
                Err(e) => return tool_error_result(format!("GIF encoding error: {}", e)),
            }
        } else {
            let (sw_px, sh_px, strip) = stitch_filmstrip_horizontal(w, h, &captured);
            match encode_png_rgba(sw_px, sh_px, &strip) {
                Ok(bytes) => (bytes, "image/png", sw_px, sh_px),
                Err(e) => return tool_error_result(format!("PNG encoding error: {}", e)),
            }
        }
    } else {
        let opts = RenderOptions {
            width: w,
            height: h,
            view: render_view,
            show_grid: grid,
            show_annotations: annotations,
            label_override: None,
        };
        let (out_w, out_h, rgba) = render_scene_rgba(&scene, &opts);
        match encode_png_rgba(out_w, out_h, &rgba) {
            Ok(bytes) => (bytes, "image/png", out_w, out_h),
            Err(e) => return tool_error_result(format!("PNG encoding error: {}", e)),
        }
    };

    if let Some(ref out_path) = out_path_opt {
        if let Err(e) = fs::write(out_path, &img_bytes) {
            return tool_error_result(format!("Failed writing outputPath {:?}: {}", out_path, e));
        }
    }

    let b64 = encode_base64(&img_bytes);
    let meta = json!({
        "valid": validation.valid,
        "width": final_w,
        "height": final_h,
        "frames": frame_count,
        "mimeType": mime_type,
        "byteLength": img_bytes.len(),
        "outputPath": out_path_opt,
        "summary": validation.summary,
        "diagnostics": validation.diagnostics,
    });

    json!({
        "content": [
            {
                "type": "image",
                "data": b64,
                "mimeType": mime_type
            },
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&meta).unwrap_or_else(|_| "{}".to_string())
            }
        ],
        "isError": false
    })
}

fn call_tool_convert(args: &Value) -> Value {
    let src = match load_source_from_args(args, "inline.js") {
        Ok(s) => s,
        Err(e) => return tool_error_result(e),
    };
    let out_path_opt = args.get("outputPath").and_then(Value::as_str).map(str::to_string);
    let format_str = args
        .get("format")
        .and_then(Value::as_str)
        .map(|s| s.to_ascii_lowercase())
        .or_else(|| {
            out_path_opt
                .as_deref()
                .and_then(|p| Path::new(p).extension())
                .and_then(|e| e.to_str())
                .map(|e| e.to_ascii_lowercase())
        })
        .unwrap_or_else(|| if src.is_glb { "usdz".to_string() } else { "glb".to_string() });

    let target_usdz = format_str == "usdz";
    let sw = Stopwatch::start();

    let (compiled_bytes, validation) = if src.is_glb {
        let (scene_opt, base_diags) = decode_scene_with_diags(&src);
        let bytes = if target_usdz {
            match transcode_glb_to_usdz(&src.raw_bytes) {
                Ok(b) => b,
                Err(e) => return tool_error_result(format!("GLB to USDZ error: {}", e)),
            }
        } else {
            src.raw_bytes.clone()
        };
        let elapsed_ms = (sw.elapsed_ms() * 10.0).round() / 10.0;
        let report =
            build_validation_report(&src.filename, elapsed_ms, scene_opt.as_ref(), base_diags);
        (bytes, report)
    } else {
        let raw_source = match String::from_utf8(src.raw_bytes.clone()) {
            Ok(s) => s,
            Err(_) => return tool_error_result("Input script is not valid UTF-8".to_string()),
        };
        let script = if is_html_source(&raw_source, &src.filename) {
            let (scripts, _) = extract_and_lint_html(&raw_source);
            scripts.join("\n;\n")
        } else {
            raw_source.clone()
        };
        let bytes = if target_usdz {
            match transcode_three_to_usdz(&script) {
                Ok(b) => b,
                Err(e) => return tool_error_result(format!("Three.js to USDZ error: {}", e)),
            }
        } else {
            match transcode_three_to_glb(&script) {
                Ok(b) => b,
                Err(e) => return tool_error_result(format!("Three.js to GLB error: {}", e)),
            }
        };
        let (scene_opt, base_diags) = validate_scene_source(&raw_source, &src.filename);
        let elapsed_ms = (sw.elapsed_ms() * 10.0).round() / 10.0;
        let report =
            build_validation_report(&src.filename, elapsed_ms, scene_opt.as_ref(), base_diags);
        (bytes, report)
    };

    if let Some(ref out_path) = out_path_opt {
        if let Err(e) = fs::write(out_path, &compiled_bytes) {
            return tool_error_result(format!("Failed writing outputPath {:?}: {}", out_path, e));
        }
    }

    let result_json = json!({
        "format": if target_usdz { "usdz" } else { "glb" },
        "outputPath": out_path_opt,
        "byteLength": compiled_bytes.len(),
        "valid": validation.valid,
        "summary": validation.summary,
        "diagnostics": validation.diagnostics,
    });

    json!({
        "content": [
            {
                "type": "text",
                "text": serde_json::to_string_pretty(&result_json).unwrap_or_else(|_| "{}".to_string())
            }
        ],
        "isError": false
    })
}

fn call_tool_sim(args: &Value) -> Value {
    let src = match load_source_from_args(args, "inline.js") {
        Ok(s) => s,
        Err(e) => return tool_error_result(e),
    };
    let duration = args.get("duration").and_then(Value::as_f64).unwrap_or(2.0).clamp(0.0, 60.0);
    let parsed_actions: Vec<SimAction> = match args.get("actions") {
        Some(v) if v.is_array() => match serde_json::from_value(v.clone()) {
            Ok(a) => a,
            Err(e) => return tool_error_result(format!("Invalid `actions` array: {}", e)),
        },
        Some(v) if v.is_string() => match serde_json::from_str(v.as_str().unwrap_or("[]")) {
            Ok(a) => a,
            Err(e) => return tool_error_result(format!("Invalid `actions` JSON string: {}", e)),
        },
        _ => Vec::new(),
    };

    let include_filmstrip = args.get("includeFilmstrip").and_then(Value::as_bool).unwrap_or(false);
    let output_strip_opt = args.get("outputStripPath").and_then(Value::as_str).map(str::to_string);

    let total_ticks = ((duration / SIM_DT_SEC).round() as usize).max(1);
    let mut snap_ticks: Vec<usize> =
        if let Some(arr) = args.get("snapshotFrames").and_then(Value::as_array) {
            arr.iter().filter_map(Value::as_u64).map(|v| v as usize).collect()
        } else if include_filmstrip || output_strip_opt.is_some() {
            vec![0, total_ticks / 3, (total_ticks * 2) / 3, total_ticks]
        } else {
            Vec::new()
        };
    snap_ticks.sort_unstable();
    snap_ticks.dedup();

    let (report, snapshots) = match simulate_scenario_from_source(
        &src.raw_bytes,
        src.is_glb,
        duration,
        &parsed_actions,
        &snap_ticks,
    ) {
        Ok(r) => r,
        Err(e) => return tool_error_result(format!("Simulation error: {}", e)),
    };

    let mut content_blocks = Vec::new();
    if !snapshots.is_empty()
        && (include_filmstrip || output_strip_opt.is_some() || args.get("snapshotFrames").is_some())
    {
        let fw = 320u32;
        let fh = 320u32;
        let captured: Vec<Vec<u8>> = snapshots
            .iter()
            .map(|(t_sec, snap_scene)| {
                let label = format!("T={:.2}S", t_sec);
                render_viewport_rgba(
                    snap_scene,
                    fw,
                    fh,
                    RenderViewMode::Camera,
                    true,
                    true,
                    Some(&label),
                )
            })
            .collect();
        let is_gif = output_strip_opt
            .as_deref()
            .and_then(|p| Path::new(p).extension())
            .and_then(|e| e.to_str())
            .map(|e| e.eq_ignore_ascii_case("gif"))
            .unwrap_or(false);
        let (img_bytes, mime_type) = if is_gif {
            (encode_gif_frames(fw, fh, &captured, 20).unwrap_or_default(), "image/gif")
        } else {
            let (sw, sh, strip) = stitch_filmstrip_horizontal(fw, fh, &captured);
            (encode_png_rgba(sw, sh, &strip).unwrap_or_default(), "image/png")
        };
        if let Some(ref strip_path) = output_strip_opt {
            if let Err(e) = fs::write(strip_path, &img_bytes) {
                return tool_error_result(format!(
                    "Failed writing outputStripPath {:?}: {}",
                    strip_path, e
                ));
            }
        }
        if !img_bytes.is_empty() {
            content_blocks.push(json!({
                "type": "image",
                "data": encode_base64(&img_bytes),
                "mimeType": mime_type
            }));
        }
    }

    content_blocks.push(json!({
        "type": "text",
        "text": serde_json::to_string_pretty(&report).unwrap_or_else(|_| "{}".to_string())
    }));

    json!({
        "content": content_blocks,
        "isError": false
    })
}

#[cfg(test)]
mod tests {
    use super::*;
    use std::io::Cursor;

    #[test]
    fn test_encode_base64_rfc4648_vectors() {
        assert_eq!(encode_base64(b""), "");
        assert_eq!(encode_base64(b"f"), "Zg==");
        assert_eq!(encode_base64(b"fo"), "Zm8=");
        assert_eq!(encode_base64(b"foo"), "Zm9v");
        assert_eq!(encode_base64(b"foob"), "Zm9vYg==");
        assert_eq!(encode_base64(b"fooba"), "Zm9vYmE=");
        assert_eq!(encode_base64(b"foobar"), "Zm9vYmFy");
    }

    #[test]
    fn test_mcp_initialize_and_notifications() {
        let init_req = json!({
            "jsonrpc": "2.0",
            "id": 1,
            "method": "initialize",
            "params": {
                "protocolVersion": "2024-11-05",
                "capabilities": {},
                "clientInfo": { "name": "claude-code", "version": "1.0.0" }
            }
        });
        let resp = handle_mcp_request(&init_req).expect("initialize must return a response");
        assert_eq!(resp["id"], 1);
        assert_eq!(resp["result"]["protocolVersion"], "2024-11-05");
        assert_eq!(resp["result"]["serverInfo"]["name"], "three-live-mcp");
        assert!(resp["result"]["capabilities"]["tools"].is_object());

        // Notifications must return None.
        let notif = json!({
            "jsonrpc": "2.0",
            "method": "notifications/initialized"
        });
        assert!(handle_mcp_request(&notif).is_none());
    }

    #[test]
    fn test_mcp_tools_list_exposes_all_five_tools() {
        let req = json!({
            "jsonrpc": "2.0",
            "id": 2,
            "method": "tools/list"
        });
        let resp = handle_mcp_request(&req).unwrap();
        let tools = resp["result"]["tools"].as_array().unwrap();
        let names: Vec<&str> = tools.iter().filter_map(|t| t["name"].as_str()).collect();
        assert_eq!(
            names,
            vec![
                "three_live_validate",
                "three_live_render",
                "three_live_convert",
                "three_live_sim",
                "three_live_link"
            ]
        );
    }

    #[test]
    fn test_mcp_link_tool_returns_a_playground_link_and_refuses_broken_scenes() {
        let code = "const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());\nm.name = 'box';\nscene.add(m);\n";
        let req = json!({
            "jsonrpc": "2.0",
            "id": 9,
            "method": "tools/call",
            "params": { "name": "three_live_link", "arguments": { "code": code, "qr": true } }
        });
        let resp = handle_mcp_request(&req).unwrap();
        let result = &resp["result"];
        assert_eq!(result["isError"], json!(false), "{result}");
        let report: Value =
            serde_json::from_str(result["content"][0]["text"].as_str().unwrap()).unwrap();
        let url = report["url"].as_str().unwrap();
        assert!(url.starts_with("https://google.github.io/three-live/three/#s=z:"), "{url}");
        assert_eq!(report["fitsQr"], json!(true));
        assert!(report["qrSvg"].as_str().unwrap().starts_with("<svg"));
        assert!(report["qrText"].as_str().unwrap().contains('\u{2588}'));

        let broken = json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": { "name": "three_live_link", "arguments": { "code": "scene.add(new THREE.Mesh(" } }
        });
        let resp = handle_mcp_request(&broken).unwrap();
        assert_eq!(resp["result"]["isError"], json!(true));
    }

    #[test]
    fn test_mcp_validate_render_convert_and_sim_tools() {
        let code = r#"
            const floor = new THREE.Mesh(
                new THREE.BoxGeometry(4, 0.1, 4),
                new THREE.MeshStandardMaterial({ color: 0x334155 })
            );
            floor.name = 'Floor';
            floor.position.set(0, -0.05, 0);
            floor.userData.xr = { rigidBody: { type: 'static', collider: 'box' } };
            scene.add(floor);

            const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.35, 16, 12),
                new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.6, roughness: 0.2 })
            );
            sphere.name = 'HeroOrb';
            sphere.position.set(0, 0.8, 0);
            sphere.userData.xr = {
                grab: '1-hand',
                rigidBody: { type: 'dynamic', collider: 'sphere', restitution: 0.7 }
            };
            scene.add(sphere);

            const sun = new THREE.DirectionalLight(0xffffff, 1.5);
            sun.position.set(2, 4, 3);
            scene.add(sun);
        "#;

        // 1. three_live_validate
        let val_req = json!({
            "jsonrpc": "2.0",
            "id": 10,
            "method": "tools/call",
            "params": {
                "name": "three_live_validate",
                "arguments": { "code": code }
            }
        });
        let val_resp = handle_mcp_request(&val_req).unwrap();
        assert_eq!(val_resp["result"]["isError"], false);
        let val_text = val_resp["result"]["content"][0]["text"].as_str().unwrap();
        let val_json: Value = serde_json::from_str(val_text).unwrap();
        assert_eq!(val_json["valid"], true);
        assert_eq!(val_json["summary"]["meshCount"], 2);

        // 2. three_live_render
        let render_req = json!({
            "jsonrpc": "2.0",
            "id": 11,
            "method": "tools/call",
            "params": {
                "name": "three_live_render",
                "arguments": {
                    "code": code,
                    "view": "quad",
                    "width": 256,
                    "height": 256,
                    "grid": true,
                    "annotations": true
                }
            }
        });
        let render_resp = handle_mcp_request(&render_req).unwrap();
        assert_eq!(render_resp["result"]["isError"], false);
        let img_block = &render_resp["result"]["content"][0];
        assert_eq!(img_block["type"], "image");
        assert_eq!(img_block["mimeType"], "image/png");
        let b64_data = img_block["data"].as_str().unwrap();
        assert!(b64_data.starts_with("iVBORw0KGgo"), "PNG base64 must start with PNG magic");

        // 3. three_live_convert (in-memory USDZ & GLB compilation)
        let conv_req = json!({
            "jsonrpc": "2.0",
            "id": 12,
            "method": "tools/call",
            "params": {
                "name": "three_live_convert",
                "arguments": {
                    "code": code,
                    "format": "usdz"
                }
            }
        });
        let conv_resp = handle_mcp_request(&conv_req).unwrap();
        assert_eq!(conv_resp["result"]["isError"], false);
        let conv_meta: Value =
            serde_json::from_str(conv_resp["result"]["content"][0]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(conv_meta["format"], "usdz");
        assert!(conv_meta["byteLength"].as_u64().unwrap() > 200);

        // 4. three_live_sim
        let sim_req = json!({
            "jsonrpc": "2.0",
            "id": 13,
            "method": "tools/call",
            "params": {
                "name": "three_live_sim",
                "arguments": {
                    "code": code,
                    "duration": 0.5,
                    "includeFilmstrip": true
                }
            }
        });
        let sim_resp = handle_mcp_request(&sim_req).unwrap();
        assert_eq!(sim_resp["result"]["isError"], false);
        assert_eq!(sim_resp["result"]["content"][0]["type"], "image");
        let sim_report: Value =
            serde_json::from_str(sim_resp["result"]["content"][1]["text"].as_str().unwrap())
                .unwrap();
        assert_eq!(sim_report["ticksSimulated"], 30);
    }

    #[test]
    fn test_mcp_io_supports_both_newline_and_content_length_framing() {
        let newline_input = "{\"jsonrpc\":\"2.0\",\"id\":1,\"method\":\"ping\"}\n";
        let mut reader = Cursor::new(newline_input.as_bytes());
        let mut output = Vec::new();
        run_mcp_io(&mut reader, &mut output).unwrap();
        let out_str = String::from_utf8(output).unwrap();
        assert!(out_str.ends_with('\n'));
        let parsed: Value = serde_json::from_str(out_str.trim()).unwrap();
        assert_eq!(parsed["id"], 1);
        assert_eq!(parsed["result"], json!({}));

        let body = "{\"jsonrpc\":\"2.0\",\"id\":2,\"method\":\"ping\"}";
        let framed_input = format!("Content-Length: {}\r\n\r\n{}", body.len(), body);
        let mut reader2 = Cursor::new(framed_input.as_bytes());
        let mut output2 = Vec::new();
        run_mcp_io(&mut reader2, &mut output2).unwrap();
        let out_str2 = String::from_utf8(output2).unwrap();
        assert!(out_str2.starts_with("Content-Length: "));
        let (_, json_body) = out_str2.split_once("\r\n\r\n").unwrap();
        let parsed2: Value = serde_json::from_str(json_body).unwrap();
        assert_eq!(parsed2["id"], 2);
    }
}
