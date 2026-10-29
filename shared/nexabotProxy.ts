/**
 * Kebijakan timeout & retry untuk proxy NexaBot.
 *
 * Dipakai DUA implementasi proxy yang harus berperilaku sama:
 *  - server/routes/nexabot.ts  (Express lokal, dev)
 *  - api/public/nexabot.ts     (fungsi Vercel, produksi)
 *
 * Kenapa perlu: NexaBot (nexabot.id) sering menggantung tanpa respons. Proxy
 * kita dulu memakai satu timeout 20 detik untuk semua hal dan langsung menjawab
 * 504 — padahal hanya SATU percobaan. Akibatnya satu hiccup upstream langsung
 * terlihat oleh klien sebagai kegagalan job yang sebenarnya masih `queued`.
 *
 * Sekarang tiap jenis request punya timeout & jumlah percobaan sendiri:
 *  - probe saldo/sesi & poll status job = read-only → aman diulang;
 *  - submit/generate = bisa membuat job (kredit terpotong) → TIDAK pernah
 *    diulang, supaya tidak ada job/kredit ganda.
 *
 * Bedanya dengan src/lib/nexabotRetry.ts (sisi klien): modul ini berjalan di
 * server/Vercel dan mengurus timeout-batas atas proxy, sedangkan yang itu
 * mengatur backoff polling di browser.
 */

export type NexabotProxyAction =
  | 'credit'
  | 'session'
  | 'job'
  | 'modes'
  | 'submit'
  | 'generate'
  | 'gpt-image'
  | 'download'
  | 'generic'

export interface NexabotProxyPolicy {
  /** Timeout per percobaan (ms). */
  timeoutMs: number
  /** Total percobaan; 1 = tanpa retry. */
  attempts: number
  /** Keterangan singkat untuk pesan error/log. */
  label: string
}

export const NEXABOT_PROXY_POLICY: Record<NexabotProxyAction, NexabotProxyPolicy> = {
  // Probe saldo/sesi: read-only, jadi boleh diulang — TAPI anggarannya harus
  // muat di dalam kesabaran klien (halaman Providers memakai
  // NEXABOT_CHECK_TIMEOUT_MS = 55s).
  //
  // Kenapa bukan 30s × 3 seperti dulu: log nexabot-local menunjukkan /credit
  // menggantung ~30s TANPA jawaban, retry 3× = ~92s, padahal klien menyerah di
  // 8–15s — jadi hasilnya selalu 504 dan tidak ada satu pun percobaan yang
  // sempat dilihat user. Sekarang satu percobaan 20s + satu retry (~45s worst
  // case): jawaban upstream yang datang di ~30s tetap tertangkap di percobaan
  // kedua, dan seluruh anggaran masih di bawah timeout klien.
  credit: { timeoutMs: 20_000, attempts: 2, label: 'cek saldo' },
  session: { timeoutMs: 20_000, attempts: 2, label: 'cek sesi' },
  // Poll status: read-only juga, tapi ini di jalur kritis user yang sedang
  // menunggu video, jadi per percobaan lebih pendek dari probe dan hanya 2
  // percobaan — klien punya backoff sendiri dan akan menanyakan status lagi.
  job: { timeoutMs: 25_000, attempts: 2, label: 'poll status job' },
  // Daftar mode/model: read-only, dipakai halaman Providers.
  modes: { timeoutMs: 20_000, attempts: 2, label: 'ambil daftar mode' },
  // Submit & generate: SATU percobaan. Kalau responsnya hilang, job bisa saja
  // sudah terbentuk upstream — mengulang berarti kredit terpotong dua kali.
  submit: { timeoutMs: 180_000, attempts: 1, label: 'submit ke NexaBot' },
  generate: { timeoutMs: 180_000, attempts: 1, label: 'generate via session' },
  // GPT Image 2.5 (nexabot.id/gpt-image): sekali jalan seperti submit —
  // respons hilang berarti job mungkin sudah terbentuk dan 0,1 cr terpotong.
  'gpt-image': { timeoutMs: 180_000, attempts: 1, label: 'generate GPT Image' },
  download: { timeoutMs: 180_000, attempts: 1, label: 'unduh hasil' },
  // Jalur cadangan (path yang tidak dikenali): tetap diberi timeout supaya tidak
  // menggantung tanpa batas, tapi tanpa retry karena isinya tidak diketahui.
  generic: { timeoutMs: 180_000, attempts: 1, label: 'proxy NexaBot' },
}

/** Jeda antar percobaan (backoff + jitter). */
export const NEXABOT_PROXY_RETRY = {
  baseMs: 500,
  maxMs: 4000,
  jitter: 0.25,
  /** Retry-After dari upstream tidak boleh menahan proxy lebih lama dari ini. */
  maxRetryAfterMs: 10_000,
}

export interface NexabotProxyRetryConfig {
  baseMs: number
  maxMs: number
  jitter: number
  maxRetryAfterMs: number
}

/**
 * Config retry efektif. Bisa ditimpa lewat env supaya test tidak menunggu
 * setengah detik tiap percobaan (dan ops bisa melonggarkan saat upstream ramai).
 */
