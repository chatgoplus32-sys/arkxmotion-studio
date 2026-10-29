import { Router, Request, Response } from 'express'
import { authenticateToken, AuthRequest } from '../middleware/auth.js'
import { MAX_UPLOAD_BYTES, resolveMediaType, takeUploadSlot } from '../lib/uploadGuards.js'
import { diskPublicUrl, storeMedia } from '../lib/mediaStorage.js'
import {
  NEXABOT_PROXY_POLICY,
  NexabotUpstreamError,
  acquireNexabotSubmitSlot,
  fetchNexabotUpstream,
  isNexabotJobAction,
  isNexabotJobFinishedText,
  isNexabotNonIdempotentAction,
  isNexabotUpstreamBusyText,
  markNexabotJobFinished,
  markNexabotJobRunning,
  markNexabotLaneCooldown,
  nexabotErrorAdvice,
  nexabotErrorCause,
  nexabotLaneBusy,
  nexabotRelayHeaders,
  nexabotSubmitLaneKey,
  nexabotSubmitLaneLabel,
  nexabotSubmitQueueConfig,
  touchNexabotJob,
  type NexabotProxyAction,
  type NexabotSubmitSlot,
} from '../../shared/nexabotProxy.js'
import {
  serverAccounts,
  serverCredentialEligibility,
  serverSecrets,
  type ServerAccount,
} from '../lib/nexabotAccounts.js'
import {
  consumeChargeTicket,
  isAdminUser,
  releaseChargeTicket,
  reserveChargeTicket,
} from '../lib/nexabotChargeTicket.js'
import { recordUpstreamUsage, userIdFromRequest, type ResolvedCredential } from '../lib/nexabotUpstreamUsage.js'

const router = Router()
// Bisa diarahkan ke host lain: tes menembak upstream tiruan, dan operator bisa
// memakainya untuk staging. Tanpa env, perilakunya sama seperti sebelumnya.
const NEXABOT_BASE = (process.env.NEXABOT_BASE || 'https://nexabot.id').replace(/\/+$/, '')

/** Hasil relay yang dilihat rute: status + body mentah + kredensial terpakai. */
interface RelayHasil {
  status: number
  text: string
  credential: ResolvedCredential | null
  /** true = 429 ini berasal dari antrean kita sendiri, bukan dari NexaBot. */
  antreanPenuh?: boolean
}

/**
 * Satu call upstream ke NexaBot dengan timeout & retry sesuai jenis request
 * (lihat shared/nexabotProxy.ts), lalu teruskan status + body apa adanya ke
 * klien. Read-only (saldo/sesi/job/mode) boleh diulang; submit/generate tidak.
 *
 * Aksi yang MEMBUAT JOB (submit/generate/gpt-image) lebih dulu mengambil satu
 * slot antrean per kredensial. Without that, dua member yang menekan generate
 * bersamaan berarti dua submit ke akun yang sama → upstream membalas 429 untuk
 * keduanya. Slot dipegang hanya selama satu percobaan (tidak ada retry di
 * dalamnya), jadi slot tidak pernah menahan tempat untuk job kedua.
 *
 * Kalau kredensial SERVER ditolak upstream (401/403) dan ada kredensial server
 * lain, request diulang SEKALI dengan kredensial itu. Aman untuk submit: 401/403
 * berarti upstream menolak sebelum job dibuat, jadi tidak ada job/kredit ganda.
 */
