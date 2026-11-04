import { getConfig } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from './asyncTimeout';

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
});
