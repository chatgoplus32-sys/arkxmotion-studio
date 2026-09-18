// ─── Umur access token app ──────────────────────────────────────────────────
// Yang dijaga di sini adalah batas keputusan "perbarui sekarang atau tidak".
// Salah ke arah "tidak" berarti sesi mati di tengah jalan setiap 15 menit dan
// poller auto-sync menembak server dengan 401 sampai pengguna login ulang;
// salah ke arah "ya" berarti refresh token dipakai jauh lebih sering dari
// perlu.
import test from 'node:test'
import assert from 'node:assert/strict'
import jwt from 'jsonwebtoken'
import {
  ACCESS_TOKEN_TTL_MS,
  REFRESH_MARGIN_MS,
  isTokenExpiring,
  secondsUntilExpiry,
  tokenExpiresAt,
} from '../src/lib/sessionExpiry.js'

// Detik bulat terdekat, bukan angka tetap: `jwt.sign` menstempel `iat` dari jam
// nyata, jadi `exp` hasil `expiresIn` juga relatif ke jam nyata. Patokan yang
// di-hardcode akan membuat tes ini lulus atau gagal menurut waktu jalan.
const NOW = Math.floor(Date.now() / 1000) * 1000

function token(deltaSeconds: number): string {
  return jwt.sign({ id: 1, email: 'a@test.local', role: 'user' }, 'rahasia-tes', { expiresIn: deltaSeconds })
}

test('token yang masih jauh dari kedaluwarsa tidak di-refresh', () => {
  const t = token(600) // 10 menit lagi, margin 3 menit
  assert.equal(isTokenExpiring(t, NOW), false)
  assert.ok((secondsUntilExpiry(t, NOW) ?? 0) > REFRESH_MARGIN_MS / 1000)
})

test('token yang tinggal di bawah margin sudah dianggap mepet', () => {
  assert.equal(isTokenExpiring(token(120), NOW), true)
})

test('token yang sudah kedaluwarsa tetap dianggap mepet', () => {
  assert.equal(isTokenExpiring(token(-60), NOW), true)
  assert.ok((secondsUntilExpiry(token(-60), NOW) ?? 0) < 0)
})

test('token tanpa exp / tidak terbaca diperlakukan sebagai mepet', () => {
  const tanpaExp = jwt.sign({ id: 1 }, 'rahasia-tes')
  assert.equal(tokenExpiresAt(tanpaExp), null)
  assert.equal(isTokenExpiring(tanpaExp, NOW), true)
  assert.equal(isTokenExpiring(null, NOW), true)
  assert.equal(isTokenExpiring('bukan.jwt', NOW), true)
  assert.equal(isTokenExpiring('', NOW), true)
})

test('batas margin dipakai apa adanya (<=, bukan <)', () => {
  const expDetik = Math.floor((NOW + REFRESH_MARGIN_MS) / 1000)
  const tepatDiBatas = jwt.sign({ id: 1, exp: expDetik }, 'rahasia-tes')
  assert.equal(tokenExpiresAt(tepatDiBatas), expDetik * 1000)
  assert.equal(isTokenExpiring(tepatDiBatas, NOW), true)
  assert.equal(isTokenExpiring(tepatDiBatas, NOW, REFRESH_MARGIN_MS - 1000), false)
})

test('ACCESS_TOKEN_TTL_MS mencerminkan ACCESS_EXPIRES server (15 menit)', () => {
  assert.equal(ACCESS_TOKEN_TTL_MS, 15 * 60 * 1000)
})