async function relayUpstream(
  res: Response,
  action: NexabotProxyAction,
  url: string,
  init: RequestInit,
  opts: {
    /** true = percobaan pertama memakai kredensial milik server. */
    kredensialServer?: boolean
    /** Kredensial percobaan pertama, supaya catatan pemakaian tetap akurat. */
    credential?: ResolvedCredential | null
    /**
     * Kredensial server lain bila yang utama ditolak upstream. `url` hanya
     * dipakai kalau jalur upstream bergantung pada jenis kredensial
     * (/submit: cookie ke /api/v1/generate, kunci ke /api/v1/api).
     */
    cadangan?: { headers: Record<string, string>; credential: ResolvedCredential; url?: string }
    /** Akun pool yang dipakai; job yang lahir dicatat milik akun ini. */
    accountId?: string
  } = {},
): Promise<RelayHasil | null> {
  const { label } = NEXABOT_PROXY_POLICY[action]

  // ── Antrean submit per kredensial (hanya aksi yang membuat job) ──
  let slot: NexabotSubmitSlot | null = null
  // Aksi yang membuat job panjang: selain berebut slot submit, akun upstream-nya
  // hanya boleh menjalankan SATU job. Lane yang masih memegang job ditahan di
  // sini — tanpa ini submit ke-2..10 menembus antrean, ditolak NexaBot, lalu
  // klien menyerah.
  const jobAction = isNexabotJobAction(action)
  const laneKey = nexabotSubmitLaneKey(opts.credential)
  if (isNexabotNonIdempotentAction(action)) {
    if (jobAction) {
      const sibuk = nexabotLaneBusy(laneKey)
      if (sibuk.busy) {
        return jawabLaneSibuk(res, action, nexabotSubmitLaneLabel(opts.credential), sibuk.retryAfterSeconds)
      }
    }
    slot = await acquireNexabotSubmitSlot(laneKey)
    if (!slot) return jawabAntreanPenuh(res, action, nexabotSubmitLaneLabel(opts.credential))
    if (slot.waitMs > 200) {
      console.log(
        `[nexabot-local] ${action}: mengantre ${slot.waitMs}ms (posisi ${slot.position}) di jalur ${nexabotSubmitLaneLabel(opts.credential)}`,
      )
    }
  }

  const kirim = (tambahan?: Record<string, string>, alamat = url) =>
    fetchNexabotUpstream(
      alamat,
      tambahan ? { ...init, headers: { ...tanpaKredensial(init.headers), ...tambahan } } : init,
      {
        action,
        onRetry: ({ attempt, status, delayMs, message }) =>
          console.warn(
            `[nexabot-local] ${action} percobaan ${attempt} gagal (${message}${status ? ` HTTP ${status}` : ''}) — coba lagi dalam ${delayMs}ms`,
          ),
      },
    )
  try {
    // Dicek ULANG setelah dapat slot: dua submit bisa lolos pemeriksaan di atas
    // bersamaan, lalu yang kedua baru jalan setelah yang pertama mencatat job-nya.
    if (jobAction) {
      const sibuk = nexabotLaneBusy(laneKey)
      if (sibuk.busy) {
        return jawabLaneSibuk(res, action, nexabotSubmitLaneLabel(opts.credential), sibuk.retryAfterSeconds)
      }
    }

    let { response, attempts, shared } = await kirim()
    let text = await response.text()
    let credential = opts.credential ?? null

    // Kredensial utama ditolak → coba kredensial server lainnya sebelum
    // menyimpulkan admin salah konfigurasi. Kunci yang kedaluwarsa/salah tempel
    // tidak lagi mematikan jalur generate selama sesi cookie masih sah.
    if ((response.status === 401 || response.status === 403) && opts.cadangan) {
      const jenis = opts.cadangan.credential.kind === 'cookie' ? 'sesi cookie server' : 'kunci server'
      console.warn(
        `[nexabot-local] ${action}: kredensial server ditolak (HTTP ${response.status}) — ulangi dengan ${jenis} cadangan`,
      )
      const ulang = await kirim(opts.cadangan.headers, opts.cadangan.url || url)
      response = ulang.response
      attempts = ulang.attempts
      shared = ulang.shared
      text = await response.text()
      credential = opts.cadangan.credential
    }

    // Job baru yang sah MENGUNCI lane sampai selesai (akun Unlimited hanya
    // boleh satu job). Kalau upstream justru menolak karena masih ada job lain
    // berjalan — mis. dari device lain di akun yang sama — pasang cooldown
    // supaya submit berikutnya ditahan relay, tidak ditembak lalu ditolak lagi.
    if (jobAction) {
      const laneAkhir = nexabotSubmitLaneKey(credential)
      const jobBaru = jobIdDari(text)
      if (upstreamMembuatJob(response.status, text) && jobBaru) {
        markNexabotJobRunning(laneAkhir, jobBaru, { estSeconds: estSecondsDari(text) })
        console.log(
          `[nexabot-local] ${action}: job ${jobBaru.slice(0, 16)} memegang jalur ${nexabotSubmitLaneLabel(credential)}`,
        )
      } else if (isNexabotUpstreamBusyText(text)) {
        markNexabotLaneCooldown(laneAkhir)
        console.warn(
          `[nexabot-local] ${action}: upstream masih mengerjakan job lain — jalur ${nexabotSubmitLaneLabel(credential)} cooldown`,
        )
      }
    }

    // Id job berlaku per akun upstream: poll/unduh/simpan nanti harus memakai
    // akun yang membuatnya, bukan akun pertama di daftar.
    if (opts.accountId) {
      const jobBaru = jobIdDari(text)
      if (jobBaru && upstreamMembuatJob(response.status, text)) ingatAkunJob(jobBaru, opts.accountId)
    }

    const sharedNote = shared ? ' (single-flight: respons dipakai bersama)' : ''
    console.log(`[nexabot-local] ${action} ${response.status}${attempts > 1 ? ` (percobaan ke-${attempts})` : ''}${sharedNote}: ${text.slice(0, 300)}`)
    // Kredensial server yang ditolak upstream bukan salah member: pesan upstream
    // ("API key tidak valid") membuat mereka mengira kunci pribadinya yang salah.
    const ditolakKredensialServer =
      !!opts.kredensialServer && (response.status === 401 || response.status === 403)
    if (ditolakKredensialServer) {
      console.error(
        `[nexabot-local] kredensial server ditolak upstream (HTTP ${response.status}) — ` +
        'periksa Kunci Server / Sesi Unlimited di panel admin',
      )
    }
    res.writeHead(response.status, {
      'Content-Type': 'application/json',
      'Access-Control-Allow-Origin': '*',
      // Teruskan Retry-After upstream supaya klien menunggu sesuai anjuran mereka.
      ...nexabotRelayHeaders(response),
    })
    res.end(ditolakKredensialServer
      ? JSON.stringify({
          ok: false,
          // Hanya rute yang memotong saldo yang boleh menjanjikan refund.
          error:
            'Akses NexaBot milik server ditolak penyedia (bukan kredensial Anda). ' +
            (action === 'submit' || action === 'gpt-image'
              ? 'Saldo yang terpotong dikembalikan otomatis — hubungi admin.'
              : 'Coba lagi nanti; bila berulang, hubungi admin.'),
        })
      : text)
    // Dikembalikan supaya rute yang mengonsumsi kuota bisa mencatat biaya
    // upstream-nya tanpa membaca body untuk kedua kalinya.
    return { status: response.status, text, credential }
  } catch (err: any) {
    const upstream = err instanceof NexabotUpstreamError ? err : null
    // `cause` = alasan asli dari undici (ECONNRESET, UND_ERR_SOCKET, dst) yang
    // tanpa ini hilang menjadi cuma "fetch failed".
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] ${label} error:`, err?.message, cause ? `(cause: ${cause})` : '')
    if (res.headersSent) {
      gagalSetelahHeader(res)
      return null
    }
    res.status(upstream?.timeout ? 504 : 502).json({
      ok: false,
      error: upstream
        ? `${upstream.message} — ${nexabotErrorAdvice(action)}`
        : `${err?.message || `Gagal ${label}`}${cause ? ` (${cause})` : ''}`,
    })
  } finally {
    // Slot selalu dilepas, termasuk saat jalur error — kalau tidak, satu
    // koneksi yang putus menahan seluruh antrian member berikutnya selamanya.
    slot?.release()
  }
  return null
}

/**
 * Respons gagal untuk jalur yang sudah mulai mengirim body (unduhan streaming).
 * Begitu header terkirim, status & body tidak bisa diganti lagi — memanggil
 * res.status().json() di sini melempar ERR_HTTP_HEADERS_SENT dan menyisakan
 * klien dengan unduhan yang tak pernah selesai. Putuskan koneksinya saja supaya
 * klien melihat transfer gagal, bukan file terpotong yang tampak berhasil.
 */
function gagalSetelahHeader(res: Response): void {
  if (!res.writableEnded) res.destroy()
}

/**
 * Antrean submit penuh: KITA yang menjawab 429, bukan NexaBot.
 *
 * Bedanya penting: upstream tidak pernah melihat request ini, jadi tidak ada job
 * dan tidak ada kredit yang terpotong. `Retry-After` dipasang supaya klien
 * menunggu sesuai anjuran kita alih-alih membacot, dan pemanggil melepas tiket
 * pembayarannya (429 = "ditolak sebelum job") sehingga member cukup menekan
 * ulang tanpa harus memotong saldo sekali lagi.
 */
function jawabAntreanPenuh(res: Response, action: NexabotProxyAction, laneLabel: string): RelayHasil {
  const { retryAfterSeconds, concurrency } = nexabotSubmitQueueConfig()
  const body = JSON.stringify({
    ok: false,
    queued: true,
    retry_after_seconds: retryAfterSeconds,
    error:
      `Antrian generate NexaBot sedang penuh (${laneLabel}: ${concurrency} permintaan diproses bergantian). ` +
      `Coba lagi dalam ${retryAfterSeconds} detik — saldo Anda belum terpotong untuk percobaan ini.`,
  })
  console.warn(`[nexabot-local] ${action}: antrean penuh (${laneLabel}) — jawab 429 tanpa mengirim ke upstream`)
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Retry-After': String(retryAfterSeconds),
  })
  res.end(body)
  return { status: 429, text: body, credential: null, antreanPenuh: true }
}

/**
 * Lane masih menjalankan job: KITA yang menjawab 429 sebelum menyentuh upstream.
 *
 * `queued: true` membuat klien mengulang dengan sabar (bukan menyerah), dan
 * `Retry-After` disusun dari `est_seconds` job yang sedang berjalan supaya
 * member berikutnya tidak membombardir relay tiap detik.
 */
function jawabLaneSibuk(
  res: Response,
  action: NexabotProxyAction,
  laneLabel: string,
  retryAfterSeconds: number,
): RelayHasil {
  const detik = Math.max(1, Math.round(retryAfterSeconds))
  const body = JSON.stringify({
    ok: false,
    queued: true,
    retry_after_seconds: detik,
    error:
      `NexaBot (${laneLabel}) masih mengerjakan generate sebelumnya — akun hanya bisa satu job pada satu waktu. ` +
      `Permintaan Anda dicoba lagi otomatis dalam ${detik} detik; saldo belum terpotong untuk percobaan ini.`,
  })
  console.warn(`[nexabot-local] ${action}: lane sibuk (${laneLabel}) — jawab 429 antrean, upstream tidak disentuh`)
  res.writeHead(429, {
    'Content-Type': 'application/json',
    'Access-Control-Allow-Origin': '*',
    'Retry-After': String(detik),
  })
  res.end(body)
  return { status: 429, text: body, credential: null, antreanPenuh: true }
}

/** Buang header kredensial sebelum menempelkan kredensial server lain. */
function tanpaKredensial(headers: unknown): Record<string, string> {
  const out: Record<string, string> = {}
  for (const [k, v] of Object.entries((headers || {}) as Record<string, string>)) {
    if (/^(x-api-key|cookie|origin|referer)$/i.test(k)) continue
    out[k] = v
  }
  return out
}

// Mode session: request ditandai dengan cookie login nexabot.id (dikirim klien
// sebagai header X-Nexabot-Cookie karena browser melarang set header `Cookie`).
function sessionHeaders(cookies: string): Record<string, string> {
  return {
    'Cookie': cookies,
    'Origin': NEXABOT_BASE,
    'Referer': `${NEXABOT_BASE}/`,
  }
}

interface ResolvedUpstreamAuth {
  headers: Record<string, string>
  credential: ResolvedCredential | null
  /** Pesan untuk klien kalau tidak ada kredensial yang bisa dipakai. */
  error?: string
  /** Kredensial server lain, dicoba kalau yang utama ditolak upstream. */
  cadangan?: { headers: Record<string, string>; credential: ResolvedCredential }
  /** Akun pool yang dipakai (untuk mengingat akun asal sebuah job). */
  accountId?: string
  /** true = semua akun server sedang dipakai; route menjawab 429 antrean. */
  antrean?: boolean
  /**
   * Kredensial server yang DIKIRIM klien (bukan hasil suntikan relay). Dipakai
   * hanya untuk pencatatan: laporan admin perlu tetap melihat bahwa kunci ini
   * masih beredar di browser, walau lane-nya dipilih dari pool.
   */
  kredensialKlien?: ResolvedCredential
}

/** Boleh tidaknya member ini memakai kredensial server (kunci atau sesi). */
function bolehPakaiKredensialServer(req: Request): { ok: boolean; reason: string } {
  const userId = userIdFromRequest(req)
  if (!userId) {
    return {
      ok: false,
      reason:
        'Kunci NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>). ' +
        'Tanpa itu, pakai kunci NexaBot Anda sendiri lewat header X-Api-Key.',
    }
  }
  return serverCredentialEligibility(userId)
}

/** Boleh tidaknya member ini memakai kunci induk untuk rute BACA. */
function bolehBacaDenganKunciInduk(req: Request): { ok: boolean; reason: string } {
  const userId = userIdFromRequest(req)
  if (!userId) {
    return {
      ok: false,
      reason:
        'Kunci NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>). ' +
        'Tanpa itu, pakai kunci NexaBot Anda sendiri lewat header X-Api-Key.',
    }
  }
  // Rute baca tidak memakai kredit, dan menolaknya bisa memutus polling job yang
  // SUDAH berjalan sah — misalnya paket member habis di tengah job. Karena itu
  // yang diwajibkan di sini hanya identitas, bukan kelayakan.
  return { ok: true, reason: 'Rute baca: hanya butuh identitas' }
}

/** Kredensial utama sebuah akun: sesi cookie dulu (Unlimited dihormati), kunci sebagai cadangan. */
function kredensialAkun(akun: ServerAccount): ResolvedCredential | null {
  if (akun.cookie) return { kind: 'cookie', source: 'master', secret: akun.cookie }
  if (akun.apiKey) return { kind: 'api-key', source: 'master', secret: akun.apiKey }
  return null
}

function headersUntuk(kredensial: ResolvedCredential): Record<string, string> {
  return kredensial.kind === 'cookie' ? sessionHeaders(kredensial.secret) : { 'x-api-key': kredensial.secret }
}

/** Kredensial server yang disuntikkan relay — klien tidak pernah melihat nilainya. */
function authDariAkun(akun: ServerAccount): ResolvedUpstreamAuth {
  const utama = kredensialAkun(akun)
  if (!utama) {
    return { headers: {}, credential: null, error: 'Akun server NexaBot tidak punya kunci atau sesi' }
  }
  const lain: ResolvedCredential | null =
    utama.kind === 'cookie' && akun.apiKey
      ? { kind: 'api-key', source: 'master', secret: akun.apiKey }
      : utama.kind === 'api-key' && akun.cookie
        ? { kind: 'cookie', source: 'master', secret: akun.cookie }
        : null
  return {
    headers: headersUntuk(utama),
    credential: utama,
    accountId: akun.id,
    cadangan: lain ? { headers: headersUntuk(lain), credential: lain } : undefined,
  }
}

// ── Job → akun asal ───────────────────────────────────────────────
// Id job NexaBot hanya berlaku di akun yang membuatnya. Tanpa ingatan ini,
// member yang job-nya berjalan di akun kedua akan dipoll memakai akun pertama
// dan dianggap "job tidak ditemukan". Peta ini proses-wide dan sengaja terbatas.
const BATAS_INGATAN_JOB = 500
const akunJob = new Map<string, string>()

function ingatAkunJob(jobId: string, accountId: string) {
  if (akunJob.size >= BATAS_INGATAN_JOB) {
    const tertua = akunJob.keys().next().value
    if (tertua) akunJob.delete(tertua)
  }
  akunJob.set(jobId, accountId)
}

function lupakanAkunJob(jobId: string) {
  akunJob.delete(jobId)
}

// ── Reservasi lane saat submit ────────────────────────────────────
// Lane baru terkunci SETELAH upstream menjawab, karena id job belum diketahui
// sebelumnya. Tanpa reservasi, dua submit yang datang hampir bersamaan sama-sama
// melihat semua lane kosong, memilih akun yang sama, dan yang kedua ditahan 429
// padahal akun lain menganggur. Reservasi menutup jeda itu: akun yang sudah
// dipilih dianggap sibuk oleh submit lain sampai relay selesai — atau sampai
// kedaluwarsa kalau proses mati di tengah jalan.
const RESERVASI_MS = 90_000
const reservasiLane = new Map<string, number>()

function laneDireservasi(accountId: string): boolean {
  const sampai = reservasiLane.get(accountId)
  if (sampai == null) return false
  if (sampai <= Date.now()) {
    reservasiLane.delete(accountId)
    return false
  }
  return true
}

function reservasiAkun(accountId: string) {
  reservasiLane.set(accountId, Date.now() + RESERVASI_MS)
}

/** Lepas reservasi milik request ini. Aman dipanggil walau tidak pernah memasang. */
function lepasReservasi(accountId?: string | null) {
  if (accountId) reservasiLane.delete(accountId)
}

/**
 * Pilih akun server untuk satu request.
 *
 * Rute baca memakai akun yang membuat job (bila masih diingat), kalau tidak akun
 * pertama. Rute yang MEMBUAT job memilih akun yang lane-nya kosong — inilah yang
 * membuat beberapa akun benar-benar berjalan paralel. Kalau semuanya sibuk, akun
 * dengan sisa antrean terpendek yang dipakai; relay lalu menjawab 429 antrean
 * dari lane akun itu. `null` hanya untuk submit saat SEMUA akun sedang direservasi
 * submit lain yang belum dapat id job — tidak ada akun yang aman ditembak.
 */
function pilihAkunServer(
  daftar: ServerAccount[],
  opts: { membuatJob?: boolean; jobId?: string },
): ServerAccount | null {
  if (opts.jobId) {
    const pemilik = akunJob.get(opts.jobId)
    if (pemilik) {
      const ketemu = daftar.find((a) => a.id === pemilik)
      if (ketemu) return ketemu
    }
  }

  // Akun bersesi cookie didahulukan: paket Unlimited hanya dihormati di jalur
  // web, jadi generate tidak memotong kredit upstream operator.
  const urut = [...daftar].sort((a, b) => Number(!!b.cookie) - Number(!!a.cookie))
  if (!opts.membuatJob) return urut[0] ?? null

  let cadangan: ServerAccount | null = null
  let sisaTerpendek = Number.POSITIVE_INFINITY
  let adaYangBebasReservasi = false
  for (const akun of urut) {
    const kredensial = kredensialAkun(akun)
    if (!kredensial) continue
    if (laneDireservasi(akun.id)) continue
    adaYangBebasReservasi = true
    const sibuk = nexabotLaneBusy(nexabotSubmitLaneKey(kredensial))
    if (!sibuk.busy) {
      if (akun !== urut[0]) {
        console.log(`[nexabot-local] akun "${akun.label}" kosong — dipakai untuk submit berikutnya`)
      }
      reservasiAkun(akun.id)
      return akun
    }
    if (sibuk.retryAfterSeconds < sisaTerpendek) {
      sisaTerpendek = sibuk.retryAfterSeconds
      cadangan = akun
    }
  }
  if (!cadangan && !adaYangBebasReservasi) {
    console.warn('[nexabot-local] semua akun server sedang dipesan submit lain — jawab antrean')
    return null
  }
  const akun = cadangan ?? urut[0]
  console.warn(
    `[nexabot-local] semua ${daftar.length} akun server sibuk — submit ditahan di "${akun.label}" (±${sisaTerpendek}s)`,
  )
  return akun
}

/**
 * Satu tempat resolusi kredensial ke upstream. Urutannya:
 *   1. cookie sesi dari klien (jalur Unlimited — tidak pernah digantikan);
 *   2. kunci yang dikirim klien;
 *   3. akun server, kalau membernya berhak — akun yang lane-nya kosong untuk
 *      submit, akun pembuat job untuk rute baca.
 *
 * Kunci induk yang MASIH dikirim klien tidak diperlakukan sebagai kunci pribadi:
 * artinya kunci itu beredar di browser, jadi ia tetap harus lolos kebijakan yang
 * sama, dan sidik jarinya dicatat sebagai 'client-master' — jejak kunci yang
 * perlu dihabiskan, bukan kunci yang dianggap aman.
 */
function resolveUpstreamAuth(
  req: Request,
  opts: { bacaSaja?: boolean; membuatJob?: boolean; jobId?: string } = {},
): ResolvedUpstreamAuth {
  const rahasiaServer = serverSecrets()

  const cookieMentah = req.headers['x-nexabot-cookie']
  if (typeof cookieMentah === 'string' && cookieMentah.trim()) {
    const cookies = cookieMentah.trim()
    // Cookie yang ternyata sesi milik server (ditempel di halaman Providers atau
    // dibagikan admin) bukan kredensial pribadi member: saat MEMBUAT job lanenya
    // dipilih dari pool supaya tidak berebut satu akun. Rute baca tidak memakai
    // kredit, jadi kredensial klien dipakai apa adanya — menolaknya akan memutus
    // cek saldo dan poll job yang sudah berjalan.
    if (!rahasiaServer.has(cookies)) {
      return {
        headers: sessionHeaders(cookies),
        credential: { kind: 'cookie', source: 'own-cookie', secret: cookies },
      }
    }
    const izin = opts.bacaSaja ? bolehBacaDenganKunciInduk(req) : bolehPakaiKredensialServer(req)
    if (!izin.ok) return { headers: {}, credential: null, error: izin.reason }
    if (opts.membuatJob) return authDariPool(req, opts)
    return authJobAffinity(opts.jobId) ?? {
      headers: sessionHeaders(cookies),
      credential: { kind: 'cookie', source: 'master', secret: cookies },
    }
  }

  const kunciKlien = req.headers['x-api-key']
  if (typeof kunciKlien === 'string' && kunciKlien.trim()) {
    const kunci = kunciKlien.trim()
    if (rahasiaServer.has(kunci)) {
      // Kunci server yang masih beredar di browser: saat MEMBUAT job lanenya
      // dipilih dari pool, bukan dipaku ke akun yang namanya disebut klien. Jejak
      // "kunci ini masih di browser" tetap dicatat lewat `kredensialKlien`.
      const izin = opts.bacaSaja ? bolehBacaDenganKunciInduk(req) : bolehPakaiKredensialServer(req)
      if (!izin.ok) return { headers: {}, credential: null, error: izin.reason }
      if (opts.membuatJob) {
        const hasil = authDariPool(req, opts)
        return hasil.credential
          ? { ...hasil, kredensialKlien: { kind: 'api-key', source: 'client-master', secret: kunci } }
          : hasil
      }
      // Rute baca: job yang dibuat akun pool lain dipoll lewat akun pembuatnya,
      // selain itu pakai kunci yang dikirim klien (cek saldo harus membaca akun
      // yang kuncinya memang dia pegang).
      return authJobAffinity(opts.jobId) ?? {
        headers: { 'x-api-key': kunci },
        credential: { kind: 'api-key', source: 'client-master', secret: kunci },
      }
    }
    return { headers: { 'x-api-key': kunci }, credential: { kind: 'api-key', source: 'own-key', secret: kunci } }
  }

  return authDariPool(req, opts)
}

/**
 * Kredensial akun yang MEMBUAT sebuah job.
 *
 * Id job NexaBot hanya berlaku di akun pembuatnya, jadi poll/unduh untuk job yang
 * lahir di akun pool kedua harus tetap memakai akun itu — `null` kalau job tidak
 * diingat (relay restart) atau tidak ada id job.
 */
function authJobAffinity(jobId?: string): ResolvedUpstreamAuth | null {
  if (!jobId) return null
  const akunId = akunJob.get(jobId)
  if (!akunId) return null
  const akun = serverAccounts().find((a) => a.id === akunId)
  if (!akun) return null
  const auth = authDariAkun(akun)
  return auth.credential ? auth : null
}

/**
 * Kredensial dari pool akun server untuk satu request.
 *
 * Satu pintu untuk jalur tanpa kredensial klien DAN jalur kredensial server yang
 * dikirim klien: keduanya memakai akun milik operator yang sama, jadi lane-nya
 * dipilih dengan aturan yang sama (kosong dulu, afinitas job untuk rute baca).
 */
function authDariPool(
  req: Request,
  opts: { bacaSaja?: boolean; membuatJob?: boolean; jobId?: string },
): ResolvedUpstreamAuth {
  const daftar = serverAccounts()
  if (daftar.length === 0) {
    return { headers: {}, credential: null, error: 'Missing X-Api-Key header' }
  }
  const izin = opts.bacaSaja ? bolehBacaDenganKunciInduk(req) : bolehPakaiKredensialServer(req)
  if (!izin.ok) return { headers: {}, credential: null, error: izin.reason }

  const akun = pilihAkunServer(daftar, opts)
  // Semua akun sudah dipesan submit lain yang belum dapat id job: tidak ada
  // akun yang aman ditembak. Route menjawab 429 antrean (bukan 400) supaya
  // klien mengulang dengan sabar.
  if (!akun) {
    return {
      headers: {},
      credential: null,
      antrean: true,
      error: 'Semua akun NexaBot server sedang dipakai generate lain — permintaan diulang otomatis sebentar lagi',
    }
  }
  return authDariAkun(akun)
}


/**
 * Penegakan pembayaran untuk jalur kredensial SERVER.
 *
 * Kredensial sendiri (kunci/cookie milik member) tidak butuh tiket: uang yang
 * dipakai bukan milik operator. Yang butuh bukti bayar hanya saat relay
 * menyuntikkan kunci/sesi induk, karena di situlah biaya upstream operator bisa
 * dipakai berkali-kali tanpa potongan lokal.
 *
 * Admin dikecualikan: merekalah pemilik kredensial itu, dan klien memang tidak
 * memotong saldo admin.
 */
interface TiketHasil {
  ok: boolean
  /** Tiket yang harus dihanguskan/dilepas setelah respons upstream. */
  usageId?: number | null
  /** Status HTTP untuk penolakan (hanya saat `ok: false`). */
  status?: number
  reason?: string
}

function tiketServer(req: Request, auth: ResolvedUpstreamAuth, route: 'submit' | 'gpt-image'): TiketHasil {
  const sumber = auth.credential?.source
  if (sumber !== 'master' && sumber !== 'client-master') return { ok: true, usageId: null }

  const userId = userIdFromRequest(req)
  if (!userId) {
    return {
      ok: false,
      status: 401,
      reason: 'Kredensial NexaBot milik server hanya untuk member yang login (Authorization: Bearer <token app>).',
    }
  }
  if (isAdminUser(userId)) return { ok: true, usageId: null }

  const header = req.headers['x-nexabot-charge']
  const mentah = Array.isArray(header) ? header[0] : header
  const cek = reserveChargeTicket(userId, mentah, route)
  if (!cek.ok) return { ok: false, status: 402, reason: cek.reason || 'Pembayaran generate ini belum terverifikasi.' }
  return { ok: true, usageId: cek.usageId ?? null }
}

/** Upstream menerima dan (setidaknya secara eksplisit) tidak menolak job. */
function upstreamMembuatJob(status: number, bodyText: string): boolean {
  if (status < 200 || status >= 300) return false
  try {
    const data = JSON.parse(bodyText)
    return data?.ok !== false
  } catch {
    // Body tidak terbaca: jangan hanguskan tiket, tapi juga jangan anggap job ada.
    return false
  }
}

/** Id job dari respons upstream (`job_id` untuk submit, `id` untuk gpt-image). */
function jobIdDari(bodyText: string): string | null {
  try {
    const data = JSON.parse(bodyText)
    const id = data?.job_id ?? data?.id ?? data?.task_id
    return id == null ? null : String(id).slice(0, 200)
  } catch {
    return null
  }
}

/** Estimasi durasi job dari upstream (`est_seconds`) — dipakai menyusun `Retry-After`. */
function estSecondsDari(bodyText: string): number | null {
  try {
    const data = JSON.parse(bodyText)
    const est = Number(data?.est_seconds ?? data?.job?.est_seconds)
    return Number.isFinite(est) && est > 0 ? est : null
  } catch {
    return null
  }
}

/**
 * Status yang PASTI ditolak sebelum job dibuat → tiket dilepas supaya klien boleh
 * mengulang dengan tiket yang sama (mis. 429). 5xx/timeout sengaja TIDAK di
 * sini: job bisa saja sudah terbentuk, dan tiket yang lepas membuka job ganda.
 */
function upstreamMenolakSebelumJob(status: number, bodyText: string): boolean {
  if ([400, 401, 402, 403, 404, 409, 422, 429].includes(status)) return true
  return status === 503 && /coba lagi dalam/i.test(bodyText)
}

/** Catat hasil relay pada tiket: hanguskan kalau job dibuat, lepas kalau ditolak. */
function selesaikanTiket(usageId: number, status: number, bodyText: string): void {
  if (upstreamMembuatJob(status, bodyText)) consumeChargeTicket(usageId, jobIdDari(bodyText))
  else if (upstreamMenolakSebelumJob(status, bodyText)) releaseChargeTicket(usageId)
}

// Alias query → path: /api/public/nexabot?action=session (juga credit,
// generate, job&id=…, download&id=…) dipetakan ke route path-based di bawah.
// Fallback untuk host/rewrite yang memangkas path (mis. Vercel).
router.use((req: Request, _res: Response, next) => {
  const action = req.query.action as string | undefined
  if (!action || req.path !== '/') return next()
  const id = req.query.id as string | undefined
  if ((action === 'job' || action === 'download' || action === 'gpt-image') && id) req.url = `/${action}/${id}`
  else req.url = `/${action}`
  next()
})

// ── Health check ──
router.get('/health', (_req: Request, res: Response) => {
  res.json({ ok: true, provider: 'nexabot', timestamp: new Date().toISOString() })
})

// ── Credit check ──
router.get('/credit', async (req: Request, res: Response) => {
  // Rute baca: menolaknya karena saldo kosong justru memutus satu-satunya cara
  // member tahu saldonya habis (dan apakah kuncinya masih sah).
  const auth = resolveUpstreamAuth(req, { bacaSaja: true })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/api/credit`)
  // /credit sering menggantung di sisi NexaBot — timeout 25s × 3 percobaan
  // dengan backoff jauh lebih jarang berakhir 504 daripada sekali 20s.
  await relayUpstream(res, 'credit', `${NEXABOT_BASE}/api/v1/api/credit`, {
    method: 'GET',
    headers: {
      ...auth.headers,
      'Accept': 'application/json',
    },
  }, { kredensialServer: auth.credential?.source === 'master', credential: auth.credential, cadangan: auth.cadangan })
})

