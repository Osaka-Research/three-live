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

//! Phase 4: Deterministic 60 Hz Scenario, `KHR_interactivity`, `orbit`/`explode`,
//! and `xr-live-sim` Time-Stepper for `three-live-cli render` and `three-live-cli sim`.

use crate::glb::read_glb;
use crate::scene::{SceneGraph, SceneNode};
use serde::{Deserialize, Serialize};
use serde_json::Value;

/// Fixed simulation timestep (`dt = 1/60 s`).
pub const SIM_DT_SEC: f64 = 1.0 / 60.0;
/// Maximum recursion depth for chained `sendEvent -> onReceive` dispatches.
const MAX_EVENT_CHAIN_DEPTH: usize = 8;
/// Maximum total nodes allowed when `spawner` traits instantiate clones.
const MAX_SIM_NODES: usize = 512;

/// One scripted user/agent action in a `three-live-cli sim --actions='[...]'` timeline.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct SimAction {
    /// Timestamp in seconds when the action starts (`>= 0.0`).
    #[serde(default)]
    pub at: f64,
    /// Action type: `"select"`, `"explode"`, `"moveCharacter"`, `"sendEvent"`, `"damage"`,
    /// `"heal"`.
    #[serde(rename = "type", alias = "action")]
    pub action_type: String,
    /// Target node name (accepts `"target"` or `"node"` in JSON).
    #[serde(default, alias = "node")]
    pub target: Option<String>,
    /// Explosion factor (`0.0..=1.0`) for `"explode"` actions.
    #[serde(default = "default_explode_factor")]
    pub factor: f32,
    /// Movement direction vector `[dx, dy, dz]` for `"moveCharacter"`.
    #[serde(default)]
    pub direction: Option<[f32; 3]>,
    /// Optional X movement component if `direction` is omitted.
    #[serde(default)]
    pub dx: f32,
    /// Optional Z movement component if `direction` is omitted.
    #[serde(default)]
    pub dz: f32,
    /// Duration in seconds for continuous actions like `"moveCharacter"` (defaults to a single
    /// tick or `0.5s`).
    #[serde(default)]
    pub duration: Option<f64>,
    /// Whether the character jumps on `"moveCharacter"`.
    #[serde(default)]
    pub jump: bool,
    /// Custom event identifier for `"sendEvent"`.
    #[serde(default, alias = "eventId", alias = "id")]
    pub event_id: Option<String>,
    /// Numeric delta for `"damage"` / `"heal"`.
    #[serde(default)]
    pub amount: Option<f32>,
}

fn default_explode_factor() -> f32 {
    1.0
}

/// Per-node initial vs. final state in [`SimulationReport`].
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimNodeReport {
    pub index: usize,
    pub name: String,
    pub initial_translation: [f32; 3],
    pub final_translation: [f32; 3],
    pub initial_rotation: [f32; 4],
    pub final_rotation: [f32; 4],
    pub initial_scale: [f32; 3],
    pub final_scale: [f32; 3],
    pub visible: bool,
    pub grounded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<f32>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_health: Option<f32>,
    pub destroyed: bool,
}

/// Complete JSON output returned by `three-live-cli sim --json`.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SimulationReport {
    pub duration_sec: f64,
    pub ticks_simulated: usize,
    pub explode_factor: f32,
    pub score: i64,
    pub scenario_state: String,
    pub completed_objectives: Vec<String>,
    pub triggered_events: Vec<String>,
    pub audio_cues_fired: Vec<String>,
    pub bodies: Vec<SimNodeReport>,
}

/// Active property interpolation tween on a node or material.
#[derive(Debug, Clone)]
struct ActiveTween {
    node_idx: usize,
    property: TweenProperty,
    from: [f32; 4],
    to: [f32; 4],
    elapsed: f64,
    duration: f64,
}

#[derive(Debug, Clone, Copy, PartialEq, Eq)]
enum TweenProperty {
    Translation,
    Rotation,
    Scale,
    MaterialColor(usize),
}

/// Runtime state for a single node during 60 Hz simulation.
#[derive(Debug, Clone)]
struct NodeSimState {
    name: String,
    base_translation: [f32; 3],
    base_rotation: [f32; 4],
    base_scale: [f32; 3],
    translation: [f32; 3],
    rotation: [f32; 4],
    scale: [f32; 3],
    velocity: [f32; 3],
    visible: bool,
    destroyed: bool,
    grounded: bool,
    toggle_active: bool,
    color_cycle_idx: usize,
    // XR traits
    xr: Value,
    interactivity: Option<Value>,
    group: String,
    is_character: bool,
    character_speed: f32,
    jump_impulse: f32,
    physics_mode: Option<String>,
    mass: f32,
    restitution: f32,
    friction: f32,
    linear_damping: f32,
    gravity_scale: f32,
    has_rigid_body_config: bool,
    half_extents: [f32; 3],
    // Integrity
    hp: Option<f32>,
    max_hp: Option<f32>,
    armor: f32,
    invuln_duration_sec: f64,
    invuln_remaining_sec: f64,
    on_zero: String,
    score_value: i64,
    // Agent
    agent_behavior: Option<String>,
    agent_speed: f32,
    agent_aggro_radius: f32,
    agent_attack_radius: f32,
    agent_waypoints: Vec<[f32; 3]>,
    agent_waypoint_idx: usize,
    agent_attack_cooldown_sec: f64,
    // Zone
    zone_kind: Option<String>,
    zone_rate: f32,
    zone_cooldown_sec: f64,
    zone_timer_sec: f64,
    zone_event: Option<String>,
    zone_fired_once: bool,
    // Spawner
    spawner_template: Option<String>,
    spawner_interval_sec: f64,
    spawner_max_active: usize,
    spawner_radius: f32,
    spawner_timer_sec: f64,
    spawner_active_children: usize,
    spawned_by: Option<usize>,
    // Mechanical joint (`hinge`, `slider`, `spring`, `ball`)
    joint: Option<JointSimState>,
}

#[derive(Debug, Clone)]
struct JointSimState {
    kind: String,
    target: String,
    anchor: [f32; 3],
    axis: [f32; 3],
    limits: Option<[f32; 2]>,
    stiffness: f32,
    damping: f32,
    rest_length: f32,
    motor_speed: f32,
    motor_max_force: f32,
    initialized: bool,
    target_local_anchor: [f32; 3],
    world_anchor: [f32; 3],
    effective_rest_len: f32,
    angle: f32,
    omega: f32,
    slide_pos: f32,
    slide_vel: f32,
    omega_vec: [f32; 3],
    joint_rot: [f32; 4],
}

/// Objective tracker entry.
#[derive(Debug, Clone)]
struct ObjectiveState {
    id: String,
    kind: String,
    target: String,
    radius: f32,
    amount: i64,
    count: f64,
    progress: f64,
    completed: bool,
    win_on_complete: bool,
}

/// Evaluates a `.js`, `.html`, or `.glb` scene over `duration_sec` at 60 Hz (`dt = 1/60 s`)
/// with the provided [`SimAction`] timeline, returning both the [`SimulationReport`] and
/// the requested snapshot [`SceneGraph`] frames.
pub fn simulate_scenario_from_source(
    source_bytes: &[u8],
    is_glb: bool,
    duration_sec: f64,
    actions: &[SimAction],
    snapshot_ticks: &[usize],
) -> Result<(SimulationReport, Vec<(f64, SceneGraph)>), String> {
    let duration_sec = duration_sec.clamp(0.0, 120.0);
    let total_ticks = ((duration_sec / SIM_DT_SEC).round() as usize).max(1);

    let initial_scene = compile_sim_scene(source_bytes, is_glb)?;

    // Pre-sample procedural JS `animate(t)` / `requestAnimationFrame` at snapshot ticks
    // (plus final tick) if source is JS/HTML.
    let mut sample_ticks: Vec<usize> = snapshot_ticks.to_vec();
    if !sample_ticks.contains(&0) {
        sample_ticks.push(0);
    }
    if !sample_ticks.contains(&total_ticks) {
        sample_ticks.push(total_ticks);
    }
    sample_ticks.sort_unstable();
    sample_ticks.dedup();

    let js_time_series: Vec<(usize, SceneGraph)> = if !is_glb {
        let raw_text = std::str::from_utf8(source_bytes).unwrap_or("");
        let (script, _) = crate::extract_script_from_source(raw_text);
        let sample_times: Vec<f64> =
            sample_ticks.iter().map(|&tk| (tk as f64) * SIM_DT_SEC).collect();
        match crate::with_three_engine(|engine| engine.execute_time_series(&script, &sample_times))
        {
            Ok(graphs) => sample_ticks.iter().copied().zip(graphs).collect(),
            Err(_) => Vec::new(),
        }
    } else {
        Vec::new()
    };

    Ok(run_simulation_loop(
        &initial_scene,
        &js_time_series,
        duration_sec,
        total_ticks,
        actions,
        snapshot_ticks,
    ))
}

/// Compiles a `.glb` or Three.js script / HTML source into the scene a simulation starts from.
fn compile_sim_scene(source_bytes: &[u8], is_glb: bool) -> Result<SceneGraph, String> {
    if is_glb {
        return read_glb(source_bytes);
    }
    let raw_text =
        std::str::from_utf8(source_bytes).map_err(|e| format!("Invalid UTF-8 in source: {}", e))?;
    let (script, html_diags) = crate::extract_script_from_source(raw_text);
    if html_diags.iter().any(|d| d.severity == "error") {
        return Err(html_diags[0].message.clone());
    }
    crate::with_three_engine(|engine| engine.execute(&script))
}

/// A 60 Hz simulation advanced step by step, with actions added as it runs (the agent gym).
///
/// State carries over between steps, so a step costs only its own ticks. Scenes whose
/// procedural `animate(t)` / `requestAnimationFrame` / interactivity hooks change them over time
/// are sampled once per step, at the step's last tick (`three_live_sim` samples its snapshot
/// ticks the same way).
#[derive(Debug, Clone)]
pub struct SimStepper {
    initial_scene: SceneGraph,
    /// Script to re-sample for time-varying scenes (`None` for static scenes and `.glb`).
    script: Option<String>,
    /// The latest procedural sample, keyed by tick.
    js_sample: Vec<(usize, SceneGraph)>,
    state: SimLoopState,
}

impl SimStepper {
    /// Compiles `source_bytes` and prepares the tick-0 state (runs `onStart` hooks).
    pub fn new(source_bytes: &[u8], is_glb: bool) -> Result<Self, String> {
        let initial_scene = compile_sim_scene(source_bytes, is_glb)?;
        let mut script = None;
        let mut js_sample = Vec::new();
        if !is_glb {
            let raw_text = std::str::from_utf8(source_bytes).unwrap_or("");
            let (src, _) = crate::extract_script_from_source(raw_text);
            if let Ok((mut graphs, time_varying)) =
                crate::with_three_engine(|engine| engine.execute_time_series_probed(&src, &[0.0]))
            {
                if let Some(g) = graphs.pop() {
                    js_sample.push((0, g));
                }
                if time_varying {
                    script = Some(src);
                }
            }
        }
        let state = init_sim_loop(&initial_scene, &js_sample, &[]);
        Ok(SimStepper { initial_scene, script, js_sample, state })
    }

    /// Last simulated tick.
    pub fn tick(&self) -> usize {
        self.state.tick
    }

    /// True when the scene changes over time on its own (`animate`, `requestAnimationFrame`, or
    /// interactivity function hooks).
    pub fn is_time_varying(&self) -> bool {
        self.script.is_some()
    }

    /// Simulates up to `to_tick` (at most 7200). `actions` is the whole timeline so far, with
    /// absolute `at` times; actions scheduled at or before the current tick never fire again.
    pub fn advance(&mut self, to_tick: usize, actions: &[SimAction]) {
        let to_tick = to_tick.min(7200);
        if to_tick <= self.state.tick {
            return;
        }
        if let Some(script) = self.script.as_deref() {
            let t = to_tick as f64 * SIM_DT_SEC;
            let sampled =
                crate::with_three_engine(|engine| engine.execute_time_series(script, &[t]))
                    .ok()
                    .and_then(|mut graphs| graphs.pop());
            match sampled {
                Some(g) => self.js_sample = vec![(to_tick, g)],
                // A failing `animate` (e.g. a timeout) freezes procedural motion, as in
                // `simulate_scenario_from_source`.
                None => self.script = None,
            }
        }
        advance_sim_loop(
            &mut self.state,
            &self.initial_scene,
            &self.js_sample,
            to_tick,
            actions,
            &[],
        );
    }

    /// Report for everything simulated so far.
    pub fn report(&self) -> SimulationReport {
        sim_loop_report(&self.state, self.state.tick as f64 * SIM_DT_SEC)
    }

    /// The scene as it looks at the current tick (for rendering).
    pub fn snapshot(&self) -> SceneGraph {
        build_snapshot_scene(
            &self.state.working_scene,
            &self.state.states,
            &self.js_sample,
            self.state.tick,
            self.state.explode_factor,
        )
    }
}

/// Convenience helper for `three-live-cli render --frames=N --duration=T [--trigger-select=...]`:
/// produces `frames` keyframe [`SceneGraph`]s across `[0, duration_sec]`.
pub fn evaluate_temporal_keyframes(
    source_bytes: &[u8],
    is_glb: bool,
    frames: usize,
    duration_sec: f64,
    trigger_select: Option<&str>,
) -> Result<Vec<(f64, SceneGraph)>, String> {
    let frames = frames.clamp(1, 64);
    let duration_sec = if frames <= 1 { 0.0 } else { duration_sec.clamp(0.05, 60.0) };
    let total_ticks = ((duration_sec / SIM_DT_SEC).round() as usize).max(1);
    let mut snapshot_ticks = Vec::with_capacity(frames);
    if frames == 1 {
        snapshot_ticks.push(0);
    } else {
        for k in 0..frames {
            let tick = ((k as f64) * (total_ticks as f64) / ((frames - 1) as f64)).round() as usize;
            snapshot_ticks.push(tick.min(total_ticks));
        }
    }
    let mut actions = Vec::new();
    if let Some(target) = trigger_select {
        if !target.trim().is_empty() {
            actions.push(SimAction {
                at: 0.0,
                action_type: "select".to_string(),
                target: Some(target.trim().to_string()),
                factor: 1.0,
                direction: None,
                dx: 0.0,
                dz: 0.0,
                duration: None,
                jump: false,
                event_id: None,
                amount: None,
            });
        }
    }
    let (_, keyframes) = simulate_scenario_from_source(
        source_bytes,
        is_glb,
        duration_sec,
        &actions,
        &snapshot_ticks,
    )?;
    Ok(keyframes)
}

