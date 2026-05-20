import React, { useState, useEffect } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import { Plus, Trash2, Edit2, CheckCircle, X, AlertCircle } from 'lucide-react';

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const PROVIDER_TYPES = [
  { value: 'anthropic',  label: 'Anthropic (Claude)',         models: ['claude-sonnet-4-6', 'claude-haiku-4-5-20251001', 'claude-opus-4-6'],  baseUrl: '' },
  { value: 'openrouter', label: 'OpenRouter (Gemini/Others)', models: ['google/gemini-3.5-flash', 'google/gemini-2.5-flash', 'google/gemini-2.0-flash-exp', 'meta-llama/llama-3.3-70b-instruct', 'openai/gpt-4o-mini'], baseUrl: '' },
  { value: 'openai',     label: 'OpenAI',                     models: ['gpt-4o-mini', 'gpt-4o', 'gpt-4-turbo'], baseUrl: '' },
  { value: 'custom',     label: 'Custom (OpenAI-compatible)', models: [], baseUrl: 'https://your-endpoint/v1/chat/completions' },
];

const inp = {
  width: '100%', padding: '9px 12px', border: '1.5px solid #e2e8f0',
  borderRadius: 8, fontSize: '0.88rem', fontFamily: FONT, outline: 'none',
  boxSizing: 'border-box', background: 'white', color: '#1e293b',
};

