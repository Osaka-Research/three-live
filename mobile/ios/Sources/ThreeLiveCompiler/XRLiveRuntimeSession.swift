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

// Platform-neutral iOS / visionOS runtime for compiled three-live scenes: a sandboxed
// `KHR_interactivity` behavior-graph VM (port of `three-live/src/plugins/interactivity.ts`)
// plus the XR Blocks lazy-follow and orbit traits (`xr-live/src/plugins/head-follow.ts`).
// Pure Swift + simd; the RealityKit binding lives in `XRLiveRealityKitSession.swift`.

import Foundation
import simd

// MARK: - Public value types

/// A value flowing through a `KHR_interactivity` graph. JavaScript `undefined` is `nil`.
public enum XRInteractivityValue: Equatable, Sendable {
  case bool(Bool)
  case number(Double)
  case string(String)
  /// Numeric vector (`float2/3/4`, quaternions, colors). Non-numeric JSON entries are NaN.
  case vector([Double])

  /// Converts a `JSONSerialization` value. Returns `nil` for `null`, objects and unknown types.
  public init?(json value: Any?) {
    guard let value = value, !(value is NSNull) else { return nil }
    if let b = XRJSON.bool(value) {
      self = .bool(b)
    } else if let d = XRJSON.number(value) {
      self = .number(d)
    } else if let s = XRJSON.string(value) {
      self = .string(s)
    } else if let a = XRJSON.array(value) {
      self = .vector(a.map { XRJSON.number($0) ?? .nan })
    } else {
      return nil
    }
  }

  /// A `JSONSerialization`-safe representation (non-finite numbers become `NSNull`).
  public var jsonObject: Any {
    switch self {
    case .bool(let b): return b
    case .number(let d): return d.isFinite ? d : NSNull()
    case .string(let s): return s
    case .vector(let v): return v.map { $0.isFinite ? ($0 as Any) : (NSNull() as Any) }
    }
  }
}

/// Local TRS transform of a glTF node.
public struct XRNodeTransform: Sendable, Equatable {
  public var translation: SIMD3<Float>
  public var rotation: simd_quatf
  public var scale: SIMD3<Float>

  public init(
    translation: SIMD3<Float> = .zero,
    rotation: simd_quatf = XRBlocksMath.identityQuat,
    scale: SIMD3<Float> = SIMD3<Float>(1, 1, 1)
  ) {
    self.translation = translation
    self.rotation = rotation
    self.scale = scale
  }

  /// Column-major local matrix.
  public var matrix: simd_float4x4 {
    XRBlocksMath.compose(translation: translation, rotation: rotation, scale: scale)
  }

  public static func == (lhs: XRNodeTransform, rhs: XRNodeTransform) -> Bool {
    lhs.translation == rhs.translation && lhs.rotation.vector == rhs.rotation.vector
      && lhs.scale == rhs.scale
  }
}

/// PBR material factors addressable by `KHR_interactivity` pointers.
public struct XRMaterialState: Sendable, Equatable {
  /// Linear RGBA base color factor.
  public var baseColorFactor: SIMD4<Float>
  public var metallicFactor: Float
  public var roughnessFactor: Float
  /// Linear RGB emissive factor.
  public var emissiveFactor: SIMD3<Float>
  public var alphaCutoff: Float
}

/// Receives scene changes produced by an `XRLiveRuntimeSession`. All methods have no-op
/// default implementations. Transform / visibility / material callbacks are batched and
/// delivered at the end of each `start()`, `dispatchSelect`, `dispatchHover`, `sendEvent`
/// and `step` call; events and animation requests are delivered immediately.
public protocol XRLiveRuntimeSessionDelegate: AnyObject {
  /// A node's local transform changed (behavior graph, lazy follow, or orbit).
  func nodeTransformChanged(_ nodeIndex: Int, transform: XRNodeTransform)
  /// A node's `KHR_node_visibility` flag changed.
  func visibilityChanged(_ nodeIndex: Int, visible: Bool)
  /// A material's factors changed.
  func materialChanged(_ materialIndex: Int, material: XRMaterialState)
  /// The graph executed `event/send`; `payloadJSON` is a JSON object string.
  func interactivityEvent(id: String, payloadJSON: String)
  /// The graph executed `animation/start` for a glTF animation index and / or name.
  func animationStart(index: Int?, name: String?)
  /// The graph executed `animation/stop` (or `animation/resetAt`).
  func animationStop()
}

extension XRLiveRuntimeSessionDelegate {
  public func nodeTransformChanged(_ nodeIndex: Int, transform: XRNodeTransform) {}
  public func visibilityChanged(_ nodeIndex: Int, visible: Bool) {}
  public func materialChanged(_ materialIndex: Int, material: XRMaterialState) {}
  public func interactivityEvent(id: String, payloadJSON: String) {}
  public func animationStart(index: Int?, name: String?) {}
  public func animationStop() {}
}

// MARK: - Session

/// Platform-neutral runtime for one compiled scene: per-node TRS / visibility / material
/// state from the glTF JSON, a sandboxed `KHR_interactivity` VM, and lazy follow / orbit.
///
/// Not thread-safe: drive it from a single thread (the RealityKit binding uses the main
/// actor). Malformed graphs never crash; graphs exceeding `maxGraphNodes` or
/// `maxVariables` are disabled and `interactivityError` describes why.
public final class XRLiveRuntimeSession {
  /// Maximum number of nodes permitted in a single behavior graph.
  public static let maxGraphNodes = 1024
  /// Maximum number of mutable state variables permitted in a single graph.
  public static let maxVariables = 256
  /// Maximum synchronous flow steps executed per event invocation.
  public static let maxStepsPerInvocation = 2048
  /// Maximum concurrent property / variable tweens.
  public static let maxActiveTweens = 128
  /// Maximum concurrent scheduled delays.
  public static let maxActiveDelays = 64
  /// Maximum value-graph (`evalSocket`) evaluations per top-level invocation; bounds
  /// diamond-shaped math chains that would otherwise cost 2^N.
  public static let maxEvaluationsPerInvocation = 10_000
  /// Maximum nested `flow/for` bodies.
  public static let maxForDepth = 8
  /// Maximum flows / values / configuration entries kept per graph node.
  public static let maxSocketsPerNode = 64
  /// Maximum glTF nodes / materials / meshes / animations loaded from one scene.
  public static let maxSceneElements = 65_536
  static let maxEventNestingDepth = 16
  static let maxFlowDepth = 32
  static let maxEvalDepth = 256
  static let forbiddenSegments: Set<String> = ["__proto__", "constructor", "prototype"]

  typealias Value = XRInteractivityValue

  // MARK: Graph model

  struct FlowTarget {
    let node: Int
    let socket: String?
  }

  enum ValueSocket {
    case literal(Value?)
    case link(node: Int, socket: String)
  }

  struct GraphNode {
    var op = ""
    var config: [String: Value] = [:]
    var values: [String: ValueSocket] = [:]
    var valueKeys: [String] = []
    var flows: [String: FlowTarget] = [:]
  }

  enum VarKey: Hashable {
    case index(Int)
    case name(String)
  }

  struct Tween {
    let key: String
    let pointer: String?
    let varKey: VarKey?
    let from: Value
    let to: Value
    let duration: Double
    var elapsed: Double
    let quat: Bool
    let linear: Bool
    let done: FlowTarget?
  }

  struct Delay {
    let id: Int
    let nodeIndex: Int
    var remaining: Double
    let done: FlowTarget?
  }

  // MARK: Scene model

  struct NodeState {
    var name: String?
    var translation = SIMD3<Double>(0, 0, 0)
    var rotation = SIMD4<Double>(0, 0, 0, 1)
    var scale = SIMD3<Double>(1, 1, 1)
    var visible = true
    var mesh: Int?
    var traits: XRLiveNodeTraits?
  }

  struct MaterialData {
    var baseColor = SIMD4<Double>(1, 1, 1, 1)
    var metallic = 1.0
    var roughness = 1.0
    var emissive = SIMD3<Double>(0, 0, 0)
    var alphaCutoff = 0.5
  }

  struct FollowState {
    var spring: XRSpringState
    var following: Bool
  }

  // MARK: Stored state

  /// Receives batched scene changes.
  public weak var delegate: XRLiveRuntimeSessionDelegate?

  /// World placement of the scene root (e.g. the RealityKit root entity's world matrix).
  /// Parent of every root glTF node for lazy follow / orbit world-space math.
  public var rootTransform: simd_float4x4 = matrix_identity_float4x4

  /// Why the behavior graph was disabled, or `nil` when it loaded (or none was present).
  public private(set) var interactivityError: String?

  private var nodes: [NodeState] = []
  private var parentOf: [Int: Int] = [:]
  private var materials: [MaterialData] = []
  private var meshMaterials: [[Int]] = []
  private var animationNames: [String?] = []
  private var nodeIndexByName: [String: Int] = [:]

  private var graph: [GraphNode] = []
  private var eventIds: [String?] = []
  private var variableAliases: [Int: String] = [:]
  private var vars: [VarKey: Value] = [:]
  private var outputs: [Int: [String: Value]] = [:]
  private var doNCounts: [Int: Int] = [:]
  private var waitAll: [Int: Set<String>] = [:]
  private var throttles: [Int: Double] = [:]
  private var multiGates: [Int: Int] = [:]
  private var tweens: [Tween] = []
  private var delays: [Delay] = []
  private var nextDelayId = 1
  private var elapsed = 0.0
  private var eventDepth = 0
  private var flowDepth = 0
  private var forDepth = 0
  private var evalCount = 0
  private var evalDepth = 0
  private var started = false

