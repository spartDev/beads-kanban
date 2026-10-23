import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseArgs } from 'node:util';
import open from 'open';
import { loadConfig } from './config';
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

await startServer({ config, webRoot, port, allowAnyLocalPort: values.dev });

const url = `http://${HOST}:${port}`;
console.log(`beads-desktop → ${url}`);
console.log(`Racines scannées : ${config.roots.join(', ')}`);
if (!values.dev && !values['no-open']) await open(url);
