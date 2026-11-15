/**
 * QRIS manual + verifikasi otomatis lewat email notifikasi bank/e-wallet.
 *
 * QRIS statis tidak punya API, jadi identitas pembayaran dipindahkan ke
 * NOMINAL: tiap pengajuan top-up diberi kode unik 3 digit (Rp 50.000 →
 * Rp 50.137). Parser email (paymentEmailWatcher) / BasuniPay mengekstrak
 * nominal masuk, lalu `matchIncomingAmount` mencocokkannya ke baris pending
 * lewat `amount_total` — approve/kredit saldo berjalan tanpa campur tangan
 * admin.
 *
 * Mode per tabel (semuanya otomatis penuh):
 *  - 'credit' : wallet (CreatePulse/NexaBot saldo/Seavi/PosBot) → saldo masuk.
 *               Pengecualian: kind='unlimited' di nexabot_topup = AKTIVASI
 *               paket (penumpukan masa berlaku), bukan kredit saldo.
 *  - 'manual' : provider manual — uang masuk divalidasi lalu ditandai LUNAS
 *               + status approved otomatis; admin tinggal menyerahkan
 *               kunci/akses provider.
 */
import db from '../db.js'
import { alertInfo } from './alerts.js'
import { activateUnlimitedTopup } from './unlimitedActivation.js'
import { approveMembershipPaymentRow, approveProPaymentRow } from './membershipActivation.js'

// ── Registry tabel top-up yang bisa diverifikasi ──────────────────────────
interface QrisTable {
  table: string
  label: string
  mode: 'credit' | 'manual'
  balanceTable?: string
  /** Kolom baris top-up yang dikredit ke saldo ('amount' Rp / 'tokens'). */
  creditColumn?: 'amount' | 'tokens'
}

