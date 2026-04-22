import React from 'react'
import Layout from '../components/Layout'
import { Activity } from 'lucide-react'

export default function Sessions() {
  return (
    <Layout title="Sessions">
      <div style={s.empty}>
        <Activity size={48} color="#cbd5e1" />
        <h3 style={s.emptyTitle}>No Sessions Yet</h3>
        <p style={s.emptyDesc}>Sessions appear here once you launch a test run on a project.</p>
      </div>
    </Layout>
  )
}

const s = {
  empty:      { background: 'white', borderRadius: 12, padding: '80px 40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  emptyTitle: { fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '16px 0 8px' },
  emptyDesc:  { color: '#64748b', fontSize: '0.9rem' },
}