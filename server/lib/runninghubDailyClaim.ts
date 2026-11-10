// ─── Klaim hadiah harian RunningHub lewat cron server ──────────────────────
//
// Token RunningHub hanya ada di browser (Providers), sedangkan hadiah harian
// (+30 poin/akun) harus diklaim tiap hari. Pengguna menyalakan "Klaim otomatis"
// sekali; app menyalin token JWT ke tabel server, lalu scheduler di bawah
// mengklaim semuanya tiap hari tanpa perlu app terbuka.
//
// Aturan yang membuat ini aman untuk 35+ akun:
//  - hari klaim memakai UTC+8 (reset RunningHub), bukan tanggal lokal VPS;
//  - satu akun = satu baris; token yang tidak dikirim lagi dihapus saat sync;
//  - klaim berurutan dengan jeda 2 detik (RunningHub menolak burst);
//  - gagal transient diulang tiap 30 menit, maksimal 6 percobaan/hari;
//  - token yang ditolak upstream (412/806/…) tidak diulang — tunggu token baru;
//  - token tidak pernah ikut keluar di API maupun log.
import db from '../db.js'
import { rhClaimDailyGift, rhJwtExp, rhJwtExpired, rhJwtSub } from '../routes/publicRunninghub.js'

/** Reset hadiah RunningHub mengikuti waktu China (UTC+8). */
const CLAIM_DAY_OFFSET_MS = 8 * 60 * 60 * 1000
const TICK_MS = 10 * 60 * 1000
const RETRY_GAP_MS = 30 * 60 * 1000
const MAX_ATTEMPTS_PER_DAY = 6
const CLAIM_DELAY_MS = 2000
export const MAX_AUTO_CLAIM_TOKENS = 100

export type RhAutoClaimStatus = 'pending' | 'claimed' | 'already' | 'rejected' | 'error'

interface ClaimRow {
  id: number
  user_id: number
  token: string
  account: string
  status: RhAutoClaimStatus
  last_message: string
  last_attempt_at: number | null
  last_success_day: string | null
  attempt_day: string | null
  attempts: number
  created_at: number
  updated_at: number
}

export interface RhAutoClaimTokenStatus {
  id: number
  account: string
  status: RhAutoClaimStatus
  message: string
  claimedToday: boolean
  attemptsToday: number
  lastAttemptAt: number | null
  lastSuccessDay: string | null
}

export interface RhAutoClaimRunSummary {
  processed: number
  claimed: number
  already: number
  failed: number
  skipped: number
}

/** Kunci hari klaim: tanggal di UTC+8, format YYYY-MM-DD. */
export function claimDayKey(now = Date.now()): string {
  return new Date(now + CLAIM_DAY_OFFSET_MS).toISOString().slice(0, 10)
}

/**
 * Validasi daftar token dari klien: hanya JWT yang bisa dibaca exp-nya,
 * buang duplikat dan API key 32-hex, batasi jumlahnya.
 */
export function normalizeClaimTokens(raw: unknown): string[] {
  if (!Array.isArray(raw)) return []
  const out: string[] = []
  for (const item of raw) {
    // Toleran terhadap tempelan "Bearer …" — klien sudah mengirim token mentah,
    // tapi nilai lama di localStorage bisa saja terbawa format header.
    const token = String(item ?? '').trim().replace(/^bearer\s+/i, '')
    if (!token.startsWith('eyJ')) continue
    if (rhJwtExp(token) === null) continue
    if (out.includes(token)) continue
    out.push(token)
    if (out.length >= MAX_AUTO_CLAIM_TOKENS) break
  }
  return out
}

/** Tampilan akun non-rahasia: ID RunningHub (sub) yang dipotong. */
function maskAccount(account: string, id: number): string {
  if (account.length > 6) return `${account.slice(0, 3)}…${account.slice(-4)}`
  return account ? `…${account}` : `token #${id}`
}

const runningUsers = new Set<number>()
let schedulerStarted = false

export function isAutoClaimRunning(userId: number): boolean {
  return runningUsers.has(userId)
}

