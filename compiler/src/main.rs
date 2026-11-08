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

//! Standalone CLI for Three.js / GLB / USDZ compilation and inspection.

use clap::{Args, Parser, Subcommand, ValueEnum};
use std::fs;
use std::io::{BufRead, Write};
use std::path::{Path, PathBuf};
use std::time::Instant;
use three_live_compiler::gym::{
    GymEpisodeFile, GymObserveOptions, GymRecordedStep, GymSession, GymStepOutput,
};
use three_live_compiler::{
    build_validation_report, compute_node_world_aabbs, compute_node_world_matrices,
    encode_gif_frames, encode_png_rgba, evaluate_temporal_keyframes, extract_and_lint_html,
    is_html_source, read_glb, render_scene_rgba, render_viewport_rgba, run_mcp_stdio_server,
    simulate_scenario_from_source, stitch_filmstrip_horizontal, transcode_glb_to_usdz,
    transcode_three_to_glb, transcode_three_to_usdz, validate_scene_source, CameraConfig,
    RenderOptions, RenderViewMode, SimAction, WorldAABB, SIM_DT_SEC,
};

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq)]
enum CliViewMode {
    Camera,
    Front,
    Top,
    Right,
    Iso,
    Quad,
}

impl From<CliViewMode> for RenderViewMode {
    fn from(v: CliViewMode) -> Self {
        match v {
            CliViewMode::Camera => RenderViewMode::Camera,
            CliViewMode::Front => RenderViewMode::Front,
            CliViewMode::Top => RenderViewMode::Top,
            CliViewMode::Right => RenderViewMode::Right,
            CliViewMode::Iso => RenderViewMode::Iso,
            CliViewMode::Quad => RenderViewMode::Quad,
        }
    }
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq)]
enum Format {
    Glb,
    Usdz,
}

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq)]
enum DiagnosticFormat {
    Text,
    Json,
}

#[derive(Parser)]
#[command(name = "three-live-cli")]
#[command(about = "three-live toolkit: compile Three.js scripts and models to GLB or USDZ", long_about = None)]
struct Cli {
    #[command(subcommand)]
    command: Commands,
}

#[derive(Subcommand)]
enum Commands {
    /// Convert a Three.js scene script, HTML file, or GLB into a binary container (GLB or USDZ)
    Convert {
        /// Input file path (.js script, .html page, or .glb model)
        input: PathBuf,

        /// Output file path (defaults to <input>.<format>)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Target output format (glb or usdz)
        #[arg(short, long, value_enum)]
        format: Option<Format>,
    },

    /// Validate Three.js script or HTML file and report compiler/schema/spatial diagnostics
    Validate {
        /// Input JavaScript (.js) or HTML (.html) file path
        input: PathBuf,

        /// Output structured JSON diagnostics report
        #[arg(long)]
        json: bool,

        /// Diagnostic output format (text or json)
        #[arg(long, value_enum, default_value_t = DiagnosticFormat::Text)]
        diagnostic_format: DiagnosticFormat,
    },

    /// Inspect a binary 3D container (GLB or USDZ)
    Info {
        /// Input file path (.glb or .usdz)
        input: PathBuf,
    },

    /// Render a Three.js script, HTML page, or GLB headlessly to a PNG contact sheet or GIF89a
    /// turntable
    Render {
        /// Input file path (.js, .html, or .glb)
        input: PathBuf,

        /// Output image file path (.png or .gif)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Viewport layout (camera, front, top, right, iso, or quad)
        #[arg(long, value_enum, default_value_t = CliViewMode::Quad)]
        view: CliViewMode,

        /// Output image width in pixels (defaults to 1024 for quad, 512 for single view)
        #[arg(long)]
        width: Option<u32>,

        /// Output image height in pixels (defaults to 1024 for quad, 512 for single view)
        #[arg(long)]
        height: Option<u32>,

        /// Draw 1.0m / 0.25m reference ground grid and X/Y/Z origin axes
        #[arg(long)]
        grid: bool,

        /// Draw 3D AABB wireframes and 2D node name callouts
        #[arg(long)]
        annotations: bool,

        /// Render a 360-degree turntable orbit around the scene
        #[arg(long)]
        turntable: bool,

        /// Number of frames for temporal filmstrip or GIF animation
        #[arg(long)]
        frames: Option<usize>,

        /// Total duration in seconds for multi-frame capture
        #[arg(long, default_value_t = 2.0)]
        duration: f64,

        /// Optional interactive node name to trigger at t = 0
        #[arg(long)]
        trigger_select: Option<String>,

        /// Reference image to match (PNG/JPEG path or data:image/... URI). Writes a
        /// REFERENCE | RENDER | OVERLAY | SILHOUETTE DIFF sheet and prints silhouette metrics
        /// as JSON. `--view quad` is treated as `camera`; `--height` sets the panel height.
        #[arg(long)]
        reference: Option<String>,
    },

