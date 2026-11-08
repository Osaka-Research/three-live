/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import type {DegradedAliasMatch, SymbolAnalysis} from './types.ts';

/**
 * Symbols natively implemented in `three-author.ts` + `cad.ts` + `ik.ts` + `lod.ts`
 * without fidelity loss.
 */
export const NATIVE_SUPPORTED_SYMBOLS = new Set<string>([
  // Math
  'Vector2',
  'Vector3',
  'Vector4',
  'Euler',
  'Quaternion',
  'Matrix4',
  'Matrix3',
  'Box3',
  'Sphere',
  'ImprovedNoise',
  'SimplexNoise',
  'Color',
  'MathUtils',
  // Buffers & Core Geometries
  'BufferAttribute',
  'Float32BufferAttribute',
  'Uint16BufferAttribute',
  'Uint32BufferAttribute',
  'BufferGeometry',
  'BoxGeometry',
  'PlaneGeometry',
  'SphereGeometry',
  'CylinderGeometry',
  'ConeGeometry',
  'TorusGeometry',
  'TorusKnotGeometry',
  'Curve',
  'Curve3',
  'LineCurve3',
  'QuadraticBezierCurve3',
  'CubicBezierCurve3',
  'CatmullRomCurve3',
  'LatheGeometry',
  'TubeGeometry',
  'PolyhedronGeometry',
  'IcosahedronGeometry',
  'OctahedronGeometry',
  'DodecahedronGeometry',
  'TetrahedronGeometry',
  'CapsuleGeometry',
  'RingGeometry',
  'CircleGeometry',
  'WireframeGeometry',
  'EdgesGeometry',
  // Standard Three.js Enum Constants
  'FrontSide',
  'BackSide',
  'DoubleSide',
  'NoBlending',
  'NormalBlending',
  'AdditiveBlending',
  'SubtractiveBlending',
  'MultiplyBlending',
  'CustomBlending',
  'RepeatWrapping',
  'ClampToEdgeWrapping',
  'MirroredRepeatWrapping',
  'NearestFilter',
  'NearestMipmapNearestFilter',
  'NearestMipmapLinearFilter',
  'LinearFilter',
  'LinearMipmapNearestFilter',
  'LinearMipmapLinearFilter',
  'SRGBColorSpace',
  'LinearSRGBColorSpace',
  'NoColorSpace',
  'UnsignedByteType',
  'ByteType',
  'ShortType',
  'UnsignedShortType',
  'IntType',
  'UnsignedIntType',
  'FloatType',
  'HalfFloatType',
  'AlphaFormat',
  'RGBFormat',
  'RGBAFormat',
  'LuminanceFormat',
  'LuminanceAlphaFormat',
  'RedFormat',
  'RGFormat',
  'StaticDrawUsage',
  'DynamicDrawUsage',
  'NoToneMapping',
  'LinearToneMapping',
  'ReinhardToneMapping',
  'CineonToneMapping',
  'ACESFilmicToneMapping',
  'AgXToneMapping',
  'NeutralToneMapping',
  'BasicShadowMap',
  'PCFShadowMap',
  'PCFSoftShadowMap',
  'VSMShadowMap',
  // CAD & Vector Text Extensions (installed in server extract & cadPlugin)
  'Path',
  'Shape',
  'ShapeGeometry',
  'ExtrudeGeometry',
  'TextGeometry',
  'CSG',
  'MAX_CSG_TRIANGLES',
  'MAX_BSP_DEPTH',
  'MAX_TEXT_GEOMETRY_CHARS',
  'MAX_SHAPE_POINTS',
  // Materials & Textures
  'Texture',
  'DataTexture',
  'CanvasTexture',
  'TextureLoader',
  'Material',
  'MeshStandardMaterial',
  'MeshBasicMaterial',
  'MeshLambertMaterial',
  'MeshPhongMaterial',
  'MeshPhysicalMaterial',
  'PointsMaterial',
  'LineBasicMaterial',
  'LineDashedMaterial',
  'SpriteMaterial',
  'ShaderMaterial',
  'RawShaderMaterial',
  // Scene Graph & Meshes
  'Object3D',
  'Group',
  'Mesh',
  'InstancedMesh',
  'Sprite',
  'Line',
  'LineLoop',
  'LineSegments',
  'Points',
  // Lights & Cameras
  'Light',
  'AmbientLight',
  'DirectionalLight',
  'PointLight',
  'SpotLight',
  'HemisphereLight',
  'Camera',
  'PerspectiveCamera',
  'Scene',
  'WebGLRenderer',
  'Clock',
  // IK & LOD Extensions
  'IKSolver',
  'solveTwoBoneIK',
  'solveFABRIK',
  'quatFromUnitVectors',
  'LOD',
  'decimateGeometry',
  // Internal / Exporter helpers
  'SceneQuotaValidator',
  'exportSceneToCanvas3D',
  'exportSceneToGLB',
  'exportSceneToUSDZ',
  'generateUSDZ',
  'glbToUSDZ',
  'sceneToCanvas3D',
  'sceneToGLB',
  'sceneToUSDZ',
]);