export function nexabotProxyRetryConfig(env: NodeJS.ProcessEnv = process.env): NexabotProxyRetryConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    baseMs: num(env.NEXABOT_PROXY_RETRY_BASE_MS, NEXABOT_PROXY_RETRY.baseMs),
    maxMs: num(env.NEXABOT_PROXY_RETRY_MAX_MS, NEXABOT_PROXY_RETRY.maxMs),
    jitter: NEXABOT_PROXY_RETRY.jitter,
    maxRetryAfterMs: num(env.NEXABOT_PROXY_RETRY_MAX_RETRY_AFTER_MS, NEXABOT_PROXY_RETRY.maxRetryAfterMs),
  }
}

/** Status upstream yang layak diulang proxy (rate limit & gateway). */
export function isNexabotProxyTransientStatus(status: number): boolean {
  return status === 429 || status === 408 || status === 425 || status >= 500
}

/** `Retry-After` dalam ms (detik atau tanggal HTTP); null kalau tidak terbaca. */
export function parseNexabotRetryAfterMs(header: string | null | undefined, nowMs: number = Date.now()): number | null {
  const raw = String(header ?? '').trim()
  if (!raw) return null
  if (/^\d+$/.test(raw)) return Math.max(0, Number(raw) * 1000)
  const at = Date.parse(raw)
  if (!Number.isFinite(at)) return null
  return Math.max(0, at - nowMs)
}

/** Jeda sebelum percobaan berikutnya (Retry-After menang atas backoff). */
export function nexabotProxyDelayMs(params: {
  attempt: number
  retryAfterHeader?: string | null
  config?: NexabotProxyRetryConfig
  random?: () => number
  nowMs?: number
}): number {
  const {
    attempt,
    retryAfterHeader,
    config = nexabotProxyRetryConfig(),
    random = Math.random,
    nowMs = Date.now(),
  } = params
  const hinted = parseNexabotRetryAfterMs(retryAfterHeader, nowMs)
  if (hinted != null) return Math.min(config.maxRetryAfterMs, hinted)

  const step = Math.max(0, Math.floor(attempt) - 1)
  const raw = Math.min(config.maxMs, config.baseMs * Math.pow(2, step))
  const spread = raw * Math.min(1, Math.max(0, config.jitter))
  const value = raw + (random() * 2 - 1) * spread
  return Math.max(0, Math.round(Math.min(config.maxMs, value)))
}

/** Header yang perlu diteruskan apa adanya dari upstream ke klien. */
export function nexabotRelayHeaders(upstream: Response): Record<string, string> {
  const retryAfter = upstream.headers.get('retry-after')
  return retryAfter ? { 'Retry-After': retryAfter } : {}
}

// ═══════════════════════════════════════════════════════════════════
// ANTREAN PROBE & SINGLE-FLIGHT (khusus request read-only)
// ═══════════════════════════════════════════════════════════════════
/**
 * Log lapangan (nexabot-local): begitu beberapa key dicek bersamaan, lima
 * request `/credit` menembak upstream sekaligus — dan NexaBot menggantung untuk
 * SEMUANYA (semua berakhir `timeout setelah 3×30s`). Padahal request yang persis
 * sama (key/sesi yang sama, dipicu cek-all + pemantau sesi + dashboard) tidak
 * perlu dua kali jalan sama sekali.
 *
 * Dua penanganan di sini, keduanya HANYA untuk aksi read-only:
 *
 *  1. **single-flight** — panggilan identik yang sedang jalan berbagi satu
 *     respons upstream, bukan menembak ulang. Respons di-clone supaya tiap
 *     pemanggil tetap bebas membaca body-nya sendiri.
 *  2. **antrean FIFO** — maksimum {@link NEXABOT_PROBE_QUEUE.concurrency} probe
 *     jalan bersamaan; sisanya menunggu slot, dibatasi
 *     {@link NEXABOT_PROBE_QUEUE.maxWaitMs} supaya tidak menggantung selamanya.
 *
 * Submit & generate TIDAK lewat jalur ini: keduanya bisa membuat job (kredit
 * terpotong) dan tidak boleh DIBAGI (satu respons untuk dua submit berbeda tidak
 * ada artinya). Yang boleh — dan sekarang dilakukan — adalah MENAHAN submit di
 * antrean sendiri; lihat bagian "ANTREAN SUBMIT PER KREDENSIAL" di bawah.
 *
 * Batasannya: antrean ini per proses/instance server. Di Vercel ia menjaga
 * instance yang dipakai bersama; di server Express lokal (kasus paling sering
 * memicu hujan probe) efeknya langsung terasa.
 */

export const NEXABOT_PROBE_QUEUE = {
  /** Probe read-only yang boleh jalan bersamaan per proses/instance. */
  concurrency: 2,
  /** Batas menunggu slot antrean sebelum menyerah (ms). */
  maxWaitMs: 25_000,
}

export interface NexabotProbeQueueConfig {
  concurrency: number
  maxWaitMs: number
}

