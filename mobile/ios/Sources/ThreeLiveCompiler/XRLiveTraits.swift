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

// Platform-neutral (pure Foundation + simd) port of `three-live/src/xr-trait-schema.ts`.
// Every clamp and default below mirrors the TypeScript schema so a scene authored once
// behaves identically on web, Android and iOS / visionOS (docs/xr-blocks-parity.md).

import Foundation
import simd

// MARK: - JSON value helpers

/// Strictly-typed accessors for `JSONSerialization` output.
///
/// On Apple platforms JSON booleans and numbers are both bridged as `NSNumber`, so a naive
/// `as? Bool` accepts `1` and `as? Double` accepts `true`. These helpers distinguish them the
/// same way JavaScript's `typeof` does.
enum XRJSON {
  /// Returns `true` when `n` is a CoreFoundation boolean (`__NSCFBoolean`).
  private static func isCFBoolean(_ n: NSNumber) -> Bool {
    #if canImport(ObjectiveC)
      return CFGetTypeID(n) == CFBooleanGetTypeID()
    #else
      return false
    #endif
  }

  /// Returns the value when it is a JSON boolean (never a number).
  static func bool(_ value: Any?) -> Bool? {
    guard let value = value else { return nil }
    let t = type(of: value)
    if t == Bool.self { return value as? Bool }
    if t is NSNumber.Type, let n = value as? NSNumber, isCFBoolean(n) { return n.boolValue }
    return nil
  }

  /// Returns the value when it is a JSON number (never a boolean). May be non-finite.
  ///
  /// Exact dynamic types are compared so a native Swift `Int` 0 / 1 is never bridged to a
  /// `Bool` (or vice versa) through `NSNumber`.
  static func number(_ value: Any?) -> Double? {
    guard let value = value else { return nil }
    let t = type(of: value)
    if t is NSNumber.Type {
      guard let n = value as? NSNumber, !isCFBoolean(n) else { return nil }
      return n.doubleValue
    }
    if t == Double.self { return value as? Double }
    if t == Float.self { return (value as? Float).map { Double($0) } }
    if t == Int.self { return (value as? Int).map { Double($0) } }
    return nil
  }

  /// Returns the value when it is a string.
  static func string(_ value: Any?) -> String? {
    guard let value = value else { return nil }
    if type(of: value) is NSNumber.Type { return nil }
    return value as? String
  }

  /// Returns the value when it is a JSON object.
  static func object(_ value: Any?) -> [String: Any]? {
    value as? [String: Any]
  }

  /// Returns the value when it is a JSON array.
  static func array(_ value: Any?) -> [Any]? {
    guard let value = value, !(value is String) else { return nil }
    return value as? [Any]
  }

  /// JavaScript truthiness (`!!v`).
  static func truthy(_ value: Any?) -> Bool {
    guard let value = value, !(value is NSNull) else { return false }
    if let b = bool(value) { return b }
    if let d = number(value) { return d != 0 && !d.isNaN }
    if let s = string(value) { return !s.isEmpty }
    return true
  }

  /// `clampNum` from the schema: non-finite or non-number values map to `fallback`.
  static func clampNum(_ value: Any?, _ lo: Double, _ hi: Double, _ fallback: Double) -> Double {
    var n = fallback
    if let d = number(value), d.isFinite { n = d }
    return Swift.max(lo, Swift.min(hi, n))
  }

  /// Returns the first three entries of `value` when it is an array of finite numbers.
  static func finiteVec3(_ value: Any?) -> SIMD3<Double>? {
    guard let a = array(value), a.count >= 3,
      let x = number(a[0]), let y = number(a[1]), let z = number(a[2]),
      x.isFinite, y.isFinite, z.isFinite
    else { return nil }
    return SIMD3<Double>(x, y, z)
  }

  /// `shortString` from the schema: a non-empty string truncated to `max` characters.
  static func shortString(_ value: Any?, max: Int = 256) -> String? {
    guard let s = string(value), !s.isEmpty else { return nil }
    return s.count > max ? String(s.prefix(max)) : s
  }

