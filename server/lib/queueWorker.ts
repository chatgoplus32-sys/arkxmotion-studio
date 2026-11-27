// ─── Worker antrean generasi ───────────────────────────────────────────────
//
// Tugas worker: memantau job NexaBot/PosBot sampai selesai TANPA menunggu
// tab browser terbuka, lalu memberi tahu pemiliknya lewat notifikasi in-app.
//
// Dua jalur, karena kunci API member TIDAK PERNAH disimpan di server
// (hanya ada di localStorage browser):
//
//  1. POLL UPSTREAM — hanya untuk job yang dibuat dengan KUNCI SERVER
//     (`credential_source = 'server'`, dicatat klien saat track; lihat
//     src/lib/jobTracking.ts). NexaBot memakai pool akun server
//     (serverAccounts()), PosBot memakai kunci induk (masterKey('posbot')).
//     Kunci member tidak ada di sini, jadi job berkunci pribadi tidak bisa
//     dipoll worker — lihat jalur 2.
//
//  2. TRANSISI KLIEN — job apa pun (termasuk berkunci pribadi) yang dilaporkan
//     selesai/gagal oleh klien lewat PATCH /api/generation-jobs akan dibuatkan
//     notifikasinya di sini, sekali saja (dijaga kolom `notified_at`).
//
// Batasan yang disengaja (lihat DESIGN.md):
//  - Worker TIDAK mengunduh/menyimpan hasil NexaBot: simpan hasil tetap
//    lewat alur resume klien (saveNexabotResult) saat aplikasi dibuka lagi.
//    Worker hanya menandai `done` + memberi notifikasi ke /queue.
//  - Respons 404 upstream TIDAK PERNAH menandai job gagal: bisa jadi worker
//    memakai akun pool yang salah (afinitas job→akun hanya diingat di memori
//    relay dan hilang saat restart). 404 hanya dihitung sebagai "miss";
//    setelah 3 miss beruntun, polling server untuk job itu dimatikan
//    (`server_poll = 0`) dan pelacakan diserahkan ke resume klien.
//  - Worker TIDAK menyentuh `updated_at` untuk job yang masih berjalan,
//    supaya jendela resume 24 jam (generationJobs.ts) tidak diperpanjang
//    tanpa batas oleh polling server.
//
// Pola scheduler mengikuti server/lib/runninghubDailyClaim.ts: guard
// anti-tick-ganda, jeda awal saat boot, setInterval .unref(), gerbang env.
import db from '../db.js'
import { serverAccounts, type ServerAccount } from './nexabotAccounts.js'
import { masterKey } from './providerMasterKey.js'
import { buatNotifikasiJob, pruneOldNotifications } from './notifications.js'
import {
  CLAIM_TTL_MS,
  RESUME_MAX_AGE_MS,
  TRACK_GRACE_MS,
} from '../routes/generationJobs.js'
/** Deteksi "job sudah berhenti" yang sama dengan relay NexaBot — satu sumber kebenaran. */
import { isNexabotJobFinishedText } from '../../shared/nexabotProxy.js'

const NEXABOT_BASE = (process.env.NEXABOT_BASE || 'https://nexabot.id').replace(/\/+$/, '')
const POSBOT_BASE = (process.env.POSBOT_BASE || 'https://api.posbot.web.id/api/v1').replace(/\/+$/, '')

/** User-Agent yang dipakai relay untuk sesi cookie NexaBot (salin dari server/routes/nexabot.ts). */
const NEXABOT_BROWSER_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/131.0.0.0 Safari/537.36'

const TICK_MS_DEFAULT = 30_000
const POLL_TIMEOUT_NEXABOT_MS = 25_000
const POLL_TIMEOUT_POSBOT_MS = 30_000
/** Berapa job upstream dicek per tick (paling lama dulu). */
const MAX_JOB_PER_TICK = 10
/** 404 beruntun sebelum polling server dimatikan untuk job itu. */
const MAX_POLL_MISSES = 3
/** Jeda antar job dalam satu tick supaya upstream tidak dihujani. */
const ANTAR_JOB_MS = 300
/** Bersihkan notifikasi lama maksimal 1x/jam. */
const PRUNE_INTERVAL_MS = 60 * 60 * 1000

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export interface GenerationJobRow {
  id: number
  user_id: number
  provider: string
  job_id: string
  page: string
  model: string
  prompt: string
  status: string
  result_url: string
  last_error: string
  credential_source: string
  server_poll: number
  poll_misses: number
  notified_at: number | null
  created_at: number
  updated_at: number
}

