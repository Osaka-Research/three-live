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

/**
 * @fileoverview Luxury PBR, Optical Materials & Custom Shader Plugin for three-live.
 * Implements:
 * - KHR_materials_clearcoat
 * - KHR_materials_sheen
 * - KHR_materials_unlit
 * - KHR_materials_transmission (two-pass screen-space backbuffer refraction + mip blur)
 * - KHR_materials_volume (thickness refraction offset + Beer-Lambert absorption)
 * - KHR_materials_ior (physical dielectric index of refraction)
 * - KHR_materials_dispersion (Cauchy RGB chromatic dispersion)
 * - KHR_materials_iridescence (thin-film interference phase shift)
 */

import type {ThreeLivePlugin} from '../plugin';

export interface CustomShaderDefinition {
  vs?: string;
  fs?: string;
  onBindUniforms?: (
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitive: any,
  ) => void;
}

const customShaders = new Map<string, CustomShaderDefinition>();
const transmissionTextures = new WeakMap<
  WebGL2RenderingContext,
  WebGLTexture
>();

export function registerMaterialShader(
  name: string,
  def: CustomShaderDefinition,
): void {
  customShaders.set(name, def);
}

export const materialsPlugin: ThreeLivePlugin = {
  name: 'materials',

  onBuildPrimitiveVAO(
    _gl: WebGL2RenderingContext,
    _vao: WebGLVertexArrayObject,
    primitiveDef: any,
    gltf: any,
    _bin: ArrayBuffer,
  ): any {
    const mat =
      gltf?.materials && primitiveDef.material !== undefined
        ? gltf.materials[primitiveDef.material]
        : null;
    const exts = mat?.extensions || {};
    const trans = exts.KHR_materials_transmission?.transmissionFactor ?? 0;
    if (trans > 0) {
      return {isTransmissive: true};
    }
    return null;
  },

  onBeforeTransmissivePass(gl: WebGL2RenderingContext, view: any): void {
    let tex = transmissionTextures.get(gl);
    if (!tex) {
      tex = gl.createTexture()!;
      transmissionTextures.set(gl, tex);
    }
    const width = Math.max(1, view.canvas.width);
    const height = Math.max(1, view.canvas.height);

    gl.activeTexture(gl.TEXTURE6);
    gl.bindTexture(gl.TEXTURE_2D, tex);
    gl.copyTexImage2D(gl.TEXTURE_2D, 0, gl.RGBA, 0, 0, width, height, 0);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_S, gl.CLAMP_TO_EDGE);
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_WRAP_T, gl.CLAMP_TO_EDGE);
    gl.texParameteri(
      gl.TEXTURE_2D,
      gl.TEXTURE_MIN_FILTER,
      gl.LINEAR_MIPMAP_LINEAR,
    );
    gl.texParameteri(gl.TEXTURE_2D, gl.TEXTURE_MAG_FILTER, gl.LINEAR);
    gl.generateMipmap(gl.TEXTURE_2D);
  },

  onResolveShader(
    _primitiveDef: any,
    materialDef: any,
    defaultVS: string,
    defaultFS: string,
  ): {vs: string; fs: string} | null {
    if (!materialDef) return null;

    if (materialDef.name && customShaders.has(materialDef.name)) {
      const def = customShaders.get(materialDef.name)!;
      return {
        vs: def.vs || defaultVS,
        fs: def.fs || defaultFS,
      };
    }

    const exts = materialDef.extensions || {};
    const cc = exts.KHR_materials_clearcoat;
    const sh = exts.KHR_materials_sheen;
    const hasTransmission = Boolean(exts.KHR_materials_transmission);
    const hasIOR = Boolean(exts.KHR_materials_ior);
    const irid = exts.KHR_materials_iridescence;

    if (
      !cc &&
      !sh &&
      !exts.KHR_materials_unlit &&
      !hasTransmission &&
      !exts.KHR_materials_volume &&
      !hasIOR &&
      !exts.KHR_materials_dispersion &&
      !irid
    ) {
      return null;
    }

    if (exts.KHR_materials_unlit) {
      return {
        vs: defaultVS,
        fs: defaultFS
          .replace(
            'fragColor=vec4(color,outAlpha);',
            'fragColor=vec4(base.rgb,outAlpha);',
          )
          .replace(
            'fragColor=vec4(color,base.a);',
            'fragColor=vec4(base.rgb,base.a);',
          ),
      };
    }

    let modifiedFS = defaultFS;

    if (hasTransmission) {
      modifiedFS = modifiedFS.replace(
        'out vec4 fragColor;',
        'uniform sampler2D uTransmissionTex;\nuniform vec2 uViewportSize;\nout vec4 fragColor;',
      );
    }

    const safeGlslFloat = (
      val: unknown,
      fallback: number,
      min = 0,
      max = 1e6,
      decimals = 3,
    ): string => {
      const n = Number(val);
      return (
        Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : fallback
      ).toFixed(decimals);
    };

    // 1. Custom IOR F0 override
    const rawIor = Number(exts.KHR_materials_ior?.ior ?? 1.5);
    const iorVal = Number.isFinite(rawIor)
      ? Math.min(10.0, Math.max(1.0, rawIor))
      : 1.5;
    if (hasIOR) {
      const f0Scalar = Math.pow((iorVal - 1.0) / (iorVal + 1.0), 2.0);
      modifiedFS = modifiedFS.replace(
        'vec3 F0=mix(vec3(0.04),base.rgb,metallic);',
        `vec3 F0=mix(vec3(${safeGlslFloat(f0Scalar, 0.04, 0, 1, 4)}),base.rgb,metallic);`,
      );
    }

    // 2. Thin-film Iridescence
    if (irid) {
      const iridFactor = safeGlslFloat(irid.iridescenceFactor, 1.0, 0, 1);
      const iridIOR = safeGlslFloat(irid.iridescenceIor, 1.3, 1.0, 10.0);
      modifiedFS = modifiedFS.replace(
        'vec3 F=F_SchlickRoughness(F0,roughness,NoV);',
        `vec3 F=F_SchlickRoughness(F0,roughness,NoV);vec3 iridColor=.5+.5*cos(800.*${iridIOR}*NoV*vec3(.015,.018,.022));F=mix(F,iridColor,${iridFactor}*pow(1.-NoV,2.));`,
      );
    }

    // 3. Transmission, Volume Absorption & Chromatic Dispersion
    if (hasTransmission) {
      const transFactor = safeGlslFloat(
        exts.KHR_materials_transmission?.transmissionFactor,
        1.0,
        0,
        1,
      );
      const vol = exts.KHR_materials_volume || {};
      const thickness = safeGlslFloat(vol.thicknessFactor, 0.5, 0, 1e4);
      const attenDist = safeGlslFloat(vol.attenuationDistance, 1.0, 0.001, 1e6);
      const attenCol = Array.isArray(vol.attenuationColor)
        ? vol.attenuationColor
        : [1, 1, 1];
      const disp = safeGlslFloat(
        exts.KHR_materials_dispersion?.dispersion,
        0.0,
        0,
        10,
      );

      modifiedFS = modifiedFS.replace(
        'vec3 diffuseIBL=kD*base.rgb*(uAmbientColor+envDiffuse*0.5)*occ;',
        `vec3 diffuseIBL=kD*base.rgb*(uAmbientColor+envDiffuse*0.5)*occ;
vec2 sUV=gl_FragCoord.xy/max(uViewportSize,vec2(1.));float iorB=${safeGlslFloat(iorVal, 1.5, 1.0, 10.0)},dV=${disp},tV=${thickness},lod=clamp(roughness*5.,0.,5.),sc=.06*(1.+tV);
vec3 refractedR=refract(-V,N,1./(iorB-.02*dV)),rG=refract(-V,N,1./iorB),refractedB=refract(-V,N,1./(iorB+.02*dV));
vec3 tr=vec3(textureLod(uTransmissionTex,clamp(sUV+refractedR.xy*sc,.001,.999),lod).r,textureLod(uTransmissionTex,clamp(sUV+rG.xy*sc,.001,.999),lod).g,textureLod(uTransmissionTex,clamp(sUV+refractedB.xy*sc,.001,.999),lod).b);
vec3 aCol=vec3(${safeGlslFloat(attenCol[0], 1.0, 0, 1)},${safeGlslFloat(attenCol[1], 1.0, 0, 1)},${safeGlslFloat(attenCol[2], 1.0, 0, 1)});
vec3 volumeAtten=exp(-tV*(vec3(1.)-aCol)/max(${attenDist},.001));
diffuseIBL=mix(diffuseIBL,tr*volumeAtten*base.rgb,${transFactor});`,
      );
    }

    // 4. Clearcoat (injected only if defaultFS does not already have built-in uClearcoat)
    if (cc && !defaultFS.includes('uClearcoat')) {
      const factor = safeGlslFloat(cc.clearcoatFactor, 1.0, 0, 1);
      const rough = safeGlslFloat(cc.clearcoatRoughnessFactor, 0.0, 0, 1);
      modifiedFS = modifiedFS.replace(
        'fragColor=vec4(color,base.a);',
        `vec3 ccF=F_SchlickRoughness(vec3(.04),${rough},NoV)*${factor};color=color*(vec3(1.)-ccF)+getStudioRadiance(R,${rough})*ccF;fragColor=vec4(color,base.a);`,
      );
    }

    // 5. Sheen
    if (sh) {
      const col = Array.isArray(sh.sheenColorFactor)
        ? sh.sheenColorFactor
        : [1, 1, 1];
      const sheenExpr = `color+=vec3(${safeGlslFloat(col[0], 1.0, 0, 1)},${safeGlslFloat(col[1], 1.0, 0, 1)},${safeGlslFloat(col[2], 1.0, 0, 1)})*pow(1.-NoV,4.)*.5;`;
      if (modifiedFS.includes('color=applyToneMapping(color,uToneMapping);')) {
        modifiedFS = modifiedFS.replace(
          'color=applyToneMapping(color,uToneMapping);',
          `${sheenExpr}color=applyToneMapping(color,uToneMapping);`,
        );
      } else {
        modifiedFS = modifiedFS.replace(
          'fragColor=vec4(color,base.a);',
          `${sheenExpr}fragColor=vec4(color,base.a);`,
        );
      }
    }

    return {vs: defaultVS, fs: modifiedFS};
  },

  onBeforeDrawPrimitive(
    gl: WebGL2RenderingContext,
    program: WebGLProgram,
    primitiveGpu: any,
    _meshGpu: any,
    _nodeWorldMatrices: Float32Array[],
    gltf: any,
  ): void {
    const matIndex = primitiveGpu.materialIndex;
    if (matIndex !== undefined && gltf?.materials) {
      const matDef = gltf.materials[matIndex];
      if (matDef?.name && customShaders.has(matDef.name)) {
        const def = customShaders.get(matDef.name)!;
        def.onBindUniforms?.(gl, program, primitiveGpu);
      }
    }

    if (primitiveGpu.isTransmissive) {
      const tex = transmissionTextures.get(gl);
      if (tex) {
        gl.activeTexture(gl.TEXTURE6);
        gl.bindTexture(gl.TEXTURE_2D, tex);
        const uTexLoc = gl.getUniformLocation(program, 'uTransmissionTex');
        if (uTexLoc) gl.uniform1i(uTexLoc, 6);
        const uSizeLoc = gl.getUniformLocation(program, 'uViewportSize');
        if (uSizeLoc) {
          gl.uniform2f(
            uSizeLoc,
            gl.drawingBufferWidth || 1,
            gl.drawingBufferHeight || 1,
          );
        }
      }
    }
  },
};
