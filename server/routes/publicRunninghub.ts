import { Router } from 'express'
import type { Request, Response } from 'express'
import { createHash, randomUUID } from 'node:crypto'

const router = Router()

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'

// ── Akses token RunningHub ─────────────────────────────────────────────────
// RunningHub kini mengautentikasi panggilan OpenAPI dengan access token (JWT)
// hasil login, bukan API key lama. Token dibaca dari env
// RUNNINGHUB_ACCESS_TOKEN (isi di .env — berkas itu di-ignore git) dan dipakai
// sebagai credential default untuk SEMUA request upstream; token tidak pernah
// dikirim ke browser.
//
//   • Env kosong / tidak diisi → mode lama: pakai key yang dikirim tiap user
//   • Diisi token baru         → mengganti token aktif (mis. sesudah rotate)
const RUNNINGHUB_SERVER_MANAGED_KEY = 'server-managed'
const RUNNINGHUB_DEFAULT_WORKFLOW_ID = '2092795737699856386'
const RUNNINGHUB_ULTRA_HD_WORKFLOW_ID = '2102004799470764034'
// MC Ultra Fast HD — node ID resmi dari dokumentasi workflow:
// node 30 = image (LoadImage), node 33 = video (LoadVideo)
const ULTRA_HD_IMAGE_NODE = '30'
const ULTRA_HD_VIDEO_NODE = '33'

// Kling Motion Control v2.6 Motion Transfer (app RunningHub):
// node 3 = image (foto karakter), node 5 = file (video referensi gerakan).
// https://www.runninghub.ai/id/ai-detail/2054013205567033345
const RUNNINGHUB_KLING_MC_WORKFLOW_ID = '2054013205567033345'
const KLING_MC_IMAGE_NODE = '3'
const KLING_MC_VIDEO_NODE = '5'
const KLING_MC_VIDEO_FIELD = 'file'

// MC ULTRA HD — AI Motion Transfer PRO+ (app RunningHub 2101654299003973634):
// node 30 = image (foto karakter), node 33 = video (video referensi gerakan).
// Struktur node-nya sama dengan Ultra Fast HD, tapi app-nya berbeda (SAM3 person
// tracking + multi-person), jadi app id-nya tetap dipisah.
const RUNNINGHUB_ULTRA_HD_PRO_WORKFLOW_ID = '2101654299003973634'
const ULTRA_HD_PRO_IMAGE_NODE = '30'
const ULTRA_HD_PRO_VIDEO_NODE = '33'
const ULTRA_HD_PRO_VIDEO_FIELD = 'video'

// Motion Control Pro — Motion Transfer V3 (app RunningHub): node 30 = image,
// node 33 = video. Output maksimum 15 detik — UI memangkas video referensi.
const RUNNINGHUB_MC_PRO_APP_ID = '2103523610144309249'
const MC_PRO_IMAGE_NODE = '30'
const MC_PRO_VIDEO_NODE = '33'
const MC_PRO_VIDEO_FIELD = 'video'

// Eposcents MC (motion control 512HD 32FPS, maks 50 detik): node 68 = image,
// node 2 = video. Video referensi >30 detik dipakai instance Plus.
const RUNNINGHUB_EPOSCENTS_MC_APP_ID = '2107144516724932610'
const EPOSCENTS_MC_IMAGE_NODE = '68'
const EPOSCENTS_MC_VIDEO_NODE = '2'
const EPOSCENTS_MC_VIDEO_FIELD = 'video'

// KONTROL GERAK 50 FPS (app RunningHub): transfer gerakan dari video referensi
// ke gambar karakter dengan output 50 FPS. Benchmark app: video 24s ~17 menit.
// node 30 = image, node 33 = video. Tidak ada input prompt/resolusi/fps manual.
// https://www.runninghub.ai/id/ai-detail/2112893346377531393
const RUNNINGHUB_KONTROL_GERAKAN_APP_ID = '2112893346377531393'
const KONTROL_GERAKAN_IMAGE_NODE = '30'
const KONTROL_GERAKAN_VIDEO_NODE = '33'
const KONTROL_GERAKAN_VIDEO_FIELD = 'video'
// MOTION CONTROL 72 FPS — transfer gerakan ke 72 FPS, app RunningHub
// 2114353645982978049. Skema node sama seperti app motion control 50 FPS:
// node 30 = image (foto karakter), node 33 = video (video referensi gerakan),
// tanpa prompt/extra node. Rata-rata run ±902 detik (sukses 90%).
// https://www.runninghub.ai/id/ai-detail/2114353645982978049
const RUNNINGHUB_72FPS_APP_ID = '2114353645982978049'
const MOTION_72FPS_IMAGE_NODE = '30'
const MOTION_72FPS_VIDEO_NODE = '33'
const MOTION_72FPS_VIDEO_FIELD = 'video'

// Virtual Try-On FLUX2-Klein (app RunningHub): transfer pakaian tubuh atas
// dengan wajah/pose/latar tetap. Urutan input sesuai contoh resmi:
// node 23 = image (Gambar Orang), node "LoadImage.0" = image (Gambar Pakaian).
// https://www.runninghub.ai/id/ai-detail/2102388260877221889
const RUNNINGHUB_TRYON_FLUX2_APP_ID = '2102388260877221889'
const TRYON_FLUX2_PERSON_NODE = '23'
const TRYON_FLUX2_GARMENT_NODE = 'LoadImage.0'
const TRYON_FLUX2_IMAGE_FIELD = 'image'

// Tabel app RunningHub berbasis workflow dengan dua input (gambar + video
// referensi). Model baru cukup ditambah satu entri di sini: `action` dipakai UI
// sebagai nama aksi, `appId` app RunningHub-nya, `imageNode`/`videoNode` node yang
// menerima berkasnya, dan `videoField` nama field node video (app Kling 2.6
// menamainya 'file', app ultra-hd menamainya 'video').
interface MotionAppConfig {
  appId: string
  imageNode: string
  videoNode: string
  videoField: string
  label: string
  // Kalau durasi video referensi (detik, dikirim client sebagai `durationHint`)
  // melewati nilai ini, request dipakai `instanceType: 'plus'` (VRAM lebih besar
  // untuk video panjang, mis. >30 detik butuh Plus di app Eposcents MC).
  plusAboveSec?: number
  // Parameter node tetap milik app (resolusi, fps, frame limit, dsb).
  extraNodes?: Array<{ nodeId: string; fieldName: string; fieldValue: string }>
  // Node teks yang menerima prompt. Kalau diisi, prompt langsung dikirim ke node
  // ini dan auto-discovery prompt dilewati.
  promptNode?: { nodeId: string; fieldName: string; defaultText?: string }
}

const MOTION_APPS: Record<string, MotionAppConfig> = {
  'motion-control-kling-2.6': {
    appId: RUNNINGHUB_KLING_MC_WORKFLOW_ID,
    imageNode: KLING_MC_IMAGE_NODE,
    videoNode: KLING_MC_VIDEO_NODE,
    videoField: KLING_MC_VIDEO_FIELD,
    label: 'kling-mc',
  },
  // MC ULTRA HD — AI Motion Transfer PRO+ (SAM3 person tracking, multi-person)
  'motion-control-ultra-hd-pro': {
    appId: RUNNINGHUB_ULTRA_HD_PRO_WORKFLOW_ID,
    imageNode: ULTRA_HD_PRO_IMAGE_NODE,
    videoNode: ULTRA_HD_PRO_VIDEO_NODE,
    videoField: ULTRA_HD_PRO_VIDEO_FIELD,
    label: 'ultra-hd-pro',
  },
  // Motion Control Pro — Motion Transfer V3 (app RunningHub): gerakan mulus &
  // sinematik dari gambar referensi + video gerakan, output maksimum 15 detik.
  // node 30 = image (foto karakter), node 33 = video (video referensi gerakan).
  // https://www.runninghub.ai/id/ai-detail/2103523610144309249
  'motion-control-pro': {
    appId: RUNNINGHUB_MC_PRO_APP_ID,
    imageNode: MC_PRO_IMAGE_NODE,
    videoNode: MC_PRO_VIDEO_NODE,
    videoField: MC_PRO_VIDEO_FIELD,
    label: 'mc-pro',
  },
  // Eposcents MC (eposcents studio by Vanixen) — motion control 512HD 32FPS,
  // output maksimum 50 detik, tanpa watermark. Video referensi >30 detik butuh
  // instance Plus (diarahkan otomatis dari `durationHint`).
  // node 68 = image (foto karakter), node 2 = video (video referensi gerakan).
  // https://www.runninghub.ai/id/ai-detail/2107144516724932610
  'motion-control-eposcents': {
    appId: RUNNINGHUB_EPOSCENTS_MC_APP_ID,
    imageNode: EPOSCENTS_MC_IMAGE_NODE,
    videoNode: EPOSCENTS_MC_VIDEO_NODE,
    videoField: EPOSCENTS_MC_VIDEO_FIELD,
    label: 'eposcents-mc',
    // plusAboveSec sengaja TIDAK dipakai: tes menunjukkan instance 'plus' membuat
    // app ini gagal startup (805, node RuntimeError) — semua durasi pakai 'default'.
  },
  // KONTROL GERAK 50 FPS — transfer gerakan video referensi ke gambar karakter,
  // output 50 FPS, benchmark 24 detik selesai ~17 menit di instance default.
  // App hanya menerima node image (30) + video (33), tanpa prompt/extra nodes.
  // https://www.runninghub.ai/id/ai-detail/2112893346377531393
  'motion-control-kontrol-gerakan': {
    appId: RUNNINGHUB_KONTROL_GERAKAN_APP_ID,
    imageNode: KONTROL_GERAKAN_IMAGE_NODE,
    videoNode: KONTROL_GERAKAN_VIDEO_NODE,
    videoField: KONTROL_GERAKAN_VIDEO_FIELD,
    label: 'kontrol-gerakan-50fps',
  },
  // MOTION CONTROL 72 FPS — output 72 FPS dari gambar + video referensi gerakan.
  // App tidak punya node prompt: gambar dan video saja (node 30 & 33).
  'motion-control-72fps': {
    appId: RUNNINGHUB_72FPS_APP_ID,
    imageNode: MOTION_72FPS_IMAGE_NODE,
    videoNode: MOTION_72FPS_VIDEO_NODE,
    videoField: MOTION_72FPS_VIDEO_FIELD,
    label: 'mc-72fps',
  },
}
// Virtual Try-On & Ekstraksi Pakaian: node 13 = foto orang, node 53 = pakaian
const RUNNINGHUB_TRYON_WORKFLOW_ID = '2099800742046818306'
const RUNNINGHUB_TRYON_PERSON_NODE = '13'
const RUNNINGHUB_TRYON_GARMENT_NODE = '53'
// MiniMax H3 Music Avatar (app 2111522730906955778): 1 foto + audio lagu →
// video avatar menyanyi dengan segmen tanpa batas + video panjang.
// node 306 = image, node 317 = audio, node 214 = text (prompt acting).
// https://www.runninghub.ai/id/ai-detail/2111522730906955778
const RUNNINGHUB_H3_MUSIC_AVATAR_APP_ID = '2111522730906955778'
const H3_MUSIC_AVATAR_IMAGE_NODE = '306'
const H3_MUSIC_AVATAR_AUDIO_NODE = '317'
const H3_MUSIC_AVATAR_PROMPT_NODE = '214'
// MiniMax H3 Realistic VLOG (app 2112457853784121345): 1 gambar + prompt
// VLOG terstruktur → video VLOG realistis 15 detik.
// node 137 = image, node 138 = text (prompt).
// https://www.runninghub.ai/id/ai-detail/2112457853784121345
const RUNNINGHUB_H3_VLOG_APP_ID = '2112457853784121345'
const H3_VLOG_IMAGE_NODE = '137'
const H3_VLOG_PROMPT_NODE = '138'
// AI Song Cover Studio (app RunningHub 2104229552179425282):
// node 1 = audio (lagu asli), node 4 = prompt (gaya/arrangement cover),
// node 5 = prompt (lirik).
// https://www.runninghub.ai/ai-detail/2104229552179425282
const RUNNINGHUB_SONG_COVER_WORKFLOW_ID = '2104229552179425282'
const SONG_COVER_AUDIO_NODE = '1'
const SONG_COVER_STYLE_NODE = '4'
const SONG_COVER_LYRICS_NODE = '5'
// PETTAPUNYA — YuE2 Indonesian Song Reimaginer (app 2102484425270693890):
// audio referensi → durasi + struktur melodi, lalu restyle/reimagine dengan
// style & lirik baru. node 20 = audio, node 81 = style, node 83 = lirik
// (style dan lirik sama-sama field `positive`).
// https://www.runninghub.ai/id/ai-detail/2102484425270693890
const RUNNINGHUB_YUE2_REIMAGINER_APP_ID = '2102484425270693890'
const YUE2_AUDIO_NODE = '20'
const YUE2_STYLE_NODE = '81'
const YUE2_LYRICS_NODE = '83'
// VOSR2 Video Upscale 2K: node 1 = video + frame_load_cap,
// node 21 = cfg/scheduler/steps, node 13 = save_output
const RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID = '2100537736599035906'
// AI Photo Enhancer: node 642 = image, node 688 = scale_by
const RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID = '2100619334354759681'
const RUNNINGHUB_TRAVEL_PHOTO_WORKFLOW_ID = '2097726202999336962'
const TRAVEL_PHOTO_MASTER_PROMPT = `Anda adalah asisten yang khusus membuat prompt untuk model QWEN-IMAGE. Tugas: berdasarkan gambar yang diunggah pengguna, gunakan orang pada gambar sebagai karakter utama dan buat adegan perjalanan karakter tersebut di [lokasi]. Sesuaikan suasana dengan waktu lokal dan kondisi cuaca yang relevan. Buat karakter utama sedang berkunjung dan menyatu secara alami dengan lokasi tersebut. Hasilkan [jumlah] prompt terstruktur yang siap digunakan langsung pada QWEN-IMAGE. Setiap prompt wajib menjelaskan ekspresi karakter, pose, sudut kamera, lingkungan, suasana, pencahayaan, dan gaya. Jika pengguna tidak menentukan gaya, gunakan gaya foto realistis, kualitas film CCD, dan hindari kesan AI. Buat setiap hasil berbeda secara jelas dan hindari komposisi yang berulang, namun tetap konsisten dengan ide pengguna.

ATURAN PEMBUATAN PROMPT
Buat [jumlah] prompt yang tidak berulang dengan pedoman berikut.

Kamera dan sudut pandang:
- Gunakan lensa ultra-wide atau efek fisheye dengan kesan setara full-frame sekitar 12-18 mm.
- Sudut kamera harus berbeda jelas dari foto asli. Variasikan sudut ekstrem seperti pandangan dari bawah ke atas, dari atas ke bawah, kamera sangat rendah dekat tanah, high angle, atau komposisi Dutch angle.
- Hasil akhir harus terlihat seperti foto fashion atau street photography yang berani dan sepenuhnya realistis.

Bagian tubuh dekat kamera:
- Pada setiap gambar pilih 1-2 bagian tubuh utama yang sangat dekat dengan kamera.
- Variasikan bagian tubuh tersebut di setiap gambar agar tidak selalu sama.

Pose dan tubuh:
- Buat pose kuat, keren, dinamis, dan sesuai dengan sudut ekstrem.
- Variasikan pose: berdiri, jongkok, duduk, berbaring, condong ke depan, memutar badan, atau pose dinamis lain.

Sudut kamera dan karakter:
- Variasikan arah kamera: ke atas, ke bawah, menyamping, atau miring.
- Karakter harus terlihat keren, santai, percaya diri, dengan nuansa fashion editorial atau street style.

Pencahayaan dan rendering:
- Pertahankan bayangan realistis serta kontak tubuh dengan tanah/lantai.
- Gunakan detail tajam beresolusi tinggi sehingga tekstur kulit, kain, dan pantulan material terlihat alami.

ATURAN KETAT:
- Jangan mengganti karakter dengan orang lain.
- Jangan mengubah jenis pakaian.
- Jangan memindahkan adegan keluar dari area [lokasi].
- Jangan menambahkan teks, logo, watermark, atau elemen desain grafis.
- Jangan mengubah hasil menjadi lukisan, ilustrasi, atau anime; wajib foto-realistis.

FORMAT OUTPUT:
Setiap prompt wajib diawali dengan kalimat: "Pertahankan ciri wajah karakter agar tidak berubah". Susun isi dengan urutan: karakter, ekspresi, pakaian, pose, sudut pengambilan gambar, komposisi, latar lingkungan, kondisi cahaya, dan parameter kamera. Panjang setiap prompt sekitar 200 kata.

Kembalikan hanya [jumlah] prompt. Setiap prompt berdiri sebagai satu paragraf tanpa penjelasan tambahan.`
// FLUX.1 Kontext image edit: node 28 = image, node 31 = text
const RUNNINGHUB_IMAGE_EDIT_WORKFLOW_ID = '1928844216607129602'
// MiniMax H3 I2V: node 181 = text, node 143 = image,
// node 126 = steps, node 146 = aspect_ratio
const RUNNINGHUB_H3_I2V_WORKFLOW_ID = '2099854999999340546'
// UGC Storyboard (MiniMax H3 I2V — gambar ke video multi-scene + audio):
// node 114/162 = karakter utama, node 170/167/165/166 = scene 1-4,
// node 135 = durasi (detik), node 115 = aspect_ratio, node 136 = prompt
// https://www.runninghub.ai/id/ai-detail/2096092981395841025
const RUNNINGHUB_UGC_WORKFLOW_ID = '2096092981395841025'
const UGC_ASPECTS = new Set([
  '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
  '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
])
const UGC_SCENE_NODES = ['170', '167', '165', '166']
// Seedance 2.0 Replica (gambar + prompt storyboard → video):
// node 168 = image, node 136 = text (storyboard), node 115 = aspect_ratio.
// https://www.runninghub.ai/id/ai-detail/2104455137652932609
const RUNNINGHUB_SEEDANCE2_WORKFLOW_ID = '2104455137652932609'
const SEEDANCE2_IMAGE_NODE = '168'
const SEEDANCE2_TEXT_NODE = '136'
const SEEDANCE2_ASPECT_NODE = '115'
const SEEDANCE2_ASPECTS = new Set([
  '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
  '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
])
const SEEDANCE2_ASPECT_FALLBACK = '16:9 (Widescreen)'
// Seedance 2.6 Replica (multi karakter + prompt storyboard → video):
// app 2105907802166689794. node 168/169/170/171/173 = image (referensi karakter),
// node 136 = text (storyboard), node 115 = aspect_ratio.
// https://www.runninghub.ai/id/ai-detail/2105907802166689794
const RUNNINGHUB_SEEDANCE26_APP_ID = '2105907802166689794'
const SEEDANCE26_IMAGE_NODES = ['168', '169', '170', '171', '173']
const SEEDANCE26_TEXT_NODE = '136'
const SEEDANCE26_ASPECT_NODE = '115'
const SEEDANCE26_MAX_IMAGES = 5
const SEEDANCE26_ASPECTS = new Set([
  '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
  '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)',
])
const SEEDANCE26_ASPECT_FALLBACK = '16:9 (Widescreen)'

