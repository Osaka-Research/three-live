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
fn test_warm_engine_blanks_top_level_var_and_function_declarations() {
    use three_live_compiler::{clear_thread_local_engine, set_thread_local_cache_enabled};

    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();
    // Top-level `var` / function declarations become non-configurable globals that `delete`
    // cannot remove, so a reused engine used to show them to the next scene.
    let polluter = r#"
        var leakedVar = 5;
        function leakedFn() { return 1; }
        globalThis.leakedProp = 7;
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    "#;
    validate_three_script(polluter).expect("polluter compiles");
    let checker = r#"
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        m.name = [typeof leakedVar, typeof leakedFn, typeof leakedProp].join(',');
        scene.add(m);
    "#;
    let scene = validate_three_script(checker).expect("checker compiles");
    assert_eq!(scene.nodes[0].name, "undefined,undefined,undefined");
    // Re-declaring the same names on the warm engine still works.
    validate_three_script(polluter).expect("re-declaring blanked globals compiles");

    clear_thread_local_engine();
    set_thread_local_cache_enabled(false);
}

#[test]
fn test_simulation_is_identical_on_warm_and_fresh_engines() {
    use three_live_compiler::{clear_thread_local_engine, set_thread_local_cache_enabled};

    let scene = br#"
        const floor = new THREE.Mesh(new THREE.BoxGeometry(10, 0.1, 10), new THREE.MeshStandardMaterial());
        floor.name = 'Floor'; floor.position.y = -0.05; floor.userData.xr = { collidable: true };
        scene.add(floor);
        const hero = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshStandardMaterial());
        hero.name = 'Hero'; hero.position.set(0, 0.5, 0); hero.userData.xr = { character: { speed: 3 } };
        scene.add(hero);
        const spinner = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.3, 0.3), new THREE.MeshStandardMaterial());
        spinner.name = 'Spinner'; spinner.position.set(2, 1, 0);
        scene.add(spinner);
        var phase = 0;
        function animate(t) { phase += 1; spinner.position.x = 2 + Math.sin(t); }
    "#;
    let actions: Vec<three_live_compiler::SimAction> = serde_json::from_str(
        r#"[{"at":0.1,"type":"moveCharacter","direction":[1,0,0],"duration":1.0}]"#,
    )
    .unwrap();
    let run = || {
        let (report, _) = three_live_compiler::simulate_scenario_from_source(
            scene,
            false,
            2.0,
            &actions,
            &[0, 30, 60, 120],
        )
        .unwrap();
        serde_json::to_string(&report).unwrap()
    };
    set_thread_local_cache_enabled(false);
    let fresh = run();
    set_thread_local_cache_enabled(true);
    clear_thread_local_engine();
    let warm1 = run();
    let warm2 = run();
    assert_eq!(fresh, warm1, "first warm run matches a fresh engine");
    assert_eq!(warm1, warm2, "reusing the warm engine is deterministic");

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
    assert_eq!(scene.meshes[0].positions.len(), (32 + 1) * 4 + 2);
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].normals.len());
    assert_eq!(scene.meshes[0].positions.len(), scene.meshes[0].uvs.len());

    let glb = transcode_three_to_glb(script).expect("Cylinder transcoding to GLB failed");
    assert!(!glb.is_empty());
    let magic = u32::from_le_bytes([glb[0], glb[1], glb[2], glb[3]]);
    assert_eq!(magic, 0x46546C67);
}

#[test]
fn test_box_and_cylinder_outward_ccw_winding() {
    let script = r#"
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(2, 4, 6), new THREE.MeshStandardMaterial()));
        scene.add(new THREE.Mesh(new THREE.CylinderGeometry(1, 2, 4, 16), new THREE.MeshStandardMaterial()));
    "#;

    let scene = validate_three_script(script).expect("Box/Cylinder validation failed");
    assert_eq!(scene.meshes.len(), 2);

    for (mesh_idx, mesh) in scene.meshes.iter().enumerate() {
        for tri in mesh.indices.chunks_exact(3) {
            let p0 = mesh.positions[tri[0] as usize];
            let p1 = mesh.positions[tri[1] as usize];
            let p2 = mesh.positions[tri[2] as usize];
            let n0 = mesh.normals[tri[0] as usize];

            let e1 = [p1[0] - p0[0], p1[1] - p0[1], p1[2] - p0[2]];
            let e2 = [p2[0] - p0[0], p2[1] - p0[1], p2[2] - p0[2]];
            let cross = [
                e1[1] * e2[2] - e1[2] * e2[1],
                e1[2] * e2[0] - e1[0] * e2[2],
                e1[0] * e2[1] - e1[1] * e2[0],
            ];
            let dot = cross[0] * n0[0] + cross[1] * n0[1] + cross[2] * n0[2];
            assert!(
                dot > 0.0,
                "Mesh {} triangle {:?} has inward/clockwise winding (dot = {})",
                mesh_idx,
                tri,
                dot
            );
        }
    }
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
    // TorusKnot with 400 tubularSegments and 300 radialSegments creates (400+1)*(300+1) = 120,701
    // vertices exceeding SECURITY_3D_MAX_VERTICES (100,000).
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

    // 2. Subsequent call with valid script must succeed cleanly (engine was discarded and
    //    recreated)
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

    // Issue #16: Verify binary GLB with embedded bufferView PNG texture (and omitted
    // baseColorFactor, as in Khronos BoxTextured.glb) packages texture_0.png and emits
    // UsdPrimvarReader_float2 + UsdUVTexture in transcode_glb_to_usdz.
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let mut gltf: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_len]).expect("Valid GLB JSON");
    let bin_header_off = 20 + json_len;
    let bin_len = u32::from_le_bytes([
        glb[bin_header_off],
        glb[bin_header_off + 1],
        glb[bin_header_off + 2],
        glb[bin_header_off + 3],
    ]) as usize;
    let orig_bin = &glb[bin_header_off + 8..bin_header_off + 8 + bin_len];
    let fake_png: &[u8] = &[
        0x89, 0x50, 0x4E, 0x47, 0x0D, 0x0A, 0x1A, 0x0A, 0x00, 0x00, 0x00, 0x0D, 0x49, 0x48, 0x44,
        0x52,
    ];
    let mut new_bin = Vec::with_capacity(orig_bin.len() + fake_png.len());
    new_bin.extend_from_slice(orig_bin);
    new_bin.extend_from_slice(fake_png);
    while new_bin.len() % 4 != 0 {
        new_bin.push(0);
    }

    let bvs = gltf["bufferViews"].as_array_mut().unwrap();
    let png_bv_idx = bvs.len();
    bvs.push(serde_json::json!({
        "buffer": 0,
        "byteOffset": orig_bin.len(),
        "byteLength": fake_png.len()
    }));
    gltf["buffers"][0]["byteLength"] = serde_json::json!(new_bin.len());
    gltf["images"] = serde_json::json!([{
        "bufferView": png_bv_idx,
        "mimeType": "image/png"
    }]);
    gltf["textures"] = serde_json::json!([{ "source": 0 }]);
    gltf["materials"] = serde_json::json!([{
        "name": "BoxTexturedMat",
        "pbrMetallicRoughness": {
            "baseColorTexture": { "index": 0 },
            "metallicFactor": 0.0,
            "roughnessFactor": 0.5
        }
    }]);

    let mut json_bytes = serde_json::to_vec(&gltf).unwrap();
    while json_bytes.len() % 4 != 0 {
        json_bytes.push(b' ');
    }
    let total_len = 12 + 8 + json_bytes.len() + 8 + new_bin.len();
    let mut textured_glb = Vec::with_capacity(total_len);
    textured_glb.extend_from_slice(&0x46546C67u32.to_le_bytes());
    textured_glb.extend_from_slice(&2u32.to_le_bytes());
    textured_glb.extend_from_slice(&(total_len as u32).to_le_bytes());
    textured_glb.extend_from_slice(&(json_bytes.len() as u32).to_le_bytes());
    textured_glb.extend_from_slice(&0x4E4F534Au32.to_le_bytes());
    textured_glb.extend_from_slice(&json_bytes);
    textured_glb.extend_from_slice(&(new_bin.len() as u32).to_le_bytes());
    textured_glb.extend_from_slice(&0x004E4942u32.to_le_bytes());
    textured_glb.extend_from_slice(&new_bin);

    let textured_usdz =
        transcode_glb_to_usdz(&textured_glb).expect("Textured GLB to USDZ should succeed");
    let tex_entries = verify_usdz_alignment(&textured_usdz);
    assert_eq!(tex_entries, 2, "Textured GLB USDZ must contain model.usda and texture_0.png");
    let textured_usda_str = String::from_utf8_lossy(&textured_usdz);
    assert!(textured_usda_str.contains("UsdPrimvarReader_float2"));
    assert!(textured_usda_str.contains("UsdUVTexture"));
    assert!(textured_usda_str.contains("asset inputs:file = @texture_0.png@"));
    assert!(textured_usda_str.contains(
        "color3f inputs:diffuseColor.connect = </Root/Materials/BoxTexturedMat/DiffuseTexture.outputs:rgb>"
    ));
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

    // 2. NaN and Infinity floats in positions and material should be sanitized to valid JSON
    //    numbers
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
              { pos: [-0.55, -0.125, 0.55], color: 0x22c55e, h: 0.7 },
              { pos: [0.0, 0.0, 0.0], color: 0x38bdf8, h: 0.95 },
              { pos: [0.6, 0.125, -0.65], color: 0xa855f7, h: 1.2 }
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

#[test]
fn test_khr_interactivity_and_xr_spatial_traits_in_glb_and_usdz() {
    use three_live_compiler::compile_three_to_usdz;

    let script = r#"
        const lamp = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, 0.2),
            new THREE.MeshStandardMaterial({ color: 0xffcc00 })
        );
        lamp.name = "Lamp";
        lamp.userData.xr = {
            grab: true,
            follow: { mode: "head", distance: 99, deadzoneDeg: 20 },
            handles: { minScale: 0.5, maxScale: 3 },
            particles: { preset: "snow", count: 1e9 },
            holdToAsk: { prompt: "What lamp is this?" },
            orbit: { target: "Sun", radius: 0.4, speed: 0.6 },
            splatUrl: "https://example.com/room.spz",
            restitution: 0.4
        };
        lamp.userData.interactivity = { onSelect: { action: "toggleVisibility" } };
        scene.add(lamp);

        const other = new THREE.Mesh(
            new THREE.SphereGeometry(0.1, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0x00ccff })
        );
        other.name = "Other";
        other.userData.xr = { follow: "hand-left" };
        scene.add(other);
    "#;

    let glb = transcode_three_to_glb(script).expect("GLB with extended XR traits should compile");
    let gltf = parse_gltf_json(&glb);

    // KHR_interactivity is compiled with the shared TS compiler and declared.
    let used: Vec<&str> =
        gltf["extensionsUsed"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert!(used.contains(&"KHR_interactivity"), "extensionsUsed: {:?}", used);
    let graph = &gltf["extensions"]["KHR_interactivity"];
    assert!(graph.is_object(), "root KHR_interactivity extension must be present");
    let graph_json = graph.to_string();
    assert!(
        graph_json.contains("pointer/onSelect"),
        "onSelect event node expected: {}",
        graph_json
    );
    assert!(
        graph_json.contains("/nodes/0/extensions/KHR_node_visibility/visible"),
        "toggleVisibility must target node 0: {}",
        graph_json
    );

    // Canonical normalized traits (clamped identically on every platform).
    let lamp = &gltf["nodes"][0];
    let xr = &lamp["extras"]["xr"];
    assert_eq!(xr["grab"], "2-hand");
    assert_eq!(xr["grabbable"], true);
    assert_eq!(xr["follow"]["lazy"], true);
    assert_eq!(xr["follow"]["distance"], 10.0);
    assert_eq!(xr["particles"]["count"], 2000);
    assert_eq!(xr["particles"]["preset"], "snow");
    assert_eq!(xr["handles"]["maxScale"], 3.0);
    assert_eq!(xr["restitution"], 0.4, "unknown authored keys are preserved");

    let core = &lamp["extensions"]["ANDROID_xr_scenecore"];
    assert_eq!(core["movable"]["systemMovable"], true);
    assert_eq!(core["follow"]["target"], "head");
    assert_eq!(core["follow"]["deadzoneDeg"], 20.0);
    assert_eq!(core["resizable"]["minScale"], 0.5);
    assert_eq!(core["particles"]["count"], 2000);
    assert_eq!(core["holdToAsk"]["prompt"], "What lamp is this?");
    assert_eq!(core["orbit"]["target"], "Sun");
    assert_eq!(core["splat"]["url"], "https://example.com/room.spz");

    let other = &gltf["nodes"][1];
    assert_eq!(other["extras"]["xr"]["follow"], "hand-left", "eager follow stays a string");
    assert_eq!(other["extensions"]["ANDROID_xr_scenecore"]["follow"]["lazy"], false);

    // USDZ carries the flattened canonical traits for RealityKit.
    let usdz = compile_three_to_usdz(script).expect("USDZ with extended XR traits should compile");
    let usdz_str = String::from_utf8_lossy(&usdz);
    for needle in [
        "double followDistance = 10",
        "bool handles = true",
        "double handlesMaxScale = 3",
        "string particlesPreset = \"snow\"",
        "double particlesCount = 2000",
        "bool holdToAsk = true",
        "string splatUrl = \"https://example.com/room.spz\"",
        "string follow = \"hand-left\"",
    ] {
        assert!(usdz_str.contains(needle), "USDZ customData should contain `{}`", needle);
    }
}

#[test]
fn test_scene_level_raw_khr_interactivity_graph_passthrough() {
    let script = r#"
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        scene.add(box);
        scene.userData.interactivity = JSON.parse(
            '{"declarations":[{"op":"event/onStart"}],"nodes":[{"declaration":0}],' +
            '"__proto__":{"polluted":true}}'
        );
    "#;
    let glb = transcode_three_to_glb(script).expect("raw graph scene should compile");
    let gltf = parse_gltf_json(&glb);
    let graph = gltf["extensions"]["KHR_interactivity"].to_string();
    assert!(graph.contains("event/onStart"), "raw graph declarations preserved: {}", graph);
    assert!(!graph.contains("polluted"), "prototype keys must be stripped: {}", graph);
}

#[test]
fn test_scene_without_interactivity_has_no_extension() {
    let glb = transcode_three_to_glb(
        "scene.add(new THREE.Mesh(new THREE.BoxGeometry(1,1,1), new THREE.MeshStandardMaterial()));",
    )
    .expect("plain scene should compile");
    let gltf = parse_gltf_json(&glb);
    assert!(gltf.get("extensions").is_none(), "no root extensions without interactivity");
}

#[test]
fn test_scripts_cannot_replace_the_trait_serializer() {
    use three_live_compiler::compile_three_to_usdz;

    // Script A tries to swap the USD serializer on the shared registry.
    let attacker = r#"
        try {
            globalThis.__THREE_LIVE_REGISTRY__.xrTraitSerializer = {
                gltfNode() {},
                usdLines: () => ['}}) def "Injected" (prepend references = @https://evil/x.usd@) {'],
            };
        } catch (e) {}
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    "#;
    let _ = compile_three_to_usdz(attacker);

    // Script B on the same (cached) engine must not see the payload.
    let victim = r#"
        const m = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        m.userData.xr = { grab: true };
        scene.add(m);
    "#;
    let usdz = compile_three_to_usdz(victim).expect("victim scene should compile");
    let text = String::from_utf8_lossy(&usdz);
    assert!(!text.contains("Injected"), "serializer swap must not leak across compiles");
    assert!(text.contains("string grab = \"2-hand\""), "canonical serializer still active");
}

