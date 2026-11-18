import { WA_NUMBER, formatRp } from './membership'

/** Harga Add-on Akun default (Rp) — fallback sebelum config server termuat. */
export const DEFAULT_ADDON_FEE = 100000
/** Jumlah akun email siap pakai per periode add-on. */
export const ADDON_ACCOUNTS_PER_PERIOD = 3
/** Masa aktif add-on (hari) per pembayaran. */
export const ADDON_PERIOD_DAYS = 30

export interface AddonAccount {
  email: string
  password: string
  note?: string
}

export interface AddonPayment {
  id: number
  amount: number
  status: 'pending' | 'approved' | 'rejected'
  proofNote: string
  adminNote: string
  periodStart?: string | null
  periodEnd?: string | null
  createdAt: string
  amountTotal?: number | null
  uniqueCode?: number | null
  checkoutUrl?: string | null
  qrisImage?: string | null
}

export interface AddonStatus {
  fee: number
  accountsPerPeriod: number
  periodDays: number
  isActive: boolean
  periodStart: string | null
  periodEnd: string | null
  accounts: AddonAccount[]
  payment: AddonPayment | null
  /** true bila akun yang login adalah akun ADD-ON (bukan akun utama). */
  isAddonAccount?: boolean
  /** Sumber saldo yang berlaku untuk akun yang login. */
  saldoSource?: 'parent' | 'own'
  /** Nama pemilik akun utama (hanya bila akun yang login adalah add-on). */
  ownerName?: string | null
}

export interface AddonLink {
  email: string
  note: string
  paymentId: number
  periodEnd: string | null
  registered: boolean
  addonUserId: number | null
  name: string | null
  saldoSource: 'parent' | 'own'
  linked: boolean
}

let cachedFee: number | null = null
let cachedCount: number | null = null

/** Harga add-on aktif dari server (bisa diubah admin di halaman Membership). */
export async function getAddonFee(): Promise<number> {
  if (cachedFee != null) return cachedFee
  try {
    const res = await fetch('/api/membership/config', { signal: AbortSignal.timeout(8000) })
    const data = await res.json()
    const fee = Number(data?.addonFee)
    if (Number.isFinite(fee) && fee > 0) {
      cachedFee = fee
      const count = Number(data?.addonAccountsPerPeriod)
      if (Number.isFinite(count) && count > 0) cachedCount = count
      return fee
    }
  } catch (e) { console.warn('[addon] Failed to fetch Add-on fee:', e) }
  return DEFAULT_ADDON_FEE
}

/** Jumlah akun per periode dari server (fallback 3). */
export async function getAddonAccountsPerPeriod(): Promise<number> {
  await getAddonFee()
  return cachedCount ?? ADDON_ACCOUNTS_PER_PERIOD
}

export function setAddonFeeCache(fee: number | null) {
  cachedFee = fee
}

export function getAddonAccountsPerPeriodCached(): number {
  return cachedCount ?? ADDON_ACCOUNTS_PER_PERIOD
}

/** Daftar provisioning add-on milik member + status tautan & mode saldo. */
export async function fetchAddonLinks(token: string): Promise<AddonLink[]> {
  const res = await fetch('/api/membership/addon/links', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memuat daftar akun add-on')
  return (data.links || []) as AddonLink[]
}

/** Ubah mode saldo akun add-on (khusus pemilik akun utama). */
export async function setAddonSaldoSource(
  token: string,
  addonUserId: number,
  saldoSource: 'parent' | 'own',
): Promise<string> {
  const res = await fetch(`/api/membership/addon/links/${addonUserId}`, {
    method: 'PATCH',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ saldo_source: saldoSource }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal mengubah mode saldo')
  return data.message || 'Mode saldo diubah'
}

export async function fetchAddonStatus(token: string): Promise<AddonStatus> {
  const res = await fetch('/api/membership/addon/status', {
    headers: { Authorization: `Bearer ${token}` },
    signal: AbortSignal.timeout(8000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal memuat status Add-on Akun')
  return data as AddonStatus
}

/** Kirim konfirmasi pembayaran add-on (nominal ditentukan server). */
export async function submitAddonPayment(
  token: string,
  proofNote: string,
): Promise<{ payment: AddonPayment; basunipay?: { checkout_url?: string; payable_amount?: number; unique_code?: number; qris_image?: string } | null }> {
  const res = await fetch('/api/membership/addon/payment', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${token}` },
    body: JSON.stringify({ proof_note: proofNote }),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error(data.error || 'Gagal mengirim konfirmasi pembayaran')
  return data as { payment: AddonPayment; basunipay?: { checkout_url?: string; payable_amount?: number; unique_code?: number; qris_image?: string } | null }
}

/** Pesan WhatsApp ke admin bahwa pembayaran add-on sudah dikirim. */
export function buildAddonWaPaymentUrl(opts: { name?: string; email: string; note?: string; fee: number }): string {
  const lines = [
    'Halo admin ARKXMotion Studio',
    'Saya sudah melakukan pembayaran QRIS untuk Add-on Akun (3 akun email siap pakai / 30 hari).',
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
