/** Harga membership default (Rp) — dipakai sementara / fallback sebelum fetch. */
export const DEFAULT_MEMBERSHIP_FEE = 150000

/** Nomor WhatsApp admin untuk konfirmasi pembayaran. */
export const WA_NUMBER = '6285156207924'

/** Gambar QRIS tujuan pembayaran. */
export const QRIS_IMG = '/qris-faezya-cell.jpg'

let cachedFee: number | null = null

/**
 * Ambil harga membership dari server (bisa diubah admin via halaman Admin →
 * Membership). Di-cache per sesi; fallback ke DEFAULT_MEMBERSHIP_FEE.
 */
export async function getMembershipFee(): Promise<number> {
  if (cachedFee != null) return cachedFee
  try {
    const res = await fetch('/api/membership/config', { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    const fee = Number(data?.membershipFee)
    if (Number.isFinite(fee) && fee > 0) {
      cachedFee = fee
      return fee
    }
  } catch {}
  return DEFAULT_MEMBERSHIP_FEE
}

/** Set cache harga (dipakai halaman admin setelah mengubah harga). */
export function setMembershipFeeCache(fee: number | null) {
  cachedFee = fee
}

export function formatRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

/** Bangun URL WhatsApp dengan pesan konfirmasi pembayaran. */
export function buildWaPaymentUrl(opts: { name?: string; email: string; note?: string; fee: number }): string {
  const lines = [
    'Halo admin ARKXMotion Studio 👋',
    'Saya sudah melakukan pembayaran QRIS untuk pendaftaran member.',
    '',
    opts.name ? `Nama: ${opts.name}` : '',
    `Email: ${opts.email}`,
    `Nominal: ${formatRp(opts.fee)}`,
    opts.note ? `Catatan: ${opts.note}` : '',
    '',
    'Mohon dicek dan disetujui ya. Terima kasih.',
  ].filter(Boolean)
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`
}