function rhAuthHeaders(apiKey: string) {
  return {
    'Content-Type': 'application/json',
    'User-Agent': 'ArkxMotion/1.0',
    'Authorization': `Bearer ${apiKey}`,
  }
}

// Key yang ditempel dari dashboard bisa membawa kutip, bullet, atau prefix
// "Bearer". Bersihkan di pintu masuk supaya key lama yang tersimpan kotor
// tetap bisa dipakai tanpa paste ulang.
function normalizeRhApiKey(raw: unknown): string {
  return String(raw ?? '')
    .trim()
    .replace(/^[•*`'"\s-]+|[•*`'"\s-]+$/g, '')
    .replace(/^Bearer\s+/i, '')
    .trim()
}

/** exp (detik sejak epoch) dari payload JWT — null kalau bukan JWT valid. */
export function rhJwtExp(token: string): number | null {
  const parts = String(token || '').split('.')
  if (parts.length < 2 || !parts[0].startsWith('ey')) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return typeof decoded?.exp === 'number' ? decoded.exp : null
  } catch {
    return null
  }
}

export function rhJwtExpired(token: string): boolean {
  const exp = rhJwtExp(token)
  return exp !== null && Date.now() > exp * 1000
}

/** sub (id akun) dari payload JWT — null kalau bukan JWT valid. */
export function rhJwtSub(token: string): string | null {
  const parts = String(token || '').split('.')
  if (parts.length < 2 || !parts[0].startsWith('ey')) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    const sub = decoded?.sub
    return sub === undefined || sub === null || sub === '' ? null : String(sub)
  } catch {
    return null
  }
}

/** Token global dari env RUNNINGHUB_ACCESS_TOKEN — '' kalau belum diisi. */
function rhGlobalAccessToken(): string {
  return normalizeRhApiKey(process.env.RUNNINGHUB_ACCESS_TOKEN)
}

/**
 * Tentukan credential yang dikirim ke upstream RunningHub:
 *  1. Akses token milik pengguna (JWT yang masih berlaku) → dipakai apa adanya.
 *  2. Selain itu (API key lama, key kosong, placeholder server) → token global.
 *  3. Token global dimatikan (env '') → key pengguna dipakai seperti mode lama.
 */
function rhResolveCredential(clientKey: string): { token: string; source: 'user-token' | 'server-token' | 'user-key' } {
  if (clientKey && rhJwtExp(clientKey) !== null && !rhJwtExpired(clientKey)) {
    return { token: clientKey, source: 'user-token' }
  }
  const global = rhGlobalAccessToken()
  if (global) return { token: global, source: 'server-token' }
  return { token: clientKey, source: 'user-key' }
}

// ── Jalur khusus access token (JWT) ───────────────────────────────────────
// Endpoint OpenAPI RunningHub (/openapi/v2/*) hanya menerima API key asli;
// JWT ditolak dengan "ApiKey verification failed: API Key不存在". Untuk sesi
// JWT kita memakai jalur resmi milik situsnya:
//   * upload media  → POST /upload/image memakai accessKey dari
//                     /api/instance/access/auth (dicoba & terbukti jalan);
//   * submit        → POST /task/webapp/create — jalur yang dipakai UI situs
//                     saat tombol Run ditekan. Ini yang menagih RH Coin akun.
//                     Jalur klasik /openapi/v2/run/ai-app/{id} membalas
//                     901 "webapp not exists", sedangkan playground menagih
//                     wallet USD (605 untuk akun yang cuma punya RH Coin).
//   * query         → POST /api/playground/openapi/v2/query?apiKeyId=<id key>
//                     (server RunningHub yang menerjemahkan apiKeyId menjadi
//                     key asli) — task dari jalur web tetap terbaca di sini.
function rhIsJwt(token: string): boolean {
  return rhJwtExp(token) !== null && !rhJwtExpired(token)
}

// Token bisa terlihat hidup (exp masih jauh) tapi sudah dicabut RunningHub —
// mis. login ulang mem-rotate sesi. /api/welfare/summary menolaknya dengan
// 412 TOKEN_INVALID; hasilnya di-cache 60 detik agar tidak menambah latensi.
const RH_TOKEN_HEALTH_MS = 60 * 1000
const rhTokenHealthCache = new Map<string, { ok: boolean; at: number }>()

async function rhJwtStillAccepted(jwt: string): Promise<boolean> {
  const fp = rhTokenFingerprint(jwt)
  const cached = rhTokenHealthCache.get(fp)
  if (cached && Date.now() - cached.at < RH_TOKEN_HEALTH_MS) return cached.ok

  let ok = true
  try {
    const res = await fetch(`${RUNNINGHUB_BASE}/api/welfare/summary`, {
      method: 'POST',
      headers: rhAuthHeaders(jwt),
      body: '{}',
      signal: AbortSignal.timeout(15000),
    })
    const text = await res.text()
    let data: any = null
    try { data = JSON.parse(text) } catch { data = null }
    const code = String(data?.code ?? '')
    // Hanya 412/401 yang tegas berarti token mati; gangguan upstream lain
    // jangan membuat token pengguna dibuang.
    ok = !(code === '412' || code === '401' || res.status === 401)
  } catch { ok = true }

  if (rhTokenHealthCache.size > 50) rhTokenHealthCache.clear()
  rhTokenHealthCache.set(fp, { ok, at: Date.now() })
  return ok
}

const RH_PLAYGROUND_PREFIX = '/api/playground/openapi/v2'
const RH_KEY_ID_CACHE_MS = 10 * 60 * 1000
// Cache per token: akun berbeda = apiKeyId berbeda. Cache global dulu membuat
// token kedua memakai apiKeyId milik token pertama (task masuk akun yang salah).
const rhKeyIdCache = new Map<string, { value: string; at: number }>()

function rhTokenFingerprint(token: string): string {
  return createHash('sha256').update(token).digest('hex').slice(0, 20)
}

/** Ambil apiKeyId milik akun dari sesi JWT (di-cache 10 menit per token). */
async function rhResolveApiKeyId(jwt: string): Promise<string> {
  const fp = rhTokenFingerprint(jwt)
  const cached = rhKeyIdCache.get(fp)
  if (cached && Date.now() - cached.at < RH_KEY_ID_CACHE_MS) {
    return cached.value
  }

  const apiRes = await fetch(`${RUNNINGHUB_BASE}/api/key/list`, {
    method: 'POST',
    headers: rhAuthHeaders(jwt),
    body: JSON.stringify({ type: 'SHARED' }),
    signal: AbortSignal.timeout(20000),
  })
  const rawText = await apiRes.text()

  let data: any = null
  try { data = JSON.parse(rawText) } catch { data = null }
  const list: any[] = Array.isArray(data?.data) ? data.data : []

  const rejCode = String(data?.code ?? '')
  if (!list.length && (rejCode === '412' || rejCode === '401' || apiRes.status === 401 || apiRes.status === 412
    || /TOKEN_INVALID|UNAUTHORIZED/i.test(String(data?.msg ?? '')))) {
    throw new Error(`Access token ditolak RunningHub (${rejCode || apiRes.status} ${data?.msg || 'TOKEN_INVALID'}) — token sudah tidak berlaku (logout/rotate). Salin access token baru dari sesi runninghub.ai yang masih login, lalu ganti Key ini di Providers.`)
  }

  // Key sistem-auto (isSystemAuto) ditolak gateway (1303) — pakai key milik akun.
  const mine = list.find((k) => !k?.isSystemAuto && k?.apiKeyId && k?.key != null)
  if (!mine) {
    throw new Error('Tidak ada API key milik akun yang bisa dipakai access token: ' + rawText.slice(0, 200))
  }

  if (rhKeyIdCache.size > 50) rhKeyIdCache.clear()
  rhKeyIdCache.set(fp, { value: String(mine.apiKeyId), at: Date.now() })
  return String(mine.apiKeyId)
}

/** Terjemahkan URL OpenAPI menjadi jalur playground bawaannya JWT. */
async function rhUpstreamUrl(jwt: string, url: string): Promise<string> {
  if (!rhIsJwt(jwt)) return url
  const prefix = `${RUNNINGHUB_BASE}/openapi/v2`
  if (!url.startsWith(prefix)) return url
  const kid = await rhResolveApiKeyId(jwt)
  const rest = url.slice(prefix.length)
  const join = rest.includes('?') ? '&' : '?'
  return `${RUNNINGHUB_BASE}${RH_PLAYGROUND_PREFIX}${rest}${join}apiKeyId=${kid}`
}

/**
 * Terjemahkan permintaan run klasik (/openapi/v2/run/ai-app/{id}) menjadi
 * permintaan yang dipakai UI situs (/task/webapp/create). Hanya untuk sesi JWT.
 *
 * Jalur web ini yang menagih RH Coin milik akun. Jalur klasik membalas
 * 901 "webapp not exists" untuk JWT, dan playground menagih wallet USD.
 */
const RH_WEBAPP_RUN_RE = /\/openapi\/v2\/run\/ai-app\/([^/?#]+)\/?$/

function rhWebappRunRequest(url: string, init?: RequestInit): { url: string; init: RequestInit } | null {
  if (!init || String(init.method ?? 'GET').toUpperCase() !== 'POST') return null
  if (typeof init.body !== 'string') return null

  const match = RH_WEBAPP_RUN_RE.exec(url.split('?')[0])
  if (!match) return null

  let body: any
  try { body = JSON.parse(init.body) } catch { return null }
  const nodeInfoList: any[] = Array.isArray(body?.nodeInfoList) ? body.nodeInfoList : []
  if (!nodeInfoList.length) return null

  // UI situs mengirim `inputs`, bukan `nodeInfoList`. Tanpa `inputs` server
  // menjawab 301 "must not be null".
  const inputs = nodeInfoList.map((node) => ({
    nodeId: String(node?.nodeId ?? ''),
    nodeName: String(node?.nodeName ?? node?.fieldName ?? ''),
    fieldName: String(node?.fieldName ?? ''),
    fieldValue: node?.fieldValue,
    description: node?.description ?? null,
  }))

  const requested = String(body?.instanceType ?? '').toLowerCase()
  const instanceType = !requested || requested === 'default' ? 'standard' : requested
  const usePersonalQueue = body?.usePersonalQueue === true || body?.usePersonalQueue === 'true'

  return {
    url: `${RUNNINGHUB_BASE}/task/webapp/create`,
    init: {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        webappId: decodeURIComponent(match[1]),
        inputs,
        clientId: randomUUID(),
        instanceType,
        usePersonalQueue,
      }),
    },
  }
}

/**
 * Samakan bentuk respons /task/webapp/create dengan respons run klasik supaya
 * handler lama (yang membaca data.data.taskId / data.data.status) tetap jalan.
 */
async function rhNormalizeWebappRunResponse(
  res: Awaited<ReturnType<typeof fetch>>,
): Promise<Awaited<ReturnType<typeof fetch>>> {
  const text = await res.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {
    return new globalThis.Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } })
  }

  const data = parsed?.data
  if ((parsed?.code === 0 || parsed?.code === '0') && data && data.taskId) {
    parsed.data = {
      ...data,
      status: data.taskStatus ?? data.status ?? '',
      errorCode: '',
      errorMessage: '',
      results: null,
      usage: null,
    }
  }

  return new globalThis.Response(JSON.stringify(parsed), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
}

/**
 * fetch yang otomatis menukar jalur OpenAPI → playground saat memakai JWT.
 *
 * Playground membungkus kegagalan request di `data.errorCode` sementara
 * top-level tetap `code: 0` (mis. 605 saldo habis, 1101 node error). Handler
 * lama hanya membaca top-level, sehingga kegagalan itu terbaca "success" lalu
 * "No taskId returned". Di sini kode bersarang dinaikkan ke top-level HANYA
 * untuk respons penolakan (tanpa taskId/status) — respons task yang sudah
 * berjalan tidak diubah.
 */
