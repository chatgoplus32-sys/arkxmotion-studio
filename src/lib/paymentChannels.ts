/**
 * Kanal pembayaran top up saldo (DANA) + nominal yang ditawarkan.
 *
 * Dipakai bersama oleh halaman top up per provider (CreatePulse, NexaBot) supaya
 * nomor DANA, nama penerima, dan link WhatsApp tidak pernah berbeda antar
 * halaman — kalau nomornya bergeser, cukup ubah di satu tempat.
 */
export const TOPUP_NOMINALS = [10000, 15000, 20000, 25000, 50000, 100000]

export const DANA_NUMBER = '082280204445'
export const DANA_NAME = 'Yusuf Prihandoko'
export const WHATSAPP_LINK = 'https://wa.me/6285156207924?text=Halo%20saya%20ingin%20top%20up%20saldo'

export function formatRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}
