import test, { after } from 'node:test'
import assert from 'node:assert/strict'

process.env.ARKXMOTION_DB_PATH = ':memory:'
process.env.ALERT_WEBHOOK_URL = ''
process.env.BASUNIPAY_ENABLED = 'true'
process.env.BASUNIPAY_API_KEY = 'test-only'
const { default: db } = await import('../server/db.js')
const { pollBasunipayPayments } = await import('../server/lib/basunipay.js')
const originalFetch = globalThis.fetch
let calls = 0
globalThis.fetch = async () => {
  calls++
  return Response.json({ success: true, data: { status: 'paid' } })
}
after(() => { globalThis.fetch = originalFetch; db.close() })

function seed(id: number, status = 'pending') {
  db.prepare("INSERT INTO users (id,email,password,name) VALUES (?,?,'x','Test')").run(id, `test${id}@example.test`)
  db.prepare('INSERT INTO runninghub_topup (id,user_id,amount,status) VALUES (?,?,1000,?)').run(id, id, status)
  db.prepare("INSERT INTO basunipay_payment (order_id,ref_table,ref_id,user_id,base_amount,payable_amount) VALUES (?,'runninghub_topup',?,?,1000,1100)").run(`test-${id}`, id, id)
}
const payment = (id: number) => db.prepare('SELECT status,paid_at FROM basunipay_payment WHERE ref_id=?').get(id) as { status: string; paid_at: string | null }
const balance = (id: number) => (db.prepare('SELECT balance FROM runninghub_balance WHERE user_id=?').get(id) as { balance: number } | undefined)?.balance || 0

test('paid but rejected reference stays recoverable; retry credits once without another provider call', async () => {
  seed(1, 'rejected')
  assert.equal((await pollBasunipayPayments()).paid, 0)
  assert.equal(payment(1).status, 'pending')
  assert.ok(payment(1).paid_at)
  assert.equal(balance(1), 0)
  assert.ok(db.prepare("SELECT 1 FROM payment_verify_log WHERE action='approval_pending'").get())
  const before = calls
  db.prepare("UPDATE runninghub_topup SET status='pending' WHERE id=1").run()
  db.prepare("UPDATE basunipay_payment SET created_at=datetime('now','-8 days') WHERE ref_id=1").run()
  assert.equal((await pollBasunipayPayments()).paid, 1)
  assert.equal(calls, before)
  assert.equal(balance(1), 1100)
  assert.equal(payment(1).status, 'paid')
  await pollBasunipayPayments()
  assert.equal(balance(1), 1100)
})

test('an approval exception does not skip later payments; retry preserves idempotency', async () => {
  seed(2)
  seed(3)
  db.exec("CREATE TRIGGER block_credit BEFORE INSERT ON runninghub_balance WHEN NEW.user_id=2 BEGIN SELECT RAISE(ABORT,'test failure'); END")
  assert.equal((await pollBasunipayPayments()).paid, 1)
  assert.equal(payment(2).status, 'pending')
  assert.equal(balance(2), 0)
  assert.equal(balance(3), 1100)
  db.exec('DROP TRIGGER block_credit')
  await pollBasunipayPayments()
  assert.equal(balance(2), 1100)
  assert.equal(balance(3), 1100)
})

test('manual approval and overlapping polls never credit twice', async () => {
  seed(4, 'approved')
  db.prepare('INSERT INTO runninghub_balance (user_id,balance) VALUES (4,1000)').run()
  seed(5)
  await Promise.all([pollBasunipayPayments(), pollBasunipayPayments()])
  assert.equal(balance(4), 1000)
  assert.equal(balance(5), 1100)
  assert.equal(payment(4).status, 'paid')
})