#[test]
fn test_empty_mesh_does_not_shift_interactivity_node_indices() {
    let script = r#"
        scene.add(new THREE.Mesh(new THREE.BufferGeometry(), new THREE.MeshStandardMaterial()));
        const target = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        target.name = "Target";
        target.position.set(2, 0, 0);
        target.userData.interactivity = { onSelect: { action: "toggleVisibility" } };
        scene.add(target);
        const button = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        button.name = "Button";
        button.userData.interactivity = { onSelect: { action: "toggleVisibility", target: "Target" } };
        scene.add(button);
    "#;
    let glb = transcode_three_to_glb(script).expect("scene should compile");
    let gltf = parse_gltf_json(&glb);
    let nodes = gltf["nodes"].as_array().unwrap();
    let target_idx = nodes.iter().position(|n| n["name"] == "Target").expect("Target node");
    assert_eq!(nodes[target_idx]["translation"], serde_json::json!([2.0, 0.0, 0.0]));
    let graph = gltf["extensions"]["KHR_interactivity"].to_string();
    let ptr = format!("/nodes/{}/extensions/KHR_node_visibility/visible", target_idx);
    assert_eq!(
        graph.matches(&ptr).count(),
        2,
        "both actions target Target by index/name: {}",
        graph
    );
    let used: Vec<&str> =
        gltf["extensionsUsed"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    assert!(used.contains(&"KHR_node_visibility"), "extensionsUsed: {:?}", used);
}

/// Rounds every number to 1e-5 (native f32 vs web f64) and folds `-0` into `0`;
/// mirrors `canon` in `three-live/tests/hierarchy_parity_test.ts`.
fn canon_parity(v: &serde_json::Value) -> serde_json::Value {
    use serde_json::Value;
    match v {
        Value::Number(n) => {
            let r = (n.as_f64().unwrap_or(0.0) * 1e5).round() / 1e5;
            serde_json::json!(if r == 0.0 { 0.0 } else { r })
        }
        Value::Array(a) => Value::Array(a.iter().map(canon_parity).collect()),
        Value::Object(o) => {
            Value::Object(o.iter().map(|(k, v)| (k.clone(), canon_parity(v))).collect())
        }
        other => other.clone(),
    }
}

/// Exporter-neutral glTF projection; mirrors `project` in
/// `three-live/tests/hierarchy_parity_test.ts`.
fn project_parity(gltf: &serde_json::Value) -> serde_json::Value {
    use serde_json::{json, Value};
    let or = |v: &Value, d: Value| if v.is_null() { d } else { v.clone() };
    let empty = Vec::new();
    let nodes: Vec<Value> = gltf["nodes"]
        .as_array()
        .unwrap_or(&empty)
        .iter()
        .map(|n| {
            let mesh = n["mesh"].as_u64();
            let material = match mesh {
                Some(m) => gltf["meshes"][m as usize]["primitives"][0]["material"].clone(),
                None => Value::Null,
            };
            json!({
                "name": or(&n["name"], json!("")),
                "children": or(&n["children"], json!([])),
                "translation": or(&n["translation"], json!([0, 0, 0])),
                "rotation": or(&n["rotation"], json!([0, 0, 0, 1])),
                "scale": or(&n["scale"], json!([1, 1, 1])),
                "mesh": mesh.is_some(),
                "material": material,
                "xr": n["extras"]["xr"].clone(),
                "hubs": n["extensions"]["MOZ_hubs_components"].clone(),
                "scenecore": n["extensions"]["ANDROID_xr_scenecore"].clone(),
            })
        })
        .collect();
    canon_parity(&json!({
        "sceneNodes": or(&gltf["scenes"][0]["nodes"], json!([])),
        "nodes": nodes,
        "interactivity": gltf["extensions"]["KHR_interactivity"].clone(),
    }))
}

/// Cross-exporter parity: the native GLB must describe exactly the node list
/// `sceneToCanvas3D` produces for the same script (same DFS order, names,
/// hierarchy, local TRS, mesh/material references, XR extras/extensions and
/// KHR_interactivity node indices). The expected JSON is generated from the web
/// exporter by `three-live/tests/hierarchy_parity_test.ts`, which also fails if
/// the web side drifts from it, so both exporters are pinned to one fixture.
#[test]
fn test_hierarchy_matches_web_exporter_fixture() {
    let script = include_str!("fixtures/hierarchy_parity.js");
    let expected: serde_json::Value =
        serde_json::from_str(include_str!("fixtures/hierarchy_parity.expected.json"))
            .expect("fixture parses");
    let glb = transcode_three_to_glb(script).expect("parity scene should compile");
    let gltf = parse_gltf_json(&glb);
    let actual = project_parity(&gltf);
    assert_eq!(
        actual,
        canon_parity(&expected),
        "native GLB diverges from the web exporter fixture:\n{}",
        serde_json::to_string_pretty(&actual).unwrap()
    );
}

/// Groups now carry traits and behaviors (they used to be dropped with a
/// warning in native builds).
#[test]
fn test_traits_and_interactivity_on_group() {
    let script = r#"
        const group = new THREE.Group();
        group.name = "Handle";
        group.userData.xr = { grab: true };
        group.userData.interactivity = { onSelect: { action: "toggleVisibility" } };
        const child = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial());
        child.name = "Body";
        group.add(child);
        scene.add(group);
    "#;
    let glb = transcode_three_to_glb(script).expect("group traits should compile");
    let gltf = parse_gltf_json(&glb);
    let nodes = gltf["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 2);
    let group = &nodes[0];
    assert_eq!(group["name"], "Handle");
    assert!(group.get("mesh").is_none(), "a group has no mesh");
    assert_eq!(group["children"], serde_json::json!([1]));
    assert_eq!(group["extras"]["xr"]["grabbable"], true);
    assert_eq!(group["extensions"]["ANDROID_xr_scenecore"]["movable"]["systemMovable"], true);
    assert_eq!(group["extensions"]["MOZ_hubs_components"]["grabbable"]["hand"], true);
    assert_eq!(nodes[1]["name"], "Body");
    assert!(nodes[1]["mesh"].is_u64());
    assert_eq!(gltf["scenes"][0]["nodes"], serde_json::json!([0]));

    let graph = gltf["extensions"]["KHR_interactivity"].to_string();
    assert!(graph.contains("\"nodeIndex\":0"), "onSelect bound to the group: {}", graph);
    assert!(graph.contains("/nodes/0/extensions/KHR_node_visibility/visible"), "{}", graph);
    let used: Vec<&str> =
        gltf["extensionsUsed"].as_array().unwrap().iter().filter_map(|v| v.as_str()).collect();
    for ext in
        ["KHR_interactivity", "KHR_node_visibility", "MOZ_hubs_components", "ANDROID_xr_scenecore"]
    {
        assert!(used.contains(&ext), "{} missing from extensionsUsed: {:?}", ext, used);
    }
}

/// Extracts the first `point3f[] points = [...]` array of a (stored) USDZ.
fn usdz_points(usdz: &[u8]) -> Vec<[f32; 3]> {
    let text = String::from_utf8_lossy(usdz);
    let start = text.find("points = [").expect("USDA points") + "points = [".len();
    let end = start + text[start..].find(']').expect("points end");
    text[start..end]
        .split(')')
        .filter_map(|tuple| {
            let nums: Vec<f32> = tuple
                .trim_start_matches([',', ' ', '('])
                .split(',')
                .filter_map(|s| s.trim().parse().ok())
                .collect();
            (nums.len() == 3).then(|| [nums[0], nums[1], nums[2]])
        })
        .collect()
}

/// A rotated parent preserves its local TRS hierarchy and local mesh vertices
/// in both GLB and USDZ.
#[test]
fn test_rotated_parent_world_transform_in_glb_and_usdz() {
    use three_live_compiler::compile_three_to_usdz;

    let script = r#"
        const parent = new THREE.Group();
        parent.name = "Turntable";
        parent.position.set(10, 0, 0);
        parent.rotation.set(0, 0, Math.PI / 2);
        const geo = new THREE.BufferGeometry();
        geo.setAttribute("position", new THREE.BufferAttribute(new Float32Array([1, 0, 0, 0, 1, 0, 0, 0, 1]), 3));
        const tri = new THREE.Mesh(geo, new THREE.MeshStandardMaterial());
        tri.name = "Tri";
        tri.position.set(1, 0, 0);
        parent.add(tri);
        scene.add(parent);
    "#;

    let gltf = parse_gltf_json(&transcode_three_to_glb(script).expect("GLB should compile"));
    let nodes = gltf["nodes"].as_array().unwrap();
    assert_eq!(nodes[0]["name"], "Turntable");
    assert_eq!(nodes[0]["children"], serde_json::json!([1]));
    let rot: Vec<f64> =
        nodes[0]["rotation"].as_array().unwrap().iter().map(|v| v.as_f64().unwrap()).collect();
    let h = std::f64::consts::FRAC_1_SQRT_2;
    for (got, want) in rot.iter().zip([0.0, 0.0, h, h]) {
        assert!((got - want).abs() < 1e-6, "parent rotation {:?}", rot);
    }
    assert_eq!(nodes[1]["translation"], serde_json::json!([1.0, 0.0, 0.0]));
    assert!(nodes[1].get("rotation").is_none(), "child keeps its local (identity) rotation");

    let usdz = compile_three_to_usdz(script).expect("USDZ should compile");
    let usda = String::from_utf8_lossy(&usdz);
    assert!(usda.contains("def Xform \"Turntable\""), "USDZ preserves parent Xform: {}", usda);
    assert!(usda.contains("xformOp:translate = (10.0, 0, 0)"), "parent local translate: {}", usda);
    assert!(
        usda.contains("xformOp:orient = (0.70711, 0, 0, 0.70711)"),
        "parent local orient: {}",
        usda
    );
    assert!(usda.contains("def Mesh \"Tri\""), "USDZ preserves child Mesh: {}", usda);
    assert!(usda.contains("MaterialBindingAPI"), "Mesh applies MaterialBindingAPI: {}", usda);
    assert!(usda.contains("xformOp:translate = (1.0, 0, 0)"), "child local translate: {}", usda);

    let points = usdz_points(&usdz);
    let expected = [[1.0, 0.0, 0.0], [0.0, 1.0, 0.0], [0.0, 0.0, 1.0]];
    assert_eq!(points.len(), 3, "points: {:?}", points);
    for (p, e) in points.iter().zip(expected) {
        for c in 0..3 {
            assert!(
                (p[c] - e[c]).abs() < 1e-4,
                "local-space points {:?} != {:?}",
                points,
                expected
            );
        }
    }
}

/// Deep nesting must not hit the VM recursion limit, and a parent/child cycle
/// wired by hand must not hang or duplicate nodes.
#[test]
fn test_deep_and_cyclic_hierarchies_are_bounded() {
    let deep = r#"
        let parent = scene;
        for (let i = 0; i < 300; i++) {
            const g = new THREE.Group();
            g.position.x = 0.01;
            parent.add(g);
            parent = g;
        }
        parent.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    "#;
    let gltf = parse_gltf_json(&transcode_three_to_glb(deep).expect("deep hierarchy compiles"));
    let nodes = gltf["nodes"].as_array().unwrap();
    assert_eq!(nodes.len(), 301);
    assert_eq!(nodes[299]["children"], serde_json::json!([300]));
    assert!(nodes[300]["mesh"].is_u64());
    let deep_usdz =
        three_live_compiler::compile_three_to_usdz(deep).expect("deep USDZ hierarchy compiles");
    assert!(String::from_utf8_lossy(&deep_usdz).contains("def Xform \"Group_299\""));

    let cyclic = r#"
        const a = new THREE.Group(); a.name = "A";
        const b = new THREE.Group(); b.name = "B";
        scene.add(a);
        a.add(b);
        b.children.push(a);
    "#;
    let gltf = parse_gltf_json(&transcode_three_to_glb(cyclic).expect("cycle compiles"));
    let names: Vec<&str> =
        gltf["nodes"].as_array().unwrap().iter().filter_map(|n| n["name"].as_str()).collect();
    assert_eq!(names, ["A", "B"]);
    assert!(gltf["nodes"][1].get("children").is_none(), "the back edge is dropped");
    let cyclic_usdz =
        three_live_compiler::compile_three_to_usdz(cyclic).expect("cyclic USDZ compiles");
    let cyclic_usda = String::from_utf8_lossy(&cyclic_usdz);
    assert!(cyclic_usda.contains("def Xform \"A\"") && cyclic_usda.contains("def Xform \"B\""));
}

#[test]
fn test_node_quota_limit() {
    // Fully constructed Groups are too slow to build 4001 of within the
    // execution ceiling, so use bare prototype instances: this also checks
    // that half-initialized hostile objects (no position/children) are safe.
    let script = r#"
        for (let i = 0; i < 4001; i++) scene.children.push(Object.create(THREE.Group.prototype));
    "#;
    let err = transcode_three_to_glb(script).expect_err("node quota must be enforced");
    assert!(err.contains("maximum allowed nodes"), "unexpected error: {}", err);
}

/// A hand-built SceneGraph cannot describe a cycle or reference a missing mesh.
#[test]
fn test_glb_writer_rejects_invalid_hierarchy_links() {
    use three_live_compiler::scene::{SceneGraph, SceneNode};
    let scene = SceneGraph {
        nodes: vec![
            SceneNode { name: "Root".into(), parent: Some(1), mesh: Some(7), ..Default::default() },
            SceneNode {
                name: "Child".into(),
                parent: Some(0),
                rotation: [f32::NAN, 0.0, 0.0, 1.0],
                translation: [f32::INFINITY, 1.0, 0.0],
                ..Default::default()
            },
        ],
        ..Default::default()
    };
    let gltf = parse_gltf_json(&three_live_compiler::write_glb(&scene).expect("GLB"));
    assert_eq!(gltf["scenes"][0]["nodes"], serde_json::json!([0]), "forward parent -> root");
    assert_eq!(gltf["nodes"][0]["children"], serde_json::json!([1]));
    assert!(gltf["nodes"][0].get("mesh").is_none(), "out-of-range mesh dropped");
    assert!(gltf["nodes"][1].get("rotation").is_none(), "non-finite rotation -> identity");
    assert_eq!(gltf["nodes"][1]["translation"], serde_json::json!([0.0, 1.0, 0.0]));
}

#[test]
fn test_phase2_cad_extrude_csg_and_text_parity() {
    let script = r##"
        const shape = new THREE.Shape();
        shape.moveTo(-0.5, -0.5);
        shape.lineTo(0.5, -0.5);
        shape.lineTo(0.5, 0.5);
        shape.lineTo(-0.5, 0.5);
        shape.closePath();

        const hole = new THREE.Path();
        hole.absarc(0, 0, 0.2, 0, Math.PI * 2, false);
        shape.holes.push(hole);

        const extrudeGeo = new THREE.ExtrudeGeometry(shape, {
            depth: 0.25,
            bevelEnabled: true,
            bevelThickness: 0.02,
            bevelSize: 0.02,
            bevelSegments: 1,
        });
        const baseMesh = new THREE.Mesh(
            extrudeGeo,
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        const cutter = new THREE.Mesh(new THREE.BoxGeometry(0.2, 1.2, 0.6));
        const csgPart = THREE.CSG.subtract(baseMesh, cutter);
        csgPart.name = "CSGBracket";
        scene.add(csgPart);

        const label = new THREE.Mesh(
            new THREE.TextGeometry("CAD-01", { size: 0.15, depth: 0.03 }),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        label.name = "TextMesh";
        label.position.set(0, 0.8, 0);
        scene.add(label);

        const traitLabel = new THREE.Mesh();
        traitLabel.name = "TraitLabel";
        traitLabel.userData.xr = { text: { text: "OK", size: 0.1, depth: 0.02, color: "#22c55e" } };
        scene.add(traitLabel);
    "##;

    let glb = transcode_three_to_glb(script).expect("CAD + CSG + Text should compile to GLB");
    let gltf = parse_gltf_json(&glb);
    let meshes = gltf["meshes"].as_array().expect("meshes array");
    assert_eq!(meshes.len(), 3, "expected 3 meshes (CSGBracket, TextMesh, TraitLabel)");

    let nodes = gltf["nodes"].as_array().expect("nodes array");
    assert_eq!(nodes.len(), 3);
    assert_eq!(
        nodes[2]["extensions"]["ANDROID_xr_scenecore"]["text3d"]["text"],
        serde_json::json!("OK")
    );

    let usdz = three_live_compiler::compile_three_to_usdz(script)
        .expect("CAD + CSG + Text should compile to USDZ");
    assert!(usdz.len() > 1000, "USDZ should contain extruded and CSG geometry");
}

#[test]
fn test_phase1_structured_compiler_and_schema_diagnostics() {
    let script = r#"
        const mat = new THREE.ShaderMaterial({
            uniforms: { color: { value: new THREE.Color(0x00ff88) } }
        });
        const icosa = new THREE.Mesh(new THREE.IcosahedronGeometry(0.5, 1), mat);
        icosa.userData.xr = {
            grabbable: true,
            health: 100,
            gaze: { dwellMs: 50 },
            splatUrl: 'javascript:alert(1)',
            orbit: { target: 'NonExistentHub', radius: 1.5 }
        };
        icosa.userData.interactivity = {
            onSelect: { action: 'interpolate', target: 'MissingTarget', to: [0, 1, 0] }
        };
        scene.add(icosa);

        const loader = new THREE.GLTFLoader();
        const controls = new THREE.OrbitControls();
        const composer = new THREE.EffectComposer();
        const bloomPass = new THREE.UnrealBloomPass();
        const hemi = new THREE.HemisphereLight(0xffffff, 0x444444, 0.5);
        scene.add(hemi);
        const rectLight = new THREE.RectAreaLight(0xffffff, 0.5);
        scene.add(rectLight);
        requestAnimationFrame(() => {});

        const vA = new THREE.Vector3(0, 0, 0).lerp(new THREE.Vector3(2, 4, 6), 0.5);
        const vB = new THREE.Vector3().lerpVectors(new THREE.Vector3(1, 1, 1), vA, 0.5);
        const q = new THREE.Quaternion().setFromUnitVectors(
            new THREE.Vector3(0, 1, 0),
            vB.clone().normalize()
        ).normalize();
        icosa.quaternion.copy(q);
    "#;

    let (scene_opt, diags) = three_live_compiler::validate_scene_source(script, "test_diag.js");
    let scene = scene_opt.expect("scene should extract with diagnostics");
    let codes: Vec<&str> = diags.iter().map(|d| d.code.as_str()).collect();
    assert!(codes.contains(&"TL101"), "expected TL101 for ShaderMaterial, got {:?}", codes);
    assert!(codes.contains(&"TL102"), "expected TL102 for IcosahedronGeometry, got {:?}", codes);
    assert!(codes.contains(&"TL103"), "expected TL103 for THREE.GLTFLoader, got {:?}", codes);
    assert!(codes.contains(&"TL104"), "expected TL104 for requestAnimationFrame, got {:?}", codes);
    assert!(codes.contains(&"TL106"), "expected TL106 for THREE.OrbitControls, got {:?}", codes);
    assert!(
        codes.contains(&"TL107"),
        "expected TL107 for THREE.EffectComposer / UnrealBloomPass, got {:?}",
        codes
    );
    assert!(codes.contains(&"TL201"), "expected TL201 for grabbable/health, got {:?}", codes);
    assert!(codes.contains(&"TL202"), "expected TL202 for gaze.dwellMs=50, got {:?}", codes);
    assert!(codes.contains(&"TL203"), "expected TL203 for unsafe splatUrl, got {:?}", codes);
    assert!(
        codes.contains(&"TL204"),
        "expected TL204 for broken target node names, got {:?}",
        codes
    );
    assert!(
        codes.contains(&"TL205"),
        "expected TL205 for unnamed interactive mesh, got {:?}",
        codes
    );
    assert_eq!(scene.nodes[0].interactivity_events, vec!["onSelect".to_string()]);
}

#[test]
fn test_phase1_syntax_and_quota_error_diagnostics_and_html_lint() {
    let broken_js = "const m = new THREE.Mesh(\nconst bad = ;";
    let (scene_opt, diags) = three_live_compiler::validate_scene_source(broken_js, "broken.js");
    assert!(scene_opt.is_none());
    assert_eq!(diags.len(), 1);
    assert_eq!(diags[0].code, "TL100");
    assert_eq!(diags[0].severity, "error");
    assert!(
        diags[0].line.is_some(),
        "TL100 should extract line number from Boa syntax error: {:?}",
        diags[0]
    );

    let html_doc = r#"
        <!DOCTYPE html>
        <html>
        <body>
            <three-live xr-hands plugins="spatial-measure">
                <div slot="spatial">HUD</div>
                <script type="text/three">
                    const box = new THREE.Mesh(
                        new THREE.BoxGeometry(1, 1, 1),
                        new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
                    );
                    box.name = 'Crate';
                    scene.add(box);
                </script>
            </three-live>
        </body>
        </html>
    "#;
    let (html_scene, html_diags) =
        three_live_compiler::validate_scene_source(html_doc, "index.html");
    assert!(html_scene.is_some(), "HTML inline script should be extracted and compiled");
    let html_codes: Vec<&str> = html_diags.iter().map(|d| d.code.as_str()).collect();
    assert!(
        html_codes.contains(&"TL401"),
        "expected TL401 for missing allow-client-scripts, got {:?}",
        html_codes
    );
    assert!(
        html_codes.contains(&"TL402"),
        "expected TL402 for <xr-live> features on <three-live>, got {:?}",
        html_codes
    );

    // Phase 1 audit edge cases:
    // 1. Self-closing <three-live src="a.glb" title="voice demo" /> should NOT trigger TL401 or
    //    TL402 for "voice" inside quoted title
    // 2. HTML comments <!-- <three-live xr-hands> --> should be ignored
    // 3. Unrecognized interactivity trigger (`onClick`) and action (`move`) should emit TL201
    let edge_html = r#"
        <!DOCTYPE html>
        <!-- <three-live xr-hands><script type="text/three">bad()</script></three-live> -->
        <three-live src="static.glb" title="voice and xr-hands demo" />
        <three-live allow-client-scripts>
            <script type="text/three">
                const btn = new THREE.Mesh(
                    new THREE.BoxGeometry(0.5, 0.5, 0.5),
                    new THREE.MeshStandardMaterial({ color: 0x22c55e })
                );
                btn.name = 'Button';
                btn.userData.interactivity = {
                    onClick: { action: 'move', to: [0, 1, 0] },
                    onSelect: { action: 'unknownOp', to: [0, 1, 0] }
                };
                scene.add(btn);
            </script>
        </three-live>
    "#;
    let (edge_scene, edge_diags) =
        three_live_compiler::validate_scene_source(edge_html, "edge.html");
    assert!(edge_scene.is_some());
    assert!(
        !edge_diags.iter().any(|d| d.code == "TL401" || d.code == "TL402"),
        "self-closing and commented-out tags or quoted attribute values must not trigger TL401/TL402: {:?}",
        edge_diags
    );
    assert!(
        edge_diags.iter().any(|d| d.code == "TL201"
            && d.message.contains("onClick")
            && d.message.contains("onSelect")),
        "unrecognized interactivity trigger onClick should suggest onSelect: {:?}",
        edge_diags
    );
    assert!(
        edge_diags.iter().any(|d| d.code == "TL201" && d.message.contains("unknownOp")),
        "unrecognized interactivity action should emit TL201: {:?}",
        edge_diags
    );
}

#[test]
fn test_phase2_spatial_frustum_grounding_and_lighting_linter() {
    use three_live_compiler::validate_and_lint_scene;

    // 1. TL301: Empty scene
    let empty_report = validate_and_lint_scene("// no meshes", "empty.js", 1.0);
    assert!(!empty_report.valid, "Empty scene should have valid=false due to TL301 error");
    assert!(
        empty_report.diagnostics.iter().any(|d| d.code == "TL301" && d.severity == "error"),
        "expected TL301 error: {:?}",
        empty_report.diagnostics
    );

    // 2. TL302 (camera inside mesh), TL303 (behind/offscreen mesh), TL305 (unlit metallic PBR),
    //    TL306 (interpenetrating sibling meshes), TL307 (floating scene)
    let spatial_script = r#"
        const cam = new THREE.PerspectiveCamera(45, 1.0, 0.1, 1000);
        cam.position.set(0, 2, 5);
        cam.lookAt(0, 0, 0);
        scene.add(cam);

        // Encloses camera [0, 2, 5] -> TL302
        const tower = new THREE.Mesh(
            new THREE.BoxGeometry(4, 4, 4),
            new THREE.MeshStandardMaterial({ color: 0x111827, metalness: 0.9, roughness: 0.2 })
        );
        tower.name = 'Tower';
        tower.position.set(0, 2, 5);
        scene.add(tower);

        // Sibling overlapping >80% with Tower -> TL306
        const towerDuplicate = new THREE.Mesh(
            new THREE.BoxGeometry(3.9, 3.9, 3.9),
            new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
        );
        towerDuplicate.name = 'TowerDuplicate';
        towerDuplicate.position.set(0, 2, 5);
        scene.add(towerDuplicate);

        // Behind camera (z = +15 while looking from z=5 toward z=0) -> TL303
        const behindBox = new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ color: 0x22c55e })
        );
        behindBox.name = 'BehindProp';
        behindBox.position.set(0, 2, 15);
        scene.add(behindBox);
    "#;
    let report = validate_and_lint_scene(spatial_script, "spatial.js", 2.5);
    let codes: Vec<&str> = report.diagnostics.iter().map(|d| d.code.as_str()).collect();
    assert!(
        codes.contains(&"TL302"),
        "expected TL302 camera inside mesh: {:?}",
        report.diagnostics
    );
    assert!(
        codes.contains(&"TL303"),
        "expected TL303 offscreen behind camera: {:?}",
        report.diagnostics
    );
    assert!(
        codes.contains(&"TL305"),
        "expected TL305 unlit metallic PBR: {:?}",
        report.diagnostics
    );
    assert!(codes.contains(&"TL306"), "expected TL306 sibling overlap: {:?}", report.diagnostics);

    let summary = report.summary.expect("summary present");
    assert_eq!(summary.mesh_count, 3);
    assert!(
        summary.camera.occluded_or_offscreen_meshes.contains(&"BehindProp".to_string()),
        "BehindProp should be listed in occludedOrOffscreenMeshes: {:?}",
        summary.camera
    );

    // 3. TL304: Giant millimeter scale (> 200m diagonal) and TL307 (floating/buried)
    let giant_script = r#"
        const box = new THREE.Mesh(
            new THREE.BoxGeometry(500, 500, 500),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        box.name = 'MillimeterBox';
        box.position.set(0, 300, 0);
        scene.add(box);
        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(10, 20, 10);
        scene.add(light);
    "#;
    let giant_report = validate_and_lint_scene(giant_script, "giant.js", 1.2);
    let giant_codes: Vec<&str> = giant_report.diagnostics.iter().map(|d| d.code.as_str()).collect();
    assert!(
        giant_codes.contains(&"TL304"),
        "expected TL304 for 500m millimeter box: {:?}",
        giant_report.diagnostics
    );
    assert!(
        giant_codes.contains(&"TL307"),
        "expected TL307 for min.y = 50m floating: {:?}",
        giant_report.diagnostics
    );

    // 4. Well-formed grounded scene at y=0 with lights should produce 0 diagnostics
    let clean_script = r#"
        const prop = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 1.0, 1.0),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.2, roughness: 0.5 })
        );
        prop.name = 'GroundedCrate';
        prop.position.set(0, 0.5, 0);
        scene.add(prop);

        const dirLight = new THREE.DirectionalLight(0xffffff, 1.2);
        dirLight.position.set(2, 4, 3);
        scene.add(dirLight);
    "#;
    let clean_report = validate_and_lint_scene(clean_script, "clean.js", 1.5);
    assert!(clean_report.valid);
    assert!(
        clean_report.diagnostics.is_empty(),
        "Grounded, lit, in-frustum scene should have 0 diagnostics, got: {:?}",
        clean_report.diagnostics
    );
    let clean_summary = clean_report.summary.unwrap();
    assert_eq!(clean_summary.camera.visible_mesh_count, 1);
    assert_eq!(clean_report.nodes[0].in_frustum, true);
    assert!(clean_report.nodes[0].screen_coverage_pct > 1.0);
    let wb = clean_summary.world_bounds.unwrap();
    assert_eq!(wb.min, [-0.5, 0.0, -0.5]);
    assert_eq!(wb.max, [0.5, 1.0, 0.5]);

    // 5. Phase 2 Audit edge cases:
    //    - Per-node TL307 for a floating character even when a floor rests at y=0
    //    - Two adjacent pillars sharing min.y=0 with tiny corner overlap must NOT trigger
    //      false-positive TL306
    //    - read_glb round-trip preserves SceneGraph for spatial linting
    let audit_script = r#"
        const floor = new THREE.Mesh(
            new THREE.BoxGeometry(6, 0.1, 6),
            new THREE.MeshStandardMaterial({ color: 0x334155 })
        );
        floor.name = 'MainFloor';
        floor.position.set(0, 0.05, 0);
        scene.add(floor);

        // Two pillars standing on y=0 with a small corner overlap (0.05m x 0.05m out of 1.0m x 1.0m)
        const pillarA = new THREE.Mesh(
            new THREE.BoxGeometry(1, 2, 1),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        pillarA.name = 'PillarA';
        pillarA.position.set(-0.48, 1.0, 0);
        scene.add(pillarA);

        const pillarB = new THREE.Mesh(
            new THREE.BoxGeometry(1, 2, 1),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        );
        pillarB.name = 'PillarB';
        pillarB.position.set(0.48, 1.0, 0);
        scene.add(pillarB);

        // Floating character (min.y = 1.2m) while MainFloor is at y=0 -> per-node TL307!
        const hero = new THREE.Mesh(
            new THREE.CapsuleGeometry(0.3, 1.0),
            new THREE.MeshStandardMaterial({ color: 0x22c55e })
        );
        hero.name = 'FloatingHero';
        hero.position.set(0, 2.0, -1);
        hero.userData.xr = { character: { speed: 4.0 } };
        scene.add(hero);

        const light = new THREE.DirectionalLight(0xffffff, 1.0);
        light.position.set(2, 5, 3);
        scene.add(light);
    "#;
    let audit_report = validate_and_lint_scene(audit_script, "audit_phase2.js", 2.0);
    assert!(
        !audit_report.diagnostics.iter().any(|d| d.code == "TL306"),
        "Adjacent pillars with minor corner overlap on floor must not trigger TL306: {:?}",
        audit_report.diagnostics
    );
    assert!(
        audit_report
            .diagnostics
            .iter()
            .any(|d| d.code == "TL307" && d.node.as_deref() == Some("FloatingHero")),
        "Floating character node should trigger per-node TL307 even when floor touches y=0: {:?}",
        audit_report.diagnostics
    );

    // Verify read_glb round-trip (GroundedCrate mesh node + DirectionalLight node = 2 nodes)
    let glb_bytes = transcode_three_to_glb(clean_script).expect("clean_script compiles to GLB");
    let parsed_glb = three_live_compiler::read_glb(&glb_bytes).expect("read_glb parses GLB");
    assert_eq!(parsed_glb.meshes.len(), 1);
    assert_eq!(parsed_glb.nodes.len(), 2);
    assert_eq!(parsed_glb.nodes[0].name, "GroundedCrate");
}