  /// `safeMediaUrl` from the schema: returns the (trimmed) URL when it is an `https:` URL
  /// or a plain relative path (no `..` segment, `\`, `%`, control / space characters,
  /// scheme, or protocol-relative `//`), else `nil`.
  static func safeMediaUrl(_ value: Any?) -> String? {
    guard
      let url = shortString(value, max: 4096)?.trimmingCharacters(in: .whitespacesAndNewlines),
      !url.isEmpty
    else { return nil }
    for scalar in url.unicodeScalars {
      if scalar.value <= 0x20 || scalar == "\\" || scalar == "%" { return nil }
    }
    let lower = url.lowercased()
    if lower.hasPrefix("https://"), let next = lower.dropFirst(8).first, next != "/" {
      return url
    }
    if url.hasPrefix("//") || hasScheme(url) { return nil }
    let segments = url.split(
      omittingEmptySubsequences: false, whereSeparator: { $0 == "/" || $0 == "?" || $0 == "#" })
    return segments.contains("..") ? nil : url
  }

  /// Whether `url` starts with `[a-z][a-z0-9+.-]*:` (case-insensitive).
  private static func hasScheme(_ url: String) -> Bool {
    var first = true
    for scalar in url.unicodeScalars {
      let v = scalar.value
      let isAlpha = (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
      if first {
        guard isAlpha else { return false }
        first = false
        continue
      }
      if scalar == ":" { return true }
      let isDigit = v >= 0x30 && v <= 0x39
      guard isAlpha || isDigit || scalar == "+" || scalar == "." || scalar == "-" else {
        return false
      }
    }
    return false
  }
}

// MARK: - Canonical trait types

/// Normalized XR Blocks lazy-follow options (`follow: {mode, distance, ...}` with `lazy`).
public struct XRLiveLazyFollow: Codable, Sendable, Equatable {
  /// `"head"`, `"hand-left"` or `"hand-right"`.
  public var mode: String
  /// Forward distance from the anchor in meters (0.1–10).
  public var distance: Float
  /// Horizontal angular deadzone in degrees (0–90).
  public var deadzoneDeg: Float
  /// Spring angular frequency (0.5–40).
  public var stiffness: Float
  /// Vertical offset from the anchor in meters (−2–2).
  public var height: Float
  /// Whether the follower yaws to face the user's head.
  public var faceUser: Bool
  /// Whether the follower snaps to its target on the first step.
  public var snapOnStart: Bool

  /// Creates lazy-follow options, applying the schema's per-mode defaults and clamps.
  public init(
    mode: String = "head",
    distance: Float? = nil,
    deadzoneDeg: Float? = nil,
    stiffness: Float? = nil,
    height: Float? = nil,
    faceUser: Bool = true,
    snapOnStart: Bool = true
  ) {
    let m = (mode == "hand-left" || mode == "hand-right") ? mode : "head"
    let isHand = m != "head"
    self.mode = m
    self.distance = Float(
      XRJSON.clampNum(distance.map { Double($0) }, 0.1, 10, isHand ? 0.15 : 1.0))
    self.deadzoneDeg = Float(
      XRJSON.clampNum(deadzoneDeg.map { Double($0) }, 0, 90, isHand ? 0 : 15))
    self.stiffness = Float(XRJSON.clampNum(stiffness.map { Double($0) }, 0.5, 40, 6))
    self.height = Float(XRJSON.clampNum(height.map { Double($0) }, -2, 2, isHand ? 0.12 : -0.1))
    self.faceUser = faceUser
    self.snapOnStart = snapOnStart
  }

  /// Whether the follower is anchored to the head (as opposed to a hand).
  public var isHead: Bool { mode == "head" }
}

/// Normalized orbit options.
public struct XRLiveOrbit: Codable, Sendable, Equatable {
  /// Named target node (or `"head"`); `nil` means orbit `targetPoint`.
  public var targetName: String?
  /// Literal orbit center in scene (model) space, used when `targetName` is `nil`.
  public var targetPoint: SIMD3<Float>
  /// Orbit radius in meters (0.01–50).
  public var radius: Float
  /// Angular speed in rad/s (−20–20).
  public var speed: Float
  /// Vertical offset from the center in meters (−10–10).
  public var height: Float
  /// Initial angle in radians.
  public var phase: Float
  /// Whether the orbiter yaws to face the center.
  public var faceCenter: Bool

