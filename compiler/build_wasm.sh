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
cd "${SCRIPT_DIR}"

echo "============================================================"
echo "  Building three-compiler WebAssembly Packages"
echo "============================================================"

# Ensure cargo is available in PATH
if ! command -v cargo &> /dev/null; then
    if [ -x "${HOME}/.cargo/bin/cargo" ]; then
        export PATH="${HOME}/.cargo/bin:${PATH}"
    fi
fi

# Check for wasm-pack
WASM_PACK_CMD=""
if command -v wasm-pack &> /dev/null; then
    WASM_PACK_CMD="wasm-pack"
elif command -v npx &> /dev/null && npx --no-install wasm-pack --version &> /dev/null; then
    WASM_PACK_CMD="npx wasm-pack"
else
    echo "⚠️  wasm-pack not found in PATH."
    echo "   Installing wasm-pack via cargo..."
    cargo install wasm-pack --quiet
    WASM_PACK_CMD="wasm-pack"
fi

echo "📦 wasm-pack executable: ${WASM_PACK_CMD}"

# Set local target dir to prevent FUSE text file busy errors
export CARGO_TARGET_DIR="${CARGO_TARGET_DIR:-/tmp/three_live_wasm_target}"

# `getrandom` (a transitive dependency of `boa_engine`) refuses to compile for
# `wasm32-unknown-unknown` unless the backend is named explicitly, because that target
# has no ambient source of entropy. `wasm_js` routes it to `crypto.getRandomValues()`.
export RUSTFLAGS="${RUSTFLAGS:-} --cfg getrandom_backend=\"wasm_js\""

# Clean previous build artifacts
rm -rf pkg
mkdir -p pkg/web pkg/node pkg/bundler

echo ""
echo "🧪 [0/3] Running WebAssembly tests under Node.js..."
${WASM_PACK_CMD} test --node -- --no-default-features --features wasm

echo ""
echo "⚙️  [1/3] Compiling for Web Browsers / Web Workers (--target web)..."
${WASM_PACK_CMD} build \
    --target web \
    --out-dir pkg/web \
    --scope three-live \
    --release \
    -- --no-default-features --features wasm

echo ""
echo "⚙️  [2/3] Compiling for Node.js (--target nodejs)..."
${WASM_PACK_CMD} build \
    --target nodejs \
    --out-dir pkg/node \
    --scope three-live \
    --release \
    -- --no-default-features --features wasm

echo ""
echo "⚙️  [3/3] Compiling for ESM Bundlers (--target bundler)..."
${WASM_PACK_CMD} build \
    --target bundler \
    --out-dir pkg/bundler \
    --scope three-live \
    --release \
    -- --no-default-features --features wasm

echo ""
echo "✨ [Done] WebAssembly targets generated successfully in pkg/:"
echo "   - pkg/web/     (Direct browser / Web Worker loading with init())"
echo "   - pkg/node/    (CommonJS / Node.js native runtime loading)"
echo "   - pkg/bundler/ (Vite / Webpack / Rollup bundler integration)"
echo "============================================================"
