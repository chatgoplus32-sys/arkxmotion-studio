/**
 * Aturan skrip/narasi untuk video Omni 15 detik per scene.
 *
 * Dipakai ARKX Health Animasi supaya panjang voiceover SELALU muat diucapkan
 * dalam satu video 15 detik, dan instruksi voiceover di prompt video tidak
 * dobel / tidak beda teks dengan field voiceover yang ditampilkan ke user.
 */

export const OMNI_DURATION_SECONDS = 15
/** ~150 kata/menit → 15 detik ≈ 37 kata; 33 kata memberi ruang jeda & napas. */
export const MAKS_KATA_VOICEOVER = 33

export function hitungKataOmni(teks: string): number {
  return String(teks || '').trim().split(/\s+/).filter(Boolean).length
}

/** Potong voiceover supaya pas dibacakan dalam 15 detik (tanpa memotong di tengah kata). */
export function potongVoiceoverOmni(teks: string, maksKata: number = MAKS_KATA_VOICEOVER): string {
  const kata = String(teks || '').trim().split(/\s+/).filter(Boolean)
  if (kata.length <= maksKata) return kata.join(' ')
  const dipotong = kata.slice(0, maksKata).join(' ')
  return /[.,!?;:]$/.test(dipotong) ? dipotong : dipotong + '.'
}

/**
 * Bangun prompt video dengan SATU instruksi voiceover yang persis sama dengan
 * teks yang dipakai UI. Baris voiceover lama dibuang dulu (Gemini sering
 * menambahkannya sendiri), jadi hasilnya selalu konsisten & idempoten.
 */
export function susunPromptVideoOmni(
  prompt: string,
  voiceover: string,
  durasiDetik: number = OMNI_DURATION_SECONDS,
): string {
  const vo = potongVoiceoverOmni(voiceover)
  const dasar = String(prompt || '')
    .split(/\r?\n/)
    .filter((baris) => !/\bvoiceover\b/i.test(baris))
    .join('\n')
    .trim()
  const durasi = `Duration: exactly ${durasiDetik} seconds.`
  const adaDurasi = new RegExp(`duration[^\\n]*${durasiDetik}`, 'i').test(dasar)
  const bagian = [adaDurasi ? dasar : `${dasar}\n${durasi}`.trim()]
  if (vo) {
    bagian.push(
      `A voiceover narrates in Indonesian (Bahasa Indonesia), warm and friendly tone, saying exactly: "${vo}". No English speech.`,
    )
  }
  return bagian.filter(Boolean).join('\n')
}
