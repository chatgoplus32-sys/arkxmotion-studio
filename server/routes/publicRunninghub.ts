import { Router, Request, Response } from 'express'

const router = Router()

const RUNNINGHUB_BASE = 'https://www.runninghub.ai'
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
}
// Virtual Try-On & Ekstraksi Pakaian: node 13 = foto orang, node 53 = pakaian
const RUNNINGHUB_TRYON_WORKFLOW_ID = '2099800742046818306'
const RUNNINGHUB_TRYON_PERSON_NODE = '13'
const RUNNINGHUB_TRYON_GARMENT_NODE = '53'
// H3 Audio Avatar: node 209 = foto, node 215 = audio
const RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID = '2099332942179229697'
const RUNNINGHUB_AUDIO_AVATAR_IMAGE_NODE = '209'
const RUNNINGHUB_AUDIO_AVATAR_AUDIO_NODE = '215'
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
// LTX-2.5 LipSync ID: node 23/30 = image, node 148 = audio,
// node 14 = width, node 15 = height, node 16 = fps
const RUNNINGHUB_LIPSYNC_WORKFLOW_ID = '2098820058905927682'
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

function rhAuthHeaders(_apiKey: string) {
  return { 'Content-Type': 'application/json', 'User-Agent': 'ArkxMotion/1.0' }
}

