import React, { useState } from 'react'
import { useNavigate } from 'react-router-dom'
import { useAuth } from '../App'
import api from '../api'

export default function Login() {
  const { login }            = useAuth()
  const navigate             = useNavigate()
  const [tab, setTab]        = useState('login')
  const [loading, setLoading]= useState(false)
  const [error, setError]    = useState('')
  const [form, setForm]      = useState({ email: '', password: '', fullName: '' })

  const set = (k) => (e) => setForm(f => ({ ...f, [k]: e.target.value }))

  const handleSubmit = async (e) => {
    e.preventDefault()
    setError('')
    setLoading(true)
    try {
      const endpoint = tab === 'login' ? '/auth/login' : '/auth/register'
      const payload  = tab === 'login'
        ? { email: form.email, password: form.password }
        : { email: form.email, password: form.password, fullName: form.fullName }

      const res = await api.post(endpoint, payload)
      login(res.data.user, res.data.token)
      navigate('/')
    } catch (err) {
      setError(err.response?.data?.error || 'Something went wrong')
    } finally {
      setLoading(false)
    }
  }

  return (
    <div style={s.bg}>
      <div style={s.card}>

        {/* Logo */}
        <div style={s.logoWrap}>
          <img src="/logo.png" alt="INJ Technologies" style={s.logoImg} />
        </div>

        {/* Tabs */}
        <div style={s.tabs}>
          {['login', 'register'].map(t => (
            <button key={t} onClick={() => { setTab(t); setError('') }}
              style={{ ...s.tab, ...(tab === t ? s.tabActive : {}) }}>
              {t === 'login' ? 'Sign In' : 'Create Account'}
            </button>
          ))}
        </div>

        {/* Form */}
        <form onSubmit={handleSubmit} style={s.form}>

          {tab === 'register' && (
            <div style={s.field}>
              <label style={s.label}>Full Name</label>
              <input style={s.input} type="text" placeholder="Vijay Rana"
                value={form.fullName} onChange={set('fullName')} required />
            </div>
          )}

          <div style={s.field}>
            <label style={s.label}>Email Address</label>
            <input style={s.input} type="email" placeholder="you@injtechnologies.com"
              value={form.email} onChange={set('email')} required />
          </div>

          <div style={s.field}>
            <label style={s.label}>Password</label>
            <input style={s.input} type="password" placeholder="••••••••"
              value={form.password} onChange={set('password')} required />
          </div>

          {error && <div style={s.error}>{error}</div>}

          <button type="submit" style={{ ...s.btn, opacity: loading ? 0.7 : 1 }} disabled={loading}>
            {loading ? 'Please wait...' : tab === 'login' ? 'Sign In' : 'Create Account'}
          </button>
        </form>

        <div style={s.footer}>INJ Technologies · SurveyQA Pro v1.0</div>
      </div>
    </div>
  )
}

const s = {
  bg:       { minHeight: '100vh', display: 'flex', alignItems: 'center', justifyContent: 'center', background: 'linear-gradient(135deg, #1e3a5f 0%, #2563eb 100%)', padding: 20 },
  card:     { background: 'white', borderRadius: 16, padding: '40px 36px', width: '100%', maxWidth: 420, boxShadow: '0 25px 50px rgba(0,0,0,0.25)' },
  logoWrap: { display: 'flex', justifyContent: 'center', marginBottom: 28 },
  logoImg:  { height: 52, maxWidth: 220, objectFit: 'contain' },
  logoBox:  { width: 48, height: 48, borderRadius: 12, background: '#1e3a5f', display: 'flex', alignItems: 'center', justifyContent: 'center' },
  logoText: { color: 'white', fontWeight: 800, fontSize: '1.1rem' },
  brand:    { fontSize: '1.1rem', fontWeight: 700, color: '#1e293b' },
  tagline:  { fontSize: '0.72rem', color: '#94a3b8', marginTop: 2 },
  tabs:     { display: 'flex', background: '#f1f5f9', borderRadius: 10, padding: 4, marginBottom: 28 },
  tab:      { flex: 1, padding: '9px 0', border: 'none', background: 'none', borderRadius: 8, cursor: 'pointer', fontSize: '0.87rem', color: '#64748b', fontWeight: 500, transition: 'all 0.15s' },
  tabActive:{ background: 'white', color: '#1e3a5f', fontWeight: 700, boxShadow: '0 1px 4px rgba(0,0,0,0.1)' },
  form:     { display: 'flex', flexDirection: 'column', gap: 18 },
  field:    { display: 'flex', flexDirection: 'column', gap: 6 },
  label:    { fontSize: '0.82rem', fontWeight: 600, color: '#374151' },
  input:    { padding: '11px 14px', border: '1.5px solid #e2e8f0', borderRadius: 8, fontSize: '0.9rem', outline: 'none', transition: 'border 0.15s', color: '#1e293b' },
  error:    { background: '#fef2f2', border: '1px solid #fecaca', borderRadius: 8, padding: '10px 14px', color: '#dc2626', fontSize: '0.85rem' },
  btn:      { background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '13px', fontSize: '0.95rem', fontWeight: 600, cursor: 'pointer', transition: 'background 0.15s' },
  footer:   { textAlign: 'center', marginTop: 24, fontSize: '0.75rem', color: '#cbd5e1' },
}