export type PollKeadaan = 'selesai' | 'gagal' | 'berjalan' | 'tidak-ditemukan' | 'tidak-tersedia' | 'sementara'

export interface PollHasil {
  keadaan: PollKeadaan
  /** URL hasil kalau upstream memberikannya (PosBot). NexaBot: null — hasil disimpan klien. */
  resultUrl?: string | null
  error?: string
}

/** Status terminal NexaBot yang berarti GAGAL (bukan selesai-berhasil). */
const STATUS_GAGAL = new Set(['failed', 'error', 'cancelled', 'canceled'])

/**
 * Petakan teks respons mentah job NexaBot ke keadaan worker. Fungsi murni —
 * dipakai test tanpa HTTP. Deteksi "sudah berhenti" memakai
 * `isNexabotJobFinishedText` yang sama dengan relay (shared/nexabotProxy.ts);
 * pembedaan selesai/gagal memakai STATUS_GAGAL di atas.
 */
export function petakanStatusNexabot(teksRespons: string): PollKeadaan {
  let data: unknown = null
  try {
    data = JSON.parse(teksRespons || '')
  } catch {
    return 'sementara'
  }
  const mentah = (data as { job?: { status?: unknown }; status?: unknown })?.job?.status
    ?? (data as { status?: unknown })?.status
  const status = typeof mentah === 'string' ? mentah.trim().toLowerCase() : ''
  if (!status) return 'sementara'
  if (!isNexabotJobFinishedText(teksRespons)) return 'berjalan'
  return STATUS_GAGAL.has(status) ? 'gagal' : 'selesai'
}

/**
 * Petakan respons status PosBot ke keadaan worker. Fungsi murni — dipakai
 * test tanpa HTTP. Bentuk respons mengikuti src/lib/posbot.ts:
 * `{ status: 'completed' | 'failed' | ..., result_url?, result?.url, error?, model? }`.
 */
export function petakanStatusPosbot(data: unknown): PollHasil {
  if (!data || typeof data !== 'object') return { keadaan: 'sementara' }
  const j = data as { status?: unknown; result_url?: unknown; result?: { url?: unknown }; error?: unknown }
  const status = typeof j.status === 'string' ? j.status.trim().toLowerCase() : ''
  if (status === 'completed') {
    const url = j.result_url || j.result?.url
    return { keadaan: 'selesai', resultUrl: typeof url === 'string' ? url : null }
  }
  if (status === 'failed') {
    const pesan = typeof j.error === 'string'
      ? j.error
      : (j.error as { message?: unknown } | null)?.message
    return {
      keadaan: 'gagal',
      error: typeof pesan === 'string' && pesan ? `PosBot: ${pesan}` : 'PosBot: job gagal',
    }
  }
  if (!status) return { keadaan: 'sementara' }
  return { keadaan: 'berjalan' }
}

/**
 * Header upstream untuk satu akun server NexaBot. Cookie sesi didahulukan
 * seperti relay (kredensialAkun di server/routes/nexabot.ts): paket
 * Unlimited tidak memotong kredit. Tanpa cookie, pakai API key.
 */
function headersAkunNexabot(akun: ServerAccount): Record<string, string> | null {
  if (akun.cookie) {
    return {
      Cookie: akun.cookie,
      Origin: NEXABOT_BASE,
      Referer: `${NEXABOT_BASE}/`,
      'User-Agent': NEXABOT_BROWSER_UA,
      Accept: 'application/json, text/plain, */*',
      'Accept-Language': 'id-ID,id;q=0.9,en-US;q=0.8,en;q=0.7',
    }
  }
  if (akun.apiKey) return { 'x-api-key': akun.apiKey }
  return null
}

/**
 * Poll satu job NexaBot dengan kredensial server. Semua akun pool dicoba
 * berurutan sampai satu menjawab selain 404/401/403: afinitas job→akun
 * hanya hidup di memori relay, jadi setelah restart worker tidak tahu akun
 * mana yang membuat job. 404 dari SEMUA akun = 'tidak-ditemukan' (bukan
 * berarti job gagal — lihat catatan di kepala file).
 */
