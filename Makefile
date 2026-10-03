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

SHELL := /usr/bin/env bash
.DEFAULT_GOAL := help

UNAME_S := $(shell uname -s)
PORT ?= 8888
ENGINE_ASSET := compiler/assets/three-author-engine.min.js

.PHONY: help doctor ensure-esbuild all web web-demo engine-asset rust test test-web test-rust ios ios-demo android android-demo clean

help:
	@echo "================================================================================"
	@echo "  Three-Live & XR-Live Monorepo — Build & Developer Commands"
	@echo "================================================================================"
	@echo ""
	@echo "  Setup & Diagnostics:"
	@echo "    make doctor        Check installed toolchains (Web, Rust, iOS, Android)"
	@echo "    make all           Build Web bundles, Rust compiler, and available Mobile SDKs"
	@echo "    make clean         Remove generated dist/, target/, XCFramework, and Gradle artifacts"
	@echo ""
	@echo "  Web (<three-live> & <xr-live>):"
	@echo "    make web           Compile all JS/TS bundles, examples, and embedded engine asset"
	@echo "    make web-demo      Build Web bundles and serve examples at http://localhost:$(PORT)"
	@echo "    make test-web      Run all <three-live> and <xr-live> unit & sandbox tests"
	@echo ""
	@echo "  Rust Compiler & Tests:"
	@echo "    make rust          Build libthree_live_compiler and three-live-cli"
	@echo "    make test-rust     Run all Rust compiler & GLB/USDZ parity tests"
	@echo "    make test          Run full Web + Rust compiler test suites"
	@echo ""
	@echo "  iOS & visionOS (macOS + Xcode):"
	@echo "    make ios           Build universal ThreeLiveCompiler.xcframework + run SwiftPM tests"
	@echo "    make ios-demo      Build XCFramework, generate ThreeLiveDemo.xcodeproj, and open Xcode"
	@echo ""
	@echo "  Android (NDK + Gradle):"
	@echo "    make android       Cross-compile JNI .so slices and assemble release Android AAR"
	@echo "    make android-demo  Build JNI slices + debug Compose demo APK and open Android Studio"
	@echo "================================================================================"

doctor:
	@echo "=== Three-Live Toolchain Doctor ($(UNAME_S)) ==="
	@if command -v node >/dev/null 2>&1; then \
		echo "  [OK]   node:          $$(node --version)"; \
	else \
		echo "  [MISS] node:          Install Node.js >= 18 (https://nodejs.org)"; \
	fi
	@if [ -f node_modules/esbuild/package.json ] || command -v esbuild >/dev/null 2>&1 || [ -n "$${ESBUILD_BINARY:-}" ]; then \
		echo "  [OK]   esbuild:       Available"; \
	else \
		echo "  [INFO] esbuild:       Will be installed automatically via 'npm install' on 'make web'"; \
	fi
	@if command -v cargo >/dev/null 2>&1; then \
		echo "  [OK]   cargo:         $$(cargo --version)"; \
	else \
		echo "  [MISS] cargo:         Install Rust via https://rustup.rs"; \
	fi
	@if [ "$(UNAME_S)" = "Darwin" ]; then \
		if command -v xcodebuild >/dev/null 2>&1; then \
			echo "  [OK]   xcodebuild:    $$(xcodebuild -version | head -n 1)"; \
		else \
			echo "  [MISS] xcodebuild:    Install Xcode from the Mac App Store"; \
		fi; \
		if command -v xcodegen >/dev/null 2>&1 || [ -x "$(CURDIR)/.build/xcodegen/xcodegen/bin/xcodegen" ]; then \
			echo "  [OK]   xcodegen:      Available"; \
		else \
			echo "  [INFO] xcodegen:      Will be downloaded automatically to .build/xcodegen on 'make ios-demo'"; \
		fi; \
	else \
		echo "  [SKIP] iOS/Xcode:     macOS required for XCFramework & Xcode demo builds"; \
	fi
	@if command -v cargo-ndk >/dev/null 2>&1; then \
		echo "  [OK]   cargo-ndk:     $$(cargo ndk --version)"; \
	else \
		echo "  [INFO] cargo-ndk:     Run 'cargo install cargo-ndk' (needed for 'make android')"; \
	fi
	@if [ -n "$${ANDROID_NDK_HOME:-}$${NDK_HOME:-}" ]; then \
		echo "  [OK]   Android NDK:   $${ANDROID_NDK_HOME:-$$NDK_HOME}"; \
	else \
		echo "  [INFO] Android NDK:   Set ANDROID_NDK_HOME to build Android JNI libraries locally"; \
	fi

ensure-esbuild:
	@if [ ! -f node_modules/esbuild/package.json ] && ! command -v esbuild >/dev/null 2>&1 && [ -z "$${ESBUILD_BINARY:-}" ]; then \
		echo "--> Installing npm devDependencies (esbuild)..."; \
		npm install; \
	fi

