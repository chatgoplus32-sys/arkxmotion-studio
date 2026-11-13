/**
 * QRIS manual + verifikasi otomatis lewat email notifikasi bank/e-wallet.
 *
 * QRIS statis tidak punya API, jadi identitas pembayaran dipindahkan ke
 * NOMINAL: tiap pengajuan top-up diberi kode unik 3 digit (Rp 50.000 →
 * Rp 50.137). Parser email (paymentEmailWatcher) mengekstrak nominal masuk,
 * lalu `matchIncomingAmount` mencocokkannya ke baris pending lewat
 * `amount_total` — approve/kredit saldo berjalan tanpa campur tangan admin.
 *
 * Dua mode per tabel:
 *  - 'credit' : saldo member dikredit otomatis (wallet CreatePulse/NexaBot/
 *               Seavi/PosBot) — pembayaran = saldo masuk, selesai.
 *  - 'manual' : pembayaran ditandai LUNAS tapi status tetap pending, karena
 *               tindakan admin berikutnya (menyerahkan kunci provider,
 *               aktivasi paket Unlimited) tidak bisa digantikan parser.
 */
import db from '../db.js'
import { alertInfo } from './alerts.js'

// ── Registry tabel top-up yang bisa diverifikasi ──────────────────────────
interface QrisTable {
  table: string
  label: string
  mode: 'credit' | 'manual'
  balanceTable?: string
  /** Kolom baris top-up yang dikredit ke saldo ('amount' Rp / 'tokens'). */
  creditColumn?: 'amount' | 'tokens'
  /** Syarat SQL tambahan untuk mode credit (mis. kind = 'balance'). */
  creditWhere?: string
}

export const QRIS_TABLES: QrisTable[] = [
  { table: 'provider_topup_request', label: 'Top-up Manual Provider', mode: 'manual' },
  { table: 'createpulse_topup', label: 'Top-up CreatePulse', mode: 'credit', balanceTable: 'createpulse_balance', creditColumn: 'amount' },
  // Paket Unlimited = aktivasi masa berlaku oleh admin → manual. Hanya top-up
  // saldo (kind='balance') yang boleh dikredit sendiri.
  { table: 'nexabot_topup', label: 'Top-up NexaBot', mode: 'credit', balanceTable: 'nexabot_balance', creditColumn: 'amount', creditWhere: "kind = 'balance'" },
  { table: 'seavi_topup', label: 'Top-up Seavi', mode: 'credit', balanceTable: 'seavi_balance', creditColumn: 'tokens' },
  { table: 'posbot_topup', label: 'Top-up PosBot', mode: 'credit', balanceTable: 'posbot_balance', creditColumn: 'amount' },
]

/** Baris pending hanya dicocokkan selama jendela ini sejak diajukan. */
const MATCH_WINDOW_HOURS = 24

// ── Kode unik ─────────────────────────────────────────────────────────────
/**
 * Kode unik 3 digit yang membuat `amount_total` belum dipakai baris pending
 * lain di tabel yang sama — dua user dengan nominal sama tidak boleh saling
 * berebut satu email notifikasi.
 */
export function nextUniqueCode(amount: number): { unique_code: number; amount_total: number } {
  // better-sqlite3 tidak menerima placeholder untuk nama tabel, jadi nama
  // tabel hanya boleh datang dari QRIS_TABLES (daftar putih di atas).
  // Collision dicek ke SELURUH tabel supaya dua pengajuan beda-provider
  // tidak pernah berbagi satu nominal (pemenang pertama yang dicocokkan).
  const q = () =>
    QRIS_TABLES.map((t) => `SELECT 1 FROM ${t.table} WHERE amount_total = ? AND status = 'pending' LIMIT 1`)

  const stmts = q().map((sql) => db.prepare(sql))
  const isTaken = (total: number) => stmts.some((s) => s.get(total))
  const seen = new Set<number>()
  for (let i = 0; i < 900; i++) {
    const code = 100 + Math.floor(Math.random() * 900)
    if (seen.has(code)) continue
    seen.add(code)
    const total = amount + code
    if (!isTaken(total)) return { unique_code: code, amount_total: total }
  }
  // Jalur darurat: telusuri seluruh rentang sampai ketemu yang bebas.
  for (let code = 100; code <= 999; code++) {
    const total = amount + code
    if (!isTaken(total)) return { unique_code: code, amount_total: total }
  }
  // Nyaris mustahil terjadi; tetap kembalikan kode supaya alur tidak putus.
  return { unique_code: 100, amount_total: amount + 100 }
}

// ── Log audit ─────────────────────────────────────────────────────────────
export function logPaymentVerify(entry: {
  source?: string
  refTable?: string
  refId?: number | null
  amount?: number
  action: string
  emailFrom?: string
  emailSubject?: string
  detail?: string
}): void {
  try {
    db.prepare(
      `INSERT INTO payment_verify_log (source, ref_table, ref_id, amount, action, email_from, email_subject, detail)
       VALUES (?, ?, ?, ?, ?, ?, ?, ?)`,
    ).run(
      entry.source || 'email',
      entry.refTable || '',
      entry.refId ?? null,
      Math.round(entry.amount || 0),
      entry.action,
      (entry.emailFrom || '').slice(0, 200),
      (entry.emailSubject || '').slice(0, 300),
      (entry.detail || '').slice(0, 500),
    )
  } catch (e) {
    console.warn('[qris] Gagal menulis payment_verify_log:', e)
  }
}

