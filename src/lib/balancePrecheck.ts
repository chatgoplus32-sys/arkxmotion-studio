import { checkRoboneoBalance } from '@/lib/roboneo'
import { selectWeavyTokenForCredits } from '@/lib/weavy'
import { getGalleri5AuthHeaders, checkGalleri5Balance } from '@/lib/galleri5'
import { useProviderManager } from '@/stores/providerManager'

export interface BalancePrecheckResult {
  ok: boolean
  balance?: number | null
  error?: string
}

/**
 * Pre-check saldo provider vs estimasi biaya sebelum generate dimulai.
 * Provider yang tidak punya endpoint balance (leonardo, magnific, runninghub,
 * wavespeed, framia, dst) hanya dicek keberadaan key aktif — tanpa blokir.
 *
 * @param provider        ID provider (roboneo | weavy | galleri5 | createpulse | lainnya)
 * @param minCredits      Estimasi biaya generate dalam credits
 * @param opts            Opsi tambahan: cpBalance (saldo CreatePulse yang sudah di-fetch di halaman),
 *                        authToken (token sesi untuk CreatePulse)
 */
export async function precheckProviderBalance(
  provider: string,
  minCredits: number,
  opts: { cpBalance?: number; authToken?: string; isCpAdmin?: boolean } = {}
): Promise<BalancePrecheckResult> {
  if (minCredits <= 0) return { ok: true }

  switch (provider) {
    case 'roboneo':
      return precheckRoboneoBalance(minCredits)
    case 'weavy':
      return precheckWeavyBalance(minCredits)
    case 'galleri5':
      return precheckGalleri5Balance(minCredits)
    case 'oneover':
      return precheckOneOverBalance(minCredits)
    case 'createpulse': {
      if (opts.isCpAdmin) return { ok: true }
      const balance = opts.cpBalance
      if (balance === undefined) return { ok: true } // saldo belum dimuat → biarkan flow yang cek
      if (balance >= minCredits) return { ok: true, balance }
      return {
        ok: false,
        balance,
        error: `Saldo CreatePulse tidak cukup: Rp ${balance.toLocaleString('id-ID')} < Rp ${minCredits.toLocaleString('id-ID')}. Top up dulu.`,
      }
    }
    default: {
      const key = useProviderManager.getState().getFirstValidKey(provider as any)
      if (!key) {
        return { ok: false, error: `Tidak ada API key aktif untuk provider ini. Tambahkan di halaman Providers.` }
      }
      return { ok: true }
    }
  }
}

/**
 * Cek saldo Roboneo: cari key aktif dengan saldo >= minCredits.
 * Menggunakan balance yang tersimpan di store bila cukup, lalu fallback
 * probe balance key yang belum diketahui / kurang.
 */
export async function precheckRoboneoBalance(minCredits: number): Promise<BalancePrecheckResult> {
  const store = useProviderManager.getState()
  const keys = store.keys.roboneo || []
  if (keys.length === 0) {
    return { ok: false, error: 'Tidak ada token Roboneo. Tambahkan di halaman Providers.' }
  }

  // 1) Key yang sudah ber-status active & balance diketahui cukup → langsung lolos
  const cached = keys.find((k) => k.status === 'active' && k.balance != null && k.balance >= minCredits)
  if (cached) return { ok: true, balance: cached.balance }

  // 2) Probe SEMUA key yang belum punya balance / balance-nya kurang (urutan: balance desc)
  //    Supaya key dengan saldo cukup tidak terlewat (rotasi otomatis ke token berikutnya).
  const candidates = [...keys]
    .filter((k) => k.status !== 'invalid' && k.status !== 'expired')
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))

  let bestBalance: number | null = null
  for (const k of candidates) {
    try {
      const res = await checkRoboneoBalance(k.key)
      if (!res.ok) continue
      const bal = res.balance
      if (bal == null) continue
      bestBalance = Math.max(bestBalance ?? 0, bal)
      store.updateKeyStatus('roboneo', k.id, bal <= 0 ? 'empty' : 'active', bal)
      if (bal >= minCredits) return { ok: true, balance: bal }
    } catch {
      // token error — lanjut key berikutnya
    }
  }

  return {
    ok: false,
    balance: bestBalance,
    error: bestBalance != null
      ? `Saldo Roboneo tidak cukup: butuh ${minCredits} cr, saldo tertinggi ${bestBalance} cr. Top up atau pilih model lebih murah.`
      : 'Saldo Roboneo tidak bisa dicek (semua token gagal). Perbarui token di Providers.',
  }
}

/**
 * Cek saldo Weavy: pakai selectWeavyTokenForCredits yang sudah ada — memilih
 * token valid dengan balance >= minCredits (probe API bila perlu).
 */
export async function precheckWeavyBalance(minCredits: number): Promise<BalancePrecheckResult> {
  const selected = await selectWeavyTokenForCredits(minCredits)
  if (selected) return { ok: true, balance: selected.token.balance ?? null }
  return {
    ok: false,
    error: `Saldo Weavy tidak cukup: butuh ${minCredits} cr dan tidak ada token dengan saldo mencukupi. Top up atau tambahkan token baru.`,
  }
}

/**
 * Cek saldo OneOver: probe balance via /api-v1-usage?view=balance
 */