  /// Creates orbit options, applying the schema's defaults and clamps.
  public init(
    targetName: String? = nil,
    targetPoint: SIMD3<Float> = .zero,
    radius: Float? = nil,
    speed: Float? = nil,
    height: Float? = nil,
    phase: Float? = nil,
    faceCenter: Bool = false
  ) {
    if let name = targetName, !name.isEmpty, name.count <= 256 {
      self.targetName = name
    } else {
      self.targetName = nil
    }
    self.targetPoint = targetPoint
    self.radius = Float(XRJSON.clampNum(radius.map { Double($0) }, 0.01, 50, 0.5))
    self.speed = Float(XRJSON.clampNum(speed.map { Double($0) }, -20, 20, 0.5))
    self.height = Float(XRJSON.clampNum(height.map { Double($0) }, -10, 10, 0))
    self.phase = Float(XRJSON.clampNum(phase.map { Double($0) }, -1e6, 1e6, 0))
    self.faceCenter = faceCenter
  }
}

/// Normalized manipulation-handle options.
public struct XRLiveHandles: Codable, Sendable, Equatable {
  /// `"y"` (pedestal yaw bar shown) or `"none"`.
  public var rotateAxis: String
  /// Minimum uniform scale (0.001–1000).
  public var minScale: Float
  /// Maximum uniform scale (≥ `minScale`, ≤ 1000).
  public var maxScale: Float

  /// Creates handle options, applying the schema's defaults and clamps.
  public init(rotateAxis: String = "y", minScale: Float? = nil, maxScale: Float? = nil) {
    self.rotateAxis = rotateAxis == "none" ? "none" : "y"
    let lo = XRJSON.clampNum(minScale.map { Double($0) }, 0.001, 1000, 0.1)
    self.minScale = Float(lo)
    self.maxScale = Float(XRJSON.clampNum(maxScale.map { Double($0) }, lo, 1000, Swift.max(lo, 10)))
  }
}

/// Supported particle presets.
public enum XRLiveParticlePreset: String, Codable, Sendable, CaseIterable {
  case rain
  case snow
  case sparks
  case confetti

  /// Default particle count for this preset.
  public var defaultCount: Int {
    switch self {
    case .rain: return 600
    case .snow: return 400
    case .sparks: return 300
    case .confetti: return 300
    }
  }
}

/// Normalized particle emitter options.
public struct XRLiveParticles: Codable, Sendable, Equatable {
  /// Hard cap on particles per emitter.
  public static let maxParticlesPerEmitter = 2000

  public var preset: XRLiveParticlePreset
  /// Particle count (1–2000).
  public var count: Int
  /// Emitter volume size in meters per axis (0.05–50).
  public var area: SIMD3<Float>
  /// Speed multiplier (0.05–10).
  public var speed: Float

  /// Creates particle options, applying the schema's defaults and clamps.
  public init(
    preset: XRLiveParticlePreset = .rain,
    count: Int? = nil,
    area: SIMD3<Float>? = nil,
    speed: Float? = nil
  ) {
    self.preset = preset
    let c = XRJSON.clampNum(
      count.map { Double($0) }, 1, Double(Self.maxParticlesPerEmitter), Double(preset.defaultCount))
    self.count = Int(c.rounded())
    let side = { (v: Float) -> Float in Float(XRJSON.clampNum(Double(v), 0.05, 50, 2)) }
    if let a = area {
      self.area = SIMD3<Float>(side(a.x), side(a.y), side(a.z))
    } else {
      self.area = SIMD3<Float>(2, 2, 2)
    }
    self.speed = Float(XRJSON.clampNum(speed.map { Double($0) }, 0.05, 10, 1))
  }
}

/// Normalized `holdToAsk` options.
public struct XRLiveHoldToAsk: Codable, Sendable, Equatable {
  /// Maximum characters of a hold-to-ask prompt.
  public static let maxPromptCharacters = 4000

