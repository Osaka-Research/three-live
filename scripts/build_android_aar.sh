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

# Ensure JAVA_HOME points to a Gradle 8.7 / AGP 8.5 compatible JDK (17 through 21).
# Newer Homebrew OpenJDK releases (e.g. JDK 25) cause Gradle 8.7's Groovy/Kotlin runtime
# to fail with `What went wrong: 25.0.2`.
java_major_version() {
    local java_bin="$1"
    if [ ! -x "${java_bin}" ] && ! command -v "${java_bin}" >/dev/null 2>&1; then
        echo 0
        return
    fi
    "${java_bin}" -version 2>&1 | awk -F '[\".-]' '/version/ {if ($2 == "1") print $3; else print $2; exit}'
}

ACTIVE_JAVA_BIN="java"
if [ -n "${JAVA_HOME:-}" ] && [ -x "${JAVA_HOME}/bin/java" ]; then
    ACTIVE_JAVA_BIN="${JAVA_HOME}/bin/java"
fi
ACTIVE_JAVA_MAJOR="$(java_major_version "${ACTIVE_JAVA_BIN}")"

if [ "${ACTIVE_JAVA_MAJOR:-0}" -lt 17 ] || [ "${ACTIVE_JAVA_MAJOR:-0}" -gt 21 ]; then
    STUDIO_APP=""
    if command -v mdfind >/dev/null 2>&1; then
        STUDIO_APP="$(mdfind "kMDItemCFBundleIdentifier == 'com.google.android.studio'" 2>/dev/null | head -n 1 || true)"
    fi
    CANDIDATE_JDKS=(
        "/Applications/Android Studio.app/Contents/jbr/Contents/Home"
        "${HOME}/Applications/Android Studio.app/Contents/jbr/Contents/Home"
        "/Applications/Android Studio Preview.app/Contents/jbr/Contents/Home"
        "${STUDIO_APP:+${STUDIO_APP}/Contents/jbr/Contents/Home}"
        "$(/usr/libexec/java_home -v 21.0 2>/dev/null || true)"
        "$(/usr/libexec/java_home -v 17.0 2>/dev/null || true)"
        "/opt/homebrew/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        "/opt/homebrew/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
        "/usr/local/opt/openjdk@21/libexec/openjdk.jdk/Contents/Home"
        "/usr/local/opt/openjdk@17/libexec/openjdk.jdk/Contents/Home"
        "${HOME}/jdk21"
    )
    for jdk in "${CANDIDATE_JDKS[@]}"; do
        if [ -n "${jdk}" ] && [ -x "${jdk}/bin/java" ]; then
            cand_major="$(java_major_version "${jdk}/bin/java")"
            if [ "${cand_major:-0}" -ge 17 ] && [ "${cand_major:-0}" -le 21 ]; then
                export JAVA_HOME="${jdk}"
                export PATH="${JAVA_HOME}/bin:${PATH}"
                echo "--> Using compatible JDK ${cand_major} at: ${JAVA_HOME}"
                break
            fi
        fi
    done
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
if [ -n "${ANDROID_HOME:-}" ] && [ -d "${ANDROID_HOME}/platform-tools" ]; then
    export PATH="${ANDROID_HOME}/platform-tools:${PATH}"
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

# Ensure gradle-wrapper.jar exists before invoking ./gradlew
if [ ! -f "${ROOT_DIR}/gradle/wrapper/gradle-wrapper.jar" ]; then
    bash "${SCRIPT_DIR}/bootstrap_gradle_wrapper.sh"
fi

PREBUILT_JNI_VERSION="v1.3.2"