/**
 * Ganti seluruh daftar token milik satu pengguna. Baris yang tokennya tidak
 * dikirim lagi dihapus — credential lama tidak disimpan tanpa batas waktu.
 * Status baris yang masih sama dipertahankan supaya riwayat klaim tidak hilang.
 */
export function replaceAutoClaimTokens(userId: number, tokens: string[]): void {
  const now = Date.now()
  const tx = db.transaction(() => {
    const existing = db
      .prepare('SELECT id, token FROM runninghub_claim_token WHERE user_id = ?')
      .all(userId) as { id: number; token: string }[]
    const keep = new Set(tokens)
    const drop = db.prepare('DELETE FROM runninghub_claim_token WHERE id = ?')
    for (const row of existing) {
      if (!keep.has(row.token)) drop.run(row.id)
    }
    const present = new Set(existing.map((r) => r.token))
    const insert = db.prepare(
      `INSERT OR IGNORE INTO runninghub_claim_token
       (user_id, token, account, status, created_at, updated_at)
       VALUES (?, ?, ?, 'pending', ?, ?)`,
    )
    for (const token of tokens) {
      if (present.has(token)) continue
      insert.run(userId, token, rhJwtSub(token) || '', now, now)
    }
  })
  tx()
}

export function clearAutoClaimTokens(userId: number): void {
  db.prepare('DELETE FROM runninghub_claim_token WHERE user_id = ?').run(userId)
}

/** Status untuk UI: token tidak ikut dikembalikan, hanya ID akun + hasil. */
export function getAutoClaimStatus(userId: number) {
  const day = claimDayKey()
  const rows = db
    .prepare('SELECT * FROM runninghub_claim_token WHERE user_id = ? ORDER BY id')
    .all(userId) as ClaimRow[]

  const tokens: RhAutoClaimTokenStatus[] = rows.map((row) => ({
    id: row.id,
    account: maskAccount(row.account, row.id),
    status: row.status,
    message: row.last_message,
    claimedToday: row.last_success_day === day,
    attemptsToday: row.attempt_day === day ? row.attempts : 0,
    lastAttemptAt: row.last_attempt_at,
    lastSuccessDay: row.last_success_day,
  }))

  return {
    enabled: rows.length > 0,
    day,
    timezone: 'UTC+8',
    running: isAutoClaimRunning(userId),
    tokens,
    summary: {
      total: tokens.length,
      claimedToday: tokens.filter((t) => t.claimedToday).length,
      rejected: tokens.filter((t) => t.status === 'rejected').length,
      failedToday: tokens.filter((t) => t.status === 'error' && !t.claimedToday).length,
      lastAttemptAt: rows.reduce<number | null>(
        (max, r) => (r.last_attempt_at && (!max || r.last_attempt_at > max) ? r.last_attempt_at : max),
        null,
      ),
    },
  }
}

/** Semua user yang punya token terdaftar — sasaran scheduler harian. */
export function autoClaimUserIds(): number[] {
  const rows = db
    .prepare('SELECT DISTINCT user_id FROM runninghub_claim_token')
    .all() as { user_id: number }[]
  return rows.map((r) => r.user_id)
}

function updateClaimRow(row: ClaimRow, patch: {
  status: RhAutoClaimStatus
  message: string
  day: string
  attempts: number
  success: boolean
}): void {
  const now = Date.now()
  db.prepare(
    `UPDATE runninghub_claim_token
     SET status = ?, last_message = ?, last_attempt_at = ?,
         last_success_day = ?, attempt_day = ?, attempts = ?, updated_at = ?
     WHERE id = ?`,
  ).run(
    patch.status,
    patch.message.slice(0, 300),
    now,
    patch.success ? patch.day : row.last_success_day,
    patch.day,
    patch.attempts,
    now,
    row.id,
  )
}

/**
 * Klaim semua token milik satu pengguna yang masih "due" hari ini.
 * `force` = tombol "Klaim sekarang": abaikan jeda retry/limit percobaan,
 * tapi tetap tidak mengulang akun yang sudah sukses atau token yang ditolak.
 */
