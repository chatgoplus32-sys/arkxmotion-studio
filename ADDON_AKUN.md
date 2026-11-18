# Skema Add-on Akun — ARKXMotion Studio

Add-on bulanan khusus member: **Rp 100.000 / 30 hari → 3 akun email siap pakai**.
Pembayaran QRIS (BasuniPay, kode unik) diverifikasi otomatis; admin menyerahkan akun.

3 email add-on bisa didaftarkan member sebagai **akun ArkXMotion sendiri**;
saldo akun itu bisa diatur: **top up saldo sendiri** atau **ambil saldo dari
akun utama member** (diatur pemilik akun utama di halaman Add-on Akun).

## Produk

| Item | Nilai |
|---|---|
| Harga | Rp 100.000 (bisa diubah admin di Membership → "Harga Add-on Akun") |
| Isi | 3 akun email siap pakai (email + password [+ catatan]) |
| Periode | 30 hari per pembayaran |
| Target | Member/admin terdaftar (semua user login wajib punya akun) |
| Perpanjangan | Beli lagi; approval menambah 30 hari di atas sisa expiry aktif |

## Alur

1. Member buka menu **Lainnya → Add-on Akun** (`/addon-akun`).
2. Member klik "Saya sudah bayar — Kirim Konfirmasi" → server membuat baris
   `account_addon_payments` (pending) dengan **nominal terkunci di server**
   (Rp 100.000) + kode unik 3 digit → BasuniPay QRIS dinamis ditampilkan.
3. Member bayar nominal TEPAT. Pembayaran terdeteksi lewat:
   - webhook/poller BasuniPay → `approveTopupRef('account_addon_payments', …)`, atau
   - parser email mutasi → `matchIncomingAmount`, atau
   - admin approve manual di **Admin → Membership → Antrian Add-on Akun**.
4. Saat disetujui (`approveAddonPaymentRow`): `period_start`/`period_end` diisi
   30 hari (diperpanjang dari expiry terakhir bila masih aktif), email + notifikasi
   terkirim ke member & admin.
5. Admin menyerahkan akun: kolom **Set Akun** di tabel antrian (atau sekalian saat
   Approve) — isi satu akun per baris: `email|password|catatan`.
6. Member melihat 3 akun di halaman Add-on Akun (tampil hanya selama periode aktif),
   dengan tombol salin email/password.

## Database

Tabel `account_addon_payments` (dibuat di `server/db.ts`):

```
id INTEGER PK, user_id INTEGER NOT NULL → users(id),
amount INTEGER, unique_code INTEGER, amount_total INTEGER, paid_amount INTEGER,
paid_at DATETIME, pay_ref TEXT,
status TEXT CHECK(status IN ('pending','approved','rejected')) DEFAULT 'pending',
proof_note TEXT, admin_note TEXT,
accounts TEXT NOT NULL DEFAULT '[]',   -- JSON [{email, password, note?}]
period_start DATETIME, period_end DATETIME,
created_at DATETIME, updated_at DATETIME
```

Tabel `account_addon_links` (tautan akun add-on → akun utama):

```
id INTEGER PK, addon_user_id INTEGER NOT NULL UNIQUE → users(id),
owner_user_id INTEGER NOT NULL → users(id),
saldo_source TEXT NOT NULL DEFAULT 'parent' CHECK(saldo_source IN ('parent','own')),
created_at DATETIME, updated_at DATETIME
```

Setting harga di `app_settings`: key `addon_fee` (default `100000`).
Terdaftar di `QRIS_TABLES` (`mode: 'manual'`) supaya verifikasi BasuniPay/email otomatis.

## Endpoint

Member (auth):
- `GET  /api/membership/addon/status` — isActive, periodStart/End, accounts (hanya periode aktif), payment terakhir, `isAddonAccount`/`saldoSource`/`ownerName` (bila pemanggil adalah akun add-on).
- `POST /api/membership/addon/payment` — buat pengajuan (1 pengajuan pending per user).
- `GET  /api/membership/addon/links` — provisioning email add-on milik caller: `{email, note, periodEnd, registered, addonUserId, saldoSource, linked}`.
- `PATCH /api/membership/addon/links/:addonUserId` — body `{ saldo_source: 'parent' | 'own' }`; hanya pemilik akun utama yang boleh.

Publik: `GET /api/membership/config` kini mengembalikan `addonFee`, `addonAccountsPerPeriod`, `addonPeriodDays`.

Admin (requireAdmin):
- `GET  /api/admin/addon/payments` — semua pengajuan + jumlah akun terisi.
- `POST /api/admin/addon/payments/:id/approve` — body opsional `{ accounts: [...] }`.
- `POST /api/admin/addon/payments/:id/reject` — body `{ admin_note }`.
- `POST /api/admin/addon/payments/:id/accounts` — set/ganti akun (hanya payment approved).
- `PATCH /api/admin/membership/config` — kini juga menerima `addonFee`.

## Akun add-on tertaut & saldo (baru)

Alur: admin menyerahkan 3 email → member **mendaftarkan sendiri** email itu di
`/register`. Karena email tercantum di `account_addon_payments` (approved &
masih aktif), registrasi **otomatis**: akun langsung `approved` + Pro (tanpa
biaya join) dan **tertaut** ke akun utama pembayar via `account_addon_links`
(default `saldo_source='parent'`).

Pemilik akun utama mengatur tiap akun tertaut di halaman **Add-on Akun → Akun
Add-on Tertaut**:

| Mode | Efek |
|---|---|
| **Akun Utama** (`parent`) | Saldo CreatePulse/NexaBot/Seavi/PosBot/RunningHub akun add-on dipotong dari saldo akun utama; jawaban `/balance` = saldo akun utama; refund kembali ke akun utama. |
| **Saldo Sendiri** (`own`) | Akun add-on top up & memakai saldonya sendiri (tagihan sendiri). |

Detail teknis:
- Resolusi saldo di `server/lib/effectiveWallet.ts` (`walletUserIdFor`) —
  dipakai di semua endpoint `/balance`, `/deduct`, `/refund` (kelima provider).
  Usage & refund selalu melekat pada wallet yang menanggung biaya.
- Catatan/statistik (`*_usage`) dari akun add-on mode `parent` tertulis atas
  nama akun utama (wallet yang dipotong).
- Mode `parent` juga membawa paket Unlimited/Booster & kelayakan kunci server
  milik akun utama; kuota harian NexaDance ikut kuota akun utama.
- Akun add-on **tidak** bisa mengubah mode saldonya sendiri (PATCH butuh akun
  utama); pemilik bisa mengganti kapan pun.
- Registrasi email biasa (bukan add-on) tetap alur lama: pending + bayar.

## File yang diubah/ditambah

Server: `db.ts`, `routes/auth.ts`, `routes/membership.ts`, `routes/admin.ts`, `routes/createpulse.ts`, `routes/nexabotWallet.ts`, `routes/seaviWallet.ts`, `routes/posbotWallet.ts`, `routes/runninghubWallet.ts`, `lib/membershipActivation.ts`, `lib/qrisPayment.ts`, `lib/effectiveWallet.ts` (baru)
Frontend: `pages/AddonAkun.tsx` (baru), `pages/Register.tsx`, `pages/AdminMembership.tsx`, `components/layout/Sidebar.tsx`, `stores/authStore.ts`, `lib/addon.ts` (baru), `App.tsx`

## Catatan keamanan

- Nominal selalu dari server; klien tidak bisa menentukan harga.
- Password akun hanya terlihat user pemilik periode aktif + admin.
- Route dalam app tetap `noindex` (RouteMeta); tidak ada akun tersimpan di log.