/** Config antrean efektif — bisa disetel lewat env saat upstream sedang ramai. */
export function nexabotProbeQueueConfig(env: NodeJS.ProcessEnv = process.env): NexabotProbeQueueConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n >= 0 ? n : fallback
  }
  return {
    concurrency: Math.max(1, Math.floor(num(env.NEXABOT_PROBE_CONCURRENCY, NEXABOT_PROBE_QUEUE.concurrency))),
    maxWaitMs: num(env.NEXABOT_PROBE_QUEUE_MAX_WAIT_MS, NEXABOT_PROBE_QUEUE.maxWaitMs),
  }
}

/** Aksi read-only & idempoten → aman diantrekan sekaligus dibagi. */
export function isNexabotShareableProbe(action: NexabotProxyAction): boolean {
  return action === 'credit' || action === 'session' || action === 'modes'
}

/**
 * Kunci single-flight: jenis request + URL + kredensialnya. Nilainya hanya
 * dipakai sebagai kunci Map di memori proses — tidak pernah di-log.
 */
export function nexabotProbeShareKey(url: string, init: RequestInit, action: NexabotProxyAction): string {
  const headers = (init.headers || {}) as Record<string, string>
  const auth = headers['x-api-key'] || headers['X-Api-Key']
    || headers['x-nexabot-cookie'] || headers['X-Nexabot-Cookie'] || ''
  return `${action}|${init.method || 'GET'}|${url}|${auth}`
}

interface ProbeWaiter {
  grant: () => void
  timer: ReturnType<typeof setTimeout> | null
  settled: boolean
}

/** Semaphore FIFO sederhana (satu instance per proses). */
export class NexabotProbeGate {
  private active = 0
  private queue: ProbeWaiter[] = []

  /** true = slot didapat (wajib `release()`), false = menunggu kelamaan. */
  async acquire(limit: number, maxWaitMs: number): Promise<boolean> {
    if (this.active < limit) {
      this.active += 1
      return true
    }
    return await new Promise<boolean>((resolve) => {
      const waiter: ProbeWaiter = { grant: () => resolve(true), timer: null, settled: false }
      waiter.timer = setTimeout(() => {
        if (waiter.settled) return
        waiter.settled = true
        this.queue = this.queue.filter((w) => w !== waiter)
        resolve(false)
      }, maxWaitMs)
      // Antrean tidak boleh menahan proses tetap hidup (Node/Vercel).
      ;(waiter.timer as { unref?: () => void } | null)?.unref?.()
      this.queue.push(waiter)
    })
  }

  /** Lepas slot: diteruskan ke penunggu berikutnya kalau ada. */
  release(): void {
    const next = this.queue.shift()
    if (!next) {
      this.active = Math.max(0, this.active - 1)
      return
    }
    next.settled = true
    if (next.timer) clearTimeout(next.timer)
    next.grant()
  }

  /** Dipakai test: slot terpakai & jumlah penunggu saat ini. */
  stats(): { active: number; waiting: number } {
    return { active: this.active, waiting: this.queue.length }
  }
}

const probeGate = new NexabotProbeGate()
const inFlightProbes = new Map<string, Promise<{ response: Response; attempts: number }>>()

/** Salinan respons supaya tiap pemanggil bisa membaca body-nya sendiri. */
function cloneProbeResult(result: { response: Response; attempts: number }): { response: Response; attempts: number } {
  try {
    return { response: result.response.clone(), attempts: result.attempts }
  } catch {
    // Body sudah terkunci / respons tidak bisa di-clone — pakai apa adanya.
    return result
  }
}

