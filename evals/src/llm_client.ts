/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

import {spawn} from 'child_process';
import * as fs from 'fs';
import type {CliOptions, LlmConfig, PromptPair} from './types.ts';

/**
 * Extracts pure JavaScript source code from an LLM response string.
 */
export function extractJsCode(rawText: string): string {
  if (!rawText || typeof rawText !== 'string') {
    return '';
  }
  const trimmed = rawText.trim();
  const fenceRegex = /```(?:javascript|js|ts|typescript)?\s*\n([\s\S]*?)```/gi;
  const matches: string[] = [];
  let match: RegExpExecArray | null = null;
  while ((match = fenceRegex.exec(trimmed)) !== null) {
    if (match[1] && match[1].trim()) {
      matches.push(match[1].trim());
    }
  }
  if (matches.length > 0) {
    matches.sort((a, b) => b.length - a.length);
    return matches[0] + '\n';
  }
  return trimmed.replace(/^`+|`+$/g, '').trim() + '\n';
}

/**
 * Resolves the active LLM provider configuration from CLI flags and environment variables.
 */
export function resolveLlmConfig(options: Partial<CliOptions>): LlmConfig {
  let provider = options.provider ?? null;
  let cmd = options.cmd ?? null;
  const googleGeminiCli = '/google/bin/releases/gemini-cli/tools/gemini';
  if (provider === 'gemini-cli') {
    provider = 'cmd';
    if (!cmd) {
      cmd = fs.existsSync(googleGeminiCli)
        ? `${googleGeminiCli} -p "Generate the requested JavaScript code block from stdin."`
        : 'gemini -p "Generate the requested JavaScript code block from stdin."';
    }
  }
  if (!provider) {
    if (cmd) {
      provider = 'cmd';
    } else if (process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY) {
      provider = 'gemini';
    } else if (process.env.OPENAI_API_KEY) {
      provider = 'openai';
    } else if (process.env.ANTHROPIC_API_KEY) {
      provider = 'anthropic';
    } else if (process.env.OLLAMA_HOST) {
      provider = 'ollama';
    } else if (fs.existsSync(googleGeminiCli)) {
      provider = 'cmd';
      cmd = `${googleGeminiCli} -p "Generate the requested JavaScript code block from stdin."`;
    }
  }

  if (!provider) {
    throw new Error(
      'No LLM provider configured for --generate / --repair.\n' +
        'Set one of the following:\n' +
        '  1. Gemini API:      GEMINI_API_KEY=... node evals/run_evals.ts --generate --provider=gemini\n' +
        '  2. OpenAI / Compat: OPENAI_API_KEY=... node evals/run_evals.ts --generate --provider=openai\n' +
        '  3. Anthropic API:   ANTHROPIC_API_KEY=... node evals/run_evals.ts --generate --provider=anthropic\n' +
        '  4. Local Ollama:    node evals/run_evals.ts --generate --provider=ollama --model=qwen2.5-coder:32b\n' +
        '  5. Any CLI Command: node evals/run_evals.ts --generate --cmd="gemini -p"\n' +
        'Or run without --generate to evaluate existing scripts (e.g. `node evals/run_evals.ts --arm=smoke`).',
    );
  }

  const defaultModels: Record<string, string> = {
    gemini: 'gemini-2.5-flash',
    openai: 'gpt-4o',
    anthropic: 'claude-3-7-sonnet-latest',
    ollama: 'qwen2.5-coder:14b',
    cmd: 'custom-cli',
  };

  return {
    provider,
    model: options.model || defaultModels[provider] || 'default',
    cmd,
    temperature: options.temperature ?? 0.2,
  };
}

interface GeminiResponse {
  candidates?: Array<{
    content?: {
      parts?: Array<{text?: string}>;
    };
  }>;
}

interface OpenAIChatResponse {
  choices?: Array<{
    message?: {content?: string};
  }>;
}

interface AnthropicResponse {
  content?: Array<{text?: string}>;
}

/**
 * Calls the configured LLM provider and returns the extracted JavaScript code.
 */
