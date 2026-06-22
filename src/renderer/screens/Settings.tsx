import { useState, useEffect } from 'react';

import { X, Key, Server, Cpu, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '../stores/useWorkflowStore';
import type { ApiProvider, BrowserMode } from '../../shared/types';

export function Settings() {
  const {
    preferredProvider,
    hasOpenAIKey,
    hasAnthropicKey,
    hasGeminiKey,
    loadSettings,
    setSignalingUrl,
    setPreferredProvider,
    setApiKey,
    headlessMode,
    setHeadlessMode,
  } = useSettingsStore();

  const [openAIInput, setOpenAIInput] = useState('');
  const [anthropicInput, setAnthropicInput] = useState('');
  const [geminiInput, setGeminiInput] = useState('');
  const [signalingInput, setSignalingInput] = useState('');
  const [browserMode, setBrowserMode] = useState('internal');
  const [showOpenAI, setShowOpenAI] = useState(false);
  const [showAnthropic, setShowAnthropic] = useState(false);
  const [showGemini, setShowGemini] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  useEffect(() => {
    loadSettings().then(() => {
      setSignalingInput(useSettingsStore.getState().signalingUrl);
    });
    window.RemoteCtrlAPI?.settings.getBrowserMode().then(setBrowserMode);
  }, []);

  async function handleSaveApiKey(provider: ApiProvider, value: string) {
    if (!value.trim()) return;
    await setApiKey(provider, value.trim());
    if (provider === 'openai') setOpenAIInput('');
    else if (provider === 'anthropic') setAnthropicInput('');
    else setGeminiInput('');
    flash('Key saved');
  }

  async function handleSaveSignaling() {
    try {
      await setSignalingUrl(signalingInput.trim());
      flash('Saved');
    } catch {
      flash('Invalid URL');
    }
  }

  async function handleResetBrowser() {
    await window.RemoteCtrlAPI?.browser.resetProfile();
    flash('Browser profile reset');
  }

  async function handleSaveBrowserMode(m: BrowserMode) {
    setBrowserMode(m);
    await window.RemoteCtrlAPI?.settings.setBrowserMode(m);
    flash('Browser mode saved');
  }

  function flash(msg: string) {
    setSavedMsg(msg);
    setTimeout(() => setSavedMsg(''), 2500);
  }

  return (
    <div className="settings-root">
      <div className="drag-region settings-titlebar" />

      <div className="settings-header no-drag">
        <h1 className="settings-title">Settings</h1>
        {savedMsg && <span className="settings-saved-toast animate-fade-in">{savedMsg}</span>}
        <button className="icon-btn" onClick={() => window.close()}>
          <X size={16} />
        </button>
      </div>

      <div className="settings-body">

        {/* Browser Mode */}
        <Section icon={<Cpu size={15} />} title="Browser Connection">
          <p className="settings-hint">
            <strong>Internal:</strong> Launches a fresh, isolated, headless browser.<br/>
            <strong>Local Chrome:</strong> Connects to your existing browser. You must launch Chrome with <code>--remote-debugging-port=9222</code>.
          </p>
          <SettingField label="Connection Mode" status="">
            <div className="settings-radio-group">
              {(['internal', 'local_chrome'] as BrowserMode[]).map((m) => (
                <label key={m} className="settings-radio">
                  <input
                    type="radio"
                    name="browserMode"
                    value={m}
                    checked={browserMode === m}
                    onChange={() => handleSaveBrowserMode(m)}
                  />
                  <span className="settings-radio-label">
                    {m === 'internal' ? 'Internal Isolated' : 'Local Chrome (Port 9222)'}
                  </span>
                </label>
              ))}
            </div>
          </SettingField>

          {browserMode === 'internal' && (
            <SettingField label="Headless Mode" status="">
              <label className="settings-checkbox-label" style={{ display: 'flex', alignItems: 'center', gap: '8px', cursor: 'pointer' }}>
                <input
                  type="checkbox"
                  checked={headlessMode}
                  onChange={(e) => setHeadlessMode(e.target.checked)}
                />
                <span className="settings-radio-label">
                  Run invisibly in background (prevents stealing OS focus)
                </span>
              </label>
            </SettingField>
          )}
        </Section>

        {/* API Keys */}
        <Section icon={<Key size={15} />} title="API Keys">
          <p className="settings-hint">
            Keys are stored locally on this machine. They are never sent over the network.
          </p>

          <SettingField label="OpenAI API Key" status={hasOpenAIKey ? 'Configured' : 'Not set'} hasKey={hasOpenAIKey}>
            <div className="settings-input-row">
              <div className="settings-input-wrap">
                <input
                  type={showOpenAI ? 'text' : 'password'}
                  className="settings-input"
                  placeholder={hasOpenAIKey ? '••••••••••••••••' : 'sk-...'}
                  value={openAIInput}
                  onChange={(e) => setOpenAIInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-eye-btn" onClick={() => setShowOpenAI(!showOpenAI)}>
                  {showOpenAI ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                className="btn btn-primary"
                disabled={!openAIInput.trim()}
                onClick={() => handleSaveApiKey('openai', openAIInput)}
              >
                Save
              </button>
            </div>
          </SettingField>

          <SettingField label="Anthropic API Key" status={hasAnthropicKey ? 'Configured' : 'Not set'} hasKey={hasAnthropicKey}>
            <div className="settings-input-row">
              <div className="settings-input-wrap">
                <input
                  type={showAnthropic ? 'text' : 'password'}
                  className="settings-input"
                  placeholder={hasAnthropicKey ? '••••••••••••••••' : 'sk-ant-...'}
                  value={anthropicInput}
                  onChange={(e) => setAnthropicInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-eye-btn" onClick={() => setShowAnthropic(!showAnthropic)}>
                  {showAnthropic ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                className="btn btn-primary"
                disabled={!anthropicInput.trim()}
                onClick={() => handleSaveApiKey('anthropic', anthropicInput)}
              >
                Save
              </button>
            </div>
          </SettingField>

          <SettingField label="Gemini API Key" status={hasGeminiKey ? 'Configured' : 'Not set'} hasKey={hasGeminiKey}>
            <div className="settings-input-row">
              <div className="settings-input-wrap">
                <input
                  type={showGemini ? 'text' : 'password'}
                  className="settings-input"
                  placeholder={hasGeminiKey ? '••••••••••••••••' : 'AIzaSy...'}
                  value={geminiInput}
                  onChange={(e) => setGeminiInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-eye-btn" onClick={() => setShowGemini(!showGemini)}>
                  {showGemini ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                className="btn btn-primary"
                disabled={!geminiInput.trim()}
                onClick={() => handleSaveApiKey('gemini', geminiInput)}
              >
                Save
              </button>
            </div>
          </SettingField>
        </Section>

        {/* Model Preference */}
        <Section icon={<Cpu size={15} />} title="Model Preference">
          <SettingField label="Preferred Provider" status="">
            <div className="settings-radio-group">
              {(['openai', 'anthropic', 'gemini'] as ApiProvider[]).map((p) => (
                <label key={p} className="settings-radio">
                  <input
                    type="radio"
                    name="provider"
                    value={p}
                    checked={preferredProvider === p}
                    onChange={() => setPreferredProvider(p)}
                  />
                  <span className="settings-radio-label">
                    {p === 'openai' ? 'OpenAI' : p === 'anthropic' ? 'Anthropic (Claude)' : 'Gemini (3.1 Flash)'}
                  </span>
                </label>
              ))}
            </div>
          </SettingField>
        </Section>

        {/* Connection */}
        <Section icon={<Server size={15} />} title="Connection">
          <SettingField label="Signaling Server URL" status="">
            <div className="settings-input-row">
              <input
                type="url"
                className="settings-input"
                value={signalingInput}
                onChange={(e) => setSignalingInput(e.target.value)}
                placeholder="http://localhost:3001"
              />
              <button className="btn btn-primary" onClick={handleSaveSignaling}>
                Save
              </button>
            </div>
          </SettingField>
        </Section>

        {/* Browser */}
        <Section icon={<RefreshCw size={15} />} title="Browser">
          <p className="settings-hint">
            Reset the dedicated Playwright browser profile. This clears all session data,
            cookies, and cached content.
          </p>
          <button className="btn btn-danger-outline settings-reset-btn" onClick={handleResetBrowser}>
            <RefreshCw size={13} />
            Reset Browser Profile
          </button>
        </Section>

        </div>{/* end settings-body */}

        <style>{`
          .settings-root {
            height: 100vh;
            display: flex;
            flex-direction: column;
            background: var(--bg-base);
          }
          .settings-titlebar { height: 28px; }
            .settings-header {
              display: flex;
              align-items: center;
              gap: 12px;
              padding: 16px 20px;
              border-bottom: 1px solid var(--border);
              background: var(--bg-surface);
              flex-shrink: 0;
            }
            .settings-title {
              font-size: 15px;
              font-weight: 600;
              color: var(--text-primary);
              flex: 1;
            }
            .settings-saved-toast {
              font-size: 12px;
              color: var(--success);
              font-weight: 500;
            }
            .settings-body {
              flex: 1;
              overflow-y: auto;
              padding: 24px 20px;
              display: flex;
              flex-direction: column;
              gap: 24px;
            }
            .settings-section {
              display: flex;
              flex-direction: column;
              gap: 16px;
            }
            .settings-section-header {
              display: flex;
              align-items: center;
              gap: 8px;
              font-size: 12px;
              font-weight: 600;
              text-transform: uppercase;
              letter-spacing: 0.06em;
              color: var(--text-muted);
              border-bottom: 1px solid var(--border);
              padding-bottom: 10px;
            }
            .settings-field {
              display: flex;
              flex-direction: column;
              gap: 8px;
            }
            .settings-field-label-row {
              display: flex;
              align-items: center;
              justify-content: space-between;
            }
            .settings-field-label {
              font-size: 13px;
              font-weight: 500;
              color: var(--text-primary);
            }
            .settings-field-status {
              font-size: 11px;
              padding: 2px 8px;
              border-radius: 99px;
              font-weight: 600;
            }
            .status-ok  { background: rgba(34,197,94,0.1); color: var(--success); }
            .status-off { background: var(--bg-overlay); color: var(--text-muted); }
            .settings-hint {
              font-size: 12px;
              color: var(--text-muted);
              line-height: 1.6;
            }
            .settings-input-row {
              display: flex;
              gap: 8px;
              align-items: center;
            }
            .settings-input-wrap {
              position: relative;
              flex: 1;
            }
            .settings-input {
              width: 100%;
              height: 36px;
              padding: 0 36px 0 12px;
              background: var(--bg-surface);
              border: 1px solid var(--border);
              border-radius: var(--radius-sm);
              color: var(--text-primary);
              font-size: 13px;
              font-family: var(--font-mono);
              outline: none;
              transition: border-color var(--transition);
            }
            .settings-input:focus { border-color: var(--accent); }
            .settings-eye-btn {
              position: absolute;
              right: 8px;
              top: 50%;
              transform: translateY(-50%);
              background: none;
              border: none;
              color: var(--text-muted);
              cursor: pointer;
              padding: 2px;
            }
            .settings-eye-btn:hover { color: var(--text-secondary); }
            .settings-radio-group {
              display: flex;
              gap: 12px;
            }
            .settings-radio {
              display: flex;
              align-items: center;
              gap: 6px;
              cursor: pointer;
            }
            .settings-radio-label { font-size: 13px; color: var(--text-secondary); }
            .settings-reset-btn { margin-top: 4px; }
            .icon-btn {
              display: flex; align-items: center; justify-content: center;
              width: 32px; height: 32px; border-radius: var(--radius-sm);
              border: none; background: transparent; color: var(--text-muted);
              cursor: pointer; transition: color var(--transition), background var(--transition);
            }
            .icon-btn:hover { color: var(--text-primary); background: var(--bg-elevated); }
            .btn {
              display: inline-flex; align-items: center; justify-content: center;
              gap: 6px; height: 36px; padding: 0 16px; border-radius: var(--radius-sm);
              font-size: 13px; font-weight: 600; cursor: pointer; border: none;
              transition: background var(--transition), opacity var(--transition), transform var(--transition);
              white-space: nowrap;
            }
            .btn:active { transform: scale(0.97); }
            .btn:disabled { opacity: 0.4; cursor: not-allowed; }
            .btn-primary { background: var(--accent); color: white; }
            .btn-primary:hover:not(:disabled) { background: var(--accent-hover); }
            .btn-danger-outline { background: transparent; color: var(--danger); border: 1px solid rgba(239,68,68,0.4); }
            .btn-danger-outline:hover { background: rgba(239,68,68,0.1); }
          `}</style>
    </div>
  );
}

function Section({ icon, title, children }: { icon: React.ReactNode; title: string; children: React.ReactNode }) {
  return (
    <div className="settings-section">
      <div className="settings-section-header">
        {icon}
        {title}
      </div>
      {children}
    </div>
  );
}

function SettingField({
  label,
  status,
  hasKey,
  children,
}: {
  label: string;
  status: string;
  hasKey?: boolean;
  children: React.ReactNode;
}) {
  return (
    <div className="settings-field">
      <div className="settings-field-label-row">
        <div className="settings-field-label">{label}</div>
        {status && (
          <span className={`settings-field-status ${hasKey ? 'status-ok' : 'status-off'}`}>
            {status}
          </span>
        )}
      </div>
      {children}
    </div>
  );
}
