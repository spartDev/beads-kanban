import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';

export default defineConfig({
  root: 'src/web',
  plugins: [react(), tailwindcss()],
  build: { outDir: '../../dist/web', emptyOutDir: true },
  server: {
    // En développement, l'API (src/server, `--dev`) tourne à part : tout ce qui commence par /api lui est transmis.
    proxy: {
      '/api': {
        target: 'http://127.0.0.1:5179',
        // http-proxy ne relaie pas à l'API le départ du navigateur tant qu'elle n'a pas commencé à répondre (sa requête est déjà lue
        // quand il part) : sans cela, l'API lirait Dolt pour un onglet parti (bdesk-38k.20). Un flux d'événements, lui, se ferme déjà.
        configure: (proxy) => {
          proxy.on('proxyReq', (proxyReq, _req, res) => {
            res.on('close', () => {
              if (!res.writableFinished) proxyReq.destroy();
            });
          });
        },
      },
    },
  },
  test: {
    root: '.',
    // `forks` est déjà le pool par défaut de Vitest 3 ; on le fixe parce que `poolOptions.forks` ne vaut que pour lui. `--expose-gc` s'applique ainsi à
    // tous les processus de tests, `web` compris (le type n'accepte `execArgv` qu'ici, pas par projet) : les tests de mémoire
    // (metrics/service.test.ts) demandent un ramasse-miettes à V8, et échouent avec un message clair sous un autre pool (`--pool=threads`).
    pool: 'forks',
    poolOptions: { forks: { execArgv: ['--expose-gc'] } },
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