  private var opIndex: [String: [Int]] = [:]

  private var dirtyTransforms = Set<Int>()
  private var dirtyVisibility = Set<Int>()
  private var dirtyMaterials = Set<Int>()

  private var followStates: [Int: FollowState] = [:]
  private var orbitTimes: [Int: Double] = [:]
  private var grabbed = Set<Int>()

  // MARK: Initialization

  /// Creates a session from a parsed glTF JSON root (`nodes`, `meshes`, `materials`,
  /// `animations`, `extensions.KHR_interactivity`).
  public init(gltf root: [String: Any]) {
    loadScene(root)
    loadGraph(root)
  }

  /// Creates a session from a binary `.glb` container, or `nil` when the GLB is malformed.
  public convenience init?(glbData: Data) {
    guard let root = XRLiveGLB.jsonRoot(fromGLB: glbData) else { return nil }
    self.init(gltf: root)
  }

  /// Creates a session from glTF JSON bytes, or `nil` when the JSON is malformed.
  public convenience init?(gltfJSONData: Data) {
    guard gltfJSONData.count <= XRLiveGLB.maxJSONChunkBytes,
      let root = (try? JSONSerialization.jsonObject(with: gltfJSONData)) as? [String: Any]
    else { return nil }
    self.init(gltf: root)
  }

  private static func doubles(_ raw: Any?, defaults: [Double]) -> [Double] {
    let arr = XRJSON.array(raw) ?? []
    return defaults.enumerated().map { (i, d) -> Double in
      guard i < arr.count, let v = XRJSON.number(arr[i]), v.isFinite else { return d }
      return v
    }
  }

  private func loadScene(_ root: [String: Any]) {
    let rawNodes = Array((XRJSON.array(root["nodes"]) ?? []).prefix(Self.maxSceneElements))
    nodes.reserveCapacity(rawNodes.count)
    for (i, raw) in rawNodes.enumerated() {
      var state = NodeState()
      guard let n = XRJSON.object(raw) else {
        nodes.append(state)
        continue
      }
      state.name = XRJSON.string(n["name"])
      if let name = state.name, nodeIndexByName[name] == nil {
        nodeIndexByName[name] = i
      }
      if let m = XRJSON.array(n["matrix"]), m.count == 16, n["translation"] == nil,
        n["rotation"] == nil, n["scale"] == nil
      {
        let v = Self.doubles(m, defaults: [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1])
        let f = v.map { Float($0) }
        let mat = simd_float4x4(
          SIMD4<Float>(f[0], f[1], f[2], f[3]), SIMD4<Float>(f[4], f[5], f[6], f[7]),
          SIMD4<Float>(f[8], f[9], f[10], f[11]), SIMD4<Float>(f[12], f[13], f[14], f[15]))
        let trs = XRBlocksMath.decompose(mat)
        state.translation = SIMD3<Double>(
          Double(trs.translation.x), Double(trs.translation.y), Double(trs.translation.z))
        state.rotation = SIMD4<Double>(
          Double(trs.rotation.imag.x), Double(trs.rotation.imag.y), Double(trs.rotation.imag.z),
          Double(trs.rotation.real))
        state.scale = SIMD3<Double>(Double(trs.scale.x), Double(trs.scale.y), Double(trs.scale.z))
      } else {
        let t = Self.doubles(n["translation"], defaults: [0, 0, 0])
        let r = Self.normalizedQuat(Self.doubles(n["rotation"], defaults: [0, 0, 0, 1]))
        let s = Self.doubles(n["scale"], defaults: [1, 1, 1])
        state.translation = SIMD3<Double>(t[0], t[1], t[2])
        state.rotation = SIMD4<Double>(r[0], r[1], r[2], r[3])
        state.scale = SIMD3<Double>(s[0], s[1], s[2])
      }
      let ext = XRJSON.object(n["extensions"])
      let vis = XRJSON.object(ext?["KHR_node_visibility"])
      state.visible = XRJSON.bool(vis?["visible"]) ?? XRJSON.bool(n["visible"]) ?? true
      if let mesh = XRJSON.number(n["mesh"]), let mi = Int(exactly: mesh), mi >= 0 {
        state.mesh = mi
      }
      state.traits = XRLiveTraitParser.normalize(XRJSON.object(n["extras"])?["xr"])
      for c in XRJSON.array(n["children"]) ?? [] {
        if let cd = XRJSON.number(c), let ci = Int(exactly: cd), ci >= 0, ci < rawNodes.count,
          ci != i
        {
          parentOf[ci] = i
        }
      }
      nodes.append(state)
    }

    for raw in (XRJSON.array(root["materials"]) ?? []).prefix(Self.maxSceneElements) {
      var mat = MaterialData()
      if let m = XRJSON.object(raw) {
        let pbr = XRJSON.object(m["pbrMetallicRoughness"]) ?? [:]
        let c = Self.doubles(pbr["baseColorFactor"], defaults: [1, 1, 1, 1])
        mat.baseColor = SIMD4<Double>(c[0], c[1], c[2], c[3])
        mat.metallic = XRJSON.number(pbr["metallicFactor"]).flatMap { $0.isFinite ? $0 : nil } ?? 1
        mat.roughness =
          XRJSON.number(pbr["roughnessFactor"]).flatMap { $0.isFinite ? $0 : nil } ?? 1
        let e = Self.doubles(m["emissiveFactor"], defaults: [0, 0, 0])
        mat.emissive = SIMD3<Double>(e[0], e[1], e[2])
        mat.alphaCutoff = XRJSON.number(m["alphaCutoff"]).flatMap { $0.isFinite ? $0 : nil } ?? 0.5
      }
      materials.append(mat)
    }

    for raw in (XRJSON.array(root["meshes"]) ?? []).prefix(Self.maxSceneElements) {
      var list: [Int] = []
      for p in (XRJSON.array(XRJSON.object(raw)?["primitives"]) ?? []).prefix(Self.maxSocketsPerNode) {
        let mat = XRJSON.number(XRJSON.object(p)?["material"]).flatMap { Int(exactly: $0) }
        list.append(mat ?? -1)
      }
      meshMaterials.append(list)
    }

    for raw in (XRJSON.array(root["animations"]) ?? []).prefix(Self.maxSceneElements) {
      animationNames.append(XRJSON.string(XRJSON.object(raw)?["name"]))
    }
  }

  private func loadGraph(_ root: [String: Any]) {
    guard let ext = XRLiveGLB.interactivityExtension(fromGLTF: root) else { return }
    var rawGraph: [String: Any]? = ext
    if let graphs = XRJSON.array(ext["graphs"]) {
      let gi = XRJSON.number(ext["graph"]).flatMap { Int(exactly: $0) } ?? 0
      rawGraph = (gi >= 0 && gi < graphs.count) ? XRJSON.object(graphs[gi]) : nil
    }
    guard let g = rawGraph, let rawNodes = XRJSON.array(g["nodes"]) else { return }
    if rawNodes.count > Self.maxGraphNodes {
      interactivityError = "SecurityError: Exceeds MAX_GRAPH_NODES (\(Self.maxGraphNodes))"
      return
    }
    let rawVars = XRJSON.array(g["variables"]) ?? []
    if rawVars.count > Self.maxVariables {
      interactivityError = "SecurityError: Exceeds MAX_VARIABLES (\(Self.maxVariables))"
      return
    }
    let declOps: [String?] = (XRJSON.array(g["declarations"]) ?? []).map {
      XRJSON.string(XRJSON.object($0)?["op"])
    }
    eventIds = (XRJSON.array(g["events"]) ?? []).map { XRJSON.string(XRJSON.object($0)?["id"]) }

    for (i, raw) in rawVars.enumerated() {
      guard let v = XRJSON.object(raw) else { continue }
      let initial = Value(json: Self.unwrapValue(v["value"]))
      if let initial = initial { vars[.index(i)] = initial }
      if let id = XRJSON.string(v["id"]) ?? XRJSON.string(v["name"]), !id.isEmpty,
        !Self.forbiddenSegments.contains(id)
      {
        variableAliases[i] = id
        if let initial = initial { vars[.name(id)] = initial }
      }
    }

    graph.reserveCapacity(rawNodes.count)
    for raw in rawNodes {
      var node = GraphNode()
      guard let n = XRJSON.object(raw) else {
        graph.append(node)
        continue
      }
      if let op = XRJSON.string(n["op"]), !op.isEmpty {
        node.op = op
      } else if let d = XRJSON.number(n["declaration"]), let di = Int(exactly: d), di >= 0,
        di < declOps.count, let op = declOps[di]
      {
        node.op = op
      }
      let config = XRJSON.object(n["configuration"]) ?? [:]
      for k in Self.cappedKeys(config) {
        if let v = Self.configValue(config[k]) { node.config[k] = v }
      }
      let values = XRJSON.object(n["values"]) ?? [:]
      for k in Self.cappedKeys(values) {
        if let s = Self.valueSocket(values[k]) {
          node.values[k] = s
          node.valueKeys.append(k)
        }
      }
      let flows = XRJSON.object(n["flows"]) ?? [:]
      for k in Self.cappedKeys(flows) {
        guard let f = XRJSON.object(flows[k]), let nd = XRJSON.number(f["node"]) else { continue }
        node.flows[k] = FlowTarget(node: Int(exactly: nd) ?? -1, socket: XRJSON.string(f["socket"]))
      }
      opIndex[node.op, default: []].append(graph.count)
      graph.append(node)
    }
  }

