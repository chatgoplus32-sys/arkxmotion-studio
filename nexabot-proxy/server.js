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
const RUNNINGHUB_WEBAPP_ID = process.env.RUNNINGHUB_WEBAPP_ID || '2099800742046818306';
// 🎬 MiniMax H3 I2V — UGC Storyboard (Gambar → Video Multi-Scene + Audio)
const UGC_WEBAPP_ID = process.env.RUNNINGHUB_UGC_WEBAPP_ID || '2096092981395841025';
const UGC_MAX_SCENES = parseInt(process.env.UGC_MAX_SCENES) || 10;
const UGC_MAX_DURATION = parseInt(process.env.UGC_MAX_DURATION) || 15;
const OPENAI_API_KEY = process.env.OPENAI_API_KEY || MASTER_KEY;
const OPENAI_BASE_URL = process.env.OPENAI_BASE_URL || NEXABOT_BASE_URL;
const OPENAI_DEFAULT_MODEL = process.env.OPENAI_DEFAULT_MODEL || 'gpt-4o';

// ── Default Provider (Locked) ──────────────────────────────────────────────
const MOTION_CONTROL_PROVIDER = 'runninghub'; // 🔒 TIDAK BISA DIGANTI — provider default untuk motion control
const PROVIDER_INFO = {
  provider: MOTION_CONTROL_PROVIDER,
  name: 'RunningHub AI',
  features: ['virtual-tryon', 'garment-extraction', 'motion-control', 'ugc-storyboard-video'],
  locked: true,
  models: ['FireRed 2-in-1', 'Qwen-Image-Lightning', 'Qwen 2.5 VL 7B', 'MiniMax H3 I2V']
};

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
// PROVIDER INFO: Default settingan untuk member
// ══════════════════════════════════════════════════════════════════════════════
app.get('/api/provider', (req, res) => {
  res.json({
    code: 0,
    message: 'Motion control provider dikunci ke RunningHub',
    data: PROVIDER_INFO
  });
});

// ── RunningHub Key Pool (Auto-Rotate) ──────────────────────────────────────
const RH_KEY_POOL = (() => {
  const raw = process.env.RUNNINGHUB_API_KEYS || process.env.RUNNINGHUB_API_KEY || '';
  return raw.split(',').map(k => k.trim()).filter(Boolean);
})();
let rhCurrentKeyIdx = 0;
const rhFailedKeys = new Map(); // key -> { failCount, cooldownUntil }

function rhGetActiveKey() {
  if (RH_KEY_POOL.length === 0) return null;
  const now = Date.now();
  for (let i = 0; i < RH_KEY_POOL.length; i++) {
    const idx = (rhCurrentKeyIdx + i) % RH_KEY_POOL.length;
    const key = RH_KEY_POOL[idx];
    const fail = rhFailedKeys.get(key);
    if (!fail || now > fail.cooldownUntil) {
      rhCurrentKeyIdx = (idx + 1) % RH_KEY_POOL.length;
      return key;
    }
  }
  let earliest = Infinity, bestIdx = 0;
  RH_KEY_POOL.forEach((k, i) => {
    const f = rhFailedKeys.get(k);
    const until = f ? f.cooldownUntil : 0;
    if (until < earliest) { earliest = until; bestIdx = i; }
  });
  rhCurrentKeyIdx = (bestIdx + 1) % RH_KEY_POOL.length;
  return RH_KEY_POOL[bestIdx];
}

function rhMarkFailed(key) {
  const fail = rhFailedKeys.get(key) || { failCount: 0, cooldownUntil: 0 };
  fail.failCount++;
  const cooldownMs = Math.min(30000 * fail.failCount, 600000);
  fail.cooldownUntil = Date.now() + cooldownMs;
  rhFailedKeys.set(key, fail);
  console.log(`[RH KEY] ❌ Key ${rhKeyLabel(key)} gagal (cooldown ${Math.round(cooldownMs/1000)}s)`);
}

function rhMarkSuccess(key) {
  rhFailedKeys.delete(key);
}

function rhKeyLabel(key) {
  const idx = RH_KEY_POOL.indexOf(key) + 1;
  return `Key ${idx}/${RH_KEY_POOL.length} (${key.slice(0,8)}...)`;
}

