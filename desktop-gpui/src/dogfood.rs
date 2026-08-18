//! Dogfood suite: the client is exercised the way a user would hit it —
//! pure helpers, the real HTTP/SSE client against a canned local server, and
//! AppState + the rendered composer driven through gpui's input simulation.

use std::collections::HashMap;
use std::io::{BufRead, BufReader, Read, Write};
use std::net::{SocketAddr, TcpListener, TcpStream};
use std::sync::{Arc, Mutex};
use std::thread::JoinHandle;

use gpui::*;

use crate::api::{self, Client, HostEvent, TranscriptEntry};
use crate::state::{
    format_tokens, next_reasoning_level, usage_totals, AppState, REASONING_LEVELS,
};

// ---------------------------------------------------------------------------
// Canned local HTTP server (no deps): routes by (method, path-prefix),
// records every request body, serves canned JSON or SSE.
// ---------------------------------------------------------------------------

struct CannedServer {
    addr: SocketAddr,
    requests: Arc<Mutex<Vec<(String, String, String)>>>, // (method, path, body)
    stop: Arc<std::sync::atomic::AtomicBool>,
    handle: Option<JoinHandle<()>>,
}

impl Drop for CannedServer {
    fn drop(&mut self) {
        // Unblock the accept loop so the server thread exits and the test
        // binary can terminate (a leaked listener blocks process exit).
        self.stop.store(true, std::sync::atomic::Ordering::SeqCst);
        if let Some(handle) = self.handle.take() {
            let _ = handle.join();
        }
    }
}

fn serve(stream: &mut TcpStream, method: &str, path: &str, routes: &HashMap<String, String>) {
    let mut best: Option<(&str, &String)> = None;
    for (key, value) in routes.iter() {
        let (m, prefix) = key.split_once(' ').unwrap_or(("", key));
        if m == method && path.starts_with(prefix) {
            if best.map(|(p, _)| p.len()).unwrap_or(0) < prefix.len() {
                best = Some((prefix, value));
            }
        }
    }

    let is_sse = path.contains("/events");
    let response = match best {
        Some((_prefix, body)) => {
            let content_type = if is_sse {
                "text/event-stream"
            } else {
                "application/json"
            };
            format!(
                "HTTP/1.1 200 OK\r\ncontent-type: {content_type}\r\ncontent-length: {}\r\nconnection: close\r\n\r\n{body}",
                body.len()
            )
        }
        None => {
            format!("HTTP/1.1 404 Not Found\r\ncontent-length: 0\r\nconnection: close\r\n\r\n")
        }
    };
    let _ = stream.write_all(response.as_bytes());
}

fn handle_connection(
    stream: &mut TcpStream,
    routes: &HashMap<String, String>,
    record: &Mutex<Vec<(String, String, String)>>,
) {
    let mut reader = BufReader::new(stream.try_clone().unwrap());
    let mut request_line = String::new();
    let _ = reader.read_line(&mut request_line);
    let mut parts = request_line.split_whitespace();
    let method = parts.next().unwrap_or("").to_string();
    let path = parts.next().unwrap_or("").to_string();
    let mut content_length = 0usize;
    loop {
        let mut line = String::new();
        if reader.read_line(&mut line).unwrap_or(0) == 0 {
            break;
        }
        let line = line.trim_end();
        if line.is_empty() {
            break;
        }
        if let Some(v) = line.to_ascii_lowercase().strip_prefix("content-length:") {
            content_length = v.trim().parse().unwrap_or(0);
        }
    }
    let mut body = vec![0u8; content_length];
    if content_length > 0 {
        let _ = reader.read_exact(&mut body);
    }
    record
        .lock()
        .unwrap()
        .push((method.clone(), path.clone(), String::from_utf8_lossy(&body).to_string()));
    serve(stream, &method, &path, routes);
}

