# three-live

Lightweight `<three-live>` web component for 3D, AR, and sandboxed procedural
Three.js. Part of [Three-Live](https://github.com/google/three-live).

> Developer Preview. APIs may change before a stable release.

## Install

```sh
npm install three-live
```

Or load it from a CDN with a classic script tag:

```html
<script src="https://cdn.jsdelivr.net/npm/three-live/dist/three-live.min.js"></script>
```

## Usage

```html
<three-live allow-client-scripts camera-controls ar>
  <script type="text/three">
    scene.add(new THREE.Mesh(
      new THREE.TorusKnotGeometry(0.4, 0.14, 64, 16),
      new THREE.MeshStandardMaterial({color: 0x4285f4, metalness: 0.6, roughness: 0.2})
    ));
  </script>
</three-live>
```

Inline scripts run in a sandboxed worker and require the `allow-client-scripts`
opt-in. Server-generated scripts can be loaded with `script-src` instead. To
display existing models only, use the viewer-only build:

```html
<script src="https://cdn.jsdelivr.net/npm/three-live/dist/three-live-viewer.min.js"></script>
<three-live src="model.glb" camera-controls auto-rotate></three-live>
```

## Bundles

<!-- mdformat off(reason: preserve GFM single-line pipe tables for GitHub) -->
| File | Contents |
| :--- | :--- |
| `dist/three-live-viewer.min.js` | Viewer only: `.glb` display, PBR, orbit controls, animation |
| `dist/three-live.min.js` | Standard: viewer + sandboxed `<script type="text/three">` + AR handoff |
| `dist/three-live-studio.min.js` | Add-on: PBR Next, HDRI/SH, `bloom`/`outline`, `KHR_materials_variants`, `EXT_meshopt_compression`, `KHR_interactivity` VM, hotspots |
| `dist/three-live-cad.min.js` | Add-on: 2D `Path`/`Shape`, `ExtrudeGeometry`, 3D `CSG` Booleans, stroke-font `TextGeometry` |
| `dist/three-live-animation.min.js` | Add-on: 64-joint skinning, morph targets, keyframe cross-fading, 2-bone/FABRIK `IKSolver` |
| `dist/three-live-full.min.js` | Standard + all plugins (`studio`, `cad`, `animation`) |
<!-- mdformat on -->

ES module and CommonJS builds are available through the package `exports`.

## Documentation

See the [project README](https://github.com/google/three-live#readme) and
[docs](https://github.com/google/three-live/tree/main/docs).

## License

Apache 2.0. This is not an officially supported Google product.
