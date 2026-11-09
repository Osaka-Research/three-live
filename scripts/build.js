#!/usr/bin/env node
/**
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

const fs = require('fs');
const path = require('path');
const { execFileSync } = require('child_process');

const ROOT_DIR = path.resolve(__dirname, '..');
const THREE_LIVE_DIR = path.join(ROOT_DIR, 'three-live');
const XR_LIVE_DIR = path.join(ROOT_DIR, 'xr-live');
const DIST_DIR = path.join(ROOT_DIR, 'dist');

let esbuild;
try {
  esbuild = require('esbuild');
} catch (e) {
  // esbuild not available as node module, fallback to binary
}

function resolveEsbuildBinary() {
  if (process.env.ESBUILD_BINARY && fs.existsSync(process.env.ESBUILD_BINARY)) {
    return process.env.ESBUILD_BINARY;
  }
  return 'esbuild';
}
const ESBUILD_BIN = resolveEsbuildBinary();

const FULL_LICENSE_BANNER = `/**
 * @license
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
 */`;

const SPDX_SHORT_BANNER = [
  '/**',
  ' * @license',
  ' * Copyright 2026 Google LLC',
  ' * SPDX-License-' + 'Identifier: Apache-2.0',
  ' */',
].join('\n');

const DEFAULT_DEFINES = {
  'IS_DEV': 'false',
  'ENABLE_NATIVE_HOOKS': 'false',
  'ENABLE_SERVER_EXTRACT': 'false',
  'SECURITY_3D_EXECUTION_CEILING_MS': '250',
  'SECURITY_3D_INTERRUPT_CHECK_OPCODES': '10000',
  'SECURITY_3D_MAX_HEAP_BYTES': '16777216',
  'SECURITY_3D_MAX_VERTICES': '100000',
  'SECURITY_3D_MAX_MESHES': '1000',
  'SECURITY_3D_MAX_INDICES': '300000',
  'SECURITY_3D_MAX_TEXTURES': '16',
  'SECURITY_3D_MAX_TEXTURE_DIMENSION': '2048',
  'SECURITY_3D_SANDBOX_TIMEOUT_MS': '3000',
  'SECURITY_3D_MAX_SCRIPT_BYTES': '1048576',
  'SECURITY_3D_MAX_CONCURRENT_TASKS': '32',
};

const WEBGL_CONSTANTS = {
  ARRAY_BUFFER: 34962,
  BLEND: 3042,
  CLAMP_TO_EDGE: 33071,
  COLOR_ATTACHMENT0: 36064,
  COLOR_BUFFER_BIT: 16384,
  COMPILE_STATUS: 35713,
  DEPTH_ATTACHMENT: 36096,
  DEPTH_BUFFER_BIT: 256,
  DEPTH_COMPONENT16: 33189,
  DEPTH_TEST: 2929,
  DYNAMIC_DRAW: 35048,
  ELEMENT_ARRAY_BUFFER: 34963,
  FLOAT: 5126,
  FRAGMENT_SHADER: 35632,
  FRAMEBUFFER: 36160,
  LINEAR: 9729,
  LINEAR_MIPMAP_LINEAR: 9987,
  LINK_STATUS: 35714,
  NEAREST: 9728,
  ONE_MINUS_SRC_ALPHA: 771,
  RENDERBUFFER: 36161,
  REPEAT: 10497,
  RGBA: 6408,
  RGBA32F: 34836,
  SRC_ALPHA: 770,
  STATIC_DRAW: 35044,
  TEXTURE0: 33984,
  TEXTURE1: 33985,
  TEXTURE2: 33986,
  TEXTURE3: 33987,
  TEXTURE4: 33988,
  TEXTURE5: 33989,
  TEXTURE6: 33990,
  TEXTURE7: 33991,
  TEXTURE8: 33992,
  TEXTURE_2D: 3553,
  TEXTURE_MAG_FILTER: 10240,
  TEXTURE_MIN_FILTER: 10241,
  TEXTURE_WRAP_S: 10242,
  TEXTURE_WRAP_T: 10243,
  TRIANGLES: 4,
  UNSIGNED_BYTE: 5121,
  UNSIGNED_INT: 5125,
  UNSIGNED_SHORT: 5123,
  VERTEX_SHADER: 35633,
};

const WEBGL_REGEX = new RegExp(
  '\\b([a-zA-Z0-9_$]+)\\.(' + Object.keys(WEBGL_CONSTANTS).join('|') + ')\\b',
  'g'
);

function buildTarget(options) {
  const outDir = path.dirname(options.outfile);
  if (!fs.existsSync(outDir)) {
    fs.mkdirSync(outDir, { recursive: true });
  }

  options.define = { ...DEFAULT_DEFINES, ...(options.define || {}) };

  if (!options.banner) {
    options.banner = {js: FULL_LICENSE_BANNER};
  }
  const legalComments = 'none';
  options.legalComments = legalComments;

  if (esbuild) {
    esbuild.buildSync(options);
  } else {
    const args = [options.entryPoints[0]];
    if (options.bundle) args.push('--bundle', '--tree-shaking=true');
    if (options.format) args.push(`--format=${options.format}`);
    if (options.globalName) args.push(`--global-name=${options.globalName}`);
    if (options.minify) args.push('--minify');
    if (options.target) args.push(`--target=${options.target}`);
    if (options.platform) args.push(`--platform=${options.platform}`);
    if (options.outfile) args.push(`--outfile=${options.outfile}`);
    args.push(`--legal-comments=${legalComments}`);
    if (options.banner && options.banner.js) {
      args.push(`--banner:js=${options.banner.js}`);
    }
    if (options.define) {
      for (const [k, v] of Object.entries(options.define)) {
        args.push(`--define:${k}=${v}`);
      }
    }
    execFileSync(ESBUILD_BIN, args, { stdio: 'inherit' });
  }

  // Substitute WebGL constants in minified bundles
  if (options.minify && fs.existsSync(options.outfile)) {
    let code = fs.readFileSync(options.outfile, 'utf8');
    code = code.replace(WEBGL_REGEX, (_, _obj, prop) => String(WEBGL_CONSTANTS[prop]));
    // Fold arithmetic exposed by enum substitution; keep the complete license.
    code = esbuild ?
        esbuild
            .transformSync(
                code,
                {minify: true, target: options.target, legalComments: 'inline'})
            .code :
        execFileSync(
            ESBUILD_BIN,
            [
              '--minify', `--target=${options.target}`,
              '--legal-comments=inline'
            ],
            {input: code, encoding: 'utf8'});
    fs.writeFileSync(options.outfile, code, 'utf8');
  }
}

function buildThreeLive() {
  console.log('--> Building three-live...');
  const tlDist = path.join(THREE_LIVE_DIR, 'dist');

  // 1. three-live standard (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/index.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/index.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/index.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLive',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live.min.js'),
  });

  // 2. ThreeView (ESM & CJS)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-view.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-view.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-view.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-view.cjs'),
  });

  // 3. ThreeAuthor (ESM & CJS)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-author.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-author.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-author.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-author.cjs'),
  });

  // 4. ThreeXR (ESM & CJS)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-xr.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-xr.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-xr.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-xr.cjs'),
  });

  // 5. ThreeConvert (ESM & CJS)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-convert.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false', 'ENABLE_NATIVE_HOOKS': 'false'},
    outfile: path.join(tlDist, 'three-convert.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-convert.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false', 'ENABLE_NATIVE_HOOKS': 'false'},
    outfile: path.join(tlDist, 'three-convert.cjs'),
  });

  // 6. Embedded Engine (IIFE) for Rust compiler
  const engineJs = path.join(tlDist, 'three-author-engine.js');
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-author.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeEngine',
    minify: true,
    target: 'es2020',
    banner: {js: FULL_LICENSE_BANNER},
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'true',
      'ENABLE_SERVER_EXTRACT': 'true',
    },
    outfile: engineJs,
  });

  const compilerAssetsDir = path.join(ROOT_DIR, 'compiler/assets');
  if (!fs.existsSync(compilerAssetsDir)) {
    fs.mkdirSync(compilerAssetsDir, { recursive: true });
  }
  fs.copyFileSync(engineJs, path.join(compilerAssetsDir, 'three-author-engine.min.js'));

  // 7. three-live-element (ESM & CJS)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-live-element.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-element.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/three-live-element.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-element.cjs'),
  });

  // 8. three-live-full (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live-full.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live-full.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveBundle',
    minify: true,
    target: 'es2020',
    define: {
      'IS_DEV': 'false',
      'ENABLE_NATIVE_HOOKS': 'false',
      'ENABLE_SERVER_EXTRACT': 'false',
    },
    outfile: path.join(tlDist, 'three-live-full.min.js'),
  });

  // 9. three-live-viewer (ESM, CJS, IIFE min - ultra-lean without three-xr)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-viewer.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-viewer.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveViewer',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-viewer.min.js'),
  });

  // 10. three-live-studio (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/studio.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-studio.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/studio.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-studio.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/studio.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveStudio',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-studio.min.js'),
  });

  // 10b. three-live-cad (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/cad.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-cad.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/cad.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-cad.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/cad.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveCAD',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-cad.min.js'),
  });

  // 10c. three-live-procedural (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/procedural.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-procedural.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/procedural.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-procedural.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/procedural.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveProcedural',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-procedural.min.js'),
  });

  // 10d. three-live-ai (ESM, CJS, IIFE min): opt-in bring-your-own-LLM editing
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/ai.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-ai.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/ai.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-ai.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/ai.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveAI',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-ai.min.js'),
  });

  // 11. three-live-animation (ESM, CJS, IIFE min)
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/animation.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-animation.js'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/animation.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-animation.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(THREE_LIVE_DIR, 'src/animation.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'ThreeLiveAnimation',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(tlDist, 'three-live-animation.min.js'),
  });

  // Generate type definition stubs in dist
  const rootDts = fs.readFileSync(path.join(ROOT_DIR, 'three-live.d.ts'), 'utf8');
  fs.writeFileSync(path.join(tlDist, 'index.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-view.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-author.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-xr.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-convert.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-element.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-viewer.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-studio.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-cad.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-procedural.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-animation.d.ts'), rootDts);
  fs.writeFileSync(path.join(tlDist, 'three-live-ai.d.ts'), rootDts);

  // Sync to root dist/ and examples
  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, { recursive: true });
  }
  const sandboxHtmlSrc =
      path.join(THREE_LIVE_DIR, 'src/three-live-sandbox.html');
  fs.copyFileSync(sandboxHtmlSrc, path.join(tlDist, 'three-live-sandbox.html'));
  fs.copyFileSync(
      sandboxHtmlSrc, path.join(DIST_DIR, 'three-live-sandbox.html'));
  const cliLauncherSrc = path.join(ROOT_DIR, 'bin/three-live-cli.js');
  if (fs.existsSync(cliLauncherSrc)) {
    const cliLauncherDst = path.join(tlDist, 'three-live-cli.js');
    fs.copyFileSync(cliLauncherSrc, cliLauncherDst);
    try {
      fs.chmodSync(cliLauncherDst, 0o755);
    } catch (_) {
    }
  }
  fs.copyFileSync(
      path.join(tlDist, 'three-live.min.js'),
      path.join(DIST_DIR, 'three-live.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-viewer.min.js'),
      path.join(DIST_DIR, 'three-live-viewer.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-studio.min.js'),
      path.join(DIST_DIR, 'three-live-studio.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-cad.min.js'),
      path.join(DIST_DIR, 'three-live-cad.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-procedural.min.js'),
      path.join(DIST_DIR, 'three-live-procedural.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-animation.min.js'),
      path.join(DIST_DIR, 'three-live-animation.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-ai.min.js'),
      path.join(DIST_DIR, 'three-live-ai.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-full.min.js'),
      path.join(DIST_DIR, 'three-live-full.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live.min.js'),
      path.join(THREE_LIVE_DIR, 'examples/three-live.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-studio.min.js'),
      path.join(THREE_LIVE_DIR, 'examples/three-live-studio.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-cad.min.js'),
      path.join(THREE_LIVE_DIR, 'examples/three-live-cad.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-animation.min.js'),
      path.join(THREE_LIVE_DIR, 'examples/three-live-animation.min.js'));
  fs.copyFileSync(
      sandboxHtmlSrc,
      path.join(THREE_LIVE_DIR, 'examples/three-live-sandbox.html'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live.min.js'),
      path.join(ROOT_DIR, 'examples/three/three-live.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-studio.min.js'),
      path.join(ROOT_DIR, 'examples/three/three-live-studio.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-cad.min.js'),
      path.join(ROOT_DIR, 'examples/three/three-live-cad.min.js'));
  fs.copyFileSync(
      path.join(tlDist, 'three-live-animation.min.js'),
      path.join(ROOT_DIR, 'examples/three/three-live-animation.min.js'));
  fs.copyFileSync(
      sandboxHtmlSrc,
      path.join(ROOT_DIR, 'examples/three/three-live-sandbox.html'));

  try {
    fs.mkdirSync('/tmp/three-live-cache', { recursive: true });
    fs.copyFileSync(
        path.join(tlDist, 'three-live.min.js'),
        '/tmp/three-live-cache/three-live.js');
  } catch (e) {
    // Ignore /tmp write errors if any
  }
}

function buildXRLive() {
  console.log('--> Building xr-live...');
  const xrDist = path.join(XR_LIVE_DIR, 'dist');

  // 1. xr-live (Standard <xr-live> with Three.js authoring)
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/bundle.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live.js'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/bundle.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/bundle.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'XRLive',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live.min.js'),
  });

  // 2. xr-live-viewer (Lean .glb/.usdz WebXR viewer without Three.js script
  // compiler)
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-viewer.js'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-viewer.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/viewer.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'XRLiveViewer',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-viewer.min.js'),
  });

  // 3. xr-live-sensors (Hardware XR Sensors, Simulator & WebMCP Plugin)
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/sensors.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-sensors.js'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/sensors.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-sensors.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/sensors.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'XRLiveSensors',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-sensors.min.js'),
  });

  // 4. xr-live-spatial (optional spatial UX, world-understanding, splats & AI
  // plugins)
  for (const [format, ext] of [['esm', 'js'], ['cjs', 'cjs'], ['iife', 'min.js']]) {
    buildTarget({
      entryPoints: [path.join(XR_LIVE_DIR, 'src/plugins/index.ts')],
      bundle: true,
      format,
      ...(format === 'iife' ? {globalName: 'XRLiveSpatial'} : {}),
      minify: true,
      target: 'es2020',
      define: {'IS_DEV': 'false'},
      outfile: path.join(xrDist, `xr-live-spatial.${ext}`),
    });
  }

  // 4b. xr-live-sim (optional simulation plugins: character-controller,
  // steering-agents, hit-zones, objectives, synth-audio)
  for (const [format, ext] of [
           ['esm', 'js'], ['cjs', 'cjs'], ['iife', 'min.js']]) {
    buildTarget({
      entryPoints: [path.join(XR_LIVE_DIR, 'src/sim/index.ts')],
      bundle: true,
      format,
      ...(format === 'iife' ? {globalName: 'XRSim'} : {}),
      minify: true,
      target: 'es2020',
      define: {'IS_DEV': 'false'},
      outfile: path.join(xrDist, `xr-live-sim.${ext}`),
    });
  }

  // 5. xr-live-full (All-in-One Kitchen Sink)
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'esm',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-full.js'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'cjs',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-full.cjs'),
  });
  buildTarget({
    entryPoints: [path.join(XR_LIVE_DIR, 'src/full.ts')],
    bundle: true,
    format: 'iife',
    globalName: 'XRLiveFull',
    minify: true,
    target: 'es2020',
    define: {'IS_DEV': 'false'},
    outfile: path.join(xrDist, 'xr-live-full.min.js'),
  });

  const rootDts =
      fs.readFileSync(path.join(ROOT_DIR, 'three-live.d.ts'), 'utf8');
  fs.writeFileSync(path.join(xrDist, 'index.d.ts'), rootDts);
  fs.writeFileSync(path.join(xrDist, 'xr-live-viewer.d.ts'), rootDts);
  fs.writeFileSync(path.join(xrDist, 'xr-live-sensors.d.ts'), rootDts);
  fs.writeFileSync(path.join(xrDist, 'xr-live-full.d.ts'), rootDts);
  fs.writeFileSync(path.join(xrDist, 'xr-live-spatial.d.ts'), rootDts);
  fs.writeFileSync(path.join(xrDist, 'xr-live-sim.d.ts'), rootDts);

  if (!fs.existsSync(DIST_DIR)) {
    fs.mkdirSync(DIST_DIR, {recursive: true});
  }
  fs.copyFileSync(
      path.join(xrDist, 'xr-live.min.js'),
      path.join(DIST_DIR, 'xr-live.min.js'));
  fs.copyFileSync(
      path.join(xrDist, 'xr-live-viewer.min.js'),
      path.join(DIST_DIR, 'xr-live-viewer.min.js'));
  fs.copyFileSync(
      path.join(xrDist, 'xr-live-sensors.min.js'),
      path.join(DIST_DIR, 'xr-live-sensors.min.js'));
  fs.copyFileSync(
      path.join(xrDist, 'xr-live-full.min.js'),
      path.join(DIST_DIR, 'xr-live-full.min.js'));
  fs.copyFileSync(
      path.join(xrDist, 'xr-live-spatial.min.js'),
      path.join(DIST_DIR, 'xr-live-spatial.min.js'));
  fs.copyFileSync(
      path.join(xrDist, 'xr-live-sim.min.js'),
      path.join(DIST_DIR, 'xr-live-sim.min.js'));

  const sandboxHtmlSrc =
      path.join(THREE_LIVE_DIR, 'src/three-live-sandbox.html');
  fs.copyFileSync(sandboxHtmlSrc, path.join(xrDist, 'three-live-sandbox.html'));

  const xrExampleDir = path.join(ROOT_DIR, 'examples/xr');
  if (fs.existsSync(xrExampleDir)) {
    fs.copyFileSync(
        path.join(xrDist, 'xr-live.min.js'),
        path.join(xrExampleDir, 'xr-live.min.js'));
    fs.copyFileSync(
        path.join(xrDist, 'xr-live-sensors.min.js'),
        path.join(xrExampleDir, 'xr-live-sensors.min.js'));
    fs.copyFileSync(
        path.join(xrDist, 'xr-live-spatial.min.js'),
        path.join(xrExampleDir, 'xr-live-spatial.min.js'));
    fs.copyFileSync(
        path.join(xrDist, 'xr-live-sim.min.js'),
        path.join(xrExampleDir, 'xr-live-sim.min.js'));
    fs.copyFileSync(
        path.join(DIST_DIR, 'three-live-studio.min.js'),
        path.join(xrExampleDir, 'three-live-studio.min.js'));
    fs.copyFileSync(
        path.join(DIST_DIR, 'three-live-cad.min.js'),
        path.join(xrExampleDir, 'three-live-cad.min.js'));
    fs.copyFileSync(
        path.join(DIST_DIR, 'three-live-animation.min.js'),
        path.join(xrExampleDir, 'three-live-animation.min.js'));
    fs.copyFileSync(
        sandboxHtmlSrc, path.join(xrExampleDir, 'three-live-sandbox.html'));
  }
}

/**
 * Stamps the gzipped size of the bundles each demo loads into the hub page and
 * the demo pages, so every page shows the same, current number.
 */
function stampDemoSizes() {
  const {stampBundleSizes} = require('./stamp_bundle_sizes');
  stampBundleSizes(
      {
        'three-live.min.js': path.join(DIST_DIR, 'three-live.min.js'),
        'xr-live.min.js': path.join(DIST_DIR, 'xr-live.min.js'),
      },
      [
        path.join(ROOT_DIR, 'examples/index.html'),
        path.join(ROOT_DIR, 'examples/three/index.html'),
        path.join(ROOT_DIR, 'examples/xr/index.html'),
        path.join(THREE_LIVE_DIR, 'examples/index.html'),
      ]);
}

/**
 * Prints raw and gzipped sizes for every published bundle and enforces the
 * gzip budgets. The README lists these same budgets as `< N KB gz` ceilings,
 * so exceeding one fails the build rather than letting the docs go stale.
 * Keep `budgetKb` in sync with the README bundle tables.
 */
function reportSizes() {
  const zlib = require('zlib');
  console.log('\n============================= Bundle Size Report =============================');
  console.log('Asset                                      Raw Size     Gzip Size     Budget');
  console.log('------------------------------------------------------------------------------');
  const files = [
    {name: 'three-live-viewer.min.js', budgetKb: '30'},
    {name: 'three-live.min.js', budgetKb: '72'},
    {name: 'three-live-studio.min.js', budgetKb: '29'},
    {name: 'three-live-cad.min.js', budgetKb: '10'},
    {name: 'three-live-procedural.min.js', budgetKb: '28'},
    {name: 'three-live-animation.min.js', budgetKb: '11'},
    {name: 'three-live-ai.min.js', budgetKb: '10'},
    {name: 'three-live-full.min.js', budgetKb: '151'},
    {name: 'xr-live-viewer.min.js', budgetKb: '54'},
    {name: 'xr-live.min.js', budgetKb: '84'},
    {name: 'xr-live-sensors.min.js', budgetKb: '10'},
    {name: 'xr-live-spatial.min.js', budgetKb: '63'},
    {name: 'xr-live-sim.min.js', budgetKb: '30'},
    {name: 'xr-live-full.min.js', budgetKb: '251'},
  ];
  const failures = [];
  for (const f of files) {
    const filePath = path.join(DIST_DIR, f.name);
    const label = `dist/${f.name}`;
    // Kept as a string so the label matches the README text exactly.
    const budgetLabel = `< ${f.budgetKb} KB gz`;
    if (!fs.existsSync(filePath)) {
      console.log(`${label.padEnd(42)} ${'MISSING'.padStart(9)}     ${''.padStart(9)}     ${budgetLabel}`);
      failures.push(`${label} was not built`);
      continue;
    }
    const raw = fs.readFileSync(filePath);
    const gz = zlib.gzipSync(raw, {level: 9});
    const gzKbValue = gz.length / 1024;
    const rawKb = (raw.length / 1024).toFixed(1).padStart(6) + ' KB';
    const gzKb = gzKbValue.toFixed(1).padStart(6) + ' KB';
    const overBudget = gzKbValue >= parseFloat(f.budgetKb);
    console.log(
        `${label.padEnd(42)} ${rawKb}     ${gzKb}     ${budgetLabel}` +
        (overBudget ? '  OVER BUDGET' : ''));
    if (overBudget) {
      failures.push(
          `${label} is ${gzKbValue.toFixed(1)} KB gz (budget ${budgetLabel})`);
    }
  }
  console.log('==============================================================================\n');
  // <three-live> never requests WebXR depth, so its bundles must not carry the
  // depth-occlusion shader (installed only by <xr-live>).
  for (const name
           of ['three-live-viewer.min.js',
               'three-live.min.js',
               'three-live-full.min.js',
  ]) {
    const filePath = path.join(DIST_DIR, name);
    if (fs.existsSync(filePath) &&
        fs.readFileSync(filePath, 'utf8').includes('uXrDepthTex')) {
      failures.push(`dist/${name} unexpectedly bundles WebXR depth occlusion`);
    }
  }
  if (failures.length > 0) {
    console.error('Bundle size budget check failed:');
    for (const failure of failures) {
      console.error(`  - ${failure}`);
    }
    console.error(
        'Reduce the bundle size, or raise the budget in scripts/build.js ' +
        'and the README bundle tables together.');
    process.exit(1);
  }
}

function runTestFile(entryPoint, outfile) {
  buildTarget({
    entryPoints: [entryPoint],
    bundle: true,
    platform: 'node',
    format: 'cjs',
    minify: false,
    outfile,
  });
  console.log(`--> Running test: ${path.relative(ROOT_DIR, entryPoint)}`);
  execFileSync(process.execPath, [outfile], { stdio: 'inherit' });
}

function testThreeLive() {
  console.log('--> Testing three-live...');
  const testDir = path.join(THREE_LIVE_DIR, 'tests');
  const outDir = path.join(THREE_LIVE_DIR, 'dist/tests');
  const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('_test.ts'));
  for (const file of testFiles) {
    runTestFile(
      path.join(testDir, file),
      path.join(outDir, file.replace(/\.ts$/, '.cjs'))
    );
  }
}

function testXRLive() {
  console.log('--> Testing xr-live...');
  const testDir = path.join(XR_LIVE_DIR, 'tests');
  const outDir = path.join(XR_LIVE_DIR, 'dist/tests');
  const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('_test.ts'));
  for (const file of testFiles) {
    runTestFile(
      path.join(testDir, file),
      path.join(outDir, file.replace(/\.ts$/, '.cjs'))
    );
  }
}

function testEvals() {
  const testDir = path.join(ROOT_DIR, 'evals', 'tests');
  if (!fs.existsSync(testDir)) return;
  console.log('--> Testing evals...');
  const outDir = path.join(THREE_LIVE_DIR, 'dist/tests');
  const testFiles = fs.readdirSync(testDir).filter((f) => f.endsWith('_test.ts'));
  for (const file of testFiles) {
    runTestFile(
      path.join(testDir, file),
      path.join(outDir, file.replace(/\.ts$/, '.cjs'))
    );
  }
}

const args = process.argv.slice(2);
if (args.includes('--test-three-live') || args.includes('--test-core')) {
  testThreeLive();
} else if (args.includes('--test-xr-live')) {
  testXRLive();
} else if (args.includes('--test-evals')) {
  testEvals();
} else if (args.includes('--test')) {
  testThreeLive();
  testXRLive();
  testEvals();
} else if (args.includes('--three-live') || args.includes('--core')) {
  buildThreeLive();
} else if (args.includes('--xr-live')) {
  buildXRLive();
} else {
  buildThreeLive();
  buildXRLive();
  stampDemoSizes();
  if (fs.existsSync(path.join(ROOT_DIR, 'scripts', 'build_llms_txt.js'))) {
    require('./build_llms_txt').generateLlmsFiles();
  }
  reportSizes();
  console.log(
      '=== Successfully built all three-live and xr-live JS/TS packages! ===');
}