#[test]
fn test_phase3_headless_pbr_rasterizer_quad_png_and_gif() {
    use three_live_compiler::{
        encode_gif_frames, encode_png_rgba, render_scene_rgba, render_viewport_rgba,
        stitch_filmstrip_horizontal, validate_three_script, RenderOptions, RenderViewMode,
    };

    let script = r#"
        const floor = new THREE.Mesh(
            new THREE.BoxGeometry(4, 0.1, 4),
            new THREE.MeshStandardMaterial({ color: 0x334155, roughness: 0.8 })
        );
        floor.name = 'StudioFloor';
        floor.position.set(0, -0.05, 0);
        scene.add(floor);

        const cube = new THREE.Mesh(
            new THREE.BoxGeometry(1.0, 1.0, 1.0),
            new THREE.MeshStandardMaterial({ color: 0xef4444, metalness: 0.3, roughness: 0.4 })
        );
        cube.name = 'RedHeroCube';
        cube.position.set(0, 0.5, 0);
        scene.add(cube);

        const inst = new THREE.InstancedMesh(
            new THREE.SphereGeometry(0.25, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0xffffff, metalness: 0.7, roughness: 0.2 }),
            2
        );
        inst.name = 'GoldOrbs';
        inst.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-1.0, 0.25, 0.5));
        inst.setMatrixAt(1, new THREE.Matrix4().makeTranslation(1.0, 0.25, 0.5));
        inst.setColorAt(0, new THREE.Color(0xf59e0b));
        inst.setColorAt(1, new THREE.Color(0x38bdf8));
        scene.add(inst);

        const light = new THREE.DirectionalLight(0xffffff, 1.4);
        light.position.set(3, 6, 4);
        scene.add(light);
    "#;
    let scene = validate_three_script(script).expect("script compiles");

    // 1. 4-Up Quad Contact Sheet with grid and annotations
    let quad_opts = RenderOptions {
        width: 256,
        height: 256,
        view: RenderViewMode::Quad,
        show_grid: true,
        show_annotations: true,
        label_override: None,
    };
    let (qw, qh, quad_rgba) = render_scene_rgba(&scene, &quad_opts);
    assert_eq!(qw, 256);
    assert_eq!(qh, 256);
    assert_eq!(quad_rgba.len(), 256 * 256 * 4);

    // Ensure non-background pixels were rasterized (red hero cube & cyan annotations)
    let red_dominant_pixels = quad_rgba
        .chunks_exact(4)
        .filter(|px| px[0] > 140 && px[0] > px[2].saturating_add(40))
        .count();
    assert!(
        red_dominant_pixels > 100,
        "Expected red hero cube pixels in quad contact sheet, got {}",
        red_dominant_pixels
    );

    // 2. Pure-Rust PNG Encoder validation (8-byte magic + IHDR + IDAT + IEND)
    let png = encode_png_rgba(qw, qh, &quad_rgba).expect("PNG encoding succeeds");
    assert_eq!(&png[0..8], b"\x89PNG\r\n\x1a\n");
    assert_eq!(&png[12..16], b"IHDR");
    assert_eq!(&png[png.len() - 8..png.len() - 4], b"IEND");

    // 3. Horizontal Filmstrip & Pure-Rust Animated GIF89a Encoder
    let f0 = render_viewport_rgba(
        &scene,
        128,
        128,
        RenderViewMode::Camera,
        true,
        false,
        Some("FRAME 0"),
    );
    let f1 =
        render_viewport_rgba(&scene, 128, 128, RenderViewMode::Iso, true, true, Some("FRAME 1"));
    let (sw, sh, strip_rgba) = stitch_filmstrip_horizontal(128, 128, &[f0.clone(), f1.clone()]);
    assert_eq!(sw, 256);
    assert_eq!(sh, 128);
    assert_eq!(strip_rgba.len(), 256 * 128 * 4);

    let gif = encode_gif_frames(128, 128, &[f0, f1], 10).expect("GIF89a encoding succeeds");
    assert_eq!(&gif[0..6], b"GIF89a");
    assert_eq!(gif[gif.len() - 1], 0x3B, "GIF must end with 0x3B trailer");

    // 4. Phase 3 Audit: non-uniform scale + negative-determinant mirrored scale + empty scene +
    //    zero-dim errors
    assert!(encode_png_rgba(0, 128, &[]).is_err());
    assert!(encode_gif_frames(0, 128, &[vec![0; 4]], 10).is_err());
    assert!(encode_gif_frames(16, 16, &[], 10).is_err());

    let empty_scene = validate_three_script("// empty").expect("empty script");
    let (ew, eh, empty_rgba) = render_scene_rgba(&empty_scene, &quad_opts);
    assert_eq!((ew, eh), (256, 256));
    assert_eq!(empty_rgba.len(), 256 * 256 * 4);

    let mirrored_script = r#"
        const mat = new THREE.MeshStandardMaterial({ color: 0x22c55e, side: THREE.FrontSide });
        const box = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), mat);
        box.name = 'MirroredNonUniformBox';
        box.scale.set(-2.0, 0.4, 1.5);
        box.position.set(0, 0.2, 0);
        scene.add(box);
    "#;
    let mirrored_scene = validate_three_script(mirrored_script).expect("mirrored script");
    let mirrored_rgba = render_viewport_rgba(
        &mirrored_scene,
        128,
        128,
        RenderViewMode::Camera,
        false,
        true,
        Some("MIRRORED [100%]!"),
    );
    let green_pixels = mirrored_rgba
        .chunks_exact(4)
        .filter(|px| px[1] > 100 && px[1] > px[0].saturating_add(30))
        .count();
    assert!(
        green_pixels > 50,
        "Mirrored single-sided box should still render front faces when det < 0, got {} green pixels",
        green_pixels
    );
}