// ── Session info (mode cookie) ──
// Probe status sesi & paket Unlimited lewat endpoint web /api/v1/credits.
router.get('/session', async (req: Request, res: Response) => {
  const cookies = req.headers['x-nexabot-cookie'] as string
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Nexabot-Cookie header' })
  }

  console.log(`[nexabot-local] GET /api/v1/credits (session probe)`)
  await relayUpstream(res, 'session', `${NEXABOT_BASE}/api/v1/credits`, {
    method: 'GET',
    headers: {
      ...sessionHeaders(cookies),
      'Accept': 'application/json',
    },
  })
})

// ── Submit job ──
router.post('/submit', async (req: Request, res: Response) => {
  const auth = resolveUpstreamAuth(req, { membuatJob: true })
  if (auth.antrean) {
    return res.status(429).json({
      ok: false,
      queued: true,
      retry_after_seconds: 30,
      error: auth.error,
    })
  }
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }
  const tiket = tiketServer(req, auth, 'submit')
  if (!tiket.ok) {
    lepasReservasi(auth.accountId)
    return res.status(tiket.status ?? 402).json({ ok: false, error: tiket.reason })
  }

  const body = req.body
  // Kredensial cookie (milik klien atau sesi server) harus lewat jalur web
  // /api/v1/generate supaya paket Unlimited dihormati; endpoint API selalu
  // menagih 0.15 cr/request.
  const pakaiSesi = auth.credential?.kind === 'cookie'
  const upstreamPath = pakaiSesi ? '/api/v1/generate' : '/api/v1/api'
  console.log(`[nexabot-local] POST ${upstreamPath} (mode: ${body.mode}${pakaiSesi ? ', sesi cookie' : ''})`)

  const upstreamBody: Record<string, any> = {
    mode: body.mode,
    prompt: body.prompt,
  }
  if (body.ratio !== undefined) upstreamBody.ratio = body.ratio
  if (body.aspect !== undefined) upstreamBody.aspect = body.aspect
  if (body.voice) upstreamBody.voice = body.voice
  if (body.media) upstreamBody.media = body.media
  // Resolusi video 720|1080 (mode video; lihat /api/v1/modes).
  if (body.resolution !== undefined) upstreamBody.resolution = body.resolution
  // telegram_id = "user id for credit billing" (docs NexaBot) — menentukan
  // akun mana yang ditagih 0.15 cr/request.
  if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

  // Sengaja TANPA retry: kalau responsnya hilang, job bisa saja sudah terbentuk
  // dan kredit 0.15 sudah terpotong.
  const hasil = await relayUpstream(res, 'submit', `${NEXABOT_BASE}${upstreamPath}`, {
    method: 'POST',
    headers: {
      ...auth.headers,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  }, {
    kredensialServer: auth.credential?.source === 'master',
    credential: auth.credential,
    accountId: auth.accountId,
    // Kredensial cadangan bisa berjenis berbeda, dan jenis itulah yang menentukan
    // jalur upstream: kunci ke /api/v1/api (selalu menagih), cookie ke
    // /api/v1/generate (Unlimited dihormati). Tanpa ini kunci akan dikirim ke
    // jalur web yang tidak mengenalnya.
    cadangan: auth.cadangan && {
      ...auth.cadangan,
      url: auth.cadangan.credential.kind === 'cookie'
        ? `${NEXABOT_BASE}/api/v1/generate`
        : `${NEXABOT_BASE}/api/v1/api`,
    },
  })
  // Lane sudah dikunci job (kalau job terbentuk) atau upstream menolak — dua-duanya
  // berarti reservasi pemilihan akun sudah tidak diperlukan.
  lepasReservasi(auth.accountId)
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil) {
    if (tiket.usageId) selesaikanTiket(tiket.usageId, hasil.status, hasil.text)
    // 429 dari antrean kita sendiri bukan pemakaian upstream: mencatatnya akan
    // membuat laporan operator tampak seperti NexaBot yang menolak.
    if (!hasil.antreanPenuh) recordUpstreamUsage({
      req,
      // Mengikuti kredensial yang BENAR-BENAR dipakai: kalau cookie ditolak lalu
      // kunci cadangan yang berhasil, job itu tercatat di /api/v1/api — bukan di
      // jalur sesi yang gagal.
      route: hasil.credential?.kind === 'cookie' ? 'generate' : 'submit',
      statusCode: hasil.status,
      bodyText: hasil.text,
      // Kunci server yang dikirim browser tetap dicatat sebagai 'client-master'
      // walau lane-nya akun pool lain: laporan admin yang menjawab "kunci ini masih
      // beredar di browser". Kalau cadangan yang dipakai, pencatatan ikut cadangan.
      credential:
        auth.kredensialKlien && hasil.credential === auth.credential
          ? auth.kredensialKlien
          : hasil.credential,
    })
  }
})

