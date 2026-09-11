import { useState, useCallback } from 'react'
import { PageHeader, PageContent } from '@/components/layout'
import { Section, Button, Badge } from '@/components/ui'
import { useProviderManager, type ProviderId } from '@/stores/providerManager'
import { useToastStore } from '@/stores/toastStore'
import {
  Download, ExternalLink, Copy, Check,
  Terminal, AlertTriangle, Package
} from 'lucide-react'

// ─── Token grab scripts per provider ────────────────────────────────────────
const TOKEN_SCRIPTS: Record<string, { script: string; instructions: string[]; url: string }> = {
  leonardo: {
    url: 'https://app.leonardo.ai',
    script: `// ARKXMotion Token Grab — Leonardo AI
// Buka app.leonardo.ai (login dulu) → F12 → Console → paste ini
(async () => {
  try {
    const res = await fetch('https://cloud.leonardo.ai/api/rest/v1/user', {
      headers: { 'Authorization': 'Bearer ' + (await (await fetch('https://api.leonardo.ai/v1/auth/')).headers.get('authorization') || '') }
    });
    alert('Paste token dari Network tab:\\\\nF12 → Network → filter api.leonardo.ai → klik request pertama → Headers → Authorization → copy Bearer token');
  } catch(e) { alert('Error: ' + e.message); }
})();`,
    instructions: [
      'Buka app.leonardo.ai dan login',
      'Setelah halaman dashboard kebuka, extension auto-sync JWT terbaru tiap ±45 dtk — key expired di app diganti otomatis, tanpa copy-paste',
      'Buka DevTools (F12) → tab Network',
      'Filter: api.leonardo.ai',
      'Klik request pertama → Headers → Authorization',
      'Copy Bearer token (eyJ...eyJ...)',
    ],
  },
  framia: {
    url: 'https://framia.converge.ai',
    script: `// ARKXMotion Token Grab — Framia
(async () => {
  const r = await fetch('/api/auth/session');
  const d = await r.json();
  const t = d?.accessToken || d?.access_token;
  if (t) { await navigator.clipboard.writeText(t); alert('✅ Framia token copied!'); }
  else { alert('❌ Token not found.'); }
})();`,
    instructions: [
      'Buka framia.converge.ai dan login',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter',
      'Token otomatis copy ke clipboard',
    ],
  },
  oneover: {
    url: 'https://oneover.com',
    script: `// ARKXMotion Token Grab — OneOver
(async () => {
  const r = await fetch('/api/auth/session');
  const d = await r.json();
  const t = d?.accessToken || d?.access_token || d?.session?.access_token;
  if (t) { await navigator.clipboard.writeText(t); alert('✅ OneOver token copied!'); }
  else { alert('❌ Token not found.'); }
})();`,
    instructions: [
      'Buka oneover.com dan login',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter',
      'Token otomatis copy ke clipboard',
    ],
  },
  weavy: {
    url: 'https://app.weavy.ai',
    script: `// ARKXMotion Token Grab — Weavy
(async () => {
  try {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      const idb = await new Promise((resolve) => {
        const req = indexedDB.open(db.name);
        req.onsuccess = () => resolve(req.result);
      });
      for (const name of Array.from(idb.objectStoreNames)) {
        const tx = idb.transaction(name, 'readonly');
        const data = await new Promise((resolve) => {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
        });
        for (const item of data) {
          if (item?.access_token || item?.token) {
            await navigator.clipboard.writeText(item.access_token || item.token);
            alert('✅ Weavy token copied!');
            return;
          }
        }
      }
    }
    alert('❌ Token not found.');
  } catch(e) { alert('Error: ' + e.message); }
})();`,
    instructions: [
      'Buka app.weavy.ai dan login',
      'Setelah halaman dashboard kebuka, extension auto-sync token terbaru tiap ±45 dtk — key expired di app diganti otomatis, tanpa copy-paste',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter',
      'Token otomatis copy dari IndexedDB',
    ],
  },
  galleri5: {
    url: 'https://studio.galleri5.com',
    script: `// ARKXMotion Token Grab — Galleri5
(async () => {
  try {
    const dbs = await indexedDB.databases();
    for (const db of dbs) {
      if (!db.name?.includes('firebase')) continue;
      const idb = await new Promise((resolve) => {
        const req = indexedDB.open(db.name);
        req.onsuccess = () => resolve(req.result);
      });
      for (const name of Array.from(idb.objectStoreNames)) {
        const tx = idb.transaction(name, 'readonly');
        const data = await new Promise((resolve) => {
          const req = tx.objectStore(name).getAll();
          req.onsuccess = () => resolve(req.result);
        });
        for (const item of data) {
          if (item?.stsTokenManager?.accessToken) {
            const token = JSON.stringify({
              accessToken: item.stsTokenManager.accessToken,
              refreshToken: item.stsTokenManager.refreshToken,
              expirationTime: item.stsTokenManager.expirationTime
            });
            await navigator.clipboard.writeText(token);
            alert('✅ Galleri5 token copied!');
            return;
          }
        }
      }
    }
    alert('❌ Token not found.');
  } catch(e) { alert('Error: ' + e.message); }
})();`,
    instructions: [
      'Buka studio.galleri5.com dan login',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter',
      'Token (JSON) otomatis copy dari Firebase IndexedDB',
    ],
  },
  roboneo: {
    url: 'https://roboneo.com',
    script: `// ARKXMotion Token Grab — Roboneo
(async () => {
  for (const key of Object.keys(localStorage)) {
    const val = localStorage.getItem(key);
    if (val && val.startsWith('eyJ')) {
      await navigator.clipboard.writeText(val);
      alert('✅ Roboneo token copied!');
      return;
    }
    try {
      const parsed = JSON.parse(val);
      if (parsed?.access_token) {
        await navigator.clipboard.writeText(parsed.access_token);
        alert('✅ Roboneo token copied!');
        return;
      }
    } catch(e) {}
  }
  alert('❌ Token not found.');
})();`,
    instructions: [
      'Buka roboneo.com dan login',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter',
      'Token otomatis copy ke clipboard',
    ],
  },
  riverside: {
    url: 'https://riverside.com/dashboard',
    script: `// ARKXMotion Token Grab — Riverside
(async () => {
  const grab = async () => {
    const found = [];
    const isToken = (v) => v && typeof v === 'string' && (v.startsWith('eyJ') || v.startsWith('AMf')) && v.length > 40;
    // 1. localStorage / sessionStorage
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const v = s.getItem(s.key(i)) || '';
        if (isToken(v)) found.push(v);
        try {
          const j = JSON.parse(v);
          if (j && typeof j === 'object') {
            const c = j.access_token || j.idToken || j.refreshToken || j.refresh_token || j.token || j.id_token || (j.stsTokenManager && (j.stsTokenManager.refreshToken || j.stsTokenManager.accessToken));
            if (isToken(c)) found.push(c);
          }
        } catch {}
      }
    }
    // 2. Firebase IndexedDB
    try {
      const dbs = await indexedDB.databases();
      for (const db of dbs) {
        if (!db.name?.includes('firebase')) continue;
        const idb = await new Promise((resolve) => { const req = indexedDB.open(db.name); req.onsuccess = () => resolve(req.result); });
        for (const name of Array.from(idb.objectStoreNames)) {
          const tx = idb.transaction(name, 'readonly');
          const data = await new Promise((resolve) => { const req = tx.objectStore(name).getAll(); req.onsuccess = () => resolve(req.result); });
          for (const item of data) {
            const sts = item?.value?.stsTokenManager || item?.stsTokenManager;
            if (sts && isToken(sts.refreshToken)) found.push(sts.refreshToken);
            else if (sts && isToken(sts.accessToken)) found.push(sts.accessToken);
          }
        }
      }
    } catch {}
    // 3. Cookies raw JWT
    for (const c of document.cookie.split(';')) {
      const v = decodeURIComponent(c.trim().split('=').slice(1).join('='));
      if (v.startsWith('eyJ') && v.indexOf('.') !== -1) found.push(v);
    }
    // Prefer refresh token (AMf-), else JWT
    const best = found.find((t) => t.startsWith('AMf')) || found[0];
    return best || null;
  };
  const t = await grab();
  if (t) { try { await navigator.clipboard.writeText(t); } catch {}
    alert('✅ Riverside token copied! Format: ' + (t.startsWith('AMf') ? 'Firebase refresh (tahan lama)' : 'JWT (expired ~1 jam)') + '\n\n' + t.slice(0, 30) + '...\n\nPaste ke ARKXMotion → Providers → Riverside'); }
  else { alert('❌ Token not found.\n\nPastikan sudah login di riverside.com/dashboard.\n\nAlternatif: F12 → Network → klik request API → Headers → salin value "Authorization: Bearer ..."'); }
})();`,
    instructions: [
      'Buka riverside.com/dashboard dan login',
      'Buka DevTools Console (F12 → Console)',
      'Paste script di atas & Enter — script otomatis pilih token termuda',
      'Session JWT Riverside cuma ±10 menit — grab ulang kalau expired',
      'Paste di ARKXMotion → Providers → Riverside',
    ],
  },
  genspark: {
    url: 'https://www.genspark.ai/settings/api-keys',
    script: `// ARKXMotion Token Grab — Genspark AI
// Buka genspark.ai/settings/api-keys (login dulu)
// PENTING: Klik Show/Reveal dulu sebelum jalankan script ini!
(async () => {
  let key = null;
  // 1. Scan ALL text in page (fast)
  const html = document.documentElement.outerHTML;
  const m = html.match(/gsk[-_][a-zA-Z0-9_-]{16,}/);
  if (m) key = m[0];
  // 2. Scan localStorage/sessionStorage
  if (!key) {
    for (const s of [localStorage, sessionStorage]) {
      for (let i = 0; i < s.length; i++) {
        const v = s.getItem(s.key(i)) || '';
        const m2 = v.match(/gsk[-_][a-zA-Z0-9_-]{16,}/);
        if (m2) { key = m2[0]; break; }
        try { const j = JSON.stringify(JSON.parse(v)); const m3 = j.match(/gsk[-_][a-zA-Z0-9_-]{16,}/); if (m3) { key = m3[0]; break; } } catch {}
      }
      if (key) break;
    }
  }
  // 3. Scan input values
  if (!key) {
    document.querySelectorAll('input, textarea').forEach(el => {
      const m4 = (el.value || '').match(/gsk[-_][a-zA-Z0-9_-]{16,}/);
      if (m4 && !key) key = m4[0];
    });
  }
  // 4. Auto-click show/reveal buttons, wait, then re-scan
  if (!key) {
    document.querySelectorAll('button, [role=button], span, div').forEach(b => {
      const t = (b.textContent || '').toLowerCase();
      if (t.includes('show') || t.includes('reveal') || t.includes('eye') || t.includes('view')) b.click();
    });
    await new Promise(r => setTimeout(r, 2000));
    const m5 = document.documentElement.outerHTML.match(/gsk[-_][a-zA-Z0-9_-]{16,}/);
    if (m5) key = m5[0];
  }
  // 5. Copy or alert with manual instructions
  if (key) {
    try { await navigator.clipboard.writeText(key); } catch {}
    alert('API key found: ' + key.slice(0, 12) + '...\n\nCopied to clipboard! Paste in ARKXMotion → Providers → Genspark AI');
  } else {
    alert('Key not found automatically.\n\nManual steps:\n1. On this page, find your API key\n2. Click Show/Reveal/View eye icon next to it\n3. Select and copy the key (starts with gsk_)\n4. Paste in ARKXMotion → Providers → Genspark AI');
  }
})();`,
    instructions: [
      'Buka genspark.ai/settings/api-keys dan login',
      'Klik "Create API Key" jika belum ada',
      'Klik tombol Show/Reveal (icon mata) di samping key',
      'Jalankan script di Console (F12 → Console)',
      'Key otomatis copy, paste ke ARKXMotion Providers',
    ],
  },
  nexabot: {
    url: 'https://nexabot.id',
    // NexaBot memakai cookie session HttpOnly → Console TIDAK bisa membacanya.
    // Script ini hanya alat diagnosa; sumber cookie yang andal adalah extension
    // (chrome.cookies) di atas.
    script: `// NexaBot Session Check — cookie sesi HttpOnly TIDAK terbaca dari Console.
// Pakai extension "NexaBot Session Cookie Manager" (tombol Download ZIP di atas):
// dia membaca cookie via chrome.cookies lalu auto-sync ke app.
(async () => {
  try {
    const r = await fetch('https://nexabot.id/api/v1/credits', { credentials: 'include' });
    alert('HTTP ' + r.status + '\n\n' + (r.ok
      ? 'Sesi login aktif ✓ — ambil cookie-nya lewat extension (HttpOnly tidak bisa dari Console).'
      : 'Sesi belum aktif / kedaluwarsa. Login ulang di nexabot.id lalu pakai extension.'));
  } catch (e) {
    alert('Error: ' + e.message);
  }
})();`,
    instructions: [
      'Download & install extension "NexaBot Session Cookie Manager" di atas (Load unpacked)',
      'Buka app ARKXMotion ini di tab lain dan login — extension mengambil izin sync (JWT akunmu) dari tab itu sendiri, jadi tidak ada token yang perlu di-paste',
      'Buka nexabot.id dan login dengan akun yang punya paket Unlimited',
      'Cookie HttpOnly langsung terbaca lewat chrome.cookies — popup extension harus menunjukkan "sesi terdeteksi ✓"',
      'Cookie otomatis terkirim ke app (maks. 10 detik) — panel Providers → NexaBot → Session terisi sendiri. Tombol "Copy Cookie Session" + "Hubungkan ke app" tersedia kalau perlu manual',
      'Buka panel Session di Providers, cek status paket, lalu generate seperti biasa',
    ],
  },
}

