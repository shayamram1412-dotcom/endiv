import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';
import tailwindcss from '@tailwindcss/vite';
import { fileURLToPath } from 'node:url';

export default defineConfig({
  root: 'web',
  plugins: [react(), tailwindcss()],
  resolve: { alias: { '@shared': fileURLToPath(new URL('./shared', import.meta.url)) } },
  build: { outDir: '../dist', emptyOutDir: true },
  // A second copy (e.g. a test run on copied data) can run beside the main one: WEB_PORT / API_PORT.
  server: {
    port: Number(process.env.WEB_PORT ?? 5173),
    proxy: { '/api': { target: `http://localhost:${process.env.API_PORT ?? 8787}`, changeOrigin: false } },
  },
});
