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

use three_live_compiler::{transcode_three_to_glb, validate_three_script};

#[test]
fn test_box_geometry_to_glb() {
    let script = r#"
        const geo = new THREE.BoxGeometry(2, 3, 4);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.3 });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
    "#;

    let glb_bytes = transcode_three_to_glb(script).expect("Transcoding failed");
    assert!(glb_bytes.len() >= 20);

    // Verify 12-byte header
    let magic = u32::from_le_bytes([glb_bytes[0], glb_bytes[1], glb_bytes[2], glb_bytes[3]]);
    let version = u32::from_le_bytes([glb_bytes[4], glb_bytes[5], glb_bytes[6], glb_bytes[7]]);
    let length = u32::from_le_bytes([glb_bytes[8], glb_bytes[9], glb_bytes[10], glb_bytes[11]]);

    assert_eq!(magic, 0x46546C67, "GLB magic mismatch");
    assert_eq!(version, 2, "GLB version mismatch");
    assert_eq!(length as usize, glb_bytes.len(), "GLB header length mismatch");

    // Chunk 0: JSON
    let json_chunk_len =
        u32::from_le_bytes([glb_bytes[12], glb_bytes[13], glb_bytes[14], glb_bytes[15]]) as usize;
    let json_chunk_type =
        u32::from_le_bytes([glb_bytes[16], glb_bytes[17], glb_bytes[18], glb_bytes[19]]);
    assert_eq!(json_chunk_type, 0x4E4F534A, "Chunk 0 should be JSON");

    let json_slice = &glb_bytes[20..20 + json_chunk_len];
    let gltf_json: serde_json::Value = serde_json::from_slice(json_slice).expect("Valid JSON");

    assert_eq!(gltf_json["asset"]["version"], "2.0");
    assert_eq!(gltf_json["meshes"].as_array().unwrap().len(), 1);
    assert_eq!(gltf_json["materials"].as_array().unwrap().len(), 1);
}

#[test]
fn test_torus_knot_scene() {
    let script = r#"
        const geo = new THREE.TorusKnotGeometry(10, 3, 100, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x6366f1, roughness: 0.2, metalness: 0.8 });
        scene.add(new THREE.Mesh(geo, mat));

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(5, 10, 7);
        scene.add(dirLight);
    "#;

    let scene = validate_three_script(script).expect("Validation should succeed");
    assert_eq!(scene.meshes.len(), 1);
    assert!(scene.meshes[0].positions.len() > 100);
    assert!(scene.meshes[0].indices.len() > 100);
    assert_eq!(scene.lights.len(), 1);

    let glb = transcode_three_to_glb(script).expect("Transcoding should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_multiple_primitives_in_scene() {
    let script = r#"
        const boxGeo = new THREE.BoxGeometry(1, 1, 1);
        const sphereGeo = new THREE.SphereGeometry(1, 16, 12);
        const cylinderGeo = new THREE.CylinderGeometry(0.5, 0.5, 2, 16);

        const mat1 = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const mat2 = new THREE.MeshStandardMaterial({ color: 0x0000ff });

        const m1 = new THREE.Mesh(boxGeo, mat1);
        m1.position.set(-2, 0, 0);

        const m2 = new THREE.Mesh(sphereGeo, mat2);
        m2.position.set(0, 0, 0);

        const m3 = new THREE.Mesh(cylinderGeo, mat1);
        m3.position.set(2, 0, 0);

        scene.add(m1);
        scene.add(m2);
        scene.add(m3);
    "#;

    let glb = transcode_three_to_glb(script).expect("Transcoding should succeed");
    assert!(!glb.is_empty());

    let scene = validate_three_script(script).expect("Validation should succeed");
    assert_eq!(scene.meshes.len(), 3);
}

#[test]
fn test_syntax_error_returns_err() {
    let script = "const x = ;";
    let res = transcode_three_to_glb(script);
    assert!(res.is_err());
}

#[test]
fn test_texture_mapping_scene() {
    let script = r#"
        const texture = new THREE.TextureLoader().load("/textures/wood_albedo.png");
        const mat = new THREE.MeshStandardMaterial({
            color: 0xffffff,
            map: texture,
            roughness: 0.4,
            metalness: 0.1
        });
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
    "#;

    let scene = validate_three_script(script).expect("Validation should succeed");
    assert_eq!(scene.materials.len(), 1);
    assert_eq!(scene.materials[0].base_color_texture.as_deref(), Some("/textures/wood_albedo.png"));

    let glb = transcode_three_to_glb(script).expect("Transcoding should succeed");
    assert!(!glb.is_empty());

    // Extract JSON chunk from GLB and check textures/images
    let json_chunk_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let gltf_json: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_chunk_len]).expect("Valid JSON");
    assert_eq!(gltf_json["textures"].as_array().unwrap().len(), 1);
    assert_eq!(gltf_json["images"].as_array().unwrap().len(), 1);
    assert_eq!(gltf_json["images"][0]["uri"], "/textures/wood_albedo.png");
    assert_eq!(gltf_json["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"], 0);
}

#[test]
fn test_thread_local_engine_isolation_and_reusability() {
    use three_live_compiler::{clear_thread_local_engine, set_thread_local_cache_enabled};

    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();

    // Script 1: Declares `const geometry` and adds a Box
    let script1 = r#"
        const geometry = new THREE.BoxGeometry(2, 2, 2);
        const material = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
    "#;
    let scene1 = validate_three_script(script1).expect("Script 1 should succeed");
    assert_eq!(scene1.meshes.len(), 1);
    assert_eq!(scene1.meshes[0].positions.len(), 24); // Box has 24 vertices (6 faces * 4)

    // Script 2: Declares the identical `const geometry` and adds a Sphere
    // Verifies lexical scope isolation: `const geometry` does not throw already declared error!
    let script2 = r#"
        const geometry = new THREE.SphereGeometry(1, 8, 6);
        const material = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);
    "#;
    let scene2 = validate_three_script(script2)
        .expect("Script 2 should succeed with identical const identifier");
    assert_eq!(
        scene2.meshes.len(),
        1,
        "Scene 2 should have exactly 1 mesh (no scene graph leakage from Script 1)"
    );

    clear_thread_local_engine();
    set_thread_local_cache_enabled(false);
}

