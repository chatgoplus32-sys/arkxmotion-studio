export const ADMIN_WHATSAPP = '6285156207924'

/**
 * Data checkout VelianPay (QRIS dinamis) yang dipakai halaman pembayaran.
 * QRIS statis lama sengaja TIDAK punya representasi di sini — semua bayar
 * lewat VelianPay supaya nominal unik + verifikasi otomatis.
 */
export type VelianpayCheckout = {
  checkout_url?: string
  payable_amount?: number
  unique_code?: number
  qris_image?: string
}

/**
 * Siapkan ulang QRIS VelianPay untuk pengajuan yang sudah ada (tombol
 * "Coba lagi" saat checkout pertama gagal dibuat). Tidak membuat baris
 * pengajuan baru. Mengembalikan null bila masih gagal.
 */
export async function recreateVelianpayQris(
  token: string,
  refTable: string,
  refId: number,
): Promise<VelianpayCheckout | null> {
  try {
    const res = await fetch('/api/payments/qris/recreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refTable, refId }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as VelianpayCheckout
    return data?.checkout_url || data?.qris_image ? data : null
  } catch {
    return null
  }
}

/**
 * QRIS VelianPay pembayaran join Pro untuk halaman status pendaftaran
 * (belum login — identitasnya email). Membuat checkout bila belum ada.
 */
export async function fetchMembershipQris(email: string): Promise<VelianpayCheckout | null> {
  try {
    const res = await fetch('/api/payments/qris/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as VelianpayCheckout
    return data?.checkout_url || data?.qris_image ? data : null
  } catch {
    return null
  }
}

/** Link WhatsApp admin dengan pesan awal yang sudah terisi. */
export function adminWhatsappLink(message: string): string {
  return `https://wa.me/${ADMIN_WHATSAPP}?text=${encodeURIComponent(message)}`
}

/** Format angka jadi "Rp 35.000" (gaya Indonesia). */
export function formatRp(value: number): string {
  return `Rp ${Math.round(value || 0).toLocaleString('id-ID')}`
}
