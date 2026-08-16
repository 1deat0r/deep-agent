import type {
  AppConfig,
  ExecResult,
  GoalState,
  SessionDetail,
  SessionMeta,
  SkillInfo,
} from './types';

/**
 * The backend serves the built app from its own origin at `/`, so in
 * production we use relative URLs. In Vite dev mode (port 5173) the backend
 * runs separately on 127.0.0.1:3824 and CORS is `*` on API responses.
 */
export const API_BASE: string = import.meta.env.DEV ? 'http://127.0.0.1:3824' : '';

export function apiUrl(path: string): string {
  return `${API_BASE}${path}`;
}

export function eventsUrl(sessionId: string): string {
  return apiUrl(`/api/sessions/${sessionId}/events`);
}

async function apiFetch<T>(path: string, init?: RequestInit): Promise<T> {
  const headers: Record<string, string> = {};
  if (init?.body !== undefined) headers['content-type'] = 'application/json';

  const res = await fetch(apiUrl(path), { ...init, headers });

  let message = `${res.status} ${res.statusText}`;
  if (!res.ok) {
    try {
      const body = (await res.json()) as { error?: unknown };
      if (typeof body.error === 'string' && body.error !== '') message = body.error;
    } catch {
      // non-JSON error body; keep the status message
    }
    throw new Error(message);
  }
  return (await res.json()) as T;
}

export function getConfig(): Promise<AppConfig> {
  return apiFetch<AppConfig>('/api/config');
}

export function getModels(): Promise<{ models: string[]; default: string }> {
  return apiFetch<{ models: string[]; default: string }>('/api/models');
}

export function getSkills(): Promise<{ dir: string; skills: SkillInfo[] }> {
  return apiFetch<{ dir: string; skills: SkillInfo[] }>('/api/skills');
}

export function getSessions(): Promise<{ sessions: SessionMeta[] }> {
  return apiFetch<{ sessions: SessionMeta[] }>('/api/sessions');
}

export interface CreateSessionInput {
  title?: string;
  goal?: string;
  model?: string;
}

export function createSession(input: CreateSessionInput): Promise<{ meta: SessionMeta }> {
  return apiFetch<{ meta: SessionMeta }>('/api/sessions', {
    method: 'POST',
    body: JSON.stringify(input),
  });
}

export function getSession(id: string): Promise<SessionDetail> {
  return apiFetch<SessionDetail>(`/api/sessions/${id}`);
}

export function sendMessage(
  id: string,
  content: string,
): Promise<{ accepted: boolean; sessionId: string }> {
  return apiFetch<{ accepted: boolean; sessionId: string }>(
    `/api/sessions/${id}/messages`,
    { method: 'POST', body: JSON.stringify({ content }) },
  );
}

export function interruptSession(id: string): Promise<{ accepted: boolean }> {
  return apiFetch<{ accepted: boolean }>(`/api/sessions/${id}/interrupt`, {
    method: 'POST',
  });
}

export function continueSession(id: string): Promise<{ accepted: boolean }> {
  return apiFetch<{ accepted: boolean }>(`/api/sessions/${id}/continue`, {
    method: 'POST',
  });
}

export function runKernel(id: string, code: string): Promise<ExecResult> {
  return apiFetch<ExecResult>(`/api/sessions/${id}/kernel`, {
    method: 'POST',
    body: JSON.stringify({ code }),
  });
}

export function setGoal(id: string, objective: string): Promise<{ goal: GoalState }> {
  return apiFetch<{ goal: GoalState }>(`/api/sessions/${id}/goal`, {
    method: 'POST',
    body: JSON.stringify({ objective }),
  });
}

export function deleteSession(id: string): Promise<{ ok: boolean }> {
  return apiFetch<{ ok: boolean }>(`/api/sessions/${id}`, { method: 'DELETE' });
}