#[test]
fn test_thread_local_prewarm_performance() {
    use three_live_compiler::{
        clear_thread_local_engine, prewarm_thread_local_engine, set_thread_local_cache_enabled,
    };

    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();

    // Pre-warm engine
    prewarm_thread_local_engine().expect("Prewarm should succeed");

    let script = r#"
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0x123456 });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let start = std::time::Instant::now();
    let glb =
        transcode_three_to_glb(script).expect("Transcoding on prewarmed engine should succeed");
    let elapsed = start.elapsed();
    assert!(!glb.is_empty());
    println!("⏱️ Prewarmed transcoding took: {:?}", elapsed);
    // Perf-regression tripwire, not a correctness assertion. An unoptimized build runs the
    // Boa interpreter roughly 25x slower than release and shared CI runners are slower
    // still, so the debug bound is deliberately loose; the release bound is the real one.
    #[cfg(debug_assertions)]
    const PREWARM_BUDGET_MS: u128 = 500;
    #[cfg(not(debug_assertions))]
    const PREWARM_BUDGET_MS: u128 = 250;

    assert!(
        elapsed.as_millis() < PREWARM_BUDGET_MS,
        "Prewarmed transcoding should be under {} ms, took {:?}",
        PREWARM_BUDGET_MS,
        elapsed
    );

    clear_thread_local_engine();
    set_thread_local_cache_enabled(false);
}

#[test]
fn test_torus_knot_prewarm_performance() {
    use three_live_compiler::{
        clear_thread_local_engine, prewarm_thread_local_engine, set_thread_local_cache_enabled,
    };

    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();

    let init_start = std::time::Instant::now();
    prewarm_thread_local_engine().expect("Prewarm should succeed");
    let init_elapsed = init_start.elapsed();
    eprintln!("⏱️ Prewarm (VM + Shim) took: {:?}", init_elapsed);

    let script = r#"
        const geometry = new THREE.TorusKnotGeometry(0.8, 0.25, 100, 16);
        const material = new THREE.MeshStandardMaterial({
          color: 0x6366f1,
          roughness: 0.3,
          metalness: 0.7
        });
        const mesh = new THREE.Mesh(geometry, material);
        scene.add(mesh);

        const light1 = new THREE.DirectionalLight(0xffffff, 1.5);
        light1.position.set(5, 10, 7);
        scene.add(light1);

        const light2 = new THREE.PointLight(0x38bdf8, 2.0, 10);
        light2.position.set(-4, -2, 2);
        scene.add(light2);

        const ambient = new THREE.AmbientLight(0xffffff, 0.4);
        scene.add(ambient);
    "#;

    let start = std::time::Instant::now();
    let _glb =
        transcode_three_to_glb(script).expect("Transcoding on prewarmed engine should succeed");
    let elapsed1 = start.elapsed();
    eprintln!("⏱️ First TorusKnot transcoding took: {:?}", elapsed1);

    let start2 = std::time::Instant::now();
    let _glb2 = transcode_three_to_glb(script).expect("Transcoding on warm engine should succeed");
    let elapsed2 = start2.elapsed();
    eprintln!("⏱️ Second TorusKnot transcoding took: {:?}", elapsed2);

    clear_thread_local_engine();
    set_thread_local_cache_enabled(false);
}

#[test]
fn test_sphere_geometry_native_acceleration() {
    let script = r#"
        const geo = new THREE.SphereGeometry(2, 32, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x10b981, roughness: 0.1 });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let scene = validate_three_script(script).expect("Sphere validation failed");
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(scene.meshes[0].positions.len(), (32 + 1) * (16 + 1));
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].normals.len());
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].uvs.len());

    let glb = transcode_three_to_glb(script).expect("Sphere transcoding to GLB failed");
    assert!(!glb.is_empty());
    let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
    assert_eq!(magic, 0x46546C67);
}

#[test]
fn test_cylinder_geometry_native_acceleration() {
    let script = r#"
        const geo = new THREE.CylinderGeometry(1, 2, 4, 32);
        const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9 });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let scene = validate_three_script(script).expect("Cylinder validation failed");
    assert_eq!(scene.meshes.len(), 1);
    assert_eq!(scene.meshes[0].positions.len(), (32 + 1) * 2);
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].normals.len());
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].uvs.len());

    let glb = transcode_three_to_glb(script).expect("Cylinder transcoding to GLB failed");
    assert!(!glb.is_empty());
    let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
    assert_eq!(magic, 0x46546C67);
}

#[test]
fn test_security_script_size_limit() {
    use three_live_compiler::SECURITY_3D_MAX_SCRIPT_BYTES;

    // Construct a script slightly larger than SECURITY_3D_MAX_SCRIPT_BYTES (1 MB)
    let padding = " ".repeat(SECURITY_3D_MAX_SCRIPT_BYTES + 10);
    let malicious_script = format!("// Large script payload\nconst x = 1;\n{}", padding);

    let res = transcode_three_to_glb(&malicious_script);
    assert!(res.is_err(), "Scripts exceeding max bytes must be rejected");
    let err = res.err().unwrap();
    assert!(
        err.contains("exceeds SECURITY_3D_MAX_SCRIPT_BYTES"),
        "Error message should mention SECURITY_3D_MAX_SCRIPT_BYTES, got: {}",
        err
    );
}

#[test]
fn test_security_vertex_quota_limit() {
    // TorusKnot with 400 tubularSegments and 300 radialSegments creates (400+1)*(300+1) = 120,701 vertices
    // exceeding SECURITY_3D_MAX_VERTICES (100,000).
    let script = r#"
        const geo = new THREE.TorusKnotGeometry(10, 3, 400, 300);
        const mat = new THREE.MeshBasicMaterial({ color: 0xffffff });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let res = transcode_three_to_glb(script);
    assert!(res.is_err(), "Exceeding vertex quota must be rejected");
    let err = res.err().unwrap();
    assert!(
        err.contains("SECURITY_3D_MAX_VERTICES") || err.contains("maximum allowed vertices"),
        "Error message should mention vertex quota, got: {}",
        err
    );
}

