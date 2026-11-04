import { configure, getConfig } from '@testing-library/react';
import { afterAll, beforeAll } from 'vitest';

/**
 * Accorde `ms` aux attentes de Testing Library (`findBy…`, `waitFor`) le temps d'un bloc de tests, ou de tout un fichier quand
 * on l'appelle à son premier niveau, puis rend le délai qu'elle a trouvé. Les blocs s'emboîtent : chacun rend celui qu'il a trouvé.
 *
 * Monter toute l'application (`renderApp`) prend plus d'une seconde, le délai par défaut, quand la machine est chargée (la suite
 * complète en parallèle, d'autres processus) : un test échouerait sur la durée, pas sur le comportement. Allonger le délai ne
 * change rien aux tests qui réussissent, et ne retarde que l'échec de ceux qui échouent.
 *
 * (Pas de `use…` dans le nom : ce n'est pas un hook React, et le lint le prendrait pour tel. Voir `withTimeZone`.)
 */
export function withAsyncTimeout(ms: number): void {
  let previous = getConfig().asyncUtilTimeout;
  beforeAll(() => {
    previous = getConfig().asyncUtilTimeout;
    configure({ asyncUtilTimeout: ms });
  });
  afterAll(() => {
    configure({ asyncUtilTimeout: previous });
  });
}
