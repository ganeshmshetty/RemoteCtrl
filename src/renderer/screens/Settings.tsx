import { useState, useEffect } from 'react';

import { X, Key, Server, Cpu, RefreshCw, Eye, EyeOff } from 'lucide-react';
import { useSettingsStore } from '../stores/useWorkflowStore';
import type { ApiProvider, BrowserMode } from '../../shared/types';

const MODELS_BY_PROVIDER: Record<ApiProvider, string[]> = {
  openai: ['gpt-4o', 'gpt-4o-mini', 'o1-mini'],
  anthropic: ['claude-3-5-sonnet-latest', 'claude-3-haiku-20240307'],
  gemini: ['gemini-1.5-pro', 'gemini-2.0-flash-exp'],
  groq: ['llama-3.3-70b-versatile', 'mixtral-8x7b-32768'],
  deepseek: ['deepseek-chat', 'deepseek-reasoner'],
  nebius: ['meta-llama/Llama-3.3-70B-Instruct', 'mistralai/Mixtral-8x22B-Instruct-v0.1'],
  openrouter: ['anthropic/claude-3.5-sonnet', 'openai/o1-mini', 'google/gemini-pro-1.5', 'meta-llama/llama-3.3-70b-instruct']
};

export function Settings() {
  const {
    preferredProvider,
    preferredModel,
    hasOpenAIKey,
    hasAnthropicKey,
    hasGeminiKey,
    hasGroqKey,
    hasDeepseekKey,
    hasNebiusKey,
    hasOpenRouterKey,
    loadSettings,
    setSignalingUrl,
    setPreferredProvider,
    setPreferredModel,
    setApiKey,
    headlessMode,
    setHeadlessMode,
  } = useSettingsStore();

  const [apiInput, setApiInput] = useState('');
  const [signalingInput, setSignalingInput] = useState('');
  const [browserMode, setBrowserMode] = useState('internal');
  const [showKey, setShowKey] = useState(false);
  const [savedMsg, setSavedMsg] = useState('');

  const [fetchedModels, setFetchedModels] = useState<Record<string, string[]>>({});
  const [isFetchingModels, setIsFetchingModels] = useState(false);
  const [isCustomModel, setIsCustomModel] = useState(false);
  const [customModelInput, setCustomModelInput] = useState('');

  useEffect(() => {
    loadSettings().then(() => {
      setSignalingInput(useSettingsStore.getState().signalingUrl);
    });
    window.RemoteCtrlAPI?.settings.getBrowserMode().then(setBrowserMode);
  }, []);

  function hasKeyForProvider(p: ApiProvider) {
    switch (p) {
      case 'openai': return hasOpenAIKey;
      case 'anthropic': return hasAnthropicKey;
      case 'gemini': return hasGeminiKey;
      case 'groq': return hasGroqKey;
      case 'deepseek': return hasDeepseekKey;
      case 'nebius': return hasNebiusKey;
      case 'openrouter': return hasOpenRouterKey;
      default: return false;
    }
  }

  async function handleSaveApiKey() {
    if (!apiInput.trim()) return;
    await setApiKey(preferredProvider, apiInput.trim());
    setApiInput('');
    flash('Key saved');
  }

  async function handleProviderChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const p = e.target.value as ApiProvider;
    await setPreferredProvider(p);
    setApiInput(''); // clear input when switching
    setIsCustomModel(false);
    // Set default model for the new provider
    const available = Array.from(new Set([...(MODELS_BY_PROVIDER[p] || []), ...(fetchedModels[p] || [])]));
    if (available.length > 0) {
      await setPreferredModel(available[0]);
    }
  }

  async function handleModelChange(e: React.ChangeEvent<HTMLSelectElement>) {
    const m = e.target.value;
    if (m === '__custom__') {
      setIsCustomModel(true);
      setCustomModelInput(preferredModel || '');
    } else {
      await setPreferredModel(m);
    }
  }

  async function handleSaveCustomModel() {
    if (customModelInput.trim()) {
      await setPreferredModel(customModelInput.trim());
      setIsCustomModel(false);
      flash('Custom model saved');
    }
  }

  async function fetchModelsSilently(provider: ApiProvider) {
    setIsFetchingModels(true);
    try {
      const ms = await window.RemoteCtrlAPI?.settings.fetchModels(provider);
      if (ms && ms.length > 0) {
        setFetchedModels(prev => ({ ...prev, [provider]: ms }));
      }
    } catch (e) {
      // ignore
    }
    setIsFetchingModels(false);
  }

  // Auto-fetch models for the active provider
  useEffect(() => {
    if (['openai', 'groq', 'deepseek', 'nebius', 'openrouter'].includes(preferredProvider)) {
      const hasKey = hasKeyForProvider(preferredProvider);
      if ((hasKey || preferredProvider === 'openrouter') && !fetchedModels[preferredProvider]) {
        fetchModelsSilently(preferredProvider);
      }
    }
  }, [preferredProvider, hasOpenAIKey, hasGroqKey, hasDeepseekKey, hasNebiusKey, hasOpenRouterKey, fetchedModels]);

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

  const hasCurrentKey = hasKeyForProvider(preferredProvider);
  const models = Array.from(new Set([...(MODELS_BY_PROVIDER[preferredProvider] || []), ...(fetchedModels[preferredProvider] || [])]));

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

        {/* Active AI Setup */}
        <Section icon={<Cpu size={15} />} title="Active AI Setup">
          <p className="settings-hint">
            Select your preferred AI provider and model. The API key you enter will be associated with the selected provider. Keys are stored locally.
          </p>
          
          <div className="settings-row" style={{ display: 'flex', gap: '16px' }}>
            <SettingField label="Provider" status="" style={{ flex: 1 }}>
              <select className="settings-select" value={preferredProvider} onChange={handleProviderChange}>
                <option value="openai">OpenAI</option>
                <option value="anthropic">Anthropic</option>
                <option value="gemini">Google Gemini</option>
                <option value="groq">Groq</option>
                <option value="deepseek">DeepSeek</option>
                <option value="nebius">Nebius</option>
                <option value="openrouter">OpenRouter</option>
              </select>
            </SettingField>

            <SettingField label="Model" status="" style={{ flex: 1 }}>
              {isCustomModel ? (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <input
                    type="text"
                    className="settings-input"
                    value={customModelInput}
                    onChange={e => setCustomModelInput(e.target.value)}
                    placeholder="e.g. custom-model-name"
                    autoFocus
                  />
                  <button className="btn btn-primary" onClick={handleSaveCustomModel} disabled={!customModelInput.trim()}>
                    Save
                  </button>
                  <button className="btn btn-secondary" onClick={() => setIsCustomModel(false)}>
                    Cancel
                  </button>
                </div>
              ) : (
                <div style={{ display: 'flex', gap: '8px' }}>
                  <select className="settings-select" value={preferredModel || ''} onChange={handleModelChange} style={{ flex: 1 }}>
                    {models.map(m => <option key={m} value={m}>{m}</option>)}
                    {!models.includes(preferredModel as string) && preferredModel && (
                       <option value={preferredModel}>{preferredModel} (Custom)</option>
                    )}
                    <option value="__custom__">Custom Model...</option>
                  </select>
                </div>
              )}
            </SettingField>
          </div>

          <SettingField label={`${preferredProvider.charAt(0).toUpperCase() + preferredProvider.slice(1)} API Key`} status={hasCurrentKey ? 'Configured' : 'Not set'} hasKey={hasCurrentKey}>
            <div className="settings-input-row">
              <div className="settings-input-wrap">
                <input
                  type={showKey ? 'text' : 'password'}
                  className="settings-input"
                  placeholder={hasCurrentKey ? '••••••••••••••••' : 'Enter API Key...'}
                  value={apiInput}
                  onChange={(e) => setApiInput(e.target.value)}
                  autoComplete="off"
                  spellCheck={false}
                />
                <button className="settings-eye-btn" onClick={() => setShowKey(!showKey)}>
                  {showKey ? <EyeOff size={13} /> : <Eye size={13} />}
                </button>
              </div>
              <button
                className="btn btn-primary"
                disabled={!apiInput.trim()}
                onClick={handleSaveApiKey}
              >
                Save Key
              </button>
            </div>
          </SettingField>
        </Section>

        {/* Browser Mode */}
        <Section icon={<RefreshCw size={15} />} title="Browser Connection">
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

        {/* Connection */}
        <Section icon={<Server size={15} />} title="Advanced Connection">
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

          <div style={{ marginTop: 12 }}>
            <p className="settings-hint">
              Reset the dedicated Playwright browser profile. This clears all session data, cookies, and cached content.
            </p>
            <button className="btn btn-danger-outline settings-reset-btn" onClick={handleResetBrowser}>
              <RefreshCw size={13} />
              Reset Browser Profile
            </button>
          </div>
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
            .settings-input, .settings-select {
              width: 100%;
              height: 36px;
              padding: 0 12px;
              background: var(--bg-surface);
              border: 1px solid var(--border);
              border-radius: var(--radius-sm);
              color: var(--text-primary);
              font-size: 13px;
              outline: none;
              transition: border-color var(--transition);
            }
            .settings-input { padding-right: 36px; font-family: var(--font-mono); }
            .settings-input:focus, .settings-select:focus { border-color: var(--accent); }
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
  style,
}: {
  label: string;
  status: string;
  hasKey?: boolean;
  children: React.ReactNode;
  style?: React.CSSProperties;
}) {
  return (
    <div className="settings-field" style={style}>
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