/** Probe read-only di belakang antrean; dipanggil sekali per single-flight. */
async function runSharedProbe(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<{ response: Response; attempts: number }> {
  const queue = nexabotProbeQueueConfig()
  const acquired = await probeGate.acquire(queue.concurrency, queue.maxWaitMs)
  if (!acquired) {
    const label = options.policy?.label ?? NEXABOT_PROXY_POLICY[options.action].label
    // attempts: 0 = tidak ada percobaan ke upstream sama sekali (tertahan antrean).
    // timeout: true → route menjawab 504, dan klien memperlakukannya transient.
    throw new NexabotUpstreamError(
      `NexaBot ${label} gagal — antrean probe penuh (semua slot terpakai)`,
      { attempts: 0, timeout: true },
    )
  }
  try {
    return await runNexabotUpstream(url, init, options)
  } finally {
    probeGate.release()
  }
}

// ═══════════════════════════════════════════════════════════════════
// ANTREAN SUBMIT PER KREDENSIAL (jalur yang membuat job)
// ═══════════════════════════════════════════════════════════════════
/**
 * Dua member menekan "Generate" bersamaan → dua submit menembak AKUN NexaBot
 * yang sama dari IP yang sama → upstream membalas 429 `Rate limit` untuk
 * keduanya, dan generate gagal padahal tidak ada job yang terbentuk. Dengan
 * puluhan member yang berbagi kredensial server (sesi Unlimited + kunci induk)
 * tabrakan ini bukan lagi insiden, tapi keadaan default.
 *
 * Antrean ini memperlakukan akun upstream seperti sumber daya yang punya
 * jumlah slot: submit per kredensial diurutkan, bukan ditabrakkan. Bedanya
 * dengan antrean probe di atas:
 *  - kuncinya PER KREDENSIAL (lane), supaya member yang memakai kunci sendiri
 *    tidak ikut mengantre di belakang akun orang lain;
 *  - hanya menahan SEBELUM request dikirim — begitu upstream menjawab, slot
 *    langsung lepas. Tidak ada retry di dalam slot, jadi tidak mungkin ada
 *    job/kredit ganda (satu slot = satu percobaan submit).
 *
 * Kalau penunggu kehabisan batas sabar, route kita yang menjawab 429 +
 * `Retry-After` (bukan upstream). Tiket pembayaran klien dilepas, jadi klien
 * boleh mengulang dengan tiket yang sama — dan klien sekarang cukup sabar untuk
 * itu (lihat src/lib/nexabotRetry.ts).
 *
 * Yang TIDAK dicakup antrean ini: masa job itu sendiri. Akun Unlimited hanya
 * menjalankan satu job, jadi submit berikutnya harus ditahan sampai job selesai
 * — lihat bagian "JOB YANG SEDANG BERJALAN PER LANE" di bawah.
 *
 * Batasan yang sama seperti antrean probe: per proses/instance. Di PM2 satu
 * instance (kasus produksi sekarang) itu sudah cukup; kalau kelak dipakai
 * lebih dari satu proses, penjadwalan harus pindah ke antrean di database.
 */

export const NEXABOT_SUBMIT_QUEUE = {
  /** Submit yang boleh jalan bersamaan PER kredensial upstream. */
  concurrency: 1,
  /** Batas seorang member menunggu slot sebelum kita jawab "antrian penuh" (ms). */
  maxWaitMs: 45_000,
  /** `Retry-After` (detik) yang kita anjurkan saat antrean penuh. */
  retryAfterSeconds: 10,
}

export interface NexabotSubmitQueueConfig {
  concurrency: number
  maxWaitMs: number
  retryAfterSeconds: number
}

/** Config antrean submit — bisa disetel lewat env tanpa deploy ulang. */
export function nexabotSubmitQueueConfig(env: NodeJS.ProcessEnv = process.env): NexabotSubmitQueueConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    concurrency: Math.max(1, Math.floor(num(env.NEXABOT_SUBMIT_CONCURRENCY, NEXABOT_SUBMIT_QUEUE.concurrency))),
    maxWaitMs: num(env.NEXABOT_SUBMIT_QUEUE_MAX_WAIT_MS, NEXABOT_SUBMIT_QUEUE.maxWaitMs),
    retryAfterSeconds: num(env.NEXABOT_SUBMIT_RETRY_AFTER_S, NEXABOT_SUBMIT_QUEUE.retryAfterSeconds),
  }
}

/** Bentuk kredensial yang dipakai relay (dipetakan dari server tanpa mengimpor tipe server). */
export interface NexabotLaneCredential {
  kind: 'api-key' | 'cookie'
  source: string
  secret: string
}

/**
 * Kunci lane = identitas akun upstream yang dipakai. Nilainya hanya jadi kunci
 * Map di memori proses — tidak pernah di-log maupun dikirim ke klien.
 */
export function nexabotSubmitLaneKey(credential: NexabotLaneCredential | null | undefined): string {
  if (!credential) return 'lane:tanpa-kredensial'
  return `lane:${credential.kind}:${credential.secret}`
}

/** Label aman untuk log: jenis kredensialnya saja, isinya tidak pernah muncul. */
export function nexabotSubmitLaneLabel(credential: NexabotLaneCredential | null | undefined): string {
  if (!credential) return 'tanpa kredensial'
  if (credential.source === 'master') return credential.kind === 'cookie' ? 'sesi server' : 'kunci server'
  if (credential.source === 'client-master') return 'kunci master di browser'
  return credential.kind === 'cookie' ? 'sesi member' : 'kunci member'
}

interface SubmitLane {
  gate: NexabotProbeGate
}

const submitLanes = new Map<string, SubmitLane>()

function laneOf(key: string): SubmitLane {
  const existing = submitLanes.get(key)
  if (existing) return existing
  const created: SubmitLane = { gate: new NexabotProbeGate() }
  submitLanes.set(key, created)
  return created
}

/** Buang lane yang sudah tidak dipakai supaya Map tidak tumbuh tanpa batas. */
function dropLaneIfIdle(key: string): void {
  const lane = submitLanes.get(key)
  if (!lane) return
  const { active, waiting } = lane.gate.stats()
  if (active === 0 && waiting === 0) submitLanes.delete(key)
}

export interface NexabotSubmitSlot {
  /** Lama menunggu slot (ms) — 0 kalau langsung jalan. */
  waitMs: number
  /** Posisi antrean saat meminta slot (0 = tidak mengantre). */
  position: number
  release: () => void
}

