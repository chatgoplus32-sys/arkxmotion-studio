# Kunci induk NexaBot: sekarang di server, bukan di browser

## Masalahnya dulu

Jalur API key mengharuskan **klien** mengirim `x-api-key` sendiri. Artinya kunci
apa pun yang dipakai member ada di `localStorage` browser mereka
(`arkxmotion.providers`, dibaca `getNexabotApiKey()`), dan toko token bahkan
menyerahkan nilainya lewat catatan pembelian. Siapa pun bisa membuka devtools,
membaca kunci itu, lalu memakainya **langsung ke nexabot.id**: di luar app — tidak
tercatat di `nexabot_upstream_usage`, tidak dipotong saldo, tapi tetap ditagihkan
ke akun pemilik kunci. Dan karena kuncinya satu, mencabut akses satu orang tidak
mungkin tanpa memutus semua orang.

## Yang berubah

Relay `/api/public/nexabot/*` yang **memasang** kunci induk. Klien tidak pernah
menerimanya. Urutan resolusi kredensial (satu tempat, `resolveUpstreamAuth`):

1. **cookie sesi** dari klien — jalur Unlimited, tidak pernah digantikan;
2. **kunci yang dikirim klien** — kalau itu kunci pribadi miliknya, dipakai apa
   adanya (relay ini tetap publik untuk pemakai tanpa akun yang membawa kuncinya);
3. **kunci induk server** — hanya kalau membernya berhak.

Kunci induk yang **masih** dikirim klien tidak dianggap kunci pribadi: ia tetap
harus lolos kebijakan yang sama, dan sidik jarinya dicatat sebagai
`client-master` — jejak kunci yang masih beredar, dan itulah yang perlu
dihabiskan.

## Konfigurasi (di `.env` VPS)

```bash
NEXABOT_MASTER_API_KEY=...      # kunci induk. Kosong = fitur ini mati (perilaku lama)
NEXABOT_MASTER_KEY_MODE=unlimited-or-balance
#   unlimited-or-balance (default) — paket Unlimited aktif, atau pernah top up saldo
#   unlimited                      — hanya paket Unlimited aktif
#   off                            — jangan pernah disuntikkan
NEXABOT_MASTER_DAILY_CAP=0      # 0/kosong = tanpa batas. Batas job per member per hari
```

Setelah mengubah `.env`, jalankan `pm2 restart arkxmotion --update-env` atau
deploy ulang.

**Kebijakan kelayakan memeriksa saldo `> 0`, bukan `>= harga`.** Pemotongan saldo
dilakukan klien sebelum generate, jadi memeriksa terhadap harga di sini akan
menolak member yang barusan membayar. Pencatatan biaya tetap ada di tabel
pemakaian upstream.

Batas harian defaultnya **mati** — menyalakannya bisa memutus member yang sudah
membayar. Yang membuatnya layak dinyalakan adalah angka dari laporan di bawah.

## Langkah yang tidak bisa dilewatkan: rotasi kunci

**Memindahkan kunci ke server tidak menarik kembali kunci yang sudah beredar.**
Kunci lama masih ada di `localStorage` setiap browser yang pernah menerimanya, dan
masih bisa dipakai langsung ke nexabot.id. Jadi urutannya:

1. Set `NEXABOT_MASTER_API_KEY` ke kunci **baru** di `.env` VPS (rotasi di
   nexabot.id lebih dulu), lalu restart.
2. Hapus `nexabot` dari daftar jual di toko token (admin → Tokens) supaya kunci
   server tidak pernah ada di jalur yang menyerahkannya ke member. Kalau ada yang
   keliru dimasukkan, server sudah menyensornya dan menolak menjualnya — tapi
   keluarkan dari daftarnya juga.
3. Lihat laporan di bawah: selama `jobs_client_master` masih > 0, kunci lama masih
   dipakai member — artinya masih ada browser yang menyimpannya.

## Cara membaca hasilnya

```
GET /api/nexabot/admin/upstream-usage?days=30      (butuh admin)
```

- `jobs_master` — job yang memakai kunci induk server. Ini yang Anda bayar.
- `jobs_client_master` — kunci induk **masih dikirim klien**: browser masih
  memegangnya. Turunkan lewat rotasi, bukan lewat harapan.
- `jobs_own` / `jobs_cookie` — kunci atau cookie milik member sendiri.
- `cost_known_sum` — biaya yang **dilaporkan** upstream. Job yang biayanya tidak
  dilaporkan dihitung di `jobs_cost_unknown` dan sengaja tidak ditaksir.
- `local_revenue` — yang benar-benar dipotong ke member. Untuk member Unlimited
  angkanya 0, dan itulah sumber subsidinya.

## Telapak tangan untuk verifikasi cepat

```bash
# tanpa identitas: harus 400 (relay menolak), bukan 200
curl -s -o /dev/null -w '%{http_code}\n' -X POST https://arkxmotion-studio.win/api/public/nexabot/submit \
  -H 'Content-Type: application/json' -d '{"mode":"t2v","prompt":"uji"}'

# relay masih hidup
curl -s https://arkxmotion-studio.win/api/public/nexabot/health
```

Kalau `NEXABOT_MASTER_API_KEY` kosong, jawabannya tetap `400 Missing X-Api-Key` —
yaitu perilaku lama. Itu memang kondisi aman untuk deploy: fitur ini inert sampai
kuncinya diisi.

## Peta berkas

| Berkas | Perannya |
| --- | --- |
| `server/lib/nexabotMasterKey.ts` | Kebijakan: siapa yang berhak, batas harian |
| `server/routes/nexabot.ts` | `resolveUpstreamAuth` — satu tempat resolusi + penyuntikan |
| `server/lib/nexabotUpstreamUsage.ts` | Perekam biaya per job + sidik jari + sumber kredensial |
| `server/routes/tokens.ts` | Sensor nilai kunci server di toko token |
| `test/nexabotMasterKey.test.ts` | Perilaku penyuntikan + kebijakan + penjaga toko |
