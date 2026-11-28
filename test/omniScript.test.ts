import test from 'node:test'
import assert from 'node:assert/strict'
import {
  hitungKataOmni,
  potongVoiceoverOmni,
  susunPromptVideoOmni,
  MAKS_KATA_VOICEOVER,
} from '../src/lib/omniScript.js'

test('hitung kata mengabaikan spasi berlebih', () => {
  assert.equal(hitungKataOmni('  Halo   teman  semua '), 3)
  assert.equal(hitungKataOmni(''), 0)
})

test('voiceover dipotong maksimal 33 kata dan diakhiri tanda baca', () => {
  const panjang = Array.from({ length: 60 }, (_, i) => `kata${i}`).join(' ')
  const hasil = potongVoiceoverOmni(panjang)
  assert.equal(hitungKataOmni(hasil), MAKS_KATA_VOICEOVER)
  assert.match(hasil, /[.,!?;:]$/)
})

test('voiceover yang sudah pendek tidak diubah', () => {
  const teks = 'Kalsium menjaga tulang tetap kuat.'
  assert.equal(potongVoiceoverOmni(teks), teks)
})

test('prompt video memuat durasi 15 detik dan satu instruksi voiceover persis', () => {
  const vo = 'Kalsium menjaga tulang tetap kuat.'
  const prompt = susunPromptVideoOmni('Close up organ, cinematic lighting.', vo)
  assert.match(prompt, /Duration: exactly 15 seconds/)
  assert.match(prompt, /saying exactly: "Kalsium menjaga tulang tetap kuat\."/)
  assert.equal(prompt.split(/voiceover narrates/i).length - 1, 1)
})

test('instruksi voiceover lama dibuang (tidak dobel) dan idempoten', () => {
  const vo = 'Narasi baru yang pas.'
  const lama = 'Close up organ.\nA voiceover narrates in Indonesian, saying exactly: "narasi lama".'
  const sekali = susunPromptVideoOmni(lama, vo)
  assert.equal(sekali.split(/voiceover narrates/i).length - 1, 1)
  assert.doesNotMatch(sekali, /narasi lama/)
  assert.equal(susunPromptVideoOmni(sekali, vo), sekali)
})

test('voiceover kosong tidak menyisipkan instruksi', () => {
  const prompt = susunPromptVideoOmni('Close up organ.', '')
  assert.doesNotMatch(prompt, /voiceover narrates/i)
  assert.match(prompt, /Duration: exactly 15 seconds/)
})
