// ─── Kunci server Alriz / Seavi ─────────────────────────────────────────────
// Member yang sudah top up saldo provider tidak wajib punya API key sendiri:
// relay /api/public/{alriz,seavi} bisa memasang kunci milik operator untuk
// mereka. Kunci itu tidak pernah sampai ke browser — klien hanya mengirim
// identitas app (JWT) dan, untuk request yang membuat job, tiket pembayaran
// dari /api/{alriz,seavi}/deduct.
//
// Nilai sentinel di bawah dipakai sebagai `apiKey` di lib provider: selama
// berupa string biasa, header Authorization berisi kunci member seperti dulu.
// Sengaja tanpa alias `@/`: modul ini ikut di-import lib klien yang dites
// langsung lewat tsx (tanpa resolver alias Vite), dan tanpa store auth supaya
// impor tidak menyentuh `localStorage` saat modul dimuat di Node.
import type { ProviderKey } from '../stores/providerManager.js'

/** Penanda "pakai kunci server" di parameter apiKey lib provider. */
export const SERVER_KEY = '__arkxmotion_server_key__'

export function isServerKey(apiKey: string | null | undefined): boolean {
  return apiKey === SERVER_KEY
}

/** JWT app untuk relay. Null kalau sesi tidak ada / sudah dihapus. */
export function appToken(): string | null {
  if (typeof window === 'undefined') return null
  try {
    return localStorage.getItem('arkxmotion_token')
  } catch {
    return null
  }
}

/**
 * Header kredensial relay.
 *
 * - kunci member → `Authorization: Bearer <key>` (perilaku lama)
 * - kunci server → `X-App-Token` + `X-Provider-Charge` (hanya submit)
 *
 * Header `Authorization` sengaja TIDAK dikirim pada jalur server: relay
 * menganggap Authorization sebagai kunci member, dan kunci server tidak boleh
 * pernah menyentuh browser.
 */
export function relayAuthHeaders(apiKey: string, chargeId?: number | null): Record<string, string> {
  if (!isServerKey(apiKey)) {
    return apiKey ? { Authorization: `Bearer ${apiKey}` } : {}
  }
  const token = appToken()
  const headers: Record<string, string> = {}
  if (token) headers['X-App-Token'] = token
  if (typeof chargeId === 'number' && chargeId > 0) headers['X-Provider-Charge'] = String(chargeId)
  return headers
}

/**
 * Entri kunci semu supaya `withTokenRotation` bisa menjalankan satu percobaan
 * lewat relay tanpa kunci member. Tidak pernah disimpan ke providerManager.
 */
export function serverKeyEntry(provider: 'alriz' | 'seavi'): ProviderKey {
  return {
    id: `server-key:${provider}`,
    key: SERVER_KEY,
    name: provider === 'alriz' ? 'Kunci server Alriz' : 'Kunci server Seavi',
    status: 'active',
  }
}
