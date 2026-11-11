// ─── Statistik publik (read-only) ───────────────────────────────────────────
// Dipakai landing page untuk menampilkan angka yang benar-benar terjadi.
//
// Sebelumnya landing menulis "2.400+ kreator · 48k video ter-generate" sebagai
// teks statis. Angka itu tidak pernah berasal dari data: di produksi sebenarnya
// ada 17 user terdaftar dan 1.872 baris generation_logs (1.272 selesai).
// Klaim seperti itu melanggar kebijakan iklan Meta/Google (false claim) dan
// langsung mengikis kredibilitas begitu user pertama mengeceknya.
//
// Endpoint ini mengembalikan angka real-time dari DB supaya klaim di landing
// selalu benar dan tidak perlu diupdate manual tiap kali trafik naik.
import { Router, Response } from 'express'
import db from '../db.js'

const router = Router()

/** Jumlah provider yang terhubung di app (daftar di src/stores/providerManager.ts). */
const PROVIDER_COUNT = 20

export function buildPublicStats() {
  const hitung = (sql: string): number => {
    try {
      const row = db.prepare(sql).get() as { c: number } | undefined
      return Number(row?.c ?? 0)
    } catch {
      return 0
    }
  }

  return {
    ok: true,
    updated_at: new Date().toISOString(),
    users: hitung('SELECT COUNT(*) AS c FROM users'),
    // Hanya generate yang benar-benar selesai — angka "video dibuat" harus
    // menghitung yang sukses, bukan semua attempt (termasuk failed/pending).
    videos: hitung(
      "SELECT COUNT(*) AS c FROM generation_logs WHERE status IN ('completed','success','done')",
    ),
    providers: PROVIDER_COUNT,
  }
}

router.get('/', (_req, res: Response) => {
  try {
    // Angka ini berubah tiap menit — cache singkat cukup, tidak perlu realtime.
    res.setHeader('Cache-Control', 'public, max-age=60, s-maxage=300')
    res.json(buildPublicStats())
  } catch (error) {
    console.error('Public stats error:', error)
    res.status(500).json({ error: 'Internal server error' })
  }
})

export default router