download_prebuilt_jnilibs() {
    # If all 3 ABI .so files and the expected prebuilt version stamp are present in jniLibs, reuse them directly.
    if [ -f "${JNILIBS_DIR}/.prebuilt-version" ] && \
       [ "$(cat "${JNILIBS_DIR}/.prebuilt-version" 2>/dev/null || true)" = "${PREBUILT_JNI_VERSION}" ] && \
       [ -f "${JNILIBS_DIR}/arm64-v8a/libthree_live_compiler.so" ] && \
       [ -f "${JNILIBS_DIR}/x86_64/libthree_live_compiler.so" ] && \
       [ -f "${JNILIBS_DIR}/armeabi-v7a/libthree_live_compiler.so" ]; then
        echo "--> Using existing prebuilt Android JNI libraries (${PREBUILT_JNI_VERSION}) in ${JNILIBS_DIR}"
        return 0
    fi

    rm -rf "${JNILIBS_DIR}"
    mkdir -p "${JNILIBS_DIR}"

    local tmp_dir
    tmp_dir="$(mktemp -d)"
    local aar_file="${tmp_dir}/three-live-compiler-release.aar"
    local downloaded=0

    echo "--> Downloading prebuilt Android JNI libraries from GitHub Releases (skipping local Rust build)..."

    if command -v gh >/dev/null 2>&1; then
        if gh release download "${PREBUILT_JNI_VERSION}" --repo google/three-live --pattern "three-live-compiler-release.aar" --dir "${tmp_dir}" --clobber >/dev/null 2>&1 || \
           gh release download v1.0.0 --repo google/three-live --pattern "three-live-compiler-release.aar" --dir "${tmp_dir}" --clobber >/dev/null 2>&1; then
            downloaded=1
        fi
    fi

    if [ "${downloaded}" -eq 0 ]; then
        local gh_token="${GITHUB_TOKEN:-}"
        if [ -z "${gh_token}" ] && command -v git >/dev/null 2>&1; then
            gh_token="$(printf "protocol=https\nhost=github.com\n\n" | GIT_TERMINAL_PROMPT=0 git -C "${ROOT_DIR}" credential fill 2>/dev/null | sed -n 's/^password=//p' || true)"
        fi
        if [ -n "${gh_token}" ] && command -v python3 >/dev/null 2>&1; then
            local asset_url
            asset_url="$(curl -fsSL -H "Authorization: token ${gh_token}" "https://api.github.com/repos/google/three-live/releases/tags/${PREBUILT_JNI_VERSION}" 2>/dev/null | python3 -c "
import sys, json
data = json.load(sys.stdin)
for a in data.get('assets', []):
    if a.get('name') == 'three-live-compiler-release.aar':
        print(a.get('url', ''))
        break
" 2>/dev/null || true)"
            if [ -n "${asset_url}" ]; then
                if curl -fsSL -H "Authorization: token ${gh_token}" -H "Accept: application/octet-stream" "${asset_url}" -o "${aar_file}" 2>/dev/null; then
                    downloaded=1
                fi
            fi
        fi
    fi

    if [ "${downloaded}" -eq 0 ]; then
        if curl -fsSL "https://github.com/google/three-live/releases/download/${PREBUILT_JNI_VERSION}/three-live-compiler-release.aar" -o "${aar_file}" 2>/dev/null || \
           curl -fsSL "https://github.com/google/three-live/releases/download/v1.0.0/three-live-compiler-release.aar" -o "${aar_file}" 2>/dev/null; then
            downloaded=1
        fi
    fi

    if [ "${downloaded}" -eq 1 ] && [ -f "${aar_file}" ]; then
        unzip -qo "${aar_file}" "jni/*" -d "${tmp_dir}"
        cp -R "${tmp_dir}/jni/"* "${JNILIBS_DIR}/"
        echo "${PREBUILT_JNI_VERSION}" > "${JNILIBS_DIR}/.prebuilt-version"
        rm -rf "${tmp_dir}"
        echo "--> Extracted prebuilt JNI libraries (arm64-v8a, x86_64, armeabi-v7a) [${PREBUILT_JNI_VERSION}] into ${JNILIBS_DIR}"
        return 0
    fi

    rm -rf "${tmp_dir}"
    return 1
}

UNAME_S="$(uname -s)"
USE_PREBUILT="${THREE_LIVE_PREBUILT_JNI:-}"
if [ -z "${USE_PREBUILT}" ]; then
    # On macOS, default to downloading the prebuilt Android JNI .so libraries from GitHub Releases
    # unless THREE_LIVE_BUILD_RUST_FROM_SOURCE=1 is set.
    if [ "${UNAME_S}" = "Darwin" ] && [ "${THREE_LIVE_BUILD_RUST_FROM_SOURCE:-0}" != "1" ]; then
        USE_PREBUILT="1"
    else
        USE_PREBUILT="0"
    fi
fi

BUILT_JNI=0
if [ "${USE_PREBUILT}" = "1" ]; then
    if download_prebuilt_jnilibs; then
        BUILT_JNI=1
    else
        echo "Warning: Could not download prebuilt JNI libraries; falling back to building from Rust source..." >&2
    fi
fi

