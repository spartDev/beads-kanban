import { existsSync } from 'node:fs';
import { expect, it } from 'vitest';
import { fakeDolt } from '../fake-dolt';
import { scratchDir } from '../scratch';

/**
 * Ce que chacun des trois fichiers `worker-N.test.ts` vérifie (bdesk-38k.66). `scratch.no-isolate.test.ts` les lance ensemble, dans un seul worker et sans isolation
 * (`--no-isolate`) : ils partagent alors le processus et ses modules, et chacun doit pourtant avoir son registre, refuser de créer un dossier à la collecte, et retirer
 * ses dossiers à sa fin. Lancés comme les autres tests, avec isolation, ils ne vérifient que cela.
 */
export function checkScratchFile(): void {
  // À la collecte du fichier : aucun crochet n'a encore tourné, `scratchDir` doit le refuser, y compris pour le deuxième fichier d'un worker.
  const atCollection = (() => {
    try {
      scratchDir('bdesk-collecte-');
    } catch (error) {
      return error;
    }
    return undefined;
  })();

  it('refuse de créer un dossier à la collecte', () => {
    expect(atCollection).toBeInstanceOf(Error);
  });

  it('crée un dossier, que la fin du fichier retire', () => {
    expect(existsSync(fakeDolt('echo ok').binary)).toBe(true);
  });
}
