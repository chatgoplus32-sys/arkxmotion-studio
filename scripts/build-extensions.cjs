#!/usr/bin/env node
/**
 * Build Chrome extensions for ARKXMotion providers.
 * Features: Auto-grab tokens + Auto-sync to Token Manager
 * Output: public/downloads/<provider>-extension.zip
 */

const fs = require('fs');
const path = require('path');
const zlib = require('zlib');
const JSZip = require('jszip');

const OUTPUT_DIR = path.resolve(__dirname, '..', 'public', 'downloads');
const ORIG_DIR = path.resolve(__dirname, '..', '..', 'jwt-extractor-extension');

// ─── ARKXMotion sync config ──────────────────────────────────────────────────
const ARKX_CONFIG = {
  API_URL: 'https://arkxmotion-studio.vercel.app',
};

// ─── Helper: Generate PNG icon ───────────────────────────────────────────────
function generateIcon(size, hexColor) {
  const r = parseInt(hexColor.slice(1, 3), 16);
  const g = parseInt(hexColor.slice(3, 5), 16);
  const b = parseInt(hexColor.slice(5, 7), 16);
  const rawData = Buffer.alloc(size * size * 4);
  for (let i = 0; i < size * size; i++) {
    const x = (i % size) / size;
    const y = Math.floor(i / size) / size;
    const dist = Math.sqrt((x - 0.5) ** 2 + (y - 0.5) ** 2);
    const off = i * 4;
    if (dist < 0.42) {
      rawData[off] = r; rawData[off+1] = g; rawData[off+2] = b; rawData[off+3] = 255;
    } else if (dist < 0.5) {
      rawData[off] = r; rawData[off+1] = g; rawData[off+2] = b;
      rawData[off+3] = Math.floor(255 * (0.5 - dist) / 0.08);
    }
  }
  const rowSize = 1 + size * 4;
  const filtered = Buffer.alloc(size * rowSize);
  for (let y = 0; y < size; y++) {
    filtered[y * rowSize] = 0;
    rawData.copy(filtered, y * rowSize + 1, y * size * 4, (y + 1) * size * 4);
  }
  const compressed = zlib.deflateSync(filtered);
  const sig = Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]);
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(size, 0); ihdr.writeUInt32BE(size, 4);
  ihdr[8] = 8; ihdr[9] = 6;
  return Buffer.concat([sig, makeChunk('IHDR', ihdr), makeChunk('IDAT', compressed), makeChunk('IEND', Buffer.alloc(0))]);
}
function makeChunk(type, data) {
  const len = Buffer.alloc(4); len.writeUInt32BE(data.length, 0);
  const typeB = Buffer.from(type, 'ascii');
  const crc = crc32(Buffer.concat([typeB, data]));
  const crcB = Buffer.alloc(4); crcB.writeUInt32BE(crc >>> 0, 0);
  return Buffer.concat([len, typeB, data, crcB]);
}
function crc32(buf) {
  let c = 0xFFFFFFFF;
  for (let i = 0; i < buf.length; i++) {
    c ^= buf[i];
    for (let j = 0; j < 8; j++) c = (c >>> 1) ^ (c & 1 ? 0xEDB88320 : 0);
  }
  return (c ^ 0xFFFFFFFF) >>> 0;
}

// ─── Helper: Build MV3 extension ─────────────────────────────────────────────
function buildMV3(id, name, icon, color, description, manifest, background, content, popupHTML, popupJS) {
  const zip = new JSZip();
  const folder = zip.folder(id);
  folder.file('manifest.json', JSON.stringify(manifest, null, 2));
  folder.file('background.js', background);
  folder.file('content.js', content);
  folder.file('popup.html', popupHTML);
  folder.file('popup.js', popupJS);
  folder.file('icon.png', generateIcon(128, color));
  return zip;
}

// ─── Template: MV3 manifest ──────────────────────────────────────────────────
function mv3Manifest(id, name, description, matches) {
  return {
    manifest_version: 3,
    name: `ARKXMotion — ${name}`,
    description,
    version: '1.0.0',
    permissions: ['activeTab', 'storage', 'scripting', 'tabs'],
    host_permissions: [...matches, `${ARKX_CONFIG.API_URL}/*`],
    action: {
      default_popup: 'popup.html',
      default_title: `Grab ${name} Token`,
      default_icon: { '16': 'icon.png', '48': 'icon.png', '128': 'icon.png' },
    },
    icons: { '16': 'icon.png', '48': 'icon.png', '128': 'icon.png' },
    background: { service_worker: 'background.js' },
    content_scripts: [{ matches, js: ['content.js'], run_at: 'document_idle' }],
  };
}

