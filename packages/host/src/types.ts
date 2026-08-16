import type { ChatMessage } from '@deep-agent/provider';

export type SessionRole = 'root' | 'child';
export type SessionStatus = 'idle' | 'running' | 'completed' | 'error';

export interface GoalState {
  objective: string;
  status: 'active' | 'completed' | 'blocked' | 'paused';
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

export type TranscriptEntry =
  | ({ kind: 'message' } & ChatMessage)
  | {
      kind: 'cell';
      code: string;
      stdout: string;
      stderr: string;
      resultRepr: string | null;
      error: string | null;
      durationMs: number;
      timestamp: string;
    }
  | {
      kind: 'compaction';
      summary: string;
      /** Transcript index of the first entry kept in the new context. */
      from: number;
      timestamp: string;
    };

export type HostEvent =
  | { type: 'status'; sessionId: string; status: SessionStatus }
  | { type: 'turn_start'; sessionId: string; turnId: string }
  | { type: 'turn_end'; sessionId: string; turnId: string; summary: string }
  | { type: 'message_delta'; sessionId: string; turnId: string; delta: string }
  | { type: 'cell_start'; sessionId: string; code: string }
  | {
      type: 'message_complete';
      sessionId: string;
      message: TranscriptEntry & { kind: 'message' };
    }
  | {
      type: 'cell_result';
      sessionId: string;
      cell: TranscriptEntry & { kind: 'cell' };
    }
  | { type: 'child_spawned'; sessionId: string; child: ChildSummary }
  | { type: 'child_finished'; sessionId: string; childId: string; summary: string }
  | { type: 'goal_updated'; sessionId: string; goal: GoalState }
  | { type: 'session_deleted'; sessionId: string }
  | { type: 'kernel_restarted'; sessionId: string; reason: string }
  | { type: 'error'; sessionId: string; message: string };

export interface SessionDetail {
  meta: SessionMeta;
  transcript: TranscriptEntry[];
  children: ChildSummary[];
}

export interface HostConfig {
  port: number;
  host: string;
  dataDir: string;
  /** Directory holding the deep_agent_runtime Python package. */
  pythonDir?: string;
  pythonPath?: string;
  /** Skills directory; defaults to <dataDir>/skills. */
  skillsDir?: string;
  maxDepth: number;
  maxToolIterations: number;
  maxAutoRounds: number;
  execTimeoutMs: number;
  /** Respawn an unexpectedly-exited kernel this many times per session. */
  maxKernelRestarts: number;
  /** The model's context window in tokens (budgeting headroom applied). */
  contextWindowTokens: number;
  /** Compact the LLM context when the messages exceed this many tokens. */
  compactAtTokens: number;
  /** Keep roughly this many tokens of recent messages after compaction. */
  compactKeepTokens: number;
  provider: {
    id: 'openai-compatible' | 'mock';
    baseUrl?: string;
    apiKey?: string;
    model: string;
    temperature?: number;
    maxTokens?: number;
  };
}

export const IPYTHON_TOOL = {
  type: 'function',
  function: {
    name: 'ipython',
    description:
      'Execute Python code in the persistent kernel. All file reading/editing, shell commands, ' +
      'analysis, and subagent spawning happen here. State (variables, imports, functions, working ' +
      'directory) persists across calls. Use %%bash cells or !commands for shell work. Use ' +
      '`handle = await rlm(prompt, name="...")` to spawn child agents, ' +
      '`await agent_message.send(msg, receiver_role="parent")` to message the parent, and the ' +
      '`rlm.goal.*` API for goals. Each call returns stdout, stderr, the repr of the last ' +
      'expression, and any error traceback.',
    parameters: {
      type: 'object',
      properties: {
        code: { type: 'string', description: 'Python code to run in the persistent kernel.' },
      },
      required: ['code'],
    },
  },
} as const;
