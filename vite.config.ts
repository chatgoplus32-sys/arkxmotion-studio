import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'
import { roboneoProxyPlugin } from './vite-plugin-roboneo.js'

export default defineConfig({
  plugins: [react(), tailwindcss(), roboneoProxyPlugin()],
  resolve: {
    alias: {
      '@': '/src',
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
