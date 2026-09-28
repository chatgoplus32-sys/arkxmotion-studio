/**
 * Benchmark pembersih watermark video PER FRAME.
 *
 * Yang diukur: biaya bersih-bersih satu frame 1080p untuk beberapa ukuran
 * watermark (crop = bbox mask + ring). Angka ini yang menentukan apakah
 * pemrosesan video masih lebih cepat dari realtime (30 fps ⇒ 33.3 ms/frame).
 *
 * Fase yang dilaporkan:
 *   1. salin crop dari frame  (di browser: getImageData)
 *   2. isi hole dari ring     (pyramid smooth fill)
 *   3. tempel hasil ke hole   (komposit)
 *   4. salin crop balik       (di browser: putImageData)
 *
 * Jalankan:  npx tsx scripts/bench-frame-cleaner.ts
 * Opsi:      FRAMES=120 npx tsx scripts/bench-frame-cleaner.ts
 */
import { planSeamFrame, filledHoleValues, compositeHoleInPlace, type SeamFramePlan } from '../src/lib/video-frame-cleaner.js'
import type { Raster } from '../src/lib/inpaint-core.js'

const W = 1920
const H = 1080
const FRAMES = Number(process.env.FRAMES ?? 120)

interface Case {
  name: string
  box: { x: number; y: number; w: number; h: number }
}

// Watermark khas di video 1080p: sudut kanan bawah (Gemini/Veo), kanal tengah
// (logo TV), dan overlay besar (burn-in teks/anime subtitle).
const CASES: Case[] = [
  { name: 'kecil  200×70  (logo Gemini 1080p)', box: { x: 1690, y: 985, w: 200, h: 70 } },
  { name: 'sedang 480×160 (logo TV kanal)', box: { x: 1400, y: 900, w: 480, h: 160 } },
  { name: 'besar  960×360 (burn-in teks)', box: { x: 480, y: 360, w: 960, h: 360 } },
]

function makeFrame(t: number): Uint8ClampedArray {
  // Latar bergerak + sedikit tekstur, dan watermark semi-transparan di kotak.
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = 0; y < H; y++) {
    for (let x = 0; x < W; x++) {
      const i = (y * W + x) * 4
      data[i] = (x + t * 3) & 255
      data[i + 1] = (y * 2 + t * 2) & 255
      data[i + 2] = (x + y + t * 5) & 255
      data[i + 3] = 255
    }
  }
  return data
}

function makeMask(box: Case['box']): Raster {
  const data = new Uint8ClampedArray(W * H * 4)
  for (let y = box.y; y < box.y + box.h; y++) {
    for (let x = box.x; x < box.x + box.w; x++) data[(y * W + x) * 4 + 3] = 255
  }
  return { width: W, height: H, data }
}

function percentiles(sorted: number[], qs: number[]): number[] {
  return qs.map((q) => sorted[Math.min(sorted.length - 1, Math.max(0, Math.round((sorted.length - 1) * q)))])
}

interface Phases {
  copyIn: number
  fill: number
  composite: number
  copyOut: number
}

function bench(name: string, plan: SeamFramePlan, frames: Uint8ClampedArray[]): void {
  const { x, y, w, h } = plan.crop
  const crop = new Uint8ClampedArray(w * h * 4)
  const times: number[] = []
  const phase: Phases = { copyIn: 0, fill: 0, composite: 0, copyOut: 0 }

  const copyIn = (src: Uint8ClampedArray) => {
    for (let cy = 0; cy < h; cy++) {
      const s = ((y + cy) * W + x) * 4
      crop.set(src.subarray(s, s + w * 4), cy * w * 4)
    }
  }
  const copyOut = (dst: Uint8ClampedArray) => {
    for (let cy = 0; cy < h; cy++) {
      const d = ((y + cy) * W + x) * 4
      dst.set(crop.subarray(cy * w * 4, cy * w * 4 + w * 4), d)
    }
  }
  const clean = () => {
    const filled = filledHoleValues(plan, crop)
    compositeHoleInPlace(crop, plan, filled)
  }

  // Pemanasan (agar JIT & alokasi awal tidak ikut terukur).
  for (let f = 0; f < 5; f++) {
    copyIn(frames[f % frames.length])
    clean()
  }

  for (let f = 0; f < FRAMES; f++) {
    const src = frames[f % frames.length]
    const t0 = performance.now()
    copyIn(src)
    const t1 = performance.now()
    const filled = filledHoleValues(plan, crop)
    const t2 = performance.now()
    compositeHoleInPlace(crop, plan, filled)
    const t3 = performance.now()
    copyOut(src)
    const t4 = performance.now()
    phase.copyIn += t1 - t0
    phase.fill += t2 - t1
    phase.composite += t3 - t2
    phase.copyOut += t4 - t3
    times.push(t4 - t0)
  }

  times.sort((a, b) => a - b)
  const [p50, p95] = percentiles(times, [0.5, 0.95])
  const mean = times.reduce((s, v) => s + v, 0) / times.length
  const cropPx = w * h
  // 1 menit video @30fps = 1800 frame.
  const secPerMin = (mean * 1800) / 1000
  console.log(
    `${name} | crop ${w}×${h} (${(cropPx / 1000).toFixed(0)}k px, ${((cropPx / (W * H)) * 100).toFixed(1)}% frame) ` +
      `| rata² ${mean.toFixed(2)} ms (p50 ${p50.toFixed(2)}, p95 ${p95.toFixed(2)}) ` +
      `| ${secPerMin.toFixed(1)} s per menit video ${secPerMin < 60 ? '✅' : '⚠️ lebih lambat dari realtime'}`,
  )
  const f = (v: number) => (v / FRAMES).toFixed(2).padStart(6)
  console.log(
    `   └ per frame: salin-masuk ${f(phase.copyIn)} ms | isi hole ${f(phase.fill)} ms | komposit ${f(phase.composite)} ms | salin-keluar ${f(phase.copyOut)} ms\n`,
  )
}

console.log(`Benchmark pembersih per-frame — frame ${W}×${H}, ${FRAMES} frame per kasus\n`)
for (const c of CASES) {
  const mask = makeMask(c.box)
  const t0 = performance.now()
  const plan = planSeamFrame(mask, W, H)
  const planMs = performance.now() - t0
  if (!plan) throw new Error(`plan null untuk ${c.name}`)
  const frames = Array.from({ length: 8 }, (_, i) => makeFrame(i))
  bench(c.name, plan, frames)
  console.log(`   └ penyiapan rencana (sekali per video): ${planMs.toFixed(1)} ms, hole ${plan.holePixels} px\n`)
}
