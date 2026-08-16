// TypeScript types mirroring the backend API contract (packages/host/src/types.ts).
// Kept in one place so the UI and API helper share a single source of truth.

export type SessionRole = 'root' | 'child';
export type SessionStatus = 'idle' | 'running' | 'completed';
export type GoalStatus = 'active' | 'completed' | 'blocked' | 'paused';

export interface GoalState {
  objective: string;
  status: GoalStatus;
  rounds: number;
  maxRounds: number;
  summary?: string;
  blockedReason?: string;
  updatedAt: string;
}

export interface ChildSummary {
  id: string;
  name: string;
  status: SessionStatus;
  depth: number;
  model: string;
}

export interface SessionMeta {
  id: string;
  title: string;
  role: SessionRole;
  parentId: string | null;
  /** Title of the parent session (for child prompts). */
  parentTitle?: string | null;
  depth: number;
  model: string;
  status: SessionStatus;
  createdAt: string;
  updatedAt: string;
  childIds: string[];
  goal: GoalState | null;
  autoContinue: boolean;
  /** Markdown summary of the latest completed turn, if any. */
  lastSummary?: string;
}

export interface ToolCall {
  id: string;
  type: 'function';
  function: { name: string; arguments: string };
}

/** LLM message shape (matches provider ChatMessage). */
export interface ChatMessage {
  role: 'system' | 'user' | 'assistant' | 'tool';
  content: string | null;
  name?: string;
  tool_calls?: ToolCall[];
  tool_call_id?: string;
}

export type TranscriptMessage = ChatMessage & { kind: 'message' };

export interface TranscriptCell {
  kind: 'cell';
  code: string;
  stdout: string;
  stderr: string;
  resultRepr: string | null;
  error: string | null;
  durationMs: number;
  timestamp: string;
}

export type TranscriptEntry = TranscriptMessage | TranscriptCell;

export type HostEvent =
  | { type: 'status'; sessionId: string; status: SessionStatus }
  | { type: 'turn_start'; sessionId: string; turnId: string }
  | { type: 'turn_end'; sessionId: string; turnId: string; summary: string }
  | { type: 'message_delta'; sessionId: string; turnId: string; delta: string }
  // NOTE: the backend emits a bare ChatMessage here (no `kind` field); the UI
  // normalizes it into a TranscriptMessage when finalizing the transcript.
  | { type: 'message_complete'; sessionId: string; message: ChatMessage }
  | { type: 'cell_result'; sessionId: string; cell: TranscriptCell }
  | { type: 'child_spawned'; sessionId: string; child: ChildSummary }
  | { type: 'child_finished'; sessionId: string; childId: string; summary: string }
  | { type: 'goal_updated'; sessionId: string; goal: GoalState }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'error'; sessionId: string; message: string };

export interface SessionDetail {
  meta: SessionMeta;
  transcript: TranscriptEntry[];
  children: ChildSummary[];
}

export interface ProviderConfig {
  id: string;
  baseUrl?: string;
  model: string;
  temperature?: number;
  maxTokens?: number;
  hasApiKey: boolean;
}

export interface AppConfig {
  port: number;
  host: string;
  dataDir: string;
  maxDepth: number;
  maxToolIterations: number;
  maxAutoRounds: number;
  execTimeoutMs: number;
  provider: ProviderConfig;
}

/** Shape of the /api/sessions/:id/kernel response (an ExecResult). */
export interface KernelError {
  type: string;
  message: string;
  traceback: string[];
}

export interface ExecResult {
  stdout: string;
  stderr: string;
  resultRepr: string | null;
  error: KernelError | null;
  durationMs: number;
}

/** A single skill from the /api/skills listing. */
export interface SkillInfo {
  name: string;
  description: string;
}

/** GET /api/models response. */
export interface ModelsResponse {
  models: string[];
  default: string;
  error?: string;
}