function rhKeyStatus() {
  const now = Date.now();
  return RH_KEY_POOL.map((k, i) => {
    const f = rhFailedKeys.get(k);
    return {
      index: i + 1,
      key_preview: k.slice(0, 8) + '...',
      active: !f || now > f.cooldownUntil,
      fail_count: f?.failCount || 0,
      cooldown_until: f && now <= f.cooldownUntil ? new Date(f.cooldownUntil).toISOString() : null
    };
  });
}

// ══════════════════════════════════════════════════════════════════════════════
// RUNNINGHUB: Virtual Try-On & Ekstraksi Pakaian
// ══════════════════════════════════════════════════════════════════════════════
const multer = require('multer');
const FormData = require('form-data');
const fs = require('fs');
const os = require('os');

const uploadTemp = multer({
  dest: path.join(os.tmpdir(), 'rh-upload-'),
  limits: { fileSize: 50 * 1024 * 1024 } // 50MB max
});

const RH_API = 'www.runninghub.ai';

// Helper: RunningHub HTTP request with auto-rotate
async function rhRequest(method, urlPath, body = null, isForm = false) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: RH_API,
      path: urlPath,
      headers: {}
    };
    if (!isForm && body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = require('https').request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error('Invalid JSON from RunningHub')); }
      });
    });
    req.on('error', reject);
    if (isForm && body) {
      // pipe() otomatis memanggil req.end() setelah stream selesai
      body.pipe(req);
    } else if (body) {
      req.write(JSON.stringify(body));
      req.end();
    } else {
      req.end();
    }
  });
}

// Auto-rotate: coba semua key sampai ada yang berhasil
async function rhRequestWithRotation(method, urlPathBuilder, body = null, isForm = false) {
  const triedKeys = [];
  for (let attempt = 0; attempt < RH_KEY_POOL.length; attempt++) {
    const key = rhGetActiveKey();
    if (!key) throw new Error('Tidak ada RunningHub API key yang tersedia');
    triedKeys.push(key);

    try {
      const urlPath = typeof urlPathBuilder === 'function' ? urlPathBuilder(key) : urlPathBuilder;
      const result = await rhRequest(method, urlPath, body, isForm);

      // Cek error saldo/kuota → rotate ke key berikutnya
      const errMsg = result?.msg || result?.message || '';
      const errCode = result?.code;
      const isQuotaError = errMsg.includes('kuota') || errMsg.includes('saldo') || errMsg.includes('top up') ||
                           errMsg.includes('insufficient') || errCode === 401 || errCode === 402;

      if (isQuotaError && RH_KEY_POOL.length > 1) {
        rhMarkFailed(key);
        console.log(`[RH KEY] 🔄 Key ${rhKeyLabel(key)} kuota habis, rotasi ke berikutnya...`);
        continue;
      }

      rhMarkSuccess(key);
      return result;
    } catch (err) {
      rhMarkFailed(key);
      console.log(`[RH KEY] 🔄 Key ${rhKeyLabel(key)} error: ${err.message}`);
      if (attempt === RH_KEY_POOL.length - 1) throw err;
    }
  }
  throw new Error('Semua RunningHub API key gagal');
}

// GET /api/runninghub/keys — Status semua key
app.get('/api/runninghub/keys', requireAdmin, (req, res) => {
  res.json({
    total: RH_KEY_POOL.length,
    keys: rhKeyStatus()
  });
});

// POST /api/runninghub/nodes — Get workflow node info
app.get('/api/runninghub/nodes', requireAdmin, async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi di .env' });
  try {
    const data = await rhRequestWithRotation('GET', (key) =>
      `/api/webapp/apiCallDemo?apiKey=${encodeURIComponent(key)}&webappId=${RUNNINGHUB_WEBAPP_ID}`
    );
    res.json(data);
  } catch (err) {
    console.error('[RUNNINGHUB NODES]', err.message);
    res.status(502).json({ error: 'Gagal mengambil info node: ' + err.message });
  }
});

