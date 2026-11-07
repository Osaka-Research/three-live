/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {execFile} from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import * as zlib from 'zlib';
import {resolveLlmConfig} from './llm_client.ts';
import type {
  CliOptions,
  LlmConfig,
  PromptEntry,
  QuadrantRasterMetrics,
  QuadRasterStats,
  ScriptEvalResult,
  VisualEvaluation,
  VlmJudgeScores,
} from './types.ts';

/**
 * IEEE 802.3 CRC-32 table for re-encoding compressed PNG chunks in place.
 */
const PNG_CRC_TABLE: Uint32Array = (() => {
  const t = new Uint32Array(256);
  for (let i = 0; i < 256; i++) {
    let c = i;
    for (let k = 0; k < 8; k++) {
      c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    }
    t[i] = c >>> 0;
  }
  return t;
})();

export function crc32Buf(buf: Buffer): number {
  let c = 0xffffffff;
  for (let i = 0; i < buf.length; i++) {
    c = PNG_CRC_TABLE[(c ^ buf[i]) & 0xff] ^ (c >>> 8);
  }
  return (c ^ 0xffffffff) >>> 0;
}

export function makePngChunk(typeAscii: string, dataBuf: Buffer): Buffer {
  const out = Buffer.allocUnsafe(12 + dataBuf.length);
  out.writeUInt32BE(dataBuf.length, 0);
  out.write(typeAscii, 4, 4, 'ascii');
  dataBuf.copy(out, 8);
  const crc = crc32Buf(out.subarray(4, 8 + dataBuf.length));
  out.writeUInt32BE(crc, 8 + dataBuf.length);
  return out;
}

/**
 * Decodes a 4-up quad PNG rendered by `three-live-cli render`, re-compresses
 * uncompressed store-block IDAT streams in place with `zlib.deflateSync` (shrinking
 * 1.64 MB -> ~55 KB), and extracts per-quadrant raster metrics (`camera`, `front`, `top`, `iso`).
 */
