import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { assertOutlasts, withAsyncTimeout } from './asyncTimeout';

/** Le délai que `findBy…` et `waitFor` accordent à cet instant. */
const timeout = () => getConfig().asyncUtilTimeout;

// Ce que le lanceur a laissé : la seconde de Testing Library.
const launchedWith = timeout();

describe('withAsyncTimeout', () => {
  describe('le temps d’un bloc', () => {
    withAsyncTimeout(7_000);

    it('change le délai de findBy et de waitFor', () => {
      expect(timeout()).toBe(7_000);
    });

    describe('et d’un bloc dans le bloc', () => {
      withAsyncTimeout(9_000);

      it('donne au bloc intérieur son propre délai', () => {
        expect(timeout()).toBe(9_000);
      });
    });

    it('rend au bloc extérieur son délai quand le bloc intérieur est fini', () => {
      expect(timeout()).toBe(7_000);
    });
  });

  it('rend le délai tel que le lanceur l’a laissé, une fois le bloc fini', () => {
    expect(launchedWith).toBe(1_000);
    expect(timeout()).toBe(launchedWith);
  });

  describe('un bloc qui attend 5 s, comme les fichiers qui montent l’application', () => {
    withAsyncTimeout(5_000);

    it('laisse au test, tel que le projet web le règle, au moins le double de l’attente', ({ task }) => {
      expect(task.timeout).toBeGreaterThanOrEqual(2 * timeout());
    });

    // La garde tourne avant chaque test du bloc : un test dont le délai n'atteint pas le double de l'attente (10 s) échoue avant de
    // tourner, à une fois et demie l'attente comme en dessous d'elle ; au double exactement, il passe.
    it.fails('refuse, avant de le lancer, un test dont le délai fait une fois et demie l’attente', { timeout: 7_500 }, () => {});
    it.fails('refuse, avant de le lancer, un test dont le délai ne dépasse pas l’attente', { timeout: 1_000 }, () => {});
    it('laisse passer un test dont le délai fait exactement le double de l’attente', { timeout: 10_000 }, () => {});
  });
});

describe('assertOutlasts : un test qui attend jusqu’à N a au moins 2 N devant lui', () => {
  it('laisse passer un délai de test qui atteint le double de l’attente', () => {
    expect(() => assertOutlasts(10_000, 5_000)).not.toThrow(); // exactement 2 ×
    expect(() => assertOutlasts(20_000, 5_000)).not.toThrow(); // 4 × : le délai du projet web
  });

  it('refuse un délai de test qui ne l’atteint pas, et dit quoi relever', () => {
    expect(() => assertOutlasts(7_500, 5_000)).toThrow(/\(7500 ms\) n'atteint pas le double.*\(5000 ms\).*testTimeout/s); // 1,5 ×
    expect(() => assertOutlasts(9_999, 5_000)).toThrow(/n'atteint pas le double/); // juste sous 2 ×
    expect(() => assertOutlasts(5_001, 5_000)).toThrow(/n'atteint pas le double/); // « plus long que l'attente » ne suffit plus
    expect(() => assertOutlasts(1_000, 5_000)).toThrow(/Test timed out/);
  });

  it('ne dit rien d’un test sans délai', () => {
    expect(() => assertOutlasts(0, 5_000)).not.toThrow();
    expect(() => assertOutlasts(Number.POSITIVE_INFINITY, 5_000)).not.toThrow();
  });
});
