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
4. Biarkan **Auto-sync token ke app** menyala (default) dan pastikan tab app
   dalam keadaan login: token terbaik tiap provider dikirim sendiri ke
   `/api/sync-tokens`, jadi halaman **Providers** tidak perlu ditempeli apa pun.
   Tombol **Kirim sekarang** memaksa kirim ulang, dan status percobaan terakhir
   tampil di bawah sakelarnya.
5. Kalau auto-sync dimatikan atau app tidak pernah dibuka, tombol Copy tetap ada:
   salin lalu tempel manual di halaman **Providers**; **Copy & buka Providers**
   menyalin token sekaligus membuka halamannya.

| Provider | Sumber capture | Default Copy | Refresh | Cek saldo | Field app |
| --- | --- | --- | --- | --- | --- |
| G5 AI Studio | interceptor jaringan + IndexedDB `firebaseLocalStorage` | refresh token (`AMf-…`); ID token lewat tombol kedua | Firebase `securetoken` | `GET /api/v1/auth/me/info` | `galleri5` |
| OneOver | interceptor + `localStorage` Supabase + cookie HttpOnly (`chrome.cookies`) | JSON `{ access_token, refresh_token }` | Supabase `auth/v1/token` | `get-credit-balance` | `oneover` |
| Adobe Firefly | interceptor jaringan (tanpa `debugger`) + pemindaian Web Storage | Bearer IMS token; JSON `{ token, apiKey, account, session }` lewat tombol kedua | — (token ~1 jam) | — | `firefly` |
| JWT generik | pemindaian tab saat diminta (`activeTab`) | token apa adanya | — | — | untuk Leonardo, Framia, dll. |

## Auto-sync ke app

Ekstensi ini bisa mengirim token sendiri ke app — alur yang sama dengan
`riverside-token-ext` dan `nexabot-token-ext`, jadi token G5/OneOver/Firefly
tidak perlu disalin ke halaman Providers:

1. **JWT app diambil, bukan diminta.** App menyimpan JWT login di
   `localStorage.arkxmotion_token`; ekstensi membacanya dengan
   `chrome.scripting` dari tab app yang Anda buka sendiri, lalu memakainya
   sebagai `Authorization: Bearer` saat `POST /api/sync-tokens`.
2. **Hanya origin app itu yang menerima credential.** Kiriman selalu menuju
   origin tab tempat JWT diambil (App URL pilihan Anda + kandidat lokal/Vercel).
   Host lain tidak pernah dikirimi token provider: JWT yang ditandatangani satu
   server akan ditolak 401 di server lain, dan mengirim ke tempat lain berarti
   membocorkan token Anda.
3. **Yang dikirim adalah token terbaik provider** (`bestEntry`: yang belum
   kedaluwarsa dan punya refresh token) dengan format dari `sync.prefer` di
   registry — G5 & OneOver mengirim **refresh token** (app menukarnya sendiri),
   Firefly mengirim **access token** karena IMS tidak punya refresh.
4. **Dedupe, bukan spam.** Sidik jari token disimpan per provider sehingga token
   yang sama tidak dikirim dua kali. Pemicunya: setiap capture/scan/simpan
   manual, setiap refresh token, dan saat tab app selesai dimuat — supaya token
   yang gagal terkirim ketika server mati ikut tercoba lagi.
5. **Kegagalan tidak pernah mengganggu.** Server app mati atau belum login hanya
   tercatat sebagai status gagal di popup; token tetap tersimpan lokal dan bisa
   dikirim manual lewat **Kirim sekarang** atau disalin seperti biasa.

