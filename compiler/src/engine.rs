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

//! ThreeEngine runs Three.js scene-building scripts inside pure Rust Boa JS VM.
//!
//! Features:
//! - Direct zero-copy TypedArray extraction bypassing JSON.stringify/serde_json.
//! - Native Rust geometry kernels for complex procedural shapes.
//! - Resource quotas: execution ceiling, loop iteration limits, vertex & mesh quotas.

use crate::constants::*;
use crate::geometry::register_native_geometry_callables;
use crate::scene::{CameraConfig, Diagnostic, Light3D, Material3D, Mesh3D, SceneGraph, SceneNode};
use crate::time::Stopwatch;
use crate::usdz::register_native_usdz_callables;
use boa_engine::{
    builtins::typed_array::TypedArrayKind,
    js_string,
    object::builtins::{JsArray, JsArrayBuffer, JsTypedArray},
    Context, JsObject, JsString, JsValue, Source,
};

#[cfg(not(cargo_build))]
use three_author_engine_asset::EMBEDDED_THREE_AUTHOR_ENGINE_JS;

#[cfg(cargo_build)]
pub const EMBEDDED_THREE_AUTHOR_ENGINE_JS: &str =
    include_str!(concat!(env!("OUT_DIR"), "/three-author-engine.min.js"));

#[derive(Debug)]
enum RawExtractionError {
    Quota(String),
    Format(String),
}

pub struct ThreeEngine {
    context: Context,
    /// Set when the execution deadline forced us to abandon a running future, which
    /// leaves a call frame on the VM stack. The engine must not be reused afterwards.
    poisoned: bool,
}

/// Host hooks constraining what the sandboxed script may allocate.
///
/// `SECURITY_3D_MAX_HEAP_BYTES` was documented as the per-context heap ceiling but was
/// only ever applied per-buffer inside the extraction helpers — the Boa context itself
/// ran with the stock 1.5 GiB default. Enforcing it here catches the allocation at the
/// source, before any native hook gets a chance to be handed an oversized buffer.
#[derive(Debug, Clone, Copy)]
struct ThreeLiveHostHooks;

impl boa_engine::context::HostHooks for ThreeLiveHostHooks {
    fn max_buffer_size(&self, _context: &mut Context) -> u64 {
        SECURITY_3D_MAX_HEAP_BYTES as u64
    }
}

impl ThreeEngine {
    pub fn new() -> Result<Self, String> {
        let mut context = Context::builder()
            .host_hooks(std::rc::Rc::new(ThreeLiveHostHooks))
            .module_loader(std::rc::Rc::new(boa_engine::module::IdleModuleLoader))
            .build()
            .map_err(|e| format!("Failed to build JS context: {}", e))?;

        // 1. Set strict runtime limits for DoS / infinite loop protection
        let mut limits = boa_engine::vm::RuntimeLimits::default();
        limits.set_loop_iteration_limit(250_000);
        limits.set_recursion_limit(256);
        limits.set_stack_size_limit(1024 * 256);
        context.set_runtime_limits(limits);

        // 2. Register native SIMD geometry accelerators
        register_native_geometry_callables(&mut context)
            .map_err(|e| format!("Failed to register native geometry callables: {}", e))?;

        // 2.1. Register native USDZ accelerators
        register_native_usdz_callables(&mut context)
            .map_err(|e| format!("Failed to register native USDZ callables: {}", e))?;

        // 2.2. Initialize standard Web encoding polyfills backed by native Rust UTF-8 hooks
        let polyfills = r#"
            if (typeof TextEncoder === 'undefined') {
                globalThis.TextEncoder = class TextEncoder {
                    encode(str = '') {
                        return globalThis.__three_live_native_utf8_encode__(String(str));
                    }
                };
            }
            if (typeof TextDecoder === 'undefined') {
                globalThis.TextDecoder = class TextDecoder {
                    decode(bytes) {
                        if (bytes === undefined || bytes === null) return '';
                        return globalThis.__three_live_native_utf8_decode__(bytes);
                    }
                };
            }
        "#;
        context
            .eval(Source::from_bytes(polyfills.as_bytes()))
            .map_err(|e| format!("Failed to initialize encoding polyfills: {}", e))?;

        // 3. Pre-warm context with Three.js shim environment
        context
            .eval(Source::from_bytes(EMBEDDED_THREE_AUTHOR_ENGINE_JS.as_bytes()))
            .map_err(|e| format!("Failed to initialize THREE shim: {}", e))?;

        // 4. Harden VM intrinsics, freeze prototypes, and block dynamic code evaluation
        let hardening = r#"
            (() => {
                const freezeObjAndProto = (obj) => {
                    if (!obj) return;
                    try { Object.freeze(obj); } catch (_) {}
                    if (obj.prototype) {
                        try { Object.freeze(obj.prototype); } catch (_) {}
                    }
                };

                // Close every route back into the engine's *synchronous* evaluator.
                //
                // The execution deadline works by driving Boa's budgeted, yielding VM
                // loop and checking the wall clock at each yield. The `eval` builtin
                // and the `Function` constructor both run their body on the
                // synchronous runner, which does not return control until the body has
                // finished — so leaving either reachable would let a script opt out of
                // the deadline entirely with `eval("while(true){}")`. The authoring
                // engine uses neither.
                //
                // This has to run *before* the freeze pass: once a prototype is frozen,
                // its `constructor` back-reference can no longer be replaced, and
                // `(function(){}).constructor` is just as good as `Function`.
                const RealFunction = Function;
                const blockDynamicCode = function () {
                    throw new EvalError(
                        'Dynamic code evaluation is disabled in the Three-Live sandbox'
                    );
                };
                const dynamicCodeProtos = [];
                const collectProto = (sample) => {
                    try {
                        const proto = Object.getPrototypeOf(sample);
                        if (proto) dynamicCodeProtos.push(proto);
                    } catch (_) {}
                };
                collectProto(function () {});
                try { collectProto(function* () {}); } catch (_) {}
                try { collectProto(async function () {}); } catch (_) {}
                try { collectProto(async function* () {}); } catch (_) {}
                for (const proto of dynamicCodeProtos) {
                    try {
                        Object.defineProperty(proto, 'constructor', {
                            value: blockDynamicCode,
                            writable: false,
                            configurable: false
                        });
                    } catch (_) {}
                }
                for (const name of ['eval', 'Function']) {
                    try {
                        Object.defineProperty(globalThis, name, {
                            value: blockDynamicCode,
                            writable: false,
                            configurable: false
                        });
                    } catch (_) {}
                }

                // Bound String.prototype.repeat / padStart / padEnd to prevent single-call
                // multi-hundred-MB string allocations before any VM opcode yield occurs.
                //
                // This is a partial mitigation. `HostHooks::max_buffer_size` only covers
                // ArrayBuffer, and Boa exposes no general heap ceiling, so other
                // amplifiers (repeated `s += s`, `new Array(n).fill()`, `Array#join`)
                // can still allocate large amounts of memory between deadline checks.
                // Hostile-input deployments should also rely on process-level memory
                // limits.
                const MAX_SANDBOX_STRING_LEN = 4 * 1024 * 1024;
                const origRepeat = String.prototype.repeat;
                const origPadStart = String.prototype.padStart;
                const origPadEnd = String.prototype.padEnd;
                Object.defineProperty(String.prototype, 'repeat', {
                    value: function (count) {
                        const str = String(this);
                        const n = Number(count);
                        if (n > 0 && str.length * n > MAX_SANDBOX_STRING_LEN) {
                            throw new RangeError(
                                'SecurityError: String.prototype.repeat exceeds sandbox string limit'
                            );
                        }
                        return origRepeat.call(str, count);
                    },
                    writable: false,
                    configurable: false
                });
                Object.defineProperty(String.prototype, 'padStart', {
                    value: function (targetLength, padString) {
                        if (Number(targetLength) > MAX_SANDBOX_STRING_LEN) {
                            throw new RangeError(
                                'SecurityError: String.prototype.padStart exceeds sandbox string limit'
                            );
                        }
                        return origPadStart.call(this, targetLength, padString);
                    },
                    writable: false,
                    configurable: false
                });
                Object.defineProperty(String.prototype, 'padEnd', {
                    value: function (targetLength, padString) {
                        if (Number(targetLength) > MAX_SANDBOX_STRING_LEN) {
                            throw new RangeError(
                                'SecurityError: String.prototype.padEnd exceeds sandbox string limit'
                            );
                        }
                        return origPadEnd.call(this, targetLength, padString);
                    },
                    writable: false,
                    configurable: false
                });

                [
                    Object, Array, RealFunction, blockDynamicCode, String, Number, Boolean, RegExp, Date, Error,
                    Map, Set, Promise, ArrayBuffer, DataView,
                    Int8Array, Uint8Array, Uint8ClampedArray, Int16Array, Uint16Array,
                    Int32Array, Uint32Array, Float32Array, Float64Array,
                    Math, JSON, TextEncoder, TextDecoder
                ].forEach(freezeObjAndProto);


                if (typeof THREE === 'object' && THREE !== null) {
                    for (const key of Object.keys(THREE)) {
                        freezeObjAndProto(THREE[key]);
                    }
                    const authNs = globalThis.__THREE_LIVE_REGISTRY__?.authorNamespace;
                    if (authNs && typeof authNs === 'object') {
                        for (const key of Object.keys(authNs)) {
                            freezeObjAndProto(authNs[key]);
                        }
                        try { Object.freeze(authNs); } catch (_) {}
                    }
                    try { Object.freeze(THREE); } catch (_) {}
                    try {
                        Object.defineProperty(globalThis, 'THREE', {
                            value: THREE,
                            writable: false,
                            configurable: false
                        });
                    } catch (_) {}
                }
                if (typeof globalThis.document === 'object' && globalThis.document !== null) {
                    try {
                        if (globalThis.document.body) Object.freeze(globalThis.document.body);
                        if (globalThis.document.documentElement) Object.freeze(globalThis.document.documentElement);
                        Object.freeze(globalThis.document);
                        Object.defineProperty(globalThis, 'document', {
                            value: globalThis.document,
                            writable: false,
                            configurable: false
                        });
                    } catch (_) {}
                }
                if (typeof globalThis.window === 'object' && globalThis.window !== null && globalThis.window !== globalThis) {
                    try {
                        Object.freeze(globalThis.window);
                        Object.defineProperty(globalThis, 'window', {
                            value: globalThis.window,
                            writable: false,
                            configurable: false
                        });
                    } catch (_) {}
                }

                const nativeHooks = [
                    '__three_live_native_crc32__',
                    '__three_live_native_build_usdz_zip__',
                    '__three_live_native_format_usda_points__',
                    '__three_live_native_format_usda_uvs__',
                    '__three_live_native_format_usda_ints__',
                    '__three_live_native_utf8_encode__',
                    '__three_live_native_utf8_decode__',
                    '__three_live_native_encode_rgba_png__',
                    '__three_live_native_decode_b64_image__',
                    '__three_live_native_torus_knot__',
                    '__three_live_native_sphere__',
                    '__three_live_native_cylinder__',
                    '__three_live_native_box__',
                    '__three_live_native_plane__',
                    '__three_live_native_torus__',
                    '__three_live_native_csg_boolean__',
                    '__three_live_native_f32_array__',
                    '__three_live_native_index_array__',
                    '__three_live_native_compute_vertex_normals__'
                ];
                for (const hookName of nativeHooks) {
                    if (typeof globalThis[hookName] === 'function') {
                        const fn = globalThis[hookName];
                        try {
                            Object.defineProperty(globalThis, hookName, {
                                value: fn,
                                writable: false,
                                configurable: false
                            });
                        } catch (_) {}
                    }
                }

                const OriginalFunction = Function;
                const resetScene = globalThis.__three_live_reset_scene__;
                if (typeof resetScene === 'function') {
                    resetScene();
                }
                const baselineKeys = new Set(Reflect.ownKeys(globalThis));

                const scrubGlobals = () => {
                    if (typeof resetScene === 'function') {
                        resetScene();
                    }
                    for (const key of Reflect.ownKeys(globalThis)) {
                        if (!baselineKeys.has(key)) {
                            try { delete globalThis[key]; } catch (_) {}
                        }
                    }
                };

                Object.defineProperty(globalThis, '__three_live_scrub_globals__', {
                    value: scrubGlobals,
                    writable: false,
                    configurable: false
                });
            })();
        "#;
        context
            .eval(Source::from_bytes(hardening.as_bytes()))
            .map_err(|e| format!("Failed to harden VM environment: {}", e))?;

        Ok(Self { context, poisoned: false })
    }

