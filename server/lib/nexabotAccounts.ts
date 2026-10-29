import crypto from 'node:crypto'

import db from '../db.js'
import {
  MASTER_KEY_SETTING,
  looksLikeSessionCookie,
  masterDailyCap,
  masterKeyMode,
  memberMayUseMasterKey,
  underDailyCap,
  type Kelayakan,
} from './nexabotMasterKey.js'
import {
  MASTER_COOKIE_SETTING,
  isValidCookie,
  memberMayUseMasterCookie,
  parseCookieInput,
} from './nexabotMasterCookie.js'

/**
 * Pool akun NexaBot milik operator.
 *
 * Kenapa pool
 * -----------
 * Satu akun NexaBot (mode Unlimited) hanya boleh menjalankan SATU job. Relay
 * sudah menahan submit kedua sampai job pertama selesai, tapi itu berarti member
 * ke-10 menunggu belasan menit. Satu-satunya jalan keluar yang tidak mengubah
 * model/harga bagi member adalah akun tambahan: tiap akun punya lane sendiri,
 * jadi N akun = N job berjalan bersamaan.
 *
 * Bentuk penyimpanan
 * ------------------
 * Akun utama tetap memakai dua slot lama (`NEXABOT_MASTER_API_KEY` /
 * `nexabot_master_cookie`), sehingga instalasi yang sudah berjalan tidak perlu
 * migrasi. Akun tambahan disimpan sebagai JSON di `app_settings`:
 *
 *   [{ "id": "acc_1a2b3c4d", "label": "Akun 2", "api_key": "…", "cookie": "…" }]
 *
 * Nilai rahasia TIDAK pernah keluar dari modul ini menuju klien: ringkasan untuk
 * dashboard hanya berisi boolean `has_key` / `has_cookie`.
 */

export const ACCOUNTS_SETTING = 'nexabot_master_accounts'

/** Batas wajar: lebih dari ini berarti ada yang salah, bukan kebutuhan nyata. */
const MAKS_AKUN = 20
const MAKS_LABEL = 40

export interface ServerAccount {
  id: string
  label: string
  apiKey: string | null
  cookie: string | null
  /** true = berasal dari dua slot kredensial lama (bukan daftar akun). */
  legacy: boolean
}

export interface AccountSummary {
  id: string
  label: string
  has_key: boolean
  has_cookie: boolean
  legacy: boolean
}

interface StoredAccount {
  id: string
  label: string
  api_key?: string
  cookie?: string
}

export class AccountInputError extends Error {}

function readSetting(key: string): string | null {
  try {
    const row = db.prepare('SELECT value FROM app_settings WHERE key = ?').get(key) as
      | { value: string }
      | undefined
    const nilai = (row?.value || '').trim()
    return nilai || null
  } catch {
    return null
  }
}

function writeSetting(key: string, value: string) {
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(key, value)
}

/**
 * Kunci akun utama: dashboard dulu, lalu `.env` — urutan yang sama dengan
 * `masterKey()`. Nilai berbentuk cookie diabaikan sebagai kunci.
 */
function legacyApiKey(): string | null {
  const mentah = (readSetting(MASTER_KEY_SETTING) || process.env.NEXABOT_MASTER_API_KEY || '').trim()
  if (!mentah || looksLikeSessionCookie(mentah)) return null
  return mentah
}

function legacyCookie(): string | null {
  const mentah = (readSetting(MASTER_COOKIE_SETTING) || '').trim()
  return mentah || null
}

function sanitizeStored(entry: unknown): StoredAccount | null {
  if (!entry || typeof entry !== 'object') return null
  const obj = entry as Record<string, unknown>
  const apiKey = typeof obj.api_key === 'string' ? obj.api_key.trim() : ''
  const cookie = typeof obj.cookie === 'string' ? obj.cookie.trim() : ''
  const id = typeof obj.id === 'string' && obj.id.trim() ? obj.id.trim() : ''
  if (!id) return null
  if (!apiKey && !cookie) return null
  const label = typeof obj.label === 'string' && obj.label.trim()
    ? obj.label.trim().slice(0, MAKS_LABEL)
    : 'Akun tambahan'
  return {
    id,
    label,
    ...(apiKey && !looksLikeSessionCookie(apiKey) ? { api_key: apiKey } : {}),
    ...(cookie && isValidCookie(cookie) ? { cookie } : {}),
  }
}

