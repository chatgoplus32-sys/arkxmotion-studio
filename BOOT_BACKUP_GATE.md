# Gerbang 3 di deploy — boot harus meninggalkan snapshot

Gerbang ini dijalankan **sesudah** proses produksi diganti, dan diwujudkan oleh
`scripts/check-boot-backup.sh`. Ia berpasangan dengan **gerbang 3a**
(`scripts/check-prod-env.sh`), yang diperiksa lebih dulu: proses yang melayani
harus benar-benar berjalan dengan `NODE_ENV=production`.

## Kenapa ada

Deploy 17 Sep 2026 memperlihatkan bentuk kegagalan yang tidak terlihat dari
luar: gerbang 2 (smoke test) menulis snapshot pukul 11:42:10, `pm2 restart`
berjalan pukul 11:42:19, dan proses produksi **tidak pernah menulis snapshot
sendiri**. Terukur 31 menit setelah boot, `local.latest` masih berkas milik
smoke test. Deploy tetap dilaporkan sukses, karena tidak ada apa pun yang
memeriksa hasil boot-nya.

Kejadian itu terulang pada deploy `7faf8f0` (snapshot smoke test 05:27:02,
start proses 05:27:11), jadi ini bukan peristiwa sekali.

## Yang diperiksa, berurutan

1. proses baru menjawab `/api/health`
2. proses itu memang **baru** start — umurnya tidak lebih tua dari perintah
   restart. Kalau `pm2 restart` ternyata tidak benar-benar mengganti prosesnya,
   itu kegagalan tersendiri dan gerbang menyebutkannya secara terpisah, bukan
   terlihat seperti masalah backup
3. ada snapshot di `data/backups/` yang **lebih baru dari start proses itu**

Poin 3 memakai ambang `start proses − 3 detik`, dan toleransi itu harus tetap
kecil: snapshot gerbang 2 lahir beberapa detik *sebelum* restart, jadi toleransi
yang longgar akan menghitungnya sebagai bukti boot. Pada kasus 17 Sep jaraknya
sembilan detik. Snapshot itu **tidak** boleh lolos sebagai bukti boot, dan
`test/bootBackupGate.test.ts` mengunci kasus ini secara eksplisit.

## Gerbang 3a — sebab sebenarnya dari tiga deploy merah

Gerbang 3 gagal tiga kali berturut-turut (17 Sep 11:42, `7faf8f0` 05:27,
`55a4bfa` 05:31), selalu dengan tanda tangan yang sama: boot tidak menulis
snapshot. Setelah `/api/backup/status` melaporkan hasil snapshot saat start,
sebabnya terbaca tanpa masuk ke VPS:

```json
"startup": { "outcome": "not-run", "reason": "gerbang AUTO_BACKUP tertutup:
            AUTO_BACKUP=(kosong), NODE_ENV=(tidak diset)" }
```

Backup-nya tidak rusak. `NODE_ENV` tidak pernah sampai ke proses produksi.
`ecosystem.config.cjs` mendeklarasikan `NODE_ENV: 'production'`, tapi deploy
me-restart dengan `pm2 restart arkxmotion --update-env` — dan flag itu
menyegarkan environment dari **shell yang menjalankan perintah** (sesi SSH
deploy, yang tidak punya `NODE_ENV`), bukan dengan membaca ulang berkas
ecosystem-nya. Karena `AUTO_BACKUP` tidak diset, gerbang backup jatuh ke
`isProd`; `isProd` bernilai false; `backupOnStartup()` tidak pernah dipanggil.

Deploy sekarang menyalakan proses lewat berkas itu — dengan menghapus proses
lama lebih dulu, bukan me-reload-nya. Alasannya ada di bagian berikutnya.