#[test]
fn test_phase4_temporal_animation_interactivity_and_sim_runner() {
    use three_live_compiler::{
        evaluate_temporal_keyframes, simulate_scenario_from_source, SimAction,
    };

    let scenario_script = r#"
        const player = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.0, 0.6),
            new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
        );
        player.name = 'hero';
        player.position.set(0, 0.5, 2.0);
        player.userData.xr = {
            character: { moveSpeed: 4.0, jumpImpulse: 5.0 },
            integrity: { hp: 100, maxHp: 100, group: 'player' },
            audioCues: { onSpawn: 'spawn.wav', onMove: 'step.wav', onJump: 'jump.wav' },
            objective: { id: 'reach_crystal', kind: 'reach', target: 'crystal', winOnComplete: true }
        };
        scene.add(player);

        const crystal = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x10b981 })
        );
        crystal.name = 'crystal';
        crystal.position.set(0, 0.25, 0.0);
        crystal.userData.xr = {
            explode: { direction: [0, 1, 0], distance: 1.0, layer: 2.0 }
        };
        crystal.userData.interactivity = {
            onSelect: [
                { action: 'interpolate', property: 'position', to: [0, 1.25, 0], duration: 0.5 },
                { action: 'sendEvent', eventId: 'crystal_activated' }
            ]
        };
        scene.add(crystal);

        const beacon = new THREE.Mesh(
            new THREE.SphereGeometry(0.3, 12, 8),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        );
        beacon.name = 'beacon';
        beacon.position.set(1.5, 0.5, 0.0);
        beacon.userData.xr = {
            orbit: { radius: 1.5, speed: 2.0, height: 0.5, target: [0, 0.5, 0], faceCenter: true }
        };
        beacon.userData.interactivity = {
            onReceive: { eventId: 'crystal_activated', action: 'toggleVisibility' }
        };
        scene.add(beacon);

        function animate(t) {
            crystal.rotation.y = t * 1.5;
        }
    "#;

    let actions = vec![
        SimAction {
            at: 0.1,
            action_type: "select".to_string(),
            target: Some("crystal".to_string()),
            factor: 1.0,
            direction: None,
            dx: 0.0,
            dz: 0.0,
            duration: None,
            jump: false,
            event_id: None,
            amount: None,
        },
        SimAction {
            at: 0.2,
            action_type: "explode".to_string(),
            target: None,
            factor: 0.5,
            direction: None,
            dx: 0.0,
            dz: 0.0,
            duration: None,
            jump: false,
            event_id: None,
            amount: None,
        },
        SimAction {
            at: 0.3,
            action_type: "moveCharacter".to_string(),
            target: Some("hero".to_string()),
            factor: 1.0,
            direction: Some([0.0, 0.0, -1.0]),
            dx: 0.0,
            dz: -1.0,
            duration: Some(0.6),
            jump: true,
            event_id: None,
            amount: None,
        },
    ];

    let (report, snapshots) = simulate_scenario_from_source(
        scenario_script.as_bytes(),
        false,
        1.2,
        &actions,
        &[0, 30, 72],
    )
    .expect("Simulation should succeed");

    assert_eq!(report.ticks_simulated, 72);
    assert_eq!(snapshots.len(), 3);
    assert_eq!(
        report.scenario_state, "victory",
        "Expected hero to reach crystal and complete reach_crystal objective, got {:?}",
        report
    );
    assert!(report.completed_objectives.contains(&"reach_crystal".to_string()));
    assert!(
        report.triggered_events.iter().any(|e| e.contains("onReceive:toggleVisibility:beacon")),
        "Expected sendEvent -> onReceive chain to toggle beacon visibility: {:?}",
        report.triggered_events
    );
    assert!(report.audio_cues_fired.iter().any(|c| c.contains("hero:onJump")));

    let crystal_body = report.bodies.iter().find(|b| b.name == "crystal").unwrap();
    // Initial y=0.25 -> interpolated to 1.25 + explode(0.5 * 1.0 * 2.0 = +1.0) = 2.25
    assert!(
        crystal_body.final_translation[1] > 2.0,
        "Expected crystal y > 2.0 after interpolate + explode, got {:?}",
        crystal_body.final_translation
    );
    let beacon_body = report.bodies.iter().find(|b| b.name == "beacon").unwrap();
    assert!(!beacon_body.visible, "Beacon should be toggled hidden via onReceive");

    let keyframes =
        evaluate_temporal_keyframes(scenario_script.as_bytes(), false, 4, 1.0, Some("crystal"))
            .expect("Temporal keyframes should evaluate");
    assert_eq!(keyframes.len(), 4);

    // Phase 4 Audit:
    // 1. Canonical xr-sim-schema.ts `pickup` objective on target mesh awards `amount` score & hides
    //    coin
    // 2. Multi-objective `winOnComplete` waits for both `pickup` and `destroyAll` before `victory`
    // 3. Circular `sendEvent -> onReceive -> sendEvent` loop terminates via `MAX_EVENT_CHAIN_DEPTH`
    // 4. `.glb` round-trip simulation via `simulate_scenario_from_source(..., is_glb: true, ...)`
    let audit_sim_script = r#"
        const player = new THREE.Mesh(
            new THREE.BoxGeometry(0.6, 1.0, 0.6),
            new THREE.MeshStandardMaterial({ color: 0x3b82f6 })
        );
        player.name = 'hero';
        player.position.set(0, 0.5, 0.0);
        player.userData.xr = {
            character: { speed: 4.0 },
            objective: { id: 'defeat_turret', kind: 'destroyAll', target: 'enemies', winOnComplete: true }
        };
        scene.add(player);

        const coin = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 8, 8),
            new THREE.MeshStandardMaterial({ color: 0xfacc15 })
        );
        coin.name = 'gold_coin';
        coin.position.set(0.5, 0.5, 0.0);
        coin.userData.xr = {
            objective: { type: 'pickup', tag: 'collect_coin', amount: 50, radius: 1.0, required: true },
            audioCues: { onCollect: 'coin.wav' }
        };
        scene.add(coin);

        const turret = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.8, 0.8),
            new THREE.MeshStandardMaterial({ color: 0xef4444 })
        );
        turret.name = 'turret';
        turret.position.set(4.0, 0.4, 0.0);
        turret.userData.xr = {
            agent: { mode: 'patrol' },
            integrity: { hp: 40, maxHp: 40, group: 'enemies', scoreValue: 100 }
        };
        turret.userData.interactivity = {
            onReceive: { eventId: 'loop_ping', action: 'sendEvent', eventId: 'loop_pong' }
        };
        scene.add(turret);

        const relay = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 0.2, 0.2),
            new THREE.MeshStandardMaterial({ color: 0xffffff })
        );
        relay.name = 'relay';
        relay.userData.interactivity = {
            onReceive: { eventId: 'loop_pong', action: 'sendEvent', eventId: 'loop_ping' }
        };
        scene.add(relay);
    "#;

    let audit_actions = vec![
        SimAction {
            at: 0.05,
            action_type: "sendEvent".to_string(),
            target: None,
            factor: 1.0,
            direction: None,
            dx: 0.0,
            dz: 0.0,
            duration: None,
            jump: false,
            event_id: Some("loop_ping".to_string()),
            amount: None,
        },
        SimAction {
            at: 0.1,
            action_type: "damage".to_string(),
            target: Some("turret".to_string()),
            factor: 1.0,
            direction: None,
            dx: 0.0,
            dz: 0.0,
            duration: None,
            jump: false,
            event_id: None,
            amount: Some(25.0),
        },
        SimAction {
            at: 0.2,
            action_type: "damage".to_string(),
            target: Some("turret".to_string()),
            factor: 1.0,
            direction: None,
            dx: 0.0,
            dz: 0.0,
            duration: None,
            jump: false,
            event_id: None,
            amount: Some(25.0),
        },
    ];

    let (audit_report, _) =
        simulate_scenario_from_source(audit_sim_script.as_bytes(), false, 0.5, &audit_actions, &[])
            .expect("Audit simulation should succeed without infinite recursion");
    assert_eq!(audit_report.scenario_state, "victory");
    assert_eq!(audit_report.score, 150, "50 from coin pickup + 100 from turret scoreValue");
    assert!(audit_report.completed_objectives.contains(&"collect_coin".to_string()));
    assert!(audit_report.completed_objectives.contains(&"defeat_turret".to_string()));
    let coin_body = audit_report.bodies.iter().find(|b| b.name == "gold_coin").unwrap();
    assert!(!coin_body.visible, "Collected pickup coin should be hidden");
    let turret_body = audit_report.bodies.iter().find(|b| b.name == "turret").unwrap();
    assert!(turret_body.destroyed, "Turret should be destroyed after two 25-HP hits");

    // Verify .glb simulation via `is_glb: true`
    let glb_bytes = transcode_three_to_glb(scenario_script).expect("scenario_script to GLB");
    let (glb_sim_report, _) =
        simulate_scenario_from_source(&glb_bytes, true, 0.5, &actions[0..2], &[0, 30])
            .expect("GLB simulation should succeed");
    assert_eq!(glb_sim_report.ticks_simulated, 30);
    assert_eq!(glb_sim_report.explode_factor, 0.5);
}

#[test]
fn test_plane_geometry_native_acceleration() {
    let script = r#"
        const geo = new THREE.PlaneGeometry(10, 10, 8, 8);
        const mat = new THREE.MeshStandardMaterial({ color: 0x38bdf8 });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "NativePlane";
        scene.add(mesh);
    "#;

    let scene = validate_three_script(script).expect("Plane validation should succeed");
    assert_eq!(scene.meshes.len(), 1);
    let plane = &scene.meshes[0];
    assert_eq!(plane.positions.len(), (8 + 1) * (8 + 1));
    assert_eq!(plane.indices.len(), 8 * 8 * 6);
    assert_eq!(plane.normals.len(), plane.positions.len());
    assert_eq!(plane.uvs.len(), (8 + 1) * (8 + 1));

    let glb = transcode_three_to_glb(script).expect("Plane transcoding to GLB should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_torus_geometry_native_acceleration() {
    let script = r#"
        const geo = new THREE.TorusGeometry(3.0, 0.8, 16, 32);
        const mat = new THREE.MeshStandardMaterial({ color: 0xf59e0b });
        const mesh = new THREE.Mesh(geo, mat);
        mesh.name = "NativeTorus";
        scene.add(mesh);
    "#;

    let scene = validate_three_script(script).expect("Torus validation should succeed");
    assert_eq!(scene.meshes.len(), 1);
    let torus = &scene.meshes[0];
    assert_eq!(torus.positions.len(), (16 + 1) * (32 + 1));
    assert_eq!(torus.indices.len(), 16 * 32 * 6);
    assert_eq!(torus.normals.len(), torus.positions.len());
    assert_eq!(torus.uvs.len(), (16 + 1) * (32 + 1));

    let glb = transcode_three_to_glb(script).expect("Torus transcoding to GLB should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_native_csg_boolean_operations() {
    let script = r#"
        const boxMesh = new THREE.Mesh(new THREE.BoxGeometry(2, 2, 2));
        const cylMesh = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.5, 3, 16));

        // Test subtraction
        const sub = THREE.CSG.subtract(boxMesh, cylMesh);
        sub.name = "CSG_Subtracted";

        // Test union
        const unionMesh = THREE.CSG.union(boxMesh, cylMesh);
        unionMesh.name = "CSG_Union";

        // Test intersection
        const intersectMesh = THREE.CSG.intersect(boxMesh, cylMesh);
        intersectMesh.name = "CSG_Intersect";

        scene.add(sub);
        scene.add(unionMesh);
        scene.add(intersectMesh);
    "#;

    let scene = validate_three_script(script).expect("CSG validation should succeed");
    assert_eq!(scene.meshes.len(), 3);
    for m in &scene.meshes {
        assert!(!m.positions.is_empty(), "CSG mesh {} positions should not be empty", m.name);
        assert!(!m.indices.is_empty(), "CSG mesh {} indices should not be empty", m.name);
        assert!(!m.normals.is_empty(), "CSG mesh {} normals should not be empty", m.name);
    }

    let glb = transcode_three_to_glb(script).expect("CSG scene transcoding should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_cad_flange_scene_compilation() {
    let script = r#"
        const profile = new THREE.Shape();
        profile.absarc(0, 0, 1.25, 0, Math.PI * 2, false);
        const bore = new THREE.Path();
        bore.absarc(0, 0, 0.48, 0, Math.PI * 2, true);
        profile.holes.push(bore);

        const alloyMat = new THREE.MeshStandardMaterial({ color: 0x94a3b8 });
        const rawBlank = new THREE.Mesh(
            new THREE.ExtrudeGeometry(profile, {
                depth: 0.36,
                bevelEnabled: true,
                bevelThickness: 0.05,
                bevelSize: 0.04,
                bevelSegments: 2,
                curveSegments: 36
            }),
            alloyMat
        );
        rawBlank.rotation.x = -Math.PI / 2;
        rawBlank.position.set(0, -0.18, 0);

        const slotX = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.26, 0.32), alloyMat);
        slotX.position.set(0, 0.12, 0);
        const slotZ = new THREE.Mesh(new THREE.BoxGeometry(0.32, 0.26, 2.8), alloyMat);
        slotZ.position.set(0, 0.12, 0);

        const step1 = THREE.CSG.subtract(rawBlank, slotX);
        const machinedFlange = THREE.CSG.subtract(step1, slotZ);
        machinedFlange.name = "MachinedCADFlange";
        scene.add(machinedFlange);
    "#;

    let scene =
        validate_three_script(script).expect("Machined CAD flange must succeed without timeout");
    assert_eq!(scene.meshes.len(), 1);
    let flange = &scene.meshes[0];
    assert!(flange.positions.len() > 1000);
    assert!(flange.indices.len() > 1000);

    let glb = transcode_three_to_glb(script).expect("CAD flange transcoding to GLB should succeed");
    assert!(!glb.is_empty());
}

