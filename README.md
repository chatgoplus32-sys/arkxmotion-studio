# React + TypeScript + Vite

This template provides a minimal setup to get React working in Vite with HMR and some Oxlint rules.

Currently, two official plugins are available:

- [@vitejs/plugin-react](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react) uses [Oxc](https://oxc.rs)
- [@vitejs/plugin-react-swc](https://github.com/vitejs/vite-plugin-react/blob/main/packages/plugin-react-swc) uses [SWC](https://swc.rs/)

## React Compiler

The React Compiler is not enabled on this template because of its impact on dev & build performances. To add it, see [this documentation](https://react.dev/learn/react-compiler/installation).

## Expanding the Oxlint configuration

If you are developing a production application, we recommend enabling type-aware lint rules by installing `oxlint-tsgolint` and editing `.oxlintrc.json`:

```json
{
  "$schema": "./node_modules/oxlint/configuration_schema.json",
  "plugins": ["react", "typescript", "oxc"],
  "options": {
    "typeAware": true
  },
  "rules": {
    "react/rules-of-hooks": "error",
    "react/only-export-components": ["warn", { "allowConstantExport": true }]
  }
}
```

See the [Oxlint rules documentation](https://oxc.rs/docs/guide/usage/linter/rules) for the full list of rules and categories.

## Deploy frontend ke VPS

Selalu pakai skrip ini untuk deploy frontend, jangan unggah tar manual. Skrip
menghapus `dist/` lama di server SEBELUM ekstrak, jadi chunk hasil build
terdahulu tidak menumpuk.

```bash
python deploy_dist.py              # build -> unggah -> restart pm2 -> tunggu health 200
python deploy_dist.py --no-build   # pakai dist/ hasil build terakhir (tanpa npm run build)
python deploy_dist.py --check      # hanya cek kredensial VPS, tidak unggah / tidak restart
```

Langkah yang dijalankan `deploy_dist.py`:

1. `npm run build` (dilewati kalau `--no-build`)
2. arsip `dist/` ke `.tmpdbg/dist.tar.gz`
3. unggah arsip ke `/tmp/arkxmotion_dist_upload.tar.gz`
4. `rm -rf dist && tar -xzf` di folder remote (`VPS_REMOTE_DIR`, default `/opt/arkxmotion-studio`)
5. `pm2 restart arkxmotion --update-env`
6. polling `http://127.0.0.1:6000/api/health/live` sampai 200 (maks 60 detik); keluar dengan
   status bukan 0 kalau proses server tidak hidup, supaya kegagalan deploy tidak lolos diam-diam.
   Endpoint `/api/health` tetap menyediakan pemeriksaan database dan layanan upstream yang lebih rinci.

Kredensial dibaca dari `.env` lewat `deploy_config.py` (`VPS_HOST`, `VPS_PORT`,
`VPS_USER`, `VPS_PASSWORD`, opsional `VPS_REMOTE_DIR`). Tidak ada kredensial di
dalam skrip deploy.

`deploy_vps.py` tetap dipakai kalau perubahan menyentuh kode server (`server/**`),
karena skrip itu ikut mengunggah sumber dan melakukan deploy penuh. Untuk
perubahan frontend saja, `deploy_dist.py` lebih cepat dan dijamin bersih.
