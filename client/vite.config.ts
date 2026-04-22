import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

const API_TARGET = process.env.VITE_API_TARGET || 'http://localhost:4001'
const WS_TARGET = process.env.VITE_WS_TARGET || 'ws://localhost:4001'

/** Do not use `PORT` here — it must stay free for the API server (default 4001). */
const DEV_CLIENT_PORT = Number(process.env.VITE_PORT || process.env.CLIENT_PORT) || 5173

export default defineConfig({
  plugins: [react()],
  server: {
    host: true,
    port: DEV_CLIENT_PORT,
    strictPort: false,
    proxy: {
      '/api': {
        target: API_TARGET,
        changeOrigin: true,
      },
      '/ws': {
        target: WS_TARGET,
        ws: true,
      },
    },
  },
  preview: {
    host: true,
    port: Number(process.env.PREVIEW_PORT) || 4173,
  },
})
