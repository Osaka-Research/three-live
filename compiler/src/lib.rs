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

//! three-live-compiler: In-process Pure Rust Three.js to binary GLB compiler.

pub mod constants;
pub mod engine;
pub mod ffi;
pub mod geometry;
pub mod glb;
pub mod scene;
pub mod time;
pub mod usdz;

#[cfg(target_arch = "wasm32")]
pub mod wasm;

#[cfg(feature = "jni")]
pub mod jni;

use std::cell::RefCell;

pub use constants::*;
pub use engine::ThreeEngine;
pub use geometry::*;
pub use glb::write_glb;
pub use scene::SceneGraph;
pub use usdz::*;

#[cfg(any(feature = "wasm", target_arch = "wasm32"))]
pub use wasm::*;

/// Convenience aliases for the main compilation entry points.
pub use transcode_three_to_glb as compile_three_to_glb;
pub use transcode_three_to_usdz as compile_three_to_usdz;

struct TlsEngineSlot(std::mem::ManuallyDrop<Option<ThreeEngine>>);

impl TlsEngineSlot {
    const fn new() -> Self {
        Self(std::mem::ManuallyDrop::new(None))
    }
    fn as_mut(&mut self) -> &mut Option<ThreeEngine> {
        &mut self.0
    }
    fn clear(&mut self) {
        // Explicitly drops ThreeEngine during normal execution while boa_gc TLS is alive.
        let _ = self.0.take();
    }
}

thread_local! {
    static THREAD_LOCAL_CACHE_ENABLED: std::cell::Cell<bool> = const { std::cell::Cell::new(true) };
    static THREAD_LOCAL_ENGINE: RefCell<TlsEngineSlot> = const { RefCell::new(TlsEngineSlot::new()) };
}

/// Sets whether thread-local ThreeEngine VM caching is enabled for the current thread.
pub fn set_thread_local_cache_enabled(enabled: bool) {
    THREAD_LOCAL_CACHE_ENABLED.with(|c| c.set(enabled));
    if !enabled {
        clear_thread_local_engine();
    }
}

/// Returns whether thread-local ThreeEngine VM caching is enabled for the current thread.
pub fn is_thread_local_cache_enabled() -> bool {
    THREAD_LOCAL_CACHE_ENABLED.with(|c| c.get())
}

/// Clears the thread-local engine for the current thread to reclaim memory.
pub fn clear_thread_local_engine() {
    THREAD_LOCAL_ENGINE.with(|cell| {
        cell.borrow_mut().clear();
    });
}

fn panic_payload_message(err: &(dyn std::any::Any + Send)) -> String {
    if let Some(s) = err.downcast_ref::<&str>() {
        (*s).to_string()
    } else if let Some(s) = err.downcast_ref::<String>() {
        s.clone()
    } else {
        "unknown panic payload".to_string()
    }
}

/// Pre-warms the thread-local Boa context if thread-local caching is enabled.
pub fn prewarm_thread_local_engine() -> Result<(), String> {
    if !is_thread_local_cache_enabled() {
        return Ok(());
    }
    THREAD_LOCAL_ENGINE.with(|cell| {
        let mut slot = cell.borrow_mut();
        if slot.as_mut().is_none() {
            let init_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
            match init_res {
                Ok(Ok(eng)) => *slot.as_mut() = Some(eng),
                Ok(Err(e)) => return Err(e),
                Err(panic_err) => {
                    return Err(format!(
                        "3D Transcoder failed to prewarm ThreeEngine (internal panic: {})",
                        panic_payload_message(&*panic_err)
                    ))
                }
            }
        }
        Ok(())
    })
}

