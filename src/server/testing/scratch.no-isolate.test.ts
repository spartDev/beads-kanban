import { spawnSync } from 'node:child_process';
import { readdirSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { describe, expect, it } from 'vitest';
import { scratchDir } from './scratch';

/** La racine du dépôt : où est `vite.config.ts`, et `node_modules`. */
const ROOT = fileURLToPath(new URL('../../..', import.meta.url));
const VITEST = fileURLToPath(new URL('../../../node_modules/vitest/vitest.mjs', import.meta.url));
/** Ce qu'un worker de vitest ajoute à son environnement, et qu'un vitest lancé à partir de lui ne doit pas hériter. */
const FROM_VITEST = ['TEST', 'VITEST', 'VITEST_MODE', 'VITEST_WORKER_ID', 'VITEST_POOL_ID', 'NODE_ENV', 'FORCE_TTY', 'PROD', 'DEV', 'BASE_URL', 'MODE', 'SSR'];

/**
 * Sans isolation (`vitest --no-isolate`), plusieurs fichiers de tests tournent dans le même worker, et en partagent les modules : un registre et des crochets posés
 * une fois par worker ne servaient que le premier, et chaque fichier suivant laissait ses dossiers, sans que le refus de créer à la collecte joue encore (bdesk-38k.66,
 * relecture finale de bdesk-38k.60). Les trois fichiers de `isolation/` sont lancés ici dans un vitest à part, avec la configuration du dépôt, un seul worker et sans
 * isolation : tous doivent passer, et il ne doit rester aucun `bdesk-*` dans le dossier temporaire de ce vitest.
 */
describe('sans isolation : un registre par fichier de tests', () => {
  it('chaque fichier d’un même worker refuse de créer à la collecte et retire ses dossiers', () => {
    const tmp = scratchDir('bdesk-sans-isolation-');
    const env: NodeJS.ProcessEnv = { ...process.env, TMPDIR: tmp, NO_COLOR: '1' }; // sans couleurs : on lit le bilan de ce vitest
    for (const key of [...FROM_VITEST, 'FORCE_COLOR']) delete env[key];

    const run = spawnSync(process.execPath, [VITEST, 'run', '--project', 'node', '--no-isolate', '--maxWorkers=1', '--minWorkers=1', 'src/server/testing/isolation/'], {
      cwd: ROOT,
      env,
      encoding: 'utf8',
      timeout: 240_000,
    });

    expect(run.status, `${run.stdout}\n${run.stderr}`).toBe(0);
    expect(run.stdout + run.stderr).toMatch(/Test Files\s+3 passed/);
    expect(readdirSync(tmp).filter((name) => name.startsWith('bdesk-'))).toEqual([]);
  }, 300_000);
});