    /// Simulate interactive KHR_interactivity, orbit/explode, and xr-live-sim scenarios at 60 Hz
    Sim {
        /// Input file path (.js, .html, or .glb)
        input: PathBuf,

        /// Simulation duration in seconds (default 2.0s)
        #[arg(long, default_value_t = 2.0)]
        duration: f64,

        /// JSON array of timed actions (e.g. '[{"at":0.2,"type":"select","target":"crystal"}]')
        #[arg(long, default_value = "[]")]
        actions: String,

        /// Comma-separated 60Hz tick indices to render into --output-strip (e.g. "0,12,60,120")
        #[arg(long)]
        snapshot_frames: Option<String>,

        /// Optional output path for a keyframe filmstrip PNG or animated GIF
        #[arg(long)]
        output_strip: Option<PathBuf>,

        /// Output structured JSON simulation report
        #[arg(long)]
        json: bool,
    },

    /// Start a Model Context Protocol (MCP) server over stdio for AI coding agents
    Mcp,

    /// Validate a Three.js scene script and print a web playground link to open it on any
    /// device (optionally as a terminal QR code to scan with a phone)
    Link {
        /// Input JavaScript (.js) scene script
        input: PathBuf,

        /// Also print the link as a QR code in the terminal
        #[arg(long)]
        qr: bool,

        /// Playground page the link opens
        #[arg(long, default_value = three_live_compiler::scene_link::DEFAULT_PLAYGROUND_URL)]
        base: String,

        /// Output a structured JSON report instead of text
        #[arg(long)]
        json: bool,
    },

    /// Play a scene closed-loop, step by step, like a reinforcement-learning environment
    /// (the CLI form of the three_live_gym_* MCP tools)
    Gym {
        #[command(subcommand)]
        command: GymCommands,
    },
}

#[derive(Subcommand)]
enum GymCommands {
    /// Start an episode, save it to a session file, and print the t = 0 observation as JSON
    Reset {
        /// Input file path (.js, .html, or .glb)
        input: PathBuf,

        /// Session file to create (holds the scene and every step, so each call can resume)
        #[arg(long)]
        session: PathBuf,

        /// Only report these node names (comma-separated; default all, at most 64)
        #[arg(long, value_delimiter = ',')]
        watch: Vec<String>,

        #[command(flatten)]
        frame: GymFrameArgs,
    },

    /// Apply actions, advance the simulation, print the observation as JSON, and record the
    /// step in the session file
    Step {
        /// Session file from `gym reset`
        #[arg(long)]
        session: PathBuf,

        /// JSON array of actions; `at` is a delay in seconds from the start of this step
        /// (e.g. '[{"type":"moveCharacter","direction":[1,0,0],"jump":true}]')
        #[arg(long, default_value = "[]")]
        actions: String,

        /// 60 Hz ticks to advance (1..600)
        #[arg(long, default_value_t = 30)]
        ticks: usize,

        /// Override the session's watch list for this observation (comma-separated)
        #[arg(long, value_delimiter = ',')]
        watch: Option<Vec<String>>,

        #[command(flatten)]
        frame: GymFrameArgs,
    },

    /// Interactive mode: print the t = 0 observation, then read one JSON step per stdin line
    /// ({"actions": [...], "ticks": 30, "watch": [...], "frame": "out.png"}) and print one
    /// observation (or {"error": ...}) per line
    Play {
        /// Input file path (.js, .html, or .glb)
        input: PathBuf,

        /// Only report these node names (comma-separated; default all, at most 64)
        #[arg(long, value_delimiter = ',')]
        watch: Vec<String>,

        /// Viewport for per-step "frame" renders
        #[arg(long, value_enum, default_value_t = CliViewMode::Camera)]
        view: CliViewMode,

        /// Frame width in pixels
        #[arg(long, default_value_t = 384)]
        width: u32,

        /// Frame height in pixels
        #[arg(long, default_value_t = 288)]
        height: u32,
    },
}

#[derive(Args)]
struct GymFrameArgs {
    /// Also render the observation to this PNG file
    #[arg(long)]
    frame: Option<PathBuf>,

    /// Viewport for --frame
    #[arg(long, value_enum, default_value_t = CliViewMode::Camera)]
    view: CliViewMode,

    /// Frame width in pixels
    #[arg(long, default_value_t = 384)]
    width: u32,

