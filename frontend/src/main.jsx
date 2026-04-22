import React from 'react'
import ReactDOM from 'react-dom/client'

function App() {
  return (
    <div style={{ 
      display: 'flex', alignItems: 'center', justifyContent: 'center', 
      height: '100vh', fontFamily: 'Arial, sans-serif',
      background: '#1F4E79', color: 'white', flexDirection: 'column'
    }}>
      <h1 style={{ fontSize: '3rem', marginBottom: '1rem' }}>SurveyQA Pro</h1>
      <p style={{ fontSize: '1.2rem', opacity: 0.8 }}>Platform is deploying...</p>
      <p style={{ fontSize: '1rem', opacity: 0.6, marginTop: '2rem' }}>
        alpha.injtechnologies.com
      </p>
    </div>
  )
}

ReactDOM.createRoot(document.getElementById('root')).render(<App />)