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

//! Realtime voice protocols for Tap & Speak on Android and iOS (roadmap B2b-2/3).
//!
//! Mirrors `realtimeAdapter` / `geminiLiveAdapter` in `three-live/src/plugins/ai-voice.ts`:
//! - `ai-realtime`: the provider-neutral Realtime WebSocket event protocol (GA session shape;
//!   GA and older server event names).
//! - `gemini-live`: the Gemini Live API `BidiGenerateContent` protocol.
//!
//! Native code owns the WebSocket, microphone, and speaker; it asks this module (through
//! [`crate::ai_edit::ai_call`]) to build client messages and to normalize server messages into
//! `audio` / `transcript` / `toolCall` / `interrupted` / `turnComplete` / `error` events.

use serde_json::{json, Map, Value};

/// Voice-model instructions shared by all platforms (keep in sync with `ai-voice.ts`).
pub const VOICE_INSTRUCTIONS: &str = "You are a voice assistant inside a live 3D scene editor. Keep spoken replies short: one sentence. To change the scene, call edit_scene with the request; never describe code. After a tool result, say briefly what changed, or why it could not be done.";

/// Tools exposed to the voice model (keep in sync with `VOICE_TOOLS` in `ai-voice.ts`).
pub fn voice_tools() -> Value {
    json!([
        {
            "name": "edit_scene",
            "description": "Change the 3D scene the user is looking at. Call this whenever the user asks to add, remove, move, resize, recolor, or otherwise modify anything. Pass their request as a clear, self-contained instruction. If they selected a mesh, \"this\" or \"it\" refers to that mesh; the tool knows which one.",
            "parameters": {
                "type": "object",
                "properties": {
                    "instruction": {
                        "type": "string",
                        "description": "The requested change, e.g. \"make the roof red\"."
                    }
                },
                "required": ["instruction"]
            }
        },
        {
            "name": "undo_edit",
            "description": "Undo the last scene change.",
            "parameters": {"type": "object", "properties": {}}
        }
    ])
}

/// Deep-merges plain-object `overrides` into `base` (arrays and scalars replace).
pub fn merge_session(base: &Value, overrides: Option<&Value>) -> Value {
    let mut out = base.clone();
    let (Some(Value::Object(over)), Value::Object(target)) = (overrides, &mut out) else {
        return out;
    };
    for (k, v) in over {
        if k == "__proto__" || k == "constructor" || k == "prototype" {
            continue;
        }
        let merged = match (target.get(k), v) {
            (Some(prev @ Value::Object(_)), Value::Object(_)) => merge_session(prev, Some(v)),
            _ => v.clone(),
        };
        target.insert(k.clone(), merged);
    }
    out
}

fn s(v: Option<&Value>) -> &str {
    v.and_then(Value::as_str).unwrap_or("")
}

fn parse_args(raw: Option<&Value>) -> Value {
    match raw {
        Some(Value::Object(m)) => Value::Object(m.clone()),
        Some(Value::String(text)) => match serde_json::from_str::<Value>(text) {
            Ok(Value::Object(m)) => Value::Object(m),
            _ => Value::Object(Map::new()),
        },
        _ => Value::Object(Map::new()),
    }
}

/// Microphone sample rate for `provider`.
pub fn input_rate(provider: &str) -> u32 {
    if provider == "gemini-live" {
        16_000
    } else {
        24_000
    }
}

fn instructions_with(extra: &str) -> String {
    if extra.trim().is_empty() {
        VOICE_INSTRUCTIONS.to_string()
    } else {
        format!("{}\n{}", VOICE_INSTRUCTIONS, extra)
    }
}

