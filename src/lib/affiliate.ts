/** Klien API Affiliate Tools. Semua endpoint butuh token member login. */

/** Sama dengan `MIN_WITHDRAWAL` di server/lib/affiliate.ts (dijaga test). */
export const MIN_WITHDRAWAL = 50000

export interface AffiliateCommission {
  id: number
  amount: number
  rate: number
  source: string
  createdAt: string
  referredName: string
}

export interface AffiliateWithdrawal {
  id: number
  amount: number
  destination: string
  note: string
  status: 'pending' | 'paid' | 'rejected'
  adminNote: string
  createdAt: string
  processedAt: string | null
}

export interface AffiliateData {
  referralCode: string
  balance: number
  totalEarned: number
  totalWithdrawn: number
  totalReferrals: number
  commissions: AffiliateCommission[]
  withdrawals: AffiliateWithdrawal[]
}

export interface AdminWithdrawal extends AffiliateWithdrawal {
  userId: number
  email: string
  name: string
}

async function api<T>(token: string, path: string, init?: RequestInit): Promise<T> {
  const res = await fetch(`/api/affiliate${path}`, {
    ...init,
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
      ...(init?.headers || {}),
    },
    signal: AbortSignal.timeout(10000),
  })
  const data = await res.json().catch(() => ({}))
  if (!res.ok) throw new Error((data as { error?: string }).error || 'Permintaan gagal')
  return data as T
}

export function fetchAffiliate(token: string): Promise<AffiliateData> {
  return api<AffiliateData>(token, '/me')
}

export function requestWithdrawal(
  token: string,
  amount: number,
  destination: string,
  note: string,
): Promise<{ ok: boolean; id: number }> {
  return api(token, '/withdraw', {
    method: 'POST',
    body: JSON.stringify({ amount, destination, note }),
  })
}

export function fetchAdminWithdrawals(token: string, status = ''): Promise<{ items: AdminWithdrawal[] }> {
  return api(token, `/admin/withdrawals${status ? `?status=${status}` : ''}`)
}

export function processWithdrawal(
  token: string,
  id: number,
  action: 'paid' | 'rejected',
  adminNote = '',
): Promise<{ ok: boolean }> {
  return api(token, `/admin/withdrawals/${id}/${action}`, {
    method: 'POST',
    body: JSON.stringify({ admin_note: adminNote }),
  })
}
