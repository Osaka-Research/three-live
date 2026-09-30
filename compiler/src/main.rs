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

use clap::{Parser, Subcommand, ValueEnum};
use std::fs;
use std::path::PathBuf;
use three_live_compiler::{
    transcode_glb_to_usdz, transcode_three_to_glb, transcode_three_to_usdz, validate_three_script,
};

#[derive(ValueEnum, Clone, Copy, Debug, PartialEq)]
enum Format {
    Glb,
    Usdz,
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
    /// Convert a Three.js scene script or GLB into a binary container (GLB or USDZ)
    Convert {
        /// Input file path (.js script or .glb model)
        input: PathBuf,

        /// Output file path (defaults to <input>.<format>)
        #[arg(short, long)]
        output: Option<PathBuf>,

        /// Target output format (glb or usdz)
        #[arg(short, long, value_enum)]
        format: Option<Format>,
    },

    /// Validate Three.js script syntax and inspect scene graph statistics
    Validate {
        /// Input JavaScript file path
        input: PathBuf,
    },

    /// Inspect a binary 3D container (GLB or USDZ)
    Info {
        /// Input file path (.glb or .usdz)
        input: PathBuf,
    },
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
                let script = match String::from_utf8(input_bytes) {
                    Ok(s) => s,
                    Err(_) => {
                        eprintln!("Input script is not valid UTF-8");
                        std::process::exit(1);
                    }
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

        Commands::Validate { input } => {
            let script = match fs::read_to_string(&input) {
                Ok(s) => s,
                Err(e) => {
                    eprintln!("Error reading input file {:?}: {}", input, e);
                    std::process::exit(1);
                }
            };

            match validate_three_script(&script) {
                Ok(scene) => {
                    println!("Scene validation successful:");
                    println!("  Meshes: {}", scene.meshes.len());
                    for (i, m) in scene.meshes.iter().enumerate() {
                        println!(
                            "    [{}] '{}' - {} vertices, {} indices",
                            i,
                            m.name,
                            m.positions.len(),
                            m.indices.len()
                        );
                    }
                    println!("  Materials: {}", scene.materials.len());
                    println!("  Lights: {}", scene.lights.len());
                }
                Err(err) => {
                    eprintln!("Validation failed: {}", err);
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
    }
}