function storedAccounts(): StoredAccount[] {
  const mentah = readSetting(ACCOUNTS_SETTING)
  if (!mentah) return []
  try {
    const parsed = JSON.parse(mentah)
    if (!Array.isArray(parsed)) return []
    return parsed
      .map(sanitizeStored)
      .filter((x): x is StoredAccount => !!x)
      .slice(0, MAKS_AKUN)
  } catch {
    return []
  }
}

function writeStoredAccounts(list: StoredAccount[]) {
  writeSetting(ACCOUNTS_SETTING, JSON.stringify(list.slice(0, MAKS_AKUN)))
}

/**
 * Semua akun server yang siap dipakai, akun utama lebih dulu.
 *
 * Mode `off` mengosongkan daftar: satu saklar yang sama mematikan seluruh
 * kredensial server, termasuk akun tambahan.
 */
export function serverAccounts(): ServerAccount[] {
  if (masterKeyMode() === 'off') return []

  const hasil: ServerAccount[] = []
  const kunciUtama = legacyApiKey()
  const kukiUtama = legacyCookie()
  if (kunciUtama || kukiUtama) {
    hasil.push({
      id: 'utama',
      label: 'Akun utama',
      apiKey: kunciUtama,
      cookie: kukiUtama,
      legacy: true,
    })
  }

  for (const akun of storedAccounts()) {
    hasil.push({
      id: akun.id,
      label: akun.label,
      apiKey: akun.api_key || null,
      cookie: akun.cookie || null,
      legacy: false,
    })
  }
  return hasil
}

export function serverAccountById(id: string): ServerAccount | null {
  return serverAccounts().find((a) => a.id === id) ?? null
}

export function accountSummaries(): AccountSummary[] {
  return serverAccounts().map((a) => ({
    id: a.id,
    label: a.label,
    has_key: !!a.apiKey,
    has_cookie: !!a.cookie,
    legacy: a.legacy,
  }))
}

/** Apakah nilai dari klien sebenarnya kredensial server (kunci atau cookie). */
export function isAnyServerSecret(value: string | null | undefined): boolean {
  const v = (value || '').trim()
  if (!v) return false
  return serverAccounts().some((a) => a.apiKey === v || a.cookie === v)
}

/** Kumpulan rahasia server, untuk memeriksa banyak nilai sekaligus tanpa query berulang. */
export function serverSecrets(): Set<string> {
  const set = new Set<string>()
  for (const akun of serverAccounts()) {
    if (akun.apiKey) set.add(akun.apiKey)
    if (akun.cookie) set.add(akun.cookie)
  }
  return set
}

/** Pengganti `redactIfMasterKey` yang ikut mengenali kunci/cookie akun tambahan. */
export function redactIfServerSecret(value: unknown, secrets = serverSecrets()): string {
  const nilai = typeof value === 'string' ? value : ''
  return nilai && secrets.has(nilai.trim())
    ? '(kredensial server NexaBot — sengaja tidak ditampilkan)'
    : nilai
}

function normalisasiInput(input: { label?: unknown; apiKey?: unknown; cookie?: unknown }) {
  const label = typeof input.label === 'string' ? input.label.trim().slice(0, MAKS_LABEL) : ''
  const kunciMentah = typeof input.apiKey === 'string' ? input.apiKey.trim() : ''
  const kukiMentah = typeof input.cookie === 'string' ? input.cookie.trim() : ''

  if (kunciMentah && looksLikeSessionCookie(kunciMentah)) {
    throw new AccountInputError(
      'Nilai kunci itu cookie sesi (ada `nama=isi`), bukan API key. Tempel di kolom sesi cookie.',
    )
  }
  const cookie = kukiMentah ? parseCookieInput(kukiMentah) : ''
  if (kukiMentah && !isValidCookie(cookie)) {
    throw new AccountInputError('Cookie tidak valid — tempel nilai cookie sesi (`session=...`) atau hasil Copy as cURL')
  }
  if (!kunciMentah && !cookie) {
    throw new AccountInputError('Isi minimal satu: API key atau cookie sesi')
  }
  return { label, apiKey: kunciMentah, cookie }
}

function labelBaru(label: string, list: StoredAccount[]): string {
  if (label) return label
  return `Akun ${list.length + 2}`
}

export function addServerAccount(input: {
  label?: unknown
  apiKey?: unknown
  cookie?: unknown
}): AccountSummary {
  const { label, apiKey, cookie } = normalisasiInput(input)
  const list = storedAccounts()
  if (list.length >= MAKS_AKUN - 1) {
    throw new AccountInputError(`Batas ${MAKS_AKUN} akun tercapai`)
  }
  const baru: StoredAccount = {
    id: `acc_${crypto.randomBytes(4).toString('hex')}`,
    label: labelBaru(label, list),
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(cookie ? { cookie } : {}),
  }
  writeStoredAccounts([...list, baru])
  return {
    id: baru.id,
    label: baru.label,
    has_key: !!baru.api_key,
    has_cookie: !!baru.cookie,
    legacy: false,
  }
}

