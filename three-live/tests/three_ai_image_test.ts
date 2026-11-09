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

import {createAIChatProvider} from '../src/plugins/ai';
import {
  type AISpatialPlane,
  type AISpatialObject,
  type AISpatialPriors,
  buildImageMessages,
  buildImageUserText,
  formatSpatialPriors,
  IMAGE_SYSTEM_PROMPT,
  imageRepairMessage,
  isAllowedImageUrl,
  MAX_IMAGE_PROMPT_CHARS,
  MAX_PRIOR_LABEL_CHARS,
  MAX_PRIOR_OBJECTS,
  MAX_PRIOR_PLANES,
} from '../src/plugins/ai-image';
import fixture from './fixtures/image_cases.json';

let passed = 0;
let failed = 0;

function assert(condition: boolean, testName: string): void {
  if (condition) {
    console.log(`   ✅ [PASS] ${testName}`);
    passed++;
  } else {
    console.error(`   ❌ [FAIL] ${testName}`);
    failed++;
  }
}

async function runTests(): Promise<void> {
  console.log('=== Running three_ai_image_test.ts (Phase 4a) ===');

  // 1. Shared fixture cases (`priors`, `messages`, `repairs`)
  for (const c of fixture.priors) {
    const got = formatSpatialPriors(c.priors as unknown as AISpatialPriors | null);
    assert(
      got === c.expected,
      `fixture priors case '${c.name}' matches expected output`,
    );
  }

  for (const c of fixture.messages) {
    const msgs = buildImageMessages(
      c.imageUrl,
      c.prompt,
      c.priors as unknown as AISpatialPriors | null,
    );
    assert(msgs.length === 2, `fixture messages '${c.name}' has 2 messages`);
    assert(
      msgs[0].role === 'system' && msgs[0].content === IMAGE_SYSTEM_PROMPT,
      `fixture messages '${c.name}' system prompt matches IMAGE_SYSTEM_PROMPT`,
    );
    const content = msgs[1].content;
    const isArray = Array.isArray(content) && content.length === 2;
    assert(isArray, `fixture messages '${c.name}' user content is 2-part array`);
    if (Array.isArray(content)) {
      const part0 = content[0];
      const part1 = content[1];
      assert(
        part0.type === 'image_url' && part0.image_url.url === c.imageUrl,
        `fixture messages '${c.name}' image_url part matches`,
      );
      assert(
        part1.type === 'text' && part1.text === c.expectedUserText,
        `fixture messages '${c.name}' text part matches expectedUserText`,
      );
    }
  }

  for (const c of fixture.repairs) {
    const got = imageRepairMessage(c.error, c.warnings);
    assert(
      got === c.expected,
      `fixture repairs case '${c.name}' matches expected output`,
    );
  }

  // 2. URL validation (`isAllowedImageUrl`)
  assert(
    isAllowedImageUrl('data:image/png;base64,iVBORw0KGgo='),
    'isAllowedImageUrl accepts base64 PNG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/jpeg;base64,/9j/4AAQ'),
    'isAllowedImageUrl accepts base64 JPEG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/jpg;base64,/9j/4AAQ'),
    'isAllowedImageUrl accepts base64 JPG data URI',
  );
  assert(
    isAllowedImageUrl('data:image/webp;base64,UklGRg=='),
    'isAllowedImageUrl accepts base64 WebP data URI',
  );
  assert(
    isAllowedImageUrl('https://example.com/photo.jpg'),
    'isAllowedImageUrl accepts https:// URL',
  );
  assert(
    isAllowedImageUrl('http://localhost:8080/photo.jpg'),
    'isAllowedImageUrl accepts http://localhost URL',
  );
  assert(
    isAllowedImageUrl('http://127.0.0.1:11434/img.png'),
    'isAllowedImageUrl accepts http://127.0.0.1 URL',
  );
  assert(
    isAllowedImageUrl('http://[::1]:8000/img.png'),
    'isAllowedImageUrl accepts http://[::1] URL',
  );
  assert(!isAllowedImageUrl(''), 'isAllowedImageUrl rejects empty string');
  assert(
    !isAllowedImageUrl('http://example.com/photo.jpg'),
    'isAllowedImageUrl rejects non-loopback http:// URL',
  );
  assert(
    !isAllowedImageUrl('javascript:alert(1)'),
    'isAllowedImageUrl rejects javascript: URI',
  );
  assert(
    !isAllowedImageUrl('data:text/html;base64,PHNjcmlwdD4='),
    'isAllowedImageUrl rejects non-image data: URI',
  );
  assert(
    !isAllowedImageUrl('data:image/png;base64,not valid base64!!!'),
    'isAllowedImageUrl rejects invalid base64 payload',
  );

  let threwOnBadUrl = false;
  try {
    buildImageMessages('http://insecure.example.com/a.png');
  } catch {
    threwOnBadUrl = true;
  }
  assert(threwOnBadUrl, 'buildImageMessages throws on disallowed imageUrl');

  // 3. Edge cases: truncation & negative-zero normalization
  const manyPlanes: AISpatialPlane[] = Array.from({length: 40}, (_, i) => ({
    label: `plane_${i}_${'x'.repeat(100)}`,
    orientation: i % 2 === 0 ? 'horizontal' : 'vertical',
    center: [-0, i * 0.1, -0.00001],
  }));
  const manyObjects: AISpatialObject[] = Array.from({length: 40}, (_, i) => ({
    label: `obj_${i}`,
    center: [i, 0, -0],
    yawDeg: -0,
  }));
  const priorsBlock = formatSpatialPriors({
    floorY: -0,
    planes: manyPlanes,
    objects: manyObjects,
  });
  assert(
    priorsBlock.includes('- Floor height: y = 0.00 m'),
    'formatSpatialPriors normalizes -0 floorY to 0.00',
  );
  assert(
    priorsBlock.includes(`  ${MAX_PRIOR_PLANES}. `) &&
      !priorsBlock.includes(`  ${MAX_PRIOR_PLANES + 1}. `),
    `formatSpatialPriors caps planes at ${MAX_PRIOR_PLANES}`,
  );
  assert(
    priorsBlock.includes(`  ${MAX_PRIOR_OBJECTS}. "obj_${MAX_PRIOR_OBJECTS - 1}"`) &&
      !priorsBlock.includes(`"obj_${MAX_PRIOR_OBJECTS}"`),
    `formatSpatialPriors caps objects at ${MAX_PRIOR_OBJECTS}`,
  );
  const firstPlaneMatch = priorsBlock.match(/1\. horizontal "([^"]+)"/);
  assert(
    firstPlaneMatch !== null &&
      firstPlaneMatch[1].length === MAX_PRIOR_LABEL_CHARS,
    `formatSpatialPriors caps plane label at ${MAX_PRIOR_LABEL_CHARS} chars`,
  );
  assert(
    priorsBlock.includes('yaw 0 deg') && !priorsBlock.includes('-0'),
    'formatSpatialPriors never emits -0 in coordinates or yaw',
  );

  const longPrompt = 'p'.repeat(MAX_IMAGE_PROMPT_CHARS + 500);
  const userText = buildImageUserText(longPrompt, null);
  assert(
    userText.includes(`Additional instructions: ${'p'.repeat(MAX_IMAGE_PROMPT_CHARS)}\n`) &&
      !userText.includes('p'.repeat(MAX_IMAGE_PROMPT_CHARS + 1)),
    `buildImageUserText truncates prompt at ${MAX_IMAGE_PROMPT_CHARS} chars`,
  );

  // 4. Multimodal AIChatMessage serialization in createAIChatProvider
  let capturedBody: any = null;
  const provider = createAIChatProvider({
    endpoint: 'https://api.example.com/v1/chat/completions',
    model: 'gemini-2.5-flash',
    apiKey: 'test-key',
    fetch: (async (_url: string, init?: RequestInit) => {
      capturedBody = JSON.parse(String(init?.body ?? '{}'));
      return {
        ok: true,
        status: 200,
        text: async () =>
          JSON.stringify({
            choices: [{message: {content: '```js\nscene.add(m);\n```'}}],
          }),
      } as unknown as Response;
    }) as typeof fetch,
  });
  const multimodalMessages = buildImageMessages(
    'data:image/png;base64,iVBORw0KGgo=',
    'modern oak desk',
    {floorY: 0},
  );
  const reply = await provider.complete({messages: multimodalMessages});
  assert(
    reply.includes('scene.add(m);'),
    'createAIChatProvider returns completion for multimodal messages',
  );
  assert(
    Array.isArray(capturedBody?.messages?.[1]?.content) &&
      capturedBody.messages[1].content[0].type === 'image_url' &&
      capturedBody.messages[1].content[0].image_url.url ===
        'data:image/png;base64,iVBORw0KGgo=' &&
      capturedBody.messages[1].content[1].type === 'text',
    'createAIChatProvider serializes multimodal content array verbatim in JSON body',
  );

  console.log(`\nResults: ${passed} passed, ${failed} failed.`);
  if (failed > 0) {
    process.exit(1);
  }
}

runTests().catch((err) => {
  console.error(err);
  process.exit(1);
});