  public var prompt: String
  /// Hold duration in milliseconds (100–5000).
  public var holdMs: Float

  /// Creates hold-to-ask options, applying the schema's defaults and clamps.
  public init(prompt: String? = nil, holdMs: Float? = nil) {
    self.prompt =
      XRJSON.shortString(prompt, max: Self.maxPromptCharacters) ?? "What is this?"
    self.holdMs = Float(XRJSON.clampNum(holdMs.map { Double($0) }, 100, 5000, 600))
  }
}

/// Normalized world-understanding flags.
public struct XRLiveWorldUnderstanding: Codable, Sendable, Equatable {
  public var planes: Bool
  public var meshes: Bool
  public var reticle: Bool
  public var objects: Bool

  public init(
    planes: Bool = true, meshes: Bool = false, reticle: Bool = false, objects: Bool = false
  ) {
    self.planes = planes
    self.meshes = meshes
    self.reticle = reticle
    self.objects = objects
  }
}

/// Normalized spatial audio options.
public struct XRLiveSpatialAudio: Codable, Sendable, Equatable {
  public var src: String
  /// Reference distance in meters (0.01–1000).
  public var refDistance: Float
  public var loop: Bool

  public init(src: String, refDistance: Float? = nil, loop: Bool = false) {
    self.src = src.count > 4096 ? String(src.prefix(4096)) : src
    self.refDistance = Float(XRJSON.clampNum(refDistance.map { Double($0) }, 0.01, 1000, 1))
    self.loop = loop
  }
}

/// Normalized uniform scale range (`scale: {min, max}`, defaults 0.05–5 like the web
/// `XRTraitSystem`).
public struct XRLiveScaleRange: Codable, Sendable, Equatable {
  public var min: Float
  public var max: Float

  public init(min: Float? = nil, max: Float? = nil) {
    let lo = XRJSON.clampNum(min.map { Double($0) }, 0.001, 1000, 0.05)
    self.min = Float(lo)
    self.max = Float(XRJSON.clampNum(max.map { Double($0) }, lo, 1000, Swift.max(lo, 5)))
  }
}

/// Canonical, fully-normalized trait set for one glTF node (`NormalizedXRTraits` in TS).
public struct XRLiveNodeTraits: Codable, Sendable, Equatable {
  /// `"1-hand"` or `"2-hand"`.
  public var grab: String?
  /// Whether the node is grabbable (`grab != nil`).
  public var grabbable: Bool { grab != nil }
  public var scale: XRLiveScaleRange?
  /// `"capsule"`, `"cylindrical"` or `"spherical"`.
  public var billboard: String?
  /// Eager (string) follow mode. `nil` when absent or when `lazyFollow` is set.
  public var follow: String?
  /// XR Blocks lazy follow (object-valued `follow`).
  public var lazyFollow: XRLiveLazyFollow?
  public var anchor: String?
  /// `"dynamic"` or `"static"`.
  public var physics: String?
  public var orbit: XRLiveOrbit?
  public var handles: XRLiveHandles?
  public var particles: XRLiveParticles?
  public var holdToAsk: XRLiveHoldToAsk?
  public var worldUnderstanding: XRLiveWorldUnderstanding?
  public var splatUrl: String?
  public var spatialSlot: String?
  public var audio: XRLiveSpatialAudio?
  /// `true` when `pointerEvents: "none"` (node is not pickable).
  public var pointerEventsNone: Bool

  public init() {
    pointerEventsNone = false
  }

  /// Whether no recognized trait is present.
  public var isEmpty: Bool {
    grab == nil && scale == nil && billboard == nil && follow == nil && lazyFollow == nil
      && anchor == nil && physics == nil && orbit == nil && handles == nil && particles == nil
      && holdToAsk == nil && worldUnderstanding == nil && splatUrl == nil && spatialSlot == nil
      && audio == nil && !pointerEventsNone
  }
}

// MARK: - Parser

/// Parses authored or compiled `extras.xr` dictionaries into canonical traits, applying the
/// same clamps as `normalizeXRTraits()` in `xr-trait-schema.ts`.
public enum XRLiveTraitParser {
  private static let anchors: Set<String> = ["horizontal", "vertical", "floor", "wall", "table"]
  private static let billboards: Set<String> = ["capsule", "cylindrical", "spherical"]