// POST /api/runninghub/upload — Upload file ke RunningHub
app.post('/api/runninghub/upload', requireAdmin, uploadTemp.single('file'), async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  if (!req.file) return res.status(400).json({ error: 'File tidak ditemukan' });
  try {
    const key = rhGetActiveKey();
    if (!key) throw new Error('Tidak ada API key aktif');
    const form = new FormData();
    form.append('apiKey', key);
    form.append('fileType', req.body.fileType || 'input');
    form.append('file', fs.createReadStream(req.file.path), req.file.originalname);

    const data = await rhRequest('POST', '/task/openapi/upload', form, true);
    rhMarkSuccess(key);

    // Hapus file temporary
    fs.unlink(req.file.path, () => {});
    res.json(data);
  } catch (err) {
    console.error('[RUNNINGHUB UPLOAD]', err.message);
    if (req.file) fs.unlink(req.file.path, () => {});
    res.status(502).json({ error: 'Upload gagal: ' + err.message });
  }
});

// POST /api/runninghub/run — Submit workflow task (auto-rotate)
app.post('/api/runninghub/run', requireAdmin, async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  const { nodeInfoList } = req.body;
  if (!nodeInfoList || !Array.isArray(nodeInfoList)) {
    return res.status(400).json({ error: 'nodeInfoList wajib berupa array' });
  }
  try {
    const data = await rhRequestWithRotation('POST', (key) => '/task/openapi/ai-app/run', {
      webappId: RUNNINGHUB_WEBAPP_ID,
      apiKey: key,
      nodeInfoList
    });
    res.json(data);
  } catch (err) {
    console.error('[RUNNINGHUB RUN]', err.message);
    res.status(502).json({ error: 'Submit task gagal: ' + err.message });
  }
});

// POST /api/runninghub/query — Query task status & results
app.post('/api/runninghub/query', requireAdmin, async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId wajib diisi' });
  try {
    const data = await rhRequestWithRotation('POST', (key) => '/task/openapi/outputs', {
      apiKey: key,
      taskId
    });
    res.json(data);
  } catch (err) {
    console.error('[RUNNINGHUB QUERY]', err.message);
    res.status(502).json({ error: 'Query gagal: ' + err.message });
  }
});

// ══════════════════════════════════════════════════════════════════════════════
// UGC STORYBOARD: MiniMax H3 I2V — Gambar ke Video Multi-Scene (+ Audio)
// Workflow: https://www.runninghub.ai/id/ai-detail/2096092981395841025
// ══════════════════════════════════════════════════════════════════════════════

// ── RunningHub OpenAPI v2 helpers (Bearer header) ──────────────────────────
// Dipakai fitur UGC Storyboard — API v2: auth via Authorization header
function rhV2Request(method, urlPath, apiKey, body = null, form = null) {
  return new Promise((resolve, reject) => {
    const opts = {
      method,
      hostname: RH_API,
      path: urlPath,
      headers: { 'Authorization': `Bearer ${apiKey}` }
    };
    if (form) {
      Object.assign(opts.headers, form.getHeaders());
    } else if (body) {
      opts.headers['Content-Type'] = 'application/json';
    }
    const req = require('https').request(opts, (res) => {
      let data = '';
      res.on('data', chunk => data += chunk);
      res.on('end', () => {
        try { resolve(JSON.parse(data)); }
        catch (e) { reject(new Error(`Respon tidak valid dari RunningHub (HTTP ${res.statusCode})`)); }
      });
    });
    req.on('error', reject);
    if (form) {
      // pipe() otomatis memanggil req.end() setelah stream selesai
      form.pipe(req);
    } else if (body) {
      req.write(JSON.stringify(body));
      req.end();
    } else {
      req.end();
    }
  });
}

