import { chmodSync, existsSync, readFileSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { scratchDir } from './scratch';

/**
 * Un faux binaire `dolt` : un script shell qui rejoue `body`, avec un compteur d'appels (`calls`). Dans `body`, `$n` est le
 * numéro de l'appel, `$5` la requête reçue (`dolt sql -r json -q <requête>`) et `$(dirname "$0")` le dossier du script,
 * où poser des fichiers témoins. Son dossier est retiré à la fin du fichier de tests (voir `scratchDir`).
 */
export function fakeDolt(body: string): { binary: string; dir: string; calls: () => number } {
  const dir = scratchDir('bdesk-fake-dolt-');
  const counter = join(dir, 'calls');
  const binary = join(dir, 'dolt');
  writeFileSync(binary, `#!/bin/sh\necho x >> '${counter}'\nn=$(wc -l < '${counter}' | tr -d ' ')\n${body}\n`);
  chmodSync(binary, 0o755);
  const calls = () => (existsSync(counter) ? readFileSync(counter, 'utf8').split('\n').filter(Boolean).length : 0);
  return { binary, dir, calls };
}

/**
 * Le `rootPath` d'un client Dolt qui lance un faux binaire : un dossier de configuration jetable, que le client prépare (`config_global.json`) et que
 * le fichier de tests retire à sa fin. Un chemin fixe sous le dossier temporaire (c'était `bdesk-fake-dolt-root`) y serait resté après la suite.
 */
export const fakeDoltRoot = (): string => scratchDir('bdesk-fake-dolt-root-');
