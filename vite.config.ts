import { resolve } from 'node:path';
import { defineConfig } from 'vitest/config';

// Multi-page build: the landing page has no 3D code at all.
// Each lesson is its own page, so Three.js loads only when a lesson opens.
export default defineConfig({
  // GitHub Pages serves the site from /<repo-name>/
  base: process.env.GITHUB_ACTIONS ? '/ame-3d-lessons/' : '/',
  build: {
    target: 'es2020',
    // Three.js is ~150 KB gzipped and loads only on lesson pages.
    chunkSizeWarningLimit: 700,
    rollupOptions: {
      input: {
        main: resolve(__dirname, 'index.html'),
        magnus: resolve(__dirname, 'lessons/magnus/index.html'),
      },
    },
  },
  server: { port: Number(process.env.PORT) || 5183 },
  test: {
    include: ['tests/**/*.test.ts'],
  },
});
