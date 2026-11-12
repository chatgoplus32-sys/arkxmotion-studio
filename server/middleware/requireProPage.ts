/**
 * Gerbang halaman statis berlisensi (ARKX AUTO Studio & ARKX AUTO Motion).
 *
 * Halaman aplikasi penuh itu sebelumnya disajikan sebagai berkas publik —
 * siapa pun bisa Unduh/Save Page As tanpa akun. Gate ini memastikan hanya
 * member Pro (atau admin) yang bisa mengunduh, sekaligus memblokir mesin
 * pencari (X-Robots-Tag di-set oleh static handler).
 *
 * Browser tidak mengirim Bearer header saat navigasi biasa, jadi credential
 * dipegang cookie httpOnly `arkx_session` (isi = refresh token yang sama
 * dengan yang dipegang klien). Cookie hanya di-set/di-clear di rute auth.
 */
import { Request, Response, NextFunction } from 'express'
import jwt from 'jsonwebtoken'
import db from '../db.js'

const REFRESH_SECRET = process.env.JWT_REFRESH_SECRET || (process.env.JWT_SECRET || '') + '-refresh'

function parseCookies(req: Request): Record<string, string> {
  const out: Record<string, string> = {}
  const raw = req.headers.cookie
  if (typeof raw !== 'string') return out
  for (const part of raw.split(';')) {
    const idx = part.indexOf('=')
    if (idx < 0) continue
    const k = part.slice(0, idx).trim()
    const v = part.slice(idx + 1).trim()
    if (k) {
      try { out[k] = decodeURIComponent(v) } catch { out[k] = v }
    }
  }
  return out
}

const UPGRADE_PAGE = `<!doctype html>
<html lang="id">
<head>
<meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>Fitur Pro — ARKXMotion</title>
<style>
body{margin:0;min-height:100vh;display:grid;place-items:center;background:#0A0B0E;color:#ECEEF3;font:15px/1.6 system-ui,sans-serif}
.card{max-width:420px;background:#13151B;border:1px solid #22252E;border-radius:18px;padding:32px;text-align:center}
h1{font-size:20px;margin:0 0 8px}
p{color:#9AA1AF;margin:0 0 20px;font-size:14px}
a.btn{display:inline-block;padding:12px 22px;border-radius:12px;text-decoration:none;font-weight:700;background:linear-gradient(180deg,#FF7C40,#EE5413);color:#fff}
a.sub{display:block;margin-top:14px;color:#5F6676;font-size:12px;text-decoration:none}
</style>
</head>
<body>
<div class="card">
  <h1>Fitur Pro</h1>
  <p>ARKX AUTO Studio &amp; ARKX AUTO Motion khusus member Pro. Upgrade sekali bayar untuk membuka kedua studio itu (dan Gemini Tools, AI Song Cover, H3 Music Avatar) — permanen.</p>
  <a class="btn" href="/upgrade-pro">Upgrade ke Pro</a>
  <a class="sub" href="/login">Ganti akun</a>
</div>
</body>
</html>`

export function requireProPage(req: Request, res: Response, next: NextFunction) {
  const raw = parseCookies(req)['arkx_session']
  const fail = () => res.redirect(302, '/login?next=' + encodeURIComponent(req.originalUrl || '/'))
  try {
    if (!raw) return fail()
    const payload = jwt.verify(raw, REFRESH_SECRET) as any
    if (payload.kind !== 'refresh' || !payload.id) return fail()
    const row = db.prepare(
      'SELECT role, plan, approved, refresh_token FROM users WHERE id = ?'
    ).get(payload.id) as any
    // Refresh token dari DB harus cocok — jika sudah di-logout/rotasi, tolak.
    if (!row || row.refresh_token !== raw) return fail()
    const isPro = row.role === 'admin' || row.plan === 'pro'
    if (!isPro) {
      res.status(403).set({ 'Content-Type': 'text/html; charset=utf-8', 'X-Robots-Tag': 'noindex, nofollow, noarchive', 'Cache-Control': 'no-store' }).send(UPGRADE_PAGE)
      return
    }
    next()
  } catch {
    return fail()
  }
}
