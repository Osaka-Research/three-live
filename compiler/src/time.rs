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

//! Portable wall-clock measurement for the execution ceiling.
//!
//! `std::time::Instant::now()` is not implemented on `wasm32-unknown-unknown` — the
//! standard library routes it to a platform shim that panics with *"time not
//! implemented on this platform"*. Since the execution ceiling is checked on every
//! compile path, calling it unconditionally means every compile from the WebAssembly
//! package fails. This module picks the right clock per target so the ceiling is
//! enforced everywhere.

#[cfg(not(target_arch = "wasm32"))]
mod imp {
    use std::time::Instant;

    /// Native monotonic clock.
    #[derive(Debug, Clone, Copy)]
    pub struct Stopwatch(Instant);

    impl Stopwatch {
        #[inline]
        pub fn start() -> Self {
            Self(Instant::now())
        }

        #[inline]
        pub fn elapsed_ms(&self) -> f64 {
            self.0.elapsed().as_secs_f64() * 1000.0
        }
    }
}

#[cfg(target_arch = "wasm32")]
mod imp {
    use wasm_bindgen::prelude::wasm_bindgen;

    #[wasm_bindgen]
    extern "C" {
        /// `Date.now()`, bound directly rather than via `js-sys` to avoid pulling in
        /// another dependency for a single call.
        #[wasm_bindgen(js_namespace = Date, js_name = now)]
        fn date_now() -> f64;
    }

    /// `Date.now()`-backed clock.
    ///
    /// `Date.now()` is wall-clock rather than monotonic, so a clock adjustment mid-run
    /// could in principle skew a reading. That is acceptable here: the value only
    /// feeds a coarse DoS ceiling, and `performance.now()` is not reachable from every
    /// host this package is loaded into (plain Node without a DOM, some worker
    /// contexts). `elapsed_ms` clamps at zero so a backwards jump can never present as
    /// a negative duration.
    #[derive(Debug, Clone, Copy)]
    pub struct Stopwatch(f64);

    impl Stopwatch {
        #[inline]
        pub fn start() -> Self {
            Self(date_now())
        }

        #[inline]
        pub fn elapsed_ms(&self) -> f64 {
            (date_now() - self.0).max(0.0)
        }
    }
}

pub use imp::Stopwatch;

#[cfg(test)]
mod tests {
    use super::Stopwatch;

    #[test]
    fn elapsed_is_non_negative_and_monotonic() {
        let sw = Stopwatch::start();
        let first = sw.elapsed_ms();
        assert!(first >= 0.0, "elapsed must never be negative, got {}", first);

        // Burn a little time without sleeping, so the test stays fast and hermetic.
        let mut acc = 0u64;
        for i in 0..200_000u64 {
            acc = acc.wrapping_add(i);
        }
        assert_ne!(acc, u64::MAX); // keep the loop from being optimized away

        let second = sw.elapsed_ms();
        assert!(second >= first, "elapsed must be non-decreasing: {} then {}", first, second);
    }
}