#[test]
fn test_phase1_rigid_body_physics_simulation_and_usdz() {
    let script = r#"
        const ball = new THREE.Mesh(
            new THREE.SphereGeometry(0.25, 16, 12),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        ball.name = "BounceBall";
        ball.position.set(2.0, 2.0, 0.0);
        ball.userData.xr = {
            rigidBody: {
                body: "dynamic",
                shape: "sphere",
                mass: 2.5,
                restitution: 0.75,
                friction: 0.3,
                linearDamping: 0.05
            }
        };
        scene.add(ball);

        const bottom = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        );
        bottom.name = "BottomCrate";
        bottom.position.set(-2.0, 0.25, 0.0);
        bottom.userData.xr = {
            rigidBody: {
                body: "dynamic",
                shape: "box",
                mass: 2.0,
                restitution: 0.05,
                linearDamping: 0.5
            }
        };
        scene.add(bottom);

        const top = new THREE.Mesh(
            new THREE.BoxGeometry(0.5, 0.5, 0.5),
            new THREE.MeshStandardMaterial({ color: 0x22c55e })
        );
        top.name = "TopCrate";
        top.position.set(-2.0, 1.0, 0.0);
        top.userData.xr = {
            rigidBody: {
                body: "dynamic",
                shape: "box",
                mass: 1.0,
                restitution: 0.05,
                linearDamping: 0.5
            }
        };
        scene.add(top);
    "#;

    let (report, snapshots) = three_live_compiler::simulate_scenario_from_source(
        script.as_bytes(),
        false,
        1.5,
        &[],
        &[42, 90],
    )
    .expect("Rigid-body simulation should succeed");
    assert_eq!(report.ticks_simulated, 90);
    // At tick 42 (0.7 s), BounceBall has hit the floor at y=0.25 and bounced back up above 0.45.
    let (_, snap_42) = &snapshots[0];
    let ball_42 = snap_42.nodes.iter().find(|n| n.name == "BounceBall").unwrap();
    assert!(
        ball_42.translation[1] > 0.40 && ball_42.translation[1] < 1.8,
        "Expected BounceBall to bounce above 0.40 at t=0.7s, got y={}",
        ball_42.translation[1]
    );
    // At tick 90 (1.5 s), TopCrate should be stacked on BottomCrate (y ~= 0.75).
    let bottom_body = report.bodies.iter().find(|b| b.name == "BottomCrate").unwrap();
    let top_body = report.bodies.iter().find(|b| b.name == "TopCrate").unwrap();
    assert!(
        (bottom_body.final_translation[1] - 0.25).abs() < 0.05,
        "Expected BottomCrate at y~0.25, got {}",
        bottom_body.final_translation[1]
    );
    assert!(
        (top_body.final_translation[1] - 0.75).abs() < 0.08,
        "Expected TopCrate stacked at y~0.75, got {}",
        top_body.final_translation[1]
    );
}

#[test]
fn test_spatial_audio_khr_audio_emitter_and_usdz_export() {
    let script = r#"
        const beacon = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.4, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        beacon.name = "BeaconEmitter";
        beacon.position.set(0, 1.5, -2.0);
        beacon.userData.xr = {
            audioEmitter: {
                preset: "beacon",
                src: "https://cdn.example.com/beacon.ogg",
                volume: 0.75,
                refDistance: 1.5,
                maxDistance: 20.0,
                coneInnerAngle: 90,
                coneOuterAngle: 180,
                coneOuterGain: 0.25,
                playOnSelect: true
            }
        };
        scene.add(beacon);
    "#;

    let glb = three_live_compiler::transcode_three_to_glb(script)
        .expect("GLB compilation with audioEmitter should succeed");
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let gltf: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_len]).expect("Valid GLB JSON chunk");
    let exts_used = gltf["extensionsUsed"].as_array().expect("extensionsUsed present");
    assert!(exts_used.iter().any(|e| e.as_str() == Some("KHR_audio_emitter")));
    let khr_audio = &gltf["extensions"]["KHR_audio_emitter"];
    assert_eq!(khr_audio["audio"][0]["uri"].as_str(), Some("https://cdn.example.com/beacon.ogg"));
    assert_eq!(khr_audio["sources"][0]["extras"]["preset"].as_str(), Some("beacon"));
    assert_eq!(khr_audio["emitters"][0]["positional"]["refDistance"].as_f64(), Some(1.5));
    assert_eq!(gltf["nodes"][0]["extensions"]["KHR_audio_emitter"]["emitter"].as_u64(), Some(0));

    let usdz = three_live_compiler::transcode_three_to_usdz(script)
        .expect("USDZ compilation with audioEmitter should succeed");
    let usdz_str = String::from_utf8_lossy(&usdz);
    assert!(usdz_str.contains("def SpatialAudio \"AudioEmitter\""));
    assert!(usdz_str.contains("uniform token inputs:auralMode = \"spatial\""));
    assert!(usdz_str.contains("asset inputs:file = @https://cdn.example.com/beacon.ogg@"));
    assert!(usdz_str.contains("string audioEmitterPreset = \"beacon\""));
}

#[test]
fn test_lod_plugin_msft_lod_export_and_spatial_lint_no_false_overlap() {
    let script = r#"
        const lodGroup = new THREE.LOD();
        lodGroup.name = "HeroStatueLOD";
        const hi = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 24, 16),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        hi.name = "HeroStatue_L0";
        const lo = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 0.8, 0.8),
            new THREE.MeshStandardMaterial({ color: 0x22c55e })
        );
        lo.name = "HeroStatue_L1";
        lodGroup.addLevel(hi, 0);
        lodGroup.addLevel(lo, 6);
        lodGroup.position.set(-1.2, 0.5, 0);
        scene.add(lodGroup);

        const autoTree = new THREE.Mesh(
            new THREE.SphereGeometry(0.5, 20, 14),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        );
        autoTree.name = "AutoTreeLOD";
        autoTree.position.set(1.2, 0.5, 0);
        autoTree.userData.xr = {
            lod: {
                distances: [0, 4, 10],
                ratios: [1.0, 0.45, 0.2],
                cullDistance: 25,
                hysteresis: 0.05
            }
        };
        scene.add(autoTree);

        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(2, 4, 3);
        scene.add(sun);
    "#;

    let glb = three_live_compiler::transcode_three_to_glb(script)
        .expect("GLB compilation with THREE.LOD and userData.xr.lod should succeed");
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let gltf: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_len]).expect("Valid GLB JSON chunk");
    let exts_used = gltf["extensionsUsed"].as_array().expect("extensionsUsed present");
    assert!(exts_used.iter().any(|e| e.as_str() == Some("MSFT_lod")));
    assert!(exts_used.iter().any(|e| e.as_str() == Some("KHR_node_visibility")));

    let nodes = gltf["nodes"].as_array().expect("nodes array");
    let hero_node = nodes.iter().find(|n| n["name"].as_str() == Some("HeroStatueLOD")).unwrap();
    let hero_ids = hero_node["extensions"]["MSFT_lod"]["ids"].as_array().expect("MSFT_lod.ids");
    assert_eq!(hero_ids.len(), 2);
    let l1_idx = hero_ids[1].as_u64().unwrap() as usize;
    assert_eq!(
        nodes[l1_idx]["extensions"]["KHR_node_visibility"]["visible"].as_bool(),
        Some(false)
    );

    let tree_node = nodes.iter().find(|n| n["name"].as_str() == Some("AutoTreeLOD")).unwrap();
    let tree_ids = tree_node["extensions"]["MSFT_lod"]["ids"].as_array().expect("MSFT_lod.ids");
    assert_eq!(tree_ids.len(), 3);

    // Spatial lint must NOT emit TL306 overlapping-mesh warnings for co-located LOD tiers.
    let report = three_live_compiler::validate_and_lint_scene(script, "lod.js", 1.5);
    assert!(
        !report.diagnostics.iter().any(|d| d.code == "TL306"),
        "Expected no TL306 overlap diagnostic between co-located LOD children, got: {:?}",
        report.diagnostics
    );

    let usdz = three_live_compiler::transcode_three_to_usdz(script)
        .expect("USDZ compilation with LOD should succeed");
    let usdz_str = String::from_utf8_lossy(&usdz);
    assert!(usdz_str.contains("bool lodEnabled = true"));
    assert!(usdz_str.contains("double lodCullDistance = 25"));
}

#[test]
fn test_data_texture_glb_usdz_and_headless_render() {
    let script = r#"
        const width = 32;
        const height = 32;
        const data = new Uint8Array(width * height * 4);
        for (let y = 0; y < height; y++) {
            for (let x = 0; x < width; x++) {
                const idx = (y * width + x) * 4;
                const stripe = ((x + y) & 4) !== 0;
                data[idx] = stripe ? 210 : 90;
                data[idx + 1] = stripe ? 140 : 55;
                data[idx + 2] = stripe ? 70 : 25;
                data[idx + 3] = 255;
            }
        }
        const tex = new THREE.DataTexture(data, width, height, THREE.RGBAFormat);
        tex.wrapS = THREE.RepeatWrapping;
        tex.wrapT = THREE.RepeatWrapping;
        tex.needsUpdate = true;

        const mat = new THREE.MeshStandardMaterial({
            map: tex,
            roughness: 0.4,
            metalness: 0.1
        });
        const mesh = new THREE.Mesh(new THREE.BoxGeometry(1.2, 1.2, 1.2), mat);
        mesh.name = "TexturedBlock";
        mesh.position.set(0, 0.6, 0);
        scene.add(mesh);

        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        camera.position.set(2.2, 1.8, 2.5);
        camera.lookAt(0, 0.6, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(script, "data_tex.js", 1.5);
    assert!(
        report.valid && report.diagnostics.is_empty(),
        "Expected zero diagnostics for THREE.DataTexture, got: {:?}",
        report.diagnostics
    );

    let glb = three_live_compiler::transcode_three_to_glb(script)
        .expect("GLB compilation with THREE.DataTexture should succeed");
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let gltf: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_len]).expect("Valid GLB JSON chunk");
    let uri = gltf["images"][0]["uri"].as_str().expect("images[0].uri present");
    assert!(uri.starts_with("data:image/png;base64,"), "Expected inline PNG data URI, got {}", uri);
    assert_eq!(gltf["materials"][0]["pbrMetallicRoughness"]["baseColorTexture"]["index"], 0);

    let usdz = three_live_compiler::transcode_three_to_usdz(script)
        .expect("USDZ compilation with THREE.DataTexture should succeed");
    let entries = verify_usdz_alignment(&usdz);
    assert!(
        entries >= 2,
        "Expected USDZ archive with THREE.DataTexture to package model.usda + texture_0.png, got {} entries",
        entries
    );
    let usdz_str = String::from_utf8_lossy(&usdz);
    assert!(
        usdz_str.contains("UsdUVTexture")
            && usdz_str.contains("asset inputs:file = @texture_0.png@")
            && usdz_str.contains("DiffuseTexture.outputs:rgb"),
        "Expected USDZ material to wire UsdUVTexture to texture_0.png"
    );

    let sg = three_live_compiler::validate_three_script(script).expect("SceneGraph");
    let (w, h, rgba) = three_live_compiler::render::render_scene_rgba(
        &sg,
        &three_live_compiler::render::RenderOptions::default(),
    );
    let png = three_live_compiler::render::encode_png_rgba(w, h, &rgba)
        .expect("Headless software render with DataTexture should succeed");
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n") && png.len() > 1000);
}

#[test]
fn test_mcp_server_end_to_end_jsonrpc_session() {
    use std::io::Cursor;

    let session_input = concat!(
        r#"{"jsonrpc":"2.0","id":1,"method":"initialize","params":{"protocolVersion":"2024-11-05","capabilities":{},"clientInfo":{"name":"test-agent","version":"1.0.0"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","method":"notifications/initialized"}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":2,"method":"tools/list"}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":3,"method":"tools/call","params":{"name":"three_live_validate","arguments":{"code":"const box = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial({ color: 0x38bdf8 })); box.name = 'HeroBox'; box.position.set(0, 0.2, 0); scene.add(box); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(2, 4, 3); scene.add(sun);"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":4,"method":"tools/call","params":{"name":"three_live_render","arguments":{"source":"const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x38bdf8 })); box.name = 'HeroBox'; scene.add(box); const sun = new THREE.DirectionalLight(0xffffff, 1.5); sun.position.set(2, 4, 3); scene.add(sun);","width":128,"height":128,"view":"quad"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":5,"method":"tools/call","params":{"name":"three_live_convert","arguments":{"code":"const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x38bdf8 })); scene.add(box);","format":"usdz"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":6,"method":"tools/call","params":{"name":"three_live_sim","arguments":{"code":"const box = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial({ color: 0x38bdf8 })); box.name = 'TargetCube'; box.position.set(0, 1.4, -1.5); scene.add(box);","duration":0.5}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":7,"method":"resources/read","params":{"uri":"three-live://docs/authoring-guide"}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":8,"method":"prompts/get","params":{"name":"author_three_live_scene","arguments":{"description":"a floating crystal"}}}"#,
        "\n",
        r#"{"jsonrpc":"2.0","id":9,"method":"unknown/method"}"#,
        "\n"
    );

    let mut reader = Cursor::new(session_input.as_bytes());
    let mut writer = Vec::new();
    three_live_compiler::run_mcp_io(&mut reader, &mut writer)
        .expect("MCP stdio session should complete cleanly");

    let output = String::from_utf8(writer).expect("UTF-8 MCP responses");
    let responses: Vec<serde_json::Value> = output
        .lines()
        .filter(|l| !l.trim().is_empty())
        .map(|l| serde_json::from_str(l).expect("Valid JSON-RPC response line"))
        .collect();

    // 9 requests with `id` (the notification produces no response)
    assert_eq!(responses.len(), 9);
    assert_eq!(responses[0]["id"], 1);
    assert_eq!(responses[0]["result"]["serverInfo"]["name"], "three-live-mcp");

    assert_eq!(responses[1]["id"], 2);
    assert_eq!(responses[1]["result"]["tools"].as_array().unwrap().len(), 9);

    assert_eq!(responses[2]["id"], 3);
    assert_eq!(responses[2]["result"]["isError"], false);

    assert_eq!(responses[3]["id"], 4);
    let render_content = responses[3]["result"]["content"].as_array().unwrap();
    assert_eq!(render_content.len(), 2);
    assert_eq!(render_content[0]["type"], "image");
    assert_eq!(render_content[0]["mimeType"], "image/png");
    assert_eq!(render_content[1]["type"], "text");

    assert_eq!(responses[4]["id"], 5);
    let convert_text = responses[4]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(convert_text.contains("\"format\": \"usdz\""));

    assert_eq!(responses[5]["id"], 6);
    let sim_text = responses[5]["result"]["content"][0]["text"].as_str().unwrap();
    assert!(sim_text.contains("TargetCube"));

    assert_eq!(responses[6]["id"], 7);
    let guide_text = responses[6]["result"]["contents"][0]["text"].as_str().unwrap();
    assert!(guide_text.contains("Three-Live Authoring Guide"));

    assert_eq!(responses[7]["id"], 8);
    let prompt_text = responses[7]["result"]["messages"][0]["content"]["text"].as_str().unwrap();
    assert!(prompt_text.contains("floating crystal"));

    assert_eq!(responses[8]["id"], 9);
    assert_eq!(responses[8]["error"]["code"], -32601);
}

