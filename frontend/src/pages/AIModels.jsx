import React, { useState, useEffect, useCallback } from 'react';
import Layout from '../components/Layout';
import api from '../api';
import {
  Search, RefreshCw, Star, Trash2, Edit2,
  X, Brain, Eye, ChevronDown, ChevronUp,
} from 'lucide-react';

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Indian number formatting ─────────────────────────────────────────────────
// Formats numbers using the Indian numbering system (lakhs, crores)
// e.g. 1500000 → 15,00,000  |  0.000159 → 0.000159
const fmtIN = (num, decimals = 6) => {
  if (num === null || num === undefined || isNaN(num)) return '0';
  return new Intl.NumberFormat('en-IN', {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  }).format(num);
};

// Smart formatter: uses more decimals for very small numbers, fewer for large
const fmtCost = (num) => {
  if (!num || isNaN(num)) return '$0.00';
  if (num < 0.000001)  return `$${fmtIN(num, 8)}`;
  if (num < 0.001)     return `$${fmtIN(num, 6)}`;
  if (num < 1)         return `$${fmtIN(num, 4)}`;
  return `$${fmtIN(num, 2)}`;
};

// Format price per 1M tokens (always 4 decimals)
const fmtPrice = (num) => {
  if (!num || isNaN(num)) return '$0.0000';
  return `$${fmtIN(parseFloat(num), 4)}`;
};

// Format context window size
const fmtCtx = (n) => {
  if (!n) return '—';
  if (n >= 1_000_000) return `${fmtIN(n / 1_000_000, 0)}M`;
  if (n >= 1_000)     return `${fmtIN(n / 1_000, 0)}K`;
  return String(n);
};

// ─── Cost calculator — pure function, no side effects ─────────────────────────
const calcCost = (model, reasoningLevel, Q = 20, IN = 1200, OUT = 150) => {
  const inPrice     = parseFloat(model?.input_price_per_1m        || 0);
  const outPrice    = parseFloat(model?.output_price_per_1m       || 0);
  const rsnPrice    = parseFloat(model?.reasoning_price_per_1m    || 0);
  const multiplier  = { off: 0, low: 0.3, medium: 1.0, high: 3.0 }[reasoningLevel || 'off'] || 0;
  const rsnTokens   = OUT * multiplier;

  const perCallIn   = (IN         / 1_000_000) * inPrice;
  const perCallOut  = (OUT        / 1_000_000) * outPrice;
  const perCallRsn  = (rsnTokens  / 1_000_000) * rsnPrice;
  const perCall     = perCallIn + perCallOut + perCallRsn;
  const perSession  = perCall * Q;

  return {
    perCallIn, perCallOut, perCallRsn, perCall,
    perSession,
    per100:  perSession * 100,
    per1000: perSession * 1000,
    rsnTokens: Math.round(rsnTokens),
  };
};

// ─── Small reusable components ─────────────────────────────────────────────────
const Badge = ({ label, color, bg, border }) => (
  <span style={{
    fontSize: '0.68rem', fontWeight: 700, padding: '2px 8px',
    borderRadius: 20, background: bg, color,
    border: border ? `1px solid ${border}` : 'none',
    fontFamily: FONT, whiteSpace: 'nowrap',
  }}>{label}</span>
);

const Btn = ({ onClick, children, variant = 'primary', style = {}, title, disabled }) => {
  const styles = {
    primary: { background: '#1e3a5f', color: 'white', border: 'none' },
    ghost:   { background: '#f1f5f9', color: '#475569', border: '1px solid #e2e8f0' },
    red:     { background: '#fef2f2', color: '#ef4444', border: '1px solid #fecaca' },
    green:   { background: '#f0fdf4', color: '#059669', border: '1px solid #bbf7d0' },
    purple:  { background: '#faf5ff', color: '#7c3aed', border: '1px solid #e9d5ff' },
  };
  return (
    <button
      onClick={onClick}
      title={title}
      disabled={disabled}
      style={{
        ...styles[variant],
        padding: '7px 14px', borderRadius: 7, fontFamily: FONT,
        fontWeight: 600, fontSize: '0.82rem', cursor: disabled ? 'not-allowed' : 'pointer',
        display: 'flex', alignItems: 'center', gap: 5,
        opacity: disabled ? 0.5 : 1,
        ...style,
      }}
    >
      {children}
    </button>
  );
};

