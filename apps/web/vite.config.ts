import { defineConfig } from 'vite'
import react from '@vitejs/plugin-react'
import tailwind from '@tailwindcss/vite'

export default defineConfig({
  plugins: [react(), tailwind()],
  base: '/app/',
  build: { outDir: 'dist', emptyOutDir: true, sourcemap: true },
  server: {
    port: 5173,
    proxy: {
      '/claims': 'http://localhost:3001',
      '/resume': 'http://localhost:3001',
      '/sessions': 'http://localhost:3001',
      '/ledger': 'http://localhost:3001',
      '/schedule': 'http://localhost:3001',
      '/review': 'http://localhost:3001',
      '/export': 'http://localhost:3001',
      '/privacy': 'http://localhost:3001',
      '/jobs': 'http://localhost:3001',
      '/roles': 'http://localhost:3001',
      '/topics': 'http://localhost:3001',
      '/formats': 'http://localhost:3001',
      '/rubrics': 'http://localhost:3001',
      '/personas': 'http://localhost:3001',
      '/actions': 'http://localhost:3001',
      '/snapshots': 'http://localhost:3001',
      '/benchmark': 'http://localhost:3001',
      '/mirror': 'http://localhost:3001',
      '/analytics': 'http://localhost:3001',
      '/health': 'http://localhost:3001',
    },
  },
})
