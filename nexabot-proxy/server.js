/**
 * Nexabot Proxy Server v3
 *
 * Arsitektur:
 *   Member → [Proxy ini] → Nexabot (master key)
 *
 * Workflow:
 *   1. Admin tambah member → status 'pending'
 *   2. Admin approve → status 'approved' → member bisa generate
 *   3. Member generate → proxy cek plan & validasi
 *
 * 3 mode langganan:
 *   - weekly   : unlimited 7 hari
 *   - monthly  : unlimited 30 hari
 *   - topup    : bayar per generate, saldo dikurangi Rp 250/request
 */

require('dotenv').config();
const express = require('express');
const Database = require('better-sqlite3');
const crypto = require('crypto');
const path = require('path');

// ── Config ──────────────────────────────────────────────────────────────────
const PORT = process.env.PORT || 3000;
const MASTER_KEY = process.env.NEXABOT_MASTER_KEY;
const NEXABOT_BASE_URL = process.env.NEXABOT_BASE_URL || 'https://api.nexabot.com';
const DB_PATH = process.env.DB_PATH || path.join(__dirname, 'members.db');
const COST_PER_GENERATE = parseInt(process.env.COST_PER_GENERATE) || 250;

if (!MASTER_KEY) {
  console.error('❌ NEXABOT_MASTER_KEY wajib diisi di .env');
  process.exit(1);
}

// ── Database ────────────────────────────────────────────────────────────────
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

// Migrasi kolom lama
try { db.exec(`ALTER TABLE members ADD COLUMN saldo INTEGER NOT NULL DEFAULT 0`); } catch (e) {}
try { db.exec(`ALTER TABLE members ADD COLUMN status TEXT NOT NULL DEFAULT 'approved'`); } catch (e) {}

// ── Express ─────────────────────────────────────────────────────────────────
const app = express();
app.use(express.json());

// Serve dashboard & register page
app.get('/admin', (req, res) => res.sendFile(path.join(__dirname, 'dashboard.html')));
app.get('/register', (req, res) => res.sendFile(path.join(__dirname, 'register.html')));

app.get('/health', (req, res) => res.json({ status: 'ok', uptime: process.uptime() }));

