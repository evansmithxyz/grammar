import { defineConfig } from 'vite';

export default defineConfig({
  // relative asset paths, so dist/ works from any folder or host path
  base: './',
  build: {
    // fonts ride inside the CSS as data URIs
    assetsInlineLimit: (file) => (/\.woff2?$/.test(file) ? true : undefined),
    // one page, one bundle; most of it is the compromise tagger
    chunkSizeWarningLimit: 700,
  },
});
