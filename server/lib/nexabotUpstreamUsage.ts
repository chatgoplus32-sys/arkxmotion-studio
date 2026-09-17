import crypto from 'crypto'
import jwt from 'jsonwebtoken'
import type { Request } from 'express'
import db from '../db.js'

/**
 * Mencatat pemakaian upstream NexaBot untuk setiap request yang MENGONSUMSI
 * kuota (generate/submit) — bukan rute baca.
 *
 * Kenapa ini ada
 * -------------
 * Paket Unlimited dijual mingguan/bulanan, dan di sisi app biaya lokal untuk
 * member yang paketnya aktif memang 0. Tapi job itu tetap berjalan di upstream
 * dengan kredensial yang tersedia — cookie sesi (jalur Unlimited) atau API key
 * (pay-as-you-go). Kalau API key, yang membayar adalah pemilik key, bukan member
 * yang sudah membayar flat. Selama tidak ada catatan, subsidinya tidak terlihat
 * sama sekali: `nexabot_usage.cost` menyimpan HARGA LOKAL (0 saat unlimited),
 * bukan biaya upstream.
 *
 * Prinsip yang dipegang
 * ---------------------
 * - Rahasia kredensial tidak pernah disimpan; hanya sidik jarinya, supaya bisa
 *   membedakan "kredensial milik member ini" dari "kredensial induk" tanpa
 *   memegang nilainya.
 * - Biaya dicatat HANYA kalau upstream melaporkannya. Kalau tidak ada field
 *   angka yang bisa dipercaya, `cost_value` dibiarkan NULL dan yang tersisa
 *   adalah jumlah job — bukan angka karangan.
 * - Pencatatan tidak boleh menjatuhkan relay: semua kegagalan di sini ditelan
 *   dan dicatat ke console.
 */

/** Rute yang mengonsumsi kuota upstream. Poll job/health/credit sengaja tidak. */
export type ConsumingRoute = 'generate' | 'submit'

const EVIDENCE_MAX = 300

/** Nama field yang menandakan biaya/kredit di respons upstream. */
const COST_FIELD_PATTERN = /(credit|kredit|cost|price|charge|usage|saldo|point|quota)/i

/** Sidik jari kredensial: cukup untuk membedakan, tidak untuk memakainya. */
export function credentialFingerprint(kind: string, secret: string): string {
  return crypto.createHash('sha256').update(`${kind}\u0000${secret}`).digest('hex').slice(0, 12)
}

/** Jenis kredensial yang dipakai sebuah request relay, dari header-nya. */
export function credentialKindOf(req: Request): { kind: 'cookie' | 'api-key'; secret: string } | null {
  const cookie = req.headers['x-nexabot-cookie']
  if (typeof cookie === 'string' && cookie.trim()) return { kind: 'cookie', secret: cookie.trim() }
  const apiKey = req.headers['x-api-key']
  if (typeof apiKey === 'string' && apiKey.trim()) return { kind: 'api-key', secret: apiKey.trim() }
  return null
}

/**
 * Identitas pemanggil, kalau ia memang mengirim JWT app. Relay ini terbuka
 * (klien bisa memakai kredensial nexabot-nya sendiri tanpa akun app), jadi
 * ketiadaan identitas adalah keadaan sah — bukan alasan menolak request.
 */
export function userIdFromRequest(req: Request): number | null {
  const header = req.headers['authorization']
  if (typeof header !== 'string') return null
  const token = header.split(' ')[1]
  if (!token) return null
  try {
    const secret = process.env.JWT_SECRET
    if (!secret) return null
    const decoded = jwt.verify(token, secret) as { id?: number }
    return typeof decoded?.id === 'number' ? decoded.id : null
  } catch {
    return null
  }
}

/**
 * Cari angka biaya di respons upstream tanpa mengandaikan skema mereka.
 * Kita belum tahu nama field yang nexabot pakai untuk kredit; yang pertama kali
 * cocok dicatat beserta bukti potongan responsnya, supaya bentuk aslinya bisa
 * dilihat setelah pemakaian nyata — bukan ditebak sekarang.
 */
export function extractCost(bodyText: string): { field: string; value: number; evidence: string } | null {
  let parsed: unknown
  try {
    parsed = JSON.parse(bodyText)
  } catch {
    return null
  }

  const temukan = (obj: unknown, jejak: string, kedalaman: number): { field: string; value: number } | null => {
    if (kedalaman > 3 || !obj || typeof obj !== 'object') return null
    for (const [key, value] of Object.entries(obj as Record<string, unknown>)) {
      if (typeof value === 'number' && Number.isFinite(value) && COST_FIELD_PATTERN.test(key)) {
        return { field: jejak ? `${jejak}.${key}` : key, value }
      }
      if (value && typeof value === 'object') {
        const dalam = temukan(value, jejak ? `${jejak}.${key}` : key, kedalaman + 1)
        if (dalam) return dalam
      }
    }
    return null
  }

  const hit = temukan(parsed, '', 0)
  if (!hit) return null
  return { ...hit, evidence: bodyText.slice(0, EVIDENCE_MAX) }
}

export interface UpstreamUsageInput {
  req: Request
  route: ConsumingRoute
  statusCode: number
  bodyText: string
}

/**
 * Catat satu pemakaian upstream. Aman dipanggil kapan saja: kegagalan di sini
 * tidak pernah dilempar ke pemanggil.
 */
export function recordUpstreamUsage({ req, route, statusCode, bodyText }: UpstreamUsageInput): void {
  try {
    const kredensial = credentialKindOf(req)
    if (!kredensial) return // tanpa kredensial tidak ada kuota upstream yang terpakai

    const biaya = extractCost(bodyText)

    db.prepare(
      `INSERT INTO nexabot_upstream_usage
         (user_id, route, credential_kind, credential_fingerprint, status_code, cost_field, cost_value, evidence, created_at)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      userIdFromRequest(req),
      route,
      kredensial.kind,
      credentialFingerprint(kredensial.kind, kredensial.secret),
      statusCode,
      biaya?.field ?? null,
      biaya?.value ?? null,
      biaya?.evidence ?? null,
      Date.now(),
    )
  } catch (error) {
    console.error('[nexabot-upstream] gagal mencatat pemakaian:', error)
  }
}