#[test]
fn test_box3_sphere_bounding_helpers_and_prototype_freeze() {
    // 1. Authoring script using Box3.setFromObject + Sphere + InstancedMesh bounds
    // to auto-ground a pedestal underneath a rotated assembly with zero TL102 warnings.
    let script = r#"
        const assembly = new THREE.Group();
        assembly.position.set(0, 2.5, 0);
        const partA = new THREE.Mesh(
            new THREE.BoxGeometry(1.2, 0.8, 1.0),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        assembly.add(partA);

        const bolts = new THREE.InstancedMesh(
            new THREE.CylinderGeometry(0.05, 0.05, 0.4, 8),
            new THREE.MeshStandardMaterial({ color: 0x94a3b8 }),
            2
        );
        bolts.setMatrixAt(0, new THREE.Matrix4().makeTranslation(-0.5, -0.5, 0));
        bolts.setMatrixAt(1, new THREE.Matrix4().makeTranslation(0.5, -0.5, 0));
        assembly.add(bolts);
        scene.add(assembly);

        const bounds = new THREE.Box3().setFromObject(assembly, true);
        const size = bounds.getSize(new THREE.Vector3());
        const sphere = bounds.getBoundingSphere(new THREE.Sphere());
        if (bounds.isEmpty() || sphere.isEmpty() || size.x < 1.1) {
            throw new Error('Unexpected empty or undersized Box3/Sphere bounds');
        }

        // Ground assembly so bounds.min.y sits cleanly at y = 0.2 (top of pedestal)
        assembly.position.y += (0.2 - bounds.min.y);
        const pedestal = new THREE.Mesh(
            new THREE.CylinderGeometry(sphere.radius * 0.8, sphere.radius * 0.9, 0.2, 24),
            new THREE.MeshStandardMaterial({ color: 0x1e293b })
        );
        pedestal.position.y = 0.1;
        scene.add(pedestal);
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(3, 5, 4);
        scene.add(sun);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(script, "box3.js", 1.5);
    assert!(report.valid, "Expected valid scene, diagnostics: {:?}", report.diagnostics);
    let has_tl102 = report.diagnostics.iter().any(|d| d.code == "TL102");
    assert!(
        !has_tl102,
        "THREE.Box3 and THREE.Sphere must not emit TL102 unsupported warnings: {:?}",
        report.diagnostics
    );

    // 2. Verify Box3.prototype is frozen against cross-invocation pollution in Boa VM
    let pollute_attempt = r#"
        let mutated = false;
        try {
            THREE.Box3.prototype.setFromObject = () => { mutated = true; };
        } catch (_) {}
        const b = new THREE.Box3().setFromPoints([
            new THREE.Vector3(-1, 0, 0),
            new THREE.Vector3(1, 2, 0),
        ]);
        if (mutated || b.getSize().x !== 2) {
            throw new Error('Box3.prototype was mutated inside sandbox');
        }
        scene.add(new THREE.Mesh(new THREE.BoxGeometry(1, 1, 1), new THREE.MeshStandardMaterial()));
    "#;
    let glb = transcode_three_to_glb(pollute_attempt)
        .expect("Prototype pollution attempt should be blocked cleanly");
    assert!(glb.starts_with(b"glTF"));
}

#[test]
fn test_canvas_texture_virtual_2d_context_glb_usdz_and_render() {
    let script = r#"
        const canvas = document.createElement('canvas');
        canvas.width = 128;
        canvas.height = 128;
        // Instantiate CanvasTexture before drawing to verify reactive lazy sync
        const tex = new THREE.CanvasTexture(canvas);
        const ctx = canvas.getContext('2d');

        // Top half (y = 0..64): bright red
        ctx.fillStyle = '#ef4444';
        ctx.fillRect(0, 0, 128, 64);

        // Bottom half (y = 64..128): bright blue
        ctx.fillStyle = '#2563eb';
        ctx.fillRect(0, 64, 128, 64);

        // White label across top banner
        ctx.fillStyle = '#ffffff';
        ctx.font = 'bold 20px sans-serif';
        ctx.textAlign = 'center';
        ctx.textBaseline = 'middle';
        ctx.fillText('LIVE', 64, 32);

        const board = new THREE.Mesh(
            new THREE.PlaneGeometry(2.0, 2.0),
            new THREE.MeshBasicMaterial({ map: tex })
        );
        board.name = 'SignBoard';
        board.position.set(0, 1.0, 0);
        scene.add(board);

        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const sun = new THREE.DirectionalLight(0xffffff, 1.2);
        sun.position.set(0, 2, 4);
        scene.add(sun);

        camera.position.set(0, 1.0, 2.6);
        camera.lookAt(0, 1.0, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(script, "canvas_tex.js", 1.5);
    assert!(
        report.valid && report.diagnostics.is_empty(),
        "Expected zero diagnostics for THREE.CanvasTexture, got: {:?}",
        report.diagnostics
    );

    let glb = transcode_three_to_glb(script)
        .expect("GLB compilation with THREE.CanvasTexture should succeed");
    let json_len = u32::from_le_bytes([glb[12], glb[13], glb[14], glb[15]]) as usize;
    let gltf: serde_json::Value =
        serde_json::from_slice(&glb[20..20 + json_len]).expect("Valid GLB JSON chunk");
    let uri = gltf["images"][0]["uri"].as_str().expect("images[0].uri present");
    assert!(uri.starts_with("data:image/png;base64,"));

    let usdz = three_live_compiler::transcode_three_to_usdz(script)
        .expect("USDZ compilation with THREE.CanvasTexture should succeed");
    let entries = verify_usdz_alignment(&usdz);
    assert!(entries >= 2, "Expected USDZ to package model.usda + texture_0.png");

    // Verify right-side-up UV orientation in software rasterizer:
    // Upper center of rendered viewport (above board center y=1.0) must be red-dominant,
    // and lower center of rendered viewport (below board center y=1.0) must be blue-dominant!
    let sg = three_live_compiler::validate_three_script(script).expect("SceneGraph");
    let cam_rgba = three_live_compiler::render::render_viewport_rgba(
        &sg,
        128,
        128,
        three_live_compiler::render::RenderViewMode::Camera,
        false,
        false,
        None,
    );
    let px = |x: usize, y: usize| -> [u8; 4] {
        let o = (y * 128 + x) * 4;
        [cam_rgba[o], cam_rgba[o + 1], cam_rgba[o + 2], cam_rgba[o + 3]]
    };
    // Sample upper board region (x=16, y=36, avoiding centered white text) and lower region (x=64,
    // y=92)
    let top_px = px(40, 24);
    let bot_px = px(64, 96);
    assert!(
        top_px[0] > top_px[2] + 40,
        "Top half of CanvasTexture PlaneGeometry should render red-dominant (right-side-up), got {:?}",
        top_px
    );
    assert!(
        bot_px[2] > bot_px[0] + 40,
        "Bottom half of CanvasTexture PlaneGeometry should render blue-dominant (right-side-up), got {:?}",
        bot_px
    );

    // Verify `document` and `VirtualCanvas.prototype` cannot be poisoned across invocations
    let tamper_attempt = r#"
        try { document.createElement = () => null; } catch (_) {}
        try { globalThis.document = null; } catch (_) {}
        const c = document.createElement('canvas');
        c.width = 512;
        c.height = 512;
        try { Object.getPrototypeOf(c).getContext = () => null; } catch (_) {}
        const ctx = c.getContext('2d');
        if (!ctx) throw new Error('VirtualCanvas was poisoned');
        ctx.fillStyle = 'green';
        ctx.fillRect(0, 0, 512, 512);
        scene.add(new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ map: new THREE.CanvasTexture(c) })
        ));
    "#;
    let glb2 = transcode_three_to_glb(tamper_attempt)
        .expect("document / VirtualCanvas tamper attempt must be blocked and remain functional");
    assert!(glb2.starts_with(b"glTF"));
}