#[test]
fn test_security_mesh_quota_limit() {
    // Script adding 1,005 distinct meshes, exceeding SECURITY_3D_MAX_MESHES (1,000)
    let script = r#"
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff0000 });
        for (let i = 0; i < 1005; i++) {
            scene.add(new THREE.Mesh(geo, mat));
        }
    "#;

    let res = transcode_three_to_glb(script);
    assert!(res.is_err(), "Exceeding mesh quota must be rejected");
    let err = res.err().unwrap();
    assert!(
        err.contains("exceeds maximum allowed meshes")
            || err.contains("SECURITY_3D_EXECUTION_CEILING_MS"),
        "Error message should mention mesh quota or execution ceiling, got: {}",
        err
    );
}

#[test]
fn test_security_infinite_loop_protection() {
    // Infinite loop in script should trip Boa VM loop iteration limit
    let script = r#"
        while (true) {}
    "#;

    let res = transcode_three_to_glb(script);
    assert!(res.is_err(), "Infinite loop script must be aborted");
}

#[test]
fn test_panic_safety_and_engine_recovery() {
    use three_live_compiler::{clear_thread_local_engine, set_thread_local_cache_enabled};

    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();

    // 1. Trigger an error in the cached engine
    let bad_script = "throw new Error('Fatal error simulated');";
    let bad_res = transcode_three_to_glb(bad_script);
    assert!(bad_res.is_err());

    // 2. Subsequent call with valid script must succeed cleanly (engine was discarded and recreated)
    let good_script = r#"
        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
        scene.add(new THREE.Mesh(geo, mat));
    "#;
    let good_res = transcode_three_to_glb(good_script);
    assert!(good_res.is_ok(), "Engine must recover cleanly after prior failure");

    clear_thread_local_engine();
    set_thread_local_cache_enabled(false);
}

#[test]
fn test_three_author_math_features() {
    let script = r#"
        const q = new THREE.Quaternion().setFromAxisAngle(new THREE.Vector3(0, 1, 0), THREE.MathUtils.degToRad(90));
        const m = new THREE.Matrix4();
        m.makeRotationFromQuaternion(q);

        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshStandardMaterial({ color: 0x3b82f6 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.quaternion.copy(q);
        scene.add(mesh);
    "#;

    let scene = validate_three_script(script).expect("Math features validation should succeed");
    assert_eq!(scene.meshes.len(), 1);

    let glb =
        transcode_three_to_glb(script).expect("Transcoding with math features should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_three_author_universal_chaining_proxy() {
    let script = r#"
        // Accessing unsupported Three.js symbols should not throw reference or type errors
        const shadowMap = THREE.PCFSoftShadowMap;
        const renderer = new THREE.WebGLRenderer();
        renderer.shadowMap.enabled = true;
        renderer.shadowMap.type = shadowMap;

        const geo = new THREE.BoxGeometry(1, 1, 1);
        const mat = new THREE.MeshBasicMaterial({ color: 0xff00ff });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.castShadow = true;
        mesh.receiveShadow = true;
        scene.add(mesh);
    "#;

    let scene =
        validate_three_script(script).expect("Universal proxy script should succeed cleanly");
    assert_eq!(scene.meshes.len(), 1);

    let glb =
        transcode_three_to_glb(script).expect("Transcoding with universal proxy should succeed");
    assert!(!glb.is_empty());
}

fn verify_usdz_alignment(zip: &[u8]) -> usize {
    assert!(zip.len() >= 30, "ZIP buffer too small");
    let mut offset = 0;
    let mut entries_found = 0;
    while offset + 4 <= zip.len() {
        let sig =
            u32::from_le_bytes([zip[offset], zip[offset + 1], zip[offset + 2], zip[offset + 3]]);
        if sig == 0x04034b50 {
            entries_found += 1;
            let fn_len = u16::from_le_bytes([zip[offset + 26], zip[offset + 27]]) as usize;
            let extra_len = u16::from_le_bytes([zip[offset + 28], zip[offset + 29]]) as usize;
            let compressed_size = u32::from_le_bytes([
                zip[offset + 18],
                zip[offset + 19],
                zip[offset + 20],
                zip[offset + 21],
            ]) as usize;
            let payload_offset = offset + 30 + fn_len + extra_len;
            assert_eq!(
                payload_offset % 64,
                0,
                "Entry {} payload offset {} is not 64-byte aligned",
                entries_found,
                payload_offset
            );
            offset = payload_offset + compressed_size;
        } else {
            break;
        }
    }
    assert!(entries_found > 0, "No ZIP entries found");
    entries_found
}

#[test]
fn test_transcode_three_to_usdz() {
    use three_live_compiler::transcode_three_to_usdz;

    let script = r#"
        const geo = new THREE.BoxGeometry(1, 2, 3);
        const mat = new THREE.MeshStandardMaterial({ color: 0xff0000, roughness: 0.2, metalness: 0.8 });
        const mesh = new THREE.Mesh(geo, mat);
        scene.add(mesh);
    "#;

    let usdz_bytes = transcode_three_to_usdz(script).expect("USDZ transcoding should succeed");
    assert!(usdz_bytes.len() > 100);

    let entries = verify_usdz_alignment(&usdz_bytes);
    assert!(entries >= 1);
}

#[test]
fn test_transcode_glb_to_usdz() {
    use three_live_compiler::{transcode_glb_to_usdz, transcode_three_to_glb};

    let script = r#"
        const geo = new THREE.SphereGeometry(1, 16, 16);
        const mat = new THREE.MeshStandardMaterial({ color: 0x0000ff });
        scene.add(new THREE.Mesh(geo, mat));
    "#;

    let glb = transcode_three_to_glb(script).expect("GLB transcoding should succeed");
    let usdz = transcode_glb_to_usdz(&glb).expect("GLB to USDZ transcoding should succeed");
    assert!(usdz.len() > 100);

    let entries = verify_usdz_alignment(&usdz);
    assert!(entries >= 1);
}

#[test]
fn test_usdz_nested_hierarchy_and_transforms() {
    use three_live_compiler::transcode_three_to_usdz;

    let script = r#"
        const parent = new THREE.Group();
        parent.position.set(10, 0, 0);
        parent.scale.set(2, 2, 2);

        const child = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0x00ff00 })
        );
        child.position.set(0, 5, 0);
        parent.add(child);
        scene.add(parent);
    "#;

    let usdz_bytes =
        transcode_three_to_usdz(script).expect("Hierarchy USDZ compilation should succeed");
    assert!(usdz_bytes.len() > 100);
    verify_usdz_alignment(&usdz_bytes);
}

