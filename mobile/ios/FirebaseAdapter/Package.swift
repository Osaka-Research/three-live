// swift-tools-version:5.9
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
// Optional Firebase AI Logic adapter for the native Gemini Live client. Kept in its own package
// so the root ThreeLiveCompiler manifest never resolves Firebase.

import PackageDescription

let package = Package(
  name: "ThreeLiveFirebaseAI",
  platforms: [.iOS(.v15), .macOS(.v12)],
  products: [
    .library(name: "ThreeLiveFirebaseAI", targets: ["ThreeLiveFirebaseAI"])
  ],
  dependencies: [
    .package(url: "https://github.com/google/three-live.git", from: "1.0.0"),
    // 12.6 is the first release with the Live API; 13.x requires Swift tools 6.2.
    .package(url: "https://github.com/firebase/firebase-ios-sdk.git", "12.6.0"..<"13.0.0"),
  ],
  targets: [
    .target(
      name: "ThreeLiveFirebaseAI",
      dependencies: [
        .product(name: "ThreeLiveCompiler", package: "three-live"),
        .product(name: "FirebaseAILogic", package: "firebase-ios-sdk"),
      ]
    )
  ]
)