  /// Sorted, non-forbidden keys of `dict`, capped at `maxSocketsPerNode`.
  private static func cappedKeys(_ dict: [String: Any]) -> [String] {
    Array(dict.keys.filter { !forbiddenSegments.contains($0) }.sorted().prefix(maxSocketsPerNode))
  }

  /// `unwrapCfg`: `{value: X}` objects unwrap to `X`.
  private static func unwrapValue(_ raw: Any?) -> Any? {
    if let o = XRJSON.object(raw), let inner = o["value"] { return inner }
    return raw
  }

  private static func configValue(_ raw: Any?) -> Value? {
    let v = unwrapValue(raw)
    // Spec-style single-element arrays of strings (`{"value": ["/nodes/0/..."]}`).
    if let a = XRJSON.array(v), a.count == 1, let s = XRJSON.string(a[0]) { return .string(s) }
    return Value(json: v)
  }

  private static func valueSocket(_ raw: Any?) -> ValueSocket? {
    guard let raw = raw, !(raw is NSNull) else { return nil }
    if let o = XRJSON.object(raw) {
      if let nd = XRJSON.number(o["node"]) {
        return .link(node: Int(exactly: nd) ?? -1, socket: XRJSON.string(o["socket"]) ?? "value")
      }
      if let inner = o["value"] { return .literal(Value(json: inner)) }
      return nil
    }
    return .literal(Value(json: raw))
  }

  // MARK: Public scene accessors

  /// Number of glTF nodes.
  public var nodeCount: Int { nodes.count }
  /// Number of glTF materials.
  public var materialCount: Int { materials.count }
  /// Whether a behavior graph is loaded.
  public var hasInteractivity: Bool { !graph.isEmpty }

  /// The glTF name of node `index`, if any.
  public func nodeName(at index: Int) -> String? {
    index >= 0 && index < nodes.count ? nodes[index].name : nil
  }

  /// The first node index with glTF name `name`.
  public func nodeIndex(named name: String) -> Int? { nodeIndexByName[name] }

  /// The parent node index of `index`, if any.
  public func parentIndex(of index: Int) -> Int? { parentOf[index] }

  /// Canonical XR traits of node `index`, if any.
  public func traits(at index: Int) -> XRLiveNodeTraits? {
    index >= 0 && index < nodes.count ? nodes[index].traits : nil
  }

  /// Material index per primitive of node `index`'s mesh (`-1` for the default material).
  public func materialIndices(forNode index: Int) -> [Int] {
    guard index >= 0, index < nodes.count, let mesh = nodes[index].mesh, mesh < meshMaterials.count
    else { return [] }
    return meshMaterials[mesh]
  }

  /// The local transform of node `index`.
  public func nodeTransform(at index: Int) -> XRNodeTransform? {
    guard index >= 0, index < nodes.count else { return nil }
    return Self.transform(of: nodes[index])
  }

  /// Sets node `index`'s local transform from the host (e.g. a manipulation gesture).
  /// Does not notify the delegate. Returns `false` for an invalid index or non-finite input.
  @discardableResult
  public func setNodeTransform(_ index: Int, _ transform: XRNodeTransform) -> Bool {
    guard index >= 0, index < nodes.count else { return false }
    let t = transform.translation
    let s = transform.scale
    let q = transform.rotation.vector
    let all = [t.x, t.y, t.z, s.x, s.y, s.z, q.x, q.y, q.z, q.w]
    guard all.allSatisfy({ $0.isFinite }) else { return false }
    nodes[index].translation = SIMD3<Double>(Double(t.x), Double(t.y), Double(t.z))
    nodes[index].scale = SIMD3<Double>(Double(s.x), Double(s.y), Double(s.z))
    let r = Self.normalizedQuat([Double(q.x), Double(q.y), Double(q.z), Double(q.w)])
    nodes[index].rotation = SIMD4<Double>(r[0], r[1], r[2], r[3])
    return true
  }

  /// Whether node `index` is visible (its own `KHR_node_visibility` flag; ancestors are
  /// not considered). `false` for an invalid index.
  public func isVisible(_ index: Int) -> Bool {
    index >= 0 && index < nodes.count ? nodes[index].visible : false
  }

  /// Whether node `index` or any ancestor is hidden.
  public func isEffectivelyVisible(_ index: Int) -> Bool {
    var cur: Int? = index
    var depth = 0
    while let c = cur, c >= 0, c < nodes.count, depth < 128 {
      if !nodes[c].visible { return false }
      cur = parentOf[c]
      depth += 1
    }
    return index >= 0 && index < nodes.count
  }

  /// The linear RGBA base color factor of material `index`.
  public func materialColor(_ index: Int) -> SIMD4<Float>? {
    material(at: index)?.baseColorFactor
  }

  /// All factors of material `index`.
  public func material(at index: Int) -> XRMaterialState? {
    guard index >= 0, index < materials.count else { return nil }
    return Self.publicMaterial(materials[index])
  }

  /// Whether a select trigger (`pointer/onSelect`) targets node `index` or one of its
  /// ancestors, i.e. whether tapping it can run behavior.
  public func isSelectable(_ index: Int) -> Bool {
    let savedEvalCount = evalCount
    evalCount = 0
    defer { evalCount = savedEvalCount }
    for i in selectNodes() where triggerMatches(graphIndex: i, hitNode: index, meshName: nil) {
      return true
    }
    return false
  }

  /// Marks node `index` as grabbed by the host; grabbed nodes are not moved by lazy follow
  /// or orbit, and their follow spring is re-seeded on release.
  public func setGrabbed(_ index: Int, _ isGrabbed: Bool) {
    if isGrabbed {
      grabbed.insert(index)
      followStates[index] = nil
    } else {
      grabbed.remove(index)
    }
  }

  /// Forgets cached spring / orbit state for node `index` (e.g. after a teleport).
  public func resetFollowState(_ index: Int) {
    followStates[index] = nil
    orbitTimes[index] = nil
  }

  /// Whether node `index` is currently catching up to its lazy-follow target.
  public func isFollowing(_ index: Int) -> Bool { followStates[index]?.following ?? false }

  // MARK: Public VM entry points

  /// Fires `event/onStart` once. Subsequent calls are no-ops. `step`, `dispatchSelect`,
  /// `dispatchHover` and `sendEvent` call it lazily if the host has not.
  public func start() {
    guard !started else { return }
    started = true
    evalCount = 0
    for i in opIndex["event/onStart"] ?? [] {
      var budget = 0
      followFlow(graph[i].flows["out"], budget: &budget)
    }
    flush()
  }

  /// Dispatches a select (tap / pinch) on node `nodeIndex` to every matching
  /// `pointer/onSelect` trigger (a trigger matches its configured node or any descendant).
  public func dispatchSelect(nodeIndex: Int, hitPoint: SIMD3<Float>? = nil, meshName: String? = nil) {
    dispatchPointer(
      ops: ["pointer/onSelect", "event/onSelect", "scene/onSelect"], nodeIndex: nodeIndex,
      hitPoint: hitPoint, meshName: meshName)
  }

  /// Dispatches hover enter / exit on node `nodeIndex` to `pointer/onHoverIn` /
  /// `pointer/onHoverOut` triggers.
  public func dispatchHover(nodeIndex: Int, hovered: Bool) {
    let ops: Set<String> =
      hovered
      ? ["pointer/onHoverIn", "event/onHoverIn", "scene/onHoverIn"]
      : ["pointer/onHoverOut", "event/onHoverOut", "scene/onHoverOut"]
    dispatchPointer(ops: ops, nodeIndex: nodeIndex, hitPoint: nil, meshName: nil)
  }

  /// Dispatches a custom event (`event/receive`) by id. Payload values are JSON-compatible
  /// (`Bool`, numbers, `String`, numeric arrays).
  public func sendEvent(_ id: String, payload: [String: Any] = [:]) {
    startIfNeeded()
    evalCount = 0
    var budget = 0
    receiveCustomEvent(.string(id), payload: Self.convertPayload(payload), budget: &budget)
  }

  /// Dispatches a custom event (`event/receive`) by its index in the graph's `events`.
  public func sendEvent(index: Int, payload: [String: Any] = [:]) {
    startIfNeeded()
    evalCount = 0
    var budget = 0
    receiveCustomEvent(
      .number(Double(index)), payload: Self.convertPayload(payload), budget: &budget)
  }

  /// Advances tweens, delays and `event/onTick` by `dt` seconds (clamped to 0.25 s), then
  /// steps lazy follow (`headPose` / `handPoses` in world space) and orbit traits.
  public func step(dt: Double, headPose: XRPose? = nil, handPoses: [XRHand: XRPose] = [:]) {
    startIfNeeded()
    evalCount = 0
    tick(dt)
    stepFollowAndOrbit(dt: dt, headPose: headPose, handPoses: handPoses)
    flush()
  }

