import { defineConfig } from 'vite';
import react from '@vitejs/plugin-react';

export default defineConfig({
  plugins: [react()],
  base: './',
  server: {
    port: 5173,
    watch: {
      // electron-builder's packaged output lives here; without this Vite's
      // watcher picks up its files and triggers spurious full-page reloads
      ignored: ['**/release/**']
    }
  },
  build: {
    outDir: 'dist'
  }
});