export default function AIProviders() {
  const [providers, setProviders]   = useState([]);
  const [loading, setLoading]       = useState(true);
  const [showForm, setShowForm]     = useState(false);
  const [editing, setEditing]       = useState(null);
  const [toast, setToast]           = useState(null);
  const [form, setForm] = useState({
    name: '', providerType: 'anthropic', secretName: '', model: 'claude-sonnet-4-6', baseUrl: '', isDefault: false,
  });

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  const load = async () => {
    try {
      const res = await api.get('/ai-providers');
      setProviders(res.data.providers || []);
    } catch { showToast('Failed to load providers', 'error'); }
    finally  { setLoading(false); }
  };
  useEffect(() => { load(); }, []);

  const resetForm = () => {
    setForm({ name: '', providerType: 'anthropic', apiKey: '', model: 'claude-sonnet-4-6', isDefault: false });
    setEditing(null);
    setShowForm(false);
  };

  const handleSubmit = async () => {
    if (!form.name || (!editing && !form.secretName) || !form.model)
      return showToast('Name, secret name and model are required', 'error');
    try {
      if (editing) {
        await api.patch(`/ai-providers/${editing.id}`, form);
        showToast('Provider updated ✓');
      } else {
        await api.post('/ai-providers', form);
        showToast('Provider added ✓');
      }
      load(); resetForm();
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to save', 'error');
    }
  };

  const handleDelete = async (id, name) => {
    if (!window.confirm(`Delete "${name}"?`)) return;
    try { await api.delete(`/ai-providers/${id}`); showToast('Deleted ✓'); load(); }
    catch { showToast('Failed to delete', 'error'); }
  };

  const handleSetDefault = async (id) => {
    try { await api.patch(`/ai-providers/${id}`, { isDefault: true }); load(); }
    catch { showToast('Failed to set default', 'error'); }
  };

  const startEdit = (p) => {
    setForm({ name: p.name, providerType: p.provider_type, secretName: '', model: p.model, baseUrl: p.base_url || '', isDefault: p.is_default });
    setEditing(p);
    setShowForm(true);
  };

  const selectedType = PROVIDER_TYPES.find(t => t.value === form.providerType);

  if (loading) return <Layout title="AI Providers"><div style={{ padding: 60, textAlign: 'center', color: '#64748b', fontFamily: FONT }}>Loading...</div></Layout>;

  return (
    <Layout title="AI Providers">
      <div style={{ maxWidth: 760, margin: '0 auto' }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontSize: '1.3rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT, marginBottom: 4 }}>AI Providers</h1>
            <p style={{ fontSize: '0.85rem', color: '#64748b', fontFamily: FONT }}>
              Configure AI APIs for session answering. The default provider is used when none is selected at session launch.
            </p>
          </div>
          <button
            onClick={() => setShowForm(true)}
            style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}
          >
            <Plus size={16} /> Add Provider
          </button>
        </div>

        {providers.length === 0 ? (
          <div style={{ background: 'white', borderRadius: 12, border: '1.5px solid #e2e8f0', padding: '60px 40px', textAlign: 'center' }}>
            <div style={{ fontSize: '0.9rem', color: '#64748b', fontFamily: FONT, marginBottom: 16 }}>No AI providers configured yet.</div>
            <button onClick={() => setShowForm(true)} style={{ background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: '0.88rem' }}>
              Add Your First Provider
            </button>
          </div>
        ) : (
          <div style={{ display: 'flex', flexDirection: 'column', gap: 10 }}>
            {providers.map(p => {
              const pt = PROVIDER_TYPES.find(t => t.value === p.provider_type);
              return (
                <div key={p.id} style={{ background: 'white', border: `1.5px solid ${p.is_default ? '#86efac' : '#e2e8f0'}`, borderRadius: 12, padding: '16px 20px', display: 'flex', alignItems: 'center', gap: 14 }}>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 3 }}>
                      <span style={{ fontWeight: 600, fontSize: '0.95rem', color: '#1e293b', fontFamily: FONT }}>{p.name}</span>
                      {p.is_default && <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#dcfce7', color: '#166534', borderRadius: 20, padding: '2px 8px', fontFamily: FONT }}>DEFAULT</span>}
                      {!p.is_active && <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#fef2f2', color: '#dc2626', borderRadius: 20, padding: '2px 8px', fontFamily: FONT }}>INACTIVE</span>}
                    </div>
                    <div style={{ fontSize: '0.8rem', color: '#64748b', fontFamily: FONT }}>
                      {pt?.label} &nbsp;·&nbsp; <code style={{ fontSize: '0.78rem', background: '#f1f5f9', padding: '1px 5px', borderRadius: 4 }}>{p.model}</code>
                      &nbsp;·&nbsp; Secret: <code style={{ fontSize: '0.78rem' }}>{p.secret_name}</code>
                    </div>
                  </div>
                  <div style={{ display: 'flex', gap: 6 }}>
                    {!p.is_default && (
                      <button onClick={() => handleSetDefault(p.id)} title="Set as default" style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#059669', display: 'flex' }}>
                        <CheckCircle size={14} />
                      </button>
                    )}
                    <button onClick={() => startEdit(p)} style={{ background: '#f0f7ff', border: '1px solid #dbeafe', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#2563eb', display: 'flex' }}>
                      <Edit2 size={14} />
                    </button>
                    <button onClick={() => handleDelete(p.id, p.name)} style={{ background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#ef4444', display: 'flex' }}>
                      <Trash2 size={14} />
                    </button>
                  </div>
                </div>
              );
            })}
          </div>
        )}

        {/* Info box */}
        <div style={{ background: '#f0f7ff', border: '1.5px solid #dbeafe', borderRadius: 10, padding: '12px 16px', marginTop: 20, fontSize: '0.82rem', color: '#1e3a5f', fontFamily: FONT, lineHeight: 1.7 }}>
          <strong>OpenRouter</strong> — Get API key at <a href="https://openrouter.ai" target="_blank" rel="noreferrer" style={{ color: '#2563eb' }}>openrouter.ai</a>. Supports Gemini, Llama, Mistral and many others at lower cost than native APIs.<br />
          <strong>Anthropic</strong> — Supports prompt caching (50–90% token cost reduction on long sessions).<br />
          <strong>Custom</strong> — Any OpenAI-compatible endpoint (Ollama, LM Studio, Azure OpenAI, etc.).<br />
          <strong>Prompt format</strong> is identical across all providers — switching requires no scenario or persona changes.<br />
          <strong>Security</strong> — API keys are stored in Docker secrets on your server, not in the database. Only the secret name is stored here.
        </div>
      </div>

      {/* Form modal */}
      {showForm && (
        <div style={{ position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 }}>
          <div style={{ background: 'white', borderRadius: 16, width: '100%', maxWidth: 480, padding: 28, boxShadow: '0 25px 50px rgba(0,0,0,0.3)' }}>
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
              <h2 style={{ fontFamily: FONT, fontSize: '1.05rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                {editing ? 'Edit Provider' : 'Add AI Provider'}
              </h2>
              <button onClick={resetForm} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
            </div>
            <div style={{ display: 'flex', flexDirection: 'column', gap: 14 }}>
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>Display Name *</label>
                <input style={inp} value={form.name} onChange={e => setForm(f => ({ ...f, name: e.target.value }))} placeholder="e.g. Gemini Flash (Cheap), Claude Sonnet" />
              </div>
              {!editing && (
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>Provider Type *</label>
                  <select style={inp} value={form.providerType} onChange={e => setForm(f => ({ ...f, providerType: e.target.value, model: PROVIDER_TYPES.find(t => t.value === e.target.value)?.models[0] || '' }))}>
                    {PROVIDER_TYPES.map(t => <option key={t.value} value={t.value}>{t.label}</option>)}
                  </select>
                </div>
              )}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>
                  Docker Secret Name * {editing && <span style={{ fontWeight: 400, color: '#94a3b8' }}>(leave blank to keep existing)</span>}
                </label>
                <input
                  style={inp}
                  value={form.secretName}
                  onChange={e => setForm(f => ({ ...f, secretName: e.target.value }))}
                  placeholder="e.g. anthropic_api_key_v1, openrouter_key_v1, gemini_key"
                />
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, marginTop: 4 }}>
                  The name of the Docker secret on your server. The actual key is never stored in the database.
                </div>
              </div>
              {(form.providerType === 'custom' || form.providerType === 'openrouter' || (!PROVIDER_TYPES.find(t => t.value === form.providerType))) && (
                <div>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>
                    Base URL <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional — overrides default endpoint)</span>
                  </label>
                  <input
                    style={inp}
                    value={form.baseUrl}
                    onChange={e => setForm(f => ({ ...f, baseUrl: e.target.value }))}
                    placeholder="https://openrouter.ai/api/v1/chat/completions"
                  />
                </div>
              )}
              <div>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>Model *</label>
                <select style={inp} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))}>
                  {(selectedType?.models || []).map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <input style={{ ...inp, marginTop: 6 }} value={form.model} onChange={e => setForm(f => ({ ...f, model: e.target.value }))} placeholder="Or type a custom model name..." />
              </div>
              <label style={{ display: 'flex', alignItems: 'center', gap: 8, cursor: 'pointer', fontSize: '0.85rem', fontFamily: FONT, color: '#374151' }}>
                <input type="checkbox" checked={form.isDefault} onChange={e => setForm(f => ({ ...f, isDefault: e.target.checked }))} />
                Set as default provider
              </label>
            </div>
            <div style={{ display: 'flex', gap: 10, marginTop: 20 }}>
              <button onClick={resetForm} style={{ flex: 1, background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: 10, cursor: 'pointer', fontFamily: FONT, color: '#64748b' }}>Cancel</button>
              <button onClick={handleSubmit} style={{ flex: 2, background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: 10, cursor: 'pointer', fontFamily: FONT, fontWeight: 600, fontSize: '0.9rem' }}>
                {editing ? 'Save Changes' : 'Add Provider'}
              </button>
            </div>
          </div>
        </div>
      )}

      {toast && (
        <div style={{ position: 'fixed', bottom: 24, right: 24, zIndex: 9999, background: toast.type === 'error' ? '#fef2f2' : '#f0fdf4', border: `1.5px solid ${toast.type === 'error' ? '#fca5a5' : '#86efac'}`, borderRadius: 10, padding: '11px 16px', display: 'flex', alignItems: 'center', gap: 8, fontSize: '0.88rem', fontFamily: FONT, color: toast.type === 'error' ? '#dc2626' : '#166534', boxShadow: '0 8px 24px rgba(0,0,0,0.1)' }}>
          {toast.type === 'error' ? <AlertCircle size={16} /> : <CheckCircle size={16} />}
          {toast.msg}
        </div>
      )}
    </Layout>
  );
}