// ── Submit job (mode session / cookie) ──
// Jalur web nexabot.id: POST /api/v1/generate dengan cookie login. Kalau akun
// punya paket Unlimited, generate tidak dipotong kredit (beda dengan API key).
router.post('/generate', async (req: Request, res: Response) => {
  const cookies = req.headers['x-nexabot-cookie'] as string
  if (!cookies) {
    return res.status(400).json({ ok: false, error: 'Missing X-Nexabot-Cookie header' })
  }

  const body = req.body
  console.log(`[nexabot-local] POST /api/v1/generate (session, mode: ${body.mode})`)

  const upstreamBody: Record<string, any> = {
    mode: body.mode,
    prompt: body.prompt,
  }
  if (body.ratio !== undefined) upstreamBody.ratio = body.ratio
  if (body.aspect !== undefined) upstreamBody.aspect = body.aspect
  if (body.voice) upstreamBody.voice = body.voice
  if (body.media) upstreamBody.media = body.media
  // Resolusi video 720|1080 (mode video; lihat /api/v1/modes).
  if (body.resolution !== undefined) upstreamBody.resolution = body.resolution
  if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

  // Tanpa retry, sama alasannya dengan /submit: hindari job & kredit ganda.
  // `credential` dibutuhkan supaya antrean submit memegang jalur cookie milik
  // member ini sendiri — bukan jalur member lain.
  const hasil = await relayUpstream(res, 'generate', `${NEXABOT_BASE}/api/v1/generate`, {
    method: 'POST',
    headers: {
      ...sessionHeaders(cookies),
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  }, { credential: { kind: 'cookie', source: 'own-cookie', secret: cookies } })
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil && !hasil.antreanPenuh) {
    recordUpstreamUsage({
      req,
      route: 'generate',
      statusCode: hasil.status,
      bodyText: hasil.text,
      credential: { kind: 'cookie', source: 'own-cookie', secret: cookies },
    })
  }
})


