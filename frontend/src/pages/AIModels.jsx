import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import {
  Search, RefreshCw, Plus, Star, Trash2, Edit2,
  CheckCircle, ChevronDown, ChevronUp, X, Zap,
  DollarSign, Brain, Eye
} from 'lucide-react';

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

const badge = (label, color, bg) => (
  <span style={{
    fontSize: '0.68rem', fontWeight: 700, padding: '2px 7px',
    borderRadius: 20, background: bg, color, fontFamily: FONT,
  }}>{label}</span>
);

const fmt = (n) => n == null ? '—' : `$${parseFloat(n).toFixed(4)}`;
const fmtCtx = (n) => {
  if (!n) return '—';
  if (n >= 1_000_000) return `${(n/1_000_000).toFixed(0)}M`;
  if (n >= 1_000)     return `${(n/1_000).toFixed(0)}K`;
  return String(n);
};

export default function AIModels() {
  const [tab, setTab]               = useState('active');  // 'active' | 'browse'
  const [activeModels, setActive]   = useState([]);
  const [browseModels, setBrowse]   = useState([]);
  const [loading, setLoading]       = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [search, setSearch]         = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [sortBy, setSortBy]         = useState('price');
  const [activateForm, setActForm]  = useState(null); // model being activated
  const [estimate, setEstimate]     = useState(null);
  const [toast, setToast]           = useState(null);
  const [editingId, setEditingId]   = useState(null);
  const [editNotes, setEditNotes]   = useState('');

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load active models ────────────────────────────────────────────────────
  const loadActive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/openrouter/active');
      setActive(res.data.models || []);
    } catch { showToast('Failed to load active models', 'error'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);

  // ── Load cost estimate ────────────────────────────────────────────────────
  const loadEstimate = async () => {
    try {
      const res = await api.get('/openrouter/estimate?questionCount=20&avgInputTokens=1200&avgOutputTokens=150');
      setEstimate(res.data);
    } catch {}
  };
  useEffect(() => { loadEstimate(); }, [activeModels]);

  // ── Browse live models from OpenRouter ───────────────────────────────────
  const loadBrowse = async () => {
    setBrowseLoading(true);
    try {
      const res = await api.get('/openrouter/models');
      setBrowse(res.data.models || []);
    } catch { showToast('Failed to fetch models from OpenRouter', 'error'); }
    finally  { setBrowseLoading(false); }
  };

  useEffect(() => {
    if (tab === 'browse' && browseModels.length === 0) loadBrowse();
  }, [tab]);

  // ── Activate a model ──────────────────────────────────────────────────────
  const handleActivate = async () => {
    if (!activateForm) return;
    try {
      await api.post('/openrouter/activate', {
        modelId:           activateForm.id,
        displayName:       activateForm.displayName || activateForm.name,
        provider:          activateForm.provider,
        inputPricePer1m:   activateForm.input_price_per_1m,
        outputPricePer1m:  activateForm.output_price_per_1m,
        contextLength:     activateForm.context_length,
        supportsReasoning: activateForm.supports_reasoning,
        reasoningLevel:    activateForm.reasoningLevel || 'off',
        notes:             activateForm.notes || '',
      });
      showToast(`${activateForm.displayName || activateForm.name} activated ✓`);
      setActForm(null);
      loadActive();
      setTab('active');
    } catch (e) {
      showToast(e.response?.data?.error || 'Failed to activate model', 'error');
    }
  };

  const handleSetDefault = async (id) => {
    try {
      await api.post(`/openrouter/active/${id}/set-default`);
      showToast('Default model updated ✓');
      loadActive();
    } catch { showToast('Failed to set default', 'error'); }
  };

  const handleRemove = async (id, name) => {
    if (!window.confirm(`Remove "${name}" from active models?`)) return;
    try {
      await api.delete(`/openrouter/active/${id}`);
      showToast(`${name} removed`);
      loadActive();
    } catch { showToast('Failed to remove model', 'error'); }
  };

  const handleSaveNotes = async (id) => {
    try {
      await api.patch(`/openrouter/active/${id}`, { notes: editNotes });
      showToast('Notes saved ✓');
      setEditingId(null);
      loadActive();
    } catch { showToast('Failed to save notes', 'error'); }
  };

  // ── Derived browse list ───────────────────────────────────────────────────
  const activeIds   = new Set(activeModels.map(m => m.model_id));
  const providers   = ['all', ...new Set(browseModels.map(m => m.provider))].sort();

  const filtered = browseModels
    .filter(m => {
      const q = search.toLowerCase();
      const matchSearch = !q ||
        m.name.toLowerCase().includes(q) ||
        m.id.toLowerCase().includes(q)   ||
        m.provider.toLowerCase().includes(q);
      const matchProvider = providerFilter === 'all' || m.provider === providerFilter;
      return matchSearch && matchProvider;
    })
    .sort((a, b) => {
      if (sortBy === 'price')   return a.input_price_per_1m - b.input_price_per_1m;
      if (sortBy === 'context') return b.context_length - a.context_length;
      if (sortBy === 'name')    return a.name.localeCompare(b.name);
      return 0;
    });

  // ── Styles ────────────────────────────────────────────────────────────────
  const card = {
    background: 'white', borderRadius: 12,
    border: '1.5px solid #e2e8f0', padding: '16px 20px',
    marginBottom: 12,
  };
  const tabBtn = (active) => ({
    padding: '8px 20px', borderRadius: 8, fontFamily: FONT,
    fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer', border: 'none',
    background: active ? '#1e3a5f' : 'transparent',
    color: active ? 'white' : '#64748b',
  });
  const btn = (variant = 'primary') => ({
    padding: '7px 14px', borderRadius: 7, fontFamily: FONT,
    fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer', border: 'none',
    background: variant === 'primary' ? '#1e3a5f'
              : variant === 'green'   ? '#059669'
              : variant === 'red'     ? '#ef4444'
              : '#f1f5f9',
    color: variant === 'ghost' ? '#475569' : 'white',
  });

  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* ── Header ── */}
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 24 }}>
          <div>
            <h1 style={{ fontFamily: FONT, fontSize: '1.5rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
              AI Models
            </h1>
            <p style={{ fontFamily: FONT, fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0' }}>
              Powered by OpenRouter · All models billed via your OpenRouter account
            </p>
          </div>
          <div style={{ display: 'flex', gap: 8 }}>
            <button style={tabBtn(tab === 'active')} onClick={() => setTab('active')}>
              Active Models ({activeModels.length})
            </button>
            <button style={tabBtn(tab === 'browse')} onClick={() => setTab('browse')}>
              Browse & Add
            </button>
          </div>
        </div>

        {/* ── Cost Estimate Banner ── */}
        {estimate && tab === 'active' && (
          <div style={{
            background: 'linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%)',
            border: '1.5px solid #bfdbfe', borderRadius: 12,
            padding: '16px 20px', marginBottom: 20,
            display: 'flex', gap: 32, flexWrap: 'wrap',
          }}>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                DEFAULT MODEL
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT }}>
                {estimate.model?.display_name}
              </div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT }}>
                {estimate.model?.id}
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                PRICING
              </div>
              <div style={{ fontSize: '0.85rem', color: '#1e293b', fontFamily: FONT }}>
                ${parseFloat(estimate.model?.input_price_per_1m||0).toFixed(4)} input &nbsp;·&nbsp;
                ${parseFloat(estimate.model?.output_price_per_1m||0).toFixed(4)} output
                <span style={{ color: '#94a3b8' }}> per 1M tokens</span>
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                EST. COST PER SESSION
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#059669', fontFamily: FONT }}>
                ${parseFloat(estimate.per_session?.total_usd||0).toFixed(5)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT }}>
                ~{estimate.assumptions?.questionCount} questions · {estimate.assumptions?.avgInputTokens} avg input tokens
              </div>
            </div>
            <div>
              <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                PER 1,000 SESSIONS
              </div>
              <div style={{ fontSize: '1.1rem', fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                ${parseFloat(estimate.per_1000_sessions?.total_usd||0).toFixed(3)}
              </div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT }}>AI cost only · excludes proxy</div>
            </div>
          </div>
        )}

        {/* ══ ACTIVE MODELS TAB ══════════════════════════════════════════════ */}
        {tab === 'active' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontFamily: FONT }}>
                Loading active models...
              </div>
            ) : activeModels.length === 0 ? (
              <div style={{ textAlign: 'center', padding: 64, background: 'white', borderRadius: 12, border: '1.5px dashed #e2e8f0' }}>
                <Brain size={40} color="#cbd5e1" style={{ marginBottom: 12 }} />
                <div style={{ fontFamily: FONT, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  No models activated yet
                </div>
                <div style={{ fontFamily: FONT, fontSize: '0.85rem', color: '#94a3b8', marginBottom: 20 }}>
                  Browse OpenRouter's model library and add models to use in your sessions
                </div>
                <button style={btn('primary')} onClick={() => setTab('browse')}>
                  Browse Models
                </button>
              </div>
            ) : (
              activeModels.map(m => (
                <div key={m.id} style={{
                  ...card,
                  border: m.is_default ? '2px solid #1e3a5f' : '1.5px solid #e2e8f0',
                }}>
                  <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                    <div style={{ flex: 1 }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                        <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>
                          {m.display_name}
                        </span>
                        {m.is_default && badge('DEFAULT', '#1e3a5f', '#dbeafe')}
                        {m.supports_reasoning && badge('REASONING', '#7c3aed', '#ede9fe')}
                        {m.reasoning_level !== 'off' && badge(`REASONING: ${m.reasoning_level.toUpperCase()}`, '#7c3aed', '#ede9fe')}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '0.8rem', color: '#64748b', marginBottom: 8 }}>
                        <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: '0.77rem' }}>
                          {m.model_id}
                        </code>
                        &nbsp;·&nbsp; {m.provider}
                        &nbsp;·&nbsp; Context: {fmtCtx(m.context_length)}
                      </div>
                      <div style={{ display: 'flex', gap: 24, flexWrap: 'wrap' }}>
                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT }}>INPUT /1M</span>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#059669', fontFamily: FONT }}>
                            {fmt(m.input_price_per_1m)}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT }}>OUTPUT /1M</span>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#dc2626', fontFamily: FONT }}>
                            {fmt(m.output_price_per_1m)}
                          </div>
                        </div>
                        <div>
                          <span style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT }}>EST. /SESSION</span>
                          <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                            ${(((1200/1e6)*parseFloat(m.input_price_per_1m||0)) + ((150/1e6)*parseFloat(m.output_price_per_1m||0))) * 20 < 0.00001
                              ? '<$0.00001'
                              : (((1200/1e6)*parseFloat(m.input_price_per_1m||0)) + ((150/1e6)*parseFloat(m.output_price_per_1m||0))*20).toFixed(5)
                            }
                          </div>
                        </div>
                      </div>

                      {/* Notes */}
                      {editingId === m.id ? (
                        <div style={{ marginTop: 10, display: 'flex', gap: 8 }}>
                          <input
                            value={editNotes}
                            onChange={e => setEditNotes(e.target.value)}
                            placeholder="Notes..."
                            style={{
                              flex: 1, padding: '6px 10px', border: '1.5px solid #cbd5e1',
                              borderRadius: 6, fontFamily: FONT, fontSize: '0.82rem',
                            }}
                          />
                          <button style={btn('green')} onClick={() => handleSaveNotes(m.id)}>Save</button>
                          <button style={btn('ghost')} onClick={() => setEditingId(null)}>Cancel</button>
                        </div>
                      ) : m.notes ? (
                        <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#64748b', fontFamily: FONT }}>
                          📝 {m.notes}
                        </div>
                      ) : null}
                    </div>

                    {/* Actions */}
                    <div style={{ display: 'flex', gap: 6, flexShrink: 0 }}>
                      {!m.is_default && (
                        <button
                          onClick={() => handleSetDefault(m.id)}
                          title="Set as default"
                          style={{ ...btn('ghost'), padding: '6px 10px', display: 'flex', alignItems: 'center', gap: 4 }}
                        >
                          <Star size={13} /> Default
                        </button>
                      )}
                      <button
                        onClick={() => { setEditingId(m.id); setEditNotes(m.notes || ''); }}
                        title="Edit notes"
                        style={{ ...btn('ghost'), padding: '6px 10px' }}
                      >
                        <Edit2 size={13} />
                      </button>
                      <button
                        onClick={() => handleRemove(m.id, m.display_name)}
                        title="Remove model"
                        style={{ ...btn('red'), padding: '6px 10px' }}
                      >
                        <Trash2 size={13} />
                      </button>
                    </div>
                  </div>
                </div>
              ))
            )}
          </>
        )}

        {/* ══ BROWSE TAB ═════════════════════════════════════════════════════ */}
        {tab === 'browse' && (
          <>
            {/* Filters */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                <Search size={14} style={{ position: 'absolute', left: 10, top: '50%', transform: 'translateY(-50%)', color: '#94a3b8' }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search models..."
                  style={{
                    width: '100%', paddingLeft: 32, padding: '8px 12px 8px 32px',
                    border: '1.5px solid #e2e8f0', borderRadius: 8,
                    fontFamily: FONT, fontSize: '0.85rem', boxSizing: 'border-box',
                  }}
                />
              </div>
              <select
                value={providerFilter}
                onChange={e => setProviderFilter(e.target.value)}
                style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem' }}
              >
                {providers.map(p => <option key={p} value={p}>{p === 'all' ? 'All Providers' : p}</option>)}
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{ padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem' }}
              >
                <option value="price">Sort: Lowest Price</option>
                <option value="context">Sort: Largest Context</option>
                <option value="name">Sort: Name A–Z</option>
              </select>
              <button style={btn('ghost')} onClick={loadBrowse} title="Refresh">
                <RefreshCw size={14} />
              </button>
            </div>

            {browseLoading ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontFamily: FONT }}>
                Fetching models from OpenRouter...
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 10 }}>
                  Showing {filtered.length} text-capable models
                </div>

                {/* Table header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 100px 110px 110px 80px 80px',
                  gap: 8, padding: '8px 16px',
                  background: '#f8fafc', borderRadius: 8, marginBottom: 4,
                  fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8',
                  fontFamily: FONT, letterSpacing: '0.05em',
                }}>
                  <div>MODEL</div>
                  <div>PROVIDER</div>
                  <div>CONTEXT</div>
                  <div>INPUT /1M</div>
                  <div>OUTPUT /1M</div>
                  <div>CAPS</div>
                  <div></div>
                </div>

                {filtered.map(m => {
                  const already = activeIds.has(m.id);
                  return (
                    <div key={m.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1fr 100px 110px 110px 80px 80px',
                      gap: 8, padding: '10px 16px',
                      background: 'white', borderRadius: 8,
                      border: '1.5px solid #f1f5f9',
                      marginBottom: 4, alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>
                          {m.name}
                        </div>
                        <div style={{ fontFamily: FONT, fontSize: '0.72rem', color: '#94a3b8' }}>
                          {m.id}
                        </div>
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '0.82rem', color: '#475569' }}>
                        {m.provider}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '0.82rem', color: '#475569' }}>
                        {fmtCtx(m.context_length)}
                      </div>
                      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: '0.85rem', color: '#059669' }}>
                        {fmt(m.input_price_per_1m)}
                      </div>
                      <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: '0.85rem', color: '#dc2626' }}>
                        {fmt(m.output_price_per_1m)}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {m.supports_reasoning && <Brain size={13} color="#7c3aed" title="Reasoning" />}
                        {m.supports_vision    && <Eye   size={13} color="#0ea5e9" title="Vision" />}
                      </div>
                      <div>
                        {already ? (
                          <span style={{ fontSize: '0.75rem', color: '#059669', fontFamily: FONT, fontWeight: 600 }}>
                            ✓ Active
                          </span>
                        ) : (
                          <button
                            style={{ ...btn('primary'), padding: '5px 10px', fontSize: '0.78rem' }}
                            onClick={() => setActForm({ ...m, displayName: m.name, notes: '', reasoningLevel: 'off' })}
                          >
                            + Add
                          </button>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ══ ACTIVATE SLIDE-IN FORM ════════════════════════════════════════ */}
        {activateForm && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.4)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999,
          }}>
            <div style={{
              background: 'white', borderRadius: 16, padding: 28,
              width: 460, maxWidth: '95vw', boxShadow: '0 20px 60px rgba(0,0,0,0.2)',
            }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20 }}>
                <h2 style={{ fontFamily: FONT, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                  Activate Model
                </h2>
                <button onClick={() => setActForm(null)} style={{ background: 'none', border: 'none', cursor: 'pointer' }}>
                  <X size={18} color="#94a3b8" />
                </button>
              </div>

              {/* Model info */}
              <div style={{ background: '#f8fafc', borderRadius: 8, padding: '12px 14px', marginBottom: 16 }}>
                <div style={{ fontFamily: FONT, fontWeight: 600, color: '#1e293b', marginBottom: 2 }}>
                  {activateForm.name}
                </div>
                <div style={{ fontFamily: FONT, fontSize: '0.78rem', color: '#64748b' }}>
                  {activateForm.id} · {activateForm.provider}
                </div>
                <div style={{ display: 'flex', gap: 20, marginTop: 8 }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT }}>INPUT /1M</div>
                    <div style={{ fontWeight: 700, color: '#059669', fontFamily: FONT }}>{fmt(activateForm.input_price_per_1m)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT }}>OUTPUT /1M</div>
                    <div style={{ fontWeight: 700, color: '#dc2626', fontFamily: FONT }}>{fmt(activateForm.output_price_per_1m)}</div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT }}>CONTEXT</div>
                    <div style={{ fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>{fmtCtx(activateForm.context_length)}</div>
                  </div>
                </div>
              </div>

              {/* Display name */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>
                  Display Name *
                </label>
                <input
                  value={activateForm.displayName}
                  onChange={e => setActForm(f => ({ ...f, displayName: e.target.value }))}
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 14 }}>
                <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 5 }}>
                  Notes <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                </label>
                <input
                  value={activateForm.notes}
                  onChange={e => setActForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Fast, cost-efficient for surveys"
                  style={{ width: '100%', padding: '8px 12px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem', boxSizing: 'border-box' }}
                />
              </div>

              {/* Reasoning level — only shown if model supports it */}
              {activateForm.supports_reasoning && (
                <div style={{ marginBottom: 14 }}>
                  <label style={{ fontSize: '0.8rem', fontWeight: 600, color: '#374151', fontFamily: FONT, display: 'block', marginBottom: 8 }}>
                    Reasoning Level
                  </label>
                  <div style={{ display: 'flex', gap: 8 }}>
                    {['off','low','medium','high'].map(level => (
                      <button
                        key={level}
                        onClick={() => setActForm(f => ({ ...f, reasoningLevel: level }))}
                        style={{
                          flex: 1, padding: '7px 0', borderRadius: 7, fontFamily: FONT,
                          fontWeight: 600, fontSize: '0.8rem', cursor: 'pointer',
                          border: '1.5px solid',
                          borderColor: activateForm.reasoningLevel === level ? '#7c3aed' : '#e2e8f0',
                          background:  activateForm.reasoningLevel === level ? '#ede9fe' : 'white',
                          color:       activateForm.reasoningLevel === level ? '#7c3aed' : '#64748b',
                        }}
                      >
                        {level.charAt(0).toUpperCase() + level.slice(1)}
                      </button>
                    ))}
                  </div>
                </div>
              )}

              {/* Cost preview */}
              <div style={{ background: '#f0fdf4', border: '1px solid #bbf7d0', borderRadius: 8, padding: '10px 14px', marginBottom: 20 }}>
                <div style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, marginBottom: 4 }}>
                  ESTIMATED COST (20 questions · 1,200 avg input tokens · 150 avg output tokens)
                </div>
                <div style={{ display: 'flex', gap: 24 }}>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT }}>PER SESSION</div>
                    <div style={{ fontWeight: 700, color: '#059669', fontFamily: FONT }}>
                      ${(((1200/1e6)*parseFloat(activateForm.input_price_per_1m||0) + (150/1e6)*parseFloat(activateForm.output_price_per_1m||0)) * 20).toFixed(6)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT }}>PER 100 SESSIONS</div>
                    <div style={{ fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                      ${(((1200/1e6)*parseFloat(activateForm.input_price_per_1m||0) + (150/1e6)*parseFloat(activateForm.output_price_per_1m||0)) * 20 * 100).toFixed(4)}
                    </div>
                  </div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: 10 }}>
                <button onClick={() => setActForm(null)} style={{ ...btn('ghost'), flex: 1, padding: '10px 0' }}>
                  Cancel
                </button>
                <button onClick={handleActivate} style={{ ...btn('primary'), flex: 2, padding: '10px 0' }}>
                  Activate Model
                </button>
              </div>
            </div>
          </div>
        )}

        {/* ── Toast ── */}
        {toast && (
          <div style={{
            position: 'fixed', bottom: 24, right: 24, zIndex: 99999,
            background: toast.type === 'error' ? '#ef4444' : '#059669',
            color: 'white', borderRadius: 10, padding: '12px 20px',
            fontFamily: FONT, fontWeight: 600, fontSize: '0.88rem',
            boxShadow: '0 4px 20px rgba(0,0,0,0.15)',
          }}>
            {toast.msg}
          </div>
        )}
      </div>
    </Layout>
  );
}