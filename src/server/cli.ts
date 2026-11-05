import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import open from 'open';
import { loadConfig } from './config';
import { createProjectService } from './projects/service';
import { DEFAULT_PORT, HOST, startServer } from './server';

const { values } = parseArgs({
  options: {
    port: { type: 'string', default: String(DEFAULT_PORT) },
    dev: { type: 'boolean', default: false },
    'no-open': { type: 'boolean', default: false },
  },
});

const config = loadConfig();
// En production, cli.js est compilé dans dist/ à côté de l'interface (dist/web).
const webRoot = values.dev ? undefined : join(dirname(fileURLToPath(import.meta.url)), 'web');
const port = Number(values.port);

const projects = createProjectService(config);
// Journal du serveur : les avertissements seulement (un Projet dont la lecture échoue, par exemple), pas les requêtes.
await startServer({ config, webRoot, projects, port, allowAnyLocalPort: values.dev, logger: { level: 'warn' } });

// Le premier scan des Projets part dès que le serveur écoute, avant que le navigateur ne demande la liste (bdesk-38k.43) : c'est le seul qui lit
// le préfixe de chaque Projet (les suivants ne relisent que ce qui a changé), et il se déroule pendant que le navigateur s'ouvre et charge
// l'interface. Pas en développement : `tsx watch` relance le serveur à chaque modification du code, et personne n'attend la liste.
// Un échec n'est gardé que 500 ms, plus s'il se répète, au plus 5 s (`rescanIntervalMs`, bdesk-38k.47) : une demande de la liste qui arrive ensuite
// réessaie, la nouvelle tentative automatique du client (une seconde après une 500) comprise.
if (!values.dev) void projects.list().catch(() => undefined);

const url = `http://${HOST}:${port}`;
console.log(`beads-desktop → ${url}`);
console.log(`Racines scannées : ${config.roots.join(', ')}`);
if (!values.dev && !values['no-open']) await open(url);