// ─── Cost Preview Block ────────────────────────────────────────────────────────
// Renders real-time cost estimate — updates when reasoning level changes
const CostPreview = ({ model, reasoningLevel }) => {
  const c = calcCost(model, reasoningLevel);
  const hasRsn = c.rsnTokens > 0;

  return (
    <div style={{
      background: '#f0fdf4', border: '1px solid #bbf7d0',
      borderRadius: 8, padding: '12px 14px',
    }}>
      <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, marginBottom: 10 }}>
        ESTIMATED COST — 20 questions · 1,200 input tokens · 150 output tokens
        {hasRsn && ` · ~${fmtIN(c.rsnTokens, 0)} reasoning tokens`} per AI call
      </div>

      {/* Per-call breakdown shown only when reasoning is active */}
      {hasRsn && (
        <div style={{
          fontSize: '0.75rem', fontFamily: FONT, marginBottom: 10,
          display: 'flex', flexDirection: 'column', gap: 3,
        }}>
          <div style={{ color: '#64748b' }}>
            Input:&nbsp;&nbsp;&nbsp;&nbsp;
            <strong style={{ color: '#1e293b' }}>{fmtCost(c.perCallIn)}/call</strong>
          </div>
          <div style={{ color: '#64748b' }}>
            Output:&nbsp;&nbsp;&nbsp;
            <strong style={{ color: '#1e293b' }}>{fmtCost(c.perCallOut)}/call</strong>
          </div>
          <div style={{ color: '#7c3aed' }}>
            Reasoning:
            <strong style={{ color: '#7c3aed' }}> {fmtCost(c.perCallRsn)}/call</strong>
            <span style={{ color: '#94a3b8', fontSize: '0.68rem' }}> (billed at {fmtPrice(model.reasoning_price_per_1m)}/1M)</span>
          </div>
        </div>
      )}

      {/* Main cost numbers */}
      <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
        <div>
          <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 2 }}>
            PER SESSION
          </div>
          <div style={{
            fontSize: '1rem', fontWeight: 800, fontFamily: FONT,
            color: hasRsn ? '#7c3aed' : '#059669',
          }}>
            {fmtCost(c.perSession)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 2 }}>
            PER 100 SESSIONS
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: FONT, color: '#1e3a5f' }}>
            {fmtCost(c.per100)}
          </div>
        </div>
        <div>
          <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 2 }}>
            PER 1,000 SESSIONS
          </div>
          <div style={{ fontSize: '1rem', fontWeight: 800, fontFamily: FONT, color: '#1e3a5f' }}>
            {fmtCost(c.per1000)}
          </div>
        </div>
      </div>
    </div>
  );
};

// ─── Reasoning Level Selector ──────────────────────────────────────────────────
const ReasoningSelector = ({ value, onChange, reasoningPricePer1m }) => (
  <div style={{ marginBottom: 14 }}>
    <label style={{
      fontSize: '0.8rem', fontWeight: 600, color: '#374151',
      fontFamily: FONT, display: 'block', marginBottom: 8,
    }}>
      Reasoning Level
    </label>
    <div style={{ display: 'flex', gap: 8, marginBottom: 8 }}>
      {['off', 'low', 'medium', 'high'].map(level => (
        <button
          key={level}
          onClick={() => onChange(level)}
          style={{
            flex: 1, padding: '8px 0', borderRadius: 7, fontFamily: FONT,
            fontWeight: 600, fontSize: '0.82rem', cursor: 'pointer',
            border: '1.5px solid',
            borderColor: value === level ? '#7c3aed' : '#e2e8f0',
            background:  value === level ? '#ede9fe' : 'white',
            color:       value === level ? '#7c3aed' : '#64748b',
            transition: 'all 0.15s',
          }}
        >
          {level === 'off' ? 'Off' : level.charAt(0).toUpperCase() + level.slice(1)}
        </button>
      ))}
    </div>
    {value !== 'off' && reasoningPricePer1m > 0 && (
      <div style={{
        fontSize: '0.75rem', color: '#7c3aed', fontFamily: FONT,
        background: '#faf5ff', border: '1px solid #e9d5ff',
        borderRadius: 6, padding: '6px 10px',
      }}>
        ⚡ Reasoning tokens billed at <strong>{fmtPrice(reasoningPricePer1m)}/1M tokens</strong>
        {' '}— charged on top of standard output rate
      </div>
    )}
  </div>
);

