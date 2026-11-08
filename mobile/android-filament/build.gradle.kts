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

// Optional Filament renderer for three-live. The core `:mobile:android` library stays free of
// rendering dependencies; apps opt in by adding this module and calling
// ThreeLiveFilament.install().

import java.net.URL
import java.nio.file.Files
import java.nio.file.StandardCopyOption

plugins {
  id("com.android.library")
  id("org.jetbrains.kotlin.android")
  `maven-publish`
  signing
}

val filamentVersion = "1.56.0"
val compiledMaterialsDir = layout.buildDirectory.dir("generated/filamentAssets")

val compileFilamentMaterials by tasks.registering {
  val matFile = layout.projectDirectory.file("src/main/materials/splat.mat")
  val outDir = compiledMaterialsDir
  val matcCacheDir = layout.buildDirectory.dir("matc/$filamentVersion")
  inputs.file(matFile)
  outputs.dir(outDir)

  doLast {
    val targetFile = outDir.get().asFile.resolve("materials/splat.filamat")
    targetFile.parentFile.mkdirs()
    val prebuilt = layout.projectDirectory.file("src/main/materials/splat.filamat").asFile
    if (prebuilt.exists()) {
      Files.copy(prebuilt.toPath(), targetFile.toPath(), StandardCopyOption.REPLACE_EXISTING)
      return@doLast
    }

    val osName = System.getProperty("os.name").lowercase()
    val platformTag =
      when {
        osName.contains("mac") || osName.contains("darwin") -> "mac"
        osName.contains("win") -> "windows"
        else -> "linux"
      }
    val exeSuffix = if (platformTag == "windows") ".exe" else ""
    val matcRoot = matcCacheDir.get().asFile
    val matcBin = matcRoot.resolve("filament/bin/matc$exeSuffix")
    try {
      if (!matcBin.canExecute()) {
        matcRoot.mkdirs()
        val archive = matcRoot.resolve("filament-v$filamentVersion-$platformTag.tgz")
        val downloadUrl =
          "https://github.com/google/filament/releases/download/v$filamentVersion/filament-v$filamentVersion-$platformTag.tgz"
        URL(downloadUrl).openStream().use { input ->
          Files.copy(input, archive.toPath(), StandardCopyOption.REPLACE_EXISTING)
        }
        project.copy {
          from(project.tarTree(project.resources.gzip(archive))) {
            include("filament/bin/matc$exeSuffix")
          }
          into(matcRoot)
        }
        matcBin.setExecutable(true)
      }

      val execResult = project.exec {
        isIgnoreExitValue = true
        commandLine(
          matcBin.absolutePath,
          "-p",
          "mobile",
          "-a",
          "opengl",
          "-a",
          "vulkan",
          "-S",
          "-o",
          targetFile.absolutePath,
          matFile.asFile.absolutePath,
        )
      }
      if (execResult.exitValue != 0) {
        logger.warn(
          "Filament matc exited with code ${execResult.exitValue}; using built-in ubershader fallback for splats."
        )
        targetFile.delete()
      }
    } catch (e: Throwable) {
      logger.warn(
        "Could not run Filament matc (${e.message}); using built-in ubershader fallback for splats."
      )
      targetFile.delete()
    }
  }
}

base { archivesName.set("three-live-filament") }

android {
  namespace = "com.google.threelive.filament"
  compileSdk = 34

  sourceSets { getByName("main") { assets.srcDir(compiledMaterialsDir) } }

  defaultConfig {
    minSdk = 24
    targetSdk = 34
    ndk { abiFilters.addAll(listOf("arm64-v8a", "x86_64", "armeabi-v7a")) }
  }

  buildTypes {
    release {
      isMinifyEnabled = false
      proguardFiles(getDefaultProguardFile("proguard-android-optimize.txt"))
    }
  }

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

  // Keep in sync with mobile/examples/android_compose/build.gradle.kts.
  api("com.google.android.filament:filament-android:$filamentVersion")
  api("com.google.android.filament:gltfio-android:$filamentVersion")

  testImplementation("junit:junit:4.13.2")
}

tasks.named("preBuild") { dependsOn(compileFilamentMaterials) }

publishing {
  publications {
    register<MavenPublication>("release") {
      groupId = "com.google.threelive"
      artifactId = "filament"
      version = "1.3.2"
      afterEvaluate { from(components["release"]) }

      pom {
        name.set("Three-Live Filament Renderer")
        description.set("Optional Filament renderer for three-live scenes on Android")
        url.set("https://github.com/google/three-live")
        licenses {
          license {
            name.set("The Apache License, Version 2.0")
            url.set("https://www.apache.org/licenses/LICENSE-2.0.txt")
            distribution.set("repo")
          }
        }
        developers {
          developer {
            id.set("google")
            name.set("Google LLC")
          }
        }
        scm {
          connection.set("scm:git:git://github.com/google/three-live.git")
          developerConnection.set("scm:git:ssh://github.com:google/three-live.git")
          url.set("https://github.com/google/three-live")
        }
      }
    }
  }
  repositories {
    val ghToken = System.getenv("GITHUB_TOKEN")
    if (!ghToken.isNullOrBlank()) {
      maven {
        name = "GitHubPackages"
        url =
          uri(
            "https://maven.pkg.github.com/${System.getenv("GITHUB_REPOSITORY") ?: "google/three-live"}"
          )
        credentials {
          username = System.getenv("GITHUB_ACTOR") ?: "github-actions"
          password = ghToken
        }
      }
    }
    val centralUser = System.getenv("MAVEN_CENTRAL_USERNAME")
    val centralPass = System.getenv("MAVEN_CENTRAL_PASSWORD")
    if (!centralUser.isNullOrBlank() && !centralPass.isNullOrBlank()) {
      maven {
        name = "MavenCentral"
        url =
          uri(
            System.getenv("MAVEN_CENTRAL_REPO_URL")
              ?: "https://ossrh-staging-api.central.sonatype.com/service/local/staging/deploy/maven2/"
          )
        credentials {
          username = centralUser
          password = centralPass
        }
      }
    }
  }
}

signing {
  val gpgKey = System.getenv("MAVEN_GPG_PRIVATE_KEY")
  if (!gpgKey.isNullOrBlank()) {
    useInMemoryPgpKeys(gpgKey, System.getenv("MAVEN_GPG_PASSPHRASE") ?: "")
    sign(publishing.publications)
  }
}