// ─── Plugin info ─────────────────────────────────────────────────────────────
interface PluginInfo {
  id: ProviderId
  name: string
  icon: string
  color: string
  description: string
  type: 'extension' | 'bookmarklet' | 'manual'
  hasScript: boolean
  hasExtension: boolean
  status: 'available' | 'coming-soon'
}

const PLUGINS: PluginInfo[] = [
  {
    id: 'leonardo',
    name: 'Leonardo AI',
    icon: '🎨',
    color: '#facc15',
    description: 'Auto-grab + AUTO-SYNC Bearer JWT dari app.leonardo.ai — token expired diganti otomatis',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'framia',
    name: 'Framia',
    icon: '🎬',
    color: '#8b5cf6',
    description: 'Auto-grab access token dari framia.converge.ai',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'oneover',
    name: 'OneOver',
    icon: '🔮',
    color: '#06b6d4',
    description: 'Auto-grab Supabase JWT dari oneover.com',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'weavy',
    name: 'Weavy',
    icon: '☁️',
    color: '#3b82f6',
    description: 'Auto-grab + AUTO-SYNC token dari app.weavy.ai via IndexedDB — token expired diganti otomatis',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'galleri5',
    name: 'Galleri5',
    icon: '🎬',
    color: '#10b981',
    description: 'Auto-grab Firebase token dari studio.galleri5.com',
    type: 'bookmarklet',
    hasScript: true,
    hasExtension: false,
    status: 'available',
  },
  {
    id: 'roboneo',
    name: 'Roboneo',
    icon: '🤖',
    color: '#f97316',
    description: 'Auto-grab + AUTO-SYNC token dari Roboneo dashboard — token expired diganti otomatis',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'genspark',
    name: 'Genspark AI',
    icon: '⚡',
    color: '#8b5cf6',
    description: 'Auto-grab API key dari genspark.ai — Kling V3 Motion Control + 14 video models',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'riverside',
    name: 'Riverside',
    icon: '🎙️',
    color: '#ff6b6b',
    description: 'Auto-grab + keep-alive + AUTO-SYNC JWT terbaru ke app (token tidak pernah mati, tanpa copy-paste)',
    type: 'extension',
    hasScript: true,
    hasExtension: true,
    status: 'available',
  },
  {
    id: 'nexabot',
    name: 'NexaBot',
    icon: '🧠',
    color: '#00D4AA',
    description: 'Auto-grab cookie session nexabot.id (termasuk HttpOnly) + AUTO-SYNC ke panel Session — tanpa Copy as cURL',
    type: 'extension',
    // Cookie sesi HttpOnly tidak bisa dibaca dari Console, jadi tidak ada jalur
    // bookmarklet yang jujur — pakai extension (chrome.cookies).
    hasScript: false,
    hasExtension: true,
    status: 'available',
  },
]

