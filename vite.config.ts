import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    // En développement, l'API (src/server, `--dev`) tourne à part : tout ce qui commence par /api lui est transmis.
    proxy: { '/api': { target: 'http://127.0.0.1:5179' } },
  },
  test: {
    root: '.',
    projects: [
      // Serveur et domaine : Node, sans DOM.
      {
        extends: true,
        test: { name: 'node', environment: 'node', include: ['src/{domain,server}/**/*.test.ts'] },
      },
      // Interface : jsdom (stubs du navigateur dans src/web/test/setup.ts).
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['src/web/test/setup.ts'],
        },
      },
    ],
  },
});
