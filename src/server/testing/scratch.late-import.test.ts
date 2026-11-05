import { existsSync } from 'node:fs';
import { beforeAll, describe, expect, it, vi } from 'vitest';

/**
 * Ce fichier n'importe ni `scratch.ts` ni `fake-dolt.ts` en tête : il les charge, ou les recharge (`vi.resetModules()`), dans un crochet puis dans un test
 * (bdesk-38k.66, relecture finale de bdesk-38k.60). Les crochets du fichier ne dépendent donc pas du moment où le module est évalué : poser les siens à l'évaluation
 * les faisait arriver trop tard (vitest les ignore en plein fichier), et `scratchDir` annonçait « appelé à la collecte » alors qu'il l'était dans un `beforeAll`.
 */
describe('scratch.ts évalué dans un crochet ou dans un test', () => {
  let fromHook: { binary: string } | undefined;

  beforeAll(async () => {
    vi.resetModules();
    const { fakeDolt } = await import('./fake-dolt');
    fromHook = fakeDolt('echo ok');
  });

  it('dans un `beforeAll` : le dossier est créé, sans fausse alerte de collecte', () => {
    expect(existsSync(String(fromHook?.binary))).toBe(true);
  });

  it('dans un test : le dossier est créé de même', async () => {
    vi.resetModules();
    const { fakeDolt } = await import('./fake-dolt');

    expect(existsSync(fakeDolt('echo ok').binary)).toBe(true);
  });
});
