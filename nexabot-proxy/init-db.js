/**
 * init-db.js — Inisialisasi database & seed member
 *
 * Jalankan:
 *   node init-db.js          → hanya buat tabel
 *   node init-db.js --seed   → buat tabel + 10 sample member
 */

require('dotenv').config();
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'members.db');
const shouldSeed = process.argv.includes('--seed');
const COST_PER_GENERATE = parseInt(process.env.COST_PER_GENERATE) || 250;

const db = new Database(DB_PATH);
db.pragma('journal_mode = WAL');

db.exec(`
  CREATE TABLE IF NOT EXISTS members (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    name        TEXT NOT NULL,
    api_key     TEXT UNIQUE NOT NULL,
    plan        TEXT CHECK (plan IN ('weekly', 'monthly', 'topup')) NOT NULL,
    status      TEXT CHECK (status IN ('pending', 'approved', 'suspended')) NOT NULL DEFAULT 'pending',
    saldo       INTEGER NOT NULL DEFAULT 0,
    started_at  TEXT NOT NULL DEFAULT (datetime('now')),
    expires_at  TEXT NOT NULL,
    active      INTEGER NOT NULL DEFAULT 1
  );
  CREATE INDEX IF NOT EXISTS idx_members_api_key ON members(api_key);
  CREATE TABLE IF NOT EXISTS usage_log (
    id          INTEGER PRIMARY KEY AUTOINCREMENT,
    member_id   INTEGER NOT NULL,
    action      TEXT NOT NULL,
    cost        INTEGER NOT NULL DEFAULT 0,
    saldo_after INTEGER,
    created_at  TEXT NOT NULL DEFAULT (datetime('now')),
    FOREIGN KEY (member_id) REFERENCES members(id)
  );
`);

try { db.exec(`ALTER TABLE members ADD COLUMN saldo INTEGER NOT NULL DEFAULT 0`); } catch(e){}
try { db.exec(`ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`); } catch(e){}

console.log('✅ Tabel siap.');

if (shouldSeed) {
  const seed = db.prepare(
    `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at)
     VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
  );

  const now = Date.now();
  const WEEK = 7*24*60*60*1000, MONTH = 30*24*60*60*1000, YEAR = 365*24*60*60*1000;

  const members = [
    // Mingguan — sudah approved
    { name:'Budi Santoso',    plan:'weekly',  status:'approved', saldo:0,    dur:WEEK },
    { name:'Rina Wati',       plan:'weekly',  status:'approved', saldo:0,    dur:WEEK },
    { name:'Ahmad Fauzi',     plan:'weekly',  status:'pending',  saldo:0,    dur:WEEK },
    // Bulanan — sudah approved
    { name:'Siti Nurhaliza',  plan:'monthly', status:'approved', saldo:0,    dur:MONTH },
    { name:'Andi Pratama',    plan:'monthly', status:'approved', saldo:0,    dur:MONTH },
    // Topup — mix status
    { name:'Rizky Ramadhani', plan:'topup',   status:'approved', saldo:10000,dur:YEAR },
    { name:'Putri Maharani',  plan:'topup',   status:'approved', saldo:5000, dur:YEAR },
    { name:'Fajar Nugroho',   plan:'topup',   status:'pending',  saldo:15000,dur:YEAR },
    { name:'Dewi Lestari',    plan:'topup',   status:'approved', saldo:2500, dur:YEAR },
    // Suspended
    { name:'Maya Anggraini',  plan:'monthly', status:'suspended', saldo:0,   dur:MONTH },
  ];

  const insertMany = db.transaction(items => {
    for (const m of items) {
      const apiKey = `arkx-${crypto.randomBytes(24).toString('hex')}`;
      const exp = new Date(now + m.dur).toISOString();
      seed.run(m.name, apiKey, m.plan, m.status, m.saldo, exp);
      const icon = m.status==='approved'?'✅':m.status==='pending'?'⏳':'⏸';
      console.log(`  ${icon} ${m.name.padEnd(18)} [${m.plan.padEnd(7)}] ${m.status.padEnd(8)} Rp ${m.saldo.toLocaleString('id-ID')}`);
    }
  });

  insertMany(members);
  console.log(`\n✅ ${members.length} member di-seed.`);
  console.log(`   Approved: ${members.filter(m=>m.status==='approved').length}`);
  console.log(`   Pending:  ${members.filter(m=>m.status==='pending').length}`);
  console.log(`   Suspended:${members.filter(m=>m.status==='suspended').length}`);
}

db.close();