/// Setup / session messages sent right after connecting.
pub fn setup(
    provider: &str,
    instructions: &str,
    model: Option<&str>,
    voice: Option<&str>,
    overrides: Option<&Value>,
) -> Value {
    let instructions = instructions_with(instructions);
    let tools = voice_tools();
    let model = model.filter(|m| !m.is_empty());
    let voice = voice.filter(|v| !v.is_empty());
    if provider == "gemini-live" {
        let mut generation = json!({"responseModalities": ["AUDIO"]});
        if let Some(v) = voice {
            generation["speechConfig"] =
                json!({"voiceConfig": {"prebuiltVoiceConfig": {"voiceName": v}}});
        }
        let mut base = json!({
            "generationConfig": generation,
            "systemInstruction": {"parts": [{"text": instructions}]},
            "tools": [{"functionDeclarations": tools}],
            "inputAudioTranscription": {},
            "outputAudioTranscription": {},
        });
        if let Some(m) = model {
            base["model"] = json!(m);
        }
        return json!([{"setup": merge_session(&base, overrides)}]);
    }
    let mut output = json!({"format": {"type": "audio/pcm", "rate": 24000}});
    if let Some(v) = voice {
        output["voice"] = json!(v);
    }
    let realtime_tools: Vec<Value> = tools
        .as_array()
        .map(|a| {
            a.iter()
                .map(|t| {
                    let mut t = t.clone();
                    t["type"] = json!("function");
                    t
                })
                .collect()
        })
        .unwrap_or_default();
    let mut base = json!({
        "type": "realtime",
        "instructions": instructions,
        "audio": {
            "input": {
                "format": {"type": "audio/pcm", "rate": 24000},
                "turn_detection": {"type": "server_vad"}
            },
            "output": output
        },
        "tools": realtime_tools,
        "tool_choice": "auto",
    });
    if let Some(m) = model {
        base["model"] = json!(m);
    }
    json!([{"type": "session.update", "session": merge_session(&base, overrides)}])
}

/// One microphone chunk (base64 16-bit little-endian PCM at [`input_rate`]).
pub fn audio(provider: &str, pcm16_base64: &str) -> Value {
    if provider == "gemini-live" {
        json!({"realtimeInput": {"audio": {"mimeType": "audio/pcm;rate=16000", "data": pcm16_base64}}})
    } else {
        json!({"type": "input_audio_buffer.append", "audio": pcm16_base64})
    }
}

/// A text turn: `respond` asks for a reply (user message); otherwise it is context only.
pub fn text(provider: &str, text: &str, respond: bool) -> Value {
    if provider == "gemini-live" {
        return json!([{"clientContent": {"turns": [{"role": "user", "parts": [{"text": text}]}], "turnComplete": respond}}]);
    }
    let role = if respond { "user" } else { "system" };
    let mut out = vec![json!({
        "type": "conversation.item.create",
        "item": {"type": "message", "role": role, "content": [{"type": "input_text", "text": text}]}
    })];
    if respond {
        out.push(json!({"type": "response.create"}));
    }
    Value::Array(out)
}

/// Answers a tool call.
pub fn tool_result(provider: &str, id: &str, name: &str, output: &Value) -> Value {
    if provider == "gemini-live" {
        return json!([{"toolResponse": {"functionResponses": [{"id": id, "name": name, "response": output}]}}]);
    }
    json!([
        {"type": "conversation.item.create", "item": {"type": "function_call_output", "call_id": id, "output": output.to_string()}},
        {"type": "response.create"}
    ])
}

fn transcript(speaker: &str, text: &str, is_final: bool) -> Value {
    json!({"type": "transcript", "speaker": speaker, "text": text, "isFinal": is_final})
}

