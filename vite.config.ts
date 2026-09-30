import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  plugins: [react()],
  server: {
    port: 5173,
    // Fail loudly rather than sliding to 5174: the backend's CORS allow-list
    // names 5173 explicitly, so a silent port change would break the app in a
    // way that looks like a bug in the fetch layer.
    strictPort: true,
    proxy: {
      // Same-origin in the browser, so CORS never enters the picture during
      // development. The allow-list in main.py stays as the belt to this
      // brace, and still matters the moment the frontend is served elsewhere.
      '/api': { target: 'http://localhost:8000', changeOrigin: true },
    },
  },
});
