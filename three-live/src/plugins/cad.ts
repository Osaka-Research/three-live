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

// Procedural CAD, 2D Contours & ear-clipping hole triangulation, ExtrudeGeometry,
// 3D BSP CSG Booleans, and built-in stroke-font TextGeometry plugin (`cadPlugin`).
// CSG output is a polygon soup (it may contain T-junctions); it is not
// guaranteed to be a closed manifold.

import {
  getSharedRegistry,
  registerWorkerExtensionInstaller,
  type ThreeLivePlugin,
} from '../plugin';

/**
 * Options for `THREE.ExtrudeGeometry`.
 *
 * Defaults differ from three.js: `bevelEnabled` is false, `bevelThickness`
 * 0.06, `bevelSize` 0.8 x `bevelThickness`, `bevelSegments` 2, and cap UVs are
 * normalized to the shape's bounding box. Non-finite values use the defaults.
 */
export interface ExtrudeGeometryOptions {
  depth?: number;
  amount?: number;
  steps?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  bevelOffset?: number;
  bevelSegments?: number;
}

/**
 * Options for `THREE.TextGeometry`.
 *
 * Uses a built-in stroke font (digits, A-Z, and common punctuation; lowercase
 * is drawn as scaled uppercase and unknown glyphs as `?`), not a Hershey or
 * typeface font. Unlike three.js the result is centered by default (set
 * `center: false` for a baseline-left origin), depth is centered on z = 0, and
 * `bevelEnabled` only thickens the strokes. Non-finite values use the defaults.
 */
export interface TextGeometryOptions {
  size?: number;
  height?: number;
  depth?: number;
  curveSegments?: number;
  bevelEnabled?: boolean;
  bevelThickness?: number;
  bevelSize?: number;
  center?: boolean;
}

/** Maximum combined input triangle count permitted for a CSG boolean operation. */
export const MAX_CSG_TRIANGLES = 8192;

/** Maximum BSP tree recursion depth permitted during CSG evaluation. */
export const MAX_BSP_DEPTH = 2048;

/** Maximum string length rendered by `TextGeometry` (prevents geometry amplification). */
export const MAX_TEXT_GEOMETRY_CHARS = 128;

/** Maximum total outer + hole contour points per `Shape` (bounds ear-clipping cost). */
export const MAX_SHAPE_POINTS = 4096;

/**
 * Self-contained installer that attaches `Path`, `Shape`, `ShapeGeometry`,
 * `ExtrudeGeometry`, `TextGeometry`, `CSG`, and `materializeDeclarativeGeometry`
 * onto a `THREE` namespace and shared registry.
 *
 * NOTE: This function is serialized with `Function.prototype.toString()` into
 * sandboxed Web Workers, so it must remain 100% self-contained (do not reference
 * module-scoped imports or variables inside its body, and initialize all class
 * properties inside `constructor` rather than with class field initializers).
 */