async function rhFetch(jwt: string, url: string, init?: RequestInit): Promise<Awaited<ReturnType<typeof fetch>>> {
  // Submit AI-app dengan sesi JWT harus lewat jalur web (RH Coin), bukan
  // /openapi/v2 (901) maupun playground (605 / wallet USD).
  const webappRun = rhIsJwt(jwt) ? rhWebappRunRequest(url, init) : null
  if (webappRun) {
    console.log('[runninghub] run/ai-app → /task/webapp/create (jalur RH Coin)')
    const res = await fetch(webappRun.url, { ...webappRun.init, headers: rhAuthHeaders(jwt) })
    return rhNormalizeWebappRunResponse(res)
  }

  const upstream = await rhUpstreamUrl(jwt, url)
  const res = await fetch(upstream, init)
  if (upstream === url) return res

  const text = await res.text()
  let parsed: any = null
  try { parsed = JSON.parse(text) } catch {
    return new globalThis.Response(text, { status: res.status, headers: { 'content-type': 'text/plain' } })
  }

  const nested = parsed?.data
  const nestedCode = nested?.errorCode
  const isRequestRejection = !nested?.taskId && !nested?.status
    && nestedCode !== undefined && nestedCode !== null && nestedCode !== ''
    && nestedCode !== 0 && nestedCode !== '0'
  if ((parsed?.code === 0 || parsed?.code === '0') && isRequestRejection) {
    parsed.code = nestedCode
    parsed.msg = nested?.errorMessage || parsed.msg
  }

  return new globalThis.Response(JSON.stringify(parsed), {
    status: res.status,
    headers: { 'content-type': 'application/json' },
  })
}

/** Payload userId dari accessKey ComfyUI (base64 JSON). */
function rhAccessKeyIdentities(accessKey: string): { identify: string } {
  try {
    const padded = String(accessKey).replace(/-/g, '+').replace(/_/g, '/')
    const json = Buffer.from(padded + '='.repeat((4 - padded.length % 4) % 4), 'base64').toString('utf8')
    const identify = JSON.parse(json)?.userId
    if (identify) return { identify: String(identify) }
  } catch { /* jatuh ke nilai bawah */ }
  return { identify: '' }
}

/**
 * Upload media lewat sesi situs RunningHub (jalur JWT).
 * Mengembalikan fileName ComfyUI (hash.ext) — format yang sama dengan
 * /openapi/v2/media/upload/binary sehingga nodeInfoList tidak perlu diubah.
 */
async function rhUploadViaSession(
  jwt: string,
  fileBase64: string,
  fileName: string,
  mimeType: string,
): Promise<{ fileName: string; downloadUrl: string }> {
  const authRes = await fetch(`${RUNNINGHUB_BASE}/api/instance/access/auth`, {
    method: 'POST',
    headers: rhAuthHeaders(jwt),
    body: JSON.stringify({}),
    signal: AbortSignal.timeout(30000),
  })
  const authRaw = await authRes.text()
  let authData: any = null
  try { authData = JSON.parse(authRaw) } catch { authData = null }
  const accessKey = authData?.data?.accessKey
  if (!accessKey) {
    // 412 TOKEN_INVALID = token ditolak RunningHub (sudah logout/di-rotate),
    // bukan gangguan jaringan. Pesan mentah JSON bikin key sehat kelihatan
    // "bermasalah" tanpa petunjuk apa yang harus dilakukan.
    const authCode = String(authData?.code ?? '')
    const authMsg = String(authData?.msg ?? '')
    if (authCode === '412' || authCode === '401' || authRes.status === 401 || authRes.status === 412 || /TOKEN_INVALID|UNAUTHORIZED/i.test(authMsg)) {
      throw new Error(`Access token ditolak RunningHub (${authCode || authRes.status} ${authMsg || 'TOKEN_INVALID'}) — token sudah tidak berlaku (logout/rotate). Salin access token baru dari sesi runninghub.ai yang masih login, lalu ganti Key ini di Providers.`)
    }
    throw new Error('Gagal dapat accessKey ComfyUI: ' + authRaw.slice(0, 200))
  }

  const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
  const binaryData = Buffer.from(base64Data, 'base64')

  const formData = new FormData()
  const blob = new Blob([binaryData], { type: mimeType || 'application/octet-stream' })
  formData.append('image', blob, fileName || 'upload.bin')

  const { identify } = rhAccessKeyIdentities(accessKey)
  const apiRes = await fetch(`${RUNNINGHUB_BASE}/upload/image`, {
    method: 'POST',
    headers: { 'Rh-Comfy-Auth': accessKey, 'Rh-Identify': identify },
    body: formData,
    signal: AbortSignal.timeout(300000),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] upload (sesi) ${apiRes.status}:`, rawText.slice(0, 300))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (!apiRes.ok) {
    throw new Error(data.message || data.msg || `Upload failed: HTTP ${apiRes.status}`)
  }

  const name = data?.name || data?.data?.name || data?.fileName || data?.data?.fileName
  if (!name) {
    throw new Error('No fileName in upload response: ' + rawText.slice(0, 300))
  }

  const subfolder = String(data?.subfolder || data?.data?.subfolder || '').replace(/^\/+|\/+$/g, '')
  return { fileName: subfolder ? `${subfolder}/${name}` : String(name), downloadUrl: '' }
}

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Runninghub-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const body = req.body || {}
  const { action, apiKey: rawApiKey, ...params } = body
  const clientKey = normalizeRhApiKey(rawApiKey)

  // Token MF-… adalah kunci akun MarkasTools (ai.markastools.id), bukan
  // kredensial RunningHub: key/list menjawab 412 TOKEN_INVALID dan OpenAPI
  // menjawab 806. Tolak di pintu masuk dengan arahan yang benar.
  if (/^MF-[A-Z0-9]/i.test(clientKey)) {
    return res.status(200).json({
      ok: false,
      error: 'Token MF-… adalah kunci akun MarkasTools, bukan access token RunningHub. ' +
        'Hubungkan lewat panel MarkasTools di Providers (butuh cookie sesi ai.markastools.id) — ' +
        'token ini tidak bisa dipakai langsung ke runninghub.ai.',
      code: 'MARKASTOOLS_TOKEN',
    })
  }

  // Klaim hadiah harian: SELALU pakai token milik pengguna (bukan token
  // server) — hadiah harian adalah hak per-akun, jadi tidak boleh diklaim
  // atas nama akun lain.
  if (action === 'claim-daily-gift') {
    return await handleClaimDailyGift(clientKey, res)
  }

  let { token: apiKey, source: authSource } = rhResolveCredential(clientKey)
  if (!action) return res.status(200).json({ ok: false, error: 'Missing action' })

  // Token pengguna yang sudah dicabut (412) jangan memblokir generasi bila
  // server punya token sendiri. check-balance dikecualikan: di sana justru
  // penting melaporkan keadaan token pengguna apa adanya.
  if (action !== 'check-balance' && authSource === 'user-token') {
    const global = rhGlobalAccessToken()
    if (global && global !== apiKey && !(await rhJwtStillAccepted(apiKey))) {
      console.log('[runninghub] token pengguna ditolak RunningHub (412) — memakai token server')
      apiKey = global
      authSource = 'server-token'
    }
  }

  // Placeholder dari client dengan token global yang dimatikan = konfigurasi
  // belum lengkap — jangan teruskan ke upstream (pasti ditolak dengan 806).
  if (apiKey === RUNNINGHUB_SERVER_MANAGED_KEY) {
    return res.status(200).json({
      ok: false,
      error: 'Access token RunningHub belum terpasang di server. Isi RUNNINGHUB_ACCESS_TOKEN di .env lalu restart server.',
    })
  }

  if (!apiKey) {
    return res.status(200).json({ ok: false, error: 'Missing apiKey' })
  }

  // Tolak lebih awal dengan pesan jelas, bukan error 806/401 membingungkan.
  const exp = rhJwtExp(apiKey)
  if (exp !== null && Date.now() > exp * 1000) {
    return res.status(200).json({
      ok: false,
      error: `Access token RunningHub kedaluwarsa (${new Date(exp * 1000).toISOString()}). Perbarui token di env RUNNINGHUB_ACCESS_TOKEN lalu restart server.`,
    })
  }

  console.log(`[runninghub] action=${action} auth=${authSource} keyLen=${String(apiKey).length}`)

  try {
    if (action === 'motion-control') {
      return await handleMotionControl(apiKey, params, res)
    }
    if (action === 'motion-control-v2.6-std') {
      return await handleMotionControlV26Std(apiKey, params, res)
    }
    if (action === 'motion-control-v2.6-pro') {
      return await handleMotionControlV26Pro(apiKey, params, res)
    }
    if (action === 'motion-control-v3') {
      return await handleMotionControlV3(apiKey, params, res)
    }
    if (action === 'motion-control-ultra-hd') {
      return await handleMotionControlUltraHD(apiKey, params, res)
    }
    const motionApp = MOTION_APPS[action]
    if (motionApp) {
      return await handleMotionAppWorkflow(apiKey, params, res, motionApp)
    }
    if (action === 'get-workflow-info') {
      return await handleGetWorkflowInfo(apiKey, params.workflowId || params.workflow_id, res)
    }
    if (action === 'submit-tryon') {
      return await handleSubmitTryOn(apiKey, params, res)
    }
    if (action === 'submit-tryon-flux2') {
      return await handleSubmitTryOnFlux2(apiKey, params, res)
    }
    if (action === 'submit-song-cover') {
      return await handleSubmitSongCover(apiKey, params, res)
    }
    if (action === 'submit-yue2-reimaginer') {
      return await handleSubmitYuE2Reimaginer(apiKey, params, res)
    }
    if (action === 'submit-video-upscale') {
      return await handleSubmitVideoUpscale(apiKey, params, res)
    }
    if (action === 'submit-photo-enhance') {
      return await handleSubmitPhotoEnhance(apiKey, params, res)
    }
    if (action === 'submit-travel-photo') {
      return await handleSubmitTravelPhoto(apiKey, params, res)
    }
    if (action === 'submit-image-edit') {
      return await handleSubmitImageEdit(apiKey, params, res)
    }
    if (action === 'submit-h3-i2v') {
      return await handleSubmitH3I2V(apiKey, params, res)
    }
    if (action === 'submit-h3-music-avatar') {
      return await handleSubmitH3MusicAvatar(apiKey, params, res)
    }
    if (action === 'submit-h3-vlog') {
      return await handleSubmitH3Vlog(apiKey, params, res)
    }
    if (action === 'submit-ugc-storyboard') {
      return await handleSubmitUGCStoryboard(apiKey, params, res)
    }
    if (action === 'submit-seedance2') {
      return await handleSubmitSeedance2(apiKey, params, res)
    }
    if (action === 'submit-seedance2.6') {
      return await handleSubmitSeedance26(apiKey, params, res)
    }
    if (action === 'query') {
      return await handleQuery(apiKey, params.taskId, res)
    }
    if (action === 'check-balance') {
      return await handleCheckBalance(apiKey, res)
    }

    return res.status(200).json({ ok: false, error: `Unknown action: ${action}` })
  } catch (err: any) {
    console.error(`[runninghub] error:`, err.message)
    return res.status(200).json({ ok: false, error: err.message })
  }
})

async function rhUpload(apiKey: string, fileBase64: string, fileName: string, mimeType: string): Promise<{ fileName: string; downloadUrl: string }> {
  // Access token (JWT): endpoint OpenAPI menolak JWT, jadi upload lewat sesi situs.
  if (rhIsJwt(apiKey)) {
    return rhUploadViaSession(apiKey, fileBase64, fileName, mimeType)
  }

  const base64Data = fileBase64.includes(',') ? fileBase64.split(',')[1] : fileBase64
  const binaryData = Buffer.from(base64Data, 'base64')

  const formData = new FormData()
  const blob = new Blob([binaryData], { type: mimeType || 'application/octet-stream' })
  formData.append('file', blob, fileName || 'upload.bin')

  const apiRes = await fetch(`${RUNNINGHUB_BASE}/openapi/v2/media/upload/binary`, {
    method: 'POST',
    headers: { 'Authorization': `Bearer ${apiKey}` },
    body: formData,
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] upload ${apiRes.status}:`, rawText.slice(0, 500))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (!apiRes.ok) {
    throw new Error(data.message || data.msg || `Upload failed: HTTP ${apiRes.status}`)
  }

  const uploadedFileName = data.data?.fileName || data.fileName
  const downloadUrl = data.data?.download_url || data.download_url
  if (!uploadedFileName) {
    throw new Error('No fileName in upload response: ' + rawText.slice(0, 300))
  }

  // download_url might be relative (just filename) — construct full URL
  let fullDownloadUrl = downloadUrl || ''
  if (fullDownloadUrl && !fullDownloadUrl.startsWith('http')) {
    fullDownloadUrl = `https://rh-hk-images-switch.xiaoyaoyou.com/input/${uploadedFileName}`
  }

  return { fileName: uploadedFileName, downloadUrl: fullDownloadUrl }
}

async function handleMotionControlV26Std(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    keepOriginalSound = 'yes',
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-std/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await rhFetch(apiKey, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v2.6-std ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'markasflow-v2',
    },
  })
}

async function handleMotionControlV26Pro(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    keepOriginalSound = 'yes',
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v2.6-pro/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await rhFetch(apiKey, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v2.6-pro ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in V2.6 Pro response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'markasflow-v2',
    },
  })
}

async function handleMotionControlV3(apiKey: string, params: any, res: Response) {
  const {
    imageUrl,
    videoUrl,
    characterOrientation = 'video',
    prompt = '',
    negativePrompt = '',
    keepOriginalSound = true,
  } = params

  if (!imageUrl) return res.status(200).json({ ok: false, error: 'Missing imageUrl' })
  if (!videoUrl) return res.status(200).json({ ok: false, error: 'Missing videoUrl' })

  const body: any = {
    imageUrl,
    videoUrl,
    characterOrientation,
    prompt,
    keepOriginalSound,
  }
  if (negativePrompt) body.negativePrompt = negativePrompt

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/kling-v3.0-pro/motion-control`
  console.log(`[runninghub] POST ${endpoint}`)
  console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

  const apiRes = await rhFetch(apiKey, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] motion-control-v3 ${apiRes.status}:`, rawText)

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  if (apiRes.status === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  if (!apiRes.ok) {
    const errorMsg = data.errorMessage || data.msg || data.message || data.error || `HTTP ${apiRes.status}`
    return res.status(200).json({ ok: false, error: errorMsg, data })
  }

  if (data.status === 'FAILED') {
    return res.status(200).json({ ok: false, error: data.errorMessage || data.failedReason || 'Task failed', data })
  }

  const taskId = data.taskId || data.data?.taskId || data.id || data.task_id
  if (!taskId) {
    console.error(`[runninghub] No taskId found in V3 response:`, JSON.stringify(data))
    return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: rawText, fullData: data })
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: data.status || data.data?.status || 'QUEUED',
      provider: 'runninghub',
    },
  })
}

async function handleGetWorkflowInfo(apiKey: string, workflowId: string, res: Response) {
  if (!workflowId) return res.status(200).json({ ok: false, error: 'Missing workflowId' })
  try {
    const nodes = await fetchWorkflowNodes(apiKey, workflowId)
    return res.status(200).json({ ok: true, data: { workflowId, nodes } })
  } catch (err: any) {
    return res.status(200).json({ ok: false, error: err.message })
  }
}

async function fetchWorkflowNodes(apiKey: string, workflowId: string): Promise<any[]> {
  // Discovery butuh API key asli; jalur playground tidak punya padanan
  // getJsonApiFormat — pemanggil sudah punya daftar node bawaan sebagai cadangan.
  if (rhIsJwt(apiKey)) {
    throw new Error('Discovery node butuh API key asli (access token memakai daftar node bawaan)')
  }
  const endpoints = [
    `${RUNNINGHUB_BASE}/api/openapi/getJsonApiFormat`,
    `${RUNNINGHUB_BASE}/openapi/getJsonApiFormat`,
  ]
  let lastErr = ''
  for (const endpoint of endpoints) {
    try {
      const apiRes = await rhFetch(apiKey, endpoint, {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'Authorization': `Bearer ${apiKey}` },
        body: JSON.stringify({ apiKey, workflowId }),
      })
      const raw = await apiRes.text()
      let data: any
      try { data = JSON.parse(raw) } catch { data = {} }
      const promptStr = data.data?.prompt || data.prompt || data.data
      if (typeof promptStr === 'string' && promptStr.includes('class_type')) {
        const prompt = JSON.parse(promptStr)
        return Object.entries(prompt).map(([nodeId, node]: [string, any]) => ({
          nodeId,
          classType: node.class_type,
          inputs: node.inputs || {},
          title: node._meta?.title || '',
        }))
      }
      lastErr = (data.msg || data.message || raw).slice(0, 200)
    } catch (err: any) {
      lastErr = err.message
    }
  }
  throw new Error(`Gagal ambil workflow JSON: ${lastErr || 'unknown'}`)
}

