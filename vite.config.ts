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
  server: {
    proxy: {
      '/api/auth': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/api/admin': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/catbox': {
        target: 'https://catbox.moe',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/catbox/, '/user/api.php'),
      },
    },
  },
})