/// Normalizes one server message into events.
pub fn parse(provider: &str, m: &Value) -> Value {
    let mut out: Vec<Value> = Vec::new();
    if provider == "gemini-live" {
        let content = m.get("serverContent").cloned().unwrap_or(Value::Null);
        if content.get("interrupted").and_then(Value::as_bool).unwrap_or(false) {
            out.push(json!({"type": "interrupted"}));
        }
        let input = s(content.get("inputTranscription").and_then(|t| t.get("text")));
        if !input.is_empty() {
            out.push(transcript("user", input, false));
        }
        let output = s(content.get("outputTranscription").and_then(|t| t.get("text")));
        if !output.is_empty() {
            out.push(transcript("model", output, false));
        }
        let parts = content
            .get("modelTurn")
            .and_then(|t| t.get("parts"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for part in parts {
            let inline = part.get("inlineData").cloned().unwrap_or(Value::Null);
            let mime = s(inline.get("mimeType"));
            let data = s(inline.get("data"));
            if mime.starts_with("audio/pcm") && !data.is_empty() {
                let rate = mime
                    .split("rate=")
                    .nth(1)
                    .and_then(|r| r.split(|c: char| !c.is_ascii_digit()).next())
                    .and_then(|r| r.parse::<u32>().ok())
                    .unwrap_or(24_000);
                out.push(json!({"type": "audio", "base64": data, "rate": rate}));
            }
        }
        if content.get("turnComplete").and_then(Value::as_bool).unwrap_or(false) {
            out.push(json!({"type": "turnComplete"}));
        }
        let calls = m
            .get("toolCall")
            .and_then(|t| t.get("functionCalls"))
            .and_then(Value::as_array)
            .cloned()
            .unwrap_or_default();
        for c in calls {
            out.push(json!({
                "type": "toolCall",
                "id": s(c.get("id")),
                "name": s(c.get("name")),
                "args": parse_args(c.get("args")),
            }));
        }
        let err = s(m.get("error").and_then(|e| e.get("message")));
        if !err.is_empty() {
            out.push(json!({"type": "error", "message": err}));
        }
        return Value::Array(out);
    }
    match s(m.get("type")) {
        "response.output_audio.delta" | "response.audio.delta" => {
            let delta = s(m.get("delta"));
            if !delta.is_empty() {
                out.push(json!({"type": "audio", "base64": delta, "rate": 24000}));
            }
        }
        "response.output_audio_transcript.delta" | "response.audio_transcript.delta" => {
            out.push(transcript("model", s(m.get("delta")), false));
        }
        "response.output_audio_transcript.done" | "response.audio_transcript.done" => {
            out.push(transcript("model", s(m.get("transcript")), true));
        }
        "conversation.item.input_audio_transcription.delta" => {
            out.push(transcript("user", s(m.get("delta")), false));
        }
        "conversation.item.input_audio_transcription.completed" => {
            out.push(transcript("user", s(m.get("transcript")), true));
        }
        "response.function_call_arguments.done" => {
            let id = match s(m.get("call_id")) {
                "" => s(m.get("item_id")),
                id => id,
            };
            out.push(json!({
                "type": "toolCall",
                "id": id,
                "name": s(m.get("name")),
                "args": parse_args(m.get("arguments")),
            }));
        }
        "input_audio_buffer.speech_started" => out.push(json!({"type": "interrupted"})),
        "response.done" => out.push(json!({"type": "turnComplete"})),
        "error" => {
            let msg = match s(m.get("error").and_then(|e| e.get("message"))) {
                "" => "Realtime server error",
                msg => msg,
            };
            out.push(json!({"type": "error", "message": msg}));
        }
        _ => {}
    }
    Value::Array(out)
}

/// Handles the `voice_*` ops of [`crate::ai_edit::ai_call`].
pub fn voice_call(op: &str, req: &Value) -> Value {
    let provider = s(req.get("provider"));
    let provider = if provider.is_empty() { "ai-realtime" } else { provider };
    if provider != "ai-realtime" && provider != "gemini-live" {
        return json!({"error": format!("unknown voice provider '{}' (use ai-realtime or gemini-live)", provider)});
    }
    match op {
        "voice_setup" => json!({
            "messages": setup(
                provider,
                s(req.get("instructions")),
                req.get("model").and_then(Value::as_str),
                req.get("voice").and_then(Value::as_str),
                req.get("session"),
            ),
            "inputRate": input_rate(provider),
        }),
        "voice_audio" => json!({"message": audio(provider, s(req.get("audio")))}),
        "voice_text" => json!({
            "messages": text(
                provider,
                s(req.get("text")),
                req.get("respond").and_then(Value::as_bool).unwrap_or(true),
            )
        }),
        "voice_tool_result" => json!({
            "messages": tool_result(
                provider,
                s(req.get("id")),
                s(req.get("name")),
                req.get("output").unwrap_or(&Value::Null),
            )
        }),
        "voice_parse" => {
            json!({"events": parse(provider, req.get("message").unwrap_or(&Value::Null))})
        }
        "voice_tools" => json!({"tools": voice_tools(), "instructions": VOICE_INSTRUCTIONS}),
        _ => json!({"error": format!("unknown op '{}'", op)}),
    }
}

#[cfg(test)]
mod tests {
    use super::*;

    #[test]
    fn instructions_and_tools_match_the_web_plugin() {
        let ts = include_str!("../../three-live/src/plugins/ai-voice.ts");
        for sentence in VOICE_INSTRUCTIONS.split(". ") {
            let sentence = sentence.trim_end_matches('.');
            assert!(ts.contains(sentence), "ai-voice.ts is missing: {}", sentence);
        }
        for t in voice_tools().as_array().unwrap() {
            let d = t["description"].as_str().unwrap();
            assert!(
                ts.contains(&d[..d.len().min(60)]),
                "ai-voice.ts tool description drifted: {}",
                d
            );
            assert!(ts.contains(&format!("name: '{}'", t["name"].as_str().unwrap())));
        }
    }

    #[test]
    fn realtime_setup_is_ga_shaped_and_vendor_neutral() {
        let over = json!({"tool_choice": "required", "audio": {"input": {"transcription": {"model": "stt-1"}}}});
        let msgs =
            setup("ai-realtime", "Use metric units.", Some("m1"), Some("marin"), Some(&over));
        let session = &msgs[0]["session"];
        assert_eq!(msgs[0]["type"], "session.update");
        assert_eq!(session["type"], "realtime");
        assert_eq!(session["audio"]["input"]["format"]["rate"], 24000);
        assert_eq!(session["audio"]["input"]["turn_detection"]["type"], "server_vad");
        assert_eq!(session["audio"]["input"]["transcription"]["model"], "stt-1");
        assert_eq!(session["audio"]["output"]["voice"], "marin");
        assert_eq!(session["tools"][0]["type"], "function");
        assert_eq!(session["tools"][1]["name"], "undo_edit");
        assert_eq!(session["tool_choice"], "required");
        assert!(session["instructions"].as_str().unwrap().ends_with("\nUse metric units."));
        let plain = setup("ai-realtime", "", None, None, None);
        assert!(!plain.to_string().contains("whisper"));
        assert!(plain[0]["session"]["audio"]["input"].get("transcription").is_none());
    }

    #[test]
    fn realtime_parse_accepts_ga_and_older_names() {
        for t in ["response.output_audio.delta", "response.audio.delta"] {
            let ev = parse("ai-realtime", &json!({"type": t, "delta": "AAA="}));
            assert_eq!(ev[0]["type"], "audio");
            assert_eq!(ev[0]["rate"], 24000);
        }
        let call = parse(
            "ai-realtime",
            &json!({"type": "response.function_call_arguments.done", "call_id": "c1", "name": "edit_scene", "arguments": "{\"instruction\":\"red\"}"}),
        );
        assert_eq!(call[0]["id"], "c1");
        assert_eq!(call[0]["args"]["instruction"], "red");
        let bad = parse(
            "ai-realtime",
            &json!({"type": "response.function_call_arguments.done", "item_id": "i2", "name": "edit_scene", "arguments": "{nope"}),
        );
        assert_eq!(bad[0]["id"], "i2");
        assert_eq!(bad[0]["args"], json!({}));
        assert_eq!(
            parse("ai-realtime", &json!({"type": "input_audio_buffer.speech_started"}))[0]["type"],
            "interrupted"
        );
        assert_eq!(
            parse("ai-realtime", &json!({"type": "error", "error": {"message": "bad"}}))[0]
                ["message"],
            "bad"
        );
        assert_eq!(
            parse("ai-realtime", &json!({"type": "error"}))[0]["message"],
            "Realtime server error"
        );
        assert_eq!(parse("ai-realtime", &json!({"type": "session.created"})), json!([]));
        let user = parse(
            "ai-realtime",
            &json!({"type": "conversation.item.input_audio_transcription.completed", "transcript": "hi"}),
        );
        assert_eq!(
            user[0],
            json!({"type": "transcript", "speaker": "user", "text": "hi", "isFinal": true})
        );
    }

    #[test]
    fn realtime_messages() {
        assert_eq!(
            audio("ai-realtime", "QQ=="),
            json!({"type": "input_audio_buffer.append", "audio": "QQ=="})
        );
        let ctx = text("ai-realtime", "selected Roof", false);
        assert_eq!(ctx.as_array().unwrap().len(), 1);
        assert_eq!(ctx[0]["item"]["role"], "system");
        let user = text("ai-realtime", "make it red", true);
        assert_eq!(user[1]["type"], "response.create");
        let res = tool_result("ai-realtime", "c1", "edit_scene", &json!({"applied": true}));
        assert_eq!(res[0]["item"]["call_id"], "c1");
        assert_eq!(res[0]["item"]["output"], "{\"applied\":true}");
        assert_eq!(res[1]["type"], "response.create");
    }

    #[test]
    fn gemini_live_protocol() {
        let msgs = setup("gemini-live", "", Some("models/live"), Some("Kore"), None);
        let setup = &msgs[0]["setup"];
        assert_eq!(setup["model"], "models/live");
        assert_eq!(setup["tools"][0]["functionDeclarations"][0]["name"], "edit_scene");
        assert_eq!(
            setup["generationConfig"]["speechConfig"]["voiceConfig"]["prebuiltVoiceConfig"]
                ["voiceName"],
            "Kore"
        );
        assert_eq!(input_rate("gemini-live"), 16_000);
        let ev = parse(
            "gemini-live",
            &json!({
                "serverContent": {
                    "modelTurn": {"parts": [{"inlineData": {"mimeType": "audio/pcm;rate=24000", "data": "AAA="}}]},
                    "outputTranscription": {"text": "Sure"},
                    "inputTranscription": {"text": "make it red"},
                    "turnComplete": true
                },
                "toolCall": {"functionCalls": [{"id": "f1", "name": "edit_scene", "args": {"instruction": "red"}}]}
            }),
        );
        let kinds: Vec<&str> =
            ev.as_array().unwrap().iter().map(|e| e["type"].as_str().unwrap()).collect();
        assert_eq!(kinds, ["transcript", "transcript", "audio", "turnComplete", "toolCall"]);
        assert_eq!(ev[4]["args"]["instruction"], "red");
        assert_eq!(
            parse("gemini-live", &json!({"serverContent": {"interrupted": true}}))[0]["type"],
            "interrupted"
        );
        let res = tool_result(
            "gemini-live",
            "f1",
            "edit_scene",
            &json!({"applied": false, "error": "x"}),
        );
        assert_eq!(res[0]["toolResponse"]["functionResponses"][0]["response"]["error"], "x");
        assert_eq!(
            audio("gemini-live", "QQ==")["realtimeInput"]["audio"]["mimeType"],
            "audio/pcm;rate=16000"
        );
        assert_eq!(text("gemini-live", "hi", false)[0]["clientContent"]["turnComplete"], false);
    }

    #[test]
    fn merge_session_is_deep_and_safe() {
        let merged = merge_session(
            &json!({"a": {"b": 1, "c": [1]}}),
            Some(&json!({"a": {"c": [2], "d": 3}, "__proto__": {"x": 1}})),
        );
        assert_eq!(merged, json!({"a": {"b": 1, "c": [2], "d": 3}}));
    }

    #[test]
    fn voice_call_ops() {
        let r = voice_call("voice_setup", &json!({"provider": "gemini-live"}));
        assert_eq!(r["inputRate"], 16000);
        assert!(r["messages"][0].get("setup").is_some());
        let r = voice_call("voice_parse", &json!({"message": {"type": "response.done"}}));
        assert_eq!(r["events"][0]["type"], "turnComplete");
        assert!(voice_call("voice_setup", &json!({"provider": "pigeon"}))["error"]
            .as_str()
            .unwrap()
            .contains("unknown voice provider"));
        let r = voice_call(
            "voice_tool_result",
            &json!({"id": "c", "name": "undo_edit", "output": {"undone": true}}),
        );
        assert_eq!(r["messages"][0]["item"]["output"], "{\"undone\":true}");
    }
}
