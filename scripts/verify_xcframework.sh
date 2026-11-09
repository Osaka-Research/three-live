#!/usr/bin/env bash
# Copyright 2026 Google LLC
#
# Licensed under the Apache License, Version 2.0 (the "License");
# you may not use this file except in compliance with the License.
# You may obtain a copy of the License at
#
#     http://www.apache.org/licenses/LICENSE-2.0
#
# Unless required by applicable law or agreed to in writing, software
# distributed under the License is distributed on an "AS IS" BASIS,
# WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
# See the License for the specific language governing permissions and
# limitations under the License.
#
# Verifies that a built ThreeLiveCompiler.xcframework is complete and usable:
#   * every declared slice directory contains a static library,
#   * every static library exports the full C ABI,
#   * no library is suspiciously small.
#
# Usage: verify_xcframework.sh <path-to-xcframework> [expected-slice-count]
#
# Written for bash 3.2, which is what macOS ships as /bin/bash.

set -euo pipefail

XCFRAMEWORK="${1:-}"
EXPECTED_SLICES="${2:-0}"

if [[ -z "${XCFRAMEWORK}" || ! -d "${XCFRAMEWORK}" ]]; then
    echo "Error: usage: $(basename "$0") <path-to-xcframework> [expected-slice-count]" >&2
    exit 1
fi

# The complete C ABI surface. Mach-O prefixes C symbols with an underscore.
REQUIRED_SYMBOLS="
_three_live_compile
_three_live_compile_usdz
_three_live_glb_to_usdz
_three_live_free_buffer
_three_live_free_error
_three_live_ai_call
_three_live_free_string
"

# A slice that is only a few KB means the Rust build silently produced a stub.
MIN_LIB_BYTES=$((256 * 1024))

if [[ ! -f "${XCFRAMEWORK}/Info.plist" ]]; then
    echo "Error: ${XCFRAMEWORK} has no Info.plist; it is not a valid XCFramework." >&2
    exit 1
fi

echo "Verifying $(basename "${XCFRAMEWORK}")"

slice_count=0
failures=0

while IFS= read -r lib; do
    slice=$(basename "$(dirname "${lib}")")
    slice_count=$((slice_count + 1))

    size=$(wc -c < "${lib}" | tr -d '[:space:]')
    if [[ "${size}" -lt "${MIN_LIB_BYTES}" ]]; then
        echo "  FAIL ${slice}: library is only ${size} bytes (expected at least ${MIN_LIB_BYTES})" >&2
        failures=$((failures + 1))
        continue
    fi

    # Collect defined external symbols across every architecture in the archive.
    # Pass `--no-llvm-bc` first so Xcode's `llvm-nm` reads the native Mach-O symbol
    # table directly instead of choking on newer Rust/LLVM bitcode attributes when LTO
    # is enabled. Filter at collection time and use a here-string so `grep -q` early
    # exit never triggers SIGPIPE (exit 141) under `set -o pipefail`.
    symbols=$( { nm --no-llvm-bc -gUj "${lib}" 2>/dev/null || nm --no-llvm-bc -gU "${lib}" 2>/dev/null || nm -gUj "${lib}" 2>/dev/null || nm -gU "${lib}" 2>/dev/null || true; } | grep 'three_live_' || true )

    missing=""
    for symbol in ${REQUIRED_SYMBOLS}; do
        if ! grep -Eq "(^|[[:space:]])${symbol}$" <<< "${symbols}"; then
            missing="${missing} ${symbol}"
        fi
    done

    architectures=$(lipo -archs "${lib}" 2>/dev/null || echo "unknown")

    if [[ -n "${missing}" ]]; then
        echo "  FAIL ${slice} [${architectures}]: missing symbols:${missing}" >&2
        failures=$((failures + 1))
    else
        echo "  ok   ${slice} [${architectures}] $((size / 1024)) KB"
    fi
done < <(find "${XCFRAMEWORK}" -name '*.a' -type f | sort)

if [[ "${slice_count}" -eq 0 ]]; then
    echo "Error: no static libraries found inside ${XCFRAMEWORK}." >&2
    exit 1
fi

if [[ "${EXPECTED_SLICES}" -gt 0 && "${slice_count}" -ne "${EXPECTED_SLICES}" ]]; then
    echo "Error: expected ${EXPECTED_SLICES} slices but found ${slice_count}." >&2
    exit 1
fi

if [[ "${failures}" -gt 0 ]]; then
    echo "Error: ${failures} slice(s) failed verification." >&2
    exit 1
fi

echo "XCFramework verification passed (${slice_count} slices)."