  /// Reads a whitelisted glTF pointer (`/nodes/{i}/translation`, ...). `nil` when rejected.
  public func readPointer(_ pointer: String) -> XRInteractivityValue? {
    guard let s = Self.parseSafePointer(pointer), !s.isEmpty else { return nil }
    if s[0] == "nodes" {
      guard s.count >= 3, let idx = Self.parseIndex(s[1], nodes.count) else { return nil }
      let n = nodes[idx]
      switch s[2] {
      case "translation" where s.count == 3:
        return .vector([n.translation.x, n.translation.y, n.translation.z])
      case "rotation" where s.count == 3:
        return .vector([n.rotation.x, n.rotation.y, n.rotation.z, n.rotation.w])
      case "scale" where s.count == 3:
        return .vector([n.scale.x, n.scale.y, n.scale.z])
      case "visible" where s.count == 3:
        return .bool(n.visible)
      case "extensions" where s.count == 5 && s[3] == "KHR_node_visibility" && s[4] == "visible":
        return .bool(n.visible)
      default:
        return nil
      }
    }
    if s[0] == "materials" {
      guard s.count >= 3, let idx = Self.parseIndex(s[1], materials.count) else { return nil }
      let m = materials[idx]
      if s[2] == "pbrMetallicRoughness" && s.count == 4 {
        switch s[3] {
        case "baseColorFactor":
          return .vector([m.baseColor.x, m.baseColor.y, m.baseColor.z, m.baseColor.w])
        case "metallicFactor": return .number(m.metallic)
        case "roughnessFactor": return .number(m.roughness)
        default: return nil
        }
      }
      if s[2] == "emissiveFactor" && s.count == 3 {
        return .vector([m.emissive.x, m.emissive.y, m.emissive.z])
      }
      if s[2] == "alphaCutoff" && s.count == 3 { return .number(m.alphaCutoff) }
    }
    return nil
  }

  /// Writes a whitelisted glTF pointer. Returns `false` when rejected. Changes are delivered
  /// to the delegate at the end of the current entry point (or on the next `step`).
  @discardableResult
  public func writePointer(_ pointer: String, _ value: XRInteractivityValue) -> Bool {
    guard let s = Self.parseSafePointer(pointer), !s.isEmpty else { return false }
    if s[0] == "nodes" {
      guard s.count >= 3, let idx = Self.parseIndex(s[1], nodes.count) else { return false }
      switch s[2] {
      case "translation" where s.count == 3, "scale" where s.count == 3:
        guard case .vector(let v) = value, v.count >= 3 else { return false }
        let d: Double = s[2] == "scale" ? 1 : 0
        let next = SIMD3<Double>(Self.fin(v[0], d), Self.fin(v[1], d), Self.fin(v[2], d))
        if s[2] == "scale" { nodes[idx].scale = next } else { nodes[idx].translation = next }
        dirtyTransforms.insert(idx)
        return true
      case "rotation" where s.count == 3:
        guard case .vector(let v) = value, v.count >= 4 else { return false }
        let q = Self.normalizedQuat([
          Self.fin(v[0], 0), Self.fin(v[1], 0), Self.fin(v[2], 0), Self.fin(v[3], 1),
        ])
        nodes[idx].rotation = SIMD4<Double>(q[0], q[1], q[2], q[3])
        dirtyTransforms.insert(idx)
        return true
      case "visible" where s.count == 3:
        setVisible(idx, Self.jsBool(value))
        return true
      case "extensions" where s.count == 5 && s[3] == "KHR_node_visibility" && s[4] == "visible":
        setVisible(idx, Self.jsBool(value))
        return true
      default:
        return false
      }
    }
    if s[0] == "materials" {
      guard s.count >= 3, let idx = Self.parseIndex(s[1], materials.count) else { return false }
      if s[2] == "pbrMetallicRoughness" && s.count == 4 {
        if s[3] == "baseColorFactor" {
          guard case .vector(let v) = value, v.count >= 3 else { return false }
          let a = v.count >= 4 ? Self.clamp01(Self.fin(v[3], 1)) : materials[idx].baseColor.w
          materials[idx].baseColor = SIMD4<Double>(
            Self.clamp01(Self.fin(v[0], 1)), Self.clamp01(Self.fin(v[1], 1)),
            Self.clamp01(Self.fin(v[2], 1)), a)
          dirtyMaterials.insert(idx)
          return true
        }
        if s[3] == "metallicFactor" || s[3] == "roughnessFactor" {
          let isMetal = s[3] == "metallicFactor"
          let v = Self.clamp01(Self.num(value, isMetal ? 0 : 0.5))
          if isMetal { materials[idx].metallic = v } else { materials[idx].roughness = v }
          dirtyMaterials.insert(idx)
          return true
        }
        return false
      }
      if s[2] == "emissiveFactor" && s.count == 3 {
        guard case .vector(let v) = value, v.count >= 3 else { return false }
        materials[idx].emissive = SIMD3<Double>(
          max(0, Self.fin(v[0], 0)), max(0, Self.fin(v[1], 0)), max(0, Self.fin(v[2], 0)))
        dirtyMaterials.insert(idx)
        return true
      }
      if s[2] == "alphaCutoff" && s.count == 3 {
        materials[idx].alphaCutoff = Self.clamp01(Self.num(value, 0.5))
        dirtyMaterials.insert(idx)
        return true
      }
    }
    return false
  }

  private func setVisible(_ idx: Int, _ visible: Bool) {
    nodes[idx].visible = visible
    dirtyVisibility.insert(idx)
  }

  // MARK: Pointer safety

  /// Validates and splits an RFC 6901 JSON pointer, rejecting empty segments and
  /// prototype-pollution tokens (`__proto__`, `constructor`, `prototype`).
  public static func parseSafePointer(_ pointer: String) -> [String]? {
    guard pointer.hasPrefix("/"), pointer.utf8.count <= 1024 else { return nil }
    var segments: [String] = []
    for rawSub in pointer.dropFirst().split(
      separator: Character("/"), omittingEmptySubsequences: false) {
      let raw = String(rawSub)
      let seg = raw.replacingOccurrences(of: "~1", with: "/")
        .replacingOccurrences(of: "~0", with: "~")
      if seg.isEmpty || forbiddenSegments.contains(seg) || forbiddenSegments.contains(raw) {
        return nil
      }
      segments.append(seg)
    }
    return segments
  }

  /// Parses a decimal array index in `0..<max`.
  static func parseIndex(_ seg: String, _ max: Int) -> Int? {
    guard !seg.isEmpty, seg.utf8.allSatisfy({ $0 >= 0x30 && $0 <= 0x39 }), let idx = Int(seg),
      idx >= 0, idx < max
    else { return nil }
    return idx
  }

  // MARK: JS-compatible coercions

  static func fin(_ v: Double, _ fallback: Double) -> Double { v.isFinite ? v : fallback }

  static func clamp01(_ v: Double) -> Double { max(0, min(1, v)) }

  /// `Number(v)`; `NaN` for `undefined`.
  static func jsNumber(_ v: Value?) -> Double {
    guard let v = v else { return .nan }
    switch v {
    case .bool(let b): return b ? 1 : 0
    case .number(let d): return d
    case .string(let s):
      let t = s.trimmingCharacters(in: .whitespacesAndNewlines)
      if t.isEmpty { return 0 }
      return Double(t) ?? .nan
    case .vector(let a):
      if a.isEmpty { return 0 }
      return a.count == 1 ? a[0] : .nan
    }
  }

  /// `num(v, fb)`: finite `Number(v)` or `fallback`.
  static func num(_ v: Value?, _ fallback: Double = 0) -> Double {
    let n = jsNumber(v)
    return n.isFinite ? n : fallback
  }

  /// The VM's `bool(v)` coercion.
  static func jsBool(_ v: Value?) -> Bool {
    guard let v = v else { return false }
    switch v {
    case .bool(let b): return b
    case .number(let d): return d != 0 && !d.isNaN
    case .string(let s): return !s.isEmpty && s != "false"
    case .vector: return true
    }
  }

  private static func formatNumber(_ d: Double) -> String {
    if d.isNaN { return "NaN" }
    if d.isInfinite { return d > 0 ? "Infinity" : "-Infinity" }
    if d == d.rounded(.towardZero) && abs(d) < 1e15 { return String(Int64(d)) }
    return String(d)
  }

  /// `String(v)`.
  static func jsString(_ v: Value?) -> String {
    guard let v = v else { return "undefined" }
    switch v {
    case .bool(let b): return b ? "true" : "false"
    case .number(let d): return formatNumber(d)
    case .string(let s): return s
    case .vector(let a): return a.map { formatNumber($0) }.joined(separator: ",")
    }
  }

  static func valEq(_ a: Value?, _ b: Value?) -> Bool {
    switch (a, b) {
    case (.vector(let x)?, .vector(let y)?):
      return x.count == y.count && zip(x, y).allSatisfy { abs($0 - $1) <= 1e-6 }
    case (nil, nil): return true
    case (.bool(let x)?, .bool(let y)?): return x == y
    case (.number(let x)?, .number(let y)?): return x == y
    case (.string(let x)?, .string(let y)?): return x == y
    default: return false
    }
  }

