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
# Keeps the SwiftPM copy of the C header byte-identical to the canonical one.
#
# SwiftPM requires the public header to live inside the ThreeLiveCompilerC target directory,
# so the repository necessarily carries two copies. Nothing in the compiler would catch a
# divergence between them -- a mismatched declaration is an ABI bug, not a build error -- so
# the copy is generated and CI asserts it is current.
#
#   sync_c_header.sh          Regenerate the SwiftPM copy.
#   sync_c_header.sh --check  Fail if the copy is stale. Used by CI.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"

CANONICAL="${ROOT_DIR}/compiler/include/three_live_compiler.h"
SWIFTPM_COPY="${ROOT_DIR}/mobile/ios/Sources/ThreeLiveCompilerC/include/ThreeLiveCompiler.h"

if [[ ! -f "${CANONICAL}" ]]; then
    echo "Error: canonical header not found at ${CANONICAL}" >&2
    exit 1
fi

if [[ "${1:-}" == "--check" ]]; then
    if ! diff -u "${CANONICAL}" "${SWIFTPM_COPY}"; then
        echo "" >&2
        echo "Error: ${SWIFTPM_COPY} is out of date." >&2
        echo "Run 'bash scripts/sync_c_header.sh' and commit the result." >&2
        exit 1
    fi
    echo "C header copy is up to date."
    exit 0
fi

cp "${CANONICAL}" "${SWIFTPM_COPY}"
echo "Synced $(basename "${SWIFTPM_COPY}") from $(basename "${CANONICAL}")."