// ══════════════════════════════════════════════════════════════════════════════
// MAIN COMPONENT
// ══════════════════════════════════════════════════════════════════════════════
export default function AIModels() {
  const [tab, setTab]             = useState('active');
  const [activeModels, setActive] = useState([]);
  const [browseModels, setBrowse] = useState([]);
  const [loading, setLoading]     = useState(false);
  const [browseLoading, setBrowseLoading] = useState(false);
  const [search, setSearch]       = useState('');
  const [providerFilter, setProviderFilter] = useState('all');
  const [sortBy, setSortBy]       = useState('price');
  const [activateForm, setActForm] = useState(null);
  const [estimate, setEstimate]   = useState(null);
  const [toast, setToast]         = useState(null);
  const [editingId, setEditingId] = useState(null);
  const [editNotes, setEditNotes] = useState('');
  const [expandedId, setExpandedId] = useState(null);

  const showToast = (msg, type = 'success') => {
    setToast({ msg, type });
    setTimeout(() => setToast(null), 3500);
  };

  // ── Load active models ─────────────────────────────────────────────────────
  const loadActive = useCallback(async () => {
    setLoading(true);
    try {
      const res = await api.get('/openrouter/active');
      setActive(res.data.models || []);
    } catch { showToast('Failed to load active models', 'error'); }
    finally  { setLoading(false); }
  }, []);

  useEffect(() => { loadActive(); }, [loadActive]);

  // ── Load cost estimate for default model ───────────────────────────────────
  const loadEstimate = async () => {
    try {
      const res = await api.get(
        '/openrouter/estimate?questionCount=20&avgInputTokens=1200&avgOutputTokens=150'
      );
      setEstimate(res.data);
    } catch { setEstimate(null); }
  };
  useEffect(() => { loadEstimate(); }, [activeModels]);

  // ── Browse live models from OpenRouter ────────────────────────────────────
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

  // ── Activate model ─────────────────────────────────────────────────────────
  const handleActivate = async () => {
    if (!activateForm) return;
    try {
      await api.post('/openrouter/activate', {
        modelId:              activateForm.id,
        displayName:          activateForm.displayName || activateForm.name,
        provider:             activateForm.provider,
        inputPricePer1m:      activateForm.input_price_per_1m,
        outputPricePer1m:     activateForm.output_price_per_1m,
        reasoningPricePer1m:  activateForm.reasoning_price_per_1m || 0,
        contextLength:        activateForm.context_length,
        supportsReasoning:    activateForm.supports_reasoning,
        reasoningLevel:       activateForm.reasoningLevel || 'off',
        notes:                activateForm.notes || '',
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
    } catch { showToast('Failed to save', 'error'); }
  };

  // ── Derived browse list ────────────────────────────────────────────────────
  const activeIds = new Set(activeModels.map(m => m.model_id));
  const providers = ['all', ...new Set(browseModels.map(m => m.provider))].sort();

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

  // ── Tab button style ───────────────────────────────────────────────────────
  const tabBtn = (active) => ({
    padding: '8px 20px', borderRadius: 8, fontFamily: FONT,
    fontWeight: 600, fontSize: '0.88rem', cursor: 'pointer', border: 'none',
    background: active ? '#1e3a5f' : 'transparent',
    color:      active ? 'white'    : '#64748b',
    transition: 'all 0.15s',
  });

  // ─────────────────────────────────────────────────────────────────────────
  return (
    <Layout>
      <div style={{ maxWidth: 1100, margin: '0 auto', padding: '24px 16px' }}>

        {/* ── Page header ─────────────────────────────────────────────────── */}
        <div style={{
          display: 'flex', justifyContent: 'space-between',
          alignItems: 'center', marginBottom: 24, flexWrap: 'wrap', gap: 12,
        }}>
          <div>
            <h1 style={{
              fontFamily: FONT, fontSize: '1.5rem', fontWeight: 700,
              color: '#1e293b', margin: 0,
            }}>
              AI Models
            </h1>
            <p style={{
              fontFamily: FONT, fontSize: '0.85rem',
              color: '#64748b', margin: '4px 0 0',
            }}>
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

        {/* ── Cost estimate banner — shown when a default model exists ───── */}
        {estimate && tab === 'active' && (
          <div style={{
            background: 'linear-gradient(135deg, #f0f7ff 0%, #e8f4fd 100%)',
            border: '1.5px solid #bfdbfe', borderRadius: 12,
            padding: '16px 20px', marginBottom: 20,
            display: 'flex', gap: 32, flexWrap: 'wrap', alignItems: 'flex-start',
          }}>
            {/* Model name */}
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                DEFAULT MODEL
              </div>
              <div style={{ fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', fontFamily: FONT }}>
                {estimate.model?.display_name}
              </div>
              <code style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT }}>
                {estimate.model?.id}
              </code>
            </div>

            {/* Pricing */}
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                PRICING / 1M TOKENS
              </div>
              <div style={{ fontSize: '0.85rem', color: '#1e293b', fontFamily: FONT, lineHeight: 1.7 }}>
                <span style={{ color: '#059669' }}>↑ {fmtPrice(estimate.model?.input_price_per_1m)} input</span>
                {' · '}
                <span style={{ color: '#dc2626' }}>↓ {fmtPrice(estimate.model?.output_price_per_1m)} output</span>
                {estimate.model?.reasoning_price_per_1m > 0 && (
                  <>
                    {' · '}
                    <span style={{ color: '#7c3aed' }}>
                      ⚡ {fmtPrice(estimate.model?.reasoning_price_per_1m)} reasoning
                    </span>
                  </>
                )}
              </div>
              {estimate.model?.reasoning_level && estimate.model.reasoning_level !== 'off' && (
                <div style={{ fontSize: '0.72rem', color: '#7c3aed', fontFamily: FONT, marginTop: 2 }}>
                  Reasoning level: {estimate.model.reasoning_level}
                </div>
              )}
            </div>

            {/* Per session */}
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                EST. COST / SESSION
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#059669', fontFamily: FONT }}>
                {fmtCost(estimate.per_session?.total_usd)}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>
                {fmtIN(estimate.assumptions?.questionCount, 0)} questions ·{' '}
                {fmtIN(estimate.assumptions?.avgInputTokens, 0)} avg input tokens
              </div>
            </div>

            {/* Per 100 */}
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                PER 100 SESSIONS
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e3a5f', fontFamily: FONT }}>
                {fmtCost(estimate.per_100_sessions?.total_usd)}
              </div>
            </div>

            {/* Per 1000 */}
            <div>
              <div style={{ fontSize: '0.72rem', color: '#64748b', fontFamily: FONT, fontWeight: 600, marginBottom: 2 }}>
                PER 1,000 SESSIONS
              </div>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color: '#1e3a5f', fontFamily: FONT }}>
                {fmtCost(estimate.per_1000_sessions?.total_usd)}
              </div>
              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>
                AI cost only · excludes proxy
              </div>
            </div>
          </div>
        )}

        {/* ══ ACTIVE MODELS TAB ═══════════════════════════════════════════ */}
        {tab === 'active' && (
          <>
            {loading ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontFamily: FONT }}>
                Loading active models...
              </div>
            ) : activeModels.length === 0 ? (
              <div style={{
                textAlign: 'center', padding: 64, background: 'white',
                borderRadius: 12, border: '1.5px dashed #e2e8f0',
              }}>
                <Brain size={40} color="#cbd5e1" style={{ marginBottom: 12 }} />
                <div style={{ fontFamily: FONT, fontWeight: 600, color: '#475569', marginBottom: 6 }}>
                  No models activated yet
                </div>
                <div style={{ fontFamily: FONT, fontSize: '0.85rem', color: '#94a3b8', marginBottom: 20 }}>
                  Browse OpenRouter's model library and add models to use in your sessions
                </div>
                <Btn onClick={() => setTab('browse')}>Browse Models</Btn>
              </div>
            ) : (
              activeModels.map(m => {
                const c       = calcCost(m, m.reasoning_level);
                const isExpanded = expandedId === m.id;
                const hasRsn  = m.supports_reasoning && parseFloat(m.reasoning_price_per_1m || 0) > 0;

                return (
                  <div key={m.id} style={{
                    background: 'white',
                    border: m.is_default ? '2px solid #1e3a5f' : '1.5px solid #e2e8f0',
                    borderRadius: 12, marginBottom: 12, overflow: 'hidden',
                  }}>
                    {/* Card header */}
                    <div style={{ padding: '16px 20px' }}>
                      <div style={{ display: 'flex', alignItems: 'flex-start', gap: 12 }}>
                        <div style={{ flex: 1 }}>
                          {/* Name + badges */}
                          <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 4, flexWrap: 'wrap' }}>
                            <span style={{ fontFamily: FONT, fontWeight: 700, fontSize: '1rem', color: '#1e293b' }}>
                              {m.display_name}
                            </span>
                            {m.is_default && <Badge label="DEFAULT" color="#1e3a5f" bg="#dbeafe" />}
                            {hasRsn && m.reasoning_level !== 'off' && (
                              <Badge
                                label={`REASONING: ${m.reasoning_level.toUpperCase()}`}
                                color="#7c3aed" bg="#ede9fe"
                              />
                            )}
                          </div>

                          {/* Model ID + provider + context */}
                          <div style={{ fontFamily: FONT, fontSize: '0.8rem', color: '#64748b', marginBottom: 10 }}>
                            <code style={{ background: '#f1f5f9', padding: '2px 6px', borderRadius: 4, fontSize: '0.77rem' }}>
                              {m.model_id}
                            </code>
                            {' · '}{m.provider}
                            {' · '}Context: {fmtCtx(m.context_length)}
                          </div>

                          {/* Pricing row */}
                          <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>INPUT /1M</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#059669', fontFamily: FONT }}>
                                {fmtPrice(m.input_price_per_1m)}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>OUTPUT /1M</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#dc2626', fontFamily: FONT }}>
                                {fmtPrice(m.output_price_per_1m)}
                              </div>
                            </div>
                            {hasRsn && (
                              <div>
                                <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>REASONING /1M</div>
                                <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#7c3aed', fontFamily: FONT }}>
                                  {fmtPrice(m.reasoning_price_per_1m)}
                                </div>
                              </div>
                            )}
                            <div>
                              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>EST. /SESSION</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                                {fmtCost(c.perSession)}
                              </div>
                            </div>
                            <div>
                              <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>EST. /1,000</div>
                              <div style={{ fontSize: '0.9rem', fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                                {fmtCost(c.per1000)}
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
                                  flex: 1, padding: '6px 10px',
                                  border: '1.5px solid #cbd5e1', borderRadius: 6,
                                  fontFamily: FONT, fontSize: '0.82rem',
                                }}
                              />
                              <Btn variant="green" onClick={() => handleSaveNotes(m.id)}>Save</Btn>
                              <Btn variant="ghost" onClick={() => setEditingId(null)}>Cancel</Btn>
                            </div>
                          ) : m.notes ? (
                            <div style={{ marginTop: 8, fontSize: '0.8rem', color: '#64748b', fontFamily: FONT }}>
                              📝 {m.notes}
                            </div>
                          ) : null}
                        </div>

                        {/* Action buttons */}
                        <div style={{ display: 'flex', gap: 6, flexShrink: 0, flexWrap: 'wrap' }}>
                          {!m.is_default && (
                            <Btn variant="ghost" onClick={() => handleSetDefault(m.id)} title="Set as default">
                              <Star size={13} /> Default
                            </Btn>
                          )}
                          <Btn variant="ghost" title="Edit notes"
                            onClick={() => { setEditingId(m.id); setEditNotes(m.notes || ''); }}
                            style={{ padding: '7px 10px' }}>
                            <Edit2 size={13} />
                          </Btn>
                          <Btn variant="ghost" title="Show cost breakdown"
                            onClick={() => setExpandedId(isExpanded ? null : m.id)}
                            style={{ padding: '7px 10px' }}>
                            {isExpanded ? <ChevronUp size={13} /> : <ChevronDown size={13} />}
                          </Btn>
                          <Btn variant="red" title="Remove model"
                            onClick={() => handleRemove(m.id, m.display_name)}
                            style={{ padding: '7px 10px' }}>
                            <Trash2 size={13} />
                          </Btn>
                        </div>
                      </div>
                    </div>

                    {/* Expanded cost breakdown */}
                    {isExpanded && (
                      <div style={{
                        borderTop: '1px solid #f1f5f9',
                        padding: '14px 20px',
                        background: '#fafafa',
                      }}>
                        <CostPreview model={m} reasoningLevel={m.reasoning_level || 'off'} />
                      </div>
                    )}
                  </div>
                );
              })
            )}
          </>
        )}

        {/* ══ BROWSE TAB ══════════════════════════════════════════════════ */}
        {tab === 'browse' && (
          <>
            {/* Filters bar */}
            <div style={{ display: 'flex', gap: 10, marginBottom: 16, flexWrap: 'wrap' }}>
              <div style={{ flex: 1, minWidth: 200, position: 'relative' }}>
                <Search size={14} style={{
                  position: 'absolute', left: 10, top: '50%',
                  transform: 'translateY(-50%)', color: '#94a3b8',
                }} />
                <input
                  value={search}
                  onChange={e => setSearch(e.target.value)}
                  placeholder="Search models..."
                  style={{
                    width: '100%', paddingLeft: 32, padding: '9px 12px 9px 32px',
                    border: '1.5px solid #e2e8f0', borderRadius: 8,
                    fontFamily: FONT, fontSize: '0.85rem', boxSizing: 'border-box',
                    outline: 'none',
                  }}
                />
              </div>
              <select
                value={providerFilter}
                onChange={e => setProviderFilter(e.target.value)}
                style={{
                  padding: '9px 12px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem',
                  outline: 'none', background: 'white',
                }}
              >
                {providers.map(p => (
                  <option key={p} value={p}>{p === 'all' ? 'All Providers' : p}</option>
                ))}
              </select>
              <select
                value={sortBy}
                onChange={e => setSortBy(e.target.value)}
                style={{
                  padding: '9px 12px', border: '1.5px solid #e2e8f0',
                  borderRadius: 8, fontFamily: FONT, fontSize: '0.85rem',
                  outline: 'none', background: 'white',
                }}
              >
                <option value="price">Lowest Price</option>
                <option value="context">Largest Context</option>
                <option value="name">Name A–Z</option>
              </select>
              <Btn variant="ghost" onClick={loadBrowse} title="Refresh from OpenRouter"
                style={{ padding: '9px 12px' }}>
                <RefreshCw size={14} />
              </Btn>
            </div>

            {browseLoading ? (
              <div style={{ textAlign: 'center', padding: 48, color: '#94a3b8', fontFamily: FONT }}>
                Fetching models from OpenRouter...
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.8rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 10 }}>
                  Showing {fmtIN(filtered.length, 0)} text-capable models
                </div>

                {/* Table header */}
                <div style={{
                  display: 'grid',
                  gridTemplateColumns: '2fr 1fr 90px 110px 110px 70px 80px',
                  gap: 8, padding: '8px 14px',
                  background: '#f8fafc', borderRadius: 8, marginBottom: 4,
                  fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8',
                  fontFamily: FONT, letterSpacing: '0.05em', textTransform: 'uppercase',
                }}>
                  <div>Model</div>
                  <div>Provider</div>
                  <div>Context</div>
                  <div>Input /1M</div>
                  <div>Output /1M</div>
                  <div>Caps</div>
                  <div></div>
                </div>

                {/* Table rows */}
                {filtered.map(m => {
                  const already = activeIds.has(m.id);
                  return (
                    <div key={m.id} style={{
                      display: 'grid',
                      gridTemplateColumns: '2fr 1fr 90px 110px 110px 70px 80px',
                      gap: 8, padding: '10px 14px',
                      background: 'white', borderRadius: 8,
                      border: '1.5px solid #f1f5f9',
                      marginBottom: 4, alignItems: 'center',
                    }}>
                      <div>
                        <div style={{ fontFamily: FONT, fontWeight: 600, fontSize: '0.85rem', color: '#1e293b' }}>
                          {m.name}
                        </div>
                        <div style={{ fontFamily: FONT, fontSize: '0.7rem', color: '#94a3b8', marginTop: 1 }}>
                          {m.id}
                        </div>
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '0.82rem', color: '#475569' }}>
                        {m.provider}
                      </div>
                      <div style={{ fontFamily: FONT, fontSize: '0.82rem', color: '#475569' }}>
                        {fmtCtx(m.context_length)}
                      </div>
                      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: '0.85rem', color: '#059669' }}>
                        {fmtPrice(m.input_price_per_1m)}
                      </div>
                      <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: '0.85rem', color: '#dc2626' }}>
                        {fmtPrice(m.output_price_per_1m)}
                      </div>
                      <div style={{ display: 'flex', gap: 4, flexWrap: 'wrap' }}>
                        {m.supports_reasoning && <Brain size={13} color="#7c3aed" title="Supports reasoning" />}
                        {m.supports_vision    && <Eye   size={13} color="#0ea5e9" title="Supports vision"   />}
                      </div>
                      <div>
                        {already ? (
                          <span style={{ fontSize: '0.75rem', color: '#059669', fontFamily: FONT, fontWeight: 700 }}>
                            ✓ Active
                          </span>
                        ) : (
                          <Btn
                            style={{ padding: '5px 10px', fontSize: '0.78rem' }}
                            onClick={() => setActForm({
                              ...m,
                              displayName:             m.name,
                              notes:                   '',
                              reasoningLevel:          'off',
                              reasoning_price_per_1m:  m.reasoning_price_per_1m || 0,
                            })}
                          >
                            + Add
                          </Btn>
                        )}
                      </div>
                    </div>
                  );
                })}
              </>
            )}
          </>
        )}

        {/* ══ ACTIVATE FORM MODAL ════════════════════════════════════════ */}
        {activateForm && (
          <div style={{
            position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.45)',
            display: 'flex', alignItems: 'center', justifyContent: 'center',
            zIndex: 9999, padding: 16,
          }}>
            <div style={{
              background: 'white', borderRadius: 16, padding: 28,
              width: 480, maxWidth: '100%', maxHeight: '90vh',
              overflowY: 'auto',
              boxShadow: '0 20px 60px rgba(0,0,0,0.25)',
            }}>
              {/* Header */}
              <div style={{
                display: 'flex', justifyContent: 'space-between',
                alignItems: 'center', marginBottom: 20,
              }}>
                <h2 style={{
                  fontFamily: FONT, fontSize: '1.1rem',
                  fontWeight: 700, color: '#1e293b', margin: 0,
                }}>
                  Activate Model
                </h2>
                <button onClick={() => setActForm(null)} style={{
                  background: 'none', border: 'none', cursor: 'pointer',
                }}>
                  <X size={18} color="#94a3b8" />
                </button>
              </div>

              {/* Model info card */}
              <div style={{
                background: '#f8fafc', borderRadius: 8,
                padding: '12px 14px', marginBottom: 16,
              }}>
                <div style={{ fontFamily: FONT, fontWeight: 700, color: '#1e293b', marginBottom: 2 }}>
                  {activateForm.name}
                </div>
                <div style={{ fontFamily: FONT, fontSize: '0.78rem', color: '#64748b', marginBottom: 10 }}>
                  {activateForm.id} · {activateForm.provider}
                </div>
                <div style={{ display: 'flex', gap: 20, flexWrap: 'wrap' }}>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>INPUT /1M</div>
                    <div style={{ fontWeight: 700, color: '#059669', fontFamily: FONT }}>
                      {fmtPrice(activateForm.input_price_per_1m)}
                    </div>
                  </div>
                  <div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>OUTPUT /1M</div>
                    <div style={{ fontWeight: 700, color: '#dc2626', fontFamily: FONT }}>
                      {fmtPrice(activateForm.output_price_per_1m)}
                    </div>
                  </div>
                  {activateForm.reasoning_price_per_1m > 0 && (
                    <div>
                      <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>REASONING /1M</div>
                      <div style={{ fontWeight: 700, color: '#7c3aed', fontFamily: FONT }}>
                        {fmtPrice(activateForm.reasoning_price_per_1m)}
                      </div>
                    </div>
                  )}
                  <div>
                    <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>CONTEXT</div>
                    <div style={{ fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                      {fmtCtx(activateForm.context_length)}
                    </div>
                  </div>
                </div>
              </div>

              {/* Display name */}
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  fontSize: '0.8rem', fontWeight: 600, color: '#374151',
                  fontFamily: FONT, display: 'block', marginBottom: 5,
                }}>
                  Display Name *
                </label>
                <input
                  value={activateForm.displayName}
                  onChange={e => setActForm(f => ({ ...f, displayName: e.target.value }))}
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1.5px solid #e2e8f0', borderRadius: 8,
                    fontFamily: FONT, fontSize: '0.85rem',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>

              {/* Notes */}
              <div style={{ marginBottom: 14 }}>
                <label style={{
                  fontSize: '0.8rem', fontWeight: 600, color: '#374151',
                  fontFamily: FONT, display: 'block', marginBottom: 5,
                }}>
                  Notes <span style={{ fontWeight: 400, color: '#94a3b8' }}>(optional)</span>
                </label>
                <input
                  value={activateForm.notes}
                  onChange={e => setActForm(f => ({ ...f, notes: e.target.value }))}
                  placeholder="e.g. Fast, cost-efficient for surveys"
                  style={{
                    width: '100%', padding: '8px 12px',
                    border: '1.5px solid #e2e8f0', borderRadius: 8,
                    fontFamily: FONT, fontSize: '0.85rem',
                    boxSizing: 'border-box', outline: 'none',
                  }}
                />
              </div>

              {/* Reasoning selector — only for models that support it */}
              {activateForm.supports_reasoning && (
                <ReasoningSelector
                  value={activateForm.reasoningLevel || 'off'}
                  onChange={level => setActForm(f => ({ ...f, reasoningLevel: level }))}
                  reasoningPricePer1m={activateForm.reasoning_price_per_1m || 0}
                />
              )}

              {/* Live cost preview — updates on every reasoning level change */}
              <div style={{ marginBottom: 20 }}>
                <CostPreview
                  model={activateForm}
                  reasoningLevel={activateForm.reasoningLevel || 'off'}
                />
              </div>

              {/* Action buttons */}
              <div style={{ display: 'flex', gap: 10 }}>
                <Btn variant="ghost" onClick={() => setActForm(null)} style={{ flex: 1, justifyContent: 'center', padding: '10px 0' }}>
                  Cancel
                </Btn>
                <Btn onClick={handleActivate} style={{ flex: 2, justifyContent: 'center', padding: '10px 0' }}>
                  Activate Model
                </Btn>
              </div>
            </div>
          </div>
        )}

        {/* ── Toast ────────────────────────────────────────────────────── */}
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