export async function callLlm(prompts: PromptPair, llmConfig: LlmConfig): Promise<string> {
  const {systemPrompt, userPrompt} = prompts;
  const {provider, model, cmd, temperature} = llmConfig;

  if (provider === 'cmd') {
    if (!cmd) {
      throw new Error('--provider=cmd requires --cmd="<shell command>"');
    }
    const combinedPrompt = `${systemPrompt}\n\n---\n\n${userPrompt}\n`;
    const rawOut = await new Promise<string>((resolve, reject) => {
      const child = spawn(cmd, {
        shell: true,
        stdio: ['pipe', 'pipe', 'pipe'],
      });
      let stdout = '';
      let stderr = '';
      child.stdout.on('data', (chunk: Buffer) => {
        stdout += chunk.toString();
      });
      child.stderr.on('data', (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      child.on('error', reject);
      child.on('close', (code: number | null) => {
        if (code !== 0) {
          reject(
            new Error(
              `Command "${cmd}" exited with code ${code}: ${stderr.slice(0, 500)}`,
            ),
          );
        } else {
          resolve(stdout);
        }
      });
      child.stdin.write(combinedPrompt);
      child.stdin.end();
    });
    return extractJsCode(rawOut);
  }

  if (provider === 'gemini') {
    const apiKey = process.env.GEMINI_API_KEY || process.env.GOOGLE_API_KEY;
    if (!apiKey) {
      throw new Error('Missing GEMINI_API_KEY or GOOGLE_API_KEY environment variable.');
    }
    const baseUrl =
      process.env.GEMINI_BASE_URL ||
      'https://generativelanguage.googleapis.com/v1beta';
    const url = `${baseUrl}/models/${encodeURIComponent(model)}:generateContent?key=${encodeURIComponent(apiKey)}`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {'Content-Type': 'application/json'},
      body: JSON.stringify({
        systemInstruction: {parts: [{text: systemPrompt}]},
        contents: [{role: 'user', parts: [{text: userPrompt}]}],
        generationConfig: {
          temperature,
          maxOutputTokens: 8192,
        },
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Gemini API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = (await res.json()) as GeminiResponse;
    const parts = data.candidates?.[0]?.content?.parts ?? [];
    const text = parts.map((p) => p.text ?? '').join('\n');
    return extractJsCode(text);
  }

  if (provider === 'openai' || provider === 'ollama') {
    const isOllama = provider === 'ollama';
    const apiKey = process.env.OPENAI_API_KEY || (isOllama ? 'ollama' : '');
    if (!apiKey) {
      throw new Error('Missing OPENAI_API_KEY environment variable.');
    }
    const baseUrl = isOllama
      ? (process.env.OLLAMA_HOST || 'http://localhost:11434') + '/v1'
      : process.env.OPENAI_BASE_URL || 'https://api.openai.com/v1';
    const url = `${baseUrl.replace(/\/+$/, '')}/chat/completions`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${apiKey}`,
      },
      body: JSON.stringify({
        model,
        temperature,
        messages: [
          {role: 'system', content: systemPrompt},
          {role: 'user', content: userPrompt},
        ],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`${provider} API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = (await res.json()) as OpenAIChatResponse;
    const text = data.choices?.[0]?.message?.content ?? '';
    return extractJsCode(text);
  }

  if (provider === 'anthropic') {
    const apiKey = process.env.ANTHROPIC_API_KEY;
    if (!apiKey) {
      throw new Error('Missing ANTHROPIC_API_KEY environment variable.');
    }
    const baseUrl = process.env.ANTHROPIC_BASE_URL || 'https://api.anthropic.com/v1';
    const url = `${baseUrl.replace(/\/+$/, '')}/messages`;
    const res = await fetch(url, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'x-api-key': apiKey,
        'anthropic-version': '2023-06-01',
      },
      body: JSON.stringify({
        model,
        max_tokens: 8192,
        temperature,
        system: systemPrompt,
        messages: [{role: 'user', content: userPrompt}],
      }),
    });
    if (!res.ok) {
      const errText = await res.text();
      throw new Error(`Anthropic API HTTP ${res.status}: ${errText.slice(0, 500)}`);
    }
    const data = (await res.json()) as AnthropicResponse;
    const blocks = data.content ?? [];
    const text = blocks.map((b) => b.text ?? '').join('\n');
    return extractJsCode(text);
  }

  throw new Error(
    `Unknown provider "${provider}". Expected gemini, openai, anthropic, ollama, or cmd.`,
  );
}
