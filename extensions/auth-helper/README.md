# auth-helper — satu ekstensi untuk semua token provider

Ekstensi MV3 tunggal yang menggantikan tujuh ekstensi terpisah yang isinya
saling menyalin: `firefly-auth-helper`, `g5-auth-helper`, `oneover-auth-helper`,
`jwt-extractor-extension` (dulu di workspace) serta `lemur-galleri5`,
`oneover-token-ext`, `firebase-token-ext` (dulu di `extensions/` repo ini).
Ketujuhnya memuat primitif yang sama berulang — `renderTokens` ×4,
`loadTokens` ×4, `showToast` ×4, `copyToken` ×3, `clearTokens` ×3 — sehingga
setiap perbaikan harus disalin ke beberapa tempat dan cepat atau lambat jadi
berbeda perilaku.

Sekarang daftar provider hidup di **satu tempat** ([`providers.js`](providers.js)).
Popup, background, dan content script membacanya, jadi menambah provider = satu
entri di registry (+ host-nya di `manifest.json`, yang MV3 wajibkan statis).

## Cara pakai

1. Buka `chrome://extensions/` → aktifkan **Developer mode** → **Load unpacked** →
   pilih folder `extensions/auth-helper`.
2. Login ke situs provider seperti biasa, lalu buka popup ekstensi.
3. Tab provider yang cocok dengan tab aktif dipilih otomatis; tekan **Scan** kalau
   token belum tertangkap.
4. Klik tombol Copy, lalu tempel di halaman **Providers** app. Tombol
   **Copy & buka Providers** menyalin token sekaligus membuka halamannya.

| Provider | Sumber capture | Default Copy | Refresh | Cek saldo | Field app |
| --- | --- | --- | --- | --- | --- |
| G5 AI Studio | interceptor jaringan + IndexedDB `firebaseLocalStorage` | refresh token (`AMf-…`); ID token lewat tombol kedua | Firebase `securetoken` | `GET /api/v1/auth/me/info` | `galleri5` |
| OneOver | interceptor + `localStorage` Supabase + cookie HttpOnly (`chrome.cookies`) | JSON `{ access_token, refresh_token }` | Supabase `auth/v1/token` | `get-credit-balance` | `oneover` |
| Adobe Firefly | interceptor jaringan (tanpa `debugger`) + pemindaian Web Storage | Bearer IMS token; JSON `{ token, apiKey, account, session }` lewat tombol kedua | — (token ~1 jam) | — | `firefly` |
| JWT generik | pemindaian tab saat diminta (`activeTab`) | token apa adanya | — | — | untuk Leonardo, Framia, dll. |

## Tata letak

```
auth-helper/
├── manifest.json          # MV3, izin seminimal mungkin (lihat tabel di bawah)
├── providers.js           # REGISTRY: metadata + kemampuan tiap provider
├── background.js          # service worker: routing capture, scan, refresh, saldo
├── lib/
│   ├── jwt.js             # decode & predikat token (sama dengan predikat di app)
│   ├── tokens.js          # bentuk entri, dedupe, format clipboard per provider
│   ├── readers.js         # pembaca halaman (IndexedDB/localStorage/cookie)
│   ├── cookies.js         # pembacaan cookie HttpOnly (khusus background)
│   └── store.js           # chrome.storage + badge
├── content/
│   ├── interceptor.js     # world MAIN: membungkus fetch/XHR halaman
│   └── bridge.js          # world ISOLATED: jembatan ke background + tombol di halaman
├── popup.html / popup.css / popup.js
└── README.md
```

Alurnya satu arah: **interceptor** (konteks halaman) → `window.postMessage` →
**bridge** → `chrome.runtime.sendMessage` → **background** (klasifikasi provider →
simpan). Content script tidak tahu daftar provider sama sekali.

Logika murni (registry, dedupe entri, format clipboard, parsing cookie, reader)
dikunci oleh `test/authHelperExtension.test.ts` dan ikut jalan di `npm test`.

Penyimpanan: `chrome.storage.local` dengan satu map
`ah_tokens_v1 = { [providerId]: TokenEntry[] }`, ditambah `ah_app_url`.
Entri didedupe per akun (klaim `sub`, fallback sidik jari token) dan dibatasi
sesuai `max` di registry.

## Izin: apa yang dibuang

