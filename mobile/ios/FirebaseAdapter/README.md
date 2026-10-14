<!--
Copyright 2026 Google LLC

Licensed under the Apache License, Version 2.0 (the "License");
you may not use this file except in compliance with the License.
You may obtain a copy of the License at

    http://www.apache.org/licenses/LICENSE-2.0

Unless required by applicable law or agreed to in writing, software
distributed under the License is distributed on an "AS IS" BASIS,
WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
See the License for the specific language governing permissions and
limitations under the License.
-->

# ThreeLiveFirebaseAI (optional)

Routes three-live's native Gemini Live client (`XRGeminiLiveController`)
through [Firebase AI Logic](https://firebase.google.com/docs/ai-logic) instead
of the default plain Live API transport. Use it if your app already uses
Firebase (App Check, Firebase Auth, or the Vertex AI backend).

This is a separate Swift package so the main `ThreeLiveCompiler` package never
depends on Firebase. Add it in Xcode with the repository URL and the
`mobile/ios/FirebaseAdapter` path, or point a local package at this directory.
Requires Xcode 16 (firebase-ios-sdk 12.6+).

```swift
import FirebaseAILogic
import ThreeLiveCompiler
import ThreeLiveFirebaseAI

let model = FirebaseAI.firebaseAI(backend: .googleAI()).liveModel(
  modelName: "gemini-live-2.5-flash",
  generationConfig: LiveGenerationConfig(responseModalities: [.audio]))
let transport = try await FirebaseLiveTransport.connect(model)
controller.connect(transport)
```
