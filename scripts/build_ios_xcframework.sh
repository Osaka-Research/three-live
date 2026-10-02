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
# Builds the ThreeLiveCompiler XCFramework covering every platform declared in Package.swift.
#
# By default, visionOS and tvOS slices are skipped with a warning if the corresponding SDK is
# not installed, so that a stock Xcode installation can still produce a usable iOS/macOS
# framework. Set THREE_LIVE_REQUIRE_ALL_PLATFORMS=1 to turn a missing SDK into a hard error;
# the release workflow does this so a release can never ship a partial framework.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPILER_DIR="${ROOT_DIR}/compiler"
IOS_DIR="${ROOT_DIR}/mobile/ios"
OUTPUT_XCFRAMEWORK="${IOS_DIR}/ThreeLiveCompiler.xcframework"
LIB_NAME="libthree_live_compiler.a"
REQUIRE_ALL="${THREE_LIVE_REQUIRE_ALL_PLATFORMS:-0}"

echo "=== Three-Live: Building Apple XCFramework ==="

if ! command -v cargo &> /dev/null; then
    echo "Error: cargo is required but not installed." >&2
    exit 1
fi

if ! command -v xcodebuild &> /dev/null; then
    echo "Error: xcodebuild is required to package XCFramework (macOS only)." >&2
    exit 1
fi

AVAILABLE_SDKS="$(xcodebuild -showsdks 2>/dev/null || true)"

# has_sdk <sdk-prefix>
has_sdk() {
    echo "${AVAILABLE_SDKS}" | grep -q -- "-sdk $1"
}

# build_target <rust-target>
build_target() {
    local target="$1"
    echo "  - ${target}"
    rustup target add "${target}"
    cargo build --release --target "${target}"
}

cd "${COMPILER_DIR}"

echo "--> Compiling Rust static libraries..."

# Core platforms. These are always required.
build_target aarch64-apple-ios
build_target aarch64-apple-ios-sim
build_target x86_64-apple-ios
build_target aarch64-apple-darwin
build_target x86_64-apple-darwin

# Optional platforms, gated on both Xcode SDK and rustup prebuilt std availability.
BUILD_VISIONOS=0
if has_sdk xros && rustup target add aarch64-apple-visionos aarch64-apple-visionos-sim 2>/dev/null; then
    BUILD_VISIONOS=1
    build_target aarch64-apple-visionos
    build_target aarch64-apple-visionos-sim
elif [[ "${REQUIRE_ALL}" == "1" ]]; then
    echo "Error: visionOS SDK/target not installed, but THREE_LIVE_REQUIRE_ALL_PLATFORMS=1." >&2
    exit 1
else
    echo "  ! visionOS SDK or Rust std target not found; skipping visionOS slices." >&2
fi

BUILD_TVOS=0
if has_sdk appletvos && rustup target add aarch64-apple-tvos aarch64-apple-tvos-sim 2>/dev/null; then
    BUILD_TVOS=1
    build_target aarch64-apple-tvos
    build_target aarch64-apple-tvos-sim
elif [[ "${REQUIRE_ALL}" == "1" ]]; then
    echo "Error: tvOS SDK/target not installed, but THREE_LIVE_REQUIRE_ALL_PLATFORMS=1." >&2
    exit 1
else
    echo "  ! tvOS SDK or Rust std target not found; skipping tvOS slices." >&2
fi

# fat_library <output-subdir> <rust-target>...
# Combines one or more single-architecture slices into a single static library.
fat_library() {
    local out_dir="${ROOT_DIR}/target/$1"
    shift
    local inputs=()
    local target
    for target in "$@"; do
        inputs+=("${ROOT_DIR}/target/${target}/release/${LIB_NAME}")
    done
    mkdir -p "${out_dir}"
    lipo -create "${inputs[@]}" -output "${out_dir}/${LIB_NAME}"
    echo "${out_dir}/${LIB_NAME}"
}

echo "--> Combining architecture slices..."
IOS_SIM_LIB="$(fat_library ios-sim-lipo aarch64-apple-ios-sim x86_64-apple-ios)"
MACOS_LIB="$(fat_library macos-lipo aarch64-apple-darwin x86_64-apple-darwin)"

XCF_ARGS=(
    -library "${ROOT_DIR}/target/aarch64-apple-ios/release/${LIB_NAME}"
    -library "${IOS_SIM_LIB}"
    -library "${MACOS_LIB}"
)

if [[ "${BUILD_VISIONOS}" == "1" ]]; then
    XCF_ARGS+=(
        -library "${ROOT_DIR}/target/aarch64-apple-visionos/release/${LIB_NAME}"
        -library "${ROOT_DIR}/target/aarch64-apple-visionos-sim/release/${LIB_NAME}"
    )
fi

if [[ "${BUILD_TVOS}" == "1" ]]; then
    XCF_ARGS+=(
        -library "${ROOT_DIR}/target/aarch64-apple-tvos/release/${LIB_NAME}"
        -library "${ROOT_DIR}/target/aarch64-apple-tvos-sim/release/${LIB_NAME}"
    )
fi

echo "--> Packaging XCFramework..."
rm -rf "${OUTPUT_XCFRAMEWORK}"

# Headers are intentionally omitted: the ThreeLiveCompilerC SwiftPM target supplies the C
# header and module map, and bundling them here would produce duplicate module definitions.
xcodebuild -create-xcframework "${XCF_ARGS[@]}" -output "${OUTPUT_XCFRAMEWORK}"

echo "--> Verifying XCFramework..."
"${SCRIPT_DIR}/verify_xcframework.sh" "${OUTPUT_XCFRAMEWORK}"

echo "=== Success! XCFramework created at: ${OUTPUT_XCFRAMEWORK} ==="
