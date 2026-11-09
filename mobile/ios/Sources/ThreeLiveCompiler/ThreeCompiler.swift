/*
 * Copyright 2026 Google LLC
 *
 * Licensed under the Apache License, Version 2.0 (the "License");
 * you may not use this file except in compliance with the License.
 * You may obtain a copy of the License at
 *
 *     http://www.apache.org/licenses/LICENSE-2.0
 *
 * Unless required by applicable law or agreed to in writing, software
 * distributed under the License is distributed on an "AS IS" BASIS,
 * WITHOUT WARRANTIES OR CONDITIONS OF ANY KIND, either express or implied.
 * See the License for the specific language governing permissions and
 * limitations under the License.
 */

import Dispatch
import Foundation
import ThreeLiveCompilerC

/// Errors thrown by the ThreeLive compiler.
public enum ThreeCompilerError: Error, LocalizedError, Equatable {
  /// The native compiler reported a failure. The payload is the compiler diagnostic.
  case compilationFailed(String)

  /// The supplied script cannot be passed across the C boundary. The payload explains why.
  case invalidScript(String)

  /// The native compiler reported success but produced no bytes.
  case emptyResult(String)

  public var errorDescription: String? {
    switch self {
    case .compilationFailed(let message):
      return "Three.js compilation failed: \(message)"
    case .invalidScript(let reason):
      return "Script could not be passed to the native compiler: \(reason)"
    case .emptyResult(let operation):
      return "Native compiler returned an empty buffer from \(operation)"
    }
  }
}

/// High-performance procedural Three.js to binary glTF 2.0 (GLB) and USDZ compiler
/// for iOS, visionOS, tvOS, and macOS.
public enum ThreeCompiler {

  /// Dedicated OS thread with an 8 MiB stack used to run the blocking native compiler.
  ///
  /// The native compiler is CPU-bound and blocks for the duration of a compile. It must
  /// therefore NOT run on Swift Concurrency's global concurrent executor (the cooperative
  /// thread pool), which is width-limited to roughly the core count and relies on threads
  /// always making forward progress. Blocking those threads starves unrelated `async` work
  /// in the host application.
  ///
  /// In addition, Darwin's `DispatchQueue` and Swift Concurrency worker threads only
  /// allocate a 512 KiB stack, which is too small for the Rust Boa JavaScript parser and
  /// evaluator (especially in unoptimized debug/test builds), and `three_live_compiler`
  /// caches the warmed `ThreeEngine` in thread-local storage (`THREAD_LOCAL_ENGINE`).
  /// Pinning all compiles to a single persistent 8 MiB worker thread prevents stack-guard
  /// faults and ensures the thread-local Boa VM is initialized only once.
  private final class CompilerWorkerThread: @unchecked Sendable {
    static let shared = CompilerWorkerThread()

    private let condition = NSCondition()
    private var queue: [@Sendable () -> Void] = []
    private var workerThread: Thread?

    private init() {
      let thread = Thread { [weak self] in
        self?.runLoop()
      }
      thread.name = "com.google.threelive.compile"
      thread.qualityOfService = .userInitiated
      thread.stackSize = 8 * 1024 * 1024
      self.workerThread = thread
      thread.start()
    }

    var isCurrentThread: Bool {
      Thread.current === workerThread
    }

    func enqueue(_ job: @escaping @Sendable () -> Void) {
      condition.lock()
      queue.append(job)
      condition.signal()
      condition.unlock()
    }

    func performSync<T: Sendable>(_ work: @escaping @Sendable () throws -> T) throws -> T {
      if isCurrentThread {
        return try work()
      }
      let box = SyncResultBox<T>()
      enqueue {
        box.complete(with: Result(catching: work))
      }
      return try box.wait()
    }

    private func runLoop() {
      while true {
        let job: @Sendable () -> Void
        condition.lock()
        while queue.isEmpty {
          condition.wait()
        }
        job = queue.removeFirst()
        condition.unlock()
        autoreleasepool {
          job()
        }
      }
    }
  }

  private final class SyncResultBox<T>: @unchecked Sendable {
    private let condition = NSCondition()
    private var result: Result<T, Error>?

    func complete(with value: Result<T, Error>) {
      condition.lock()
      result = value
      condition.signal()
      condition.unlock()
    }

    func wait() throws -> T {
      condition.lock()
      while result == nil {
        condition.wait()
      }
      let r = result!
      condition.unlock()
      return try r.get()
    }
  }

