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

/** Compile and link a program, releasing temporary shaders on every path. */
export function createProgram(
  gl: WebGL2RenderingContext,
  vsSrc: string,
  fsSrc: string,
  diagnostic = true,
): WebGLProgram | null {
  const shaders: WebGLShader[] = [];
  let program: WebGLProgram | null = null;
  try {
    for (const [type, source] of [[gl.VERTEX_SHADER, vsSrc], [gl.FRAGMENT_SHADER, fsSrc]] as const) {
      const shader = gl.createShader(type);
      if (!shader) {
        if (diagnostic) throw new Error('Shader allocation failed');
        return null;
      }
      shaders.push(shader);
      gl.shaderSource(shader, source);
      gl.compileShader(shader);
      // Lightweight headless contexts may omit status queries.
      if (gl.getShaderParameter && !gl.getShaderParameter(shader, gl.COMPILE_STATUS)) {
        if (diagnostic) throw new Error(`Shader compile error: ${gl.getShaderInfoLog(shader)}`);
        return null;
      }
    }
    program = gl.createProgram();
    if (!program) {
      if (diagnostic) throw new Error('Program allocation failed');
      return null;
    }
    for (const shader of shaders) gl.attachShader(program, shader);
    gl.linkProgram(program);
    if (gl.getProgramParameter && !gl.getProgramParameter(program, gl.LINK_STATUS)) {
      const err = diagnostic ? gl.getProgramInfoLog(program) : null;
      gl.deleteProgram?.(program);
      program = null;
      if (diagnostic) throw new Error(`Program link error: ${err}`);
      return null;
    }
    return program;
  } finally {
    for (const shader of shaders) {
      if (program) gl.detachShader?.(program, shader);
      gl.deleteShader?.(shader);
    }
  }
}
