// ─── Pemanggil upstream CreatePulse (I/O) ───────────────────────────────────
// Kebijakannya murni dan teruji di shared/createpulseProxy.ts; modul ini yang
// menjalankannya. Dipakai bersama oleh jalur Express
// (server/routes/publicCreatepulse.ts) dan versi Vercel
// (api/public/createpulse.ts) supaya keduanya tidak bisa berperilaku beda.
//
// `fetchWithTimeout` disuntikkan karena tiap runtime punya salinannya sendiri
// (server/lib/fetchTimeout.ts dan versi lokal di api/public/createpulse.ts) —
// sekaligus membuat fungsi ini bisa diuji dengan fetch palsu, tanpa server.
//
// Yang dilakukan di sini, semuanya karena 502 "unknown" yang pernah muncul di
// UI saat submit Veo Omni:
//   - body upstream dibaca sebagai teks lebih dulu, jadi halaman error gateway
//     yang bukan JSON tetap ikut dilaporkan (parseUpstreamBody);
//   - status dan lamanya selalu dicatat, supaya "502 dalam 2 detik" dan
//     "timeout 30s" tidak lagi terlihat sama;
//   - hanya aksi read-only yang diulang (createpulseAttempts), karena submit
//     yang sebenarnya sudah diterima upstream tidak boleh dikirim dua kali.

import {
  CREATEPULSE_PROXY_POLICY,
  createpulseAttempts,
  createpulseProxyDelayMs,
  isCreatepulseProxyTransientStatus,
  parseUpstreamBody,
  type CreatepulseProxyAction,
} from './createpulseProxy.js'

export interface CreatepulseUpstreamResult {
  status: number
  body: Record<string, any>
  raw: string
  durationMs: number
}

export interface CreatepulseUpstreamDeps {
  fetchWithTimeout: (url: string, init?: RequestInit & { timeoutMs?: number }) => Promise<Response>
  sleep?: (ms: number) => Promise<void>
  log?: (pesan: string) => void
  warn?: (pesan: string) => void
  error?: (pesan: string) => void
}

const sleepDefault = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms))

export async function callCreatepulseUpstream(
  params: CreatepulseUpstreamDeps & {
    action: CreatepulseProxyAction
    url: string
    init?: RequestInit
  },
): Promise<CreatepulseUpstreamResult> {
  const {
    action,
    url,
    init,
    fetchWithTimeout,
    sleep = sleepDefault,
    log = console.log,
    warn = console.warn,
    error = console.error,
  } = params

  const policy = CREATEPULSE_PROXY_POLICY[action]
  const attempts = createpulseAttempts(action)
  let last: CreatepulseUpstreamResult | null = null

  for (let attempt = 1; attempt <= attempts; attempt++) {
    const startedAt = Date.now()
    let res: Response
    try {
      res = await fetchWithTimeout(url, { ...init, timeoutMs: policy.timeoutMs })
    } catch (err: any) {
      const durationMs = Date.now() - startedAt
      const pesan = err?.message || String(err)
      // Tidak ada jawaban sama sekali: permintaan ini tidak sampai ke upstream,
      // jadi aman dilaporkan sebagai 502 dengan pesan aslinya (bukan "unknown").
      error(`[createpulse] ${policy.label} gagal sebelum jawaban setelah ${durationMs}ms: ${pesan}`)
      return {
        status: 502,
        body: { ok: false, error: `createpulse.online tidak bisa dihubungi (${pesan})` },
        raw: '',
        durationMs,
      }
    }

    const raw = await res.text()
    const durationMs = Date.now() - startedAt
    const contentType = res.headers.get('content-type')
    const body = parseUpstreamBody(raw, res.status, contentType)
    log(
      `[createpulse] ${policy.label} → HTTP ${res.status} dalam ${durationMs}ms` +
      `${contentType ? ` (${contentType})` : ''}: ${raw.slice(0, 300) || '(body kosong)'}`,
    )
    last = { status: res.status, body, raw, durationMs }

    if (attempt < attempts && isCreatepulseProxyTransientStatus(res.status)) {
      const jeda = createpulseProxyDelayMs({ attempt, retryAfterHeader: res.headers.get('retry-after') })
      warn(`[createpulse] ${policy.label} HTTP ${res.status} — ulangi dalam ${jeda}ms (percobaan ${attempt + 1}/${attempts})`)
      await sleep(jeda)
      continue
    }
    break
  }

  return last as CreatepulseUpstreamResult
}
