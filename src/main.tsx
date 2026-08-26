import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch(()=>{})
    if (Notification && Notification.permission === 'default') Notification.requestPermission().catch(()=>{})
  })
  document.addEventListener('visibilitychange', () => { if (!document.hidden) { try { const { startBackgroundPolling } = require('@/lib/backgroundTasks'); startBackgroundPolling() } catch {} } })
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
