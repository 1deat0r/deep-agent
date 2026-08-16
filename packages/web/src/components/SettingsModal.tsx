import { useEffect, useState } from 'react';
import { getSkills } from '../api';
import type { AppConfig, SkillInfo } from '../types';

export interface SettingsModalProps {
  config: AppConfig | null;
  onClose: () => void;
}

export function SettingsModal(props: SettingsModalProps): JSX.Element {
  const { config, onClose } = props;
  const [skills, setSkills] = useState<SkillInfo[] | null>(null);
  const [skillsDir, setSkillsDir] = useState<string | null>(null);
  const [skillsError, setSkillsError] = useState<string | null>(null);

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
                <p className="settings-section__text">
                  The provider is configured at server start, not from the browser. Set any of the
                  following before launching the backend:
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
              </section>
            </>
          )}
        </div>

        <div className="modal__footer">
          <button type="button" className="btn btn--primary" onClick={onClose}>
            Close
          </button>
        </div>
      </div>
    </div>
  );
}
