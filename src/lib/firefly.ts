const FIREFLY_API_KEY = 'SunbreakWebUI1'

function decodeJwtPayload(token: string): Record<string, unknown> | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = JSON.parse(atob(parts[1]))
    return payload
  } catch {
    return null
  }
}

export async function checkFireflyBalance(token: string): Promise<{ ok: boolean; balance?: number; total?: number; used?: number; plan?: string; error?: string }> {
  const trimmed = token.trim()
  if (!/^eyJ[\w-]*\.[\w-]+\.[\w-]+$/.test(trimmed)) {
    return { ok: false, error: 'Token bukan JWT valid' }
  }

  const payload = decodeJwtPayload(trimmed)
  if (!payload) {
    return { ok: false, error: 'Gagal decode JWT' }
  }

  // Check expiry
  const expMs = payload.expires_in ? parseInt(payload.expires_in as string) : (payload.exp ? (payload.exp as number) * 1000 - Date.now() : 0)
  if (expMs > 0 && expMs < 60000) {
    return { ok: false, error: 'Token hampir expired (< 1 menit). Ambil baru dari firefly.adobe.com.' }
  }

  const userId = (payload.user_id as string) || ''

  try {
    const r = await fetch('https://firefly.adobe.io/v1/credits/balance', {
      method: 'GET',
      headers: {
        'Authorization': `Bearer ${trimmed}`,
        'x-api-key': FIREFLY_API_KEY,
        'x-account-id': userId,
      },
    })

    if (!r.ok) {
      const text = await r.text().catch(() => '')
      return { ok: false, error: `HTTP ${r.status}: ${text.slice(0, 120)}` }
    }

    const data = await r.json().catch(() => null)
    if (!data) {
      return { ok: false, error: 'Gagal parse response' }
    }

    // Response shape: { total: { quota: { total, used, available } }, credits: { firefly_plan_credit, firefly_free_credit } }
    const totalQuota = data?.total?.quota
    const planCredit = data?.credits?.firefly_plan_credit?.quota
    const freeCredit = data?.credits?.firefly_free_credit?.quota

    const total = totalQuota?.total ?? 0
    const used = totalQuota?.used ?? 0
    const available = totalQuota?.available ?? (total - used)

    const planTotal = planCredit?.total ?? 0
    const freeTotal = freeCredit?.total ?? 0

    if (total <= 0 && planTotal <= 0 && freeTotal <= 0) {
      return { ok: false, error: 'Balance kosong — pastikan login dengan akun yang punya subscription Firefly' }
    }

    const plan = planTotal > 0 ? 'Firefly Plan' : 'Firefly Free'

    return {
      ok: true,
      balance: available,
      total,
      used,
      plan,
    }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Gagal cek balance' }
  }
}