export function analyzeAndCompressQuadPng(pngPath: string): QuadRasterStats | null {
  if (!fs.existsSync(pngPath)) {
    return null;
  }
  const buf = fs.readFileSync(pngPath);
  if (buf.length < 32) {
    return null;
  }

  let offset = 8;
  let width = 0;
  let height = 0;
  let ihdrData: Buffer | null = null;
  const idatChunks: Buffer[] = [];
  while (offset + 8 <= buf.length) {
    const len = buf.readUInt32BE(offset);
    const type = buf.toString('ascii', offset + 4, offset + 8);
    const data = buf.subarray(offset + 8, offset + 8 + len);
    if (type === 'IHDR') {
      width = data.readUInt32BE(0);
      height = data.readUInt32BE(4);
      ihdrData = Buffer.from(data);
    } else if (type === 'IDAT') {
      idatChunks.push(data);
    } else if (type === 'IEND') {
      break;
    }
    offset += 12 + len;
  }
  if (!width || !height || idatChunks.length === 0) {
    return null;
  }

  const raw = zlib.inflateSync(Buffer.concat(idatChunks));
  if (ihdrData && buf.length > width * height * 2) {
    const compressedIdat = zlib.deflateSync(raw, {level: 6});
    const sig = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]);
    const outPng = Buffer.concat([
      sig,
      makePngChunk('IHDR', ihdrData),
      makePngChunk('IDAT', compressedIdat),
      makePngChunk('IEND', Buffer.alloc(0)),
    ]);
    fs.writeFileSync(pngPath, outPng);
  }

  const cw = width >> 1;
  const ch = height >> 1;
  const stride = 1 + width * 4;

  function analyzeQuadrant(ox: number, oy: number): QuadrantRasterMetrics {
    const mask = new Uint8Array(cw * ch);
    for (let y = 28; y < ch - 6; y++) {
      const t = y / ch;
      const bgR = 13 + t * 15;
      const bgG = 19 + t * 20;
      const bgB = 34 + t * 26;
      const rowOff = (oy + y) * stride + 1;
      for (let x = 6; x < cw - 6; x++) {
        const idx = rowOff + (ox + x) * 4;
        const r = raw[idx];
        const g = raw[idx + 1];
        const b = raw[idx + 2];
        const diff = Math.abs(r - bgR) + Math.abs(g - bgG) + Math.abs(b - bgB);
        if (diff <= 18) {
          continue;
        }
        if (Math.abs(r - 56) < 14 && Math.abs(g - 189) < 18 && Math.abs(b - 248) < 18) {
          continue;
        }
        if (Math.abs(r - 51) < 6 && Math.abs(g - 65) < 6 && Math.abs(b - 85) < 6) {
          continue;
        }
        mask[y * cw + x] = 1;
      }
    }

    let count = 0;
    let sumX = 0;
    let sumY = 0;
    let minX = cw;
    let maxX = 0;
    let minY = ch;
    let maxY = 0;
    let lumaSum = 0;
    let lumaSqSum = 0;
    const colorBuckets = new Set<number>();

    for (let y = 29; y < ch - 7; y++) {
      const rowOff = (oy + y) * stride + 1;
      for (let x = 7; x < cw - 7; x++) {
        if (!mask[y * cw + x]) {
          continue;
        }
        let nb = 0;
        for (let dy = -1; dy <= 1; dy++) {
          for (let dx = -1; dx <= 1; dx++) {
            nb += mask[(y + dy) * cw + (x + dx)];
          }
        }
        if (nb < 7) {
          continue;
        }
        count++;
        sumX += x;
        sumY += y;
        if (x < minX) {
          minX = x;
        }
        if (x > maxX) {
          maxX = x;
        }
        if (y < minY) {
          minY = y;
        }
        if (y > maxY) {
          maxY = y;
        }
        const idx = rowOff + (ox + x) * 4;
        const r = raw[idx];
        const g = raw[idx + 1];
        const b = raw[idx + 2];
        const luma = 0.2126 * r + 0.7152 * g + 0.0722 * b;
        lumaSum += luma;
        lumaSqSum += luma * luma;
        colorBuckets.add(((r >> 4) << 8) | ((g >> 4) << 4) | (b >> 4));
      }
    }

    const totalValid = Math.max(1, (cw - 14) * (ch - 36));
    const occupancy = count / totalValid;
    const meanLuma = count > 0 ? lumaSum / count : 0;
    const lumaStd =
      count > 0 ? Math.sqrt(Math.max(0, lumaSqSum / count - meanLuma * meanLuma)) : 0;

    return {
      occupancy: Number(occupancy.toFixed(4)),
      centroidX: count > 0 ? Number((sumX / count / cw).toFixed(3)) : 0.5,
      centroidY: count > 0 ? Number((sumY / count / ch).toFixed(3)) : 0.5,
      bboxW: count > 0 ? Number(((maxX - minX) / cw).toFixed(3)) : 0,
      bboxH: count > 0 ? Number(((maxY - minY) / ch).toFixed(3)) : 0,
      meanLuma: Number(meanLuma.toFixed(1)),
      lumaStd: Number(lumaStd.toFixed(1)),
      colorBuckets: colorBuckets.size,
    };
  }

  return {
    width,
    height,
    camera: analyzeQuadrant(0, 0),
    front: analyzeQuadrant(cw, 0),
    top: analyzeQuadrant(0, ch),
    iso: analyzeQuadrant(cw, ch),
  };
}

/**
 * Renders a 4-up quad contact sheet PNG (`CAMERA`, `FRONT`, `TOP`, `ISO`) via `three-live-cli render`.
 */
export function runCompilerRender(
  binPath: string,
  scriptPath: string,
  outPngPath: string,
  width = 640,
  height = 640,
): Promise<boolean> {
  return new Promise((resolve) => {
    fs.mkdirSync(path.dirname(outPngPath), {recursive: true});
    execFile(
      binPath,
      [
        'render',
        scriptPath,
        '-o',
        outPngPath,
        '--view=quad',
        '--grid',
        '--annotations',
        '--width',
        String(width),
        '--height',
        String(height),
      ],
      {encoding: 'utf8', maxBuffer: 16 * 1024 * 1024},
      (err) => {
        resolve(!err && fs.existsSync(outPngPath));
      },
    );
  });
}

interface VlmGeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
    };
  }>;
}

interface VlmOpenAIResponse {
  choices?: Array<{
    message?: {content?: string};
  }>;
}

interface VlmAnthropicResponse {
  content?: Array<{text?: string}>;
}

/**
 * Optional multimodal VLM call (`--vlm-judge`) sending the base64 4-up PNG + prompt rubric
 * to Gemini / OpenAI / Anthropic.
 */
