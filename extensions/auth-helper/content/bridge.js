// ─── auth-helper — jembatan halaman ↔ background (world: ISOLATED) ───────────
// Dua tugas:
//  1. meneruskan hasil tangkapan interceptor (window.postMessage) ke background;
//  2. memasang tombol mengambang "Copy <provider> token" di situs provider.
//
// Script ini sengaja tidak tahu daftar provider: ia bertanya ke background
// (registry ada di providers.js), jadi menambah provider tidak menyentuh file
// ini sama sekali.

;(() => {
  if (window.__arkxAuthHelperBridge) return
  window.__arkxAuthHelperBridge = true

  // Sidik jari token yang sudah dilaporkan di halaman ini — mencegah spam pesan
  // saat situs memanggil API yang sama puluhan kali.
  const reported = new Set()
  let mounting = false

  function send(message) {
    try {
      const result = chrome.runtime.sendMessage(message)
      if (result && typeof result.catch === 'function') result.catch(() => {})
    } catch {
      /* service worker bisa sedang tidak aktif */
    }
  }

  function ask(message) {
    return new Promise((resolve) => {
      try {
        chrome.runtime.sendMessage(message, (response) => {
          resolve(chrome.runtime.lastError ? null : response)
        })
      } catch {
        resolve(null)
      }
    })
  }

  window.addEventListener('message', (event) => {
    if (event.source !== window) return
    const data = event.data
    if (!data || data.__arkxAuthHelper !== true) return
    if (data.kind !== 'network' && data.kind !== 'refresh') return
    const fingerprint = String(data.token || data.refreshToken || '').slice(0, 24)
    if (!fingerprint || reported.has(fingerprint)) return
    reported.add(fingerprint)
    send({
      type: 'capture',
      payload: {
        url: data.url,
        token: data.token || '',
        refreshToken: data.refreshToken || '',
        source: data.source || 'network',
        extra: data.extra || {},
      },
    })
  })

  async function mountButton() {
    if (mounting || document.getElementById('arkx-auth-helper-btn')) return
    mounting = true
    try {
      const response = await ask({ type: 'provider_for_host', host: location.hostname })
      const provider = response && response.provider
      if (!provider || document.getElementById('arkx-auth-helper-btn')) return
      const label = `${provider.emoji} Copy ${provider.label} token`
      const button = document.createElement('div')
      button.id = 'arkx-auth-helper-btn'
      button.textContent = label
      button.style.cssText = [
        'position:fixed',
        'bottom:20px',
        'right:20px',
        'z-index:2147483647',
        `background:${provider.ink}`,
        'color:#111',
        'padding:10px 16px',
        'border-radius:12px',
        'font:600 13px/1 system-ui,-apple-system,sans-serif',
        'cursor:pointer',
        'box-shadow:0 6px 20px rgba(0,0,0,.35)',
        'user-select:none',
      ].join(';')
      button.onclick = async () => {
        button.textContent = '⏳ Mengambil…'
        const best = await ask({ type: 'best_token', providerId: provider.id })
        if (!best || !best.payload) {
          button.textContent = `❌ Belum ada token ${provider.label}`
        } else {
          try {
            await navigator.clipboard.writeText(best.payload)
            button.textContent = '✅ Tersalin ke clipboard'
          } catch {
            button.textContent = '⚠️ Clipboard diblokir — pakai popup ekstensi'
          }
        }
        setTimeout(() => {
          button.textContent = label
        }, 2500)
      }
      document.body.appendChild(button)
    } finally {
      mounting = false
    }
  }

  if (document.body) mountButton()
  else document.addEventListener('DOMContentLoaded', mountButton, { once: true })

  // Situs provider semuanya SPA; kalau tombolnya ikut terhapus saat re-render,
  // pasang lagi. mountButton sudah mengembalikan lebih awal kalau sudah ada.
  new MutationObserver(() => {
    if (!document.getElementById('arkx-auth-helper-btn')) mountButton()
  }).observe(document.documentElement, { childList: true, subtree: true })
})()