/**
 * Minta satu slot submit untuk lane ini. `null` = batas sabar habis; pemanggil
 * wajib menjawab "antrian penuh" dan TIDAK boleh mengirim request ke upstream.
 */
export async function acquireNexabotSubmitSlot(
  laneKey: string,
  config: NexabotSubmitQueueConfig = nexabotSubmitQueueConfig(),
): Promise<NexabotSubmitSlot | null> {
  const lane = laneOf(laneKey)
  const sebelum = lane.gate.stats()
  const posisi = sebelum.active >= config.concurrency ? sebelum.waiting + 1 : 0
  const mulai = Date.now()
  const dapat = await lane.gate.acquire(config.concurrency, config.maxWaitMs)
  if (!dapat) {
    dropLaneIfIdle(laneKey)
    return null
  }
  return {
    waitMs: Date.now() - mulai,
    position: posisi,
    release: () => {
      lane.gate.release()
      dropLaneIfIdle(laneKey)
    },
  }
}

/** Kondisi lane saat ini — untuk test & diagnostik "berapa member yang mengantre". */
export function nexabotSubmitLaneStats(laneKey: string): { active: number; waiting: number } | null {
  const lane = submitLanes.get(laneKey)
  return lane ? lane.gate.stats() : null
}

// ═══════════════════════════════════════════════════════════════════
// JOB YANG SEDANG BERJALAN PER LANE
// ═══════════════════════════════════════════════════════════════════
/**
 * Antrean submit di atas hanya menyerialkan REQUEST submit (±0,3 detik). Itu
 * tidak cukup: akun NexaBot (mode Unlimited) hanya boleh menjalankan SATU job
 * pada satu waktu — submit kedua selama job pertama berjalan dijawab
 * "Generate sedang berjalan. Tunggu selesai sebelum generate lagi (mode
 * unlimited)." Di produksi ini terlihat sebagai member ke-2..10 ditolak
 * upstream lalu klien menyerah setelah ~5 detik.
 *
 * Obatnya bukan mengulang lebih cepat, tapi MENAHAN submit sampai job selesai:
 *  - job dicatat saat submit 2xx membawa `job_id`;
 *  - catatan diperbarui tiap `/job/:id` dipoll (bukti job masih hidup);
 *  - dilepas saat poll melaporkan `done`/`failed`, saat hasil diunduh/disimpan,
 *    atau saat job berhenti dipoll (`idleMs`) / melewati `maxHoldMs`.
 *
 * Selama lane sibuk, route kita sendiri yang menjawab 429 `queued: true` +
 * `Retry-After` tanpa menyentuh upstream: saldo member tidak terpotong dan
 * klien cukup mengulang (lihat src/lib/nexabotRetry.ts).
 */
export const NEXABOT_JOB_LOCK = {
  /** Batas keras umur satu job — jaring pengaman kalau klien hilang total. */
  maxHoldMs: 12 * 60_000,
  /** Job yang tidak dipoll selama ini dianggap selesai (tab ditutup). */
  idleMs: 3 * 60_000,
  /** `Retry-After` bawaan (detik) saat job sedang berjalan dan tidak ada estimasi. */
  busyRetryAfterSeconds: 15,
  /** Batas `Retry-After` saat ada `est_seconds` dari upstream. */
  maxBusyRetryAfterSeconds: 60,
  /** Cooldown setelah upstream menolak karena masih ada job berjalan (ms). */
  upstreamBusyCooldownMs: 20_000,
}

export interface NexabotJobLockConfig {
  maxHoldMs: number
  idleMs: number
  busyRetryAfterSeconds: number
  maxBusyRetryAfterSeconds: number
  upstreamBusyCooldownMs: number
}

/** Config kunci job — bisa disetel lewat env tanpa deploy ulang. */
export function nexabotJobLockConfig(env: NodeJS.ProcessEnv = process.env): NexabotJobLockConfig {
  const num = (raw: string | undefined, fallback: number) => {
    const n = Number(raw)
    return Number.isFinite(n) && n > 0 ? n : fallback
  }
  return {
    maxHoldMs: num(env.NEXABOT_JOB_MAX_HOLD_MS, NEXABOT_JOB_LOCK.maxHoldMs),
    idleMs: num(env.NEXABOT_JOB_IDLE_MS, NEXABOT_JOB_LOCK.idleMs),
    busyRetryAfterSeconds: Math.max(1, Math.floor(num(env.NEXABOT_JOB_BUSY_RETRY_AFTER_S, NEXABOT_JOB_LOCK.busyRetryAfterSeconds))),
    maxBusyRetryAfterSeconds: Math.max(1, Math.floor(num(env.NEXABOT_JOB_MAX_RETRY_AFTER_S, NEXABOT_JOB_LOCK.maxBusyRetryAfterSeconds))),
    upstreamBusyCooldownMs: num(env.NEXABOT_JOB_BUSY_COOLDOWN_MS, NEXABOT_JOB_LOCK.upstreamBusyCooldownMs),
  }
}

