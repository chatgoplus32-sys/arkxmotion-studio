import { WA_NUMBER, formatRp } from './membership'

/** Harga upgrade Pro (Rp) — fallback sebelum config server termuat. */
export const DEFAULT_PRO_FEE = 50000

export interface ProPayment {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proofNote: string
  adminNote: string
  createdAt: string
}

export interface ProStatus {
  plan: 'free' | 'pro'
  isAdmin: boolean
  proSince: string | null
  payment: ProPayment | null
}

let cachedFee: number | null = null

/** Harga Pro aktif dari server (bisa diubah admin di halaman Membership). */
export async function getProFee(): Promise<number> {
  if (cachedFee != null) return cachedFee
  try {
    const res = await fetch('/api/membership/config', { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    const fee = Number(data?.proFee)
    if (Number.isFinite(fee) && fee > 0) {
      cachedFee = fee
      return fee
    }
  } catch (e) { console.warn('[pro] Failed to fetch Pro fee:', e) }
  return DEFAULT_PRO_FEE
}

export function setProFeeCache(fee: number | null) {
  cachedFee = fee
}

export async function fetchProStatus(token: string): Promise<ProStatus> {
  const res = await fetch('/api/membership/pro/status', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memuat status Pro')
  return data as ProStatus
}

/** Kirim konfirmasi pembayaran Pro (nominal ditentukan server). */
export async function submitProPayment(token: string, proofNote: string): Promise<{ payment: ProPayment }> {
  const res = await fetch('/api/membership/pro/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ proof_note: proofNote }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal mengirim konfirmasi pembayaran')
  return data
}

/** Pesan WhatsApp ke admin bahwa pembayaran Pro sudah dikirim. */
export function buildProWaPaymentUrl(opts: { name?: string; email: string; note?: string; fee: number }): string {
  const lines = [
    'Halo admin ARKXMotion Studio 👋',
    'Saya sudah melakukan pembayaran QRIS untuk upgrade akun Pro (semua fitur AI).',
    '',
    opts.name ? `Nama: ${opts.name}` : '',
    `Email: ${opts.email}`,
    `Nominal: ${formatRp(opts.fee)}`,
    opts.note ? `Catatan: ${opts.note}` : '',
    '',
    'Mohon dicek dan diaktifkan ya. Terima kasih.',
  ].filter(Boolean)
  return `https://wa.me/${WA_NUMBER}?text=${encodeURIComponent(lines.join('\n'))}`
}
