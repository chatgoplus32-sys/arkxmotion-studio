// ─── Riverside Token Grabber ─────────────────────────────────────────────
// Riverside's dashboard/playground session token lives in the browser.
// We scan localStorage, sessionStorage, cookies and IndexedDB for any JWT
// (eyJ...), Firebase refresh token (AMf-...) or session JSON — whichever
// format the riverside.com web app uses.

export function getRiversideBookmarklet(): string {
  return `
(function() {
  try {
    var candidates = [];

    function looksLikeToken(v) {
      if (!v || typeof v !== 'string') return false;
      v = v.trim();
      if (v.indexOf('eyJ') === 0 && v.indexOf('.') !== -1) return true;   // JWT
      if (v.indexOf('AMf') === 0 && v.length > 40) return true;          // Firebase refresh
      if (v.length > 80 && v.indexOf(' ') === -1) return true;           // long opaque token
      return false;
    }

    function add(v) {
      if (looksLikeToken(v) && candidates.indexOf(v) === -1) candidates.push(v);
    }

    function unwrap(o) {
      if (!o || typeof o !== 'object') return;
      var sts = o.stsTokenManager;
      if (sts) {
        add(sts.refreshToken);   // prefer refresh (AMf-)
        add(sts.accessToken);
      }
      add(o.refresh_token);
      add(o.refreshToken);
      add(o.access_token);
      add(o.accessToken);
      add(o.idToken);
      add(o.id_token);
      add(o.token);
      if (o.current_session) unwrap(o.current_session);
    }

    // 1. localStorage + sessionStorage — semua nilai + bungkus JSON
    try {
      for (var i = 0; i < localStorage.length; i++) {
        var v = localStorage.getItem(localStorage.key(i)) || '';
        add(v);
        try { unwrap(JSON.parse(v)); } catch (e) {}
      }
    } catch (e) {}
    try {
      for (var j = 0; j < sessionStorage.length; j++) {
        var v2 = sessionStorage.getItem(sessionStorage.key(j)) || '';
        add(v2);
        try { unwrap(JSON.parse(v2)); } catch (e) {}
      }
    } catch (e) {}

    // 2. cookies — raw JWT values
    try {
      var cookies = document.cookie.split(';');
      for (var c = 0; c < cookies.length; c++) {
        var val = decodeURIComponent(cookies[c].trim().split('=').slice(1).join('='));
        add(val);
      }
    } catch (e) {}

    var done = false;
    function finish() {
      if (done) return;
      done = true;
      if (candidates.length === 0) {
        alert('Riverside session token tidak ditemukan.\n\nPastikan kamu sudah login di riverside.com/dashboard, lalu coba lagi.\n\nAlternatif: F12 → Network → klik request API → Headers → salin value header "Authorization: Bearer ...".');
        return;
      }
      // PRIORITAS: Firebase refresh (AMf-) > JWT session (eyJ-) > opaque
      var best = null;
      for (var a = 0; a < candidates.length; a++) {
        if (candidates[a].indexOf('AMf') === 0) { best = candidates[a]; break; }
      }
      if (!best) {
        for (var b = 0; b < candidates.length; b++) {
          if (candidates[b].indexOf('eyJ') === 0) { best = candidates[b]; break; }
        }
      }
      if (!best) best = candidates[0];
      navigator.clipboard.writeText(best).then(function() {
        alert('✅ Token Riverside copied! Format: ' + (best.indexOf('AMf') === 0 ? 'Firebase refresh (AMf-) — tahan lama' : best.indexOf('eyJ') === 0 ? 'JWT session (eyJ-)' : 'token') + '\n\n• ' + best.slice(0, 30) + '...\n\nPaste ke Providers → Riverside.');
      }, function() {
        prompt('Copy token ini:', best);
      });
    }

    // 3. IndexedDB firebaseLocalStorageDb (Firebase auth — sumber AMf-)
    try {
      var req = indexedDB.open('firebaseLocalStorageDb');
      req.onsuccess = function() {
        try {
          var db = req.result;
          if (!db.objectStoreNames.contains('firebaseLocalStorage')) { db.close(); finish(); return; }
          var tx = db.transaction('firebaseLocalStorage').objectStore('firebaseLocalStorage').getAll();
          tx.onsuccess = function() {
            db.close();
            var rows = tx.result || [];
            for (var r = 0; r < rows.length; r++) {
              var val2 = rows[r] && rows[r].value;
              if (val2 && typeof val2 === 'object') unwrap(val2);
            }
            finish();
          };
          tx.onerror = function() { db.close(); finish(); };
        } catch (e) { finish(); }
      };
      req.onerror = function() { finish(); };
      setTimeout(finish, 2500);
    } catch (e) { finish(); }
  } catch(e) { alert('Error: ' + e.message); }
})();`.trim()
}