/** Aksi yang menjalankan SATU job panjang di akun upstream (submit/generate). */
export function isNexabotJobAction(action: NexabotProxyAction): boolean {
  return action === 'submit' || action === 'generate'
}

interface LaneJob {
  laneKey: string
  jobId: string
  startedAt: number
  lastSeenAt: number
  /** `est_seconds` dari upstream, kalau ada — dipakai menyusun Retry-After. */
  estMs: number | null
}

/** lane → job yang sedang berjalan; jobId → lane untuk pelepasan dari rute poll. */
const laneJobs = new Map<string, LaneJob>()
const jobLanes = new Map<string, string>()
/** lane → waktu (ms) sampai kapan lane tidak boleh ditembak upstream. */
const laneCooldowns = new Map<string, number>()

function lupakanJob(laneKey: string): void {
  const job = laneJobs.get(laneKey)
  if (!job) return
  laneJobs.delete(laneKey)
  if (jobLanes.get(job.jobId) === laneKey) jobLanes.delete(job.jobId)
}

/** Catat bahwa lane ini sekarang menjalankan `jobId`. Job lama (kalau ada) dilepas. */
export function markNexabotJobRunning(
  laneKey: string,
  jobId: string,
  opts: { nowMs?: number; estSeconds?: number | null } = {},
): void {
  if (!jobId) return
  const nowMs = opts.nowMs ?? Date.now()
  lupakanJob(laneKey)
  const est = Number(opts.estSeconds)
  laneJobs.set(laneKey, {
    laneKey,
    jobId,
    startedAt: nowMs,
    lastSeenAt: nowMs,
    estMs: Number.isFinite(est) && est > 0 ? est * 1000 : null,
  })
  jobLanes.set(jobId, laneKey)
  // Cooldown lama tidak relevan lagi: job yang sah sudah tercatat.
  laneCooldowns.delete(laneKey)
}

/** Tandai job masih hidup (dipanggil tiap poll). false = job tidak tercatat. */
export function touchNexabotJob(jobId: string, nowMs: number = Date.now()): boolean {
  const laneKey = jobLanes.get(jobId)
  if (!laneKey) return false
  const job = laneJobs.get(laneKey)
  if (!job) return false
  job.lastSeenAt = nowMs
  return true
}

/** Lepas job dari lane-nya (selesai/gagal/terunduh). Idempoten. */
export function markNexabotJobFinished(jobId: string): boolean {
  const laneKey = jobLanes.get(jobId)
  if (!laneKey) return false
  lupakanJob(laneKey)
  return true
}

/**
 * Lane tidak boleh ditembak selama `ms` — dipakai saat upstream menjawab
 * "Generate sedang berjalan" / "Terlalu banyak permintaan generate" tetapi kita
 * tidak tahu job mana yang menahan (mis. job dari device lain di akun yang sama).
 */
export function markNexabotLaneCooldown(laneKey: string, ms?: number, nowMs: number = Date.now()): void {
  const durasi = ms ?? nexabotJobLockConfig().upstreamBusyCooldownMs
  const sampai = nowMs + Math.max(0, durasi)
  if (sampai > (laneCooldowns.get(laneKey) ?? 0)) laneCooldowns.set(laneKey, sampai)
}

export interface NexabotLaneBusy {
  busy: boolean
  /** `job` = job kita sendiri masih berjalan; `cooldown` = upstream baru menolak. */
  reason: 'job' | 'cooldown' | null
  /** Anjuran menunggu untuk `Retry-After` (detik). */
  retryAfterSeconds: number
  jobId?: string
}

/**
 * Apakah lane sedang tidak boleh menerima submit baru. Job yang sudah kedaluwarsa
 * (tidak dipoll / melewati batas keras) dianggap selesai supaya satu klien yang
 * hilang tidak memblokir semua member selamanya.
 */
export function nexabotLaneBusy(laneKey: string, nowMs: number = Date.now()): NexabotLaneBusy {
  const config = nexabotJobLockConfig()

  const cooldownSampai = laneCooldowns.get(laneKey)
  if (cooldownSampai != null) {
    if (cooldownSampai > nowMs) {
      return {
        busy: true,
        reason: 'cooldown',
        retryAfterSeconds: Math.min(
          config.maxBusyRetryAfterSeconds,
          Math.max(1, Math.ceil((cooldownSampai - nowMs) / 1000)),
        ),
      }
    }
    laneCooldowns.delete(laneKey)
  }

  const job = laneJobs.get(laneKey)
  if (!job) return { busy: false, reason: null, retryAfterSeconds: 0 }

  const umur = nowMs - job.startedAt
  const diam = nowMs - job.lastSeenAt
  if (umur >= config.maxHoldMs || diam >= config.idleMs) {
    lupakanJob(laneKey)
    return { busy: false, reason: null, retryAfterSeconds: 0 }
  }

  const sisa = job.estMs != null ? (job.estMs - umur) / 1000 : NaN
  const retryAfterSeconds = Number.isFinite(sisa)
    ? Math.min(config.maxBusyRetryAfterSeconds, Math.max(1, Math.ceil(sisa)))
    : config.busyRetryAfterSeconds
  return { busy: true, reason: 'job', retryAfterSeconds, jobId: job.jobId }
}