/// Mutable state of an in-progress 60 Hz simulation, so it can be advanced in steps.
#[derive(Debug, Clone, Default)]
struct SimLoopState {
    working_scene: SceneGraph,
    states: Vec<NodeSimState>,
    objectives: Vec<ObjectiveState>,
    tweens: Vec<ActiveTween>,
    triggered_events: Vec<String>,
    audio_cues_fired: Vec<String>,
    score: i64,
    explode_factor: f32,
    scenario_state: String,
    snapshots: Vec<(f64, SceneGraph)>,
    /// Last simulated tick.
    tick: usize,
}

fn run_simulation_loop(
    initial_scene: &SceneGraph,
    js_time_series: &[(usize, SceneGraph)],
    duration_sec: f64,
    total_ticks: usize,
    actions: &[SimAction],
    snapshot_ticks: &[usize],
) -> (SimulationReport, Vec<(f64, SceneGraph)>) {
    let mut st = init_sim_loop(initial_scene, js_time_series, snapshot_ticks);
    advance_sim_loop(&mut st, initial_scene, js_time_series, total_ticks, actions, snapshot_ticks);
    let report = sim_loop_report(&st, duration_sec);
    (report, st.snapshots)
}

/// Builds the tick-0 state: node states, objectives, and `onSpawn` / `onStart` hooks.
fn init_sim_loop(
    initial_scene: &SceneGraph,
    js_time_series: &[(usize, SceneGraph)],
    snapshot_ticks: &[usize],
) -> SimLoopState {
    let mut working_scene = initial_scene.clone();
    if working_scene.nodes.is_empty() && !working_scene.meshes.is_empty() {
        for (i, m) in working_scene.meshes.iter().enumerate() {
            working_scene.nodes.push(SceneNode {
                name: m.name.clone(),
                parent: None,
                translation: m.translation,
                rotation: [0.0, 0.0, 0.0, 1.0],
                scale: m.scale,
                mesh: Some(i),
                xr_traits: m.xr_traits.clone(),
                xr_normalized: m.xr_normalized.clone(),
                xr_scenecore: m.xr_scenecore.clone(),
                xr_hubs: m.xr_hubs.clone(),
                instance_matrices: Vec::new(),
                instance_colors: Vec::new(),
                interactivity_events: Vec::new(),
                interactivity: None,
                visible: true,
            });
        }
    }

    let mut states: Vec<NodeSimState> =
        working_scene.nodes.iter().map(|n| build_node_sim_state(n, &working_scene)).collect();

    let objectives = extract_objectives(&states);
    let mut tweens: Vec<ActiveTween> = Vec::new();
    let mut triggered_events: Vec<String> = Vec::new();
    let mut audio_cues_fired: Vec<String> = Vec::new();
    let score: i64 = 0;
    let explode_factor: f32 = 0.0;
    let scenario_state = "running".to_string();

    // Fire initial onSpawn audio cues and onStart interactivity hooks.
    for idx in 0..states.len() {
        fire_audio_cue(&states[idx], "onSpawn", &mut audio_cues_fired);
        if states[idx].xr.get("audioEmitter").is_some() || states[idx].xr.get("audio").is_some() {
            audio_cues_fired.push(format!("{}:audioEmitter", states[idx].name));
        }
        for trait_key in [
            "anchor",
            "grab",
            "handles",
            "dimensions",
            "billboard",
            "follow",
            "gaze",
            "particles",
            "snapTo",
            "snapSocket",
            "navigable",
            "explode",
            "lod",
            "outline",
            "bloom",
        ] {
            if states[idx].xr.get(trait_key).is_some() {
                triggered_events.push(format!("xrTrait:{}:{}", trait_key, states[idx].name));
            }
        }
        if states[idx].joint.is_some() {
            triggered_events.push(format!("xrTrait:joint:{}", states[idx].name));
        }
        if let Some(inter) = states[idx].interactivity.clone() {
            if let Some(on_start) = inter.get("onStart") {
                dispatch_interactivity_entry(
                    idx,
                    "onStart",
                    on_start,
                    &mut states,
                    &mut working_scene,
                    &mut tweens,
                    &mut triggered_events,
                    0,
                );
            }
        }
    }
    // Also check root glTF `KHR_interactivity` graph for `.glb` scenes without raw node
    // interactivity.
    if states.iter().all(|s| s.interactivity.is_none()) {
        if let Some(root_inter) = working_scene.interactivity.clone() {
            dispatch_gltf_khr_interactivity(
                &root_inter,
                "event/onStart",
                None,
                &mut states,
                &mut tweens,
                &mut triggered_events,
            );
        }
    }

    let mut snapshots: Vec<(f64, SceneGraph)> = Vec::new();
    if snapshot_ticks.contains(&0) {
        let snap = build_snapshot_scene(&working_scene, &states, js_time_series, 0, explode_factor);
        snapshots.push((0.0, snap));
    }

    SimLoopState {
        working_scene,
        states,
        objectives,
        tweens,
        triggered_events,
        audio_cues_fired,
        score,
        explode_factor,
        scenario_state,
        snapshots,
        tick: 0,
    }
}

