import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

// The dev proxy keeps the API same-origin, so the SameSite=Strict refresh cookie just works.
export default defineConfig({
  plugins: [react()],
  server: { port: 5173, allowedHosts: ['.trycloudflare.com'], proxy: { '/api': 'http://localhost:4000' } },
});
