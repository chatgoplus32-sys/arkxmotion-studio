// ─── Jalur kredensial NexaBot untuk member berpakat ─────────────────────────
//
// Bug yang dijaga: member Premium Booster/Unlimited yang juga punya API key
// pribadi dipaksa memakai kunci itu, lalu gagal di upstream dengan 402 "Kredit
// tidak cukup" padahal paketnya sudah menanggung biaya generate. Aturannya:
// generate yang ditanggung paket dibayar kunci server; tanpa paket kunci
// pribadi tetap didahulukan supaya biaya upstream tidak jatuh ke operator.
import test from 'node:test'
import assert from 'node:assert/strict'
import { nexabotPreferServerKey } from '../src/lib/nexabotWallet.js'

test('paket aktif → kunci server walau member punya API key sendiri', () => {
  assert.equal(
    nexabotPreferServerKey({ hasOwnKey: true, serverReady: true, coveredByPackage: true }),
    true
  )
})

test('tanpa paket → kunci pribadi tetap dipakai', () => {
  assert.equal(
    nexabotPreferServerKey({ hasOwnKey: true, serverReady: true, coveredByPackage: false }),
    false
  )
})

test('tanpa kunci pribadi → kunci server selama relay menyatakan siap', () => {
  assert.equal(
    nexabotPreferServerKey({ hasOwnKey: false, serverReady: true, coveredByPackage: false }),
    true
  )
})

test('relay belum siap → tidak pernah memaksa jalur server', () => {
  assert.equal(
    nexabotPreferServerKey({ hasOwnKey: false, serverReady: false, coveredByPackage: true }),
    false
  )
  assert.equal(
    nexabotPreferServerKey({ hasOwnKey: true, serverReady: false, coveredByPackage: true }),
    false
  )
})
