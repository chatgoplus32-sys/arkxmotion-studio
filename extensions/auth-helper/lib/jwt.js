// ─── Utilitas JWT bersama ────────────────────────────────────────────────────
// Dipakai background dan popup. Predikatnya sengaja dibuat SAMA dengan yang
// dipakai app (src/lib/oneover.ts, src/lib/galleri5.ts, src/pages/Providers.tsx)
// supaya token yang kita salin pasti diterima parser di halaman Providers.

/** JWT = tiga segmen dipisah titik dan segmen pertama diawali `eyJ`. */
export function isJwt(value) {
  return /^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(String(value ?? '').trim())
}

/**
 * Refresh token (Firebase G5 `AMf-...` maupun Supabase) = tanpa titik dan
 * panjang. Batas 60 karakter diambil dari app supaya klasifikasinya konsisten.
 */
export function isRefreshToken(value) {
  const t = String(value ?? '').trim()
  return !t.includes('.') && /^[\w-]{60,}$/.test(t)
}

/** Payload JWT (objek) atau null kalau bukan JWT / payload-nya tidak terbaca. */
export function decodeJwt(token) {
  const t = String(token ?? '').trim()
  if (!isJwt(t)) return null
  try {
    const payload = t.split('.')[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const binary = atob(padded)
    // Payload bisa memuat karakter non-ASCII (nama), jadi decode manual UTF-8.
    const json = decodeURIComponent(
      binary
        .split('')
        .map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2))
        .join(''),
    )
    const parsed = JSON.parse(json)
    return parsed && typeof parsed === 'object' ? parsed : null
  } catch {
    return null
  }
}

/** Waktu kedaluwarsa (ms epoch) dari klaim `exp`, atau null. */
export function jwtExpiryMs(token) {
  const payload = decodeJwt(token)
  return payload && payload.exp ? payload.exp * 1000 : null
}

/** Email/identitas yang bisa dibaca dari payload, untuk ditampilkan di kartu. */
export function jwtIdentity(token) {
  const payload = decodeJwt(token)
  if (!payload) return { email: '', sub: '' }
  return {
    email: payload.email || payload.user_metadata?.email || payload.name || '',
    sub: String(payload.sub || payload.user_id || payload.uid || ''),
  }
}

/** Sidik jari pendek untuk dedupe & tampilan (bukan rahasia, hanya sebagian). */
export function fingerprint(token) {
  const t = String(token ?? '').trim()
  if (!t) return ''
  return `${t.slice(0, 18)}…${t.length}`
}

/** Label sisa umur token, mis. "42 mnt lagi" / "kedaluwarsa 3 mnt lalu". */
export function expiryLabel(expMs, nowMs = Date.now()) {
  if (!expMs) return 'tanpa exp'
  const diff = expMs - nowMs
  const abs = Math.abs(diff)
  const minutes = Math.round(abs / 60_000)
  const text = minutes < 60 ? `${Math.max(1, minutes)} mnt` : `${Math.round(minutes / 60)} jam`
  return diff > 0 ? `sisa ${text}` : `kedaluwarsa ${text} lalu`
}
