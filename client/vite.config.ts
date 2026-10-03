import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    proxy: {
      '/api': {
        target: 'http://localhost:3001',
        changeOrigin: true,
      },
    },
    // Coalesce OneDrive / cloud-sync mtime storms so the page does not full-reload in a loop.
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 800,
        pollInterval: 100,
      },
    },
  },
});
