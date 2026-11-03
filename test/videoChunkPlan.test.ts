import { test } from 'node:test'
import assert from 'node:assert/strict'
import { planClips, normalizeTrim, isTrimmedRange, CLIP_SECONDS } from '../src/lib/videoChunks'

// planClips adalah satu-satunya tempat jumlah klip — dan therefore jumlah
// tiket yang dibayar member — ditentukan. Satu klip hilang = video hasil
// terpotong; satu klip lebih = satu generate sia-sia.

const totalDurasi = (specs: ReturnType<typeof planClips>) =>
  Number(specs.reduce((s, c) => s + c.duration, 0).toFixed(3))

test('planClips: durasi pas kelipatan 10s jadi klip seragam tanpa ekor', () => {
  for (const d of [10, 20, 30, 60]) {
    const specs = planClips(d)
    assert.equal(totalDurasi(specs), d, `total harus ${d}`)
    assert.ok(specs.every((c) => c.duration === CLIP_SECONDS), `semua klip 10s untuk d=${d}`)
  }
  assert.equal(planClips(30).length, 3)
})

test('planClips: menutupi video tanpa celah dan tanpa tumpang-tindih', () => {
  for (const d of [13, 17.5, 25, 31.2, 44.8, 61.3, 90]) {
    const specs = planClips(d)
    assert.ok(specs.length > 0, `harus ada klip untuk d=${d}`)
    assert.equal(specs[0].start, 0)
    for (let i = 1; i < specs.length; i++) {
      const prev = specs[i - 1]
      assert.ok(Math.abs(specs[i].start - (prev.start + prev.duration)) < 0.011, `bersambung di klip ${i} d=${d}`)
    }
    const last = specs[specs.length - 1]
    assert.ok(Math.abs(last.start + last.duration - d) < 0.011, `mencapai akhir d=${d}`)
    assert.equal(totalDurasi(specs), Number(d.toFixed(3)), `total = durasi sumber d=${d}`)
  }
})

test('planClips: ekor < 2 detik diserap ke klip terakhir, bukan jadi klip 1 detik', () => {
  // Model tidak berguna mengedit potongan 1s, dan tiap klip = satu biaya.
  for (const d of [11, 11.9, 21, 21.5, 41, 31, 51]) {
    const specs = planClips(d)
    assert.ok(specs.every((c) => c.duration >= 2), `tidak boleh ada klip <2s untuk d=${d}: ${JSON.stringify(specs.map((c) => c.duration))}`)
    assert.equal(totalDurasi(specs), Number(d.toFixed(3)), `total tetap utuh d=${d}`)
  }
  assert.deepEqual(planClips(11).map((c) => c.duration), [11])
  assert.deepEqual(planClips(21).map((c) => c.duration), [10, 11])
  assert.deepEqual(planClips(25).map((c) => c.duration), [10, 10, 5])
})

test('planClips: klip tidak pernah lebih panjang dari CLIP_SECONDS + toleransi ekor', () => {
  for (let d = 1; d <= 95; d += 0.5) {
    for (const c of planClips(d)) {
      assert.ok(c.duration <= CLIP_SECONDS + 2.001, `d=${d} menghasilkan klip ${c.duration}s`)
    }
  }
  assert.equal(planClips(120).length, 12)
  assert.ok(planClips(120).every((c) => c.duration === CLIP_SECONDS))
})

test('planClips: durasi di bawah 10s tetap satu klip utuh', () => {
  for (const d of [0.5, 3, 9.8]) {
    const specs = planClips(d)
    assert.equal(specs.length, 1, `d=${d} tidak boleh dipecah`)
    assert.ok(Math.abs(specs[0].duration - d) < 0.011)
  }
})

// Rentang potong menentukan berapa detik yang BENAR-BENAR dibayar. Batas yang
// salah di sini bisa menghasilkan generate 0 detik atau video yang lebih panjang
// dari sumbernya.
test('normalizeTrim: menjepit rentang ke durasi video dan minimal 1 detik', () => {
  assert.deepEqual(normalizeTrim(60, 0, 60), { start: 0, end: 60 })
  assert.deepEqual(normalizeTrim(60, -5, 999), { start: 0, end: 60 })
  // Ujung mulai tidak boleh menyisakan kurang dari 1 detik.
  assert.deepEqual(normalizeTrim(60, 59.8, 60), { start: 59, end: 60 })
  // Ujung selesai tidak boleh lebih pendek dari 1 detik setelah mulai.
  assert.deepEqual(normalizeTrim(60, 30, 30.2), { start: 30, end: 31 })
  assert.deepEqual(normalizeTrim(60, 12, 20), { start: 12, end: 20 })
})

test('normalizeTrim: video sangat pendek tetap tidak menghasilkan durasi negatif', () => {
  for (const d of [0, 0.4, 1]) {
    const r = normalizeTrim(d, 0, d)
    assert.equal(r.start, 0, `d=${d}`)
    assert.ok(r.end >= 0 && r.end <= Math.max(d, 0) + 0.001, `d=${d} menghasilkan end ${r.end}`)
  }
})

test('isTrimmedRange: hanya true kalau benar-benar memotong', () => {
  assert.equal(isTrimmedRange(60, null), false)
  assert.equal(isTrimmedRange(60, { start: 0, end: 60 }), false)
  assert.equal(isTrimmedRange(60, { start: 0.01, end: 60 }), false)
  assert.equal(isTrimmedRange(60, { start: 0, end: 59.9 }), false)
  assert.equal(isTrimmedRange(60, { start: 5, end: 60 }), true)
  assert.equal(isTrimmedRange(60, { start: 0, end: 45 }), true)
  assert.equal(isTrimmedRange(60, { start: 5, end: 45 }), true)
})
