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
# Generates gradle/wrapper/gradle-wrapper.jar locally.
#
# The jar is a compiled binary and is deliberately not checked in, so `./gradlew` cannot run the
# pinned Gradle version on a fresh clone. This script produces it from the version already pinned
# in gradle-wrapper.properties, and is a one-time step per clone.
#
# `gradle wrapper` also rewrites gradlew, gradlew.bat and gradle-wrapper.properties. We restore the
# checked-in versions of those afterwards so only the generated jar is left behind.

set -euo pipefail

SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
ROOT_DIR="$(cd "${SCRIPT_DIR}/.." && pwd)"
WRAPPER_DIR="${ROOT_DIR}/gradle/wrapper"
PROPERTIES="${WRAPPER_DIR}/gradle-wrapper.properties"

if [ ! -f "${PROPERTIES}" ]; then
    echo "Error: ${PROPERTIES} not found." >&2
    exit 1
fi

GRADLE_VERSION="$(sed -n 's|.*/gradle-\([0-9][0-9.]*\)-bin\.zip.*|\1|p' "${PROPERTIES}")"
if [ -z "${GRADLE_VERSION}" ]; then
    echo "Error: could not parse the pinned Gradle version from ${PROPERTIES}." >&2
    exit 1
fi

echo "=== Three-Live: generating Gradle ${GRADLE_VERSION} wrapper jar ==="

BACKUP_DIR="$(mktemp -d)"
trap 'rm -rf "${BACKUP_DIR}"' EXIT

# Fast, JVM-free extraction: every Gradle distribution bundles the standalone `gradle-wrapper.jar`
# inside `lib/plugins/gradle-wrapper-<version>.jar`. Extracting it directly via `unzip` avoids
# invoking a system/Homebrew `gradle` binary (which may run against an incompatible Java version
# such as JDK 25 before `./gradlew` is even bootstrapped).
PLUGIN_JAR="$(ls "${HOME}/.gradle/wrapper/dists/gradle-${GRADLE_VERSION}"-*/*/gradle-"${GRADLE_VERSION}"/lib/plugins/gradle-wrapper-"${GRADLE_VERSION}".jar 2>/dev/null | head -n 1 || true)"
if [ -z "${PLUGIN_JAR}" ]; then
    PLUGIN_JAR="$(ls "${HOME}/.gradle/wrapper/dists"/gradle-*-*/*/gradle-*/lib/plugins/gradle-wrapper-*.jar 2>/dev/null | tail -n 1 || true)"
fi

if [ -z "${PLUGIN_JAR}" ] || [ ! -f "${PLUGIN_JAR}" ]; then
    echo "--> Downloading Gradle ${GRADLE_VERSION} distribution to extract gradle-wrapper.jar..."
    curl -fsSL "https://services.gradle.org/distributions/gradle-${GRADLE_VERSION}-bin.zip" -o "${BACKUP_DIR}/gradle.zip"
    unzip -qo "${BACKUP_DIR}/gradle.zip" "gradle-${GRADLE_VERSION}/lib/plugins/gradle-wrapper-${GRADLE_VERSION}.jar" -d "${BACKUP_DIR}"
    PLUGIN_JAR="${BACKUP_DIR}/gradle-${GRADLE_VERSION}/lib/plugins/gradle-wrapper-${GRADLE_VERSION}.jar"
fi

mkdir -p "${WRAPPER_DIR}"
unzip -p "${PLUGIN_JAR}" gradle-wrapper.jar > "${WRAPPER_DIR}/gradle-wrapper.jar"
chmod +x "${ROOT_DIR}/gradlew"

if [ ! -f "${WRAPPER_DIR}/gradle-wrapper.jar" ]; then
    echo "Error: gradle wrapper ran but produced no jar." >&2
    exit 1
fi

echo "=== Done. './gradlew' now runs Gradle ${GRADLE_VERSION}. ==="
echo "Note: gradle/wrapper/gradle-wrapper.jar is gitignored and must not be committed."
