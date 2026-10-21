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

#if canImport(QuickLook) && canImport(UIKit)
  import Dispatch
  import Foundation
  import QuickLook
  import UIKit
  #if canImport(ARKit)
    import ARKit
  #endif

  /// Errors thrown while presenting AR Quick Look.
  public enum QuickLookHelperError: Error, LocalizedError {
    /// The presenting view controller is already showing another view controller.
    case alreadyPresenting

    public var errorDescription: String? {
      switch self {
      case .alreadyPresenting:
        return
          "The view controller is already presenting; dismiss it before presenting AR Quick Look"
      }
    }
  }

  /// Manages Apple AR Quick Look presentation for compiled USDZ models.
  ///
  /// - Important: Hosting applications must declare `NSCameraUsageDescription` in their
  ///   `Info.plist`. AR Quick Look uses the device camera to place models in the real world,
  ///   and Apple rejects submissions that access it without a purpose string.
  @MainActor
  public final class QuickLookHelper: NSObject, QLPreviewControllerDataSource,
    QLPreviewControllerDelegate
  {
    private let fileURL: URL

    /// Strong references to the helpers backing each live `QLPreviewController`.
    ///
    /// `QLPreviewController.dataSource` and `.delegate` are both `weak`, so nothing else
    /// retains the helper for the lifetime of the presentation. This is keyed by helper
    /// identity rather than being a single slot: with one slot, presenting a second preview
    /// before the first is dismissed would deallocate the first helper, blanking its preview
    /// and stranding its temporary USDZ file on disk forever.
    private static var activeHelpers: [ObjectIdentifier: QuickLookHelper] = [:]

    /// Serial queue for temporary-file writes, kept off the main actor.
    private static let ioQueue = DispatchQueue(
      label: "com.google.threelive.quicklook.io",
      qos: .userInitiated
    )

    private init(fileURL: URL) {
      self.fileURL = fileURL
      super.init()
    }

    deinit {
      try? FileManager.default.removeItem(at: fileURL)
    }

    /// Returns `true` when camera-based AR world-tracking placement is supported on this device,
    /// or `false` on the iOS Simulator / unsupported hardware (so the caller can present an
    /// in-app AR Surface Placement Preview via
    /// `XRLiveRealityKitSession.setArSurfacePreviewEnabled(_:groundY:)`).
    public nonisolated static var isARPlacementSupported: Bool {
      #if targetEnvironment(simulator)
        return false
      #elseif os(iOS) && canImport(ARKit)
        return ARWorldTrackingConfiguration.isSupported
      #elseif os(visionOS)
        return true
      #else
        return false
      #endif
    }

    /// Presents Apple AR Quick Look directly from a procedural Three.js script.
    ///
    /// - Parameters:
    ///   - viewController: The parent UIViewController to present the AR preview from.
    ///   - script: The Three.js script to compile to USDZ.
    public static func presentAR(
      from viewController: UIViewController,
      script: String
    ) async throws {
      let usdzData = try await ThreeCompiler.compileUSDZ(script)
      try await presentAR(from: viewController, usdzData: usdzData)
    }

    /// Presents Apple AR Quick Look directly from binary USDZ Data.
    ///
    /// - Parameters:
    ///   - viewController: The parent UIViewController to present the AR preview from.
    ///   - usdzData: The binary USDZ archive data.
    public static func presentAR(
      from viewController: UIViewController,
      usdzData: Data
    ) async throws {
      guard
        viewController.presentedViewController == nil,
        viewController.viewIfLoaded?.window != nil
      else {
        throw QuickLookHelperError.alreadyPresenting
      }

      // USDZ archives routinely run to several megabytes. Writing them inline would stall
      // the main actor at exactly the moment the user taps "View in AR".
      let tempURL = try await writeTemporaryUSDZ(usdzData)

      // Re-check: presentation state can change while the write is in flight.
      guard
        viewController.presentedViewController == nil,
        viewController.viewIfLoaded?.window != nil
      else {
        try? FileManager.default.removeItem(at: tempURL)
        throw QuickLookHelperError.alreadyPresenting
      }

      let helper = QuickLookHelper(fileURL: tempURL)
      QuickLookHelper.activeHelpers[ObjectIdentifier(helper)] = helper

      let previewController = QLPreviewController()
      previewController.dataSource = helper
      previewController.delegate = helper

      viewController.present(previewController, animated: true)
    }

    // MARK: - QLPreviewControllerDataSource

    public func numberOfPreviewItems(in controller: QLPreviewController) -> Int {
      return 1
    }

    public func previewController(
      _ controller: QLPreviewController,
      previewItemAt index: Int
    ) -> QLPreviewItem {
      return fileURL as NSURL
    }

    // MARK: - QLPreviewControllerDelegate

    public nonisolated func previewControllerDidDismiss(_ controller: QLPreviewController) {
      let urlToRemove = fileURL
      try? FileManager.default.removeItem(at: urlToRemove)

      let key = ObjectIdentifier(self)
      Task { @MainActor in
        QuickLookHelper.activeHelpers.removeValue(forKey: key)
      }
    }

    // MARK: - Private helpers

    private static func writeTemporaryUSDZ(_ usdzData: Data) async throws -> URL {
      try await withCheckedThrowingContinuation { continuation in
        ioQueue.async {
          continuation.resume(
            with: Result {
              let url = FileManager.default.temporaryDirectory
                .appendingPathComponent(UUID().uuidString)
                .appendingPathExtension("usdz")
              #if os(iOS) || os(visionOS) || os(tvOS)
                try usdzData.write(
                  to: url,
                  options: [.atomic, .completeFileProtectionUnlessOpen]
                )
              #else
                try usdzData.write(to: url, options: .atomic)
              #endif
              return url
            })
        }
      }
    }
  }
#endif