// Auto-rotate key untuk API v2
async function rhV2WithRotation(urlPathBuilder, body = null, formBuilder = null) {
  let lastErr = null;
  for (let attempt = 0; attempt < RH_KEY_POOL.length; attempt++) {
    const key = rhGetActiveKey();
    if (!key) throw new Error('Tidak ada RunningHub API key yang tersedia');
    try {
      const urlPath = typeof urlPathBuilder === 'function' ? urlPathBuilder() : urlPathBuilder;
      const form = formBuilder ? formBuilder() : null;
      const result = await rhV2Request((body || form) ? 'POST' : 'GET', urlPath, key, body, form);
      const errMsg = String(result?.errorMessage || result?.message || result?.msg || '');
      if (/insufficient|balance|kuota|saldo|top.?up|quota/i.test(errMsg) && RH_KEY_POOL.length > 1) {
        rhMarkFailed(key);
        console.log(`[RH V2] 🔄 Key ${rhKeyLabel(key)} kuota habis, rotasi ke berikutnya...`);
        continue;
      }
      rhMarkSuccess(key);
      return result;
    } catch (err) {
      lastErr = err;
      rhMarkFailed(key);
      console.log(`[RH V2] 🔄 Key ${rhKeyLabel(key)} error: ${err.message}`);
    }
  }
  if (lastErr) throw lastErr;
  throw new Error('Semua RunningHub API key gagal');
}

// Template node workflow MiniMax H3 I2V (dari halaman API workflow)
const UGC_FEATURES = [
  'Multi-Shot Storyboard', 'Multi-Angle Camera', 'Konsistensi Karakter',
  'Dialog Bahasa Indonesia', 'Natural Lip-Sync', 'Image Reference',
  'UGC Product Showcase', 'Video + Audio'
];
const UGC_ASPECT_RATIOS = [
  '1:1 (Square)', '2:3 (Portrait Photo)', '3:2 (Photo)', '3:4 (Portrait Standard)',
  '4:3 (Standard)', '9:16 (Portrait Widescreen)', '16:9 (Widescreen)', '21:9 (Ultrawide)'
];
const UGC_NODE_TEMPLATE = [
  { nodeId: '114', fieldName: 'image', fieldType: 'IMAGE', label: 'Karakter Utama (referensi wajah & gaya)', required: true },
  { nodeId: '162', fieldName: 'image', fieldType: 'IMAGE', label: 'Karakter Utama 2 (auto-copy dari node 114)', required: false },
  { nodeId: '170', fieldName: 'image', fieldType: 'IMAGE', label: 'Gambar Scene/Produk 1', required: true },
  { nodeId: '167', fieldName: 'image', fieldType: 'IMAGE', label: 'Gambar Scene/Produk 2', required: false },
  { nodeId: '165', fieldName: 'image', fieldType: 'IMAGE', label: 'Gambar Scene 3', required: false },
  { nodeId: '166', fieldName: 'image', fieldType: 'IMAGE', label: 'Gambar Scene 4', required: false },
  { nodeId: '135', fieldName: 'value', fieldType: 'INT', label: 'Durasi video (detik)', defaultValue: String(UGC_MAX_DURATION) },
  { nodeId: '115', fieldName: 'aspect_ratio', fieldType: 'COMBO', label: 'Aspect ratio', defaultValue: '9:16 (Portrait Widescreen)' },
  { nodeId: '136', fieldName: 'text', fieldType: 'STRING', label: 'Prompt storyboard', defaultValue: 'follow prompt storyboards' }
];

// GET /api/ugc/info — Info fitur + template node workflow UGC
app.get('/api/ugc/info', requireAdmin, (req, res) => {
  res.json({
    name: 'UGC Storyboard — AI Video Creator',
    model: 'MiniMax H3 I2V',
    webappId: UGC_WEBAPP_ID,
    api_version: 'v2',
    features: UGC_FEATURES,
    aspect_ratios: UGC_ASPECT_RATIOS,
    limits: { max_scenes: UGC_MAX_SCENES, max_duration_seconds: UGC_MAX_DURATION },
    node_template: UGC_NODE_TEMPLATE,
    result_link_valid_hours: 24,
    endpoints: {
      upload: 'POST /api/ugc/upload (multipart, field: files[])',
      run: 'POST /api/ugc/run { nodeInfoList }',
      status: 'POST /api/ugc/status { taskId }'
    }
  });
});

