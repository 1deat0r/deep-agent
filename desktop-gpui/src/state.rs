//! Central app state: sessions, selected session detail, draft, and the host
//! client. One entity drives the whole tree; background tasks mutate it
//! through cx.update on the UI thread.

use gpui::*;

use crate::api::{self, HostEvent, SessionMeta, TranscriptEntry};

pub struct AppState {
    pub client: api::Client,
    pub sessions: Vec<SessionMeta>,
    pub selected_id: Option<String>,
    pub detail: Option<api::SessionDetail>,
    pub models: Vec<String>,
    pub draft: String,
    pub caret: usize,
    pub streaming: bool,
    pub busy: bool,
    pub toast: Option<String>,
    pub input_focus: FocusHandle,
}

impl AppState {
    pub fn new(client: api::Client, cx: &mut Context<Self>) -> Self {
        Self {
            client,
            sessions: Vec::new(),
            selected_id: None,
            detail: None,
            models: Vec::new(),
            draft: String::new(),
            caret: 0,
            streaming: false,
            busy: false,
            toast: None,
            input_focus: cx.focus_handle(),
        }
    }

    pub fn init(&self, cx: &mut Context<Self>) {
        self.refresh_sessions(cx);
        self.load_models(cx);
    }

    pub fn refresh_sessions(&self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.get_sessions();
            match result {
                Ok(sessions) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        let mut first_id: Option<String> = None;
                        this.sessions = sessions;
                        if this.selected_id.is_none() && !this.sessions.is_empty() {
                            first_id = this.sessions.first().map(|m| m.id.clone());
                        }
                        if let Some(id) = first_id {
                            this.select(id, cx);
                        }
                        cx.notify();
                    })
                    .ok();
                }
                Err(err) => {
                    this.update(&mut async_cx.clone(), |this, cx| this.fail(&err.to_string(), cx))
                        .ok();
                }
            }
        })
        .detach();
    }

    pub fn load_models(&self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.get_models();
            match result {
                Ok(models) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        this.models = models.models;
                        cx.notify();
                    })
                    .ok();
                }
                Err(_) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        if this.models.is_empty() {
                            this.models.push(String::from("deepseek-v4-pro"));
                        }
                        cx.notify();
                    })
                    .ok();
                }
            }
        })
        .detach();
    }

    pub fn select(&mut self, id: String, cx: &mut Context<Self>) {
        if self.selected_id.as_deref() == Some(&id) {
            return;
        }
        self.selected_id = Some(id.clone());
        self.detail = None;
        self.draft.clear();
        self.caret = 0;
        self.streaming = false;
        self.load_detail(id.clone(), cx);
        self.open_event_stream(id, cx);
        cx.notify();
    }

    pub fn load_detail(&self, id: String, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.get_session(&id);
            match result {
                Ok(detail) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        if this.selected_id.as_deref() == Some(&id) {
                            this.detail = Some(detail);
                            this.patch_session_list();
                            cx.notify();
                        }
                    })
                    .ok();
                }
                Err(err) => {
                    this.update(&mut async_cx.clone(), |this, cx| this.fail(&err.to_string(), cx))
                        .ok();
                }
            }
        })
        .detach();
    }

    /// Persistent SSE connection for the selected session. The blocking reader
    /// runs on the background executor and pushes events through an mpsc; a
    /// drain task applies them on the UI thread.
    pub fn open_event_stream(&self, id: String, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let (tx, rx) = smol::channel::unbounded::<HostEvent>();

        let stream_tx = tx.clone();
        let async_cx = cx.to_async();
        let drain_cx = async_cx.clone();
        // Producer: keep the session's event stream open; on end (host
        // restart, network blip), back off and reconnect while the session is
        // still selected.
        let mut producer_cx = async_cx.clone();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let mut backoff = std::time::Duration::from_secs(1);
            loop {
                let still_selected = this
                    .update(&mut producer_cx, |this, _cx| {
                        this.selected_id.as_deref() == Some(id.as_str())
                    })
                    .unwrap_or(false);
                if !still_selected {
                    break;
                }
                let stream_tx = stream_tx.clone();
                let stream_id = id.clone();
                let stream_client = client.clone();
                let stream_cx = producer_cx.clone();
                let _ = stream_cx
                    .background_executor()
                    .spawn(async move {
                        let _ = stream_client.stream_events(&stream_id, move |event| {
                            let _ = stream_tx.try_send(event);
                        });
                    })
                    .await;
                smol::Timer::after(backoff).await;
                backoff = (backoff * 2).min(std::time::Duration::from_secs(8));
            }
        })
        .detach();

        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let mut async_cx = drain_cx;
            while let Ok(event) = rx.recv().await {
                let _ = this.update(&mut async_cx, |this, cx| {
                    this.handle_event(event, cx);
                });
            }
        })
        .detach();
    }

    pub fn handle_event(&mut self, event: HostEvent, cx: &mut Context<Self>) {
        let Some(detail) = self.detail.as_mut() else {
            return;
        };
        match event {
            HostEvent::Status { status, .. } => {
                let running = status == "running";
                detail.meta.status = status;
                self.streaming = running;
                self.patch_session_list();
            }
            HostEvent::TurnStart { .. } => {
                self.draft.clear();
                self.caret = 0;
                self.streaming = true;
            }
            HostEvent::MessageDelta { delta, .. } => {
                self.draft.push_str(&delta);
                self.streaming = true;
            }
            HostEvent::MessageComplete { message, .. } => {
                let entry = message;
                let is_dup = detail
                    .transcript
                    .last()
                    .map(|e| e == &entry)
                    .unwrap_or(false);
                if !is_dup {
                    detail.transcript.push(entry);
                }
                self.draft.clear();
                self.caret = 0;
                self.streaming = false;
            }
            HostEvent::CellResult { cell, .. } => {
                let is_dup = detail
                    .transcript
                    .last()
                    .map(|e| e == &cell)
                    .unwrap_or(false);
                if !is_dup {
                    detail.transcript.push(cell);
                }
            }
            HostEvent::TurnEnd { summary, .. } => {
                detail.meta.last_summary = Some(summary);
                detail.meta.status = String::from("idle");
                self.streaming = false;
                self.patch_session_list();
            }
            HostEvent::GoalUpdated { goal, .. } => {
                detail.meta.goal = Some(goal);
            }
            HostEvent::Error { message, .. } => {
                self.fail(&format!("agent error: {}", message), cx);
            }
            _ => {}
        }
        cx.notify();
    }

    pub fn send(&mut self, cx: &mut Context<Self>) {
        let text = self.draft.trim().to_string();
        if text.is_empty() || self.streaming || self.busy {
            return;
        }
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        self.draft.clear();
        self.caret = 0;
        self.busy = true;
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.send_message(&id, &text);
            match result {
                Ok(()) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        this.busy = false;
                        this.streaming = true;
                        cx.notify();
                    })
                    .ok();
                }
                Err(err) => {
                    this.update(&mut async_cx.clone(), |this, cx| {
                        this.busy = false;
                        this.fail(&err.to_string(), cx);
                    })
                    .ok();
                }
            }
        })
        .detach();
    }

    pub fn interrupt(&self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let _ = client.interrupt(&id);
            this.update(&mut async_cx.clone(), |this, cx| {
                this.streaming = false;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn continue_turn(&self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let _ = client.continue_turn(&id);
            this.update(&mut async_cx.clone(), |this, cx| {
                this.streaming = true;
                cx.notify();
            })
            .ok();
        })
        .detach();
    }

    pub fn cycle_model(&mut self, cx: &mut Context<Self>) {
        let Some(detail) = self.detail.as_ref() else {
            return;
        };
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let current = detail.meta.model.clone();
        let pos = self.models.iter().position(|m| m == &current).unwrap_or(0);
        let next = self.models.get((pos + 1) % self.models.len().max(1));
        let Some(next) = next.cloned() else {
            return;
        };
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.update_settings(&id, Some(&next), None);
            match result {
                Ok(meta) => {
                    this.update(&mut async_cx.clone(), move |this, cx| {
                        if let Some(detail) = this.detail.as_mut() {
                            detail.meta = meta;
                        }
                        this.patch_session_list();
                        cx.notify();
                    })
                    .ok();
                }
                Err(err) => {
                    this.update(&mut async_cx.clone(), |this, cx| this.fail(&err.to_string(), cx))
                        .ok();
                }
            }
        })
        .detach();
    }

    pub fn cycle_reasoning(&mut self, cx: &mut Context<Self>) {
        let Some(id) = self.selected_id.clone() else {
            return;
        };
        let current = self
            .detail
            .as_ref()
            .and_then(|d| d.meta.reasoning_effort.clone())
            .unwrap_or_else(|| String::from("auto"));
        let next = next_reasoning_level(&current);
        let client = self.client.clone();
        let next = next.to_string();
        let id_for_call = id.clone();
        let sent: Option<String> = if next == "auto" {
            None
        } else {
            Some(next.clone())
        };
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.update_settings(&id_for_call, None, sent.as_deref());
            if let Ok(meta) = result {
                this.update(&mut async_cx.clone(), move |this, cx| {
                    if let Some(detail) = this.detail.as_mut() {
                        detail.meta = meta;
                    }
                    this.patch_session_list();
                    cx.notify();
                })
                .ok();
            }
        })
        .detach();
    }

    pub fn create_session(&mut self, cx: &mut Context<Self>) {
        let client = self.client.clone();
        let async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            let result = client.create_session();
            match result {
                Ok(meta) => {
                    this.update(&mut async_cx.clone(), move |this, cx| {
                        this.sessions.insert(0, meta.clone());
                        this.select(meta.id, cx);
                    })
                    .ok();
                }
                Err(err) => {
                    this.update(&mut async_cx.clone(), |this, cx| this.fail(&err.to_string(), cx))
                        .ok();
                }
            }
        })
        .detach();
    }

    fn patch_session_list(&mut self) {
        let Some(detail) = self.detail.as_ref() else {
            return;
        };
        for meta in self.sessions.iter_mut() {
            if meta.id == detail.meta.id {
                *meta = detail.meta.clone();
            }
        }
    }

    fn fail(&mut self, message: &str, cx: &mut Context<Self>) {
        self.toast = Some(message.to_string());
        let mut async_cx = cx.to_async();
        cx.spawn(move |this: WeakEntity<Self>, _cx: &mut AsyncApp| async move {
            smol::Timer::after(std::time::Duration::from_secs(6)).await;
            this.update(&mut async_cx, |this, cx| {
                this.toast = None;
                cx.notify();
            })
            .ok();
        })
        .detach();
        cx.notify();
    }
}