  /// Parses an object-valued `follow` trait. Returns `nil` for strings, missing values and
  /// objects with `lazy: false`.
  public static func parseLazyFollow(_ raw: Any?) -> XRLiveLazyFollow? {
    guard let r = XRJSON.object(raw) else { return nil }
    if XRJSON.bool(r["lazy"]) == false { return nil }
    let modeRaw = XRJSON.string(r["mode"]) ?? "head"
    var f = XRLiveLazyFollow(mode: modeRaw)
    let isHand = !f.isHead
    f.distance = Float(XRJSON.clampNum(r["distance"], 0.1, 10, isHand ? 0.15 : 1.0))
    f.deadzoneDeg = Float(XRJSON.clampNum(r["deadzoneDeg"], 0, 90, isHand ? 0 : 15))
    f.stiffness = Float(XRJSON.clampNum(r["stiffness"], 0.5, 40, 6))
    f.height = Float(XRJSON.clampNum(r["height"], -2, 2, isHand ? 0.12 : -0.1))
    f.faceUser = XRJSON.bool(r["faceUser"]) != false
    f.snapOnStart = XRJSON.bool(r["snapOnStart"]) != false
    return f
  }

  /// Parses an `orbit` trait, returning `nil` when absent or malformed.
  public static func parseOrbit(_ raw: Any?) -> XRLiveOrbit? {
    guard let r = XRJSON.object(raw) else { return nil }
    var o = XRLiveOrbit()
    if let v = XRJSON.finiteVec3(r["target"]) {
      o.targetPoint = SIMD3<Float>(Float(v.x), Float(v.y), Float(v.z))
    } else if let s = XRJSON.string(r["target"]), !s.isEmpty, s.count <= 256 {
      o.targetName = s
    }
    o.radius = Float(XRJSON.clampNum(r["radius"], 0.01, 50, 0.5))
    o.speed = Float(XRJSON.clampNum(r["speed"], -20, 20, 0.5))
    o.height = Float(XRJSON.clampNum(r["height"], -10, 10, 0))
    o.phase = Float(XRJSON.clampNum(r["phase"], -1e6, 1e6, 0))
    o.faceCenter = XRJSON.bool(r["faceCenter"]) == true
    return o
  }

  /// Parses a `handles` trait (`true` or an object), returning `nil` when absent / falsy.
  public static func parseHandles(_ raw: Any?) -> XRLiveHandles? {
    guard XRJSON.truthy(raw) else { return nil }
    let r = XRJSON.object(raw) ?? [:]
    let minScale = XRJSON.clampNum(r["minScale"], 0.001, 1000, 0.1)
    let maxScale = XRJSON.clampNum(r["maxScale"], minScale, 1000, Swift.max(minScale, 10))
    var h = XRLiveHandles(rotateAxis: XRJSON.string(r["rotateAxis"]) ?? "y")
    h.minScale = Float(minScale)
    h.maxScale = Float(maxScale)
    return h
  }

  /// Parses a `particles` trait, returning `nil` when absent or malformed.
  public static func parseParticles(_ raw: Any?) -> XRLiveParticles? {
    guard let r = XRJSON.object(raw) else { return nil }
    let presetName = XRJSON.string(r["preset"]) ?? ""
    let preset: XRLiveParticlePreset =
      (presetName == "snow" || presetName == "sparks" || presetName == "confetti")
      ? (XRLiveParticlePreset(rawValue: presetName) ?? .rain) : .rain
    var p = XRLiveParticles(preset: preset)
    let side = { (v: Any?) -> Float in Float(XRJSON.clampNum(v, 0.05, 50, 2)) }
    if let a = XRJSON.array(r["area"]), XRJSON.finiteVec3(a) != nil {
      p.area = SIMD3<Float>(side(a[0]), side(a[1]), side(a[2]))
    } else if XRJSON.number(r["area"]) != nil {
      let s = side(r["area"])
      p.area = SIMD3<Float>(s, s, s)
    }
    let count = XRJSON.clampNum(
      r["count"], 1, Double(XRLiveParticles.maxParticlesPerEmitter), Double(preset.defaultCount))
    p.count = Int(count.rounded())
    p.speed = Float(XRJSON.clampNum(r["speed"], 0.05, 10, 1))
    return p
  }