/**
 * Body/jawaban upstream yang berarti "masih ada job berjalan / terlalu sering".
 * Dipakai untuk memasang cooldown singkat sehingga submit berikutnya ditahan
 * relay, bukan ditembakkan lalu ditolak NexaBot lagi.
 */
export function isNexabotUpstreamBusyText(text: string): boolean {
  return /generate sedang berjalan|sudah ada job|masih berjalan|tunggu selesai|terlalu banyak permintaan/i
    .test(text || '')
}

const STATUS_SELESAI = new Set(['done', 'completed', 'completed_with_error', 'success', 'failed', 'error', 'cancelled', 'canceled'])

/** Respons poll job yang menandakan job sudah berhenti (berhasil atau gagal). */
export function isNexabotJobFinishedText(text: string): boolean {
  try {
    const data = JSON.parse(text)
    const status = data?.job?.status ?? data?.status
    return typeof status === 'string' && STATUS_SELESAI.has(status.trim().toLowerCase())
  } catch {
    return false
  }
}

/** Dipakai test: kosongkan seluruh catatan job/cooldown. */
export function resetNexabotLaneJobs(): void {
  laneJobs.clear()
  jobLanes.clear()
  laneCooldowns.clear()
}

/**
 * Penyebab asli kegagalan jaringan, diambil dari `err.cause`.
 *
 * `fetch` (undici) membungkus alasan sebenarnya di `cause` — ECONNRESET,
 * `UND_ERR_SOCKET`, `HeadersTimeoutError`, dan sejenisnya. Tanpa ini pesan yang
 * tersimpan hanya "fetch failed" (itulah yang bikin insiden submit 61 detik di
 * log tidak bisa ditelusuri).
 */
export function nexabotErrorCause(err: any): string {
  const cause = err?.cause
  if (!cause) return ''
  const code = cause.code || cause.errno || ''
  const name = cause.name && cause.name !== 'Error' ? cause.name : ''
  const label = [code, name].filter(Boolean).join(' ')
  const message = String(cause.message || '').trim()
  if (label && message) return `${label}: ${message}`
  return label || message
}

/**
 * Aksi yang bisa MEMBUAT job (kredit terpotong) → respons hilang berarti job
 * mungkin sudah terbentuk, jadi jangan menyarankan "coba lagi" begitu saja.
 */
export function isNexabotNonIdempotentAction(action: NexabotProxyAction): boolean {
  return action === 'submit' || action === 'generate' || action === 'gpt-image'
}

/**
 * Saran aman yang boleh ditampilkan ke user setelah kegagalan.
 *
 * Untuk submit/generate, mengulang tanpa memeriksa lebih dulu bisa membuat job
 * ganda dan kredit 0.15 cr terpotong dua kali — jadi sarannya diperingatkan,
 * bukan "coba lagi".
 */
export function nexabotErrorAdvice(action: NexabotProxyAction): string {
  if (!isNexabotNonIdempotentAction(action)) return 'coba lagi'
  // Biaya per aksi: GPT Image 0,1 cr, sisanya 0,15 cr.
  const biaya = action === 'gpt-image' ? '0,1' : '0,15'
  return `Respons NexaBot hilang — job MUNGKIN sudah terbentuk, jadi cek dulu di nexabot.id/riwayat; ulangi hanya kalau kamu yakin belum ada job, karena kredit ${biaya} cr bisa terpotong dua kali.`
}

/** Error dari percobaan yang semuanya gagal (timeout / koneksi). */
export class NexabotUpstreamError extends Error {
  attempts: number
  lastStatus: number | null
  timeout: boolean

  constructor(message: string, info: { attempts: number; lastStatus?: number | null; timeout?: boolean }) {
    super(message)
    this.name = 'NexabotUpstreamError'
    this.attempts = info.attempts
    this.lastStatus = info.lastStatus ?? null
    this.timeout = !!info.timeout
  }
}

export interface NexabotProxyCallOptions {
  action: NexabotProxyAction
  /** Timpa policy (test). */
  policy?: Partial<NexabotProxyPolicy>
  /** Timpa config retry (test). */
  retry?: Partial<NexabotProxyRetryConfig>
  /** Dipakai test supaya tidak menyentuh jaringan global. */
  fetchImpl?: typeof fetch
  sleep?: (ms: number) => Promise<void>
  random?: () => number
  /** Dipanggil tiap kali menunggu sebelum mencoba lagi (log). */
  onRetry?: (info: { attempt: number; status: number | null; delayMs: number; message: string }) => void
}

const defaultSleep = (ms: number): Promise<void> => new Promise<void>((resolve) => setTimeout(resolve, Math.max(0, ms)))

function isTimeoutError(err: any): boolean {
  return err?.name === 'TimeoutError' || err?.name === 'AbortError'
}

export interface NexabotUpstreamCallResult {
  response: Response
  attempts: number
  /** true kalau respons ini dipakai bersama panggilan identik (single-flight). */
  shared?: boolean
}