// ─── Template: MV3 background with auto-sync ─────────────────────────────────
function mv3Background(id, name, icon, grabMatches) {
  return `// ARKXMotion Extension — ${name}
// Background service worker with auto-sync

const API_URL = '${ARKX_CONFIG.API_URL}';

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  if (msg.type === 'TOKEN_GRABBED' && msg.provider === '${id}') {
    chrome.storage.local.set({
      arkx_${id}: { token: msg.token, timestamp: Date.now(), url: sender.tab?.url || '' }
    });
    syncToken('${id}', msg.token);
    chrome.action.setBadgeText({ text: '✓' });
    chrome.action.setBadgeBackgroundColor({ color: '#10b981' });
    chrome.notifications?.create({
      type: 'basic',
      iconUrl: 'icon.png',
      title: 'ARKXMotion — ${name}',
      message: 'Token berhasil di-grab & sync ke Token Manager!',
    });
  }

  if (msg.type === 'TOKEN_ERROR' && msg.provider === '${id}') {
    chrome.action.setBadgeText({ text: '!' });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' });
  }

  if (msg.type === 'GET_TOKEN') {
    chrome.storage.local.get('arkx_${id}', (data) => {
      sendResponse(data.arkx_${id} || null);
    });
    return true;
  }

  if (msg.type === 'OPEN_ARKXMOTION') {
    chrome.tabs.create({ url: API_URL });
  }
});

async function syncToken(provider, token) {
  try {
    await fetch(API_URL + '/api/sync-tokens', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ provider, token, source: 'extension' }),
    });
    console.log('[ARKX] Token synced for', provider);
  } catch (e) {
    console.error('[ARKX] Sync failed:', e);
  }
}

chrome.tabs.onUpdated.addListener((tabId, info, tab) => {
  if (info.status === 'complete' && tab.url) {
    const matches = ${JSON.stringify(grabMatches.map(m => m.replace('*://', '').replace('/*', '')))};
    if (matches.some(d => tab.url.includes(d))) {
      chrome.scripting.executeScript({ target: { tabId }, files: ['content.js'] });
    }
  }
});
`;
}

// ─── Template: MV3 popup HTML ────────────────────────────────────────────────
function mv3PopupHTML(id, name, icon, color) {
  return `<!DOCTYPE html>
<html>
<head>
<meta charset="utf-8">
<style>
*{box-sizing:border-box;margin:0;padding:0}
body{width:360px;min-height:200px;font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif;background:#0f172a;color:#e2e8f0;padding:16px}
.hdr{display:flex;align-items:center;gap:10px;margin-bottom:16px;padding-bottom:12px;border-bottom:1px solid #1e293b}
.hdr .ico{font-size:28px}
.hdr .ttl{font-size:16px;font-weight:700;color:${color}}
.hdr .sub{font-size:11px;color:#94a3b8}
.st{padding:10px 12px;border-radius:8px;margin-bottom:12px;font-size:13px;display:flex;align-items:center;gap:8px}
.st.idle{background:#1e293b;color:#94a3b8}
.st.ok{background:#065f46;color:#6ee7b7}
.st.err{background:#7f1d1d;color:#fca5a5}
.st.load{background:#1e3a5f;color:#93c5fd}
.dot{width:8px;height:8px;border-radius:50%;flex-shrink:0}
.dot.idle{background:#64748b}.dot.ok{background:#10b981}.dot.err{background:#ef4444}.dot.load{background:#3b82f6;animation:p 1s infinite}
@keyframes p{0%,100%{opacity:1}50%{opacity:.4}}
.tok{background:#1e293b;border:1px solid #334155;border-radius:8px;padding:10px;margin-bottom:12px;font-family:monospace;font-size:11px;color:#64748b;word-break:break-all;max-height:60px;overflow:hidden}
.btn{width:100%;padding:10px;border:none;border-radius:8px;font-size:13px;font-weight:600;cursor:pointer;margin-bottom:8px;transition:all .15s}
.btn:active{transform:scale(.98)}
.bp{background:${color};color:#0f172a}.bp:hover{filter:brightness(1.1)}
.bs{background:#1e293b;color:#e2e8f0;border:1px solid #334155}.bs:hover{background:#334155}
.ft{margin-top:12px;padding-top:8px;border-top:1px solid #1e293b;text-align:center;font-size:10px;color:#475569}
.sync{margin-top:8px;padding:8px;background:#065f46;border-radius:6px;font-size:11px;color:#6ee7b7;text-align:center}
</style>
</head>
<body>
<div class="hdr">
  <span class="ico">${icon}</span>
  <div><div class="ttl">ARKXMotion — ${name}</div><div class="sub">Auto-grab & sync token</div></div>
</div>
<div id="st" class="st idle"><span class="dot idle"></span><span>Menunggu aksi...</span></div>
<div id="tp" class="tok" style="display:none"></div>
<div id="sync" class="sync" style="display:none">✅ Auto-synced ke Token Manager</div>
<button id="gb" class="btn bp">🔑 Grab Token dari Halaman Ini</button>
<button id="ab" class="btn bs">🚀 Buka ARKXMotion</button>
<div class="ft">ARKXMotion Token Extension v1.0.0</div>
<script src="popup.js"></script>
</body>
</html>`;
}