  /// Parses a `holdToAsk` trait (`true` or an object), returning `nil` when absent / falsy.
  public static func parseHoldToAsk(_ raw: Any?) -> XRLiveHoldToAsk? {
    guard XRJSON.truthy(raw) else { return nil }
    let r = XRJSON.object(raw) ?? [:]
    var h = XRLiveHoldToAsk()
    h.prompt =
      XRJSON.shortString(r["prompt"], max: XRLiveHoldToAsk.maxPromptCharacters) ?? "What is this?"
    h.holdMs = Float(XRJSON.clampNum(r["holdMs"], 100, 5000, 600))
    return h
  }

  /// Parses a `worldUnderstanding` trait (`true` or an object).
  public static func parseWorldUnderstanding(_ raw: Any?) -> XRLiveWorldUnderstanding? {
    guard XRJSON.truthy(raw) else { return nil }
    let r = XRJSON.object(raw) ?? [:]
    return XRLiveWorldUnderstanding(
      planes: XRJSON.bool(r["planes"]) != false,
      meshes: XRJSON.bool(r["meshes"]) == true,
      reticle: XRJSON.bool(r["reticle"]) == true,
      objects: XRJSON.bool(r["objects"]) == true
    )
  }

  /// Parses an `audio` trait (string URL or `{src, refDistance, loop}`).
  public static func parseSpatialAudio(_ raw: Any?) -> XRLiveSpatialAudio? {
    if XRJSON.string(raw) != nil {
      guard let src = XRJSON.safeMediaUrl(raw) else { return nil }
      return XRLiveSpatialAudio(src: src)
    }
    guard let r = XRJSON.object(raw), let src = XRJSON.safeMediaUrl(r["src"]) else {
      return nil
    }
    var a = XRLiveSpatialAudio(src: src)
    a.refDistance = Float(XRJSON.clampNum(r["refDistance"], 0.01, 1000, 1))
    a.loop = XRJSON.bool(r["loop"]) == true
    return a
  }

