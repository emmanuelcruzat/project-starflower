import { defineConfig } from 'vite';

// Three pages: the homepage at / (index.html), the game at /play/
// (play/index.html), and the account page mockup at /account/
// (account/index.html). All are built; in development Vite serves them as is.
export default defineConfig({
  build: {
    rollupOptions: {
      input: {
        home: 'index.html',
        play: 'play/index.html',
        account: 'account/index.html',
      },
    },
  },
});
