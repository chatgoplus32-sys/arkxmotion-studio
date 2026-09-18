#!/usr/bin/env node
/**
 * Diagnosa submit CreatePulse — langsung ke API mereka, tanpa menunggu deploy.
 *
 * Latar: submit Veo Omni dijawab **502 dalam ~2 detik** dua kali berturut-turut
 * (21:15:38 dan 21:43:20), sementara /api/createpulse/deduct, unggah start
 * frame, dan refund di sisi kita semuanya sukses di detik yang berdekatan.
 * Artinya 502 datang dari hop di depan createpulse.online — tapi UI kita masih
 * hanya bisa bilang "unknown" karena proxy lama membuang body non-JSON.
 *
 * Skrip ini menjawab pertanyaan yang tersisa dengan satu perintah:
 *
 *   - model yang SENGAJA salah dijawab 4xx rapi? → validasi model mereka jalan,
 *     jadi `veo-omni-10s` dikenali dan 502 itu kegagalan di sisi mereka untuk
 *     model itu (bukan salah ketik slug di katalog kita);
 *   - model sengaja salah JUGA 502? → handler mereka tumbang untuk model tak
 *     dikenal, dan slug kita patut dicurigai;
 *   - `--submit` tanpa gambar berhasil (200 + batchId)? → jalur teks-ke-video
 *     sehat, jadi yang bermasalah adalah gambar/start-frame atau model Veo;
 *   - `--submit` tanpa gambar 502 tapi `--submit --image=…` juga 502? → masalah
 *     di model, bukan di gambar.
 *
 * AMAN secara default: tanpa `--submit`, tidak ada satu pun body yang bisa
 * membuat job (model sengaja salah, dan satu permintaan tanpa key).
 *
 * Pemakaian:
 *   CREATEPULSE_API_KEY=xxx node scripts/createpulse-diagnose.mjs
 *   CREATEPULSE_API_KEY=xxx node scripts/createpulse-diagnose.mjs --submit
 *   CREATEPULSE_API_KEY=xxx node scripts/createpulse-diagnose.mjs --submit --image=https://...
 *   CREATEPULSE_API_KEY=xxx node scripts/createpulse-diagnose.mjs --submit --model=dreamina-seedance-2.0
 *   node scripts/createpulse-diagnose.mjs --dry-run     # cetak rencananya saja
 *
 * Catatan biaya: `--submit` yang BERHASIL membuat job nyata di akun
 * createpulse.online Anda (kuota app tidak ikut terpotong, karena skrip ini
 * tidak lewat /api/createpulse/deduct).
 */
import fs from 'node:fs'
import path from 'node:path'
import { fileURLToPath } from 'node:url'

const ROOT = path.join(path.dirname(fileURLToPath(import.meta.url)), '..')
const CP_GENERATE = 'https://createpulse.online/api/generate'
const BOGUS_MODEL = '__arkx_diagnostic_bogus__'

const args = process.argv.slice(2)
const has = (nama) => args.some((a) => a === `--${nama}`)
const nilai = (nama, fallback) => {
  const hit = args.find((a) => a.startsWith(`--${nama}=`))
  return hit ? hit.slice(nama.length + 3) : fallback
}

if (has('help') || has('h')) {
  console.log(fs.readFileSync(fileURLToPath(import.meta.url), 'utf8').split('*/')[0].replace(/^\/\*\*?/, '').trim())
  process.exit(0)
}

