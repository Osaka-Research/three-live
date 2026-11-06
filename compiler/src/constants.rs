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

//! Execution limits, ceilings, and quotas for 3D Transcoding.

/// Maximum wall-clock time permitted for *untrusted script* execution, in milliseconds.
///
/// This is the security-critical bound. It is what stops hostile or runaway AI-generated
/// script from occupying the calling thread, and `ThreeEngine::eval_isolated_script`
/// enforces it *preemptively* — the clock is re-checked every
/// `SECURITY_3D_INTERRUPT_CHECK_OPCODES` opcodes and the script is abandoned mid-execution
/// once it is exceeded. Keep this tight; it bounds the damage a malicious script can do.
///
/// The debug value is deliberately generous because an unoptimized Boa interpreter is
/// roughly 25x slower than a release build, and CI runners are slower still. It is a
/// flake guard, not a second opinion on the production budget.
#[cfg(debug_assertions)]
pub const SECURITY_3D_EXECUTION_CEILING_MS: u64 = 2_000;
#[cfg(not(debug_assertions))]
pub const SECURITY_3D_EXECUTION_CEILING_MS: u64 = 500;

/// Maximum wall-clock time permitted for *binary asset packaging and transcoding*, in
/// milliseconds — `scene.toUSDZ()` and `THREE.glbToUSDZ()`.
///
/// This is a performance-regression tripwire rather than a security bound, and it is
/// separate from `SECURITY_3D_EXECUTION_CEILING_MS` for a reason. The work it covers runs
/// *trusted* author-engine code over input whose size is already capped by
/// `SECURITY_3D_MAX_HEAP_BYTES`, and its cost scales with model complexity rather than with
/// anything an attacker controls directly. Folding it into the script ceiling would force
/// that ceiling up by an order of magnitude and give back most of the DoS protection the
/// preemptive deadline buys.
///
/// Measured baseline: GLB -> USDZ of a 16x16 sphere costs 41-52 ms in a release LTO build
/// on a workstation, measured across both an idle machine and a fully parallel test run.
/// The previous 50 ms limit sat about 6% above that, which is why it failed intermittently
/// rather than consistently. The value here leaves roughly 20x headroom for larger models
/// and slower mobile hardware; tighten it if the transcode path is optimized.
#[cfg(debug_assertions)]
pub const SECURITY_3D_TRANSCODE_CEILING_MS: u64 = 20_000;
#[cfg(not(debug_assertions))]
pub const SECURITY_3D_TRANSCODE_CEILING_MS: u64 = 1_000;

/// Instruction check interval (opcodes executed) before re-checking wall-clock deadline in the interrupt hook.
pub const SECURITY_3D_INTERRUPT_CHECK_OPCODES: u32 = 10_000;

/// Maximum heap allocation allowed per 3D context in bytes (16 MB).
pub const SECURITY_3D_MAX_HEAP_BYTES: usize = 16 * 1024 * 1024;

/// Maximum vertex count per 3D scene (prevents GPU/memory exhaustion).
pub const SECURITY_3D_MAX_VERTICES: usize = 100_000;

/// Maximum sub-meshes allowed in a single 3D scene.
pub const SECURITY_3D_MAX_MESHES: usize = 1_000;

/// Maximum triangle index count per 3D scene.
pub const SECURITY_3D_MAX_INDICES: usize = 300_000;

/// Maximum texture assets referenced in a single 3D scene.
pub const SECURITY_3D_MAX_TEXTURES: usize = 16;

/// Maximum texture dimension (width or height) in pixels.
///
/// Enforcement point: the JavaScript authoring layer (injected via `DEFAULT_DEFINES`
/// in `scripts/build.js`). The Rust compiler never decodes texture payloads — it only
/// records URIs — so it has no pixel dimensions to validate against.
pub const SECURITY_3D_MAX_TEXTURE_DIMENSION: u32 = 2048;

/// Client-side sandboxed 3D execution watchdog timeout in milliseconds.
///
/// Enforcement point: the JavaScript host (Web Worker watchdog). This is the outer
/// bound around a whole compile request; the inner, per-script bound that the Rust
/// engine enforces is `SECURITY_3D_EXECUTION_CEILING_MS`.
pub const SECURITY_3D_SANDBOX_TIMEOUT_MS: u64 = 3_000;

/// Maximum procedural 3D script source length in bytes (1 MB).
pub const SECURITY_3D_MAX_SCRIPT_BYTES: usize = 1024 * 1024;

/// Maximum concurrent in-process 3D compilation tasks before applying backpressure.
///
/// Enforcement point: the JavaScript host scheduler. The Rust engine is single-threaded
/// per context and has no visibility into the caller's task queue.
pub const SECURITY_3D_MAX_CONCURRENT_TASKS: usize = 32;
