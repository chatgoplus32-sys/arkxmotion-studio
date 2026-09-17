# Gerbang 3 di deploy — boot harus meninggalkan snapshot

Gerbang ini adalah langkah ketiga di `.github/workflows/deploy-vps.yml`,
dijalankan **sesudah** `pm2 restart`, dan diwujudkan oleh
`scripts/check-boot-backup.sh`.

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
tetap berjalan, dan workflow mencatat bahwa gerbang 3 dilewati. Memakai ini
secara permanen akan mengembalikan kebutaan yang justru sedang dihilangkan.

## Satu pengecualian yang disengaja

Pada instalasi baru dengan database yang benar-benar masih kosong, boot memang
tidak menulis snapshot ("Dilewati — database masih kosong"), jadi gerbang ini
akan gagal sampai ada data. Itu memang tujuannya — yang dicegah di sini adalah
diam-diam tidak punya backup pada sistem yang sudah berisi data.
