export const ADMIN_WHATSAPP = '6285156207924'

/**
 * Data checkout BasuniPay (QRIS dinamis) yang dipakai halaman pembayaran.
 * QRIS statis lama sengaja TIDAK punya representasi di sini — semua bayar
 * lewat BasuNiPay supaya nominal unik + verifikasi otomatis.
 */
export type BasunipayCheckout = {
  checkout_url?: string
  payable_amount?: number
  unique_code?: number
  qris_image?: string
}

/**
 * Siapkan ulang QRIS BasuniPay untuk pengajuan yang sudah ada (tombol
 * "Coba lagi" saat checkout pertama gagal dibuat). Tidak membuat baris
 * pengajuan baru. Mengembalikan null bila masih gagal.
 */
export async function recreateBasunipayQris(
  token: string,
  refTable: string,
  refId: number,
): Promise<BasunipayCheckout | null> {
  try {
    const res = await fetch('/api/payments/qris/recreate', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
      body: JSON.stringify({ refTable, refId }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as BasunipayCheckout
    return data?.checkout_url || data?.qris_image ? data : null
  } catch {
    return null
  }
}

/**
 * QRIS BasuniPay pembayaran join Pro untuk halaman status pendaftaran
 * (belum login — identitasnya email). Membuat checkout bila belum ada.
 */
export async function fetchMembershipQris(email: string): Promise<BasunipayCheckout | null> {
  try {
    const res = await fetch('/api/payments/qris/membership', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) return null
    const data = (await res.json()) as BasunipayCheckout
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