/// Simulates ticks `st.tick + 1 ..= to_tick`. `actions` may hold the whole timeline: only actions
/// scheduled inside each tick's `(t_prev, t_curr]` window fire.
fn advance_sim_loop(
    st: &mut SimLoopState,
    initial_scene: &SceneGraph,
    js_time_series: &[(usize, SceneGraph)],
    to_tick: usize,
    actions: &[SimAction],
    snapshot_ticks: &[usize],
) {
    let start_tick = st.tick;
    let mut working_scene = std::mem::take(&mut st.working_scene);
    let mut states = std::mem::take(&mut st.states);
    let mut objectives = std::mem::take(&mut st.objectives);
    let mut tweens = std::mem::take(&mut st.tweens);
    let mut triggered_events = std::mem::take(&mut st.triggered_events);
    let mut audio_cues_fired = std::mem::take(&mut st.audio_cues_fired);
    let mut score = st.score;
    let mut explode_factor = st.explode_factor;
    let mut scenario_state = std::mem::take(&mut st.scenario_state);
    let mut snapshots = std::mem::take(&mut st.snapshots);

    for tick in (start_tick + 1)..=to_tick {
        let t_prev = ((tick - 1) as f64) / 60.0;
        let t_curr = (tick as f64) / 60.0;

        // 1. Update base transforms from JS procedural `animate(t)` if available at this tick.
        if let Some((_, js_scene)) = js_time_series.iter().find(|(tk, _)| *tk == tick) {
            for (i, js_node) in js_scene.nodes.iter().enumerate() {
                if i < states.len() {
                    let dr = [
                        js_node.translation[0] - states[i].base_translation[0],
                        js_node.translation[1] - states[i].base_translation[1],
                        js_node.translation[2] - states[i].base_translation[2],
                    ];
                    states[i].base_translation = js_node.translation;
                    states[i].translation[0] += dr[0];
                    states[i].translation[1] += dr[1];
                    states[i].translation[2] += dr[2];
                    if js_node.rotation != states[i].base_rotation {
                        states[i].base_rotation = js_node.rotation;
                        states[i].rotation = js_node.rotation;
                    }
                    if js_node.scale != states[i].base_scale {
                        states[i].base_scale = js_node.scale;
                        states[i].scale = js_node.scale;
                    }
                    if let Some(init_node) = initial_scene.nodes.get(i) {
                        if !js_node.instance_matrices.is_empty()
                            && js_node.instance_matrices.len() == init_node.instance_matrices.len()
                        {
                            let mut first_delta: Option<[f32; 3]> = None;
                            let mut any_changed = false;
                            for (m_curr, m_init) in js_node
                                .instance_matrices
                                .chunks_exact(16)
                                .zip(init_node.instance_matrices.chunks_exact(16))
                            {
                                let d0 = m_curr[12] - m_init[12];
                                let d1 = m_curr[13] - m_init[13];
                                let d2 = m_curr[14] - m_init[14];
                                if d0.abs() > 1e-4 || d1.abs() > 1e-4 || d2.abs() > 1e-4 {
                                    any_changed = true;
                                    if first_delta.is_none() {
                                        first_delta = Some([d0, d1, d2]);
                                    }
                                    break;
                                }
                                if (0..12).any(|k| (m_curr[k] - m_init[k]).abs() > 1e-4) {
                                    any_changed = true;
                                    break;
                                }
                            }
                            if any_changed {
                                let ev = format!("instancedAnim:{}", states[i].name);
                                if !triggered_events.contains(&ev) {
                                    triggered_events.push(ev);
                                }
                                let delta = first_delta.unwrap_or([0.01, 0.0, 0.0]);
                                if (states[i].translation[0] - init_node.translation[0]).abs()
                                    < 1e-4
                                    && (states[i].translation[1] - init_node.translation[1]).abs()
                                        < 1e-4
                                    && (states[i].translation[2] - init_node.translation[2]).abs()
                                        < 1e-4
                                {
                                    states[i].translation[0] += delta[0];
                                    states[i].translation[1] += delta[1];
                                    states[i].translation[2] += delta[2];
                                }
                            }
                        }
                    }
                }
            }
            let light_changed =
                js_scene.lights.iter().zip(initial_scene.lights.iter()).any(|(l_curr, l_init)| {
                    (l_curr.intensity - l_init.intensity).abs() > 1e-4
                        || l_curr.direction != l_init.direction
                        || (0..3).any(|k| {
                            (l_curr.color[k] - l_init.color[k]).abs() > 1e-4
                                || (l_curr.position[k] - l_init.position[k]).abs() > 1e-4
                        })
                });
            if light_changed && !triggered_events.iter().any(|e| e == "lightAnim") {
                triggered_events.push("lightAnim".to_string());
            }
            let mat_changed = js_scene.materials.iter().zip(initial_scene.materials.iter()).any(
                |(m_curr, m_init)| {
                    (0..4).any(|k| (m_curr.base_color[k] - m_init.base_color[k]).abs() > 1e-4)
                        || (m_curr.metallic - m_init.metallic).abs() > 1e-4
                        || (m_curr.roughness - m_init.roughness).abs() > 1e-4
                        || (m_curr.transmission - m_init.transmission).abs() > 1e-4
                },
            );
            if mat_changed && !triggered_events.iter().any(|e| e == "materialAnim") {
                triggered_events.push("materialAnim".to_string());
            }
        }

        // 2. Process scripted actions scheduled in `(t_prev, t_curr]` (or `at == 0.0` on tick 1).
        for act in actions {
            let fires_now = (tick == 1 && act.at <= 1e-7)
                || (act.at > t_prev + 1e-7 && act.at <= t_curr + 1e-7);
            let active_window = {
                let dur = act.duration.unwrap_or(0.0);
                dur > 0.0 && t_curr + 1e-7 >= act.at && t_curr <= act.at + dur + 1e-6
            };
            match act.action_type.as_str() {
                "select" | "tap" | "click" if fires_now => {
                    let target_indices: Vec<usize> = match act.target.as_deref() {
                        Some(t) if !t.trim().is_empty() && t.trim() != "*" => {
                            find_node_index(&states, t).into_iter().collect()
                        }
                        _ => (0..states.len())
                            .filter(|&i| {
                                states[i]
                                    .interactivity
                                    .as_ref()
                                    .and_then(|v| v.get("onSelect"))
                                    .is_some()
                            })
                            .collect(),
                    };
                    for idx in target_indices {
                        triggered_events.push(format!("select:{}", states[idx].name));
                        if let Some(inter) = states[idx].interactivity.clone() {
                            if let Some(on_sel) = inter.get("onSelect") {
                                dispatch_interactivity_entry(
                                    idx,
                                    "onSelect",
                                    on_sel,
                                    &mut states,
                                    &mut working_scene,
                                    &mut tweens,
                                    &mut triggered_events,
                                    0,
                                );
                            }
                        } else if let Some(root_inter) = working_scene.interactivity.clone() {
                            dispatch_gltf_khr_interactivity(
                                &root_inter,
                                "event/onSelect",
                                Some(idx),
                                &mut states,
                                &mut tweens,
                                &mut triggered_events,
                            );
                        }
                    }
                }
                "explode" if fires_now => {
                    explode_factor = act.factor.clamp(0.0, 2.0);
                    if states.iter().any(|s| s.xr.get("explode").is_some()) {
                        triggered_events.push(format!("explode:{:.2}", explode_factor));
                    }
                }
                "sendEvent" | "event" if fires_now => {
                    if let Some(ev_id) = &act.event_id {
                        triggered_events.push(format!("sendEvent:{}", ev_id));
                        dispatch_custom_event(
                            ev_id,
                            &mut states,
                            &mut working_scene,
                            &mut tweens,
                            &mut triggered_events,
                            0,
                        );
                    }
                }
                "damage" | "heal" if fires_now => {
                    if let Some(target_name) = &act.target {
                        if let Some(idx) = find_node_index(&states, target_name) {
                            let amt = act.amount.unwrap_or(25.0);
                            let signed = if act.action_type == "Heal" || act.action_type == "heal" {
                                amt
                            } else {
                                -amt
                            };
                            apply_health_delta(
                                idx,
                                signed,
                                &mut states,
                                &mut score,
                                &mut audio_cues_fired,
                                &mut triggered_events,
                            );
                        }
                    }
                }
                "moveCharacter" | "move" if fires_now || active_window => {
                    if let Some(char_idx) = find_character_index(&states, act.target.as_deref()) {
                        let dir = act.direction.unwrap_or([act.dx, 0.0, act.dz]);
                        let spd = states[char_idx].character_speed;
                        states[char_idx].velocity[0] = dir[0] * spd;
                        states[char_idx].velocity[2] = dir[2] * spd;
                        if fires_now && act.jump && states[char_idx].grounded {
                            states[char_idx].velocity[1] = states[char_idx].jump_impulse;
                            states[char_idx].grounded = false;
                            fire_audio_cue(&states[char_idx], "onJump", &mut audio_cues_fired);
                        }
                        if fires_now {
                            fire_audio_cue(&states[char_idx], "onMove", &mut audio_cues_fired);
                        }
                    }
                }
                _ => {}
            }
        }

        // 3. Step active property tweens (`interpolate` / `toggleTransform`).
        for tw in &mut tweens {
            tw.elapsed = (tw.elapsed + SIM_DT_SEC).min(tw.duration);
            let u =
                if tw.duration <= 1e-6 { 1.0 } else { (tw.elapsed / tw.duration).clamp(0.0, 1.0) };
            // Smoothstep easing for natural motion.
            let s = (u * u * (3.0 - 2.0 * u)) as f32;
            if tw.node_idx < states.len() {
                match tw.property {
                    TweenProperty::Translation => {
                        for k in 0..3 {
                            states[tw.node_idx].translation[k] =
                                tw.from[k] + (tw.to[k] - tw.from[k]) * s;
                        }
                    }
                    TweenProperty::Scale => {
                        for k in 0..3 {
                            states[tw.node_idx].scale[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * s;
                        }
                    }
                    TweenProperty::Rotation => {
                        let mut q = [0.0f32; 4];
                        for k in 0..4 {
                            q[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * s;
                        }
                        states[tw.node_idx].rotation = normalize_quat(q);
                    }
                    TweenProperty::MaterialColor(mat_idx) => {
                        if let Some(mat) = working_scene.materials.get_mut(mat_idx) {
                            for k in 0..4 {
                                mat.base_color[k] = tw.from[k] + (tw.to[k] - tw.from[k]) * s;
                            }
                        }
                    }
                }
            }
        }
        tweens.retain(|tw| tw.elapsed + 1e-9 < tw.duration);

        // 4. Step `userData.xr.orbit` trajectories.
        let snapshot_names_positions: Vec<(String, [f32; 3])> =
            states.iter().map(|s| (s.name.clone(), s.translation)).collect();
        for st in &mut states {
            if st.destroyed {
                continue;
            }
            if let Some(orbit) = st.xr.get("orbit").and_then(|v| v.as_object()) {
                let radius = orbit.get("radius").and_then(|v| v.as_f64()).unwrap_or(1.5) as f32;
                let speed = orbit.get("speed").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
                let height = orbit.get("height").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                let phase = orbit.get("phase").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                let center = match orbit.get("target") {
                    Some(Value::Array(arr)) if arr.len() >= 3 => [
                        arr[0].as_f64().unwrap_or(0.0) as f32,
                        arr[1].as_f64().unwrap_or(0.0) as f32,
                        arr[2].as_f64().unwrap_or(0.0) as f32,
                    ],
                    Some(Value::String(tname)) => snapshot_names_positions
                        .iter()
                        .find(|(n, _)| n == tname)
                        .map(|(_, p)| *p)
                        .unwrap_or([0.0, 0.0, 0.0]),
                    _ => st.base_translation,
                };
                let angle = phase + (t_curr as f32) * speed;
                st.translation = [
                    center[0] + radius * angle.cos(),
                    center[1] + height,
                    center[2] + radius * angle.sin(),
                ];
                if orbit.get("faceCenter").and_then(|v| v.as_bool()).unwrap_or(false) {
                    let yaw = (-angle) - std::f32::consts::FRAC_PI_2;
                    let half = 0.5 * yaw;
                    st.rotation = [0.0, half.sin(), 0.0, half.cos()];
                }
            }
        }

        // 5. Step character & dynamic physics (gravity + restitution bounce + pairwise stacking).
        let dt_f32 = SIM_DT_SEC as f32;
        for st in &mut states {
            if st.destroyed {
                continue;
            }
            if st.invuln_remaining_sec > 0.0 {
                st.invuln_remaining_sec = (st.invuln_remaining_sec - SIM_DT_SEC).max(0.0);
            }
            let is_kinematic = st.physics_mode.as_deref() == Some("kinematic");
            if is_kinematic && !st.is_character {
                st.translation[0] += st.velocity[0] * dt_f32;
                st.translation[1] += st.velocity[1] * dt_f32;
                st.translation[2] += st.velocity[2] * dt_f32;
                continue;
            }
            let is_dynamic = st.is_character || st.physics_mode.as_deref() == Some("dynamic");
            if is_dynamic {
                let g_scale = if st.is_character { 1.0 } else { st.gravity_scale };
                st.velocity[1] -= 9.81 * g_scale * dt_f32;
                if st.has_rigid_body_config && !st.is_character {
                    let lin_damp = (1.0 - st.linear_damping * dt_f32).max(0.0);
                    st.velocity[0] *= lin_damp;
                    st.velocity[1] *= lin_damp;
                    st.velocity[2] *= lin_damp;
                }
                st.translation[0] += st.velocity[0] * dt_f32;
                st.translation[1] += st.velocity[1] * dt_f32;
                st.translation[2] += st.velocity[2] * dt_f32;

                let floor_y = st.half_extents[1];
                if st.translation[1] <= floor_y {
                    let was_airborne = !st.grounded && st.velocity[1] < -0.5;
                    st.translation[1] = floor_y;
                    if st.has_rigid_body_config && !st.is_character && -st.velocity[1] > 0.25 {
                        st.velocity[1] = -st.velocity[1] * st.restitution;
                        let fric = (1.0 - st.friction * 0.25).max(0.0);
                        st.velocity[0] *= fric;
                        st.velocity[2] *= fric;
                        st.grounded = st.velocity[1].abs() <= 0.05;
                    } else {
                        st.velocity[1] = 0.0;
                        st.grounded = true;
                    }
                    if was_airborne {
                        fire_audio_cue(st, "onLand", &mut audio_cues_fired);
                    }
                } else {
                    st.grounded = false;
                }
                if !st.has_rigid_body_config || st.is_character {
                    // Dampen horizontal velocity when not actively driven.
                    st.velocity[0] *= 0.85;
                    st.velocity[2] *= 0.85;
                }
            }
        }

        // 5b. Pairwise AABB collision & vertical stacking for rigid bodies.
        let n_states = states.len();
        for _iter in 0..4 {
            for i in 0..n_states {
                if states[i].destroyed || !states[i].visible {
                    continue;
                }
                for j in (i + 1)..n_states {
                    if states[j].destroyed || !states[j].visible {
                        continue;
                    }
                    let dyn_i = states[i].physics_mode.as_deref() == Some("dynamic")
                        && !states[i].is_character;
                    let dyn_j = states[j].physics_mode.as_deref() == Some("dynamic")
                        && !states[j].is_character;
                    let col_i = dyn_i
                        || states[i].is_character
                        || states[i].physics_mode.as_deref() == Some("static")
                        || states[i].physics_mode.as_deref() == Some("kinematic")
                        || states[i]
                            .xr
                            .get("collidable")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                    let col_j = dyn_j
                        || states[j].is_character
                        || states[j].physics_mode.as_deref() == Some("static")
                        || states[j].physics_mode.as_deref() == Some("kinematic")
                        || states[j]
                            .xr
                            .get("collidable")
                            .and_then(|v| v.as_bool())
                            .unwrap_or(false);
                    if !(dyn_i && col_j) && !(dyn_j && col_i) {
                        continue;
                    }
                    let dx = states[j].translation[0] - states[i].translation[0];
                    let dy = states[j].translation[1] - states[i].translation[1];
                    let dz = states[j].translation[2] - states[i].translation[2];
                    let ox = (states[i].half_extents[0] + states[j].half_extents[0]) - dx.abs();
                    let oy = (states[i].half_extents[1] + states[j].half_extents[1]) - dy.abs();
                    let oz = (states[i].half_extents[2] + states[j].half_extents[2]) - dz.abs();
                    if ox <= 0.0 || oy <= 0.0 || oz <= 0.0 {
                        continue;
                    }
                    let (nx, ny, nz, depth) = if oy <= ox && oy <= oz {
                        (0.0f32, if dy >= 0.0 { 1.0 } else { -1.0 }, 0.0f32, oy)
                    } else if ox <= oz {
                        (if dx >= 0.0 { 1.0 } else { -1.0 }, 0.0f32, 0.0f32, ox)
                    } else {
                        (0.0f32, 0.0f32, if dz >= 0.0 { 1.0 } else { -1.0 }, oz)
                    };
                    let inv_i = if dyn_i { 1.0 / states[i].mass.max(0.01) } else { 0.0 };
                    let inv_j = if dyn_j { 1.0 / states[j].mass.max(0.01) } else { 0.0 };
                    let inv_sum = inv_i + inv_j;
                    if inv_sum <= 0.0 {
                        continue;
                    }
                    let corr = ((depth - 0.002).max(0.0) / inv_sum) * 0.6;
                    if inv_i > 0.0 {
                        states[i].translation[0] -= nx * corr * inv_i;
                        states[i].translation[1] -= ny * corr * inv_i;
                        states[i].translation[2] -= nz * corr * inv_i;
                    }
                    if inv_j > 0.0 {
                        states[j].translation[0] += nx * corr * inv_j;
                        states[j].translation[1] += ny * corr * inv_j;
                        states[j].translation[2] += nz * corr * inv_j;
                    }
                    let rvx = states[j].velocity[0] - states[i].velocity[0];
                    let rvy = states[j].velocity[1] - states[i].velocity[1];
                    let rvz = states[j].velocity[2] - states[i].velocity[2];
                    let vn = rvx * nx + rvy * ny + rvz * nz;
                    if vn < 0.0 {
                        let e_raw = (states[i].restitution * states[j].restitution).sqrt();
                        let e = if -vn > 0.25 { e_raw } else { 0.0 };
                        let j_n = -(1.0 + e) * vn / inv_sum;
                        if inv_i > 0.0 {
                            states[i].velocity[0] -= nx * j_n * inv_i;
                            states[i].velocity[1] -= ny * j_n * inv_i;
                            states[i].velocity[2] -= nz * j_n * inv_i;
                        }
                        if inv_j > 0.0 {
                            states[j].velocity[0] += nx * j_n * inv_j;
                            states[j].velocity[1] += ny * j_n * inv_j;
                            states[j].velocity[2] += nz * j_n * inv_j;
                        }
                    }
                    if ny > 0.5 && dyn_j {
                        states[j].grounded = true;
                    } else if ny < -0.5 && dyn_i {
                        states[i].grounded = true;
                    }
                }
            }
        }

        // 5c. Step mechanical joints (`hinge`, `slider`, `spring`, `ball`).
        step_joints(&mut states, dt_f32);

        // 6. Step autonomous agents (`patrol` / `chase` / `flee`).
        let player_pos =
            states.iter().find(|s| !s.destroyed && s.is_character).map(|s| s.translation);
        let player_idx = states.iter().position(|s| !s.destroyed && s.is_character);
        let mut pending_player_damage: f32 = 0.0;

        for idx in 0..states.len() {
            if states[idx].destroyed {
                continue;
            }
            let Some(behavior) = states[idx].agent_behavior.clone() else {
                continue;
            };
            states[idx].agent_attack_cooldown_sec =
                (states[idx].agent_attack_cooldown_sec - SIM_DT_SEC).max(0.0);
            let pos = states[idx].translation;
            let spd = states[idx].agent_speed;

            let mut target_pt: Option<[f32; 3]> = None;
            if let Some(p_pos) = player_pos {
                let dist = horiz_dist(pos, p_pos);
                if behavior == "chase" && dist <= states[idx].agent_aggro_radius {
                    if dist <= states[idx].agent_attack_radius {
                        if states[idx].agent_attack_cooldown_sec <= 0.0 {
                            pending_player_damage += 10.0;
                            states[idx].agent_attack_cooldown_sec = 0.75;
                        }
                    } else {
                        target_pt = Some(p_pos);
                    }
                } else if behavior == "flee" && dist <= states[idx].agent_aggro_radius {
                    let dx = pos[0] - p_pos[0];
                    let dz = pos[2] - p_pos[2];
                    target_pt = Some([pos[0] + dx, pos[1], pos[2] + dz]);
                }
            }
            if target_pt.is_none() && !states[idx].agent_waypoints.is_empty() {
                let wp_idx = states[idx].agent_waypoint_idx % states[idx].agent_waypoints.len();
                let wp = states[idx].agent_waypoints[wp_idx];
                if horiz_dist(pos, wp) < 0.15 {
                    states[idx].agent_waypoint_idx =
                        (wp_idx + 1) % states[idx].agent_waypoints.len();
                }
                target_pt = Some(states[idx].agent_waypoints[states[idx].agent_waypoint_idx]);
            }
            if let Some(tp) = target_pt {
                let dx = tp[0] - pos[0];
                let dz = tp[2] - pos[2];
                let d = (dx * dx + dz * dz).sqrt();
                if d > 1e-4 {
                    let step = (spd * dt_f32).min(d);
                    states[idx].translation[0] += (dx / d) * step;
                    states[idx].translation[2] += (dz / d) * step;
                }
            }
        }
        if pending_player_damage > 0.0 {
            if let Some(p_idx) = player_idx {
                apply_health_delta(
                    p_idx,
                    -pending_player_damage,
                    &mut states,
                    &mut score,
                    &mut audio_cues_fired,
                    &mut triggered_events,
                );
            }
        }

        // 7. Step spatial zones (`trigger`, `damage`, `heal`, `finish`).
        for z_idx in 0..states.len() {
            if states[z_idx].destroyed {
                continue;
            }
            let Some(z_kind) = states[z_idx].zone_kind.clone() else {
                continue;
            };
            states[z_idx].zone_timer_sec = (states[z_idx].zone_timer_sec - SIM_DT_SEC).max(0.0);
            let z_pos = states[z_idx].translation;
            let z_ext = states[z_idx].half_extents;

            if let Some(p_idx) = player_idx {
                let p_pos = states[p_idx].translation;
                let p_ext = states[p_idx].half_extents;
                if aabb_overlaps(z_pos, z_ext, p_pos, p_ext) {
                    if !states[z_idx].zone_fired_once {
                        states[z_idx].zone_fired_once = true;
                        fire_audio_cue(&states[z_idx], "onEnter", &mut audio_cues_fired);
                        triggered_events.push(format!("zoneEnter:{}", states[z_idx].name));
                        if let Some(ev) = states[z_idx].zone_event.clone() {
                            dispatch_custom_event(
                                &ev,
                                &mut states,
                                &mut working_scene,
                                &mut tweens,
                                &mut triggered_events,
                                0,
                            );
                        }
                    }
                    match z_kind.as_str() {
                        "damage" if states[z_idx].zone_timer_sec <= 0.0 => {
                            let dmg = states[z_idx].zone_rate
                                * (states[z_idx].zone_cooldown_sec.max(SIM_DT_SEC) as f32);
                            states[z_idx].zone_timer_sec =
                                states[z_idx].zone_cooldown_sec.max(SIM_DT_SEC);
                            apply_health_delta(
                                p_idx,
                                -dmg,
                                &mut states,
                                &mut score,
                                &mut audio_cues_fired,
                                &mut triggered_events,
                            );
                        }
                        "heal" if states[z_idx].zone_timer_sec <= 0.0 => {
                            let heal = states[z_idx].zone_rate
                                * (states[z_idx].zone_cooldown_sec.max(SIM_DT_SEC) as f32);
                            states[z_idx].zone_timer_sec =
                                states[z_idx].zone_cooldown_sec.max(SIM_DT_SEC);
                            apply_health_delta(
                                p_idx,
                                heal,
                                &mut states,
                                &mut score,
                                &mut audio_cues_fired,
                                &mut triggered_events,
                            );
                        }
                        "finish" => {
                            if scenario_state == "running" {
                                scenario_state = "victory".to_string();
                            }
                        }
                        _ => {}
                    }
                }
            }
        }

        // 8. Step spawners (bounded by `MAX_SIM_NODES`).
        let mut new_spawns: Vec<(NodeSimState, SceneNode)> = Vec::new();
        for s_idx in 0..states.len() {
            if states[s_idx].destroyed {
                continue;
            }
            let Some(tpl_name) = states[s_idx].spawner_template.clone() else {
                continue;
            };
            if states[s_idx].spawner_active_children >= states[s_idx].spawner_max_active
                || states.len() + new_spawns.len() >= MAX_SIM_NODES
            {
                continue;
            }
            states[s_idx].spawner_timer_sec += SIM_DT_SEC;
            if states[s_idx].spawner_timer_sec >= states[s_idx].spawner_interval_sec {
                states[s_idx].spawner_timer_sec -= states[s_idx].spawner_interval_sec;
                if let Some(tpl_idx) = find_node_index(&states, &tpl_name) {
                    let count_idx = states[s_idx].spawner_active_children;
                    states[s_idx].spawner_active_children += 1;
                    let angle = (count_idx as f32) * 2.094_395;
                    let rad = states[s_idx].spawner_radius;
                    let spawn_pos = [
                        states[s_idx].translation[0] + rad * angle.cos(),
                        states[s_idx].translation[1],
                        states[s_idx].translation[2] + rad * angle.sin(),
                    ];
                    let mut cloned_state = states[tpl_idx].clone();
                    cloned_state.name = format!("{}_spawn_{}", tpl_name, count_idx + 1);
                    cloned_state.base_translation = spawn_pos;
                    cloned_state.translation = spawn_pos;
                    cloned_state.visible = true;
                    cloned_state.destroyed = false;
                    cloned_state.spawner_template = None;
                    cloned_state.spawned_by = Some(s_idx);
                    fire_audio_cue(&cloned_state, "onSpawn", &mut audio_cues_fired);
                    let mut cloned_node = working_scene.nodes[tpl_idx].clone();
                    cloned_node.name = cloned_state.name.clone();
                    cloned_node.translation = spawn_pos;
                    new_spawns.push((cloned_state, cloned_node));
                }
            }
        }
        for (st, nd) in new_spawns {
            states.push(st);
            working_scene.nodes.push(nd);
        }

        // 9. Evaluate objectives (`reach`, `pickup`, `checkpoint`, `key`, `restore`, `time-bonus`,
        //    `destroyAll`, `survive`, `score`).
        let mut any_newly_completed = false;
        for obj in &mut objectives {
            if obj.completed {
                continue;
            }
            match obj.kind.as_str() {
                "reach" | "pickup" | "checkpoint" | "key" | "restore" | "time-bonus" => {
                    if let (Some(p_idx), Some(t_idx)) =
                        (player_idx, find_node_index(&states, &obj.target))
                    {
                        if horiz_dist(states[p_idx].translation, states[t_idx].translation)
                            <= obj.radius
                        {
                            obj.completed = true;
                            if matches!(obj.kind.as_str(), "pickup" | "time-bonus") {
                                score += obj.amount;
                            }
                            fire_audio_cue(&states[t_idx], "onCollect", &mut audio_cues_fired);
                            if matches!(
                                obj.kind.as_str(),
                                "pickup" | "key" | "restore" | "time-bonus"
                            ) {
                                states[t_idx].visible = false;
                            }
                            if obj.kind == "restore" && obj.amount > 0 {
                                apply_health_delta(
                                    p_idx,
                                    obj.amount as f32,
                                    &mut states,
                                    &mut score,
                                    &mut audio_cues_fired,
                                    &mut triggered_events,
                                );
                            }
                        }
                    }
                }
                "destroyAll" => {
                    let any_alive = states.iter().any(|s| {
                        !s.destroyed
                            && (s.group == obj.target
                                || s.name == obj.target
                                || ((obj.target == "agents" || obj.target == "enemies")
                                    && s.agent_behavior.is_some()))
                            && s.hp.unwrap_or(1.0) > 0.0
                    });
                    if !any_alive {
                        obj.completed = true;
                    }
                }
                "survive" => {
                    obj.progress += SIM_DT_SEC;
                    if obj.progress + 1e-6 >= obj.count {
                        obj.completed = true;
                    }
                }
                "score" => {
                    if (score as f64) >= obj.count {
                        obj.completed = true;
                    }
                }
                _ => {}
            }
            if obj.completed {
                any_newly_completed = true;
                triggered_events.push(format!("objectiveComplete:{}", obj.id));
            }
        }
        if any_newly_completed && scenario_state == "running" {
            let has_required = objectives.iter().any(|o| o.win_on_complete);
            let all_required_done =
                objectives.iter().filter(|o| o.win_on_complete).all(|o| o.completed);
            if has_required && all_required_done {
                scenario_state = "victory".to_string();
            }
        }

        // Check if player character was destroyed -> defeat.
        if let Some(p_idx) = player_idx {
            if states[p_idx].destroyed && scenario_state == "running" {
                scenario_state = "defeat".to_string();
            }
        }

        if snapshot_ticks.contains(&tick) {
            let snap =
                build_snapshot_scene(&working_scene, &states, js_time_series, tick, explode_factor);
            snapshots.push((t_curr, snap));
        }
    }

    st.working_scene = working_scene;
    st.states = states;
    st.objectives = objectives;
    st.tweens = tweens;
    st.triggered_events = triggered_events;
    st.audio_cues_fired = audio_cues_fired;
    st.score = score;
    st.explode_factor = explode_factor;
    st.scenario_state = scenario_state;
    st.snapshots = snapshots;
    st.tick = st.tick.max(to_tick);
}

fn sim_loop_report(st: &SimLoopState, duration_sec: f64) -> SimulationReport {
    let working_scene = &st.working_scene;
    let explode_factor = st.explode_factor;
    let bodies = st
        .states
        .iter()
        .enumerate()
        .map(|(i, s)| SimNodeReport {
            index: i,
            name: if s.name.is_empty() { format!("Node_{}", i) } else { s.name.clone() },
            initial_translation: working_scene
                .nodes
                .get(i)
                .map(|n| n.translation)
                .unwrap_or(s.base_translation),
            final_translation: apply_explode_offset(&s.xr, s.translation, explode_factor),
            initial_rotation: working_scene
                .nodes
                .get(i)
                .map(|n| n.rotation)
                .unwrap_or(s.base_rotation),
            final_rotation: s.rotation,
            initial_scale: working_scene.nodes.get(i).map(|n| n.scale).unwrap_or(s.base_scale),
            final_scale: if s.visible && !s.destroyed { s.scale } else { [0.0, 0.0, 0.0] },
            visible: s.visible && !s.destroyed,
            grounded: s.grounded,
            health: s.hp,
            max_health: s.max_hp,
            destroyed: s.destroyed,
        })
        .collect();

    let completed_objectives =
        st.objectives.iter().filter(|o| o.completed).map(|o| o.id.clone()).collect();

    SimulationReport {
        duration_sec,
        ticks_simulated: st.tick,
        explode_factor,
        score: st.score,
        scenario_state: st.scenario_state.clone(),
        completed_objectives,
        triggered_events: st.triggered_events.clone(),
        audio_cues_fired: st.audio_cues_fired.clone(),
        bodies,
    }
}

fn build_snapshot_scene(
    base_scene: &SceneGraph,
    states: &[NodeSimState],
    js_time_series: &[(usize, SceneGraph)],
    tick: usize,
    explode_factor: f32,
) -> SceneGraph {
    let mut snap = if let Some((_, js_s)) = js_time_series.iter().find(|(tk, _)| *tk == tick) {
        let mut s = js_s.clone();
        s.materials = base_scene.materials.clone();
        s
    } else {
        base_scene.clone()
    };

    while snap.nodes.len() < states.len() {
        let idx = snap.nodes.len();
        snap.nodes.push(base_scene.nodes[idx].clone());
    }

    for (i, st) in states.iter().enumerate() {
        if let Some(node) = snap.nodes.get_mut(i) {
            node.translation = apply_explode_offset(&st.xr, st.translation, explode_factor);
            node.rotation = st.rotation;
            node.scale = if st.visible && !st.destroyed { st.scale } else { [0.0, 0.0, 0.0] };
            node.visible = st.visible && !st.destroyed;
        }
    }
    snap
}

fn apply_explode_offset(xr: &Value, pos: [f32; 3], explode_factor: f32) -> [f32; 3] {
    if explode_factor.abs() <= 1e-5 {
        return pos;
    }
    let Some(exp) = xr.get("explode") else {
        return pos;
    };
    if let Some(obj) = exp.as_object() {
        if let Some(off) = obj.get("offset").and_then(|v| v.as_array()).filter(|a| a.len() >= 3) {
            let ox = off[0].as_f64().unwrap_or(0.0) as f32;
            let oy = off[1].as_f64().unwrap_or(0.0) as f32;
            let oz = off[2].as_f64().unwrap_or(0.0) as f32;
            if ox.abs() > 1e-5 || oy.abs() > 1e-5 || oz.abs() > 1e-5 {
                return [
                    pos[0] + ox * explode_factor,
                    pos[1] + oy * explode_factor,
                    pos[2] + oz * explode_factor,
                ];
            }
        }
    }
    let (dir, dist, layer) = if let Some(obj) = exp.as_object() {
        let dir = obj
            .get("direction")
            .and_then(|v| v.as_array())
            .filter(|a| a.len() >= 3)
            .map(|a| {
                [
                    a[0].as_f64().unwrap_or(0.0) as f32,
                    a[1].as_f64().unwrap_or(1.0) as f32,
                    a[2].as_f64().unwrap_or(0.0) as f32,
                ]
            })
            .unwrap_or_else(|| {
                let len = (pos[0] * pos[0] + pos[1] * pos[1] + pos[2] * pos[2]).sqrt();
                if len > 1e-4 {
                    [pos[0] / len, pos[1] / len, pos[2] / len]
                } else {
                    [0.0, 1.0, 0.0]
                }
            });
        let dist = obj.get("distance").and_then(|v| v.as_f64()).unwrap_or(0.35) as f32;
        let layer = obj.get("layer").and_then(|v| v.as_f64()).unwrap_or(1.0) as f32;
        (dir, dist, layer.max(0.25))
    } else {
        ([0.0, 1.0, 0.0], 0.35, 1.0)
    };
    let mag = explode_factor * dist * layer;
    [pos[0] + dir[0] * mag, pos[1] + dir[1] * mag, pos[2] + dir[2] * mag]
}

fn merge_json_objects(norm: Option<&Value>, raw: Option<&Value>) -> Value {
    match (norm, raw) {
        (Some(Value::Object(n_map)), Some(Value::Object(r_map))) => {
            let mut merged = n_map.clone();
            for (k, r_val) in r_map {
                match (merged.get(k).cloned(), r_val) {
                    (Some(Value::Object(mut sub_n)), Value::Object(sub_r)) => {
                        for (sk, sv) in sub_r {
                            sub_n.entry(sk.clone()).or_insert_with(|| sv.clone());
                        }
                        merged.insert(k.clone(), Value::Object(sub_n));
                    }
                    (None, _) => {
                        merged.insert(k.clone(), r_val.clone());
                    }
                    _ => {}
                }
            }
            Value::Object(merged)
        }
        (Some(n), None) => n.clone(),
        (None, Some(r)) => r.clone(),
        (Some(n), Some(_)) => n.clone(),
        (None, None) => Value::Null,
    }
}

fn build_node_sim_state(node: &SceneNode, scene: &SceneGraph) -> NodeSimState {
    let xr = merge_json_objects(node.xr_normalized.as_ref(), node.xr_traits.as_ref());

    let mut half_extents = [0.5f32, 0.5, 0.5];
    if let Some(m_idx) = node.mesh.filter(|&m| m < scene.meshes.len()) {
        let mesh = &scene.meshes[m_idx];
        if !mesh.positions.is_empty() {
            let mut min = [f32::INFINITY; 3];
            let mut max = [f32::NEG_INFINITY; 3];
            for p in &mesh.positions {
                for c in 0..3 {
                    min[c] = min[c].min(p[c] * node.scale[c].abs());
                    max[c] = max[c].max(p[c] * node.scale[c].abs());
                }
            }
            for c in 0..3 {
                half_extents[c] = ((max[c] - min[c]) * 0.5).max(0.05);
            }
        }
    }

    let is_character = xr.get("character").is_some()
        || xr
            .get("role")
            .and_then(|v| v.as_str())
            .map(|s| {
                let l = s.to_lowercase();
                l.contains("player") || l.contains("character")
            })
            .unwrap_or(false);
    let top_speed =
        xr.get("moveSpeed").or_else(|| xr.get("speed")).and_then(|v| v.as_f64()).unwrap_or(4.0)
            as f32;
    let top_jump = xr
        .get("jumpImpulse")
        .or_else(|| xr.get("jumpVelocity"))
        .and_then(|v| v.as_f64())
        .unwrap_or(5.0) as f32;
    let (character_speed, jump_impulse) = match xr.get("character") {
        Some(Value::Object(o)) => (
            o.get("moveSpeed")
                .or_else(|| o.get("speed"))
                .and_then(|v| v.as_f64())
                .map(|v| v as f32)
                .unwrap_or(top_speed),
            o.get("jumpImpulse")
                .or_else(|| o.get("jumpVelocity"))
                .and_then(|v| v.as_f64())
                .map(|v| v as f32)
                .unwrap_or(top_jump),
        ),
        _ => (top_speed, top_jump),
    };

    let rb_val = xr.get("rigidBody").or_else(|| xr.get("physics"));
    let (
        physics_mode,
        mass,
        restitution,
        friction,
        linear_damping,
        gravity_scale,
        initial_velocity,
        has_rigid_body_config,
    ) = match rb_val {
        Some(Value::Bool(true)) => (
            Some("dynamic".to_string()),
            1.0f32,
            0.35f32,
            0.5f32,
            0.05f32,
            1.0f32,
            [0.0f32; 3],
            xr.get("rigidBody").is_some(),
        ),
        Some(Value::String(s)) => {
            let m = s.to_lowercase();
            let is_dyn = m == "dynamic";
            (
                Some(m),
                if is_dyn { 1.0 } else { 0.0 },
                0.35,
                0.5,
                0.05,
                1.0,
                [0.0; 3],
                xr.get("rigidBody").is_some(),
            )
        }
        Some(Value::Object(o)) => {
            let mode = o
                .get("body")
                .or_else(|| o.get("type"))
                .or_else(|| o.get("mode"))
                .and_then(|m| m.as_str())
                .unwrap_or("dynamic")
                .to_lowercase();
            let is_dyn = mode == "dynamic";
            let m = o
                .get("mass")
                .and_then(|v| v.as_f64())
                .map(|v| (v as f32).clamp(0.01, 1000.0))
                .unwrap_or(if is_dyn { 1.0 } else { 0.0 });
            let rest = o
                .get("restitution")
                .and_then(|v| v.as_f64())
                .map(|v| (v as f32).clamp(0.0, 1.0))
                .unwrap_or(0.35);
            let fric = o
                .get("friction")
                .and_then(|v| v.as_f64())
                .map(|v| (v as f32).clamp(0.0, 1.0))
                .unwrap_or(0.5);
            let ld = o
                .get("linearDamping")
                .and_then(|v| v.as_f64())
                .map(|v| (v as f32).clamp(0.0, 20.0))
                .unwrap_or(0.05);
            let gs = o
                .get("gravityScale")
                .and_then(|v| v.as_f64())
                .map(|v| (v as f32).clamp(-5.0, 5.0))
                .unwrap_or(1.0);
            let vel = o
                .get("velocity")
                .and_then(|v| v.as_array())
                .filter(|a| a.len() >= 3)
                .map(|a| {
                    [
                        (a[0].as_f64().unwrap_or(0.0) as f32).clamp(-200.0, 200.0),
                        (a[1].as_f64().unwrap_or(0.0) as f32).clamp(-200.0, 200.0),
                        (a[2].as_f64().unwrap_or(0.0) as f32).clamp(-200.0, 200.0),
                    ]
                })
                .unwrap_or([0.0; 3]);
            (Some(mode), m, rest, fric, ld, gs, vel, true)
        }
        _ => (None, 1.0, 0.35, 0.5, 0.05, 1.0, [0.0; 3], false),
    };

    let (hp, max_hp, armor, invuln_duration_sec, on_zero, score_value, mut group) =
        match xr.get("integrity") {
            Some(Value::Number(n)) => {
                let v = n.as_f64().unwrap_or(100.0) as f32;
                (Some(v), Some(v), 0.0, 0.0, "destroy".to_string(), 0, String::new())
            }
            Some(Value::Object(o)) => {
                let max_v = o
                    .get("maxHp")
                    .or_else(|| o.get("max"))
                    .or_else(|| o.get("hp"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(100.0) as f32;
                let hp_v = o
                    .get("hp")
                    .or_else(|| o.get("current"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(max_v as f64) as f32;
                let arm = o.get("armor").and_then(|v| v.as_f64()).unwrap_or(0.0) as f32;
                let invuln = o
                    .get("invulnerabilitySec")
                    .or_else(|| o.get("cooldownSec"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(0.0)
                    .max(0.0);
                let oz = o.get("onZero").and_then(|v| v.as_str()).unwrap_or("destroy").to_string();
                let sc = o.get("scoreValue").and_then(|v| v.as_i64()).unwrap_or(0);
                let grp = o.get("group").and_then(|v| v.as_str()).unwrap_or("").to_string();
                (Some(hp_v), Some(max_v), arm, invuln, oz, sc, grp)
            }
            _ => (None, None, 0.0, 0.0, "destroy".to_string(), 0, String::new()),
        };
    if group.is_empty() && is_character {
        group = "player".to_string();
    }

    let (agent_behavior, agent_speed, agent_aggro_radius, agent_attack_radius, agent_waypoints) =
        match xr.get("agent") {
            Some(Value::String(b)) => (Some(b.clone()), 2.5, 8.0, 1.2, Vec::new()),
            Some(Value::Object(o)) => {
                let b = o
                    .get("behavior")
                    .or_else(|| o.get("mode"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("patrol")
                    .to_string();
                let spd = o.get("speed").and_then(|v| v.as_f64()).unwrap_or(2.5) as f32;
                let aggro = o
                    .get("aggroRadius")
                    .or_else(|| o.get("sightRadius"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(8.0) as f32;
                let atk = o
                    .get("attackRadius")
                    .or_else(|| o.get("stopDistance"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.2) as f32;
                let wps = o
                    .get("waypoints")
                    .and_then(|v| v.as_array())
                    .map(|arr| {
                        arr.iter()
                            .filter_map(|pt| {
                                let a = pt.as_array()?;
                                if a.len() >= 3 {
                                    Some([
                                        a[0].as_f64().unwrap_or(0.0) as f32,
                                        a[1].as_f64().unwrap_or(0.0) as f32,
                                        a[2].as_f64().unwrap_or(0.0) as f32,
                                    ])
                                } else {
                                    None
                                }
                            })
                            .collect()
                    })
                    .unwrap_or_default();
                (Some(b), spd, aggro, atk, wps)
            }
            _ => (None, 2.5, 8.0, 1.2, Vec::new()),
        };

    let (zone_kind, zone_rate, zone_cooldown_sec, zone_event) = match xr.get("zone") {
        Some(Value::String(k)) => (Some(k.clone()), 10.0, 0.5, None),
        Some(Value::Object(o)) => {
            let k = o
                .get("kind")
                .or_else(|| o.get("action"))
                .and_then(|v| v.as_str())
                .unwrap_or("trigger")
                .to_string();
            let r = o.get("rate").and_then(|v| v.as_f64()).unwrap_or(10.0) as f32;
            let cd = o.get("cooldownMs").and_then(|v| v.as_f64()).unwrap_or(500.0) / 1000.0;
            let ev = o.get("event").and_then(|v| v.as_str()).map(|s| s.to_string());
            (Some(k), r, cd.max(SIM_DT_SEC), ev)
        }
        _ => (None, 10.0, 0.5, None),
    };

    let (spawner_template, spawner_interval_sec, spawner_max_active, spawner_radius) =
        match xr.get("spawner") {
            Some(Value::Object(o)) => {
                let tpl = o
                    .get("template")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .map(|s| s.to_string());
                let intv = o
                    .get("interval")
                    .or_else(|| o.get("intervalSec"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(3.0)
                    .max(0.1);
                let max_a = o.get("maxActive").and_then(|v| v.as_u64()).unwrap_or(5) as usize;
                let rad = o
                    .get("radius")
                    .or_else(|| o.get("spawnRadius"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.5) as f32;
                (tpl, intv, max_a.min(32), rad)
            }
            _ => (None, 3.0, 5, 1.5),
        };

    let joint = parse_joint_sim_state(&xr);
    let grounded = (node.translation[1] - half_extents[1]).abs() <= 0.08;

    NodeSimState {
        name: node.name.clone(),
        base_translation: node.translation,
        base_rotation: node.rotation,
        base_scale: node.scale,
        translation: node.translation,
        rotation: node.rotation,
        scale: node.scale,
        velocity: initial_velocity,
        visible: node.visible,
        destroyed: false,
        grounded,
        toggle_active: false,
        color_cycle_idx: 0,
        xr,
        interactivity: node.interactivity.clone(),
        group,
        is_character,
        character_speed,
        jump_impulse,
        physics_mode,
        mass,
        restitution,
        friction,
        linear_damping,
        gravity_scale,
        has_rigid_body_config,
        half_extents,
        hp,
        max_hp,
        armor,
        invuln_duration_sec,
        invuln_remaining_sec: 0.0,
        on_zero,
        score_value,
        agent_behavior,
        agent_speed,
        agent_aggro_radius,
        agent_attack_radius,
        agent_waypoints,
        agent_waypoint_idx: 0,
        agent_attack_cooldown_sec: 0.0,
        zone_kind,
        zone_rate,
        zone_cooldown_sec,
        zone_timer_sec: 0.0,
        zone_event,
        zone_fired_once: false,
        spawner_template,
        spawner_interval_sec,
        spawner_max_active,
        spawner_radius,
        spawner_timer_sec: 0.0,
        spawner_active_children: 0,
        spawned_by: None,
        joint,
    }
}

fn extract_objectives(states: &[NodeSimState]) -> Vec<ObjectiveState> {
    let mut out = Vec::new();
    for st in states {
        let Some(obj_val) = st.xr.get("objective") else {
            continue;
        };
        let list: Vec<&Value> =
            if let Some(arr) = obj_val.as_array() { arr.iter().collect() } else { vec![obj_val] };
        for item in list {
            if let Some(o) = item.as_object() {
                let id = o
                    .get("id")
                    .or_else(|| o.get("tag"))
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&st.name)
                    .to_string();
                let kind = o
                    .get("kind")
                    .or_else(|| o.get("type"))
                    .and_then(|v| v.as_str())
                    .unwrap_or("reach")
                    .to_string();
                let target = o
                    .get("target")
                    .and_then(|v| v.as_str())
                    .filter(|s| !s.is_empty())
                    .unwrap_or(&st.name)
                    .to_string();
                let radius =
                    o.get("radius").and_then(|v| v.as_f64()).unwrap_or(1.25).max(0.1) as f32;
                let amount = o.get("amount").and_then(|v| v.as_i64()).unwrap_or(0);
                let count = o
                    .get("count")
                    .or_else(|| o.get("duration"))
                    .and_then(|v| v.as_f64())
                    .unwrap_or(1.0);
                let win_on_complete = o
                    .get("winOnComplete")
                    .or_else(|| o.get("required"))
                    .and_then(|v| v.as_bool())
                    .unwrap_or(true);
                out.push(ObjectiveState {
                    id,
                    kind,
                    target,
                    radius,
                    amount,
                    count,
                    progress: 0.0,
                    completed: false,
                    win_on_complete,
                });
            }
        }
    }
    out
}

#[allow(clippy::too_many_arguments)]
fn dispatch_interactivity_entry(
    owner_idx: usize,
    hook_name: &str,
    entry: &Value,
    states: &mut [NodeSimState],
    scene: &mut SceneGraph,
    tweens: &mut Vec<ActiveTween>,
    triggered_events: &mut Vec<String>,
    depth: usize,
) {
    if depth > MAX_EVENT_CHAIN_DEPTH {
        return;
    }
    if let Some(arr) = entry.as_array() {
        for sub in arr {
            dispatch_interactivity_entry(
                owner_idx,
                hook_name,
                sub,
                states,
                scene,
                tweens,
                triggered_events,
                depth + 1,
            );
        }
        return;
    }
    let Some(obj) = entry.as_object() else {
        return;
    };
    let action = obj.get("action").and_then(|v| v.as_str()).unwrap_or("");
    let target_idx = obj
        .get("target")
        .and_then(|v| v.as_str())
        .and_then(|tname| find_node_index(states, tname))
        .unwrap_or(owner_idx);
    if target_idx >= states.len() {
        return;
    }

    triggered_events.push(format!("{}:{}:{}", hook_name, action, states[target_idx].name));
    let duration = obj.get("duration").and_then(|v| v.as_f64()).unwrap_or(0.0).max(0.0);

    match action {
        "toggleVisibility" => {
            states[target_idx].visible = !states[target_idx].visible;
        }
        "setProperty" => {
            let prop = obj.get("property").and_then(|v| v.as_str()).unwrap_or("");
            if let Some(val) = obj.get("value") {
                apply_property_immediate_or_tween(
                    target_idx, prop, val, 0.0, states, scene, tweens,
                );
            }
        }
        "interpolate" => {
            let prop = obj.get("property").and_then(|v| v.as_str()).unwrap_or("position");
            if let Some(to_val) = obj.get("to").or_else(|| obj.get("value")) {
                apply_property_immediate_or_tween(
                    target_idx, prop, to_val, duration, states, scene, tweens,
                );
            }
            if let Some(pos_val) = obj.get("position").or_else(|| obj.get("translation")) {
                apply_property_immediate_or_tween(
                    target_idx, "position", pos_val, duration, states, scene, tweens,
                );
            }
            if let Some(rot_val) = obj.get("rotation") {
                apply_property_immediate_or_tween(
                    target_idx, "rotation", rot_val, duration, states, scene, tweens,
                );
            }
            if let Some(scl_val) = obj.get("scale") {
                apply_property_immediate_or_tween(
                    target_idx, "scale", scl_val, duration, states, scene, tweens,
                );
            }
        }
        "toggleTransform" => {
            states[target_idx].toggle_active = !states[target_idx].toggle_active;
            let active = states[target_idx].toggle_active;
            if let Some(pos_val) = obj.get("position").or_else(|| obj.get("translation")) {
                let target_pos = if active {
                    parse_vec3(pos_val, states[target_idx].base_translation)
                } else {
                    states[target_idx].base_translation
                };
                schedule_vec3_tween(
                    target_idx,
                    TweenProperty::Translation,
                    states[target_idx].translation,
                    target_pos,
                    duration,
                    states,
                    tweens,
                );
            }
            if let Some(scl_val) = obj.get("scale") {
                let target_scl = if active {
                    parse_vec3(scl_val, states[target_idx].base_scale)
                } else {
                    states[target_idx].base_scale
                };
                schedule_vec3_tween(
                    target_idx,
                    TweenProperty::Scale,
                    states[target_idx].scale,
                    target_scl,
                    duration,
                    states,
                    tweens,
                );
            }
            if let Some(rot_val) = obj.get("rotation") {
                let target_rot = if active {
                    parse_rot_quat(rot_val, states[target_idx].base_rotation)
                } else {
                    states[target_idx].base_rotation
                };
                if duration <= 1e-6 {
                    states[target_idx].rotation = target_rot;
                } else {
                    tweens.push(ActiveTween {
                        node_idx: target_idx,
                        property: TweenProperty::Rotation,
                        from: states[target_idx].rotation,
                        to: target_rot,
                        elapsed: 0.0,
                        duration,
                    });
                }
            }
        }
        "cycleMaterialColor" => {
            if let Some(colors) = obj.get("colors").and_then(|v| v.as_array()) {
                if !colors.is_empty() {
                    let c_idx = states[target_idx].color_cycle_idx % colors.len();
                    states[target_idx].color_cycle_idx = (c_idx + 1) % colors.len();
                    if let Some(rgb) = parse_color_rgba(&colors[c_idx]) {
                        if let Some(m_idx) = scene
                            .nodes
                            .get(target_idx)
                            .and_then(|n| n.mesh)
                            .and_then(|mi| scene.meshes.get(mi).and_then(|m| m.material_index))
                        {
                            if let Some(mat) = scene.materials.get_mut(m_idx) {
                                mat.base_color = rgb;
                            }
                        }
                    }
                }
            }
        }
        "sendEvent" => {
            if let Some(ev_id) =
                obj.get("eventId").or_else(|| obj.get("event")).and_then(|v| v.as_str())
            {
                dispatch_custom_event(ev_id, states, scene, tweens, triggered_events, depth + 1);
            }
        }
        _ => {}
    }
}

fn dispatch_custom_event(
    event_id: &str,
    states: &mut [NodeSimState],
    scene: &mut SceneGraph,
    tweens: &mut Vec<ActiveTween>,
    triggered_events: &mut Vec<String>,
    depth: usize,
) {
    if depth > MAX_EVENT_CHAIN_DEPTH {
        return;
    }
    for idx in 0..states.len() {
        let Some(inter) = states[idx].interactivity.clone() else {
            continue;
        };
        let Some(on_recv) = inter.get("onReceive") else {
            continue;
        };
        let entries: Vec<&Value> =
            if let Some(arr) = on_recv.as_array() { arr.iter().collect() } else { vec![on_recv] };
        for entry in entries {
            let matches_id = entry
                .get("eventId")
                .or_else(|| entry.get("event"))
                .and_then(|v| v.as_str())
                .map(|id| id == event_id)
                .unwrap_or(true);
            if matches_id {
                dispatch_interactivity_entry(
                    idx,
                    "onReceive",
                    entry,
                    states,
                    scene,
                    tweens,
                    triggered_events,
                    depth + 1,
                );
            }
        }
    }
}

/// Evaluates basic `KHR_interactivity` behavior graphs from `.glb` files.
fn dispatch_gltf_khr_interactivity(
    khr: &Value,
    event_op: &str,
    selected_node: Option<usize>,
    states: &mut [NodeSimState],
    tweens: &mut Vec<ActiveTween>,
    triggered_events: &mut Vec<String>,
) {
    let Some(nodes) = khr
        .get("graphs")
        .and_then(|g| g.as_array())
        .and_then(|a| a.first())
        .and_then(|g0| g0.get("nodes"))
        .and_then(|n| n.as_array())
    else {
        return;
    };
    for gnode in nodes {
        let decl_idx =
            gnode.get("declaration").and_then(|v| v.as_u64()).unwrap_or(u64::MAX) as usize;
        let op = khr
            .get("graphs")
            .and_then(|g| g.as_array())
            .and_then(|a| a.first())
            .and_then(|g0| g0.get("declarations"))
            .and_then(|d| d.as_array())
            .and_then(|da| da.get(decl_idx))
            .and_then(|d| d.get("op"))
            .and_then(|v| v.as_str())
            .unwrap_or("");
        if op != event_op {
            continue;
        }
        if let Some(sel_idx) = selected_node {
            if let Some(cfg_node) = gnode
                .get("configuration")
                .and_then(|c| c.get("nodeIndex"))
                .and_then(|n| n.get("value"))
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_u64())
            {
                if (cfg_node as usize) != sel_idx {
                    continue;
                }
            }
        }
        let Some(next_idx) = gnode
            .get("flows")
            .and_then(|f| f.get("out"))
            .and_then(|o| o.get("node"))
            .and_then(|v| v.as_u64())
            .map(|v| v as usize)
        else {
            continue;
        };
        if let Some(act_node) = nodes.get(next_idx) {
            let ptr = act_node
                .get("configuration")
                .and_then(|c| c.get("pointer"))
                .and_then(|p| p.get("value"))
                .and_then(|v| v.as_array())
                .and_then(|a| a.first())
                .and_then(|v| v.as_str())
                .unwrap_or("");
            // Pointer format: `/nodes/{idx}/translation` | `/nodes/{idx}/rotation` |
            // `/nodes/{idx}/scale`
            let parts: Vec<&str> = ptr.split('/').collect();
            if parts.len() >= 4 && parts[1] == "nodes" {
                if let Ok(target_idx) = parts[2].parse::<usize>() {
                    if target_idx < states.len() {
                        let prop_name = parts[3];
                        let dur = act_node
                            .get("values")
                            .and_then(|v| v.get("duration"))
                            .and_then(|d| d.get("value"))
                            .and_then(|a| a.as_array())
                            .and_then(|a| a.first())
                            .and_then(|x| x.as_f64())
                            .unwrap_or(0.5);
                        if let Some(val_arr) = act_node
                            .get("values")
                            .and_then(|v| v.get("b").or_else(|| v.get("value")))
                            .and_then(|b| b.get("value"))
                        {
                            triggered_events.push(format!(
                                "khr:{}:{}:{}",
                                event_op, prop_name, states[target_idx].name
                            ));
                            if prop_name == "translation" {
                                let to = parse_vec3(val_arr, states[target_idx].translation);
                                schedule_vec3_tween(
                                    target_idx,
                                    TweenProperty::Translation,
                                    states[target_idx].translation,
                                    to,
                                    dur,
                                    states,
                                    tweens,
                                );
                            } else if prop_name == "scale" {
                                let to = parse_vec3(val_arr, states[target_idx].scale);
                                schedule_vec3_tween(
                                    target_idx,
                                    TweenProperty::Scale,
                                    states[target_idx].scale,
                                    to,
                                    dur,
                                    states,
                                    tweens,
                                );
                            }
                        }
                    }
                }
            }
        }
    }
}

fn apply_property_immediate_or_tween(
    target_idx: usize,
    prop: &str,
    val: &Value,
    duration: f64,
    states: &mut [NodeSimState],
    scene: &mut SceneGraph,
    tweens: &mut Vec<ActiveTween>,
) {
    match prop {
        "position" | "translation" => {
            let to = parse_vec3(val, states[target_idx].translation);
            schedule_vec3_tween(
                target_idx,
                TweenProperty::Translation,
                states[target_idx].translation,
                to,
                duration,
                states,
                tweens,
            );
        }
        "scale" => {
            let to = if let Some(n) = val.as_f64() {
                [n as f32, n as f32, n as f32]
            } else {
                parse_vec3(val, states[target_idx].scale)
            };
            schedule_vec3_tween(
                target_idx,
                TweenProperty::Scale,
                states[target_idx].scale,
                to,
                duration,
                states,
                tweens,
            );
        }
        "rotation" => {
            let to = parse_rot_quat(val, states[target_idx].rotation);
            if duration <= 1e-6 {
                states[target_idx].rotation = to;
            } else {
                tweens.push(ActiveTween {
                    node_idx: target_idx,
                    property: TweenProperty::Rotation,
                    from: states[target_idx].rotation,
                    to,
                    elapsed: 0.0,
                    duration,
                });
            }
        }
        "visible" => {
            if let Some(b) = val.as_bool() {
                states[target_idx].visible = b;
            }
        }
        "color" | "baseColor" | "baseColorFactor" => {
            if let Some(rgba) = parse_color_rgba(val) {
                if let Some(m_idx) = scene
                    .nodes
                    .get(target_idx)
                    .and_then(|n| n.mesh)
                    .and_then(|mi| scene.meshes.get(mi).and_then(|m| m.material_index))
                {
                    if let Some(mat) = scene.materials.get_mut(m_idx) {
                        if duration <= 1e-6 {
                            mat.base_color = rgba;
                        } else {
                            tweens.push(ActiveTween {
                                node_idx: target_idx,
                                property: TweenProperty::MaterialColor(m_idx),
                                from: mat.base_color,
                                to: rgba,
                                elapsed: 0.0,
                                duration,
                            });
                        }
                    }
                }
            }
        }
        _ => {}
    }
}

fn schedule_vec3_tween(
    node_idx: usize,
    property: TweenProperty,
    from: [f32; 3],
    to: [f32; 3],
    duration: f64,
    states: &mut [NodeSimState],
    tweens: &mut Vec<ActiveTween>,
) {
    if duration <= 1e-6 {
        match property {
            TweenProperty::Translation => states[node_idx].translation = to,
            TweenProperty::Scale => states[node_idx].scale = to,
            _ => {}
        }
    } else {
        tweens.push(ActiveTween {
            node_idx,
            property,
            from: [from[0], from[1], from[2], 0.0],
            to: [to[0], to[1], to[2], 0.0],
            elapsed: 0.0,
            duration,
        });
    }
}

fn apply_health_delta(
    idx: usize,
    delta: f32,
    states: &mut [NodeSimState],
    score: &mut i64,
    audio_cues_fired: &mut Vec<String>,
    triggered_events: &mut Vec<String>,
) {
    if idx >= states.len() || states[idx].destroyed {
        return;
    }
    let Some(cur_hp) = states[idx].hp else {
        return;
    };
    if delta < 0.0 && states[idx].invuln_remaining_sec > 0.0 {
        return;
    }
    let effective_delta = if delta < 0.0 { (delta + states[idx].armor).min(-1.0) } else { delta };
    let max_hp = states[idx].max_hp.unwrap_or(100.0);
    let next_hp = (cur_hp + effective_delta).clamp(0.0, max_hp);
    states[idx].hp = Some(next_hp);
    if effective_delta < 0.0 {
        states[idx].invuln_remaining_sec = states[idx].invuln_duration_sec;
        fire_audio_cue(&states[idx], "onHit", audio_cues_fired);
    }
    if next_hp <= 0.0 {
        fire_audio_cue(&states[idx], "onZero", audio_cues_fired);
        *score += states[idx].score_value;
        triggered_events.push(format!("integrityZero:{}", states[idx].name));
        let parent_spawner = states[idx].spawned_by;
        match states[idx].on_zero.as_str() {
            "hide" => {
                states[idx].visible = false;
                states[idx].destroyed = true;
            }
            _ => {
                states[idx].destroyed = true;
                states[idx].visible = false;
            }
        }
        if let Some(p_idx) = parent_spawner {
            if p_idx < states.len() {
                states[p_idx].spawner_active_children =
                    states[p_idx].spawner_active_children.saturating_sub(1);
            }
        }
    }
}

fn fire_audio_cue(state: &NodeSimState, cue_key: &str, out: &mut Vec<String>) {
    if let Some(cues) = state.xr.get("audioCues").and_then(|v| v.as_object()) {
        if let Some(val) = cues.get(cue_key) {
            let label = match val {
                Value::String(s) => s.clone(),
                Value::Object(o) => o
                    .get("src")
                    .or_else(|| o.get("preset"))
                    .and_then(|v| v.as_str())
                    .unwrap_or(cue_key)
                    .to_string(),
                _ => cue_key.to_string(),
            };
            out.push(format!("{}:{}:{}", state.name, cue_key, label));
        }
    }
}

fn find_node_index(states: &[NodeSimState], name: &str) -> Option<usize> {
    states.iter().position(|s| !s.destroyed && s.name == name)
}

fn find_character_index(states: &[NodeSimState], target: Option<&str>) -> Option<usize> {
    if let Some(t) = target {
        if let Some(idx) = find_node_index(states, t) {
            return Some(idx);
        }
    }
    states.iter().position(|s| !s.destroyed && s.is_character)
}

fn horiz_dist(a: [f32; 3], b: [f32; 3]) -> f32 {
    let dx = a[0] - b[0];
    let dz = a[2] - b[2];
    (dx * dx + dz * dz).sqrt()
}

fn aabb_overlaps(pos_a: [f32; 3], ext_a: [f32; 3], pos_b: [f32; 3], ext_b: [f32; 3]) -> bool {
    (pos_a[0] - pos_b[0]).abs() <= (ext_a[0] + ext_b[0])
        && (pos_a[1] - pos_b[1]).abs() <= (ext_a[1] + ext_b[1])
        && (pos_a[2] - pos_b[2]).abs() <= (ext_a[2] + ext_b[2])
}

fn parse_vec3(val: &Value, fallback: [f32; 3]) -> [f32; 3] {
    if let Some(arr) = val.as_array() {
        if arr.len() >= 3 {
            return [
                arr[0].as_f64().unwrap_or(fallback[0] as f64) as f32,
                arr[1].as_f64().unwrap_or(fallback[1] as f64) as f32,
                arr[2].as_f64().unwrap_or(fallback[2] as f64) as f32,
            ];
        }
    }
    fallback
}

fn parse_rot_quat(val: &Value, fallback: [f32; 4]) -> [f32; 4] {
    if let Some(arr) = val.as_array() {
        if arr.len() == 4 {
            return normalize_quat([
                arr[0].as_f64().unwrap_or(0.0) as f32,
                arr[1].as_f64().unwrap_or(0.0) as f32,
                arr[2].as_f64().unwrap_or(0.0) as f32,
                arr[3].as_f64().unwrap_or(1.0) as f32,
            ]);
        } else if arr.len() == 3 {
            // Euler XYZ (radians) -> Quaternion
            let rx = (arr[0].as_f64().unwrap_or(0.0) as f32) * 0.5;
            let ry = (arr[1].as_f64().unwrap_or(0.0) as f32) * 0.5;
            let rz = (arr[2].as_f64().unwrap_or(0.0) as f32) * 0.5;
            let (sx, cx) = rx.sin_cos();
            let (sy, cy) = ry.sin_cos();
            let (sz, cz) = rz.sin_cos();
            return normalize_quat([
                sx * cy * cz + cx * sy * sz,
                cx * sy * cz - sx * cy * sz,
                cx * cy * sz + sx * sy * cz,
                cx * cy * cz - sx * sy * sz,
            ]);
        }
    }
    fallback
}

fn normalize_quat(q: [f32; 4]) -> [f32; 4] {
    let len = (q[0] * q[0] + q[1] * q[1] + q[2] * q[2] + q[3] * q[3]).sqrt();
    if len > 1e-6 {
        [q[0] / len, q[1] / len, q[2] / len, q[3] / len]
    } else {
        [0.0, 0.0, 0.0, 1.0]
    }
}

fn dot3(a: [f32; 3], b: [f32; 3]) -> f32 {
    a[0] * b[0] + a[1] * b[1] + a[2] * b[2]
}

fn cross3(a: [f32; 3], b: [f32; 3]) -> [f32; 3] {
    [a[1] * b[2] - a[2] * b[1], a[2] * b[0] - a[0] * b[2], a[0] * b[1] - a[1] * b[0]]
}

fn quat_from_axis_angle(axis: [f32; 3], angle: f32) -> [f32; 4] {
    let half = angle * 0.5;
    let (s, c) = half.sin_cos();
    [axis[0] * s, axis[1] * s, axis[2] * s, c]
}

fn quat_mul(a: [f32; 4], b: [f32; 4]) -> [f32; 4] {
    [
        a[3] * b[0] + a[0] * b[3] + a[1] * b[2] - a[2] * b[1],
        a[3] * b[1] - a[0] * b[2] + a[1] * b[3] + a[2] * b[0],
        a[3] * b[2] + a[0] * b[1] - a[1] * b[0] + a[2] * b[3],
        a[3] * b[3] - a[0] * b[0] - a[1] * b[1] - a[2] * b[2],
    ]
}

fn quat_rotate_vec(q: [f32; 4], v: [f32; 3]) -> [f32; 3] {
    let tx = 2.0 * (q[1] * v[2] - q[2] * v[1]);
    let ty = 2.0 * (q[2] * v[0] - q[0] * v[2]);
    let tz = 2.0 * (q[0] * v[1] - q[1] * v[0]);
    [
        v[0] + q[3] * tx + (q[1] * tz - q[2] * ty),
        v[1] + q[3] * ty + (q[2] * tx - q[0] * tz),
        v[2] + q[3] * tz + (q[0] * ty - q[1] * tx),
    ]
}

fn parse_joint_axis(val: Option<&Value>, fallback: [f32; 3]) -> [f32; 3] {
    match val {
        Some(Value::String(s)) => match s.trim().to_ascii_lowercase().as_str() {
            "x" | "+x" => [1.0, 0.0, 0.0],
            "-x" => [-1.0, 0.0, 0.0],
            "y" | "+y" => [0.0, 1.0, 0.0],
            "-y" => [0.0, -1.0, 0.0],
            "z" | "+z" => [0.0, 0.0, 1.0],
            "-z" => [0.0, 0.0, -1.0],
            _ => fallback,
        },
        Some(Value::Array(arr)) if arr.len() >= 3 => {
            let x = arr[0].as_f64().unwrap_or(0.0) as f32;
            let y = arr[1].as_f64().unwrap_or(0.0) as f32;
            let z = arr[2].as_f64().unwrap_or(0.0) as f32;
            let len = (x * x + y * y + z * z).sqrt();
            if len.is_finite() && len > 1e-6 {
                [x / len, y / len, z / len]
            } else {
                fallback
            }
        }
        _ => fallback,
    }
}

fn parse_joint_sim_state(xr: &Value) -> Option<JointSimState> {
    let raw = xr.get("joint").or_else(|| xr.get("constraint"))?;
    let (raw_type, obj) = match raw {
        Value::Bool(true) => ("hinge", None),
        Value::String(s) => {
            if s.trim().eq_ignore_ascii_case("none") || s.trim().is_empty() {
                return None;
            }
            (s.as_str(), None)
        }
        Value::Object(o) => {
            if o.get("enabled").and_then(|v| v.as_bool()) == Some(false) {
                return None;
            }
            let t = o
                .get("type")
                .or_else(|| o.get("kind"))
                .or_else(|| o.get("mode"))
                .and_then(|v| v.as_str())
                .unwrap_or("hinge");
            (t, Some(o))
        }
        _ => return None,
    };
    let kind = match raw_type.trim().to_ascii_lowercase().as_str() {
        "hinge" | "revolute" => "hinge",
        "slider" | "prismatic" => "slider",
        "spring" | "distance" => "spring",
        "ball" | "spherical" => "ball",
        _ => return None,
    }
    .to_string();

    let target = obj
        .and_then(|o| {
            o.get("target").or_else(|| o.get("connectedBody")).or_else(|| o.get("parent"))
        })
        .and_then(|v| v.as_str())
        .map(|s| s.trim())
        .filter(|s| !s.is_empty() && !s.eq_ignore_ascii_case("world"))
        .unwrap_or("")
        .to_string();

    let anchor = obj
        .and_then(|o| o.get("anchor").or_else(|| o.get("pivot")))
        .and_then(|v| v.as_array())
        .filter(|a| a.len() >= 3)
        .map(|a| {
            [
                (a[0].as_f64().unwrap_or(0.0) as f32).clamp(-100.0, 100.0),
                (a[1].as_f64().unwrap_or(0.0) as f32).clamp(-100.0, 100.0),
                (a[2].as_f64().unwrap_or(0.0) as f32).clamp(-100.0, 100.0),
            ]
        })
        .unwrap_or([0.0, 0.0, 0.0]);

    let axis_fallback = match kind.as_str() {
        "slider" => [0.0, 0.0, 1.0],
        "spring" => [0.0, -1.0, 0.0],
        _ => [0.0, 1.0, 0.0],
    };
    let axis = parse_joint_axis(obj.and_then(|o| o.get("axis")), axis_fallback);
    let is_ang = kind == "hinge" || kind == "ball";
    let lim_lo = if is_ang {
        -360.0f32
    } else if kind == "spring" {
        0.0f32
    } else {
        -100.0f32
    };
    let lim_hi = if is_ang { 360.0f32 } else { 100.0f32 };
    let limits = obj.and_then(|o| {
        if let Some(arr) = o.get("limits").and_then(|v| v.as_array()).filter(|a| a.len() >= 2) {
            let a = (arr[0].as_f64()? as f32).clamp(lim_lo, lim_hi);
            let b = (arr[1].as_f64()? as f32).clamp(lim_lo, lim_hi);
            return Some(if a <= b { [a, b] } else { [b, a] });
        }
        let min_v = o
            .get("min")
            .or_else(|| if is_ang { o.get("minAngle") } else { o.get("minDistance") })
            .and_then(|v| v.as_f64());
        let max_v = o
            .get("max")
            .or_else(|| if is_ang { o.get("maxAngle") } else { o.get("maxDistance") })
            .and_then(|v| v.as_f64());
        if min_v.is_some() || max_v.is_some() {
            let a = (min_v.unwrap_or(lim_lo as f64) as f32).clamp(lim_lo, lim_hi);
            let b = (max_v.unwrap_or(lim_hi as f64) as f32).clamp(lim_lo, lim_hi);
            Some(if a <= b { [a, b] } else { [b, a] })
        } else {
            None
        }
    });

    let default_stiffness = if kind == "spring" { 40.0 } else { 0.0 };
    let default_damping = if kind == "spring" { 4.0 } else { 0.5 };
    let stiffness = obj
        .and_then(|o| o.get("stiffness"))
        .and_then(|v| v.as_f64())
        .map(|v| (v as f32).clamp(0.0, 10000.0))
        .unwrap_or(default_stiffness);
    let damping = obj
        .and_then(|o| o.get("damping"))
        .and_then(|v| v.as_f64())
        .map(|v| (v as f32).clamp(0.0, 1000.0))
        .unwrap_or(default_damping);
    let rest_length = obj
        .and_then(|o| o.get("restLength"))
        .and_then(|v| v.as_f64())
        .map(|v| (v as f32).clamp(0.0, 100.0))
        .unwrap_or(0.0);
    let motor_speed = obj
        .and_then(|o| o.get("motorSpeed"))
        .and_then(|v| v.as_f64())
        .map(|v| (v as f32).clamp(-100.0, 100.0))
        .unwrap_or(0.0);
    let default_motor_force = if motor_speed != 0.0 { 50.0 } else { 0.0 };
    let motor_max_force = obj
        .and_then(|o| o.get("motorMaxForce").or_else(|| o.get("maxMotorForce")))
        .and_then(|v| v.as_f64())
        .map(|v| (v as f32).clamp(0.0, 10000.0))
        .unwrap_or(default_motor_force);

    Some(JointSimState {
        kind,
        target,
        anchor,
        axis,
        limits,
        stiffness,
        damping,
        rest_length,
        motor_speed,
        motor_max_force,
        initialized: false,
        target_local_anchor: [0.0, 0.0, 0.0],
        world_anchor: [0.0, 0.0, 0.0],
        effective_rest_len: 0.0,
        angle: 0.0,
        omega: 0.0,
        slide_pos: 0.0,
        slide_vel: 0.0,
        omega_vec: [0.0, 0.0, 0.0],
        joint_rot: [0.0, 0.0, 0.0, 1.0],
    })
}

fn step_joints(states: &mut [NodeSimState], dt: f32) {
    let n = states.len();
    for i in 0..n {
        if states[i].destroyed || !states[i].visible || states[i].joint.is_none() {
            continue;
        }
        let target_name = states[i].joint.as_ref().map(|j| j.target.clone()).unwrap_or_default();
        let tb_idx = if !target_name.is_empty() {
            (0..n).find(|&k| {
                k != i && !states[k].destroyed && states[k].visible && states[k].name == target_name
            })
        } else {
            None
        };

        let base_pos_i = states[i].base_translation;
        let base_rot_i = states[i].base_rotation;
        let tb_init_pos = tb_idx.map(|k| states[k].base_translation);
        let tb_pos = tb_idx.map(|k| states[k].translation);
        let tb_vel = tb_idx.map(|k| states[k].velocity).unwrap_or([0.0, 0.0, 0.0]);
        let tb_joint_rot = tb_idx
            .and_then(|k| states[k].joint.as_ref().map(|j| j.joint_rot))
            .unwrap_or([0.0, 0.0, 0.0, 1.0]);
        let tb_dyn_mass = tb_idx.and_then(|k| {
            if states[k].physics_mode.as_deref() == Some("dynamic") && states[k].mass > 0.0 {
                Some(states[k].mass)
            } else {
                None
            }
        });

        let has_rb_cfg = states[i].physics_mode.is_some();
        let has_dyn_rb = states[i].physics_mode.as_deref() == Some("dynamic");
        let mass = if has_dyn_rb && states[i].mass > 0.0 { states[i].mass } else { 1.0 };
        let g_scale = if has_rb_cfg {
            if has_dyn_rb {
                states[i].gravity_scale
            } else {
                0.0
            }
        } else {
            1.0
        };
        let mut pos_i = states[i].translation;
        let mut vel_i = states[i].velocity;
        let mut rot_i = states[i].rotation;
        let mut pending_tb_dv: Option<([f32; 3], [f32; 3])> = None;

        if let Some(js) = states[i].joint.as_mut() {
            if !js.initialized {
                let pivot0 = [
                    base_pos_i[0] + js.anchor[0],
                    base_pos_i[1] + js.anchor[1],
                    base_pos_i[2] + js.anchor[2],
                ];
                let mut target_local = [0.0f32; 3];
                let mut d0 = 0.0f32;
                if let Some(t0) = tb_init_pos {
                    if js.kind == "spring" {
                        let dx = pivot0[0] - t0[0];
                        let dy = pivot0[1] - t0[1];
                        let dz = pivot0[2] - t0[2];
                        d0 = (dx * dx + dy * dy + dz * dz).sqrt();
                    } else {
                        target_local = [pivot0[0] - t0[0], pivot0[1] - t0[1], pivot0[2] - t0[2]];
                    }
                } else if js.kind == "spring" {
                    d0 = (js.anchor[0] * js.anchor[0]
                        + js.anchor[1] * js.anchor[1]
                        + js.anchor[2] * js.anchor[2])
                        .sqrt();
                }
                js.initialized = true;
                js.target_local_anchor = target_local;
                js.world_anchor = pivot0;
                js.effective_rest_len = if js.rest_length > 0.0 { js.rest_length } else { d0 };
            }

            let world_pivot = if let Some(tp) = tb_pos {
                let off = quat_rotate_vec(tb_joint_rot, js.target_local_anchor);
                [tp[0] + off[0], tp[1] + off[1], tp[2] + off[2]]
            } else {
                js.world_anchor
            };

            match js.kind.as_str() {
                "hinge" => {
                    let u = js.axis;
                    let r0 = [-js.anchor[0], -js.anchor[1], -js.anchor[2]];
                    let q_prev = quat_from_axis_angle(u, js.angle);
                    let r_prev = quat_rotate_vec(q_prev, r0);
                    let u_dot_r = dot3(u, r_prev);
                    let r_perp = [
                        r_prev[0] - u[0] * u_dot_r,
                        r_prev[1] - u[1] * u_dot_r,
                        r_prev[2] - u[2] * u_dot_r,
                    ];
                    let r_perp2 = dot3(r_perp, r_perp);
                    let inertia = (mass * r_perp2.max(0.25)).max(0.05);
                    let wx_r_prev = cross3(u, r_prev);
                    let dv = [
                        vel_i[0] - (tb_vel[0] + wx_r_prev[0] * js.omega),
                        vel_i[1] - (tb_vel[1] + wx_r_prev[1] * js.omega),
                        vel_i[2] - (tb_vel[2] + wx_r_prev[2] * js.omega),
                    ];
                    let mut omega = js.omega;
                    if r_perp2 > 1e-6 {
                        omega += dot3(cross3(r_prev, dv), u) / r_perp2;
                    }
                    let tau_g = if has_dyn_rb {
                        0.0
                    } else {
                        dot3(cross3(r_prev, [0.0, -9.81 * mass * g_scale, 0.0]), u)
                    };
                    let denom = inertia + js.damping * dt + js.stiffness * dt * dt;
                    omega = (inertia * omega + (tau_g - js.stiffness * js.angle) * dt) / denom;
                    if js.motor_max_force > 0.0 {
                        let max_dw = (js.motor_max_force / inertia) * dt;
                        omega += (js.motor_speed - omega).clamp(-max_dw, max_dw);
                    }
                    omega = omega.clamp(-50.0, 50.0);
                    let mut angle = js.angle + omega * dt;
                    if let Some(lims) = js.limits {
                        let min_rad = lims[0].to_radians();
                        let max_rad = lims[1].to_radians();
                        if angle < min_rad {
                            angle = min_rad;
                            if omega < 0.0 {
                                omega = 0.0;
                            }
                        } else if angle > max_rad {
                            angle = max_rad;
                            if omega > 0.0 {
                                omega = 0.0;
                            }
                        }
                    }
                    js.angle = angle;
                    js.omega = omega;
                    let q_hinge = quat_from_axis_angle(u, angle);
                    js.joint_rot = q_hinge;
                    rot_i = normalize_quat(quat_mul(q_hinge, base_rot_i));
                    let r_new = quat_rotate_vec(q_hinge, r0);
                    pos_i = [
                        world_pivot[0] + r_new[0],
                        world_pivot[1] + r_new[1],
                        world_pivot[2] + r_new[2],
                    ];
                    let wx_r = cross3(u, r_new);
                    vel_i = [
                        tb_vel[0] + wx_r[0] * omega,
                        tb_vel[1] + wx_r[1] * omega,
                        tb_vel[2] + wx_r[2] * omega,
                    ];
                }
                "slider" => {
                    let u = js.axis;
                    let origin = [
                        world_pivot[0] - js.anchor[0],
                        world_pivot[1] - js.anchor[1],
                        world_pivot[2] - js.anchor[2],
                    ];
                    let dv = [
                        vel_i[0] - (tb_vel[0] + u[0] * js.slide_vel),
                        vel_i[1] - (tb_vel[1] + u[1] * js.slide_vel),
                        vel_i[2] - (tb_vel[2] + u[2] * js.slide_vel),
                    ];
                    let mut v = js.slide_vel + dot3(dv, u);
                    let f_grav = if has_dyn_rb { 0.0 } else { -9.81 * mass * g_scale * u[1] };
                    let denom = mass + js.damping * dt + js.stiffness * dt * dt;
                    v = (mass * v + (f_grav - js.stiffness * js.slide_pos) * dt) / denom;
                    if js.motor_max_force > 0.0 {
                        let max_dv = (js.motor_max_force / mass) * dt;
                        v += (js.motor_speed - v).clamp(-max_dv, max_dv);
                    }
                    v = v.clamp(-200.0, 200.0);
                    let mut s = js.slide_pos + v * dt;
                    if let Some(lims) = js.limits {
                        if s < lims[0] {
                            s = lims[0];
                            if v < 0.0 {
                                v = 0.0;
                            }
                        } else if s > lims[1] {
                            s = lims[1];
                            if v > 0.0 {
                                v = 0.0;
                            }
                        }
                    }
                    js.slide_pos = s;
                    js.slide_vel = v;
                    pos_i = [origin[0] + u[0] * s, origin[1] + u[1] * s, origin[2] + u[2] * s];
                    vel_i = [tb_vel[0] + u[0] * v, tb_vel[1] + u[1] * v, tb_vel[2] + u[2] * v];
                }
                "spring" => {
                    if !has_rb_cfg {
                        vel_i[1] += -9.81 * g_scale * dt;
                    }
                    let p_b = tb_pos.unwrap_or(js.world_anchor);
                    let off_a = if tb_pos.is_some() {
                        quat_rotate_vec(js.joint_rot, js.anchor)
                    } else {
                        [0.0, 0.0, 0.0]
                    };
                    let p_a = [pos_i[0] + off_a[0], pos_i[1] + off_a[1], pos_i[2] + off_a[2]];
                    let d = [p_a[0] - p_b[0], p_a[1] - p_b[1], p_a[2] - p_b[2]];
                    let dist = (d[0] * d[0] + d[1] * d[1] + d[2] * d[2]).sqrt();
                    let dir =
                        if dist > 1e-6 { [d[0] / dist, d[1] / dist, d[2] / dist] } else { js.axis };
                    let stretch = dist - js.effective_rest_len;
                    let inv_m1 = 1.0 / mass;
                    let inv_m2 = tb_dyn_mass.map(|m| 1.0 / m).unwrap_or(0.0);
                    let eff_mass = 1.0 / (inv_m1 + inv_m2);
                    let rel_vel =
                        [vel_i[0] - tb_vel[0], vel_i[1] - tb_vel[1], vel_i[2] - tb_vel[2]];
                    let v_rel = dot3(rel_vel, dir);
                    let denom = eff_mass + js.damping * dt + js.stiffness * dt * dt;
                    let v_rel_new = (eff_mass * v_rel - js.stiffness * stretch * dt) / denom;
                    let j_imp = (v_rel_new - v_rel) * eff_mass;
                    let dv1 = j_imp * inv_m1;
                    vel_i = [
                        (vel_i[0] + dir[0] * dv1).clamp(-200.0, 200.0),
                        (vel_i[1] + dir[1] * dv1).clamp(-200.0, 200.0),
                        (vel_i[2] + dir[2] * dv1).clamp(-200.0, 200.0),
                    ];
                    if !has_rb_cfg {
                        let lat_damp = (1.0 - (js.damping * 0.05).min(5.0) * dt).max(0.0);
                        let vn_after = dot3(vel_i, dir);
                        vel_i = [
                            dir[0] * vn_after + (vel_i[0] - dir[0] * vn_after) * lat_damp,
                            dir[1] * vn_after + (vel_i[1] - dir[1] * vn_after) * lat_damp,
                            dir[2] * vn_after + (vel_i[2] - dir[2] * vn_after) * lat_damp,
                        ];
                        pos_i = [
                            pos_i[0] + vel_i[0] * dt,
                            pos_i[1] + vel_i[1] * dt,
                            pos_i[2] + vel_i[2] * dt,
                        ];
                    } else if has_dyn_rb {
                        pos_i = [
                            pos_i[0] + dir[0] * dv1 * dt,
                            pos_i[1] + dir[1] * dv1 * dt,
                            pos_i[2] + dir[2] * dv1 * dt,
                        ];
                    }
                    let mut tb_pos_mut = tb_pos;
                    let mut tb_vel_mut = tb_vel;
                    if inv_m2 > 0.0 {
                        let dv2 = -j_imp * inv_m2;
                        tb_vel_mut = [
                            (tb_vel_mut[0] + dir[0] * dv2).clamp(-200.0, 200.0),
                            (tb_vel_mut[1] + dir[1] * dv2).clamp(-200.0, 200.0),
                            (tb_vel_mut[2] + dir[2] * dv2).clamp(-200.0, 200.0),
                        ];
                        if let Some(tp) = tb_pos_mut.as_mut() {
                            tp[0] += dir[0] * dv2 * dt;
                            tp[1] += dir[1] * dv2 * dt;
                            tp[2] += dir[2] * dv2 * dt;
                        }
                    }
                    if let Some(lims) = js.limits {
                        let p_b2 = tb_pos_mut.unwrap_or(js.world_anchor);
                        let dx = pos_i[0] + off_a[0] - p_b2[0];
                        let dy = pos_i[1] + off_a[1] - p_b2[1];
                        let dz = pos_i[2] + off_a[2] - p_b2[2];
                        let d2 = (dx * dx + dy * dy + dz * dz).sqrt();
                        let clamped = d2.clamp(lims[0], lims[1]);
                        if (clamped - d2).abs() > 1e-6 {
                            let n_dir =
                                if d2 > 1e-6 { [dx / d2, dy / d2, dz / d2] } else { js.axis };
                            let corr = (clamped - d2) / (inv_m1 + inv_m2);
                            pos_i = [
                                pos_i[0] + n_dir[0] * corr * inv_m1,
                                pos_i[1] + n_dir[1] * corr * inv_m1,
                                pos_i[2] + n_dir[2] * corr * inv_m1,
                            ];
                            if inv_m2 > 0.0 {
                                if let Some(tp) = tb_pos_mut.as_mut() {
                                    tp[0] -= n_dir[0] * corr * inv_m2;
                                    tp[1] -= n_dir[1] * corr * inv_m2;
                                    tp[2] -= n_dir[2] * corr * inv_m2;
                                }
                            }
                            let rv = dot3(
                                [
                                    vel_i[0] - if tb_pos.is_some() { tb_vel_mut[0] } else { 0.0 },
                                    vel_i[1] - if tb_pos.is_some() { tb_vel_mut[1] } else { 0.0 },
                                    vel_i[2] - if tb_pos.is_some() { tb_vel_mut[2] } else { 0.0 },
                                ],
                                n_dir,
                            );
                            if (d2 > lims[1] && rv > 0.0) || (d2 < lims[0] && rv < 0.0) {
                                let j_lim = -rv / (inv_m1 + inv_m2);
                                vel_i = [
                                    vel_i[0] + n_dir[0] * j_lim * inv_m1,
                                    vel_i[1] + n_dir[1] * j_lim * inv_m1,
                                    vel_i[2] + n_dir[2] * j_lim * inv_m1,
                                ];
                                if inv_m2 > 0.0 {
                                    tb_vel_mut = [
                                        tb_vel_mut[0] - n_dir[0] * j_lim * inv_m2,
                                        tb_vel_mut[1] - n_dir[1] * j_lim * inv_m2,
                                        tb_vel_mut[2] - n_dir[2] * j_lim * inv_m2,
                                    ];
                                }
                            }
                        }
                    }
                    if inv_m2 > 0.0 {
                        if let Some(tp) = tb_pos_mut {
                            pending_tb_dv = Some((tp, tb_vel_mut));
                        }
                    }
                }
                "ball" => {
                    let r0 = [-js.anchor[0], -js.anchor[1], -js.anchor[2]];
                    let arm_len2 = dot3(r0, r0);
                    let r_prev = quat_rotate_vec(js.joint_rot, r0);
                    let inertia = (mass * arm_len2.max(0.25)).max(0.05);
                    let mut w = js.omega_vec;
                    if arm_len2 > 1e-8 {
                        let wx_r_prev = cross3(w, r_prev);
                        let dv = [
                            vel_i[0] - (tb_vel[0] + wx_r_prev[0]),
                            vel_i[1] - (tb_vel[1] + wx_r_prev[1]),
                            vel_i[2] - (tb_vel[2] + wx_r_prev[2]),
                        ];
                        let dw = cross3(r_prev, dv);
                        w = [
                            w[0] + dw[0] / arm_len2,
                            w[1] + dw[1] / arm_len2,
                            w[2] + dw[2] / arm_len2,
                        ];
                    }
                    let fg = if has_dyn_rb { 0.0 } else { -9.81 * mass * g_scale };
                    let tau_g = [-r_prev[2] * fg, 0.0, r_prev[0] * fg];
                    let q_pos = if js.joint_rot[3] < 0.0 {
                        [-js.joint_rot[0], -js.joint_rot[1], -js.joint_rot[2], -js.joint_rot[3]]
                    } else {
                        js.joint_rot
                    };
                    let sin_half =
                        (q_pos[0] * q_pos[0] + q_pos[1] * q_pos[1] + q_pos[2] * q_pos[2]).sqrt();
                    let swing_angle = 2.0 * sin_half.atan2(q_pos[3].clamp(0.0, 1.0));
                    let swing_axis = if sin_half > 1e-7 {
                        [q_pos[0] / sin_half, q_pos[1] / sin_half, q_pos[2] / sin_half]
                    } else {
                        [0.0, 1.0, 0.0]
                    };
                    let denom = inertia + js.damping * dt + js.stiffness * dt * dt;
                    w = [
                        (inertia * w[0]
                            + (tau_g[0] - js.stiffness * swing_angle * swing_axis[0]) * dt)
                            / denom,
                        (inertia * w[1]
                            + (tau_g[1] - js.stiffness * swing_angle * swing_axis[1]) * dt)
                            / denom,
                        (inertia * w[2]
                            + (tau_g[2] - js.stiffness * swing_angle * swing_axis[2]) * dt)
                            / denom,
                    ];
                    let w_mag = (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt();
                    if w_mag > 50.0 {
                        let scale = 50.0 / w_mag;
                        w = [w[0] * scale, w[1] * scale, w[2] * scale];
                    }
                    let w_step = (w[0] * w[0] + w[1] * w[1] + w[2] * w[2]).sqrt();
                    if w_step > 1e-8 {
                        let dq = quat_from_axis_angle(
                            [w[0] / w_step, w[1] / w_step, w[2] / w_step],
                            w_step * dt,
                        );
                        js.joint_rot = normalize_quat(quat_mul(dq, js.joint_rot));
                    }
                    if let Some(lims) = js.limits {
                        let max_rad = lims[0].abs().max(lims[1].abs()).to_radians();
                        let q_c = if js.joint_rot[3] < 0.0 {
                            [-js.joint_rot[0], -js.joint_rot[1], -js.joint_rot[2], -js.joint_rot[3]]
                        } else {
                            js.joint_rot
                        };
                        let s_h = (q_c[0] * q_c[0] + q_c[1] * q_c[1] + q_c[2] * q_c[2]).sqrt();
                        let ang = 2.0 * s_h.atan2(q_c[3].clamp(0.0, 1.0));
                        if ang > max_rad && s_h > 1e-7 {
                            let ax = [q_c[0] / s_h, q_c[1] / s_h, q_c[2] / s_h];
                            js.joint_rot = quat_from_axis_angle(ax, max_rad);
                            let w_out = dot3(w, ax);
                            if w_out > 0.0 {
                                w = [
                                    w[0] - ax[0] * w_out,
                                    w[1] - ax[1] * w_out,
                                    w[2] - ax[2] * w_out,
                                ];
                            }
                        }
                    }
                    js.omega_vec = w;
                    rot_i = normalize_quat(quat_mul(js.joint_rot, base_rot_i));
                    let r_new = quat_rotate_vec(js.joint_rot, r0);
                    pos_i = [
                        world_pivot[0] + r_new[0],
                        world_pivot[1] + r_new[1],
                        world_pivot[2] + r_new[2],
                    ];
                    let wx_r = cross3(w, r_new);
                    vel_i = [tb_vel[0] + wx_r[0], tb_vel[1] + wx_r[1], tb_vel[2] + wx_r[2]];
                }
                _ => {}
            }
        }

        states[i].translation = pos_i;
        states[i].velocity = vel_i;
        states[i].rotation = rot_i;
        if let (Some(k), Some((tp, tv))) = (tb_idx, pending_tb_dv) {
            states[k].translation = tp;
            states[k].velocity = tv;
        }
    }
}

fn parse_color_rgba(val: &Value) -> Option<[f32; 4]> {
    match val {
        Value::Number(n) => {
            let hex = n.as_u64()? as u32;
            let r = ((hex >> 16) & 0xff) as f32 / 255.0;
            let g = ((hex >> 8) & 0xff) as f32 / 255.0;
            let b = (hex & 0xff) as f32 / 255.0;
            Some([r, g, b, 1.0])
        }
        Value::String(s) => {
            let trimmed = s.trim().trim_start_matches('#').trim_start_matches("0x");
            if trimmed.len() == 6 {
                let hex = u32::from_str_radix(trimmed, 16).ok()?;
                let r = ((hex >> 16) & 0xff) as f32 / 255.0;
                let g = ((hex >> 8) & 0xff) as f32 / 255.0;
                let b = (hex & 0xff) as f32 / 255.0;
                Some([r, g, b, 1.0])
            } else {
                None
            }
        }
        Value::Array(arr) if arr.len() >= 3 => Some([
            arr[0].as_f64().unwrap_or(1.0) as f32,
            arr[1].as_f64().unwrap_or(1.0) as f32,
            arr[2].as_f64().unwrap_or(1.0) as f32,
            arr.get(3).and_then(|v| v.as_f64()).unwrap_or(1.0) as f32,
        ]),
        _ => None,
    }
}