#[test]
fn test_procedural_noise_and_seeded_random_determinism_glb_usdz() {
    // 1. Warm-VM determinism when `seededRandom()` is called without an explicit seed:
    // `resetSceneFn` must reset the internal Mulberry32 state between compilations.
    let unseeded_script = r#"
        const r = THREE.MathUtils.seededRandom();
        const m = new THREE.Mesh(
            new THREE.BoxGeometry(0.5 + r, 0.5 + THREE.MathUtils.seededRandom(), 0.5),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        m.name = "DeterministicBox";
        m.position.set(0, 0.6, 0);
        scene.add(m);
    "#;
    let glb_run1 = transcode_three_to_glb(unseeded_script).expect("First warm-VM run");
    let glb_run2 = transcode_three_to_glb(unseeded_script).expect("Second warm-VM run");
    assert_eq!(
        glb_run1, glb_run2,
        "Warm Boa VM must reset THREE.MathUtils.seededRandom state across compilations"
    );

    // 2. End-to-end procedural terrain + texture using ImprovedNoise + SimplexNoise (2D/3D/4D)
    let terrain_script = r#"
        try { THREE.ImprovedNoise.prototype.noise = () => 999; } catch (_) {}
        try { THREE.SimplexNoise.prototype.noise = () => 999; } catch (_) {}

        THREE.MathUtils.seededRandom(2026);
        const perlin = new THREE.ImprovedNoise();
        const simplex = new THREE.SimplexNoise({
            random: () => THREE.MathUtils.seededRandom()
        });

        const geo = new THREE.PlaneGeometry(3.0, 3.0, 24, 24);
        const pos = geo.attributes.position;
        for (let i = 0; i < pos.count; i++) {
            const x = pos.getX(i);
            const y = pos.getY(i);
            const elev =
                0.35 * simplex.noise(x * 0.7, y * 0.7) +
                0.15 * perlin.noise(x * 1.5, y * 1.5, 0.35) +
                0.05 * simplex.noise4d(x, y, 0.2, 0.8);
            pos.setZ(i, elev);
        }
        geo.computeVertexNormals();

        const tw = 32, th = 32;
        const pixels = new Uint8Array(tw * th * 4);
        for (let py = 0; py < th; py++) {
            for (let px = 0; px < tw; px++) {
                const n = 0.5 + 0.5 * simplex.noise3d(px * 0.15, py * 0.15, 1.1);
                const o = (py * tw + px) * 4;
                pixels[o] = Math.round(40 + 120 * n);
                pixels[o + 1] = Math.round(110 + 110 * n);
                pixels[o + 2] = Math.round(50 + 40 * n);
                pixels[o + 3] = 255;
            }
        }
        const tex = new THREE.DataTexture(pixels, tw, th, THREE.RGBAFormat);
        tex.needsUpdate = true;

        const terrain = new THREE.Mesh(
            geo,
            new THREE.MeshStandardMaterial({ map: tex, roughness: 0.85, metalness: 0.05 })
        );
        terrain.name = "ProceduralTerrain";
        terrain.rotation.x = -Math.PI / 2;
        const bounds = new THREE.Box3().setFromObject(terrain);
        terrain.position.set(0, -bounds.min.y, 0);
        scene.add(terrain);

        scene.add(new THREE.AmbientLight(0xffffff, 0.65));
        const sun = new THREE.DirectionalLight(0xffffff, 1.25);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        camera.position.set(0, 2.8, 4.2);
        camera.lookAt(0, 0.4, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(terrain_script, "terrain.js", 1.5);
    assert!(
        report.valid && report.diagnostics.is_empty(),
        "Expected zero diagnostics for ImprovedNoise + SimplexNoise terrain, got: {:?}",
        report.diagnostics
    );

    let glb_a = transcode_three_to_glb(terrain_script).expect("Terrain GLB A");
    let glb_b = transcode_three_to_glb(terrain_script).expect("Terrain GLB B");
    assert_eq!(glb_a, glb_b, "Seeded procedural noise terrain GLB must be deterministic");

    let usdz = three_live_compiler::transcode_three_to_usdz(terrain_script).expect("Terrain USDZ");
    let entries = verify_usdz_alignment(&usdz);
    assert!(entries >= 2, "Expected aligned USDZ with terrain texture, got {} entries", entries);

    let sg =
        three_live_compiler::validate_three_script(terrain_script).expect("Terrain SceneGraph");
    let (w, h, rgba) = three_live_compiler::render::render_scene_rgba(
        &sg,
        &three_live_compiler::render::RenderOptions::default(),
    );
    let png = three_live_compiler::render::encode_png_rgba(w, h, &rgba)
        .expect("Headless render of procedural noise terrain should succeed");
    assert!(png.starts_with(b"\x89PNG\r\n\x1a\n") && png.len() > 2000);
}

#[test]
fn test_full_pbr_material_maps_glb_usdz_and_software_render() {
    let pbr_script = r#"
        function solidTex(r, g, b, size) {
            const s = size || 8;
            const buf = new Uint8Array(s * s * 4);
            for (let i = 0; i < buf.length; i += 4) {
                buf[i] = r;
                buf[i + 1] = g;
                buf[i + 2] = b;
                buf[i + 3] = 255;
            }
            return new THREE.DataTexture(buf, s, s, THREE.RGBAFormat);
        }

        const darkAlbedo = solidTex(12, 12, 16, 8);
        const roughTex = solidTex(70, 70, 70, 8);
        const metalTex = solidTex(210, 210, 210, 8);
        const aoTex = solidTex(140, 140, 140, 8);

        // Glowing orange emissive stripe across the center of the panel
        const emCvs = document.createElement('canvas');
        emCvs.width = 32;
        emCvs.height = 32;
        const emCtx = emCvs.getContext('2d');
        emCtx.fillStyle = '#000000';
        emCtx.fillRect(0, 0, 32, 32);
        emCtx.fillStyle = '#ff6600';
        emCtx.fillRect(4, 10, 24, 12);
        const emTex = new THREE.CanvasTexture(emCvs);

        // Diagonal height ridge for bumpMap -> tangent-space normal baking
        const bumpBuf = new Uint8Array(16 * 16 * 4);
        for (let y = 0; y < 16; y++) {
            for (let x = 0; x < 16; x++) {
                const h = Math.round(127 + 120 * Math.sin((x + y) * 0.6));
                const o = (y * 16 + x) * 4;
                bumpBuf[o] = h;
                bumpBuf[o + 1] = h;
                bumpBuf[o + 2] = h;
                bumpBuf[o + 3] = 255;
            }
        }
        const bumpTex = new THREE.DataTexture(bumpBuf, 16, 16, THREE.RGBAFormat);

        const panel = new THREE.Mesh(
            new THREE.BoxGeometry(1.6, 1.6, 0.2),
            new THREE.MeshStandardMaterial({
                map: darkAlbedo,
                roughnessMap: roughTex,
                metalnessMap: metalTex,
                aoMap: aoTex,
                aoMapIntensity: 0.7,
                emissiveMap: emTex,
                emissiveIntensity: 2.0,
                bumpMap: bumpTex,
                bumpScale: 1.5,
            })
        );
        panel.name = "PbrPanel";
        panel.position.set(0, 0.8, 0);
        scene.add(panel);

        scene.add(new THREE.AmbientLight(0xffffff, 0.2));
        const key = new THREE.DirectionalLight(0xffffff, 0.9);
        key.position.set(2, 3, 4);
        scene.add(key);
        camera.position.set(0, 0.8, 2.4);
        camera.lookAt(0, 0.8, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(pbr_script, "pbr.js", 1.5);
    assert!(
        report.valid && report.diagnostics.is_empty(),
        "Expected zero diagnostics for full PBR material maps scene, got: {:?}",
        report.diagnostics
    );

    let sg = three_live_compiler::validate_three_script(pbr_script).expect("PBR SceneGraph");
    assert_eq!(sg.materials.len(), 1);
    let m = &sg.materials[0];
    assert!(m.base_color_texture.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
    assert!(m
        .metallic_roughness_texture
        .as_deref()
        .unwrap_or("")
        .starts_with("data:image/png;base64,"));
    assert!(m.normal_texture.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
    assert!(m.emissive_texture.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
    assert!(m.occlusion_texture.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
    assert!((m.occlusion_strength - 0.7).abs() < 1e-5);
    assert!((m.emissive_factor[0] - 2.0).abs() < 1e-5);

    // GLB write + read round-trip preserves all 5 PBR textures and scalar strengths
    let glb = transcode_three_to_glb(pbr_script).expect("PBR GLB");
    let round_trip = three_live_compiler::glb::read_glb(&glb).expect("read_glb round-trip");
    let rm = &round_trip.materials[0];
    assert_eq!(rm.metallic_roughness_texture, m.metallic_roughness_texture);
    assert_eq!(rm.normal_texture, m.normal_texture);
    assert_eq!(rm.emissive_texture, m.emissive_texture);
    assert_eq!(rm.occlusion_texture, m.occlusion_texture);
    assert!((rm.occlusion_strength - 0.7).abs() < 1e-4);
    assert!((rm.emissive_factor[0] - 2.0).abs() < 1e-4);

    // USDZ export packages all 5 PNG textures with 64-byte alignment
    let usdz = three_live_compiler::transcode_three_to_usdz(pbr_script).expect("PBR USDZ");
    let entry_count = verify_usdz_alignment(&usdz);
    assert!(
        entry_count >= 6,
        "Expected model.usda + 5 PBR PNG textures in USDZ archive, got {} entries",
        entry_count
    );

    // Headless software rasterizer renders glowing orange emissive pixels despite dark
    // baseColorTexture
    let opts = three_live_compiler::render::RenderOptions {
        width: 128,
        height: 128,
        view: three_live_compiler::render::RenderViewMode::Camera,
        ..Default::default()
    };
    let (_w, _h, rgba) = three_live_compiler::render::render_scene_rgba(&sg, &opts);
    let glowing_orange_pixels =
        rgba.chunks_exact(4).filter(|px| px[0] > 180 && px[1] > 60 && px[2] < 60).count();
    assert!(
        glowing_orange_pixels > 50,
        "Expected glowing orange emissiveMap stripe pixels over dark albedo in software render, got {}",
        glowing_orange_pixels
    );

    // An un-bakeable bumpMap (remote URL height map) is dropped rather than exported as a
    // tangent-space normal_texture.
    let url_bump_script = r#"
        scene.add(new THREE.Mesh(
            new THREE.BoxGeometry(1, 1, 1),
            new THREE.MeshStandardMaterial({ bumpMap: 'https://example.com/height.png', bumpScale: 3 })
        ));
    "#;
    let url_sg =
        three_live_compiler::validate_three_script(url_bump_script).expect("URL bump SceneGraph");
    assert!(
        url_sg.materials[0].normal_texture.is_none(),
        "Un-bakeable bumpMap must not become a normal_texture, got {:?}",
        url_sg.materials[0].normal_texture
    );
}

#[test]
fn test_a5_hemisphere_light_and_sprite_parity() {
    // 1. HemisphereLight: zero TL102 warnings, GLB round-trip preserves ground_color, and software
    //    rasterizer shades upper hemisphere sky-blue and lower hemisphere warm-orange.
    let hemi_script = r#"
        const hemi = new THREE.HemisphereLight(0x0066ff, 0xff4400, 0.9);
        hemi.position.set(0, 1, 0);
        scene.add(hemi);

        const sphere = new THREE.Mesh(
            new THREE.SphereGeometry(1.0, 32, 24),
            new THREE.MeshStandardMaterial({ color: 0xffffff, roughness: 1.0, metalness: 0.0 })
        );
        sphere.position.set(0, 1.0, 0);
        scene.add(sphere);

        camera.position.set(0, 1.0, 3.0);
        camera.lookAt(0, 1.0, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(hemi_script, "hemi.js", 1.5);
    assert!(
        report.valid && !report.diagnostics.iter().any(|d| d.code == "TL102"),
        "HemisphereLight must not emit TL102 degraded-alias warning: {:?}",
        report.diagnostics
    );

    let sg = three_live_compiler::validate_three_script(hemi_script).expect("Hemi SceneGraph");
    assert_eq!(sg.lights.len(), 1);
    assert_eq!(sg.lights[0].light_type, "hemisphere");
    let gc = sg.lights[0].ground_color.expect("ground_color present");
    assert!(gc[0] > gc[2] && sg.lights[0].color[2] > sg.lights[0].color[0]);

    let glb = transcode_three_to_glb(hemi_script).expect("Hemi GLB");
    let rt = three_live_compiler::glb::read_glb(&glb).expect("Hemi read_glb");
    assert_eq!(rt.lights.len(), 1);
    assert_eq!(rt.lights[0].light_type, "hemisphere");
    assert!(rt.lights[0].ground_color.is_some());

    let opts = three_live_compiler::render::RenderOptions {
        width: 128,
        height: 128,
        view: three_live_compiler::render::RenderViewMode::Camera,
        ..Default::default()
    };
    let (_w, _h, rgba) = three_live_compiler::render::render_scene_rgba(&sg, &opts);
    // Sample upper sphere pixel (x=64, y=28) vs lower sphere pixel (x=64, y=100)
    let top_idx = (28 * 128 + 64) * 4;
    let bot_idx = (100 * 128 + 64) * 4;
    let top_px = &rgba[top_idx..top_idx + 4];
    let bot_px = &rgba[bot_idx..bot_idx + 4];
    assert!(
        top_px[2] > top_px[0] + 20 && top_px[2] > bot_px[2] + 30,
        "Upper hemisphere should be sky-blue (B > R + 20 and top B > bottom B + 30), got top={:?} bot={:?}",
        top_px,
        bot_px
    );
    assert!(
        bot_px[0] > bot_px[2] + 15 && bot_px[0] > top_px[0] + 15,
        "Lower hemisphere should be ground-orange (R > B + 15 and bottom R > top R + 15), got top={:?} bot={:?}",
        top_px,
        bot_px
    );

    // 2. Sprite + SpriteMaterial: zero TL102/TL205 warnings, spherical billboard faces orthogonal
    //    cameras
    let sprite_script = r#"
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        const c = document.createElement('canvas');
        c.width = 32; c.height = 32;
        const ctx = c.getContext('2d');
        ctx.fillStyle = '#00ff66';
        ctx.fillRect(0, 0, 32, 32);
        const tex = new THREE.CanvasTexture(c);

        const sprite = new THREE.Sprite(new THREE.SpriteMaterial({
            map: tex,
            color: 0xffffff,
            opacity: 0.9,
            rotation: Math.PI / 6
        }));
        sprite.scale.set(1.2, 1.2, 1.2);
        sprite.position.set(0, 0.8, 0);
        scene.add(sprite);

        camera.position.set(0, 0.8, 3.0);
        camera.lookAt(0, 0.8, 0);
    "#;

    let sp_report = three_live_compiler::validate_and_lint_scene(sprite_script, "sprite.js", 1.5);
    assert!(
        sp_report.valid
            && !sp_report.diagnostics.iter().any(|d| d.code == "TL102" || d.code == "TL205"),
        "Sprite must not emit TL102 or TL205 warnings: {:?}",
        sp_report.diagnostics
    );

    let sp_sg =
        three_live_compiler::validate_three_script(sprite_script).expect("Sprite SceneGraph");
    let sp_node = sp_sg.nodes.iter().find(|n| n.mesh.is_some()).expect("Sprite mesh node");
    assert_eq!(
        sp_node.xr_normalized.as_ref().and_then(|v| v["billboard"].as_str()),
        Some("spherical")
    );

    // Because Sprite billboards spherically toward the active camera, BOTH Front (+Z) AND Right
    // (+X) views must see broad green coverage (whereas an un-billboarded XY quad would be edge-on
    // from +X!).
    for view in [
        three_live_compiler::render::RenderViewMode::Front,
        three_live_compiler::render::RenderViewMode::Right,
        three_live_compiler::render::RenderViewMode::Top,
    ] {
        let v_opts = three_live_compiler::render::RenderOptions {
            width: 96,
            height: 96,
            view,
            ..Default::default()
        };
        let (_vw, _vh, v_rgba) = three_live_compiler::render::render_scene_rgba(&sp_sg, &v_opts);
        let green_px = v_rgba
            .chunks_exact(4)
            .filter(|px| px[1] > 150 && u16::from(px[1]) > u16::from(px[0]) + 60)
            .count();
        assert!(
            green_px > 200,
            "Expected spherical Sprite billboard to face {:?} view (>200 green px), got {}",
            view,
            green_px
        );
    }
}

#[test]
fn test_a6_2d_curves_and_scene_helpers_parity() {
    let script = r#"
        scene.add(new THREE.AmbientLight(0xffffff, 0.8));
        const dir = new THREE.DirectionalLight(0xffffff, 1.1);
        dir.position.set(3, 5, 4);
        scene.add(dir);

        // 1. 2D CurvePath + SplineCurve + EllipseCurve hole extruded into a 3D cam plate
        const shape = new THREE.Shape();
        shape.moveTo(-0.6, -0.35);
        shape.add(new THREE.LineCurve(new THREE.Vector2(-0.6, -0.35), new THREE.Vector2(0.6, -0.35)));
        shape.splineThru([
            new THREE.Vector2(0.75, 0.1),
            new THREE.Vector2(0.0, 0.55),
            new THREE.Vector2(-0.75, 0.1)
        ]);
        shape.closePath();

        const bore = new THREE.Path();
        bore.add(new THREE.EllipseCurve(0, 0.05, 0.18, 0.12, 0, Math.PI * 2, false, 0));
        shape.holes.push(bore);

        const camMesh = new THREE.Mesh(
            new THREE.ExtrudeGeometry(shape, { depth: 0.2, bevelEnabled: true, bevelThickness: 0.02, bevelSize: 0.02, curveSegments: 16 }),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8, metalness: 0.35, roughness: 0.4 })
        );
        camMesh.name = 'ExtrudedSplineCam';
        camMesh.position.set(0, 0.45, 0);
        scene.add(camMesh);

        // 2. SplineCurve -> LatheGeometry goblet
        const profile = new THREE.SplineCurve([
            new THREE.Vector2(0.02, 0.0),
            new THREE.Vector2(0.22, 0.04),
            new THREE.Vector2(0.06, 0.35),
            new THREE.Vector2(0.26, 0.75)
        ]);
        const goblet = new THREE.Mesh(
            new THREE.LatheGeometry(profile.getPoints(20), 20),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b, metalness: 0.6, roughness: 0.25 })
        );
        goblet.name = 'SplineGoblet';
        goblet.position.set(-1.1, 0, 0);
        scene.add(goblet);

        // 3. Exportable Scene Helpers (GridHelper, AxesHelper, ArrowHelper, BoxHelper, Box3Helper)
        const grid = new THREE.GridHelper(4, 8, 0x64748b, 0x334155);
        grid.name = 'FloorGrid';
        scene.add(grid);

        const axes = new THREE.AxesHelper(1.2);
        axes.name = 'OriginAxes';
        axes.position.set(1.1, 0.02, 0);
        scene.add(axes);

        const arrow = new THREE.ArrowHelper(
            new THREE.Vector3(0, 1, 0),
            new THREE.Vector3(1.1, 0.02, 0),
            1.1,
            0xfacc15,
            0.28,
            0.16
        );
        arrow.name = 'ForceArrow';
        scene.add(arrow);

        const boxHelper = new THREE.BoxHelper(camMesh, 0x22c55e);
        boxHelper.name = 'CamBoundsHelper';
        scene.add(boxHelper);

        const zoneBox = new THREE.Box3(new THREE.Vector3(-1.45, 0, -0.35), new THREE.Vector3(-0.75, 0.85, 0.35));
        const box3Helper = new THREE.Box3Helper(zoneBox, 0xe879f9);
        box3Helper.name = 'GobletZoneHelper';
        scene.add(box3Helper);

        camera.position.set(0, 1.6, 4.2);
        camera.lookAt(0, 0.45, 0);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(script, "a6_helpers.js", 1.5);
    assert!(
        report.valid && !report.diagnostics.iter().any(|d| d.code == "TL102"),
        "A6 2D curves and scene helpers must compile with valid=true and zero TL102 warnings: {:?}",
        report.diagnostics
    );

    let glb = transcode_three_to_glb(script).expect("A6 GLB export succeeds");
    let usdz =
        three_live_compiler::transcode_three_to_usdz(script).expect("A6 USDZ export succeeds");
    assert!(glb.len() > 4000 && usdz.len() > 4000);

    let sg = validate_three_script(script).expect("A6 SceneGraph");
    assert!(
        sg.meshes.len() >= 9,
        "Expected meshes for cam, goblet, grid(2), axes(3), arrow(2), boxHelper, and box3Helper, got {}",
        sg.meshes.len()
    );

    let opts = three_live_compiler::render::RenderOptions {
        width: 160,
        height: 120,
        view: three_live_compiler::render::RenderViewMode::Camera,
        ..Default::default()
    };
    let (_w, _h, rgba) = three_live_compiler::render::render_scene_rgba(&sg, &opts);
    let non_bg_px =
        rgba.chunks_exact(4).filter(|px| px[0] > 60 || px[1] > 60 || px[2] > 70).count();
    assert!(
        non_bg_px > 800,
        "Expected rendered pixels from extruded curve cam, spline goblet, and scene helpers, got {}",
        non_bg_px
    );
}

#[test]
fn test_a7_mechanical_joints_glb_usdz_lint_and_sim() {
    let script = r#"
        const floor = new THREE.Mesh(
            new THREE.BoxGeometry(8, 0.2, 8),
            new THREE.MeshStandardMaterial({ color: 0x334155 })
        );
        floor.name = 'Floor';
        floor.position.set(0, -0.1, 0);
        floor.userData.xr = { collidable: true };
        scene.add(floor);

        const frame = new THREE.Mesh(
            new THREE.BoxGeometry(0.2, 2.0, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x64748b })
        );
        frame.name = 'DoorFrame';
        frame.position.set(-1.5, 1.0, 0);
        scene.add(frame);

        const door = new THREE.Mesh(
            new THREE.BoxGeometry(0.8, 1.8, 0.08),
            new THREE.MeshStandardMaterial({ color: 0x38bdf8 })
        );
        door.name = 'HingeDoor';
        door.position.set(-1.0, 1.0, 0);
        door.userData.xr = {
            joint: {
                type: 'hinge',
                target: 'DoorFrame',
                anchor: [-0.4, 0, 0],
                axis: 'y',
                limits: [-15, 60],
                motorSpeed: 3.0,
                motorMaxForce: 80
            }
        };
        scene.add(door);

        const slider = new THREE.Mesh(
            new THREE.BoxGeometry(0.4, 0.25, 0.4),
            new THREE.MeshStandardMaterial({ color: 0x22c55e })
        );
        slider.name = 'SliderCarriage';
        slider.position.set(0.5, 0.6, 0);
        slider.userData.xr = {
            joint: {
                type: 'slider',
                axis: 'x',
                limits: [-0.2, 0.4],
                motorSpeed: 1.5,
                motorMaxForce: 60
            }
        };
        scene.add(slider);

        const springBob = new THREE.Mesh(
            new THREE.SphereGeometry(0.18, 16, 12),
            new THREE.MeshStandardMaterial({ color: 0xf59e0b })
        );
        springBob.name = 'SpringBob';
        springBob.position.set(1.8, 1.5, 0);
        springBob.userData.xr = {
            rigidBody: { body: 'dynamic', mass: 1.0 },
            joint: {
                type: 'spring',
                anchor: [0, 0.5, 0],
                restLength: 0.5,
                stiffness: 10000,
                damping: 80,
                limits: [0.1, 1.2]
            }
        };
        scene.add(springBob);

        const ballLamp = new THREE.Mesh(
            new THREE.SphereGeometry(0.16, 16, 12),
            new THREE.MeshStandardMaterial({ color: 0xe879f9 })
        );
        ballLamp.name = 'BallLamp';
        ballLamp.position.set(0.3, 1.6, -1.2);
        ballLamp.userData.xr = {
            joint: {
                type: 'ball',
                anchor: [-0.3, 0.5, 0],
                limits: [-30, 30],
                damping: 1.5
            }
        };
        scene.add(ballLamp);

        scene.add(new THREE.AmbientLight(0xffffff, 0.7));
        const sun = new THREE.DirectionalLight(0xffffff, 1.5);
        sun.position.set(3, 5, 4);
        scene.add(sun);
        camera.position.set(0.2, 2.2, 6.2);
        camera.lookAt(0.2, 0.9, -0.3);
    "#;

    let report = three_live_compiler::validate_and_lint_scene(script, "a7_joints.js", 1.5);
    assert!(
        report.valid && !report.diagnostics.iter().any(|d| d.code.starts_with("TL2")),
        "Expected clean validation for valid mechanical joints, got: {:?}",
        report.diagnostics
    );

    // Broken joint.target emits TL204 diagnostic.
    let broken_script = r#"
        const m = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.4, 0.4), new THREE.MeshStandardMaterial());
        m.name = 'OrphanDoor';
        m.position.set(0, 0.2, 0);
        m.userData.xr = { joint: { type: 'hinge', target: 'MissingFrame' } };
        scene.add(m);
        scene.add(new THREE.AmbientLight(0xffffff, 1.0));
        camera.position.set(0, 1, 3);
        camera.lookAt(0, 0.2, 0);
    "#;
    let broken_report =
        three_live_compiler::validate_and_lint_scene(broken_script, "a7_broken.js", 1.5);
    assert!(
        broken_report
            .diagnostics
            .iter()
            .any(|d| d.code == "TL204" && d.message.contains("MissingFrame")),
        "Expected TL204 broken node reference for MissingFrame, got: {:?}",
        broken_report.diagnostics
    );

    // GLB carries extras.xr.joint and ANDROID_xr_scenecore.joint.
    let glb = transcode_three_to_glb(script).expect("A7 GLB export succeeds");
    let glb_str = String::from_utf8_lossy(&glb);
    assert!(
        glb_str.contains("\"joint\"") && glb_str.contains("\"DoorFrame\""),
        "Expected GLB JSON chunk to preserve joint traits"
    );

    // USDZ carries PhysicsRevoluteJoint, PhysicsPrismaticJoint, PhysicsDistanceJoint,
    // PhysicsSphericalJoint.
    let usdz = three_live_compiler::transcode_three_to_usdz(script).expect("A7 USDZ export");
    let usdz_str = String::from_utf8_lossy(&usdz);
    for prim in [
        "PhysicsRevoluteJoint",
        "PhysicsPrismaticJoint",
        "PhysicsDistanceJoint",
        "PhysicsSphericalJoint",
    ] {
        assert!(usdz_str.contains(prim), "Expected USDZ to emit {}, missing in USDA payload", prim);
    }

    // 60 Hz deterministic simulation articulates all 4 joint types cleanly.
    let (sim, _snaps) = three_live_compiler::sim::simulate_scenario_from_source(
        script.as_bytes(),
        false,
        1.2,
        &[],
        &[],
    )
    .expect("A7 60 Hz simulation succeeds");
    assert!(
        sim.triggered_events.iter().any(|e| e == "xrTrait:joint:HingeDoor")
            && sim.triggered_events.iter().any(|e| e == "xrTrait:joint:SliderCarriage"),
        "Expected xrTrait:joint:* triggered events, got: {:?}",
        sim.triggered_events
    );
    let door_delta = sim.bodies.iter().find(|n| n.name == "HingeDoor").expect("HingeDoor present");
    let slider_delta =
        sim.bodies.iter().find(|n| n.name == "SliderCarriage").expect("SliderCarriage present");
    let ball_delta = sim.bodies.iter().find(|n| n.name == "BallLamp").expect("BallLamp present");
    assert!(
        (door_delta.final_rotation[1]).abs() > 0.2,
        "Expected HingeDoor Y rotation from motor, got {:?}",
        door_delta.final_rotation
    );
    assert!(
        (slider_delta.final_translation[0] - 0.9).abs() < 0.03,
        "Expected SliderCarriage X translation clamped near 0.5 + 0.4 = 0.9, got {:?}",
        slider_delta.final_translation
    );
    assert!(
        ball_delta.final_translation[0] < 0.3
            && ball_delta.final_translation.iter().all(|v| v.is_finite()),
        "Expected BallLamp pendulum to swing inward cleanly, got {:?}",
        ball_delta.final_translation
    );
    // Stiff spring (k=10000) must remain finite with no NaN/explosion.
    for n in &sim.bodies {
        assert!(
            n.final_translation.iter().all(|v| v.is_finite())
                && n.final_rotation.iter().all(|v| v.is_finite()),
            "Non-finite state on {}: {:?}",
            n.name,
            n
        );
    }
}

// ---------------------------------------------------------------------------------------------
// B1: Reference-driven authoring (`three_live_render` `reference` + `three-live-cli --reference`)
// ---------------------------------------------------------------------------------------------

const REF_BLUEPRINT_ADAM7: &[u8] = include_bytes!("fixtures/reference/blueprint_2to1_adam7.png");
const REF_CUTOUT_PALETTE: &[u8] = include_bytes!("fixtures/reference/cutout_palette.png");
const REF_SQUARE_BASELINE: &[u8] = include_bytes!("fixtures/reference/square_baseline.jpg");
const REF_SQUARE_PROGRESSIVE: &[u8] = include_bytes!("fixtures/reference/square_progressive.jpg");
const REF_RECT_2TO1_JPG: &[u8] = include_bytes!("fixtures/reference/oriented_6.jpg");

fn ref_px(img: &three_live_compiler::ReferenceImage, x: u32, y: u32) -> [u8; 4] {
    let o = ((y * img.width + x) * 4) as usize;
    [img.rgba[o], img.rgba[o + 1], img.rgba[o + 2], img.rgba[o + 3]]
}

fn ref_data_uri(mime: &str, bytes: &[u8]) -> String {
    format!("data:{};base64,{}", mime, three_live_compiler::encode_base64(bytes))
}

#[test]
fn test_b1_reference_decoder_handles_real_encoder_output() {
    use three_live_compiler::decode_reference_image;

    // ImageMagick Adam7-interlaced RGB PNG (dark 2:1-ish rectangle on white).
    let (img, size) = decode_reference_image(REF_BLUEPRINT_ADAM7).expect("adam7 png");
    assert_eq!(size, [400, 200]);
    assert_eq!((img.width, img.height), (400, 200));
    assert_eq!(ref_px(&img, 2, 2), [255, 255, 255, 255]);
    let c = ref_px(&img, 200, 100);
    assert!(c[0] < 60 && c[1] < 60 && c[2] < 80, "center {:?}", c);

    // Indexed (palette) PNG with tRNS transparency.
    let (img, _) = decode_reference_image(REF_CUTOUT_PALETTE).expect("palette png");
    assert_eq!(ref_px(&img, 1, 1)[3], 0);
    let c = ref_px(&img, 32, 16);
    assert!(c[3] == 255 && c[0] > 200 && c[1] < 100, "center {:?}", c);

    // Baseline and progressive JPEG.
    for bytes in [REF_SQUARE_BASELINE, REF_SQUARE_PROGRESSIVE] {
        let (img, size) = decode_reference_image(bytes).expect("jpeg");
        assert_eq!(size, [300, 300]);
        assert!(ref_px(&img, 5, 5)[0] > 240);
        assert!(ref_px(&img, 150, 150)[0] < 90);
    }

    // EXIF Orientation = 6 (rotate 90 CW) inserted as an APP1 segment after SOI.
    let tiff: [u8; 26] =
        [b'M', b'M', 0, 42, 0, 0, 0, 8, 0, 1, 0x01, 0x12, 0, 3, 0, 0, 0, 1, 0, 6, 0, 0, 0, 0, 0, 0];
    let mut app1 = vec![0xFF, 0xE1];
    app1.extend_from_slice(&((2 + 6 + tiff.len()) as u16).to_be_bytes());
    app1.extend_from_slice(b"Exif\0\0");
    app1.extend_from_slice(&tiff);
    let mut rotated = REF_RECT_2TO1_JPG[..2].to_vec();
    rotated.extend_from_slice(&app1);
    rotated.extend_from_slice(&REF_RECT_2TO1_JPG[2..]);
    let (plain, _) = decode_reference_image(REF_RECT_2TO1_JPG).expect("plain jpeg");
    assert_eq!((plain.width, plain.height), (200, 100));
    let (img, size) = decode_reference_image(&rotated).expect("exif jpeg");
    assert_eq!(size, [100, 200], "EXIF orientation 6 swaps width and height");
    // The black block at the top-left of the landscape image lands at the top-right.
    assert!(ref_px(&img, 75, 20)[0] < 60, "{:?}", ref_px(&img, 75, 20));
    assert!(ref_px(&img, 20, 20)[0] > 200, "{:?}", ref_px(&img, 20, 20));
}

fn render_with_reference(code: &str, reference: &str, view: &str) -> serde_json::Value {
    let req = serde_json::json!({
        "jsonrpc": "2.0",
        "id": 7,
        "method": "tools/call",
        "params": {
            "name": "three_live_render",
            "arguments": { "code": code, "reference": reference, "view": view }
        }
    });
    three_live_compiler::handle_mcp_request(&req).expect("response")["result"].clone()
}

fn ref_meta(result: &serde_json::Value) -> serde_json::Value {
    let text = result["content"][1]["text"].as_str().expect("meta text");
    serde_json::from_str(text).expect("meta json")
}

const PANEL_SCENE_WIDE: &str = r#"
    const panel = new THREE.Mesh(new THREE.BoxGeometry(3.2, 1, 0.4),
        new THREE.MeshStandardMaterial({ color: 0x3b82f6 }));
    panel.name = 'Panel';
    panel.position.y = 0.5;
    scene.add(panel);
    scene.add(new THREE.AmbientLight(0xffffff, 0.6));
"#;

#[test]
fn test_b1_mcp_reference_comparison_metrics_and_sheet() {
    let uri = ref_data_uri("image/png", REF_BLUEPRINT_ADAM7);

    // Matching proportions: high IoU, small aspect error, 4-panel sheet at the reference aspect.
    let res = render_with_reference(PANEL_SCENE_WIDE, &uri, "front");
    assert_eq!(res["isError"], false, "{}", res);
    assert_eq!(res["content"][0]["type"], "image");
    assert!(res["content"][0]["data"].as_str().unwrap().starts_with("iVBORw0KGgo"));
    let meta = ref_meta(&res);
    let r = &meta["reference"];
    assert_eq!(r["view"], "front");
    assert_eq!(r["silhouetteReliable"], true);
    assert_eq!(r["referenceSegmentation"], "background");
    assert!(r["silhouetteIou"].as_f64().unwrap() > 0.9, "{}", r);
    assert!(r["aspectError"].as_f64().unwrap().abs() < 0.05, "{}", r);
    let panel = r["panelSize"].as_array().unwrap();
    let (pw, ph) = (panel[0].as_u64().unwrap(), panel[1].as_u64().unwrap());
    assert_eq!(pw, (ph as f64 * 2.0).round() as u64, "panel follows the 2:1 reference aspect");
    assert_eq!(meta["width"].as_u64().unwrap(), pw * 3 + ph + 6);
    assert!(meta["width"].as_u64().unwrap() <= 2560);

    // Wrong proportions (cube): low IoU, negative aspect error, actionable guidance.
    let cube = PANEL_SCENE_WIDE.replace("3.2, 1, 0.4", "1, 1, 0.4");
    let meta = ref_meta(&render_with_reference(&cube, &uri, "front"));
    let r = &meta["reference"];
    assert!(r["silhouetteIou"].as_f64().unwrap() < 0.6, "{}", r);
    assert!(r["aspectError"].as_f64().unwrap() < -0.5, "{}", r);
    let guidance = r["guidance"].to_string();
    assert!(guidance.contains("narrower") && guidance.contains("DIFF"), "{}", guidance);

    // Transparent cutout reference is segmented by alpha; JPEG reference via file path.
    let meta = ref_meta(&render_with_reference(
        PANEL_SCENE_WIDE,
        &ref_data_uri("image/png", REF_CUTOUT_PALETTE),
        "front",
    ));
    assert_eq!(meta["reference"]["referenceSegmentation"], "alpha");
    assert!(meta["reference"]["silhouetteIou"].as_f64().unwrap() > 0.7);

    let jpg_path = std::env::temp_dir().join(format!("tl_ref_{}.jpg", std::process::id()));
    std::fs::write(&jpg_path, REF_SQUARE_BASELINE).unwrap();
    let res = render_with_reference(&cube, jpg_path.to_str().unwrap(), "front");
    let _ = std::fs::remove_file(&jpg_path);
    let r = &ref_meta(&res)["reference"];
    assert_eq!(r["referenceSize"], serde_json::json!([300, 300]));
    assert!(r["silhouetteIou"].as_f64().unwrap() > 0.9, "{}", r);

    // Default view with a reference is `camera`, never the quad sheet.
    let req = serde_json::json!({
        "jsonrpc": "2.0", "id": 8, "method": "tools/call",
        "params": { "name": "three_live_render",
                    "arguments": { "code": PANEL_SCENE_WIDE, "reference": uri } }
    });
    let res = three_live_compiler::handle_mcp_request(&req).unwrap()["result"].clone();
    assert_eq!(ref_meta(&res)["reference"]["view"], "camera");
}

#[test]
fn test_b1_mcp_reference_errors_and_prompt() {
    let call = |args: serde_json::Value| {
        let req = serde_json::json!({
            "jsonrpc": "2.0", "id": 9, "method": "tools/call",
            "params": { "name": "three_live_render", "arguments": args }
        });
        three_live_compiler::handle_mcp_request(&req).unwrap()["result"].clone()
    };
    let uri = ref_data_uri("image/png", REF_BLUEPRINT_ADAM7);
    for (args, needle) in [
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": uri, "turntable": true }),
            "single still",
        ),
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": uri, "frames": 4 }),
            "single still",
        ),
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": "https://x.test/a.png" }),
            "network",
        ),
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": "data:image/gif;base64,R0lGODlhAQABAAAAACw=" }),
            "GIF",
        ),
        (serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": 42 }), "must be a string"),
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": "/no/such/ref.png" }),
            "Failed reading",
        ),
        (
            serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": uri, "outputPath": "/tmp/x.gif" }),
            ".png",
        ),
    ] {
        let res = call(args);
        assert_eq!(res["isError"], true, "{}", res);
        let text = res["content"][0]["text"].as_str().unwrap();
        assert!(text.contains(needle), "expected {:?} in {:?}", needle, text);
    }
    // `reference: null` behaves like no reference (plain quad render).
    let res = call(serde_json::json!({ "code": PANEL_SCENE_WIDE, "reference": null }));
    assert_eq!(res["isError"], false);
    assert!(ref_meta(&res).get("reference").is_none());

    // Prompt discovery and argument validation.
    let list = three_live_compiler::handle_mcp_request(
        &serde_json::json!({ "jsonrpc": "2.0", "id": 1, "method": "prompts/list" }),
    )
    .unwrap();
    assert!(list.to_string().contains("build_from_reference"));
    let missing = three_live_compiler::handle_mcp_request(&serde_json::json!({
        "jsonrpc": "2.0", "id": 2, "method": "prompts/get",
        "params": { "name": "build_from_reference", "arguments": {} }
    }))
    .unwrap();
    assert!(missing.get("error").is_some());
    let got = three_live_compiler::handle_mcp_request(&serde_json::json!({
        "jsonrpc": "2.0", "id": 3, "method": "prompts/get",
        "params": { "name": "build_from_reference",
                    "arguments": { "reference": "desk.jpg", "view": "front", "description": "1.2 m wide" } }
    }))
    .unwrap();
    let text = got["result"]["messages"][0]["content"]["text"].as_str().unwrap();
    assert!(
        text.contains("\"desk.jpg\"")
            && text.contains("view: \"front\"")
            && text.contains("1.2 m wide")
    );
    assert!(text.contains("silhouetteIou"));
}

