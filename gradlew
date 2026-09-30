#!/bin/sh
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
# Gradle wrapper launcher.
#
# NOTE: gradle-wrapper.jar is intentionally NOT checked in. It is a compiled binary, and this
# source tree is mirrored from a repository that does not accept build artifacts. The pinned
# Gradle version still lives in gradle/wrapper/gradle-wrapper.properties and is honoured by:
#
#   * this script, once the jar has been generated locally
#     (run scripts/bootstrap_gradle_wrapper.sh once);
#   * CI, which provisions the same version explicitly via gradle/actions/setup-gradle.
#
# If the jar is absent we fall back to a Gradle already on PATH, which may be a different version.

set -e

APP_HOME="$(cd "$(dirname "$0")" && pwd)"
WRAPPER_JAR="$APP_HOME/gradle/wrapper/gradle-wrapper.jar"
WRAPPER_PROPERTIES="$APP_HOME/gradle/wrapper/gradle-wrapper.properties"

pinned_version() {
    sed -n 's|.*/gradle-\([0-9][0-9.]*\)-bin\.zip.*|\1|p' "$WRAPPER_PROPERTIES" 2>/dev/null
}

if [ -f "$WRAPPER_JAR" ]; then
    JAVACMD="${JAVA_HOME:+$JAVA_HOME/bin/}java"
    exec "$JAVACMD" -Xmx64m -Xms64m -Dorg.gradle.appname=gradlew \
        -classpath "$WRAPPER_JAR" org.gradle.wrapper.GradleWrapperMain "$@"
elif command -v gradle >/dev/null 2>&1; then
    PINNED="$(pinned_version)"
    CURRENT="$(gradle --version 2>/dev/null | sed -n 's/^Gradle \([0-9][0-9.]*\)$/\1/p')"
    if [ -n "$PINNED" ] && [ -n "$CURRENT" ] && [ "$PINNED" != "$CURRENT" ]; then
        echo "Warning: using Gradle $CURRENT from PATH, but this project pins $PINNED." >&2
        echo "         Run scripts/bootstrap_gradle_wrapper.sh to use the pinned version." >&2
    fi
    exec gradle "$@"
else
    echo "Error: no Gradle available." >&2
    echo >&2
    echo "gradle-wrapper.jar is not checked in (see the comment at the top of this script)." >&2
    echo "Generate it once with:" >&2
    echo >&2
    echo "    scripts/bootstrap_gradle_wrapper.sh" >&2
    echo >&2
    echo "That requires Gradle on PATH (e.g. 'sdk install gradle', 'brew install gradle')." >&2
    exit 1
fi