  /// Normalizes an authored or compiled `extras.xr` bag. Accepts legacy aliases
  /// (`grabbable`, `scalable`, `traits: ["grab", ...]`). Returns `nil` when no recognized
  /// trait is present or `raw` is not a dictionary.
  public static func normalize(_ raw: Any?) -> XRLiveNodeTraits? {
    guard let r = XRJSON.object(raw) else { return nil }
    let traitList = (XRJSON.array(r["traits"]) ?? []).compactMap { XRJSON.string($0) }
    let has = { (name: String) -> Bool in traitList.contains(name) }
    var out = XRLiveNodeTraits()

    let grabString = XRJSON.string(r["grab"])
    if grabString == "1-hand" || grabString == "2-hand" {
      out.grab = grabString
    } else if XRJSON.bool(r["grab"]) == true || XRJSON.bool(r["grabbable"]) == true
      || has("grab")
    {
      out.grab = "2-hand"
    }

    // `r.scale ?? r.scalable` (nullish coalescing: only null / undefined fall through).
    let scaleValue: Any? = (r["scale"] == nil || r["scale"] is NSNull) ? r["scalable"] : r["scale"]
    if XRJSON.truthy(scaleValue) || has("scale") {
      let s = XRJSON.object(scaleValue) ?? [:]
      let lo = XRJSON.clampNum(s["min"], 0.001, 1000, 0.05)
      var range = XRLiveScaleRange()
      range.min = Float(lo)
      range.max = Float(XRJSON.clampNum(s["max"], lo, 1000, Swift.max(lo, 5)))
      out.scale = range
    }

    if let bb = XRJSON.string(r["billboard"]), billboards.contains(bb) {
      out.billboard = bb
    } else if XRJSON.bool(r["billboard"]) == true || has("billboard") {
      out.billboard = "capsule"
    }

    // Strings and `{lazy: false}` objects are eager spring follows; other objects are lazy.
    let followObject = XRJSON.object(r["follow"])
    let followMode = XRJSON.string(r["follow"]) ?? XRJSON.string(followObject?["mode"])
    let followString = XRJSON.string(r["follow"])
    let isEager =
      followString.map { !$0.isEmpty } ?? (XRJSON.bool(followObject?["lazy"]) == false)
    if isEager {
      out.follow = (followMode == "hand-left" || followMode == "hand-right") ? followMode : "head"
    } else if let lazy = parseLazyFollow(r["follow"]) {
      out.lazyFollow = lazy
    }

    if let anchor = XRJSON.string(r["anchor"]), anchors.contains(anchor) {
      out.anchor = anchor
    }
    if let physics = XRJSON.string(r["physics"]), physics == "dynamic" || physics == "static" {
      out.physics = physics
    }

    out.orbit = parseOrbit(r["orbit"])
    out.handles = parseHandles(r["handles"])
    out.particles = parseParticles(r["particles"])
    out.holdToAsk = parseHoldToAsk(r["holdToAsk"])
    out.worldUnderstanding = parseWorldUnderstanding(r["worldUnderstanding"])
    out.splatUrl = XRJSON.safeMediaUrl(r["splatUrl"])
    out.spatialSlot = XRJSON.shortString(r["spatialSlot"])
    out.audio = parseSpatialAudio(r["audio"])
    out.pointerEventsNone = XRJSON.string(r["pointerEvents"]) == "none"

    return out.isEmpty ? nil : out
  }

  /// Reconstructs canonical traits from the flattened USDZ `customData = {dictionary xr}`
  /// produced by `flattenXRTraitsForUsd()` (`followDistance`, `particlesCount`, ...).
  ///
  /// RealityKit does not surface USD `customData`; this is for hosts that read the USD layer
  /// themselves (e.g. via OpenUSD) and want identical clamping.
  public static func normalize(usdCustomData d: [String: Any]) -> XRLiveNodeTraits? {
    func gather(_ prefix: String) -> [String: Any]? {
      var out: [String: Any] = [:]
      for (key, value) in d where key.count > prefix.count && key.hasPrefix(prefix) {
        let rest = key.dropFirst(prefix.count)
        guard let first = rest.first, first.isUppercase else { continue }
        out[first.lowercased() + rest.dropFirst()] = value
      }
      return out.isEmpty ? nil : out
    }
    var r: [String: Any] = [:]
    for key in [
      "grab", "billboard", "anchor", "physics", "splatUrl", "spatialSlot", "pointerEvents",
    ] {
      if let v = d[key] { r[key] = v }
    }
    if let s = gather("scale") { r["scale"] = s }
    if var f = gather("follow"), XRJSON.bool(f["lazy"]) == true {
      if let mode = d["follow"] { f["mode"] = mode }
      r["follow"] = f
    } else if let mode = d["follow"] {
      r["follow"] = mode
    }
    if let o = gather("orbit") { r["orbit"] = o }
    if let h = gather("handles") {
      r["handles"] = h
    } else if let h = d["handles"] {
      r["handles"] = h
    }
    if let p = gather("particles") { r["particles"] = p }
    if let h = gather("holdToAsk") {
      r["holdToAsk"] = h
    } else if let h = d["holdToAsk"] {
      r["holdToAsk"] = h
    }
    if let w = gather("worldUnderstanding") { r["worldUnderstanding"] = w }
    if let a = gather("audio") { r["audio"] = a }
    return normalize(r)
  }