// ─── Format detection ─────────────────────────────────────────────────────

export function detectRiversideTokenFormat(token: string): 'jwt' | 'firebase-refresh' | 'opaque' | 'unknown' {
  const t = (token || '').trim()
  if (/^eyJ[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+\.[A-Za-z0-9_-]+$/.test(t)) return 'jwt'
  if (/^AMf[A-Za-z0-9_-]{40,}$/.test(t)) return 'firebase-refresh'
  if (t.length >= 60 && !/\s/.test(t)) return 'opaque'
  return 'unknown'
}

// ─── Balance / Status check ────────────────────────────────────────────────
// Riverside punya session token (JWT / Firebase refresh), bukan API key
// dengan endpoint balance publik. Cek ini memvalidasi token: untuk JWT kita
// decode + cek expiry; untuk Firebase refresh kita tukar ke ID token via
// securetoken.googleapis.com (sama seperti Galleri5) lalu decode.

const RIVERSIDE_FIREBASE_KEY = 'AIzaSyBejuWIKZ7yQT9bdG_jnb4RrkW3DoFCNNo'
const RIVERSIDE_FIREBASE_TOKEN_URL = `https://securetoken.googleapis.com/v1/token?key=${RIVERSIDE_FIREBASE_KEY}`

export function decodeRiversideJwt(token: string): {
  email?: string
  sub?: string
  exp?: number
  iat?: number
  name?: string
  userId?: string
  accountId?: string
  productions?: string[]
} | null {
  try {
    const parts = token.split('.')
    if (parts.length !== 3) return null
    const payload = parts[1].replace(/-/g, '+').replace(/_/g, '/')
    const json = decodeURIComponent(
      atob(payload).split('').map((c) => '%' + ('00' + c.charCodeAt(0).toString(16)).slice(-2)).join('')
    )
    const obj = JSON.parse(json)
    return {
      email: obj.email || obj.user_email || undefined,
      sub: obj.sub || obj.user_id || undefined,
      exp: typeof obj.exp === 'number' ? obj.exp * 1000 : undefined,
      iat: typeof obj.iat === 'number' ? obj.iat * 1000 : undefined,
      name: obj.name || obj.display_name || undefined,
      userId: obj.userId || obj.user_id || obj.uid || undefined,
      accountId: obj.accountId || obj.account_id || undefined,
      productions: Array.isArray(obj.productions) ? obj.productions : undefined,
    }
  } catch {
    return null
  }
}

async function refreshRiversideFirebase(refreshToken: string): Promise<{ ok: boolean; idToken?: string; email?: string; error?: string }> {
  try {
    const res = await fetch(RIVERSIDE_FIREBASE_TOKEN_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: `grant_type=refresh_token&refresh_token=${encodeURIComponent(refreshToken)}`,
    })
    if (!res.ok) {
      const body = await res.text().catch(() => '')
      const msg = body.includes('TOKEN_EXPIRED') || body.includes('INVALID_REFRESH_TOKEN')
        ? 'Refresh token expired / tidak valid — ambil ulang dari riverside.com/dashboard'
        : `HTTP ${res.status} — token mungkin bukan Firebase Riverside, ambil token langsung dari dashboard`
      return { ok: false, error: msg }
    }
    const data = await res.json()
    const idToken = data.id_token || data.access_token
    if (!idToken) return { ok: false, error: 'Response tanpa token' }
    const payload = decodeRiversideJwt(idToken)
    return { ok: true, idToken, email: payload?.email }
  } catch (err: any) {
    return { ok: false, error: err.message }
  }
}