// POST /api/ugc/upload — Upload multi-file via OpenAPI v2 (media/upload/binary)
// Form-data: files[] (bisa banyak). Response: { uploaded: [{ original, fileName }] }
app.post('/api/ugc/upload', requireAdmin, uploadTemp.array('files', UGC_MAX_SCENES + 2), async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  const files = req.files || [];
  if (files.length === 0) return res.status(400).json({ error: 'Tidak ada file yang diupload (field name: files)' });

  const uploaded = [];
  const errors = [];
  for (const f of files) {
    try {
      // formBuilder dipanggil ulang setiap percobaan rotasi key (stream hanya bisa dipakai sekali)
      const formBuilder = () => {
        const fd = new FormData();
        fd.append('file', fs.createReadStream(f.path), f.originalname);
        return fd;
      };
      const data = await rhV2WithRotation('/openapi/v2/media/upload/binary', null, formBuilder);
      const fileName = data?.data?.fileName;
      if (fileName) uploaded.push({ original: f.originalname, fileName, size: data.data.size });
      else errors.push({ original: f.originalname, error: data?.message || data?.msg || 'Upload gagal (tidak ada fileName)' });
    } catch (e) {
      errors.push({ original: f.originalname, error: e.message });
    } finally {
      fs.unlink(f.path, () => {});
    }
  }
  if (uploaded.length === 0) return res.status(502).json({ error: 'Semua upload gagal', errors });
  res.json({ code: 0, uploaded, errors, total: uploaded.length });
});

// POST /api/ugc/run — Submit UGC storyboard task (OpenAPI v2)
// Body: { nodeInfoList, instanceType?, usePersonalQueue? }
app.post('/api/ugc/run', requireAdmin, async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  const { nodeInfoList, instanceType, usePersonalQueue } = req.body;
  if (!nodeInfoList || !Array.isArray(nodeInfoList)) {
    return res.status(400).json({ error: 'nodeInfoList wajib berupa array (ambil template dari /api/ugc/info lalu isi fieldValue)' });
  }
  // Clamp durasi ke limit (node 135)
  const nodeList = nodeInfoList.map(n => {
    if (String(n.nodeId) === '135') {
      const v = parseFloat(n.fieldValue);
      if (!isNaN(v) && v > UGC_MAX_DURATION) {
        console.log(`[UGC RUN] Durasi ${v}s > limit ${UGC_MAX_DURATION}s — di-clamp`);
        return { ...n, fieldValue: String(UGC_MAX_DURATION) };
      }
    }
    return n;
  });
  try {
    const data = await rhV2WithRotation(
      () => `/openapi/v2/run/ai-app/${UGC_WEBAPP_ID}`,
      {
        nodeInfoList: nodeList,
        instanceType: instanceType || 'default',
        usePersonalQueue: String(usePersonalQueue ?? false)
      }
    );
    if (data.taskId) {
      console.log(`[UGC RUN] ✅ Task ${data.taskId} (${data.status}) — ${nodeList.length} nodes`);
    } else {
      console.error('[UGC RUN] ❌', data.errorCode || '', data.errorMessage || JSON.stringify(data).slice(0, 200));
    }
    res.json(data);
  } catch (err) {
    console.error('[UGC RUN]', err.message);
    res.status(502).json({ error: 'Submit UGC task gagal: ' + err.message });
  }
});

