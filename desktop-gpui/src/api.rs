//! Types and client for the deep-agent host HTTP+SSE API (default 127.0.0.1:3824).
//! Blocking ureq calls are run on gpui's background executor.

use serde::{Deserialize, Serialize};

pub const DEFAULT_BASE: &str = "http://127.0.0.1:3824";

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct GoalState {
    pub objective: String,
    pub status: String,
    pub rounds: i64,
    pub max_rounds: i64,
    pub sovereign: bool,
    #[serde(default)]
    pub summary: Option<String>,
    #[serde(default)]
    pub blocked_reason: Option<String>,
    pub updated_at: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct SessionMeta {
    pub id: String,
    pub title: String,
    pub role: String,
    #[serde(default)]
    pub parent_id: Option<String>,
    pub depth: i64,
    pub model: String,
    pub status: String,
    pub created_at: String,
    pub updated_at: String,
    pub child_ids: Vec<String>,
    #[serde(default)]
    pub goal: Option<GoalState>,
    pub auto_continue: bool,
    #[serde(default)]
    pub last_summary: Option<String>,
    #[serde(default)]
    pub reasoning_effort: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct ToolCall {
    pub id: String,
    #[serde(rename = "type")]
    pub kind: String,
    pub function: ToolCallFunction,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
pub struct ToolCallFunction {
    pub name: String,
    pub arguments: String,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(rename_all = "camelCase")]
pub struct UsageInfo {
    #[serde(default)]
    pub prompt_tokens: Option<f64>,
    #[serde(default)]
    pub completion_tokens: Option<f64>,
    #[serde(default)]
    pub cache_hit_tokens: Option<f64>,
    #[serde(default)]
    pub cache_miss_tokens: Option<f64>,
}

#[derive(Debug, Clone, Serialize, Deserialize, PartialEq)]
#[serde(tag = "kind", rename_all = "snake_case")]
pub enum TranscriptEntry {
    Message {
        role: String,
        #[serde(default)]
        content: Option<String>,
        #[serde(default)]
        name: Option<String>,
        #[serde(default)]
        tool_calls: Option<Vec<ToolCall>>,
        #[serde(default)]
        tool_call_id: Option<String>,
        #[serde(default)]
        usage: Option<UsageInfo>,
    },
    Cell {
        code: String,
        stdout: String,
        stderr: String,
        #[serde(default)]
        result_repr: Option<String>,
        #[serde(default)]
        error: Option<String>,
        duration_ms: f64,
        timestamp: String,
    },
    Compaction {
        summary: String,
        from: f64,
        timestamp: String,
        #[serde(default)]
        usage: Option<UsageInfo>,
    },
    ApprovalRequest {
        id: String,
        session_id: String,
        summary: String,
        detail: String,
        created_at: String,
    },
    ApprovalDecision {
        id: String,
        approved: bool,
        note: String,
        decided_at: String,
    },
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(rename_all = "camelCase")]
pub struct SessionDetail {
    pub meta: SessionMeta,
    pub transcript: Vec<TranscriptEntry>,
    pub children: Vec<serde_json::Value>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
pub struct ModelsResponse {
    pub models: Vec<String>,
    pub default: String,
    #[serde(default)]
    pub error: Option<String>,
}

#[derive(Debug, Clone, Serialize, Deserialize)]
#[serde(tag = "type", rename_all = "snake_case", rename_all_fields = "camelCase")]
pub enum HostEvent {
    Status { session_id: String, status: String },
    TurnStart { session_id: String, turn_id: String },
    TurnEnd {
        session_id: String,
        turn_id: String,
        summary: String,
    },
    MessageDelta {
        session_id: String,
        turn_id: String,
        delta: String,
    },
    MessageComplete {
        session_id: String,
        message: TranscriptEntry,
    },
    CellStart { session_id: String, code: String },
    CellResult {
        session_id: String,
        cell: TranscriptEntry,
    },
    ChildSpawned {
        session_id: String,
        child: serde_json::Value,
    },
    ChildFinished {
        session_id: String,
        child_id: String,
        summary: String,
    },
    GoalUpdated {
        session_id: String,
        goal: GoalState,
    },
    SessionDeleted { session_id: String },
    KernelRestarted { session_id: String, reason: String },
    ApprovalRequested {
        session_id: String,
        approval: serde_json::Value,
    },
    ApprovalDecided {
        session_id: String,
        approval: serde_json::Value,
    },
    Error { session_id: String, message: String },
}

#[derive(Clone)]
pub struct Client {
    pub base: String,
}

impl Client {
    pub fn new(base: impl Into<String>) -> Self {
        Self { base: base.into() }
    }

    pub fn get_sessions(&self) -> anyhow::Result<Vec<SessionMeta>> {
        #[derive(Deserialize)]
        struct Res {
            sessions: Vec<SessionMeta>,
        }
        let res: Res = ureq::get(&format!("{}/api/sessions", self.base))
            .call()?
            .body_mut()
            .read_json()?;
        Ok(res.sessions)
    }

    pub fn create_session(&self) -> anyhow::Result<SessionMeta> {
        #[derive(Deserialize)]
        struct Res {
            meta: SessionMeta,
        }
        let res: Res = ureq::post(&format!("{}/api/sessions", self.base))
            .send_json(serde_json::json!({}))?
            .body_mut()
            .read_json()?;
        Ok(res.meta)
    }

    pub fn get_session(&self, id: &str) -> anyhow::Result<SessionDetail> {
        Ok(ureq::get(&format!("{}/api/sessions/{}", self.base, id))
            .call()?
            .body_mut()
            .read_json()?)
    }

    pub fn get_models(&self) -> anyhow::Result<ModelsResponse> {
        Ok(ureq::get(&format!("{}/api/models", self.base))
            .call()?
            .body_mut()
            .read_json()?)
    }

    pub fn send_message(&self, id: &str, content: &str) -> anyhow::Result<()> {
        ureq::post(&format!("{}/api/sessions/{}/messages", self.base, id))
            .send_json(serde_json::json!({ "content": content }))?;
        Ok(())
    }

    pub fn interrupt(&self, id: &str) -> anyhow::Result<()> {
        ureq::post(&format!("{}/api/sessions/{}/interrupt", self.base, id))
            .send_json(serde_json::json!({}))?;
        Ok(())
    }

    pub fn continue_turn(&self, id: &str) -> anyhow::Result<()> {
        ureq::post(&format!("{}/api/sessions/{}/continue", self.base, id))
            .send_json(serde_json::json!({}))?;
        Ok(())
    }

    pub fn update_settings(
        &self,
        id: &str,
        model: Option<&str>,
        reasoning_effort: Option<&str>,
    ) -> anyhow::Result<SessionMeta> {
        #[derive(Deserialize)]
        struct Res {
            meta: SessionMeta,
        }
        let mut body = serde_json::Map::new();
        if let Some(m) = model {
            body.insert("model".into(), m.into());
        }
        if let Some(r) = reasoning_effort {
            body.insert("reasoningEffort".into(), r.into());
        }
        let res: Res = ureq::post(&format!("{}/api/sessions/{}/settings", self.base, id))
            .send_json(serde_json::Value::Object(body))?
            .body_mut()
            .read_json()?;
        Ok(res.meta)
    }

    /// Stream SSE events; `on_event` runs on the UI thread. Blocks until the
    /// stream ends (call from a background task).
    pub fn stream_events(
        &self,
        id: &str,
        mut on_event: impl FnMut(HostEvent) + Send + 'static,
    ) -> anyhow::Result<()> {
        use std::io::{BufRead, BufReader};
        let reader = ureq::get(&format!("{}/api/sessions/{}/events", self.base, id))
            .call()?
            .into_body()
            .into_reader();
        for line in BufReader::new(reader).lines() {
            let line = line?;
            let data = match line.strip_prefix("data:") {
                Some(d) => d.trim(),
                None => continue,
            };
            if data.is_empty() {
                continue;
            }
            if let Ok(event) = serde_json::from_str::<HostEvent>(data) {
                on_event(event);
            }
        }
        Ok(())
    }
}