// ══════════════════════════════════════════════════════════════════════════════
// PUBLIC: Register (member self-register)
// ══════════════════════════════════════════════════════════════════════════════
app.post('/register', (req, res) => {
  const { name, plan } = req.body;
  if (!name || !plan) return res.status(400).json({ error: 'name dan plan wajib diisi.' });
  if (!['weekly', 'monthly', 'topup'].includes(plan)) return res.status(400).json({ error: 'Plan tidak valid.' });

  const apiKey = `arkx-${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date();
  let expiresAt;
  let initialSaldo = 0;

  if (plan === 'weekly') expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  else { expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(); }

  const result = db.prepare(
    `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, 'pending', ?, datetime('now'), ?)`
  ).run(name, apiKey, plan, initialSaldo, expiresAt);

  console.log(`[REGISTER] New member: ${name} (${plan}) — ID: ${result.lastInsertRowid}`);

  // Broadcast real-time event ke admin panel
  broadcastSSE({ type: 'new_member', id: result.lastInsertRowid, name, plan, time: new Date().toISOString() });

  res.json({
    message: 'Pendaftaran berhasil! Menunggu approve dari admin.',
    id: result.lastInsertRowid, name, plan,
    api_key: apiKey,
    expires_at: expiresAt
  });
});

// ══════════════════════════════════════════════════════════════════════════════
// PROXY: validasi member lalu forward ke Nexabot
// ══════════════════════════════════════════════════════════════════════════════
function validateSubscription(req, res, next) {
  const apiKey = req.headers['x-api-key'];
  if (!apiKey) return res.status(401).json({ error: 'API key diperlukan.' });

  const member = db.prepare('SELECT * FROM members WHERE api_key = ? AND active = 1').get(apiKey);
  if (!member) return res.status(403).json({ error: 'API key tidak valid atau nonaktif.' });

  // Cek status approval
  if (member.status === 'pending') {
    return res.status(403).json({
      error: 'Akun belum di-approve oleh admin. Silakan tunggu.',
      status: 'pending'
    });
  }
  if (member.status === 'suspended') {
    return res.status(403).json({ error: 'Akun ditangguhkan. Hubungi admin.', status: 'suspended' });
  }

  const now = new Date();
  if (member.plan === 'weekly' || member.plan === 'monthly') {
    const expiresAt = new Date(member.expires_at);
    if (now > expiresAt) {
      return res.status(403).json({
        error: `Langganan ${member.plan} sudah habis. Silakan perpanjang.`,
        expired_at: member.expires_at
      });
    }
    req.sisaHari = Math.ceil((expiresAt - now) / (1000 * 60 * 60 * 24));
    req.deducted = false;
  } else if (member.plan === 'topup') {
    if (member.saldo < COST_PER_GENERATE) {
      return res.status(403).json({
        error: `Saldo tidak cukup. Saldo: Rp ${member.saldo.toLocaleString('id-ID')}, biaya: Rp ${COST_PER_GENERATE}`,
        saldo: member.saldo
      });
    }
    const newSaldo = member.saldo - COST_PER_GENERATE;
    db.prepare('UPDATE members SET saldo = ? WHERE id = ?').run(newSaldo, member.id);
    db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
      .run(member.id, 'generate', COST_PER_GENERATE, newSaldo);
    req.sisaSaldo = newSaldo;
    req.deducted = true;
  }

  req.member = member;
  next();
}

app.all('/v1/*', validateSubscription, async (req, res) => {
  const member = req.member;
  const targetUrl = `${NEXABOT_BASE_URL}${req.originalUrl}`;

  console.log(
    `[${new Date().toISOString()}] Member #${member.id} (${member.name}) ` +
    `→ ${req.method} ${req.originalUrl}` +
    (member.plan === 'topup' ? ` (saldo: Rp ${(req.sisaSaldo || member.saldo).toLocaleString('id-ID')})` : ` (sisa ${req.sisaHari} hari)`)
  );

  try {
    const headers = {
      'Content-Type': req.headers['content-type'] || 'application/json',
      'Authorization': `Bearer ${MASTER_KEY}`
    };
    const fetchOptions = { method: req.method, headers };
    if (['POST', 'PUT', 'PATCH'].includes(req.method)) fetchOptions.body = JSON.stringify(req.body);

    const nexabotRes = await fetch(targetUrl, fetchOptions);

    // Refund kalau Nexabot gagal & sudah potong saldo
    if (!nexabotRes.ok && req.deducted) {
      db.prepare('UPDATE members SET saldo = saldo + ? WHERE id = ?').run(COST_PER_GENERATE, member.id);
      db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
        .run(member.id, 'refund', -COST_PER_GENERATE, member.saldo);
      console.log(`[REFUND] Member #${member.id}: Rp ${COST_PER_GENERATE.toLocaleString('id-ID')}`);
    }

    const data = await nexabotRes.json();
    if (member.plan === 'topup' && nexabotRes.ok) {
      data._billing = { cost: COST_PER_GENERATE, saldo_tertinggal: req.sisaSaldo };
    }
    res.status(nexabotRes.status).json(data);
  } catch (err) {
    if (req.deducted) {
      db.prepare('UPDATE members SET saldo = saldo + ? WHERE id = ?').run(COST_PER_GENERATE, member.id);
      db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
        .run(member.id, 'refund', -COST_PER_GENERATE, member.saldo);
    }
    console.error(`[ERROR] Member #${member.id}: ${err.message}`);
    res.status(502).json({ error: 'Gagal menghubungi Nexabot.', detail: err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN API
// ══════════════════════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY || 'change-me-admin-key';
function requireAdmin(req, res, next) {
  if (req.headers['x-admin-key'] !== ADMIN_KEY) return res.status(403).json({ error: 'Admin key tidak valid.' });
  next();
}

// ── List members (API key tidak ditampilkan) ────────────────────────────────
app.get('/admin/members', requireAdmin, (req, res) => {
  const members = db.prepare(
    'SELECT id, name, plan, status, saldo, started_at, expires_at, active FROM members ORDER BY id'
  ).all();

  const now = new Date();
  const result = members.map(m => ({
    ...m,
    expired: m.plan !== 'topup' ? now > new Date(m.expires_at) : null,
    sisa_hari: m.plan !== 'topup'
      ? Math.max(0, Math.ceil((new Date(m.expires_at) - now) / (1000 * 60 * 60 * 24)))
      : null,
    sisa_generate: m.plan === 'topup' ? Math.floor(m.saldo / COST_PER_GENERATE) : null
  }));

  res.json({ members: result, total: result.length });
});

// ── Tambah member → status 'pending' ────────────────────────────────────────
app.post('/admin/members', requireAdmin, (req, res) => {
  const { name, plan, saldo } = req.body;
  if (!name || !plan) return res.status(400).json({ error: 'name dan plan wajib diisi.' });
  if (!['weekly', 'monthly', 'topup'].includes(plan)) return res.status(400).json({ error: 'Plan tidak valid.' });

  const apiKey = `arkx-${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date();
  let expiresAt;
  let initialSaldo = 0;

  if (plan === 'weekly') expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  else { expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString(); initialSaldo = parseInt(saldo) || 0; }

  const result = db.prepare(
    `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, 'pending', ?, datetime('now'), ?)`
  ).run(name, apiKey, plan, initialSaldo, expiresAt);

  res.json({
    message: 'Member ditambahkan (status: pending, menunggu approve).',
    id: result.lastInsertRowid, name, plan, saldo: initialSaldo,
    api_key: apiKey, // ← hanya ditampilkan sekali saat pembuatan
    expires_at: expiresAt
  });
});

// ── Approve member ──────────────────────────────────────────────────────────
app.post('/admin/members/:id/approve', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  if (member.status === 'approved') return res.json({ message: `${member.name} sudah approved.` });

  db.prepare("UPDATE members SET status = 'approved', active = 1 WHERE id = ?").run(id);
  res.json({ message: `✅ ${member.name} di-approve! Sekarang bisa generate.`, api_key: member.api_key });
});

// ── Suspend / unsuspend ─────────────────────────────────────────────────────
app.post('/admin/members/:id/suspend', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  db.prepare("UPDATE members SET status = 'suspended', active = 0 WHERE id = ?").run(id);
  res.json({ message: `${member.name} ditangguhkan.` });
});

app.post('/admin/members/:id/unsuspend', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  db.prepare("UPDATE members SET status = 'approved', active = 1 WHERE id = ?").run(id);
  res.json({ message: `${member.name} diaktifkan kembali.` });
});

// ── Topup saldo ────────────────────────────────────────────────────────────
app.post('/admin/members/:id/topup', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { amount } = req.body;
  if (!amount || amount <= 0) return res.status(400).json({ error: 'amount wajib angka positif.' });

  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });
  if (member.plan !== 'topup') return res.status(400).json({ error: `Plan "${member.plan}" bukan topup.` });

  const newSaldo = member.saldo + parseInt(amount);
  db.prepare('UPDATE members SET saldo = ?, active = 1, status = ? WHERE id = ?')
    .run(newSaldo, member.status === 'pending' ? 'approved' : member.status, id);
  db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
    .run(id, 'topup', parseInt(amount), newSaldo);

  res.json({
    message: `Saldo ${member.name} +Rp ${parseInt(amount).toLocaleString('id-ID')}.`,
    saldo_baru: newSaldo
  });
});

// ── Usage log ───────────────────────────────────────────────────────────────
app.get('/admin/members/:id/usage', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT id, name, plan FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  const logs = db.prepare('SELECT * FROM usage_log WHERE member_id = ? ORDER BY created_at DESC LIMIT ?')
    .all(id, parseInt(req.query.limit) || 50);
  res.json({ member, logs });
});

// ── Renew ───────────────────────────────────────────────────────────────────
app.post('/admin/members/:id/renew', requireAdmin, (req, res) => {
  const { id } = req.params;
  const { plan } = req.body;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  const newPlan = plan || member.plan;
  if (!['weekly', 'monthly', 'topup'].includes(newPlan)) return res.status(400).json({ error: 'Plan tidak valid.' });

  const now = new Date();
  let newExpiresAt;
  if (newPlan === 'topup') {
    newExpiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
  } else {
    const dur = newPlan === 'weekly' ? 7 : 30;
    const base = new Date(member.expires_at) > now ? new Date(member.expires_at) : now;
    newExpiresAt = new Date(base.getTime() + dur * 24 * 60 * 60 * 1000).toISOString();
  }

  db.prepare('UPDATE members SET plan = ?, expires_at = ?, active = 1, status = ? WHERE id = ?')
    .run(newPlan, newExpiresAt, member.status === 'suspended' ? 'approved' : member.status, id);

  res.json({ message: `${member.name} diperpanjang → ${newPlan}.`, plan: newPlan, expires_at: newExpiresAt });
});

// ── Deactivate ──────────────────────────────────────────────────────────────
app.post('/admin/members/:id/deactivate', requireAdmin, (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });
  db.prepare("UPDATE members SET active = 0, status = 'suspended' WHERE id = ?").run(req.params.id);
  res.json({ message: `${member.name} dinonaktifkan.` });
});

// ── Delete member ────────────────────────────────────────────────────────
app.delete('/admin/members/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  db.prepare('DELETE FROM usage_log WHERE member_id = ?').run(id);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);

  res.json({ message: `🗑️ ${member.name} (ID: ${id}) berhasil dihapus.` });
});

// ── Delete all seed members (bulk) ────────────────────────────────────────
app.delete('/admin/members/seed/all', requireAdmin, (req, res) => {
  const seedNames = [
    'Budi Santoso', 'Rina Wati', 'Ahmad Fauzi', 'Siti Nurhaliza', 'Andi Pratama',
    'Rizky Ramadhani', 'Putri Maharani', 'Fajar Nugroho', 'Dewi Lestari', 'Maya Anggraini'
  ];
  const placeholders = seedNames.map(() => '?').join(',');

  const memberIds = db.prepare(`SELECT id FROM members WHERE name IN (${placeholders})`).all(...seedNames);
  if (memberIds.length === 0) return res.json({ message: 'Tidak ada seed member yang ditemukan.' });

  const ids = memberIds.map(m => m.id);
  const idPlaceholders = ids.map(() => '?').join(',');
  db.prepare(`DELETE FROM usage_log WHERE member_id IN (${idPlaceholders})`).run(...ids);
  db.prepare(`DELETE FROM members WHERE id IN (${idPlaceholders})`).run(...ids);

  res.json({ message: `🗑️ ${ids.length} seed member berhasil dihapus.`, deleted: ids });
});

// ── Regenerate API key ─────────────────────────────────────────────────────
app.post('/admin/members/:id/regenerate-key', requireAdmin, (req, res) => {
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(req.params.id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });
  const newKey = `arkx-${crypto.randomBytes(24).toString('hex')}`;
  db.prepare('UPDATE members SET api_key = ? WHERE id = ?').run(newKey, req.params.id);
  res.json({ message: `API key ${member.name} di-regenerate.`, api_key: newKey });
});

// ── Stats ───────────────────────────────────────────────────────────────────
app.get('/admin/stats', requireAdmin, (req, res) => {
  const total = db.prepare('SELECT COUNT(*) as n FROM members').get().n;
  const byPlan = db.prepare('SELECT plan, COUNT(*) as count FROM members WHERE active = 1 GROUP BY plan').all();
  const byStatus = db.prepare('SELECT status, COUNT(*) as count FROM members GROUP BY status').all();
  const totalTopup = db.prepare("SELECT SUM(saldo) as total FROM members WHERE plan = 'topup' AND active = 1").get();
  const todayUsage = db.prepare(
    `SELECT COUNT(*) as count, SUM(cost) as total FROM usage_log WHERE action = 'generate' AND date(created_at) = date('now')`
  ).get();

  res.json({
    total_members: total, by_plan: byPlan, by_status: byStatus,
    total_saldo: totalTopup?.total || 0,
    usage_hari_ini: { generate: todayUsage?.count || 0, total_cost: todayUsage?.total || 0 }
  });
});

// ── Pending list (member yang belum approve) ────────────────────────────────
app.get('/admin/pending', requireAdmin, (req, res) => {
  const pending = db.prepare("SELECT id, name, plan, saldo, created_at FROM members WHERE status = 'pending' ORDER BY id").all();
  res.json({ pending, count: pending.length });
});

// ══════════════════════════════════════════════════════════════════════════════
// SYNC: Pull users from Arkx Motion Studio
// ══════════════════════════════════════════════════════════════════════════════
const ARKX_STUDIO_URL = process.env.ARKX_STUDIO_URL || 'https://arkxmotion-studio.win';
const NEXABOT_SYNC_SECRET = process.env.NEXABOT_SYNC_SECRET || 'change-me-sync-secret';

// Mapping package_slug ke plan nexabot proxy
function mapPackageToPlan(pkg) {
  if (!pkg.package_kind) return null;
  if (pkg.package_kind === 'unlimited') {
    if (pkg.package_slug?.includes('weekly')) return 'weekly';
    if (pkg.package_slug?.includes('monthly')) return 'monthly';
    return 'monthly'; // default
  }
  if (pkg.package_kind === 'balance') return 'topup';
  return null;
}

// Sync users dari Arkx Studio → Nexabot Proxy
app.get('/admin/sync', requireAdmin, async (req, res) => {
  try {
    const since = req.query.since || '';
    const url = `${ARKX_STUDIO_URL}/api/nexabot-sync-users?secret=${encodeURIComponent(NEXABOT_SYNC_SECRET)}` + (since ? `&since=${encodeURIComponent(since)}` : '');
    
    const response = await fetch(url);
    if (!response.ok) throw new Error(`Arkx Studio API error: ${response.status}`);
    
    const data = await response.json();
    const users = data.users || [];
    
    let created = 0, updated = 0, skipped = 0;
    const results = [];
    
    for (const user of users) {
      const plan = mapPackageToPlan(user);
      if (!plan) { skipped++; continue; }
      
      // Cek apakah user sudah ada di members (berdasarkan name + email)
      const existingMember = db.prepare(
        'SELECT * FROM members WHERE name = ? OR (name = ? AND api_key LIKE ?)'
      ).get(user.name, `${user.name} (${user.email})`, `arkx-arkxuser-${user.id}%`);
      
      if (existingMember) {
        // Update status jika berubah
        if (user.status === 'approved' && existingMember.status !== 'approved') {
          db.prepare("UPDATE members SET status = 'approved', active = 1 WHERE id = ?").run(existingMember.id);
          updated++;
          results.push({ id: existingMember.id, name: user.name, action: 'updated' });
        }
      } else {
        // Buat member baru
        const apiKey = `arkx-arkxuser-${user.id}-${crypto.randomBytes(12).toString('hex')}`;
        let expiresAt;
        let initialSaldo = 0;
        
        if (plan === 'weekly') {
          expiresAt = user.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
        } else if (plan === 'monthly') {
          expiresAt = user.expires_at || new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
        } else {
          expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
          initialSaldo = 5000; // Default saldo untuk topup
        }
        
        const memberName = `${user.name}`;
        const status = user.status === 'approved' ? 'approved' : 'pending';
        
        db.prepare(
          `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
        ).run(memberName, apiKey, plan, status, initialSaldo, expiresAt);
        
        created++;
        results.push({ id: db.prepare('SELECT last_insert_rowid() as id').get().id, name: memberName, api_key: apiKey, action: 'created' });
        
        // Broadcast real-time event
        broadcastSSE({ type: 'sync_new_member', name: memberName, plan, time: new Date().toISOString() });
      }
    }
    
    res.json({ message: `Sync selesai: ${created} baru, ${updated} diupdate, ${skipped} dilewati`, created, updated, skipped, results });
  } catch (err) {
    console.error('[SYNC ERROR]', err.message);
    res.status(500).json({ error: 'Gagal sync: ' + err.message });
  }
});