export async function precheckOneOverBalance(minCredits: number): Promise<BalancePrecheckResult> {
  const store = useProviderManager.getState()
  const keys = store.keys.oneover || []
  if (keys.length === 0) {
    return { ok: false, error: 'Tidak ada token OneOver. Tambahkan di halaman Providers (paste access_token dari oneover.com).' }
  }

  // Check cached balances first
  const cached = keys.find((k) => k.status === 'active' && k.balance != null && k.balance >= minCredits)
  if (cached) return { ok: true, balance: cached.balance }

  // Probe all valid keys
  const candidates = [...keys]
    .filter((k) => k.status !== 'invalid' && k.status !== 'expired')
    .sort((a, b) => (b.balance ?? 0) - (a.balance ?? 0))

  let bestBalance: number | null = null
  for (const k of candidates) {
    try {
      const { resolveOneOverAccessToken, checkOneOverBalance, extractOneOverUserId } = await import('@/lib/oneover')
      const accessToken = await resolveOneOverAccessToken(k.key)
      const userId = extractOneOverUserId(accessToken)
      const res = await checkOneOverBalance(accessToken, userId || undefined)
      if (!res.ok) continue
      const bal = res.balance ?? 0
      bestBalance = Math.max(bestBalance ?? 0, bal)
      store.updateKeyStatus('oneover', k.id, bal >= minCredits ? 'active' : bal > 0 ? 'active' : 'empty', bal)
      if (bal >= minCredits) return { ok: true, balance: bal }
    } catch {
      // key error — try next
    }
  }

  return {
    ok: false,
    balance: bestBalance,
    error: bestBalance != null
      ? `Saldo OneOver tidak cukup: butuh ${minCredits} cr, saldo tertinggi ${bestBalance} cr.`
      : 'Saldo OneOver tidak bisa dicek. Perbarui token di Providers.',
  }
}

/**
 * Cek saldo G5 AI Studio: getGalleri5AuthHeaders dengan minCredits —
 * hanya mengembalikan headers bila ada key dengan balance cukup.
 */
export async function precheckGalleri5Balance(minCredits: number): Promise<BalancePrecheckResult> {
  const headers = await getGalleri5AuthHeaders(undefined, minCredits)
  if (headers) return { ok: true }
  return {
    ok: false,
    error: `Saldo G5 AI Studio tidak cukup: butuh ${minCredits} cr. Top up atau tambahkan token Firebase baru di Providers.`,
  }
}

/**
 * Refresh saldo dari API provider (bukan dari cache localStorage) dan tulis
 * hasilnya kembali ke storage arkxmotion.providers. Dipakai badge saldo
 * (klik untuk refresh) dan halaman Providers.
 */
export async function refreshProviderBalance(
  provider: string
): Promise<BalancePrecheckResult & { email?: string }> {
  const store = useProviderManager.getState()

  if (provider === 'roboneo') {
    const keys = store.keys.roboneo || []
    const key = keys.find((k) => k.status !== 'invalid' && k.status !== 'expired') || keys[0]
    if (!key) return { ok: false, error: 'Tidak ada token Roboneo di Providers.' }
    const res = await checkRoboneoBalance(key.key)
    if (!res.ok) return { ok: false, error: res.error || 'Gagal cek saldo Roboneo' }
    const bal = res.balance
    if (bal != null) {
      store.updateKeyStatus('roboneo', key.id, bal > 0 ? 'active' : 'empty', bal)
      window.dispatchEvent(new Event('aatools:keys-changed'))
    }
    return { ok: true, balance: bal }
  }

  if (provider === 'weavy') {
    // selectWeavyTokenForCredits(0) resolve token + fetch credits + update storage
    const selected = await selectWeavyTokenForCredits(0)
    if (!selected) return { ok: false, error: 'Tidak ada token Weavy aktif di Providers.' }
    window.dispatchEvent(new Event('aatools:keys-changed'))
    return { ok: true, balance: selected.token.balance ?? null }
  }

  if (provider === 'oneover') {
    const { resolveOneOverAccessToken, checkOneOverBalance, extractOneOverUserId } = await import('@/lib/oneover')
    const keys = store.keys.oneover || []
    const key = keys.find((k) => k.status !== 'invalid' && k.status !== 'expired') || keys[0]
    if (!key) return { ok: false, error: 'Tidak ada token OneOver di Providers.' }
    const accessToken = await resolveOneOverAccessToken(key.key)
    const userId = extractOneOverUserId(accessToken)
    const res = await checkOneOverBalance(accessToken, userId || undefined)
    if (!res.ok) return { ok: false, error: res.error || 'Gagal cek saldo OneOver' }
    const bal = res.balance ?? 0
    if (bal != null) {
      store.updateKeyStatus('oneover', key.id, bal > 0 ? 'active' : 'empty', bal)
      window.dispatchEvent(new Event('aatools:keys-changed'))
    }
    return { ok: true, balance: bal }
  }

  if (provider === 'galleri5') {
    const keys = store.keys.galleri5 || []
    const key = keys.find((k) => k.status !== 'invalid' && k.status !== 'expired') || keys[0]
    if (!key) return { ok: false, error: 'Tidak ada token G5 AI Studio di Providers.' }
    try {
      // Tanpa tokenKey → pilih key aktif dari localStorage (aman setelah token di-rotate)
      const headers = await getGalleri5AuthHeaders(undefined, 0)
      if (!headers) return { ok: false, error: 'Gagal resolve auth G5 AI Studio.' }
      const res = await checkGalleri5Balance(headers)
      if (!res.ok) return { ok: false, error: res.error || 'Gagal cek saldo G5' }
      const bal = res.balance
      if (bal != null) {
        store.updateKeyStatus('galleri5', key.id, bal >= 60 ? 'active' : bal > 0 ? 'active' : 'empty', bal, res.email || key.email)
        window.dispatchEvent(new Event('aatools:keys-changed'))
      }
      return { ok: true, balance: bal, email: res.email }
    } catch (err: any) {
      return { ok: false, error: err.message || 'Gagal cek saldo G5 AI Studio' }
    }
  }

  return { ok: false, error: `Provider "${provider}" tidak mendukung refresh saldo.` }
}