  static func normalizedQuat(_ q: [Double]) -> [Double] {
    guard q.count >= 4 else { return [0, 0, 0, 1] }
    let x = fin(q[0], 0)
    let y = fin(q[1], 0)
    let z = fin(q[2], 0)
    let w = fin(q[3], 1)
    let l = (x * x + y * y + z * z + w * w).squareRoot()
    return (l > 1e-8 && l.isFinite) ? [x / l, y / l, z / l, w / l] : [0, 0, 0, 1]
  }

  static func applyBin(_ a: Value?, _ b: Value?, _ fn: (Double, Double) -> Double) -> Value {
    switch (a, b) {
    case (.vector(let x)?, .vector(let y)?):
      return .vector(zip(x, y).map { fn(fin($0, 0), fin($1, 0)) })
    case (.vector(let x)?, _):
      let nb = num(b)
      return .vector(x.map { fn(fin($0, 0), nb) })
    case (_, .vector(let y)?):
      let na = num(a)
      return .vector(y.map { fn(na, fin($0, 0)) })
    default:
      return .number(fn(num(a), num(b)))
    }
  }

  static func applyUn(_ a: Value?, _ fn: (Double) -> Double) -> Value {
    if case .vector(let x)? = a { return .vector(x.map { fn(fin($0, 0)) }) }
    return .number(fn(num(a)))
  }

  static func lerpVal(_ a: Value?, _ b: Value?, _ t: Double, quat: Bool) -> Value? {
    switch (a, b) {
    case (.number(let x)?, .number(let y)?):
      return .number(x + (y - x) * t)
    case (.vector(let x)?, .vector(let y)?):
      if quat && x.count == 4 && y.count == 4 {
        let qa = normalizedQuat(x)
        let qb = normalizedQuat(y)
        let r = simd_slerp(
          simd_quatd(ix: qa[0], iy: qa[1], iz: qa[2], r: qa[3]),
          simd_quatd(ix: qb[0], iy: qb[1], iz: qb[2], r: qb[3]), t)
        return .vector([r.imag.x, r.imag.y, r.imag.z, r.real])
      }
      return .vector(zip(x, y).map { $0 + ($1 - $0) * t })
    default:
      return t >= 0.5 ? b : a
    }
  }

  static func unaryMath(_ m: String) -> ((Double) -> Double)? {
    switch m {
    case "neg": return { -$0 }
    case "abs": return { abs($0) }
    case "sign": return { $0 > 0 ? 1 : ($0 < 0 ? -1 : $0) }
    case "floor": return { $0.rounded(.down) }
    case "ceil": return { $0.rounded(.up) }
    case "round": return { ($0 + 0.5).rounded(.down) }
    case "trunc": return { $0.rounded(.towardZero) }
    case "fract": return { $0 - $0.rounded(.down) }
    case "sqrt": return { Swift.max(0, $0).squareRoot() }
    case "cbrt": return { cbrt($0) }
    case "exp": return { exp($0) }
    case "log": return { $0 > 0 ? log($0) : 0 }
    case "sin": return { sin($0) }
    case "cos": return { cos($0) }
    case "tan": return { tan($0) }
    case "asin": return { asin(Swift.max(-1, Swift.min(1, $0))) }
    case "acos": return { acos(Swift.max(-1, Swift.min(1, $0))) }
    case "atan": return { atan($0) }
    case "rad": return { $0 * Double.pi / 180 }
    case "deg": return { $0 * 180 / Double.pi }
    case "saturate": return { Swift.max(0, Swift.min(1, $0)) }
    default: return nil
    }
  }

  static func binaryMath(_ m: String) -> ((Double, Double) -> Double)? {
    switch m {
    case "add": return { $0 + $1 }
    case "sub": return { $0 - $1 }
    case "mul": return { $0 * $1 }
    case "div": return { abs($1) < 1e-12 ? 0 : $0 / $1 }
    case "rem", "mod": return { abs($1) < 1e-12 ? 0 : $0.truncatingRemainder(dividingBy: $1) }
    case "min": return { Swift.min($0, $1) }
    case "max": return { Swift.max($0, $1) }
    case "pow": return { pow($0, $1) }
    case "atan2": return { atan2($0, $1) }
    default: return nil
    }
  }

  // MARK: VM internals

  private func setOut(_ idx: Int, _ sock: String, _ value: Value?) {
    if Self.forbiddenSegments.contains(sock) { return }
    if let value = value {
      outputs[idx, default: [:]][sock] = value
    } else {
      outputs[idx]?[sock] = nil
    }
  }

  private static func varKey(_ v: Value?) -> VarKey? {
    switch v {
    case .number(let d)?:
      return Int(exactly: d).map { VarKey.index($0) }
    case .string(let s)?:
      return forbiddenSegments.contains(s) ? nil : .name(s)
    case .vector(let a)? where a.count == 1:
      return Int(exactly: a[0]).map { VarKey.index($0) }
    default:
      return nil
    }
  }

  private func setVar(_ key: VarKey?, _ value: Value?) {
    guard let key = key else { return }
    if vars[key] == nil && vars.count >= Self.maxVariables * 2 { return }
    vars[key] = value
    if case .index(let i) = key, let alias = variableAliases[i] {
      vars[.name(alias)] = value
    }
  }

  private func resolveEventId(_ ev: Value?) -> String {
    switch ev {
    case .number(let d)?:
      if let i = Int(exactly: d), i >= 0, i < eventIds.count, let id = eventIds[i] { return id }
      return Self.jsString(ev)
    case .string(let s)?:
      if let i = Self.parseIndex(s, eventIds.count), let id = eventIds[i] { return id }
      return s
    default:
      return ""
    }
  }

  private func isAncestor(_ hit: Int, _ target: Int) -> Bool {
    var cur: Int? = hit
    var depth = 0
    while let c = cur, c >= 0, depth < 128 {
      if c == target { return true }
      cur = parentOf[c]
      depth += 1
    }
    return false
  }

  private func cancelTween(_ key: String) {
    tweens.removeAll { $0.key == key }
  }

  private func addTween(_ tween: Tween) {
    cancelTween(tween.key)
    if tweens.count >= Self.maxActiveTweens { tweens.removeFirst() }
    tweens.append(tween)
  }

  private func readInput(_ nodeIdx: Int, _ sock: String, _ fallback: Value?, _ visited: inout Set<Int>)
    -> Value?
  {
    guard nodeIdx >= 0, nodeIdx < graph.count, let b = graph[nodeIdx].values[sock] else {
      return fallback
    }
    switch b {
    case .literal(let v):
      return v
    case .link(let node, let socket):
      return evalSocket(node, socket, &visited)
    }
  }

  /// Resolves the node's `pointer` configuration, substituting `{param}` templates from
  /// input sockets. `visited` is the caller's evaluation path so a template input that links
  /// back to this node terminates instead of recursing.
  private func resolvePointer(_ nodeIdx: Int, _ visited: inout Set<Int>) -> String? {
    guard nodeIdx >= 0, nodeIdx < graph.count,
      case .string(let raw)? = graph[nodeIdx].config["pointer"], raw.hasPrefix("/")
    else { return nil }
    var result = ""
    var i = raw.startIndex
    while i < raw.endIndex {
      let ch = raw[i]
      if ch == "{", let close = raw[i...].firstIndex(of: "}") {
        let name = String(raw[raw.index(after: i)..<close])
        let isIdent =
          !name.isEmpty
          && name.unicodeScalars.allSatisfy { s in
            let v = s.value
            return (v >= 0x30 && v <= 0x39) || (v >= 0x41 && v <= 0x5A)
              || (v >= 0x61 && v <= 0x7A) || v == 0x5F
          }
        if isIdent {
          let v = readInput(nodeIdx, name, nil, &visited) ?? graph[nodeIdx].config[name]
          let t = Self.jsNumber(v).rounded(.towardZero)
          if t.isFinite, t >= 0, t <= 9_007_199_254_740_991, let iv = Int(exactly: t) {
            result += String(iv)
          } else {
            result += "-1"
          }
          i = raw.index(after: close)
          continue
        }
      }
      result.append(ch)
      i = raw.index(after: i)
    }
    return Self.parseSafePointer(result) != nil ? result : nil
  }

  private func evalSocket(_ nodeIdx: Int, _ sock: String, _ visited: inout Set<Int>) -> Value? {
    evalCount += 1
    guard evalCount <= Self.maxEvaluationsPerInvocation, evalDepth < Self.maxEvalDepth else {
      return nil
    }
    evalDepth += 1
    defer { evalDepth -= 1 }
    guard nodeIdx >= 0, nodeIdx < graph.count, !visited.contains(nodeIdx), visited.count <= 128
    else { return nil }
    let node = graph[nodeIdx]
    let op = node.op
    if op.hasPrefix("event/") || op.hasPrefix("pointer/on") || op.hasPrefix("scene/on")
      || op.hasPrefix("flow/") || op.hasPrefix("customEvent/")
    {
      return outputs[nodeIdx]?[sock]
    }
    visited.insert(nodeIdx)
    defer { visited.remove(nodeIdx) }
    func inp(_ name: String, _ fb: Value? = .number(0)) -> Value? {
      readInput(nodeIdx, name, fb, &visited)
    }

    if op == "variable/get" {
      return vars[Self.varKey(node.config["variable"] ?? node.config["id"]) ?? .index(-1)]
    }
    if op == "pointer/get" {
      guard let p = resolvePointer(nodeIdx, &visited) else { return nil }
      return readPointer(p)
    }
    if op.hasPrefix("math/") {
      let m = String(op.dropFirst(5))
      if let f = Self.unaryMath(m) { return Self.applyUn(inp("a"), f) }
      if let f = Self.binaryMath(m) {
        let dB: Double = ["mul", "div", "rem", "mod", "pow"].contains(m) ? 1 : 0
        let a = inp("a", .number(m == "mul" ? 1 : 0))
        let b = inp("b", .number(dB))
        return Self.applyBin(a, b, f)
      }
      return evalMath(m, nodeIdx: nodeIdx, sock: sock, visited: &visited)
    }
    switch op {
    case "type/boolToInt", "type/boolToFloat":
      return .number(Self.jsBool(inp("a", .bool(false))) ? 1 : 0)
    case "type/intToBool", "type/floatToBool":
      return .bool(Self.num(inp("a", .number(0))) != 0)
    case "type/intToFloat":
      return .number(Self.num(inp("a", .number(0))))
    case "type/floatToInt":
      return .number(Self.num(inp("a", .number(0))).rounded(.towardZero))
    default:
      return nil
    }
  }