    /// Frame height in pixels
    #[arg(long, default_value_t = 288)]
    height: u32,
}

impl GymFrameArgs {
    fn options(&self, watch: Vec<String>) -> GymObserveOptions {
        GymObserveOptions {
            watch,
            frame: self.frame.as_ref().map(|_| gym_frame_spec(self.view, self.width, self.height)),
        }
    }
}

fn gym_frame_spec(view: CliViewMode, width: u32, height: u32) -> (RenderViewMode, u32, u32) {
    (view.into(), width.clamp(64, 2048), height.clamp(64, 2048))
}

fn gym_fail(message: impl std::fmt::Display) -> ! {
    eprintln!("{}", message);
    std::process::exit(1);
}

/// Writes `out`'s frame (if any) to `frame_path` and returns the observation as JSON.
fn gym_output_json(
    out: GymStepOutput,
    frame_path: Option<&Path>,
) -> Result<serde_json::Value, String> {
    let mut value = serde_json::to_value(&out.observation).map_err(|e| e.to_string())?;
    if let (Some(png), Some(path)) = (out.frame_png, frame_path) {
        fs::write(path, &png).map_err(|e| format!("Error writing frame {:?}: {}", path, e))?;
        value["frame"] = serde_json::json!(path.to_string_lossy());
    }
    Ok(value)
}

/// Saves the session file atomically (write a sibling temp file, then rename).
fn gym_save_session(path: &Path, file: &GymEpisodeFile) -> Result<(), String> {
    let text = serde_json::to_string(file).map_err(|e| e.to_string())?;
    let mut tmp = path.as_os_str().to_owned();
    tmp.push(".tmp");
    let tmp = PathBuf::from(tmp);
    fs::write(&tmp, text).map_err(|e| format!("Error writing session {:?}: {}", tmp, e))?;
    fs::rename(&tmp, path).map_err(|e| format!("Error saving session {:?}: {}", path, e))
}

fn gym_read_input(input: &Path) -> (Vec<u8>, bool) {
    let bytes = fs::read(input)
        .unwrap_or_else(|e| gym_fail(format!("Error reading input file {:?}: {}", input, e)));
    let is_glb = bytes.len() >= 4 && &bytes[0..4] == b"glTF";
    (bytes, is_glb)
}

fn run_gym(command: GymCommands) {
    match command {
        GymCommands::Reset { input, session, watch, frame } => {
            let (bytes, is_glb) = gym_read_input(&input);
            let file = GymEpisodeFile::new(
                &bytes,
                is_glb,
                Some(input.to_string_lossy().to_string()),
                watch.clone(),
            )
            .unwrap_or_else(|e| gym_fail(e));
            let (_, out) = GymSession::reset(&bytes, is_glb, &frame.options(watch))
                .unwrap_or_else(|e| gym_fail(format!("Simulation error: {}", e)));
            let value =
                gym_output_json(out, frame.frame.as_deref()).unwrap_or_else(|e| gym_fail(e));
            gym_save_session(&session, &file).unwrap_or_else(|e| gym_fail(e));
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
        }
        GymCommands::Step { session, actions, ticks, watch, frame } => {
            let text = fs::read_to_string(&session).unwrap_or_else(|e| {
                gym_fail(format!(
                    "Error reading session {:?}: {} (create one with `three-live-cli gym reset`)",
                    session, e
                ))
            });
            let mut file = GymEpisodeFile::from_json(&text).unwrap_or_else(|e| gym_fail(e));
            let actions: Vec<SimAction> = serde_json::from_str(&actions)
                .unwrap_or_else(|e| gym_fail(format!("Error parsing --actions JSON: {}", e)));
            let watch = watch.unwrap_or_else(|| file.watch.clone());
            let quiet = GymObserveOptions { watch: watch.clone(), frame: None };
            let (mut sim, _) = file.replay(&quiet).unwrap_or_else(|e| gym_fail(e));
            let out =
                sim.step(&actions, ticks, &frame.options(watch)).unwrap_or_else(|e| gym_fail(e));
            let value =
                gym_output_json(out, frame.frame.as_deref()).unwrap_or_else(|e| gym_fail(e));
            file.steps.push(GymRecordedStep { actions, ticks });
            gym_save_session(&session, &file).unwrap_or_else(|e| gym_fail(e));
            println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
        }
        GymCommands::Play { input, watch, view, width, height } => {
            let (bytes, is_glb) = gym_read_input(&input);
            let base = GymObserveOptions { watch: watch.clone(), frame: None };
            let (mut sim, out) = GymSession::reset(&bytes, is_glb, &base)
                .unwrap_or_else(|e| gym_fail(format!("Simulation error: {}", e)));
            let stdout = std::io::stdout();
            let mut w = stdout.lock();
            let emit = |w: &mut std::io::StdoutLock<'_>, v: serde_json::Value| {
                let _ = writeln!(w, "{}", v);
                let _ = w.flush();
            };
            emit(&mut w, gym_output_json(out, None).unwrap_or_else(|e| gym_fail(e)));
            for line in std::io::stdin().lock().lines() {
                let Ok(line) = line else { break };
                if line.trim().is_empty() {
                    continue;
                }
                let result = (|| -> Result<serde_json::Value, String> {
                    let req: serde_json::Value =
                        serde_json::from_str(&line).map_err(|e| format!("Invalid JSON: {}", e))?;
                    let actions: Vec<SimAction> = match req.get("actions") {
                        None | Some(serde_json::Value::Null) => Vec::new(),
                        Some(v) => serde_json::from_value(v.clone())
                            .map_err(|e| format!("Invalid `actions`: {}", e))?,
                    };
                    let ticks = match req.get("ticks") {
                        None | Some(serde_json::Value::Null) => 30,
                        Some(v) => v
                            .as_u64()
                            .ok_or_else(|| "`ticks` must be a positive integer.".to_string())?
                            as usize,
                    };
                    let watch = match req.get("watch").and_then(|v| v.as_array()) {
                        Some(a) => {
                            a.iter().filter_map(|x| x.as_str().map(str::to_string)).collect()
                        }
                        None => watch.clone(),
                    };
                    let frame_path = req.get("frame").and_then(|v| v.as_str()).map(PathBuf::from);
                    let opts = GymObserveOptions {
                        watch,
                        frame: frame_path.as_ref().map(|_| gym_frame_spec(view, width, height)),
                    };
                    let out = sim.step(&actions, ticks, &opts)?;
                    gym_output_json(out, frame_path.as_deref())
                })();
                match result {
                    Ok(v) => emit(&mut w, v),
                    Err(e) => emit(&mut w, serde_json::json!({ "error": e })),
                }
            }
        }
    }
}