router.all('/', async (req: Request, res: Response) => {
  res.setHeader('Access-Control-Allow-Origin', '*')
  res.setHeader('Access-Control-Allow-Methods', 'POST, OPTIONS')
  res.setHeader('Access-Control-Allow-Headers', 'Content-Type, X-Runninghub-Key')

  if (req.method === 'OPTIONS') return res.status(200).end()
  if (req.method !== 'POST') return res.status(405).json({ ok: false, error: 'Method not allowed' })

  const body = req.body || {}
  const { action, apiKey, ...params } = body

  if (!action) return res.status(200).json({ ok: false, error: 'Missing action' })
  if (!apiKey) return res.status(200).json({ ok: false, error: 'Missing apiKey' })

  console.log(`[runninghub] action=${action} apiKeyLen=${String(apiKey).length}`)

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
    if (action === 'submit-audio-avatar') {
      return await handleSubmitAudioAvatar(apiKey, params, res)
    }
    if (action === 'submit-song-cover') {
      return await handleSubmitSongCover(apiKey, params, res)
    }
    if (action === 'submit-video-upscale') {
      return await handleSubmitVideoUpscale(apiKey, params, res)
    }
    if (action === 'submit-photo-enhance') {
      return await handleSubmitPhotoEnhance(apiKey, params, res)
    }
    if (action === 'submit-lipsync') {
      return await handleSubmitLipSync(apiKey, params, res)
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

  const apiRes = await fetch(endpoint, {
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
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
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

  const apiRes = await fetch(endpoint, {
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
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
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

  const apiRes = await fetch(endpoint, {
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
    return res.status(200).json({ ok: false, error: 'No taskId returned', raw: rawText, fullData: data })
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
  const endpoints = [
    `${RUNNINGHUB_BASE}/api/openapi/getJsonApiFormat`,
    `${RUNNINGHUB_BASE}/openapi/getJsonApiFormat`,
  ]
  let lastErr = ''
  for (const endpoint of endpoints) {
    try {
      const apiRes = await fetch(endpoint, {
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

async function handleSubmitAudioAvatar(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
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

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_AUDIO_AVATAR_WORKFLOW_ID

  console.log(`[runninghub] Uploading photo (audio-avatar)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Photo uploaded: ${imageUpload.fileName}`)

  console.log(`[runninghub] Uploading audio (audio-avatar)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const nodeInfoList: any[] = [
    { nodeId: RUNNINGHUB_AUDIO_AVATAR_IMAGE_NODE, fieldName: 'image', fieldValue: imageUpload.fileName },
    { nodeId: RUNNINGHUB_AUDIO_AVATAR_AUDIO_NODE, fieldName: 'audio', fieldValue: audioUpload.fileName },
  ]

  try {
    const nodes = await fetchWorkflowNodes(apiKey, effectiveWorkflowId)
    const extras = collectUltraHDExtras(nodes, {
      fps: 0, steps: 0, maxFrames: 0, prompt: String(prompt || ''), negativePrompt: '',
    }).filter((e) => /prompt|text|positive/i.test(e.fieldName))
    if (extras.length > 0) {
      nodeInfoList.push(...extras)
      console.log(`[runninghub] audio-avatar + ${extras.length} extras`)
    }
  } catch (err: any) {
    console.log(`[runninghub] audio-avatar discovery skipped: ${err.message}`)
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
    console.log(`[runninghub] POST ${endpoint} (audio-avatar attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify(body),
    })

    lastRawText = await apiRes.text()
    console.log(`[runninghub] submit-audio-avatar ${apiRes.status}:`, lastRawText.slice(0, 1000))

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
      console.error(`[runninghub] No taskId found (audio-avatar):`, JSON.stringify(data).slice(0, 500))
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

    const apiRes = await fetch(endpoint, {
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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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
    const apiRes = await fetch(endpoint, {
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
    const apiRes = await fetch(endpoint, {
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

    const apiRes = await fetch(endpoint, {
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

async function handleSubmitLipSync(apiKey: string, params: any, res: Response) {
  const {
    workflow_id,
    workflowId,
    imageBase64,
    imageFileName = 'photo.jpg',
    imageMimeType = 'image/jpeg',
    imageBase64_2,
    imageFileName2 = 'photo2.jpg',
    imageMimeType2 = 'image/jpeg',
    audioBase64,
    audioFileName = 'audio.mp3',
    audioMimeType = 'audio/mpeg',
    width = 1280,
    height = 720,
    fps = 30,
  } = params

  if (!imageBase64) return res.status(200).json({ ok: false, error: 'Missing imageBase64' })
  if (!audioBase64) return res.status(200).json({ ok: false, error: 'Missing audioBase64' })

  const effectiveWorkflowId = workflow_id || workflowId || RUNNINGHUB_LIPSYNC_WORKFLOW_ID
  const effWidth = Math.max(64, Math.min(2048, Number(width) || 1280))
  const effHeight = Math.max(64, Math.min(2048, Number(height) || 720))
  const effFps = Math.max(1, Math.min(60, Number(fps) || 30))

  console.log(`[runninghub] Uploading image 1 (lipsync)...`)
  const imageUpload = await rhUpload(apiKey, imageBase64, imageFileName, imageMimeType)
  console.log(`[runninghub] Image 1 uploaded: ${imageUpload.fileName}`)

  let imageUpload2: { fileName: string; downloadUrl: string } | null = null
  if (imageBase64_2) {
    console.log(`[runninghub] Uploading image 2 (lipsync)...`)
    imageUpload2 = await rhUpload(apiKey, imageBase64_2, imageFileName2, imageMimeType2)
    console.log(`[runninghub] Image 2 uploaded: ${imageUpload2.fileName}`)
  }

  console.log(`[runninghub] Uploading audio (lipsync)...`)
  const audioUpload = await rhUpload(apiKey, audioBase64, audioFileName, audioMimeType)
  console.log(`[runninghub] Audio uploaded: ${audioUpload.fileName}`)

  const endpoint = `${RUNNINGHUB_BASE}/openapi/v2/run/ai-app/${effectiveWorkflowId}`
  const RETRY_DELAY_MS = 10000
  const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms))

  const postRun = async (list: any[]) => {
    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        'Authorization': `Bearer ${apiKey}`,
      },
      body: JSON.stringify({ nodeInfoList: list, instanceType: 'default', usePersonalQueue: 'false' }),
    })
    const rawText = await apiRes.text()
    console.log(`[runninghub] submit-lipsync ${apiRes.status}:`, rawText.slice(0, 1000))
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
  const AUD_CANDS = ['audio', 'file', 'path', 'filename', 'input', 'src']
  const nodeField: Record<string, string> = { '23': 'image', '148': 'audio' }
  if (imageUpload2) nodeField['30'] = 'image'

  const droppedEntries = new Set<string>()
  const buildList = () => {
    const list: any[] = [
      { nodeId: '23', fieldName: nodeField['23'], fieldValue: imageUpload.fileName },
      ...(imageUpload2 ? [{ nodeId: '30', fieldName: nodeField['30'], fieldValue: imageUpload2.fileName }] : []),
      { nodeId: '148', fieldName: nodeField['148'], fieldValue: audioUpload.fileName },
      { nodeId: '14', fieldName: 'value', fieldValue: String(effWidth) },
      { nodeId: '15', fieldName: 'value', fieldValue: String(effHeight) },
      { nodeId: '16', fieldName: 'value', fieldValue: String(effFps) },
    ]
    return droppedEntries.size === 0 ? list : list.filter((e) => !droppedEntries.has(`${e.nodeId}/${e.fieldName}`))
  }

  let lastErr = 'Unknown error'
  let lastData: any = null

  for (let round = 0; round < 18; round++) {
    const list = buildList()
    let r: Awaited<ReturnType<typeof postRun>> | null = null
    for (let attempt = 1; attempt <= 3; attempt++) {
      console.log(`[runninghub] lipsync round=${round} (attempt ${attempt}/3)`)
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
    if (mm && /field_not_found|node_not_found/i.test(mm.reason) && ['23', '30', '148'].includes(mm.nodeId)) {
      if (/node_not_found/i.test(mm.reason)) {
        return res.status(200).json({ ok: false, error: `Node ${mm.nodeId} tidak ada di workflow ini`, data: r.data })
      }
      const cands = mm.nodeId === '148' ? AUD_CANDS : IMG_CANDS
      const cur = nodeField[mm.nodeId] || ''
      const nextIdx = cands.indexOf(cur) + 1
      if (nextIdx <= 0 || nextIdx >= cands.length) {
        return res.status(200).json({ ok: false, error: `Field ${mm.nodeId} ditolak semua kandidat. Terakhir: ${r.msg}`, data: r.data })
      }
      nodeField[mm.nodeId] = cands[nextIdx]
      console.log(`[runninghub] lipsync node ${mm.nodeId}: "${cur}" ditolak → coba "${cands[nextIdx]}"`)
      continue
    }
    if (mm && /field_not_found|node_not_found/i.test(mm.reason)) {
      console.log(`[runninghub] lipsync buang field ${mm.nodeId}/${mm.fieldName} (${mm.reason}), pakai default workflow`)
      droppedEntries.add(`${mm.nodeId}/${mm.fieldName}`)
      continue
    }
    const errorMsg = translateRhError(String(r.code ?? ''), r.msg) || r.msg || 'Submit gagal'
    return res.status(200).json({ ok: false, error: errorMsg, code: r.code, data: r.data })
  }

  return res.status(200).json({ ok: false, error: `Gagal submit lip-sync. Terakhir: ${lastErr}`, data: lastData })
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
    const apiRes = await fetch(endpoint, {
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
    const apiRes = await fetch(endpoint, {
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
        const apiRes = await fetch(endpoint, {
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
        const apiRes = await fetch(endpoint, {
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
        const apiRes = await fetch(endpoint, {
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
    _workflow_id,
    imageBase64,
    videoBase64,
    imageFileName = 'image.jpg',
    videoFileName = 'video.mp4',
    imageMimeType = 'image/jpeg',
    videoMimeType = 'video/mp4',
    _prompt = '',
    _negative_prompt = '',
    _keep_original_sound = false,
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
  let _lastData: any = null

  for (let attempt = 1; attempt <= MAX_RETRIES; attempt++) {
    console.log(`[runninghub] POST ${endpoint} (attempt ${attempt}/${MAX_RETRIES})`)
    console.log(`[runninghub] body:`, JSON.stringify(body).slice(0, 1000))

    const apiRes = await fetch(endpoint, {
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
    _lastData = data

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
      return res.status(200).json({ ok: false, error: 'No taskId returned', raw: lastRawText.slice(0, 500) })
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

  const apiRes = await fetch(endpoint, {
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

function translateRhError(code: string, msg?: string): string {
  const map: Record<string, string> = {
    '414': 'Saldo/kuota kerja (power) tidak cukup untuk menjalankan task ini. Silakan top up RH coins di akun RunningHub.',
    '404': 'Workflow tidak ditemukan atau tidak dapat diakses API key ini.',
    '403': 'Akses ditolak. API key tidak berhak mengakses workflow ini.',
    '1002': 'API key tidak valid.',
    '1003': 'API key tidak valid atau telah kedaluwarsa.',
    '1004': 'Workflow tidak ditemukan.',
    '5101': 'Gagal membuat task, coba lagi.',
  }
  if (msg && /API balance is insufficient/i.test(msg)) {
    return 'Saldo LLM API RunningHub tidak cukup (terpisah dari koin RH). Isi ulang "LLM API Balance" di RunningHub lalu coba lagi.'
  }
  if (msg && /NOT_ENOUGH_POWER|balance|insufficient|coin/i.test(msg)) {
    return 'Saldo/kuota kerja tidak cukup. Silakan top up RH coins di akun RunningHub.'
  }
  return map[code] || msg || `Error RunningHub (${code})`
}

async function handleCheckBalance(apiKey: string, res: Response) {
  try {
    const endpoint = `${RUNNINGHUB_BASE}/uc/openapi/accountStatus`

    const apiRes = await fetch(endpoint, {
      method: 'POST',
      headers: rhAuthHeaders(apiKey),
      body: JSON.stringify({ apiKey }),
    })

    const rawText = await apiRes.text()
    console.log(`[runninghub] check-balance ${apiRes.status}:`, rawText.slice(0, 500))

    let data: any
    try { data = JSON.parse(rawText) } catch { data = { raw: rawText } }

    if (data.code !== undefined && data.code !== 0) {
      return res.status(200).json({
        ok: false,
        error: translateRhError(String(data.code), data.msg) || data.msg || 'Gagal cek saldo',
        balance: null,
        isValidUser: false,
      })
    }

    const info = data.data || {}
    const balance = info.remainCoins !== undefined && info.remainCoins !== null ? parseFloat(info.remainCoins) : null

    return res.status(200).json({
      ok: true,
      balance,
      isValidUser: true,
      apiType: info.apiType || null,
      message: 'API key valid',
    })
  } catch (err: any) {
    return res.status(200).json({
      ok: false,
      error: err.message,
      balance: null,
      isValidUser: false,
      message: 'Gagal terhubung ke RunningHub',
    })
  }
}

export default router
