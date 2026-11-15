// ─── Pool token master RunningHub (milik operator) ─────────────────────────
// Admin menempel banyak access token (JWT) / API key lewat dashboard; relay
// merotasinya per submit supaya member yang top up bisa generate tanpa punya
// token sendiri. Aturan main:
//  - token TIDAK PERNAH keluar dari modul ini menuju browser (hanya status);
//  - saldo habis (414/605) → cooldown, bukan rejected: poin bisa terisi lagi
//    lewat klaim harian / top up operator;
//  - token ditolak (412/806/…) → rejected permanen sampai admin mengganti;
//  - env RUNNINGHUB_ACCESS_TOKEN adalah entri implisit id 0 (tidak bisa dihapus);
//  - task terikat akun pembuatnya → afinitas task→token disimpan di DB supaya
//    poll tetap memakai token yang benar walau server restart.
import db from '../db.js'
import { rhJwtExp, rhJwtExpired, rhJwtSub } from './rhJwt.js'

// Batas jumlah token pool. Default 1000, bisa diubah lewat env tanpa rebuild
// (penting kalau operator menambah akun lebih banyak dari biasanya).
export const RH_POOL_MAX = (() => {
  const raw = Number.parseInt(process.env.RUNNINGHUB_POOL_MAX ?? '', 10)
  if (Number.isFinite(raw) && raw > 0) return Math.min(raw, 5000)
  return 1000
})()

/** Saldo poin habis: tunggu klaim harian / top up operator, jangan dibuang. */
const COOLDOWN_SALDO_MS = 60 * 60 * 1000
/** Batas concurrent / rate limit upstream: sebentar saja. */
const COOLDOWN_RATE_MS = 2 * 60 * 1000

export type RhPoolFailureKind = 'saldo' | 'invalid' | 'rate'

export interface RhPoolRow {
  id: number
  label: string
  kind: 'jwt' | 'key'
  account: string
  status: 'active' | 'cooldown' | 'rejected'
  cooldown_until: number
  last_error: string
  last_used_at: number | null
  points_balance: number | null
  points_checked_at: number | null
  last_claim_day: string
  created_at: number
  updated_at: number
}

/** Kandidat untuk relay — membawa nilai token, HANYA dipakai di server. */
export interface RhPoolCandidate {
  id: number
  token: string
  kind: 'jwt' | 'key'
  label: string
  /** Saldo poin/power upstream terakhir yang diketahui (null = belum pernah dicek). */
  points?: number | null
}

