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

import {strict as assert} from 'node:assert';
import {createProgram} from '../src/gl-program';

function mock(options: {allocation?: number; program?: boolean; compile?: boolean; link?: boolean; permissive?: boolean} = {}) {
  const shaders: object[] = [];
  const deleted: object[] = [];
  const detached: object[] = [];
  let programsDeleted = 0;
  let allocations = 0;
  const gl = {
    VERTEX_SHADER: 1, FRAGMENT_SHADER: 2, COMPILE_STATUS: 3, LINK_STATUS: 4,
    createShader: () => ++allocations === options.allocation ? null : (shaders.push({}), shaders[shaders.length - 1]),
    shaderSource: () => {}, compileShader: () => {},
    getShaderParameter: options.permissive ? undefined : () => options.compile !== false,
    getShaderInfoLog: () => 'compile detail',
    createProgram: () => options.program === false ? null : {},
    attachShader: () => {}, linkProgram: () => {},
    getProgramParameter: options.permissive ? undefined : () => options.link !== false,
    getProgramInfoLog: () => 'link detail',
    deleteProgram: () => programsDeleted++,
    detachShader: (_: unknown, shader: object) => { assert.equal(programsDeleted, 0); detached.push(shader); },
    deleteShader: (shader: object) => deleted.push(shader),
  } as unknown as WebGL2RenderingContext;
  return {gl, shaders, deleted, detached, deletedPrograms: () => programsDeleted};
}

for (const permissive of [false, true]) {
  const m = mock({permissive});
  assert.ok(createProgram(m.gl, 'vertex', 'fragment', !permissive));
  assert.equal(m.shaders.length, 2);
  assert.deepEqual(m.deleted, m.shaders);
  assert.deepEqual(m.detached, m.shaders);
}
for (const options of [{allocation: 1}, {allocation: 2}, {program: false}, {compile: false}, {link: false}]) {
  for (const diagnostic of [false, true]) {
    const m = mock(options);
    if (diagnostic) assert.throws(() => createProgram(m.gl, 'vertex', 'fragment'));
    else assert.equal(createProgram(m.gl, 'vertex', 'fragment', false), null);
    assert.deepEqual(m.deleted, m.shaders, JSON.stringify(options));
    assert.equal(m.deletedPrograms(), options.link === false ? 1 : 0);
  }
}
for (const [options, message] of [[{compile: false}, 'Shader compile error: compile detail'], [{link: false}, 'Program link error: link detail']] as const) {
  const m = mock(options);
  assert.throws(() => createProgram(m.gl, 'vertex', 'fragment'), {message});
}
console.log('PASS: shared GL program diagnostics, graceful failures, allocation failures, cleanup, and permissive mocks');