  // MARK: - Asynchronous entry points

  /// Compiles a Three.js scene script into binary GLB Data with ZERO memory copies.
  ///
  /// The returned `Data` instance wraps the native heap memory allocated by Rust.
  /// When the `Data` instance is deallocated by Swift ARC, the native Rust memory
  /// is automatically released via `three_live_free_buffer`.
  ///
  /// - Note: The underlying native compile cannot be interrupted. Cancelling the
  ///   surrounding task will not stop work already in flight.
  ///
  /// - Parameter script: The Three.js scene script to compile.
  /// - Returns: A `Data` instance containing the binary `.glb` wire bytes.
  public static func compile(_ script: String) async throws -> Data {
    try await offloadFromCooperativePool { try compileSync(script) }
  }

  /// Convenience alias for `compile(_:)` matching `compileUSDZ(_:)`.
  public static func compileGLB(_ script: String) async throws -> Data {
    try await compile(script)
  }

  /// Compiles a Three.js scene script into binary USDZ Data with ZERO memory copies.
  ///
  /// - Note: The underlying native compile cannot be interrupted. Cancelling the
  ///   surrounding task will not stop work already in flight.
  ///
  /// - Parameter script: The Three.js scene script to compile.
  /// - Returns: A `Data` instance containing the 64-byte aligned binary `.usdz` archive.
  public static func compileUSDZ(_ script: String) async throws -> Data {
    try await offloadFromCooperativePool { try compileUSDZSync(script) }
  }

  /// Transcodes binary GLB Data directly into binary USDZ Data with ZERO memory copies.
  ///
  /// - Note: The underlying native transcode cannot be interrupted. Cancelling the
  ///   surrounding task will not stop work already in flight.
  ///
  /// - Parameter glbData: The binary `.glb` data to convert.
  /// - Returns: A `Data` instance containing the 64-byte aligned binary `.usdz` archive.
  public static func glbToUSDZ(_ glbData: Data) async throws -> Data {
    try await offloadFromCooperativePool { try glbToUSDZSync(glbData) }
  }

  // MARK: - Synchronous entry points

  /// Synchronous compilation entry point. Safe to call from background threads.
  ///
  /// - Parameter script: The Three.js scene script to compile.
  /// - Returns: A `Data` instance containing the binary `.glb` wire bytes.
  public static func compileSync(_ script: String) throws -> Data {
    let cScript = try nullTerminatedUTF8(script)
    return try CompilerWorkerThread.shared.performSync {
      let result = cScript.withUnsafeBufferPointer { ptr in
        three_live_compile(ptr.baseAddress)
      }
      return try takeOwnership(of: result, operation: "compile")
    }
  }

  /// Convenience alias for `compileSync(_:)` matching `compileUSDZSync(_:)`.
  public static func compileGLBSync(_ script: String) throws -> Data {
    try compileSync(script)
  }

  /// Synchronous USDZ compilation entry point. Safe to call from background threads.
  ///
  /// - Parameter script: The Three.js scene script to compile.
  /// - Returns: A `Data` instance containing the 64-byte aligned binary `.usdz` archive.
  public static func compileUSDZSync(_ script: String) throws -> Data {
    let cScript = try nullTerminatedUTF8(script)
    return try CompilerWorkerThread.shared.performSync {
      let result = cScript.withUnsafeBufferPointer { ptr in
        three_live_compile_usdz(ptr.baseAddress)
      }
      return try takeOwnership(of: result, operation: "compileUSDZ")
    }
  }

  /// Synchronous GLB to USDZ transcoding entry point. Safe to call from background threads.
  ///
  /// - Parameter glbData: The binary `.glb` data to convert.
  /// - Returns: A `Data` instance containing the 64-byte aligned binary `.usdz` archive.
  public static func glbToUSDZSync(_ glbData: Data) throws -> Data {
    // Deliberately do not short-circuit on empty input: the native layer produces a
    // precise diagnostic ("Null or empty GLB data provided") that is more useful than
    // anything synthesized here.
    guard !glbData.isEmpty else {
      throw ThreeCompilerError.compilationFailed("Null or empty GLB data provided")
    }

    return try CompilerWorkerThread.shared.performSync {
      let result = glbData.withUnsafeBytes { rawBuffer -> ThreeLiveBuffer in
        guard let baseAddr = rawBuffer.baseAddress?.assumingMemoryBound(to: UInt8.self) else {
          return ThreeLiveBuffer(data: nil, len: 0, capacity: 0, error_msg: nil)
        }
        return three_live_glb_to_usdz(baseAddr, rawBuffer.count)
      }
      return try takeOwnership(of: result, operation: "glbToUSDZ")
    }
  }