// ---------------------------------------------------------------------------------------------
// A8: Deterministic PBR material presets (`THREE.ProceduralTexture`, `userData.xr.material`)
// ---------------------------------------------------------------------------------------------

#[test]
fn test_a8_material_presets_use_native_kernels_and_export() {
    use three_live_compiler::material_preset::{generate_material_preset, PresetParams};
    let script = r#"
        const plank = new THREE.Mesh(new THREE.BoxGeometry(2, 0.2, 0.4),
            new THREE.MeshStandardMaterial({
                ...THREE.ProceduralTexture.wood({ size: 64, seed: 7, color: 0x996633 })
            }));
        plank.name = 'Plank';
        plank.position.set(0, 0.1, 0);
        scene.add(plank);
        const wall = new THREE.Mesh(new THREE.BoxGeometry(2, 1, 0.2),
            new THREE.MeshStandardMaterial({ color: 0x9a3b2e }));
        wall.name = 'Wall';
        wall.position.set(0, 0.7, 0);
        wall.userData.xr = { material: { preset: 'brick', size: 64 } };
        scene.add(wall);
        const plate = new THREE.Mesh(new THREE.BoxGeometry(1, 1, 0.05),
            new THREE.MeshStandardMaterial({ ...THREE.ProceduralTexture.brushedMetal({ size: 32 }) }));
        plate.name = 'Plate';
        plate.position.set(1.5, 0.5, 0);
        scene.add(plate);
        scene.add(new THREE.AmbientLight(0xffffff, 0.6));
    "#;
    let report = three_live_compiler::validate_and_lint_scene(script, "presets.js", 1.5);
    assert!(
        report.valid && report.diagnostics.is_empty(),
        "Expected zero diagnostics for material presets, got: {:?}",
        report.diagnostics
    );
    let sg = three_live_compiler::validate_three_script(script).expect("preset SceneGraph");
    assert_eq!(sg.materials.len(), 3);
    for m in &sg.materials {
        for tex in [&m.base_color_texture, &m.normal_texture, &m.metallic_roughness_texture] {
            assert!(tex.as_deref().unwrap_or("").starts_with("data:image/png;base64,"));
        }
    }

    // The exported wood albedo is exactly the native kernel's output (Boa uses the native hook).
    let wood_png = three_live_compiler::load_reference_bytes(
        sg.materials[0].base_color_texture.as_deref().unwrap(),
    )
    .unwrap();
    let (decoded, size) = three_live_compiler::decode_reference_image(&wood_png).unwrap();
    assert_eq!(size, [64, 64]);
    let expected = generate_material_preset(&PresetParams {
        kind: 2,
        size: 64,
        scale: 10,
        seed: 7,
        color: [153.0 / 255.0, 102.0 / 255.0, 51.0 / 255.0],
        color2: [153.0 / 255.0, 102.0 / 255.0, 51.0 / 255.0],
        roughness: 0.6,
        normal_strength: 1.0,
    });
    assert_eq!(decoded.rgba, expected.albedo, "exported wood albedo == native kernel output");

    // Declarative brick bakes the mesh color as the tint and resets the factor to white;
    // brushedMetal exports metalness through the packed texture.
    let wall = &sg.materials[1];
    assert!(wall.base_color[0] > 0.99 && wall.base_color[1] > 0.99);
    assert!((sg.materials[2].metallic - 1.0).abs() < 1e-6);

    // GLB and USDZ exports succeed and carry the textures.
    let glb = transcode_three_to_glb(script).expect("preset GLB");
    assert!(glb.len() > 8000);
    let usdz = three_live_compiler::transcode_three_to_usdz(script).expect("preset USDZ");
    assert!(verify_usdz_alignment(&usdz) >= 4);

    // Texture quota: 6 distinct presets (18 textures) fail validation with the same TL105
    // that export hits; dropping normal maps (12 textures) passes; repeated presets share.
    let many = |extra: &str| {
        format!(
            r#"
            ['wood', 'marble', 'brick', 'concrete', 'leather', 'rust'].forEach((p, i) => {{
                const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5),
                    new THREE.MeshStandardMaterial({{ ...THREE.ProceduralTexture[p]({{ size: 32{} }}) }}));
                m.name = 'S' + i;
                m.position.set(i * 0.7, 0.25, 0);
                scene.add(m);
            }});
            scene.add(new THREE.AmbientLight(0xffffff, 0.6));
        "#,
            extra
        )
    };
    let over = three_live_compiler::validate_and_lint_scene(&many(""), "many.js", 1.5);
    assert!(!over.valid, "18 textures must fail validation");
    assert!(over
        .diagnostics
        .iter()
        .any(|d| d.code == "TL105" && d.message.contains("SECURITY_3D_MAX_TEXTURES")));
    assert!(transcode_three_to_glb(&many("")).is_err());
    let flat = many(", normalStrength: 0");
    let ok = three_live_compiler::validate_and_lint_scene(&flat, "flat.js", 1.5);
    assert!(ok.valid, "12 textures pass: {:?}", ok.diagnostics);
    assert!(transcode_three_to_glb(&flat).is_ok());
}
