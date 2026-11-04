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

import type {ThreeLivePlugin} from '../plugin';
import type {GLBData, ThreeView} from '../three-view';

/**
 * Primitive-level `KHR_materials_variants` mapping entry associating a glTF
 * `material` index with one or more root `variants` indices.
 */
export interface MaterialVariantMapping {
  material: number;
  variants: number[];
}

/** Alias for `MaterialVariantMapping`. */
export type VariantMapping = MaterialVariantMapping;

/**
 * Extracts ordered variant names from root `extensions.KHR_materials_variants`.
 */
export function extractMaterialVariants(gltf: unknown): string[] {
  const g = gltf as
    | {
        extensions?: {
          KHR_materials_variants?: {variants?: Array<{name?: unknown}>};
        };
      }
    | null
    | undefined;
  const raw = g?.extensions?.KHR_materials_variants?.variants;
  if (!Array.isArray(raw)) return [];
  const out: string[] = [];
  for (let i = 0; i < raw.length && out.length < 256; i++) {
    const name = raw[i]?.name;
    out.push(
      typeof name === 'string' && name.length > 0 ? name : `Variant_${i}`,
    );
  }
  return out;
}

/**
 * Extracts primitive-level `KHR_materials_variants.mappings` entries.
 */
export function extractPrimitiveVariantMappings(
  primitive: unknown,
): MaterialVariantMapping[] {
  const p = primitive as
    | {
        extensions?: {
          KHR_materials_variants?: {mappings?: unknown};
        };
      }
    | null
    | undefined;
  const raw = p?.extensions?.KHR_materials_variants?.mappings;
  if (!Array.isArray(raw)) return [];
  const mappings: MaterialVariantMapping[] = [];
  for (const item of raw) {
    if (!item || typeof item !== 'object') continue;
    const m = item as {material?: unknown; variants?: unknown};
    const matIdx = Number(m.material);
    if (!Number.isInteger(matIdx) || matIdx < 0) continue;
    const variants: number[] = [];
    if (Array.isArray(m.variants)) {
      for (const v of m.variants) {
        const vi = Number(v);
        if (Number.isInteger(vi) && vi >= 0) variants.push(vi);
      }
    }
    if (variants.length > 0) {
      mappings.push({material: matIdx, variants});
    }
  }
  return mappings;
}

/**
 * Selects a material variant by name on `view` (or resolves a primitive's
 * material index when passed `(gltf, mappings, variantName, defaultMaterial)`).
 */
export function selectMaterialVariant(
  view: ThreeView,
  variantName: string | null,
): boolean;
export function selectMaterialVariant(
  gltf: unknown,
  mappings: MaterialVariantMapping[],
  variantName: string | null,
  defaultMaterialIndex?: number,
): number;
export function selectMaterialVariant(
  viewOrGltf: unknown,
  variantNameOrMappings: unknown,
  maybeVariantName?: string | null,
  defaultMaterialIndex = 0,
): boolean | number {
  const maybeView = viewOrGltf as {
    selectVariant?: (name: string | null) => boolean;
  } | null;
  if (
    maybeView &&
    typeof maybeView.selectVariant === 'function' &&
    !Array.isArray(variantNameOrMappings)
  ) {
    return maybeView.selectVariant(
      typeof variantNameOrMappings === 'string' ? variantNameOrMappings : null,
    );
  }
  const gltf = viewOrGltf;
  const mappings: MaterialVariantMapping[] = Array.isArray(
    variantNameOrMappings,
  )
    ? (variantNameOrMappings as MaterialVariantMapping[])
    : [];
  const variantName = maybeVariantName ?? null;
  if (!variantName) return defaultMaterialIndex;
  const variants = extractMaterialVariants(gltf);
  const vIdx = variants.indexOf(variantName);
  if (vIdx < 0) return defaultMaterialIndex;
  for (const m of mappings) {
    if (m.variants.includes(vIdx)) return m.material;
  }
  return defaultMaterialIndex;
}

/**
 * `<three-live>` plugin that applies any active `variantName` when a model
 * declaring `KHR_materials_variants` finishes loading.
 */
export const variantsPlugin: ThreeLivePlugin = {
  name: 'variants',
  onLoadModel(view: ThreeView, _gltf: GLBData['gltf']) {
    const active = view.getVariantName?.();
    if (active) {
      view.selectVariant(active);
    }
  },
};
