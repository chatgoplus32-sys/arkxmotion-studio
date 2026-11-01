import db from '../db.js'
import { nexabotSubmitQueueConfig, type NexabotSubmitQueueConfig } from '../../shared/nexabotProxy.js'
import { serverAccounts } from './nexabotAccounts.js'

/**
 * Batas submit bersamaan PER jalur kredensial (lane), disetel admin.
 *
 * Kenapa di admin, bukan di member
 * --------------------------------
 * Angka ini mengatur antrean internal relay, bukan hak yang bisa dibeli: punya
 * 5 slot di antrian tidak berarti 5 video jalan bersamaan. Yang membatasi
 * paralelitas nyata adalah JUMLAH AKUN di pool server — satu akun NexaBot hanya
 * menjalankan satu job, dan lane (jalur kredensial) yang sama tidak bisa
 * menjalankan dua job walau `concurrency`-nya 8. Karena itu halaman admin
 * menampilkan kedua angka ini berdampingan.
 *
 * Urutan prioritas: nilai app_settings → env → default katalog. Nilai di luar
 * 1..20 ditolak (20 = batas pool), jadi salah ketik tidak bisa membuka
 * floodgate ke upstream.
 */
export const SUBMIT_CONCURRENCY_SETTING = 'nexabot_submit_concurrency'

const MIN_CONCURRENCY = 1
const MAKS_CONCURRENCY = 20

/** Config antrean submit efektif — dipakai rute relay tiap kali mengantre. */
export function getNexabotSubmitQueueConfig(): NexabotSubmitQueueConfig {
  const base = nexabotSubmitQueueConfig()
  const row = db
    .prepare('SELECT value FROM app_settings WHERE key = ?')
    .get(SUBMIT_CONCURRENCY_SETTING) as { value: string } | undefined
  const n = Number(row?.value)
  if (!Number.isFinite(n)) return base
  return { ...base, concurrency: Math.max(MIN_CONCURRENCY, Math.min(MAKS_CONCURRENCY, Math.floor(n))) }
}

/**
 * Simpan batas submit bersamaan. Nilai tak valid dilempar sebagai Error dengan
 * pesan yang menyebut batasnya, sama seperti pengaturan harga.
 */
export function setNexabotSubmitConcurrency(value: unknown): number {
  const n = Number(value)
  if (!Number.isFinite(n) || n < MIN_CONCURRENCY || n > MAKS_CONCURRENCY) {
    throw new Error(`Submit bersamaan harus antara ${MIN_CONCURRENCY} dan ${MAKS_CONCURRENCY}`)
  }
  const concurrency = Math.floor(n)
  db.prepare(
    `INSERT INTO app_settings (key, value, updated_at) VALUES (?, ?, CURRENT_TIMESTAMP)
     ON CONFLICT(key) DO UPDATE SET value = excluded.value, updated_at = CURRENT_TIMESTAMP`,
  ).run(SUBMIT_CONCURRENCY_SETTING, String(concurrency))
  return concurrency
}

/**
 * Paralelitas nyata: sebanyak apa job bisa benar-benar jalan bersamaan.
 * Ini jumlah akun di pool server (mode 'off' menghasilkan 0), bukan angka
 * `concurrency` — itu hanya batas antrean per akun.
 */
export function nexabotRealParallelism(): number {
  return serverAccounts().length
}
