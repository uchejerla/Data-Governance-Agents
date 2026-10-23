import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

const WORKER_ORIGIN = 'http://127.0.0.1:8787';

export default defineConfig({
  plugins: [react()],
  server: {
    host: '0.0.0.0',
    port: 3000,
    strictPort: true,
    allowedHosts: ['pv-47f1232029da-35918a1a-d265-40f0-80e4-e78f95fcadc2.style.dev'],
    // The Worker owns sessions and the decisions API. Proxying keeps the browser
    // on one origin (so cookies and same-origin checks behave as they do deployed).
    proxy: {
      '/api': WORKER_ORIGIN,
      '/auth/freebuff': WORKER_ORIGIN,
    },
  },
});
