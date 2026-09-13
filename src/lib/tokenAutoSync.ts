import { useProviderManager, type ProviderId, type ProviderKey } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import { useTokenSyncStore } from '@/stores/tokenSyncStore'
import { useAuthStore } from '@/stores/authStore'

// ─── Auto-sync extension→app ────────────────────────────────────────────────
// Provider yang tokennya pendek umurnya (session JWT / access token) dan punya
// extension yang mengirim token terbaru ke /api/sync-tokens. App polling tiap
// 30 detik: token baru otomatis menggantikan key yang expired, lalu LANGSUNG
// menjalankan "Cek Limit & Status" untuk key tersebut biar balance & pool
// summary selalu segar — tanpa klik manual.

export interface AutoSyncDef {
  id: ProviderId
  label: string
  icon: string
  /**
   * 'token' (default) = yang dikirim extension adalah JWT / API key → field `key`.
   * 'cookie' = header Cookie session (NexaBot) → field `cookies` pada key session,
   * sehingga generate tetap lewat jalur web /api/v1/generate (paket Unlimited).
   */
  kind?: 'token' | 'cookie'
}

export const AUTO_SYNC_PROVIDERS: AutoSyncDef[] = [
  { id: 'riverside', label: 'Riverside', icon: '🎙️' },
  { id: 'roboneo', label: 'Roboneo', icon: '🤖' },
  { id: 'weavy', label: 'Weavy', icon: '🌊' },
  { id: 'leonardo', label: 'Leonardo', icon: '🎨' },
  { id: 'nexabot', label: 'NexaBot', icon: '🧠', kind: 'cookie' },
  // Token yang dikirim extension auth-helper (G5/OneOver/Firefly) masuk ke field
  // `key`, jadi key di halaman Providers ikut segar tanpa copy-paste.
  { id: 'galleri5', label: 'G5 AI Studio', icon: '🎬' },
  { id: 'oneover', label: 'OneOver', icon: '🔮' },
  { id: 'firefly', label: 'Adobe Firefly', icon: '🔥' },
]

// ── JWT identity (email/sub) — untuk mencocokkan key akun yang sama ────────
interface JwtClaims {
  email?: string
  sub?: string
}

function decodeJwtClaims(token: string): JwtClaims | null {
  try {
    const parts = token.split('.')
    if (parts.length < 2) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - (payload.length % 4)) % 4)
    const text = typeof atob === 'function'
      ? atob(padded)
      : new TextDecoder().decode(Uint8Array.from(padded, (c) => c.charCodeAt(0)))
    const obj = JSON.parse(text)
    return {
      email: obj.email || obj.user_email || undefined,
      sub: obj.sub || obj.user_id || obj.uid || undefined,
    }
  } catch {
    return null
  }
}

function identityOf(token: string): string | null {
  const claims = decodeJwtClaims(token)
  if (!claims) return null
  return claims.email || claims.sub || null
}

// ── Terapkan token baru ke store provider ───────────────────────────────────
async function replaceOrAddKey(def: AutoSyncDef, fresh: string): Promise<{ changed: boolean; action: 'replaced' | 'added'; keyId?: string }> {
  const pm = useProviderManager.getState()
  const keys = pm.keys[def.id] || []

  // Token sudah tersimpan → tidak perlu apa-apa (biar antrian dikonsumsi)
  if (keys.some((k) => k.key === fresh)) return { changed: false, action: 'replaced' }

  const freshIdent = identityOf(fresh)

  // 1) Key akun sama (email/sub identik) → replace, apapun statusnya
  if (freshIdent) {
    for (const k of keys) {
      const kIdent = identityOf(k.key)
      if (kIdent && kIdent === freshIdent) {
        pm.replaceKey(def.id, k.id, fresh)
        return { changed: true, action: 'replaced', keyId: k.id }
      }
    }
  }

  // 2) Key expired/invalid → replace
  const deadIdx = keys.findIndex((k) => k.status === 'expired' || k.status === 'invalid')
  if (deadIdx >= 0) {
    pm.replaceKey(def.id, keys[deadIdx].id, fresh)
    return { changed: true, action: 'replaced', keyId: keys[deadIdx].id }
  }

  // 3) Belum ada key → tambah
  if (keys.length === 0) {
    pm.addKey(def.id, fresh)
    const added = useProviderManager.getState().keys[def.id]
    const key = added[added.length - 1]
    return { changed: true, action: 'added', keyId: key?.id }
  }

  // 4) Hanya 1 key → anggap refresh sesi yang sama
  if (keys.length === 1) {
    pm.replaceKey(def.id, keys[0].id, fresh)
    return { changed: true, action: 'replaced', keyId: keys[0].id }
  }

  // 5) Multi-key tanpa identitas cocok → tambah sebagai key baru (akun lain)
  pm.addKey(def.id, fresh)
  const added = useProviderManager.getState().keys[def.id]
  const key = added[added.length - 1]
  return { changed: true, action: 'added', keyId: key?.id }
}