#[test]
fn test_vm_isolation_and_prototype_freezing() {
    use three_live_compiler::validate_three_script;

    // 1. Attempt IIFE breakout injection
    let breakout_script = "}}); globalThis.pwned = true; (() => {{";
    assert!(
        validate_three_script(breakout_script).is_err(),
        "IIFE breakout syntax should be rejected as invalid FunctionBody"
    );

    // 2. Script 1 attempts to pollute globalThis and Object.prototype
    let attacker_script = r#"
        globalThis.secret_token = "tenant_A_secret";
        try { Object.prototype.polluted_prop = "pwned"; } catch (_) {}
        try { THREE.Mesh.prototype.hacked = true; } catch (_) {}
        const g = new THREE.BoxGeometry(1, 1, 1);
        scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    "#;
    let _ = validate_three_script(attacker_script).expect("Attacker script should execute");

    // 3. Script 2 verifies complete isolation on the same worker thread
    let victim_script = r#"
        if (typeof globalThis.secret_token !== 'undefined') {
            throw new Error("Cross-request globalThis leakage detected!");
        }
        if (({}).polluted_prop !== undefined) {
            throw new Error("Object.prototype pollution detected!");
        }
        if (THREE.Mesh.prototype.hacked !== undefined) {
            throw new Error("THREE.Mesh.prototype pollution detected!");
        }
        const g = new THREE.BoxGeometry(1, 1, 1);
        scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    "#;
    validate_three_script(victim_script)
        .expect("Victim script should run in a clean, unpolluted environment");
}

#[test]
fn test_thread_local_cache_enabled_api() {
    use three_live_compiler::{
        clear_thread_local_engine, is_thread_local_cache_enabled, set_thread_local_cache_enabled,
        validate_three_script,
    };

    assert!(is_thread_local_cache_enabled());

    set_thread_local_cache_enabled(false);
    assert!(!is_thread_local_cache_enabled());

    let script = r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    "#;
    assert!(validate_three_script(script).is_ok());

    set_thread_local_cache_enabled(true);
    assert!(is_thread_local_cache_enabled());
    assert!(validate_three_script(script).is_ok());
    clear_thread_local_engine();
}

#[test]
fn test_usda_scene_graph_injection_sanitization() {
    use three_live_compiler::transcode_three_to_usdz;

    // Mesh name contains USDA syntax breakouts and external @asset@ reference
    let script = r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({ color: 0xff0000 });
        const mesh = new THREE.Mesh(g, m);
        mesh.name = ' Evil" (prepend references = @https://evil.com/payload.usd@) { } def Mesh "Fake ';
        scene.add(mesh);
    "#;

    let usdz = transcode_three_to_usdz(script).expect("USDZ transcoding should succeed safely");
    verify_usdz_alignment(&usdz);

    // Ensure the raw USDA string in the archive does NOT contain the unescaped @https:// reference
    let raw_str = String::from_utf8_lossy(&usdz);
    assert!(
        !raw_str.contains("@https://evil.com/payload.usd@"),
        "USDA injection payload must be stripped/sanitized from USDZ output"
    );
}

#[test]
fn test_out_of_bounds_index_and_nan_float_sanitization() {
    use three_live_compiler::transcode_three_to_glb;

    // 1. Out-of-bounds vertex index should be rejected
    let bad_index_script = r#"
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([0,0,0, 1,0,0, 0,1,0]), 3));
        g.setIndex(new THREE.BufferAttribute(new Uint32Array([0, 1, 999]), 1));
        scene.add(new THREE.Mesh(g, new THREE.MeshBasicMaterial()));
    "#;
    let res = transcode_three_to_glb(bad_index_script);
    assert!(
        res.is_err() && res.unwrap_err().contains("out of bounds"),
        "Out-of-bounds vertex index should be rejected"
    );

    // 2. NaN and Infinity floats in positions and material should be sanitized to valid JSON numbers
    let nan_script = r#"
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(new Float32Array([NaN, Infinity, -Infinity, 1, 0, 0, 0, 1, 0]), 3));
        const m = new THREE.MeshStandardMaterial({ roughness: NaN, metalness: Infinity });
        scene.add(new THREE.Mesh(g, m));
    "#;
    let glb =
        transcode_three_to_glb(nan_script).expect("NaN/Inf scene should sanitize and compile");
    assert!(glb.len() > 20);
    // Extract JSON chunk and ensure it contains no "null" values in min/max/factors
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let json_str = std::str::from_utf8(&glb[20..20 + json_len]).expect("Valid UTF-8 JSON chunk");
    assert!(
        !json_str.contains("null"),
        "GLB JSON chunk must not contain null for NaN/Infinity floats: {}",
        json_str
    );
}