// ─── Template: MV3 popup JS ──────────────────────────────────────────────────
function mv3PopupJS(id) {
  return `document.addEventListener('DOMContentLoaded', () => {
  const st = document.getElementById('st');
  const tp = document.getElementById('tp');
  const sync = document.getElementById('sync');
  const gb = document.getElementById('gb');
  const ab = document.getElementById('ab');

  function setStatus(type, text) {
    st.className = 'st ' + type;
    st.innerHTML = '<span class="dot ' + type + '"></span><span>' + text + '</span>';
  }
  function mask(t) { return t && t.length > 20 ? t.slice(0,15) + '...' + t.slice(-8) : t; }

  chrome.storage.local.get('arkx_${id}', (data) => {
    const s = data.arkx_${id};
    if (s?.token) {
      setStatus('ok', 'Token tersimpan ✓');
      tp.style.display = 'block';
      tp.textContent = mask(s.token);
      sync.style.display = 'block';
    }
  });

  gb.addEventListener('click', async () => {
    setStatus('load', 'Grabbing token...');
    const [tab] = await chrome.tabs.query({ active: true, currentWindow: true });
    try {
      await chrome.scripting.executeScript({ target: { tabId: tab.id }, files: ['content.js'] });
      setTimeout(() => { if (st.classList.contains('load')) setStatus('err', 'Timeout — pastikan sudah login'); }, 10000);
    } catch(e) { setStatus('err', 'Error: ' + e.message); }
  });

  ab.addEventListener('click', () => { chrome.runtime.sendMessage({ type: 'OPEN_ARKXMOTION' }); });
});`;
}

// ─────────────────────────────────────────────────────────────────────────────
// LEONARDO AI
// ─────────────────────────────────────────────────────────────────────────────
const LEO_MATCHES = ['*://app.leonardo.ai/*', '*://cloud.leonardo.ai/*'];
const LEO_CONTENT = `(function() {
  'use strict';
  function checkStorage(storage) {
    for (const key of Object.keys(storage)) {
      const val = storage.getItem(key);
      if (val && val.includes('eyJ')) return val;
    }
    return null;
  }
  let token = checkStorage(localStorage) || checkStorage(sessionStorage);
  if (token) window.postMessage({ type: 'ARKX_TOKEN', provider: 'leonardo', token: token }, '*');

  fetch('/api/auth/session').then(r => r.json()).then(data => {
    const t = data?.accessToken || data?.access_token;
    if (t) window.postMessage({ type: 'ARKX_TOKEN', provider: 'leonardo', token: t }, '*');
  }).catch(() => {});

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ARKX_TOKEN' && event.data.provider === 'leonardo') {
      chrome.runtime.sendMessage({ type: 'TOKEN_GRABBED', provider: 'leonardo', token: event.data.token });
    }
  });
})();`;