    /// Resets the active scene, camera, and global properties on globalThis to pristine initial
    /// state.
    pub fn reset_scene(&mut self) -> Result<(), String> {
        // A poisoned context has an abandoned call frame still on the VM stack (see
        // `eval_isolated_script`). Evaluating anything further on it is undefined
        // behavior as far as the VM's own invariants go, and the engine is about to be
        // thrown away regardless, so there is nothing to reset.
        if self.poisoned {
            return Ok(());
        }
        let reset_call = "if (typeof __three_live_scrub_globals__ === 'function') { __three_live_scrub_globals__(); } else if (typeof __three_live_reset_scene__ === 'function') { __three_live_reset_scene__(); }";
        self.context
            .eval(Source::from_bytes(reset_call.as_bytes()))
            .map_err(|e| format!("Scene reset error: {}", e))?;
        Ok(())
    }

    /// Evaluates `source` under a preemptive wall-clock deadline (`ceiling_ms`) using
    /// Boa's opcode-budgeted async evaluator (`evaluate_async_with_budget`).
    fn eval_with_deadline(
        &mut self,
        source: &str,
        clock: &Stopwatch,
        ceiling_ms: u64,
        ceiling_name: &str,
        err_prefix: &str,
    ) -> Result<JsValue, String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        let parsed = boa_engine::Script::parse(
            Source::from_bytes(source.as_bytes()),
            None,
            &mut self.context,
        )
        .map_err(|e| format!("{}: {}", err_prefix, e))?;

        let mut future = std::pin::pin!(parsed
            .evaluate_async_with_budget(&mut self.context, SECURITY_3D_INTERRUPT_CHECK_OPCODES));

        let waker = std::task::Waker::noop();
        let mut task_cx = std::task::Context::from_waker(waker);

