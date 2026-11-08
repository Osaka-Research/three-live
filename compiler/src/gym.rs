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

//! Closed-loop agent gym (`three_live_gym_reset` / `three_live_gym_step`).
//!
//! An episode is a [`SimStepper`] plus the timeline of actions the agent has issued so far.
//! Each step schedules its actions at the current time and advances the deterministic 60 Hz
//! simulation by the requested ticks, carrying all state over, so a step costs only its own ticks
//! and the same actions always produce the same observations.

use crate::render::{encode_png_rgba_compressed, render_viewport_rgba, RenderViewMode};
use crate::sim::{SimAction, SimStepper, SimulationReport, SIM_DT_SEC};
use serde::{Deserialize, Serialize};

/// Longest episode: 120 s of simulated time (the simulator's cap).
pub const GYM_MAX_TICKS: usize = 7200;
/// Most steps per episode.
pub const GYM_MAX_STEPS: usize = 240;
/// Most ticks per step (10 s).
pub const GYM_MAX_TICKS_PER_STEP: usize = 600;
/// Most bodies listed in one observation.
pub const GYM_MAX_BODIES: usize = 64;
/// Most actions in one step.
pub const GYM_MAX_ACTIONS_PER_STEP: usize = 64;

const ACTION_TYPES: [&str; 10] = [
    "select",
    "tap",
    "click",
    "explode",
    "sendEvent",
    "event",
    "damage",
    "heal",
    "moveCharacter",
    "move",
];

/// One episode's state.
#[derive(Debug, Clone)]
pub struct GymSession {
    sim: SimStepper,
    /// Every action issued so far, with absolute `at` times.
    actions: Vec<SimAction>,
    steps: usize,
    done: bool,
    last_score: i64,
    seen_events: usize,
    seen_audio: usize,
    /// Objectives completed so far (the report lists them in declaration order, not
    /// completion order, so new ones are found by difference rather than by index).
    seen_objectives: Vec<String>,
}

/// Observed state of one scene node.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GymBody {
    pub name: String,
    /// Meters, rounded to 0.1 mm.
    pub position: [f64; 3],
    /// Quaternion `[x, y, z, w]`, rounded to 1e-5.
    pub rotation: [f64; 4],
    pub scale: [f64; 3],
    pub visible: bool,
    pub grounded: bool,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub health: Option<f64>,
    #[serde(skip_serializing_if = "Option::is_none")]
    pub max_health: Option<f64>,
    pub destroyed: bool,
}

/// Observation returned by reset and every step.
#[derive(Debug, Clone, Serialize)]
#[serde(rename_all = "camelCase")]
pub struct GymObservation {
    pub tick: usize,
    pub time_sec: f64,
    pub step: usize,
    /// `running`, `victory`, or `defeat`.
    pub scenario_state: String,
    pub score: i64,
    /// Score gained during this step.
    pub reward: i64,
    /// True when the scenario ended or the episode hit its time / step limit.
    pub done: bool,
    /// Objectives completed during this step.
    pub new_objectives: Vec<String>,
    /// All objectives completed so far.
    pub completed_objectives: Vec<String>,
    /// Events (objective completions, zone hits, interactivity, ...) fired during this step
    /// (for reset: at `t = 0`).
    pub events: Vec<String>,
    /// Audio cues fired during this step (for reset: at `t = 0`).
    pub audio_cues: Vec<String>,
    pub bodies: Vec<GymBody>,
    /// True when `bodies` was truncated to [`GYM_MAX_BODIES`] (use `watch` to pick nodes).
    pub bodies_truncated: bool,
    /// `watch` names that match no node.
    #[serde(skip_serializing_if = "Vec::is_empty")]
    pub unknown_watch: Vec<String>,
}

/// Optional extras for an observation.
#[derive(Debug, Clone, Default)]
pub struct GymObserveOptions {
    /// Only report these node names (all nodes when empty).
    pub watch: Vec<String>,
    /// Render the scene at the observation tick.
    pub frame: Option<(RenderViewMode, u32, u32)>,
}

/// Observation plus an optional PNG frame.
#[derive(Debug)]
pub struct GymStepOutput {
    pub observation: GymObservation,
    pub frame_png: Option<Vec<u8>>,
}

