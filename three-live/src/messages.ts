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
 * @fileoverview User-facing messages shared by more than one module, so each
 * appears only once in a bundle.
 */

/** Error raised when client-modified scripts run without the opt-in. */
export const CLIENT_SCRIPTS_DISABLED_ERROR =
  'SecurityError: Client-modified script compilation (Use Case 1) is ' +
  'disabled by default to satisfy strict CSP and Trusted Types ' +
  'requirements. Use script-src="..." or loadScriptFromSrc(url) for ' +
  'server-generated scripts (Use Case 2), or explicitly opt in via ' +
  'ThreeLiveElement.allowClientScripts = true (or the ' +
  'allow-client-scripts attribute).';

/** Toast shown alongside CLIENT_SCRIPTS_DISABLED_ERROR. */
export const CLIENT_SCRIPTS_DISABLED_TOAST =
  'Security Error: client-side scripts require allow-client-scripts opt-in.';