// tslint:disable-next-line:no-any Heterogeneous host/worker THREE and registry objects.
export function installCadExtension(threeNs: any, reg?: any): any {
  if (!threeNs || !threeNs.BufferGeometry) return null;

  const Vector2 = threeNs.Vector2;
  const Vector3 = threeNs.Vector3;
  const Quaternion = threeNs.Quaternion;
  const Matrix4 = threeNs.Matrix4;
  const Matrix3 = threeNs.Matrix3;
  const Color = threeNs.Color;
  const BufferAttribute = threeNs.BufferAttribute;
  const BufferGeometry = threeNs.BufferGeometry;
  const Material = threeNs.Material;
  const MeshStandardMaterial = threeNs.MeshStandardMaterial;
  const Mesh = threeNs.Mesh;

  const maxCsgTriangles = 8192;
  const maxBspDepth = 2048;
  const maxTextGeometryChars = 128;
  const maxShapePoints = 4096;

  // Numeric option coercion: missing, NaN, or non-finite values fall back to
  // the default instead of propagating NaN into positions or loop bounds.
  const num = (v: unknown, d: number): number => {
    const n = v == null ? NaN : Number(v);
    return Number.isFinite(n) ? n : d;
  };

  interface PathSegment {
    type: 'move' | 'line' | 'quad' | 'cubic' | 'arc' | 'curve';
    pts: number[];
    // tslint:disable-next-line:no-any Optional Curve2D instance added via Path.add().
    curve?: any;
  }

  // tslint:disable-next-line:no-any Dynamic Vector2 instance from threeNs.
  type Vec2Like = any;

  class Path {
    declare currentPoint: Vec2Like;
    declare private readonly segments: PathSegment[];

    constructor(points?: Vec2Like[]) {
      this.currentPoint = new Vector2(0, 0);
      this.segments = [];
      if (Array.isArray(points) && points.length > 0) {
        this.fromPoints(points);
      }
    }

    fromPoints(points: Vec2Like[]): this {
      if (!points.length) return this;
      this.moveTo(points[0].x, points[0].y);
      for (let i = 1; i < points.length; i++) {
        this.lineTo(points[i].x, points[i].y);
      }
      return this;
    }

    moveTo(x: number, y: number): this {
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'move', pts: [fx, fy]});
      return this;
    }

    lineTo(x: number, y: number): this {
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({
          type: 'move',
          pts: [this.currentPoint.x, this.currentPoint.y],
        });
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'line', pts: [fx, fy]});
      return this;
    }

    quadraticCurveTo(cpX: number, cpY: number, x: number, y: number): this {
      const x0 = this.currentPoint.x;
      const y0 = this.currentPoint.y;
      const fcpX = Number(cpX) || 0;
      const fcpY = Number(cpY) || 0;
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({type: 'move', pts: [x0, y0]});
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({type: 'quad', pts: [x0, y0, fcpX, fcpY, fx, fy]});
      return this;
    }

    bezierCurveTo(
      cp1X: number,
      cp1Y: number,
      cp2X: number,
      cp2Y: number,
      x: number,
      y: number,
    ): this {
      const x0 = this.currentPoint.x;
      const y0 = this.currentPoint.y;
      const f1x = Number(cp1X) || 0;
      const f1y = Number(cp1Y) || 0;
      const f2x = Number(cp2X) || 0;
      const f2y = Number(cp2Y) || 0;
      const fx = Number(x) || 0;
      const fy = Number(y) || 0;
      if (this.segments.length === 0) {
        this.segments.push({type: 'move', pts: [x0, y0]});
      }
      this.currentPoint.set(fx, fy);
      this.segments.push({
        type: 'cubic',
        pts: [x0, y0, f1x, f1y, f2x, f2y, fx, fy],
      });
      return this;
    }

    absarc(
      aX: number,
      aY: number,
      aRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
    ): this {
      return this.absellipse(
        aX,
        aY,
        aRadius,
        aRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
        0,
      );
    }

    arc(
      aX: number,
      aY: number,
      aRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
    ): this {
      return this.absarc(
        this.currentPoint.x + (Number(aX) || 0),
        this.currentPoint.y + (Number(aY) || 0),
        aRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
      );
    }

    absellipse(
      aX: number,
      aY: number,
      xRadius: number,
      yRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
      aRotation = 0,
    ): this {
      const cx = Number(aX) || 0;
      const cy = Number(aY) || 0;
      const rx = Math.max(0, Number(xRadius) || 0);
      const ry = Math.max(0, Number(yRadius) || 0);
      const start = Number(aStartAngle) || 0;
      const end = Number(aEndAngle) || 0;
      const cw = aClockwise ? 1 : 0;
      const rot = Number(aRotation) || 0;
      this.segments.push({
        type: 'arc',
        pts: [cx, cy, rx, ry, start, end, cw, rot],
      });
      const cosR = Math.cos(rot);
      const sinR = Math.sin(rot);
      const ex = rx * Math.cos(end);
      const ey = ry * Math.sin(end);
      this.currentPoint.set(
        cx + ex * cosR - ey * sinR,
        cy + ex * sinR + ey * cosR,
      );
      return this;
    }

    ellipse(
      aX: number,
      aY: number,
      xRadius: number,
      yRadius: number,
      aStartAngle: number,
      aEndAngle: number,
      aClockwise = false,
      aRotation = 0,
    ): this {
      return this.absellipse(
        this.currentPoint.x + (Number(aX) || 0),
        this.currentPoint.y + (Number(aY) || 0),
        xRadius,
        yRadius,
        aStartAngle,
        aEndAngle,
        aClockwise,
        aRotation,
      );
    }

    // tslint:disable-next-line:no-any Curve2D instance (LineCurve, EllipseCurve, SplineCurve, etc.).
    add(curve: any): this {
      if (curve && typeof curve.getPoints === 'function') {
        this.segments.push({type: 'curve', pts: [], curve});
        const end = curve.getPoint?.(1);
        if (end) this.currentPoint.set(Number(end.x) || 0, Number(end.y) || 0);
      }
      return this;
    }

    splineThru(pts: Vec2Like[]): this {
      if (!Array.isArray(pts) || pts.length === 0) return this;
      const Spline = threeNs.SplineCurve || reg?.authorNamespace?.SplineCurve;
      if (Spline) {
        return this.add(new Spline([this.currentPoint.clone(), ...pts]));
      }
      for (const p of pts) {
        if (p) this.lineTo(Number(p.x) || 0, Number(p.y) || 0);
      }
      return this;
    }

    closePath(): this {
      if (this.segments.length > 0) {
        const first = this.segments[0];
        let sx = 0;
        let sy = 0;
        if (first.type === 'curve' && first.curve?.getPoint) {
          const st = first.curve.getPoint(0);
          sx = Number(st?.x) || 0;
          sy = Number(st?.y) || 0;
        } else if (first.type === 'arc') {
          const cx = first.pts[0];
          const cy = first.pts[1];
          const rx = first.pts[2];
          const ry = first.pts[3];
          const start = first.pts[4];
          const rot = first.pts[7];
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const tx = rx * Math.cos(start);
          const ty = ry * Math.sin(start);
          sx = cx + tx * cosR - ty * sinR;
          sy = cy + tx * sinR + ty * cosR;
        } else {
          sx = first.pts[0];
          sy = first.pts[1];
        }
        if (
          Math.hypot(this.currentPoint.x - sx, this.currentPoint.y - sy) > 1e-6
        ) {
          this.lineTo(sx, sy);
        }
      }
      return this;
    }

    getPoints(divisions = 12): Vec2Like[] {
      const divs = Math.max(
        1,
        Math.min(128, Math.floor(Number(divisions) || 12)),
      );
      const pts: Vec2Like[] = [];
      const pushPt = (x: number, y: number): void => {
        if (pts.length > 0) {
          const last = pts[pts.length - 1];
          if (Math.hypot(last.x - x, last.y - y) < 1e-6) return;
        }
        pts.push(new Vector2(x, y));
      };

      for (const seg of this.segments) {
        const p = seg.pts;
        if (seg.type === 'move' || seg.type === 'line') {
          pushPt(p[0], p[1]);
        } else if (seg.type === 'quad') {
          const x0 = p[0];
          const y0 = p[1];
          const cpx = p[2];
          const cpy = p[3];
          const x1 = p[4];
          const y1 = p[5];
          pushPt(x0, y0);
          for (let i = 1; i <= divs; i++) {
            const t = i / divs;
            const mt = 1 - t;
            pushPt(
              mt * mt * x0 + 2 * mt * t * cpx + t * t * x1,
              mt * mt * y0 + 2 * mt * t * cpy + t * t * y1,
            );
          }
        } else if (seg.type === 'cubic') {
          const x0 = p[0];
          const y0 = p[1];
          const cp1x = p[2];
          const cp1y = p[3];
          const cp2x = p[4];
          const cp2y = p[5];
          const x1 = p[6];
          const y1 = p[7];
          pushPt(x0, y0);
          for (let i = 1; i <= divs; i++) {
            const t = i / divs;
            const mt = 1 - t;
            const mt2 = mt * mt;
            const t2 = t * t;
            pushPt(
              mt2 * mt * x0 +
                3 * mt2 * t * cp1x +
                3 * mt * t2 * cp2x +
                t2 * t * x1,
              mt2 * mt * y0 +
                3 * mt2 * t * cp1y +
                3 * mt * t2 * cp2y +
                t2 * t * y1,
            );
          }
        } else if (seg.type === 'arc') {
          const cx = p[0];
          const cy = p[1];
          const rx = p[2];
          const ry = p[3];
          const aStart = p[4];
          const aEnd = p[5];
          const cw = p[6] !== 0;
          const rot = p[7];
          const twoPi = Math.PI * 2;
          let deltaAngle = aEnd - aStart;
          const samePoints = Math.abs(deltaAngle) < 1e-9;
          while (deltaAngle < 0) deltaAngle += twoPi;
          while (deltaAngle > twoPi) deltaAngle -= twoPi;
          if (deltaAngle < 1e-9) {
            deltaAngle = samePoints ? 0 : twoPi;
          }
          if (cw && !samePoints) {
            deltaAngle = deltaAngle === twoPi ? -twoPi : deltaAngle - twoPi;
          }
          const cosR = Math.cos(rot);
          const sinR = Math.sin(rot);
          const arcDivs = Math.max(2, divs);
          for (let i = 0; i <= arcDivs; i++) {
            const t = i / arcDivs;
            const angle = aStart + t * deltaAngle;
            const tx = rx * Math.cos(angle);
            const ty = ry * Math.sin(angle);
            pushPt(cx + tx * cosR - ty * sinR, cy + tx * sinR + ty * cosR);
          }
        } else if (seg.type === 'curve' && seg.curve?.getPoints) {
          for (const cp of seg.curve.getPoints(divs)) {
            if (cp) pushPt(Number(cp.x) || 0, Number(cp.y) || 0);
          }
        }
      }
      if (pts.length > 2) {
        const first = pts[0];
        const last = pts[pts.length - 1];
        if (Math.hypot(first.x - last.x, first.y - last.y) < 1e-6) {
          pts.pop();
        }
      }
      return pts;
    }

    getSpacedPoints(divisions = 12): Vec2Like[] {
      return this.getPoints(divisions);
    }

    clone(): this {
      const c: any = new (this.constructor as any)();
      c.currentPoint.copy(this.currentPoint);
      c.segments = this.segments.map((s) => ({
        type: s.type,
        pts: [...s.pts],
        ...(s.curve ? {curve: s.curve.clone ? s.curve.clone() : s.curve} : {}),
      }));
      if (Array.isArray((this as any).holes)) {
        c.holes = (this as any).holes.map((h: Path) => h.clone());
      }
      return c;
    }
  }

  class Shape extends Path {
    declare holes: Path[];

    constructor(points?: Vec2Like[]) {
      super(points);
      this.holes = [];
    }

    extractPoints(divisions = 12): {shape: Vec2Like[]; holes: Vec2Like[][]} {
      return {
        shape: this.getPoints(divisions),
        holes: this.holes.map((h) => h.getPoints(divisions)),
      };
    }
  }

  function signedArea2D(pts: Vec2Like[]): number {
    let area = 0;
    const n = pts.length;
    for (let i = 0, j = n - 1; i < n; j = i++) {
      area += pts[j].x * pts[i].y - pts[i].x * pts[j].y;
    }
    return area * 0.5;
  }

  function pointInTriangle2D(
    px: number,
    py: number,
    ax: number,
    ay: number,
    bx: number,
    by: number,
    cx: number,
    cy: number,
  ): boolean {
    const v0x = cx - ax;
    const v0y = cy - ay;
    const v1x = bx - ax;
    const v1y = by - ay;
    const v2x = px - ax;
    const v2y = py - ay;
    const dot00 = v0x * v0x + v0y * v0y;
    const dot01 = v0x * v1x + v0y * v1y;
    const dot02 = v0x * v2x + v0y * v2y;
    const dot11 = v1x * v1x + v1y * v1y;
    const dot12 = v1x * v2x + v1y * v2y;
    const denom = dot00 * dot11 - dot01 * dot01;
    if (Math.abs(denom) < 1e-12) return false;
    const invDenom = 1 / denom;
    const u = (dot11 * dot02 - dot01 * dot12) * invDenom;
    const v = (dot00 * dot12 - dot01 * dot02) * invDenom;
    return u >= -1e-7 && v >= -1e-7 && u + v <= 1 + 1e-7;
  }

  function mergeHolesIntoContour(
    outerInput: Vec2Like[],
    holesInput: Vec2Like[][],
  ): {merged: Vec2Like[]; mergedIndices: number[]; allVertices: Vec2Like[]} {
    const outer = outerInput.slice();
    if (signedArea2D(outer) < 0) outer.reverse();
    const allVertices: Vec2Like[] = outer.map((p) => new Vector2(p.x, p.y));
    let contour = outer.map((_, i) => i);

    const validHoles: Array<{
      pts: Vec2Like[];
      indices: number[];
      maxX: number;
      maxIdx: number;
    }> = [];
    for (const hRaw of holesInput) {
      if (!hRaw || hRaw.length < 3) continue;
      const h = hRaw.slice();
      if (signedArea2D(h) > 0) h.reverse();
      const indices: number[] = [];
      let maxX = -Infinity;
      let maxIdx = 0;
      for (let i = 0; i < h.length; i++) {
        const p = h[i];
        const globalIdx = allVertices.length;
        allVertices.push(new Vector2(p.x, p.y));
        indices.push(globalIdx);
        if (p.x > maxX) {
          maxX = p.x;
          maxIdx = i;
        }
      }
      validHoles.push({pts: h, indices, maxX, maxIdx});
    }

    validHoles.sort((a, b) => b.maxX - a.maxX);

    const cr = (o: Vec2Like, a: Vec2Like, b: Vec2Like): number =>
      (a.x - o.x) * (b.y - o.y) - (a.y - o.y) * (b.x - o.x);
    // True if segment a-b properly crosses any edge of the closed ring
    // (shared endpoints and touching do not count).
    const ringBlocks = (
      a: Vec2Like,
      b: Vec2Like,
      ring: Vec2Like[],
    ): boolean => {
      for (let k = 0; k < ring.length; k++) {
        const c = ring[k];
        const d = ring[(k + 1) % ring.length];
        if (cr(a, b, c) * cr(a, b, d) < 0 && cr(c, d, a) * cr(c, d, b) < 0) {
          return true;
        }
      }
      return false;
    };

    for (const hole of validHoles) {
      const h = hole.pts[hole.maxIdx];
      const hx = h.x;
      const n = contour.length;
      const ring = contour.map((idx) => allVertices[idx]);
      // Candidates: right of the hole first (no unit-dependent penalty), then
      // by distance. Take the first one that lies inside the contour's corner
      // sector at that vertex and whose bridge crosses no contour/hole edge.
      const dist = (i: number): number =>
        Math.hypot(ring[i].x - hx, ring[i].y - h.y);
      const order = ring
        .map((_, i) => i)
        .sort(
          (i, j) =>
            Number(ring[i].x < hx) - Number(ring[j].x < hx) ||
            dist(i) - dist(j),
        );
      let bestContourPos = order[0];
      for (const i of order) {
        const p = ring[i];
        const prev = ring[(i + n - 1) % n];
        const next = ring[(i + 1) % n];
        const leftOfNext = cr(p, next, h) >= 0;
        const leftOfPrev = cr(prev, p, h) >= 0;
        const inSector =
          cr(prev, p, next) >= 0
            ? leftOfNext && leftOfPrev
            : leftOfNext || leftOfPrev;
        if (
          inSector &&
          !ringBlocks(h, p, ring) &&
          !validHoles.some((o) => ringBlocks(h, p, o.pts))
        ) {
          bestContourPos = i;
          break;
        }
      }

      const nextContour: number[] = [];
      for (let i = 0; i <= bestContourPos; i++) {
        nextContour.push(contour[i]);
      }
      for (let i = 0; i <= hole.indices.length; i++) {
        const hIdx = hole.indices[(hole.maxIdx + i) % hole.indices.length];
        nextContour.push(hIdx);
      }
      for (let i = bestContourPos; i < contour.length; i++) {
        nextContour.push(contour[i]);
      }
      contour = nextContour;
    }

    return {
      merged: contour.map((idx) => allVertices[idx]),
      mergedIndices: contour,
      allVertices,
    };
  }

  function triangulatePolygonIndices(
    contourIndices: number[],
    vertices: Vec2Like[],
  ): Array<[number, number, number]> {
    const triangles: Array<[number, number, number]> = [];
    const poly = contourIndices.slice();
    if (poly.length < 3) return triangles;

    let guard = poly.length * poly.length + 64;
    let i = 0;
    while (poly.length > 2 && guard-- > 0) {
      const n = poly.length;
      const prevIdx = poly[(i + n - 1) % n];
      const currIdx = poly[i % n];
      const nextIdx = poly[(i + 1) % n];

      const a = vertices[prevIdx];
      const b = vertices[currIdx];
      const c = vertices[nextIdx];

      const cross = (b.x - a.x) * (c.y - a.y) - (b.y - a.y) * (c.x - a.x);
      if (cross > 1e-9) {
        let ear = true;
        const minX = Math.min(a.x, b.x, c.x) - 1e-7;
        const maxX = Math.max(a.x, b.x, c.x) + 1e-7;
        const minY = Math.min(a.y, b.y, c.y) - 1e-7;
        const maxY = Math.max(a.y, b.y, c.y) + 1e-7;
        for (let j = 0; j < n; j++) {
          const testIdx = poly[j];
          if (
            testIdx === prevIdx ||
            testIdx === currIdx ||
            testIdx === nextIdx
          ) {
            continue;
          }
          const p = vertices[testIdx];
          if (
            p.x >= minX &&
            p.x <= maxX &&
            p.y >= minY &&
            p.y <= maxY &&
            pointInTriangle2D(p.x, p.y, a.x, a.y, b.x, b.y, c.x, c.y) &&
            (p.x - a.x) * (p.x - a.x) + (p.y - a.y) * (p.y - a.y) >= 1e-12 &&
            (p.x - b.x) * (p.x - b.x) + (p.y - b.y) * (p.y - b.y) >= 1e-12 &&
            (p.x - c.x) * (p.x - c.x) + (p.y - c.y) * (p.y - c.y) >= 1e-12
          ) {
            ear = false;
            break;
          }
        }
        if (ear) {
          triangles.push([prevIdx, currIdx, nextIdx]);
          poly.splice(i % n, 1);
          // Re-test the previous vertex (it may have become an ear) instead of
          // rescanning from 0, which made clipping O(n^3).
          i = Math.max(0, (i % n) - 1);
          continue;
        }
      }
      i++;
      if (i >= n * 2) {
        // No ear found in a full pass: force-clip the vertex just tested
        // (prev/curr/next were computed for i - 1).
        triangles.push([prevIdx, currIdx, nextIdx]);
        poly.splice((i - 1) % n, 1);
        i = 0;
      }
    }
    return triangles;
  }

  // Extracts outer/hole contours and enforces MAX_SHAPE_POINTS (ear clipping
  // is O(n^2), so unbounded author-supplied contours could hang the worker).
  function extractShapePoints(
    shape: Path,
    curveSegments: number,
  ): {shape: Vec2Like[]; holes: Vec2Like[][]} {
    const extracted =
      shape instanceof Shape
        ? shape.extractPoints(curveSegments)
        : {shape: shape.getPoints(curveSegments), holes: []};
    let total = extracted.shape.length;
    for (const h of extracted.holes) total += h.length;
    if (total > maxShapePoints) {
      throw new RangeError(
        `SecurityError: shape point count (${total}) exceeds MAX_SHAPE_POINTS (${maxShapePoints})`,
      );
    }
    return extracted;
  }

  function bounds2D(verts: Vec2Like[]): [number, number, number, number] {
    let minX = Infinity;
    let minY = Infinity;
    let maxX = -Infinity;
    let maxY = -Infinity;
    for (const v of verts) {
      if (v.x < minX) minX = v.x;
      if (v.y < minY) minY = v.y;
      if (v.x > maxX) maxX = v.x;
      if (v.y > maxY) maxY = v.y;
    }
    return [minX, minY, Math.max(1e-6, maxX - minX), Math.max(1e-6, maxY - minY)];
  }

  class ShapeGeometry extends BufferGeometry {
    constructor(shapes: Shape | Shape[] = new Shape(), curveSegments = 12) {
      super();
      const shapeList = Array.isArray(shapes) ? shapes : [shapes];
      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (const shape of shapeList) {
        if (!(shape instanceof Path)) continue;
        const extracted = extractShapePoints(shape, curveSegments);
        if (extracted.shape.length < 3) continue;
        const {mergedIndices, allVertices} = mergeHolesIntoContour(
          extracted.shape,
          extracted.holes,
        );
        const tris = triangulatePolygonIndices(mergedIndices, allVertices);
        const baseVertex = positions.length / 3;
        const [minX, minY, spanX, spanY] = bounds2D(allVertices);
        for (const v of allVertices) {
          positions.push(v.x, v.y, 0);
          normals.push(0, 0, 1);
          uvs.push((v.x - minX) / spanX, (v.y - minY) / spanY);
        }
        for (const [a, b, c] of tris) {
          indices.push(baseVertex + a, baseVertex + b, baseVertex + c);
        }
      }

      setGeoBuffers(this, positions, normals, uvs, indices);
    }
  }

  function setGeoBuffers(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geo: any,
    pos: number[] | Float32Array,
    norm: number[] | Float32Array,
    uv: number[] | Float32Array,
    idx: number[] | Uint32Array,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  ): any {
    geo.setAttribute('position', new BufferAttribute(pos, 3));
    geo.setAttribute('normal', new BufferAttribute(norm, 3));
    geo.setAttribute('uv', new BufferAttribute(uv, 2));
    geo.setIndex(idx);
    return geo;
  }

  function computeContourOffsetNormals(ring: Vec2Like[]): Vec2Like[] {
    const n = ring.length;
    const out: Vec2Like[] = [];
    for (let i = 0; i < n; i++) {
      const prev = ring[(i + n - 1) % n];
      const curr = ring[i];
      const next = ring[(i + 1) % n];
      let e1x = curr.x - prev.x;
      let e1y = curr.y - prev.y;
      const l1 = Math.hypot(e1x, e1y) || 1;
      e1x /= l1;
      e1y /= l1;
      let e2x = next.x - curr.x;
      let e2y = next.y - curr.y;
      const l2 = Math.hypot(e2x, e2y) || 1;
      e2x /= l2;
      e2y /= l2;
      const n1x = e1y;
      const n1y = -e1x;
      const n2x = e2y;
      const n2y = -e2x;
      let bx = n1x + n2x;
      let by = n1y + n2y;
      const bl = Math.hypot(bx, by);
      if (bl > 1e-6) {
        bx /= bl;
        by /= bl;
        const denom = Math.max(0.35, bx * n1x + by * n1y);
        out.push(new Vector2(bx / denom, by / denom));
      } else {
        out.push(new Vector2(n1x, n1y));
      }
    }
    return out;
  }

  class ExtrudeGeometry extends BufferGeometry {
    constructor(
      shapes: Shape | Shape[] = new Shape(),
      options: ExtrudeGeometryOptions = {},
    ) {
      super();
      const shapeList = Array.isArray(shapes) ? shapes : [shapes];
      const curveSegments = Math.max(
        1,
        Math.min(64, Math.floor(num(options.curveSegments, 12))),
      );
      const depth = num(options.depth ?? options.amount, 1);
      const steps = Math.max(
        1,
        Math.min(32, Math.floor(num(options.steps, 1))),
      );
      const bevelEnabled = Boolean(options.bevelEnabled ?? false);
      const bevelThickness = bevelEnabled
        ? Math.max(0, num(options.bevelThickness, 0.06))
        : 0;
      const bevelSize = bevelEnabled
        ? Math.max(0, num(options.bevelSize, bevelThickness * 0.8))
        : 0;
      const bevelOffset = bevelEnabled ? num(options.bevelOffset, 0) : 0;
      const bevelSegments = bevelEnabled
        ? Math.max(1, Math.min(8, Math.floor(num(options.bevelSegments, 2))))
        : 0;

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      for (const shape of shapeList) {
        if (!(shape instanceof Path)) continue;
        const extracted = extractShapePoints(shape, curveSegments);
        if (extracted.shape.length < 3) continue;

        const outer = extracted.shape.slice();
        if (signedArea2D(outer) < 0) outer.reverse();
        const holes: Vec2Like[][] = [];
        for (const h of extracted.holes) {
          if (h.length < 3) continue;
          const hc = h.slice();
          if (signedArea2D(hc) > 0) hc.reverse();
          holes.push(hc);
        }

        const {mergedIndices, allVertices} = mergeHolesIntoContour(
          outer,
          holes,
        );
        const capTris = triangulatePolygonIndices(mergedIndices, allVertices);

        const allRings: Vec2Like[] = [outer, ...holes];
        const vertexNormals2D: Vec2Like[] = [];
        for (const ring of allRings) {
          const ringNorms = computeContourOffsetNormals(ring);
          for (const rn of ringNorms) {
            vertexNormals2D.push(rn);
          }
        }

        const [minX, minY, spanX, spanY] = bounds2D(allVertices);

        // 1. Back cap (-Z) and 2. Front cap (+Z)
        for (const [zCap, nz] of [
          [-bevelThickness, -1],
          [depth + bevelThickness, 1],
        ]) {
          const base = positions.length / 3;
          for (let i = 0; i < allVertices.length; i++) {
            const v = allVertices[i];
            const n2 = vertexNormals2D[i] ?? new Vector2(0, 0);
            const vx = v.x + n2.x * bevelOffset;
            const vy = v.y + n2.y * bevelOffset;
            positions.push(vx, vy, zCap);
            normals.push(0, 0, nz);
            uvs.push((vx - minX) / spanX, (vy - minY) / spanY);
          }
          for (const [a, b, c] of capTris) {
            indices.push(
              base + a,
              base + (nz < 0 ? c : b),
              base + (nz < 0 ? b : c),
            );
          }
        }

        // 3. Z-layer profile (back bevel -> body steps -> front bevel)
        const layers: Array<{z: number; expand: number}> = [];
        if (bevelEnabled && bevelSegments > 0) {
          for (let s = 0; s < bevelSegments; s++) {
            const t = s / bevelSegments;
            const angle = (t * Math.PI) / 2;
            layers.push({
              z: -bevelThickness * Math.cos(angle),
              expand: bevelOffset + bevelSize * Math.sin(angle),
            });
          }
        }
        for (let s = 0; s <= steps; s++) {
          const t = s / steps;
          layers.push({
            z: t * depth,
            expand: bevelOffset + bevelSize,
          });
        }
        if (bevelEnabled && bevelSegments > 0) {
          for (let s = 1; s <= bevelSegments; s++) {
            const t = s / bevelSegments;
            const angle = (t * Math.PI) / 2;
            layers.push({
              z: depth + bevelThickness * Math.sin(angle),
              expand: bevelOffset + bevelSize * Math.cos(angle),
            });
          }
        }

        // 4. Side walls for outer contour and each hole contour
        let globalRingOffset = 0;
        for (const ring of allRings) {
          const rLen = ring.length;
          for (let l = 0; l < layers.length - 1; l++) {
            const l0 = layers[l];
            const l1 = layers[l + 1];
            for (let i = 0; i < rLen; i++) {
              const j = (i + 1) % rLen;
              const v0 = ring[i];
              const v1 = ring[j];
              const n0 = vertexNormals2D[globalRingOffset + i];
              const n1 = vertexNormals2D[globalRingOffset + j];

              const p00x = v0.x + n0.x * l0.expand;
              const p00y = v0.y + n0.y * l0.expand;
              const p10x = v1.x + n1.x * l0.expand;
              const p10y = v1.y + n1.y * l0.expand;
              const p11x = v1.x + n1.x * l1.expand;
              const p11y = v1.y + n1.y * l1.expand;
              const p01x = v0.x + n0.x * l1.expand;
              const p01y = v0.y + n0.y * l1.expand;

              const ux = p10x - p00x;
              const uy = p10y - p00y;
              const vx = p01x - p00x;
              const vy = p01y - p00y;
              const vz = l1.z - l0.z;
              let nx = uy * vz;
              let ny = -ux * vz;
              let nz = ux * vy - uy * vx;
              const nLen = Math.hypot(nx, ny, nz) || 1;
              nx /= nLen;
              ny /= nLen;
              nz /= nLen;

              const quadBase = positions.length / 3;
              positions.push(
                p00x,
                p00y,
                l0.z,
                p10x,
                p10y,
                l0.z,
                p11x,
                p11y,
                l1.z,
                p01x,
                p01y,
                l1.z,
              );
              normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
              const u0 = i / rLen;
              const u1 = (i + 1) / rLen;
              const v0uv = l / (layers.length - 1);
              const v1uv = (l + 1) / (layers.length - 1);
              uvs.push(u0, v0uv, u1, v0uv, u1, v1uv, u0, v1uv);
              indices.push(
                quadBase,
                quadBase + 1,
                quadBase + 2,
                quadBase,
                quadBase + 2,
                quadBase + 3,
              );
            }
          }
          globalRingOffset += rLen;
        }
      }

      setGeoBuffers(this, positions, normals, uvs, indices);
    }
  }

  interface CSGVertex {
    x: number;
    y: number;
    z: number;
    nx: number;
    ny: number;
    nz: number;
    u: number;
    v: number;
  }

  interface CSGPolygon {
    vertices: CSGVertex[];
    nx: number;
    ny: number;
    nz: number;
    w: number;
  }

  function csgCloneVertex(v: CSGVertex): CSGVertex {
    return {
      x: v.x,
      y: v.y,
      z: v.z,
      nx: v.nx,
      ny: v.ny,
      nz: v.nz,
      u: v.u,
      v: v.v,
    };
  }

  function csgFlipVertex(v: CSGVertex): CSGVertex {
    return {
      x: v.x,
      y: v.y,
      z: v.z,
      nx: -v.nx,
      ny: -v.ny,
      nz: -v.nz,
      u: v.u,
      v: v.v,
    };
  }

  function csgLerpVertex(a: CSGVertex, b: CSGVertex, t: number): CSGVertex {
    const nx = a.nx + (b.nx - a.nx) * t;
    const ny = a.ny + (b.ny - a.ny) * t;
    const nz = a.nz + (b.nz - a.nz) * t;
    const len = Math.hypot(nx, ny, nz) || 1;
    return {
      x: a.x + (b.x - a.x) * t,
      y: a.y + (b.y - a.y) * t,
      z: a.z + (b.z - a.z) * t,
      nx: nx / len,
      ny: ny / len,
      nz: nz / len,
      u: a.u + (b.u - a.u) * t,
      v: a.v + (b.v - a.v) * t,
    };
  }

  function csgMakePolygon(vertices: CSGVertex[]): CSGPolygon | null {
    if (vertices.length < 3) return null;
    const a = vertices[0];
    const b = vertices[1];
    const c = vertices[2];
    const abx = b.x - a.x;
    const aby = b.y - a.y;
    const abz = b.z - a.z;
    const acx = c.x - a.x;
    const acy = c.y - a.y;
    const acz = c.z - a.z;
    let nx = aby * acz - abz * acy;
    let ny = abz * acx - abx * acz;
    let nz = abx * acy - aby * acx;
    const len = Math.hypot(nx, ny, nz);
    if (len < 1e-9) return null;
    nx /= len;
    ny /= len;
    nz /= len;
    const w = nx * a.x + ny * a.y + nz * a.z;
    return {vertices, nx, ny, nz, w};
  }

  function csgFlipPolygon(p: CSGPolygon): void {
    p.vertices.reverse();
    for (let i = 0; i < p.vertices.length; i++) {
      p.vertices[i] = csgFlipVertex(p.vertices[i]);
    }
    p.nx = -p.nx;
    p.ny = -p.ny;
    p.nz = -p.nz;
    p.w = -p.w;
  }

  const csgEps = 1e-5;
  const csgCoplanar = 0;
  const csgFront = 1;
  const csgBack = 2;
  const csgSpanning = 3;

  function csgSplitPolygon(
    planeNx: number,
    planeNy: number,
    planeNz: number,
    planeW: number,
    polygon: CSGPolygon,
    coplanarFront: CSGPolygon[],
    coplanarBack: CSGPolygon[],
    front: CSGPolygon[],
    back: CSGPolygon[],
  ): void {
    let polygonType = 0;
    const types: number[] = [];
    for (let i = 0; i < polygon.vertices.length; i++) {
      const v = polygon.vertices[i];
      const t = planeNx * v.x + planeNy * v.y + planeNz * v.z - planeW;
      const type = t < -csgEps ? csgBack : t > csgEps ? csgFront : csgCoplanar;
      polygonType |= type;
      types.push(type);
    }

    switch (polygonType) {
      case csgCoplanar: {
        const dot =
          planeNx * polygon.nx + planeNy * polygon.ny + planeNz * polygon.nz;
        if (dot > 0) coplanarFront.push(polygon);
        else coplanarBack.push(polygon);
        break;
      }
      case csgFront:
        front.push(polygon);
        break;
      case csgBack:
        back.push(polygon);
        break;
      case csgSpanning: {
        const f: CSGVertex[] = [];
        const b: CSGVertex[] = [];
        const n = polygon.vertices.length;
        for (let i = 0; i < n; i++) {
          const j = (i + 1) % n;
          const ti = types[i];
          const tj = types[j];
          const vi = polygon.vertices[i];
          const vj = polygon.vertices[j];
          if (ti !== csgBack) f.push(vi);
          if (ti !== csgFront) {
            b.push(ti !== csgBack ? csgCloneVertex(vi) : vi);
          }
          if ((ti | tj) === csgSpanning) {
            const dx = vj.x - vi.x;
            const dy = vj.y - vi.y;
            const dz = vj.z - vi.z;
            const denom = planeNx * dx + planeNy * dy + planeNz * dz;
            const t =
              Math.abs(denom) > 1e-12
                ? (planeW -
                    (planeNx * vi.x + planeNy * vi.y + planeNz * vi.z)) /
                  denom
                : 0.5;
            const vMid = csgLerpVertex(vi, vj, Math.max(0, Math.min(1, t)));
            f.push(vMid);
            b.push(csgCloneVertex(vMid));
          }
        }
        // Fragments of a convex polygon stay on the parent plane; recomputing
        // it from 3 possibly near-collinear vertices could drop the fragment.
        const {nx, ny, nz, w} = polygon;
        if (f.length >= 3) front.push({vertices: f, nx, ny, nz, w});
        if (b.length >= 3) back.push({vertices: b, nx, ny, nz, w});
        break;
      }
      default:
        break;
    }
  }

  class CSGNode {
    declare nx: number;
    declare ny: number;
    declare nz: number;
    declare w: number;
    declare hasPlane: boolean;
    declare polygons: CSGPolygon[];
    declare front: CSGNode | null;
    declare back: CSGNode | null;

    constructor(polygons?: CSGPolygon[], depth = 0) {
      this.nx = 0;
      this.ny = 0;
      this.nz = 0;
      this.w = 0;
      this.hasPlane = false;
      this.polygons = [];
      this.front = null;
      this.back = null;
      if (polygons && polygons.length > 0) {
        this.build(polygons, depth);
      }
    }

    invert(): void {
      for (let i = 0; i < this.polygons.length; i++) {
        csgFlipPolygon(this.polygons[i]);
      }
      this.nx = -this.nx;
      this.ny = -this.ny;
      this.nz = -this.nz;
      this.w = -this.w;
      if (this.front) this.front.invert();
      if (this.back) this.back.invert();
      const temp = this.front;
      this.front = this.back;
      this.back = temp;
    }

    clipPolygons(polygons: CSGPolygon[], depth = 0): CSGPolygon[] {
      if (!this.hasPlane || polygons.length === 0) {
        return polygons.slice();
      }
      // Never return unclipped polygons at the depth cap: that silently keeps
      // fragments which should have been removed.
      if (depth >= maxBspDepth) {
        throw new RangeError(
          `SecurityError: CSG BSP depth exceeds MAX_BSP_DEPTH (${maxBspDepth})`,
        );
      }
      let front: CSGPolygon[] = [];
      let back: CSGPolygon[] = [];
      for (let i = 0; i < polygons.length; i++) {
        csgSplitPolygon(
          this.nx,
          this.ny,
          this.nz,
          this.w,
          polygons[i],
          front,
          back,
          front,
          back,
        );
      }
      if (this.front && front.length > 0) {
        front = this.front.clipPolygons(front, depth + 1);
      }
      if (this.back) {
        back = back.length > 0 ? this.back.clipPolygons(back, depth + 1) : [];
      } else {
        back = [];
      }
      return front.concat(back);
    }

    clipTo(bsp: CSGNode, depth = 0): void {
      if (this.polygons.length > 0) {
        this.polygons = bsp.clipPolygons(this.polygons, 0);
      }
      if (depth < maxBspDepth) {
        if (this.front) this.front.clipTo(bsp, depth + 1);
        if (this.back) this.back.clipTo(bsp, depth + 1);
      }
    }

    allPolygons(out: CSGPolygon[] = []): CSGPolygon[] {
      for (let i = 0; i < this.polygons.length; i++) {
        out.push(this.polygons[i]);
      }
      if (this.front) this.front.allPolygons(out);
      if (this.back) this.back.allPolygons(out);
      return out;
    }

    build(polygons: CSGPolygon[], depth = 0): void {
      if (!polygons.length) return;
      if (!this.hasPlane) {
        const splitPoly = polygons[polygons.length >> 1];
        this.nx = splitPoly.nx;
        this.ny = splitPoly.ny;
        this.nz = splitPoly.nz;
        this.w = splitPoly.w;
        this.hasPlane = true;
      }
      // Convex meshes build a chain as deep as their plane count. Dumping the
      // remainder into one node here would give wrong booleans, so fail loudly.
      if (depth >= maxBspDepth) {
        throw new RangeError(
          `SecurityError: CSG BSP depth exceeds MAX_BSP_DEPTH (${maxBspDepth})`,
        );
      }
      const front: CSGPolygon[] = [];
      const back: CSGPolygon[] = [];
      for (let i = 0; i < polygons.length; i++) {
        csgSplitPolygon(
          this.nx,
          this.ny,
          this.nz,
          this.w,
          polygons[i],
          this.polygons,
          this.polygons,
          front,
          back,
        );
      }
      if (front.length > 0) {
        if (!this.front) this.front = new CSGNode();
        this.front.build(front, depth + 1);
      }
      if (back.length > 0) {
        if (!this.back) this.back = new CSGNode();
        this.back.build(back, depth + 1);
      }
    }
  }

  // tslint:disable-next-line:no-any Dynamic BufferGeometry and Matrix4 from threeNs.
  function geometryToCSGPolygons(geo: any, matrix: any): CSGPolygon[] {
    if (!matrix && geo._csgPolygons) return geo._csgPolygons;
    const pos = geo.attributes.position;
    if (!pos || pos.count === 0) return [];
    const norm = geo.attributes.normal;
    const uv = geo.attributes.uv;
    const idx = geo.index ? geo.index.array : null;
    const triCount = idx
      ? Math.floor(idx.length / 3)
      : Math.floor(pos.count / 3);
    if (triCount > maxCsgTriangles) {
      throw new RangeError(
        `SecurityError: CSG input triangle count (${triCount}) exceeds MAX_CSG_TRIANGLES (${maxCsgTriangles})`,
      );
    }

    const m = matrix ? matrix.elements : null;
    const flipWinding = m
      ? m[0] * (m[5] * m[10] - m[9] * m[6]) -
          m[4] * (m[1] * m[10] - m[9] * m[2]) +
          m[8] * (m[1] * m[6] - m[5] * m[2]) <
        0
      : false;
    // Normals transform by the normal matrix (inverse transpose of the upper
    // 3x3, column-major), not by the plain matrix.
    const nm: ArrayLike<number> | null = m
      ? new Matrix3().getNormalMatrix(matrix).elements
      : null;
    const readVert = (vi: number): CSGVertex => {
      let x = pos.getX(vi);
      let y = pos.getY(vi);
      let z = pos.getZ(vi);
      // Without a normal attribute, NaN marks "use the face normal" on output.
      let nx = norm ? norm.getX(vi) : NaN;
      let ny = norm ? norm.getY(vi) : NaN;
      let nz = norm ? norm.getZ(vi) : NaN;
      if (m && nm) {
        const tx = m[0] * x + m[4] * y + m[8] * z + m[12];
        const ty = m[1] * x + m[5] * y + m[9] * z + m[13];
        const tz = m[2] * x + m[6] * y + m[10] * z + m[14];
        x = tx;
        y = ty;
        z = tz;
        const tnx = nm[0] * nx + nm[3] * ny + nm[6] * nz;
        const tny = nm[1] * nx + nm[4] * ny + nm[7] * nz;
        const tnz = nm[2] * nx + nm[5] * ny + nm[8] * nz;
        const nLen = Math.hypot(tnx, tny, tnz) || 1;
        nx = tnx / nLen;
        ny = tny / nLen;
        nz = tnz / nLen;
      }
      const u = uv ? uv.getX(vi) : 0;
      const v = uv ? uv.getY(vi) : 0;
      return {x, y, z, nx, ny, nz, u, v};
    };

    const polys: CSGPolygon[] = [];
    for (let t = 0; t < triCount; t++) {
      const i0 = idx ? idx[t * 3] : t * 3;
      const i1 = idx ? idx[t * 3 + 1] : t * 3 + 1;
      const i2 = idx ? idx[t * 3 + 2] : t * 3 + 2;
      const poly = csgMakePolygon(
        flipWinding
          ? [readVert(i0), readVert(i2), readVert(i1)]
          : [readVert(i0), readVert(i1), readVert(i2)],
      );
      if (poly) polys.push(poly);
    }
    return polys;
  }

  // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  function csgPolygonsToGeometry(polys: CSGPolygon[]): any {
    const positions: number[] = [];
    const normals: number[] = [];
    const uvs: number[] = [];
    const indices: number[] = [];

    for (const poly of polys) {
      const verts = poly.vertices;
      if (verts.length < 3) continue;
      const base = positions.length / 3;
      for (const v of verts) {
        positions.push(v.x, v.y, v.z);
        // Keep interpolated vertex normals (smooth surfaces stay smooth); fall
        // back to the polygon's plane normal when missing or degenerate.
        const hasN =
          Number.isFinite(v.nx) &&
          v.nx * v.nx + v.ny * v.ny + v.nz * v.nz > 0.5;
        if (hasN) normals.push(v.nx, v.ny, v.nz);
        else normals.push(poly.nx, poly.ny, poly.nz);
        uvs.push(v.u, v.v);
      }
      for (let i = 1; i < verts.length - 1; i++) {
        indices.push(base, base + i, base + i + 1);
      }
    }

    const out = setGeoBuffers(
      new BufferGeometry(),
      positions,
      normals,
      uvs,
      indices,
    );
    // tslint:disable-next-line:no-any Cache polygons for chained CSG calls.
    (out as any)._csgPolygons = polys;
    return out;
  }

  function evaluateCSGBoolean(
    polysA: CSGPolygon[],
    polysB: CSGPolygon[],
    op: 'subtract' | 'union' | 'intersect',
  ): CSGPolygon[] {
    if (polysA.length + polysB.length > maxCsgTriangles) {
      throw new RangeError(
        `SecurityError: Combined CSG triangle count (${polysA.length + polysB.length}) exceeds MAX_CSG_TRIANGLES (${maxCsgTriangles})`,
      );
    }
    if (polysA.length === 0) {
      return op === 'union' ? polysB : [];
    }
    if (polysB.length === 0) {
      return op === 'intersect' ? [] : polysA;
    }

    let bMinX = Infinity,
      bMinY = Infinity,
      bMinZ = Infinity;
    let bMaxX = -Infinity,
      bMaxY = -Infinity,
      bMaxZ = -Infinity;
    for (let i = 0; i < polysB.length; i++) {
      const vs = polysB[i].vertices;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (v.x < bMinX) bMinX = v.x;
        if (v.y < bMinY) bMinY = v.y;
        if (v.z < bMinZ) bMinZ = v.z;
        if (v.x > bMaxX) bMaxX = v.x;
        if (v.y > bMaxY) bMaxY = v.y;
        if (v.z > bMaxZ) bMaxZ = v.z;
      }
    }
    bMinX -= 1e-4;
    bMinY -= 1e-4;
    bMinZ -= 1e-4;
    bMaxX += 1e-4;
    bMaxY += 1e-4;
    bMaxZ += 1e-4;
    const aOverlap: CSGPolygon[] = [];
    const aDisjoint: CSGPolygon[] = [];
    for (let i = 0; i < polysA.length; i++) {
      const p = polysA[i];
      const vs = p.vertices;
      let pMinX = Infinity,
        pMinY = Infinity,
        pMinZ = Infinity;
      let pMaxX = -Infinity,
        pMaxY = -Infinity,
        pMaxZ = -Infinity;
      for (let j = 0; j < vs.length; j++) {
        const v = vs[j];
        if (v.x < pMinX) pMinX = v.x;
        if (v.y < pMinY) pMinY = v.y;
        if (v.z < pMinZ) pMinZ = v.z;
        if (v.x > pMaxX) pMaxX = v.x;
        if (v.y > pMaxY) pMaxY = v.y;
        if (v.z > pMaxZ) pMaxZ = v.z;
      }
      if (
        pMaxX < bMinX ||
        pMinX > bMaxX ||
        pMaxY < bMinY ||
        pMinY > bMaxY ||
        pMaxZ < bMinZ ||
        pMinZ > bMaxZ
      ) {
        aDisjoint.push(p);
      } else {
        aOverlap.push(p);
      }
    }
    if (aOverlap.length === 0) {
      return op === 'union'
        ? polysA.concat(polysB)
        : op === 'subtract'
          ? polysA
          : [];
    }

    const a = new CSGNode(aOverlap);
    const b = new CSGNode(polysB);

    if (op === 'union') {
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      return aDisjoint.concat(a.allPolygons());
    } else if (op === 'subtract') {
      a.invert();
      a.clipTo(b);
      b.clipTo(a);
      b.invert();
      b.clipTo(a);
      b.invert();
      a.build(b.allPolygons());
      a.invert();
      return aDisjoint.concat(a.allPolygons());
    } else {
      a.invert();
      b.clipTo(a);
      b.invert();
      a.clipTo(b);
      b.clipTo(a);
      a.build(b.allPolygons());
      a.invert();
      return a.allPolygons();
    }
  }

  function csgToGeometry(
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geomA: any,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
    geomB: any,
    op: 'subtract' | 'union' | 'intersect',
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    matrixA: any = null,
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    matrixB: any = null,
    // tslint:disable-next-line:no-any Dynamic BufferGeometry from threeNs.
  ): any {
    if (typeof ENABLE_NATIVE_HOOKS !== 'undefined' && ENABLE_NATIVE_HOOKS) {
      const nativeFn = (globalThis as any).__three_live_native_csg_boolean__;
      if (
        typeof nativeFn === 'function' &&
        geomA?.attributes?.position?.array &&
        geomB?.attributes?.position?.array
      ) {
        const opCode = op === 'subtract' ? 0 : op === 'union' ? 1 : 2;
        const native = nativeFn(
          geomA.attributes.position.array,
          geomA.attributes.normal ? geomA.attributes.normal.array : null,
          geomA.attributes.uv ? geomA.attributes.uv.array : null,
          geomA.index ? geomA.index.array : null,
          matrixA ? matrixA.elements : null,
          geomB.attributes.position.array,
          geomB.attributes.normal ? geomB.attributes.normal.array : null,
          geomB.attributes.uv ? geomB.attributes.uv.array : null,
          geomB.index ? geomB.index.array : null,
          matrixB ? matrixB.elements : null,
          opCode,
        );
        if (native) {
          return setGeoBuffers(
            new BufferGeometry(),
            native.positions,
            native.normals,
            native.uvs,
            native.indices,
          );
        }
      }
    }
    const polysA = geometryToCSGPolygons(geomA, matrixA);
    const polysB = geometryToCSGPolygons(geomB, matrixB);
    return csgPolygonsToGeometry(evaluateCSGBoolean(polysA, polysB, op));
  }

  function runCSGMeshOp(
    // tslint:disable-next-line:no-any Dynamic Mesh or BufferGeometry from threeNs.
    targetA: any,
    // tslint:disable-next-line:no-any Dynamic Mesh or BufferGeometry from threeNs.
    targetB: any,
    op: 'subtract' | 'union' | 'intersect',
    // tslint:disable-next-line:no-any Dynamic Mesh from threeNs.
  ): any {
    const isMeshA = targetA instanceof Mesh || Boolean(targetA?.isMesh);
    const isMeshB = targetB instanceof Mesh || Boolean(targetB?.isMesh);
    const geomA = isMeshA ? targetA.geometry : targetA;
    const geomB = isMeshB ? targetB.geometry : targetB;
    // tslint:disable-next-line:no-any Dynamic Matrix4 from threeNs.
    let relMatrixB: any = null;
    if (isMeshB) {
      targetB.updateMatrix();
      if (isMeshA) {
        targetA.updateMatrix();
        const invScale = new Matrix4().makeScale(
          1 / (targetA.scale.x || 1),
          1 / (targetA.scale.y || 1),
          1 / (targetA.scale.z || 1),
        );
        const qLen =
          Math.hypot(
            targetA.quaternion.x,
            targetA.quaternion.y,
            targetA.quaternion.z,
            targetA.quaternion.w,
          ) || 1;
        const invRot = new Matrix4().compose(
          new Vector3(0, 0, 0),
          new Quaternion(
            -targetA.quaternion.x / qLen,
            -targetA.quaternion.y / qLen,
            -targetA.quaternion.z / qLen,
            targetA.quaternion.w / qLen,
          ),
          new Vector3(1, 1, 1),
        );
        const invTrans = new Matrix4().makeTranslation(
          -targetA.position.x,
          -targetA.position.y,
          -targetA.position.z,
        );
        relMatrixB = invScale
          .multiply(invRot)
          .multiply(invTrans)
          .multiply(targetB.matrix);
      } else {
        relMatrixB = targetB.matrix;
      }
    }
    const resultGeo = csgToGeometry(geomA, geomB, op, null, relMatrixB);
    const mat = isMeshA ? targetA.material : new MeshStandardMaterial();
    const out = new Mesh(resultGeo, mat);
    if (isMeshA) {
      out.position.copy(targetA.position);
      out.quaternion.copy(targetA.quaternion);
      out.scale.copy(targetA.scale);
      out.name = targetA.name;
    }
    return out;
  }

  const CSG = {
    toGeometry: csgToGeometry,
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    subtract(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'subtract');
    },
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    union(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'union');
    },
    // tslint:disable-next-line:no-any Dynamic Mesh / BufferGeometry.
    intersect(meshA: any, meshB: any): any {
      return runCSGMeshOp(meshA, meshB, 'intersect');
    },
  };

  const vectorGlyphStrokes: Record<string, number[][][]> = {
    '0': [
      [
        [0.15, 0],
        [0.85, 0],
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
      ],
    ],
    '1': [
      [
        [0.3, 0.8],
        [0.5, 1],
        [0.5, 0],
      ],
      [
        [0.2, 0],
        [0.8, 0],
      ],
    ],
    '2': [
      [
        [0.15, 0.8],
        [0.3, 1],
        [0.7, 1],
        [0.85, 0.8],
        [0.85, 0.55],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    '3': [
      [
        [0.15, 0.85],
        [0.3, 1],
        [0.75, 1],
        [0.85, 0.75],
        [0.5, 0.5],
        [0.85, 0.25],
        [0.75, 0],
        [0.3, 0],
        [0.15, 0.15],
      ],
    ],
    '4': [
      [
        [0.7, 0],
        [0.7, 1],
        [0.15, 0.35],
        [0.9, 0.35],
      ],
    ],
    '5': [
      [
        [0.85, 1],
        [0.2, 1],
        [0.15, 0.55],
        [0.75, 0.55],
        [0.85, 0.3],
        [0.75, 0],
        [0.2, 0],
      ],
    ],
    '6': [
      [
        [0.8, 0.9],
        [0.5, 1],
        [0.15, 0.7],
        [0.15, 0.15],
        [0.5, 0],
        [0.85, 0.2],
        [0.85, 0.45],
        [0.5, 0.55],
        [0.15, 0.45],
      ],
    ],
    '7': [
      [
        [0.15, 1],
        [0.85, 1],
        [0.35, 0],
      ],
    ],
    '8': [
      [
        [0.2, 0.5],
        [0.15, 0.75],
        [0.3, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.8, 0.5],
        [0.2, 0.5],
        [0.15, 0.2],
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.2],
        [0.8, 0.5],
      ],
    ],
    '9': [
      [
        [0.85, 0.55],
        [0.5, 0.45],
        [0.15, 0.55],
        [0.15, 0.85],
        [0.5, 1],
        [0.85, 0.85],
        [0.85, 0.2],
        [0.5, 0],
        [0.2, 0.1],
      ],
    ],
    'A': [
      [
        [0.1, 0],
        [0.5, 1],
        [0.9, 0],
      ],
      [
        [0.25, 0.35],
        [0.75, 0.35],
      ],
    ],
    'B': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
      [
        [0.7, 0.5],
        [0.85, 0.25],
        [0.7, 0],
        [0.15, 0],
      ],
    ],
    'C': [
      [
        [0.85, 0.8],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
        [0.65, 0],
        [0.85, 0.2],
      ],
    ],
    'D': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.65, 1],
        [0.85, 0.75],
        [0.85, 0.25],
        [0.65, 0],
        [0.15, 0],
      ],
    ],
    'E': [
      [
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
        [0.85, 0],
      ],
      [
        [0.15, 0.5],
        [0.7, 0.5],
      ],
    ],
    'F': [
      [
        [0.85, 1],
        [0.15, 1],
        [0.15, 0],
      ],
      [
        [0.15, 0.5],
        [0.7, 0.5],
      ],
    ],
    'G': [
      [
        [0.85, 0.8],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
        [0.85, 0],
        [0.85, 0.45],
        [0.55, 0.45],
      ],
    ],
    'H': [
      [
        [0.15, 0],
        [0.15, 1],
      ],
      [
        [0.85, 0],
        [0.85, 1],
      ],
      [
        [0.15, 0.5],
        [0.85, 0.5],
      ],
    ],
    'I': [
      [
        [0.25, 1],
        [0.75, 1],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
      [
        [0.25, 0],
        [0.75, 0],
      ],
    ],
    'J': [
      [
        [0.8, 1],
        [0.8, 0.25],
        [0.6, 0],
        [0.3, 0],
        [0.15, 0.25],
      ],
    ],
    'K': [
      [
        [0.15, 0],
        [0.15, 1],
      ],
      [
        [0.85, 1],
        [0.15, 0.45],
        [0.85, 0],
      ],
    ],
    'L': [
      [
        [0.15, 1],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    'M': [
      [
        [0.1, 0],
        [0.1, 1],
        [0.5, 0.35],
        [0.9, 1],
        [0.9, 0],
      ],
    ],
    'N': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.85, 0],
        [0.85, 1],
      ],
    ],
    'O': [
      [
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.25],
        [0.85, 0.75],
        [0.7, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
      ],
    ],
    'P': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
    ],
    'Q': [
      [
        [0.3, 0],
        [0.7, 0],
        [0.85, 0.25],
        [0.85, 0.75],
        [0.7, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.15, 0.25],
        [0.3, 0],
      ],
      [
        [0.55, 0.3],
        [0.9, -0.05],
      ],
    ],
    'R': [
      [
        [0.15, 0],
        [0.15, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.7, 0.5],
        [0.15, 0.5],
      ],
      [
        [0.55, 0.5],
        [0.85, 0],
      ],
    ],
    'S': [
      [
        [0.85, 0.85],
        [0.65, 1],
        [0.3, 1],
        [0.15, 0.75],
        [0.85, 0.25],
        [0.7, 0],
        [0.3, 0],
        [0.15, 0.15],
      ],
    ],
    'T': [
      [
        [0.1, 1],
        [0.9, 1],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
    ],
    'U': [
      [
        [0.15, 1],
        [0.15, 0.25],
        [0.35, 0],
        [0.65, 0],
        [0.85, 0.25],
        [0.85, 1],
      ],
    ],
    'V': [
      [
        [0.1, 1],
        [0.5, 0],
        [0.9, 1],
      ],
    ],
    'W': [
      [
        [0.05, 1],
        [0.25, 0],
        [0.5, 0.65],
        [0.75, 0],
        [0.95, 1],
      ],
    ],
    'X': [
      [
        [0.15, 1],
        [0.85, 0],
      ],
      [
        [0.85, 1],
        [0.15, 0],
      ],
    ],
    'Y': [
      [
        [0.15, 1],
        [0.5, 0.5],
        [0.85, 1],
      ],
      [
        [0.5, 0.5],
        [0.5, 0],
      ],
    ],
    'Z': [
      [
        [0.15, 1],
        [0.85, 1],
        [0.15, 0],
        [0.85, 0],
      ],
    ],
    '.': [
      [
        [0.45, 0],
        [0.55, 0],
        [0.55, 0.12],
        [0.45, 0.12],
        [0.45, 0],
      ],
    ],
    ',': [
      [
        [0.5, 0.15],
        [0.4, -0.1],
      ],
    ],
    ':': [
      [
        [0.45, 0.1],
        [0.55, 0.1],
      ],
      [
        [0.45, 0.7],
        [0.55, 0.7],
      ],
    ],
    '-': [
      [
        [0.2, 0.5],
        [0.8, 0.5],
      ],
    ],
    '+': [
      [
        [0.2, 0.5],
        [0.8, 0.5],
      ],
      [
        [0.5, 0.2],
        [0.5, 0.8],
      ],
    ],
    '=': [
      [
        [0.2, 0.35],
        [0.8, 0.35],
      ],
      [
        [0.2, 0.65],
        [0.8, 0.65],
      ],
    ],
    '/': [
      [
        [0.2, 0],
        [0.8, 1],
      ],
    ],
    '!': [
      [
        [0.5, 1],
        [0.5, 0.28],
      ],
      [
        [0.5, 0.1],
        [0.5, 0],
      ],
    ],
    '?': [
      [
        [0.2, 0.8],
        [0.35, 1],
        [0.7, 1],
        [0.85, 0.75],
        [0.5, 0.45],
        [0.5, 0.28],
      ],
      [
        [0.5, 0.1],
        [0.5, 0],
      ],
    ],
    '(': [
      [
        [0.65, 1],
        [0.35, 0.65],
        [0.35, 0.35],
        [0.65, 0],
      ],
    ],
    ')': [
      [
        [0.35, 1],
        [0.65, 0.65],
        [0.65, 0.35],
        [0.35, 0],
      ],
    ],
    '%': [
      [
        [0.2, 0],
        [0.8, 1],
      ],
      [
        [0.2, 0.8],
        [0.35, 0.8],
        [0.35, 0.95],
        [0.2, 0.95],
        [0.2, 0.8],
      ],
      [
        [0.65, 0.05],
        [0.8, 0.05],
        [0.8, 0.2],
        [0.65, 0.2],
        [0.65, 0.05],
      ],
    ],
    '#': [
      [
        [0.32, 0],
        [0.32, 1],
      ],
      [
        [0.68, 0],
        [0.68, 1],
      ],
      [
        [0.12, 0.35],
        [0.88, 0.35],
      ],
      [
        [0.12, 0.65],
        [0.88, 0.65],
      ],
    ],
    '$': [
      [
        [0.8, 0.8],
        [0.6, 0.92],
        [0.3, 0.92],
        [0.18, 0.72],
        [0.82, 0.28],
        [0.7, 0.08],
        [0.4, 0.08],
        [0.2, 0.2],
      ],
      [
        [0.5, 1],
        [0.5, 0],
      ],
    ],
    '_': [
      [
        [0.1, 0],
        [0.9, 0],
      ],
    ],
    '[': [
      [
        [0.65, 1],
        [0.3, 1],
        [0.3, 0],
        [0.65, 0],
      ],
    ],
    ']': [
      [
        [0.35, 1],
        [0.7, 1],
        [0.7, 0],
        [0.35, 0],
      ],
    ],
    '<': [
      [
        [0.75, 0.85],
        [0.25, 0.5],
        [0.75, 0.15],
      ],
    ],
    '>': [
      [
        [0.25, 0.85],
        [0.75, 0.5],
        [0.25, 0.15],
      ],
    ],
    '*': [
      [
        [0.5, 0.2],
        [0.5, 0.8],
      ],
      [
        [0.2, 0.35],
        [0.8, 0.65],
      ],
      [
        [0.2, 0.65],
        [0.8, 0.35],
      ],
    ],
    '\\': [
      [
        [0.2, 1],
        [0.8, 0],
      ],
    ],
  };

  class TextGeometry extends BufferGeometry {
    constructor(text = '', options: TextGeometryOptions = {}) {
      super();
      const cleanText = String(text ?? '').slice(0, maxTextGeometryChars);
      const size = Math.max(0.005, Math.min(100, num(options.size, 0.2)));
      const bevelEnabled = Boolean(options.bevelEnabled ?? false);
      const bevelThickness = bevelEnabled
        ? Math.max(0, Math.min(2, num(options.bevelThickness, size * 0.04)))
        : 0;
      const bevelSize = bevelEnabled
        ? Math.max(0, Math.min(2, num(options.bevelSize, size * 0.03)))
        : 0;
      const depth =
        Math.max(
          0.001,
          Math.min(20, num(options.depth ?? options.height, size * 0.2)),
        ) +
        bevelThickness * 2;
      const strokeRadius = size * 0.085 + bevelSize;
      const charWidth = size * 0.68;
      const charAdvance = size * 0.82;

      const positions: number[] = [];
      const normals: number[] = [];
      const uvs: number[] = [];
      const indices: number[] = [];

      const addBoxSegment = (
        x0: number,
        y0: number,
        x1: number,
        y1: number,
        r: number,
        z0: number,
        z1: number,
      ): void => {
        const dx = x1 - x0;
        const dy = y1 - y0;
        const len = Math.hypot(dx, dy);
        let ux = 1;
        let uy = 0;
        if (len > 1e-6) {
          ux = dx / len;
          uy = dy / len;
        }
        const px = -uy * r;
        const py = ux * r;
        const ex = ux * r * 0.6;
        const ey = uy * r * 0.6;

        const ax = x0 - ex + px;
        const ay = y0 - ey + py;
        const bx = x0 - ex - px;
        const by = y0 - ey - py;
        const cx = x1 + ex - px;
        const cy = y1 + ey - py;
        const dxp = x1 + ex + px;
        const dyp = y1 + ey + py;

        const pushQuad = (
          p0: [number, number, number],
          p1: [number, number, number],
          p2: [number, number, number],
          p3: [number, number, number],
          nx: number,
          ny: number,
          nz: number,
        ): void => {
          const base = positions.length / 3;
          positions.push(
            p0[0],
            p0[1],
            p0[2],
            p1[0],
            p1[1],
            p1[2],
            p2[0],
            p2[1],
            p2[2],
            p3[0],
            p3[1],
            p3[2],
          );
          normals.push(nx, ny, nz, nx, ny, nz, nx, ny, nz, nx, ny, nz);
          uvs.push(0, 0, 1, 0, 1, 1, 0, 1);
          indices.push(base, base + 1, base + 2, base, base + 2, base + 3);
        };

        pushQuad(
          [ax, ay, z1],
          [bx, by, z1],
          [cx, cy, z1],
          [dxp, dyp, z1],
          0,
          0,
          1,
        );
        pushQuad(
          [bx, by, z0],
          [ax, ay, z0],
          [dxp, dyp, z0],
          [cx, cy, z0],
          0,
          0,
          -1,
        );
        pushQuad(
          [ax, ay, z0],
          [bx, by, z0],
          [bx, by, z1],
          [ax, ay, z1],
          -ux,
          -uy,
          0,
        );
        pushQuad(
          [cx, cy, z0],
          [dxp, dyp, z0],
          [dxp, dyp, z1],
          [cx, cy, z1],
          ux,
          uy,
          0,
        );
        pushQuad(
          [bx, by, z0],
          [cx, cy, z0],
          [cx, cy, z1],
          [bx, by, z1],
          uy,
          -ux,
          0,
        );
        pushQuad(
          [dxp, dyp, z0],
          [ax, ay, z0],
          [ax, ay, z1],
          [dxp, dyp, z1],
          -uy,
          ux,
          0,
        );
      };

      let cursorX = 0;
      let cursorY = 0;
      for (let i = 0; i < cleanText.length; i++) {
        const ch = cleanText[i];
        if (ch === '\n') {
          cursorX = 0;
          cursorY -= size * 1.35;
          continue;
        }
        if (ch === ' ' || ch === '\t') {
          // A tab advances like four spaces.
          cursorX += charAdvance * (ch === ' ' ? 0.75 : 3);
          continue;
        }
        if (ch === '\r') continue;
        const upper = ch.toUpperCase();
        const isLower = ch !== upper && ch >= 'a' && ch <= 'z';
        const strokes = vectorGlyphStrokes[upper] ?? vectorGlyphStrokes['?'];
        const scaleY = isLower ? size * 0.76 : size;
        const scaleX = isLower ? charWidth * 0.88 : charWidth;

        for (const poly of strokes) {
          for (let s = 0; s < poly.length - 1; s++) {
            const p0 = poly[s];
            const p1 = poly[s + 1];
            addBoxSegment(
              cursorX + p0[0] * scaleX,
              cursorY + p0[1] * scaleY,
              cursorX + p1[0] * scaleX,
              cursorY + p1[1] * scaleY,
              strokeRadius,
              -depth * 0.5,
              depth * 0.5,
            );
          }
        }
        cursorX += isLower ? charAdvance * 0.88 : charAdvance;
      }

      setGeoBuffers(this, positions, normals, uvs, indices);

      if (options.center !== false) {
        this.center();
      } else {
        this.computeBoundingBox();
      }
    }
  }

  // tslint:disable-next-line:no-any Dynamic Object3D / Mesh node.
  function materializeDeclarativeGeometry(node: any): void {
    if (!node) return;
    const meshLike = node;
    const rawText =
      node.userData?.xr?.text ??
      node.userData?.xr?.label ??
      node.userData?.xr?.title ??
      node.userData?.xr?.caption ??
      node.userData?.xr?.spatialLabel;
    if (rawText !== undefined && rawText !== null && rawText !== false) {
      const existingPos = meshLike.geometry?.attributes?.position;
      // `_textApplied` stops a rebuild on every updateMatrixWorld when the
      // built text has no vertices (e.g. only whitespace in the first 128 chars).
      if (
        (!existingPos || existingPos.count === 0) &&
        node.userData['_textApplied'] !== true
      ) {
        let textStr = '';
        let size = 0.08;
        let depth = 0.015;
        let colorVal: string | number | undefined;
        if (typeof rawText === 'string' || typeof rawText === 'number') {
          textStr = String(rawText);
        } else if (typeof rawText === 'object') {
          const rec = rawText as Record<string, unknown>;
          textStr = String(rec['text'] ?? rec['value'] ?? '');
          if (rec['size'] !== undefined) size = Number(rec['size']) || 0.08;
          if (rec['depth'] !== undefined || rec['height'] !== undefined) {
            depth = Number(rec['depth'] ?? rec['height']) || size * 0.2;
          }
          if (
            typeof rec['color'] === 'string' ||
            typeof rec['color'] === 'number'
          ) {
            colorVal = rec['color'];
          }
        }
        if (textStr.trim().length > 0) {
          meshLike.geometry = new TextGeometry(textStr, {size, depth});
          node.userData['_textApplied'] = true;
          if (!(meshLike.material instanceof Material)) {
            meshLike.material = new MeshStandardMaterial({
              color: colorVal ?? 0xf8fafc,
            });
          } else if (
            colorVal !== undefined &&
            node.userData['_autoTextColorApplied'] !== true
          ) {
            meshLike.material.color = new Color(colorVal);
            node.userData['_autoTextColorApplied'] = true;
          }
        }
      }
    }

    const rawCsg = node.userData?.csg;
    if (
      rawCsg &&
      typeof rawCsg === 'object' &&
      node.userData['_csgApplied'] !== true &&
      meshLike.geometry instanceof BufferGeometry &&
      meshLike.geometry.attributes.position?.count > 0
    ) {
      node.userData['_csgApplied'] = true;
      const ops = Array.isArray(rawCsg) ? rawCsg : [rawCsg];
      const original = meshLike.geometry;
      for (const item of ops) {
        if (!item || typeof item !== 'object') continue;
        const rec = item as Record<string, unknown>;
        const opRaw = String(rec['op'] ?? rec['operation'] ?? 'subtract');
        const op: 'subtract' | 'union' | 'intersect' =
          opRaw === 'union' || opRaw === 'intersect' ? opRaw : 'subtract';
        const target = rec['target'] ?? rec['mesh'] ?? rec['geometry'];
        if (target instanceof Mesh || target instanceof BufferGeometry) {
          // One over-limit op must not abort the whole scene export: warn and
          // keep the current geometry.
          try {
            const res =
              op === 'union'
                ? CSG.union(meshLike, target)
                : op === 'intersect'
                  ? CSG.intersect(meshLike, target)
                  : CSG.subtract(meshLike, target);
            // Dispose intermediate results we created; the author's original
            // geometry may be shared by other meshes.
            if (meshLike.geometry !== original) meshLike.geometry.dispose?.();
            meshLike.geometry = res.geometry;
          } catch (e) {
            if (typeof console !== 'undefined') {
              console.warn('[three-live] userData.csg skipped:', e);
            }
          }
        }
      }
    }
  }

  const exportsMap = {
    Path,
    Shape,
    ShapeGeometry,
    ExtrudeGeometry,
    TextGeometry,
    CSG,
    MAX_CSG_TRIANGLES: maxCsgTriangles,
    MAX_BSP_DEPTH: maxBspDepth,
    MAX_TEXT_GEOMETRY_CHARS: maxTextGeometryChars,
    MAX_SHAPE_POINTS: maxShapePoints,
    materializeDeclarativeGeometry,
  };

  if (reg && typeof reg === 'object') {
    if (!reg.authorNamespace) {
      reg.authorNamespace = {};
    }
    Object.assign(reg.authorNamespace, exportsMap);
    reg._cadMaterialize = materializeDeclarativeGeometry;
    reg.materializeDeclarativeGeometry = (node: unknown) => {
      reg._cadMaterialize?.(node);
      reg._lodMaterialize?.(node);
    };
  }

  return exportsMap;
}

/**
 * `<three-live>` and `<xr-live>` plugin registering 2D `Path`/`Shape`,
 * ear-clipping triangulation (`ShapeGeometry`), `ExtrudeGeometry`, 3D BSP `CSG`
 * booleans, and stroke-font `TextGeometry` onto `THREE` and worker sandboxes.
 */
export const cadPlugin: ThreeLivePlugin = {
  name: 'cad',
  onRegister(): void {
    registerWorkerExtensionInstaller(installCadExtension);
    const reg = getSharedRegistry();
    const threeNs =
      reg.threeNamespace ??
      (typeof globalThis !== 'undefined'
        ? (globalThis as Record<string, unknown>)['THREE']
        : undefined);
    if (threeNs) {
      installCadExtension(threeNs, reg);
    }
  },
};
