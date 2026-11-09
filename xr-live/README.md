# xr-live

HTML-first spatial computing on top of
[`three-live`](https://www.npmjs.com/package/three-live): 6DoF WebXR, hand
gestures, spatial HTML cards, and depth-aware physics. Part of
[Three-Live](https://github.com/google/three-live).

> Status: **Beta**. Minor API details may evolve before General Availability (GA).

## Install

```sh
npm install xr-live
```

Or load it from a CDN with a classic script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/xr-live/dist/xr-live.min.js"></script>
```

## Usage

```html
<xr-live allow-client-scripts xr-mode="inline-ar" camera-controls>
  <script type="text/three">
    const orb = new THREE.Mesh(
      new THREE.SphereGeometry(0.15, 32, 32),
      new THREE.MeshStandardMaterial({color: 0x38bdf8, metalness: 0.4, roughness: 0.2})
    );
    orb.position.set(0, 1.2, -0.8);
    orb.userData.xrTraits = ['grab', 'scale', 'billboard'];
    scene.add(orb);
  </script>
</xr-live>
```

## Bundles

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| File | Contents |
| :--- | :--- |
| `dist/xr-live-viewer.min.js` | Lean `.glb`/`.usdz` WebXR viewer with spatial traits |
| `dist/xr-live.min.js` | Standard: `<xr-live>` + sandboxed `<script type="text/three">` |
| `dist/xr-live-sensors.min.js` | Add-on: XR desktop simulator, hardware depth occlusion, heightfield physics, 25-joint hands, spatial audio, and WebMCP |
| `dist/xr-live-spatial.min.js` | Add-on: all 15 `XRSpatial` plugins (`head-follow`, `manipulation-handles`, `world-understanding`, `gemini-live`, `spatial-paint`, `depth-particles`, `splat-loader`, `spatial-measure`, `magnetic-snap`, `gaze-dwell`, `exploded-view`, `persistent-anchors`, `spatial-locomotion`, `shared-room`, `spatial-audio`) |
| `dist/xr-live-webgpu.min.js` | Add-on: opt-in WebGPU Gaussian Splatting compute & render accelerator (`@compute` 16-bit radix sort, fp16 Degree 1–3 SH, and instanced quad rasterizer) |
| `dist/xr-live-sim.min.js` | Add-on: the 6 `xr-live-sim` simulation plugins (`character-controller`, `steering-agents`, `rigid-body`, `hit-zones`, `objectives`, `synth-audio`) |
| `dist/xr-live-full.min.js` | Everything in one bundle (`three-live-full` + `xr-live` + `xr-live-sensors` + 15 spatial plugins + WebGPU splat accelerator + 6 simulation plugins) |
<!-- mdformat on -->

## Documentation

See the [project README](https://github.com/google/three-live#readme) and
[xr-live docs](https://github.com/google/three-live/blob/main/docs/xr-live.md).

## License

Apache 2.0. This is not an officially supported Google product.
