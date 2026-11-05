import { chmodSync, existsSync, mkdtempSync, readFileSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

/**
 * Un faux binaire `dolt` : un script shell qui rejoue `body`, avec un compteur d'appels (`calls`). Dans `body`, `$n` est le
 * numéro de l'appel, `$5` la requête reçue (`dolt sql -r json -q <requête>`) et `$(dirname "$0")` le dossier du script,
 * où poser des fichiers témoins.
 */
export function fakeDolt(body: string): { binary: string; dir: string; calls: () => number } {
  const dir = mkdtempSync(join(tmpdir(), 'bdesk-fake-dolt-'));
  const counter = join(dir, 'calls');
  const binary = join(dir, 'dolt');
  writeFileSync(binary, `#!/bin/sh\necho x >> '${counter}'\nn=$(wc -l < '${counter}' | tr -d ' ')\n${body}\n`);
  chmodSync(binary, 0o755);
  const calls = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  return { binary, dir, calls };
}