// ── Notifikasi (in-app bell) + alert webhook ──────────────────────────────
function insertNotification(title: string, message: string, type: 'info' | 'success' | 'warning', target: 'users' | 'admins', userId: number | null): void {
  try {
    db.prepare('INSERT INTO notifications (title, message, type, target, user_id) VALUES (?, ?, ?, ?, ?)').run(
      title, message, type, target, userId,
    )
  } catch (e) {
    console.warn('[qris] Gagal menulis notifikasi:', e)
  }
}

// ── Pencocokan & approve ──────────────────────────────────────────────────
interface PendingRow {
  id: number
  user_id: number
  amount: number
  amount_total: number | null
  [key: string]: any
}

/**
 * Cocokkan nominal masuk ke baris pending. Mengembalikan ringkasan hasil
 * untuk log; kalau cocok, baris langsung diproses (kredit atau tanda lunas).
 */
export function matchIncomingAmount(
  amount: number,
  ref: { from?: string; subject?: string; source?: 'email' | 'android' } = {},
): { action: string; table?: string; id?: number; detail: string } {
  if (!Number.isFinite(amount) || amount <= 0) return { action: 'skip_invalid', detail: 'Nominal tidak valid' }

  // Kandidat terlama dulu supaya dua pembayaran bernilai sama tidak saling
  // menyalip. Jendela 24 jam: email lama tidak boleh meng-approve baris baru.
  for (const t of QRIS_TABLES) {
    const where = [
      'amount_total = ?',
      "status = 'pending'",
      "created_at >= datetime('now', ?)",
      t.creditWhere || '',
    ].filter(Boolean).join(' AND ')
    const row = db
      .prepare(`SELECT * FROM ${t.table} WHERE ${where} ORDER BY created_at ASC LIMIT 1`)
      .get(amount, `-${MATCH_WINDOW_HOURS} hours`) as PendingRow | undefined
    if (!row) continue

    if (t.mode === 'credit') return approveCredit(t, row, amount, ref)
    return markPaidManual(t, row, amount, ref)
  }

  logPaymentVerify({
    source: ref.source || 'email',
    amount,
    action: 'no_match',
    emailFrom: ref.from,
    emailSubject: ref.subject,
    detail: `Tidak ada baris pending dengan amount_total ${amount} (jendela ${MATCH_WINDOW_HOURS} jam)`,
  })
  return { action: 'no_match', detail: `Tidak ada baris pending untuk ${amount}` }
}

/** Bayar = saldo masuk: tandai lunas + kredit saldo + beri tahu user & admin. */
function approveCredit(t: QrisTable, row: PendingRow, paid: number, ref: { from?: string; subject?: string; source?: 'email' | 'android' }): { action: string; table: string; id: number; detail: string } {
  // Kredit yang diterima = apa yang benar-benar masuk (termasuk kode unik).
  const credit = paid
  db.transaction(() => {
    db.prepare(
      `UPDATE ${t.table}
          SET status = 'approved', paid_amount = ?, paid_at = CURRENT_TIMESTAMP,
              pay_ref = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
        WHERE id = ? AND status = 'pending'`,
    ).run(paid, (ref.subject || ref.from || '').slice(0, 300), 'Terverifikasi otomatis via email notifikasi', row.id)

    const bal = db.prepare(`SELECT balance FROM ${t.balanceTable} WHERE user_id = ?`).get(row.user_id) as { balance: number } | undefined
    if (!bal) {
      db.prepare(`INSERT INTO ${t.balanceTable} (user_id, balance) VALUES (?, ?)`).run(row.user_id, credit)
    } else {
      db.prepare(`UPDATE ${t.balanceTable} SET balance = balance + ?, updated_at = CURRENT_TIMESTAMP WHERE user_id = ?`).run(credit, row.user_id)
    }
  })()

  const unit = t.creditColumn === 'tokens' ? 'token' : 'Rupiah'
  insertNotification(
    'Pembayaran Masuk — Saldo Dikredit ✅',
    `${t.label} Rp ${paid.toLocaleString('id-ID')} terverifikasi otomatis. ${credit.toLocaleString('id-ID')} ${unit} sudah masuk ke saldo kamu.`,
    'success',
    'users',
    row.user_id,
  )
  insertNotification(
    '💰 Pembayaran QRIS Masuk (auto)',
    `${t.label} #${row.id} — Rp ${paid.toLocaleString('id-ID')} terverifikasi via email, saldo member sudah dikredit otomatis.`,
    'success',
    'admins',
    null,
  )
  alertInfo('Pembayaran QRIS masuk (auto-verified)', {
    tabel: t.table,
    id: String(row.id),
    nominal: `Rp ${paid.toLocaleString('id-ID')}`,
    user_id: String(row.user_id),
  })

  logPaymentVerify({
    source: ref.source || 'email',
    refTable: t.table,
    refId: row.id,
    amount: paid,
    action: 'auto_approved',
    emailFrom: ref.from,
    emailSubject: ref.subject,
    detail: `Saldo dikredit ${credit} ${unit}`,
  })
  return { action: 'auto_approved', table: t.table, id: row.id, detail: `Saldo dikredit ${credit} ${unit}` }
}