// POST /api/ugc/status — Poll status & hasil video UGC (OpenAPI v2 /query)
// Response: { taskId, status: QUEUED|RUNNING|SUCCESS|FAILED, results: [{url, outputType}], errorMessage }
app.post('/api/ugc/status', requireAdmin, async (req, res) => {
  if (RH_KEY_POOL.length === 0) return res.status(500).json({ error: 'RUNNINGHUB_API_KEYS belum dikonfigurasi' });
  const { taskId } = req.body;
  if (!taskId) return res.status(400).json({ error: 'taskId wajib diisi' });
  try {
    const data = await rhV2WithRotation('/openapi/v2/query', { taskId });
    res.json(data);
  } catch (err) {
    console.error('[UGC STATUS]', err.message);
    res.status(502).json({ error: 'Query status gagal: ' + err.message });
  }
});

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
// OPENAI PROXY: Forward ke OpenAI API (atau compatible provider)
// Endpoint: POST /openai/v1/chat/completions
// ══════════════════════════════════════════════════════════════════════════════
if (OPENAI_API_KEY) {
  app.post('/openai/v1/chat/completions', validateSubscription, async (req, res) => {
    const member = req.member;
    const { model, messages, stream, temperature, max_tokens, top_p, frequency_penalty, presence_penalty, tools, tool_choice } = req.body;

    if (!messages || !Array.isArray(messages) || messages.length === 0) {
      return res.status(400).json({ error: 'messages wajib berupa array dan tidak boleh kosong.' });
    }

    const usedModel = model || OPENAI_DEFAULT_MODEL;

    console.log(
      `[${new Date().toISOString()}] [OPENAI] Member #${member.id} (${member.name}) ` +
      `→ ${usedModel} (${messages.length} msgs)` +
      (member.plan === 'topup' ? ` (saldo: Rp ${(req.sisaSaldo || member.saldo).toLocaleString('id-ID')})` : ` (sisa ${req.sisaHari} hari)`)
    );

    try {
      const body = {
        model: usedModel,
        messages,
        stream: !!stream,
      };
      if (temperature !== undefined) body.temperature = temperature;
      if (max_tokens !== undefined) body.max_tokens = max_tokens;
      if (top_p !== undefined) body.top_p = top_p;
      if (frequency_penalty !== undefined) body.frequency_penalty = frequency_penalty;
      if (presence_penalty !== undefined) body.presence_penalty = presence_penalty;
      if (tools !== undefined) body.tools = tools;
      if (tool_choice !== undefined) body.tool_choice = tool_choice;

      const openaiRes = await fetch(`${OPENAI_BASE_URL}/v1/chat/completions`, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          'Authorization': `Bearer ${OPENAI_API_KEY}`,
        },
        body: JSON.stringify(body),
      });

      // Refund kalau OpenAI gagal & sudah potong saldo
      if (!openaiRes.ok && req.deducted) {
        db.prepare('UPDATE members SET saldo = saldo + ? WHERE id = ?').run(COST_PER_GENERATE, member.id);
        db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
          .run(member.id, 'refund', -COST_PER_GENERATE, member.saldo);
        console.log(`[OPENAI REFUND] Member #${member.id}: Rp ${COST_PER_GENERATE.toLocaleString('id-ID')}`);
      }

      if (stream) {
        // Stream response langsung ke client
        res.writeHead(openaiRes.status, {
          'Content-Type': 'text/event-stream',
          'Cache-Control': 'no-cache',
          'Connection': 'keep-alive',
        });
        const reader = openaiRes.body.getReader();
        const pump = async () => {
          while (true) {
            const { done, value } = await reader.read();
            if (done) break;
            res.write(value);
          }
          res.end();
        };
        pump().catch(() => res.end());
      } else {
        const data = await openaiRes.json();
        if (member.plan === 'topup' && openaiRes.ok) {
          data._billing = { cost: COST_PER_GENERATE, saldo_tertinggal: req.sisaSaldo };
        }
        res.status(openaiRes.status).json(data);
      }
    } catch (err) {
      if (req.deducted) {
        db.prepare('UPDATE members SET saldo = saldo + ? WHERE id = ?').run(COST_PER_GENERATE, member.id);
        db.prepare('INSERT INTO usage_log (member_id, action, cost, saldo_after) VALUES (?, ?, ?, ?)')
          .run(member.id, 'refund', -COST_PER_GENERATE, member.saldo);
      }
      console.error(`[OPENAI ERROR] Member #${member.id}: ${err.message}`);
      res.status(502).json({ error: 'Gagal menghubungi OpenAI API.', detail: err.message });
    }
  });

  // GET /openai/v1/models — List available models
  app.get('/openai/v1/models', validateSubscription, async (req, res) => {
    try {
      const openaiRes = await fetch(`${OPENAI_BASE_URL}/v1/models`, {
        headers: { 'Authorization': `Bearer ${OPENAI_API_KEY}` },
      });
      const data = await openaiRes.json();
      res.status(openaiRes.status).json(data);
    } catch (err) {
      res.status(502).json({ error: 'Gagal mengambil daftar model.', detail: err.message });
    }
  });

  console.log(`   OpenAI Proxy: ✅ /openai/v1/* (model default: ${OPENAI_DEFAULT_MODEL})`);
} else {
  console.log(`   OpenAI Proxy: ⚠️ OPENAI_API_KEY belum dikonfigurasi`);
}

