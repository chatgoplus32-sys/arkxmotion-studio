import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { roboneoProxyPlugin } from './vite-plugin-roboneo.js'
import path from 'path'
import { fileURLToPath } from 'url'

// ── Path alias: '@/' → src/ ──
// Hitung absolute path relatif ke file config ini. PENTING (Windows): pakai
// fileURLToPath — new URL(...).pathname menghasilkan "/D:/KOKO%20MITION/..."
// (URL-encode + leading slash) yang tidak valid sebagai filesystem path dan
// bikin build error "The filename, directory name, or volume label syntax
// is incorrect".
const __dirname = path.dirname(fileURLToPath(import.meta.url))

export default defineConfig({
  plugins: [react(), tailwindcss(), roboneoProxyPlugin()],
  resolve: {
    alias: {
      '@': path.resolve(__dirname, 'src'),
    },
  },
  build: {
    chunkSizeWarningLimit: 600,
  },
  server: {
    proxy: {
      '/catbox': {
        target: 'https://catbox.moe',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/catbox/, '/user/api.php'),
      },
      '/api': {
        target: 'http://localhost:6000',
        changeOrigin: true,
      },
    },
  },
})