#[test]
fn test_ssrf_texture_uri_rejection() {
    use three_live_compiler::transcode_three_to_glb;

    let ssrf_script = r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({
            map: new THREE.TextureLoader().load("http://169.254.169.254/latest/meta-data/")
        });
        scene.add(new THREE.Mesh(g, m));
    "#;
    let res = transcode_three_to_glb(ssrf_script);
    assert!(res.is_err(), "SSRF http:// texture URI should be rejected");

    let lfi_script = r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({
            map: new THREE.TextureLoader().load("file:///etc/passwd")
        });
        scene.add(new THREE.Mesh(g, m));
    "#;
    let res_lfi = transcode_three_to_glb(lfi_script);
    assert!(res_lfi.is_err(), "LFI file:// texture URI should be rejected");

    let traversal_script = r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({
            map: new THREE.TextureLoader().load("../../etc/shadow")
        });
        scene.add(new THREE.Mesh(g, m));
    "#;
    let res_trav = transcode_three_to_glb(traversal_script);
    assert!(res_trav.is_err(), "Path traversal ../ texture URI should be rejected");
}

// ---------------------------------------------------------------------------
// Regression tests for the compiler security & correctness audit.
// ---------------------------------------------------------------------------

/// Parses the glTF JSON chunk out of a GLB byte stream.
fn parse_gltf_json(glb: &[u8]) -> serde_json::Value {
    assert!(glb.len() >= 20, "GLB too short to contain a JSON chunk");
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let json_type = u32::from_le_bytes([glb[16], glb[17], glb[18], glb[19]]);
    assert_eq!(json_type, 0x4E4F534A, "Chunk 0 must be JSON");
    serde_json::from_slice(&glb[20..20 + json_len]).expect("JSON chunk must parse")
}

/// H-1: the execution ceiling must preempt, not merely report.
///
/// Boa's `loop_iteration_limit` lives on the `CallFrame` and resets for every
/// invocation, so a helper called in a loop multiplies the budgets. This exact script
/// previously ran to completion in 100.6 seconds against a 500 ms ceiling before any
/// check fired. The assertion that matters is the wall clock, not the error text: a
/// limit you only notice afterwards is not a limit.
#[test]
fn test_execution_deadline_preempts_runaway_script() {
    let script = r#"
        function burn() { let acc = 0; for (let i = 0; i < 200000; i++) { acc += i; } return acc; }
        let total = 0;
        for (let j = 0; j < 200; j++) { total += burn(); }
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshBasicMaterial()));
    "#;

    let start = std::time::Instant::now();
    let res = transcode_three_to_glb(script);
    let elapsed = start.elapsed();

    assert!(res.is_err(), "A runaway script must be rejected");

    // Generous bound relative to the debug ceiling (SECURITY_3D_EXECUTION_CEILING_MS): this
    // is guarding against the 100-second regression, not measuring scheduler jitter.
    assert!(
        elapsed.as_secs() < 30,
        "Deadline must preempt execution; script ran for {:?}",
        elapsed
    );
}

/// The deadline must not disturb ordinary scripts, and the engine must stay usable
/// after a script has been killed (`with_three_engine` discards the poisoned engine).
#[test]
fn test_engine_recovers_after_deadline() {
    let runaway = r#"
        function burn() { let acc = 0; for (let i = 0; i < 200000; i++) { acc += i; } return acc; }
        for (let j = 0; j < 200; j++) { burn(); }
    "#;
    assert!(transcode_three_to_glb(runaway).is_err(), "Runaway script must be rejected");

    let benign = r#"
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    "#;
    let glb = transcode_three_to_glb(benign)
        .expect("Engine must recover and compile normally after a deadline kill");
    let gltf = parse_gltf_json(&glb);
    assert_eq!(gltf["meshes"].as_array().unwrap().len(), 1);
}

/// M-1: a rejected texture URI longer than the 64-byte error preview must not panic
/// when the cut lands inside a multi-byte code point.
#[test]
fn test_multibyte_texture_uri_rejection_does_not_panic() {
    // 21 three-byte characters puts byte 64 inside the 22nd character.
    let padding = "日".repeat(30);
    let script = format!(
        r#"
        const g = new THREE.BoxGeometry(1, 1, 1);
        const m = new THREE.MeshStandardMaterial({{
            map: new THREE.TextureLoader().load("http://example.com/{}.png")
        }});
        scene.add(new THREE.Mesh(g, m));
        "#,
        padding
    );

    let res = transcode_three_to_glb(&script);
    assert!(res.is_err(), "Disallowed scheme must be rejected");
    let err = res.err().unwrap();
    assert!(
        err.contains("Disallowed texture URI"),
        "Must surface the real diagnostic rather than a generic panic message, got: {}",
        err
    );
}

/// M-2: every attribute accessor in a primitive must report the same `count`.
#[test]
fn test_attribute_accessor_counts_agree() {
    let script = r#"
        const geo = new THREE.SphereGeometry(1, 16, 12);
        scene.add(new THREE.Mesh(geo, new THREE.MeshStandardMaterial()));
    "#;
    let glb = transcode_three_to_glb(script).expect("Transcoding failed");
    let gltf = parse_gltf_json(&glb);

    let accessors = gltf["accessors"].as_array().expect("accessors present");
    for mesh in gltf["meshes"].as_array().expect("meshes present") {
        for prim in mesh["primitives"].as_array().expect("primitives present") {
            let attrs = prim["attributes"].as_object().expect("attributes present");
            let position_idx =
                attrs["POSITION"].as_u64().expect("POSITION accessor index") as usize;
            let expected = accessors[position_idx]["count"].as_u64().expect("POSITION count");

            for (name, idx) in attrs {
                let idx = idx.as_u64().expect("accessor index") as usize;
                let count = accessors[idx]["count"].as_u64().expect("accessor count");
                assert_eq!(
                    count, expected,
                    "glTF requires all attribute accessors in a primitive to share a count; \
                     {} has {} but POSITION has {}",
                    name, count, expected
                );
            }
        }
    }
}

