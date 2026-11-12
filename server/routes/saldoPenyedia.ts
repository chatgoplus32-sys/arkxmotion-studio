import { Router, Response } from 'express'
import { authenticateToken, requireAdmin, AuthRequest } from '../middleware/auth.js'
import { masterKey, providerLabel } from '../lib/providerMasterKey.js'
import { checkMasterKey as cekKunciNexabot } from '../lib/nexabotMasterKey.js'
import { checkMasterCookie as cekSesiNexabot } from '../lib/nexabotMasterCookie.js'

/**
 * Saldo ASLI di sisi penyedia, khusus untuk akun admin.
 *
 * Dompet member (`*_balance`) sengaja tidak dipakai di sini: angka di tabel itu
 * adalah saldo yang dibayar member ke kita, bukan sisa kredit di akun penyedia.
 * Admin tidak menagih dirinya sendiri, jadi satu-satunya angka yang berarti
 * untuknya adalah yang dijawab penyedia.
 *
 * Sumber per layanan
 * ------------------
 *  • Seavi  — GET {SEAVI_BASE}/balance dengan kunci induk server.
 *  • NexaBot— GET /api/v1/credits lewat sesi web tersimpan; bila sesi tidak ada
 *             atau ditolak, jatuh ke kunci API induk (/api/v1/api/credit).
 *  • PosBot — GET /balance dengan kunci induk PosBot bila sudah diatur admin
 *             (Sistem → Kunci Server PosBot). Selama kunci belum ada, dipakai
 *             angka dari dashboard operator (env POSBOT_REPORTED_BALANCE,
 *             default 4.650) dan ditandai `source: 'manual'`.
 *  • CreatePulse — integrasi kita tidak punya endpoint saldo upstream.
 *
 * Rute ini hanya mengembalikan ANGKA + status. Kunci, cookie, dan nilai
 * kredensial apa pun tidak pernah ikut dikirim ke browser.
 */

const router = Router()

const SEAVI_BASE = (process.env.SEAVI_BASE || 'https://api.seavilabs.site/v1').replace(/\/+$/, '')
const POSBOT_BASE = (process.env.POSBOT_BASE || 'https://api.posbot.web.id/api/v1').replace(/\/+$/, '')

/** Angka dari dashboard PosBot milik operator — bukan hasil hitungan sistem. */
const POSBOT_REPORTED = (() => {
  const nilai = Number(process.env.POSBOT_REPORTED_BALANCE ?? 4650)
  return Number.isFinite(nilai) ? nilai : null
})()

export interface SaldoSeavi {
  tokens: number | null
  used: number | null
  status: number | null
  error: string | null
}

export interface SaldoPosbot {
  rupiah: number | null
  /** 'upstream' = dijawab /balance PosBot; 'manual' = angka dashboard operator. */
  source: 'upstream' | 'manual'
  status: number | null
  error: string | null
}

export interface SaldoNexabot {
  credits: number | null
  plan: string | null
  unlimited: boolean
  status: number | null
  error: string | null
}

/** Ambil angka dari respons upstream yang bentuknya bisa berubah-ubah. */
function angkaDari(raw: any, keys: string[]): number | null {
  for (const sumber of [raw, raw?.data]) {
    if (!sumber || typeof sumber !== 'object') continue
    for (const k of keys) {
      const v = sumber[k]
      if (typeof v === 'number' && Number.isFinite(v)) return v
      if (typeof v === 'string' && /^-?\d+(\.\d+)?$/.test(v.trim())) return Number(v)
    }
  }
  return null
}