// ── GPT Image 2.5 (jalur web nexabot.id/gpt-image) ──
// Kontrak upstream (diverifikasi langsung dengan kredensial valid):
//   POST {prompt, aspect, references} → {ok, id} — tanpa prompt: 400, tanpa job;
//   GET  /:id → {ok, job:{status, progress, phase, images[], error}}.
// Auth-nya menerima x-api-key, cookie, dan Bearer (tanpa → 401), jadi rute ini
// memakai resolusi kredensial penuh seperti /submit, bukan session-only.
router.post('/gpt-image', async (req: Request, res: Response) => {
  const auth = resolveUpstreamAuth(req, { membuatJob: true })
  if (auth.antrean) {
    return res.status(429).json({
      ok: false,
      queued: true,
      retry_after_seconds: 30,
      error: auth.error,
    })
  }
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }
  const tiket = tiketServer(req, auth, 'gpt-image')
  if (!tiket.ok) {
    lepasReservasi(auth.accountId)
    return res.status(tiket.status ?? 402).json({ ok: false, error: tiket.reason })
  }

  const body = req.body
  console.log(`[nexabot-local] POST /api/v1/gpt-image (aspect: ${body.aspect ?? '-'}, refs: ${Array.isArray(body.references) ? body.references.length : 0})`)

  const upstreamBody: Record<string, any> = {
    prompt: body.prompt,
    // Enum angka milik nexabot.id: 1 = 1:1, 2 = 16:9, 5 = 9:16. Default 2
    // mengikuti halaman web-nya (tombol 16:9 yang terpilih bawaan).
    aspect: body.aspect ?? 2,
    references: Array.isArray(body.references) ? body.references.slice(0, 10) : [],
  }
  if (body.telegram_id) upstreamBody.telegram_id = body.telegram_id

  // Tanpa retry, sama alasannya dengan /submit: job & kredit 0,1 tidak boleh ganda.
  const hasil = await relayUpstream(res, 'gpt-image', `${NEXABOT_BASE}/api/v1/gpt-image`, {
    method: 'POST',
    headers: {
      ...auth.headers,
      'Content-Type': 'application/json',
      'Accept': 'application/json',
    },
    body: JSON.stringify(upstreamBody),
  }, { kredensialServer: auth.credential?.source === 'master', credential: auth.credential, accountId: auth.accountId, cadangan: auth.cadangan })
  // Lane sudah dikunci job (kalau job terbentuk) atau upstream menolak — reservasi
  // pemilihan akun tidak diperlukan lagi.
  lepasReservasi(auth.accountId)
  // Dicatat setelah respons upstream diterima: rute inilah yang memakai kuota.
  if (hasil) {
    if (tiket.usageId) selesaikanTiket(tiket.usageId, hasil.status, hasil.text)
    if (!hasil.antreanPenuh) recordUpstreamUsage({
      req,
      route: 'gpt-image',
      statusCode: hasil.status,
      bodyText: hasil.text,
      credential:
        auth.kredensialKlien && hasil.credential === auth.credential
          ? auth.kredensialKlien
          : hasil.credential,
    })
  }
})