function buildUltraHDNodeList(nodes: any[], opts: {
  imageFileName: string
  videoFileName: string
  fps: number
  steps: number
  maxFrames: number
  prompt: string
  negativePrompt: string
}): any[] | null {
  if (!nodes || nodes.length === 0) return null
  const list: any[] = []
  let imageSet = false
  let videoSet = false

  const findInputKey = (inputs: Record<string, any>, patterns: RegExp[]): string | null => {
    for (const k of Object.keys(inputs)) {
      if (patterns.some((p) => p.test(k))) return k
    }
    return null
  }

  for (const n of nodes) {
    const inputs = n.inputs || {}
    const cls = String(n.classType || '')
    const title = String(n.title || '')

    if (!imageSet && /loadimage|image/i.test(cls + ' ' + title)) {
      const key = findInputKey(inputs, [/image/i]) || 'image'
      list.push({ nodeId: String(n.nodeId), fieldName: key, fieldValue: opts.imageFileName })
      imageSet = true
      continue
    }
    if (!videoSet && /loadvideo|video/i.test(cls + ' ' + title)) {
      const key = findInputKey(inputs, [/video/i]) || 'video'
      list.push({ nodeId: String(n.nodeId), fieldName: key, fieldValue: opts.videoFileName })
      videoSet = true
      continue
    }
    const fpsKey = findInputKey(inputs, [/^fps$/i, /frame_?rate/i])
    if (fpsKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: fpsKey, fieldValue: String(opts.fps) })
      continue
    }
    const stepsKey = findInputKey(inputs, [/^steps$/i])
    if (stepsKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: stepsKey, fieldValue: String(opts.steps) })
      continue
    }
    const frameKey = findInputKey(inputs, [/max_?frames?/i, /frame_?limit/i, /num_?frames?/i, /^frames?$/i])
    if (frameKey) {
      list.push({ nodeId: String(n.nodeId), fieldName: frameKey, fieldValue: String(opts.maxFrames) })
      continue
    }
    const promptKey = findInputKey(inputs, [/^prompt$/i, /^text$/i, /positive/i])
    if (promptKey && /clip|prompt|text/i.test(cls + ' ' + title)) {
      const isNegative = /negative/i.test(title + ' ' + cls)
      const value = isNegative ? opts.negativePrompt : opts.prompt
      if (value) list.push({ nodeId: String(n.nodeId), fieldName: promptKey, fieldValue: value })
      continue
    }
  }

  if (!list.some((l) => /fps/i.test(l.fieldName))) {
    for (const n of nodes) {
      const inputs = n.inputs || {}
      if (inputs.fps !== undefined) {
        list.push({ nodeId: String(n.nodeId), fieldName: 'fps', fieldValue: String(opts.fps) })
        break
      }
    }
  }

  if (!imageSet || !videoSet) return null
  return list
}

function collectUltraHDExtras(nodes: any[], opts: {
  fps: number
  steps: number
  maxFrames: number
  prompt: string
  negativePrompt: string
}): any[] {
  const extras: any[] = []
  if (!nodes || nodes.length === 0) return extras

  const findInputKey = (inputs: Record<string, any>, patterns: RegExp[]): string | null => {
    for (const k of Object.keys(inputs)) {
      if (patterns.some((p) => p.test(k))) return k
    }
    return null
  }

  for (const n of nodes) {
    const inputs = n.inputs || {}
    const cls = String(n.classType || '')
    const title = String(n.title || '')
    const tag = `${cls} ${title}`
    if (/loadimage|loadvideo|image|video/i.test(tag) && (findInputKey(inputs, [/^image$/i, /^video$/i]))) continue

    const fpsKey = findInputKey(inputs, [/^fps$/i, /frame_?rate/i])
    if (fpsKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: fpsKey, fieldValue: String(opts.fps) })
      continue
    }
    const stepsKey = findInputKey(inputs, [/^steps$/i])
    if (stepsKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: stepsKey, fieldValue: String(opts.steps) })
      continue
    }
    const frameKey = findInputKey(inputs, [/max_?frames?/i, /frame_?limit/i, /num_?frames?/i, /^frames?$/i])
    if (frameKey) {
      extras.push({ nodeId: String(n.nodeId), fieldName: frameKey, fieldValue: String(opts.maxFrames) })
      continue
    }
    const promptKey = findInputKey(inputs, [/^prompt$/i, /^text$/i, /positive/i])
    if (promptKey && /clip|prompt|text/i.test(tag)) {
      const isNegative = /negative/i.test(tag)
      const value = isNegative ? opts.negativePrompt : opts.prompt
      if (value) extras.push({ nodeId: String(n.nodeId), fieldName: promptKey, fieldValue: value })
      continue
    }
  }
  return extras
}