  // MARK: - AI core

  /// Runs one AI scene-editing / voice-protocol JSON request in the shared Rust core
  /// (`three_live_ai_call`). Always returns JSON; failures come back as `{"error": ...}`.
  ///
  /// - Parameter onCompilerThread: `true` for ops that compile scripts (`validate`), so they reuse
  ///   the warm JavaScript VM on the 8 MiB compiler thread; `false` for pure ops (prompts,
  ///   parsing, voice protocol), which then never wait behind a compile.
  public static func aiCall(_ request: String, onCompilerThread: Bool) async throws -> String {
    let cRequest = try nullTerminatedUTF8(request)
    let work: @Sendable () -> String = {
      let ptr = cRequest.withUnsafeBufferPointer { three_live_ai_call($0.baseAddress) }
      guard let ptr = ptr else { return "{\"error\":\"null response\"}" }
      defer { three_live_free_string(ptr) }
      return String(cString: ptr)
    }
    if onCompilerThread {
      return try await offloadFromCooperativePool(work)
    }
    return work()
  }

  // MARK: - Private helpers

  /// Runs blocking native work on the dedicated 8 MiB compiler thread rather than the cooperative thread pool.
  private static func offloadFromCooperativePool<T: Sendable>(
    _ work: @escaping @Sendable () throws -> T
  ) async throws -> T {
    try await withCheckedThrowingContinuation { continuation in
      CompilerWorkerThread.shared.enqueue {
        continuation.resume(with: Result(catching: work))
      }
    }
  }

  /// Converts a Swift `String` into a NUL-terminated UTF-8 buffer suitable for the C ABI.
  ///
  /// `String.cString(using: .utf8)` is unsuitable here: it silently truncates at the first
  /// embedded NUL scalar, so a script containing U+0000 would be partially compiled with no
  /// diagnostic. This rejects such scripts instead.
  private static func nullTerminatedUTF8(_ script: String) throws -> [CChar] {
    var bytes = Array(script.utf8)
    if let nullIndex = bytes.firstIndex(of: 0) {
      throw ThreeCompilerError.invalidScript(
        "script contains an embedded NUL byte at offset \(nullIndex), "
          + "which cannot be represented as a C string"
      )
    }
    bytes.append(0)
    return bytes.map { CChar(bitPattern: $0) }
  }

  /// Takes ownership of a native buffer, converting it into a zero-copy `Data`.
  ///
  /// On every path this either transfers ownership to the returned `Data` or frees the
  /// native allocation before throwing; the caller never needs to clean up.
  private static func takeOwnership(
    of result: ThreeLiveBuffer,
    operation: String
  ) throws -> Data {
    if let errPtr = result.error_msg {
      let errorMsg = String(cString: errPtr)
      three_live_free_error(errPtr)
      // The native layer never returns both an error and a buffer, but free defensively
      // so that a future change on the Rust side cannot introduce a silent leak here.
      if let dataPtr = result.data {
        three_live_free_buffer(dataPtr, result.capacity)
      }
      throw ThreeCompilerError.compilationFailed(errorMsg)
    }

    guard let dataPtr = result.data else {
      // A null buffer with no error message means the compiler produced nothing.
      // Surface that as an error rather than as a silently empty success.
      throw ThreeCompilerError.emptyResult(operation)
    }

    let capacity = result.capacity

    guard result.len > 0 else {
      // Non-null pointer with zero length. Unreachable today (Rust returns a null
      // buffer for empty output) but freeing here keeps this correct if that changes.
      three_live_free_buffer(dataPtr, capacity)
      throw ThreeCompilerError.emptyResult(operation)
    }

    // Zero-copy bridge: Swift Data takes ownership of the native pointer and triggers
    // the custom deallocator when its reference count drops to zero.
    //
    // The deallocator deliberately ignores the byte count Foundation supplies (that is
    // `len`) and closes over Rust's `capacity`, because the Rust allocator must be given
    // the original capacity, not the length.
    return Data(
      bytesNoCopy: dataPtr,
      count: result.len,
      deallocator: .custom { (rawPtr, _) in
        three_live_free_buffer(rawPtr.bindMemory(to: UInt8.self, capacity: capacity), capacity)
      }
    )
  }
}
