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
2. The Vite dev server proxies `/api/public/*` requests to the production Vercel
   deployment via `vite-plugin-roboneo.ts`, so the frontend renders standalone.
   The `/api` routes (auth, tokens, admin) proxy to `localhost:6000` (Express backend)
   — not needed for the preview UI.

## Preview ports
- Vite: 5173
- Express backend: 6000 (not required for preview)

## Status
- Server confirmed running on port 5173, PID 10928, HTTP 200
- Vite serves React SPA with `@react-refresh` injection
