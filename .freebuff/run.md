# ArkxMotion Studio — Preview Run Doc

## How to reproduce artifacts
1. `node_modules` already present — run `npm install` if missing.
2. `.env` is already present in the checkout root. If missing, copy from main checkout:
   ```
   copy D:\KOKO MITION\clone\.env D:\KOKO MITION\clone\.env
   ```

## How to run the dev server
1. Start Vite dev server (default port 5173):
   ```
   npm run dev
   ```
2. `vite-plugin-roboneo.ts` forwards most `/api/public/*` paths to the local
   Express backend first (`:6000`, `npm run dev:server`), and falls back to the
   production site (https://arkxmotion-studio.win) only when that backend is not
   running. Exception: `tiktok-download`, `upload-catbox`, and `firefly` POST
   straight to production — the local-first path was never wired for those three.
   Production is the VPS — there is no Vercel deployment anymore.
   The `/api` routes (auth, tokens, admin) proxy to `localhost:6000` (Express backend)
   — not needed for the preview UI.

## Preview ports
- Vite: 5173
- Express backend: 6000 (not required for preview)

## Status
- Server confirmed running on port 5173, PID 10928, HTTP 200
- Vite serves React SPA with `@react-refresh` injection
