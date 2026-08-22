# Konfigurasi SMTP — Email Verifikasi & Reset Password

ARKXMotion Studio mengirim 2 jenis email transaksional:

| Email | Kapan dikirim | Link berlaku |
|---|---|---|
| **Verifikasi email** | Saat user mendaftar / admin menekan "Kirim ulang link verifikasi" | 24 jam |
| **Reset password** | Saat user meminta "Lupa password" | 15 menit |

Email dikirim lewat SMTP menggunakan **nodemailer**. Tanpa konfigurasi SMTP, app
tetap berfungsi tetapi email **tidak benar-benar terkirim** — isi email di-log ke
console server dan link-nya ditampilkan langsung di UI (mode dev), sehingga alur
tetap bisa diuji tanpa email sungguhan.

---

## 1. Variabel yang dibutuhkan

Salin `.env.example` ke `.env` (untuk lokal) dan set Environment Variables di
Vercel (untuk produksi) dengan variabel berikut:

| Variabel | Wajib | Keterangan |
|---|---|---|
| `SMTP_HOST` | ✅ | Host SMTP provider (mis. `smtp.gmail.com`) |
| `SMTP_PORT` | ✅ | `587` (STARTTLS, disarankan) · `465` (SSL/TLS) · `2525` (alternatif) |
| `SMTP_SECURE` | | `true` hanya jika pakai port `465`; biarkan `false` untuk 587 |
| `SMTP_USER` | ✅ | Username SMTP (biasanya alamat email / email login akun) |
| `SMTP_PASS` | ✅ | **App Password / SMTP key** — bukan password akun biasa |
| `MAIL_FROM` | | Alamat pengirim di email (default: `SMTP_USER`) |
| `APP_URL` | ✅ | Base URL app untuk membangun link (lokal `http://localhost:5173`, produksi `https://…vercel.app`) |

> **Catatan**: `SMTP_SECURE=true` hanya untuk port 465. Untuk port 587
> (STARTTLS) biarkan `false` — nodemailer menaikkan enkripsi otomatis.

---

## 2. Pilihan Provider

### 2.1 Gmail (App Password) — gratis, paling mudah untuk mulai

1. Aktifkan **2-Step Verification** di akun Google kamu:
   https://myaccount.google.com/security → *2-Step Verification* → aktifkan.
2. Buat **App Password**: https://myaccount.google.com/apppasswords
   - Pilih *Other (Custom name)* → ketik `arkxmotion` → *Generate*.
   - Google menampilkan 16 karakter (format: `abcd efgh ijkl mnop`) — **hapus spasi** saat menyalin.
3. Isi `.env` / Vercel:

```env
SMTP_HOST=smtp.gmail.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-email@gmail.com
SMTP_PASS=abcdEFGHijklMNOP            # App Password 16 karakter, tanpa spasi
MAIL_FROM=ARKXMotion Studio <your-email@gmail.com>
APP_URL=http://localhost:5173         # ganti dengan URL produksi di Vercel
```

**Batas**: ±500 email/hari. App Password **tidak bisa** dipakai kalau 2FA mati —
password akun biasa pasti ditolak (`Invalid login` / `535`).

### 2.2 Brevo (d/h Sendinblue) — paling cocok untuk skala (300 email gratis/hari)

1. Daftar di https://www.brevo.com (gratis 300 email/hari).
2. Buka **SMTP & API** → tab **SMTP** → copy **SMTP key** (atau klik *Generate*).
   - `SMTP_USER` = **email login akun Brevo** kamu.
   - `SMTP_PASS` = **SMTP key** (bukan password akun).
3. Verifikasi **sender email**: Settings → *Senders* → tambahkan & verifikasi email
   pengirim (harus sama dengan `MAIL_FROM`).

```env
SMTP_HOST=smtp-relay.brevo.com
SMTP_PORT=587
SMTP_SECURE=false
SMTP_USER=your-login@email.com        # email login akun Brevo
SMTP_PASS=xsmtpsib-xxxxxxxxxxxxxxxx   # SMTP key dari Brevo
MAIL_FROM=ARKXMotion Studio <verified-sender@email.com>
APP_URL=https://arkxmotion-studio.vercel.app
```