async function handleMotionControlUltraHD(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    fps = 24,
    steps = 20,
    maxFrames,
    max_frames,
    frameLimit,
    prompt = '',
    negative_prompt = '',
    negativePrompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_ULTRA_HD_WORKFLOW_ID
  const effFps = Math.max(1, Math.min(60, Number(fps) || 60))
  const effSteps = Math.max(1, Math.min(100, Number(steps) || 4))
  const effMaxFrames = Math.max(1, Math.min(1000, Number(maxFrames ?? max_frames ?? frameLimit) || 120))
  const effPrompt = String(prompt || '')
  const effNegative = String(negative_prompt || negativePrompt || '')

  console.log(`[runninghub] Uploading image (ultra-hd)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading video (ultra-hd)...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  let nodeInfoList: any[] = [
    { nodeId: ULTRA_HD_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: ULTRA_HD_VIDEO_NODE, fieldName: 'video', fieldValue: videoUpload.fileName },
  ]
  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    console.log(`[runninghub] ultra-hd discovered ${nodes.length} nodes`)
    const mapped = buildUltraHDNodeList(nodes, {
      imageFileName: imageUpload.fileName,
      videoFileName: videoUpload.fileName,
      fps: effFps,
      steps: effSteps,
      maxFrames: effMaxFrames,
      prompt: effPrompt,
      negativePrompt: effNegative,
    })
    if (mapped) {
      nodeInfoList = mapped
      console.log(`[runninghub] ultra-hd auto-mapped ${nodeInfoList.length} fields`)
    } else {
      const extras = collectUltraHDExtras(nodes, {
        fps: effFps,
        steps: effSteps,
        maxFrames: effMaxFrames,
        prompt: effPrompt,
        negativePrompt: effNegative,
      })
      if (extras.length > 0) {
        nodeInfoList = [...nodeInfoList, ...extras]
        console.log(`[runninghub] ultra-hd base 30/33 + ${extras.length} extras`)
      } else {
        console.log(`[runninghub] ultra-hd base 30/33 (workflow defaults untuk fps/steps/frames)`)
      }
    }
  } catch (err: any) {
    console.log(`[runninghub] ultra-hd node discovery failed, pakai base 30/33: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (ultra-hd attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] motion-control-ultra-hd ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (ultra-hd):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    const netWssUrl = data.data?.netWssUrl
    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        netWssUrl,
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

// Ambil node teks saja (prompt/negative). App motion transfer ini tidak punya node
// fps/steps/frames, jadi bagian itu sengaja tidak disalin dari handler ultra-hd.
function collectPromptExtras(nodes: any[], opts: { prompt: string; negativePrompt: string }): any[] {
  const extras: any[] = []
  if (!nodes || nodes.length === 0) return extras
  for (const n of nodes) {
    const inputs = n.inputs || {}
    const tag = `${String(n.classType || '')} ${String(n.title || '')}`
    const promptKey = Object.keys(inputs).find((k) => /^(prompt|text)$/i.test(k) || /positive/i.test(k))
    if (!promptKey || !/clip|prompt|text/i.test(tag)) continue
    const value = /negative/i.test(tag) ? opts.negativePrompt : opts.prompt
    if (value) extras.push({ nodeId: String(n.nodeId), fieldName: promptKey, fieldValue: value })
  }
  return extras
}

// App motion control berbasis workflow: unggah gambar + video referensi, kirim
// nodeInfoList sesuai konfigurasi app (MOTION_APPS), lalu serahkan taskId ke UI.
// Karena konfigurasinya tabel, menambah model baru tidak menambah blok kode di sini.
async function handleMotionAppWorkflow(apiKey: string, params: any, res: Response, cfg: MotionAppConfig) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    prompt = '',
    negative_prompt = '',
    negativePrompt = '',
    durationHint = 0,
    instanceType = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || cfg.appId
  const effPrompt = String(prompt || '')
  const effNegative = String(negative_prompt || negativePrompt || '')

  console.log(`[runninghub] Uploading image (${cfg.label})...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading video (${cfg.label})...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  let nodeInfoList: any[] = [
    { nodeId: cfg.imageNode, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: cfg.videoNode, fieldName: cfg.videoField, fieldValue: videoUpload.fileName },
  ]

  if (cfg.extraNodes && cfg.extraNodes.length > 0) {
    nodeInfoList = [...nodeInfoList, ...cfg.extraNodes]
  }

  if (cfg.promptNode) {
    const text = effPrompt || cfg.promptNode.defaultText || ''
    if (text) {
      nodeInfoList.push({
        nodeId: cfg.promptNode.nodeId,
        fieldName: cfg.promptNode.fieldName,
        fieldValue: text,
      })
    }
  } else if (effPrompt || effNegative) {
    try {
      const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
      const extras = collectPromptExtras(nodes, { prompt: effPrompt, negativePrompt: effNegative })
      if (extras.length > 0) {
        nodeInfoList = [...nodeInfoList, ...extras]
        console.log(`[runninghub] ${cfg.label} prompt dikirim ke ${extras.length} node teks`)
      } else {
        console.log(`[runninghub] ${cfg.label}: prompt diabaikan, workflow ini tidak punya node teks`)
      }
    } catch (err: any) {
      console.log(`[runninghub] ${cfg.label} prompt discovery gagal: ${err.message}`)
    }
  }

  // Instance type: client bisa memaksa ('plus'/'ultra'/'default'), atau server
  // memilih 'plus' bila durasi referensi melewati ambang cfg.plusAboveSec.
  const effectiveInstance = ['default', 'plus', 'ultra'].includes(String(instanceType))
    ? String(instanceType)
    : (cfg.plusAboveSec && Number(durationHint) > cfg.plusAboveSec ? 'plus' : 'default')
  console.log(`[runninghub] ${cfg.label} instanceType=${effectiveInstance} (durationHint=${Number(durationHint)}s)`)

  const body = {
    nodeInfoList,
    instanceType: effectiveInstance,
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (${cfg.label} attempt ${attempt}/${MAX_RETRIES})`)

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] ${cfg.label} ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (${cfg.label}):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    const netWssUrl = data.data?.netWssUrl
    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        netWssUrl,
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitTryOn(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    mode = 'tryon',
    personBase64,
    personFileName = 'person.jpg',
    personMimeType = 'image/jpeg',
    garmentBase64,
    garmentFileName = 'garment.jpg',
    garmentMimeType = 'image/jpeg',
    prompt = '',
  } = params

  if (!personBase64) return res.status(200).json({ ok: false, error: 'Missing personBase64' })
  if (mode === 'tryon' && !garmentBase64) {
    return res.status(200).json({ ok: false, error: 'Missing garmentBase64 (mode tryon butuh foto pakaian)' })
  }

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_TRYON_WORKFLOW_ID

  console.log(`[runninghub] Uploading person image (tryon)...`)
  const personUpload = await rhUpload(apiKey, personBase64, personFileName, personMimeType)
  console.log(`[runninghub] Person uploaded: ${personUpload.fileName}`)

  let garmentUpload: { fileName: string; downloadUrl: string } | null = null
  if (garmentBase64) {
    console.log(`[runninghub] Uploading garment image (tryon)...`)
    garmentUpload = await rhUpload(apiKey, garmentBase64, garmentFileName, garmentMimeType)
    console.log(`[runninghub] Garment uploaded: ${garmentUpload.fileName}`)
  }

  const nodeInfoList: any[] = [
    { nodeId: RUNNINGHUB_TRYON_PERSON_NODE, fieldName: 'image', fieldValue: personUpload.fileName },
  ]
  if (garmentUpload) {
    nodeInfoList.push({ nodeId: RUNNINGHUB_TRYON_GARMENT_NODE, fieldName: 'image', fieldValue: garmentUpload.fileName })
  }

  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    const extras = collectUltraHDExtras(nodes, {
      fps: 0, steps: 0, maxFrames: 0, prompt: String(prompt || ''), negativePrompt: '',
    }).filter((e) => /prompt|text|positive/i.test(e.fieldName))
    if (extras.length > 0) {
      nodeInfoList.push(...extras)
      console.log(`[runninghub] tryon + ${extras.length} extras`)
    }
  } catch (err: any) {
    console.log(`[runninghub] tryon discovery skipped: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (tryon attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-tryon ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (tryon):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitTryOnFlux2(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    personBase64,
    personFileName = 'person.jpg',
    personMimeType = 'image/jpeg',
    garmentBase64,
    garmentFileName = 'garment.jpg',
    garmentMimeType = 'image/jpeg',
    prompt = '',
  } = params

  if (!personBase64) return res.status(200).json({ ok: false, error: 'Missing personBase64' })
  if (!garmentBase64) return res.status(200).json({ ok: false, error: 'Missing garmentBase64 (FLUX2-Klein butuh foto pakaian)' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_TRYON_FLUX2_APP_ID

  console.log(`[runninghub] Uploading person image (tryon flux2)...`)
  const personUpload = await rhUpload(apiKey, personBase64, personFileName, personMimeType)
  console.log(`[runninghub] Person uploaded: ${personUpload.fileName}`)

  console.log(`[runninghub] Uploading garment image (tryon flux2)...`)
  const garmentUpload = await rhUpload(apiKey, garmentBase64, garmentFileName, garmentMimeType)
  console.log(`[runninghub] Garment uploaded: ${garmentUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: TRYON_FLUX2_PERSON_NODE, fieldName: TRYON_FLUX2_IMAGE_FIELD, fieldValue: personUpload.fileName },
    { nodeId: TRYON_FLUX2_GARMENT_NODE, fieldName: TRYON_FLUX2_IMAGE_FIELD, fieldValue: garmentUpload.fileName },
  ]

  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    const extras = collectUltraHDExtras(nodes, {
      fps: 0, steps: 0, maxFrames: 0, prompt: String(prompt || ''), negativePrompt: '',
    }).filter((e) => /prompt|text|positive/i.test(e.fieldName))
    if (extras.length > 0) {
      nodeInfoList.push(...extras)
      console.log(`[runninghub] tryon-flux2 + ${extras.length} extras`)
    }
  } catch (err: any) {
    console.log(`[runninghub] tryon-flux2 discovery skipped: ${err.message}`)
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (tryon-flux2 attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-tryon-flux2 ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (tryon-flux2):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitH3MusicAvatar(apiKey: string, params: any, res: Response) {
  const {
    app_id,
    appId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    audioBase64,
    audioFileName = 'audio.mp3',
    audioMimeType = 'audio/mpeg',
    prompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!audioBase64) return res.status(200).json({ ok: false, error: 'Missing audioBase64' })

  const effectiveAppId = app_id || appId || RUNNINGHUB_H3_MUSIC_AVATAR_APP_ID

  console.log(`[runninghub] Uploading photo (h3-music-avatar)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading audio (h3-music-avatar)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: H3_MUSIC_AVATAR_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: H3_MUSIC_AVATAR_AUDIO_NODE, fieldName: 'audio', fieldValue: audioUpload.fileName },
  ]

  // Node 214 = prompt acting. Sesuai contoh resmi docs, fieldName-nya "value".
  // Tanpa prompt, app memakai teks default di dalam workflow-nya.
  const effPrompt = String(prompt || '').trim()
  if (effPrompt) {
    nodeInfoList.push({ nodeId: H3_MUSIC_AVATAR_PROMPT_NODE, fieldName: 'value', fieldValue: effPrompt })
  }

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveAppId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (h3-music-avatar attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-h3-music-avatar ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (h3-music-avatar):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveAppId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitH3Vlog(apiKey: string, params: any, res: Response) {
  const {
    app_id,
    appId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    prompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!String(prompt || '').trim()) return res.status(200).json({ ok: false, error: 'Missing prompt' })

  const effectiveAppId = app_id || appId || RUNNINGHUB_H3_VLOG_APP_ID

  console.log(`[runninghub] Uploading photo (h3-vlog)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: H3_VLOG_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: H3_VLOG_PROMPT_NODE, fieldName: 'value', fieldValue: String(prompt).trim() },
  ]

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveAppId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (h3-vlog attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-h3-vlog ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (h3-vlog):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveAppId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitSongCover(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    audioBase64,
    audioFileName = 'song.mp3',
    audioMimeType = 'audio/mpeg',
    stylePrompt = '',
    lyrics = '',
    instanceType = 'default',
  } = params

  if (!audioBase64) return res.status(200).json({ ok: false, error: 'Missing audioBase64' })
  if (!stylePrompt && !lyrics) {
    return res.status(200).json({ ok: false, error: 'Isi minimal gaya (style prompt) atau lirik.' })
  }

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_SONG_COVER_WORKFLOW_ID

  console.log(`[runninghub] Uploading audio (song-cover)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: SONG_COVER_AUDIO_NODE, fieldName: 'audio', fieldValue: audioUpload.fileName },
  ]
  if (stylePrompt) {
    nodeInfoList.push({ nodeId: SONG_COVER_STYLE_NODE, fieldName: 'prompt', fieldValue: String(stylePrompt) })
  }
  if (lyrics) {
    nodeInfoList.push({ nodeId: SONG_COVER_LYRICS_NODE, fieldName: 'prompt', fieldValue: String(lyrics) })
  }

  const instance = ['default', 'plus', 'ultra'].includes(String(instanceType)) ? String(instanceType) : 'default'
  const body = {
    nodeInfoList,
    instanceType: instance,
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (song-cover attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-song-cover ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (song-cover):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveWorkflowId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitYuE2Reimaginer(apiKey: string, params: any, res: Response) {
  const {
    app_id,
    appId,
    workflow_id,
    workflowId,
    audioBase64,
    audioFileName = 'reference.mp3',
    audioMimeType = 'audio/mpeg',
    stylePrompt = '',
    lyrics = '',
    instanceType = 'default',
  } = params

  if (!audioBase64) return res.status(200).json({ ok: false, error: 'Missing audioBase64' })
  if (!String(stylePrompt).trim() || !String(lyrics).trim()) {
    return res.status(200).json({ ok: false, error: 'YuE2 Reimaginer butuh style musik dan lirik baru sekaligus.' })
  }

  const effectiveAppId = app_id || appId || workflow_id || workflowId || RUNNINGHUB_YUE2_REIMAGINER_APP_ID

  console.log(`[runninghub] Uploading audio (yue2-reimaginer)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const nodeInfoList = [
    { nodeId: YUE2_AUDIO_NODE, fieldName: 'audio', fieldValue: audioUpload.fileName },
    { nodeId: YUE2_STYLE_NODE, fieldName: 'positive', fieldValue: String(stylePrompt) },
    { nodeId: YUE2_LYRICS_NODE, fieldName: 'positive', fieldValue: String(lyrics) },
  ]

  const instance = ['default', 'plus', 'ultra'].includes(String(instanceType)) ? String(instanceType) : 'default'
  const body = {
    nodeInfoList,
    instanceType: instance,
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveAppId}`

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (yue2-reimaginer attempt ${attempt}/${MAX_RETRIES})`)

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-yue2-reimaginer ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found (yue2-reimaginer):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        provider: 'runninghub',
        workflowId: effectiveAppId,
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

const VOSR2_SCHEDULERS = new Set([
  'simple', 'sgm_uniform', 'karras', 'exponential', 'ddim_uniform', 'beta',
  'normal', 'linear_quadratic', 'kl_optimal', 'beta57', 'gits', 'beta_1_1',
])

async function handleSubmitVideoUpscale(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    videoBase64,
    videoFileName = 'video.mp4',
    videoMimeType = 'video/mp4',
    steps = 4,
    cfg = 4.5,
    scheduler = 'beta',
    frameLoadCap = 0,
  } = params

  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_VIDEO_UPSCALE_WORKFLOW_ID
  const effSteps = Math.max(1, Math.min(50, Number(steps) || 4))
  const effCfg = Math.max(0, Math.min(30, Number(cfg) || 4.5))
  const effScheduler = VOSR2_SCHEDULERS.has(String(scheduler)) ? String(scheduler) : 'beta'
  const effFrameCap = Math.max(0, Math.min(10000, Number(frameLoadCap) || 0))

  console.log(`[runninghub] Uploading video (upscale)...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  const baseList: any[] = [
    { nodeId: '1', fieldName: 'video', fieldValue: videoUpload.fileName },
    { nodeId: '1', fieldName: 'frame_load_cap', fieldValue: String(effFrameCap) },
    { nodeId: '21', fieldName: 'cfg', fieldValue: String(effCfg) },
    { nodeId: '21', fieldName: 'scheduler', fieldValue: effScheduler },
    { nodeId: '21', fieldName: 'steps', fieldValue: String(effSteps) },
    { nodeId: '13', fieldName: 'save_output', fieldValue: 'true' },
  ]

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-video-upscale ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const VIDEO_FIELDS = ['video', 'file', 'path', 'video_path', 'filename']
  let lastErr = 'Unknown error'
  let lastData: any = null

  for (const vf of VIDEO_FIELDS) {
    let list = baseList.map((e) =>
      e.nodeId === '1' && /video|file|path|filename|input/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
    )
    for (let fix = 0; fix < 6; fix++) {
      let r: Awaited<ReturnType<typeof postRun>> | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] upscale field=${vf} fix=${fix} (attempt ${attempt}/3)`)
        r = await postRun(list)
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: effectiveWorkflowId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        const isVideoEntry = mm.nodeId === '1' && mm.fieldName === vf
        if (isVideoEntry) {
          if (/field_not_found/i.test(mm.reason)) {
            console.log(`[runninghub] upscale field "${vf}" ditolak, coba kandidat berikutnya`)
            break
          }
          return res.status(200).json({ ok: false, error: `Node video (1) tidak ada di workflow ini`, data: r.data })
        }
        console.log(`[runninghub] upscale buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }
  }

  return res.status(200).json({ ok: false, error: `Semua kandidat field video ditolak. Terakhir: ${lastErr}`, data: lastData })
}

async function handleSubmitPhotoEnhance(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    scaleBy = 2,
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_PHOTO_ENHANCE_WORKFLOW_ID
  const effScaleBy = Math.max(1, Math.min(4, Number(scaleBy) || 2))

  console.log(`[runninghub] Uploading photo (enhance)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  const baseList: any[] = [
    { nodeId: '642', fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: '688', fieldName: 'scale_by', fieldValue: String(effScaleBy) },
  ]

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-photo-enhance ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const IMAGE_FIELDS = ['image', 'file', 'path', 'filename', 'input', 'src']
  let lastErr = 'Unknown error'
  let lastData: any = null

  for (const vf of IMAGE_FIELDS) {
    let list = baseList.map((e) =>
      e.nodeId === '642' && /image|file|path|filename|input|src/i.test(e.fieldName) ? { ...e, fieldName: vf } : e,
    )
    for (let fix = 0; fix < 4; fix++) {
      let r: Awaited<ReturnType<typeof postRun>> | null = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] enhance field=${vf} fix=${fix} (attempt ${attempt}/3)`)
        r = await postRun(list)
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: effectiveWorkflowId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        const isImageEntry = mm.nodeId === '642' && mm.fieldName === vf
        if (isImageEntry) {
          if (/field_not_found/i.test(mm.reason)) {
            console.log(`[runninghub] enhance field "${vf}" ditolak, coba kandidat berikutnya`)
            break
          }
          return res.status(200).json({ ok: false, error: `Node image (642) tidak ada di workflow ini`, data: r.data })
        }
        console.log(`[runninghub] enhance buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        list = list.filter((e) => !(String(e.nodeId) === mm.nodeId && String(e.fieldName) === mm.fieldName))
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }
  }

  return res.status(200).json({ ok: false, error: `Semua kandidat field image ditolak. Terakhir: ${lastErr}`, data: lastData })
}

// Travel Photography - 1 foto ke banyak destinasi
async function handleSubmitTravelPhoto(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    characterBase64,
    characterFileName = 'character.jpg',
    characterMimeType = 'image/jpeg',
    destination = '',
    prompt = '',
    aspectRatio = '9:16',
  } = params

  if (!characterBase64) return res.status(200).json({ ok: false, error: 'Missing characterBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_TRAVEL_PHOTO_WORKFLOW_ID

  console.log('[runninghub] Uploading character image (travel-photo)...')
  const characterUpload = await rhUpload(apiKey, characterBase64, characterFileName, characterMimeType)
  console.log('[runninghub] Character uploaded: ' + characterUpload.fileName)

  // Idea prompt untuk node 152 (CR Text). Dulu selalu "walking in the city of
  // X at night" — memaksa suasana malam & sering membawa emoji dari label UI.
  // Master prompt node 15 sudah mengatur suasana mengikuti waktu lokal & cuaca,
  // jadi default di sini netral. Prompt user (kalau ada) dipakai apa adanya.
  const destClean = String(destination || '').replace(/[\u{1F300}-\u{1FAFF}\u{2600}-\u{27BF}]/gu, '').trim()
  const userPrompt = String(prompt || '').trim()
  const destPrompt = userPrompt || (destClean ? `candid realistic travel photo of the character exploring ${destClean}` : '')

  // Build master prompt with destination injected
  const masterPrompt = TRAVEL_PHOTO_MASTER_PROMPT.replace(/\[lokasi\]/g, destination).replace(/\[jumlah\]/g, '3')

  // Node IDs from RunningHub Travel Photo workflow (2097726202999336962)
  const nodeInfoList: any[] = [
    { nodeId: '103', fieldName: 'image', fieldValue: characterUpload.fileName },
    { nodeId: '107', fieldName: 'aspect_ratio', fieldValue: aspectRatio },
    { nodeId: '152', fieldName: 'text', fieldValue: destPrompt },
    { nodeId: '12', fieldName: 'text', fieldValue: 'Pertahankan ciri wajah karakter pada gambar agar tidak berubah' },
    { nodeId: '15', fieldName: 'text', fieldValue: masterPrompt },
  ]

  const body = { nodeInfoList, instanceType: 'default', usePersonalQueue: 'false' }
  const endpoint = RUNNINGHUB_BASE + '/openapi/v2/run/ai-app/' + effectiveWorkflowId

  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log('[runninghub] POST ' + endpoint + ' (travel-photo attempt ' + attempt + '/' + MAX_RETRIES + ')')

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'Authorization': 'Bearer ' + apiKey },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log('[runninghub] submit-travel-photo ' + apiRes.status + ': ' + lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      if (attempt < MAX_RETRIES) { await new Promise(r => setTimeout(r, RETRY_DELAY_MS)); continue }
      return res.status(200).json({ ok: false, error: 'Queue limit reached', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || 'Error code: ' + rhCode
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (taskId) {
      return res.status(200).json({
        ok: true,
        data: { id: taskId, taskId, status: data.data?.status || data.status || 'QUEUED', provider: 'runninghub', workflowId: effectiveWorkflowId },
      })
    }

    if (attempt < MAX_RETRIES) {
      await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
    }
  }

  return res.status(200).json({ ok: false, error: 'Gagal submit Travel Photo setelah beberapa percobaan', raw: lastRawText.slice(0, 500) })
}

async function handleSubmitImageEdit(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    prompt = '',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!prompt) return res.status(200).json({ ok: false, error: 'Missing prompt' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_IMAGE_EDIT_WORKFLOW_ID

  console.log(`[runninghub] Uploading image (image-edit)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-image-edit ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const IMG_CANDS = ['image', 'file', 'path', 'filename', 'input', 'src']
  const TXT_CANDS = ['text', 'prompt', 'positive']
  const nodeField: Record<string, string> = { '28': 'image', '31': 'text' }
  const droppedEntries = new Set<string>()
  const buildList = () => {
    const list: any[] = [
      { nodeId: '28', fieldName: nodeField['28'], fieldValue: imageUpload.fileName },
      { nodeId: '31', fieldName: nodeField['31'], fieldValue: String(prompt) },
    ]
    return droppedEntries.size === 0 ? list : list.filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
  }

  let lastErr = 'Unknown error'
  let lastData: any = null

  for (let round = 0; round < 14; round++) {
    const list = buildList()
    let r: Awaited<ReturnType<typeof postRun>> | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[runninghub] image-edit round=${round} (attempt ${attempt}/3)`)
      r = await postRun(list)
      if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
      if (r.http === 429 || r.code === 429) {
        return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
      }
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
      if (attempt < 3) await sleep(RETRY_DELAY_MS)
    }
    if (!r) break
    if (r.taskId) {
      return res.status(200).json({
        ok: true,
        data: {
          id: r.taskId,
          taskId: r.taskId,
          status: r.status,
          provider: 'runninghub',
          workflowId: effectiveWorkflowId,
        },
      })
    }
    if (r.code === 421 || r.code === '421') {
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
    }
    lastErr = r.msg || `Error code: ${r.code}`
    lastData = r.data
    const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
    if (mm && /field_not_found|node_not_found/i.test(mm.reason) && ['28', '31'].includes(mm.nodeId)) {
      if (/node_not_found/i.test(mm.reason)) {
        return res.status(200).json({ ok: false, error: `Node ${mm.nodeId} tidak ada di workflow ini`, data: r.data })
      }
      const cands = mm.nodeId === '31' ? TXT_CANDS : IMG_CANDS
      const cur = nodeField[mm.nodeId] || ''
      const nextIdx = cands.indexOf(cur) + 1
      if (nextIdx <= 0 || nextIdx >= cands.length) {
        return res.status(200).json({ ok: false, error: `Field ${mm.nodeId} ditolak semua kandidat. Terakhir: ${r.msg}`, data: r.data })
      }
      nodeField[mm.nodeId] = cands[nextIdx]
      console.log(`[runninghub] image-edit node ${mm.nodeId}: "${cur}" ditolak → coba "${cands[nextIdx]}"`)
      continue
    }
    if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
      console.log(`[runninghub] image-edit buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
      droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
      continue
    }
    const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
    return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
  }

  return res.status(200).json({ ok: false, error: `Gagal submit image-edit. Terakhir: ${lastErr}`, data: lastData })
}

const H3_ASPECTS = new Set([
  'original', 'custom', '1:1', '3:2', '4:3', '16:9', '2:3', '3:4', '9:16',
])

async function handleSubmitH3I2V(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    prompt = '',
    steps = 8,
    aspectRatio = 'original',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!prompt) return res.status(200).json({ ok: false, error: 'Missing prompt' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_H3_I2V_WORKFLOW_ID
  const effSteps = Math.max(1, Math.min(50, Number(steps) || 8))
  const effAspect = H3_ASPECTS.has(String(aspectRatio)) ? String(aspectRatio) : 'original'

  console.log(`[runninghub] Uploading image (h3-i2v)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-h3-i2v ${apiRes.status}:`, rawText.slice(0, 1000))
    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
    return {
      http: apiRes.status,
      data,
      raw: rawText.slice(0, 500),
      code: data.code ?? data.errorCode,
      msg: String(data.msg || data.errorMessage || data.message || ''),
      taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
      status: data.data?.status || data.status || 'QUEUED',
    }
  }

  const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
    const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
    return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
  }

  const IMG_CANDS = ['image', 'file', 'path', 'filename', 'input', 'src']
  const TXT_CANDS = ['text', 'prompt', 'positive']
  const nodeField: Record<string, string> = { '143': 'image', '181': 'text' }
  const droppedEntries = new Set<string>()
  const buildList = () => {
    const list: any[] = [
      { nodeId: '181', fieldName: nodeField['181'], fieldValue: String(prompt) },
      { nodeId: '143', fieldName: nodeField['143'], fieldValue: imageUpload.fileName },
      { nodeId: '126', fieldName: 'steps', fieldValue: String(effSteps) },
      { nodeId: '146', fieldName: 'aspect_ratio', fieldValue: effAspect },
    ]
    return droppedEntries.size === 0 ? list : list.filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
  }

  let lastErr = 'Unknown error'
  let lastData: any = null

  for (let round = 0; round < 14; round++) {
    const list = buildList()
    let r: Awaited<ReturnType<typeof postRun>> | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[runninghub] h3-i2v round=${round} (attempt ${attempt}/3)`)
      r = await postRun(list)
      if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
      if (r.http === 429 || r.code === 429) {
        return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
      }
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
      if (attempt < 3) await sleep(RETRY_DELAY_MS)
    }
    if (!r) break
    if (r.taskId) {
      return res.status(200).json({
        ok: true,
        data: {
          id: r.taskId,
          taskId: r.taskId,
          status: r.status,
          provider: 'runninghub',
          workflowId: effectiveWorkflowId,
        },
      })
    }
    if (r.code === 421 || r.code === '421') {
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
    }
    lastErr = r.msg || `Error code: ${r.code}`
    lastData = r.data
    const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
    if (mm && /field_not_found|node_not_found/i.test(mm.reason) && ['143', '181'].includes(mm.nodeId)) {
      if (/node_not_found/i.test(mm.reason)) {
        return res.status(200).json({ ok: false, error: `Node ${mm.nodeId} tidak ada di workflow ini`, data: r.data })
      }
      const cands = mm.nodeId === '181' ? TXT_CANDS : IMG_CANDS
      const cur = nodeField[mm.nodeId] || ''
      const nextIdx = cands.indexOf(cur) + 1
      if (nextIdx <= 0 || nextIdx >= cands.length) {
        return res.status(200).json({ ok: false, error: `Field ${mm.nodeId} ditolak semua kandidat. Terakhir: ${r.msg}`, data: r.data })
      }
      nodeField[mm.nodeId] = cands[nextIdx]
      console.log(`[runninghub] h3-i2v node ${mm.nodeId}: "${cur}" ditolak → coba "${cands[nextIdx]}"`)
      continue
    }
    if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
      console.log(`[runninghub] h3-i2v buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
      droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
      continue
    }
    const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
    return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
  }

  return res.status(200).json({ ok: false, error: `Gagal submit h3-i2v. Terakhir: ${lastErr}`, data: lastData })
}

async function handleSubmitSeedance2(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'reference.jpg',
    imageMimeType = 'image/jpeg',
    prompt = '',
    aspectRatio = SEEDANCE2_ASPECT_FALLBACK,
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!prompt) return res.status(200).json({ ok: false, error: 'Missing prompt storyboard' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_SEEDANCE2_WORKFLOW_ID
  const effAspect = SEEDANCE2_ASPECTS.has(String(aspectRatio)) ? String(aspectRatio) : SEEDANCE2_ASPECT_FALLBACK

  try {
    console.log(`[runninghub] Uploading image (seedance2)...`)
    const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
    console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

    const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
    const RETRY_DELAY_MS = 10000
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const nodeField: Record<string, string> = { [SEEDANCE2_IMAGE_NODE]: 'image' }
    const IMG_CANDS = ['image', 'file', 'path', 'filename', 'input', 'src']
    const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
      const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
      return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
    }

    const buildList = () => [
      { nodeId: SEEDANCE2_IMAGE_NODE, fieldName: nodeField[SEEDANCE2_IMAGE_NODE], fieldValue: imageUpload.fileName },
      { nodeId: SEEDANCE2_TEXT_NODE, fieldName: 'text', fieldValue: String(prompt) },
      { nodeId: SEEDANCE2_ASPECT_NODE, fieldName: 'aspect_ratio', fieldValue: effAspect },
    ]

    const droppedEntries = new Set<string>()
    let lastErr = 'Unknown error'
    let lastData: any = null
    let r: any = null

    for (let round = 0; round < 8; round++) {
      const list = buildList().filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] seedance2 round=${round} (attempt ${attempt}/3)`)
        const apiRes = await rhFetch(apiKey, endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
        })
        const rawText = await apiRes.text()
        console.log(`[runninghub] submit-seedance2 ${apiRes.status}:`, rawText.slice(0, 1000))
        let data: any
        try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
        r = {
          http: apiRes.status,
          data,
          code: data.code ?? data.errorCode,
          msg: String(data.msg || data.errorMessage || data.message || ''),
          taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
          status: data.data?.status || data.status || 'QUEUED',
        }
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: effectiveWorkflowId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason) && mm.nodeId === SEEDANCE2_IMAGE_NODE) {
        if (/node_not_found/i.test(mm.reason)) {
          return res.status(200).json({ ok: false, error: `Node ${mm.nodeId} tidak ada di workflow ini`, data: r.data })
        }
        const cur = nodeField[mm.nodeId] || ''
        const nextIdx = IMG_CANDS.indexOf(cur) + 1
        if (nextIdx <= 0 || nextIdx >= IMG_CANDS.length) {
          return res.status(200).json({ ok: false, error: `Field ${mm.nodeId} ditolak semua kandidat. Terakhir: ${r.msg}`, data: r.data })
        }
        nodeField[mm.nodeId] = IMG_CANDS[nextIdx]
        console.log(`[runninghub] seedance2 node ${mm.nodeId}: "${cur}" ditolak → coba "${IMG_CANDS[nextIdx]}"`)
        continue
      }
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        console.log(`[runninghub] seedance2 buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }

    return res.status(200).json({ ok: false, error: `Gagal submit seedance2. Terakhir: ${lastErr}`, data: lastData })
  } catch (err: any) {
    console.error('[runninghub] seedance2 error:', err.message)
    return res.status(200).json({ ok: false, error: err.message || 'Seedance2 gagal' })
  }
}

async function handleSubmitSeedance26(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    images = [],
    prompt = '',
    aspectRatio = SEEDANCE26_ASPECT_FALLBACK,
  } = params

  const imageList: Array<{ base64: string; fileName?: string; mimeType?: string }> = Array.isArray(images)
    ? images.filter((im: any) => im && im.base64).slice(0, SEEDANCE26_MAX_IMAGES)
    : []
  if (imageList.length === 0) return res.status(200).json({ ok: false, error: 'Missing images' })
  if (!prompt) return res.status(200).json({ ok: false, error: 'Missing prompt storyboard' })

  const appId = workflow_id || workflowId || RUNNINGHUB_SEEDANCE26_APP_ID
  const effAspect = SEEDANCE26_ASPECTS.has(String(aspectRatio)) ? String(aspectRatio) : SEEDANCE26_ASPECT_FALLBACK

  try {
    const uploaded: string[] = []
    for (let i = 0; i < imageList.length; i++) {
      const im = imageList[i]
      console.log(`[runninghub] Uploading image ${i + 1}/${imageList.length} (seedance2.6)...`)
      const up = await rhUpload(apiKey, im.base64, im.fileName || `reference${i + 1}.jpg`, im.mimeType || 'image/jpeg')
      uploaded.push(up.fileName)
    }
    console.log(`[runninghub] seedance2.6 images uploaded: ${uploaded.length}`)

    const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${appId}`
    const RETRY_DELAY_MS = 10000
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const nodeField: Record<string, string> = {}
    SEEDANCE26_IMAGE_NODES.forEach((n) => { nodeField[n] = 'image' })
    const IMG_CANDS = ['image', 'file', 'path', 'filename', 'input', 'src']
    const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
      const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
      return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
    }

    const buildList = () => {
      const list: Array<{ nodeId: string; fieldName: string; fieldValue: string }> = []
      uploaded.forEach((fileName, i) => {
        const node = SEEDANCE26_IMAGE_NODES[i]
        list.push({ nodeId: node, fieldName: nodeField[node], fieldValue: fileName })
      })
      list.push({ nodeId: SEEDANCE26_TEXT_NODE, fieldName: 'text', fieldValue: String(prompt) })
      list.push({ nodeId: SEEDANCE26_ASPECT_NODE, fieldName: 'aspect_ratio', fieldValue: effAspect })
      return list
    }

    const droppedEntries = new Set<string>()
    let lastErr = 'Unknown error'
    let lastData: any = null
    let r: any = null

    for (let round = 0; round < 8; round++) {
      const list = buildList().filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] seedance2.6 round=${round} (attempt ${attempt}/3)`)
        const apiRes = await rhFetch(apiKey, endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
        })
        const rawText = await apiRes.text()
        console.log(`[runninghub] submit-seedance2.6 ${apiRes.status}:`, rawText.slice(0, 1000))
        let data: any
        try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
        r = {
          http: apiRes.status,
          data,
          code: data.code ?? data.errorCode,
          msg: String(data.msg || data.errorMessage || data.message || ''),
          taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
          status: data.data?.status || data.status || 'QUEUED',
        }
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: appId,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason) && SEEDANCE26_IMAGE_NODES.includes(mm.nodeId)) {
        if (/node_not_found/i.test(mm.reason)) {
          droppedEntries.add(`${mm.nodeId}/${nodeField[mm.nodeId]}`)
          console.log(`[runninghub] seedance2.6 node ${mm.nodeId} tidak ada, dibuang`)
          continue
        }
        const cur = nodeField[mm.nodeId] || ''
        const nextIdx = IMG_CANDS.indexOf(cur) + 1
        if (nextIdx <= 0 || nextIdx >= IMG_CANDS.length) {
          droppedEntries.add(`${mm.nodeId}/${cur}`)
          console.log(`[runninghub] seedance2.6 field ${mm.nodeId} ditolak semua kandidat, dibuang`)
          continue
        }
        nodeField[mm.nodeId] = IMG_CANDS[nextIdx]
        console.log(`[runninghub] seedance2.6 node ${mm.nodeId}: "${cur}" ditolak → coba "${IMG_CANDS[nextIdx]}"`)
        continue
      }
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        console.log(`[runninghub] seedance2.6 buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason})`)
        droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }

    return res.status(200).json({ ok: false, error: `Gagal submit seedance2.6. Terakhir: ${lastErr}`, data: lastData })
  } catch (err: any) {
    console.error('[runninghub] seedance2.6 error:', err.message)
    return res.status(200).json({ ok: false, error: err.message || 'Seedance2.6 gagal' })
  }
}

async function handleSubmitUGCStoryboard(apiKey: string, params: any, res: Response) {
  const {
    characterImageBase64,
    characterImageFileName = 'character.jpg',
    characterImageMimeType = 'image/jpeg',
    sceneImages = [],
    prompt = 'follow prompt storyboards',
    duration = 15,
    aspectRatio = '9:16 (Portrait Widescreen)',
  } = params

  if (!characterImageBase64) return res.status(200).json({ ok: false, error: 'Missing characterImageBase64' })
  if (!Array.isArray(sceneImages) || sceneImages.length === 0) {
    return res.status(200).json({ ok: false, error: 'Missing sceneImages (minimal 1 gambar scene)' })
  }

  const scenes = sceneImages.slice(0, 4)
  const effDuration = Math.max(1, Math.min(15, Number(duration) || 15))
  const effAspect = UGC_ASPECTS.has(String(aspectRatio)) ? String(aspectRatio) : '9:16 (Portrait Widescreen)'

  try {
    console.log(`[runninghub] Uploading character image (ugc-storyboard)...`)
    const charUpload = await rhUpload(apiKey, characterImageBase64, characterImageFileName, characterImageMimeType)
    console.log(`[runninghub] Character uploaded: ${charUpload.fileName}`)

    const sceneFileNames: string[] = []
    for (let i = 0; i < scenes.length; i++) {
      const s = scenes[i]
      console.log(`[runninghub] Uploading scene ${i + 1}/${scenes.length} (ugc-storyboard)...`)
      const up = await rhUpload(apiKey, s.base64, s.fileName || `scene${i + 1}.jpg`, s.mimeType || 'image/jpeg')
      sceneFileNames.push(up.fileName)
      console.log(`[runninghub] Scene ${i + 1} uploaded: ${up.fileName}`)
    }

    const buildList = () => {
      const list: any[] = [
        { nodeId: '114', fieldName: 'image', fieldValue: charUpload.fileName },
        { nodeId: '162', fieldName: 'image', fieldValue: charUpload.fileName },
        { nodeId: '135', fieldName: 'value', fieldValue: String(effDuration) },
        { nodeId: '115', fieldName: 'aspect_ratio', fieldValue: effAspect },
        { nodeId: '136', fieldName: 'text', fieldValue: String(prompt) },
      ]
      for (let i = 0; i < UGC_SCENE_NODES.length; i++) {
        list.push({
          nodeId: UGC_SCENE_NODES[i],
          fieldName: 'image',
          fieldValue: sceneFileNames[i] || 'None',
        })
      }
      return list
    }

    const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${RUNNINGHUB_UGC_WORKFLOW_ID}`
    const RETRY_DELAY_MS = 10000
    const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

    const parseMismatch = (msg: string): { nodeId: string; fieldName: string; reason: string } | null => {
      const m = /nodeId=([^,)]+),\s*fieldName=([^,)]+),\s*reason=([^,)]+)/.exec(msg)
      return m ? { nodeId: m[1].trim(), fieldName: m[2].trim(), reason: m[3].trim() } : null
    }

    const droppedEntries = new Set<string>()
    let lastErr = 'Unknown error'
    let lastData: any = null

    for (let round = 0; round < 8; round++) {
      const list = buildList().filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
      let r: any = null
      for (let attempt = 1; attempt <= 3; attempt++) {
        console.log(`[runninghub] ugc-storyboard round=${round} (attempt ${attempt}/3)`)
        const apiRes = await rhFetch(apiKey, endpoint, {
          method: 'POST',
          headers: {
            'Content-Type': 'application/json',
            'Authorization': `Bearer ${apiKey}`,
          },
          body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
        })
        const rawText = await apiRes.text()
        console.log(`[runninghub] submit-ugc-storyboard ${apiRes.status}:`, rawText.slice(0, 1000))
        let data: any
        try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }
        r = {
          http: apiRes.status,
          data,
          code: data.code ?? data.errorCode,
          msg: String(data.msg || data.errorMessage || data.message || ''),
          taskId: data.data?.taskId || data.taskId || data.id || data.task_id,
          status: data.data?.status || data.status || 'QUEUED',
        }
        if (r.taskId || (r.http !== 429 && r.code !== 429 && r.code !== 421 && r.code !== '421')) break
        if (r.http === 429 || r.code === 429) {
          return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data: r.data, retryable: true })
        }
        console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s...`)
        if (attempt < 3) await sleep(RETRY_DELAY_MS)
      }
      if (!r) break
      if (r.taskId) {
        return res.status(200).json({
          ok: true,
          data: {
            id: r.taskId,
            taskId: r.taskId,
            status: r.status,
            provider: 'runninghub',
            workflowId: RUNNINGHUB_UGC_WORKFLOW_ID,
          },
        })
      }
      if (r.code === 421 || r.code === '421') {
        return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data: r.data, retryable: true })
      }
      lastErr = r.msg || `Error code: ${r.code}`
      lastData = r.data
      const mm = r.code === 803 || r.code === '803' ? parseMismatch(r.msg) : null
      if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
        if (/node_not_found/i.test(mm.reason)) {
          return res.status(200).json({ ok: false, error: `Node ${mm.nodeId} tidak ada di workflow UGC ini`, data: r.data })
        }
        console.log(`[runninghub] ugc-storyboard buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
        droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
        continue
      }
      const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
      return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
    }

    return res.status(200).json({ ok: false, error: `Gagal submit ugc-storyboard. Terakhir: ${lastErr}`, data: lastData })
  } catch (err: any) {
    console.error('[runninghub] ugc-storyboard error:', err.message)
    return res.status(200).json({ ok: false, error: err.message || 'UGC storyboard gagal' })
  }
}