pub fn usage_totals(entries: &[TranscriptEntry]) -> (Totals, Totals) {
    let mut start = 0usize;
    for (i, entry) in entries.iter().enumerate().rev() {
        if let TranscriptEntry::Message { role, .. } = entry {
            if role == "user" {
                start = i + 1;
                break;
            }
        }
    }
    let mut session = Totals::default();
    let mut turn = Totals::default();
    for (i, entry) in entries.iter().enumerate() {
        let usage = match entry {
            TranscriptEntry::Message { usage, .. } | TranscriptEntry::Compaction { usage, .. } => {
                usage.as_ref()
            }
            _ => None,
        };
        let Some(usage) = usage else { continue };
        session.add(usage);
        if i >= start {
            turn.add(usage);
        }
    }
    (session, turn)
}

#[derive(Default, Clone, Copy)]
pub struct Totals {
    pub input: f64,
    pub output: f64,
    pub cache_hit: f64,
    pub cache_miss: f64,
}

impl Totals {
    fn add(&mut self, usage: &api::UsageInfo) {
        self.input += usage.prompt_tokens.unwrap_or(0.0);
        self.output += usage.completion_tokens.unwrap_or(0.0);
        self.cache_hit += usage.cache_hit_tokens.unwrap_or(0.0);
        self.cache_miss += usage.cache_miss_tokens.unwrap_or(0.0);
    }

