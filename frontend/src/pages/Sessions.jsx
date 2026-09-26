import React, { useState, useEffect, useCallback, useRef } from 'react';
import { useNavigate } from 'react-router-dom';
import Layout from '../components/Layout';
import api from '../api';
import {
  Activity, RefreshCw, X, FileText, StopCircle,
  Trash2, AlertCircle, CheckCircle, Filter, ChevronRight,
  BookOpen, Sparkles,
} from 'lucide-react';

const FONT = "'Google Sans', -apple-system, BlinkMacSystemFont, 'Segoe UI', sans-serif";

// ─── Helpers ──────────────────────────────────────────────────────────────────
const fmtDuration = (s) => {
  if (!s) return '—';
  if (s < 60) return `${s}s`;
  return `${Math.floor(s / 60)}m ${s % 60}s`;
};
const fmtTime = (dt) => {
  if (!dt) return '—';
  return new Date(dt).toLocaleString('en-IN', {
    day: 'numeric', month: 'short', hour: '2-digit', minute: '2-digit',
  });
};
const fmtCost = (n) => {
  if (!n || isNaN(parseFloat(n))) return '—';
  const num = parseFloat(n);
  if (num === 0) return '—';
  if (num < 0.001)  return `$${num.toFixed(6)}`;
  if (num < 1)      return `$${num.toFixed(4)}`;
  return `$${num.toLocaleString('en-IN', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
};
const fmtIN = (n) => new Intl.NumberFormat('en-IN').format(n || 0);

const SESSION_COLORS = {
  queued:       { bg: '#f1f5f9', text: '#64748b' },
  initialising: { bg: '#fef3c7', text: '#92400e' },
  in_progress:  { bg: '#dbeafe', text: '#1e40af' },
  completed:    { bg: '#dcfce7', text: '#166534' },
  terminated:   { bg: '#fce7f3', text: '#9d174d' },
  over_quota:   { bg: '#fef3c7', text: '#92400e' },
  error:        { bg: '#fef2f2', text: '#dc2626' },
  flagged:      { bg: '#fff7ed', text: '#c2410c' },
};
const OUTCOME_COLORS = {
  completed:  { bg: '#dcfce7', text: '#166534' },
  terminated: { bg: '#fce7f3', text: '#9d174d' },
  over_quota: { bg: '#fef3c7', text: '#92400e' },
  error:      { bg: '#fef2f2', text: '#dc2626' },
};

function Badge({ label, colors, style = {} }) {
  const c = colors?.[label] || { bg: '#f1f5f9', text: '#64748b' };
  return (
    <span style={{
      background: c.bg, color: c.text,
      borderRadius: 20, padding: '3px 10px',
      fontSize: '0.72rem', fontWeight: 700,
      fontFamily: FONT, whiteSpace: 'nowrap', ...style,
    }}>
      {label?.replace(/_/g, ' ')}
    </span>
  );
}

function Toast({ message, type, onClose }) {
  useEffect(() => { const t = setTimeout(onClose, 3500); return () => clearTimeout(t); }, []);
  const isErr = type === 'error';
  return (
    <div style={{
      position: 'fixed', bottom: 28, right: 28, zIndex: 9999,
      display: 'flex', alignItems: 'center', gap: 10,
      background: isErr ? '#fef2f2' : '#f0fdf4',
      border: `1.5px solid ${isErr ? '#fca5a5' : '#86efac'}`,
      borderRadius: 10, padding: '12px 18px',
      boxShadow: '0 8px 24px rgba(0,0,0,0.12)',
      fontFamily: FONT, fontSize: '0.88rem',
      color: isErr ? '#dc2626' : '#166534', fontWeight: 500,
    }}>
      {isErr ? <AlertCircle size={18} /> : <CheckCircle size={18} />}
      {message}
      <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'inherit', marginLeft: 8, padding: 0, display: 'flex' }}>
        <X size={14} />
      </button>
    </div>
  );
}

// ─── Session Report Modal (reused from ProjectDetail) ─────────────────────────
// Import via dynamic rendering — we open the project's session report directly
function SessionReportModal({ sessionId, projectId, onClose, showToast }) {
  const [detail, setDetail]   = useState(null);
  const [loading, setLoading] = useState(true);
  const [activePage, setActive] = useState(0);
  const API_BASE = import.meta.env.VITE_API_URL || '/api';

  useEffect(() => {
    api.get(`/sessions/${sessionId}`)
      .then(r => setDetail(r.data))
      .catch(() => setDetail(null))
      .finally(() => setLoading(false));
  }, [sessionId]);

  const pageEvents = () =>
    (detail?.events || [])
      .filter(e => e.event_type === 'page_view' || e.event_type === 'page_answered')
      .map(e => ({ ...e, payload: typeof e.payload === 'string' ? JSON.parse(e.payload) : e.payload }));

  if (loading) return (
    <div style={s.overlay}>
      <div style={{ background: 'white', borderRadius: 16, padding: 60, fontFamily: FONT, color: '#64748b', textAlign: 'center' }}>
        Loading session report...
      </div>
    </div>
  );
  if (!detail) return (
    <div style={s.overlay}>
      <div style={{ background: 'white', borderRadius: 16, padding: 32, maxWidth: 440, width: '100%', textAlign: 'center' }}>
        <p style={{ fontFamily: FONT, color: '#64748b' }}>Session details not available.</p>
        <button style={s.cancelBtn} onClick={onClose}>Close</button>
      </div>
    </div>
  );

  const { session } = detail;
  const pages = pageEvents();
  const ipEvent = (detail.events || []).find(e => e.event_type === 'ip_assigned');
  const ipPayload = ipEvent ? (typeof ipEvent.payload === 'string' ? JSON.parse(ipEvent.payload) : ipEvent.payload) : null;
  const activePg = pages[activePage];
  const oc = OUTCOME_COLORS[session.outcome] || OUTCOME_COLORS.error;

  return (
    <div style={{ ...s.overlay, alignItems: 'flex-start', paddingTop: 20 }}>
      <div style={{
        background: 'white', borderRadius: 16, width: '100%', maxWidth: 1020,
        maxHeight: '94vh', display: 'flex', flexDirection: 'column',
        boxShadow: '0 25px 50px rgba(0,0,0,0.3)',
      }}>
        {/* Header */}
        <div style={{ padding: '20px 24px', borderBottom: '1px solid #f1f5f9', display: 'flex', justifyContent: 'space-between', alignItems: 'center', flexWrap: 'wrap', gap: 12 }}>
          <div>
            <div style={{ display: 'flex', alignItems: 'center', gap: 10, marginBottom: 4 }}>
              <FileText size={18} color="#1e3a5f" />
              <h2 style={{ fontFamily: FONT, fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>Session Report</h2>
              <code style={{ fontFamily: 'monospace', fontSize: '0.82rem', color: '#64748b', background: '#f1f5f9', padding: '2px 8px', borderRadius: 4 }}>{session.id.slice(0, 8)}</code>
              <span style={{ background: oc.bg, color: oc.text, borderRadius: 20, padding: '3px 10px', fontSize: '0.75rem', fontWeight: 600, fontFamily: FONT }}>{session.outcome?.replace(/_/g,' ')}</span>
            </div>
            <div style={{ display: 'flex', gap: 16, flexWrap: 'wrap' }}>
              {[
                session.proxy_country && `🌍 ${session.proxy_country}`,
                session.device_type   && `💻 ${session.device_type}`,
                session.total_duration_s && `⏱ ${fmtDuration(session.total_duration_s)}`,
                session.response_id   && `🔑 ${session.response_id}`,
                ipPayload?.ip         && `🌐 ${ipPayload.ip}`,
              ].filter(Boolean).map((item, i) => (
                <span key={i} style={{ fontSize: '0.78rem', color: '#64748b', fontFamily: FONT }}>{item}</span>
              ))}
            </div>
          </div>
          <button onClick={onClose} style={{ background: 'none', border: 'none', cursor: 'pointer', color: '#64748b' }}><X size={20} /></button>
        </div>

        {/* Body */}
        <div style={{ flex: 1, overflow: 'hidden', display: 'flex' }}>
          {/* Left panel */}
          <div style={{ width: 200, borderRight: '1px solid #f1f5f9', overflowY: 'auto', flexShrink: 0 }}>
            <div style={{ padding: '12px 14px 6px', fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.5 }}>
              Pages ({pages.length})
            </div>
            {pages.map((ev, i) => (
              <button key={i} onClick={() => setActive(i)} style={{
                width: '100%', textAlign: 'left', padding: '10px 14px', border: 'none',
                background: activePage === i ? '#f0f7ff' : 'transparent',
                borderLeft: activePage === i ? '3px solid #2563eb' : '3px solid transparent',
                cursor: 'pointer', display: 'flex', flexDirection: 'column', gap: 3,
              }}>
                <div style={{ fontSize: '0.82rem', fontWeight: 600, color: activePage === i ? '#1e3a5f' : '#1e293b', fontFamily: FONT }}>
                  {ev.payload?.isExitPage ? 'Exit Page' : `Page ${i + 1}`}
                </div>
                <div style={{ fontSize: '0.72rem', color: '#94a3b8', fontFamily: FONT }}>{fmtDuration(ev.payload?.timeTaken)}</div>
                {ev.payload?.screenshot && (
                  <div style={{ width: '100%', height: 50, background: '#f8fafc', borderRadius: 4, overflow: 'hidden', marginTop: 4, border: '1px solid #e2e8f0' }}>
                    <img src={`${API_BASE}/sessions/${session.id}/screenshot/page_${i + 1}.png`}
                      style={{ width: '100%', height: '100%', objectFit: 'cover' }} alt="" />
                  </div>
                )}
              </button>
            ))}
          </div>

          {/* Right panel */}
          <div style={{ flex: 1, overflowY: 'auto', padding: 24 }}>
            {!activePg ? (
              <div style={{ textAlign: 'center', padding: 60, color: '#94a3b8', fontFamily: FONT }}>
                {pages.length === 0 ? 'No page data recorded for this session.' : 'Select a page from the left panel.'}
              </div>
            ) : (
              <div>
                <div style={{ display: 'flex', justifyContent: 'space-between', marginBottom: 16 }}>
                  <h3 style={{ fontFamily: FONT, fontSize: '1rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
                    Page {activePage + 1} — {activePg.payload?.title || 'Survey Page'}
                  </h3>
                  <span style={{ fontSize: '0.75rem', color: '#64748b', fontFamily: FONT, background: '#f1f5f9', padding: '3px 8px', borderRadius: 6 }}>
                    ⏱ {fmtDuration(activePg.payload?.timeTaken)}
                  </span>
                </div>
                {activePg.payload?.url && (
                  <div style={{ fontSize: '0.78rem', color: '#2563eb', fontFamily: FONT, background: '#f0f7ff', padding: '6px 10px', borderRadius: 6, marginBottom: 14, wordBreak: 'break-all' }}>
                    🔗 {activePg.payload.url}
                  </div>
                )}

                {/* Cumulative Living Story Card */}
                {(() => {
                  const currentStory =
                    activePg.payload?.cumulative_story ||
                    activePg.payload?.story_snapshot ||
                    pages.slice().reverse().find((e) => e.payload?.cumulative_story)?.payload?.cumulative_story ||
                    session.living_story;
                  if (!currentStory) return null;
                  return (
                    <div
                      style={{
                        background: 'linear-gradient(135deg, #f0f7ff 0%, #e0f2fe 100%)',
                        border: '1.5px solid #bae6fd',
                        borderRadius: 12,
                        padding: '14px 18px',
                        marginBottom: 16,
                        boxShadow: '0 2px 8px rgba(14, 165, 233, 0.08)',
                      }}
                    >
                      <div
                        style={{
                          display: 'flex',
                          alignItems: 'center',
                          justifyContent: 'space-between',
                          marginBottom: 6,
                          flexWrap: 'wrap',
                          gap: 6,
                        }}
                      >
                        <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                          <BookOpen size={16} color="#0284c7" />
                          <span
                            style={{
                              fontSize: '0.78rem',
                              fontWeight: 700,
                              color: '#0369a1',
                              fontFamily: FONT,
                              textTransform: 'uppercase',
                              letterSpacing: 0.5,
                            }}
                          >
                            Respondent Persona & Living Story
                          </span>
                        </div>
                        {session.persona_name && (
                          <span
                            style={{
                              fontSize: '0.72rem',
                              background: '#e0f2fe',
                              color: '#0284c7',
                              padding: '2px 8px',
                              borderRadius: 12,
                              fontWeight: 600,
                              border: '1px solid #7dd3fc',
                              fontFamily: FONT,
                            }}
                          >
                            👤 {session.persona_name}
                          </span>
                        )}
                      </div>
                      <p
                        style={{
                          margin: 0,
                          fontSize: '0.85rem',
                          color: '#0f172a',
                          lineHeight: 1.55,
                          fontFamily: FONT,
                        }}
                      >
                        "{currentStory}"
                      </p>
                    </div>
                  );
                })()}

                {/* Page QA Rationale & Story Evolution */}
                {(activePg.payload?.qa_rationale || activePg.payload?.story_update) && (
                  <div
                    style={{
                      background: '#f0fdf4',
                      border: '1.5px solid #bbf7d0',
                      borderRadius: 10,
                      padding: '12px 16px',
                      marginBottom: 16,
                    }}
                  >
                    <div
                      style={{
                        display: 'flex',
                        alignItems: 'center',
                        gap: 8,
                        marginBottom: 6,
                      }}
                    >
                      <Sparkles size={15} color="#16a34a" />
                      <span
                        style={{
                          fontSize: '0.75rem',
                          fontWeight: 700,
                          color: '#15803d',
                          fontFamily: FONT,
                          textTransform: 'uppercase',
                          letterSpacing: 0.4,
                        }}
                      >
                        QA Decision Rationale & Story Evolution
                      </span>
                    </div>
                    {activePg.payload?.qa_rationale && (
                      <div
                        style={{
                          fontSize: '0.83rem',
                          color: '#166534',
                          marginBottom: activePg.payload?.story_update ? 6 : 0,
                          lineHeight: 1.5,
                          fontFamily: FONT,
                        }}
                      >
                        <strong>QA Rationale:</strong> {activePg.payload.qa_rationale}
                      </div>
                    )}
                    {activePg.payload?.story_update && (
                      <div
                        style={{
                          fontSize: '0.82rem',
                          color: '#14532d',
                          fontStyle: 'italic',
                          lineHeight: 1.45,
                          fontFamily: FONT,
                        }}
                      >
                        <strong>Story Update:</strong> "{activePg.payload.story_update}"
                      </div>
                    )}
                  </div>
                )}
                <div style={{ border: '1.5px solid #e2e8f0', borderRadius: 10, overflow: 'hidden', marginBottom: 16 }}>
                  <div style={{ padding: '8px 12px', background: '#f8fafc', borderBottom: '1px solid #e2e8f0', fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.5 }}>
                    Screenshot
                  </div>
                  <img src={`${API_BASE}/sessions/${session.id}/screenshot/page_${activePage + 1}.png`}
                    style={{ width: '100%', display: 'block' }} alt="screenshot"
                    onError={e => { e.target.parentElement.innerHTML = '<div style="padding:32px;text-align:center;color:#94a3b8;font-family:sans-serif;font-size:0.85rem">Screenshot not available</div>'; }} />
                </div>
                {activePg.payload?.questions?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>Questions Detected</div>
                    {activePg.payload.questions.map((q, qi) => (
                      <div key={qi} style={{ background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 8, padding: '10px 12px', marginBottom: 6, fontSize: '0.85rem', color: '#1e293b', fontFamily: FONT }}>
                        <span style={{ color: '#94a3b8', marginRight: 6 }}>Q{qi + 1}.</span>{q}
                      </div>
                    ))}
                  </div>
                )}
                {activePg.payload?.options?.length > 0 && (
                  <div style={{ marginBottom: 16 }}>
                    <div style={{ fontSize: '0.72rem', fontWeight: 700, color: '#94a3b8', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.5, marginBottom: 8 }}>All Options & Selection</div>
                    {activePg.payload.options.map((og, gi) => (
                      <div key={gi} style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 14, marginBottom: 12 }}>
                        <div style={{ marginBottom: 8, display: 'flex', alignItems: 'center', gap: 8 }}>
                          <span style={{ fontSize: '0.7rem', fontWeight: 700, background: '#f0f7ff', color: '#2563eb', borderRadius: 6, padding: '2px 8px', fontFamily: FONT, textTransform: 'uppercase' }}>{og.type}</span>
                          {og.selected && !Array.isArray(og.selected) && <span style={{ fontSize: '0.75rem', color: '#166534', fontFamily: FONT }}>✓ {og.selected}</span>}
                          {Array.isArray(og.selected) && og.selected.length > 0 && <span style={{ fontSize: '0.75rem', color: '#166534', fontFamily: FONT }}>✓ {og.selected.length} selected</span>}
                        </div>
                        {og.options?.map((opt, oi) => {
                          const isSel = og.type === 'checkbox' ? og.selected?.includes(opt) : og.selected === opt;
                          return (
                            <div key={oi} style={{ display: 'flex', alignItems: 'center', gap: 10, padding: '7px 10px', borderRadius: 6, background: isSel ? '#f0fdf4' : '#f8fafc', border: `1px solid ${isSel ? '#86efac' : '#e2e8f0'}`, marginBottom: 4 }}>
                              <div style={{ width: 14, height: 14, borderRadius: og.type === 'checkbox' ? 3 : '50%', border: `2px solid ${isSel ? '#059669' : '#cbd5e1'}`, background: isSel ? '#059669' : 'white', flexShrink: 0 }} />
                              <span style={{ fontSize: '0.82rem', color: isSel ? '#166534' : '#475569', fontFamily: FONT, fontWeight: isSel ? 600 : 400, flex: 1 }}>{opt}</span>
                              {isSel && <span style={{ fontSize: '0.68rem', background: '#059669', color: 'white', borderRadius: 4, padding: '1px 6px', fontFamily: FONT, fontWeight: 700 }}>SELECTED</span>}
                            </div>
                          );
                        })}
                      </div>
                    ))}
                  </div>
                )}
                <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 20, paddingTop: 16, borderTop: '1px solid #f1f5f9' }}>
                  <button onClick={() => setActive(i => Math.max(0, i - 1))} disabled={activePage === 0} style={{ background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '7px 14px', fontSize: '0.85rem', cursor: activePage === 0 ? 'not-allowed' : 'pointer', color: '#64748b', fontFamily: FONT, opacity: activePage === 0 ? 0.4 : 1 }}>← Previous</button>
                  <span style={{ fontSize: '0.8rem', color: '#94a3b8', fontFamily: FONT, alignSelf: 'center' }}>{activePage + 1} / {pages.length}</span>
                  <button onClick={() => setActive(i => Math.min(pages.length - 1, i + 1))} disabled={activePage === pages.length - 1} style={{ background: '#1e3a5f', border: 'none', borderRadius: 8, padding: '7px 14px', fontSize: '0.85rem', cursor: activePage === pages.length - 1 ? 'not-allowed' : 'pointer', color: 'white', fontFamily: FONT, opacity: activePage === pages.length - 1 ? 0.4 : 1 }}>Next →</button>
                </div>
              </div>
            )}
          </div>
        </div>

        {/* Footer */}
        <div style={{ padding: '12px 24px', borderTop: '1px solid #f1f5f9', background: '#f8fafc', display: 'flex', gap: 24, flexWrap: 'wrap' }}>
          {[
            ['Total Pages', pages.length],
            ['Duration',    fmtDuration(session.total_duration_s)],
            ['Outcome',     session.outcome?.replace(/_/g,' ') || '—'],
            ['Response ID', session.response_id || '—'],
            ['IP',          ipPayload?.ip || '—'],
            ['Country',     session.proxy_country || '—'],
            ['Device',      session.device_type || '—'],
            ['AI Cost',     fmtCost(session.ai_cost_usd)],
          ].map(([k, v]) => (
            <div key={k}>
              <div style={{ fontSize: '0.68rem', fontWeight: 700, color: '#94a3b8', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.4 }}>{k}</div>
              <div style={{ fontSize: '0.82rem', fontWeight: 600, color: '#1e293b', fontFamily: FONT }}>{v}</div>
            </div>
          ))}
        </div>
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════
// MAIN SESSIONS PAGE
// ══════════════════════════════════════════════════════════════════════════════
const PAGE_SIZE = 25;

export default function Sessions() {
  const navigate = useNavigate();

  const [sessions,    setSessions]    = useState([]);
  const [stats,       setStats]       = useState(null);
  const [loading,     setLoading]     = useState(true);
  const [refreshing,  setRefreshing]  = useState(false);
  const [total,       setTotal]       = useState(0);
  const [page,        setPage]        = useState(1);
  const [toast,       setToast]       = useState(null);
  const [viewSession, setViewSession] = useState(null);

  // Filter state
  const [projects,    setProjects]    = useState([]);
  const [surveys,     setSurveys]     = useState([]);
  const [filters, setFilters] = useState({
    projectId:       '',
    surveyUrl:       '',
    status:          '',
    outcome:         '',
    country:         '',
    internalTesting: '',
  });

  const intervalRef = useRef(null);
  const showToast = (message, type = 'success') => setToast({ message, type });

  // Load projects for filter dropdown
  useEffect(() => {
    api.get('/projects').then(r => setProjects(r.data.projects || [])).catch(() => {});
  }, []);

  // Load surveys when project filter changes
  useEffect(() => {
    if (!filters.projectId) { setSurveys([]); setFilters(f => ({ ...f, surveyUrl: '' })); return; }
    api.get(`/projects/${filters.projectId}`)
      .then(r => setSurveys(r.data.surveys || []))
      .catch(() => setSurveys([]));
  }, [filters.projectId]);

  const buildParams = (pg = page) => {
    const p = new URLSearchParams();
    if (filters.projectId)       p.set('projectId',       filters.projectId);
    if (filters.surveyUrl)       p.set('surveyUrl',       filters.surveyUrl);
    if (filters.status)          p.set('status',          filters.status);
    if (filters.outcome)         p.set('outcome',         filters.outcome);
    if (filters.country)         p.set('country',         filters.country);
    if (filters.internalTesting) p.set('internalTesting', filters.internalTesting);
    p.set('limit',  PAGE_SIZE);
    p.set('offset', (pg - 1) * PAGE_SIZE);
    return p.toString();
  };

  const load = useCallback(async (isRefresh = false, pg = page) => {
    if (isRefresh) setRefreshing(true); else setLoading(true);
    try {
      const res = await api.get(`/sessions?${buildParams(pg)}`);
      setSessions(res.data.sessions || []);
      setStats(res.data.stats || null);
      setTotal(parseInt(res.data.total || 0));
    } catch {
      showToast('Failed to load sessions', 'error');
    } finally {
      setLoading(false);
      setRefreshing(false);
    }
  }, [filters, page]);

  useEffect(() => { load(); }, [load]);

  // Auto-refresh when active sessions exist
  useEffect(() => {
    clearInterval(intervalRef.current);
    const hasActive = stats && (parseInt(stats.active) > 0);
    if (hasActive) intervalRef.current = setInterval(() => load(true), 8000);
    return () => clearInterval(intervalRef.current);
  }, [stats?.active, filters]);

  const setF = (k, v) => { setFilters(f => ({ ...f, [k]: v })); setPage(1); };
  const clearFilters = () => { setFilters({ projectId: '', surveyUrl: '', status: '', outcome: '', country: '', internalTesting: '' }); setPage(1); };
  const hasFilters = Object.values(filters).some(Boolean);

  const handleDelete = async (sessionId) => {
    if (!window.confirm('Delete this session? This cannot be undone.')) return;
    try {
      await api.delete(`/sessions/${sessionId}`);
      showToast('Session deleted ✓');
      load(true);
    } catch { showToast('Failed to delete session', 'error'); }
  };

  const handleStop = async (sessionId) => {
    try {
      await api.post(`/sessions/${sessionId}/stop`);
      showToast('Session stopped ✓');
      load(true);
    } catch { showToast('Failed to stop session', 'error'); }
  };

  const totalPages = Math.max(1, Math.ceil(total / PAGE_SIZE));

  const STATUS_OPTS  = ['queued','initialising','in_progress','completed','terminated','over_quota','error','flagged'];
  const OUTCOME_OPTS = ['completed','terminated','over_quota','error'];

  return (
    <Layout title="Sessions">
      {/* Page header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 20, flexWrap: 'wrap', gap: 12 }}>
        <div>
          <h1 style={{ fontFamily: FONT, fontSize: '1.4rem', fontWeight: 700, color: '#1e293b', margin: 0 }}>
            All Sessions
          </h1>
          <p style={{ fontFamily: FONT, fontSize: '0.85rem', color: '#64748b', margin: '4px 0 0' }}>
            Sessions across all your projects — {fmtIN(total)} total
          </p>
        </div>
        <button
          onClick={() => load(true)}
          disabled={refreshing}
          style={{ display: 'flex', alignItems: 'center', gap: 6, background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 16px', fontSize: '0.85rem', fontWeight: 600, cursor: 'pointer', color: '#475569', fontFamily: FONT }}
        >
          <RefreshCw size={14} style={{ animation: refreshing ? 'spin 1s linear infinite' : 'none' }} />
          {refreshing ? 'Refreshing...' : 'Refresh'}
        </button>
      </div>

      {/* Stats bar */}
      {stats && (
        <div style={{ display: 'flex', gap: 0, background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, overflow: 'hidden', marginBottom: 16 }}>
          {[
            { label: 'Total',       val: fmtIN(stats.total),      color: '#64748b' },
            { label: 'Active',      val: fmtIN(stats.active),     color: '#2563eb' },
            { label: 'Completed',   val: fmtIN(stats.completed),  color: '#059669' },
            { label: 'Terminated',  val: fmtIN(stats.terminated), color: '#9d174d' },
            { label: 'Over Quota',  val: fmtIN(stats.over_quota), color: '#92400e' },
            { label: 'Errors',      val: fmtIN(stats.errors),     color: '#dc2626' },
            { label: 'Avg Duration',val: fmtDuration(stats.avg_duration), color: '#0891b2' },
            { label: 'Total AI Cost',val: fmtCost(stats.total_ai_cost), color: '#1e3a5f' },
          ].map(({ label, val, color }) => (
            <div key={label} style={{ flex: 1, padding: '14px 12px', textAlign: 'center', borderRight: '1px solid #f1f5f9' }}>
              <div style={{ fontSize: '1.2rem', fontWeight: 800, color, fontFamily: FONT }}>{val}</div>
              <div style={{ fontSize: '0.7rem', color: '#94a3b8', fontFamily: FONT, marginTop: 2 }}>{label}</div>
            </div>
          ))}
        </div>
      )}

      {/* Filters */}
      <div style={{ background: 'white', border: '1.5px solid #e2e8f0', borderRadius: 12, padding: '16px 20px', marginBottom: 16 }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 8, marginBottom: 12 }}>
          <Filter size={15} color="#64748b" />
          <span style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 600, color: '#374151' }}>Filters</span>
          {hasFilters && (
            <button onClick={clearFilters} style={{ marginLeft: 'auto', display: 'flex', alignItems: 'center', gap: 4, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '4px 10px', fontSize: '0.75rem', fontWeight: 600, cursor: 'pointer', color: '#dc2626', fontFamily: FONT }}>
              <X size={12} /> Clear All
            </button>
          )}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(200px, 1fr))', gap: 10 }}>
          {/* Project filter */}
          <div>
            <label style={s.filterLabel}>Project</label>
            <select style={s.filterSel} value={filters.projectId} onChange={e => setF('projectId', e.target.value)}>
              <option value="">All Projects</option>
              {projects.map(p => (
                <option key={p.id} value={p.id}>
                  {p.reference_id ? `${p.reference_id} — ` : ''}{p.name}
                </option>
              ))}
            </select>
          </div>

          {/* Survey URL filter — only shown when project selected */}
          {filters.projectId && surveys.length > 0 && (
            <div>
              <label style={s.filterLabel}>Survey URL</label>
              <select style={s.filterSel} value={filters.surveyUrl} onChange={e => setF('surveyUrl', e.target.value)}>
                <option value="">All Survey URLs</option>
                {surveys.map((sv, i) => (
                  <option key={i} value={sv.url}>
                    {sv.label || `Survey ${i + 1}`} — {sv.url?.slice(0, 40)}...
                  </option>
                ))}
              </select>
            </div>
          )}

          {/* Status */}
          <div>
            <label style={s.filterLabel}>State</label>
            <select style={s.filterSel} value={filters.status} onChange={e => setF('status', e.target.value)}>
              <option value="">All States</option>
              {STATUS_OPTS.map(o => <option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}
            </select>
          </div>

          {/* Outcome */}
          <div>
            <label style={s.filterLabel}>Outcome</label>
            <select style={s.filterSel} value={filters.outcome} onChange={e => setF('outcome', e.target.value)}>
              <option value="">All Outcomes</option>
              {OUTCOME_OPTS.map(o => <option key={o} value={o}>{o.replace(/_/g,' ')}</option>)}
            </select>
          </div>

          {/* Mode */}
          <div>
            <label style={s.filterLabel}>Mode</label>
            <select style={s.filterSel} value={filters.internalTesting} onChange={e => setF('internalTesting', e.target.value)}>
              <option value="">All Modes</option>
              <option value="false">🌐 Live</option>
              <option value="true">🧪 Internal Test</option>
            </select>
          </div>
        </div>
      </div>

      {/* Active indicator */}
      {stats && parseInt(stats.active) > 0 && (
        <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 10, fontSize: '0.78rem', color: '#2563eb', fontFamily: FONT }}>
          <span style={{ width: 7, height: 7, borderRadius: '50%', background: '#2563eb', display: 'inline-block', animation: 'pulse 1.5s infinite' }} />
          {fmtIN(stats.active)} session(s) active — auto-refreshing every 8s
        </div>
      )}

      {/* Table */}
      {loading ? (
        <div style={{ textAlign: 'center', padding: 60, color: '#64748b', fontFamily: FONT }}>Loading sessions...</div>
      ) : sessions.length === 0 ? (
        <div style={{ background: 'white', borderRadius: 12, padding: '60px 40px', textAlign: 'center', border: '1.5px solid #e2e8f0', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 }}>
          <Activity size={48} color="#cbd5e1" />
          <div style={{ fontFamily: FONT, fontWeight: 700, fontSize: '1.1rem', color: '#1e293b' }}>
            {hasFilters ? 'No sessions match your filters' : 'No Sessions Yet'}
          </div>
          <div style={{ fontFamily: FONT, fontSize: '0.88rem', color: '#64748b' }}>
            {hasFilters ? 'Try adjusting your filters.' : 'Sessions appear here once you launch a test run on any project.'}
          </div>
          {hasFilters && (
            <button onClick={clearFilters} style={{ background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '9px 18px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer', fontFamily: FONT }}>
              Clear Filters
            </button>
          )}
        </div>
      ) : (
        <>
          <div style={{ fontSize: '0.75rem', color: '#94a3b8', fontFamily: FONT, marginBottom: 8, display: 'flex', justifyContent: 'space-between' }}>
            <span>Showing {(page - 1) * PAGE_SIZE + 1}–{Math.min(page * PAGE_SIZE, total)} of {fmtIN(total)} sessions</span>
            {stats && parseInt(stats.active) > 0 && (
              <span style={{ color: '#2563eb', fontWeight: 600 }}>{fmtIN(stats.active)} active</span>
            )}
          </div>
          <div style={{ background: 'white', borderRadius: 12, border: '1.5px solid #e2e8f0', overflow: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', minWidth: 1100 }}>
              <thead>
                <tr style={{ background: '#f8fafc', borderBottom: '2px solid #e2e8f0' }}>
                  {['Project','Session ID','Response ID','Country','Device','Mode','State','Outcome','Duration','AI Cost','Persona','Started','Actions'].map(h => (
                    <th key={h} style={{ padding: '12px 14px', textAlign: 'left', fontSize: '0.72rem', fontWeight: 700, color: '#374151', fontFamily: FONT, textTransform: 'uppercase', letterSpacing: 0.4, whiteSpace: 'nowrap' }}>
                      {h}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {sessions.map((session, idx) => (
                  <tr key={session.id} style={{ borderBottom: '1px solid #f1f5f9', background: idx % 2 === 0 ? 'white' : '#f8fafc' }}>
                    {/* Project */}
                    <td style={{ padding: '11px 14px' }}>
                      <button
                        onClick={() => navigate(`/projects/${session.project_id}`)}
                        style={{ background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left', padding: 0 }}
                      >
                        <div style={{ fontFamily: FONT, fontSize: '0.85rem', fontWeight: 600, color: '#1e3a5f' }}>
                          {session.project_name}
                        </div>
                        {session.project_reference_id && (
                          <div style={{ fontFamily: FONT, fontSize: '0.72rem', color: '#94a3b8' }}>
                            {session.project_reference_id}
                          </div>
                        )}
                      </button>
                    </td>
                    {/* Session ID */}
                    <td style={{ padding: '11px 14px' }}>
                      <code style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#64748b', background: '#f1f5f9', padding: '2px 6px', borderRadius: 4 }}>
                        {session.id.slice(0, 8)}
                      </code>
                    </td>
                    {/* Response ID */}
                    <td style={{ padding: '11px 14px' }}>
                      {session.response_id ? (
                        <code style={{ fontFamily: 'monospace', fontSize: '0.75rem', color: '#2563eb', background: '#eff6ff', padding: '2px 6px', borderRadius: 4 }}>
                          {session.response_id}
                        </code>
                      ) : <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>}
                    </td>
                    {/* Country */}
                    <td style={{ padding: '11px 14px', fontSize: '0.82rem', color: '#475569', fontFamily: FONT }}>
                      {session.proxy_country || '—'}
                    </td>
                    {/* Device */}
                    <td style={{ padding: '11px 14px', fontSize: '0.82rem', color: '#475569', fontFamily: FONT }}>
                      {session.device_type || '—'}
                    </td>
                    {/* Mode */}
                    <td style={{ padding: '11px 14px' }}>
                      <span style={{ fontSize: '0.72rem', fontWeight: 700, background: session.internal_testing ? '#fef3c7' : '#dbeafe', color: session.internal_testing ? '#92400e' : '#1e40af', borderRadius: 20, padding: '2px 8px', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                        {session.internal_testing ? '🧪 Test' : '🌐 Live'}
                      </span>
                    </td>
                    {/* State */}
                    <td style={{ padding: '11px 14px' }}>
                      <Badge label={session.status} colors={SESSION_COLORS} />
                    </td>
                    {/* Outcome */}
                    <td style={{ padding: '11px 14px' }}>
                      {session.outcome
                        ? <Badge label={session.outcome} colors={OUTCOME_COLORS} />
                        : <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>}
                    </td>
                    {/* Duration */}
                    <td style={{ padding: '11px 14px', fontSize: '0.82rem', color: '#475569', fontFamily: FONT }}>
                      {['in_progress','initialising','queued'].includes(session.status)
                        ? <span style={{ color: '#2563eb', fontWeight: 600 }}>
                            {fmtDuration(Math.round((Date.now() - new Date(session.started_at || session.created_at).getTime()) / 1000))} ⏳
                          </span>
                        : fmtDuration(session.total_duration_s)}
                    </td>
                    {/* AI Cost */}
                    <td style={{ padding: '11px 14px', textAlign: 'right' }}>
                      {session.ai_cost_usd && parseFloat(session.ai_cost_usd) > 0 ? (
                        <div>
                          <div style={{ fontSize: '0.82rem', fontWeight: 700, color: '#1e3a5f', fontFamily: FONT }}>
                            {fmtCost(session.ai_cost_usd)}
                          </div>
                          {session.ai_calls_count > 0 && (
                            <div style={{ fontSize: '0.68rem', color: '#94a3b8', fontFamily: FONT }}>
                              {fmtIN(session.ai_calls_count)} calls
                            </div>
                          )}
                        </div>
                      ) : <span style={{ color: '#94a3b8', fontSize: '0.75rem' }}>—</span>}
                    </td>
                    {/* Persona */}
                    <td style={{ padding: '11px 14px', fontSize: '0.82rem', color: '#475569', fontFamily: FONT }}>
                      {session.persona_name || '—'}
                    </td>
                    {/* Started */}
                    <td style={{ padding: '11px 14px', fontSize: '0.75rem', color: '#94a3b8', fontFamily: FONT, whiteSpace: 'nowrap' }}>
                      {fmtTime(session.started_at || session.created_at)}
                    </td>
                    {/* Actions */}
                    <td style={{ padding: '11px 14px' }}>
                      <div style={{ display: 'flex', gap: 5 }}>
                        <button
                          onClick={() => setViewSession({ id: session.id, projectId: session.project_id })}
                          title="View session report"
                          style={{ display: 'flex', alignItems: 'center', gap: 4, background: '#f0f7ff', border: '1px solid #dbeafe', borderRadius: 6, padding: '5px 8px', cursor: 'pointer', color: '#2563eb', fontSize: '0.72rem', fontFamily: FONT, fontWeight: 600 }}
                        >
                          <FileText size={11} /> View
                        </button>
                        <button
                          onClick={() => navigate(`/projects/${session.project_id}`)}
                          title="Open project"
                          style={{ display: 'flex', alignItems: 'center', background: '#f8fafc', border: '1px solid #e2e8f0', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: '#64748b' }}
                        >
                          <ChevronRight size={11} />
                        </button>
                        {['queued','initialising','in_progress'].includes(session.status) && (
                          <button
                            onClick={() => handleStop(session.id)}
                            title="Stop session"
                            style={{ display: 'flex', alignItems: 'center', background: '#fff7ed', border: '1px solid #fed7aa', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: '#c2410c' }}
                          >
                            <StopCircle size={11} />
                          </button>
                        )}
                        <button
                          onClick={() => handleDelete(session.id)}
                          title="Delete session"
                          style={{ display: 'flex', alignItems: 'center', background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 6, padding: '5px 7px', cursor: 'pointer', color: '#ef4444' }}
                        >
                          <Trash2 size={11} />
                        </button>
                      </div>
                    </td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>

          {/* Pagination */}
          {totalPages > 1 && (
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', gap: 8, marginTop: 16 }}>
              <PagBtn disabled={page === 1} onClick={() => { setPage(1); }}>«</PagBtn>
              <PagBtn disabled={page === 1} onClick={() => setPage(p => p - 1)}>‹</PagBtn>
              {Array.from({ length: Math.min(7, totalPages) }, (_, i) => {
                let n;
                if (totalPages <= 7) n = i + 1;
                else if (page <= 4)  n = i + 1;
                else if (page >= totalPages - 3) n = totalPages - 6 + i;
                else n = page - 3 + i;
                return (
                  <button key={n} onClick={() => setPage(n)} style={{
                    minWidth: 32, height: 32, border: '1.5px solid', borderRadius: 6,
                    background: n === page ? '#1e3a5f' : 'white',
                    color: n === page ? 'white' : '#475569',
                    borderColor: n === page ? '#1e3a5f' : '#e2e8f0',
                    fontFamily: FONT, fontSize: '0.85rem', cursor: 'pointer',
                  }}>{n}</button>
                );
              })}
              <PagBtn disabled={page === totalPages} onClick={() => setPage(p => p + 1)}>›</PagBtn>
              <PagBtn disabled={page === totalPages} onClick={() => setPage(totalPages)}>»</PagBtn>
              <span style={{ fontSize: '0.78rem', color: '#94a3b8', fontFamily: FONT, marginLeft: 8 }}>
                Page {page} of {totalPages}
              </span>
            </div>
          )}
        </>
      )}

      {/* Session Report Modal */}
      {viewSession && (
        <SessionReportModal
          sessionId={viewSession.id}
          projectId={viewSession.projectId}
          onClose={() => setViewSession(null)}
          showToast={showToast}
        />
      )}

      {toast && <Toast message={toast.message} type={toast.type} onClose={() => setToast(null)} />}

      <style>{`
        @keyframes spin  { from { transform: rotate(0deg); } to { transform: rotate(360deg); } }
        @keyframes pulse { 0%, 100% { opacity: 1; } 50% { opacity: 0.4; } }
      `}</style>
    </Layout>
  );
}

const PagBtn = ({ disabled, onClick, children }) => (
  <button onClick={onClick} disabled={disabled} style={{
    minWidth: 32, height: 32, border: '1.5px solid #e2e8f0', borderRadius: 6,
    background: 'white', cursor: disabled ? 'not-allowed' : 'pointer',
    color: disabled ? '#cbd5e1' : '#475569', fontFamily: FONT,
    fontSize: '0.85rem', fontWeight: 500, display: 'flex',
    alignItems: 'center', justifyContent: 'center',
    opacity: disabled ? 0.5 : 1, padding: '0 8px',
  }}>{children}</button>
);

const s = {
  overlay:    { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  cancelBtn:  { background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 20px', fontSize: '0.88rem', cursor: 'pointer', color: '#64748b', fontFamily: FONT },
  filterLabel:{ display: 'block', fontSize: '0.75rem', fontWeight: 600, color: '#374151', fontFamily: FONT, marginBottom: 5 },
  filterSel:  { width: '100%', padding: '8px 10px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.85rem', fontFamily: FONT, color: '#1e293b', outline: 'none', background: 'white' },
};