Itu menjelaskan dua hal lain. `PORT` juga tidak sampai, tapi tidak ada yang
sadar karena `Number(process.env.PORT) || 6000` kebetulan menghasilkan angka
yang sama. Dan 30 snapshot yang selama ini dianggap "backup produksi" sebenarnya
ditulis oleh smoke test gerbang 2 — server yang dinyalakan dengan
`NODE_ENV=production` di port 6099 — sehingga isinya selalu muncul sekitar
sepuluh detik sebelum setiap restart. Produksi tidak pernah mem-backup dirinya;
ia hanya kebetulan dilewati oleh proses deploy.

Gerbang 3a membaca environment proses dari sisi OS, `/proc/<pid>/environ`, yang
berisi environment saat proses itu di-exec. Jadi ia tidak bisa lolos hanya karena
aplikasi mengira dirinya production — dan kegagalannya menyebut nilai yang
sebenarnya beserta perintah perbaikannya.

Memeriksa tanpa deploy:

```bash
bash scripts/check-prod-env.sh
```

## Jebakan kedua: restart dari berkas tidak me-resolve `script`

Percobaan pertama memperbaiki ini memakai `pm2 startOrReload
ecosystem.config.cjs`. Hasilnya seluruh `/api` produksi 502, dan tidak pulih
sendiri.

Sebabnya pm2, bukan aplikasi. `script` relatif seperti `'tsx'` di-resolve
**hanya di jalur start**, dan itu dikerjakan di sisi CLI:
`path.resolve(cwd, 'tsx')` → `/opt/arkxmotion-studio/tsx` (tidak ada), lalu
mencari `tsx` di `PATH` (tidak ada). Jalur restart/reload dari berkas
mengirim konfigurasi **mentah** ke daemon, dan daemon mengulang resolusi yang
sama lalu menolak menyalakan proses. Lebih buruk lagi, konfigurasi tersimpan
ikut tercemar (`script` = `'tsx'`), sehingga `pm2 restart arkxmotion`
berikutnya pun gagal dengan cara yang sama — itulah sebabnya produksi tidak
pulih sendiri.

Dua hal karena itu diubah. `script` di `ecosystem.config.cjs` kini path absolut
(`path.join(__dirname, 'node_modules', '.bin', 'tsx')`), dan deploy menyalakan
proses lewat jalur start:

```bash
pm2 delete arkxmotion && pm2 start ecosystem.config.cjs && pm2 save
```

Deploy juga tidak lagi meninggalkan produksi mati: kalau `/api/health` belum
menjawab setelah itu, proses dinyalakan langsung dengan `NODE_ENV=production
PORT=6000` sebagai jalur darurat.

Aplikasinya sendiri tidak pernah bermasalah. Dijalankan lokal dengan
`NODE_ENV=production`, ia melayani `/api/health` normal — jadi 502 itu murni
soal manajemen proses pm2.

## Kalau gerbang gagal

Deploy ditandai gagal, dan gerbangnya mencetak diagnosis yang selama ini tidak
bisa didapat tanpa masuk ke VPS:

- respons `/api/backup/status`
- lima snapshot terbaru beserta waktunya
- baris log yang menyebut `backup`, dari pm2, `logs/out.log`, dan
  `logs/error.log`

Proses lama **tidak** dikembalikan otomatis, karena restart sudah terjadi.
Yang didapat adalah kegagalan yang terlihat beserta sebabnya.

Memeriksa tanpa perlu deploy:

```bash
bash scripts/check-boot-backup.sh
```

## Keadaan darurat

Jalankan workflow secara manual lalu centang `skip_backup_gate`. Gerbang 1 dan 2
tetap berjalan, gerbang 3a dan 3 dilewati, dan workflow mencatatnya. Memakai ini
secara permanen akan mengembalikan kebutaan yang justru sedang dihilangkan.

## Satu pengecualian yang disengaja

Pada instalasi baru dengan database yang benar-benar masih kosong, boot memang
tidak menulis snapshot ("Dilewati — database masih kosong"), jadi gerbang ini
akan gagal sampai ada data. Itu memang tujuannya — yang dicegah di sini adalah
diam-diam tidak punya backup pada sistem yang sudah berisi data.