async function saldoSeavi(): Promise<SaldoSeavi> {
  const kunci = masterKey('seavi')
  if (!kunci) {
    return { tokens: null, used: null, status: null, error: `Kunci ${providerLabel('seavi')} milik server belum diatur` }
  }
  try {
    const res = await fetch(`${SEAVI_BASE}/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${kunci}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401 || res.status === 403) {
      return { tokens: null, used: null, status: res.status, error: 'API key Seavi Labs ditolak penyedia' }
    }
    const raw = (await res.json().catch(() => null)) as any
    if (!res.ok) {
      return { tokens: null, used: null, status: res.status, error: `Cek saldo Seavi gagal: HTTP ${res.status}` }
    }
    if (raw && (raw.ok === false || raw.success === false)) {
      return { tokens: null, used: null, status: res.status, error: String(raw.error?.message || raw.error || 'Saldo Seavi ditolak penyedia') }
    }
    return {
      tokens: angkaDari(raw, ['token_remaining', 'tokens', 'balance', 'sisa_token']),
      used: angkaDari(raw, ['token_used', 'used']),
      status: res.status,
      error: null,
    }
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      tokens: null,
      used: null,
      status: null,
      error: timeout ? 'Cek saldo Seavi timeout — penyedia tidak menjawab' : `Cek saldo Seavi gagal: ${err?.message || err}`,
    }
  }
}

async function saldoPosbot(): Promise<SaldoPosbot> {
  const kunci = masterKey('posbot')
  if (!kunci) {
    return {
      rupiah: POSBOT_REPORTED,
      source: 'manual',
      status: null,
      error: POSBOT_REPORTED === null ? 'Angka PosBot belum diatur (POSBOT_REPORTED_BALANCE)' : null,
    }
  }
  try {
    const res = await fetch(`${POSBOT_BASE}/balance`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${kunci}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(15000),
    })
    if (res.status === 401 || res.status === 403) {
      return { rupiah: null, source: 'upstream', status: res.status, error: 'API key PosBot ditolak penyedia' }
    }
    const raw = (await res.json().catch(() => null)) as any
    if (!res.ok) {
      return { rupiah: null, source: 'upstream', status: res.status, error: `Cek saldo PosBot gagal: HTTP ${res.status}` }
    }
    if (raw && (raw.ok === false || raw.success === false)) {
      return { rupiah: null, source: 'upstream', status: res.status, error: String(raw.error?.message || raw.error || 'Saldo PosBot ditolak penyedia') }
    }
    const rupiah = angkaDari(raw, ['saldo_generate', 'saldo', 'balance', 'sisa_saldo', 'saldo_remaining'])
    return {
      rupiah,
      source: 'upstream',
      status: res.status,
      error: rupiah === null ? 'Saldo PosBot dijawab penyedia tetapi angkanya tidak dikenali' : null,
    }
  } catch (err: any) {
    const timeout = err?.name === 'TimeoutError' || err?.name === 'AbortError'
    return {
      rupiah: null,
      source: 'upstream',
      status: null,
      error: timeout ? 'Cek saldo PosBot timeout — penyedia tidak menjawab' : `Cek saldo PosBot gagal: ${err?.message || err}`,
    }
  }
}

async function saldoNexabot(): Promise<SaldoNexabot> {
  // Sesi web diutamakan karena hanya jalur itu yang menghormati paket Unlimited;
  // kunci API jadi cadangan bila sesi belum diatur atau kedaluwarsa.
  const sesi = await cekSesiNexabot()
  if (sesi.ok) {
    return {
      credits: sesi.balance,
      plan: sesi.plan,
      unlimited: sesi.unlimited,
      status: sesi.status,
      error: sesi.balance === null ? 'Sesi NexaBot aktif, tetapi angka kredit tidak dikenali' : null,
    }
  }
  const kunci = await cekKunciNexabot()
  if (kunci.ok) {
    return { credits: kunci.credit, plan: null, unlimited: false, status: kunci.status, error: kunci.credit === null ? 'Kunci NexaBot aktif, tetapi angka kredit tidak dikenali' : null }
  }
  return { credits: null, plan: null, unlimited: false, status: kunci.status ?? sesi.status, error: kunci.error || sesi.error || 'Kredensial NexaBot server tidak tersedia' }
}

router.get('/', authenticateToken, requireAdmin, async (_req: AuthRequest, res: Response) => {
  try {
    const [seavi, nexabot, posbot] = await Promise.all([saldoSeavi(), saldoNexabot(), saldoPosbot()])
    // Angka saldo berubah setiap generate: jangan sampai di-cache browser/proxy.
    res.set('Cache-Control', 'no-store')
    res.json({
      ok: true,
      checked_at: new Date().toISOString(),
      seavi,
      nexabot,
      posbot,
      createpulse: { error: 'CreatePulse tidak menyediakan cek saldo upstream' },
    })
  } catch (error) {
    console.error('Get provider balance error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
