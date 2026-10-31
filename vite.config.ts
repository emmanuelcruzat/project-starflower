import { defineConfig } from 'vite';

// Two pages: the homepage at / (index.html) and the game at /play/
// (play/index.html). Both are built; in development Vite serves them as is.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        play: 'play/index.html',
      },
    },
  },
});