/// L-8: `extract_float_buffer` must branch on `TypedArrayKind` before reinterpreting the
/// backing bytes. A `Float64Array` read as `f32` does not fail — it silently yields twice
/// as many meaningless values, which then flows into the glTF accessor counts and feeds
/// M-2. This pins both the widening and the rejection of non-float element types.
#[test]
fn test_float64_array_is_widened() {
    // 3 vertices x 3 components, authored as f64.
    let script = r#"
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(
            new Float64Array([0,0,0, 1,0,0, 0,1,0]), 3));
        scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
    "#;
    let glb = transcode_three_to_glb(script).expect("Float64Array geometry should compile");
    let gltf = parse_gltf_json(&glb);

    let accessors = gltf["accessors"].as_array().expect("accessors present");
    let attrs =
        gltf["meshes"][0]["primitives"][0]["attributes"].as_object().expect("attributes present");
    let pos = &accessors[attrs["POSITION"].as_u64().expect("POSITION index") as usize];

    // The bug reinterpreted 72 bytes as 18 f32s -> 6 vertices of garbage.
    assert_eq!(
        pos["count"].as_u64().expect("POSITION count"),
        3,
        "Float64Array must be widened element-wise, not reinterpreted as f32"
    );
    assert_eq!(
        pos["min"].as_array().expect("min present"),
        &vec![serde_json::json!(0.0), serde_json::json!(0.0), serde_json::json!(0.0)],
        "min must reflect the authored f64 values"
    );
    assert_eq!(
        pos["max"].as_array().expect("max present"),
        &vec![serde_json::json!(1.0), serde_json::json!(1.0), serde_json::json!(0.0)],
        "max must reflect the authored f64 values"
    );

    // A non-float element type must be rejected outright rather than reinterpreted.
    let bad = r#"
        const g = new THREE.BufferGeometry();
        g.setAttribute('position', new THREE.BufferAttribute(
            new Int16Array([0,0,0, 1,0,0, 0,1,0]), 3));
        scene.add(new THREE.Mesh(g, new THREE.MeshStandardMaterial()));
    "#;
    let err = transcode_three_to_glb(bad)
        .expect_err("A non-float typed array must not be reinterpreted as f32");
    assert!(
        err.contains("Float32Array or Float64Array"),
        "Expected an element-type diagnostic, got: {}",
        err
    );
}

/// M-3: a scene that builds no geometry must still emit schema-valid glTF. The spec
/// sets `minItems: 1` on every top-level array and requires `buffer.byteLength >= 1`,
/// so empty collections have to be omitted rather than written as `[]`.
#[test]
fn test_empty_scene_emits_valid_gltf() {
    let glb = transcode_three_to_glb("// builds nothing at all")
        .expect("An empty scene should compile rather than fail");
    let gltf = parse_gltf_json(&glb);

    assert_eq!(gltf["asset"]["version"], "2.0");

    for key in [
        "nodes",
        "meshes",
        "materials",
        "accessors",
        "bufferViews",
        "buffers",
        "textures",
        "images",
        "samplers",
    ] {
        if let Some(value) = gltf.get(key) {
            let arr = value.as_array().unwrap_or_else(|| panic!("{} must be an array", key));
            assert!(!arr.is_empty(), "{} must be omitted rather than emitted empty", key);
        }
    }

    if let Some(scene0) = gltf["scenes"].as_array().and_then(|s| s.first()) {
        if let Some(nodes) = scene0.get("nodes") {
            assert!(
                !nodes.as_array().expect("scene nodes array").is_empty(),
                "scenes[0].nodes must be omitted rather than emitted empty"
            );
        }
    }
}

/// L-9: PBR factors should serialize as the authored f32 value, not its f64 widening
/// (`0.10000000149011612`).
#[test]
fn test_material_factors_avoid_f64_widening_artifacts() {
    let script = r#"
        const mat = new THREE.MeshStandardMaterial({ roughness: 0.3, metalness: 0.1 });
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat));
    "#;
    let glb = transcode_three_to_glb(script).expect("Transcoding failed");
    let json_str = String::from_utf8_lossy(&glb).to_string();

    assert!(
        !json_str.contains("0.30000001") && !json_str.contains("0.10000000149011612"),
        "f32 factors must not serialize with f64 widening artifacts: {}",
        json_str.chars().take(1200).collect::<String>()
    );
}

/// H-1 (hardening): dynamic code evaluation must be unreachable from a user script.
///
/// The deadline is enforced by driving Boa's budgeted, yielding VM loop. Both the
/// `eval` builtin and the `Function` constructor run their body on the engine's
/// *synchronous* runner, which never yields — so if either stayed reachable, a script
/// could opt out of the deadline entirely by wrapping itself in one. The
/// `constructor` back-references matter just as much as the globals, since
/// `(function(){}).constructor` is an equally good handle on `Function`.
#[test]
fn test_dynamic_code_evaluation_is_blocked() {
    let escapes = [
        r#"eval("1 + 1");"#,
        r#"globalThis.eval("1 + 1");"#,
        r#"new Function("return 1")();"#,
        r#"Function("return 1")();"#,
        r#"(function () {}).constructor("return 1")();"#,
        r#"Object.getPrototypeOf(function () {}).constructor("return 1")();"#,
    ];

    for escape in escapes {
        let res = transcode_three_to_glb(escape);
        assert!(
            res.is_err(),
            "Dynamic code evaluation must be blocked, but `{}` succeeded",
            escape
        );
    }
}

/// The deadline must leave ordinary scripts alone. A normal scene is orders of
/// magnitude under the ceiling, so the budgeted evaluator must not be rejecting work
/// that the synchronous path used to accept.
#[test]
fn test_deadline_does_not_affect_normal_scripts() {
    let script = r#"
        for (let i = 0; i < 20; i++) {
            const geo = new THREE.BoxGeometry(1, 1, 1);
            const mat = new THREE.MeshStandardMaterial({ color: 0x00ff00 });
            const mesh = new THREE.Mesh(geo, mat);
            mesh.position.set(i, 0, 0);
            scene.add(mesh);
        }
    "#;

    let glb = transcode_three_to_glb(script).expect("A normal scene must compile");
    let gltf = parse_gltf_json(&glb);
    assert_eq!(gltf["meshes"].as_array().unwrap().len(), 20);
}