// ── Terapkan cookie session (NexaBot) ke key mode session ───────────────────
// Cookie tidak menempati field `key` (itu untuk API key nxb_…), tapi `cookies`
// supaya backend memakai jalur web /api/v1/generate — di situlah paket Unlimited
// NexaBot dihormati. Extension NexaBot mengirim ini otomatis, jadi user tidak
// perlu lagi Copy as cURL manual.
async function applyCookieSession(
  def: AutoSyncDef,
  cookies: string
): Promise<{ changed: boolean; action: 'replaced' | 'added'; keyId?: string }> {
  const pm = useProviderManager.getState()
  const keys = pm.keys[def.id] || []

  // 1) Sudah ada key session → timpa cookie-nya (menggantikan cookie kedaluwarsa).
  const sessionKey = keys.find((k) => k.cookies)
  if (sessionKey) {
    if (sessionKey.cookies === cookies) return { changed: false, action: 'replaced', keyId: sessionKey.id }
    pm.setKeyCookies(def.id, sessionKey.id, cookies)
    return { changed: true, action: 'replaced', keyId: sessionKey.id }
  }

  // 2) Ada key kosong tanpa API key (placeholder "Session (cookie)") → pakai itu.
  const placeholder = keys.find((k) => !k.key)
  if (placeholder) {
    pm.setKeyCookies(def.id, placeholder.id, cookies)
    return { changed: true, action: 'replaced', keyId: placeholder.id }
  }

  // 3) Belum ada key sama sekali → buat key khusus session (tanpa API key).
  pm.addKey(def.id, '', 'Session (cookie · extension)')
  const added = useProviderManager.getState().keys[def.id]
  const created = added[added.length - 1]
  if (!created) return { changed: false, action: 'added' }
  pm.setKeyCookies(def.id, created.id, cookies)
  return { changed: true, action: 'added', keyId: created.id }
}

// Header auth untuk endpoint sync. Di produksi (`api/sync-tokens.ts`) endpoint
// ini jalan tanpa server lokal tapi WAJIB JWT user — credential disimpan per
// user_id di Postgres, bukan queue global yang bisa dibaca siapa saja.
// Di dev, route ini dipegang Express lokal (`server/routes/syncTokens.ts`) yang
// mengabaikan header tersebut.
function syncAuthHeaders(): Record<string, string> {
  const token = useAuthStore.getState().token
  return token ? { Authorization: `Bearer ${token}` } : {}
}

// ── Cek Limit & Status otomatis per provider ───────────────────────────────
type CheckOutcome = {
  status?: ProviderKey['status']
  balance?: number | null
  email?: string
  note?: string
}