export async function callMultimodalVlmJudge(
  pngPath: string,
  promptEntry: PromptEntry | null,
  baseResult: ScriptEvalResult,
  llmConfig: LlmConfig,
): Promise<VlmJudgeScores | null> {
  const {provider, model} = llmConfig;
  const b64 = fs.readFileSync(pngPath).toString('base64');
  const systemPrompt =
    'You are an expert 3D graphics & industrial design visual judge evaluating a 4-up contact sheet (Top-Left: Perspective CAMERA, Top-Right: FRONT +Z elevation with Y=0 floor line, Bottom-Left: TOP +Y plan with camera frustum, Bottom-Right: ISO 45 DEG overview). Respond ONLY with a valid JSON object matching {"semanticMatch":1..5,"spatialCoherence":1..5,"cameraFraming":1..5,"materialAndLighting":1..5,"visualCritique":"..."}.';
  const userPrompt = [
    `Task ID: ${promptEntry?.id ?? baseResult.id} — ${promptEntry?.title ?? baseResult.title}`,
    `Prompt: ${promptEntry?.prompt ?? baseResult.title}`,
    `Scene Telemetry: ${baseResult.meshCount} meshes (${baseResult.visibleMeshCount} visible in camera frustum), ${baseResult.vertexCount} vertices, ${baseResult.materialCount} materials, ${baseResult.lightCount} lights.`,
    '',
    'Grade the 4-up contact sheet on a 1–5 integer scale for each axis:',
    '1. semanticMatch (1-5): Does the 3D assembly contain the requested parts and silhouette?',
    '2. spatialCoherence (1-5): Are components properly aligned, connected, and grounded on y = 0 without floating/detached parts?',
    '3. cameraFraming (1-5): Is the subject clearly visible, centered, and well-proportioned in the CAMERA and ISO viewports?',
    '4. materialAndLighting (1-5): Are materials, colors, and 3D shading gradients distinct and legible?',
    'Return ONLY JSON: {"semanticMatch":5,"spatialCoherence":5,"cameraFraming":5,"materialAndLighting":5,"visualCritique":"..."}',
  ].join('\n');

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY || '';
    const baseUrl =
      process.env.GEMINI_BASE_URL || 'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: systemPrompt}]},
        contents: [
          {
            role: 'user',
            parts: [{inlineData: {mimeType: 'image/png', data: b64}}, {text: userPrompt}],
          },
        ],
        generationConfig: {temperature: 0.1, responseMimeType: 'application/json'},
      }),
    });
    if (!res.ok) {
      throw new Error(`Gemini VLM HTTP ${res.status}`);
    }
    const data = (await res.json()) as VlmGeminiResponse;
    const text = (data.candidates?.[0]?.content?.parts ?? []).map((p) => p.text ?? '').join('\n');
    return JSON.parse(text.replace(/^```json\s*|\s*```$/g, '').trim()) as VlmJudgeScores;
  }

  if (provider === 'openai' || provider === 'ollama') {
    const isOllama = provider === 'ollama';
    const apiKey = process.env.OPENAI_API_KEY || (isOllama ? 'ollama' : '');
    const baseUrl = isOllama
      ? (process.env.OLLAMA_HOST || 'http://localhost:11434') + '/v1'
      : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/chat/completions`, {
      method: 'POST',
      headers: {'Content-Type': 'application/json', Authorization: `Bearer ${apiKey}`},
      body: JSON.stringify({
        model,
        temperature: 0.1,
        messages: [
          {role: 'system', content: systemPrompt},
          {
            role: 'user',
            content: [
              {type: 'image_url', image_url: {url: `data:image/png;base64,${b64}`}},
              {type: 'text', text: userPrompt},
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`${provider} VLM HTTP ${res.status}`);
    }
    const data = (await res.json()) as VlmOpenAIResponse;
    const text = data.choices?.[0]?.message?.content ?? '{}';
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as VlmJudgeScores;
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY || '';
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    const res = await fetch(`${baseUrl.replace(/\/+$/, '')}/messages`, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 1024,
        temperature: 0.1,
        system: systemPrompt,
        messages: [
          {
            role: 'user',
            content: [
              {type: 'image', source: {type: 'base64', media_type: 'image/png', data: b64}},
              {type: 'text', text: userPrompt},
            ],
          },
        ],
      }),
    });
    if (!res.ok) {
      throw new Error(`Anthropic VLM HTTP ${res.status}`);
    }
    const data = (await res.json()) as VlmAnthropicResponse;
    const text = (data.content ?? []).map((b) => b.text ?? '').join('\n');
    const firstBrace = text.indexOf('{');
    const lastBrace = text.lastIndexOf('}');
    return JSON.parse(text.slice(firstBrace, lastBrace + 1)) as VlmJudgeScores;
  }

  return null;
}

/**
 * Evaluates the visual quality of a rendered 4-up contact sheet (`CAMERA`, `FRONT`, `TOP`, `ISO`)
 * across the 4 rubric axes (`semanticMatch`, `spatialCoherence`, `cameraFraming`, `materialAndLighting`)
 * on a 1–5 scale, combining multi-view raster analysis with optional multimodal VLM grading.
 */
export async function evaluateVisualQuality(
  pngPath: string,
  promptEntry: PromptEntry | null,
  baseResult: ScriptEvalResult,
  evalOpts: Partial<CliOptions> = {},
  rootDir = process.cwd(),
): Promise<VisualEvaluation> {
  const raster = analyzeAndCompressQuadPng(pngPath);
  if (!raster) {
    return {
      ran: true,
      pngPath: path.relative(rootDir, pngPath),
      semanticMatch: 1,
      spatialCoherence: 1,
      cameraFraming: 1,
      materialAndLighting: 1,
      overallScore: 1.0,
      visualPass: false,
      visualCritique: 'Failed to render or decode 4-up quad contact sheet PNG.',
      raster: null,
    };
  }

  const critiques: string[] = [];
  const {camera, front, top, iso} = raster;
  const diagCodes = new Set(baseResult.diagnosticCodes ?? []);

  let semanticMatch = 5;
  const viewsPopulated = [camera, front, top, iso].filter((q) => q.occupancy >= 0.0015).length;
  if (viewsPopulated === 0 || !baseResult.compileSucceeded) {
    semanticMatch = 1;
    critiques.push('Rendered contact sheet has 0 visible 3D surfaces across all 4 viewports.');
  } else {
    if (viewsPopulated < 3) {
      semanticMatch -= 2;
      critiques.push(
        `Subject silhouette is only visible in ${viewsPopulated}/4 orthographic/camera views.`,
      );
    } else if (viewsPopulated < 4) {
      semanticMatch -= 1;
    }
    if (
      baseResult.runtimeDrops.noopDrops.length > 0 ||
      baseResult.runtimeDrops.boxGeometryFallbackCount > 0 ||
      baseResult.symbolAnalysis.degradedAliases.length > 0
    ) {
      semanticMatch -= 1;
      critiques.push('Scene uses dropped or degraded Three.js symbols that reduce geometric fidelity.');
    }
    const expLen = (baseResult.expectedFeatures ?? []).length;
    const matchLen = (baseResult.matchedExpectedFeatures ?? []).length;
    if (expLen > 0 && matchLen / expLen < 0.5) {
      semanticMatch -= 1;
      critiques.push(
        `Matched only ${matchLen}/${expLen} expected prompt features (${baseResult.expectedFeatures.join(', ')}).`,
      );
    }
    if (baseResult.meshCount < 2 && baseResult.vertexCount < 90) {
      semanticMatch -= 1;
      critiques.push('Scene has very low geometric part count (< 2 meshes and < 90 vertices).');
    }
  }
  semanticMatch = Math.max(1, Math.min(5, semanticMatch));

  let spatialCoherence = 5;
  if (diagCodes.has('TL301')) {
    spatialCoherence -= 2;
    critiques.push('Scene has degenerate or extreme world bounding box (TL301).');
  }
  if (diagCodes.has('TL304')) {
    spatialCoherence -= 1;
    critiques.push('Assembly is floating above or sunken below the y = 0 ground floor plane (TL304).');
  }
  if (diagCodes.has('TL305')) {
    spatialCoherence -= 1;
    critiques.push('Assembly contains detached outlier meshes far from the main cluster (TL305).');
  }
  if (front.occupancy < 0.004 || iso.occupancy < 0.004) {
    spatialCoherence -= 1;
    critiques.push(
      'Orthographic Front or Isometric 45° viewport has sparse/degenerate silhouette coverage.',
    );
  }
  spatialCoherence = Math.max(1, Math.min(5, spatialCoherence));

  let cameraFraming = 5;
  if (camera.occupancy < 0.0015 || diagCodes.has('TL302')) {
    cameraFraming = 1;
    critiques.push(
      `Camera viewport is nearly empty (occupancy ${(camera.occupancy * 100).toFixed(2)}%); aim camera.lookAt(...) at the scene center.`,
    );
  } else {
    if (camera.occupancy < 0.012) {
      cameraFraming -= 2;
      critiques.push(
        `Subject is too small/distant in the Camera viewport (${(camera.occupancy * 100).toFixed(1)}% occupancy); move camera closer.`,
      );
    } else if (camera.occupancy > 0.88) {
      cameraFraming -= 1;
      critiques.push(
        `Subject fills ${(camera.occupancy * 100).toFixed(1)}% of the Camera viewport and clips viewport borders; pull camera back.`,
      );
    }
    if (baseResult.frustumVisibilityRatio < 0.5) {
      cameraFraming -= 2;
      critiques.push(
        `Only ${(baseResult.frustumVisibilityRatio * 100).toFixed(0)}% of meshes are inside the camera frustum (TL303); pull camera back to ~2.2x scene radius.`,
      );
    } else if (baseResult.frustumVisibilityRatio < 0.85 || diagCodes.has('TL303')) {
      cameraFraming -= 1;
      critiques.push(
        `${baseResult.meshCount - baseResult.visibleMeshCount} mesh(es) fall outside the camera frustum (TL303); widen camera framing.`,
      );
    }
    if (Math.abs(camera.centroidX - 0.5) > 0.34 || Math.abs(camera.centroidY - 0.5) > 0.36) {
      cameraFraming -= 1;
      critiques.push(
        `Subject centroid (${camera.centroidX.toFixed(2)}, ${camera.centroidY.toFixed(2)}) is off-center in the Camera viewport.`,
      );
    }
  }
  cameraFraming = Math.max(1, Math.min(5, cameraFraming));

  let materialAndLighting = 5;
  const maxLumaStd = Math.max(camera.lumaStd, iso.lumaStd, front.lumaStd);
  const maxMeanLuma = Math.max(camera.meanLuma, iso.meanLuma, front.meanLuma);
  const maxColorBuckets = Math.max(camera.colorBuckets, iso.colorBuckets, front.colorBuckets);

  if (maxMeanLuma < 16 || maxMeanLuma > 246) {
    materialAndLighting -= 2;
    critiques.push(
      `Rendered surface luminance (${maxMeanLuma.toFixed(1)}) is ${maxMeanLuma < 16 ? 'too dark/unlit' : 'overexposed'}.`,
    );
  }
  if (maxLumaStd < 6) {
    materialAndLighting -= 2;
    critiques.push(
      `Shading contrast is flat (lumaStd=${maxLumaStd.toFixed(1)}); add directional/point lighting and varied PBR roughness/metalness.`,
    );
  } else if (maxLumaStd < 12) {
    materialAndLighting -= 1;
    critiques.push(`Low 3D shading contrast (lumaStd=${maxLumaStd.toFixed(1)}).`);
  }
  if (maxColorBuckets < 8 && baseResult.materialCount <= 1) {
    materialAndLighting -= 1;
    critiques.push('Monochrome single-material palette; use distinct PBR materials for sub-components.');
  }
  if (baseResult.lightCount < 2 || diagCodes.has('TL307')) {
    materialAndLighting -= 1;
    critiques.push(
      'Scene lacks balanced multi-light studio illumination (AmbientLight + DirectionalLight/PointLight).',
    );
  }
  materialAndLighting = Math.max(1, Math.min(5, materialAndLighting));

  if (evalOpts.vlmJudge) {
    try {
      const llmConfig = resolveLlmConfig(evalOpts);
      if (llmConfig.provider !== 'cmd') {
        const vlm = await callMultimodalVlmJudge(pngPath, promptEntry, baseResult, llmConfig);
        if (vlm && typeof vlm.semanticMatch === 'number') {
          semanticMatch = Math.max(1, Math.min(5, Math.round(vlm.semanticMatch)));
          spatialCoherence = Math.max(1, Math.min(5, Math.round(vlm.spatialCoherence)));
          cameraFraming = Math.max(1, Math.min(5, Math.round(vlm.cameraFraming)));
          materialAndLighting = Math.max(1, Math.min(5, Math.round(vlm.materialAndLighting)));
          if (vlm.visualCritique) {
            critiques.unshift(String(vlm.visualCritique));
          }
        }
      }
    } catch {
      // Fall back cleanly to deterministic multi-view raster judge
    }
  }

  const overallScore = Number(
    ((semanticMatch + spatialCoherence + cameraFraming + materialAndLighting) / 4).toFixed(2),
  );
  const minAxis = Math.min(semanticMatch, spatialCoherence, cameraFraming, materialAndLighting);
  const visualPass = Boolean(overallScore >= 3.75 && minAxis >= 3);

  const result: VisualEvaluation = {
    ran: true,
    pngPath: path.relative(rootDir, pngPath),
    semanticMatch,
    spatialCoherence,
    cameraFraming,
    materialAndLighting,
    overallScore,
    visualPass,
    visualCritique:
      critiques.length > 0
        ? critiques.join(' ')
        : 'All 4 viewports show well-framed, grounded, multi-part geometry with clear PBR shading.',
    raster,
  };

  const judgeJsonPath = pngPath.replace(/\.png$/i, '.judge.json');
  fs.writeFileSync(judgeJsonPath, JSON.stringify(result, null, 2) + '\n', 'utf8');
  return result;
}