// ── Poll status GPT Image (read-only) ──
// Sama dengan /job/:id tapi ke endpoint gpt-image; memakai aksi 'job' supaya
// kebijakan retry-nya identik (2×, 25s — klien punya backoff sendiri).
router.get('/gpt-image/:id', async (req: Request, res: Response) => {
  const jobId = String(req.params.id || '')
  const auth = resolveUpstreamAuth(req, { bacaSaja: true, jobId })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  const idPath = encodeURIComponent(String(jobId))
  console.log(`[nexabot-local] GET /api/v1/gpt-image/${idPath}`)
  const hasil = await relayUpstream(res, 'job', `${NEXABOT_BASE}/api/v1/gpt-image/${idPath}`, {
    method: 'GET',
    headers: {
      ...auth.headers,
      'Accept': 'application/json',
    },
  }, { kredensialServer: auth.credential?.source === 'master', credential: auth.credential, cadangan: auth.cadangan })
  // Job gambar yang sudah selesai/hilang tidak perlu diingat akun asalnya.
  if (hasil && (hasil.status === 404 || (hasil.status >= 200 && hasil.status < 300 && isNexabotJobFinishedText(hasil.text)))) {
    lupakanAkunJob(jobId)
  }
})

// ── Download hasil GPT Image (menyuntikkan kredensial) ──
// Uji nyata membuktikan images[].url berupa path RELATIF di origin nexabot.id
// yang MENGHARUSKAN auth (tanpa kredensial -> 401). Tag <img> galeri tidak bisa
// mengirim header, jadi lib klien mengalihkan URL hasil ke rute ini.
router.get('/gpt-image/:id/download', async (req: Request, res: Response) => {
  const jobId = String(req.params.id || '')
  const auth = resolveUpstreamAuth(req, { bacaSaja: true, jobId })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  const idPath = encodeURIComponent(String(jobId))
  const index = typeof req.query.index === 'string' && req.query.index ? encodeURIComponent(req.query.index) : '0'
  const wantAttachment = req.query.download !== undefined

  try {
    console.log(`[nexabot-local] GET /api/v1/gpt-image/${idPath}/download?index=${index}`)
    const { response: upstreamRes } = await fetchNexabotUpstream(
      `${NEXABOT_BASE}/api/v1/gpt-image/${idPath}/download?index=${index}`,
      {
        method: 'GET',
        headers: { ...auth.headers, 'Accept': 'image/*, application/json' },
        redirect: 'follow',
      },
      { action: 'download' },
    )

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '')
      console.log(`[nexabot-local] gpt-image download ${upstreamRes.status}: ${errText.slice(0, 200)}`)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ ok: false, error: `Download gagal: HTTP ${upstreamRes.status}` }))
      return
    }

    const contentType = upstreamRes.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const text = await upstreamRes.text()
      console.log(`[nexabot-local] gpt-image download json: ${text.slice(0, 300)}`)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    const headers: Record<string, string> = {
      'Content-Type': contentType || 'image/png',
      'Access-Control-Allow-Origin': '*',
    }
    // Inline untuk <img>; ?download=1 mengikuti konvensi halaman web nexabot.id.
    if (wantAttachment) headers['Content-Disposition'] = `attachment; filename="nexabot-gpt-image-${idPath}.png"`
    const len = upstreamRes.headers.get('content-length')
    if (len) headers['Content-Length'] = len

    res.writeHead(200, headers)
    const reader = upstreamRes.body?.getReader()
    if (reader) {
      while (!res.destroyed && !res.writableEnded) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err: any) {
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] gpt-image download error:`, err.message, cause ? `(cause: ${cause})` : '')
    if (res.headersSent) {
      gagalSetelahHeader(res)
      return
    }
    const upstream = err instanceof NexabotUpstreamError ? err : null
    res.status(upstream?.timeout ? 504 : 502).json({
      ok: false,
      error: upstream ? `${upstream.message} — ${nexabotErrorAdvice('download')}` : err.message,
    })
  }
})

// ── Poll job status ──
router.get('/job/:id', async (req: Request, res: Response) => {
  const jobId = String(req.params.id || '')
  const auth = resolveUpstreamAuth(req, { bacaSaja: true, jobId })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}`)
  // Poll status bersifat read-only → aman diulang; satu hiccup gateway tidak
  // lagi terlihat oleh klien sebagai "job hilang".
  const hasil = await relayUpstream(res, 'job', `${NEXABOT_BASE}/api/v1/jobs/${jobId}`, {
    method: 'GET',
    headers: {
      ...auth.headers,
      'Accept': 'application/json',
    },
  }, { kredensialServer: auth.credential?.source === 'master', credential: auth.credential, cadangan: auth.cadangan })

  // Kunci lane hanya selama job hidup. Poll yang melaporkan selesai/gagal
  // melepasnya supaya member berikutnya langsung boleh submit.
  if (!hasil) return
  if (hasil.status === 404) {
    if (markNexabotJobFinished(jobId)) console.log(`[nexabot-local] job ${jobId} hilang (404) — kunci lane dilepas`)
    lupakanAkunJob(jobId)
    return
  }
  if (hasil.status >= 200 && hasil.status < 300) {
    if (isNexabotJobFinishedText(hasil.text)) {
      if (markNexabotJobFinished(jobId)) console.log(`[nexabot-local] job ${jobId} selesai — kunci lane dilepas`)
      lupakanAkunJob(jobId)
    } else {
      touchNexabotJob(jobId)
    }
  }
})

