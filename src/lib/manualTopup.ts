// Cermin konstanta shared/pricing.ts untuk klien. Server tetap memvalidasi
// ulang; angka di sini hanya untuk tampilan dan validasi awal form.
export const MANUAL_TOPUP_MIN = 10000
export const MANUAL_TOPUP_MAX = 5000000
export const MANUAL_TOPUP_NOMINALS = [25000, 50000, 100000, 250000] as const

export interface ManualTopupRequest {
  id: number
  user_id: number
  provider: string
  amount: number
  note: string
  status: 'pending' | 'approved' | 'rejected'
  admin_note: string
  created_at: string
  updated_at: string
  /** Ada pada respons admin (join users). */
  user_name?: string
  email?: string
}

/** Provider tanpa dompet sendiri; top-up-nya diproses admin secara manual. */
export const MANUAL_PROVIDERS = [
  { key: 'roboneo', label: 'Roboneo' },
  { key: 'weavy', label: 'Weavy' },
  { key: 'framia', label: 'Framia' },
  { key: 'runninghub', label: 'RunningHub' },
  { key: 'galleri5', label: 'G5 AI Studio' },
  { key: 'leonardo', label: 'Leonardo.ai' },
  { key: 'oneover', label: 'OneOver' },
  { key: 'firefly', label: 'Adobe Firefly' },
  { key: 'genspark', label: 'Genspark AI' },
  { key: 'brain', label: 'Brain (Gemini)' },
  { key: 'wavespeed', label: 'Wavespeed' },
] as const

export function manualProviderLabel(key: string): string {
  return MANUAL_PROVIDERS.find((p) => p.key === key)?.label || key
}
