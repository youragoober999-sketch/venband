import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'

export default defineConfig({
  plugins: [react()],
  server: {
    // `npm run dev` talks to a deployed copy (or `vercel dev` on port 3000) for /api and /v1.
    proxy: {
      '/api': process.env.VIX_API_ORIGIN || 'http://localhost:3000',
      '/v1': process.env.VIX_API_ORIGIN || 'http://localhost:3000',
    },
  },
  build: {
    chunkSizeWarningLimit: 1500,
  },
})
