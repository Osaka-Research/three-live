// swift-tools-version: 5.9
//
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
//
// This is the only package manifest in the repository. Both consumers and CI resolve it, so
// there is a single code path to keep correct.

import Foundation
import PackageDescription

// MARK: - Binary target resolution
//
// The native compiler ships as a prebuilt XCFramework. When one is present in the working
// tree -- because `scripts/build_ios_xcframework.sh` has been run -- it is used directly.
// Otherwise the release artifact is downloaded from GitHub.
//
// The two constants below are rewritten automatically at release time by
// `scripts/update_spm_binary_target.sh`. Do not edit them by hand.
let releaseTag = "v1.3.0"
let releaseChecksum = "67d975ddd4f5eebca5575e1d094eb5e343c4211522e8b97c8afcfb061ac0c792"

let packageDir = URL(fileURLWithPath: #filePath).deletingLastPathComponent()
let candidateFrameworkPaths = [
  "mobile/ios/ThreeLiveCompiler.xcframework",
  "ThreeLiveCompiler.xcframework",
]
let localFrameworkPath = candidateFrameworkPaths.first {
  FileManager.default.fileExists(atPath: packageDir.appendingPathComponent($0).path)
}

var compilerDeps: [Target.Dependency] = ["ThreeLiveCompilerC"]
var targets: [Target] = [
  .target(
    name: "ThreeLiveCompilerC",
    path: "mobile/ios/Sources/ThreeLiveCompilerC",
    publicHeadersPath: "include"
  )
]

if let localFrameworkPath {
  targets.append(
    .binaryTarget(
      name: "ThreeLiveCompilerBinary",
      path: localFrameworkPath
    )
  )
} else {
  // Fail with an actionable message rather than letting SwiftPM report an opaque checksum
  // mismatch, and rather than silently dropping the binary target (which would surface much
  // later as undefined `three_live_*` symbols at link time).
  guard releaseChecksum.contains(where: { $0 != "0" }) else {
    fatalError(
      """
      ThreeLiveCompiler has no pinned release checksum, so the prebuilt XCFramework \
      cannot be downloaded. This tag was not published by the release workflow. \
      Either check out a released tag, or build the framework locally with \
      `bash scripts/build_ios_xcframework.sh`.
      """
    )
  }
  targets.append(
    .binaryTarget(
      name: "ThreeLiveCompilerBinary",
      url: "https://github.com/google/three-live/releases/download/"
        + "\(releaseTag)/ThreeLiveCompiler.xcframework.zip",
      checksum: releaseChecksum
    )
  )
}
compilerDeps.append("ThreeLiveCompilerBinary")

targets.append(
  .target(
    name: "ThreeLiveCompiler",
    dependencies: compilerDeps,
    path: "mobile/ios/Sources/ThreeLiveCompiler"
  )
)

targets.append(
  .testTarget(
    name: "ThreeLiveCompilerTests",
    dependencies: ["ThreeLiveCompiler"],
    path: "mobile/ios/Tests/ThreeLiveCompilerTests"
  )
)

let package = Package(
  name: "ThreeLiveCompiler",
  platforms: [
    .iOS(.v15),
    .macOS(.v12),
    .visionOS(.v1),
    .tvOS(.v15),
  ],
  products: [
    .library(
      name: "ThreeLiveCompiler",
      targets: ["ThreeLiveCompiler"]
    )
  ],
  targets: targets
)
