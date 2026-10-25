/** Harga join promo default (Rp) — dipakai sementara / fallback sebelum fetch. */
export const DEFAULT_MEMBERSHIP_FEE = 250000
/** Harga join normal (harga coret) — diskon dari Rp 350.000. */
export const DEFAULT_MEMBERSHIP_FEE_ORIGINAL = 350000

/** Nomor WhatsApp admin untuk konfirmasi pembayaran. */
export const WA_NUMBER = '6285156207924'

/** Gambar QRIS tujuan pembayaran. */
export { QRIS_IMG } from './payment'

export interface MembershipPricing {
  fee: number
  originalFee: number
}

let cachedPricing: MembershipPricing | null = null

async function fetchMembershipPricing(): Promise<MembershipPricing> {
  const res = await fetch('/api/membership/config', { signal: AbortSignal.timeout(8000) })
  const data = await res.json()
  const fee = Number(data?.membershipFee)
  const originalFee = Number(data?.membershipFeeOriginal)
  if (!Number.isFinite(fee) || fee <= 0) throw new Error('Harga join tidak valid')
  return {
    fee,
    originalFee: Number.isFinite(originalFee) && originalFee > 0 ? originalFee : DEFAULT_MEMBERSHIP_FEE_ORIGINAL,
  }
}

/**
 * Ambil harga join dari server (bisa diubah admin via halaman Admin →
 * Membership). Di-cache per sesi; fallback ke harga default.
 */
export async function getMembershipPricing(): Promise<MembershipPricing> {
  if (cachedPricing) return cachedPricing
  try {
    cachedPricing = await fetchMembershipPricing()
    return cachedPricing
  } catch (e) {
    console.warn('[membership] Failed to fetch membership pricing:', e)
    return { fee: DEFAULT_MEMBERSHIP_FEE, originalFee: DEFAULT_MEMBERSHIP_FEE_ORIGINAL }
  }
}

export async function getMembershipFee(): Promise<number> {
  return (await getMembershipPricing()).fee
}

/** Set cache harga (dipakai halaman admin setelah mengubah harga). */
export function setMembershipPricingCache(pricing: MembershipPricing | null) {
  cachedPricing = pricing
}

export function formatRp(n: number): string {
  return `Rp ${n.toLocaleString('id-ID')}`
}

/** Bangun URL WhatsApp dengan pesan konfirmasi pembayaran. */
export function buildWaPaymentUrl(opts: { name?: string; email: string; note?: string; fee: number }): string {
  const lines = [
    'Halo admin ARKXMotion Studio 👋',
    'Saya sudah melakukan pembayaran QRIS untuk join member Pro.',
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
