import react from '@vitejs/plugin-react'
import { defineConfig } from 'vitest/config'

export default defineConfig({
  plugins: [react()],
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
            { name: 'mui', test: /node_modules[\\/](@mui|@emotion)/ },
          ],
        },
      },
    },
  },
  optimizeDeps: { exclude: ['maplibre-gl'] },
  test: { environment: 'node' },
})
