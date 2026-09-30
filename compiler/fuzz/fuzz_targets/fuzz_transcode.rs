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

#![no_main]

use libfuzzer_sys::fuzz_target;
use three_live_compiler::{transcode_glb_to_usdz, transcode_three_to_glb, transcode_three_to_usdz};

fuzz_target!(|data: &[u8]| {
    // 1. Fuzz binary GLB to USDZ transcoding with arbitrary byte payloads
    let _ = transcode_glb_to_usdz(data);

    // 2. If valid UTF-8, fuzz Three.js script compilation to GLB and USDZ
    if let Ok(script) = std::str::from_utf8(data) {
        let _ = transcode_three_to_glb(script);
        let _ = transcode_three_to_usdz(script);
    }
});