/// Rounds an `f32` simulation value for JSON so observations read `-1.3333` rather than
/// `-1.3333336114883423` (the `f32` widened to `f64`).
fn round_to(v: f32, scale: f64) -> f64 {
    let r = (v as f64 * scale).round() / scale;
    if r == 0.0 {
        0.0
    } else {
        r
    }
}

fn bodies_from(report: &SimulationReport, watch: &[String]) -> (Vec<GymBody>, bool, Vec<String>) {
    let mut out = Vec::new();
    let mut truncated = false;
    for b in &report.bodies {
        if !watch.is_empty() && !watch.iter().any(|w| w == &b.name) {
            continue;
        }
        if out.len() >= GYM_MAX_BODIES {
            truncated = true;
            break;
        }
        out.push(GymBody {
            name: b.name.clone(),
            position: b.final_translation.map(|v| round_to(v, 1e4)),
            rotation: b.final_rotation.map(|v| round_to(v, 1e5)),
            scale: b.final_scale.map(|v| round_to(v, 1e4)),
            visible: b.visible,
            grounded: b.grounded,
            health: b.health.map(|v| round_to(v, 1e3)),
            max_health: b.max_health.map(|v| round_to(v, 1e3)),
            destroyed: b.destroyed,
        });
    }
    let unknown =
        watch.iter().filter(|w| !report.bodies.iter().any(|b| &b.name == *w)).cloned().collect();
    (out, truncated, unknown)
}

fn render_frame(
    sim: &SimStepper,
    frame: Option<(RenderViewMode, u32, u32)>,
) -> Result<Option<Vec<u8>>, String> {
    let Some((view, w, h)) = frame else { return Ok(None) };
    let w = w.clamp(32, 2048);
    let h = h.clamp(32, 2048);
    let view = if view == RenderViewMode::Quad { RenderViewMode::Camera } else { view };
    let label = format!("T={:.2}S", sim.tick() as f64 * SIM_DT_SEC);
    let rgba = render_viewport_rgba(&sim.snapshot(), w, h, view, false, false, Some(&label));
    encode_png_rgba_compressed(w, h, &rgba).map(Some)
}

impl GymSession {
    /// Compiles `source` and returns a new episode with its `t = 0` observation.
    pub fn reset(
        source: &[u8],
        is_glb: bool,
        opts: &GymObserveOptions,
    ) -> Result<(Self, GymStepOutput), String> {
        let sim = SimStepper::new(source, is_glb)?;
        let mut session = GymSession {
            sim,
            actions: Vec::new(),
            steps: 0,
            done: false,
            last_score: 0,
            seen_events: 0,
            seen_audio: 0,
            seen_objectives: Vec::new(),
        };
        let out = session.observe(opts)?;
        Ok((session, out))
    }

    /// Current simulation tick.
    pub fn tick(&self) -> usize {
        self.sim.tick()
    }

    /// True once the episode has ended.
    pub fn is_done(&self) -> bool {
        self.done
    }

