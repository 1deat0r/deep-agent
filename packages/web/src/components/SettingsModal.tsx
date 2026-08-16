import { useEffect, useState } from 'react';
import { getSkills } from '../api';
import {
  applyDesktopSettings,
  desktopSettingsAvailable,
  envOverrideLabel,
  getDesktopSettingsState,
} from '../desktop-settings';
import type { DesktopSettingsState } from '../desktop-settings';
import type { AppConfig, SkillInfo } from '../types';

export interface SettingsModalProps {
  config: AppConfig | null;
  onClose: () => void;
}

interface ProviderForm {
  id: 'openai-compatible' | 'mock';
  model: string;
  baseUrl: string;
  apiKey: string;
}

interface ApplyError {
  field: string | undefined;
  message: string;
}

export function SettingsModal(props: SettingsModalProps): JSX.Element {
  const { config, onClose } = props;
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [skillsDir, setSkillsDir] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);
  const [bridgeState, setBridgeState] = useState<DesktopSettingsState | null>(null);
  const [form, setForm] = useState<ProviderForm>({
    id: 'openai-compatible',
    model: '',
    baseUrl: '',
    apiKey: '',
  });
  const [applyError, setApplyError] = useState<ApplyError | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedNote, setSavedNote] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    getSkills()
      .then((res) => {
        if (cancelled) return;
        setSkills(res.skills);
        setSkillsDir(res.dir);
      })
      .catch((err: unknown) => {
        if (!cancelled) setSkillsError(err instanceof Error ? err.message : String(err));
      });
    return () => {
      cancelled = true;
    };
  }, []);

  // Desktop bridge: load the editable provider form state (absent in browser).
  useEffect(() => {
    let cancelled = false;
    if (!desktopSettingsAvailable()) return;
    getDesktopSettingsState()
      .then((state) => {
        if (cancelled || state === null) return;
        setBridgeState(state);
        setForm((prev) => ({
          id: state.providerId,
          model: state.model,
          baseUrl: state.baseUrl ?? '',
          apiKey: prev.apiKey, // replace-only; never prefill a secret
        }));
      })
      .catch((err: unknown) => {
        if (!cancelled) setApplyError({ field: undefined, message: String(err) });
      });
    return () => {
      cancelled = true;
    };
  }, []);

  const editable = bridgeState !== null;

  const save = async (): Promise<void> => {
    if (!editable) return;
    setSaving(true);
    setApplyError(null);
    setSavedNote(null);
    const result = await applyDesktopSettings({
      id: form.id,
      model: form.model,
      baseUrl: form.baseUrl,
      // undefined = untouched; the key is replace-only.
      ...(form.apiKey !== '' ? { apiKey: form.apiKey } : {}),
    });
    setSaving(false);
    if (!result.ok) {
      if (result.cancelled) {
        setSavedNote('Save cancelled.');
        return;
      }
      setApplyError({ field: result.field, message: result.message ?? 'Save failed.' });
      return;
    }
    if (!result.changed) {
      setSavedNote('Nothing changed.');
      return;
    }
    // The host restarted under us; refresh the bridge view of the config.
    const fresh = await getDesktopSettingsState().catch(() => null);
    if (fresh !== null) {
      setBridgeState(fresh);
      setForm((prev) => ({ ...prev, id: fresh.providerId, model: fresh.model, baseUrl: fresh.baseUrl ?? '', apiKey: '' }));
    }
    setSavedNote('Saved — the host restarted with the new provider settings.');
  };

  const fieldError = (field: string): string | null =>
    applyError !== null && applyError.field === field ? applyError.message : null;

  const envNotice =
    bridgeState !== null && bridgeState.envOverrides.length > 0
      ? `Overridden by environment: ${bridgeState.envOverrides.map(envOverrideLabel).join(', ')}. Edits to those fields will not take effect.`
      : null;

  return (
    <div className="modal-backdrop" onClick={onClose} role="presentation">
      <div className="modal" role="dialog" aria-modal="true" aria-label="Settings" onClick={(e) => e.stopPropagation()}>
        <div className="modal__header">
          <h1 className="modal__title">Settings</h1>
          <button type="button" className="modal__close" onClick={onClose} aria-label="Close">
            ×
          </button>
        </div>

        <div className="modal__body">
          {config === null ? (
            <p className="modal__loading">Loading configuration…</p>
          ) : (
            <>
              <section className="settings-section">
                <h2 className="settings-section__title">Server</h2>
                <dl className="info-list">
                  <div className="info-row">
                    <dt>host</dt>
                    <dd>{config.host}</dd>
                  </div>
                  <div className="info-row">
                    <dt>port</dt>
                    <dd>{config.port}</dd>
                  </div>
                  <div className="info-row info-row--stack">
                    <dt>data dir</dt>
                    <dd className="info-row__path">{config.dataDir}</dd>
                  </div>
                  <div className="info-row">
                    <dt>max depth</dt>
                    <dd>{config.maxDepth}</dd>
                  </div>
                  <div className="info-row">
                    <dt>max tool iterations</dt>
                    <dd>{config.maxToolIterations}</dd>
                  </div>
                  <div className="info-row">
                    <dt>max auto rounds</dt>
                    <dd>{config.maxAutoRounds}</dd>
                  </div>
                  <div className="info-row">
                    <dt>exec timeout (ms)</dt>
                    <dd>{config.execTimeoutMs === 0 ? '0 (disabled)' : config.execTimeoutMs}</dd>
                  </div>
                </dl>
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Provider</h2>
                {editable ? (
                  <div className="settings-form">
                    {envNotice !== null && (
                      <p className="settings-form__notice">{envNotice}</p>
                    )}
                    <label className="settings-form__field">
                      <span className="settings-form__label">provider id</span>
                      <select
                        value={form.id}
                        onChange={(e) =>
                          setForm((prev) => ({ ...prev, id: e.target.value as ProviderForm['id'] }))
                        }
                      >
                        <option value="openai-compatible">openai-compatible</option>
                        <option value="mock">mock</option>
                      </select>
                      {fieldError('id') !== null && (
                        <span className="settings-form__error">{fieldError('id')}</span>
                      )}
                    </label>
                    <label className="settings-form__field">
                      <span className="settings-form__label">model</span>
                      <input
                        type="text"
                        value={form.model}
                        onChange={(e) => setForm((prev) => ({ ...prev, model: e.target.value }))}
                      />
                      {fieldError('model') !== null && (
                        <span className="settings-form__error">{fieldError('model')}</span>
                      )}
                    </label>
                    <label className="settings-form__field">
                      <span className="settings-form__label">base url</span>
                      <input
                        type="text"
                        value={form.baseUrl}
                        placeholder="https://api.deepseek.com"
                        onChange={(e) => setForm((prev) => ({ ...prev, baseUrl: e.target.value }))}
                      />
                      {fieldError('baseUrl') !== null && (
                        <span className="settings-form__error">{fieldError('baseUrl')}</span>
                      )}
                    </label>
                    <label className="settings-form__field">
                      <span className="settings-form__label">api key</span>
                      <input
                        type="password"
                        value={form.apiKey}
                        placeholder={bridgeState.hasApiKey ? '•••••••• (set)' : 'not set'}
                        autoComplete="off"
                        onChange={(e) => setForm((prev) => ({ ...prev, apiKey: e.target.value }))}
                      />
                      {fieldError('apiKey') !== null && (
                        <span className="settings-form__error">{fieldError('apiKey')}</span>
                      )}
                    </label>
                    <dl className="info-list">
                      <div className="info-row">
                        <dt>temperature</dt>
                        <dd>{config.provider.temperature ?? '—'}</dd>
                      </div>
                      <div className="info-row">
                        <dt>max tokens</dt>
                        <dd>{config.provider.maxTokens ?? '—'}</dd>
                      </div>
                    </dl>
                    {applyError !== null && applyError.field === undefined && (
                      <p className="settings-form__error">{applyError.message}</p>
                    )}
                    {savedNote !== null && <p className="settings-form__saved">{savedNote}</p>}
                  </div>
                ) : (
                  <dl className="info-list">
                    <div className="info-row">
                      <dt>id</dt>
                      <dd>{config.provider.id}</dd>
                    </div>
                    <div className="info-row">
                      <dt>model</dt>
                      <dd>{config.provider.model}</dd>
                    </div>
                    <div className="info-row">
                      <dt>base url</dt>
                      <dd>{config.provider.baseUrl ?? '—'}</dd>
                    </div>
                    <div className="info-row">
                      <dt>temperature</dt>
                      <dd>{config.provider.temperature ?? '—'}</dd>
                    </div>
                    <div className="info-row">
                      <dt>max tokens</dt>
                      <dd>{config.provider.maxTokens ?? '—'}</dd>
                    </div>
                    <div className="info-row">
                      <dt>api key</dt>
                      <dd className="info-row__secret">
                        {config.provider.hasApiKey ? '•••••••• (set)' : 'not set'}
                      </dd>
                    </div>
                  </dl>
                )}
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">
                  Skills{skills !== null ? ` (${skills.length})` : ''}
                </h2>
                {skillsError !== null ? (
                  <p className="settings-section__text">Failed to load skills: {skillsError}</p>
                ) : skills === null ? (
                  <p className="modal__loading">Loading skills…</p>
                ) : skills.length === 0 ? (
                  <p className="settings-section__text">No skills installed.</p>
                ) : (
                  <>
                    {skillsDir !== null && (
                      <p className="skills-dir" title={skillsDir}>
                        {skillsDir}
                      </p>
                    )}
                    <ul className="skills-list">
                      {skills.map((skill) => (
                        <li className="skill-item" key={skill.name}>
                          <span className="skill-item__name">{skill.name}</span>
                          <span className="skill-item__desc">{skill.description}</span>
                        </li>
                      ))}
                    </ul>
                  </>
                )}
              </section>

              <section className="settings-section">
                <h2 className="settings-section__title">Configuration</h2>
                {editable ? (
                  <p className="settings-section__text">
                    Provider settings are saved by the desktop app to{' '}
                    <code>~/.config/deep-agent/config.json</code>. Saving restarts the host:
                    running sessions stop (their transcripts are kept). Environment variables
                    override the file where set.
                  </p>
                ) : (
                  <>
                    <p className="settings-section__text">
                      The provider is configured at server start, not from the browser. Set any of
                      the following before launching the backend:
                    </p>
                    <ul className="settings-section__list">
                      <li>
                        <code>DEEP_AGENT_CONFIG</code> — path to a JSON config file (e.g.{' '}
                        <code>{'{"provider": {"id": "mock", "model": "mock-model"}}'}</code>)
                      </li>
                      <li>
                        <code>DEEP_AGENT_API_KEY</code> — provider API key
                      </li>
                      <li>
                        <code>DEEP_AGENT_MODEL</code> — model name
                      </li>
                      <li>
                        <code>DEEP_AGENT_BASE_URL</code> — OpenAI-compatible endpoint
                      </li>
                    </ul>
                  </>
                )}
              </section>
            </>
          )}
        </div>

        <div className="modal__footer">
          {editable && (
            <button
              type="button"
              className="btn btn--primary"
              onClick={() => void save()}
              disabled={saving}
            >
              {saving ? 'Saving…' : 'Save'}
            </button>
          )}
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