// ── Download result ──
router.get('/download/:id', async (req: Request, res: Response) => {
  const jobId = String(req.params.id || '')
  const auth = resolveUpstreamAuth(req, { bacaSaja: true, jobId })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }

  try {
    console.log(`[nexabot-local] GET /api/v1/jobs/${jobId}/download`)
    const { response: upstreamRes } = await fetchNexabotUpstream(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
      method: 'GET',
      headers: { ...auth.headers, 'Accept': 'application/json' },
      redirect: 'follow',
    }, { action: 'download' })

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '')
      console.log(`[nexabot-local] download ${upstreamRes.status}: ${errText.slice(0, 200)}`)
      if (upstreamRes.status === 404 && markNexabotJobFinished(jobId)) {
        console.log(`[nexabot-local] job ${jobId} tidak ada (404) — kunci lane dilepas`)
      }
      lupakanAkunJob(jobId)
      res.writeHead(upstreamRes.status, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(JSON.stringify({ ok: false, error: `Download gagal: HTTP ${upstreamRes.status}` }))
      return
    }

    // Hasil bisa diunduh = job sudah pasti berhenti menahan akun upstream.
    if (markNexabotJobFinished(jobId)) console.log(`[nexabot-local] unduhan ${jobId} sukses — kunci lane dilepas`)
    lupakanAkunJob(jobId)

    // Check if response is JSON (error) or binary (file)
    const contentType = upstreamRes.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const text = await upstreamRes.text()
      console.log(`[nexabot-local] download json: ${text.slice(0, 300)}`)
      res.writeHead(200, {
        'Content-Type': 'application/json',
        'Access-Control-Allow-Origin': '*',
      })
      res.end(text)
      return
    }

    // Stream binary response
    const finalUrl = upstreamRes.url || `${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`
    console.log(`[nexabot-local] download redirect final: ${finalUrl}`)

    res.writeHead(200, {
      'Content-Type': contentType || 'video/mp4',
      'Access-Control-Allow-Origin': '*',
      'Content-Disposition': `attachment; filename="nexabot-${jobId}.mp4"`,
    })

    const reader = upstreamRes.body?.getReader()
    if (reader) {
      while (!res.destroyed && !res.writableEnded) {
        const { done, value } = await reader.read()
        if (done) break
        res.write(value)
      }
    }
    res.end()
  } catch (err: any) {
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] download error:`, err.message, cause ? `(cause: ${cause})` : '')
    if (res.headersSent) {
      gagalSetelahHeader(res)
      return
    }
    const upstream = err instanceof NexabotUpstreamError ? err : null
    res.status(upstream?.timeout ? 504 : 502).json({
      ok: false,
      error: upstream ? `${upstream.message} — ${nexabotErrorAdvice('download')}` : err.message,
    })
  }
})


// ── Simpan hasil permanen (sisi server) ──
/**
 * Unduh hasil job LANGSUNG di server lalu simpan ke R2/disk, balas URL permanen.
 *
 * Kenapa bukan lewat browser: dulu klien mengunduh seluruh file ke browser
 * (blob:) lalu mengunggahnya kembali ke /r2-upload. Dua kali lintas koneksi
 * member — untuk WAV/video besar ini yang bikin tahap "simpan ke CDN" makan
 * menit-menitan. Di sini file cuma sekali lewat: NexaBot → VPS → storage.
 */
router.post('/save/:id', authenticateToken, async (req: AuthRequest, res: Response) => {
  const jobId = String(req.params.id || '')
  const auth = resolveUpstreamAuth(req, { bacaSaja: true, jobId })
  const userId = req.user?.id
  if (!userId) {
    return res.status(401).json({ ok: false, error: 'Login dulu untuk menyimpan hasil.' })
  }
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key / X-Nexabot-Cookie header' })
  }
  if (!jobId) {
    return res.status(400).json({ ok: false, error: 'Missing job id' })
  }
  if (!takeUploadSlot(userId)) {
    return res.status(429).json({ ok: false, error: 'Terlalu banyak penyimpanan — coba lagi beberapa menit lagi' })
  }

  try {
    console.log(`[nexabot-local] POST save ${jobId} → unduh & simpan di server`)
    const { response: upstreamRes } = await fetchNexabotUpstream(`${NEXABOT_BASE}/api/v1/jobs/${jobId}/download`, {
      method: 'GET',
      headers: { ...auth.headers, 'Accept': '*/*' },
      redirect: 'follow',
    }, { action: 'download' })

    if (!upstreamRes.ok) {
      const errText = await upstreamRes.text().catch(() => '')
      if (upstreamRes.status === 404 && markNexabotJobFinished(jobId)) {
        console.log(`[nexabot-local] job ${jobId} tidak ada (404) — kunci lane dilepas`)
      }
      lupakanAkunJob(jobId)
      return res.status(upstreamRes.status === 404 ? 404 : 502).json({
        ok: false,
        error: `NexaBot menolak unduhan: HTTP ${upstreamRes.status} ${errText.slice(0, 200)}`,
      })
    }

    const contentType = upstreamRes.headers.get('content-type') || ''
    if (contentType.includes('application/json')) {
      const errText = await upstreamRes.text().catch(() => '')
      return res.status(502).json({ ok: false, error: `NexaBot tidak mengirim file: ${errText.slice(0, 200)}` })
    }

    const { mimeType, ext } = resolveMediaType(contentType, String(req.body?.filename || ''))
    if (!upstreamRes.body) throw new Error('NexaBot tidak mengirim data')

    const reader = upstreamRes.body.getReader()
    const chunks: Buffer[] = []
    let total = 0
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      total += value.byteLength
      if (total > MAX_UPLOAD_BYTES) {
        await reader.cancel().catch(() => {})
        return res.status(413).json({ ok: false, error: 'Hasil terlalu besar untuk disimpan (maks 200 MB)' })
      }
      chunks.push(Buffer.from(value))
    }
    if (total === 0) return res.status(502).json({ ok: false, error: 'Hasil kosong' })

    const stored = await storeMedia(Buffer.concat(chunks), { ext, mimeType })
    const url = stored.cdnUrl || diskPublicUrl(req, stored.key)
    if (markNexabotJobFinished(jobId)) console.log(`[nexabot-local] simpan ${jobId} sukses — kunci lane dilepas`)
    lupakanAkunJob(jobId)
    console.log(`[nexabot-local] save ${jobId} → ${stored.storage} ${(total / 1024 / 1024).toFixed(1)} MB`)
    return res.status(200).json({ ok: true, url, key: stored.key, storage: stored.storage, bytes: total })
  } catch (err: any) {
    const cause = nexabotErrorCause(err)
    console.error(`[nexabot-local] save error:`, err.message, cause ? `(cause: ${cause})` : '')
    if (res.headersSent) return gagalSetelahHeader(res)
    return res.status(502).json({ ok: false, error: err.message || 'Simpan hasil gagal' })
  }
})

// ── Daftar mode/model yang tersedia ─────────────────────────────────────
router.get('/modes', async (req: Request, res: Response) => {
  const auth = resolveUpstreamAuth(req, { bacaSaja: true })
  if (Object.keys(auth.headers).length === 0) {
    return res.status(400).json({ ok: false, error: auth.error || 'Missing X-Api-Key header' })
  }

  console.log(`[nexabot-local] GET /api/v1/modes`)
  await relayUpstream(res, 'modes', `${NEXABOT_BASE}/api/v1/modes`, {
    method: 'GET',
    headers: {
      ...auth.headers,
      'Accept': 'application/json',
    },
  }, { kredensialServer: auth.credential?.source === 'master', credential: auth.credential, cadangan: auth.cadangan })
})

export default router
