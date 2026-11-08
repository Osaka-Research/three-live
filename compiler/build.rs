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

use std::env;
use std::path::Path;
use std::process::Command;

fn main() {
    // Notify rustc that this build is executed under Cargo
    println!("cargo:rustc-check-cfg=cfg(cargo_build)");
    println!("cargo:rustc-cfg=cargo_build");
    if env::var("CARGO_CFG_TARGET_OS").as_deref() == Ok("android") {
        println!("cargo:rustc-cdylib-link-arg=-Wl,-z,max-page-size=16384");
        println!("cargo:rustc-cdylib-link-arg=-Wl,-z,common-page-size=16384");
    }
    println!("cargo:rerun-if-changed=../three-live/src/constants.ts");
    println!("cargo:rerun-if-changed=../three-live/src/three-author.ts");
    println!("cargo:rerun-if-changed=../three-live/src/three-view.ts");
    println!("cargo:rerun-if-changed=../three-live/src/xr-trait-schema.ts");
    println!("cargo:rerun-if-changed=../three-live/src/xr-sim-schema.ts");
    println!("cargo:rerun-if-changed=../three-live/src/plugins/procedural.ts");
    println!("cargo:rerun-if-changed=../three-live/src/plugins/cad.ts");
    println!("cargo:rerun-if-changed=../three-live/src/plugins/ik.ts");
    println!("cargo:rerun-if-changed=../three-live/src/plugins/lod.ts");
    println!("cargo:rerun-if-changed=assets/three-author-engine.min.js");

    let out_dir = env::var("OUT_DIR").expect("OUT_DIR must be set by Cargo");
    let dest_path = Path::new(&out_dir).join("three-author-engine.min.js");

    let manifest_dir = env::var("CARGO_MANIFEST_DIR").expect("CARGO_MANIFEST_DIR not set");
    let entry_path = Path::new(&manifest_dir).join("../three-live/src/three-author.ts");
    let vendored_path = Path::new(&manifest_dir).join("assets/three-author-engine.min.js");

    let mut built_from_source = false;
    if entry_path.exists() {
        if let Some(esbuild) = find_esbuild() {
            let mut cmd = if esbuild.starts_with("npx ") {
                let mut c = Command::new("npx");
                c.arg("esbuild");
                c
            } else {
                Command::new(&esbuild)
            };

            let status = cmd
                .arg(&entry_path)
                .arg("--bundle")
                .arg("--format=iife")
                .arg("--global-name=ThreeEngine")
                .arg("--preserve-symlinks")
                .arg("--loader:.ts=ts")
                .arg("--minify")
                .arg("--define:IS_DEV=false")
                .arg("--define:ENABLE_NATIVE_HOOKS=true")
                .arg("--define:ENABLE_SERVER_EXTRACT=true")
                .arg("--define:SECURITY_3D_EXECUTION_CEILING_MS=250")
                .arg("--define:SECURITY_3D_INTERRUPT_CHECK_OPCODES=10000")
                .arg("--define:SECURITY_3D_MAX_HEAP_BYTES=16777216")
                .arg("--define:SECURITY_3D_MAX_VERTICES=100000")
                .arg("--define:SECURITY_3D_MAX_MESHES=1000")
                .arg("--define:SECURITY_3D_MAX_INDICES=300000")
                .arg("--define:SECURITY_3D_MAX_TEXTURES=16")
                .arg("--define:SECURITY_3D_MAX_TEXTURE_DIMENSION=2048")
                .arg("--define:SECURITY_3D_SANDBOX_TIMEOUT_MS=3000")
                .arg("--define:SECURITY_3D_MAX_SCRIPT_BYTES=1048576")
                .arg("--define:SECURITY_3D_MAX_CONCURRENT_TASKS=32")
                .arg("--target=es2020")
                .arg(format!("--outfile={}", dest_path.display()))
                .status();

            if let Ok(st) = status {
                if st.success() {
                    built_from_source = true;
                    // Keep the vendored copy fresh if writable
                    if let Ok(content) = std::fs::read(&dest_path) {
                        let _ = std::fs::create_dir_all(vendored_path.parent().unwrap());
                        let _ = std::fs::write(&vendored_path, content);
                    }
                }
            }
        }
    }

    if !built_from_source {
        if vendored_path.exists() {
            std::fs::copy(&vendored_path, &dest_path)
                .expect("Failed to copy vendored three-author-engine.min.js to OUT_DIR");
        } else {
            panic!(
                "Could not compile three-author-engine.js from source and no vendored asset \
                 found at {}. Please install esbuild.",
                vendored_path.display()
            );
        }
    }
}

fn find_esbuild() -> Option<String> {
    if Command::new("esbuild").arg("--version").output().is_ok() {
        return Some("esbuild".to_string());
    }
    if let Ok(home) = env::var("HOME") {
        let candidate = format!("{}/.local/bin/esbuild", home);
        if Path::new(&candidate).exists() {
            return Some(candidate);
        }
    }
    if Command::new("npx").arg("esbuild").arg("--version").output().is_ok() {
        return Some("npx esbuild".to_string());
    }
    None
}