if [ "${BUILT_JNI}" -eq 0 ]; then
    rm -rf "${JNILIBS_DIR}"
    mkdir -p "${JNILIBS_DIR}"

    # Check requirements for source build
    if ! command -v cargo &> /dev/null; then
        echo "Error: cargo is required to build from source (and prebuilt JNI download failed)." >&2
        exit 1
    fi

    NDK_ROOT="${ANDROID_NDK_HOME:-${NDK_HOME:-}}"
    if [ -z "${NDK_ROOT}" ]; then
        echo "Error: Android NDK not found." >&2
        echo "In Android Studio, open Settings -> Languages & Frameworks -> Android SDK -> SDK Tools," >&2
        echo "check 'NDK (Side by side)', and click Apply." >&2
        exit 1
    fi

    TARGETS=("aarch64-linux-android" "x86_64-linux-android" "armv7-linux-androideabi")
    ABI_NAMES=("arm64-v8a" "x86_64" "armeabi-v7a")

    if command -v rustup >/dev/null 2>&1; then
        rustup target add "${TARGETS[@]}"
    fi

    echo "--> Cross-compiling native .so libraries (16 KB ELF page alignment)..."
    cd "${COMPILER_DIR}"

    if command -v cargo-ndk &> /dev/null; then
        for i in "${!TARGETS[@]}"; do
            target="${TARGETS[$i]}"
            abi="${ABI_NAMES[$i]}"
            echo "  Building for ${abi} (${target}) via cargo-ndk..."
            cargo ndk -t "${abi}" -o "${JNILIBS_DIR}" build --release --features jni
        done
    else
        # Direct NDK clang cross-compilation (no cargo-ndk required!)
        TOOLCHAIN_BIN="$(ls -d "${NDK_ROOT}/toolchains/llvm/prebuilt/"*/bin 2>/dev/null | head -n 1 || true)"
        if [ -z "${TOOLCHAIN_BIN}" ] || [ ! -d "${TOOLCHAIN_BIN}" ]; then
            echo "Error: Could not locate NDK LLVM toolchain under ${NDK_ROOT}/toolchains/llvm/prebuilt/" >&2
            exit 1
        fi
        export PATH="${TOOLCHAIN_BIN}:${PATH}"
        export CC_aarch64_linux_android="${TOOLCHAIN_BIN}/aarch64-linux-android24-clang"
        export CARGO_TARGET_AARCH64_LINUX_ANDROID_LINKER="${TOOLCHAIN_BIN}/aarch64-linux-android24-clang"
        export CC_x86_64_linux_android="${TOOLCHAIN_BIN}/x86_64-linux-android24-clang"
        export CARGO_TARGET_X86_64_LINUX_ANDROID_LINKER="${TOOLCHAIN_BIN}/x86_64-linux-android24-clang"
        export CC_armv7_linux_androideabi="${TOOLCHAIN_BIN}/armv7a-linux-androideabi24-clang"
        export CARGO_TARGET_ARMV7_LINUX_ANDROIDEABI_LINKER="${TOOLCHAIN_BIN}/armv7a-linux-androideabi24-clang"
        export AR="${TOOLCHAIN_BIN}/llvm-ar"

        for i in "${!TARGETS[@]}"; do
            target="${TARGETS[$i]}"
            abi="${ABI_NAMES[$i]}"
            echo "  Building for ${abi} (${target}) via NDK clang..."
            cargo build --target "${target}" --release --features jni
            mkdir -p "${JNILIBS_DIR}/${abi}"
            if [ -f "${COMPILER_DIR}/target/${target}/release/libthree_live_compiler.so" ]; then
                cp "${COMPILER_DIR}/target/${target}/release/libthree_live_compiler.so" "${JNILIBS_DIR}/${abi}/libthree_live_compiler.so"
            else
                cp "${ROOT_DIR}/target/${target}/release/libthree_live_compiler.so" "${JNILIBS_DIR}/${abi}/libthree_live_compiler.so"
            fi
        done
    fi
    echo "${PREBUILT_JNI_VERSION}" > "${JNILIBS_DIR}/.prebuilt-version"
fi

echo "--> Assembling Android AAR..."
cd "${ROOT_DIR}"
./gradlew :mobile:android:assembleRelease

AAR_PATH="$(ls "${ANDROID_DIR}"/build/outputs/aar/*-release.aar 2>/dev/null | head -n 1)"
if [ -z "${AAR_PATH}" ]; then
    echo "Error: assembleRelease did not produce an AAR in ${ANDROID_DIR}/build/outputs/aar/" >&2
    exit 1
fi

echo "=== Success! Android AAR built at: ${AAR_PATH} ==="

if [ "${1:-}" = "--demo" ]; then
    echo "--> Building Compose demo APK (:mobile:examples:android_compose:assembleDebug)..."
    ./gradlew :mobile:examples:android_compose:assembleDebug
    echo "=== Debug APK built at: mobile/examples/android_compose/build/outputs/apk/debug/ ==="

    if command -v adb >/dev/null 2>&1 && [ "$(adb devices | awk 'NR>1 && $2=="device" {count++} END {print count+0}')" -gt 0 ]; then
        echo "--> Running emulator/device detected! Installing and launching Three-Live Studio..."
        ./gradlew :mobile:examples:android_compose:installDebug
        adb shell am start -n com.google.threelive.example/.MainActivity
    fi

    if [ "${UNAME_S}" = "Darwin" ]; then
        STUDIO_APP_OPEN=""
        if [ -d "/Applications/Android Studio.app" ]; then
            STUDIO_APP_OPEN="/Applications/Android Studio.app"
        elif command -v mdfind >/dev/null 2>&1; then
            STUDIO_APP_OPEN="$(mdfind "kMDItemCFBundleIdentifier == 'com.google.android.studio'" 2>/dev/null | head -n 1 || true)"
        fi
        if [ -n "${STUDIO_APP_OPEN}" ] && [ -d "${STUDIO_APP_OPEN}" ]; then
            open -a "${STUDIO_APP_OPEN}" "${ROOT_DIR}"
        fi
    fi
fi