#[test]
fn test_xr_traits_and_animation_in_glb_and_usdz() {
    use three_live_compiler::compile_three_to_usdz;

    let script = r#"
        const geo = new THREE.BoxGeometry(0.4, 0.2, 0.6);
        const mat = new THREE.MeshStandardMaterial({ color: 0x4f46e5 });
        const sneaker = new THREE.Mesh(geo, mat);
        sneaker.name = "SneakerModel";
        sneaker.userData.xr = {
            grabbable: true,
            scalable: { min: 0.5, max: 2.5 },
            billboard: "capsule",
            anchor: "horizontal",
            physics: "dynamic",
            restitution: 0.75
        };
        scene.add(sneaker);

        function animate(t) {
            sneaker.position.y = Math.sin(t * 2.0) * 0.25;
        }
    "#;

    let glb =
        transcode_three_to_glb(script).expect("GLB compilation with userData.xr should succeed");
    let gltf = parse_gltf_json(&glb);
    let node0 = &gltf["nodes"][0];
    assert_eq!(node0["name"], "SneakerModel");
    assert_eq!(node0["extras"]["xr"]["grabbable"], true);
    assert_eq!(node0["extras"]["xr"]["billboard"], "capsule");
    assert_eq!(node0["extras"]["xr"]["anchor"], "horizontal");
    assert_eq!(node0["extensions"]["ANDROID_xr_scenecore"]["movable"]["systemMovable"], true);
    assert_eq!(node0["extensions"]["MOZ_hubs_components"]["grabbable"]["hand"], true);

    let usdz =
        compile_three_to_usdz(script).expect("USDZ compilation with userData.xr should succeed");
    let usdz_str = String::from_utf8_lossy(&usdz);
    assert!(
        usdz_str.contains("preliminary:anchoring:type = \"plane\""),
        "USDZ should include Apple QuickLook plane anchoring schema"
    );
    assert!(
        usdz_str.contains("PhysicsBodyAPI"),
        "USDZ should include UsdPhysics PhysicsBodyAPI schema"
    );
    assert!(usdz_str.contains("dictionary xr ="), "USDZ should include customData dictionary xr");
    assert!(
        usdz_str.contains("xformOp:translate.timeSamples"),
        "USDZ should bake procedural animate(t) into xformOp:translate.timeSamples"
    );
}