    pub fn cache_rate(&self) -> Option<f64> {
        let denom = self.cache_hit + self.cache_miss;
        if denom > 0.0 {
            Some(self.cache_hit / denom)
        } else {
            None
        }
    }
}

/// DeepSeek v4's real reasoning tiers (low/high/max; medium aliases high).
/// "auto" means the field is omitted from the request — the provider default.
pub const REASONING_LEVELS: &[&str] = &["auto", "low", "high", "max"];

/// Next level in the pill cycle, wrapping after the last.
pub fn next_reasoning_level(current: &str) -> String {
    let pos = REASONING_LEVELS
        .iter()
        .position(|l| *l == current)
        .unwrap_or(0);
    REASONING_LEVELS[(pos + 1) % REASONING_LEVELS.len()].to_string()
}

/// What an input keystroke asked for.
#[derive(Debug, Clone, Copy, PartialEq, Eq)]
pub enum InputAction {
    None,
    Send,
}

/// Apply one editor keystroke to the composer draft at `caret` (char index).
/// Streaming blocks edits, matching the web composer's disabled state.
pub fn apply_input_edit(
    draft: &mut String,
    caret: &mut usize,
    key: &str,
    key_char: Option<&str>,
    shift: bool,
    streaming: bool,
) -> InputAction {
    if streaming {
        return InputAction::None;
    }
    let len = draft.chars().count();
    *caret = (*caret).min(len);
    match key {
        "enter" => {
            if shift {
                insert_at(draft, caret, '\n');
            } else {
                return InputAction::Send;
            }
        }
        "backspace" => {
            if *caret > 0 {
                remove_before(draft, caret);
            }
        }
        "delete" => {
            if *caret < len {
                remove_at(draft, caret);
            }
        }
        "space" => insert_at(draft, caret, ' '),
        "tab" => insert_at(draft, caret, '\t'),
        "left" => *caret = caret.saturating_sub(1),
        "right" => *caret = (*caret + 1).min(len),
        "home" => *caret = 0,
        "end" => *caret = len,
        _ => {
            if let Some(c) = key_char {
                for ch in c.chars() {
                    insert_at(draft, caret, ch);
                }
            }
        }
    }
    InputAction::None
}

fn char_byte_index(s: &str, n: usize) -> usize {
    s.char_indices().nth(n).map(|(i, _)| i).unwrap_or(s.len())
}

fn insert_at(s: &mut String, caret: &mut usize, c: char) {
    let byte = char_byte_index(s, *caret);
    s.insert(byte, c);
    *caret += 1;
}

fn remove_at(s: &mut String, caret: &mut usize) {
    let byte = char_byte_index(s, *caret);
    s.remove(byte);
}

fn remove_before(s: &mut String, caret: &mut usize) {
    *caret -= 1;
    let byte = char_byte_index(s, *caret);
    s.remove(byte);
}

pub fn format_tokens(n: f64) -> String {
    if n >= 1_000_000.0 {
        format!("{:.1}M", n / 1_000_000.0)
    } else if n >= 1000.0 {
        format!("{:.1}k", n / 1000.0)
    } else {
        format!("{}", n as u64)
    }
}
