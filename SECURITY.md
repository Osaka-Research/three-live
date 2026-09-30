<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# Security Policy

## Reporting Security Vulnerabilities

Please use https://g.co/vulnz to report security vulnerabilities.

We use https://g.co/vulnz for intake and triage. For valid issues we will
coordinate fixes and disclosure on GitHub (including using GitHub Security
Advisories when necessary).

The Google Security Team will process your report within a day, and respond
within a week (depending on the severity of the report).

--------------------------------------------------------------------------------

## Security Architecture & Embedder Guidelines

### 1. Procedural Script Sandboxing

-   **Mobile (`Android` / `iOS`)**: Untrusted Three.js procedural scripts
    execute inside a dedicated **Rust + Boa** interpreter
    (`compiler/src/engine.rs`) with deterministic opcode-budget interrupts
    (`SECURITY_3D_INTERRUPT_CHECK_OPCODES`), wall-clock deadlines
    (`SECURITY_3D_EXECUTION_CEILING_MS`), strict loop/recursion/stack limits
    (`RuntimeLimits`), hard heap caps (`HostHooks::max_buffer_size`), and
    `std::panic::catch_unwind` across every FFI/JNI boundary.
-   **Web (`<three-live>` / `<xr-live>`)**: By default (`sandbox="worker"`),
    procedural scripts run in a dedicated Web Worker that non-configurably
    revokes `fetch`, `XMLHttpRequest`, `WebSocket`, `EventSource`,
    `importScripts`, `navigator`, `indexedDB`, `caches`, `cookieStore`,
    `Worker`, `SharedWorker`, `BroadcastChannel`, `SharedArrayBuffer`, and
    `Atomics` before evaluating the script, enforces a 3,000 ms wall-clock
    termination watchdog (`SECURITY_3D_SANDBOX_TIMEOUT_MS`), caps concurrent
    workers (`SECURITY_3D_MAX_CONCURRENT_TASKS`), and validates worker-to-host
    message schemas and byte budgets (`SECURITY_3D_MAX_HEAP_BYTES`).
-   **Untrusted Error Details**: Details attached to `error` events
    (`CustomEvent<{error: Error}>`) originate from script execution or asset
    parsing and **must** be rendered using `element.textContent` (never
    `innerHTML`).

### 2. WebXR & WebMCP Privacy (`<xr-live webmcp>`)

-   **No Passthrough Camera Capture**: `captureXRViewFrame` and the
    `capture_xr_view` WebMCP tool read **only** the virtual WebGL framebuffer
    (`canvas.toDataURL()`). Physical passthrough camera imagery from the user's
    headset or phone is **never** read, accessible, or transmitted.
-   **`XRCapturedFrame` Payload**:
    -   `dataUrl` / `base64` / `mimeType` / `width` / `height`: Virtual 3D scene
        snapshot rendered by WebGL2.
    -   `viewMatrix` / `projectionMatrix`: 16-float virtual camera matrices.
    -   `headPosition`: Coarse 3D viewer coordinates quantized to **0.1 m (10
        cm)** resolution (`quantizeHeadPosition`) to prevent sub-millimeter
        biometric height or tremor fingerprinting. Embedders can omit
        `headPosition` entirely from `inspect_xr_scene` by setting the
        `webmcp-omit-pose` attribute on `<xr-live>`.
    -   `depthGridMeters`: Optional 8×8 coarse metric depth grid (`64` floats).
        Disabled by default in WebMCP; only populated when the embedder
        explicitly sets the `webmcp-allow-depth` attribute on `<xr-live>`
        **and** the caller passes `includeDepth: true`.
-   **Capture Indicator & Event**: Invoking `capture_xr_view` sets
    `data-xr-webmcp-indicator="active"` and dispatches an `xr-webmcp-capture`
    `CustomEvent` on the `<xr-live>` element so the host page can surface a
    visible capture indicator.