#[test]
fn test_unified_presets_compile_to_glb_and_usdz() {
    use three_live_compiler::compile_three_to_usdz;

    let presets: &[(&str, &str, usize)] = &[
        (
            "Quantum Core",
            r#"
            const core = new THREE.Mesh(
              new THREE.SphereGeometry(0.85, 32, 24),
              new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.92, roughness: 0.08 })
            );
            core.name = "QuantumCore";
            scene.add(core);

            const ring1 = new THREE.Mesh(
              new THREE.TorusGeometry(1.45, 0.09, 16, 64),
              new THREE.MeshStandardMaterial({ color: 0xa855f7, metalness: 0.85, roughness: 0.2 })
            );
            ring1.name = "InnerOrbitRing";
            ring1.rotation.x = 1.1;
            scene.add(ring1);

            const ring2 = new THREE.Mesh(
              new THREE.TorusGeometry(1.95, 0.06, 16, 64),
              new THREE.MeshStandardMaterial({ color: 0x10b981, metalness: 0.7, roughness: 0.3 })
            );
            ring2.name = "OuterOrbitRing";
            ring2.rotation.y = 0.9;
            ring2.rotation.z = 0.4;
            scene.add(ring2);

            const satGeo = new THREE.BoxGeometry(0.3, 0.3, 0.3);
            const satMat = new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.9, roughness: 0.15 });
            const sat1 = new THREE.Mesh(satGeo, satMat);
            sat1.name = "SensorArray_A";
            sat1.position.set(1.4, 0.5, 0);
            scene.add(sat1);

            const sat2 = new THREE.Mesh(satGeo, satMat);
            sat2.name = "SensorArray_B";
            sat2.position.set(-1.4, -0.5, 0);
            scene.add(sat2);

            const base = new THREE.Mesh(
              new THREE.CylinderGeometry(1.8, 2.0, 0.25, 32),
              new THREE.MeshStandardMaterial({ color: 0x334155, metalness: 0.4, roughness: 0.6 })
            );
            base.name = "PedestalBase";
            base.position.set(0, -1.6, 0);
            scene.add(base);
            "#,
            6,
        ),
        (
            "Torus Knot",
            r#"
            const mesh = new THREE.Mesh(
              new THREE.TorusKnotGeometry(0.9, 0.28, 128, 24),
              new THREE.MeshStandardMaterial({ color: 0xf43f5e, metalness: 0.95, roughness: 0.12 })
            );
            mesh.name = "RubyTorusKnot";
            scene.add(mesh);
            "#,
            1,
        ),
        (
            "Emerald Crystal",
            r#"
            const mesh = new THREE.Mesh(
              new THREE.CylinderGeometry(0.0, 1.2, 2.2, 6),
              new THREE.MeshStandardMaterial({ color: 0x06b6d4, metalness: 0.8, roughness: 0.15 })
            );
            mesh.name = "EmeraldGem";
            scene.add(mesh);
            "#,
            1,
        ),
        (
            "Orbital Spheres",
            r#"
            const colors = [0xef4444, 0xf59e0b, 0x10b981, 0x3b82f6, 0x8b5cf6];
            for (let i = 0; i < 5; i++) {
              const angle = (i / 5) * Math.PI * 2;
              const sphere = new THREE.Mesh(
                new THREE.SphereGeometry(0.45, 24, 16),
                new THREE.MeshStandardMaterial({ color: colors[i], metalness: 0.9, roughness: 0.2 })
              );
              sphere.name = "Sphere_" + (i + 1);
              sphere.position.set(Math.cos(angle) * 1.3, Math.sin(angle) * 0.4, Math.sin(angle) * 1.3);
              scene.add(sphere);
            }
            "#,
            5,
        ),
        (
            "Ballpit Lab",
            r#"
            const floor = new THREE.Mesh(
              new THREE.BoxGeometry(3.4, 0.08, 3.4),
              new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.35, metalness: 0.2 })
            );
            floor.name = 'Room_Floor';
            floor.position.set(0, -0.85, 0);
            scene.add(floor);

            const table = new THREE.Mesh(
              new THREE.CylinderGeometry(0.65, 0.55, 0.08, 32),
              new THREE.MeshStandardMaterial({ color: 0x0f172a, roughness: 0.2, metalness: 0.6 })
            );
            table.name = 'Pedestal_Table';
            table.position.set(0, -0.25, 0);
            scene.add(table);

            const palette = [0x38bdf8, 0xa855f7, 0x22c55e, 0xf59e0b, 0xec4899, 0x6366f1];
            for (let i = 0; i < 14; i++) {
              const radius = 0.11 + (i % 3) * 0.03;
              const ball = new THREE.Mesh(
                new THREE.SphereGeometry(radius, 24, 24),
                new THREE.MeshStandardMaterial({
                  color: palette[i % palette.length],
                  roughness: 0.18,
                  metalness: 0.25
                })
              );
              ball.name = 'Ball_' + (i + 1);
              const angle = (i / 14) * Math.PI * 2;
              const ring = 0.25 + (i % 4) * 0.18;
              ball.position.set(
                Math.cos(angle) * ring,
                0.35 + i * 0.14,
                Math.sin(angle) * ring
              );
              ball.userData.xr = {
                physics: 'dynamic',
                traits: ['grab', 'scale']
              };
              scene.add(ball);
            }
            "#,
            16,
        ),
        (
            "Spatial Workbench",
            r#"
            const base = new THREE.Mesh(
              new THREE.CylinderGeometry(0.9, 1.0, 0.08, 36),
              new THREE.MeshStandardMaterial({ color: 0x1e293b, roughness: 0.3, metalness: 0.5 })
            );
            base.name = 'Workbench_Pedestal';
            base.position.set(0, -0.65, 0);
            scene.add(base);

            const artifact = new THREE.Mesh(
              new THREE.TorusKnotGeometry(0.28, 0.085, 96, 20),
              new THREE.MeshStandardMaterial({ color: 0x38bdf8, roughness: 0.15, metalness: 0.75 })
            );
            artifact.name = 'Torus_Knot_Artifact';
            artifact.position.set(-0.45, 0.1, 0);
            artifact.userData.xr = {
              traits: ['grab', 'scale'],
              anchor: 'table'
            };
            scene.add(artifact);

            const gem = new THREE.Mesh(
              new THREE.CylinderGeometry(0, 0.24, 0.42, 6),
              new THREE.MeshStandardMaterial({ color: 0xa855f7, roughness: 0.2, metalness: 0.4 })
            );
            gem.name = 'Billboard_Gem';
            gem.position.set(0.45, 0.15, 0);
            gem.userData.xr = {
              traits: ['grab', 'billboard'],
              anchor: 'table'
            };
            scene.add(gem);

            const orb = new THREE.Mesh(
              new THREE.SphereGeometry(0.14, 24, 24),
              new THREE.MeshStandardMaterial({ color: 0x22c55e, roughness: 0.2, metalness: 0.3 })
            );
            orb.name = 'Dynamic_Orbiter';
            orb.position.set(0, 0.55, 0);
            orb.userData.xr = {
              physics: 'dynamic',
              traits: ['grab', 'scale']
            };
            scene.add(orb);
            "#,
            4,
        ),
        (
            "Gemini AI & Depth",
            r#"
            const depths = [
              { pos: [-0.55, -0.1, 0.55], color: 0x22c55e, h: 0.7 },
              { pos: [0.0, 0.0, 0.0], color: 0x38bdf8, h: 0.95 },
              { pos: [0.6, 0.1, -0.65], color: 0xa855f7, h: 1.2 }
            ];

            depths.forEach((d, idx) => {
              const pillar = new THREE.Mesh(
                new THREE.BoxGeometry(0.28, d.h, 0.28),
                new THREE.MeshStandardMaterial({ color: d.color, roughness: 0.25, metalness: 0.4 })
              );
              pillar.name = 'Depth_Pillar_' + (idx + 1);
              pillar.position.set(d.pos[0], d.pos[1], d.pos[2]);
              pillar.userData.xr = { traits: ['grab', 'scale'] };
              scene.add(pillar);
            });
            "#,
            3,
        ),
    ];

    for &(name, script, expected_meshes) in presets {
        let glb = transcode_three_to_glb(script)
            .unwrap_or_else(|e| panic!("Preset '{}' failed GLB compilation: {}", name, e));
        let gltf = parse_gltf_json(&glb);
        assert_eq!(
            gltf["meshes"].as_array().map(|m| m.len()).unwrap_or(0),
            expected_meshes,
            "Preset '{}' should produce {} meshes in GLB",
            name,
            expected_meshes
        );
        if name == "Spatial Workbench" {
            let artifact_node = &gltf["nodes"][1];
            assert_eq!(artifact_node["extras"]["xr"]["grabbable"], true);
            assert_eq!(artifact_node["extras"]["xr"]["scalable"], true);
            assert_eq!(
                artifact_node["extensions"]["ANDROID_xr_scenecore"]["movable"]["systemMovable"],
                true
            );
            let gem_node = &gltf["nodes"][2];
            assert_eq!(gem_node["extras"]["xr"]["billboard"], "capsule");
            assert_eq!(
                gem_node["extensions"]["ANDROID_xr_scenecore"]["billboard"]["mode"],
                "capsule"
            );
        }

        let usdz = compile_three_to_usdz(script)
            .unwrap_or_else(|e| panic!("Preset '{}' failed USDZ compilation: {}", name, e));
        verify_usdz_alignment(&usdz);
    }
}