export async function pollNexabotJob(
  jobId: string,
  fetchFn: typeof fetch = fetch,
): Promise<PollHasil> {
  const daftar = serverAccounts()
  if (daftar.length === 0) return { keadaan: 'tidak-tersedia' }
  let lihat404 = false
  for (const akun of daftar) {
    const headers = headersAkunNexabot(akun)
    if (!headers) continue
    try {
      const res = await fetchFn(`${NEXABOT_BASE}/api/v1/jobs/${encodeURIComponent(jobId)}`, {
        method: 'GET',
        headers: { ...headers, Accept: 'application/json' },
        signal: AbortSignal.timeout(POLL_TIMEOUT_NEXABOT_MS),
      })
      if (res.status === 404) {
        lihat404 = true
        continue
      }
      // Akun ini ditolak — coba akun pool lain (relay melakukan hal yang sama
      // lewat `cadanganKunciPool`).
      if (res.status === 401 || res.status === 403) continue
      if (res.status === 429 || res.status >= 500) return { keadaan: 'sementara' }
      if (!res.ok) return { keadaan: 'sementara' }
      const teks = await res.text().catch(() => '')
      const keadaan = petakanStatusNexabot(teks)
      if (keadaan === 'gagal') {
        let status = 'gagal'
        try {
          const data = JSON.parse(teks) as { job?: { status?: unknown }; status?: unknown }
          const mentah = data?.job?.status ?? data?.status
          if (typeof mentah === 'string' && mentah) status = mentah
        } catch { /* pakai 'gagal' */ }
        return { keadaan: 'gagal', error: `NexaBot: status ${status}` }
      }
      return { keadaan }
    } catch {
      // Jaringan/timeout — bukan vonis atas job; coba lagi tick berikut.
      return { keadaan: 'sementara' }
    }
  }
  return lihat404 ? { keadaan: 'tidak-ditemukan' } : { keadaan: 'sementara' }
}

/**
 * Poll satu job PosBot dengan kunci induk server. Status read-only tidak
 * memakai tiket/kredit — sama seperti yang dilakukan relay untuk poll klien.
 */
export async function pollPosbotJob(
  jobCode: string,
  fetchFn: typeof fetch = fetch,
): Promise<PollHasil> {
  const kunci = masterKey('posbot')
  if (!kunci) return { keadaan: 'tidak-tersedia' }
  try {
    const res = await fetchFn(`${POSBOT_BASE}/status/${encodeURIComponent(jobCode)}`, {
      method: 'GET',
      headers: { Authorization: `Bearer ${kunci}`, Accept: 'application/json' },
      signal: AbortSignal.timeout(POLL_TIMEOUT_POSBOT_MS),
    })
    if (res.status === 404) return { keadaan: 'tidak-ditemukan' }
    if (res.status === 401 || res.status === 403) {
      console.error('[queue-worker] kunci server PosBot ditolak upstream (HTTP ' + res.status + ') — periksa panel admin')
      return { keadaan: 'tidak-tersedia' }
    }
    if (res.status === 429 || res.status >= 500) return { keadaan: 'sementara' }
    if (!res.ok) return { keadaan: 'sementara' }
    const data: unknown = await res.json().catch(() => null)
    return petakanStatusPosbot(data)
  } catch {
    return { keadaan: 'sementara' }
  }
}

async function pollUpstream(job: GenerationJobRow, fetchFn: typeof fetch): Promise<PollHasil> {
  if (job.provider === 'nexabot') return pollNexabotJob(job.job_id, fetchFn)
  if (job.provider === 'posbot') return pollPosbotJob(job.job_id, fetchFn)
  return { keadaan: 'sementara' }
}

/**
 * Job yang boleh dipoll worker tick ini: kunci server, masih hidup
 * (pending/processing, <24 jam), belum dimatikan polling-nya, dan TIDAK
 * sedang dipegang tab yang masih hidup — aturan klaim yang sama dengan
 * GET /api/generation-jobs (grace 90 detik untuk pending, TTL klaim
 * 30 menit untuk processing). Poll ganda dengan tab yang masih hidup
 * tetap aman (baca read-only; transisi terminal dijaga transaksi),
 * aturan ini hanya mengurangi panggilan upstream yang sia-sia.
 */
export function pilihJobUntukPoll(now = Date.now()): GenerationJobRow[] {
  return db
    .prepare(
      `SELECT * FROM generation_job
       WHERE status IN ('pending', 'processing')
         AND credential_source = 'server'
         AND server_poll = 1
         AND provider IN ('nexabot', 'posbot')
         AND updated_at > ?
         AND (
           (status = 'pending' AND updated_at <= ?)
           OR (status = 'processing' AND updated_at < ?)
         )
       ORDER BY updated_at ASC
       LIMIT ?`,
    )
    .all(now - RESUME_MAX_AGE_MS, now - TRACK_GRACE_MS, now - CLAIM_TTL_MS, MAX_JOB_PER_TICK) as GenerationJobRow[]
}

