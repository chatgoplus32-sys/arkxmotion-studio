import type { Request } from 'express'
import { userIdFromToken } from './appToken.js'
import { isAdminUser, keyEligibility, masterKey, providerLabel, type ServerKeyProvider } from './providerMasterKey.js'
import { claimChargeTicket, noteChargeTicketJob, releaseChargeTicket } from './providerChargeTicket.js'

/**
 * Kebijakan kredensial relay Alriz / Seavi.
 *
 * Relay menerima dua bentuk kredensial:
 *   1. `Authorization: Bearer <kunci provider>` — kunci milik member (perilaku
 *      lama). Relay meneruskannya apa adanya; tidak ada uang operator yang
 *      dipakai, jadi tidak perlu tiket.
 *   2. `X-App-Token: <JWT app>` (+ `X-Provider-Charge: <usage_id>` untuk submit)
 *      — relay menyuntikkan kunci milik operator. Member harus login, punya
 *      saldo/token (atau admin), dan untuk request yang membuat job harus
 *      membawa tiket pembayaran dari /deduct.
 *
 * Nama header `X-App-Token` dipakai karena `Authorization` sudah berarti kunci
 * provider di kontrak relay ini.
 */

/** Path upstream yang MEMBUAT job (memakai kredit upstream). */
const CONSUMING_PATH: Record<ServerKeyProvider, RegExp> = {
  alriz: /^jobs\/?$/,
  seavi: /^generate\/?$/,
}

export function isConsumingRequest(provider: ServerKeyProvider, method: string, subpath: string): boolean {
  return method.toUpperCase() === 'POST' && CONSUMING_PATH[provider].test(subpath.replace(/^\/+/, ''))
}

export type CredentialDecision =
  | { kind: 'client' }
  | { kind: 'server'; secret: string; usageId: number | null }
  | { kind: 'reject'; status: number; error: string }

function appUserId(req: Request): number | null {
  const header = req.headers['x-app-token']
  return userIdFromToken(Array.isArray(header) ? header[0] : header)
}

/** Jelaskan kedua jalur yang tersedia, supaya pesan penolakan bisa ditindak. */
function butuhIdentitas(provider: ServerKeyProvider): string {
  const label = providerLabel(provider)
  return (
    `Kunci ${label} milik server hanya untuk member yang login. ` +
    `Tanpa akun app, tempel API key ${label} Anda sendiri lewat header Authorization.`
  )
}

/**
 * Putuskan kredensial mana yang dipakai untuk request ini.
 *
 * Rute BACA (`?path=jobs/{id}`, status polling, dsb.) cukup membutuhkan
 * identitas, bukan kelayakan saldo: job yang sudah berjalan harus tetap bisa
 * dipoll walau saldo member habis di tengah jalan. Yang wajib membawa tiket
 * hanya request yang membuat job.
 */
export function decideCredential(
  provider: ServerKeyProvider,
  req: Request,
  hasClientKey: boolean,
  consuming: boolean,
): CredentialDecision {
  if (hasClientKey) return { kind: 'client' }

  const userId = appUserId(req)
  if (!userId) return { kind: 'reject', status: 401, error: butuhIdentitas(provider) }

  const secret = masterKey(provider)
  if (!secret) {
    return {
      kind: 'reject',
      status: 400,
      error:
        `Kunci ${providerLabel(provider)} milik server belum diatur admin. ` +
        `Tempel API key ${providerLabel(provider)} Anda sendiri di halaman Providers, atau hubungi admin.`,
    }
  }

  if (!consuming) return { kind: 'server', secret, usageId: null }

  const izin = keyEligibility(provider, userId)
  if (!izin.ok) return { kind: 'reject', status: 402, error: izin.reason }

  // Admin tidak dipotong klien, jadi tidak akan pernah membawa tiket.
  if (isAdminUser(userId)) return { kind: 'server', secret, usageId: null }

  const header = req.headers['x-provider-charge']
  const mentah = Array.isArray(header) ? header[0] : header
  const cek = claimChargeTicket(provider, userId, mentah)
  if (!cek.ok) {
    return { kind: 'reject', status: 402, error: cek.reason || 'Pembayaran generate ini belum terverifikasi.' }
  }
  return { kind: 'server', secret, usageId: cek.usageId ?? null }
}

/** Id job dari respons upstream Alriz (`job_id`) maupun Seavi (`id`). */
function jobIdDari(bodyText: string): string | null {
  try {
    const data = JSON.parse(bodyText)
    const id = data?.job_id ?? data?.id ?? data?.request_id ?? data?.task_id
    return id == null ? null : String(id).slice(0, 200)
  } catch {
    return null
  }
}

/**
 * Status yang PASTI ditolak sebelum job dibuat → jatah tiket dikembalikan.
 * 5xx/timeout sengaja TIDAK di sini: job bisa saja sudah terbentuk.
 */
function menolakSebelumJob(status: number, bodyText: string): boolean {
  if ([400, 401, 402, 403, 404, 409, 422, 429].includes(status)) return true
  return status === 503 && /coba lagi dalam|try again/i.test(bodyText)
}

/** Setelah respons upstream: catat job kalau dibuat, lepas klaim kalau ditolak. */
export function settleTicket(
  provider: ServerKeyProvider,
  usageId: number | null | undefined,
  status: number,
  bodyText: string,
): void {
  if (!usageId) return
  if (status >= 200 && status < 300 && jobIdDari(bodyText)) {
    noteChargeTicketJob(provider, usageId, jobIdDari(bodyText))
  } else if (menolakSebelumJob(status, bodyText)) {
    releaseChargeTicket(provider, usageId)
  }
}