function keyFromEnvFile() {
  try {
    const isi = fs.readFileSync(path.join(ROOT, '.env'), 'utf8')
    const baris = isi.split(/\r?\n/).find((l) => /^\s*CREATEPULSE_API_KEY\s*=/.test(l))
    return baris ? baris.replace(/^[^=]*=/, '').trim().replace(/^["']|["']$/g, '') : ''
  } catch {
    return ''
  }
}

const apiKey = nilai('key', process.env.CREATEPULSE_API_KEY || keyFromEnvFile())
const model = nilai('model', 'veo-omni-10s')
const prompt = nilai('prompt', 'animasikan')
const image = nilai('image', '')
const submit = has('submit')
const dryRun = has('dry-run')

function bodyUntuk(opts) {
  const body = { kind: 'video', model: opts.model, prompt, aspect: '9:16', duration: 10 }
  if (opts.image) body.init_image_url = opts.image
  return body
}

const rencana = [
  {
    label: 'model sengaja salah (tidak mungkin membuat job)',
    pakaiKey: true,
    body: bodyUntuk({ model: BOGUS_MODEL }),
    kesimpulan: '4xx rapi = validasi model mereka jalan; 502 = handler mereka tumbang untuk model tak dikenal',
  },
  {
    label: 'tanpa X-API-Key (menguji urutan validasi)',
    pakaiKey: false,
    body: bodyUntuk({ model }),
    kesimpulan: '401/403 = key diperiksa lebih dulu, jadi 502 kita bukan soal key',
  },
]

if (submit) {
  rencana.push({
    label: `submit nyata: model=${model}${image ? ' + gambar' : ' (tanpa gambar)'}`,
    pakaiKey: true,
    body: bodyUntuk({ model, image }),
    kesimpulan: '200 + batchId = jalur ini sehat; 502 = reproduksi; 4xx = payload/slug ditolak',
    biaya: true,
  })
}

console.log(`Diagnosa CreatePulse — key: ${apiKey ? 'ada' : 'TIDAK ADA'} · model uji: ${model}`)
console.log(`Target: ${CP_GENERATE}\n`)

if (dryRun) {
  for (const [i, r] of rencana.entries()) {
    console.log(`── ${i + 1}. ${r.label} ──`)
    console.log(`   X-API-Key: ${r.pakaiKey ? '(dikirim)' : '(tidak dikirim)'}`)
    console.log(`   body: ${JSON.stringify(r.body)}\n`)
  }
  console.log('--dry-run: tidak ada permintaan yang dikirim.')
  process.exit(0)
}

if (rencana.some((r) => r.pakaiKey) && !apiKey) {
  console.error('Key CreatePulse tidak ditemukan. Setel CREATEPULSE_API_KEY (env atau .env), atau pakai --key=...')
  process.exit(2)
}

const ringkas = []
for (const [i, r] of rencana.entries()) {
  console.log(`── ${i + 1}. ${r.label} ──`)
  const mulai = Date.now()
  let res
  try {
    res = await fetch(CP_GENERATE, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        ...(r.pakaiKey ? { 'X-API-Key': apiKey } : {}),
      },
      body: JSON.stringify(r.body),
    })
  } catch (err) {
    const ms = Date.now() - mulai
    console.log(`   permintaan gagal sebelum ada jawaban (${ms}ms): ${err?.message || err}\n`)
    ringkas.push({ label: r.label, status: 'GAGAL', isi: err?.message || String(err) })
    continue
  }

  const teks = await res.text()
  const ms = Date.now() - mulai
  const ct = res.headers.get('content-type') || '(tanpa content-type)'
  const padat = teks.replace(/\s+/g, ' ').trim().slice(0, 400) || '(body kosong)'
  console.log(`   → HTTP ${res.status} dalam ${ms}ms · ${ct}`)
  console.log(`   body: ${padat}`)
  console.log(`   baca: ${r.kesimpulan}`)
  if (r.biaya) console.log('   catatan: kalau ini 200, sebuah job nyata baru saja dibuat di akun CreatePulse Anda')
  console.log('')
  ringkas.push({ label: r.label, status: res.status, isi: padat })

  // Satu submission saja: job kedua tidak menambah informasi, tapi menambah biaya.
  if (r.biaya) break
}

console.log('── Ringkasan ──')
for (const r of ringkas) console.log(`   ${r.status}  ${r.label}`)
