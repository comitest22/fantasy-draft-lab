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
        // Nodemon restarts drop in-flight proxies; don't spam the terminal.
        configure: (proxy) => {
          proxy.on('error', (err, _req, res) => {
            const code = (err as NodeJS.ErrnoException).code;
            if (code === 'ECONNREFUSED' || code === 'ECONNRESET' || code === 'EPIPE') {
              if (res && 'writeHead' in res && typeof res.writeHead === 'function' && !res.headersSent) {
                res.writeHead(502, { 'Content-Type': 'application/json' });
                res.end(JSON.stringify({ error: 'API restarting — retrying…' }));
              }
              return;
            }
            console.error('[vite proxy]', err.message);
          });
        },
      },
    },
    // Coalesce cloud-sync / bulk-write mtime storms so the page does not full-reload in a loop.
    watch: {
      awaitWriteFinish: {
        stabilityThreshold: 1500,
        pollInterval: 200,
      },
    },
  },
});
