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

# Auto-detect Android Studio's bundled JDK on macOS if JAVA_HOME is not set.
if [ -z "${JAVA_HOME:-}" ] && [ -d "/Applications/Android Studio.app/Contents/jbr/Contents/Home" ]; then
    export JAVA_HOME="/Applications/Android Studio.app/Contents/jbr/Contents/Home"
    export PATH="${JAVA_HOME}/bin:${PATH}"
fi

# Auto-detect standard Android SDK paths on macOS and Linux if ANDROID_HOME is not set.
if [ -z "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    if [ -d "${HOME}/Library/Android/sdk" ]; then
        export ANDROID_HOME="${HOME}/Library/Android/sdk"
    elif [ -d "${HOME}/Android/Sdk" ]; then
        export ANDROID_HOME="${HOME}/Android/Sdk"
    fi
fi
if [ -n "${ANDROID_HOME:-}" ] && [ -z "${ANDROID_SDK_ROOT:-}" ]; then
    export ANDROID_SDK_ROOT="${ANDROID_HOME}"
fi

# Auto-detect the latest installed Android NDK inside ANDROID_HOME/ndk if ANDROID_NDK_HOME is not set.
if [ -z "${ANDROID_NDK_HOME:-}" ] && [ -z "${NDK_HOME:-}" ] && [ -n "${ANDROID_HOME:-}" ]; then
    if [ -d "${ANDROID_HOME}/ndk" ]; then
        LATEST_NDK="$(ls -d "${ANDROID_HOME}/ndk/"* 2>/dev/null | sort -V | tail -n 1 || true)"
        if [ -n "${LATEST_NDK}" ] && [ -d "${LATEST_NDK}" ]; then
            export ANDROID_NDK_HOME="${LATEST_NDK}"
            export NDK_HOME="${LATEST_NDK}"
            echo "--> Auto-detected Android NDK: ${ANDROID_NDK_HOME}"
        fi
    elif [ -d "${ANDROID_HOME}/ndk-bundle" ]; then
        export ANDROID_NDK_HOME="${ANDROID_HOME}/ndk-bundle"
        export NDK_HOME="${ANDROID_HOME}/ndk-bundle"
    fi
fi

# Check requirements
if ! command -v cargo &> /dev/null; then
    echo "Error: cargo is required but not installed. Install Rust via https://rustup.rs" >&2
    exit 1
fi

if ! command -v cargo-ndk &> /dev/null; then
    echo "--> Installing cargo-ndk via cargo..."
    cargo install cargo-ndk
fi

if [ -z "${ANDROID_NDK_HOME:-}" ] && [ -z "${NDK_HOME:-}" ]; then
    echo "Error: Android NDK not found." >&2
    echo "In Android Studio, open Settings -> Languages & Frameworks -> Android SDK -> SDK Tools," >&2
    echo "check 'NDK (Side by side)', and click Apply." >&2
    exit 1
fi

# Ensure gradle-wrapper.jar exists before invoking ./gradlew
if [ ! -f "${ROOT_DIR}/gradle/wrapper/gradle-wrapper.jar" ]; then
    bash "${SCRIPT_DIR}/bootstrap_gradle_wrapper.sh"
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
