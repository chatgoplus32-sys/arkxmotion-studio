import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Restore dead blob URLs from IndexedDB BEFORE React renders.
// After a page reload, all blob: URLs are dead. This replaces them
// with fresh blob URLs by loading video data from IndexedDB.
import { restoreIdbVideos } from '@/lib/backgroundTasks'

restoreIdbVideos().then(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch((e) => console.warn('[sw] register failed:', e))
      if (Notification && Notification.permission === 'default') Notification.requestPermission().catch((e) => console.warn('[notify] permission failed:', e))
    })
  }

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