/**
 * Symbols present in `threeExports` that compile into a simplified/degraded primitive
 * and emit a `TL102` warning.
 */
export const DEGRADED_ALIAS_SYMBOLS = new Map<string, string>([
  ['RectAreaLight', 'AmbientLight (loses rectangular area emitter)'],
]);

/**
 * Less-common Three.js enum/numeric constants that are NOT exported on `THREE`
 * in `three-author.ts`.
 */
export const UNSUPPORTED_CONSTANTS = new Set<string>([
  'ZeroCurvatureEnding',
  'WrapAroundEnding',
  'LoopOnce',
  'LoopRepeat',
  'LoopPingPong',
  'InterpolateDiscrete',
  'InterpolateLinear',
  'InterpolateSmooth',
]);

/**
 * External loader/control symbols where `TL103` ("Load external models via <three-live src='...'>
 * or use built-in orbit camera") is genuinely the right diagnostic classification.
 */
export const GENUINE_TL103_LOADER_CONTROL_SYMBOLS = new Set<string>([
  'GLTFLoader',
  'DRACOLoader',
  'OBJLoader',
  'FBXLoader',
  'STLLoader',
  'PLYLoader',
  'RGBELoader',
  'EXRLoader',
  'FontLoader',
  'AudioLoader',
  'CubeTextureLoader',
  'OrbitControls',
  'TrackballControls',
  'TransformControls',
  'FlyControls',
  'FirstPersonControls',
  'PointerLockControls',
]);

/**
 * Strips JS comments so regex symbol extraction doesn't match commented-out code.
 */
export function stripJsComments(code: string): string {
  return code
    .replace(/\/\*[\s\S]*?\*\//g, '')
    .replace(/\/\/[^\n]*/g, '');
}

/**
 * Extracts all `THREE.<Symbol>` references from a Three.js script and classifies them.
 */
export function analyzeThreeSymbols(code: string): SymbolAnalysis {
  const clean = stripJsComments(code);
  const symbolRegex = /\bTHREE\.([A-Za-z_][A-Za-z0-9_]*)\b/g;
  const allSymbols = new Set<string>();
  let match: RegExpExecArray | null = null;
  while ((match = symbolRegex.exec(clean)) !== null) {
    allSymbols.add(match[1]);
  }

  const supported: string[] = [];
  const degradedAliases: DegradedAliasMatch[] = [];
  const unsupportedConstants: string[] = [];
  const unsupportedClasses: string[] = [];

  for (const sym of Array.from(allSymbols).sort()) {
    if (NATIVE_SUPPORTED_SYMBOLS.has(sym)) {
      supported.push(sym);
    } else if (DEGRADED_ALIAS_SYMBOLS.has(sym)) {
      degradedAliases.push({
        symbol: sym,
        degradesTo: DEGRADED_ALIAS_SYMBOLS.get(sym) ?? '',
      });
    } else if (UNSUPPORTED_CONSTANTS.has(sym)) {
      unsupportedConstants.push(sym);
    } else {
      unsupportedClasses.push(sym);
    }
  }

  return {
    totalUniqueSymbols: allSymbols.size,
    supported,
    degradedAliases,
    unsupportedConstants,
    unsupportedClasses,
  };
}