async function runProviderCheck(def: AutoSyncDef, key: string): Promise<CheckOutcome> {
  try {
    if (def.id === 'nexabot') {
      // `key` di sini adalah cookie session yang baru dikirim extension.
      const { checkNexabotSession } = await import('@/lib/nexabot')
      const r = await checkNexabotSession(key)
      if (!r.ok) return { status: undefined, note: r.error || 'Sesi belum bisa diverifikasi' }
      if (!r.active) return { status: 'invalid', note: 'Masa berlaku sesi sudah berakhir — login ulang di nexabot.id' }
      return {
        status: 'active',
        balance: r.balance,
        email: r.email || undefined,
        note: r.unlimited
          ? 'paket UNLIMITED aktif'
          : (r.plan ? `sesi aktif (${r.plan})` : 'sesi aktif'),
      }
    }
    if (def.id === 'riverside') {
      const { checkRiversideBalance } = await import('@/lib/riverside')
      const r = await checkRiversideBalance(key)
      if (!r.ok) return { status: r.state === 'invalid' ? 'invalid' : undefined, note: r.error }
      return {
        status: r.state === 'empty' ? 'empty' : r.state === 'invalid' ? 'invalid' : 'active',
        balance: r.balance,
        email: r.email,
        note: r.detail,
      }
    }
    if (def.id === 'roboneo') {
      const { checkRoboneoBalance } = await import('@/lib/roboneo')
      const r = await checkRoboneoBalance(key)
      if (r.ok && r.isValidUser !== false) {
        const bal = r.balance ?? null
        return { status: bal != null && bal <= 0 ? 'empty' : 'active', balance: bal }
      }
      if (r.isValidUser === false) return { status: 'invalid', note: 'Token tidak valid' }
      return { status: undefined, note: r.error || 'Gagal cek token' }
    }
    if (def.id === 'weavy') {
      const { checkWeavyBalance } = await import('@/lib/weavy')
      const r = await checkWeavyBalance(key)
      if (r.ok) {
        const bal = r.balance ?? null
        return {
          status: bal != null && bal <= 0 ? 'empty' : 'active',
          balance: bal,
          email: r.email,
        }
      }
      if (r.error?.includes('expired')) return { status: 'invalid', note: r.error }
      return { status: undefined, note: r.error || 'Gagal cek token' }
    }
    if (def.id === 'leonardo') {
      const { fetchLeonardoBalance } = await import('@/lib/leonardo')
      const r = await fetchLeonardoBalance(key)
      if (r.ok) {
        const bal = r.balance ?? 0
        return {
          status: bal <= 0 ? 'empty' : 'active',
          balance: bal,
          email: r.email,
        }
      }
      const msg = r.message || ''
      if (/expired|401|403/i.test(msg)) return { status: 'invalid', note: msg }
      return { status: undefined, note: msg || 'Gagal cek token' }
    }
    if (def.id === 'galleri5') {
      // Extension mengirim refresh token (AMf-...) — app menukarnya ke ID token
      // sendiri; kalau yang tersimpan sudah JWT, pakai apa adanya.
      const galleri5 = await import('@/lib/galleri5')
      const trimmed = key.trim()
      const accessToken = /^eyJ/.test(trimmed) ? trimmed : await galleri5.resolveAccessTokenFromKey(trimmed)
      if (!accessToken) {
        return { status: 'invalid', note: 'Refresh token G5 tidak bisa di-resolve — login ulang di aistudio.galleri5.com' }
      }
      const r = await galleri5.checkGalleri5Balance({ Accept: '*/*', Authorization: `Bearer ${accessToken}` })
      if (r.ok) {
        const bal = r.balance
        return {
          status: bal != null && bal <= 0 ? 'empty' : 'active',
          balance: bal,
          email: r.email,
          note: r.plan || undefined,
        }
      }
      if (galleri5.isGalleri5TokenError(r.error || '')) return { status: 'invalid', note: r.error }
      return { status: undefined, note: r.error || 'Gagal cek token' }
    }
    if (def.id === 'oneover') {
      const oneover = await import('@/lib/oneover')
      const accessToken = await oneover.resolveOneOverAccessToken(key)
      const userId = oneover.extractOneOverUserId(accessToken)
      const r = await oneover.checkOneOverBalance(accessToken, userId || undefined)
      if (r.ok) {
        const bal = r.balance ?? null
        return { status: bal != null && bal <= 0 ? 'empty' : 'active', balance: bal }
      }
      if (/expired|refresh|401|403/i.test(r.error || '')) {
        return { status: 'invalid', note: 'Token OneOver expired — login ulang di oneover.com' }
      }
      return { status: undefined, note: r.error || 'Gagal cek token' }
    }
    if (def.id === 'firefly') {
      const { checkFireflyBalance } = await import('@/lib/firefly')
      const r = await checkFireflyBalance(key)
      if (r.ok) {
        const bal = r.balance ?? null
        return { status: bal != null && bal <= 0 ? 'empty' : 'active', balance: bal, note: r.plan || undefined }
      }
      if (/expired|401|403|jwt/i.test(r.error || '')) return { status: 'invalid', note: r.error }
      return { status: undefined, note: r.error || 'Gagal cek token' }
    }
    return { status: undefined }
  } catch (err: any) {
    return { status: undefined, note: err?.message || 'Gagal cek token' }
  }
}

