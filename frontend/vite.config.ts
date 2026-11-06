import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { environment: 'node' },
})