    /// Applies `actions` (with `at` meaning *seconds after now*) and advances `ticks` ticks.
    pub fn step(
        &mut self,
        actions: &[SimAction],
        ticks: usize,
        opts: &GymObserveOptions,
    ) -> Result<GymStepOutput, String> {
        if self.done {
            return Err(
                "This episode has ended; start a new one (three_live_gym_reset or `three-live-cli gym reset`)."
                    .to_string()
            );
        }
        if ticks == 0 || ticks > GYM_MAX_TICKS_PER_STEP {
            return Err(format!("`ticks` must be between 1 and {}.", GYM_MAX_TICKS_PER_STEP));
        }
        if actions.len() > GYM_MAX_ACTIONS_PER_STEP {
            return Err(format!("At most {} actions per step.", GYM_MAX_ACTIONS_PER_STEP));
        }
        let tick = self.sim.tick();
        let ticks = ticks.min(GYM_MAX_TICKS - tick);
        let step_sec = ticks as f64 * SIM_DT_SEC;
        // The latest an action can start and still fire inside this step is its last tick.
        let max_delay = (ticks - 1) as f64 * SIM_DT_SEC;
        let mut scheduled = Vec::with_capacity(actions.len());
        for a in actions {
            if !ACTION_TYPES.contains(&a.action_type.as_str()) {
                return Err(format!(
                    "Unknown action type '{}' (use select, explode, sendEvent, damage, heal, or \
                     moveCharacter).",
                    a.action_type
                ));
            }
            let delay = if a.at.is_finite() { a.at.clamp(0.0, max_delay) } else { 0.0 };
            let mut s = a.clone();
            // Half a tick past the current tick: the action fires in this step's first tick
            // (plus its delay), never in a tick that already ran.
            s.at = (tick as f64 + 0.5) * SIM_DT_SEC + delay;
            if matches!(s.action_type.as_str(), "moveCharacter" | "move") {
                s.duration = match s.duration {
                    Some(d) if d.is_finite() => Some(d.clamp(0.0, 120.0)),
                    _ => Some((step_sec - delay).max(SIM_DT_SEC * 0.5)),
                };
            }
            scheduled.push(s);
        }
        // Actions that already fired can never fire again; keep only the ones still running.
        let now = tick as f64 * SIM_DT_SEC;
        self.actions.retain(|a| a.at + a.duration.unwrap_or(0.0) + SIM_DT_SEC >= now);
        self.actions.extend(scheduled);
        self.sim.advance(tick + ticks, &self.actions);
        self.steps += 1;
        self.observe(opts)
    }

    fn observe(&mut self, opts: &GymObserveOptions) -> Result<GymStepOutput, String> {
        let report = self.sim.report();
        let frame_png = render_frame(&self.sim, opts.frame)?;
        let events = report.triggered_events.get(self.seen_events..).unwrap_or_default().to_vec();
        let audio = report.audio_cues_fired.get(self.seen_audio..).unwrap_or_default().to_vec();
        let mut previous = self.seen_objectives.clone();
        let mut new_objectives = Vec::new();
        for id in &report.completed_objectives {
            match previous.iter().position(|p| p == id) {
                Some(i) => {
                    previous.swap_remove(i);
                }
                None => new_objectives.push(id.clone()),
            }
        }
        self.seen_events = report.triggered_events.len();
        self.seen_audio = report.audio_cues_fired.len();
        self.seen_objectives = report.completed_objectives.clone();
        let reward = report.score - self.last_score;
        self.last_score = report.score;
        let tick = self.sim.tick();
        self.done = report.scenario_state != "running"
            || tick >= GYM_MAX_TICKS
            || self.steps >= GYM_MAX_STEPS;
        let (bodies, bodies_truncated, unknown_watch) = bodies_from(&report, &opts.watch);
        Ok(GymStepOutput {
            observation: GymObservation {
                tick,
                time_sec: (tick as f64 * SIM_DT_SEC * 1000.0).round() / 1000.0,
                step: self.steps,
                scenario_state: report.scenario_state.clone(),
                score: report.score,
                reward,
                done: self.done,
                new_objectives,
                completed_objectives: report.completed_objectives,
                events,
                audio_cues: audio,
                bodies,
                bodies_truncated,
                unknown_watch,
            },
            frame_png,
        })
    }
}

/// Version of the `three-live-cli gym` episode file format.
pub const GYM_EPISODE_VERSION: u32 = 1;
/// Largest scene an episode file may embed.
const GYM_EPISODE_MAX_SOURCE_BYTES: usize = 64 * 1024 * 1024;

/// One recorded step of an episode file.
#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct GymRecordedStep {
    #[serde(default)]
    pub actions: Vec<SimAction>,
    pub ticks: usize,
}

/// A self-contained, replayable episode (`three-live-cli gym reset` / `gym step --session`).
///
/// It embeds the scene and every step taken so far, so each CLI call can rebuild the episode
/// deterministically without a long-running process, even if the scene file changes on disk.
#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct GymEpisodeFile {
    pub version: u32,
    /// The scene script text, or base64 for `.glb`.
    pub source: String,
    pub is_glb: bool,
    #[serde(default, skip_serializing_if = "Option::is_none")]
    pub source_path: Option<String>,
    /// Default `watch` list for observations.
    #[serde(default)]
    pub watch: Vec<String>,
    #[serde(default)]
    pub steps: Vec<GymRecordedStep>,
}

