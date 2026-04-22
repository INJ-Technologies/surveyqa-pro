import React from 'react'
import Layout from '../components/Layout'
import { FolderKanban } from 'lucide-react'

export default function Projects() {
  return (
    <Layout title="Projects">
      <div style={s.empty}>
        <FolderKanban size={48} color="#cbd5e1" />
        <h3 style={s.emptyTitle}>No Projects Yet</h3>
        <p style={s.emptyDesc}>Create your first survey testing project to get started.</p>
        <button style={s.btn}>+ New Project</button>
      </div>
    </Layout>
  )
}

const s = {
  empty:      { background: 'white', borderRadius: 12, padding: '80px 40px', textAlign: 'center', boxShadow: '0 1px 3px rgba(0,0,0,0.06)' },
  emptyTitle: { fontSize: '1.1rem', fontWeight: 700, color: '#1e293b', margin: '16px 0 8px' },
  emptyDesc:  { color: '#64748b', fontSize: '0.9rem', marginBottom: 24 },
  btn:        { background: '#1e3a5f', color: 'white', border: 'none', borderRadius: 8, padding: '11px 24px', fontSize: '0.9rem', fontWeight: 600, cursor: 'pointer' },
}