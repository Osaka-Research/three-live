/**
 * @license
 * Copyright 2026 Google LLC
 * SPDX-License-Identifier: Apache-2.0
 */

/**
 * @fileoverview Talk-to-Select tier 1 (roadmap B2b-4): resolves a spoken reference such as
 * "the two red chairs on the left" to mesh names without a model call, and parses push-to-talk
 * commands ("select the lamp and make it blue").
 *
 * Mirrors `compiler/src/ai_select.rs` (the Rust core used by Android / iOS); both are checked
 * against `tests/fixtures/select_cases.json`. Keep the vocabulary and rules identical.
 */

type Vec3 = [number, number, number];

/** One mesh as the matcher sees it: a world-space box and an optional linear RGB color. */
export interface SelectRawEntry {
  name: string;
  min: Vec3;
  max: Vec3;
  color?: Vec3 | null;
}

/** An indexed mesh. */
export interface SelectIndexEntry {
  id: number;
  name: string;
  words: string[];
  colorName: string | null;
  size: number;
  height: number;
  center: Vec3;
}

/** The viewpoint "left", "front", etc. are relative to. */
export interface SelectCamera {
  eye: Vec3;
  target: Vec3;
}

export type SelectConfidence = 'high' | 'ambiguous' | 'none';

/** Result of {@link matchSelection}. */
export interface SelectMatch {
  /** Index positions, in index order. */
  ids: number[];
  /** Distinct mesh names of `ids`, in index order. */
  names: string[];
  confidence: SelectConfidence;
  /** Names to offer back when ambiguous (at most 10). */
  candidates: string[];
  /** `exact`, `match`, `multiple`, `count_mismatch`, `relation`, `no_match`, `empty`, `except`. */
  reason: string;
}

/** A parsed push-to-talk utterance. */
export type VoiceCommand =
  | {kind: 'clear'; mode: 'clear'}
  | {kind: 'select'; mode: 'replace' | 'add' | 'remove'; query: string}
  | {kind: 'mixed'; mode: 'replace' | 'add' | 'remove'; query: string; instruction: string}
  | {kind: 'edit'; instruction: string};

const MAX_MATCH = 50;
const MAX_CANDIDATES = 10;
const EPS = 1e-6;

export const DEFAULT_SELECT_CAMERA: SelectCamera = {eye: [0, 1.6, 5], target: [0, 0.8, 0]};

// ---------------------------------------------------------------------------------------------
// Vocabulary (keep identical to ai_select.rs).

const FILLER = new Set(
  (
    'the a an please can could would you will i want wanna to me my that this those these of ' +
    'one ones object objects thing things item items mesh meshes piece pieces part parts just ' +
    'only also too is are there here which select pick choose highlight grab focus on in at by ' +
    'some most side hand them it its and s now again as well other others'
  ).split(' '),
);

const SYNONYMS = [
  'sofa couch settee',
  'lamp light lantern',
  'door gate doorway',
  'table desk',
  'chair seat stool',
  'rug carpet mat',
  'cup mug',
  'tv television screen monitor',
  'car vehicle automobile',
  'box crate cube',
  'ball sphere orb',
  'floor ground',
  'plant tree bush',
  'cabinet cupboard closet',
].map((g) => g.split(' '));

/** [name, sRGB 0-255, family]. */
const PALETTE: Array<[string, Vec3, string]> = [
  ['red', [220, 40, 40], 'red'],
  ['orange', [245, 140, 30], 'orange'],
  ['yellow', [240, 220, 40], 'yellow'],
  ['gold', [212, 175, 55], 'yellow'],
  ['green', [50, 170, 60], 'green'],
  ['teal', [0, 128, 128], 'green'],
  ['cyan', [40, 200, 220], 'blue'],
  ['blue', [40, 80, 220], 'blue'],
  ['navy', [20, 30, 100], 'blue'],
  ['purple', [130, 50, 180], 'purple'],
  ['magenta', [220, 40, 200], 'pink'],
  ['pink', [240, 120, 180], 'pink'],
  ['brown', [130, 80, 40], 'brown'],
  ['beige', [225, 205, 160], 'brown'],
  ['white', [245, 245, 245], 'white'],
  ['silver', [192, 192, 192], 'gray'],
  ['gray', [128, 128, 128], 'gray'],
  ['black', [20, 20, 20], 'black'],
];

