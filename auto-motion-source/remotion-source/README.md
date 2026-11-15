# ARKX AUTO Motion — Remotion explainer source

Folder ini berisi composition React/Remotion untuk membuat video dokumenter, edukasi, atau topik kehidupan dari naskah. Scene memakai ilustrasi SVG kontekstual, typography, caption kata aktif, dan salah satu dari 31 art direction. UI editor/preview browser serta fitur voice-over aplikasi berada di luar folder ini dan tetap utuh.

## Menjalankan

Gunakan Node.js 20 atau lebih baru:

```bash
npm install
npm run studio
```

Pilih `ARKXAutoMotionExplainer` di Remotion Studio. Ubah `script`, `styleId`, `format`, atau audio lokal pada `props.json`. Contoh bawaan memakai naskah edukasi tentang gula dan kebiasaan makan.

Untuk menambahkan voice-over, salin audio WAV/MP3 lokal ke `public/`, lalu isi `narrationSrc`, misalnya `"narrationSrc": "arkx-auto-motion-voice-over.wav"`. Audio dimulai dari frame 0, dengan volume dibatasi pada rentang 0–1. Composition ini tidak memanggil Gemini dan tidak membuat TTS; audio lokal hanya dibaca saat preview/render.

## Motion design

Token easing, spring, timing, stagger, dan visual layers berada di `src/theme.ts`. Setiap scene mengikuti susunan background mesh/texture, ilustrasi SVG, judul dan captions, color grade, grain, lalu vignette. Judul dan elemen berulang masuk bertahap dengan spring; gerak camera ilustrasi memakai slow zoom/pan; exits lebih cepat dari entrances. Interpolasi memakai easing non-linear dengan batas kiri/kanan agar elemen tidak bocor sebelum atau sesudah keyframe. Timing animasi dihitung dari `fps` composition.

Caption bergerak mengikuti urutan kata dan estimasi bobot panjang/suku kata di scene, bukan forced alignment terhadap waveform. Karena itu highlight dapat sedikit meleset jika voice-over memiliki jeda panjang atau tempo sangat tidak rata. Pola ini tidak menambahkan musik atau SFX ke track yang sudah ada.

## 31 gaya visual

Ubah `styleId` di `props.json`; semua ID ada di `ART_STYLES` dan `STYLE_OPTIONS` pada `src/ExplainerVideo.tsx`. Setiap preset mempertahankan palet, texture, komposisi/alignment, bobot dan tracking judul, skala/posisi visual, bentuk caption, serta varian entrance motion—bukan sekadar mengganti warna:

`cinema` Cinematic · `editorial` Editorial · `neon` Neon cyber · `blueprint` Blueprint · `paper` Cut-paper · `retro` Retro grain · `minimal` Minimal · `pop` Pop collage · `data` Data lab · `botanical` Botanical · `luxe` Luxe gold · `playful` Playful · `swiss` Swiss modern · `vaporwave` Vaporwave · `holographic` Holographic · `ink` Hand-drawn ink · `cyberpunk` Cyberpunk noir · `brutalist` Brutalist type · `glass` Glassmorphism · `isometric` Isometric · `chalk` Chalkboard · `thermal` Thermal map · `mosaic` Mosaic tiles · `clay` Clay craft · `mono` Monochrome · `bauhaus` Bauhaus · `liquid` Liquid chrome · `sports` Sports broadcast · `science` Science schematic · `comic` Comic halftone · `glitch` Digital glitch.

## Render dan pemeriksaan source

```bash
npm run render
npx tsc --noEmit
```

Render MP4 bawaan dibuat di `out/arkx-auto-motion-explainer.mp4`. CLI memakai Chromium dan FFmpeg sesuai kebutuhan renderer. Untuk smoke check tanpa render video, `npx tsc --noEmit` memeriksa tipe composition; tes scene aplikasi ada di folder `../tests/`.

## Batas integrasi web preview

Halaman ARKX AUTO Motion memakai renderer Canvas/SVG browser agar preview dan ekspor WebM berjalan lokal. Voice-over ter-host dilayani endpoint Worker terpisah dan hanya dikirim ke Gemini ketika pengguna menekan tombol TTS. Composition Remotion adalah jalur render lokal/CLI yang berbeda; kedua jalur berbagi pemetaan intent/topik dan gaya tetapi tidak dijanjikan identik piksel demi piksel.

## Lisensi

Versi dependency dikunci pada Remotion `4.0.542`. Periksa [FAQ lisensi Remotion](https://www.remotion.dev/docs/license/faq) dan [ketentuan lengkap](https://www.remotion.dev/docs/terms) sebelum menggunakan pada proyek/tim.