/**
 * Panggil upstream NexaBot dengan timeout & retry sesuai `action`.
 *
 * Probe read-only (credit/session/modes) lewat antrean + single-flight dulu
 * (lihat {@link isNexabotShareableProbe}); submit/generate/download langsung
 * dieksekusi karena bisa membuat job & memotong kredit. Submit TIDAK ditahan di
 * sini — penahanannya terjadi satu level di atas ({@link acquireNexabotSubmitSlot}),
 * supaya slot dipegang sampai tiket & responsnya selesai diproses route.
 */
export async function fetchNexabotUpstream(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<NexabotUpstreamCallResult> {
  if (!isNexabotShareableProbe(options.action)) {
    return await runNexabotUpstream(url, init, options)
  }

  const shareKey = nexabotProbeShareKey(url, init, options.action)
  const running = inFlightProbes.get(shareKey)
  if (running) {
    // Panggilan kembar: pakai respons yang sedang dalam perjalanan, jangan
    // tembak upstream lagi (tiap pemanggil dapat salinan body sendiri).
    return { ...cloneProbeResult(await running), shared: true }
  }

  // Response "master" di-clone SEKALI di sini, sebelum pemanggil pertama sempat
  // membaca body-nya. Tiap pemanggil (termasuk yang pertama) menerima salinan,
  // jadi tidak ada yang bisa mengunci body milik pemanggil lain.
  const inflight = (async () => {
    const result = await runSharedProbe(url, init, options)
    return { response: result.response.clone(), attempts: result.attempts }
  })()
  inFlightProbes.set(shareKey, inflight)
  try {
    return cloneProbeResult(await inflight)
  } finally {
    if (inFlightProbes.get(shareKey) === inflight) inFlightProbes.delete(shareKey)
  }
}

/**
 * Eksekusi nyata satu panggilan upstream: timeout & retry sesuai `action`.
 *
 * Transient (timeout, koneksi putus, 429, 5xx) diulang selama percobaan tersisa;
 * kalau percobaan habis, respons terakhir dari upstream DIKEMBALIKAN apa adanya
 * (supaya klien melihat status aslinya, mis. 429 + Retry-After) atau error
 * dilempar kalau kegagalannya bukan HTTP.
 */
async function runNexabotUpstream(
  url: string,
  init: RequestInit,
  options: NexabotProxyCallOptions,
): Promise<{ response: Response; attempts: number }> {
  const base = NEXABOT_PROXY_POLICY[options.action]
  const policy: NexabotProxyPolicy = { ...base, ...options.policy }
  const retryConfig = { ...nexabotProxyRetryConfig(), ...options.retry }
  const doFetch = options.fetchImpl ?? fetch
  const sleep = options.sleep ?? defaultSleep
  const attempts = Math.max(1, Math.floor(policy.attempts))

  let attempt = 0
  let lastError: any = null
  let lastStatus: number | null = null

  for (attempt = 1; attempt <= attempts; attempt++) {
    try {
      const response = await doFetch(url, { ...init, signal: AbortSignal.timeout(policy.timeoutMs) })
      lastStatus = response.status

      if (!isNexabotProxyTransientStatus(response.status)) {
        return { response, attempts: attempt }
      }

      if (attempt < attempts) {
        const delayMs = nexabotProxyDelayMs({
          attempt,
          retryAfterHeader: response.headers.get('retry-after'),
          config: retryConfig,
          random: options.random,
        })
        options.onRetry?.({ attempt, status: response.status, delayMs, message: `upstream HTTP ${response.status}` })
        // Respons yang dibuang harus ditutup supaya koneksi tidak menggantung.
        try { await response.body?.cancel() } catch { /* bukan masalah */ }
        await sleep(delayMs)
        continue
      }

      return { response, attempts: attempt }
    } catch (err: any) {
      lastError = err
      if (attempt < attempts) {
        const delayMs = nexabotProxyDelayMs({ attempt, config: retryConfig, random: options.random })
        options.onRetry?.({
          attempt,
          status: null,
          delayMs,
          message: isTimeoutError(err)
            ? `timeout ${policy.timeoutMs}ms`
            : [err?.message || 'koneksi gagal', nexabotErrorCause(err)].filter(Boolean).join(' — '),
        })
        await sleep(delayMs)
        continue
      }
    }
  }

  const timeout = isTimeoutError(lastError)
  // Kegagalan jaringan menyertakan penyebab aslinya (mis. "fetch failed
  // (ECONNRESET: socket hang up)") supaya bisa ditelusuri tanpa menebak.
  const cause = timeout ? '' : nexabotErrorCause(lastError)
  const detail = timeout
    ? `timeout setelah ${attempts}×${Math.round(policy.timeoutMs / 1000)}s`
    : [(lastError?.message || 'koneksi ke NexaBot gagal'), cause && `(${cause})`].filter(Boolean).join(' ')
  throw new NexabotUpstreamError(
    `NexaBot ${policy.label} gagal — ${detail}`,
    { attempts, lastStatus, timeout },
  )
}