// ─── Real credits / balance via Riverside GraphQL ───────────────────────────
// Ditemukan dari bundle ai_playground riverside.com: playground memakai query
// GraphQL `PlaygroundCurrentAccount` ke https://riverside.com/graphql dengan
// header `Authorization: Bearer <session JWT>` yang mengembalikan
// creditBalanceV2 { total, spent, available } (dalam credits).

const RIVERSIDE_GRAPHQL_URL = 'https://riverside.com/graphql'
const RIVERSIDE_CREDITS_QUERY = `query PlaygroundCurrentAccount {
  currentAccount {
    id
    accountFeatures {
      features
    }
    creditBalanceV2 {
      total
      spent
      available
    }
  }
}`

export async function fetchRiversideCredits(
  token: string
): Promise<{ ok: boolean; total?: number; spent?: number; available?: number; accountId?: string; error?: string }> {
  try {
    const res = await fetch(RIVERSIDE_GRAPHQL_URL, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Authorization: `Bearer ${token}`,
      },
      body: JSON.stringify({ query: RIVERSIDE_CREDITS_QUERY }),
      signal: AbortSignal.timeout(20000),
    })
    if (!res.ok) {
      return { ok: false, error: `HTTP ${res.status}` }
    }
    const data = await res.json().catch(() => null)
    if (!data || data.errors?.length) {
      const first = data?.errors?.[0]
      const nested = first?.extensions?.errors?.[0]?.message || first?.extensions?.errors?.[0]?.extensions?.code
      return { ok: false, error: nested || first?.message || 'GraphQL error' }
    }
    const acct = data?.data?.currentAccount
    const cb = acct?.creditBalanceV2
    if (!acct || !cb) {
      return { ok: false, error: 'Account tidak punya data creditBalanceV2' }
    }
    return { ok: true, total: cb.total, spent: cb.spent, available: cb.available, accountId: acct.id }
  } catch (err: any) {
    return { ok: false, error: err.message || 'network error' }
  }
}

// ─── Real generation via Riverside GraphQL (playground) ─────────────────────
// Reverse-engineered from riverside.com ai_playground MFE bundle:
//   mutation Generate($input: GenerateInput!) → generation { id status }
//   mutation CreateMedia + PUT uploadUrl + FinalizeUpload → reference mediaId
//   query Generations(filter:{productionId}) → poll status until COMPLETED,
//   result URL ada di node.metadata.previewUrl / thumbnailUrl.

const RIVERSIDE_GENERATE_MUTATION = `mutation Generate($input: GenerateInput!) {
  generate(input: $input) {
    generation {
      id
      status
    }
    errors {
      code
      field
      message
    }
  }
}`

const RIVERSIDE_CREATE_MEDIA_MUTATION = `mutation CreateMedia($input: CreateMediaInput!) {
  createMedia(input: $input) {
    media {
      id
    }
    uploadUrl
  }
}`

const RIVERSIDE_FINALIZE_UPLOAD_MUTATION = `mutation FinalizeUpload($mediaId: ID!) {
  finalizeUpload(mediaId: $mediaId) {
    id
  }
}`

const RIVERSIDE_GENERATIONS_QUERY = `query Generations($filter: GenerationFilterInput, $sort: GenerationSortInput, $page: GenerationPaginationInput) {
  generations(filter: $filter, sort: $sort, paginationParams: $page) {
    edges {
      node {
        id
        status
        metadata
        media {
          id
        }
      }
    }
  }
}`

async function riversideGraphql<T = any>(
  token: string,
  query: string,
  variables: Record<string, any>
): Promise<T> {
  const res = await fetch(RIVERSIDE_GRAPHQL_URL, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json',
      Authorization: `Bearer ${token}`,
    },
    body: JSON.stringify({ query, variables }),
    signal: AbortSignal.timeout(30000),
  })
  const data = await res.json().catch(() => null)
  if (!data || data.errors?.length) {
    const first = data?.errors?.[0]
    const nested = first?.extensions?.errors?.[0]
    const msg = nested?.message || first?.message || `HTTP ${res.status}`
    throw new Error(msg)
  }
  return data as T
}

