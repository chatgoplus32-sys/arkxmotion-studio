# ARKX AUTO Motion Explainer — source package

Paket ini berisi editor video/produk lama yang tetap utuh dan sebuah **Explainer Studio terpisah** untuk narasi dokumenter, edukasi, atau topik kehidupan umum. Studio menerima topik singkat atau naskah lengkap, membangun scene dengan ilustrasi yang mengikuti kata/topik, serta menyediakan preview dan ekspor WebM lokal. Semua 31 art direction mengubah tata letak, komposisi, gerak judul, dan treatment label/caption—bukan hanya palet.

## Workspace narasi

- Masuk melalui **Buat animasi**. Workspace narasi memiliki tab ide/topik dan naskah lengkap; jalur ini tidak meminta deskripsi produk, harga, CTA, atau copy affiliate.
- Engine scene berjalan di browser. Ia mengenali topik seperti gula/metabolisme, tubuh, pangan, alam, teknologi, kehidupan, waktu, sebab-akibat, proses, dan perbandingan; setiap intent mendapat ilustrasi/animasi berbeda, bukan diagram yang diputar berdasarkan nomor scene.
- Motion meliputi ilustrasi SVG/canvas berlapis, gerak parallax, partikel/shape yang berkaitan dengan isi, transisi wipe singkat, kinetic typography, serta motif dan pola entrance yang berbeda per art direction.
- Saat VO tersedia, scene dan sorotan kata dipetakan secara **perkiraan** dari durasi audio, jumlah suku kata, dan tanda baca. Ini bukan forced alignment fonem/kata, sehingga untuk VO dengan jeda atau tempo sangat tidak rata, highlight mungkin sedikit bergeser.
- Tidak ada statistik atau angka yang dibuat-buat untuk mengisi scene. Visual konsep ditandai sebagai ilustrasi; angka hanya ditampilkan bila memang ditulis pengguna.
- Komposisi dibatasi maksimum 48 scene agar browser tetap responsif.

## Voice-over dan privasi

- TTS bahasa Indonesia menggunakan Gemini 3.8 Flash TTS, 30 suara, dan 6 gaya pembacaan. Narasi pada alur aplikasi hanya dikirim ke Google Gemini ketika pengguna menekan **Buat voice-over dari naskah**; status Worker tidak mengirim naskah.
- Kunci API hanya disimpan sebagai Cloudflare Worker Secret `GEMINI_API_KEY`; tidak berada pada HTML, JavaScript browser, log aplikasi, ataupun ZIP source.
- Memuat halaman, mengetik naskah, memilih gaya, menyusun scene, dan memeriksa status Worker tidak mengirim teks narasi ke Gemini.
- Audio dapat diimpor, diputar, diunduh sebagai WAV, atau disertakan sebagai track pada ekspor WebM. Batas TTS adalah 2.500 karakter dan enam permintaan per 10 menit/IP/isolat Worker.
- Audio dan naskah tetap lokal, kecuali permintaan TTS eksplisit tersebut.

## Renderer

Preview dan ekspor pada halaman menggunakan renderer Canvas/SVG browser serta `MediaRecorder`, dengan pilihan vertikal, horizontal, dan persegi. Folder `remotion-source/` berisi composition React/Remotion terpisah untuk preview Studio dan render MP4 CLI. Kedua jalur memakai pemetaan topik dan gaya visual yang sejenis, tetapi tidak dijanjikan identik piksel demi piksel. Source Remotion tidak mengirim teks ke Gemini; audio lokal perlu disalin ke `remotion-source/public/` dan diisi melalui `narrationSrc`.

## Panduan motion Remotion

Renderer Remotion kini memakai token bersama dari `remotion-source/src/theme.ts` dan pola scene yang dapat dipakai ulang: easing non-linear yang selalu di-clamp, entrance spring dengan stagger pada kata dan elemen visual, gerak kamera halus pada ilustrasi SVG, exit yang lebih singkat, serta captions progresif. Lapisan scene disusun sebagai background mesh/preset texture, ilustrasi, tipografi dan captions, color grade, grain, lalu vignette. Variasi palet, layout, tipografi, dan motion masing-masing dari 31 preset tetap dipertahankan.

Perubahan ini hanya menyentuh jalur composition Remotion; UI editor/preview browser dan alur voice-over Gemini yang sudah ada tidak diubah. Track VO tetap mulai dari frame 0 dan tidak membuat permintaan TTS saat render. Sorotan caption bergerak menurut bobot panjang/suku kata dan durasi scene, bukan forced alignment waveform, sehingga jeda atau tempo bicara yang sangat tidak rata dapat sedikit menggeser highlight.

## 31 art direction

Cinematic, Editorial, Neon cyber, Blueprint, Cut-paper, Retro grain, Minimal, Pop collage, Data lab, Botanical, Luxe gold, Playful, Swiss modern, Vaporwave, Holographic, Hand-drawn ink, Cyberpunk noir, Brutalist type, Glassmorphism, Isometric, Chalkboard, Thermal map, Mosaic tiles, Clay craft, Monochrome, Bauhaus, Liquid chrome, Sports broadcast, Science schematic, Comic halftone, dan Digital glitch. Setiap preset memiliki geometri stage, posisi/ukuran ilustrasi, entrance judul, dan treatment label yang terdefinisi; Remotion menerapkan sistem komposisi dan motion yang sepadan.

## Menjalankan dan menguji

Jalankan UI lokal statis:

```bash
python3 -m http.server 8080 --directory public
```

TTS memerlukan Worker; server statis saja dapat menguji scene, preview, serta ekspor browser, tetapi tidak menyediakan endpoint `/api/tts`.

Jalankan test dan kompilasi source Remotion:

```bash
node --check public/idea-animation.js
node --check public/narrative-engine.js
node --check worker.mjs
node --test tests/*.test.mjs
cd remotion-source && npx tsc --noEmit
```

Test Worker memakai key dan audio tiruan; tidak mengirim naskah uji ke Gemini. Test scene memeriksa pemetaan topik, batas 48 scene, timing kata, ilustrasi, dan 31 kombinasi layout/motion/caption yang unik. Kompilasi Remotion memeriksa tipe komponen dan props.

## Worker dan deployment

`wrangler.json` mengarahkan `/api/*` ke Worker terlebih dulu dan aset statis ke `public/`. Worker harus memiliki secret `GEMINI_API_KEY`; API key tidak disimpan di frontend, nilai konfigurasi publik, log, atau ZIP. Folder `public/` berisi hanya aset yang dimuat browser. Jalankan perintah dari root proyek agar konfigurasi Wrangler menyertakan `worker.mjs`; endpoint TTS memerlukan secret server-side aktif. Preview sementara tanpa secret akan menampilkan status TTS belum dikonfigurasi:

```bash
npx --yes wrangler@4.102.0 deploy --temporary --name arkx-auto-motion-explainer --compatibility-date 2026-11-09 --assets ./public
```

Untuk deployment yang juga melayani TTS, gunakan konfigurasi Worker dan secret yang sudah ada. Jangan menulis key ke `--var`, frontend, ZIP, file publik, atau output/log deployment. Tautan klaim privat bukan bagian dari paket source.

## Remotion

Lihat `remotion-source/README.md` untuk Studio, render CLI, contoh props, dan daftar `styleId`. Dependency Remotion dikunci pada versi `4.0.542`.
