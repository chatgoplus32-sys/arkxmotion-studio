/**
 * Resolusi saldo untuk akun add-on tertaut.
 *
 * Member mendaftarkan sendiri email yang diserahkan admin sebagai akun
 * ArkXMotion; email tersebut DITAUTKAN ke akun utama pembayar add-on lewat
 * tabel `account_addon_links`. Link punya mode saldo (`saldo_source`):
 *   - 'parent' → saldo dipotong/ditampilkan dari akun utama (owner)
 *   - 'own'    → saldo akun add-on dipakai sendiri (bisa top up sendiri)
 *
 * Dipakai oleh endpoint wallet (balance/deduct/refund): catatan usage &
 * refund selalu melekat pada wallet yang benar-benar menanggung biaya.
 */
import db from '../db.js'

export interface WalletResolution {
  /** user_id pemilik saldo yang dipakai untuk operasi wallet. */
  walletUserId: number
  /** Sumber saldo yang berlaku untuk akun ini. */
  source: 'own' | 'parent'
  /** user_id akun utama (kalau tertaut), null bila bukan akun add-on. */
  ownerUserId: number | null
}

export function effectiveWallet(userId: number): WalletResolution {
  const link = db.prepare(
    'SELECT owner_user_id, saldo_source FROM account_addon_links WHERE addon_user_id = ?',
  ).get(userId) as { owner_user_id: number; saldo_source: string } | undefined
  if (link && link.saldo_source === 'parent') {
    return { walletUserId: link.owner_user_id, source: 'parent', ownerUserId: link.owner_user_id }
  }
  return { walletUserId: userId, source: 'own', ownerUserId: link?.owner_user_id ?? null }
}

/** user_id yang saldonya dipakai untuk operasi wallet (balance/deduct/refund). */
export function walletUserIdFor(userId: number): number {
  return effectiveWallet(userId).walletUserId
}

export interface AddonProvisioning {
  paymentId: number
  ownerId: number
}

/**
 * Cari provisioning add-on untuk `email`: baris add-on ber-status approved dan
 * masih dalam periode aktif yang menyertakan email tersebut di kolom accounts
 * (JSON). Dipakai saat registrasi untuk mengaktifkan & menautkan akun add-on.
 */
export function findAddonProvisioning(email: string): AddonProvisioning | null {
  const emailNorm = String(email || '').trim().toLowerCase()
  if (!emailNorm) return null
  const row = db.prepare(
    `SELECT ap.id AS payment_id, ap.user_id AS owner_id
       FROM account_addon_payments ap
      WHERE ap.status = 'approved'
        AND ap.period_end > datetime('now')
        AND EXISTS (
          SELECT 1 FROM json_each(ap.accounts) j
          WHERE lower(json_extract(j.value, '$.email')) = lower(?)
        )
      ORDER BY ap.period_end DESC
      LIMIT 1`,
  ).get(emailNorm) as { payment_id: number; owner_id: number } | undefined
  return row ? { paymentId: row.payment_id, ownerId: row.owner_id } : null
}
