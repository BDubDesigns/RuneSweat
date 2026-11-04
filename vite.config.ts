import { defineConfig } from 'vite';

export default defineConfig({
  // Static hosting (GitHub Pages etc.): relative asset paths.
  base: './',
  build: {
    outDir: 'dist',
    sourcemap: true,
  },
  server: {
    port: 5173,
  },
});