  private func evalMath(_ m: String, nodeIdx: Int, sock: String, visited: inout Set<Int>)
    -> Value?
  {
    func inp(_ name: String, _ fb: Value?) -> Value? {
      readInput(nodeIdx, name, fb, &visited)
    }
    func zero(_ x: Double) -> Double { x.isNaN ? 0 : x }
    func at(_ a: [Double], _ i: Int) -> Double { i < a.count ? zero(a[i]) : 0 }
    switch m {
    case "pi": return .number(Double.pi)
    case "e": return .number(exp(1.0))
    case "random": return .number(Double.random(in: 0..<1))
    case "clamp":
      let lo = Self.applyBin(inp("a", .number(0)), inp("b", inp("min", .number(0))), { Swift.max($0, $1) })
      return Self.applyBin(lo, inp("c", inp("max", .number(1))), { Swift.min($0, $1) })
    case "mix", "quatSlerp":
      let t = Self.num(inp("c", inp("t", .number(0.5))), 0.5)
      return Self.lerpVal(inp("a", .number(0)), inp("b", .number(1)), t, quat: m == "quatSlerp")
    case "dot":
      let a = inp("a", .number(0))
      let b = inp("b", .number(0))
      if case .vector(let x)? = a, case .vector(let y)? = b {
        var s = 0.0
        for i in 0..<x.count { s += zero(x[i]) * at(y, i) }
        return .number(s)
      }
      return .number(Self.num(a) * Self.num(b))
    case "cross":
      let a = inp("a", .vector([0, 0, 0]))
      let b = inp("b", .vector([0, 0, 0]))
      guard case .vector(let x)? = a, case .vector(let y)? = b else { return .vector([0, 0, 0]) }
      return .vector([
        at(x, 1) * at(y, 2) - at(x, 2) * at(y, 1),
        at(x, 2) * at(y, 0) - at(x, 0) * at(y, 2),
        at(x, 0) * at(y, 1) - at(x, 1) * at(y, 0),
      ])
    case "length":
      let a = inp("a", .number(0))
      if case .vector(let x)? = a { return .number(x.reduce(0) { $0 + $1 * $1 }.squareRoot()) }
      return .number(abs(Self.num(a)))
    case "distance":
      let a = inp("a", .number(0))
      let b = inp("b", .number(0))
      if case .vector(let x)? = a, case .vector(let y)? = b {
        var s = 0.0
        for i in 0..<x.count {
          let d = zero(x[i]) - at(y, i)
          s += d * d
        }
        return .number(s.squareRoot())
      }
      return .number(abs(Self.num(a) - Self.num(b)))
    case "normalize":
      let a = inp("a", .number(0))
      guard case .vector(let x)? = a else { return .number(Self.num(a) >= 0 ? 1 : -1) }
      let l = x.reduce(0) { $0 + $1 * $1 }.squareRoot()
      return .vector(l > 1e-8 ? x.map { $0 / l } : x.map { _ in 0.0 })
    case "eq": return .bool(Self.valEq(inp("a", .number(0)), inp("b", .number(0))))
    case "ne": return .bool(!Self.valEq(inp("a", .number(0)), inp("b", .number(0))))
    case "lt": return .bool(Self.num(inp("a", .number(0))) < Self.num(inp("b", .number(0))))
    case "le": return .bool(Self.num(inp("a", .number(0))) <= Self.num(inp("b", .number(0))))
    case "gt": return .bool(Self.num(inp("a", .number(0))) > Self.num(inp("b", .number(0))))
    case "ge": return .bool(Self.num(inp("a", .number(0))) >= Self.num(inp("b", .number(0))))
    case "isNaN": return .bool(Self.jsNumber(inp("a", .number(0))).isNaN)
    case "isInf": return .bool(Self.jsNumber(inp("a", .number(0))).isInfinite)
    case "and":
      return .bool(Self.jsBool(inp("a", .bool(false))) && Self.jsBool(inp("b", .bool(false))))
    case "or":
      return .bool(Self.jsBool(inp("a", .bool(false))) || Self.jsBool(inp("b", .bool(false))))
    case "xor":
      return .bool(Self.jsBool(inp("a", .bool(false))) != Self.jsBool(inp("b", .bool(false))))
    case "not": return .bool(!Self.jsBool(inp("a", .bool(false))))
    case "select":
      return Self.jsBool(inp("condition", .bool(false))) ? inp("a", .number(0)) : inp("b", .number(0))
    default:
      if m.hasPrefix("combine") {
        let digit = m.dropFirst(7).first.flatMap { Int(String($0)) } ?? 0
        let n = digit > 0 ? digit : 2
        var out: [Double] = []
        for key in ["a", "b", "c", "d"].prefix(n) {
          out.append(Self.num(inp(key, .number(0))))
        }
        return .vector(out)
      }
      if m.hasPrefix("extract") {
        guard case .vector(let v)? = inp("a", .number(0)) else { return .number(0) }
        let idx: Int
        switch sock {
        case "0", "x": idx = 0
        case "1", "y": idx = 1
        case "2", "z": idx = 2
        default: idx = 3
        }
        return .number(idx < v.count ? v[idx] : 0)
      }
      return nil
    }
  }

  private static func sortedSequenceKeys(_ keys: [String]) -> [String] {
    let numeric = keys.compactMap { k -> (Double, String)? in
      guard let d = Double(k), d.isFinite else { return nil }
      return (d, k)
    }
    let numericKeys = Set(numeric.map { $0.1 })
    let sortedNumeric = numeric.sorted { $0.0 != $1.0 ? $0.0 < $1.0 : $0.1 < $1.1 }.map { $0.1 }
    let rest = keys.filter { !numericKeys.contains($0) }.sorted()
    return sortedNumeric + rest
  }