fn inspect_glb(input: &PathBuf, data: &[u8]) {
    if data.len() < 12 {
        eprintln!("Invalid GLB file (< 12 bytes)");
        return;
    }
    let version = u32::from_le_bytes([data[4], data[5], data[6], data[7]]);
    let length = u32::from_le_bytes([data[8], data[9], data[10], data[11]]);

    println!("GLB Container Info ({:?}):", input);
    println!("  Version: {}", version);
    println!("  Header Length: {} bytes", length);
    println!("  Actual File Size: {} bytes", data.len());

    let mut offset = 12usize;
    let mut chunk_idx = 0usize;
    while let Some(header_end) = offset.checked_add(8) {
        if header_end > data.len() {
            break;
        }
        let chunk_len = u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]) as usize;
        let chunk_type = u32::from_le_bytes([
            data[offset + 4],
            data[offset + 5],
            data[offset + 6],
            data[offset + 7],
        ]);
        let type_str = match chunk_type {
            0x4E4F534A => "JSON",
            0x004E4942 => "BIN",
            _ => "UNKNOWN",
        };
        println!("  Chunk [{}]: Type={}, Length={} bytes", chunk_idx, type_str, chunk_len);
        let Some(next_offset) = header_end.checked_add(chunk_len) else {
            break;
        };
        if next_offset > data.len() {
            break;
        }
        offset = next_offset;
        chunk_idx += 1;
    }
}

