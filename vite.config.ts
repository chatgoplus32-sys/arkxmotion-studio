import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwindcss from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: {
    alias: {
      '@': '/src',
    },
  },
  server: {
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
      '/roboneo': {
        target: 'https://webapi.roboneo.com',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/roboneo/, ''),
      },
      '/catbox': {
        target: 'https://catbox.moe',
        changeOrigin: true,
        rewrite: (path) => path.replace(/^\/catbox/, '/user/api.php'),
      },
    },
  },
})
