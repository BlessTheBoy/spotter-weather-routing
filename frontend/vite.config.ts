import tailwindcss from '@tailwindcss/vite'
import react from '@vitejs/plugin-react'
import path from 'node:path'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@': path.resolve(import.meta.dirname, './src') } },
  server: {
    proxy: { '/api': 'http://localhost:8000' },
  },
  build: {
    chunkSizeWarningLimit: 1200, // maplibre-gl alone is ~1 MB minified
    rolldownOptions: {
      output: {
        // Long-lived vendor chunks: app changes don't invalidate the map engine or UI kit.
        codeSplitting: {
          groups: [
            { name: 'maplibre', test: /node_modules[\\/]maplibre-gl/ },
            { name: 'ui', test: /node_modules[\\/](@radix-ui|cmdk|react-day-picker|date-fns|lucide-react)/ },
          ],
        },
      },
    },
  },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { environment: 'node' },
})