fn inspect_usdz(input: &PathBuf, data: &[u8]) {
    println!("USDZ (ZIP) Archive Info ({:?}):", input);
    println!("  Archive Size: {} bytes", data.len());

    let mut offset = 0usize;
    let mut entry_idx = 0usize;
    let mut all_aligned = true;

    while let Some(header_end) = offset.checked_add(30) {
        if header_end > data.len() {
            break;
        }
        let sig = u32::from_le_bytes([
            data[offset],
            data[offset + 1],
            data[offset + 2],
            data[offset + 3],
        ]);
        if sig != 0x04034B50 {
            break;
        }

        let comp_method = u16::from_le_bytes([data[offset + 8], data[offset + 9]]);
        let comp_size = u32::from_le_bytes([
            data[offset + 18],
            data[offset + 19],
            data[offset + 20],
            data[offset + 21],
        ]) as usize;
        let uncomp_size = u32::from_le_bytes([
            data[offset + 22],
            data[offset + 23],
            data[offset + 24],
            data[offset + 25],
        ]) as usize;
        let fn_len = u16::from_le_bytes([data[offset + 26], data[offset + 27]]) as usize;
        let extra_len = u16::from_le_bytes([data[offset + 28], data[offset + 29]]) as usize;

        let Some(fn_end) = header_end.checked_add(fn_len) else {
            break;
        };
        let filename = if fn_end <= data.len() {
            String::from_utf8_lossy(&data[header_end..fn_end]).to_string()
        } else {
            "<corrupt>".to_string()
        };

        let Some(payload_offset) = fn_end.checked_add(extra_len) else {
            break;
        };
        let Some(next_offset) = payload_offset.checked_add(comp_size) else {
            break;
        };
        if next_offset > data.len() {
            break;
        }

        let is_aligned = payload_offset % 64 == 0;
        if !is_aligned {
            all_aligned = false;
        }

        println!(
            "  Entry [{}]: {:?}, Size: {} B (Method: {}), Payload Offset: {} (64B Aligned: {})",
            entry_idx,
            filename,
            uncomp_size,
            if comp_method == 0 { "Store (0)" } else { "Compressed" },
            payload_offset,
            if is_aligned { "YES" } else { "NO ⚠️" }
        );

        offset = next_offset;
        entry_idx += 1;
    }

    println!("  Total Entries: {}", entry_idx);
    println!(
        "  Apple RealityKit 64-byte alignment: {}",
        if all_aligned { "VALID ✅" } else { "INVALID ❌" }
    );
}