function consumeQueueToken(provider: string, token: string) {
  fetch(`/api/sync-tokens/${provider}/consume`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', ...syncAuthHeaders() },
    body: JSON.stringify({ token }),
  }).catch(() => {})
}

// Mirip tombol "Cek Limit & Status": sinkronkan balance key yang baru
// di-refresh ke DB admin (Credit Management) kalau user sudah login.
function syncCreditsToDb(def: AutoSyncDef) {
  const token = useAuthStore.getState().token
  if (!token) return
  const keys = useProviderManager.getState().keys[def.id] || []
  if (keys.length === 0) return
  const updates = keys.map((k) => ({ credits: k.balance ?? 0 }))
  fetch('/api/admin/credits/sync', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ provider: def.id, updates }),
  }).catch(() => {})
}

function summarize(def: AutoSyncDef, outcome: CheckOutcome, action: 'replaced' | 'added'): string {
  const parts: string[] = []
  if (outcome.email) parts.push(outcome.email)
  if (outcome.balance != null) parts.push(`${outcome.balance} cr`)
  if (outcome.note) parts.push(outcome.note)
  const what = def.kind === 'cookie' ? 'sesi' : 'token'
  return `${def.label} · ${what} ${action === 'replaced' ? 'diganti' : 'baru'}${parts.length ? ` · ${parts.join(' · ')}` : ''}`
}

let polling = false

// ── Immediate refresh: poll sync queue segera saat token expired ──────────
// Dipanggil dari generate function ketika token ditandai expired — langsung
// cek apakah ada token baru di antrian, tanpa menunggu interval polling.
export async function pollSyncQueueImmediate(providerId: string): Promise<string | null> {
  try {
    const res = await fetch(`/api/sync-tokens/${providerId}?full=1`, { headers: syncAuthHeaders() })
    if (!res.ok) return null
    const data = await res.json()
    const queued = (data.tokens || []) as { token: string }[]
    if (queued.length === 0) return null
    return queued[0].token || null
  } catch {
    return null
  }
}

export async function pollAutoSyncQueues(): Promise<void> {
  if (polling) return
  polling = true
  try {
    for (const def of AUTO_SYNC_PROVIDERS) {
      try {
        const res = await fetch(`/api/sync-tokens/${def.id}?full=1`, { headers: syncAuthHeaders() })
        if (!res.ok) continue
        const data = await res.json()
        const queued = (data.tokens || []) as { token: string; kind?: 'token' | 'cookie' }[]
        if (queued.length === 0) continue

        for (const { token: fresh, kind } of queued) {
          if (!fresh) continue
          // Cookie session (NexaBot) masuk ke field `cookies`, bukan `key`.
          const isCookie = kind === 'cookie' || def.kind === 'cookie'
          const applied = isCookie ? await applyCookieSession(def, fresh) : await replaceOrAddKey(def, fresh)

          if (applied.changed && applied.keyId) {
            const outcome = await runProviderCheck(def, fresh)
            const pm = useProviderManager.getState()

            if (outcome.status) {
              pm.updateKeyStatus(def.id, applied.keyId, outcome.status, outcome.balance ?? undefined, outcome.email)
            }

            // Riwayat pergantian token + notifikasi realtime
            useTokenSyncStore.getState().addEvent({
              provider: def.id,
              label: def.label,
              icon: def.icon,
              action: applied.action,
              ts: Date.now(),
              note: summarize(def, outcome, applied.action),
            })

            const addToast = useToastStore.getState().addToast
            if (outcome.status === 'invalid') {
              addToast(`⚠️ ${summarize(def, outcome, applied.action)} — token tampaknya sudah tidak valid`, 'warning')
            } else if (!outcome.status && outcome.note) {
              addToast(`🔄 ${summarize(def, { email: outcome.email, balance: null, note: 'tersimpan' }, applied.action)} (cek gagal: ${outcome.note})`, 'info')
            } else {
              addToast(`🔄 ${summarize(def, outcome, applied.action)}`, 'success')
            }

            window.dispatchEvent(new Event('aatools:keys-changed'))
            syncCreditsToDb(def)
          }

          // Hapus dari antrian supaya tidak diproses ulang
          consumeQueueToken(def.id, fresh)
        }
      } catch {
        // provider ini error / server mati — lanjut provider berikutnya
      }
    }
  } finally {
    polling = false
  }
}