impl CannedServer {
    fn new(routes: HashMap<String, String>) -> Self {
        let listener = TcpListener::bind("127.0.0.1:0").unwrap();
        listener.set_nonblocking(true).unwrap();
        let addr = listener.local_addr().unwrap();
        let requests: Arc<Mutex<Vec<(String, String, String)>>> = Arc::new(Mutex::new(Vec::new()));
        let record = requests.clone();
        let stop = Arc::new(std::sync::atomic::AtomicBool::new(false));
        let stop_flag = stop.clone();
        let handle = std::thread::spawn(move || loop {
            if stop_flag.load(std::sync::atomic::Ordering::SeqCst) {
                break;
            }
            match listener.accept() {
                Ok((mut stream, _)) => {
                    stream.set_nonblocking(false).unwrap();
                    handle_connection(&mut stream, &routes, &record);
                }
                Err(err) if err.kind() == std::io::ErrorKind::WouldBlock => {
                    std::thread::sleep(std::time::Duration::from_millis(10));
                }
                Err(_) => break,
            }
        });
        Self {
            addr,
            requests,
            stop,
            handle: Some(handle),
        }
    }

    fn base(&self) -> String {
        format!("http://{}", self.addr)
    }
}

fn session_meta(model: &str, reasoning: Option<&str>) -> String {
    format!(
        r#"{{"id":"test-session-1","title":"t","role":"root","depth":0,"model":"{model}","status":"idle","createdAt":"2026-08-18T00:00:00Z","updatedAt":"2026-08-18T00:00:00Z","childIds":[],"autoContinue":false{} }}"#,
        reasoning.map(|r| format!(r#","reasoningEffort":"{r}""#)).unwrap_or_default()
    )
}

fn routes_with_settings_echo() -> HashMap<String, String> {
    let mut routes = HashMap::new();
    routes.insert(
        "GET /api/sessions".to_string(),
        format!(r#"{{"sessions":[{}]}}"#, session_meta("a", None)),
    );
    routes.insert(
        "GET /api/models".to_string(),
        r#"{"models":["deepseek-v4-flash","deepseek-v4-pro"],"default":"deepseek-v4-pro"}"#.to_string(),
    );
    routes.insert(
        "POST /api/sessions/".to_string(),
        format!(r#"{{"meta":{}}}"#, session_meta("a", None)),
    );
    routes.insert(
        "GET /api/sessions/test-session-1".to_string(),
        format!(
            r#"{{"meta":{},"transcript":[],"children":[]}}"#,
            session_meta("a", None)
        ),
    );
    routes
}

// ---------------------------------------------------------------------------
// Pure helpers
// ---------------------------------------------------------------------------

#[core::prelude::v1::test]
fn usage_totals_splits_session_and_last_turn_with_cache_rate() {
    let u1 = api::UsageInfo {
        prompt_tokens: Some(100.0),
        completion_tokens: Some(40.0),
        cache_hit_tokens: Some(80.0),
        cache_miss_tokens: Some(20.0),
    };
    let u2 = api::UsageInfo {
        prompt_tokens: Some(30.0),
        completion_tokens: Some(12.0),
        cache_hit_tokens: None,
        cache_miss_tokens: None,
    };
    let entries = vec![
        TranscriptEntry::Message {
            role: "user".into(),
            content: Some("first".into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            usage: None,
        },
        TranscriptEntry::Message {
            role: "assistant".into(),
            content: None,
            name: None,
            tool_calls: None,
            tool_call_id: None,
            usage: Some(u1),
        },
        TranscriptEntry::Message {
            role: "user".into(),
            content: Some("second".into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            usage: None,
        },
        TranscriptEntry::Message {
            role: "assistant".into(),
            content: None,
            name: None,
            tool_calls: None,
            tool_call_id: None,
            usage: Some(u2),
        },
    ];
    let (session, turn) = usage_totals(&entries);
    assert_eq!(session.input, 130.0);
    assert_eq!(session.output, 52.0);
    assert_eq!(session.cache_hit, 80.0);
    assert_eq!(session.cache_miss, 20.0);
    assert_eq!(session.cache_rate(), Some(0.8));
    assert_eq!(turn.input, 30.0);
    assert_eq!(turn.cache_rate(), None);
}

#[core::prelude::v1::test]
fn format_tokens_compacts() {
    assert_eq!(format_tokens(0.0), "0");
    assert_eq!(format_tokens(987.0), "987");
    assert_eq!(format_tokens(1234.0), "1.2k");
    assert_eq!(format_tokens(1_234_000.0), "1.2M");
}

#[core::prelude::v1::test]
fn reasoning_cycle_matches_deepseek_v4_levels() {
    // auto -> low -> high -> max -> auto, and unknown levels reset to auto.
    assert_eq!(next_reasoning_level("auto"), "low");
    assert_eq!(next_reasoning_level("low"), "high");
    assert_eq!(next_reasoning_level("high"), "max");
    assert_eq!(next_reasoning_level("max"), "auto");
    assert_eq!(next_reasoning_level("bogus"), "low");
    assert_eq!(REASONING_LEVELS, &["auto", "low", "high", "max"]);
}

// ---------------------------------------------------------------------------
// Real HTTP/SSE client against the canned server
// ---------------------------------------------------------------------------

#[core::prelude::v1::test]
fn client_parses_sessions_and_models() {
    let server = CannedServer::new(routes_with_settings_echo());
    let client = Client::new(server.base());

    let sessions = client.get_sessions().unwrap();
    assert_eq!(sessions.len(), 1);
    assert_eq!(sessions[0].model, "a");

    let models = client.get_models().unwrap();
    assert_eq!(models.models, vec!["deepseek-v4-flash", "deepseek-v4-pro"]);
    assert_eq!(models.default, "deepseek-v4-pro");
}

#[core::prelude::v1::test]
fn client_update_settings_sends_max_and_parses_meta() {
    let server = CannedServer::new(routes_with_settings_echo());
    let client = Client::new(server.base());
    let meta = client
        .update_settings("test-session-1", Some("deepseek-v4-pro"), Some("max"))
        .unwrap();
    assert_eq!(meta.model, "a"); // canned echo
    let reqs = server.requests.lock().unwrap();
    let settings = reqs
        .iter()
        .find(|(m, p, _)| m == "POST" && p.ends_with("/settings"))
        .expect("settings request was made");
    let body: serde_json::Value = serde_json::from_str(&settings.2).unwrap();
    assert_eq!(body["model"], "deepseek-v4-pro");
    assert_eq!(body["reasoningEffort"], "max");
}

#[core::prelude::v1::test]
fn client_streams_sse_events() {
    let mut routes = HashMap::new();
    routes.insert(
        "GET /api/sessions/test-session-1/events".to_string(),
        [
            "data: {\"type\":\"turn_start\",\"sessionId\":\"test-session-1\",\"turnId\":\"t1\"}",
            "data: {\"type\":\"message_delta\",\"sessionId\":\"test-session-1\",\"turnId\":\"t1\",\"delta\":\"Hel\"}",
            "data: {\"type\":\"message_delta\",\"sessionId\":\"test-session-1\",\"turnId\":\"t1\",\"delta\":\"lo\"}",
            ": keep-alive comment",
            "data: {\"type\":\"message_complete\",\"sessionId\":\"test-session-1\",\"message\":{\"kind\":\"message\",\"role\":\"assistant\",\"content\":\"Hello\"}}",
            "data: {\"type\":\"turn_end\",\"sessionId\":\"test-session-1\",\"turnId\":\"t1\",\"summary\":\"Hello\"}",
        ]
        .join("\n\n"),
    );
    let server = CannedServer::new(routes);
    let client = Client::new(server.base());
    let events = Arc::new(Mutex::new(Vec::<String>::new()));
    let sink = events.clone();
    client
        .stream_events("test-session-1", move |event| {
            sink.lock().unwrap().push(match event {
                HostEvent::TurnStart { .. } => "turn_start".into(),
                HostEvent::MessageDelta { delta, .. } => format!("delta:{delta}"),
                HostEvent::MessageComplete { .. } => "complete".into(),
                HostEvent::TurnEnd { .. } => "turn_end".into(),
                other => format!("other:{:?}", std::mem::discriminant(&other)),
            });
        })
        .unwrap();
    let events = events.lock().unwrap();
    assert_eq!(
        *events,
        vec!["turn_start", "delta:Hel", "delta:lo", "complete", "turn_end"]
    );
}

#[core::prelude::v1::test]
fn client_send_message_posts_body() {
    let mut routes = routes_with_settings_echo();
    routes.insert(
        "POST /api/sessions/test-session-1/messages".to_string(),
        r#"{"accepted":true,"sessionId":"test-session-1"}"#.to_string(),
    );
    let server = CannedServer::new(routes);
    let client = Client::new(server.base());
    client.send_message("test-session-1", "hello gpui").unwrap();
    let reqs = server.requests.lock().unwrap();
    let post = reqs
        .iter()
        .find(|(m, p, _)| m == "POST" && p.ends_with("/messages"))
        .expect("message POST");
    let body: serde_json::Value = serde_json::from_str(&post.2).unwrap();
    assert_eq!(body["content"], "hello gpui");
}

// ---------------------------------------------------------------------------
// AppState + rendered composer through gpui's input simulation
// ---------------------------------------------------------------------------

#[core::prelude::v1::test]
fn app_state_loads_sessions_from_host() {
    let mut cx = TestAppContext::single();
    let server = CannedServer::new(routes_with_settings_echo());
    let client = Client::new(server.base());
    cx.executor().allow_parking();
    let state = cx.new(|cx| {
        let state = AppState::new(client, cx);
        state.init(cx);
        state
    });

    // Poll until the background HTTP round-trips land on the UI thread.
    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        let loaded = cx.read(|app| state.read(app).sessions.len() == 1);
        if loaded || std::time::Instant::now() > deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let loaded = cx.read(|app| {
        let state = state.read(app);
        (state.sessions.len(), state.models.clone())
    });
    assert_eq!(loaded.0, 1);
    assert_eq!(loaded.1, vec!["deepseek-v4-flash", "deepseek-v4-pro"]);
}

#[core::prelude::v1::test]
fn handle_event_streams_a_full_turn() {
    let mut cx = TestAppContext::single();
    let state = cx.new(|cx| AppState::new(Client::new("http://127.0.0.1:1"), cx));
    cx.update(|app| {
        state.update(app, |state, cx| {
            state.detail = Some(api::SessionDetail {
                meta: serde_json::from_str(&session_meta("a", None)).unwrap(),
                transcript: Vec::new(),
                children: Vec::new(),
            });
            state.selected_id = Some("test-session-1".into());
            cx.notify();
        })
    });

    let mut apply = |event: HostEvent| {
        cx.update(|app| {
            state.update(app, |state, cx| state.handle_event(event, cx));
        });
    };
    apply(HostEvent::TurnStart {
        session_id: "test-session-1".into(),
        turn_id: "t1".into(),
    });
    apply(HostEvent::MessageDelta {
        session_id: "test-session-1".into(),
        turn_id: "t1".into(),
        delta: "Hel".into(),
    });
    apply(HostEvent::MessageDelta {
        session_id: "test-session-1".into(),
        turn_id: "t1".into(),
        delta: "lo".into(),
    });
    apply(HostEvent::MessageComplete {
        session_id: "test-session-1".into(),
        message: TranscriptEntry::Message {
            role: "assistant".into(),
            content: Some("Hello".into()),
            name: None,
            tool_calls: None,
            tool_call_id: None,
            usage: Some(api::UsageInfo {
                prompt_tokens: Some(10.0),
                completion_tokens: Some(3.0),
                cache_hit_tokens: None,
                cache_miss_tokens: None,
            }),
        },
    });
    apply(HostEvent::TurnEnd {
        session_id: "test-session-1".into(),
        turn_id: "t1".into(),
        summary: "Hello".into(),
    });

    cx.read(|app| {
        let state = state.read(app);
        let detail = state.detail.as_ref().unwrap();
        assert_eq!(detail.transcript.len(), 1);
        assert_eq!(detail.meta.status, "idle");
        assert_eq!(state.draft, "");
        assert!(!state.streaming);
        let (session, turn) = usage_totals(&detail.transcript);
        assert_eq!(turn.input, 10.0);
        assert_eq!(session.output, 3.0);
    });
}

#[core::prelude::v1::test]
fn typing_and_enter_in_composer_sends_message() {
    let mut cx = TestAppContext::single();
    let mut routes = routes_with_settings_echo();
    routes.insert(
        "POST /api/sessions/test-session-1/messages".to_string(),
        r#"{"accepted":true,"sessionId":"test-session-1"}"#.to_string(),
    );
    let server = CannedServer::new(routes);
    let client = Client::new(server.base());
    cx.executor().allow_parking();

    let (state, window_cx) = cx.add_window_view(|_window, cx| {
        let state = AppState::new(client, cx);
        state.init(cx);
        state
    });
    // Load the canned detail so the composer knows its session/model.
    window_cx.update(|_window, app| {
        state.update(app, |state, cx| {
            state.detail = Some(api::SessionDetail {
                meta: serde_json::from_str(&session_meta("a", None)).unwrap(),
                transcript: Vec::new(),
                children: Vec::new(),
            });
            state.selected_id = Some("test-session-1".into());
            cx.notify();
        })
    });
    window_cx.run_until_parked();
    window_cx.update(|window, cx| {
        let _ = window.draw(cx);
    });

    // Click into the composer input (focus), then type and send.
    let input_bounds = window_cx.debug_bounds("composer-input").expect("input rendered");
    window_cx.simulate_click(input_bounds.center(), Modifiers::default());
    window_cx.simulate_keystrokes("h i");
    window_cx.simulate_keystrokes("enter");

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        let sent = server
            .requests
            .lock()
            .unwrap()
            .iter()
            .any(|(m, p, b)| m == "POST" && p.ends_with("/messages") && b.contains("\"hi\""));
        if sent || std::time::Instant::now() > deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let sent = server
        .requests
        .lock()
        .unwrap()
        .iter()
        .any(|(m, p, b)| m == "POST" && p.ends_with("/messages") && b.contains("\"hi\""));
    assert!(sent, "composer sent the typed message to the host");
    let draft = cx.read(|app| state.read(app).draft.clone());
    assert_eq!(draft, "", "draft clears after send");
}

#[core::prelude::v1::test]
fn clicking_model_pill_cycles_model_and_calls_settings() {
    let mut cx = TestAppContext::single();
    let server = CannedServer::new(routes_with_settings_echo());
    let client = Client::new(server.base());
    cx.executor().allow_parking();

    let (state, window_cx) = cx.add_window_view(|_window, cx| {
        let state = AppState::new(client, cx);
        state.init(cx);
        state
    });
    window_cx.update(|_window, app| {
        state.update(app, |state, cx| {
            state.detail = Some(api::SessionDetail {
                meta: serde_json::from_str(&session_meta("deepseek-v4-flash", None)).unwrap(),
                transcript: Vec::new(),
                children: Vec::new(),
            });
            state.selected_id = Some("test-session-1".into());
            state.models = vec!["deepseek-v4-flash".into(), "deepseek-v4-pro".into()];
            cx.notify();
        })
    });
    window_cx.run_until_parked();
    window_cx.update(|window, cx| {
        let _ = window.draw(cx);
    });

    let pill_bounds = window_cx.debug_bounds("pill-model").expect("pill rendered");
    window_cx.simulate_click(pill_bounds.center(), Modifiers::default());

    let deadline = std::time::Instant::now() + std::time::Duration::from_secs(10);
    loop {
        cx.run_until_parked();
        let done = server.requests.lock().unwrap().iter().any(|(m, p, b)| {
            m == "POST" && p.ends_with("/settings") && b.contains("deepseek-v4-pro")
        });
        if done || std::time::Instant::now() > deadline {
            break;
        }
        std::thread::sleep(std::time::Duration::from_millis(20));
    }
    let done = server.requests.lock().unwrap().iter().any(|(m, p, b)| {
        m == "POST" && p.ends_with("/settings") && b.contains("deepseek-v4-pro")
    });
    assert!(done, "pill click called settings with the next model");
}