impl GymEpisodeFile {
    /// A new episode for `source` with no steps.
    pub fn new(
        source: &[u8],
        is_glb: bool,
        source_path: Option<String>,
        watch: Vec<String>,
    ) -> Result<Self, String> {
        let source = if is_glb {
            crate::mcp::encode_base64(source)
        } else {
            String::from_utf8(source.to_vec())
                .map_err(|_| "Scene source is not valid UTF-8.".to_string())?
        };
        Ok(GymEpisodeFile {
            version: GYM_EPISODE_VERSION,
            source,
            is_glb,
            source_path,
            watch,
            steps: Vec::new(),
        })
    }

    /// Parses an episode file, checking its version.
    pub fn from_json(text: &str) -> Result<Self, String> {
        let file: GymEpisodeFile =
            serde_json::from_str(text).map_err(|e| format!("Invalid gym session file: {}", e))?;
        if file.version != GYM_EPISODE_VERSION {
            return Err(format!(
                "Unsupported gym session file version {} (expected {}); run `gym reset` again.",
                file.version, GYM_EPISODE_VERSION
            ));
        }
        Ok(file)
    }

    /// The embedded scene bytes.
    pub fn source_bytes(&self) -> Result<Vec<u8>, String> {
        if self.is_glb {
            crate::render::decode_base64_str(&self.source, GYM_EPISODE_MAX_SOURCE_BYTES)
                .ok_or_else(|| "Gym session file has an invalid base64 GLB source.".to_string())
        } else {
            Ok(self.source.as_bytes().to_vec())
        }
    }

    /// Rebuilds the episode by replaying every recorded step. `opts` applies to the returned
    /// (latest) observation; replayed steps are not rendered.
    pub fn replay(&self, opts: &GymObserveOptions) -> Result<(GymSession, GymStepOutput), String> {
        let quiet = GymObserveOptions { watch: opts.watch.clone(), frame: None };
        let first = if self.steps.is_empty() { opts } else { &quiet };
        let (mut session, mut out) = GymSession::reset(&self.source_bytes()?, self.is_glb, first)?;
        for (i, step) in self.steps.iter().enumerate() {
            let o = if i + 1 == self.steps.len() { opts } else { &quiet };
            out = session
                .step(&step.actions, step.ticks, o)
                .map_err(|e| format!("Replaying recorded step {} failed: {}", i + 1, e))?;
        }
        Ok((session, out))
    }
}

#[cfg(test)]
mod tests {
    use super::*;
    use crate::sim::simulate_scenario_from_source;

    fn act(json: &str) -> SimAction {
        serde_json::from_str(json).unwrap()
    }

