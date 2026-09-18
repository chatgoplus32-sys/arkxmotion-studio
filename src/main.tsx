import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

if ('serviceWorker' in navigator) {
  window.addEventListener('load', () => {
    navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw] register failed:', e))
    if (Notification && Notification.permission === 'default') Notification.requestPermission().catch((e) => console.warn('[notify] permission failed:', e))
  })
  document.addEventListener('visibilitychange', async () => {
    if (!document.hidden) {
      try { const m = await import('@/lib/backgroundTasks'); m.startBackgroundPolling() } catch (e) { console.warn('[bg] startBackgroundPolling failed:', e) }
    }
  })
}
createRoot(document.getElementById('root')!).render(
  <StrictMode>
    <App />
  </StrictMode>,
)
