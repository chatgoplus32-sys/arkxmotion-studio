// ─── Reader halaman ──────────────────────────────────────────────────────────
// Setiap fungsi di sini dijalankan DI DALAM halaman lewat
// chrome.scripting.executeScript({ func, args }), jadi syaratnya: berdiri
// sendiri (tidak menutup variabel modul) dan hasilnya bisa diserialisasi.
//
// Semuanya mengembalikan { entries: [{ token, refreshToken, email, source }] }.
// Identitas & masa berlaku TIDAK dihitung di sini — background yang mendekode
// JWT-nya, supaya logika parsing hanya ada di satu tempat (lib/tokens.js).

/** Sesi Firebase (dipakai Galleri5) dari IndexedDB `firebaseLocalStorageDb`. */
export function firebaseIndexedDb() {
  return new Promise((resolve) => {
    const done = (entries) => resolve({ entries })
    try {
      const open = indexedDB.open('firebaseLocalStorageDb')
      open.onerror = () => done([])
      open.onblocked = () => done([])
      open.onsuccess = (event) => {
        let tx
        try {
          tx = event.target.result.transaction('firebaseLocalStorage', 'readonly')
        } catch {
          return done([])
        }
        const out = []
        const cursor = tx.objectStore('firebaseLocalStorage').openCursor()
        cursor.onerror = () => done(out)
        cursor.onsuccess = (ev) => {
          const row = ev.target.result
          if (!row) return done(out)
          const value = row.value && row.value.value
          const sts = value && value.stsTokenManager
          if (sts && sts.accessToken) {
            out.push({
              token: sts.accessToken,
              refreshToken: sts.refreshToken || '',
              email: (value && value.email) || '',
              source: 'indexeddb:firebaseLocalStorage',
            })
          }
          cursor.continue()
        }
      }
    } catch {
      done([])
    }
  })
}

/**
 * Sesi Supabase (OneOver) dari localStorage. Tiga strategi, dari yang paling
 * pasti ke yang paling longgar: kunci `sb-...-auth-token` baku → semua kunci
 * berawalan `sb-` → nilai mana pun yang terlihat seperti JSON sesi.
 */
export function supabaseLocalStorage(ctx) {
  const storageKey = (ctx && ctx.storageKey) || ''
  const out = []
  const push = (entry) => {
    if (!entry.token) return
    if (out.some((item) => item.token === entry.token)) return
    out.push(entry)
  }
  const readValue = (raw, source) => {
    if (!raw) return
    try {
      const parsed = JSON.parse(raw)
      const session = parsed.current_session || parsed.session || parsed
      if (session && session.access_token) {
        push({
          token: session.access_token,
          refreshToken: session.refresh_token || '',
          email: (session.user && session.user.email) || parsed.user?.email || '',
          source,
        })
      }
    } catch {
      /* bukan JSON: tidak apa-apa, strategi berikutnya menanganinya */
    }
  }

  try {
    if (storageKey) readValue(localStorage.getItem(storageKey), 'localStorage:' + storageKey)
    if (!out.length) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        if (key.startsWith('sb-') && key.includes('auth')) {
          readValue(localStorage.getItem(key), 'localStorage:' + key)
        }
      }
    }
    if (!out.length) {
      for (let i = 0; i < localStorage.length; i++) {
        const key = localStorage.key(i) || ''
        const value = localStorage.getItem(key) || ''
        if (value.length > 100 && value.includes('eyJ')) readValue(value, 'localStorage:' + key)
      }
    }
    // Beberapa build menyimpan sesi di sessionStorage, bukan localStorage.
    if (!out.length && storageKey) readValue(sessionStorage.getItem(storageKey), 'sessionStorage')
  } catch {
    /* storage bisa diblokir (mode privat / kebijakan situs) */
  }
  return { entries: out }
}

/**
 * Fallback Firefly: Adobe menyimpan token di cookie (HttpOnly) sehingga tidak
 * selalu terbaca, tapi sebagian nilai di Web Storage masih berbentuk JWT. Yang
 * paling sering berguna tetap interceptor jaringan; ini hanya jaring pengaman.
 */
export function fireflyPageScan() {
  const out = []
  const looksLikeJwt = (value) => /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(String(value || '').trim())
  const scan = (storage, label) => {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || ''
        const value = storage.getItem(key) || ''
        const trimmed = value.trim()
        if (looksLikeJwt(trimmed)) {
          out.push({ token: trimmed, refreshToken: '', source: `${label}:${key}` })
          continue
        }
        // Nilai JSON yang menyimpan token di dalamnya (mis. { access_token }).
        if (value.length > 80 && value.includes('eyJ')) {
          try {
            const parsed = JSON.parse(value)
            const candidates = [parsed.access_token, parsed.token, parsed.imsToken, parsed.current_session?.access_token]
            const token = candidates.find((c) => looksLikeJwt(c))
            if (token) out.push({ token, refreshToken: parsed.refresh_token || '', source: `${label}:${key}` })
          } catch {
            const match = value.match(/eyJ[\w-]*\.[\w-]+\.[\w-]+/)
            if (match) out.push({ token: match[0], refreshToken: '', source: `${label}:${key}` })
          }
        }
      }
    } catch {
      /* diabaikan */
    }
  }
  scan(localStorage, 'localStorage')
  scan(sessionStorage, 'sessionStorage')
  return { entries: out }
}

/**
 * Reader generik (pengganti jwt-extractor-extension): cari JWT di cookie yang
 * bisa dibaca halaman, localStorage, dan sessionStorage. Dipakai untuk provider
 * yang tidak punya content script tetap — Leonardo (Cognito), Framia (Auth0),
 * dan apa pun yang sedang terbuka di tab.
 */
export function activeTabJwt() {
  const out = []
  const push = (token, source, refreshToken = '') => {
    const clean = String(token || '').trim()
    if (!/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(clean)) return
    if (out.some((item) => item.token === clean)) return
    out.push({ token: clean, refreshToken, source })
  }

  const scan = (storage, label) => {
    try {
      for (let i = 0; i < storage.length; i++) {
        const key = storage.key(i) || ''
        const value = storage.getItem(key) || ''
        if (/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(value.trim())) {
          push(value, `${label}:${key}`)
          continue
        }
        if (value.length > 80 && value.includes('eyJ')) {
          const matches = value.match(/eyJ[\w-]*\.[\w-]+\.[\w-]+/g) || []
          for (const match of matches.slice(0, 3)) push(match, `${label}:${key}`)
        }
      }
    } catch {
      /* diabaikan */
    }
  }

  try {
    for (const cookie of document.cookie.split(';')) {
      const value = decodeURIComponent(cookie.trim().split('=').slice(1).join('='))
      push(value, 'cookie')
    }
  } catch {
    /* diabaikan */
  }
  scan(localStorage, 'localStorage')
  scan(sessionStorage, 'sessionStorage')
  return { entries: out.slice(0, 10) }
}

/** Nama reader yang boleh dipanggil background (sesuai registry provider). */
export const READERS = {
  firebaseIndexedDb,
  supabaseLocalStorage,
  fireflyPageScan,
  activeTabJwt,
}
