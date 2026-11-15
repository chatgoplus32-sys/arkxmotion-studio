// ─── Pasangan "potongan menunggu job" untuk jalur resume ──────────────────
// Potongan saldo terjadi DI SINI (client, sebelum submit), jauh sebelum
// `jobId` job NexaBot/PosBot itu ada. Kalau tab ditutup sebelum gagal/berhasil,
// referensi potongan di halaman hilang dan saldonya hangus — padahal job bisa
// dilanjutkan lagi (resumePendingGenerationJobs memakai jobId di server).
//
// Cara kerja:
//   1. `rememberPendingCharge()` dipanggil tepat setelah /deduct berhasil —
//      menyimpan { provider, usageId, batchId, model } di localStorage.
//   2. `pairPendingCharge()` dipanggil saat jobId job itu pertama kali dipoll —
//      memindahkan entri tertua provider tsb ke kunci resume `provider:jobId`.
//   3. `refundPendingCharge()` dipanggil kalau job gagal secara TERMINAL saat
//      resume — mengembalikan saldo/token memakai usage_id/batch_id yang
//      tersimpan, tidak perlu mencocokkan model apa pun.
//
// Penyimpanan di localStorage (bukan state) supaya bertahan lintas sesi/tab.
// FIFO cukup: satu provider hanya mem-polling job secara menunggu giliran.

const PENDING_KEY = 'arkxmotion.pendingCharges'
const RESUME_KEY = 'arkxmotion.resumeCharge:'
export type ChargeProvider = 'nexabot' | 'posbot'

export interface PendingCharge {
  provider: ChargeProvider
  usageId?: number
  batchId?: string
  model?: string
  at: number
}

/** Simpan potongan yang menunggu jobId. Best-effort. */
export function rememberPendingCharge(
  provider: ChargeProvider,
  entry: Omit<PendingCharge, 'provider' | 'at'>,
): void {
  if (typeof window === 'undefined') return
  try {
    const list = bacaList()
    list.push({ provider, at: Date.now(), ...entry })
    // Jaga-jaga: batas 40 entri & buang yang berumur > 48 jam.
    const batas = Date.now() - 48 * 60 * 60 * 1000
    localStorage.setItem(PENDING_KEY, JSON.stringify(list.filter((c) => c.at > batas).slice(-40)))
  } catch {
    // localStorage penuh — abaikan; pekerjaan tetap jalan, hanya tanpa jaring pengaman ini
  }
}

/** Pasangkan entri tertua provider ini ke satu jobId. Best-effort. */
export function pairPendingCharge(provider: ChargeProvider, jobId: string): void {
  if (typeof window === 'undefined') return
  try {
    const list = bacaList()
    const idx = list.findIndex((c) => c.provider === provider)
    if (idx === -1) return
    const [hit] = list.splice(idx, 1)
    localStorage.setItem(PENDING_KEY, JSON.stringify(list))
    localStorage.setItem(RESUME_KEY + key(provider, jobId), JSON.stringify(hit))
  } catch {
    // abaikan
  }
}

/** Apakah jobId ini sudah punya pasangan potongan? */
export function hasResumeCharge(provider: ChargeProvider, jobId: string): boolean {
  if (typeof window === 'undefined') return false
  try {
    return localStorage.getItem(RESUME_KEY + key(provider, jobId)) !== null
  } catch {
    return false
  }
}

/** Ambil (dan hapus dari storage) pasangan potongan untuk job gagal-terminal. */
export function takeResumeCharge(provider: ChargeProvider, jobId: string): PendingCharge | null {
  if (typeof window === 'undefined') return null
  const k = RESUME_KEY + key(provider, jobId)
  try {
    const raw = localStorage.getItem(k)
    if (!raw) return null
    const hit = JSON.parse(raw) as PendingCharge
    localStorage.removeItem(k)
    return hit
  } catch {
    return null
  }
}

/** Hapus pasangan potongan — dipanggil saat job selesai wajar. */
export function clearResumeCharge(provider: ChargeProvider, jobId: string): void {
  if (typeof window === 'undefined') return
  try {
    localStorage.removeItem(RESUME_KEY + key(provider, jobId))
  } catch {
    // abaikan
  }
}

function key(provider: ChargeProvider, jobId: string) {
  return `${provider}:${jobId}`
}

function bacaList(): PendingCharge[] {
  try {
    const raw = localStorage.getItem(PENDING_KEY)
    if (!raw) return []
    const parsed = JSON.parse(raw)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}