// ══════════════════════════════════════════════════════════════════════════════
// ADMIN API
// ══════════════════════════════════════════════════════════════════════════════
const ADMIN_KEY = process.env.ADMIN_KEY;
if (!ADMIN_KEY || ADMIN_KEY === 'change-me-admin-key') {
  console.error('❌ ADMIN_KEY wajib diisi di .env dengan nilai random (jangan pakai default)');
  process.exit(1);
}
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
  if (typeof name !== 'string' || name.trim().length < 1 || name.trim().length > 80) return res.status(400).json({ error: 'name wajib 1-80 karakter.' });
  if (!['weekly', 'monthly', 'topup'].includes(plan)) return res.status(400).json({ error: 'Plan tidak valid.' });

  const apiKey = `arkx-${crypto.randomBytes(24).toString('hex')}`;
  const now = new Date();
  let expiresAt;
  let initialSaldo = 0;

  if (plan === 'weekly') expiresAt = new Date(now.getTime() + 7 * 24 * 60 * 60 * 1000).toISOString();
  else if (plan === 'monthly') expiresAt = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000).toISOString();
  else {
    expiresAt = new Date(now.getTime() + 365 * 24 * 60 * 60 * 1000).toISOString();
    const parsed = Number.parseInt(saldo, 10);
    if (saldo !== undefined && (!Number.isInteger(parsed) || parsed < 0 || parsed > 1000000000)) return res.status(400).json({ error: 'saldo harus integer 0-1000000000.' });
    initialSaldo = saldo === undefined ? 0 : parsed;
  }

  const cleanName = name.trim();
  const result = db.prepare(
    `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, 'pending', ?, datetime('now'), ?)`
  ).run(cleanName, apiKey, plan, initialSaldo, expiresAt);

  res.json({
    message: 'Member ditambahkan (status: pending, menunggu approve).',
    id: result.lastInsertRowid, name: cleanName, plan, saldo: initialSaldo,
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

// ── Delete all seed members (bulk) — HARUS sebelum route :id! ─────────────
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

// ── Delete single member ──────────────────────────────────────────────────
app.delete('/admin/members/:id', requireAdmin, (req, res) => {
  const { id } = req.params;
  const member = db.prepare('SELECT * FROM members WHERE id = ?').get(id);
  if (!member) return res.status(404).json({ error: 'Member tidak ditemukan.' });

  db.prepare('DELETE FROM usage_log WHERE member_id = ?').run(id);
  db.prepare('DELETE FROM members WHERE id = ?').run(id);

  res.json({ message: `🗑️ ${member.name} (ID: ${id}) berhasil dihapus.` });
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
// SYNC: Pull users from Arkx Motion Studio (read SQLite directly)
// ══════════════════════════════════════════════════════════════════════════════
const ARKX_DB_PATH = process.env.ARKX_DB_PATH || '/opt/arkxmotion-studio/data/arkxmotion.db';
let arkxDb = null;

try {
  arkxDb = new Database(ARKX_DB_PATH, { readonly: true });
  console.log(`[SYNC] Arkx DB connected: ${ARKX_DB_PATH}`);
} catch (err) {
  console.error(`[SYNC] Cannot open Arkx DB: ${err.message}`);
}

// Mapping package_slug ke plan nexabot proxy
function mapPackageToPlan(pkg) {
  if (!pkg.kind) return null;
  if (pkg.kind === 'unlimited') {
    if (pkg.package_slug?.includes('weekly')) return 'weekly';
    if (pkg.package_slug?.includes('monthly')) return 'monthly';
    return 'monthly';
  }
  if (pkg.kind === 'balance') return 'topup';
  return null;
}

// Sync users dari Arkx Studio SQLite → Nexabot Proxy
app.get('/admin/sync', requireAdmin, (req, res) => {
  if (!arkxDb) return res.status(500).json({ error: 'Arkx database tidak tersedia' });

  try {
    // 1. Ambil paket unlimited (weekly/monthly)
    const packages = arkxDb.prepare(`
      SELECT u.id as user_id, u.name, u.email, t.kind, t.package_slug, t.status as pkg_status, t.days, t.expires_at
      FROM users u
      JOIN nexabot_topup t ON u.id = t.user_id
      WHERE t.status = 'approved' AND t.kind = 'unlimited'
    `).all();

    // 2. Ambil total saldo topup per user (semua approved balance)
    const balanceRows = arkxDb.prepare(`
      SELECT u.id as user_id, u.name, u.email, COALESCE(SUM(t.amount), 0) as total_saldo
      FROM users u
      JOIN nexabot_topup t ON u.id = t.user_id
      WHERE t.status = 'approved' AND t.kind = 'balance'
      GROUP BY u.id
    `).all();
    const balanceMap = {};
    for (const b of balanceRows) balanceMap[b.user_id] = b.total_saldo;

    // Gabungkan: user dengan paket unlimited ATAU balance
    const allUserIds = new Set();
    for (const p of packages) allUserIds.add(p.user_id);
    for (const b of balanceRows) allUserIds.add(b.user_id);

    let created = 0, updated = 0, skipped = 0;
    const results = [];

    for (const userId of allUserIds) {
      const pkg = packages.find(p => p.user_id === userId);
      const totalSaldo = balanceMap[userId] || 0;

      // Tentukan plan: kalau ada paket unlimited, pakai itu; kalau cuma balance, pakai topup
      let plan, user;
      if (pkg) {
        plan = mapPackageToPlan(pkg);
        user = pkg;
      } else {
        plan = 'topup';
        user = balanceRows.find(b => b.user_id === userId);
      }
      if (!plan || !user) { skipped++; continue; }

      const existingMember = db.prepare(
        'SELECT * FROM members WHERE api_key LIKE ?'
      ).get(`arkx-arkxuser-${userId}-%`);

      if (existingMember) {
        // Update saldo untuk plan topup
        if (plan === 'topup' && totalSaldo > 0 && existingMember.saldo !== totalSaldo) {
          db.prepare('UPDATE members SET saldo = ?, active = 1 WHERE id = ?').run(totalSaldo, existingMember.id);
          updated++;
          results.push({ id: existingMember.id, name: user.name, action: 'updated_saldo', saldo: totalSaldo });
        }
        // Update expiry jika berubah
        if (pkg && user.expires_at && existingMember.expires_at !== user.expires_at) {
          db.prepare('UPDATE members SET expires_at = ? WHERE id = ?').run(user.expires_at, existingMember.id);
          updated++;
          results.push({ id: existingMember.id, name: user.name, action: 'updated_expiry' });
        }
      } else {
        // Buat member baru
        const apiKey = `arkx-arkxuser-${userId}-${crypto.randomBytes(12).toString('hex')}`;
        let expiresAt = (user.expires_at || new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString());
        let initialSaldo = totalSaldo;

        if (plan === 'topup') {
          expiresAt = new Date(Date.now() + 365 * 24 * 60 * 60 * 1000).toISOString();
        }

        db.prepare(
          `INSERT INTO members (name, api_key, plan, status, saldo, started_at, expires_at) VALUES (?, ?, ?, 'approved', ?, datetime('now'), ?)`
        ).run(user.name, apiKey, plan, initialSaldo, expiresAt);

        created++;
        const newId = db.prepare('SELECT last_insert_rowid() as id').get().id;
        results.push({ id: newId, name: user.name, api_key: apiKey, action: 'created', saldo: initialSaldo });
        broadcastSSE({ type: 'sync_new_member', name: user.name, plan, time: new Date().toISOString() });
      }
    }

    res.json({ message: `Sync: ${created} baru, ${updated} diupdate, ${skipped} dilewati`, created, updated, skipped, results });
  } catch (err) {
    console.error('[SYNC ERROR]', err.message);
    res.status(500).json({ error: 'Gagal sync: ' + err.message });
  }
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
  console.log(`   🔒 Provider: ${PROVIDER_INFO.name} (LOCKED — tidak bisa diganti)`);
  if (RH_KEY_POOL.length > 0) console.log(`   RunningHub: ✅ ${RH_KEY_POOL.length} key(s) aktif (webapp: ${RUNNINGHUB_WEBAPP_ID})`);
  else console.log(`   RunningHub: ⚠️ API key belum dikonfigurasi`);
  console.log(`   UGC Storyboard: 🎬 MiniMax H3 I2V (webapp: ${UGC_WEBAPP_ID}, max ${UGC_MAX_SCENES} scene, ${UGC_MAX_DURATION}s)`);
});
