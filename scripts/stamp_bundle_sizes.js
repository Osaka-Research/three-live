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

/**
 * Stamps measured gzip sizes into demo HTML pages.
 *
 * Any element written as `<span data-bundle-size="three-live.min.js">…</span>`
 * has its text replaced with the gzipped size of that bundle (e.g.
 * "46.2 KB gz"), so the hub page and every demo page show the same number,
 * measured from the bundle actually being served.
 *
 * CLI usage (also used by the Blaze www_site_bundle genrule):
 *   node stamp_bundle_sizes.js \
 *     --bundle three-live.min.js=path/to/three-live.min.js \
 *     --bundle xr-live.min.js=path/to/xr-live.min.js \
 *     page1.html [page2.html ...]
 * Pages are rewritten in place.
 */

const fs = require('fs');
const zlib = require('zlib');

/** Returns the gzip (level 9) size of a file, formatted like "46.2 KB gz". */
function formatGzipSize(filePath) {
  const gzBytes = zlib.gzipSync(fs.readFileSync(filePath), {level: 9}).length;
  return `${(gzBytes / 1024).toFixed(1)} KB gz`;
}

/**
 * Rewrites every `data-bundle-size` element in `html`. Throws if a page refers
 * to a bundle that was not provided, so a typo can't leave a stale number.
 */
function stampHtml(html, sizeLabels, pageName) {
  return html.replace(
      /(<span\b[^>]*\bdata-bundle-size="([^"]+)"[^>]*>)[^<]*(<\/span>)/g,
      (match, open, bundleName, close) => {
        const label = sizeLabels[bundleName];
        if (label === undefined) {
          throw new Error(
              `${pageName}: no size provided for bundle "${bundleName}"`);
        }
        return `${open}${label}${close}`;
      });
}

/**
 * Stamps sizes into each page in place.
 * @param {!Object<string, string>} bundlePaths Bundle name -> file path.
 * @param {!Array<string>} pagePaths HTML files to rewrite (missing ones are skipped).
 */
function stampBundleSizes(bundlePaths, pagePaths) {
  const sizeLabels = {};
  for (const [name, filePath] of Object.entries(bundlePaths)) {
    sizeLabels[name] = formatGzipSize(filePath);
  }
  for (const pagePath of pagePaths) {
    if (!fs.existsSync(pagePath)) continue;
    const html = fs.readFileSync(pagePath, 'utf8');
    const updated = stampHtml(html, sizeLabels, pagePath);
    if (updated !== html) fs.writeFileSync(pagePath, updated);
  }
  return sizeLabels;
}

module.exports = {stampBundleSizes};

if (require.main === module) {
  const args = process.argv.slice(2);
  const bundlePaths = {};
  const pagePaths = [];
  for (let i = 0; i < args.length; i++) {
    if (args[i] === '--bundle') {
      const [name, filePath] = args[++i].split('=');
      bundlePaths[name] = filePath;
    } else {
      pagePaths.push(args[i]);
    }
  }
  const labels = stampBundleSizes(bundlePaths, pagePaths);
  for (const [name, label] of Object.entries(labels)) {
    console.log(`Stamped ${name}: ${label}`);
  }
}
