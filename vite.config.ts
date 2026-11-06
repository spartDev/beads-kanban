import tailwindcss from '@tailwindcss/vite';
import react from '@vitejs/plugin-react';
import { defineConfig } from 'vite';
import { frameAncestorsPlugin } from './src/server/framing';

export default defineConfig({
  root: 'src/web',
  // Le greffon d'encadrement en premier : en développement c'est Vite qui sert la page, et il refuse d'être encadré par une page d'un autre site comme le serveur de production
  // (bdesk-38k.67). Un greffon et pas `server.headers`, que Vite 6.4.4 n'applique pas à la 304 d'une page revalidée : voir `refuseFramingInDev`, src/server/framing.ts.
  plugins: [frameAncestorsPlugin(), react(), tailwindcss()],
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
        test: {
          name: 'node',
          environment: 'node',
          include: ['src/{domain,server}/**/*.test.ts'],
          // Le registre des dossiers temporaires de chaque fichier et les crochets qui les retirent à sa fin (src/server/testing/scratch.ts) : posés avant chaque fichier,
          // `--no-isolate` compris, où les fichiers d'un même worker partagent leurs modules.
          setupFiles: ['src/server/testing/setup.ts'],
        },
      },
      // Interface : jsdom (stubs du navigateur dans src/web/test/setup.ts).
      {
        extends: true,
        test: {
          name: 'web',
          environment: 'jsdom',
          include: ['src/web/**/*.test.{ts,tsx}'],
          setupFiles: ['src/web/test/setup.ts'],
          // Un test qui monte l'application entière dure 10 à 25 fois plus quand la machine est chargée (la suite en parallèle, d'autres
          // processus) : les plus longs passent alors les 5 s de vitest. Ce délai doit valoir au moins le double des attentes de Testing
          // Library, qui montent à 5 s (`withAsyncTimeout`), sinon « Test timed out » les coupe avant le DOM : elles le vérifient avant
          // chaque test.
          testTimeout: 20_000,
          // Les crochets (10 s par défaut) ont le même délai : `warmUpMetricsPages` lit le module des graphiques dans un `beforeAll`, et
          // cette lecture s'allonge comme un test.
          hookTimeout: 20_000,
        },
      },
    ],
  },
});