async function handleMotionControl(apiKey: string, params: any, res: Response) {
  const {
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!videoBase64) return res.status(200).json({ ok: false, error: 'Missing videoBase64' })

  const effectiveWorkflowId = RUNNINGHUB_DEFAULT_WORKFLOW_ID

  console.log(`[runninghub] Uploading image...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading video...`)
  const videoUpload = await rhUpload(apiKey, videoBase64, videoFileName, videoMimeType)
  console.log(`[runninghub] Video uploaded: ${videoUpload.fileName}`)

  // Workflow API: nodeInfoList uses node IDs from the workflow
  const nodeInfoList: any[] = [
    {
      nodeId: '47',
      fieldName: 'image',
      fieldValue: imageUpload.fileName,
    },
    {
      nodeId: '46',
      fieldName: 'video',
      fieldValue: videoUpload.fileName,
    },
  ]

  const body = {
    nodeInfoList,
    instanceType: 'default',
    usePersonalQueue: 'false',
  }

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`

  // Retry up to 3 times for error 421 (queue limit)
  const MAX_RETRIES = 3
  const RETRY_DELAY_MS = 10000
  let lastRawText = ''

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] motion-control ${apiRes.status}:`, lastRawText.slice(0, 1000))

    let data: any
    try { data = JSON.parse(lastRawText) } catch { data = { raw: lastRawText } }

    const rhCode = data.code ?? data.errorCode
    const rhMsg = data.msg || data.errorMessage || data.message

    if (apiRes.status === 429 || rhCode === 429) {
      return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
    }

    if (rhCode === 421 || rhCode === '421') {
      console.log(`[runninghub] Queue limit (421), retrying in ${RETRY_DELAY_MS / 1000}s... (${attempt}/${MAX_RETRIES})`)
      if (attempt < MAX_RETRIES) {
        await new Promise(r => setTimeout(r, RETRY_DELAY_MS))
        continue
      }
      return res.status(200).json({ ok: false, error: 'Queue limit reached, coba lagi dalam beberapa menit', data, retryable: true })
    }

    if (rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
      const errorMsg = translateRhError(String(rhCode), rhMsg) || rhMsg || `Error code: ${rhCode}`
      return res.status(200).json({ ok: false, error: errorMsg, code: rhCode, data })
    }

    const taskId = data.data?.taskId || data.taskId || data.id || data.task_id
    if (!taskId) {
      console.error(`[runninghub] No taskId found:`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: rhTaskErrorFrom(data) || 'No taskId returned', raw: lastRawText.slice(0, 500) })
    }

    const netWssUrl = data.data?.netWssUrl
    return res.status(200).json({
      ok: true,
      data: {
        id: taskId,
        taskId,
        status: data.data?.status || data.status || 'QUEUED',
        netWssUrl,
        provider: 'runninghub',
      },
    })
  }

  return res.status(200).json({ ok: false, error: 'Max retries exceeded', raw: lastRawText.slice(0, 500) })
}