/**
 * Tandai LUNAS tapi tetap pending: admin masih harus menyerahkan kunci
 * provider / mengaktifkan paket. Admin di-notifikasi supaya tinggal klik.
 */
function markPaidManual(t: QrisTable, row: PendingRow, paid: number, ref: { from?: string; subject?: string; source?: 'email' | 'android' }): { action: string; table: string; id: number; detail: string } {
  db.prepare(
    `UPDATE ${t.table}
        SET paid_amount = ?, paid_at = CURRENT_TIMESTAMP, pay_ref = ?,
            admin_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  ).run(paid, (ref.subject || ref.from || '').slice(0, 300), 'Pembayaran terverifikasi via email — tinggal approve', row.id)

  insertNotification(
    'Pembayaran Diterima — Menunggu Proses Admin',
    `${t.label} Rp ${paid.toLocaleString('id-ID')} sudah kami terima dan terverifikasi. Proses selanjutnya menyusul.`,
    'info',
    'users',
    row.user_id,
  )
  insertNotification(
    '💰 Pembayaran QRIS Masuk (perlu approve)',
    `${t.label} #${row.id} — Rp ${paid.toLocaleString('id-ID')} terverifikasi via email. Tinggal klik approve.`,
    'warning',
    'admins',
    null,
  )
  alertInfo('Pembayaran QRIS masuk (perlu approve manual)', {
    tabel: t.table,
    id: String(row.id),
    nominal: `Rp ${paid.toLocaleString('id-ID')}`,
    user_id: String(row.user_id),
  })

  logPaymentVerify({
    source: ref.source || 'email',
    refTable: t.table,
    refId: row.id,
    amount: paid,
    action: 'paid_awaiting_admin',
    emailFrom: ref.from,
    emailSubject: ref.subject,
    detail: 'Pembayaran lunas, menunggu tindakan admin',
  })
  return { action: 'paid_awaiting_admin', table: t.table, id: row.id, detail: 'Lunas, menunggu approve admin' }
}

// ── Parser nominal dari teks email ────────────────────────────────────────
/**
 * Ekstrak seluruh kandidat nominal Rupiah dari teks notifikasi transfer.
 * Format yang dikenal: "Rp 50.137", "Rp50137", "50.137,00", "IDR 50,137.00",
 * "sebesar Rp50.137". Pemisah ribuan (./,) dipakai untuk menebak satuan,
 * bukan asal membuang karakter.
 */
export function extractAmounts(text: string): number[] {
  const out = new Set<number>()
  const re = /(?:rp|idr|rp\.)\s*([\d][\d.,]*)/gi
  let m: RegExpExecArray | null
  while ((m = re.exec(text)) !== null) {
    const n = parseIdrNumber(m[1])
    if (n !== null && n >= 100) out.add(n)
  }
  // Kandidat tanpa awalan Rp (beberapa bank hanya menulis angka) — hanya
  // ambil yang punya pemisah ribuan, supaya angka tanggal/id tidak ikut.
  const bare = /(?<![\w.-])(\d{1,3}(?:[.,]\d{3})+)(?![\w-])/g
  while ((m = bare.exec(text)) !== null) {
    const n = parseIdrNumber(m[1])
    if (n !== null && n >= 100) out.add(n)
  }
  return [...out]
}

function parseIdrNumber(raw: string): number | null {
  let s = raw.replace(/\s+/g, '')
  // Buang trailing decimal jelas seperti ",00" / ".00" setelah pemisah lain.
  if (/^\d{1,3}(?:[.,]\d{3})+(?:[.,]\d{2})$/.test(s)) {
    s = s.replace(/[.,]\d{2}$/, '')
  } else if (/^\d+[.,]\d{2}$/.test(s) && !/^\d{1,3}[.,]\d{3}$/.test(s)) {
    // "50137.00" gaya barat → buang desimal. "50.137" tetap dipertahankan
    // sebagai ribuan karena pola 3-digit di belakang pemisah.
    s = s.replace(/[.,]\d{2}$/, '')
  }
  if (!/^\d+$/.test(s)) {
    // Sisa kasus: buang pemisah yang TIDAK berkelompok 3 (angka acak).
    const parts = s.split(/[.,]/)
    if (parts.length > 1 && parts.slice(1).every((p) => p.length === 3)) {
      s = parts.join('')
    } else {
      s = s.replace(/[.,]/g, '')
    }
  }
  const n = Number(s)
  return Number.isFinite(n) ? n : null
}