const COLOR_ALIASES: Record<string, string> = {
  grey: 'gray',
  golden: 'gold',
  crimson: 'red',
  maroon: 'red',
  violet: 'purple',
  aqua: 'cyan',
  turquoise: 'cyan',
  tan: 'beige',
};

type Axis = 'right' | 'depth' | 'up' | 'size' | 'height';
/** `[axis, max]`, or `'middle'`. */
type Modifier = [Axis, boolean] | 'middle';

const MODIFIERS: Record<string, Modifier> = {};
function addMods(words: string, m: Modifier) {
  for (const w of words.split(' ')) MODIFIERS[w] = m;
}
addMods('left leftmost', ['right', false]);
addMods('right rightmost', ['right', true]);
addMods('front nearest closest frontmost', ['depth', false]);
addMods('back farthest furthest rear far backmost', ['depth', true]);
addMods('top highest upper topmost', ['up', true]);
addMods('bottom lowest lower bottommost', ['up', false]);
addMods('biggest largest big large huge bigger larger', ['size', true]);
addMods('smallest small tiny little smaller', ['size', false]);
addMods('tallest tall taller', ['height', true]);
addMods('shortest short shorter', ['height', false]);
addMods('middle center centre central', 'middle');

const ORDINALS: Record<string, number> = {first: 0, second: 1, third: 2, fourth: 3, fifth: 4, last: -1};
const NUMBERS: Record<string, number> = {
  two: 2,
  pair: 2,
  three: 3,
  four: 4,
  five: 5,
  six: 6,
  seven: 7,
  eight: 8,
  nine: 9,
  ten: 10,
};
const ALL_WORDS = new Set(['all', 'every', 'everything', 'each', 'everybody']);
const isDigits = (w: string) => /^[0-9]+$/.test(w);

const has = (o: object, k: string) => Object.prototype.hasOwnProperty.call(o, k);
const modifierWord = (w: string): Modifier | null => (has(MODIFIERS, w) ? MODIFIERS[w] : null);
const ordinalWord = (w: string): number | null => (has(ORDINALS, w) ? ORDINALS[w] : null);

function numberWord(w: string): number | null {
  let n: number;
  if (has(NUMBERS, w)) n = NUMBERS[w];
  else if (/^[0-9]{1,3}$/.test(w)) n = Number(w);
  else return null;
  return n >= 1 && n <= MAX_MATCH ? n : null;
}

function colorWord(w: string): string | null {
  if (has(COLOR_ALIASES, w)) return COLOR_ALIASES[w];
  return PALETTE.some((p) => p[0] === w) ? w : null;
}

function isRelation(t: string[]): boolean {
  for (let i = 0; i < t.length; i++) {
    const w = t[i];
    const next = t[i + 1] ?? '';
    if (
      /^(near|nearby|beside|behind|under|underneath|beneath|above|below|between|inside|within|against|with|beyond|around)$/.test(
        w,
      )
    ) {
      return true;
    }
    if ((w === 'next' || w === 'close') && next === 'to') return true;
    if ((w === 'front' || w === 'top') && next === 'of') return true;
    if (w === 'on' || w === 'by') {
      // "on the left" is spatial; "on the table" is a relation.
      let j = i + 1;
      while (j < t.length && /^(the|a|an|its|my)$/.test(t[j])) j++;
      const n = t[j];
      if (n !== undefined && !modifierWord(n) && n !== 'side' && n !== 'end') return true;
    }
  }
  return false;
}

// ---------------------------------------------------------------------------------------------
// Words.