// ─── Install guide steps ─────────────────────────────────────────────────────
const INSTALL_STEPS = [
  'Download ZIP extension di atas',
  'Buka chrome://extensions di browser',
  'Aktifkan "Developer mode" (toggle di pojok kanan atas)',
  'Klik "Load unpacked" → pilih folder hasil extract ZIP',
  'Buka website provider & login',
  'Extension otomatis grab token saat halaman dimuat',
  'Token tersimpan — buka ARKXMotion untuk pakai',
]

export default function PluginsPage() {
  const { keys } = useProviderManager()
  const addToast = useToastStore((s) => s.addToast)
  const [copiedId, setCopiedId] = useState<string | null>(null)
  const [expandedId, setExpandedId] = useState<string | null>(null)

  const handleCopyScript = useCallback(async (plugin: PluginInfo) => {
    const scriptData = TOKEN_SCRIPTS[plugin.id]
    if (!scriptData) return
    try {
      await navigator.clipboard.writeText(scriptData.script)
      setCopiedId(plugin.id)
      addToast(`Script ${plugin.name} copied ke clipboard!`, 'success')
      setTimeout(() => setCopiedId(null), 2000)
    } catch {
      addToast('Gagal copy script', 'error')
    }
  }, [addToast])

  const handleDownload = useCallback((plugin: PluginInfo) => {
    const url = `/downloads/${plugin.id}-extension.zip`
    const a = document.createElement('a')
    a.href = url
    a.download = `${plugin.id}-extension.zip`
    document.body.appendChild(a)
    a.click()
    document.body.removeChild(a)
    addToast(`Downloading ${plugin.name} extension...`, 'success')
  }, [addToast])

  const getKeyCount = (providerId: string) => {
    return keys[providerId as ProviderId]?.length || 0
  }

  return (
    <PageContent>
      <PageHeader
        title="Plugins & Extensions"
        desc="Chrome extension untuk auto-grab token dari provider — tinggal download, install, dan pakai"
      />

      {/* Extension Cards */}
      <Section title="🧩 Chrome Extensions" sub="Download & install extension untuk setiap provider">
        <div className="grid grid-cols-1 md:grid-cols-2 lg:grid-cols-3 gap-4">
          {PLUGINS.map((plugin) => {
            const keyCount = getKeyCount(plugin.id)
            const hasKey = keyCount > 0
            const isExpanded = expandedId === plugin.id
            const isCopied = copiedId === plugin.id

            return (
              <div
                key={plugin.id}
                className={`rounded-xl border-2 transition-all ${
                  hasKey
                    ? 'border-emerald-500/30 bg-emerald-500/5'
                    : 'border-border hover:border-primary/30 bg-card/30'
                }`}
              >
                <div className="p-4">
                  {/* Header */}
                  <div className="flex items-start justify-between mb-3">
                    <div className="flex items-center gap-2">
                      <span className="text-2xl">{plugin.icon}</span>
                      <div>
                        <h3 className="font-semibold text-sm">{plugin.name}</h3>
                        <p className="text-[11px] text-muted-foreground">{plugin.description}</p>
                      </div>
                    </div>
                    {hasKey && (
                      <Badge variant="default" className="text-[10px] bg-emerald-500/20 text-emerald-400">
                        {keyCount} key{keyCount > 1 ? 's' : ''}
                      </Badge>
                    )}
                  </div>

                  {/* Type badges */}
                  <div className="flex items-center gap-2 mb-3">
                    <span className="text-[10px] px-2 py-0.5 rounded-full bg-blue-500/20 text-blue-400">
                      🧩 Chrome Extension
                    </span>
                    {plugin.hasScript && (
                      <span className="text-[10px] px-2 py-0.5 rounded-full bg-purple-500/20 text-purple-400">
                        📎 Bookmarklet
                      </span>
                    )}
                  </div>

                  {/* Action buttons */}
                  <div className="flex gap-2">
                    {plugin.hasExtension && (
                      <Button
                        size="sm"
                        variant="default"
                        onClick={() => handleDownload(plugin)}
                        className="flex-1 text-xs"
                        style={{ background: plugin.color, color: '#0f172a' }}
                      >
                        <Download className="h-3 w-3 mr-1" />
                        Download ZIP
                      </Button>
                    )}
                    {plugin.hasScript && (
                      <Button
                        size="sm"
                        variant={isCopied ? 'default' : 'outline'}
                        onClick={() => handleCopyScript(plugin)}
                        className="text-xs"
                      >
                        {isCopied ? (
                          <><Check className="h-3 w-3 mr-1" /> Copied!</>
                        ) : (
                          <><Copy className="h-3 w-3 mr-1" /> Script</>
                        )}
                      </Button>
                    )}
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => setExpandedId(isExpanded ? null : plugin.id)}
                      className="text-xs"
                    >
                      {isExpanded ? 'Hide' : 'Guide'}
                    </Button>
                    <Button
                      size="sm"
                      variant="outline"
                      onClick={() => window.open(TOKEN_SCRIPTS[plugin.id]?.url || '#', '_blank')}
                    >
                      <ExternalLink className="h-3 w-3" />
                    </Button>
                  </div>

                  {/* Expanded instructions */}
                  {isExpanded && TOKEN_SCRIPTS[plugin.id] && (
                    <div className="mt-3 p-3 rounded-lg bg-black/20 text-xs space-y-1.5">
                      <p className="font-semibold text-foreground/90 mb-2">📋 Cara pakai:</p>
                      {TOKEN_SCRIPTS[plugin.id].instructions.map((step, i) => (
                        <div key={i} className="flex gap-2">
                          <span className="text-primary font-mono">{i + 1}.</span>
                          <span className="text-muted-foreground">{step}</span>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              </div>
            )
          })}
        </div>
      </Section>

      {/* Quick Install Guide */}
      <Section title="⚡ Quick Install Guide" sub="Cara install Chrome extension">
        <div className="p-4 rounded-xl bg-black/20 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Package className="h-4 w-4 text-primary" />
            <span className="font-semibold">Install Extension (Chrome / Edge / Brave)</span>
          </div>
          <ol className="text-xs text-muted-foreground space-y-2 ml-6">
            {INSTALL_STEPS.map((step, i) => (
              <li key={i} className="flex gap-2">
                <span className="text-primary font-mono">{i + 1}.</span>
                <span>{step}</span>
              </li>
            ))}
          </ol>
          <div className="flex items-start gap-2 mt-3 p-2 rounded-lg bg-amber-500/10 border border-amber-500/20">
            <AlertTriangle className="h-4 w-4 text-amber-400 mt-0.5 shrink-0" />
            <p className="text-[11px] text-amber-400">
              <strong>Tip:</strong> Setelah install, buka website provider dan login. Extension akan otomatis grab token.
              Token tersimpan di Chrome storage — tidak perlu copy-paste manual lagi.
            </p>
          </div>
        </div>
      </Section>

      {/* Bookmarklet Method */}
      <Section title="📎 Bookmarklet (Alternatif)" sub="Cara manual tanpa install extension">
        <div className="p-4 rounded-xl bg-black/20 space-y-3">
          <div className="flex items-center gap-2 text-sm">
            <Terminal className="h-4 w-4 text-primary" />
            <span className="font-semibold">Copy & Paste Script</span>
          </div>
          <ol className="text-xs text-muted-foreground space-y-2 ml-6">
            <li className="flex gap-2">
              <span className="text-primary font-mono">1.</span>
              <span>Klik "Script" pada provider card di atas</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary font-mono">2.</span>
              <span>Buka website provider (login dulu)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary font-mono">3.</span>
              <span>Buka DevTools Console (F12 → Console)</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary font-mono">4.</span>
              <span>Paste script & Enter</span>
            </li>
            <li className="flex gap-2">
              <span className="text-primary font-mono">5.</span>
              <span>Token otomatis copy ke clipboard — paste di halaman Providers ARKXMotion</span>
            </li>
          </ol>
        </div>
      </Section>
    </PageContent>
  )
}