  /// Parses canonical traits for every node of a glTF JSON root (`nodes[i].extras.xr`),
  /// keyed by node index.
  public static func traits(fromGLTF root: [String: Any]) -> [Int: XRLiveNodeTraits] {
    guard let nodes = XRJSON.array(root["nodes"]) else { return [:] }
    var result: [Int: XRLiveNodeTraits] = [:]
    for (idx, rawNode) in nodes.prefix(XRLiveRuntimeSession.maxSceneElements).enumerated() {
      guard let node = XRJSON.object(rawNode), let extras = XRJSON.object(node["extras"]),
        let traits = normalize(extras["xr"])
      else { continue }
      result[idx] = traits
    }
    return result
  }
}

// MARK: - GLB container access

/// Bounds-checked accessors for the JSON chunk of a binary glTF (`.glb`) container.
public enum XRLiveGLB {
  /// JSON chunks larger than this are rejected before allocation.
  public static let maxJSONChunkBytes = 32 * 1024 * 1024
  private static let magicGLTF: UInt32 = 0x4654_6C67
  private static let chunkJSON: UInt32 = 0x4E4F_534A

  /// Returns the raw JSON chunk bytes of a GLB v2 container, or `nil` when malformed.
  public static func jsonChunk(fromGLB glbData: Data) -> Data? {
    guard glbData.count >= 20 else { return nil }
    let base = glbData.startIndex
    func u32(_ offset: Int) -> UInt32 {
      let s = base + offset
      let b0 = UInt32(glbData[s])
      let b1 = UInt32(glbData[s + 1]) << 8
      let b2 = UInt32(glbData[s + 2]) << 16
      let b3 = UInt32(glbData[s + 3]) << 24
      return b0 | b1 | b2 | b3
    }
    guard u32(0) == magicGLTF, u32(4) == 2, u32(16) == chunkJSON,
      let chunkLen = Int(exactly: u32(12)), chunkLen > 0, chunkLen <= glbData.count - 20,
      chunkLen <= maxJSONChunkBytes
    else { return nil }
    let start = base + 20
    return glbData.subdata(in: start..<(start + chunkLen))
  }

  /// Parses the GLB JSON chunk into a dictionary, or `nil` when malformed.
  public static func jsonRoot(fromGLB glbData: Data) -> [String: Any]? {
    guard let chunk = jsonChunk(fromGLB: glbData) else { return nil }
    return (try? JSONSerialization.jsonObject(with: chunk)) as? [String: Any]
  }

  /// Returns the root `extensions.KHR_interactivity` object of a glTF JSON root.
  public static func interactivityExtension(fromGLTF root: [String: Any]) -> [String: Any]? {
    guard let ext = XRJSON.object(root["extensions"]) else { return nil }
    return XRJSON.object(ext["KHR_interactivity"])
  }

  /// Returns the root `extensions.KHR_interactivity` object serialized as JSON, or `nil`
  /// when the GLB is malformed or carries no behavior graph.
  public static func interactivityJSON(fromGLB glbData: Data) -> Data? {
    guard let root = jsonRoot(fromGLB: glbData), let ext = interactivityExtension(fromGLTF: root),
      JSONSerialization.isValidJSONObject(ext)
    else { return nil }
    return try? JSONSerialization.data(withJSONObject: ext, options: [.sortedKeys])
  }

  /// Sanitizes a glTF node name into the USD prim identifier the exporter emits
  /// (`sanitizeUsdIdentifier()` in `three-convert.ts`: `^[A-Za-z_][A-Za-z0-9_]*$`).
  public static func usdPrimName(for name: String?, fallback: String) -> String {
    guard let name = name, !name.isEmpty else { return fallback }
    var clean = String(
      String.UnicodeScalarView(
        name.unicodeScalars.map { scalar -> Unicode.Scalar in
          let v = scalar.value
          let ok =
            (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A) || (v >= 0x61 && v <= 0x7A)
            || v == 0x5F
          return ok ? scalar : "_"
        }))
    if let first = clean.unicodeScalars.first, first.value >= 0x30, first.value <= 0x39 {
      clean = "_" + clean
    }
    return clean.isEmpty ? fallback : clean
  }
}