/**
 * Terapkan transisi terminal + buat notifikasi dalam SATU transaksi:
 * klaim baris dulu (UPDATE dengan guard status), lalu klaim
 * `notified_at`, lalu insert notifikasi. Kalau ada langkah gagal,
 * transaksi batal — tidak ada notifikasi tanpa perubahan status,
 * dan tidak ada notifikasi ganda.
 */
function terapkanTerminal(
  job: GenerationJobRow,
  status: 'done' | 'failed',
  resultUrl: string | null,
  error: string,
): boolean {
  const now = Date.now()
  return db.transaction(() => {
    const ubah = db
      .prepare(
        `UPDATE generation_job
         SET status = ?, result_url = ?, last_error = ?, updated_at = ?
         WHERE id = ? AND status NOT IN ('done', 'failed')`,
      )
      .run(status, resultUrl ?? job.result_url, error.slice(0, 300), now, job.id)
    if (ubah.changes === 0) return false
    const klaim = db
      .prepare(`UPDATE generation_job SET notified_at = ? WHERE id = ? AND notified_at IS NULL`)
      .run(now, job.id)
    if (klaim.changes === 0) return true
    buatNotifikasiJob({ ...job, status, result_url: resultUrl ?? job.result_url, last_error: error })
    return true
  })()
}

/** 404 beruntun: naikkan miss; di batas, matikan polling server untuk job ini. */
function catatMiss(job: GenerationJobRow): void {
  const miss = job.poll_misses + 1
  const masihBoleh = miss < MAX_POLL_MISSES ? 1 : 0
  db.prepare(`UPDATE generation_job SET poll_misses = ?, server_poll = ? WHERE id = ?`).run(
    miss,
    masihBoleh,
    job.id,
  )
  if (!masihBoleh) {
    console.log(
      `[queue-worker] ${job.provider}:${job.job_id} — upstream tidak mengenal job ini (${miss}x 404), polling server dihentikan; resume klien tetap bisa mencoba.`,
    )
  }
}

/** Poll sukses (masih berjalan): reset hitungan miss. */
function resetMiss(job: GenerationJobRow): void {
  if (job.poll_misses > 0) {
    db.prepare(`UPDATE generation_job SET poll_misses = 0 WHERE id = ?`).run(job.id)
  }
}

/**
 * Buat notifikasi untuk job yang SUDAH dilaporkan selesai/gagal oleh klien
 * (PATCH /api/generation-jobs) tapi belum diberitahu. Ini jalur untuk
 * job berkunci pribadi yang tidak bisa dipoll worker. Idempoten:
 * klaim `notified_at` dulu, baru insert — dijalankan dua kali pun hanya
 * satu notifikasi yang dibuat.
 */
export function beritahuTransisiKlien(): number {
  const rows = db
    .prepare(
      `SELECT * FROM generation_job
       WHERE status IN ('done', 'failed') AND notified_at IS NULL
       ORDER BY updated_at ASC LIMIT 50`,
    )
    .all() as GenerationJobRow[]
  let dibuat = 0
  for (const row of rows) {
    try {
      db.transaction(() => {
        const klaim = db
          .prepare(`UPDATE generation_job SET notified_at = ? WHERE id = ? AND notified_at IS NULL`)
          .run(Date.now(), row.id)
        if (klaim.changes === 0) return
        buatNotifikasiJob(row)
        dibuat += 1
      })()
    } catch (err) {
      console.error('[queue-worker] gagal membuat notifikasi job', row.id, (err as Error)?.message || err)
    }
  }
  return dibuat
}

export interface TickRingkasan {
  dipoll: number
  selesai: number
  gagal: number
  diberitahu: number
  dilewati: number
}

let terakhirPrune = 0