/** Lowercases and splits on anything that is not `a-z` / `0-9`. */
export function tokenize(text: string): string[] {
  return String(text ?? '')
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

/** Crude English singular: `boxes` → `box`, `shelves` → `shelf`, `chairs` → `chair`. */
export function singular(w: string): string {
  const n = w.length;
  if (n > 4 && w.endsWith('ies')) return w.slice(0, -3) + 'y';
  if (n > 4 && w.endsWith('ves')) return w.slice(0, -3) + 'f';
  for (const suffix of ['ches', 'shes', 'xes', 'sses', 'zes']) {
    if (n > suffix.length + 1 && w.endsWith(suffix)) return w.slice(0, -2);
  }
  if (n > 3 && w.endsWith('s') && !w.endsWith('ss') && !w.endsWith('us')) return w.slice(0, -1);
  return w;
}

/** Words of a mesh name: `"RedChair_02"` → `["red", "chair", "02"]`. */
export function nameWords(name: string): string[] {
  const words: string[] = [];
  let cur = '';
  let prev = '';
  const lower = (c: string) => c >= 'a' && c <= 'z';
  const upper = (c: string) => c >= 'A' && c <= 'Z';
  const digit = (c: string) => c >= '0' && c <= '9';
  for (const c of String(name)) {
    if (!(lower(c) || upper(c) || digit(c))) {
      if (cur) words.push(cur);
      cur = '';
      prev = '';
      continue;
    }
    if (prev && cur && ((lower(prev) && upper(c)) || digit(prev) !== digit(c))) {
      words.push(cur);
      cur = '';
    }
    cur += c.toLowerCase();
    prev = c;
  }
  if (cur) words.push(cur);
  return words.map(singular);
}

const normalized = (s: string) => s.replace(/[^A-Za-z0-9]/g, '').toLowerCase();
const synonyms = (a: string, b: string) => SYNONYMS.some((g) => g.includes(a) && g.includes(b));

/** Whether a (singular) query noun names a (singular) mesh-name word. */
export function nounMatches(word: string, noun: string): boolean {
  return (
    word === noun ||
    synonyms(word, noun) ||
    (noun.length >= 4 && word.length >= 4 && (word.startsWith(noun) || noun.startsWith(word)))
  );
}

// ---------------------------------------------------------------------------------------------
// Colors.

function linearToSrgb(c: number): number {
  const x = Math.min(1, Math.max(0, Number.isFinite(c) ? c : 0));
  return (x <= 0.0031308 ? 12.92 * x : 1.055 * Math.pow(x, 1 / 2.4) - 0.055) * 255;
}

/** Nearest palette name for a linear RGB color (glTF `baseColorFactor`). */
export function colorName(linear: readonly number[]): string {
  const s = [linearToSrgb(linear[0]), linearToSrgb(linear[1]), linearToSrgb(linear[2])];
  let best = PALETTE[0][0];
  let bestD = Infinity;
  for (const [name, rgb] of PALETTE) {
    const d = (s[0] - rgb[0]) ** 2 + (s[1] - rgb[1]) ** 2 + (s[2] - rgb[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

const colorFamily = (name: string) => PALETTE.find((p) => p[0] === name)?.[2] ?? '';

function entryHasColor(e: SelectIndexEntry, q: string): boolean {
  if (e.words.includes(q)) return true;
  return e.colorName != null && (e.colorName === q || colorFamily(e.colorName) === q);
}

// ---------------------------------------------------------------------------------------------
// Index.

/** Indexes raw entries (names, world boxes, linear colors). */
export function buildSelectIndex(raw: readonly SelectRawEntry[]): SelectIndexEntry[] {
  return raw.map((r, id) => {
    const ext = [0, 1, 2].map((k) => Math.abs(r.max[k] - r.min[k]));
    return {
      id,
      name: r.name,
      words: nameWords(r.name),
      colorName: r.color ? colorName(r.color) : null,
      size: Math.max(ext[0], 0.01) * Math.max(ext[1], 0.01) * Math.max(ext[2], 0.01),
      height: ext[1],
      center: [0, 1, 2].map((k) => (r.min[k] + r.max[k]) / 2) as Vec3,
    };
  });
}

// ---------------------------------------------------------------------------------------------
// Matching.

interface View {
  eye: Vec3;
  right: Vec3;
}

function viewOf(cam: SelectCamera): View {
  const d = [0, 1, 2].map((k) => cam.target[k] - cam.eye[k]);
  const l = Math.hypot(d[0], d[1], d[2]);
  const f = l < 1e-9 ? [0, 0, -1] : d.map((x) => x / l);
  // right = forward × worldUp
  const r = [-f[2], 0, f[0]];
  const rl = Math.hypot(r[0], r[1], r[2]);
  return {eye: cam.eye, right: rl < 1e-9 ? [1, 0, 0] : (r.map((x) => x / rl) as Vec3)};
}

function axisValue(e: SelectIndexEntry, axis: Axis, v: View): number {
  const d = [0, 1, 2].map((k) => e.center[k] - v.eye[k]);
  switch (axis) {
    case 'right':
      return d[0] * v.right[0] + d[1] * v.right[1] + d[2] * v.right[2];
    case 'depth':
      return Math.sqrt(d[0] * d[0] + d[1] * d[1] + d[2] * d[2]);
    case 'up':
      return e.center[1];
    case 'size':
      return e.size;
    default:
      return e.height;
  }
}

const mean = (xs: number[]) => (xs.length ? xs.reduce((a, b) => a + b, 0) / xs.length : 0);

/** Keeps the half of `set` on the modifier's side of the mean (all of it when tied). */
function halfSpace(set: SelectIndexEntry[], m: Modifier, v: View): SelectIndexEntry[] {
  let kept: SelectIndexEntry[];
  if (m === 'middle') {
    if (set.length < 3) return set;
    const vals = set.map((e) => axisValue(e, 'right', v));
    const lo = Math.min(...vals);
    const hi = Math.max(...vals);
    kept = set.filter((_, i) => vals[i] > lo + EPS && vals[i] < hi - EPS);
  } else {
    const vals = set.map((e) => axisValue(e, m[0], v));
    const mu = mean(vals);
    kept = set.filter((_, i) => (m[1] ? vals[i] > mu + EPS : vals[i] < mu - EPS));
  }
  return kept.length ? kept : set;
}

/** Sorts `set` best-first for the modifier (stable, so ties keep index order). */
function rank(set: SelectIndexEntry[], m: Modifier, v: View): Array<[SelectIndexEntry, number]> {
  let keyed: Array<[SelectIndexEntry, number]>;
  if (m === 'middle') {
    const mu = mean(set.map((e) => axisValue(e, 'right', v)));
    keyed = set.map((e) => [e, Math.abs(axisValue(e, 'right', v) - mu)]);
  } else {
    keyed = set.map((e) => [e, m[1] ? -axisValue(e, m[0], v) : axisValue(e, m[0], v)]);
  }
  return keyed.sort((a, b) => a[1] - b[1]);
}

function result(set: SelectIndexEntry[], confidence: SelectConfidence, reason: string): SelectMatch {
  const ordered = [...set].sort((a, b) => a.id - b.id);
  const ids = [...new Set(ordered.map((e) => e.id))];
  const names: string[] = [];
  for (const e of ordered) {
    if (!names.includes(e.name) && names.length < MAX_MATCH) names.push(e.name);
  }
  if (confidence === 'high') return {ids, names, confidence, candidates: [], reason};
  if (confidence === 'ambiguous') {
    return {ids: [], names: [], confidence, candidates: names.slice(0, MAX_CANDIDATES), reason};
  }
  return {ids: [], names: [], confidence, candidates: [], reason};
}

const none = (reason: string) => result([], 'none', reason);

/**
 * Resolves a spoken reference against the index. `within` (e.g. the current selection, for
 * "deselect the red one") limits the search to those names.
 */
export function matchSelection(
  index: readonly SelectIndexEntry[],
  query: string,
  camera: SelectCamera = DEFAULT_SELECT_CAMERA,
  within?: readonly string[] | null,
): SelectMatch {
  const scope = within ? index.filter((e) => within.includes(e.name)) : [...index];
  const tokens = tokenize(query);
  // "all chairs except the red one" / "but not" / "excluding" / "other than".
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i];
    const next = tokens[i + 1] ?? '';
    const one = t === 'except' || t === 'excluding';
    if (!(one || (t === 'but' && next === 'not') || (t === 'other' && next === 'than'))) continue;
    const base = matchTokens(scope, tokens.slice(0, i), camera);
    if (base.confidence !== 'high') return base;
    const baseSet = scope.filter((e) => base.ids.includes(e.id));
    const ex = matchTokens(baseSet, tokens.slice(i + (one ? 1 : 2)), camera);
    if (ex.confidence !== 'high') return result(baseSet, 'ambiguous', 'except');
    const kept = baseSet.filter((e) => !ex.ids.includes(e.id));
    return kept.length ? result(kept, 'high', 'match') : none('no_match');
  }
  return matchTokens(scope, tokens, camera);
}

function isNounToken(w: string): boolean {
  return !(
    FILLER.has(w) ||
    ALL_WORDS.has(w) ||
    w === 'both' ||
    numberWord(w) !== null ||
    ordinalWord(w) !== null ||
    colorWord(w) !== null ||
    modifierWord(w) !== null ||
    isDigits(w)
  );
}

/** "the lamp and the sofa" → two references, unioned; "red and blue chairs" stays one. */
function matchTokens(scope: SelectIndexEntry[], tokens: string[], camera: SelectCamera): SelectMatch {
  const parts: string[][] = [[]];
  for (const t of tokens) {
    if (t === 'and') parts.push([]);
    else parts[parts.length - 1].push(t);
  }
  const nonEmpty = parts.filter((p) => p.length);
  if (nonEmpty.length < 2 || !nonEmpty.every((p) => p.some(isNounToken))) {
    return matchSimple(scope, tokens, camera);
  }
  const union: SelectIndexEntry[] = [];
  let ambiguous = false;
  for (const part of nonEmpty) {
    const r = matchSimple(scope, part, camera);
    if (r.confidence === 'none') return r;
    if (r.confidence === 'ambiguous') {
      ambiguous = true;
      union.push(...scope.filter((e) => r.candidates.includes(e.name)));
    } else {
      union.push(...scope.filter((e) => r.ids.includes(e.id)));
    }
  }
  const unique = [...new Map(union.map((e) => [e.id, e])).values()];
  return ambiguous ? result(unique, 'ambiguous', 'multiple') : result(unique, 'high', 'match');
}

function matchSimple(scope: SelectIndexEntry[], tokens: string[], camera: SelectCamera): SelectMatch {
  if (!scope.length) return none('no_match');
  // Exact name ("select Chair_02").
  let s = 0;
  while (s < tokens.length && /^(select|pick|choose|highlight|grab|the|a|an|just|only)$/.test(tokens[s])) {
    s++;
  }
  const joined = tokens.slice(s).join('');
  if (joined) {
    const exact = scope.filter((e) => normalized(e.name) === joined);
    if (exact.length) return result(exact, 'high', 'exact');
  }
  if (isRelation(tokens)) return none('relation');

  const nouns: string[] = [];
  let plural = false;
  let all = false;
  let quantity: number | null = null;
  let ordinal: number | null = null;
  const colors: string[] = [];
  const mods: Modifier[] = [];
  let prevNoun = false;
  for (const w of tokens) {
    if (prevNoun && isDigits(w)) {
      nouns.push(w); // "chair 2" names a mesh
      continue;
    }
    prevNoun = false;
    let n: number | null;
    let c: string | null;
    let m: Modifier | null;
    if (ALL_WORDS.has(w)) {
      all = true;
      plural = true;
    } else if (w === 'both') {
      quantity = 2;
      plural = true;
    } else if ((n = numberWord(w)) !== null) {
      quantity = n;
      plural = plural || n > 1;
    } else if ((n = ordinalWord(w)) !== null) {
      ordinal = n;
    } else if ((c = colorWord(w)) !== null) {
      colors.push(c);
    } else if ((m = modifierWord(w)) !== null) {
      mods.push(m);
    } else if (!FILLER.has(w)) {
      const sw = singular(w);
      if (sw !== w) plural = true;
      nouns.push(sw);
      prevNoun = true;
    }
  }
  if (!nouns.length && !colors.length && !mods.length && ordinal === null && !all && quantity === null) {
    return none('empty');
  }
  const view = viewOf(camera);

  // Nouns: keep the entries naming the most of them.
  let set = scope;
  if (nouns.length) {
    const scored = set.map((e) => ({
      e,
      n: nouns.filter((noun) => e.words.some((w) => nounMatches(w, noun))).length,
    }));
    const best = Math.max(0, ...scored.map((x) => x.n));
    if (best === 0) return none('no_match');
    set = scored.filter((x) => x.n === best).map((x) => x.e);
    // Prefer meshes the nouns describe fully: "the floor" → `Floor`, not `FloorLamp`.
    const unmatched = (e: SelectIndexEntry) =>
      e.words.filter((w) => !isDigits(w) && !nouns.some((noun) => nounMatches(w, noun))).length;
    const fewest = Math.min(...set.map(unmatched));
    set = set.filter((e) => unmatched(e) === fewest);
  }
  if (colors.length) set = set.filter((e) => colors.some((c) => entryHasColor(e, c)));
  if (!set.length) return none('no_match');

  // Ordinals count left to right.
  if (ordinal !== null) {
    for (const m of mods) set = halfSpace(set, m, view);
    const ranked = rank(set, ['right', false], view);
    const n = Math.min(quantity ?? 1, ranked.length);
    let picked: Array<[SelectIndexEntry, number]>;
    if (ordinal < 0) {
      picked = ranked.slice(ranked.length - n);
    } else {
      const start = ordinal * (quantity !== null ? n : 1);
      if (start >= ranked.length) return none('no_match');
      picked = ranked.slice(start, start + n);
    }
    return result(
      picked.map((r) => r[0]),
      'high',
      'match',
    );
  }

  const singularRef = !plural && quantity === null;
  const take = singularRef ? 1 : all ? null : quantity;
  if (take !== null && mods.length) {
    for (const m of mods.slice(0, -1)) set = halfSpace(set, m, view);
    const ranked = rank(set, mods[mods.length - 1], view);
    const n = take;
    if (ranked.length < n) {
      return result(
        ranked.map((r) => r[0]),
        'ambiguous',
        'count_mismatch',
      );
    }
    // A tie at the cut-off means the reference doesn't decide.
    if (ranked.length > n && Math.abs(ranked[n][1] - ranked[n - 1][1]) <= EPS) {
      const cut = ranked[n - 1][1];
      return result(
        ranked.filter((r) => Math.abs(r[1] - cut) <= EPS).map((r) => r[0]),
        'ambiguous',
        'multiple',
      );
    }
    return result(
      ranked.slice(0, n).map((r) => r[0]),
      'high',
      'match',
    );
  }
  for (const m of mods) set = halfSpace(set, m, view);
  if (singularRef) {
    return set.length === 1 ? result(set, 'high', 'match') : result(set, 'ambiguous', 'multiple');
  }
  if (quantity !== null && set.length !== quantity) return result(set, 'ambiguous', 'count_mismatch');
  return result(set, 'high', 'match');
}

// ---------------------------------------------------------------------------------------------
// Push-to-talk grammar.

/** Verbs that start an edit instruction. */
export const EDIT_VERBS = (
  'make paint color colour turn move rotate scale resize delete remove change set add put give ' +
  'raise lower shrink enlarge hide show swap replace spin flip double halve duplicate copy ' +
  'animate brighten darken'
).split(' ');

const stripPrefixAny = (s: string, prefixes: string[]): string | null => {
  for (const p of prefixes) {
    if (s.startsWith(p)) {
      const r = s.slice(p.length).trim();
      return r || null;
    }
  }
  return null;
};

const stripSuffixAny = (s: string, suffixes: string[]): string | null => {
  for (const p of suffixes) {
    if (s.endsWith(p)) {
      const r = s.slice(0, -p.length).trim();
      return r || null;
    }
  }
  return null;
};

const trimPunct = (s: string) => s.replace(/[.!?,]+$/, '');

/** Splits "the chairs and make them red" into ["the chairs", "make them red"]. */
function splitMixed(q: string): [string, string | null] {
  const words = q.split(' ');
  for (let i = 0; i < words.length; i++) {
    const comma = words[i].endsWith(',');
    const joiner = i > 0 && (words[i] === 'and' || words[i] === 'then');
    if (!(comma || joiner)) continue;
    let j = i + 1;
    while (j < words.length && (words[j] === 'then' || words[j] === 'and')) j++;
    if (j >= words.length || !EDIT_VERBS.includes(words[j])) continue;
    const before = (joiner ? words.slice(0, i) : words.slice(0, i + 1))
      .join(' ')
      .replace(/,+$/, '')
      .trim();
    if (before) return [before, words.slice(j).join(' ')];
  }
  return [q, null];
}

/** The last `k` words of the original utterance (keeps the user's casing for the edit). */
function tailWords(original: string, k: number): string {
  const words = original.split(/\s+/).filter(Boolean);
  if (words.length && trimPunct(words[words.length - 1]).toLowerCase() === 'please') words.pop();
  return trimPunct(words.slice(Math.max(0, words.length - k)).join(' '));
}

function finish(mode: 'replace' | 'add' | 'remove', q: string, original: string): VoiceCommand {
  let [query, instruction] = splitMixed(q);
  const stripped = stripSuffixAny(query, [' too', ' as well', ' also']);
  if (stripped !== null && mode === 'replace') {
    mode = 'add';
    query = stripped;
  }
  if (instruction !== null) {
    const k = instruction.split(/\s+/).filter(Boolean).length;
    return {kind: 'mixed', mode, query, instruction: tailWords(original, k)};
  }
  return {kind: 'select', mode, query};
}

const LEADS = [
  'please ',
  'ok ',
  'ok, ',
  'okay ',
  'okay, ',
  'now ',
  'now, ',
  'hey ',
  'um ',
  'um, ',
  'uh ',
  'uh, ',
  'so ',
  'so, ',
  'and ',
];
const CLEAR = new Set([
  'clear selection',
  'clear the selection',
  'reset selection',
  'reset the selection',
  'select nothing',
  'select none',
  'deselect',
  'deselect all',
  'deselect everything',
  'unselect',
  'unselect all',
  'unselect everything',
  'clear',
  'clear all',
]);
const SELECT_PREFIXES = [
  'select only ',
  'select just ',
  'only select ',
  'just select ',
  'select ',
  'pick ',
  'choose ',
  'highlight ',
  'grab ',
  'focus on ',
];

/**
 * Parses one push-to-talk utterance into a selection change, a mixed select-and-edit, or an
 * edit.
 */
export function parseVoiceCommand(text: string): VoiceCommand {
  const original = String(text ?? '').trim();
  let s = original.toLowerCase().replace(/[\u2018\u2019]/g, "'").split(/\s+/).filter(Boolean).join(' ');
  s = trimPunct(s);
  for (;;) {
    const before = s.length;
    for (const lead of LEADS) if (s.startsWith(lead)) s = s.slice(lead.length);
    if (s.endsWith(' please')) s = s.slice(0, -7).replace(/,+$/, '');
    if (s.length === before) break;
  }
  s = s.trim();
  if (CLEAR.has(s)) return {kind: 'clear', mode: 'clear'};
  let r = stripPrefixAny(s, ['deselect ', 'unselect ', "don't select ", 'do not select ']);
  if (r !== null) return finish('remove', r, original);
  for (const verb of ['remove ', 'take ']) {
    if (s.startsWith(verb)) {
      const q = stripSuffixAny(s.slice(verb.length), [
        ' from the selection',
        ' from selection',
        ' out of the selection',
      ]);
      if (q !== null) return {kind: 'select', mode: 'remove', query: q};
    }
  }
  r = stripPrefixAny(s, ['also select ', 'also pick ', 'also choose ', 'also add ']);
  if (r !== null) return finish('add', r, original);
  if (s.startsWith('add ')) {
    const q = stripSuffixAny(s.slice(4), [' to the selection', ' to selection']);
    if (q !== null) return {kind: 'select', mode: 'add', query: q};
  }
  r = stripPrefixAny(s, SELECT_PREFIXES);
  if (r !== null) return finish('replace', r, original);
  r = stripPrefixAny(s, ['just ', 'only ']);
  if (r !== null && !EDIT_VERBS.includes(r.split(' ')[0])) return finish('replace', r, original);
  return {kind: 'edit', instruction: tailWords(original, Infinity)};
}
