#!/usr/bin/env node
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
 * @fileoverview Zero-install Node/npx launcher for `three-live-cli`.
 *
 * Locates a locally compiled `three-live-cli` binary (`compiler/target/release`
 * or `compiler/target/debug`) or downloads the matching platform binary from
 * GitHub Releases into `~/.cache/three-live/v<version>/` on first invocation.
 */

'use strict';

const fs = require('fs');
const os = require('os');
const path = require('path');
const https = require('https');
const {spawnSync} = require('child_process');

const pkg = require('../package.json');

function resolvePlatformInfo(platform = process.platform, arch = process.arch) {
  const ext = platform === 'win32' ? '.exe' : '';
  const osTag =
    platform === 'darwin'
      ? 'macos'
      : platform === 'win32'
        ? 'windows'
        : 'linux';
  const archTag =
    arch === 'arm64'
      ? platform === 'darwin'
        ? 'arm64'
        : 'aarch64'
      : 'x86_64';
  const artifactName = `three-live-cli-${osTag}-${archTag}${ext}`;
  const parentDir = path.resolve(__dirname, '..');
  const grandparentDir = path.resolve(__dirname, '../..');
  const cacheDir = path.join(
    os.homedir() || os.tmpdir(),
    '.cache',
    'three-live',
    `v${pkg.version}`,
  );
  const cachedBin = path.join(cacheDir, artifactName);
  const localRoots = [];
  if (process.env.THREE_LIVE_CLI_SKIP_LOCAL !== '1') {
    localRoots.push(parentDir);
    if (fs.existsSync(path.join(grandparentDir, 'compiler', 'Cargo.toml'))) {
      localRoots.push(grandparentDir);
    }
  }
  const localCandidates = [];
  for (const root of localRoots) {
    localCandidates.push(
      path.join(root, 'target', 'release', `three-live-cli${ext}`),
      path.join(root, 'compiler', 'target', 'release', `three-live-cli${ext}`),
      path.join(root, 'target', 'debug', `three-live-cli${ext}`),
      path.join(root, 'compiler', 'target', 'debug', `three-live-cli${ext}`),
    );
  }
  const candidatePaths = [
    process.env.THREE_LIVE_CLI_BIN || '',
    ...localCandidates,
    cachedBin,
  ].filter(Boolean);
  const releaseUrl = `https://github.com/google/three-live/releases/download/v${pkg.version}/${artifactName}`;
  const latestReleaseUrl = `https://github.com/google/three-live/releases/latest/download/${artifactName}`;
  return {
    version: pkg.version,
    platform,
    arch,
    artifactName,
    releaseUrl,
    latestReleaseUrl,
    cachedBin,
    localCandidates,
    candidatePaths,
  };
}

function findExistingBinary(info) {
  if (
    process.env.THREE_LIVE_CLI_BIN &&
    fs.existsSync(process.env.THREE_LIVE_CLI_BIN)
  ) {
    return process.env.THREE_LIVE_CLI_BIN;
  }
  const localSet = new Set(info.localCandidates || []);
  let newestLocal = null;
  let newestMtime = -1;
  for (const candidate of info.candidatePaths) {
    if (!fs.existsSync(candidate)) continue;
    if (localSet.has(candidate)) {
      try {
        const mtime = fs.statSync(candidate).mtimeMs;
        if (mtime > newestMtime) {
          newestMtime = mtime;
          newestLocal = candidate;
        }
      } catch (_) {
        if (!newestLocal) newestLocal = candidate;
      }
    } else if (!newestLocal) {
      return candidate;
    }
  }
  return newestLocal;
}

function downloadFile(url, destPath, redirectsLeft = 5) {
  return new Promise((resolve, reject) => {
    https
      .get(url, {headers: {'User-Agent': 'three-live-cli'}}, (res) => {
        if (
          res.statusCode &&
          res.statusCode >= 300 &&
          res.statusCode < 400 &&
          res.headers.location
        ) {
          res.resume();
          if (redirectsLeft <= 0) {
            reject(
              new Error('Too many HTTP redirects downloading three-live-cli'),
            );
            return;
          }
          const nextUrl = new URL(res.headers.location, url).toString();
          downloadFile(nextUrl, destPath, redirectsLeft - 1).then(
            resolve,
            reject,
          );
          return;
        }
        if (res.statusCode !== 200) {
          res.resume();
          const err = new Error(`HTTP ${res.statusCode} for ${url}`);
          err.statusCode = res.statusCode;
          reject(err);
          return;
        }
        fs.mkdirSync(path.dirname(destPath), {recursive: true});
        const file = fs.createWriteStream(destPath, {mode: 0o755});
        res.pipe(file);
        file.on('finish', () => {
          file.close(() => {
            try {
              fs.chmodSync(destPath, 0o755);
            } catch (_) {}
            resolve(destPath);
          });
        });
        file.on('error', (err) => {
          try {
            fs.unlinkSync(destPath);
          } catch (_) {}
          reject(err);
        });
      })
      .on('error', reject);
  });
}

async function main() {
  const args = process.argv.slice(2);
  const info = resolvePlatformInfo();

  if (args.includes('--locate-only')) {
    const found = findExistingBinary(info);
    process.stdout.write(
      JSON.stringify({...info, resolvedBinary: found}, null, 2) + '\n',
    );
    return;
  }

  let binPath = findExistingBinary(info);
  if (!binPath) {
    try {
      binPath = await downloadFile(info.releaseUrl, info.cachedBin);
    } catch (err) {
      if (err && err.statusCode === 404 && info.latestReleaseUrl) {
        try {
          binPath = await downloadFile(info.latestReleaseUrl, info.cachedBin);
        } catch (fallbackErr) {
          process.stderr.write(
            `[three-live-cli] Prebuilt binary not found locally and could not be downloaded (${fallbackErr.message}).\n` +
              `Build locally with: cargo build --release --manifest-path compiler/Cargo.toml --bin three-live-cli\n`,
          );
          process.exit(1);
        }
      } else {
        process.stderr.write(
          `[three-live-cli] Prebuilt binary not found locally and could not be downloaded (${err.message}).\n` +
            `Build locally with: cargo build --release --manifest-path compiler/Cargo.toml --bin three-live-cli\n`,
        );
        process.exit(1);
      }
    }
  }

  const result = spawnSync(binPath, args, {stdio: 'inherit'});
  if (result.error) {
    process.stderr.write(`[three-live-cli] Failed to spawn ${binPath}: ${result.error.message}\n`);
    process.exit(1);
  }
  process.exit(result.status ?? 0);
}

if (require.main === module) {
  main();
}

module.exports = {resolvePlatformInfo, findExistingBinary};