    const COLLECT: &str = r#"
        const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 20), new THREE.MeshStandardMaterial());
        floor.name = 'Floor'; floor.position.y = -0.05;
        floor.userData.xr = { collidable: true };
        scene.add(floor);
        const hero = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshStandardMaterial());
        hero.name = 'Hero'; hero.position.set(0, 0.5, 0);
        hero.userData.xr = { character: { speed: 3 } };
        scene.add(hero);
        const gem = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial());
        gem.name = 'Gem'; gem.position.set(3, 0.5, 0);
        gem.userData.xr = { objective: { kind: 'pickup', amount: 10, radius: 0.8, required: true } };
        scene.add(gem);
    "#;

    #[test]
    fn closed_loop_steps_match_one_shot_simulation() {
        let src = COLLECT.as_bytes().to_vec();
        let opts = GymObserveOptions::default();
        let (mut s, out0) = GymSession::reset(&src, false, &opts).unwrap();
        assert_eq!(out0.observation.tick, 0);
        let hero0 = out0.observation.bodies.iter().find(|b| b.name == "Hero").unwrap().position;
        assert!((hero0[0] - 0.0).abs() < 1e-6);

        let o1 =
            s.step(&[act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#)], 30, &opts).unwrap();
        let o2 = s.step(&[], 30, &opts).unwrap();
        let o3 =
            s.step(&[act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#)], 30, &opts).unwrap();
        assert_eq!(o3.observation.tick, 90);
        let x1 = o1.observation.bodies.iter().find(|b| b.name == "Hero").unwrap().position[0];
        assert!(x1 > 1.0, "hero moved +x during step 1: {}", x1);
        assert!(o2.observation.tick == 60);

        // The same timeline as a single one-shot simulation gives identical final state.
        let mut timeline = vec![act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#)];
        timeline[0].at = 0.5 * SIM_DT_SEC;
        timeline[0].duration = Some(0.5);
        let mut second = act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#);
        second.at = 60.5 * SIM_DT_SEC;
        second.duration = Some(0.5);
        timeline.push(second);
        let (report, _) =
            simulate_scenario_from_source(&src, false, 1.5, &timeline, &[0, 30, 60, 90]).unwrap();
        let one_shot = report.bodies.iter().find(|b| b.name == "Hero").unwrap().final_translation;
        let stepped = o3.observation.bodies.iter().find(|b| b.name == "Hero").unwrap().position;
        assert_eq!(one_shot.map(|v| round_to(v, 1e4)), stepped);
    }

    #[test]
    fn rewards_events_and_done_are_reported_per_step() {
        let opts = GymObserveOptions { watch: vec!["Hero".to_string()], frame: None };
        let (mut s, _) = GymSession::reset(COLLECT.as_bytes(), false, &opts).unwrap();
        let mut total = 0;
        let mut finished = None;
        for _ in 0..8 {
            let o = s
                .step(&[act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#)], 15, &opts)
                .unwrap()
                .observation;
            assert_eq!(o.bodies.len(), 1);
            total += o.reward;
            if o.done {
                finished = Some(o);
                break;
            }
        }
        let o = finished.expect("reaching the gem ends the episode");
        assert_eq!(o.scenario_state, "victory");
        assert_eq!(o.new_objectives, vec!["Gem".to_string()]);
        assert!(o.events.iter().any(|e| e == "objectiveComplete:Gem"), "{:?}", o.events);
        assert_eq!(o.score, 10);
        assert_eq!(total, o.score);
        assert!(s.step(&[], 1, &opts).unwrap_err().contains("ended"));
    }

    #[test]
    fn invalid_steps_are_rejected_without_advancing() {
        let opts = GymObserveOptions::default();
        let (mut s, _) = GymSession::reset(COLLECT.as_bytes(), false, &opts).unwrap();
        assert!(s.step(&[], 0, &opts).is_err());
        assert!(s.step(&[], GYM_MAX_TICKS_PER_STEP + 1, &opts).is_err());
        assert!(s
            .step(&[act(r#"{"type":"teleport"}"#)], 10, &opts)
            .unwrap_err()
            .contains("teleport"));
        assert_eq!(s.tick(), 0);
        let framed =
            GymObserveOptions { watch: vec![], frame: Some((RenderViewMode::Top, 128, 96)) };
        let out = s.step(&[], 10, &framed).unwrap();
        let png = out.frame_png.unwrap();
        assert_eq!(&png[1..4], b"PNG");
        assert_eq!(s.tick(), 10);
    }

    #[test]
    fn objectives_completed_out_of_declaration_order_are_reported_when_they_happen() {
        // `Far` is declared first but collected second.
        let src = r#"
            const floor = new THREE.Mesh(new THREE.BoxGeometry(20, 0.1, 20), new THREE.MeshStandardMaterial());
            floor.name = 'Floor'; floor.position.y = -0.05;
            floor.userData.xr = { collidable: true };
            scene.add(floor);
            const hero = new THREE.Mesh(new THREE.BoxGeometry(0.5, 1, 0.5), new THREE.MeshStandardMaterial());
            hero.name = 'Hero'; hero.position.set(0, 0.5, 0);
            hero.userData.xr = { character: { speed: 4 } };
            scene.add(hero);
            for (const [name, x] of [['Far', 3], ['Near', 1]]) {
                const c = new THREE.Mesh(new THREE.SphereGeometry(0.2), new THREE.MeshStandardMaterial());
                c.name = name; c.position.set(x, 0.5, 0);
                c.userData.xr = { objective: { kind: 'pickup', amount: 1, radius: 0.4 } };
                scene.add(c);
            }
        "#;
        let opts = GymObserveOptions { watch: vec!["Hero".to_string()], frame: None };
        let (mut s, _) = GymSession::reset(src.as_bytes(), false, &opts).unwrap();
        let mut order = Vec::new();
        for _ in 0..12 {
            let o = s
                .step(&[act(r#"{"type":"moveCharacter","direction":[1,0,0]}"#)], 10, &opts)
                .unwrap()
                .observation;
            order.extend(o.new_objectives);
        }
        assert_eq!(order, vec!["Near".to_string(), "Far".to_string()]);
    }

    #[test]
    fn delayed_actions_fire_inside_their_own_step() {
        let opts = GymObserveOptions::default();
        let (mut s, _) = GymSession::reset(COLLECT.as_bytes(), false, &opts).unwrap();
        // `at` beyond the step is clamped to the step's last tick, so the move still starts now
        // and never leaks into the next step.
        let o = s
            .step(
                &[act(r#"{"type":"moveCharacter","direction":[1,0,0],"at":5,"duration":1}"#)],
                10,
                &opts,
            )
            .unwrap()
            .observation;
        let x = o.bodies.iter().find(|b| b.name == "Hero").unwrap().position[0];
        assert!(x > 0.0, "the clamped move fired in its own step: {}", x);
    }

    #[test]
    fn procedural_animation_is_sampled_each_step() {
        let src = r#"
            const m = new THREE.Mesh(new THREE.BoxGeometry(0.5, 0.5, 0.5), new THREE.MeshStandardMaterial());
            m.name = 'Slider'; m.position.y = 0.25;
            scene.add(m);
            function animate(t) { m.position.x = t; }
        "#;
        let opts = GymObserveOptions::default();
        let (mut s, _) = GymSession::reset(src.as_bytes(), false, &opts).unwrap();
        assert!(s.sim.is_time_varying());
        for expected in [0.5f64, 1.0, 1.5] {
            let o = s.step(&[], 30, &opts).unwrap().observation;
            let x = o.bodies.iter().find(|b| b.name == "Slider").unwrap().position[0];
            assert!((x - expected).abs() < 0.02, "x = {} at {}", x, expected);
        }
        let (still, _) = GymSession::reset(COLLECT.as_bytes(), false, &opts).unwrap();
        assert!(!still.sim.is_time_varying());
    }

    #[test]
    fn episode_files_replay_to_the_same_observation() {
        let opts = GymObserveOptions { watch: vec!["Hero".to_string()], frame: None };
        let mut file = GymEpisodeFile::new(
            COLLECT.as_bytes(),
            false,
            Some("collect.js".into()),
            opts.watch.clone(),
        )
        .unwrap();
        let (mut live, _) = GymSession::reset(COLLECT.as_bytes(), false, &opts).unwrap();
        let mut last = None;
        for ticks in [10, 25, 7] {
            let actions = vec![act(r#"{"type":"moveCharacter","direction":[1,0,0],"at":0.05}"#)];
            last = Some(live.step(&actions, ticks, &opts).unwrap().observation);
            file.steps.push(GymRecordedStep { actions, ticks });
        }
        // Round-trip through JSON, as the CLI does between calls.
        let text = serde_json::to_string(&file).unwrap();
        let loaded = GymEpisodeFile::from_json(&text).unwrap();
        let (session, out) = loaded.replay(&opts).unwrap();
        let last = last.unwrap();
        assert_eq!(session.tick(), 42);
        assert_eq!(out.observation.bodies[0].position, last.bodies[0].position);
        assert_eq!(out.observation.score, last.score);
        assert_eq!(out.observation.step, 3);

        let mut bad = file.clone();
        bad.version = 99;
        assert!(GymEpisodeFile::from_json(&serde_json::to_string(&bad).unwrap())
            .unwrap_err()
            .contains("version"));
        assert!(GymEpisodeFile::from_json("{").is_err());
        let glb = GymEpisodeFile::new(b"glTF\x02\x00\x00\x00", true, None, vec![]).unwrap();
        assert_eq!(glb.source_bytes().unwrap(), b"glTF\x02\x00\x00\x00");
    }
}
