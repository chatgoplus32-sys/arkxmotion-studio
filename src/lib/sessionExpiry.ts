// ─── Umur access token app ──────────────────────────────────────────────────
// Access token app ditandatangani dengan `expiresIn: '15m'` di
// server/routes/auth.ts (ACCESS_EXPIRES); versi Vercel memakai 7 hari. Yang
// penting di sini bukan angkanya, tapi bahwa KEDALUWARSA ITU NORMAL: selama ini
// sesi baru diperpanjang kalau ada respons 401, dan tidak ada satu pun kode
// yang memeriksa sisa umur token. Akibatnya sesi mati di tengah jalan setiap
// 15 menit, dan poller auto-sync (delapan provider tiap 10 detik) menghujani
// server dengan 403 "Invalid or expired token" sampai pengguna login ulang.
//
// Logikanya sengaja murni (cuma membaca klaim JWT, tanpa store/DOM) supaya bisa
// diuji tanpa browser — lihat test/sessionExpiry.test.ts.

/** Umur access token app menurut server/routes/auth.ts (ACCESS_EXPIRES). */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000

/**
 * Perbarui token kalau sisa umurnya kurang dari ini. Cukup lebar untuk menutup
 * satu siklus poll auto-sync (10 detik) plus latensi jaringan, tapi tidak
 * me-refresh token yang masih segar.
 */
export const REFRESH_MARGIN_MS = 3 * 60 * 1000

interface JwtPayload {
  exp?: number
}

function decodePayload(token: string): JwtPayload | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const text = typeof atob === 'function'
      ? atob(padded)
      : new TextDecoder().decode(Uint8Array.from(padded, (c) => c.charCodeAt(0)))
    const obj = JSON.parse(text)
    return obj && typeof obj === 'object' ? (obj as JwtPayload) : null
  } catch {
    return null
  }
}

/** Kapan token kedaluwarsa (ms), atau null kalau tidak terbaca / tanpa `exp`. */
export function tokenExpiresAt(token: string | null | undefined): number | null {
  if (!token) return null
  const payload = decodePayload(token)
  if (!payload || typeof payload.exp !== 'number' || !Number.isFinite(payload.exp)) return null
  return payload.exp * 1000
}

/**
 * Apakah token perlu diperbarui sekarang. Token yang tidak ada atau tidak
 * terbaca dianggap perlu: dengan refresh token yang masih ada, sesi seperti itu
 * masih bisa diselamatkan — dan mencoba jauh lebih murah daripada membiarkannya
 * mati dan memaksa login ulang.
 */
export function isTokenExpiring(
  token: string | null | undefined,
  now = Date.now(),
  marginMs = REFRESH_MARGIN_MS,
): boolean {
  const exp = tokenExpiresAt(token)
  if (exp == null) return true
  return exp - now <= marginMs
}

/** Sisa umur token dalam detik (null kalau tidak terbaca) — untuk diagnosa. */
export function secondsUntilExpiry(token: string | null | undefined, now = Date.now()): number | null {
  const exp = tokenExpiresAt(token)
  if (exp == null) return null
  return Math.round((exp - now) / 1000)
}
