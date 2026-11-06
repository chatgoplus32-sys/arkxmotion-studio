import { StrictMode } from 'react'
import { createRoot } from 'react-dom/client'
import './index.css'
import App from './App.tsx'

// Restore dead blob URLs from IndexedDB BEFORE React renders.
// After a page reload, all blob: URLs are dead. This replaces them
// with fresh blob URLs by loading video data from IndexedDB.
import { restoreIdbVideos } from '@/lib/backgroundTasks'
import { promptForNotificationsIfNeeded } from '@/lib/notify'

restoreIdbVideos().then(() => {
  if ('serviceWorker' in navigator) {
    window.addEventListener('load', () => {
      navigator.serviceWorker
        .register('/sw.js')
        .then((reg) => {
          // Pastikan SW selalu versi terbaru — tanpa ini SW lama bisa bertahan
          // dan halaman tetap memakai kode lama sampai cache browser habis.
          reg.update().catch(() => {})
          const activateWaiting = () => {
            const waiting = reg.waiting
            if (waiting) waiting.postMessage({ type: 'SKIP_WAITING' })
          }
          reg.addEventListener('updatefound', activateWaiting)
          activateWaiting()
          // Cek SW baru tiap 60 detik supaya update tidak menunggu reload.
          window.setInterval(() => reg.update().catch(() => {}), 60000)
        })
        .catch((e) => console.warn('[sw] register failed:', e))
    })
  }
  // Best-effort saat load; page yang punya tombol Generate juga meminta izin
  // di dalam gestur klik (lihat ImageToVideo) supaya prompt benar-benar muncul.
  window.addEventListener('load', () => { promptForNotificationsIfNeeded() })

  createRoot(document.getElementById('root')!).render(
    <StrictMode>
      <App />
    </StrictMode>,
  )
})
