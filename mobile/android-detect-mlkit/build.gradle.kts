// Copyright 2026 Google LLC
//
// Licensed under the Apache License, Version 2.0 (the "License");
// you may not use this file except in compliance with the License.
// You may obtain a copy of the License at
//
//     http://www.apache.org/licenses/LICENSE-2.0
//
// Unless required by applicable law or agreed to in writing, software
// distributed under the License is distributed on an "AS IS" BASIS,
// WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
// See the License for the specific language governing permissions and
// limitations under the License.

// Optional ML Kit on-device object detector for three-live. The core `:mobile:android` library stays
// zero-dependency; apps opt in by adding this module and calling ThreeLiveMlKitDetector.install().

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
  `maven-publish`
}

base { archivesName.set("three-live-detect-mlkit") }

android {
  namespace = "com.google.threelive.mlkit"
  compileSdk = 34

  defaultConfig { minSdk = 24 }

  compileOptions {
    sourceCompatibility = JavaVersion.VERSION_17
    targetCompatibility = JavaVersion.VERSION_17
  }

  kotlinOptions { jvmTarget = "17" }

  publishing {
    singleVariant("release") {
      withSourcesJar()
      withJavadocJar()
    }
  }
}

dependencies {
  api(project(":mobile:android"))
  api("com.google.mlkit:object-detection:17.0.2")

  testImplementation("junit:junit:4.13.2")
}

publishing {
  publications {
    register<MavenPublication>("release") {
      groupId = "com.google.threelive"
      artifactId = "detect-mlkit"
      version = "1.0.0"
      afterEvaluate { from(components["release"]) }

      pom {
        name.set("Three-Live ML Kit Object Detector")
        description.set("Optional ML Kit on-device object detector for three-live on Android")
        url.set("https://github.com/google/three-live")
        licenses {
          license {
            name.set("The Apache License, Version 2.0")
            url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
            distribution.set("repo")
          }
        }
      }
    }
  }
}
