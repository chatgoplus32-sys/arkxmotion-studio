const FRAMIA_PROXY = '/api/public/framia'

interface FramiaRunOptions {
  apiKey: string
  imageUrl?: string
  prompt: string
  skillId?: string
  onLog?: (msg: string, level?: string) => void
  onStatus?: (text: string, pct: number) => void
}

interface FramiaSkill {
  id: string
  name: string
  description?: string
  cost?: number
}

export async function fetchFramiaSkills(apiKey: string): Promise<FramiaSkill[]> {
  const res = await fetch(`${FRAMIA_PROXY}?path=workflows/skills`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  const data = await res.json()
  return data.skills || data.data || []
}

export async function fetchFramiaCredits(apiKey: string): Promise<number | { raw: string } | null> {
  // Validate token via user info endpoint (requires auth)
  const res = await fetch(`${FRAMIA_PROXY}?path=v1/user/me`, {
    headers: { Authorization: `Bearer ${apiKey}` },
  })
  const text = await res.text()
  let data: any
  try { data = JSON.parse(text) } catch { data = null }
  console.log('[framia] validation response:', res.status, text.slice(0, 300))

  if (res.ok && data) {
    const credits = data.credits ?? data.balance ?? data.data?.credits ?? data.data?.balance ?? data.user?.credits ?? data.user?.balance ?? null
    if (credits != null && typeof credits === 'number') return credits
    return { raw: 'Token valid' }
  }

  if (res.status === 401 || res.status === 403) {
    const msg = data?.message || data?.error || `HTTP ${res.status}`
    throw new Error(`Token invalid: ${msg}`)
  }

  return null
}

export async function submitFramiaRun(
  apiKey: string,
  body: { skill_id: string; prompt?: string; image_url?: string }
): Promise<{ runId: string }> {
  const res = await fetch(`${FRAMIA_PROXY}?path=workflows/runs`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${apiKey}`,
    },
    body: JSON.stringify(body),
  })
  if (!res.ok) {
    const err = await res.json().catch(() => ({}))
    throw new Error(err.error || `HTTP ${res.status}`)
  }
  const data = await res.json()
  return { runId: data.run_id || data.id }
}

export async function pollFramiaRun(
  apiKey: string,
  runId: string,
  onLog?: (msg: string, level?: string) => void,
  onStatus?: (text: string, pct: number) => void
): Promise<string> {
  const maxPolls = 120
  for (let i = 0; i < maxPolls; i++) {
    await new Promise(r => setTimeout(r, 3000))

    const res = await fetch(`${FRAMIA_PROXY}?path=workflows/runs/${runId}/nodes`, {
      headers: { Authorization: `Bearer ${apiKey}` },
    })

    if (!res.ok) {
      onLog?.(`Poll #${i + 1}: HTTP ${res.status} (retrying...)`, 'warn')
      continue
    }

    const data = await res.json()
    const nodes = data.nodes || []
    const pct = Math.min(90, 10 + (i / maxPolls) * 80)
    onStatus?.(`Polling... (${i + 1}/${maxPolls})`, pct)
    onLog?.(`Poll #${i + 1}: ${nodes.length} nodes`)

    const outputNode = nodes.find((n: any) => n.output_url || n.status === 'completed')
    if (outputNode?.output_url) {
      return outputNode.output_url
    }

    if (nodes.some((n: any) => n.status === 'failed')) {
      throw new Error('Workflow run failed')
    }
  }
  throw new Error('Timeout: generation took too long')
}

export async function generateWithFramia(opts: FramiaRunOptions): Promise<string> {
  const { apiKey, imageUrl, prompt, skillId, onLog, onStatus } = opts

  if (!apiKey) throw new Error('No Framia API key')

  const defaultSkill = skillId || 'i2v'
  onLog?.(`Submitting to Framia... skill=${defaultSkill}`)
  onStatus?.('Submitting to Framia...', 10)

  const body: any = { skill_id: defaultSkill, prompt }
  if (imageUrl) body.image_url = imageUrl

  const { runId } = await submitFramiaRun(apiKey, body)
  onLog?.(`Run created ✓ id=${runId}`)
  onStatus?.(`Processing... (run: ${runId.slice(0, 8)}...)`, 20)

  const videoUrl = await pollFramiaRun(apiKey, runId, onLog, onStatus)
  onStatus?.('Done!', 100)
  return videoUrl
}

