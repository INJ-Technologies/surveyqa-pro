import React, { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import api from '../api'
import {
  FolderKanban, Plus, X, Globe, ChevronRight,
  Clock, Users, Activity, AlertCircle
} from 'lucide-react'

// ─── Status badge ─────────────────────────────────────────────────────────────
const STATUS_COLORS = {
  draft:     { bg: '#f1f5f9', text: '#64748b' },
  review:    { bg: '#fef3c7', text: '#92400e' },
  active:    { bg: '#dcfce7', text: '#166534' },
  paused:    { bg: '#fce7f3', text: '#9d174d' },
  completed: { bg: '#dbeafe', text: '#1e40af' },
  archived:  { bg: '#f1f5f9', text: '#94a3b8' },
}

function StatusBadge({ status }) {
  const c = STATUS_COLORS[status] || STATUS_COLORS.draft
  return (
    <span style={{ ...s.badge, background: c.bg, color: c.text }}>
      {status}
    </span>
  )
}

// ─── Platform options ─────────────────────────────────────────────────────────
const PLATFORMS = [
  'decipher', 'qualtrics', 'confirmit',
  'alchemer', 'surveymonkey', 'custom', 'unknown'
]

const AI_MODES   = ['ai', 'human', 'predefined']
const STRATEGIES = ['persona_true', 'quota_guided', 'stress_test']
const PROVIDERS  = ['brightdata', 'oxylabs', 'smartproxy', 'iproyal', 'custom']

// ─── Create Project Modal ─────────────────────────────────────────────────────
function CreateModal({ onClose, onCreated }) {
  const [step,    setStep]    = useState(1)
  const [loading, setLoading] = useState(false)
  const [error,   setError]   = useState('')

  const [form, setForm] = useState({
    name:               '',
    clientName:         '',
    referenceId:        '',
    description:        '',
    surveyPlatform:     'unknown',
    targetCompletes:    100,
    targetLoi:          15,
    aiModeOpenend:      'ai',
    aiModeImage:        'ai',
    aiStrategy:         'persona_true',
    proxyProvider:      'brightdata',
    concurrentSessions: 5,
    startDate:          '',
    endDate:            '',
    surveys:            [{ label: 'Main', url: '', countries: '', languages: '', allocation: 100 }],
  })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const setSurvey = (i, k) => (e) => {
    const surveys = [...form.surveys]
    surveys[i] = { ...surveys[i], [k]: e.target.value }
    setForm(f => ({ ...f, surveys }))
  }

  const addSurvey = () => setForm(f => ({
    ...f,
    surveys: [...f.surveys, { label: `Variant ${f.surveys.length + 1}`, url: '', countries: '', languages: '', allocation: 0 }]
  }))

  const removeSurvey = (i) => setForm(f => ({
    ...f,
    surveys: f.surveys.filter((_, idx) => idx !== i)
  }))

  const handleSubmit = async () => {
    setError('')
    setLoading(true)
    try {
      const payload = {
        ...form,
        targetCompletes:    parseInt(form.targetCompletes),
        targetLoi:          parseInt(form.targetLoi),
        concurrentSessions: parseInt(form.concurrentSessions),
        surveys: form.surveys.map(s => ({
          ...s,
          countries:  s.countries  ? s.countries.split(',').map(c => c.trim()).filter(Boolean)  : [],
          languages:  s.languages  ? s.languages.split(',').map(l => l.trim()).filter(Boolean)  : [],
          allocation: parseInt(s.allocation) || 100,
        })),
      }
      const res = await api.post('/projects', payload)
      onCreated(res.data.project)
      onClose()
    } catch (err) {
      setError(err.response?.data?.error || 'Failed to create project')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.overlay}>
      <div style={s.modal}>

        {/* Header */}
        <div style={s.modalHeader}>
          <div>
            <h2 style={s.modalTitle}>New Project</h2>
            <p style={s.modalSub}>Step {step} of 2 — {step === 1 ? 'Project Details' : 'Survey URLs & Settings'}</p>
          </div>
          <button style={s.closeBtn} onClick={onClose}><X size={20} /></button>
        </div>

        {/* Progress */}
        <div style={s.progress}>
          <div style={{ ...s.progressBar, width: `${step * 50}%` }} />
        </div>

        <div style={s.modalBody}>

          {/* ── Step 1: Basic details ── */}
          {step === 1 && (
            <div style={s.formGrid}>

              <div style={s.fieldFull}>
                <label style={s.label}>Project Name *</label>
                <input style={s.input} placeholder="Q3 Brand Tracker — India"
                  value={form.name} onChange={set('name')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>Client Name</label>
                <input style={s.input} placeholder="Acme Corp"
                  value={form.clientName} onChange={set('clientName')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>Reference ID</label>
                <input style={s.input} placeholder="PRJ-2025-001"
                  value={form.referenceId} onChange={set('referenceId')} />
              </div>

              <div style={s.fieldFull}>
                <label style={s.label}>Description</label>
                <textarea style={s.textarea} rows={3} placeholder="Brief description of this project..."
                  value={form.description} onChange={set('description')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>Survey Platform</label>
                <select style={s.input} value={form.surveyPlatform} onChange={set('surveyPlatform')}>
                  {PLATFORMS.map(p => <option key={p} value={p}>{p.charAt(0).toUpperCase() + p.slice(1)}</option>)}
                </select>
              </div>

              <div style={s.field}>
                <label style={s.label}>Target Completes</label>
                <input style={s.input} type="number" min="1"
                  value={form.targetCompletes} onChange={set('targetCompletes')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>Target LOI (minutes)</label>
                <input style={s.input} type="number" min="1"
                  value={form.targetLoi} onChange={set('targetLoi')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>Start Date</label>
                <input style={s.input} type="date"
                  value={form.startDate} onChange={set('startDate')} />
              </div>

              <div style={s.field}>
                <label style={s.label}>End Date</label>
                <input style={s.input} type="date"
                  value={form.endDate} onChange={set('endDate')} />
              </div>

            </div>
          )}

          {/* ── Step 2: Surveys + settings ── */}
          {step === 2 && (
            <div>

              {/* Survey URLs */}
              <div style={s.sectionHead}>
                <span style={s.sectionTitle}>Survey URLs</span>
                <button style={s.addBtn} onClick={addSurvey}>
                  <Plus size={14} /> Add Variant
                </button>
              </div>

              {form.surveys.map((survey, i) => (
                <div key={i} style={s.surveyCard}>
                  <div style={s.surveyCardHeader}>
                    <span style={s.surveyNum}>Survey {i + 1}</span>
                    {i > 0 && (
                      <button style={s.removeBtn} onClick={() => removeSurvey(i)}>
                        <X size={14} />
                      </button>
                    )}
                  </div>
                  <div style={s.formGrid}>
                    <div style={s.field}>
                      <label style={s.label}>Label</label>
                      <input style={s.input} placeholder="Main / Control / Variant A"
                        value={survey.label} onChange={setSurvey(i, 'label')} />
                    </div>
                    <div style={s.field}>
                      <label style={s.label}>Allocation %</label>
                      <input style={s.input} type="number" min="0" max="100"
                        value={survey.allocation} onChange={setSurvey(i, 'allocation')} />
                    </div>
                    <div style={s.fieldFull}>
                      <label style={s.label}>Survey URL *</label>
                      <input style={s.input} placeholder="https://survey.example.com/start?token=..."
                        value={survey.url} onChange={setSurvey(i, 'url')} />
                    </div>
                    <div style={s.field}>
                      <label style={s.label}>Countries (comma separated)</label>
                      <input style={s.input} placeholder="IN, US, GB"
                        value={survey.countries} onChange={setSurvey(i, 'countries')} />
                    </div>
                    <div style={s.field}>
                      <label style={s.label}>Languages (comma separated)</label>
                      <input style={s.input} placeholder="en, hi"
                        value={survey.languages} onChange={setSurvey(i, 'languages')} />
                    </div>
                  </div>
                </div>
              ))}

              {/* AI & Proxy Settings */}
              <div style={{ ...s.sectionHead, marginTop: 24 }}>
                <span style={s.sectionTitle}>AI & Automation Settings</span>
              </div>

              <div style={s.formGrid}>
                <div style={s.field}>
                  <label style={s.label}>Open-End Mode</label>
                  <select style={s.input} value={form.aiModeOpenend} onChange={set('aiModeOpenend')}>
                    {AI_MODES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Image Question Mode</label>
                  <select style={s.input} value={form.aiModeImage} onChange={set('aiModeImage')}>
                    {AI_MODES.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>AI Strategy</label>
                  <select style={s.input} value={form.aiStrategy} onChange={set('aiStrategy')}>
                    {STRATEGIES.map(m => <option key={m} value={m}>{m.replace(/_/g, ' ')}</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Proxy Provider</label>
                  <select style={s.input} value={form.proxyProvider} onChange={set('proxyProvider')}>
                    {PROVIDERS.map(m => <option key={m} value={m}>{m.charAt(0).toUpperCase() + m.slice(1)}</option>)}
                  </select>
                </div>
                <div style={s.field}>
                  <label style={s.label}>Concurrent Sessions</label>
                  <input style={s.input} type="number" min="1" max="100"
                    value={form.concurrentSessions} onChange={set('concurrentSessions')} />
                </div>
              </div>

            </div>
          )}

          {error && (
            <div style={s.error}>
              <AlertCircle size={16} /> {error}
            </div>
          )}

        </div>

        {/* Footer */}
        <div style={s.modalFooter}>
          {step === 1 ? (
            <>
              <button style={s.cancelBtn} onClick={onClose}>Cancel</button>
              <button style={s.nextBtn}
                onClick={() => {
                  if (!form.name) { setError('Project name is required'); return; }
                  setError(''); setStep(2);
                }}>
                Next — Survey URLs →
              </button>
            </>
          ) : (
            <>
              <button style={s.cancelBtn} onClick={() => setStep(1)}>← Back</button>
              <button style={{ ...s.nextBtn, opacity: loading ? 0.7 : 1 }}
                onClick={handleSubmit} disabled={loading}>
                {loading ? 'Creating...' : 'Create Project'}
              </button>
            </>
          )}
        </div>

      </div>
    </div>
  )
}

// ─── Project Card ─────────────────────────────────────────────────────────────
function ProjectCard({ project, onClick }) {
  return (
    <div style={s.card} onClick={onClick}>
      <div style={s.cardTop}>
        <div>
          <h3 style={s.cardTitle}>{project.name}</h3>
          {project.client_name && (
            <span style={s.cardClient}>{project.client_name}</span>
          )}
        </div>
        <StatusBadge status={project.status} />
      </div>

      {project.description && (
        <p style={s.cardDesc}>{project.description}</p>
      )}

      <div style={s.cardMeta}>
        <span style={s.metaItem}>
          <Globe size={13} /> {project.survey_platform}
        </span>
        <span style={s.metaItem}>
          <Users size={13} /> {project.total_completes || 0} / {project.target_completes}
        </span>
        <span style={s.metaItem}>
          <Activity size={13} /> {project.session_count || 0} sessions
        </span>
        <span style={s.metaItem}>
          <Clock size={13} /> {project.target_loi_minutes}m LOI
        </span>
      </div>

      <div style={s.cardFooter}>
        <span style={s.cardDate}>
          Created {new Date(project.created_at).toLocaleDateString('en-IN', { day: 'numeric', month: 'short', year: 'numeric' })}
        </span>
        <ChevronRight size={16} color="#94a3b8" />
      </div>
    </div>
  )
}

// ─── Main Projects Page ───────────────────────────────────────────────────────
export default function Projects() {
  const [projects, setProjects] = useState([])
  const [loading,  setLoading]  = useState(true)
  const [showModal,setShowModal]= useState(false)
  const [search,   setSearch]   = useState('')

  const load = async () => {
    try {
      const res = await api.get('/projects')
      setProjects(res.data.projects)
    } catch (err) {
      console.error('Failed to load projects', err)
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => { load() }, [])

  const filtered = projects.filter(p =>
    p.name.toLowerCase().includes(search.toLowerCase()) ||
    (p.client_name || '').toLowerCase().includes(search.toLowerCase())
  )

  return (
    <Layout title="Projects">

      {/* Toolbar */}
      <div style={s.toolbar}>
        <input style={s.search} placeholder="Search projects..."
          value={search} onChange={e => setSearch(e.target.value)} />
        <button style={s.createBtn} onClick={() => setShowModal(true)}>
          <Plus size={18} /> New Project
        </button>
      </div>

      {/* Content */}
      {loading ? (
        <div style={s.center}>Loading projects...</div>
      ) : filtered.length === 0 ? (
        <div style={s.empty}>
          <FolderKanban size={52} color="#cbd5e1" />
          <h3 style={s.emptyTitle}>
            {search ? 'No projects match your search' : 'No Projects Yet'}
          </h3>
          <p style={s.emptyDesc}>
            {search ? 'Try a different search term.' : 'Create your first survey testing project to get started.'}
          </p>
          {!search && (
            <button style={s.createBtn} onClick={() => setShowModal(true)}>
              <Plus size={16} /> New Project
            </button>
          )}
        </div>
      ) : (
        <div style={s.grid}>
          {filtered.map(p => (
            <ProjectCard key={p.id} project={p}
              onClick={() => console.log('Open project', p.id)} />
          ))}
        </div>
      )}

      {/* Modal */}
      {showModal && (
        <CreateModal
          onClose={() => setShowModal(false)}
          onCreated={(project) => {
            setProjects(prev => [project, ...prev])
          }}
        />
      )}

    </Layout>
  )
}

// ─── Styles ───────────────────────────────────────────────────────────────────
const s = {
  toolbar:       { display: 'flex', gap: 12, marginBottom: 24, alignItems: 'center' },
  search:        { flex: 1, padding: '10px 16px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.9rem', outline: 'none', background: 'white' },
  createBtn:     { display: 'flex', alignItems: 'center', gap: 8, background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '10px 20px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer', whiteSpace: 'nowrap' },
  grid:          { display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(340px, 1fr))', gap: 16 },
  card:          { background: 'white', borderRadius: 12, padding: 22, cursor: 'pointer', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', border: '1.5px solid #f1f5f9', transition: 'all 0.15s' },
  cardTop:       { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 8 },
  cardTitle:     { fontSize: '0.95rem', fontWeight: 700, color: '#1e293b', marginBottom: 3 },
  cardClient:    { fontSize: '0.78rem', color: '#64748b' },
  cardDesc:      { fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5, marginBottom: 14, display: '-webkit-box', WebkitLineClamp: 2, WebkitBoxOrient: 'vertical', overflow: 'hidden' },
  cardMeta:      { display: 'flex', flexWrap: 'wrap', gap: 12, marginBottom: 14 },
  metaItem:      { display: 'flex', alignItems: 'center', gap: 4, fontSize: '0.78rem', color: '#64748b' },
  cardFooter:    { display: 'flex', justifyContent: 'space-between', alignItems: 'center', borderTop: '1px solid #f1f5f9', paddingTop: 12 },
  cardDate:      { fontSize: '0.75rem', color: '#94a3b8' },
  badge:         { padding: '3px 10px', borderRadius: 20, fontSize: '0.72rem', fontWeight: 600, textTransform: 'capitalize', whiteSpace: 'nowrap' },
  center:        { textAlign: 'center', padding: 60, color: '#64748b' },
  empty:         { background: 'white', borderRadius: 12, padding: '80px 40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)', display: 'flex', flexDirection: 'column', alignItems: 'center', gap: 12 },
  emptyTitle:    { fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' },
  emptyDesc:     { color: '#64748b', fontSize: '0.9rem', marginBottom: 8 },
  overlay:       { position: 'fixed', inset: 0, background: 'rgba(0,0,0,0.5)', display: 'flex', alignItems: 'center', justifyContent: 'center', zIndex: 1000, padding: 20 },
  modal:         { background: 'white', borderRadius: 16, width: '100%', maxWidth: 680, maxHeight: '90vh', display: 'flex', flexDirection: 'column', boxShadow: '0 25px 50px rgba(0,0,0,0.3)' },
  modalHeader:   { display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', padding: '24px 28px 0' },
  modalTitle:    { fontSize: '1.2rem', fontWeight: 700, color: '#1e293b', marginBottom: 4 },
  modalSub:      { fontSize: '0.82rem', color: '#64748b' },
  closeBtn:      { background: 'none', border: 'none', cursor: 'pointer', color: '#64748b', padding: 4 },
  progress:      { height: 3, background: '#f1f5f9', margin: '16px 28px 0' },
  progressBar:   { height: '100%', background: '#1e3a5f', borderRadius: 2, transition: 'width 0.3s ease' },
  modalBody:     { flex: 1, overflowY: 'auto', padding: '24px 28px' },
  modalFooter:   { display: 'flex', justifyContent: 'flex-end', gap: 12, padding: '16px 28px', borderTop: '1px solid #f1f5f9' },
  formGrid:      { display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 16 },
  field:         { display: 'flex', flexDirection: 'column', gap: 6 },
  fieldFull:     { display: 'flex', flexDirection: 'column', gap: 6, gridColumn: '1 / -1' },
  label:         { fontSize: '0.8rem', fontWeight: 600, color: '#374151' },
  input:         { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: '0.88rem', outline: 'none', color: '#1e293b', background: 'white' },
  textarea:      { padding: '9px 12px', border: '1.5px solid #e2e8f0', borderRadius: 7, fontSize: '0.88rem', outline: 'none', color: '#1e293b', resize: 'vertical', fontFamily: 'inherit' },
  sectionHead:   { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 },
  sectionTitle:  { fontSize: '0.9rem', fontWeight: 700, color: '#1e293b' },
  addBtn:        { display: 'flex', alignItems: 'center', gap: 4, background: '#f1f5f9', border: 'none', borderRadius: 6, padding: '6px 12px', fontSize: '0.8rem', fontWeight: 600, cursor: 'pointer', color: '#1e3a5f' },
  surveyCard:    { background: '#f8fafc', border: '1.5px solid #e2e8f0', borderRadius: 10, padding: 16, marginBottom: 12 },
  surveyCardHeader: { display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 12 },
  surveyNum:     { fontSize: '0.82rem', fontWeight: 700, color: '#1e3a5f' },
  removeBtn:     { background: 'none', border: 'none', cursor: 'pointer', color: '#ef4444', padding: 2 },
  error:         { display: 'flex', alignItems: 'center', gap: 8, background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: '0.85rem', marginTop: 12 },
  cancelBtn:     { background: 'none', border: '1.5px solid #e2e8f0', borderRadius: 8, padding: '9px 20px', fontSize: '0.88rem', cursor: 'pointer', color: '#64748b', fontWeight: 500 },
  nextBtn:       { background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '9px 24px', fontSize: '0.88rem', fontWeight: 600, cursor: 'pointer' },
}