function normalizeToken(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^[•*`'"\s-]+|[•*`'"\s-]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

function classify(token: string): 'jwt' | 'key' | null {
  if (!token || /\s/.test(token)) return null
  if (/^MF-[A-Z0-9]/i.test(token)) return null // kunci MarkasTools, bukan RunningHub
  if (rhJwtExp(token) !== null) return 'jwt'
  return 'key'
}

function envToken(): string {
  return normalizeToken(process.env.RUNNINGHUB_ACCESS_TOKEN)
}

// Kesehatan token env tidak punya baris DB — disimpan di proses.
const envHealth = { cooldownUntil: 0, rejected: false, lastError: '' }

/** Daftar untuk admin: tanpa nilai token, akun disamarkan. */
export function rhPoolList(): Array<Omit<RhPoolRow, 'account'> & { account: string }> {
  const rows = db
    .prepare('SELECT * FROM runninghub_master_token ORDER BY id')
    .all() as Array<RhPoolRow & { token: string }>
  return rows.map((r) => ({
    id: r.id,
    label: r.label,
    kind: r.kind,
    account: r.account.length > 6 ? `${r.account.slice(0, 3)}…${r.account.slice(-4)}` : r.account,
    status: r.status,
    cooldown_until: r.cooldown_until,
    last_error: r.last_error,
    last_used_at: r.last_used_at,
    points_balance: r.points_balance,
    points_checked_at: r.points_checked_at,
    last_claim_day: r.last_claim_day,
    created_at: r.created_at,
    updated_at: r.updated_at,
  }))
}

export function rhPoolSummary() {
  const rows = rhPoolList()
  const now = Date.now()
  const usable = rows.filter((r) => r.status !== 'rejected' && r.cooldown_until <= now).length
  return {
    total: rows.length + (envToken() ? 1 : 0),
    usable: usable + (envToken() && !envHealth.rejected && envHealth.cooldownUntil <= now ? 1 : 0),
    active: rows.filter((r) => r.status === 'active').length,
    cooldown: rows.filter((r) => r.status === 'cooldown' && r.cooldown_until > now).length,
    rejected: rows.filter((r) => r.status === 'rejected').length,
    envConfigured: !!envToken(),
    max: RH_POOL_MAX,
  }
}

/**
 * Tambah banyak token sekaligus (satu per baris / dipisah koma). Duplikat
 * dilewati, nilai bukan kredensial RunningHub ditolak. Mengembalikan jumlah
 * added/skipped/invalid tanpa pernah memantulkan nilai token.
 */
export function rhPoolAddBulk(raw: unknown, label = ''): { added: number; skipped: number; invalid: number } {
  const items = Array.isArray(raw)
    ? raw
    : String(raw ?? '').split(/[\n,;]+/)
  const bersihLabel = String(label || '').trim().slice(0, 80)
  const existing = new Set(
    (db.prepare('SELECT token FROM runninghub_master_token').all() as { token: string }[]).map((r) => r.token),
  )
  const env = envToken()
  if (env) existing.add(env)

  let added = 0
  let skipped = 0
  let invalid = 0
  const now = Date.now()
  const insert = db.prepare(
    `INSERT INTO runninghub_master_token
     (label, token, kind, account, status, created_at, updated_at)
     VALUES (?, ?, ?, ?, 'active', ?, ?)`,
  )
  const tx = db.transaction(() => {
    for (const item of items) {
      const token = normalizeToken(item)
      if (!token) continue
      const kind = classify(token)
      if (!kind) { invalid += 1; continue }
      if (rhJwtExpired(token)) { invalid += 1; continue }
      if (existing.has(token)) { skipped += 1; continue }
      const total = (db.prepare('SELECT COUNT(*) AS n FROM runninghub_master_token').get() as { n: number }).n
      if (total >= RH_POOL_MAX) break
      insert.run(bersihLabel, token, kind, kind === 'jwt' ? (rhJwtSub(token) || '') : '', now, now)
      existing.add(token)
      added += 1
    }
  })
  tx()
  return { added, skipped, invalid }
}

export function rhPoolDelete(id: number): boolean {
  const tx = db.transaction(() => {
    const res = db.prepare('DELETE FROM runninghub_master_token WHERE id = ?').run(id)
    db.prepare('DELETE FROM runninghub_task_token WHERE token_id = ?').run(id)
    return res.changes > 0
  })
  return tx()
}

export function rhPoolSetLabel(id: number, label: string): boolean {
  const res = db.prepare('UPDATE runninghub_master_token SET label = ?, updated_at = ? WHERE id = ?')
    .run(String(label || '').trim().slice(0, 80), Date.now(), id)
  return res.changes > 0
}

let cursor = 0

/**
 * Kandidat token yang layak dicoba SEKARANG, urut round-robin mulai setelah
 * token yang terakhir dipakai. Token env ikut sebagai id 0. JWT kedaluwarsa
 * dan token rejected tidak ikut; cooldown yang sudah lewat ikut lagi.
 */
export function rhPoolCandidates(): RhPoolCandidate[] {
  const now = Date.now()
  const out: RhPoolCandidate[] = []

  const env = envToken()
  if (env && !envHealth.rejected && envHealth.cooldownUntil <= now && !rhJwtExpired(env)) {
    out.push({ id: 0, token: env, kind: rhJwtExp(env) !== null ? 'jwt' : 'key', label: 'Token env', points: null })
  }

  const rows = db
    .prepare("SELECT * FROM runninghub_master_token WHERE status != 'rejected' AND cooldown_until <= ? ORDER BY id")
    .all(now) as Array<RhPoolRow & { token: string }>
  for (const r of rows) {
    if (r.kind === 'jwt' && rhJwtExpired(r.token)) continue
    out.push({ id: r.id, token: r.token, kind: r.kind, label: r.label || `Token #${r.id}`, points: r.points_balance })
  }

  if (out.length === 0) return out
  const mulai = cursor % out.length
  cursor = (cursor + 1) % Math.max(1, out.length)
  return [...out.slice(mulai), ...out.slice(0, mulai)]
}

/** Ambil satu kandidat berdasarkan id (afinitas task). Null kalau tak layak. */
export function rhPoolTokenById(id: number): RhPoolCandidate | null {
  if (id === 0) {
    const env = envToken()
    if (!env || envHealth.rejected || rhJwtExpired(env)) return null
    return { id: 0, token: env, kind: rhJwtExp(env) !== null ? 'jwt' : 'key', label: 'Token env' }
  }
  const r = db.prepare('SELECT * FROM runninghub_master_token WHERE id = ?').get(id) as (RhPoolRow & { token: string }) | undefined
  if (!r || r.status === 'rejected') return null
  if (r.kind === 'jwt' && rhJwtExpired(r.token)) return null
  return { id: r.id, token: r.token, kind: r.kind, label: r.label || `Token #${r.id}`, points: r.points_balance }
}

export function rhPoolMarkSuccess(id: number): void {
  const now = Date.now()
  if (id === 0) {
    envHealth.cooldownUntil = 0
    envHealth.rejected = false
    envHealth.lastError = ''
    return
  }
  db.prepare(
    "UPDATE runninghub_master_token SET status = 'active', cooldown_until = 0, last_error = '', last_used_at = ?, updated_at = ? WHERE id = ?",
  ).run(now, now, id)
}

export function rhPoolMarkFailure(id: number, kind: RhPoolFailureKind, message: string): void {
  const now = Date.now()
  const pesan = String(message || '').slice(0, 300)
  if (id === 0) {
    if (kind === 'invalid') envHealth.rejected = true
    else envHealth.cooldownUntil = now + (kind === 'saldo' ? COOLDOWN_SALDO_MS : COOLDOWN_RATE_MS)
    envHealth.lastError = pesan
    return
  }
  if (kind === 'invalid') {
    db.prepare(
      "UPDATE runninghub_master_token SET status = 'rejected', last_error = ?, updated_at = ? WHERE id = ?",
    ).run(pesan, now, id)
    return
  }
  const until = now + (kind === 'saldo' ? COOLDOWN_SALDO_MS : COOLDOWN_RATE_MS)
  db.prepare(
    "UPDATE runninghub_master_token SET status = 'cooldown', cooldown_until = ?, last_error = ?, updated_at = ? WHERE id = ?",
  ).run(until, pesan, now, id)
}

/** Snapshot poin dari refresh latar belakang — tidak mengubah status token. */
export function rhPoolUpdatePoints(id: number, pointsBalance: number | null): void {
  if (id === 0 || pointsBalance === null) return
  const now = Date.now()
  db.prepare('UPDATE runninghub_master_token SET points_balance = ?, points_checked_at = ?, updated_at = ? WHERE id = ?')
    .run(pointsBalance, now, now, id)
}

/** Hasil "Cek" admin: snapshot poin + status token. */
export function rhPoolRecordCheck(id: number, hasil: { ok: boolean; pointsBalance?: number | null; message?: string; rejected?: boolean }): void {
  const now = Date.now()
  if (id === 0) {
    if (hasil.rejected) envHealth.rejected = true
    else if (hasil.ok) { envHealth.rejected = false; envHealth.cooldownUntil = 0 }
    envHealth.lastError = String(hasil.message || '').slice(0, 300)
    return
  }
  if (hasil.rejected) {
    db.prepare("UPDATE runninghub_master_token SET status = 'rejected', last_error = ?, updated_at = ? WHERE id = ?")
      .run(String(hasil.message || '').slice(0, 300), now, id)
    return
  }
  if (hasil.ok) {
    db.prepare(
      "UPDATE runninghub_master_token SET status = 'active', cooldown_until = 0, last_error = '', points_balance = ?, points_checked_at = ?, updated_at = ? WHERE id = ?",
    ).run(hasil.pointsBalance ?? null, now, now, id)
  } else {
    db.prepare('UPDATE runninghub_master_token SET last_error = ?, updated_at = ? WHERE id = ?')
      .run(String(hasil.message || '').slice(0, 300), now, id)
  }
}

// ── Afinitas task → token ─────────────────────────────────────────────────
export function rhRememberTaskToken(taskId: string, tokenId: number): void {
  if (!taskId) return
  try {
    db.prepare(
      'INSERT INTO runninghub_task_token (task_id, token_id, created_at) VALUES (?, ?, ?) ON CONFLICT(task_id) DO UPDATE SET token_id = excluded.token_id',
    ).run(String(taskId).slice(0, 200), tokenId, Date.now())
    // Pangkas baris tua supaya tabel tidak tumbuh tanpa batas.
    db.prepare('DELETE FROM runninghub_task_token WHERE created_at < ?').run(Date.now() - 7 * 24 * 60 * 60 * 1000)
  } catch (err) {
    console.error('[rh-pool] gagal menyimpan afinitas task:', err)
  }
}

export function rhTaskTokenId(taskId: string): number | null {
  if (!taskId) return null
  try {
    const row = db.prepare('SELECT token_id FROM runninghub_task_token WHERE task_id = ?').get(String(taskId)) as { token_id: number } | undefined
    return row ? row.token_id : null
  } catch {
    return null
  }
}

// ── Klaim hadiah harian untuk token pool ──────────────────────────────────
/** Token JWT pool yang belum diklaim hari ini (hari UTC+8 dihitung pemanggil). */
export function rhPoolClaimDue(day: string): RhPoolCandidate[] {
  const rows = db
    .prepare("SELECT * FROM runninghub_master_token WHERE kind = 'jwt' AND status != 'rejected' AND last_claim_day != ? ORDER BY id")
    .all(day) as Array<RhPoolRow & { token: string }>
  const out: RhPoolCandidate[] = []
  for (const r of rows) {
    if (rhJwtExpired(r.token)) continue
    out.push({ id: r.id, token: r.token, kind: 'jwt', label: r.label || `Token #${r.id}` })
  }
  return out
}

/** Klaim sukses: poin bertambah → cooldown saldo diangkat. */
export function rhPoolMarkClaimed(id: number, day: string, pointsBalance?: number | null): void {
  const now = Date.now()
  db.prepare(
    "UPDATE runninghub_master_token SET last_claim_day = ?, status = CASE WHEN status = 'cooldown' THEN 'active' ELSE status END, cooldown_until = 0, points_balance = COALESCE(?, points_balance), points_checked_at = ?, updated_at = ? WHERE id = ?",
  ).run(day, pointsBalance ?? null, now, now, id)
}