export function updateServerAccount(
  id: string,
  input: { label?: unknown; apiKey?: unknown; cookie?: unknown },
): AccountSummary {
  const list = storedAccounts()
  const idx = list.findIndex((a) => a.id === id)
  if (idx < 0) throw new AccountInputError('Akun tidak ditemukan')

  const lama = list[idx]
  const { label, apiKey, cookie } = normalisasiInput({
    label: input.label ?? lama.label,
    // Kolom kosong = pertahankan nilai lama; admin tidak perlu menempel ulang
    // rahasia hanya untuk mengganti nama akun.
    apiKey: typeof input.apiKey === 'string' && input.apiKey.trim() ? input.apiKey : lama.api_key,
    cookie: typeof input.cookie === 'string' && input.cookie.trim() ? input.cookie : lama.cookie,
  })
  const baru: StoredAccount = {
    id,
    label: label || lama.label,
    ...(apiKey ? { api_key: apiKey } : {}),
    ...(cookie ? { cookie } : {}),
  }
  list[idx] = baru
  writeStoredAccounts(list)
  return {
    id: baru.id,
    label: baru.label,
    has_key: !!baru.api_key,
    has_cookie: !!baru.cookie,
    legacy: false,
  }
}

/** Akun utama tidak bisa dihapus dari daftar — kosongkan lewat slot kunci/sesi. */
export function removeServerAccount(id: string): AccountSummary[] {
  if (id === 'utama') {
    throw new AccountInputError('Akun utama dihapus lewat bagian Kunci Server / Sesi Unlimited')
  }
  const list = storedAccounts()
  const sisa = list.filter((a) => a.id !== id)
  if (sisa.length === list.length) throw new AccountInputError('Akun tidak ditemukan')
  writeStoredAccounts(sisa)
  return accountSummaries()
}

/**
 * Kelayakan memakai kredensial server apa pun (kunci atau cookie).
 *
 * Satu pintu untuk relay: selama masih ada satu akun yang bisa dipakai, member
 * yang berhak tidak boleh ditolak hanya karena slot akun utama kosong.
 */
export function serverCredentialEligibility(userId: number): Kelayakan {
  if (masterKeyMode() === 'off') {
    return { ok: false, reason: 'Kunci induk NexaBot dimatikan di server' }
  }
  if (serverAccounts().length === 0) {
    return { ok: false, reason: 'Kunci/Sesi NexaBot milik server belum diatur admin' }
  }
  const izin = memberMayUseMasterKey(userId)
  if (!izin.ok) return izin
  const cap = underDailyCap(userId)
  if (!cap.ok) return cap
  return { ok: true, reason: masterDailyCap() > 0 ? `${izin.reason} · ${cap.reason}` : izin.reason }
}

/** Kelayakan khusus jalur sesi (cookie) — dipakai `/balance` untuk memilih `kind`. */
export function serverCookieEligible(userId: number): Kelayakan {
  if (masterKeyMode() === 'off') {
    return { ok: false, reason: 'Kunci induk NexaBot dimatikan di server' }
  }
  if (!serverAccounts().some((a) => a.cookie)) {
    return { ok: false, reason: 'Sesi Unlimited NexaBot milik server belum diatur admin' }
  }
  const izin = memberMayUseMasterCookie(userId)
  if (!izin.ok) return izin
  const cap = underDailyCap(userId)
  if (!cap.ok) return cap
  return { ok: true, reason: masterDailyCap() > 0 ? `${izin.reason} · ${cap.reason}` : izin.reason }
}

/** Kelayakan khusus jalur API key. */
export function serverKeyEligible(userId: number): Kelayakan {
  if (masterKeyMode() === 'off') {
    return { ok: false, reason: 'Kunci induk NexaBot dimatikan di server' }
  }
  if (!serverAccounts().some((a) => a.apiKey)) {
    return { ok: false, reason: 'Kunci Server NexaBot belum diatur' }
  }
  const izin = memberMayUseMasterKey(userId)
  if (!izin.ok) return izin
  const cap = underDailyCap(userId)
  if (!cap.ok) return cap
  return { ok: true, reason: masterDailyCap() > 0 ? `${izin.reason} · ${cap.reason}` : izin.reason }
}
