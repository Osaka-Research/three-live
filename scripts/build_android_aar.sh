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

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
COMPILER_DIR="${ROOT_DIR}/compiler"
ANDROID_DIR="${ROOT_DIR}/mobile/android"
JNILIBS_DIR="${ANDROID_DIR}/src/main/jniLibs"

echo "=== Three-Live: Building Android AAR ==="

# Check requirements
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo is required but not installed." >&2
    exit 1
fi

if ! command -v cargo-ndk &> /dev/null; then
    echo "Error: cargo-ndk is required for cross-compiling Android .so binaries." >&2
    echo "Install via: cargo install cargo-ndk" >&2
    exit 1
fi

if [ -z "${ANDROID_NDK_HOME:-}" ] && [ -z "${NDK_HOME:-}" ]; then
    echo "Warning: ANDROID_NDK_HOME / NDK_HOME environment variable not set." >&2
fi

# Start from a clean slate: .so files from a previously-configured ABI would otherwise linger
# here and be packaged into the AAR.
rm -rf "${JNILIBS_DIR}"
mkdir -p "${JNILIBS_DIR}"

TARGETS=("aarch64-linux-android" "x86_64-linux-android" "armv7-linux-androideabi")
ABI_NAMES=("arm64-v8a" "x86_64" "armeabi-v7a")

echo "--> Cross-compiling native .so libraries..."
cd "${COMPILER_DIR}"

for i in "${!TARGETS[@]}"; do
    target="${TARGETS[$i]}"
    abi="${ABI_NAMES[$i]}"
    echo "  Building for ${abi} (${target})..."

    cargo ndk -t "${abi}" -o "${JNILIBS_DIR}" build --release --features jni
done

echo "--> Assembling Android AAR..."
cd "${ROOT_DIR}"
./gradlew :mobile:android:assembleRelease

AAR_PATH="$(ls "${ANDROID_DIR}"/build/outputs/aar/*-release.aar 2>/dev/null | head -n 1)"
if [ -z "${AAR_PATH}" ]; then
    echo "Error: assembleRelease did not produce an AAR in ${ANDROID_DIR}/build/outputs/aar/" >&2
    exit 1
fi

echo "=== Success! Android AAR built at: ${AAR_PATH} ==="