web: ensure-esbuild
	node scripts/build.js

engine-asset: $(ENGINE_ASSET)

$(ENGINE_ASSET): | ensure-esbuild
	node scripts/build.js --three-live

web-demo: web
	@echo ""
	@echo "================================================================================"
	@echo "  Serving Three-Live & XR-Live Web Playgrounds on http://localhost:$(PORT)"
	@echo "  * Three-Live Demo: http://localhost:$(PORT)/three/index.html"
	@echo "  * XR-Live Demo:    http://localhost:$(PORT)/xr/index.html"
	@echo "================================================================================"
	python3 -m http.server $(PORT) --directory examples

rust: engine-asset
	@echo "--> Building Rust compiler & CLI via Cargo..."
	cd compiler && cargo build --release

test-web: ensure-esbuild
	node scripts/build.js --test

test-rust: engine-asset
	@echo "--> Running Rust compiler tests via Cargo..."
	cd compiler && cargo test

test: test-web test-rust
	@echo "=== All tests passed! ==="

ios: engine-asset
	@if [ "$(UNAME_S)" != "Darwin" ]; then \
		echo "Error: 'make ios' requires macOS with Xcode installed (current OS: $(UNAME_S))." >&2; \
		exit 1; \
	fi
	bash scripts/build_ios_xcframework.sh
	cd mobile/ios && swift test

ios-demo: engine-asset
	@if [ "$(UNAME_S)" != "Darwin" ]; then \
		echo "Error: 'make ios-demo' requires macOS with Xcode installed (current OS: $(UNAME_S))." >&2; \
		exit 1; \
	fi
	bash scripts/build_ios_xcframework.sh
	@XCODEGEN_BIN=$$(command -v xcodegen || true); \
	if [ -z "$$XCODEGEN_BIN" ] && [ -x "$(CURDIR)/.build/xcodegen/xcodegen/bin/xcodegen" ]; then \
		XCODEGEN_BIN="$(CURDIR)/.build/xcodegen/xcodegen/bin/xcodegen"; \
	fi; \
	if [ -z "$$XCODEGEN_BIN" ]; then \
		echo "--> Downloading standalone xcodegen binary to .build/xcodegen (no Homebrew required)..."; \
		mkdir -p "$(CURDIR)/.build/xcodegen"; \
		curl -fsSL https://github.com/yonaskolb/XcodeGen/releases/latest/download/xcodegen.zip -o "$(CURDIR)/.build/xcodegen/xcodegen.zip" && \
		unzip -qo "$(CURDIR)/.build/xcodegen/xcodegen.zip" -d "$(CURDIR)/.build/xcodegen" && \
		XCODEGEN_BIN="$(CURDIR)/.build/xcodegen/xcodegen/bin/xcodegen"; \
	fi; \
	cd mobile/examples/ios_swiftui && "$$XCODEGEN_BIN" generate && open ThreeLiveDemo.xcodeproj

android: engine-asset
	@if command -v rustup >/dev/null 2>&1; then \
		rustup target add aarch64-linux-android x86_64-linux-android armv7-linux-androideabi; \
	fi
	bash scripts/build_android_aar.sh

android-demo: android
	./gradlew :mobile:examples:android_compose:assembleDebug
	@echo "=== Debug APK built at: mobile/examples/android_compose/build/outputs/apk/debug/ ==="
	@if [ "$(UNAME_S)" = "Darwin" ] && [ -d "/Applications/Android Studio.app" ]; then \
		open -a "Android Studio" .; \
	fi

all: web rust
	@if [ "$(UNAME_S)" = "Darwin" ] && command -v xcodebuild >/dev/null 2>&1; then \
		$(MAKE) ios; \
	fi
	@if command -v cargo-ndk >/dev/null 2>&1 && [ -n "$${ANDROID_NDK_HOME:-}$${NDK_HOME:-}" ]; then \
		$(MAKE) android; \
	fi
	@echo "=== Build complete! ==="

clean:
	rm -rf dist three-live/dist xr-live/dist target .gradle
	rm -f $(ENGINE_ASSET) examples/three/three-live.js examples/three/three-live-sandbox.html examples/xr/xr-live.min.js examples/xr/xr-live-extras.min.js examples/xr/three-live-sandbox.html three-live/examples/three-live.js three-live/examples/three-live-sandbox.html
	rm -rf mobile/android/build mobile/android/src/main/jniLibs
	rm -rf mobile/examples/android_compose/build
	rm -rf mobile/ios/ThreeLiveCompiler.xcframework mobile/ios/.build
	rm -rf mobile/examples/ios_swiftui/ThreeLiveDemo.xcodeproj
	@echo "=== Cleaned build artifacts ==="