/**
 * Generate a bookmarklet that extracts the Auth0 access_token from framia.converge.ai.
 * Framia uses Auth0 → getAccessTokenSilently() → Bearer token.
 * The access_token is stored in localStorage under @@auth0spajs@@ keys.
 */
export function getFramiaBookmarklet(): string {
  return `
(function() {
  try {
    var accessToken = '';

    // 1. Try Auth0 SDK localStorage (key pattern: @@auth0spajs@@::clientId::auth)
    for (var i = 0; i < localStorage.length; i++) {
      var key = localStorage.key(i) || '';
      if (key.indexOf('@@auth0spajs@@') === 0) {
        try {
          var raw = localStorage.getItem(key);
          var parsed = JSON.parse(raw || '{}');
          // Auth0 stores: { body: { access_token: '...', ... }, ... }
          var body = parsed.body || parsed;
          if (body.access_token) {
            accessToken = body.access_token;
            break;
          }
        } catch {}
      }
    }

    // 2. Fallback: scan ALL localStorage for JWTs starting with eyJhbGci
    if (!accessToken) {
      for (var j = 0; j < localStorage.length; j++) {
        var val = localStorage.getItem(localStorage.key(j) || '') || '';
        try {
          var p2 = JSON.parse(val);
          if (p2 && p2.access_token && p2.access_token.indexOf('eyJhbGci') === 0) {
            accessToken = p2.access_token;
            break;
          }
        } catch {}
      }
    }

    // 3. Fallback: try window.__auth0 or similar global
    if (!accessToken && window.__auth0Client) {
      try {
        accessToken = window.__auth0Client.getTokenSilently();
      } catch {}
    }

    if (!accessToken) {
      alert('Auth0 access_token not found.\n\nMake sure you are logged in to framia.converge.ai,\nthen navigate to any page that calls the API (e.g. open a workflow).\n\nThe access_token is different from the id_token (eyJjdHki...).');
      return;
    }

    navigator.clipboard.writeText(accessToken).then(function() {
      alert('✅ Access token copied!\n\n' + accessToken.slice(0, 40) + '...\n\nPaste into Freebuff → Providers → Framia.');
    }, function() {
      prompt('Copy this token:', accessToken);
    });
  } catch(e) { alert('Error: ' + e.message); }
})();`.trim()
}

/**
 * Diagnostic: scan localStorage and cookies for any Framia/Auth0 tokens.
 */
export function diagnoseFramiaTokens(): void {
  console.log('=== Framia Token Diagnostic ===');

  // Check Auth0 keys in localStorage
  for (var i = 0; i < localStorage.length; i++) {
    var key = localStorage.key(i) || '';
    if (key.indexOf('@@auth0spajs@@') === 0 || key.indexOf('auth0') !== -1) {
      try {
        var raw = localStorage.getItem(key) || '';
        var parsed = JSON.parse(raw);
        var body = parsed.body || parsed;
        console.log('Auth0 key:', key.slice(0, 60));
        console.log('  access_token:', body.access_token ? body.access_token.slice(0, 50) + '...' : 'NONE');
        console.log('  id_token:', body.id_token ? body.id_token.slice(0, 50) + '...' : 'NONE');
        console.log('  expires_at:', body.expires_at || body.expiresAt || 'unknown');
      } catch {}
    }
  }

  // Check all localStorage for JWTs
  console.log('\n--- All localStorage keys with eyJ ---');
  for (var j = 0; j < localStorage.length; j++) {
    var k = localStorage.key(j) || '';
    var v = localStorage.getItem(k) || '';
    if (v.indexOf('eyJ') === 0 && v.indexOf('.') !== -1) {
      console.log(k.slice(0, 60) + ': ' + v.slice(0, 60) + '...');
    }
  }
}