fn main() {
    let cli = Cli::parse();

    match cli.command {
        Commands::Convert { input, output, format } => {
            let input_bytes = match fs::read(&input) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };

            let is_input_glb = input_bytes.len() >= 4 && &input_bytes[0..4] == b"glTF";

            // Determine target format
            let target_format = format.unwrap_or_else(|| {
                if let Some(ref out) = output {
                    if let Some(ext) = out.extension().and_then(|e| e.to_str()) {
                        if ext.eq_ignore_ascii_case("usdz") {
                            return Format::Usdz;
                        } else if ext.eq_ignore_ascii_case("glb") {
                            return Format::Glb;
                        }
                    }
                }
                if is_input_glb {
                    Format::Usdz
                } else {
                    Format::Glb
                }
            });

            let (result_bytes, ext) = if is_input_glb {
                match target_format {
                    Format::Usdz => match transcode_glb_to_usdz(&input_bytes) {
                        Ok(bytes) => (bytes, "usdz"),
                        Err(err) => {
                            eprintln!("GLB to USDZ transcoding error: {}", err);
                            std::process::exit(1);
                        }
                    },
                    Format::Glb => {
                        println!("Input is already GLB; nothing to convert.");
                        (input_bytes, "glb")
                    }
                }
            } else {
                let raw_source = match String::from_utf8(input_bytes) {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("Input script is not valid UTF-8");
                        std::process::exit(1);
                    }
                };
                let filename = input.to_string_lossy();
                let script = if is_html_source(&raw_source, &filename) {
                    let (scripts, _) = extract_and_lint_html(&raw_source);
                    scripts.join("\n;\n")
                } else {
                    raw_source
                };
                match target_format {
                    Format::Glb => match transcode_three_to_glb(&script) {
                        Ok(bytes) => (bytes, "glb"),
                        Err(err) => {
                            eprintln!("Transcoding error: {}", err);
                            std::process::exit(1);
                        }
                    },
                    Format::Usdz => match transcode_three_to_usdz(&script) {
                        Ok(bytes) => (bytes, "usdz"),
                        Err(err) => {
                            eprintln!("Transcoding error: {}", err);
                            std::process::exit(1);
                        }
                    },
                }
            };

            let out_path = output.unwrap_or_else(|| input.with_extension(ext));
            if let Err(e) = fs::write(&out_path, &result_bytes) {
                eprintln!("Error writing output file {:?}: {}", out_path, e);
                std::process::exit(1);
            }
            println!(
                "Successfully compiled {:?} -> {:?} ({} bytes)",
                input,
                out_path,
                result_bytes.len()
            );
        }

        Commands::Validate { input, json: json_flag, diagnostic_format } => {
            let input_bytes = match fs::read(&input) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };

            let filename = input.to_string_lossy().to_string();
            let start = Instant::now();
            let (scene_opt, base_diags) = if input_bytes.len() >= 4 && &input_bytes[0..4] == b"glTF"
            {
                match read_glb(&input_bytes) {
                    Ok(scene) => (Some(scene), Vec::new()),
                    Err(e) => (
                        None,
                        vec![three_live_compiler::Diagnostic {
                            code: "TL100".to_string(),
                            severity: "error".to_string(),
                            message: e,
                            ..Default::default()
                        }],
                    ),
                }
            } else {
                let source = match String::from_utf8(input_bytes) {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("Input script is not valid UTF-8");
                        std::process::exit(1);
                    }
                };
                validate_scene_source(&source, &filename)
            };
            let elapsed_ms = (start.elapsed().as_secs_f64() * 1000.0 * 10.0).round() / 10.0;
            let report =
                build_validation_report(&filename, elapsed_ms, scene_opt.as_ref(), base_diags);
            let emit_json = json_flag || diagnostic_format == DiagnosticFormat::Json;

            if emit_json {
                println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
                if !report.valid {
                    std::process::exit(1);
                }
            } else {
                if let Some(ref summary) = report.summary {
                    println!(
                        "Scene validation {} ({:.1} ms):",
                        if !report.valid { "completed with errors" } else { "successful" },
                        elapsed_ms
                    );
                    println!(
                        "  Meshes: {} (visible: {}), Nodes: {}, Vertices: {}, Indices: {}",
                        summary.mesh_count,
                        summary.camera.visible_mesh_count,
                        summary.node_count,
                        summary.vertex_count,
                        summary.index_count
                    );
                    if let Some(ref wb) = summary.world_bounds {
                        println!(
                            "  World Bounds: min={:?}, max={:?}, size={:?}",
                            wb.min, wb.max, wb.size
                        );
                    }
                    println!(
                        "  Materials: {}, Lights: {}",
                        summary.material_count, summary.light_count
                    );
                } else {
                    eprintln!("Validation failed ({:.1} ms):", elapsed_ms);
                }
                for d in &report.diagnostics {
                    let loc = match (d.line, d.column) {
                        (Some(l), Some(c)) => format!(" (line {}, col {})", l, c),
                        (Some(l), None) => format!(" (line {})", l),
                        _ => String::new(),
                    };
                    let node_str =
                        d.node.as_ref().map(|n| format!(" [node: {}]", n)).unwrap_or_default();
                    println!(
                        "  [{}] {}{}{}: {}",
                        d.code,
                        d.severity.to_uppercase(),
                        node_str,
                        loc,
                        d.message
                    );
                    if let Some(ref hint) = d.hint {
                        println!("    Hint: {}", hint);
                    }
                }
                if !report.valid {
                    std::process::exit(1);
                }
            }
        }

        Commands::Info { input } => {
            let data = match fs::read(&input) {
                Ok(d) => d,
                Err(e) => {
                    eprintln!("Error reading file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };

            if data.len() < 4 {
                eprintln!("File too small to inspect (min 4 bytes)");
                std::process::exit(1);
            }

            if &data[0..4] == b"glTF" {
                if data.len() < 12 {
                    eprintln!("File too small to be a valid GLB (min 12 bytes)");
                    std::process::exit(1);
                }
                inspect_glb(&input, &data);
            } else if &data[0..4] == b"PK\x03\x04" {
                inspect_usdz(&input, &data);
            } else {
                eprintln!("Unrecognized format (neither GLB 'glTF' nor USDZ/ZIP 'PK\\x03\\x04')");
                std::process::exit(1);
            }
        }

        Commands::Render {
            input,
            output,
            view,
            width,
            height,
            grid,
            annotations,
            turntable,
            frames,
            duration,
            trigger_select,
            reference,
        } => {
            let input_bytes = match fs::read(&input) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };
            let is_input_glb = input_bytes.len() >= 4 && &input_bytes[0..4] == b"glTF";
            let filename = input.to_string_lossy().to_string();
            let scene = if is_input_glb {
                match read_glb(&input_bytes) {
                    Ok(s) => s,
                    Err(e) => {
                        eprintln!("Error parsing GLB {:?}: {}", input, e);
                        std::process::exit(1);
                    }
                }
            } else {
                let source = match String::from_utf8(input_bytes.clone()) {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("Input script is not valid UTF-8");
                        std::process::exit(1);
                    }
                };
                let (scene_opt, diags) = validate_scene_source(&source, &filename);
                match scene_opt {
                    Some(s) => s,
                    None => {
                        for d in diags {
                            eprintln!("[{}] {}: {}", d.code, d.severity.to_uppercase(), d.message);
                        }
                        std::process::exit(1);
                    }
                }
            };

            let render_view: RenderViewMode = view.into();
            if let Some(spec) = reference {
                if turntable || frames.is_some_and(|f| f > 1) || trigger_select.is_some() {
                    eprintln!(
                        "--reference renders a single still frame; drop --turntable, --frames, \
                         and --trigger-select"
                    );
                    std::process::exit(1);
                }
                let decoded = three_live_compiler::load_reference_bytes(&spec)
                    .and_then(|b| three_live_compiler::decode_reference_image(&b));
                let (reference_img, reference_size) = match decoded {
                    Ok(r) => r,
                    Err(e) => {
                        eprintln!("Error: {}", e);
                        std::process::exit(1);
                    }
                };
                let cmp = three_live_compiler::compare_scene_to_reference(
                    &scene,
                    &reference_img,
                    reference_size,
                    render_view,
                    height.unwrap_or(512),
                    grid,
                    annotations,
                );
                let out_path = output.unwrap_or_else(|| input.with_extension("reference.png"));
                if !out_path
                    .extension()
                    .and_then(|e| e.to_str())
                    .is_some_and(|e| e.eq_ignore_ascii_case("png"))
                {
                    eprintln!(
                        "--reference writes a PNG comparison sheet: use an -o path ending in .png"
                    );
                    std::process::exit(1);
                }
                let png = match three_live_compiler::encode_png_rgba_compressed(
                    cmp.width, cmp.height, &cmp.rgba,
                ) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("PNG encoding error: {}", e);
                        std::process::exit(1);
                    }
                };
                if let Err(e) = fs::write(&out_path, &png) {
                    eprintln!("Error writing {:?}: {}", out_path, e);
                    std::process::exit(1);
                }
                eprintln!(
                    "Wrote {}x{} reference comparison to {:?}",
                    cmp.width, cmp.height, out_path
                );
                println!(
                    "{}",
                    serde_json::to_string_pretty(&cmp.metrics).unwrap_or_else(|_| "{}".to_string())
                );
                return;
            }
            let default_dim = if render_view == RenderViewMode::Quad { 1024 } else { 512 };
            let w = width.unwrap_or(default_dim).clamp(64, 2048);
            let h = height.unwrap_or(default_dim).clamp(64, 2048);

            let out_path = output.unwrap_or_else(|| {
                if turntable {
                    input.with_extension("gif")
                } else {
                    input.with_extension("png")
                }
            });
            let is_gif = out_path
                .extension()
                .and_then(|e| e.to_str())
                .map(|e| e.eq_ignore_ascii_case("gif"))
                .unwrap_or(turntable);

            let frame_count = frames
                .unwrap_or(if turntable || is_gif {
                    12
                } else if trigger_select.is_some() {
                    8
                } else {
                    1
                })
                .clamp(1, 60);

            if turntable || frame_count > 1 || trigger_select.is_some() {
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
                let frame_view = if render_view == RenderViewMode::Quad {
                    RenderViewMode::Camera
                } else {
                    render_view
                };

                let temporal_keyframes = if !turntable {
                    evaluate_temporal_keyframes(
                        &input_bytes,
                        is_input_glb,
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

                let bytes = if is_gif {
                    let delay_cs =
                        ((duration * 100.0 / (frame_count as f64)).round() as u16).max(4);
                    match encode_gif_frames(w, h, &captured, delay_cs) {
                        Ok(b) => b,
                        Err(e) => {
                            eprintln!("GIF encoding error: {}", e);
                            std::process::exit(1);
                        }
                    }
                } else {
                    let (sw, sh, strip) = stitch_filmstrip_horizontal(w, h, &captured);
                    match encode_png_rgba(sw, sh, &strip) {
                        Ok(b) => b,
                        Err(e) => {
                            eprintln!("PNG encoding error: {}", e);
                            std::process::exit(1);
                        }
                    }
                };
                if let Err(e) = fs::write(&out_path, &bytes) {
                    eprintln!("Error writing output image {:?}: {}", out_path, e);
                    std::process::exit(1);
                }
                println!(
                    "Rendered {} frame(s) -> {:?} ({} bytes)",
                    frame_count,
                    out_path,
                    bytes.len()
                );
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
                let png = match encode_png_rgba(out_w, out_h, &rgba) {
                    Ok(b) => b,
                    Err(e) => {
                        eprintln!("PNG encoding error: {}", e);
                        std::process::exit(1);
                    }
                };
                if let Err(e) = fs::write(&out_path, &png) {
                    eprintln!("Error writing output PNG {:?}: {}", out_path, e);
                    std::process::exit(1);
                }
                println!(
                    "Rendered {:?} ({}x{}) -> {:?} ({} bytes)",
                    render_view,
                    out_w,
                    out_h,
                    out_path,
                    png.len()
                );
            }
        }

        Commands::Sim {
            input,
            duration,
            actions,
            snapshot_frames,
            output_strip,
            json: json_flag,
        } => {
            let input_bytes = match fs::read(&input) {
                Ok(b) => b,
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };
            let is_input_glb = input_bytes.len() >= 4 && &input_bytes[0..4] == b"glTF";
            let parsed_actions: Vec<SimAction> = match serde_json::from_str(&actions) {
                Ok(a) => a,
                Err(e) => {
                    eprintln!("Error parsing --actions JSON: {}", e);
                    std::process::exit(1);
                }
            };
            let total_ticks = ((duration.max(0.0) / SIM_DT_SEC).round() as usize).max(1);
            let mut snap_ticks: Vec<usize> = if let Some(ref sf) = snapshot_frames {
                sf.split(',').filter_map(|t| t.trim().parse::<usize>().ok()).collect()
            } else if output_strip.is_some() {
                vec![0, total_ticks / 3, (total_ticks * 2) / 3, total_ticks]
            } else {
                Vec::new()
            };
            snap_ticks.sort_unstable();
            snap_ticks.dedup();

            let (report, snapshots) = match simulate_scenario_from_source(
                &input_bytes,
                is_input_glb,
                duration,
                &parsed_actions,
                &snap_ticks,
            ) {
                Ok(r) => r,
                Err(e) => {
                    eprintln!("Simulation error: {}", e);
                    std::process::exit(1);
                }
            };

            if let Some(strip_path) = output_strip {
                if !snapshots.is_empty() {
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
                    let is_gif = strip_path
                        .extension()
                        .and_then(|e| e.to_str())
                        .map(|e| e.eq_ignore_ascii_case("gif"))
                        .unwrap_or(false);
                    let img_bytes = if is_gif {
                        encode_gif_frames(fw, fh, &captured, 20).unwrap_or_default()
                    } else {
                        let (sw, sh, strip) = stitch_filmstrip_horizontal(fw, fh, &captured);
                        encode_png_rgba(sw, sh, &strip).unwrap_or_default()
                    };
                    if let Err(e) = fs::write(&strip_path, &img_bytes) {
                        eprintln!("Error writing snapshot strip {:?}: {}", strip_path, e);
                        std::process::exit(1);
                    }
                }
            }

            if json_flag {
                println!("{}", serde_json::to_string_pretty(&report).unwrap_or_default());
            } else {
                println!(
                    "Simulation completed ({:.2}s, {} ticks): state={}, score={}",
                    report.duration_sec,
                    report.ticks_simulated,
                    report.scenario_state,
                    report.score
                );
                if !report.completed_objectives.is_empty() {
                    println!("  Completed objectives: {:?}", report.completed_objectives);
                }
                if !report.triggered_events.is_empty() {
                    println!("  Triggered events: {:?}", report.triggered_events);
                }
                if !report.audio_cues_fired.is_empty() {
                    println!("  Audio cues fired: {:?}", report.audio_cues_fired);
                }
                for b in &report.bodies {
                    println!(
                        "  [{}] {}: pos {:?} -> {:?}, visible={}, destroyed={}",
                        b.index,
                        b.name,
                        b.initial_translation,
                        b.final_translation,
                        b.visible,
                        b.destroyed
                    );
                }
            }
        }

        Commands::Gym { command } => run_gym(command),
        Commands::Mcp => {
            if let Err(e) = run_mcp_stdio_server() {
                eprintln!("MCP server error: {}", e);
                std::process::exit(1);
            }
        }
        Commands::Link { input, qr, base, json } => {
            let source = match fs::read(&input).map(String::from_utf8) {
                Ok(Ok(s)) => s,
                Ok(Err(_)) => {
                    eprintln!("Input script is not valid UTF-8");
                    std::process::exit(1);
                }
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };
            let filename = input.to_string_lossy().to_string();
            match three_live_compiler::scene_link::build_scene_link(&source, &filename, &base) {
                Ok(link) => {
                    if json {
                        let mut value = link.to_json();
                        if qr {
                            if let Some(code) = link.qr.as_ref() {
                                value["qrText"] = serde_json::json!(code.to_terminal_string(2));
                            }
                        }
                        println!("{}", serde_json::to_string_pretty(&value).unwrap_or_default());
                    } else {
                        println!("{}", link.summary());
                        println!("\n{}", link.url);
                        if qr {
                            match link.qr.as_ref() {
                                Some(code) => println!("\n{}", code.to_terminal_string(2)),
                                None => println!(
                                    "\nThe link is {} characters, too long for a QR code a phone \
                                     can scan from a screen (max {}). Open it on this computer \
                                     and send it to your phone instead.",
                                    link.url.len(),
                                    three_live_compiler::scene_link::MAX_QR_URL_LEN
                                ),
                            }
                        }
                    }
                }
                Err(e) => {
                    eprintln!("{e}");
                    std::process::exit(1);
                }
            }
        }
    }
}