  private func followFlow(_ start: FlowTarget?, budget: inout Int) {
    guard let start = start else { return }
    // Bounds native stack depth for nested `flow/for` bodies and `event/send` chains; a
    // rejected nesting still costs a step so loops around it stay within the budget.
    guard flowDepth < Self.maxFlowDepth else {
      budget += 1
      return
    }
    flowDepth += 1
    defer { flowDepth -= 1 }
    var queue: [FlowTarget] = [start]
    var head = 0
    while head < queue.count && budget < Self.maxStepsPerInvocation {
      budget += 1
      let cur = queue[head]
      head += 1
      guard cur.node >= 0, cur.node < graph.count else { continue }
      let nodeIdx = cur.node
      let node = graph[nodeIdx]
      let inSock = cur.socket ?? "in"
      func inp(_ name: String, _ fb: Value? = nil) -> Value? {
        var visited = Set<Int>()
        return readInput(nodeIdx, name, fb, &visited)
      }
      func push(_ target: FlowTarget?) {
        // Never enqueue more work than the remaining step budget can run.
        if let t = target, (queue.count - head) + budget < Self.maxStepsPerInvocation {
          queue.append(t)
        }
      }
      func pushOut(_ sock: String = "out") { push(node.flows[sock]) }
      func cfgNum(_ key: String) -> Value? { node.config[key] }

      switch node.op {
      case "flow/branch":
        pushOut(Self.jsBool(inp("condition", .bool(false))) ? "true" : "false")
      case "flow/sequence":
        for k in Self.sortedSequenceKeys(Array(node.flows.keys)) { pushOut(k) }
      case "flow/switch":
        let sel = inp("selection", inp("value", .number(0)))
        push(node.flows[Self.jsString(sel)] ?? node.flows["default"])
      case "flow/for":
        let sIdx = Self.num(inp("startIndex", .number(0))).rounded(.towardZero)
        let eIdx = Self.num(inp("endIndex", .number(0))).rounded(.towardZero)
        let stp = max(1, Self.num(inp("step", .number(1)), 1).rounded(.towardZero))
        if let body = node.flows["body"], eIdx > sIdx, forDepth < Self.maxForDepth {
          forDepth += 1
          defer { forDepth -= 1 }
          let maxIt = min(((eIdx - sIdx) / stp).rounded(.up), Double(Self.maxStepsPerInvocation))
          var it = 0.0
          while it < maxIt && budget < Self.maxStepsPerInvocation {
            setOut(nodeIdx, "index", .number(sIdx + it * stp))
            followFlow(body, budget: &budget)
            it += 1
          }
        }
        push(node.flows["completed"] ?? node.flows["out"])
      case "flow/doN":
        let c = inSock == "reset" ? 0 : (doNCounts[nodeIdx] ?? 0) + 1
        doNCounts[nodeIdx] = c
        setOut(nodeIdx, "currentCount", .number(Double(c)))
        setOut(nodeIdx, "count", .number(Double(c)))
        if inSock != "reset" {
          let fb = cfgNum("stopIterations") ?? cfgNum("n") ?? .number(1)
          let maxC = Self.num(inp("n", fb), 1).rounded(.towardZero)
          if Double(c) <= maxC { pushOut() }
        }
      case "flow/multiGate":
        if inSock == "reset" {
          multiGates[nodeIdx] = 0
          break
        }
        let keys = node.flows.keys.sorted()
        if keys.isEmpty { break }
        let idx =
          Self.jsBool(cfgNum("isRandom"))
          ? Int.random(in: 0..<keys.count) : (multiGates[nodeIdx] ?? 0)
        if idx < keys.count {
          pushOut(keys[idx])
          let loop = cfgNum("isLoop") != .bool(false)
          multiGates[nodeIdx] = loop ? (idx + 1) % keys.count : idx + 1
        }
      case "flow/waitAll":
        if inSock == "reset" {
          waitAll[nodeIdx] = nil
          break
        }
        var set = waitAll[nodeIdx] ?? []
        set.insert(inSock)
        let raw = Self.jsNumber(cfgNum("inputFlows") ?? .number(2)).rounded(.towardZero)
        let needed = (raw.isFinite && raw != 0) ? max(1, Int(max(-1e9, min(1e9, raw)))) : 2
        if set.count >= needed {
          set.removeAll()
          pushOut("out")
          pushOut("completed")
        }
        waitAll[nodeIdx] = set
      case "flow/throttle":
        if inSock == "reset" {
          throttles[nodeIdx] = nil
          break
        }
        let dur = max(0, Self.num(inp("duration", .number(0))))
        if let last = throttles[nodeIdx], elapsed - last < dur {
          setOut(nodeIdx, "lastRemainingTime", .number(max(0, dur - (elapsed - last))))
        } else {
          throttles[nodeIdx] = elapsed
          setOut(nodeIdx, "lastRemainingTime", .number(0))
          pushOut()
        }
      case "flow/delay", "flow/setDelay":
        if inSock == "cancel" {
          delays.removeAll { $0.nodeIndex == nodeIdx }
          setOut(nodeIdx, "lastDelayIndex", .number(-1))
          break
        }
        let dur = max(0, Self.num(inp("duration", cfgNum("duration") ?? .number(0))))
        let done = node.flows["done"] ?? node.flows["out"]
        if dur <= 0 {
          setOut(nodeIdx, "lastDelayIndex", .number(-1))
          push(done)
          break
        }
        if delays.count >= Self.maxActiveDelays { delays.removeFirst() }
        let id = nextDelayId
        nextDelayId += 1
        setOut(nodeIdx, "lastDelayIndex", .number(Double(id)))
        delays.append(Delay(id: id, nodeIndex: nodeIdx, remaining: dur, done: done))
        if node.op == "flow/setDelay" && node.flows["out"] != nil && node.flows["done"] != nil {
          pushOut("out")
        }
      case "flow/cancelDelay":
        let dIdx = Self.num(inp("delayIndex", .number(-1)), -1).rounded(.towardZero)
        if dIdx < 0 {
          delays.removeAll()
        } else {
          delays.removeAll { Double($0.id) == dIdx }
        }
        pushOut()
      case "variable/set":
        setVar(Self.varKey(cfgNum("variable") ?? cfgNum("id")), inp("value"))
        pushOut()
      case "variable/interpolate":
        let key = Self.varKey(cfgNum("variable") ?? cfgNum("id"))
        let target = inp("value", inp("target"))
        let dur = max(0, Self.num(inp("duration", cfgNum("duration") ?? .number(0.3)), 0.3))
        if let key = key, let target = target {
          addTween(
            Tween(
              key: "var:\(key)", pointer: nil, varKey: key,
              from: inp("from") ?? vars[key] ?? .number(0), to: target, duration: dur,
              elapsed: 0, quat: false, linear: cfgNum("easing") == .string("linear"),
              done: node.flows["done"]))
        }
        pushOut()
      case "pointer/set":
        let val = inp("value")
        var ptrVisited = Set<Int>()
        if let ptr = resolvePointer(nodeIdx, &ptrVisited), let val = val {
          cancelTween("ptr:" + ptr)
          writePointer(ptr, val)
        }
        pushOut()
      case "pointer/interpolate":
        let target = inp("value", inp("target"))
        let dur = max(0, Self.num(inp("duration", cfgNum("duration") ?? .number(0.3)), 0.3))
        var ptrVisited = Set<Int>()
        if let ptr = resolvePointer(nodeIdx, &ptrVisited), let target = target,
          let current = inp("from") ?? readPointer(ptr)
        {
          if dur <= 0 {
            writePointer(ptr, target)
            pushOut("done")
          } else {
            addTween(
              Tween(
                key: "ptr:" + ptr, pointer: ptr, varKey: nil, from: current, to: target,
                duration: dur, elapsed: 0, quat: ptr.hasSuffix("/rotation"),
                linear: cfgNum("easing") == .string("linear"), done: node.flows["done"]))
          }
        }
        pushOut()
      case "animation/start":
        let ref = inp("animation") ?? cfgNum("animation") ?? cfgNum("clipName")
        var index: Int?
        var name: String?
        switch ref {
        case .number(let d)?:
          if let i = Int(exactly: d), i >= 0 {
            index = i
            if i < animationNames.count { name = animationNames[i] }
          }
        case .string(let s)?:
          name = s
        default:
          break
        }
        delegate?.animationStart(index: index, name: name)
        pushOut()
      case "animation/stop", "animation/resetAt":
        delegate?.animationStop()
        pushOut()
      case "event/send", "customEvent/send":
        let id = resolveEventId(cfgNum("event") ?? cfgNum("id"))
        var payload: [String: Value] = [:]
        for k in node.valueKeys where !Self.forbiddenSegments.contains(k) {
          if let v = inp(k) { payload[k] = v }
        }
        if !id.isEmpty {
          delegate?.interactivityEvent(id: id, payloadJSON: Self.payloadJSON(payload))
          receiveCustomEvent(.string(id), payload: payload, budget: &budget)
        }
        pushOut()
      default:
        pushOut()
      }
    }
  }

  private func selectNodes() -> [Int] {
    (opIndex["pointer/onSelect"] ?? []) + (opIndex["event/onSelect"] ?? [])
      + (opIndex["scene/onSelect"] ?? [])
  }

  private func triggerMatches(graphIndex i: Int, hitNode: Int, meshName: String?) -> Bool {
    let node = graph[i]
    if case .string(let mesh)? = node.config["meshName"], !mesh.isEmpty {
      return meshName == mesh
    }
    var visited = Set<Int>()
    let target =
      node.config["nodeIndex"] ?? node.config["node"] ?? readInput(i, "nodeIndex", nil, &visited)
    guard let t = target else { return true }
    let n = Self.jsNumber(t)
    if n.isNaN || n < 0 { return true }
    guard let ti = Int(exactly: n.rounded(.towardZero)) else { return false }
    return isAncestor(hitNode, ti)
  }

  private func startIfNeeded() {
    if !started { start() }
  }

  private func dispatchPointer(
    ops: Set<String>, nodeIndex: Int, hitPoint: SIMD3<Float>?, meshName: String?
  ) {
    startIfNeeded()
    evalCount = 0
    let indices = ops.flatMap { opIndex[$0] ?? [] }.sorted()
    for i in indices where triggerMatches(graphIndex: i, hitNode: nodeIndex, meshName: meshName) {
      setOut(i, "nodeIndex", .number(Double(nodeIndex)))
      setOut(i, "meshIndex", .number(-1))
      if let p = hitPoint {
        let pt = Value.vector([Double(p.x), Double(p.y), Double(p.z)])
        setOut(i, "hitPoint", pt)
        setOut(i, "point", pt)
        setOut(i, "intersectionPoint", pt)
      }
      var budget = 0
      followFlow(graph[i].flows["out"], budget: &budget)
    }
    flush()
  }

  /// Runs matching `event/receive` triggers, charging steps to the caller's `budget` so
  /// nested `event/send` chains share one `maxStepsPerInvocation` budget.
  private func receiveCustomEvent(_ ev: Value, payload: [String: Value], budget: inout Int) {
    guard eventDepth < Self.maxEventNestingDepth else { return }
    eventDepth += 1
    defer { eventDepth -= 1 }
    let targetId = resolveEventId(ev)
    let evString = Self.jsString(ev)
    let indices = ((opIndex["event/receive"] ?? []) + (opIndex["customEvent/receive"] ?? [])).sorted()
    for i in indices {
      let cfgEv = graph[i].config["event"] ?? graph[i].config["id"]
      if resolveEventId(cfgEv) != targetId && Self.jsString(cfgEv) != evString { continue }
      for (k, v) in payload where !Self.forbiddenSegments.contains(k) {
        setOut(i, k, v)
      }
      followFlow(graph[i].flows["out"], budget: &budget)
    }
    flush()
  }