// Auto-sync endpoint (dipanggil dari webhook Arkx Studio)
app.post('/webhook/arkx-sync', async (req, res) => {
  const secret = req.headers['x-webhook-secret'];
  if (secret !== NEXABOT_SYNC_SECRET) return res.status(403).json({ error: 'Invalid secret' });
  
  const { user_id, name, email, package_kind, package_slug, status } = req.body;
  if (!user_id || !name) return res.status(400).json({ error: 'Missing required fields' });
  
  const plan = mapPackageToPlan({ package_kind, package_slug });
  if (!plan) return res.status(400).json({ error: 'Invalid package' });
  
  // Cek duplikat
  const existing = db.prepare('SELECT id FROM members WHERE api_key LIKE ?').get(`arkx-arkxuser-${user_id}%`);
  if (existing) return res.json({ message: 'Member sudah ada', id: existing.id });
  
  // Buat member baru
  const apiKey = `arkx-arkxuser-${user_id}-${crypto.randomBytes(12).toString('hex')}`;
  let expiresAt;
  let initialSaldo = 0;
  
  if (plan === 'weekly') expiresAt = new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (plan === 'monthly') expiresAt = new Date(Date.now() + 30 * 24 * 60 * 60 * 1000).toISOString();
  else { expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString(); initialSaldo = 5000; }
  
  const memberStatus = status === 'approved' ? 'approved' : 'pending';
  const result = db.prepare(
    `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, ?, ?, datetime('now'), ?)`
  ).run(name, apiKey, plan, memberStatus, initialSaldo, expiresAt);
  
  console.log(`[WEBHOOK] New member from Arkx: ${name} (${plan}) — ID: ${result.lastInsertRowid}`);
  broadcastSSE({ type: 'webhook_new_member', name, plan, time: new Date().toISOString() });
  
  res.json({ message: `Member ${name} ditambahkan`, id: result.lastInsertRowid, api_key: apiKey });
});

// ── SSE: Real-time updates for admin ────────────────────────────────────────
const sseClients = new Set();

app.get('/admin/events', (req, res) => {
  const key = req.headers['x-admin-key'] || req.query.key;
  if (key !== ADMIN_KEY) return res.status(403).json({ error: 'Admin key tidak valid.' });

  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache',
    'Connection': 'keep-alive'
  });
  res.write('data: {"type":"connected"}\n\n');

  sseClients.add(res);
  req.on('close', () => sseClients.delete(res));
});

function broadcastSSE(data) {
  const msg = `data: ${JSON.stringify(data)}\n\n`;
  sseClients.forEach(client => client.write(msg));
}

// ── Run ─────────────────────────────────────────────────────────────────────
app.listen(PORT, () => {
  console.log(`✅ Nexabot Proxy v3 — http://localhost:${PORT}`);
  console.log(`   Dashboard: http://localhost:${PORT}/admin`);
  console.log(`   Register: http://localhost:${PORT}/register`);
  console.log(`   Biaya/generate: Rp ${COST_PER_GENERATE.toLocaleString('id-ID')}`);
});