/** Upload satu file referensi (image) ke Riverside, balikin mediaId. */
async function uploadRiversideReference(
  token: string,
  file: File,
  ctx: { productionId: string; accountId: string; uploadedBy: string }
): Promise<string> {
  const created = await riversideGraphql<{
    data: { createMedia: { media: { id: string }; uploadUrl: string } }
  }>(token, RIVERSIDE_CREATE_MEDIA_MUTATION, {
    input: {
      name: file.name || 'reference.png',
      type: 'image',
      categories: ['aiReference'],
      productionId: ctx.productionId,
      accountId: ctx.accountId,
      uploadedBy: ctx.uploadedBy,
      mimeType: file.type || 'image/png',
    },
  })
  const { media, uploadUrl } = created.data.createMedia
  if (!media?.id || !uploadUrl) throw new Error('CreateMedia gagal: tidak ada uploadUrl')

  const put = await fetch(uploadUrl, {
    method: 'PUT',
    body: file,
    headers: { 'Content-Type': file.type || 'image/png' },
    signal: AbortSignal.timeout(60000),
  })
  if (!put.ok) throw new Error(`Upload media gagal: HTTP ${put.status}`)

  await riversideGraphql(token, RIVERSIDE_FINALIZE_UPLOAD_MUTATION, { mediaId: media.id })
  return media.id
}

function toRiversideRatio(ratio?: string): string | undefined {
  const r = (ratio || '').toUpperCase()
  if (!r) return undefined
  if (r === '16:9' || r === 'RATIO_16_9') return 'RATIO_16_9'
  if (r === '9:16' || r === 'RATIO_9_16') return 'RATIO_9_16'
  if (r === '1:1' || r === 'RATIO_1_1') return 'RATIO_1_1'
  return undefined
}

function toRiversideResolution(res?: string): string | undefined {
  const r = (res || '').toLowerCase()
  if (!r) return undefined
  if (r === '4k' || r === '2160p' || r === 'res_4k') return 'RES_4K'
  if (r === '1080p' || r === 'res_1080p') return 'RES_1080P'
  if (r === '720p' || r === 'res_720p') return 'RES_720P'
  if (r === '480p' || r === 'res_480p') return 'RES_480P'
  if (r === '2k' || r === 'res_2k') return 'RES_2K'
  return undefined
}

export interface RiversideGenerateInput {
  token: string
  modelId: string
  prompt: string
  aspectRatio?: string
  resolution?: string
  durationSeconds?: number
  generateAudio?: boolean
  imageFile?: File | null
  onLog?: (msg: string, level?: string) => void
}

/**
 * Generate video via Riverside playground GraphQL:
 * 1) upload image referensi (kalau ada) → mediaId
 * 2) mutation Generate
 * 3) poll Generations sampai COMPLETED → return URL video (metadata.previewUrl)
 */