/** Satu putaran worker. `fetchFn` bisa diganti stub di test. */
export async function jalankanTickSekali(fetchFn: typeof fetch = fetch): Promise<TickRingkasan> {
  const ringkasan: TickRingkasan = { dipoll: 0, selesai: 0, gagal: 0, diberitahu: 0, dilewati: 0 }

  // Bersihkan notifikasi lama (maks 1x/jam).
  try {
    const now = Date.now()
    if (now - terakhirPrune >= PRUNE_INTERVAL_MS) {
      terakhirPrune = now
      const dibuang = pruneOldNotifications(30)
      if (dibuang > 0) console.log(`[queue-worker] bersihkan ${dibuang} notifikasi lama`)
    }
  } catch (err) {
    console.error('[queue-worker] prune notifikasi gagal:', (err as Error)?.message || err)
  }

  // Jalur 2: transisi yang dilaporkan klien.
  try {
    ringkasan.diberitahu += beritahuTransisiKlien()
  } catch (err) {
    console.error('[queue-worker] beritahu transisi klien gagal:', (err as Error)?.message || err)
  }

  // Jalur 1: poll upstream untuk job berkunci server.
  const jobs = pilihJobUntukPoll()
  for (let i = 0; i < jobs.length; i++) {
    const job = jobs[i]
    ringkasan.dipoll += 1
    let hasil: PollHasil
    try {
      hasil = await pollUpstream(job, fetchFn)
    } catch (err) {
      console.error('[queue-worker] poll gagal:', job.provider, job.job_id, (err as Error)?.message || err)
      hasil = { keadaan: 'sementara' }
    }
    try {
      if (hasil.keadaan === 'selesai') {
        if (terapkanTerminal(job, 'done', hasil.resultUrl ?? null, '')) ringkasan.selesai += 1
      } else if (hasil.keadaan === 'gagal') {
        if (terapkanTerminal(job, 'failed', null, hasil.error || '')) ringkasan.gagal += 1
      } else if (hasil.keadaan === 'tidak-ditemukan') {
        catatMiss(job)
        ringkasan.dilewati += 1
      } else if (hasil.keadaan === 'tidak-tersedia') {
        ringkasan.dilewati += 1
      } else {
        // 'berjalan' / 'sementara' — belum ada keputusan; reset miss kalau
        // upstream menjawab (bukan 404).
        if (hasil.keadaan === 'berjalan') resetMiss(job)
      }
    } catch (err) {
      console.error('[queue-worker] terapkan hasil gagal:', job.provider, job.job_id, (err as Error)?.message || err)
    }
    if (i < jobs.length - 1) await sleep(ANTAR_JOB_MS)
  }
  return ringkasan
}

/** Gerbang env: default aktif di production, bisa dipaksa/dimatikan manual. */
export function queueWorkerEnabled(): boolean {
  const raw = (process.env.QUEUE_WORKER ?? '').trim().toLowerCase()
  if (raw) return !['0', 'false', 'off', 'no'].includes(raw)
  return process.env.NODE_ENV === 'production'
}

export function queueWorkerIntervalMs(): number {
  const raw = Number(process.env.QUEUE_WORKER_INTERVAL_MS)
  if (Number.isFinite(raw) && raw >= 5_000) return Math.floor(raw)
  return TICK_MS_DEFAULT
}

let schedulerStarted = false
let sedangBerjalan = false

/**
 * Scheduler in-process — pola yang sama dengan startRunningHubDailyClaimScheduler:
 * guard sekali-jalan, jeda awal supaya boot tidak langsung dihujani request
 * upstream, interval .unref() supaya tidak menahan proses, dan tick yang
 * tumpang-tindih dilewati (bukan diantre).
 */
export function startQueueWorker(): void {
  if (schedulerStarted) return
  schedulerStarted = true
  if (!queueWorkerEnabled()) {
    console.log(
      '[queue-worker] scheduler dimatikan (aktif otomatis di production; set QUEUE_WORKER=1 untuk memaksa).',
    )
    return
  }
  const intervalMs = queueWorkerIntervalMs()
  const tick = async () => {
    if (sedangBerjalan) return
    sedangBerjalan = true
    try {
      const hasil = await jalankanTickSekali()
      if (hasil.dipoll > 0 || hasil.diberitahu > 0) {
        console.log(
          `[queue-worker] tick: ${hasil.dipoll} dipoll, ${hasil.selesai} selesai, ${hasil.gagal} gagal, ${hasil.diberitahu} diberitahu`,
        )
      }
    } catch (err) {
      console.error('[queue-worker] tick gagal:', (err as Error)?.message || err)
    } finally {
      sedangBerjalan = false
    }
  }
  // Jeda awal supaya boot server tidak langsung dihujani request upstream.
  setTimeout(() => { void tick() }, 15_000).unref()
  setInterval(() => { void tick() }, intervalMs).unref()
  console.log(`[queue-worker] scheduler aktif — cek tiap ${Math.round(intervalMs / 1000)} detik.`)
}
