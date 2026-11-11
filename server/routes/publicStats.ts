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

export function buildPublicStats() {
  const hitung = (sql: string): number => {
    try {
      const row = db.prepare(sql).get() as { c: number } | undefined
      return Number(row?.c ?? 0)
    } catch {
      return 0
    }
  }

  // Halaman yang paling sering dipakai — agregat tanpa data pribadi (nama
  // user tidak pernah dikirim), dipakai landing sebagai social proof yang
  // bisa diverifikasi.
  let topPages: { page: string; count: number }[] = []
  try {
    topPages = (
      db
        .prepare(
          "SELECT page, COUNT(*) AS c FROM generation_logs WHERE status IN ('completed','success','done') GROUP BY page ORDER BY c DESC LIMIT 3",
        )
        .all() as { page: string; c: number }[]
    ).map(r => ({ page: r.page, count: Number(r.c) }))
  } catch {
    topPages = []
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
    // Kreator yang benar-benar pernah generate (distinct), bukan sekadar
    // daftar akun — angka ini yang dipakai "kreator aktif".
    active_users: hitung('SELECT COUNT(DISTINCT user_id) AS c FROM generation_logs'),
    // Jumlah provider sengaja TIDAK di sini: daftarnya hidup di client
    // (PROVIDER_CONFIGS) dan berubah tiap ada provider baru — server
    // tidak punya akses ke file itu, jadi angka di server pasti basi.
    top_pages: topPages,
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
