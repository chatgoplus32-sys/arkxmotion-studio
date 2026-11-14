// Helper JWT RunningHub — dipisah dari relay supaya pool token master bisa
// memakainya tanpa impor melingkar (relay → pool → relay).

/** exp (detik sejak epoch) dari payload JWT — null kalau bukan JWT valid. */
export function rhJwtExp(token: string): number | null {
  const parts = String(token || '').split('.')
  if (parts.length < 2 || !parts[0].startsWith('ey')) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    return typeof decoded?.exp === 'number' ? decoded.exp : null
  } catch {
    return null
  }
}

export function rhJwtExpired(token: string): boolean {
  const exp = rhJwtExp(token)
  return exp !== null && Date.now() > exp * 1000
}

/** sub (id akun) dari payload JWT — null kalau bukan JWT valid. */
export function rhJwtSub(token: string): string | null {
  const parts = String(token || '').split('.')
  if (parts.length < 2 || !parts[0].startsWith('ey')) return null
  try {
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const padded = payload + '='.repeat((4 - payload.length % 4) % 4)
    const decoded = JSON.parse(Buffer.from(padded, 'base64').toString('utf8'))
    const sub = decoded?.sub
    return sub === undefined || sub === null || sub === '' ? null : String(sub)
  } catch {
    return null
  }
}