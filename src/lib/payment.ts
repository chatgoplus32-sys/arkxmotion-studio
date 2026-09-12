// Info pembayaran manual (transfer DANA) yang dipakai halaman top up.
// Dikumpulkan di satu tempat supaya nomor/nama tidak berbeda antar halaman
// (CreatePulse & NexaBot) dan tidak perlu diubah di dua file.
export const DANA_NUMBER = '082280204445'
export const DANA_NAME = 'Yusuf Prihandoko'
export const ADMIN_WHATSAPP = '6285156207924'

/** Link WhatsApp admin dengan pesan awal yang sudah terisi. */
export function adminWhatsappLink(message: string): string {
  return `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`
}

/** Format angka jadi "Rp 35.000" (gaya Indonesia). */
export function formatRp(value: number): string {
  return `Rp ${Math.round(value || 0).toLocaleString('id-ID')}`
}
