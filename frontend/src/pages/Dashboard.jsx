import React, { useState, useEffect } from 'react'
import Layout from '../components/Layout'
import { useAuth } from '../App'
import { FolderKanban, Users, Activity, CheckCircle } from 'lucide-react'
import api from '../api'

export default function Dashboard() {
  const { user } = useAuth()
  const [stats, setStats] = useState({ projects: 0, personas: 0, sessions: 0, completed: 0 })

useEffect(() => {
  api.get('/projects/stats')
    .then(res => {
      const d = res.data.stats
      setStats({
        projects:  parseInt(d.total_projects)   || 0,
        personas:  parseInt(d.total_personas)   || 0,
        sessions:  parseInt(d.total_sessions)   || 0,
        completed: parseInt(d.completed_sessions)|| 0,
      })
    })
    .catch(err => console.error('Stats error', err))
}, [])

  const cards = [
    { label: 'Total Projects',    value: stats.projects,  icon: FolderKanban, color: '#2563eb' },
    { label: 'Personas',          value: stats.personas,  icon: Users,        color: '#7c3aed' },
    { label: 'Sessions Run',      value: stats.sessions,  icon: Activity,     color: '#0891b2' },
    { label: 'Completed',         value: stats.completed, icon: CheckCircle,  color: '#059669' },
  ]

  return (
    <Layout title="Dashboard">

      {/* Welcome banner */}
      <div style={s.welcome}>
        <div>
          <h2 style={s.welcomeTitle}>Welcome back, {user?.fullName?.split(' ')[0]} 👋</h2>
          <p style={s.welcomeSub}>Here's what's happening with your survey testing platform.</p>
        </div>
        <div style={s.badge}>{user?.role?.toUpperCase()}</div>
      </div>

      {/* Stat cards */}
      <div style={s.grid}>
        {cards.map(({ label, value, icon: Icon, color }) => (
          <div key={label} style={s.card}>
            <div style={{ ...s.iconWrap, background: color + '15' }}>
              <Icon size={22} color={color} />
            </div>
            <div style={s.cardVal}>{value}</div>
            <div style={s.cardLabel}>{label}</div>
          </div>
        ))}
      </div>

      {/* Getting started */}
      <div style={s.section}>
        <h3 style={s.sectionTitle}>Getting Started</h3>
        <div style={s.steps}>
          {[
            { n: 1, t: 'Create a Project',  d: 'Set up your first survey testing project with a target URL and countries.', done: false },
            { n: 2, t: 'Build Personas',     d: 'Define respondent personas with demographics and behavioural attributes.', done: false },
            { n: 3, t: 'Configure Quotas',   d: 'Set up your quota plan — gender, age, region splits.', done: false },
            { n: 4, t: 'Run First Session',  d: 'Launch the AI bot to take your survey and review the session log.', done: false },
          ].map(({ n, t, d, done }) => (
            <div key={n} style={s.step}>
              <div style={{ ...s.stepNum, background: done ? '#059669' : '#1e3a5f' }}>{n}</div>
              <div>
                <div style={s.stepTitle}>{t}</div>
                <div style={s.stepDesc}>{d}</div>
              </div>
            </div>
          ))}
        </div>
      </div>

    </Layout>
  )
}

const s = {
  welcome:      { background: 'linear-gradient(135deg, #1e3a5f, #2563eb)', borderRadius: 14, padding: '28px 32px', marginBottom: 24, display: 'flex', alignItems: 'center', justifyContent: 'space-between', color: 'white' },
  welcomeTitle: { fontSize: '1.4rem', fontWeight: 700, marginBottom: 6 },
  welcomeSub:   { fontSize: '0.9rem', opacity: 0.8 },
  badge:        { background: 'rgba(255,255,255,0.15)', padding: '6px 14px', borderRadius: 20, fontSize: '0.75rem', fontWeight: 700, letterSpacing: 1 },
  grid:         { display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 16, marginBottom: 28 },
  card:         { background: 'white', borderRadius: 12, padding: '24px 20px', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  iconWrap:     { width: 46, height: 46, borderRadius: 10, display: 'flex', alignItems: 'center', justifyContent: 'center', marginBottom: 14 },
  cardVal:      { fontSize: '2rem', fontWeight: 800, color: '#1e293b', marginBottom: 4 },
  cardLabel:    { fontSize: '0.82rem', color: '#64748b', fontWeight: 500 },
  section:      { background: 'white', borderRadius: 12, padding: 28, boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  sectionTitle: { fontSize: '1rem', fontWeight: 700, color: '#1e293b', marginBottom: 20 },
  steps:        { display: 'flex', flexDirection: 'column', gap: 16 },
  step:         { display: 'flex', alignItems: 'flex-start', gap: 16 },
  stepNum:      { width: 32, height: 32, borderRadius: '50%', color: 'white', display: 'flex', alignItems: 'center', justifyContent: 'center', fontWeight: 700, fontSize: '0.85rem', flexShrink: 0 },
  stepTitle:    { fontSize: '0.9rem', fontWeight: 600, color: '#1e293b', marginBottom: 3 },
  stepDesc:     { fontSize: '0.82rem', color: '#64748b', lineHeight: 1.5 },
}