`providers.js` tetap satu-satunya tempat daftar ini hidup: provider tanpa kunci
`sync` (mis. JWT generik) otomatis kehilangan tombol sync di popup, jadi tidak
ada daftar kedua yang bisa lupa diperbarui. Sisi app-nya adalah
`AUTO_SYNC_PROVIDERS` di `src/lib/tokenAutoSync.ts` — provider baru harus
terdaftar di **kedua** tempat agar polling app mengambilnya.

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
│   ├── appSync.js         # auto-sync: JWT app dari tab + POST /api/sync-tokens
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
`ah_tokens_v1 = { [providerId]: TokenEntry[] }`, ditambah `ah_app_url`,
`ah_sync_enabled`, `ah_sync_status`, `ah_sync_sent` (auto-sync), dan
`ah_app_token` / `ah_app_token_origin` (JWT app hasil bacaan tab, dibuang
begitu server menolaknya dengan 401).
Entri didedupe per akun (klaim `sub`, fallback sidik jari token) dan dibatasi
sesuai `max` di registry.

## Izin: apa yang dibuang

| Izin lama | Ekstensi yang memakainya | Sekarang |
| --- | --- | --- |
| `debugger` (`Network.enable`) | firefly-auth-helper | dihapus — diganti interceptor `fetch`/XHR di world MAIN, jadi tidak ada lagi prompt "extension ini bisa men-debug tab" |
| `webRequest` + `<all_urls>` | lemur-galleri5, firebase-token-ext, jwt-extractor-extension | dihapus — capture lewat interceptor di host provider + `chrome.scripting` saat diminta |
| `cookies` | oneover-token-ext | **dipertahankan** (sesi Supabase HttpOnly hanya terbaca dari sini) |
| `scripting`, `activeTab` | baru | dipakai untuk Scan + auto-scan ringan saat tab provider selesai dimuat, plus membaca `localStorage` tab app untuk auto-sync |

Host di luar situs provider yang diminta hanya untuk **app sendiri**
(`http://localhost/*`, `http://127.0.0.1/*`, `https://*.vercel.app/*`) karena
auto-sync perlu membaca `localStorage` tab app dan memanggil
`/api/sync-tokens`. Tidak ada `<all_urls>` — ekstensi tetap tidak bisa melihat
situs lain.

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
   `max`, `capture`, `readers`, `refresh`, `balance`, `copy`, `extras`, `sync`,
   `hint`.
2. Tambahkan host-nya ke `host_permissions` (dan ke `content_scripts.matches` bila
   butuh capture otomatis) di `manifest.json`.
3. Bila perlu membaca storage/IndexedDB situsnya, tambahkan satu fungsi di
   `lib/readers.js` dan daftarkan di `READERS`.
4. Bila butuh refresh/cek saldo, tambahkan cabang di `background.js`
   (`refresh*Token` / `handleBalance`) lalu rujuk namanya dari registry.
5. Bila app punya slot untuk provider itu, tambahkan `sync: { provider, prefer }`
   di registry **dan** entri senama di `AUTO_SYNC_PROVIDERS`
   (`src/lib/tokenAutoSync.ts`) plus cabang cek saldonya — tanpa keduanya, tombol
   Kirim sekarang hanya jadi tombol mati.

Popup tidak perlu disentuh sama sekali — tab, tombol copy, dan labelnya mengikuti
registry.

## Catatan

- Token disimpan di `chrome.storage.local` dan hanya dikirim ke dua tujuan:
  API provider yang bersangkutan (tukar refresh token / cek saldo) dan — bila
  auto-sync aktif — origin app Anda sendiri lewat `/api/sync-tokens`. Tidak ada
  server pihak ketiga yang terlibat.
- `FIREBASE_API_KEY` dan anon key Supabase di `providers.js` adalah **client key
  publik** — nilainya memang ikut terkirim di setiap request browser dan yang
  melindungi data adalah policy di sisi server. Nilai yang sama sudah ada di
  `src/lib/galleri5.ts` dan `src/lib/oneover.ts`.
- Ikon ekstensi belum disertakan (Chrome memakai ikon default); tambahkan
  `icons/icon16|48|128.png` lalu daftarkan di `manifest.json` bila ingin tampil
  dengan ikon sendiri.
