// ─── Refund otomatis dari Sisi Server ───────────────────────────────────────
// Sampai 15 Nov 2026, pengembalian saldo/token hanya terjadi kalau FRONTEND
// memanggil /api/<wallet>/refund. Itu menjadikan saldo member bergantung pada
// halaman "ingat" memanggilnya di tadap jalan gagal — dan gagal tutup tab / bug
// / restart artinya saldo terpotong tanpa job sama sekali.
//
// Relay tahu `usage_id` (tiket pembayaran yang dikirim klien) sehingga ia bisa
// mengembalikan saldo dengan PRESISI, tanpa mencocokkan batch_id/model. Fungsi
// di sini dipakai di titik-titik gagal yang PASTI tidak membuat job:
//   - upstream menolak sebelum job terbentuk (4xx / 503 "coba lagi"),
//   - validasi pra-job di relay gagal,
//   - RunningHub: pool token master kosong / semua kandidat gagal / exception
//     sebelum task diterima.
//
// Sengaja TIDAK dipanggil untuk 5xx/timeout ambigu — job bisa saja sudah
// terbentuk (itulah mengapa tiket pun lebih dulu dilepas di sana).
//
// Idempoten: baris `*_usage` hanya `used` sekali; refund dari klien DAN dari
// server berakhir sebagai "yang pertama menang", sisanya no-op (404 pada klien).

import db from '../db.js'

/** Hasil refund otomatis. */
export interface AutoRefundHasil {
  /** 1 bila baris usage berhasil ditandai direfund, 0 bila tidak (sudah/tidak ada). */
  refunded: number
  /** Nilai yang dikembalikan ke saldo/token member (0 untuk usage gratis/paket). */
  amount: number
}

/** Kembalikan saldo/token untuk satu usage; aman dipanggil berkali-kali. */
export function autoRefundUsage(
  usageTable: string,
  balanceTable: string,
  usageId: number | null | undefined,
): AutoRefundHasil {
  if (!usageId || !Number.isFinite(usageId)) return { refunded: 0, amount: 0 }

  const usage = db
    .prepare(`SELECT id, user_id, cost FROM ${usageTable} WHERE id = ? AND status = 'used'`)
    .get(usageId) as { id: number; user_id: number; cost: number } | undefined
  if (!usage) return { refunded: 0, amount: 0 }

  const res = db
    .prepare(`UPDATE ${usageTable} SET status = 'refunded' WHERE id = ? AND status = 'used'`)
    .run(usage.id)
  if ((res.changes ?? 0) === 0) return { refunded: 0, amount: 0 } // race: sudah direfund

  if (usage.cost > 0) {
    db.prepare(
      `UPDATE ${balanceTable} SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`,
    ).run(usage.cost, usage.user_id)
  }
  return { refunded: 1, amount: usage.cost }
}

/** Refund untuk wallet provider (Seavi/PosBot/RunningHub) lewat spek provider. */
export function autoRefundProviderUsage(
  spec: { usageTable: string; balanceTable: string },
  usageId: number | null | undefined,
): AutoRefundHasil {
  return autoRefundUsage(spec.usageTable, spec.balanceTable, usageId)
}
