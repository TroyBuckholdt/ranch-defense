import { defineConfig } from 'vite';

export default defineConfig({
  root: 'client',
  publicDir: 'public',
  build: { outDir: '../dist', emptyOutDir: true, chunkSizeWarningLimit: 1500 },
  server: {
    port: 5173,
    proxy: { '/ws': { target: 'ws://localhost:3000', ws: true } },
    fs: { allow: ['..'] },
  },
});