        // Nothing ever wakes this future from the outside: the only suspension point is
        // the engine's own budget yield, so we re-poll immediately and use the gap to
        // check the deadline.
        loop {
            match std::future::Future::poll(future.as_mut(), &mut task_cx) {
                std::task::Poll::Ready(Ok(val)) => return Ok(val),
                std::task::Poll::Ready(Err(e)) => return Err(format!("{}: {}", err_prefix, e)),
                std::task::Poll::Pending => {
                    let elapsed_ms = clock.elapsed_ms();
                    if elapsed_ms > ceiling_ms as f64 {
                        // Dropping the future here skips Boa's `pop_frame()`, leaving the
                        // context inconsistent. That is acceptable only because the engine
                        // is now unusable and we say so: `reset_scene` turns into a no-op
                        // and `with_three_engine` discards the cached engine on any `Err`.
                        self.poisoned = true;
                        return Err(format!(
                            "3D execution time ({:.1} ms) exceeded {} ({} ms)",
                            elapsed_ms, ceiling_name, ceiling_ms
                        ));
                    }
                }
            }
        }
    }

    /// Runs `script` through the isolated runner under a preemptive wall-clock deadline.
    ///
    /// The resource ceiling used to be measured only after the script had already
    /// returned, which made it a report rather than a limit. Boa's
    /// `loop_iteration_limit` was the intended backstop, but that counter lives on the
    /// `CallFrame` and is re-initialized to zero for every invocation — so a helper
    /// called in a loop simply multiplies the two budgets, and the recursion limit
    /// doesn't apply because the calls are sequential rather than nested. A short
    /// script could occupy the calling thread for a hundred seconds against a 500 ms
    /// ceiling. On Android that is an ANR, because a Kotlin coroutine cancellation
    /// cannot interrupt a blocking JNI call.
    ///
    /// `Script::evaluate_async_with_budget` yields at the VM instruction level, so the
    /// budget covers nested function frames. Driving it by hand lets us check the clock
    /// at every yield point and stop.
    fn eval_isolated_script(&mut self, script: &str, clock: &Stopwatch) -> Result<(), String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        // Scrub globals first. This is the trusted, bounded half of what the old
        // `__three_live_run_isolated__` JS helper did, so running it synchronously is
        // fine.
        self.context
            .eval(Source::from_bytes(b"__three_live_scrub_globals__();"))
            .map_err(|e| format!("Failed to reset sandbox globals: {}", e))?;

        // Parse the user source as a top-level script rather than handing it to the JS
        // `eval` builtin, which is what the old helper did. That detail is the whole
        // fix: `eval` runs its body on Boa's *synchronous* runner, so the body finishes
        // before control ever comes back to us and the outer frame's budget is never
        // consulted — the deadline simply would not fire.
        //
        // The block wrapper restores the one thing indirect `eval` gave us for free:
        // a fresh scope per run. At the top level of a script, `let`/`const`/`class`
        // land in the *global* lexical environment and survive into the next compile,
        // so a second script declaring the same name would fail with "duplicate
        // lexical declaration". `var` still reaches the global object, exactly as it
        // did under `eval`, and `__three_live_scrub_globals__` clears it.
        //
        // A script can of course close the block early. That costs it the isolation and
        // grants it nothing: the wrapper is a scoping device, not a privilege boundary,
        // and the code runs in the same realm with the same globals either way.
        let takes_dt = {
            let lower = script.to_ascii_lowercase();
            lower.contains("function animate(dt")
                || lower.contains("function animate(delta")
                || lower.contains("function animate(step")
                || lower.contains("animate = (dt")
                || lower.contains("animate = function(dt")
        };
        let wrapped = format!(
            "{{\n{}\n;\nif (typeof scene === 'object' && scene !== null && Array.isArray(scene.children)) {{ globalThis.scene = scene; }}\nif (typeof camera === 'object' && camera !== null && camera.position) {{ globalThis.camera = camera; }}\nif (typeof animate === 'function') {{ globalThis.animate = animate; globalThis.__three_live_animate_takes_dt__ = {}; }}\n}}",
            script, takes_dt
        );
        self.eval_with_deadline(
            &wrapped,
            clock,
            SECURITY_3D_EXECUTION_CEILING_MS,
            "SECURITY_3D_EXECUTION_CEILING_MS",
            "Three.js script error",
        )?;
        Ok(())
    }

    pub fn execute(&mut self, script: &str) -> Result<SceneGraph, String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        // 0. Check script length
        if script.len() > SECURITY_3D_MAX_SCRIPT_BYTES {
            return Err(format!(
                "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                script.len(),
                SECURITY_3D_MAX_SCRIPT_BYTES
            ));
        }

        let clock = Stopwatch::start();

        // 1. Evaluate script in isolated FunctionBody scope (also scrubs globals & resets scene).
        //    The ceiling is enforced *during* this call, not after it.
        if let Err(e) = self.eval_isolated_script(script, &clock) {
            let _ = self.reset_scene();
            return Err(e);
        }

        // 2. Zero Fallbacks: Direct ArrayBuffer extraction only
        let scene_graph = self.extract_scene_raw(&clock).map_err(|e| {
            let _ = self.reset_scene();
            match e {
                RawExtractionError::Quota(q_err) => q_err,
                RawExtractionError::Format(fmt_err) => {
                    format!("Direct scene graph extraction failed: {}", fmt_err)
                }
            }
        })?;

        // 3. Check the cumulative ceiling after extraction. Extraction walks native Rust data
        //    structures with no VM yield points, so it can only be checked after.
        let total_elapsed_ms = clock.elapsed_ms();
        if total_elapsed_ms > SECURITY_3D_EXECUTION_CEILING_MS as f64 {
            let _ = self.reset_scene();
            return Err(format!(
                "3D total execution time ({:.1} ms) exceeded SECURITY_3D_EXECUTION_CEILING_MS ({} ms)",
                total_elapsed_ms, SECURITY_3D_EXECUTION_CEILING_MS
            ));
        }

        // 5. Scrub globals and reset scene graph to free large geometry buffers in JS heap
        let _ = self.reset_scene();

        Ok(scene_graph)
    }

    /// Evaluates `script` at `t = 0.0` and steps `globalThis.animate(t, dt)` (or the
    /// captured `requestAnimationFrame` callback) at 60 Hz across each timestamp in
    /// `sample_times_sec`, returning the extracted [`SceneGraph`] at each requested timestamp.
    pub fn execute_time_series(
        &mut self,
        script: &str,
        sample_times_sec: &[f64],
    ) -> Result<Vec<SceneGraph>, String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        if script.len() > SECURITY_3D_MAX_SCRIPT_BYTES {
            return Err(format!(
                "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                script.len(),
                SECURITY_3D_MAX_SCRIPT_BYTES
            ));
        }

        let clock = Stopwatch::start();
        if let Err(e) = self.eval_isolated_script(script, &clock) {
            let _ = self.reset_scene();
            return Err(e);
        }

        let times: Vec<f64> =
            if sample_times_sec.is_empty() { vec![0.0] } else { sample_times_sec.to_vec() };
        let mut results = Vec::with_capacity(times.len());
        let mut current_t = 0.0f64;
        let dt = 1.0f64 / 60.0f64;

        for &target_t in &times {
            let clamped_t = target_t.clamp(0.0, 60.0);
            let span_dt = ((clamped_t - current_t) / 16.0).max(dt);
            while current_t + 1e-6 < clamped_t {
                let step_dt = (clamped_t - current_t).min(span_dt);
                current_t += step_dt;
                let step_call =
                    format!("__three_live_step_js__({:.6}, {:.6});", current_t, step_dt);
                if let Err(e) = self.eval_with_deadline(
                    &step_call,
                    &clock,
                    SECURITY_3D_TRANSCODE_CEILING_MS * 3,
                    "SECURITY_3D_TRANSCODE_CEILING_MS",
                    "animate(t) step error",
                ) {
                    let _ = self.reset_scene();
                    return Err(e);
                }
            }
            let extract_clock = Stopwatch::start();
            let sg = self.extract_scene_raw(&extract_clock).map_err(|e| {
                let _ = self.reset_scene();
                match e {
                    RawExtractionError::Quota(q_err) => q_err,
                    RawExtractionError::Format(fmt_err) => {
                        format!("Direct scene graph extraction failed: {}", fmt_err)
                    }
                }
            })?;
            results.push(sg);
        }

        let _ = self.reset_scene();
        Ok(results)
    }

    /// Directly compiles a Three.js scene script into an Apple 64-byte aligned USDZ archive.
    pub fn compile_usdz(&mut self, script: &str) -> Result<Vec<u8>, String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        if script.len() > SECURITY_3D_MAX_SCRIPT_BYTES {
            return Err(format!(
                "Script length ({} bytes) exceeds SECURITY_3D_MAX_SCRIPT_BYTES ({})",
                script.len(),
                SECURITY_3D_MAX_SCRIPT_BYTES
            ));
        }

        let clock = Stopwatch::start();

        // 1. Evaluate script in isolated FunctionBody scope, under the wall-clock deadline
        if let Err(e) = self.eval_isolated_script(script, &clock) {
            let _ = self.reset_scene();
            return Err(e);
        }

        // 3. Call scene.toUSDZ() with direct zero-copy native capture and preemptive deadline
        let usdz_call = "scene.toUSDZ();";
        let (eval_res, stashed_usdz) = crate::usdz::with_direct_usdz_capture(|| {
            self.eval_with_deadline(
                usdz_call,
                &clock,
                SECURITY_3D_TRANSCODE_CEILING_MS,
                "SECURITY_3D_TRANSCODE_CEILING_MS",
                "scene.toUSDZ() evaluation failed",
            )
        });
        let usdz_val = match eval_res {
            Ok(val) => val,
            Err(e) => {
                let _ = self.reset_scene();
                return Err(e);
            }
        };

        let usdz_bytes = match stashed_usdz {
            Some(bytes) => bytes,
            None => {
                crate::usdz::extract_byte_buffer(&usdz_val, &mut self.context).map_err(|e| {
                    let _ = self.reset_scene();
                    format!("Failed to extract USDZ binary bytes: {}", e)
                })?
            }
        };

        // 3. Check cumulative wall-clock ceiling after USDZ packaging.
        let total_elapsed_ms = clock.elapsed_ms();
        if total_elapsed_ms > SECURITY_3D_TRANSCODE_CEILING_MS as f64 {
            let _ = self.reset_scene();
            return Err(format!(
                "3D USDZ compilation time ({:.1} ms) exceeded SECURITY_3D_TRANSCODE_CEILING_MS ({} ms)",
                total_elapsed_ms, SECURITY_3D_TRANSCODE_CEILING_MS
            ));
        }

        // 4. Reset scene graph to free memory
        let _ = self.reset_scene();

        Ok(usdz_bytes)
    }

    /// Transcodes a binary glTF 2.0 (GLB) buffer into an Apple 64-byte aligned USDZ archive.
    pub fn glb_to_usdz(&mut self, glb: &[u8]) -> Result<Vec<u8>, String> {
        if self.poisoned {
            return Err("SecurityError: JS engine is poisoned after a prior timeout".to_string());
        }
        if glb.len() > SECURITY_3D_MAX_HEAP_BYTES {
            return Err(format!(
                "GLB input size ({} bytes) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                glb.len(),
                SECURITY_3D_MAX_HEAP_BYTES
            ));
        }

        let clock = Stopwatch::start();

        let uint8_arr = crate::usdz::js_uint8_array_from_slice(glb, &mut self.context)
            .map_err(|e| format!("Failed to create Uint8Array for GLB: {}", e))?;

        self.context
            .global_object()
            .set(js_string!("__three_live_temp_glb__"), uint8_arr, false, &mut self.context)
            .map_err(|e| format!("Failed to set temp GLB: {}", e))?;

        let convert_call = "(() => { try { return THREE.glbToUSDZ(__three_live_temp_glb__); } finally { delete globalThis.__three_live_temp_glb__; } })();";
        let (eval_res, stashed_usdz) = crate::usdz::with_direct_usdz_capture(|| {
            self.eval_with_deadline(
                convert_call,
                &clock,
                SECURITY_3D_TRANSCODE_CEILING_MS,
                "SECURITY_3D_TRANSCODE_CEILING_MS",
                "THREE.glbToUSDZ() failed",
            )
        });
        let usdz_val = eval_res?;

        let usdz_bytes = match stashed_usdz {
            Some(bytes) => bytes,
            None => crate::usdz::extract_byte_buffer(&usdz_val, &mut self.context)
                .map_err(|e| format!("Failed to extract converted USDZ binary bytes: {}", e))?,
        };

        let total_elapsed_ms = clock.elapsed_ms();
        if total_elapsed_ms > SECURITY_3D_TRANSCODE_CEILING_MS as f64 {
            let _ = self.reset_scene();
            return Err(format!(
                "GLB to USDZ conversion time ({:.1} ms) exceeded SECURITY_3D_TRANSCODE_CEILING_MS ({} ms)",
                total_elapsed_ms, SECURITY_3D_TRANSCODE_CEILING_MS
            ));
        }

        Ok(usdz_bytes)
    }

    /// High-performance zero-copy scene graph extraction directly from Boa VM objects.
    fn extract_scene_raw(&mut self, clock: &Stopwatch) -> Result<SceneGraph, RawExtractionError> {
        let extract_call = "__three_live_extract_scene_raw__()";
        let raw_val = self
            .eval_with_deadline(
                extract_call,
                clock,
                SECURITY_3D_EXECUTION_CEILING_MS,
                "SECURITY_3D_EXECUTION_CEILING_MS",
                "Raw extraction call failed",
            )
            .map_err(|e| {
                if e.contains("SECURITY_3D") || e.contains("exceeded") {
                    RawExtractionError::Quota(e)
                } else {
                    RawExtractionError::Format(e)
                }
            })?;

        let scene_obj = raw_val.as_object().ok_or_else(|| {
            RawExtractionError::Format("Raw extraction result is not an object".to_string())
        })?;

        // 1. Meshes
        let meshes_val = scene_obj
            .get(js_string!("meshes"), &mut self.context)
            .map_err(|e| RawExtractionError::Format(format!("Failed to get meshes: {}", e)))?;
        let meshes_obj = meshes_val
            .as_object()
            .ok_or_else(|| RawExtractionError::Format("Meshes is not an object".to_string()))?;
        let meshes_arr = JsArray::from_object(meshes_obj.clone())
            .map_err(|e| RawExtractionError::Format(format!("Meshes is not an array: {}", e)))?;

        let meshes_len = meshes_arr.length(&mut self.context).map_err(|e| {
            RawExtractionError::Format(format!("Failed to get meshes length: {}", e))
        })? as usize;

        if meshes_len > SECURITY_3D_MAX_MESHES {
            return Err(RawExtractionError::Quota(format!(
                "Scene exceeds maximum allowed meshes ({}/{})",
                meshes_len, SECURITY_3D_MAX_MESHES
            )));
        }

        let mut total_vertices = 0usize;
        let mut total_indices = 0usize;
        let mut rust_meshes = Vec::with_capacity(meshes_len);

        for i in 0..meshes_len {
            let mesh_val = meshes_arr.at(i as i64, &mut self.context).map_err(|e| {
                RawExtractionError::Format(format!("Failed to get mesh {}: {}", i, e))
            })?;
            let mesh_obj = mesh_val.as_object().ok_or_else(|| {
                RawExtractionError::Format(format!("Mesh {} is not an object", i))
            })?;

            let name = mesh_obj
                .get(js_string!("name"), &mut self.context)
                .ok()
                .and_then(|v| {
                    v.as_string().filter(|s| s.len() <= 1024).map(|s| s.to_std_string_escaped())
                })
                .unwrap_or_else(|| format!("Mesh_{}", i));

            let pos_val =
                mesh_obj.get(js_string!("pos"), &mut self.context).unwrap_or(JsValue::undefined());
            let pos_trans = extract_f32_3(&pos_val, [0.0, 0.0, 0.0], &mut self.context);

            let scale_val = mesh_obj
                .get(js_string!("scale"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let scale_trans = extract_f32_3(&scale_val, [1.0, 1.0, 1.0], &mut self.context);

            // Raw positions (source of truth for actual vertex count)
            let raw_pos_val = mesh_obj
                .get(js_string!("raw_positions"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let raw_positions =
                extract_float_buffer(&raw_pos_val, &mut self.context).map_err(|e| {
                    if e.contains("SECURITY_3D") || e.contains("exceeds") {
                        RawExtractionError::Quota(e)
                    } else {
                        RawExtractionError::Format(e)
                    }
                })?;

            let vertex_count = raw_positions.len() / 3;
            total_vertices = total_vertices.saturating_add(vertex_count);
            if total_vertices > SECURITY_3D_MAX_VERTICES {
                return Err(RawExtractionError::Quota(format!(
                    "Scene exceeds maximum allowed vertices ({}/{})",
                    total_vertices, SECURITY_3D_MAX_VERTICES
                )));
            }

            // Vertices stay in mesh-local space; the world offset/scale become the
            // glTF node's `translation`/`scale`, so runtime transforms (follow,
            // handles, KHR_interactivity pointers) pivot about the mesh origin
            // exactly as on the web.
            let mut positions = Vec::with_capacity(vertex_count);
            for chunk in raw_positions.as_chunks::<3>().0 {
                positions.push([chunk[0], chunk[1], chunk[2]]);
            }

            // Raw normals
            let raw_norm_val = mesh_obj
                .get(js_string!("raw_normals"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let raw_normals = extract_float_buffer(&raw_norm_val, &mut self.context)
                .map_err(RawExtractionError::Format)?;
            let mut normals = Vec::with_capacity(raw_normals.len() / 3);
            for chunk in raw_normals.as_chunks::<3>().0 {
                normals.push([chunk[0], chunk[1], chunk[2]]);
            }

            // Raw UVs
            let raw_uv_val = mesh_obj
                .get(js_string!("raw_uvs"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let raw_uvs = extract_float_buffer(&raw_uv_val, &mut self.context)
                .map_err(RawExtractionError::Format)?;
            let mut uvs = Vec::with_capacity(raw_uvs.len() / 2);
            for chunk in raw_uvs.as_chunks::<2>().0 {
                uvs.push([chunk[0], chunk[1]]);
            }

            // Raw indices
            let raw_idx_val = mesh_obj
                .get(js_string!("raw_indices"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let indices = extract_u32_buffer(&raw_idx_val, vertex_count, &mut self.context)
                .map_err(|e| {
                    if e.contains("SECURITY_3D")
                        || e.contains("exceeds")
                        || e.contains("out of bounds")
                    {
                        RawExtractionError::Quota(e)
                    } else {
                        RawExtractionError::Format(e)
                    }
                })?;

            total_indices = total_indices.saturating_add(indices.len());
            if total_indices > SECURITY_3D_MAX_INDICES {
                return Err(RawExtractionError::Quota(format!(
                    "Scene exceeds maximum allowed indices ({}/{})",
                    total_indices, SECURITY_3D_MAX_INDICES
                )));
            }

            let mat_idx_val = mesh_obj
                .get(js_string!("material_index"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let material_index = mat_idx_val.as_number().map(|n| n as usize);

            let xr_traits = mesh_obj
                .get(js_string!("xr_traits_json"), &mut self.context)
                .ok()
                .and_then(|v| {
                    v.as_string()
                        .filter(|s| s.len() <= 16 * 1024)
                        .map(|s| s.to_std_string_escaped())
                })
                .and_then(|json_str| serde_json::from_str::<serde_json::Value>(&json_str).ok());
            let xr_normalized = read_json_field(
                &mesh_obj,
                "xr_normalized_json",
                MAX_XR_JSON_BYTES,
                &mut self.context,
            );
            let xr_scenecore = read_json_field(
                &mesh_obj,
                "xr_scenecore_json",
                MAX_XR_JSON_BYTES,
                &mut self.context,
            );

            let variant_mappings = read_json_field(
                &mesh_obj,
                "variant_mappings_json",
                MAX_XR_JSON_BYTES,
                &mut self.context,
            );

            rust_meshes.push(Mesh3D {
                name,
                positions,
                normals,
                uvs,
                indices,
                material_index,
                variant_mappings,
                xr_traits,
                xr_normalized,
                xr_scenecore,
                xr_hubs: read_json_field(
                    &mesh_obj,
                    "xr_hubs_json",
                    MAX_XR_JSON_BYTES,
                    &mut self.context,
                ),
                translation: pos_trans,
                scale: scale_trans,
            });
        }

        // 2. Materials
        let mats_val = scene_obj
            .get(js_string!("materials"), &mut self.context)
            .unwrap_or(JsValue::undefined());
        let mut rust_materials = Vec::new();
        if let Some(mats_obj) = mats_val.as_object() {
            if let Ok(mats_arr) = JsArray::from_object(mats_obj.clone()) {
                let mats_len = (mats_arr.length(&mut self.context).unwrap_or(0) as usize)
                    .min(SECURITY_3D_MAX_MESHES);
                for i in 0..mats_len {
                    if let Ok(mat_val) = mats_arr.at(i as i64, &mut self.context) {
                        if let Some(mat_obj) = mat_val.as_object() {
                            let name = mat_obj
                                .get(js_string!("name"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= 1024)
                                        .map(|s| s.to_std_string_escaped())
                                })
                                .unwrap_or_else(|| format!("Material_{}", i));

                            let base_color_val = mat_obj
                                .get(js_string!("base_color"), &mut self.context)
                                .unwrap_or(JsValue::undefined());
                            let base_color = extract_f32_4(
                                &base_color_val,
                                [1.0, 1.0, 1.0, 1.0],
                                &mut self.context,
                            );

                            let metallic = mat_obj
                                .get(js_string!("metallic"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0) as f32;

                            let roughness = mat_obj
                                .get(js_string!("roughness"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.5) as f32;

                            let double_sided = mat_obj
                                .get(js_string!("double_sided"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_boolean())
                                .unwrap_or(true);

                            let base_color_texture = mat_obj
                                .get(js_string!("base_color_texture"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= SECURITY_3D_MAX_HEAP_BYTES)
                                        .map(|s| s.to_std_string_escaped())
                                });

                            let metallic_roughness_texture = mat_obj
                                .get(js_string!("metallic_roughness_texture"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= SECURITY_3D_MAX_HEAP_BYTES)
                                        .map(|s| s.to_std_string_escaped())
                                });

                            let normal_texture = mat_obj
                                .get(js_string!("normal_texture"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= SECURITY_3D_MAX_HEAP_BYTES)
                                        .map(|s| s.to_std_string_escaped())
                                });

                            let normal_scale = mat_obj
                                .get(js_string!("normal_scale"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .filter(|v| v.is_finite())
                                .unwrap_or(1.0)
                                as f32;

                            let emissive_val = mat_obj
                                .get(js_string!("emissive_factor"), &mut self.context)
                                .unwrap_or(JsValue::undefined());
                            let emissive_factor =
                                extract_f32_3(&emissive_val, [0.0, 0.0, 0.0], &mut self.context);

                            let emissive_texture = mat_obj
                                .get(js_string!("emissive_texture"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= SECURITY_3D_MAX_HEAP_BYTES)
                                        .map(|s| s.to_std_string_escaped())
                                });

                            let occlusion_texture = mat_obj
                                .get(js_string!("occlusion_texture"), &mut self.context)
                                .ok()
                                .and_then(|v| {
                                    v.as_string()
                                        .filter(|s| s.len() <= SECURITY_3D_MAX_HEAP_BYTES)
                                        .map(|s| s.to_std_string_escaped())
                                });

                            let occlusion_strength = mat_obj
                                .get(js_string!("occlusion_strength"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .filter(|v| v.is_finite())
                                .unwrap_or(1.0)
                                .clamp(0.0, 1.0)
                                as f32;

                            let clearcoat = mat_obj
                                .get(js_string!("clearcoat"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0) as f32;

                            let clearcoat_roughness = mat_obj
                                .get(js_string!("clearcoat_roughness"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0)
                                as f32;

                            let transmission = mat_obj
                                .get(js_string!("transmission"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0)
                                as f32;

                            let ior = mat_obj
                                .get(js_string!("ior"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(1.5) as f32;

                            let thickness = mat_obj
                                .get(js_string!("thickness"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0) as f32;

                            rust_materials.push(Material3D {
                                name,
                                base_color,
                                metallic,
                                roughness,
                                double_sided,
                                base_color_texture,
                                metallic_roughness_texture,
                                normal_texture,
                                normal_scale,
                                emissive_factor,
                                emissive_texture,
                                occlusion_texture,
                                occlusion_strength,
                                clearcoat,
                                clearcoat_roughness,
                                transmission,
                                ior,
                                thickness,
                            });
                        }
                    }
                }
            }
        }

        // 3. Lights
        let lights_val =
            scene_obj.get(js_string!("lights"), &mut self.context).unwrap_or(JsValue::undefined());
        let mut rust_lights = Vec::new();
        if let Some(lights_obj) = lights_val.as_object() {
            if let Ok(lights_arr) = JsArray::from_object(lights_obj.clone()) {
                let lights_len =
                    (lights_arr.length(&mut self.context).unwrap_or(0) as usize).min(64);
                for i in 0..lights_len {
                    if let Ok(light_val) = lights_arr.at(i as i64, &mut self.context) {
                        if let Some(light_obj) = light_val.as_object() {
                            let light_type = light_obj
                                .get(js_string!("light_type"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_string().map(|s| s.to_std_string_escaped()))
                                .unwrap_or_else(|| "directional".to_string());

                            let color_val = light_obj
                                .get(js_string!("color"), &mut self.context)
                                .unwrap_or(JsValue::undefined());
                            let color =
                                extract_f32_3(&color_val, [1.0, 1.0, 1.0], &mut self.context);

                            let intensity = light_obj
                                .get(js_string!("intensity"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(1.0) as f32;

                            let pos_val = light_obj
                                .get(js_string!("position"), &mut self.context)
                                .unwrap_or(JsValue::undefined());
                            let position =
                                extract_f32_3(&pos_val, [0.0, 10.0, 10.0], &mut self.context);

                            let dir_val = light_obj
                                .get(js_string!("direction"), &mut self.context)
                                .unwrap_or(JsValue::undefined());
                            let direction = if dir_val.is_undefined() || dir_val.is_null() {
                                None
                            } else {
                                Some(extract_f32_3(&dir_val, [0.0, -1.0, 0.0], &mut self.context))
                            };

                            let range = light_obj
                                .get(js_string!("range"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0) as f32;

                            let inner_cone_angle = light_obj
                                .get(js_string!("inner_cone_angle"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(0.0)
                                as f32;

                            let outer_cone_angle = light_obj
                                .get(js_string!("outer_cone_angle"), &mut self.context)
                                .ok()
                                .and_then(|v| v.as_number())
                                .unwrap_or(std::f64::consts::FRAC_PI_3)
                                as f32;

                            rust_lights.push(Light3D {
                                light_type,
                                color,
                                intensity,
                                position,
                                direction,
                                range,
                                inner_cone_angle,
                                outer_cone_angle,
                            });
                        }
                    }
                }
            }
        }

        // 4. Camera
        let cam_val =
            scene_obj.get(js_string!("camera"), &mut self.context).unwrap_or(JsValue::undefined());
        let mut camera_config = None;
        if let Some(cam_obj) = cam_val.as_object() {
            let fov = cam_obj
                .get(js_string!("fov"), &mut self.context)
                .ok()
                .and_then(|v| v.as_number())
                .unwrap_or(45.0) as f32;

            let pos_val = cam_obj
                .get(js_string!("position"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let position = extract_f32_3(&pos_val, [0.0, 0.0, 5.0], &mut self.context);

            let target_val = cam_obj
                .get(js_string!("target"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let target = extract_f32_3(&target_val, [0.0, 0.0, 0.0], &mut self.context);

            camera_config = Some(CameraConfig { fov, position, target });
        }

        let interactivity = read_json_field(
            &scene_obj,
            "interactivity_json",
            MAX_INTERACTIVITY_JSON_BYTES,
            &mut self.context,
        )
        .filter(|v| v.is_object());

        let variants = read_json_field(
            &scene_obj,
            "variants_json",
            MAX_INTERACTIVITY_JSON_BYTES,
            &mut self.context,
        )
        .filter(|v| v.is_object());

        let diagnostics: Vec<Diagnostic> = scene_obj
            .get(js_string!("diagnostics_json"), &mut self.context)
            .ok()
            .and_then(|v| {
                v.as_string()
                    .filter(|s| s.len() <= MAX_INTERACTIVITY_JSON_BYTES)
                    .map(|s| s.to_std_string_escaped())
            })
            .and_then(|json_str| serde_json::from_str::<Vec<Diagnostic>>(&json_str).ok())
            .unwrap_or_default();

        // 5. Scene hierarchy (absent on legacy engine assets -> flat layout).
        let nodes = self.extract_nodes(&scene_obj, rust_meshes.len())?;

        Ok(SceneGraph {
            meshes: rust_meshes,
            materials: rust_materials,
            lights: rust_lights,
            camera: camera_config,
            interactivity,
            variants,
            nodes,
            diagnostics,
        })
    }

    /// Reads and validates `raw_nodes` (the `nodes` array of the extraction
    /// result). Every node's parent must precede it (a forest with no cycles),
    /// mesh references must be in range, and transforms are sanitized to finite
    /// values with a unit quaternion.
    fn extract_nodes(
        &mut self,
        scene_obj: &JsObject,
        mesh_count: usize,
    ) -> Result<Vec<SceneNode>, RawExtractionError> {
        let nodes_val = scene_obj
            .get(js_string!("nodes"), &mut self.context)
            .map_err(|e| RawExtractionError::Format(format!("Failed to get nodes: {}", e)))?;
        if nodes_val.is_undefined() || nodes_val.is_null() {
            return Ok(Vec::new());
        }
        let nodes_arr = nodes_val
            .as_object()
            .and_then(|o| JsArray::from_object(o.clone()).ok())
            .ok_or_else(|| RawExtractionError::Format("Nodes is not an array".to_string()))?;
        let nodes_len = nodes_arr
            .length(&mut self.context)
            .map_err(|e| RawExtractionError::Format(format!("Failed to get nodes length: {}", e)))?
            as usize;
        if nodes_len > MAX_SCENE_NODES {
            return Err(RawExtractionError::Quota(format!(
                "Scene exceeds maximum allowed nodes ({}/{})",
                nodes_len, MAX_SCENE_NODES
            )));
        }

        let mut nodes = Vec::with_capacity(nodes_len);
        for i in 0..nodes_len {
            let node_val = nodes_arr.at(i as i64, &mut self.context).map_err(|e| {
                RawExtractionError::Format(format!("Failed to get node {}: {}", i, e))
            })?;
            let node_obj = node_val.as_object().ok_or_else(|| {
                RawExtractionError::Format(format!("Node {} is not an object", i))
            })?;

            let name = node_obj
                .get(js_string!("name"), &mut self.context)
                .ok()
                .and_then(|v| {
                    v.as_string().filter(|s| s.len() <= 1024).map(|s| s.to_std_string_escaped())
                })
                .unwrap_or_default();

            let parent = match read_index(&node_obj, "parent", &mut self.context) {
                IndexField::None => None,
                IndexField::Some(p) if p < i => Some(p),
                _ => {
                    return Err(RawExtractionError::Format(format!(
                        "Node {} has an invalid parent (must precede the node)",
                        i
                    )))
                }
            };
            let mesh = match read_index(&node_obj, "mesh", &mut self.context) {
                IndexField::None => None,
                IndexField::Some(m) if m < mesh_count => Some(m),
                _ => {
                    return Err(RawExtractionError::Format(format!(
                        "Node {} references an invalid mesh",
                        i
                    )))
                }
            };

            let t_val = node_obj
                .get(js_string!("translation"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let r_val = node_obj
                .get(js_string!("rotation"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let s_val = node_obj
                .get(js_string!("scale"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let translation =
                finite_or(extract_f32_3(&t_val, [0.0; 3], &mut self.context), [0.0; 3]);
            let rotation =
                unit_quaternion(extract_f32_4(&r_val, [0.0, 0.0, 0.0, 1.0], &mut self.context));
            let scale = finite_or(extract_f32_3(&s_val, [1.0; 3], &mut self.context), [1.0; 3]);

            let (xr_traits, xr_normalized, xr_scenecore, xr_hubs) =
                read_xr_fields(&node_obj, &mut self.context);

            let inst_mat_val = node_obj
                .get(js_string!("instance_matrices"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let instance_matrices =
                extract_float_buffer(&inst_mat_val, &mut self.context).unwrap_or_default();

            let inst_col_val = node_obj
                .get(js_string!("instance_colors"), &mut self.context)
                .unwrap_or(JsValue::undefined());
            let instance_colors =
                extract_float_buffer(&inst_col_val, &mut self.context).unwrap_or_default();

            let interactivity_events: Vec<String> = node_obj
                .get(js_string!("interactivity_events_json"), &mut self.context)
                .ok()
                .and_then(|v| {
                    v.as_string().filter(|s| s.len() <= 4096).map(|s| s.to_std_string_escaped())
                })
                .and_then(|json_str| serde_json::from_str::<Vec<String>>(&json_str).ok())
                .unwrap_or_default();

            let interactivity = read_json_field(
                &node_obj,
                "interactivity_raw_json",
                MAX_XR_JSON_BYTES,
                &mut self.context,
            );

            let visible = node_obj
                .get(js_string!("visible"), &mut self.context)
                .ok()
                .and_then(|v| v.as_boolean())
                .unwrap_or(true);

            nodes.push(SceneNode {
                name,
                parent,
                translation,
                rotation,
                scale,
                mesh,
                xr_traits,
                xr_normalized,
                xr_scenecore,
                xr_hubs,
                instance_matrices,
                instance_colors,
                interactivity_events,
                interactivity,
                visible,
            });
        }
        Ok(nodes)
    }
}

/// Parses Boa JS parse/runtime errors into a structured `TL100` (syntax/runtime) or
/// `TL105` (security/quota) [`Diagnostic`], adjusting line numbers by `-1` for the
/// `{\n` block wrapper in [`ThreeEngine::eval_isolated_script`].
pub fn classify_script_error(err_msg: &str, script: &str) -> Diagnostic {
    let lower = err_msg.to_ascii_lowercase();
    let is_quota = err_msg.contains("SECURITY_3D")
        || lower.contains("exceeded")
        || lower.contains("exceeds")
        || lower.contains("maximum allowed")
        || lower.contains("loop iteration limit")
        || lower.contains("recursion limit")
        || lower.contains("stack size limit")
        || lower.contains("sandbox string limit")
        || lower.contains("poisoned")
        || lower.contains("out of bounds");

    if is_quota {
        return Diagnostic {
            code: "TL105".to_string(),
            severity: "error".to_string(),
            message: err_msg.to_string(),
            node: None,
            line: None,
            column: None,
            hint: Some(
                "Reduce geometry segment counts, use THREE.InstancedMesh for repeated props, or keep scripts within SECURITY_3D_MAX_* quotas."
                    .to_string(),
            ),
        };
    }

    let max_line = script.lines().count().max(1) as u32;
    let (raw_line, column) = parse_boa_line_col(err_msg);
    let line = raw_line.map(|l| l.saturating_sub(1).clamp(1, max_line));

    let hint = if err_msg.contains("EvalError") || err_msg.contains("Dynamic code evaluation") {
        "Avoid eval() and new Function(); write declarative Three.js scene construction directly."
    } else if err_msg.contains("ReferenceError") {
        "Use standard Three.js globals provided by the sandbox: THREE, scene, camera, window, document."
    } else {
        "Fix the JavaScript syntax or runtime error in your Three.js scene script."
    };

    Diagnostic {
        code: "TL100".to_string(),
        severity: "error".to_string(),
        message: err_msg.to_string(),
        node: None,
        line,
        column,
        hint: Some(hint.to_string()),
    }
}

fn parse_boa_line_col(msg: &str) -> (Option<u32>, Option<u32>) {
    // Pattern 1: "at line <L>, col <C>" or "at line <L>, column <C>"
    let lower = msg.to_ascii_lowercase();
    if let Some(pos) = lower.find("line ") {
        let rest = &lower[pos + 5..];
        let line_digits: String = rest.chars().take_while(|c| c.is_ascii_digit()).collect();
        if let Ok(line) = line_digits.parse::<u32>() {
            let after_line = &rest[line_digits.len()..];
            let col = after_line
                .find("col")
                .map(|cpos| {
                    let after_col = &after_line[cpos..];
                    let digits: String = after_col
                        .chars()
                        .skip_while(|c| !c.is_ascii_digit())
                        .take_while(|c| c.is_ascii_digit())
                        .collect();
                    digits.parse::<u32>().ok()
                })
                .flatten();
            return (Some(line), col);
        }
    }
    // Pattern 2: ":<L>:<C>" at the end or inside parentheses
    let bytes = msg.as_bytes();
    for i in 0..bytes.len() {
        if bytes[i] == b':' || bytes[i] == b'(' {
            let s1 = &msg[i + 1..];
            let d1: String = s1.chars().take_while(|c| c.is_ascii_digit()).collect();
            if !d1.is_empty() && s1[d1.len()..].starts_with(':') {
                let s2 = &s1[d1.len() + 1..];
                let d2: String = s2.chars().take_while(|c| c.is_ascii_digit()).collect();
                if !d2.is_empty() {
                    if let (Ok(l), Ok(c)) = (d1.parse::<u32>(), d2.parse::<u32>()) {
                        return (Some(l), Some(c));
                    }
                }
            }
        }
    }
    (None, None)
}

/// Maximum number of glTF nodes (groups, lights, empties and meshes).
pub(crate) const MAX_SCENE_NODES: usize = SECURITY_3D_MAX_MESHES * 4;

/// A non-negative integer index field; `-1`, `null` and absent mean "none".
enum IndexField {
    None,
    Some(usize),
    Invalid,
}

fn read_index(obj: &JsObject, key: &str, context: &mut Context) -> IndexField {
    let v = obj.get(JsString::from(key), context).unwrap_or(JsValue::undefined());
    if v.is_undefined() || v.is_null() {
        return IndexField::None;
    }
    match v.as_number() {
        Some(n) if n == -1.0 => IndexField::None,
        Some(n) if n >= 0.0 && n.fract() == 0.0 && n < usize::MAX as f64 => {
            IndexField::Some(n as usize)
        }
        _ => IndexField::Invalid,
    }
}

/// Replaces each non-finite component with the corresponding default.
fn finite_or<const N: usize>(v: [f32; N], default: [f32; N]) -> [f32; N] {
    let mut out = v;
    for i in 0..N {
        if !out[i].is_finite() {
            out[i] = default[i];
        }
    }
    out
}

/// Returns a finite unit quaternion: non-finite or zero-length input becomes the
/// identity, and a non-unit quaternion is normalized (glTF requires unit
/// rotations).
fn unit_quaternion(q: [f32; 4]) -> [f32; 4] {
    const IDENTITY: [f32; 4] = [0.0, 0.0, 0.0, 1.0];
    if !q.iter().all(|c| c.is_finite()) {
        return IDENTITY;
    }
    let len = q.iter().map(|c| (*c as f64) * (*c as f64)).sum::<f64>().sqrt();
    if !len.is_finite() || len < 1e-12 {
        return IDENTITY;
    }
    if (len - 1.0).abs() <= 1e-5 {
        return q;
    }
    [
        (q[0] as f64 / len) as f32,
        (q[1] as f64 / len) as f32,
        (q[2] as f64 / len) as f32,
        (q[3] as f64 / len) as f32,
    ]
}

/// Raw / canonical normalized / SceneCore / Hubs XR trait payloads.
type XrFields = (
    Option<serde_json::Value>,
    Option<serde_json::Value>,
    Option<serde_json::Value>,
    Option<serde_json::Value>,
);

/// Reads the four per-node XR trait JSON payloads, each bounded by
/// [`MAX_XR_JSON_BYTES`].
fn read_xr_fields(obj: &JsObject, context: &mut Context) -> XrFields {
    (
        read_json_field(obj, "xr_traits_json", MAX_XR_JSON_BYTES, context),
        read_json_field(obj, "xr_normalized_json", MAX_XR_JSON_BYTES, context),
        read_json_field(obj, "xr_scenecore_json", MAX_XR_JSON_BYTES, context),
        read_json_field(obj, "xr_hubs_json", MAX_XR_JSON_BYTES, context),
    )
}

/// Maximum size of a per-mesh canonical XR trait JSON payload.
const MAX_XR_JSON_BYTES: usize = 16 * 1024;
/// Maximum size of the compiled scene `KHR_interactivity` JSON payload.
const MAX_INTERACTIVITY_JSON_BYTES: usize = 256 * 1024;

/// Reads an optional JSON-string field from a JS object and parses it, ignoring
/// non-strings, oversized payloads, and malformed JSON.
fn read_json_field(
    obj: &JsObject,
    key: &str,
    max_bytes: usize,
    context: &mut Context,
) -> Option<serde_json::Value> {
    obj.get(JsString::from(key), context)
        .ok()
        .and_then(|v| {
            v.as_string().filter(|s| s.len() <= max_bytes).map(|s| s.to_std_string_escaped())
        })
        .and_then(|json_str| serde_json::from_str::<serde_json::Value>(&json_str).ok())
}

/// Maximum number of floats any single geometry attribute may carry.
///
/// Derived from the vertex quota (3 components per vertex for the widest attribute)
/// rather than from the generic heap ceiling. `SECURITY_3D_MAX_HEAP_BYTES` allowed
/// ~4.19M floats here — roughly 14x more than the quota downstream would ever accept
/// — so a rejected buffer still cost a ~50 MB transient allocation on the way to
/// being thrown away.
const MAX_ATTRIBUTE_FLOATS: usize = SECURITY_3D_MAX_VERTICES * 3;

pub(crate) fn extract_float_buffer(
    val: &JsValue,
    context: &mut Context,
) -> Result<Vec<f32>, String> {
    if let Some(obj) = val.as_object() {
        if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
            let buf_val =
                typed_arr.buffer(context).map_err(|e| format!("Buffer access error: {}", e))?;
            if let Some(buf_obj) = buf_val.as_object() {
                if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                    if let Some(data) = arr_buf.data() {
                        let offset = typed_arr.byte_offset(context).unwrap_or(0);
                        let len = typed_arr
                            .byte_length(context)
                            .unwrap_or(data.len().saturating_sub(offset));
                        let end = offset.saturating_add(len).min(data.len());
                        let start = offset.min(end);
                        let slice = &data[start..end];

                        // The element type has to be checked before reinterpreting the
                        // bytes. Reading a Float64Array as f32 doesn't fail, it just
                        // yields twice as many meaningless values — which then flows
                        // straight into the glTF accessor counts.
                        let kind = typed_arr.kind();
                        let floats: Vec<f32> = match kind {
                            Some(TypedArrayKind::Float32) => {
                                let count = slice.len() / 4;
                                if count > MAX_ATTRIBUTE_FLOATS {
                                    return Err(format!(
                                        "Float32Array length ({}) exceeds SECURITY_3D_MAX_VERTICES * 3 ({})",
                                        count, MAX_ATTRIBUTE_FLOATS
                                    ));
                                }
                                slice
                                    .as_chunks::<4>()
                                    .0
                                    .iter()
                                    .map(|c| f32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                                    .collect()
                            }
                            Some(TypedArrayKind::Float64) => {
                                let count = slice.len() / 8;
                                if count > MAX_ATTRIBUTE_FLOATS {
                                    return Err(format!(
                                        "Float64Array length ({}) exceeds SECURITY_3D_MAX_VERTICES * 3 ({})",
                                        count, MAX_ATTRIBUTE_FLOATS
                                    ));
                                }
                                slice
                                    .as_chunks::<8>()
                                    .0
                                    .iter()
                                    .map(|c| {
                                        f64::from_ne_bytes([
                                            c[0], c[1], c[2], c[3], c[4], c[5], c[6], c[7],
                                        ]) as f32
                                    })
                                    .collect()
                            }
                            other => {
                                return Err(format!(
                                    "Geometry attribute must be a Float32Array or Float64Array, got {:?}",
                                    other
                                ));
                            }
                        };
                        return Ok(floats);
                    }
                }
            }
        }
        if let Ok(js_arr) = JsArray::from_object(obj.clone()) {
            let len = js_arr.length(context).unwrap_or(0) as usize;
            if len > MAX_ATTRIBUTE_FLOATS {
                return Err(format!(
                    "Float array length ({}) exceeds SECURITY_3D_MAX_VERTICES * 3 ({})",
                    len, MAX_ATTRIBUTE_FLOATS
                ));
            }
            let mut floats = Vec::with_capacity(len);
            for i in 0..len {
                let v = js_arr.at(i as i64, context).unwrap_or(JsValue::undefined());
                floats.push(v.as_number().unwrap_or(0.0) as f32);
            }
            return Ok(floats);
        }
    }
    Ok(Vec::new())
}

fn extract_u32_buffer(
    val: &JsValue,
    default_count: usize,
    context: &mut Context,
) -> Result<Vec<u32>, String> {
    let indices = if let Some(obj) = val.as_object() {
        if let Ok(typed_arr) = JsTypedArray::from_object(obj.clone()) {
            let buf_val =
                typed_arr.buffer(context).map_err(|e| format!("Buffer access error: {}", e))?;
            if let Some(buf_obj) = buf_val.as_object() {
                if let Ok(arr_buf) = JsArrayBuffer::from_object(buf_obj.clone()) {
                    if let Some(data) = arr_buf.data() {
                        let offset = typed_arr.byte_offset(context).unwrap_or(0);
                        let len = typed_arr
                            .byte_length(context)
                            .unwrap_or(data.len().saturating_sub(offset));
                        let end = offset.saturating_add(len).min(data.len());
                        let start = offset.min(end);
                        let slice = &data[start..end];
                        if slice.len() > SECURITY_3D_MAX_HEAP_BYTES {
                            return Err(format!(
                                "Index TypedArray byte length ({}) exceeds SECURITY_3D_MAX_HEAP_BYTES ({})",
                                slice.len(),
                                SECURITY_3D_MAX_HEAP_BYTES
                            ));
                        }
                        if typed_arr.kind() == Some(TypedArrayKind::Uint16) {
                            slice
                                .as_chunks::<2>()
                                .0
                                .iter()
                                .map(|c| u16::from_ne_bytes([c[0], c[1]]) as u32)
                                .collect()
                        } else {
                            slice
                                .as_chunks::<4>()
                                .0
                                .iter()
                                .map(|c| u32::from_ne_bytes([c[0], c[1], c[2], c[3]]))
                                .collect()
                        }
                    } else {
                        Vec::new()
                    }
                } else {
                    Vec::new()
                }
            } else {
                Vec::new()
            }
        } else if let Ok(js_arr) = JsArray::from_object(obj.clone()) {
            let len = js_arr.length(context).unwrap_or(0) as usize;
            if len > SECURITY_3D_MAX_INDICES {
                return Err(format!(
                    "Index array length ({}) exceeds SECURITY_3D_MAX_INDICES ({})",
                    len, SECURITY_3D_MAX_INDICES
                ));
            }
            let mut arr_indices = Vec::with_capacity(len);
            for i in 0..len {
                let v = js_arr.at(i as i64, context).unwrap_or(JsValue::undefined());
                arr_indices.push(v.as_number().unwrap_or(0.0) as u32);
            }
            arr_indices
        } else {
            (0..default_count as u32).collect()
        }
    } else {
        (0..default_count as u32).collect()
    };

    if indices.len() > SECURITY_3D_MAX_INDICES {
        return Err(format!(
            "Index buffer count ({}) exceeds SECURITY_3D_MAX_INDICES ({})",
            indices.len(),
            SECURITY_3D_MAX_INDICES
        ));
    }

    if default_count > 0 {
        let max_idx = default_count as u32;
        for &idx in &indices {
            if idx >= max_idx {
                return Err(format!(
                    "Vertex index out of bounds: index {} >= vertex_count {}",
                    idx, max_idx
                ));
            }
        }
    } else if !indices.is_empty() {
        return Err("Non-empty index buffer on mesh with 0 vertices".to_string());
    }

    Ok(indices)
}

fn extract_f32_3(val: &JsValue, default: [f32; 3], context: &mut Context) -> [f32; 3] {
    if let Some(obj) = val.as_object() {
        if let Ok(arr) = JsArray::from_object(obj.clone()) {
            let x = arr.at(0, context).ok().and_then(|v| v.as_number()).unwrap_or(default[0] as f64)
                as f32;
            let y = arr.at(1, context).ok().and_then(|v| v.as_number()).unwrap_or(default[1] as f64)
                as f32;
            let z = arr.at(2, context).ok().and_then(|v| v.as_number()).unwrap_or(default[2] as f64)
                as f32;
            return [x, y, z];
        }
    }
    default
}

fn extract_f32_4(val: &JsValue, default: [f32; 4], context: &mut Context) -> [f32; 4] {
    if let Some(obj) = val.as_object() {
        if let Ok(arr) = JsArray::from_object(obj.clone()) {
            let x = arr.at(0, context).ok().and_then(|v| v.as_number()).unwrap_or(default[0] as f64)
                as f32;
            let y = arr.at(1, context).ok().and_then(|v| v.as_number()).unwrap_or(default[1] as f64)
                as f32;
            let z = arr.at(2, context).ok().and_then(|v| v.as_number()).unwrap_or(default[2] as f64)
                as f32;
            let w = arr.at(3, context).ok().and_then(|v| v.as_number()).unwrap_or(default[3] as f64)
                as f32;
            return [x, y, z, w];
        }
    }
    default
}