export async function generateRiversideVideo(
  input: RiversideGenerateInput
): Promise<{ ok: boolean; videoUrl?: string; generationId?: string; error?: string }> {
  const log = (msg: string, level = 'info') => input.onLog?.(msg, level)
  let token = input.token.trim()

  // AMf-… (Firebase refresh) — tukar dulu ke session JWT via securetoken
  if (token.startsWith('AMf')) {
    log('🔄 Firebase refresh token (AMf-) — menukar ke session JWT...', 'info')
    const ex = await refreshRiversideFirebase(token)
    if (!ex.ok || !ex.idToken) {
      return { ok: false, error: ex.error || 'Gagal menukar Firebase refresh token ke JWT' }
    }
    token = ex.idToken
    log('✅ Firebase refresh diterima — session JWT siap ✓', 'success')
  }

  // Cek apakah token mendekati expired — kalau ya, coba ambil yang baru dari antrian sync
  if (isRiversideJwtNearExpiry(token, 2 * 60 * 1000)) {
    log('⚠️ Token mendekati expired — menunggu token baru dari auto-sync...', 'info')
    try {
      const { pollSyncQueueImmediate } = await import('@/lib/tokenAutoSync')
      // Tunggu max 15 detik untuk token baru
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const fresh = await pollSyncQueueImmediate('riverside')
        if (fresh && fresh !== token) {
          token = fresh
          log('✅ Token baru diterima dari auto-sync ✓', 'success')
          break
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch {
      // Lanjut dengan token lama — mungkin masih bisa dipakai
    }
  }

  const payload = decodeRiversideJwt(token)
  const productionId = (payload as any)?.productions?.[0]
  const accountId = (payload as any)?.accountId
  const uploadedBy = (payload as any)?.userId || payload?.sub
  if (!productionId || !accountId) {
    return { ok: false, error: 'JWT Riverside tidak memuat productionId/accountId — grab ulang token dari dashboard' }
  }

  try {
    // 1) Upload referensi gambar
    let references: Array<{ type: string; mediaId: string }> | undefined
    if (input.imageFile) {
      log('🖼️ Uploading image reference ke Riverside...', 'info')
      const mediaId = await uploadRiversideReference(token, input.imageFile, {
        productionId,
        accountId,
        uploadedBy: uploadedBy || accountId,
      })
      references = [{ type: 'MEDIA', mediaId }]
      log('✅ Image reference uploaded ✓', 'success')
    }

    // 2) Generate
    const genInput: Record<string, any> = {
      outputType: 'VIDEO',
      prompt: input.prompt,
      productionId,
      modelId: input.modelId,
    }
    const ratio = toRiversideRatio(input.aspectRatio)
    const resolution = toRiversideResolution(input.resolution)
    if (ratio) genInput.aspectRatio = ratio
    if (resolution) genInput.resolution = resolution
    if (typeof input.durationSeconds === 'number' && input.durationSeconds > 0) {
      genInput.durationSeconds = input.durationSeconds
    }
    if (input.generateAudio) genInput.generateAudio = true
    if (references?.length) genInput.references = references

    log(`🚀 Generate mutation (model=${input.modelId})...`, 'info')
    const gen = await riversideGraphql<{
      data: { generate: { generation: { id: string; status: string } | null; errors: Array<{ code?: string; message: string }> } }
    }>(token, RIVERSIDE_GENERATE_MUTATION, { input: genInput })

    const genErrors = gen.data.generate.errors
    if (genErrors?.length) {
      return { ok: false, error: genErrors.map((e) => e.message).join('; ') || 'Generate ditolak' }
    }
    const generation = gen.data.generate.generation
    if (!generation?.id) return { ok: false, error: 'Generate tidak mengembalikan generation id' }
    log(`✅ Generation created ✓ id=${generation.id.slice(0, 18)}...`, 'success')

    // 3) Poll sampai COMPLETED
    const deadline = Date.now() + 10 * 60 * 1000 // max 10 menit
    while (Date.now() < deadline) {
      const list = await riversideGraphql<{
        data: {
          generations: {
            edges: Array<{ node: { id: string; status: string; metadata: any } }>
          }
        }
      }>(token, RIVERSIDE_GENERATIONS_QUERY, {
        filter: { productionId },
        sort: { field: 'createdAt', direction: 'DESC' },
        page: { limit: 10, offset: 0 },
      })
      const node = list.data.generations.edges.find((e) => e.node.id === generation.id)?.node
      if (!node) {
        await new Promise((r) => setTimeout(r, 5000))
        continue
      }
      if (node.status === 'COMPLETED') {
        const meta = node.metadata || {}
        const url = meta.previewUrl || meta.thumbnailUrl || meta.url
        if (url) return { ok: true, videoUrl: url, generationId: generation.id }
        return { ok: false, error: 'Generation COMPLETED tapi URL hasil tidak ditemukan', generationId: generation.id }
      }
      if (node.status === 'FAILED') {
        return { ok: false, error: 'Generation gagal di Riverside', generationId: generation.id }
      }
      log(`⏳ Status: ${node.status} — menunggu...`, 'debug')
      await new Promise((r) => setTimeout(r, 5000))
    }
    return { ok: false, error: 'Timeout menunggu hasil (10 menit)', generationId: generation.id }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Riverside generation error' }
  }
}

// ─── Image Editing via Riverside GraphQL ────────────────────────────────────
// Sama seperti generate video, tapi outputType='IMAGE' (bukan VIDEO).
// Model image editing: flux-1.1-pro, imagen-4, seedream-4.0, gemini-2.5-flash-image

export interface RiversideImageEditInput {
  token: string
  modelId: string
  prompt: string
  imageFile: File
  onLog?: (msg: string, level?: string) => void
}

/**
 * Edit image via Riverside playground GraphQL:
 * 1) upload image → mediaId
 * 2) mutation Generate with outputType=IMAGE
 * 3) poll sampai COMPLETED → return URL hasil edit
 */
export async function generateRiversideImage(
  input: RiversideImageEditInput
): Promise<{ ok: boolean; imageUrl?: string; generationId?: string; error?: string }> {
  const log = (msg: string, level = 'info') => input.onLog?.(msg, level)
  let token = input.token.trim()

  // AMf-… (Firebase refresh) — tukar dulu ke session JWT via securetoken
  if (token.startsWith('AMf')) {
    log('🔄 Firebase refresh token (AMf-) — menukar ke session JWT...', 'info')
    const ex = await refreshRiversideFirebase(token)
    if (!ex.ok || !ex.idToken) {
      return { ok: false, error: ex.error || 'Gagal menukar Firebase refresh token ke JWT' }
    }
    token = ex.idToken
    log('✅ Firebase refresh diterima — session JWT siap ✓', 'success')
  }

  // Cek apakah token mendekati expired — kalau ya, coba ambil yang baru dari antrian sync
  if (isRiversideJwtNearExpiry(token, 2 * 60 * 1000)) {
    log('⚠️ Token mendekati expired — menunggu token baru dari auto-sync...', 'info')
    try {
      const { pollSyncQueueImmediate } = await import('@/lib/tokenAutoSync')
      const deadline = Date.now() + 15000
      while (Date.now() < deadline) {
        const fresh = await pollSyncQueueImmediate('riverside')
        if (fresh && fresh !== token) {
          token = fresh
          log('✅ Token baru diterima dari auto-sync ✓', 'success')
          break
        }
        await new Promise((r) => setTimeout(r, 2000))
      }
    } catch {
      // Lanjut dengan token lama
    }
  }

  const payload = decodeRiversideJwt(token)
  const productionId = (payload as any)?.productions?.[0]
  const accountId = (payload as any)?.accountId
  const uploadedBy = (payload as any)?.userId || payload?.sub
  if (!productionId || !accountId) {
    return { ok: false, error: 'JWT Riverside tidak memuat productionId/accountId — grab ulang token dari dashboard' }
  }

  try {
    // 1) Upload gambar yang akan diedit
    log('🖼️ Uploading image ke Riverside...', 'info')
    const mediaId = await uploadRiversideReference(token, input.imageFile, {
      productionId,
      accountId,
      uploadedBy: uploadedBy || accountId,
    })
    const references = [{ type: 'MEDIA', mediaId }]
    log('✅ Image uploaded ✓', 'success')

    // 2) Generate dengan outputType=IMAGE
    const genInput: Record<string, any> = {
      outputType: 'IMAGE',
      prompt: input.prompt,
      productionId,
      modelId: input.modelId,
      references,
    }

    log(`🚀 Generate image (model=${input.modelId})...`, 'info')
    const gen = await riversideGraphql<{
      data: { generate: { generation: { id: string; status: string } | null; errors: Array<{ code?: string; message: string }> } }
    }>(token, RIVERSIDE_GENERATE_MUTATION, { input: genInput })

    const genErrors = gen.data.generate.errors
    if (genErrors?.length) {
      return { ok: false, error: genErrors.map((e) => e.message).join('; ') || 'Generate ditolak' }
    }
    const generation = gen.data.generate.generation
    if (!generation?.id) return { ok: false, error: 'Generate tidak mengembalikan generation id' }
    log(`✅ Generation created ✓ id=${generation.id.slice(0, 18)}...`, 'success')

    // 3) Poll sampai COMPLETED
    const deadline = Date.now() + 5 * 60 * 1000 // max 5 menit untuk image
    while (Date.now() < deadline) {
      const list = await riversideGraphql<{
        data: {
          generations: {
            edges: Array<{ node: { id: string; status: string; metadata: any } }>
          }
        }
      }>(token, RIVERSIDE_GENERATIONS_QUERY, {
        filter: { productionId },
        sort: { field: 'createdAt', direction: 'DESC' },
        page: { limit: 10, offset: 0 },
      })
      const node = list.data.generations.edges.find((e) => e.node.id === generation.id)?.node
      if (!node) {
        await new Promise((r) => setTimeout(r, 3000))
        continue
      }
      if (node.status === 'COMPLETED') {
        const meta = node.metadata || {}
        const url = meta.previewUrl || meta.thumbnailUrl || meta.url
        if (url) return { ok: true, imageUrl: url, generationId: generation.id }
        return { ok: false, error: 'Generation COMPLETED tapi URL hasil tidak ditemukan', generationId: generation.id }
      }
      if (node.status === 'FAILED') {
        return { ok: false, error: 'Image editing gagal di Riverside', generationId: generation.id }
      }
      log(`⏳ Status: ${node.status} — menunggu...`, 'debug')
      await new Promise((r) => setTimeout(r, 3000))
    }
    return { ok: false, error: 'Timeout menunggu hasil image edit (5 menit)', generationId: generation.id }
  } catch (err: any) {
    return { ok: false, error: err.message || 'Riverside image edit error' }
  }
}

// ─── Auto-refresh JWT session ──────────────────────────────────────────────
// Riverside session JWT (eyJ…) umumnya berumur ±1 jam. Saat mendekati expired,
// kita coba tukar refresh token (kalau tersimpan) ke access token baru lewat
// endpoint session riverside.com. Kalau gagal, key ditandai expired & user
// diarahkan ambil ulang dari dashboard (atau extension auto-capture).

const RIVERSIDE_REFRESH_ENDPOINTS = [
  'https://riverside.com/api/auth/session/refresh',
  'https://riverside.com/api/auth/refresh',
  'https://api.riverside.com/v1/auth/session/refresh',
]

export function getRiversideJwtExpiry(token: string): number | null {
  const payload = decodeRiversideJwt(token)
  return payload?.exp ?? null
}

export function isRiversideJwtNearExpiry(token: string, windowMs = 5 * 60 * 1000): boolean {
  const exp = getRiversideJwtExpiry(token)
  if (!exp) return false
  return Date.now() > exp - windowMs
}

export async function refreshRiversideJwt(
  token: string,
  refreshToken?: string
): Promise<{ ok: boolean; token?: string; email?: string; error?: string }> {
  if (!refreshToken) {
    return { ok: false, error: 'Tidak ada refresh token — grab ulang dari dashboard atau extension' }
  }

  let lastErr = ''
  for (const url of RIVERSIDE_REFRESH_ENDPOINTS) {
    try {
      const res = await fetch(url, {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          ...(token ? { Authorization: `Bearer ${token}` } : {}),
        },
        body: JSON.stringify({ refresh_token: refreshToken, refreshToken }),
        signal: AbortSignal.timeout(15000),
      })
      if (!res.ok) {
        lastErr = `HTTP ${res.status} (${url.replace('https://riverside.com', '')})`
        continue
      }
      const data = await res.json().catch(() => ({}))
      const newToken = data.access_token || data.accessToken || data.token || data.session?.access_token
      if (newToken) {
        return { ok: true, token: newToken, email: data.email || data.user?.email }
      }
      lastErr = `Respons tanpa token baru (${url})`
    } catch (err: any) {
      lastErr = err.message || 'network error'
    }
  }
  return { ok: false, error: lastErr || 'Semua endpoint refresh gagal' }
}

export async function checkRiversideBalance(
  key: string
): Promise<{ ok: boolean; state: 'active' | 'empty' | 'invalid' | 'failed'; balance: number | null; email?: string; detail?: string; error?: string }> {
  const token = (key || '').trim()
  const format = detectRiversideTokenFormat(token)

  if (format === 'firebase-refresh') {
    // Tukar refresh token → ID token untuk validasi + ambil email
    const res = await refreshRiversideFirebase(token)
    if (res.ok && res.idToken) {
      const payload = decodeRiversideJwt(res.idToken)
      const email = res.email || payload?.email
      // Coba ambil saldo kredit sungguhan lewat GraphQL
      const credits = await fetchRiversideCredits(res.idToken)
      if (credits.ok && credits.available !== undefined) {
        return {
          ok: true,
          state: 'active',
          balance: credits.available,
          email,
          detail: `${email || 'Akun Riverside'} · Credits: ${credits.available} (dipakai ${credits.spent ?? 0} dari ${credits.total ?? credits.available + (credits.spent ?? 0)}) · Firebase refresh (AMf-) — tahan lama`,
        }
      }
      return {
        ok: true,
        state: 'active',
        balance: null,
        email,
        detail: `${email || 'Akun Riverside'} · Firebase refresh (AMf-) — tahan lama, auto-refresh tiap ~1 jam${credits.ok ? '' : ` · balance: ${credits.error || 'gagal diambil'}`}`,
      }
    }
    return {
      ok: false,
      state: 'invalid',
      balance: null,
      error: res.error || 'Refresh token tidak valid',
    }
  }

  if (format === 'jwt') {
    const payload = decodeRiversideJwt(token)
    if (!payload) {
      return { ok: false, state: 'invalid', balance: null, error: 'Token JWT tidak bisa di-decode' }
    }
    const now = Date.now()
    const expired = payload.exp ? now > payload.exp : false
    if (expired) {
      return {
        ok: false,
        state: 'invalid',
        balance: null,
        email: payload.email,
        error: `Token JWT expired (${new Date(payload.exp!).toLocaleString()}) — ambil ulang dari riverside.com/dashboard`,
      }
    }
    const expLabel = payload.exp
      ? `expired ${new Date(payload.exp).toLocaleString()}`
      : 'masa berlaku tidak diketahui'
    const lifetimeLabel = payload.exp && payload.iat
      ? `${Math.round((payload.exp - payload.iat) / 60000)} menit`
      : null
    // Coba ambil saldo kredit sungguhan lewat GraphQL
    const credits = await fetchRiversideCredits(token)
    if (credits.ok && credits.available !== undefined) {
      return {
        ok: true,
        state: 'active',
        balance: credits.available,
        email: payload.email,
        detail: `${payload.email || 'Akun Riverside'} · Credits: ${credits.available} (dipakai ${credits.spent ?? 0} dari ${credits.total ?? credits.available + (credits.spent ?? 0)}) · ${expLabel}${lifetimeLabel ? ` · umur token ${lifetimeLabel}` : ''}`,
      }
    }
    return {
      ok: true,
      state: 'active',
      balance: null,
      email: payload.email,
      detail: `${payload.email || 'Akun Riverside'} · JWT session (±10 menit by design) · ${expLabel}${lifetimeLabel ? ` · umur token ${lifetimeLabel}` : ''} — ${credits.error ? `balance gagal diambil (${credits.error})` : 'grab ulang dari dashboard atau pakai extension keep-alive'}`,
    }
  }

  if (format === 'opaque') {
    const credits = await fetchRiversideCredits(token)
    if (credits.ok && credits.available !== undefined) {
      return {
        ok: true,
        state: 'active',
        balance: credits.available,
        detail: `Credits: ${credits.available} (dipakai ${credits.spent ?? 0} dari ${credits.total ?? credits.available + (credits.spent ?? 0)}) · token session Riverside`,
      }
    }
    return {
      ok: true,
      state: 'active',
      balance: null,
      detail: 'Token panjang terdeteksi — valid secara format, tapi tidak bisa dicek balance dari sini (Riverside tidak punya endpoint balance publik)',
    }
  }

  return {
    ok: false,
    state: 'invalid',
    balance: null,
    error: 'Format token tidak dikenal. Harus eyJ… (JWT) atau AMf-… (Firebase refresh) dari riverside.com/dashboard.',
  }
}