// ─────────────────────────────────────────────────────────────────────────────
// WEAVY
// ─────────────────────────────────────────────────────────────────────────────
const WEAVY_MATCHES = ['*://app.weavy.ai/*'];
const WEAVY_CONTENT = `(function() {
  'use strict';
  async function grabFromIndexedDB() {
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        const idb = await new Promise((resolve) => {
          const req = indexedDB.open(db.name);
          req.onsuccess = () => resolve(req.result);
        });
        for (const name of Array.from(idb.objectStoreNames)) {
          const tx = idb.transaction(name, 'readonly');
          const store = tx.objectStore(name);
          const data = await new Promise((resolve) => {
            const req = store.getAll();
            req.onsuccess = () => resolve(req.result);
          });
          for (const item of data) {
            if (item?.access_token || item?.token) {
              const token = item.access_token || item.token;
              window.postMessage({ type: 'ARKX_TOKEN', provider: 'weavy', token: token }, '*');
              return token;
            }
          }
        }
      }
    } catch(e) {}
    return null;
  }

  // Also try localStorage
  function checkStorage() {
    for (const key of Object.keys(localStorage)) {
      const val = localStorage.getItem(key);
      if (val && val.length > 50) {
        try {
          const parsed = JSON.parse(val);
          if (parsed?.access_token) return parsed.access_token;
        } catch(e) {
          if (val.startsWith('eyJ')) return val;
        }
      }
    }
    return null;
  }

  // Try session API
  fetch('/api/auth/session').then(r => r.json()).then(data => {
    const t = data?.accessToken || data?.access_token || data?.session?.access_token;
    if (t) window.postMessage({ type: 'ARKX_TOKEN', provider: 'weavy', token: t }, '*');
  }).catch(() => {});

  checkStorage() ? window.postMessage({ type: 'ARKX_TOKEN', provider: 'weavy', token: checkStorage() }, '*') : null;
  grabFromIndexedDB();

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ARKX_TOKEN' && event.data.provider === 'weavy') {
      chrome.runtime.sendMessage({ type: 'TOKEN_GRABBED', provider: 'weavy', token: event.data.token });
    }
  });
})();`;

// ─────────────────────────────────────────────────────────────────────────────
// ONEOVER (use original extension from extensions/oneover-token-ext/)
// ─────────────────────────────────────────────────────────────────────────────
const ONEOVER_EXT_DIR = path.resolve(__dirname, '..', '..', 'arkxmotion-studio', 'extensions', 'oneover-token-ext');

// ─────────────────────────────────────────────────────────────────────────────
// ROBONEO
// ─────────────────────────────────────────────────────────────────────────────
const ROBO_MATCHES = ['*://roboneo.com/*', '*://*.roboneo.com/*'];
const ROBO_CONTENT = `(function() {
  'use strict';
  function checkStorage(storage) {
    for (const key of Object.keys(storage)) {
      const val = storage.getItem(key);
      if (val && val.startsWith('eyJ')) return val;
      try {
        const parsed = JSON.parse(val);
        if (parsed?.access_token) return parsed.access_token;
      } catch(e) {}
    }
    return null;
  }
  let token = checkStorage(localStorage);
  if (token) window.postMessage({ type: 'ARKX_TOKEN', provider: 'roboneo', token: token }, '*');

  fetch('/api/auth/session').then(r => r.json()).then(data => {
    const t = data?.accessToken || data?.access_token;
    if (t) window.postMessage({ type: 'ARKX_TOKEN', provider: 'roboneo', token: t }, '*');
  }).catch(() => {});

  window.addEventListener('message', (event) => {
    if (event.source !== window) return;
    if (event.data?.type === 'ARKX_TOKEN' && event.data.provider === 'roboneo') {
      chrome.runtime.sendMessage({ type: 'TOKEN_GRABBED', provider: 'roboneo', token: event.data.token });
    }
  });
})();`;