/// Executes a function using either the cached thread-local ThreeEngine (if caching is enabled)
/// or a transient ThreeEngine fallback. If an error occurs in the cached engine, the engine
/// is discarded to ensure a clean VM on subsequent calls.
pub fn with_three_engine<F, R>(f: F) -> Result<R, String>
where
    F: FnOnce(&mut ThreeEngine) -> Result<R, String>,
{
    if is_thread_local_cache_enabled() {
        THREAD_LOCAL_ENGINE.with(|cell| {
            let mut slot = cell.borrow_mut();
            if slot.as_mut().is_none() {
                let init_res =
                    std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
                match init_res {
                    Ok(Ok(eng)) => *slot.as_mut() = Some(eng),
                    Ok(Err(e)) => return Err(e),
                    Err(panic_err) => {
                        return Err(format!(
                            "3D Transcoder failed to initialize ThreeEngine (internal panic: {})",
                            panic_payload_message(&*panic_err)
                        ));
                    }
                }
            }
            let engine = slot.as_mut().as_mut().unwrap();
            let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(engine)));
            match panic_res {
                Ok(Ok(res)) => Ok(res),
                Ok(Err(err)) => {
                    // On error, drop the cached engine to guarantee pristine recovery
                    slot.clear();
                    Err(err)
                }
                Err(panic_err) => {
                    // On panic, drop the contaminated engine and recover safely
                    slot.clear();
                    Err(format!(
                        "3D Transcoder encountered an internal panic ({}); safely recovered",
                        panic_payload_message(&*panic_err)
                    ))
                }
            }
        })
    } else {
        // Fallback: transient engine without thread-local caching
        let init_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(ThreeEngine::new));
        let mut engine = match init_res {
            Ok(Ok(eng)) => eng,
            Ok(Err(e)) => return Err(e),
            Err(panic_err) => {
                return Err(format!(
                    "3D Transcoder failed to initialize ThreeEngine (internal panic: {})",
                    panic_payload_message(&*panic_err)
                ));
            }
        };
        let panic_res = std::panic::catch_unwind(std::panic::AssertUnwindSafe(|| f(&mut engine)));
        match panic_res {
            Ok(res) => res,
            Err(panic_err) => Err(format!(
                "3D Transcoder encountered an internal panic ({}); safely recovered",
                panic_payload_message(&*panic_err)
            )),
        }
    }
}

#[derive(Debug, Clone, Default)]
pub struct ConversionResult {
    pub success: bool,
    pub glb_bytes: Vec<u8>,
    pub error_message: String,
}

/// Transcodes a Three.js scene-building script into binary GLB wire bytes.
/// Compatible with Crubit cc_bindings_from_rust.
pub fn transcode_three_to_glb(script: &str) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| {
        let scene = engine.execute(script)?;
        write_glb(&scene)
    })
}

/// Validates a Three.js script without serializing full GLB buffers.
pub fn validate_three_script(script: &str) -> Result<SceneGraph, String> {
    with_three_engine(|engine| engine.execute(script))
}

/// Transcodes a Three.js scene-building script into an Apple 64-byte aligned binary USDZ archive.
pub fn transcode_three_to_usdz(script: &str) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| engine.compile_usdz(script))
}

/// Transcodes a binary glTF 2.0 (GLB) buffer into an Apple 64-byte aligned binary USDZ archive.
pub fn transcode_glb_to_usdz(glb: &[u8]) -> Result<Vec<u8>, String> {
    with_three_engine(|engine| engine.glb_to_usdz(glb))
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn test_permissive_llm_fallbacks_compile_to_glb_and_usdz() {
        let script = r#"
            const aspect = window.innerWidth / window.innerHeight;
            const shaderMat = new THREE.ShaderMaterial({
                uniforms: { color: { value: new THREE.Color(0x00ff88) } },
                vertexShader: 'void main() { gl_Position = vec4(0.0); }',
                fragmentShader: 'void main() { gl_FragColor = vec4(1.0); }'
            });
            const icosa = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), shaderMat);
            scene.add(icosa);

            const capsule = new THREE.Mesh(
                new THREE.CapsuleGeometry(0.25, 0.8),
                new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
            );
            scene.add(capsule);

            const unknownMesh = new THREE.Mesh(
                new THREE.HallucinatedGeometry(1, 2),
                new THREE.HallucinatedMaterial()
            );
            scene.add(unknownMesh);

            const spot = new THREE.SpotLight(0xffffff, 2.0);
            spot.position.set(1, 3, 2);
            scene.add(spot);

            const controls = new THREE.OrbitControls(camera, document.createElement('canvas'));
            controls.update();

            function animate() {
                requestAnimationFrame(animate);
            }
            animate();
        "#;

        let glb = transcode_three_to_glb(script).expect(
            "LLM script with unsupported Three.js features should gracefully compile to GLB",
        );
        assert!(glb.len() > 100);
        assert_eq!(&glb[0..4], b"glTF");

        let usdz = transcode_three_to_usdz(script).expect(
            "LLM script with unsupported Three.js features should gracefully compile to USDZ",
        );
        assert!(usdz.len() > 100);
        assert_eq!(&usdz[0..2], b"PK");
    }
}