async function handleQuery(apiKey: string, taskId: string, res: Response) {
  if (!taskId) return res.status(200).json({ ok: false, error: 'Missing taskId' })

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/query`

  const apiRes = await rhFetch(apiKey, endpoint, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      'Authorization': `Bearer ${apiKey}`,
    },
    body: JSON.stringify({ taskId }),
    signal: AbortSignal.timeout(30000),
  })

  const rawText = await apiRes.text()
  console.log(`[runninghub] query ${apiRes.status}:`, rawText.slice(0, 8000))

  let data: any
  try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

  const rhCode = data.code ?? data.errorCode
  const errorMsg = data.msg || data.errorMessage || data.message

  if (apiRes.status === 429 || rhCode === 429) {
    return res.status(200).json({ ok: false, error: 'Rate limit exceeded', data, retryable: true })
  }

  const taskData = data.data || data
  const status = (taskData.status || data.status || '').toUpperCase()

  let mappedStatus = 'RUNNING'
  if (status === 'COMPLETED' || status === 'SUCCESS' || status === 'FINISHED') mappedStatus = 'COMPLETED'
  else if (status === 'FAILED') mappedStatus = 'FAILED'
  else if (status === 'QUEUED') mappedStatus = 'QUEUED'

  // Task FAILED punya errorCode top-level (mis. 805) — jangan dipotong di sini,
  // kembalikan status FAILED + detail failedReason supaya traceback sampai ke client.
  if (mappedStatus !== 'FAILED' && rhCode !== undefined && rhCode !== 0 && rhCode !== '0' && rhCode !== '') {
    return res.status(200).json({ ok: false, error: translateRhError(String(rhCode), errorMsg) || errorMsg || `Error code: ${rhCode}`, data })
  }

  let videoUrl: string | null = null
  let imageUrl: string | null = null
  let audioUrl: string | null = null
  // Semua hasil gambar (workflow seperti Travel Photo menghasilkan >1 foto).
  const imageUrls: string[] = []
  if (mappedStatus === 'COMPLETED') {
    const results = taskData.results || taskData.output || data.results || taskData.outputs || data.outputs
    const pickUrl = (r: any): string | null =>
      r?.url || r?.uri || r?.download_url || (typeof r === 'string' ? r : null)
    const isVideo = (r: any, url: string | null): boolean =>
      !!url && (/\.(mp4|webm|mov|m4v)$/i.test(url.split('?')[0]) || /video/i.test(String(r?.outputType || '')))
    const isImage = (r: any, url: string | null): boolean =>
      !!url && (/\.(png|jpe?g|webp|gif|bmp)$/i.test(url.split('?')[0]) || /image/i.test(String(r?.outputType || '')))
    const isAudio = (r: any, url: string | null): boolean =>
      !!url && (/\.(mp3|wav|m4a|aac|ogg|flac)$/i.test(url.split('?')[0]) || /audio|mp3|wav/i.test(String(r?.outputType || '')))
    if (Array.isArray(results) && results.length > 0) {
      for (const r of results) {
        const url = pickUrl(r)
        if (isVideo(r, url)) { videoUrl = url; break }
      }
      if (!videoUrl) {
        for (const r of results) {
          const url = pickUrl(r)
          if (isAudio(r, url)) { audioUrl = url; break }
        }
      }
      if (!videoUrl && !audioUrl) {
        for (const r of results) {
          const url = pickUrl(r)
          if (url && (typeof r === 'string' || (r?.outputType && r.outputType !== 'text'))) { videoUrl = url; break }
        }
      }
      if (!videoUrl && !audioUrl) videoUrl = pickUrl(results[0])
      for (const r of results) {
        const url = pickUrl(r)
        if (isImage(r, url)) {
          if (!imageUrl) imageUrl = url
          if (url && !imageUrls.includes(url)) imageUrls.push(url)
        }
      }
      if (!imageUrl && videoUrl && /\.(png|jpe?g|webp|gif|bmp)$/i.test(videoUrl.split('?')[0])) {
        imageUrl = videoUrl
      }
    } else if (typeof results === 'string') {
      videoUrl = results
    }
  }

  const fr = taskData.failedReason || data.failedReason || null
  let failedDetail: string | null = null
  if (mappedStatus === 'FAILED') {
    if (typeof fr === 'object' && fr && (fr.node_name || fr.exception_type)) {
      let tb = ''
      if (typeof fr.traceback === 'string') {
        try { tb = JSON.parse(fr.traceback).join(' | ') } catch { tb = fr.traceback }
      }
      if (Array.isArray(fr.traceback)) tb = fr.traceback.join(' | ')
      failedDetail = `[${taskData.errorCode || data.errorCode || ''}] node=${fr.node_name || '?'} type=${fr.exception_type || '?'}${tb ? ` — ${String(tb).slice(-700)}` : ''}`
    } else if (fr && typeof fr === 'object') {
      failedDetail = `[${taskData.errorCode || data.errorCode || ''}] ${JSON.stringify(fr)}`
    }
  }

  return res.status(200).json({
    ok: true,
    data: {
      id: taskId,
      taskId,
      status: mappedStatus,
      progress: taskData.progress || data.progress || 0,
      videoUrl,
      imageUrl,
      imageUrls,
      audioUrl,
      usage: taskData.usage || data.usage || null,
      code: taskData.errorCode || data.errorCode || null,
      error: mappedStatus === 'FAILED' ? (failedDetail || taskData.errorMessage || taskData.msg || errorMsg || 'Task failed') : null,
      promptTips: taskData.promptTips || data.promptTips || null,
      provider: 'runninghub',
    },
  })
}

// Kode yang berarti API key-nya sendiri ditolak RunningHub. Selain ini
// (saldo, izin workflow, gangguan upstream) key tetap sehat dan TIDAK boleh
// ditandai invalid — dulu semua kegagalan cek saldo membuat key mati permanen.
export const RH_KEY_REJECT_CODES = new Set(['401', '412', '806', '811', '814', '1002', '1003'])

function translateRhError(code: string, msg?: string): string {
  const map: Record<string, string> = {
    '414': 'RunningHub menolak task: saldo POWER/poin akun tidak cukup. Koin RH yang tampil di situs terpisah dari power — isi power/poin di runninghub.ai (Membership/Power), atau pakai akun lain.',
    '433': 'Saldo poin akun RunningHub tidak cukup untuk task ini (jalur web menagih saldo akun). Isi/top up poin di runninghub.ai atau pakai akun dengan saldo.',
    '423': 'Task ditolak: butuh keanggotaan/mode yang lebih tinggi di akun RunningHub.',
    '424': 'Batas task bersamaan (concurrent) akun RunningHub tercapai. Tunggu task lain selesai atau naikkan paket.',
    '605': 'Saldo akun RunningHub tidak cukup untuk model ini — token/key tetap valid. Isi/top up saldo di runninghub.ai atau pakai akun dengan saldo.',
    '404': 'Workflow tidak ditemukan atau tidak dapat diakses API key ini.',
    '403': 'Akses ditolak. API key tidak berhak mengakses workflow ini.',
    '412': 'Access token ditolak RunningHub (412 TOKEN_INVALID) — sesi login sudah tidak berlaku (logout / login ulang / di-rotate). Salin access token baru dari sesi runninghub.ai yang masih login, lalu ganti Key ini di Providers.',
    '806': 'API key tidak dikenali RunningHub (user pemilik key tidak ditemukan). Key mungkin sudah dihapus/di-rotate atau berasal dari akun runninghub.cn — buat API key baru di runninghub.ai → API Keys, lalu paste ulang.',
    '807': 'Task tidak ditemukan di RunningHub (mungkin sudah kedaluwarsa / dibersihkan).',
    '811': 'API key Enterprise tidak valid atau akun tidak punya izin enterprise.',
    '814': 'API key Enterprise tidak valid atau akun tidak punya izin enterprise.',
    '1014': 'Model ini hanya bisa dipanggil dengan API key Enterprise-Shared. Buat key dari akun tim/enterprise RunningHub, lalu tambahkan di Providers.',
    '1001': 'Endpoint/URL RunningHub yang dipanggil tidak dikenali (kemungkinan perubahan API upstream).',
    '1002': 'API key tidak valid.',
    '1003': 'API key tidak valid atau telah kedaluwarsa.',
    '1004': 'Workflow tidak ditemukan.',
    '1601': 'Request ke RunningHub tidak membawa field apiKey.',
    '1602': 'Header Authorization (Bearer API key) tidak terkirim ke RunningHub.',
    '5101': 'Gagal membuat task, coba lagi.',
  }
  if (RH_KEY_REJECT_CODES.has(code)) return map[code] || msg || `API key ditolak RunningHub (${code})`
  // Kode yang sudah punya pesan spesifik harus menang atas pencocokan teks di
  // bawah: upstream mengirim 414 bersama "NOT_ENOUGH_POWER", sehingga pesan
  // umum sempat menutupi penjelasan power vs koin RH.
  if (map[code]) return map[code]
  if (msg && /API balance is insufficient/i.test(msg)) {
    return 'Saldo LLM API RunningHub tidak cukup (terpisah dari koin RH). Isi ulang "LLM API Balance" di RunningHub lalu coba lagi.'
  }
  if (msg && /WORKFLOW_NOT_EXISTS/i.test(msg)) {
    return 'App/workflow tidak ditemukan untuk kredensial ini — RunningHub menolak karena app bukan milik akun/token ini atau sudah dipindah/dihapus. Pastikan appId/workflow benar dan token berasal dari akun pemilik app.'
  }
  if (msg && /NOT_ENOUGH_POWER|balance|insufficient|coin/i.test(msg)) {
    return 'Saldo/kuota kerja tidak cukup. RunningHub menagih task platform dengan power/poin (terpisah dari koin RH). Top up power di akun RunningHub atau pakai akun lain.'
  }
  return msg || `Error RunningHub (${code})`
}

/**
 * Jalur playground mengembalikan code:0 di level atas dengan errorCode di
 * dalam data (mis. 605 = saldo habis). Tanpa ini, kegagalan itu terbaca
 * "No taskId returned" dan pengguna tidak tahu penyebab sebenarnya.
 */
function rhTaskErrorFrom(data: any): string | null {
  const code = data?.data?.errorCode ?? data?.errorCode
  if (code === undefined || code === null || code === '') return null
  const msg = data?.data?.errorMessage || data?.errorMessage
  return translateRhError(String(code), msg) || msg || `Error code: ${code}`
}

// accountStatus mengembalikan saldo dengan nama field yang berbeda antar
// generasi API — baca semuanya, jangan hanya remainCoins.
const RH_BALANCE_FIELDS = ['remainCoins', 'remainCoin', 'coins', 'coin', 'balance', 'power', 'remainPower']

export interface RHTokenCredit {
  total: number
  used: number
  remaining: number
  models: string[]
}

// Saldo yang bisa dibaca dari access token. Endpoint koin lama
// (/uc/openapi/accountStatus) hanya menerima API key asli, jadi untuk JWT kita
// baca paket sesi yang memang tersedia: kredit gratis (video/image) + poin
// harian. Ini angka nyata milik akun, bukan tebakan.
export interface RHTokenWallet {
  points: number | null
  pointsExpiresAt: string | null
  freeVideo: RHTokenCredit | null
  freeImage: RHTokenCredit | null
  freePeriodEnd: string | null
  /**
   * RH Coin (koin situs). Pada billing lama ini dompet utama; pada billing baru
   * ("NEW") koin sudah dikonversi ke poin sehingga nilainya biasanya 0.
   */
  coins: number | null
  /**
   * Saldo poin akun dari /uc/point/summary (bisa negatif bila pernah minus).
   * Inilah yang benar-benar dipotong saat generate di billing baru
   * (settleMode POINT), jadi wajib ditampilkan bersama RH Coin.
   */
  pointsBalance: number | null
  /** Versi billing RunningHub: "NEW" (poin) atau "OLD" (koin). */
  billingVersion: string | null
  /**
   * Apakah hasil generate akun ini TANPA watermark "RunningHub".
   * RunningHub memberi hak "作品免水印" (hasil tanpa watermark) hanya ke akun
   * tier berbayar; akun gratis (memberInfo.userType "3") selalu diberi watermark.
   * null = tidak diketahui (endpoint user info tidak terbaca).
   */
  watermarkFree: boolean | null
}

const RH_WALLET_CACHE_MS = 60 * 1000
const rhWalletCache = new Map<string, { value: RHTokenWallet; at: number }>()

function rhNum(v: unknown): number | null {
  if (v === null || v === undefined || v === '') return null
  const n = Number(v)
  return Number.isFinite(n) ? n : null
}

/** POST JSON dengan sesi JWT; null kalau gagal / bukan code 0. */
async function rhTokenJson(jwt: string, path: string, ms = 15000): Promise<any | null> {
  try {
    const res = await fetch(`${RUNNINGHUB_BASE}${path}`, {
      method: 'POST',
      headers: rhAuthHeaders(jwt),
      body: '{}',
      signal: AbortSignal.timeout(ms),
    })
    const text = await res.text()
    const data = JSON.parse(text)
    if (!data || (data.code !== 0 && data.code !== '0') || !data.data) return null
    return data.data
  } catch {
    return null
  }
}

/** Data akun (memberInfo, paket aktif) dari /uc/getUserInfo — null kalau gagal. */
async function rhTokenUserInfo(jwt: string): Promise<any | null> {
  const userId = rhJwtSub(jwt)
  if (!userId) return null
  try {
    const res = await fetch(`${RUNNINGHUB_BASE}/uc/getUserInfo`, {
      method: 'POST',
      headers: rhAuthHeaders(jwt),
      body: JSON.stringify({ userId }),
      signal: AbortSignal.timeout(15000),
    })
    const data = JSON.parse(await res.text())
    if (!data || (data.code !== 0 && data.code !== '0') || !data.data) return null
    return data.data
  } catch {
    return null
  }
}

/**
 * Apakah akun punya hak "hasil tanpa watermark" (作品免水印).
 * RunningHub memberi hak ini hanya ke paket/member berbayar — akun gratis
 * (memberInfo.userType "3") hasil generate-nya selalu diberi watermark
 * "RunningHub" di pojok kiri atas.
 */
function rhWatermarkFree(user: any): boolean | null {
  if (!user || typeof user !== 'object') return null
  const m = user.memberInfo
  if (!m || typeof m !== 'object') return false
  if (String(m.userType ?? '') === '1') return true
  if (m.memberCode) {
    const exp = m.memberExpiredTime ? Date.parse(String(m.memberExpiredTime)) : NaN
    return Number.isFinite(exp) ? exp > Date.now() : true
  }
  if (m.memberExpiredTime) {
    const exp = Date.parse(String(m.memberExpiredTime))
    if (Number.isFinite(exp)) return exp > Date.now()
  }
  return false
}

async function rhTokenWallet(jwt: string): Promise<RHTokenWallet | null> {
  const fp = rhTokenFingerprint(jwt)
  const cached = rhWalletCache.get(fp)
  if (cached && Date.now() - cached.at < RH_WALLET_CACHE_MS) return cached.value

  // Tiga sumber berjalan berbarengan; salah satu gagal tetap menghasilkan
  // wallet selama yang lain terbaca — dulu hanya /api/welfare/summary sehingga
  // RH Coin (totalCoin/transitionCoinRemained) tidak pernah tampil.
  const [welfare, points, user] = await Promise.all([
    rhTokenJson(jwt, '/api/welfare/summary'),
    rhTokenJson(jwt, '/uc/point/summary'),
    rhTokenUserInfo(jwt),
  ])
  if (!welfare && !points) return null

  const credit = (c: any): RHTokenCredit | null => {
    if (!c || typeof c !== 'object') return null
    return {
      total: rhNum(c.total) ?? 0,
      used: rhNum(c.used) ?? 0,
      remaining: rhNum(c.remaining) ?? 0,
      models: Array.isArray(c.modelNames) ? c.modelNames.map(String) : [],
    }
  }

  const wallet: RHTokenWallet = {
    points: rhNum(welfare?.dailyGift?.amount),
    pointsExpiresAt: typeof welfare?.dailyGift?.expireTime === 'string' ? welfare.dailyGift.expireTime : null,
    freeVideo: credit(welfare?.freeVideo),
    freeImage: credit(welfare?.freeImage),
    freePeriodEnd: typeof welfare?.freePeriod?.endTime === 'string' ? welfare.freePeriod.endTime : null,
    coins: rhNum(points?.transitionCoinRemained),
    pointsBalance: rhNum(points?.balancePoint),
    billingVersion: typeof points?.billingVersion === 'string' ? points.billingVersion : null,
    watermarkFree: rhWatermarkFree(user),
  }
  if (rhWalletCache.size > 50) rhWalletCache.clear()
  rhWalletCache.set(fp, { value: wallet, at: Date.now() })
  return wallet
}

/** Angka saldo: bulatkan ke 2 desimal tanpa nol berekor ("-58.511" → "-58.51"). */
function rhFmtBalance(n: number): string {
  return String(Math.round(n * 100) / 100)
}

/** Ringkasan singkat untuk pesan UI, mis. "saldo poin 145 · kredit video 3/3 · poin harian 30". */
function rhWalletSummary(wallet: RHTokenWallet | null): string {
  if (!wallet) return ''
  const parts: string[] = []
  // Poin adalah saldo yang dipotong saat generate. RH Coin sudah tidak dipakai
  // RunningHub (billing baru mengonversinya ke poin) — jadi tidak ditampilkan
  // lagi; koin hanya jadi cadangan bila saldo poin tidak terbaca sama sekali.
  if (wallet.pointsBalance !== null) parts.push(`saldo poin ${rhFmtBalance(wallet.pointsBalance)}`)
  else if (wallet.coins !== null && wallet.coins > 0) parts.push(`saldo koin ${rhFmtBalance(wallet.coins)}`)
  if (wallet.freeVideo) parts.push(`kredit video ${wallet.freeVideo.remaining}/${wallet.freeVideo.total}`)
  if (wallet.freeImage) parts.push(`kredit image ${wallet.freeImage.remaining}/${wallet.freeImage.total}`)
  if (wallet.points !== null) parts.push(`poin harian ${rhFmtBalance(wallet.points)}`)
  // Watermark: hasilRunningHub gratis selalu diberi stempel "RunningHub".
  if (wallet.watermarkFree === false) parts.push('hasil bertimestamp (akun gratis)')
  else if (wallet.watermarkFree === true) parts.push('hasil tanpa watermark')
  return parts.join(' · ')
}

function rhKeyTypeLabel(apiType: unknown): string | null {
  if (typeof apiType !== 'string' || !apiType.trim()) return null
  const t = apiType.toLowerCase()
  if (t.includes('consum') || t.includes('personal') || t.includes('member')) return 'Consumer-Member'
  if (t.includes('exclusiv')) return 'Enterprise-Exclusive'
  if (t.includes('enterprise') || t.includes('shared') || t.includes('team')) return 'Enterprise-Shared'
  return apiType
}

export type RhDailyClaimOutcome = 'claimed' | 'already' | 'rejected' | 'error'

export interface RhDailyClaimResult {
  outcome: RhDailyClaimOutcome
  code: string | null
  message: string
  wallet?: RHTokenWallet | null
}

/** Balasan "sudah diklaim hari ini" beragam (CN/EN) — semuanya bukan kegagalan. */
const RH_ALREADY_CLAIMED_RE = /already|repeat|duplicate|claimed|领取|已领|重复/i

/**
 * Klaim hadiah harian RunningHub (30 poin/hari, dari /api/welfare/daily-gift/claim).
 * Hanya bisa memakai access token milik pengguna sendiri — hadiahnya terikat
 * akun, jadi tidak boleh diklaim memakai token server.
 *
 * Hasilnya dipakai dua jalur: handler HTTP (butuh wallet untuk UI) dan cron
 * server (tanpa wallet — 35 token × 3 panggilan wallet hanya membebani upstream).
 */
export async function rhClaimDailyGift(
  apiKey: string,
  opts: { wallet?: boolean } = {},
): Promise<RhDailyClaimResult> {
  if (rhJwtExp(apiKey) === null) {
    return {
      outcome: 'rejected',
      code: null,
      message: 'Klaim hadiah harian hanya bisa lewat access token (JWT) RunningHub, bukan API key.',
    }
  }
  if (rhJwtExpired(apiKey)) {
    return {
      outcome: 'rejected',
      code: null,
      message: 'Access token kedaluwarsa — salin token baru dari sesi runninghub.ai yang masih login, lalu ganti Key ini.',
    }
  }

  try {
    const upstream = await fetch(`${RUNNINGHUB_BASE}/api/welfare/daily-gift/claim`, {
      method: 'POST',
      headers: rhAuthHeaders(apiKey),
      body: '{}',
      signal: AbortSignal.timeout(20000),
    })
    const text = await upstream.text()
    console.log(`[runninghub] claim-daily-gift ${upstream.status}:`, text.slice(0, 300))
    let data: any = null
    try { data = JSON.parse(text) } catch { data = null }

    const code = data?.code === undefined || data?.code === null ? null : String(data.code)
    const msg = String(data?.msg || data?.message || '')

    // Buang cache wallet supaya saldo terbaru langsung terbaca.
    rhWalletCache.delete(rhTokenFingerprint(apiKey))
    const wallet = opts.wallet === false ? null : await rhTokenWallet(apiKey)

    // HTML (502 nginx/maintenance) atau JSON tanpa code bukan bukti klaim
    // berhasil — dulu balasan seperti itu dihitung sukses karena code kosong.
    if (!data || upstream.status >= 500) {
      return {
        outcome: 'error',
        code,
        message: `RunningHub tidak membalas JSON (HTTP ${upstream.status}) — coba lagi nanti.`,
        wallet,
      }
    }
    if (code === '0') {
      return { outcome: 'claimed', code, message: msg || 'success', wallet }
    }
    if (code && RH_KEY_REJECT_CODES.has(code)) {
      return { outcome: 'rejected', code, message: translateRhError(code, msg), wallet }
    }
    if (RH_ALREADY_CLAIMED_RE.test(msg)) {
      return { outcome: 'already', code, message: msg || 'Hadiah harian hari ini sudah diklaim.', wallet }
    }
    return {
      outcome: 'error',
      code,
      message: msg || `Hadiah harian gagal diklaim (${code || upstream.status}).`,
      wallet,
    }
  } catch (err: any) {
    return { outcome: 'error', code: null, message: err.message || 'Gagal klaim hadiah harian.' }
  }
}

async function handleClaimDailyGift(apiKey: string, res: Response) {
  const result = await rhClaimDailyGift(apiKey)
  if (result.outcome === 'claimed') {
    const summary = rhWalletSummary(result.wallet ?? null)
    return res.status(200).json({
      ok: true,
      message: `Hadiah harian diklaim. ${summary || 'Saldo poin diperbarui.'}`,
      tokenWallet: result.wallet ?? null,
    })
  }
  return res.status(200).json({
    ok: false,
    alreadyClaimed: result.outcome === 'already',
    code: result.code,
    error: result.message,
    ...(result.wallet ? { tokenWallet: result.wallet } : {}),
  })
}

async function handleCheckBalance(apiKey: string, res: Response) {  try {
    const endpoint = `${RUNNINGHUB_BASE}/uc/openapi/accountStatus`

    const apiRes = await rhFetch(apiKey, endpoint, {
      method: 'POST',
      headers: rhAuthHeaders(apiKey),
      body: JSON.stringify({ apiKey, accessToken: apiKey }),
    })

    const rawText = await apiRes.text()
    console.log(`[runninghub] check-balance ${apiRes.status}:`, rawText.slice(0, 500))

    let data: any = null
    try { data = JSON.parse(rawText) } catch { data = null }

    // Balasan HTML/kosong (502 nginx, maintenance) atau JSON tanpa `code`
    // maupun `data` bukan bukti key salah.
    if (
      !data || typeof data !== 'object' || apiRes.status >= 500
      || (data.code === undefined && (!data.data || typeof data.data !== 'object'))
    ) {
      return res.status(200).json({
        ok: false,
        transient: true,
        invalidKey: false,
        error: `RunningHub tidak membalas JSON (HTTP ${apiRes.status}) — coba lagi sebentar lagi; API key belum tentu salah.`,
        balance: null,
        isValidUser: false,
      })
    }

    if (data.code !== undefined && data.code !== null && data.code !== 0 && data.code !== '0') {
      const code = String(data.code)
      const rejected = RH_KEY_REJECT_CODES.has(code)

      // Credential berupa akses token (JWT) yang masih berlaku: endpoint cek
      // saldo lama (/uc/openapi/accountStatus) memang dibuat untuk API key,
      // sehingga token sering ditolak di sini walaupun panggilan OpenAPI
      // (/openapi/v2/…) menerimanya. Jangan tandai token sebagai key invalid —
      // baca paket sesi (kredit gratis + poin) lewat /api/welfare/summary.
      if (rejected && rhJwtExpired(apiKey) === false && rhJwtExp(apiKey) !== null) {
        const wallet = await rhTokenWallet(apiKey)
        // wallet null = token ini tidak bisa membaca data akun (dicabut/412):
        // jangan dilaporkan "aktif" hanya karena exp-nya belum lewat.
        if (wallet) {
          const summary = rhWalletSummary(wallet)
          return res.status(200).json({
            ok: true,
            balance: null,
            isValidUser: true,
            keyType: 'Access Token (JWT)',
            tokenWallet: wallet,
            message: summary
              ? `Access token aktif. ${summary}.`
              : 'Access token aktif. RunningHub tidak menampilkan saldo lewat access token — cek saldo hanya untuk API key lama.',
          })
        }
        // Credential ini JWT yang belum kedaluwarsa tapi tidak bisa membaca
        // data akun: RunningHub menolaknya (412/806/...) karena sesi dicabut.
        return res.status(200).json({
          ok: false,
          transient: false,
          invalidKey: true,
          error: `Access token ditolak RunningHub — sesi login sudah tidak berlaku (logout / login ulang / di-rotate)${code ? ` [${code}${data.msg ? ' ' + data.msg : ''}]` : ''}. Salin access token baru dari sesi runninghub.ai yang masih login, lalu ganti Key ini di Providers.`,
          balance: null,
          isValidUser: false,
          code: data.code,
        })
      }

      return res.status(200).json({
        ok: false,
        transient: !rejected,
        invalidKey: rejected,
        error: translateRhError(code, data.msg),
        balance: null,
        isValidUser: false,
        code: data.code,
      })
    }

    const info = data.data || {}
    let balance: number | null = null
    for (const field of RH_BALANCE_FIELDS) {
      const raw = info[field]
      if (raw === undefined || raw === null || raw === '') continue
      const num = Number(raw)
      if (Number.isFinite(num)) { balance = num; break }
    }

    const apiType = info.apiType ?? null
    // Sesi JWT selalu membawa wallet RH Coin walau accountStatus lama membalas
    // code 0 tanpa angka saldo — tanpa ini UI menampilkan "saldo belum terbaca".
    const tokenWallet = rhJwtExp(apiKey) !== null ? await rhTokenWallet(apiKey) : null
    const walletSummary = rhWalletSummary(tokenWallet)
    return res.status(200).json({
      ok: true,
      balance,
      isValidUser: true,
      apiType,
      keyType: tokenWallet ? 'Access Token (JWT)' : rhKeyTypeLabel(apiType),
      tokenWallet,
      message: tokenWallet
        ? `Access token aktif${walletSummary ? `. ${walletSummary}` : ''}.`
        : 'API key valid',
    })
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      transient: true,
      invalidKey: false,
      error: `Gagal terhubung ke RunningHub: ${err.message} — coba lagi; API key belum tentu salah.`,
      balance: null,
      isValidUser: false,
      message: 'Gagal terhubung ke RunningHub',
    })
  }
}

export default router
