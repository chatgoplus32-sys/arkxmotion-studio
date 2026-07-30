# Upload Catbox Worker

Cloudflare Worker proxy untuk upload ke catbox.moe (bypass Vercel IP block).

## Deploy

```bash
cd workers/upload-catbox
npx wrangler deploy
```

Worker akan deploy ke: `https://upload-catbox.<YOUR_SUBDOMAIN>.workers.dev`

## Update Endpoint

Setelah deploy, update `api/public/upload-catbox.ts` line 6:

```ts
const CF_WORKER_URL = 'https://upload-catbox.YOUR_SUBDOMAIN.workers.dev'
```