  private func tick(_ dt: Double) {
    guard dt.isFinite, dt >= 0 else { return }
    let d = min(dt, 0.25)
    elapsed += d
    for i in opIndex["event/onTick"] ?? [] {
      setOut(i, "timeDelta", .number(d))
      setOut(i, "dt", .number(d))
      setOut(i, "timeElapsed", .number(elapsed))
      var budget = 0
      followFlow(graph[i].flows["out"], budget: &budget)
    }
    var doneFlows: [FlowTarget] = []
    var i = tweens.count - 1
    while i >= 0 {
      if i < tweens.count {
        tweens[i].elapsed += d
        let tw = tweens[i]
        let rt = tw.duration > 1e-6 ? Self.clamp01(tw.elapsed / tw.duration) : 1
        let et = tw.linear ? rt : rt * rt * (3 - 2 * rt)
        if let cur = Self.lerpVal(tw.from, tw.to, et, quat: tw.quat) {
          if let ptr = tw.pointer {
            writePointer(ptr, cur)
          } else if let key = tw.varKey {
            setVar(key, cur)
          }
        }
        if rt >= 1 {
          tweens.remove(at: i)
          if let done = tw.done { doneFlows.append(done) }
        }
      }
      i -= 1
    }
    var j = delays.count - 1
    while j >= 0 {
      delays[j].remaining -= d
      if delays[j].remaining <= 0 {
        let dl = delays.remove(at: j)
        if let done = dl.done { doneFlows.append(done) }
      }
      j -= 1
    }
    for f in doneFlows {
      var budget = 0
      followFlow(f, budget: &budget)
    }
  }

  // MARK: Lazy follow and orbit

  private static func transform(of n: NodeState) -> XRNodeTransform {
    XRNodeTransform(
      translation: SIMD3<Float>(Float(n.translation.x), Float(n.translation.y), Float(n.translation.z)),
      rotation: simd_quatf(
        ix: Float(n.rotation.x), iy: Float(n.rotation.y), iz: Float(n.rotation.z),
        r: Float(n.rotation.w)),
      scale: SIMD3<Float>(Float(n.scale.x), Float(n.scale.y), Float(n.scale.z))
    )
  }

  /// World matrix of node `index` (`rootTransform × parents × local`).
  public func worldMatrix(of index: Int) -> simd_float4x4 {
    guard index >= 0, index < nodes.count else { return rootTransform }
    var m = Self.transform(of: nodes[index]).matrix
    var cur = parentOf[index]
    var depth = 0
    while let c = cur, c >= 0, c < nodes.count, c != index, depth < 128 {
      m = Self.transform(of: nodes[c]).matrix * m
      cur = parentOf[c]
      depth += 1
    }
    return rootTransform * m
  }

  private func parentWorld(of index: Int) -> simd_float4x4 {
    if let p = parentOf[index], p >= 0, p < nodes.count { return worldMatrix(of: p) }
    return rootTransform
  }

  private func setWorldTRS(_ index: Int, rotation: simd_quatf, position: SIMD3<Float>, scale: SIMD3<Float>) {
    let parent = parentWorld(of: index)
    let det = simd_determinant(parent)
    guard det.isFinite, abs(det) > 1e-12 else { return }
    let desired = XRBlocksMath.compose(translation: position, rotation: rotation, scale: scale)
    let local = parent.inverse * desired
    let trs = XRBlocksMath.decompose(local)
    let t = trs.translation
    let s = trs.scale
    let q = trs.rotation.vector
    guard [t.x, t.y, t.z, s.x, s.y, s.z, q.x, q.y, q.z, q.w].allSatisfy({ $0.isFinite }) else {
      return
    }
    nodes[index].translation = SIMD3<Double>(Double(t.x), Double(t.y), Double(t.z))
    nodes[index].rotation = SIMD4<Double>(Double(q.x), Double(q.y), Double(q.z), Double(q.w))
    nodes[index].scale = SIMD3<Double>(Double(s.x), Double(s.y), Double(s.z))
    dirtyTransforms.insert(index)
  }

  private func stepFollowAndOrbit(dt: Double, headPose: XRPose?, handPoses: [XRHand: XRPose]) {
    let stepDt = Float(dt.isFinite ? max(0, min(0.1, dt)) : 1.0 / 60.0)
    for i in 0..<nodes.count {
      guard let traits = nodes[i].traits else { continue }
      if grabbed.contains(i) {
        followStates[i] = nil
        continue
      }
      if let follow = traits.lazyFollow {
        stepFollow(i, follow, headPose: headPose, handPoses: handPoses, dt: stepDt)
        continue
      }
      if let orbit = traits.orbit {
        stepOrbit(i, orbit, headPose: headPose, dt: stepDt)
      }
    }
  }

  private func stepFollow(
    _ i: Int, _ options: XRLiveLazyFollow, headPose: XRPose?, handPoses: [XRHand: XRPose],
    dt: Float
  ) {
    let anchor: XRPose?
    switch options.mode {
    case "hand-left": anchor = handPoses[.left]
    case "hand-right": anchor = handPoses[.right]
    default: anchor = headPose
    }
    guard let anchorPose = anchor else { return }
    let world = XRBlocksMath.decompose(worldMatrix(of: i))
    let target = XRBlocksMath.computeFollowTarget(anchor: anchorPose, options: options)
    var state =
      followStates[i]
      ?? FollowState(
        spring: XRSpringState(position: options.snapOnStart ? target : world.translation),
        following: false)
    if !state.following
      && XRBlocksMath.shouldStartFollowing(
        position: state.spring.position, target: target, anchor: anchorPose, options: options)
    {
      state.following = true
    }
    if state.following {
      XRBlocksMath.stepCriticallyDampedSpring(
        &state.spring, target: target, omega: options.stiffness, dt: dt)
      if simd_length(state.spring.position - target) < 0.01
        && simd_length(state.spring.velocity) < 0.01
      {
        state.following = false
      }
    }
    followStates[i] = state
    var rotation = world.rotation
    if options.faceUser, let head = headPose {
      rotation = XRBlocksMath.yawTowards(from: state.spring.position, to: head.position)
    }
    setWorldTRS(i, rotation: rotation, position: state.spring.position, scale: world.scale)
  }

  private func stepOrbit(_ i: Int, _ options: XRLiveOrbit, headPose: XRPose?, dt: Float) {
    let center: SIMD3<Float>
    if let name = options.targetName {
      if name == "head" {
        guard let head = headPose else { return }
        center = head.position
      } else {
        guard let ref = nodeIndexByName[name], ref != i else { return }
        let m = worldMatrix(of: ref)
        center = SIMD3<Float>(m.columns.3.x, m.columns.3.y, m.columns.3.z)
      }
    } else {
      // Literal targets are authored in scene (model) space.
      center = XRBlocksMath.transformPoint(rootTransform, options.targetPoint)
    }
    let t = (orbitTimes[i] ?? 0) + Double(dt)
    orbitTimes[i] = t
    let world = XRBlocksMath.decompose(worldMatrix(of: i))
    let pos = XRBlocksMath.computeOrbitPosition(center: center, options: options, t: Float(t))
    let rotation =
      options.faceCenter ? XRBlocksMath.yawTowards(from: pos, to: center) : world.rotation
    setWorldTRS(i, rotation: rotation, position: pos, scale: world.scale)
  }

  // MARK: Delivery

  private static func publicMaterial(_ m: MaterialData) -> XRMaterialState {
    XRMaterialState(
      baseColorFactor: SIMD4<Float>(
        Float(m.baseColor.x), Float(m.baseColor.y), Float(m.baseColor.z), Float(m.baseColor.w)),
      metallicFactor: Float(m.metallic),
      roughnessFactor: Float(m.roughness),
      emissiveFactor: SIMD3<Float>(Float(m.emissive.x), Float(m.emissive.y), Float(m.emissive.z)),
      alphaCutoff: Float(m.alphaCutoff)
    )
  }

  static func payloadJSON(_ payload: [String: Value]) -> String {
    var obj: [String: Any] = [:]
    for (k, v) in payload { obj[k] = v.jsonObject }
    guard JSONSerialization.isValidJSONObject(obj),
      let data = try? JSONSerialization.data(withJSONObject: obj, options: [.sortedKeys]),
      let s = String(data: data, encoding: .utf8)
    else { return "{}" }
    return s
  }

  private static func convertPayload(_ payload: [String: Any]) -> [String: Value] {
    var out: [String: Value] = [:]
    for (k, raw) in payload where !forbiddenSegments.contains(k) {
      if let v = Value(json: raw) { out[k] = v }
    }
    return out
  }

  private func flush() {
    let transforms = dirtyTransforms.sorted()
    let visibility = dirtyVisibility.sorted()
    let mats = dirtyMaterials.sorted()
    dirtyTransforms.removeAll()
    dirtyVisibility.removeAll()
    dirtyMaterials.removeAll()
    guard let d = delegate else { return }
    for i in transforms where i < nodes.count {
      d.nodeTransformChanged(i, transform: Self.transform(of: nodes[i]))
    }
    for i in visibility where i < nodes.count {
      d.visibilityChanged(i, visible: nodes[i].visible)
    }
    for i in mats where i < materials.count {
      d.materialChanged(i, material: Self.publicMaterial(materials[i]))
    }
  }
}