// ─────────────────────────────────────────────────────────────────────────────
// BUILD
// ─────────────────────────────────────────────────────────────────────────────
async function main() {
  console.log('🔨 Building ARKXMotion Chrome Extensions...\n');
  fs.mkdirSync(OUTPUT_DIR, { recursive: true });

  const builds = [
    // Leonardo
    {
      name: 'Leonardo AI', id: 'leonardo', color: '#facc15', icon: '🎨',
      desc: 'Auto-grab & sync Bearer JWT dari app.leonardo.ai',
      matches: LEO_MATCHES, content: LEO_CONTENT,
    },
    // Weavy
    {
      name: 'Weavy', id: 'weavy', color: '#3b82f6', icon: '☁️',
      desc: 'Auto-grab & sync token dari app.weavy.ai via IndexedDB',
      matches: WEAVY_MATCHES, content: WEAVY_CONTENT,
    },
    // OneOver (built separately from original extension)
    // Roboneo
    {
      name: 'Roboneo', id: 'roboneo', color: '#f97316', icon: '🤖',
      desc: 'Auto-grab & sync token dari Roboneo dashboard',
      matches: ROBO_MATCHES, content: ROBO_CONTENT,
    },
  ];

  // Build MV3 extensions
  for (const b of builds) {
    console.log(`📦 ${b.name}...`);
    const manifest = mv3Manifest(b.id, b.name, b.desc, b.matches);
    const background = mv3Background(b.id, b.name, b.icon, b.matches);
    const popupHTML = mv3PopupHTML(b.id, b.name, b.icon, b.color);
    const popupJS = mv3PopupJS(b.id);
    const zip = buildMV3(b.id, b.name, b.icon, b.color, b.desc, manifest, background, b.content, popupHTML, popupJS);
    const buf = await zip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
    fs.writeFileSync(path.join(OUTPUT_DIR, `${b.id}-extension.zip`), buf);
    console.log(`  ✅ ${b.id}-extension.zip (${(buf.length / 1024).toFixed(1)} KB) [MV3]`);
  }

  // Build OneOver (original extension from extensions/oneover-token-ext/)
  console.log('📦 OneOver...');
  const ooZip = new JSZip();
  const ooFolder = ooZip.folder('oneover');
  const ooFiles = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js'];
  for (const file of ooFiles) {
    const filePath = path.join(ONEOVER_EXT_DIR, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      // Update manifest name
      if (file === 'manifest.json') {
        const manifest = JSON.parse(content);
        manifest.name = 'ARKXMotion — OneOver';
        manifest.description = 'Auto-grab & sync Supabase JWT dari oneover.com';
        content = JSON.stringify(manifest, null, 2);
      }
      ooFolder.file(file, content);
    }
  }
  // Copy icon if exists
  const ooIconPath = path.join(ONEOVER_EXT_DIR, 'icon.png');
  if (fs.existsSync(ooIconPath)) {
    ooFolder.file('icon.png', fs.readFileSync(ooIconPath));
  }
  const ooBuf = await ooZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'oneover-extension.zip'), ooBuf);
  console.log(`  ✅ oneover-extension.zip (${(ooBuf.length / 1024).toFixed(1)} KB) [MV3 — original]`);

  // Build Framia (MV2, original code with browser→chrome fix)
  console.log('📦 Framia...');
  const fraZip = new JSZip();
  const fraFolder = fraZip.folder('framia');
  const fraFiles = ['manifest.json', 'background.js', 'content.js', 'popup.html', 'popup.js'];
  for (const file of fraFiles) {
    const filePath = path.join(ORIG_DIR, file);
    if (fs.existsSync(filePath)) {
      let content = fs.readFileSync(filePath, 'utf-8');
      // Convert browser → chrome for Chrome compatibility
      content = content.replace(/\bbrowser\b\./g, 'chrome.');
      if (file === 'manifest.json') {
        const manifest = JSON.parse(content);
        manifest.name = 'ARKXMotion — Framia';
        manifest.description = 'Auto-grab & sync access token dari framia.converge.ai';
        content = JSON.stringify(manifest, null, 2);
      }
      fraFolder.file(file, content);
    }
  }
  const fraBuf = await fraZip.generateAsync({ type: 'nodebuffer', compression: 'DEFLATE' });
  fs.writeFileSync(path.join(OUTPUT_DIR, 'framia-extension.zip'), fraBuf);
  console.log(`  ✅ framia-extension.zip (${(fraBuf.length / 1024).toFixed(1)} KB) [MV2 — original]`);

  console.log(`\n✅ Built ${builds.length + 1} extensions in public/downloads/\n`);
  console.log('  📄 leonardo-extension.zip  — MV3, auto-sync');
  console.log('  📄 weavy-extension.zip     — MV3, auto-sync');
  console.log('  📄 oneover-extension.zip   — MV3, auto-sync');
  console.log('  📄 roboneo-extension.zip   — MV3, auto-sync');
  console.log('  📄 framia-extension.zip    — MV2, original code');
  console.log(`\n  ⚙️  Sync URL: ${ARKX_CONFIG.API_URL}`);
}

main().catch(err => { console.error('Build failed:', err); process.exit(1); });
