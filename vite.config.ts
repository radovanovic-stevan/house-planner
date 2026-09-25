import { defineConfig } from 'vite';

export default defineConfig({
  build: {
    // three.js alone is ~600 kB; one bundle is fine for a local tool
    chunkSizeWarningLimit: 1000,
  },
});