**Catatan**: Brevo juga mendukung port `465` (SSL) dan `2525`. Pastikan sender
email sudah diverifikasi di Brevo, kalau tidak email ditolak.

### 2.3 Zoho Mail — cocok kalau pakai domain sendiri

1. Login Zoho Mail → https://mail.zoho.com → **Settings** → **Mail Accounts** →
   **IMAP/POP** → aktifkan **SMTP**.
2. Kalau 2FA aktif, buat **App-specific password**:
   https://accounts.zoho.com → *Security* → *App Passwords*.
3. Pilih data center sesuai region akun:
   - Global: `smtp.zoho.com`
   - Eropa: `smtp.zoho.eu`
   - India: `smtp.zoho.in`

```env
SMTP_HOST=smtp.zoho.com               # atau smtp.zoho.eu / smtp.zoho.in
SMTP_PORT=465
SMTP_SECURE=true                      # Zoho port 465 = SSL
SMTP_USER=you@yourdomain.com          # alamat email Zoho lengkap
SMTP_PASS=xxxx-xxxx-xxxx-xxxx         # App-specific password (jika 2FA)
MAIL_FROM=ARKXMotion Studio <you@yourdomain.com>
APP_URL=https://arkxmotion-studio.vercel.app
```

**Catatan**: Zoho juga menerima port `587` (STARTTLS, `SMTP_SECURE=false`).

---

## 3. Cara menguji

### Lokal (Express server :6000)

```bash
# 1) isi .env lalu jalankan ulang server
npm run dev:server

# 2) uji kirim ulang verifikasi via halaman admin:
#    User Management → user "Belum" → klik ikon ✉️
#    Atau langsung:
curl -X POST http://localhost:6000/api/auth/register \
  -H "Content-Type: application/json" \
  -d '{"email":"test@example.com","password":"rahasia123","name":"Test"}'
```

Kalau SMTP berhasil, log server menampilkan:
```
[mailer] Email terkirim ke test@example.com: <messageId>
```

Kalau belum dikonfigurasi:
```
[mailer] SMTP tidak dikonfigurasi — email TIDAK terkirim ke test@example.com
```
(dan link verifikasi muncul langsung di UI)

### Produksi (Vercel)

1. Vercel Project → **Settings** → **Environment Variables** → tambahkan semua
   variabel di atas (`SMTP_*`, `MAIL_FROM`, `APP_URL`).
2. Redeploy. Email dikirim dari serverless function `api/auth.ts` / `api/admin.ts`
   (nodemailer sudah ada di dependencies).

---

## 4. Troubleshooting

| Gejala | Penyebab & solusi |
|---|---|
| `535 Authentication failed` / `Invalid login` | `SMTP_PASS` bukan App Password / SMTP key. Gmail: harus 2FA + App Password. Brevo: pakai SMTP key, bukan password akun. |
| `535 5.7.8 Username and Password not accepted` | (Gmail) 2FA belum aktif atau App Password salah eja (hapus spasi). |
| `554 Sender has rejected` / email tidak terkirim | (Brevo) sender `MAIL_FROM` belum diverifikasi di panel Brevo. |
| `Connection refused` / timeout port 587 | Port 587 diblokir provider hosting/VPS. Coba `465` + `SMTP_SECURE=true`, atau port `2525` (Brevo). |
| `Mailbox name not allowed` / `553` | Format `MAIL_FROM` salah — pakai format `Nama <email@domain.com>`. |
| Link verifikasi tidak terbuka | `APP_URL` salah (mis. masih `localhost` di produksi). Pastikan `APP_URL` = domain publik. |
| Email masuk folder Spam | Tambahkan `MAIL_FROM` domain ke SPF/DKIM (Brevo & Zoho menyediakan catatan DNS). |

---

## 5. File terkait

| File | Fungsi |
|---|---|
| `server/mailer.ts` | Mailer lokal (Express, port 6000) |
| `api/mailer.ts` | Mailer produksi (Vercel serverless) |
| `server/routes/auth.ts` | Kirim verifikasi (daftar) & reset password |
| `server/routes/admin.ts` | Kirim ulang link verifikasi (admin) |
| `.env.example` | Template variabel environment |