| Izin lama | Ekstensi yang memakainya | Sekarang |
| --- | --- | --- |
| `debugger` (`Network.enable`) | firefly-auth-helper | dihapus — diganti interceptor `fetch`/XHR di world MAIN, jadi tidak ada lagi prompt "extension ini bisa men-debug tab" |
| `webRequest` + `<all_urls>` | lemur-galleri5, firebase-token-ext, jwt-extractor-extension | dihapus — capture lewat interceptor di host provider + `chrome.scripting` saat diminta |
| `cookies` | oneover-token-ext | **dipertahankan** (sesi Supabase HttpOnly hanya terbaca dari sini) |
| `scripting`, `activeTab` | baru | dipakai untuk Scan + auto-scan ringan saat tab provider selesai dimuat |

`minimum_chrome_version` dinaikkan ke **111** karena content script `world: "MAIN"`
baru tersedia sejak versi itu.

## Migrasi dari ekstensi lama

| Ekstensi lama | Jadi apa di sini | Yang berubah |
| --- | --- | --- |
| `firefly-auth-helper` | provider **firefly** | Tidak perlu lagi klik *Start Capture* + prompt debugger dan tidak perlu klik *Generate* dulu; header tambahan (`x-api-key`, `x-gw-ims-user-id`, `x-arp-session-id`) yang dulu dihitung tapi tidak pernah dipakai sekarang benar-benar dipakai tombol Copy JSON. |
| `g5-auth-helper` | provider **galleri5** | Capture pindah dari `chrome.webRequest` (butuh `<all_urls>`) ke interceptor di halaman + IndexedDB. Refresh token kini ditampilkan & disalin, bukan hanya ID token. |
| `lemur-galleri5` | provider **galleri5** | Fitur "Send to ARKx" menjadi **Copy & buka Providers** dengan app URL yang bisa diatur (juga mendukung instance lokal). Bug `catch { e.message }` yang membuat pesan error refresh hilang sudah tidak ada jalur lagi. |
| `oneover-auth-helper` | provider **oneover** | Pembacaan cookie HttpOnly ikut diserap, plus refresh Supabase dan cek saldo. |
| `oneover-token-ext` | provider **oneover** | Tab Scan/Tokens/+/Diagnostic jadi satu halaman; diagnostik kini **tidak menampilkan potongan nilai cookie** — hanya nama, jumlah karakter, dan flag, supaya token sesi tidak pernah tampil di layar. |
| `firebase-token-ext` | provider **galleri5** | Capture, refresh Firebase, dan cek saldo `auth/me/info` diserap; `extensions/firebase-token.js` (CLI Node untuk refresh manual) tetap dipertahankan karena masih berguna di luar browser. |
| `jwt-extractor-extension` | provider **jwt** | Ekstensi lama memakai API `browser.*` (Firefox) sehingga background-nya **tidak pernah jalan di Chrome**; sekarang memakai `chrome.*`. Capture tidak lagi otomatis di seluruh `<all_urls>`, melainkan on-demand untuk tab yang sedang aktif. |

Ketujuh folder lama sudah dihapus (isinya tetap ada di riwayat git:
`git show HEAD:<path>`), dan hint Firefly di `src/pages/Providers.tsx` sudah
diarahkan ke ekstensi ini — termasuk membuang langkah *Start Capture*/*Grab Token*
yang tidak ada lagi.

## Menambah provider baru

1. Tambahkan entri di `PROVIDERS` (`providers.js`) — id, label, ink, `hosts`,
   `max`, `capture`, `readers`, `refresh`, `balance`, `copy`, `extras`, `hint`.
2. Tambahkan host-nya ke `host_permissions` (dan ke `content_scripts.matches` bila
   butuh capture otomatis) di `manifest.json`.
3. Bila perlu membaca storage/IndexedDB situsnya, tambahkan satu fungsi di
   `lib/readers.js` dan daftarkan di `READERS`.
4. Bila butuh refresh/cek saldo, tambahkan cabang di `background.js`
   (`refresh*Token` / `handleBalance`) lalu rujuk namanya dari registry.

Popup tidak perlu disentuh sama sekali — tab, tombol copy, dan labelnya mengikuti
registry.

## Catatan

- Token hanya disimpan di `chrome.storage.local` dan hanya dikirim ke API
  provider yang bersangkutan (tukar refresh token / cek saldo). Tidak ada server
  lain yang terlibat.
- `FIREBASE_API_KEY` dan anon key Supabase di `providers.js` adalah **client key
  publik** — nilainya memang ikut terkirim di setiap request browser dan yang
  melindungi data adalah policy di sisi server. Nilai yang sama sudah ada di
  `src/lib/galleri5.ts` dan `src/lib/oneover.ts`.
- Ikon ekstensi belum disertakan (Chrome memakai ikon default); tambahkan
  `icons/icon16|48|128.png` lalu daftarkan di `manifest.json` bila ingin tampil
  dengan ikon sendiri.