export async function runAutoClaimForUser(
  userId: number,
  opts: { force?: boolean } = {},
): Promise<RhAutoClaimRunSummary | null> {
  if (runningUsers.has(userId)) return null
  runningUsers.add(userId)
  try {
    const day = claimDayKey()
    const rows = db
      .prepare('SELECT * FROM runninghub_claim_token WHERE user_id = ? ORDER BY id')
      .all(userId) as ClaimRow[]

    const summary: RhAutoClaimRunSummary = { processed: 0, claimed: 0, already: 0, failed: 0, skipped: 0 }

    for (let i = 0; i < rows.length; i++) {
      const row = rows[i]
      if (row.last_success_day === day || row.status === 'rejected') {
        summary.skipped += 1
        continue
      }
      const attemptsToday = row.attempt_day === day ? row.attempts : 0
      if (!opts.force) {
        if (attemptsToday >= MAX_ATTEMPTS_PER_DAY) {
          summary.skipped += 1
          continue
        }
        if (row.last_attempt_at && Date.now() - row.last_attempt_at < RETRY_GAP_MS) {
          summary.skipped += 1
          continue
        }
      }

      summary.processed += 1
      const attempts = attemptsToday + 1

      if (rhJwtExpired(row.token)) {
        updateClaimRow(row, {
          status: 'rejected',
          message: 'Access token kedaluwarsa — perbarui JWT di Providers lalu sinkronkan ulang.',
          day,
          attempts,
          success: false,
        })
        summary.failed += 1
      } else {
        const result = await rhClaimDailyGift(row.token, { wallet: false })
        if (result.outcome === 'claimed' || result.outcome === 'already') {
          updateClaimRow(row, {
            status: result.outcome,
            message: result.message,
            day,
            attempts,
            success: true,
          })
          if (result.outcome === 'claimed') summary.claimed += 1
          else summary.already += 1
        } else {
          updateClaimRow(row, {
            status: result.outcome === 'rejected' ? 'rejected' : 'error',
            message: result.message,
            day,
            attempts,
            success: false,
          })
          summary.failed += 1
        }
      }

      if (i < rows.length - 1) await new Promise((resolve) => setTimeout(resolve, CLAIM_DELAY_MS))
    }

    if (summary.processed > 0) {
      console.log(
        `[rh-claim] user ${userId}: ${summary.claimed} klaim, ${summary.already} sudah, ` +
        `${summary.failed} gagal, ${summary.skipped} dilewati`,
      )
    }
    return summary
  } finally {
    runningUsers.delete(userId)
  }
}

/** Gerbang env: default aktif di production, bisa dipaksa di dev. */
export function autoClaimSchedulerEnabled(): boolean {
  const raw = (process.env.RUNNINGHUB_DAILY_CLAIM ?? '').trim().toLowerCase()
  if (raw) return !['0', 'false', 'off', 'no'].includes(raw)
  return process.env.NODE_ENV === 'production'
}

async function tick(): Promise<void> {
  for (const userId of autoClaimUserIds()) {
    try {
      await runAutoClaimForUser(userId)
    } catch (err) {
      console.error('[rh-claim] tick gagal:', (err as any)?.message || err)
    }
  }
}

/**
 * Scheduler in-process: cek tiap 10 menit, klaim hanya kalau hari klaim sudah
 * berganti. Restart tidak membuat klaim hilang — status hari ini tersimpan di DB.
 */
export function startRunningHubDailyClaimScheduler(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  if (!autoClaimSchedulerEnabled()) {
    console.log(
      '[rh-claim] scheduler dimatikan (aktif otomatis di production; set RUNNINGHUB_DAILY_CLAIM=1 untuk memaksa).',
    )
    return
  }
  // Jeda awal supaya boot server tidak langsung dihujani request upstream.
  setTimeout(() => { void tick() }, 20_000).unref()
  setInterval(() => { void tick() }, TICK_MS).unref()
  console.log('[rh-claim] scheduler aktif — cek tiap 10 menit, hari klaim mengikuti UTC+8.')
}
