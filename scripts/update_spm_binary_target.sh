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
# Pins the release tag and XCFramework SHA-256 into Package.swift.
#
# The checksum of a release artifact cannot be known until the artifact is built, so the
# manifest committed on a tag is necessarily stale until this runs. The release workflow
# invokes this after publishing the release and then moves the tag.
#
# Usage: update_spm_binary_target.sh <tag> <sha256>
#
# Written for bash 3.2, which is what macOS ships as /bin/bash.

set -euo pipefail

TAG="${1:-}"
CHECKSUM="${2:-}"

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
MANIFEST="${ROOT_DIR}/Package.swift"

if [[ -z "${TAG}" || -z "${CHECKSUM}" ]]; then
    echo "Error: usage: $(basename "$0") <tag> <sha256>" >&2
    exit 1
fi

if ! echo "${CHECKSUM}" | grep -qE '^[0-9a-f]{64}$'; then
    echo "Error: '${CHECKSUM}' is not a lowercase 64-character hex SHA-256." >&2
    exit 1
fi

if ! echo "${CHECKSUM}" | grep -qE '[1-9a-f]'; then
    echo "Error: refusing to pin an all-zero placeholder checksum." >&2
    exit 1
fi

if [[ ! -f "${MANIFEST}" ]]; then
    echo "Error: ${MANIFEST} not found." >&2
    exit 1
fi

# Both constants are declared on single lines in Package.swift specifically so that this
# rewrite stays a simple, reviewable substitution.
sed -i.bak -E \
    -e "s|^let releaseTag = \".*\"$|let releaseTag = \"${TAG}\"|" \
    -e "s|^let releaseChecksum = \"[0-9a-fA-F]{64}\"$|let releaseChecksum = \"${CHECKSUM}\"|" \
    "${MANIFEST}"
rm -f "${MANIFEST}.bak"

# Verify the substitution actually landed; sed reports success even when nothing matched.
if ! grep -qx "let releaseTag = \"${TAG}\"" "${MANIFEST}"; then
    echo "Error: failed to pin release tag in ${MANIFEST}." >&2
    exit 1
fi

if ! grep -qx "let releaseChecksum = \"${CHECKSUM}\"" "${MANIFEST}"; then
    echo "Error: failed to pin release checksum in ${MANIFEST}." >&2
    exit 1
fi

echo "Pinned ThreeLiveCompiler.xcframework for ${TAG} (sha256 ${CHECKSUM})."