export const QRIS_TABLES: QrisTable[] = [
  { table: 'provider_topup_request', label: 'Top-up Manual Provider', mode: 'manual' },
  { table: 'createpulse_topup', label: 'Top-up CreatePulse', mode: 'credit', balanceTable: 'createpulse_balance', creditColumn: 'amount' },
  // kind='balance' → kredit saldo; kind='unlimited' → aktivasi paket.
  { table: 'nexabot_topup', label: 'Top-up NexaBot', mode: 'credit', balanceTable: 'nexabot_balance', creditColumn: 'amount' },
  { table: 'seavi_topup', label: 'Top-up Seavi', mode: 'credit', balanceTable: 'seavi_balance', creditColumn: 'tokens' },
  { table: 'posbot_topup', label: 'Top-up PosBot', mode: 'credit', balanceTable: 'posbot_balance', creditColumn: 'amount' },
  { table: 'runninghub_topup', label: 'Top-up RunningHub', mode: 'credit', balanceTable: 'runninghub_balance', creditColumn: 'amount' },
  // Pembayaran member (join Pro) & upgrade Pro — aktivasi akun, bukan saldo.
  { table: 'membership_payments', label: 'Pembayaran Member (Join Pro)', mode: 'manual' },
  { table: 'pro_payments', label: 'Upgrade Pro', mode: 'manual' },
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
  ref: IncomingRef = {},
): { action: string; table?: string; id?: number; detail: string } {
  if (!Number.isFinite(amount) || amount <= 0) return { action: 'skip_invalid', detail: 'Nominal tidak valid' }

  // Kandidat terlama dulu supaya dua pembayaran bernilai sama tidak saling
  // menyalip. Jendela 24 jam: email lama tidak boleh meng-approve baris baru.
  for (const t of QRIS_TABLES) {
    const where = [
      'amount_total = ?',
      "status = 'pending'",
      "created_at >= datetime('now', ?)",
    ].join(' AND ')
    const row = db
      .prepare(`SELECT * FROM ${t.table} WHERE ${where} ORDER BY created_at ASC LIMIT 1`)
      .get(amount, `-${MATCH_WINDOW_HOURS} hours`) as PendingRow | undefined
    if (!row) continue
    return handleRow(t, row, amount, ref)
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

type IncomingRef = { from?: string; subject?: string; source?: 'email' | 'android' | 'paste' | 'basunipay' }

/**
 * Approve baris top-up langsung dari identitas tabel+id (dipakai BasuniPay:
 * webhook/polling status tahu PERSIS baris mana yang dibayar, tidak perlu
 * mencocokkan nominal). Logika kredit/tanda-lunas sama dengan pencocokan.
 */
/** Satu pintu keputusan: semaunya benar-benar otomatis penuh. */
function handleRow(
  t: QrisTable,
  row: PendingRow,
  paid: number,
  ref: IncomingRef,
): { action: string; table?: string; id?: number; detail: string } {
  // Member → akun langsung Pro; Upgrade Pro → plan Pro. Keduanya kirim email
  // + notifikasi sendiri, jadi lewat wrapper di bawah (bukan approveManual).
  if (t.table === 'membership_payments') {
    const r = approveMembershipPaymentRow(row.id, ref.source || 'manual')
    return r.ok
      ? { action: 'auto_activated', table: t.table, id: row.id, detail: 'Akun Pro diaktifkan' }
      : { action: 'activate_failed', table: t.table, id: row.id, detail: r.reason || 'gagal aktivasi' }
  }
  if (t.table === 'pro_payments') {
    const r = approveProPaymentRow(row.id, ref.source || 'manual')
    return r.ok
      ? { action: 'auto_activated', table: t.table, id: row.id, detail: 'Plan Pro diaktifkan' }
      : { action: 'activate_failed', table: t.table, id: row.id, detail: r.reason || 'gagal aktivasi' }
  }
  if (t.table === 'nexabot_topup' && row.kind === 'unlimited') {
    return activateUnlimitedRef(t, row, paid, ref)
  }
  if (t.mode === 'credit') return approveCredit(t, row, paid, ref)
  return approveManual(t, row, paid, ref)
}

/** Aktivasi Paket Unlimited otomatis saat pembayaran terverifikasi. */
function activateUnlimitedRef(
  t: QrisTable,
  row: PendingRow,
  paid: number,
  ref: IncomingRef,
): { action: string; table: string; id: number; detail: string } {
  const act = activateUnlimitedTopup(row, `Aktif otomatis (${ref.source || 'email'}) — pembayaran Rp ${Math.round(paid).toLocaleString('id-ID')}`)
  insertNotification(
    'Paket Unlimited Aktif ✅',
    `Paket ${act.name} aktif sampai ${act.expires_at || '-'} (${act.days_left} hari). Selamat menikmati!`,
    'success',
    'users',
    row.user_id,
  )
  insertNotification(
    '💰 Paket Unlimited Aktif (auto)',
    `${t.label} #${row.id} — Paket ${act.name} aktif sampai ${act.expires_at || '-'}. Pembayaran Rp ${Math.round(paid).toLocaleString('id-ID')} terverifikasi otomatis.`,
    'success',
    'admins',
    null,
  )
  alertInfo('Paket Unlimited aktif otomatis', {
    tabel: t.table,
    id: String(row.id),
    paket: act.name,
    aktif_sampai: act.expires_at || '-',
  })
  logPaymentVerify({
    source: ref.source || 'email',
    refTable: t.table,
    refId: row.id,
    amount: paid,
    action: 'auto_activated',
    emailFrom: ref.from,
    emailSubject: ref.subject,
    detail: `Paket ${act.name} aktif sampai ${act.expires_at}`,
  })
  return { action: 'auto_activated', table: t.table, id: row.id, detail: `Paket ${act.name} aktif sampai ${act.expires_at}` }
}

export function approveTopupRef(
  table: string,
  id: number,
  paid: number,
  ref: IncomingRef,
): { action: string; table?: string; id?: number; detail: string } {
  const t = QRIS_TABLES.find((x) => x.table === table)
  if (!t) return { action: 'unknown_table', detail: `Tabel tidak dikenal: ${table}` }
  const row = db.prepare(`SELECT * FROM ${t.table} WHERE id = ?`).get(id) as (PendingRow & { status: string }) | undefined
  if (row?.status === 'approved') return { action: 'already_approved', table, id, detail: 'Sudah disetujui; tidak dikredit ulang' }
  if (!row || row.status !== 'pending') return { action: 'no_pending_row', detail: `Baris ${table} #${id} tidak pending` }
  return handleRow(t, row, paid, ref)
}

/** Bayar = saldo masuk: tandai lunas + kredit saldo + beri tahu user & admin. */
function approveCredit(t: QrisTable, row: PendingRow, paid: number, ref: IncomingRef): { action: string; table: string; id: number; detail: string } {
  // Kredit yang diterima = apa yang benar-benar masuk (termasuk kode unik).
  // Seavi dikredit dalam TOKEN (kolom tokens), bukan rupiah.
  const credit = t.creditColumn === 'tokens' ? Number(row?.tokens) || 0 : paid
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
 * Provider manual: uang masuk tervalidasi → langsung AUTO-APPROVED (tidak ada
 * saldo untuk dikredit). Admin tinggal menyerahkan kunci/akses provider;
 * notifikasi admin memberi tahu.
 */
function approveManual(t: QrisTable, row: PendingRow, paid: number, ref: IncomingRef): { action: string; table: string; id: number; detail: string } {
  db.prepare(
    `UPDATE ${t.table}
        SET status = 'approved', paid_amount = ?, paid_at = CURRENT_TIMESTAMP,
            pay_ref = ?, admin_note = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ? AND status = 'pending'`,
  ).run(paid, (ref.subject || ref.from || '').slice(0, 300), `Pembayaran terverifikasi via ${ref.source || 'email'} — auto-approved`, row.id)

  insertNotification(
    'Pembayaran Diterima ✅',
    `${t.label} Rp ${paid.toLocaleString('id-ID')} sudah tervalidasi. Admin segera menyerahkan kunci/akses provider kamu.`,
    'success',
    'users',
    row.user_id,
  )
  insertNotification(
    '💰 Pembayaran Masuk (auto-approved)',
    `${t.label} #${row.id} — Rp ${paid.toLocaleString('id-ID')} terverifikasi; kunci/akses provider BELUM diserahkan — segera proses.`,
    'warning',
    'admins',
    null,
  )
  alertInfo('Pembayaran manual auto-approved', {
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
    detail: 'Provider manual — auto-approved',
  })
  return { action: 'auto_approved', table: t.table, id: row.id, detail: 'Otomatis disetujui' }
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
