import { configure, getConfig } from '@testing-library/react';
import { afterAll, beforeAll, beforeEach } from 'vitest';

/**
 * Combien de fois l'attente doit tenir dans le délai d'un test. Un test monte l'application, puis attend souvent plusieurs fois de suite
 * (ouvrir une boîte de dialogue, la fermer, attendre le focus) : un délai à peine plus long qu'une attente ne lui laisse pas la seconde.
 */
const WAITS_PER_TEST = 2;

/**
 * Accorde `ms` aux attentes de Testing Library (`findBy…`, `waitFor`) le temps d'un bloc de tests, ou de tout un fichier quand
 * on l'appelle à son premier niveau, puis rend le délai qu'elle a trouvé. Les blocs s'emboîtent : chacun rend celui qu'il a trouvé.
 *
 * Monter toute l'application (`renderApp`) prend plus d'une seconde, le délai par défaut, quand la machine est chargée (la suite
 * complète en parallèle, d'autres processus) : un test échouerait sur la durée, pas sur le comportement. Allonger le délai ne
 * change rien aux tests qui réussissent, et ne retarde que l'échec de ceux qui échouent.
 *
 * La règle : un test qui attend jusqu'à `ms` a au moins le double de `ms` devant lui. Sinon « Test timed out » couperait l'attente
 * avant que Testing Library ne dise ce qui était à l'écran, et un vrai défaut échouerait sans le DOM. Le délai d'un test web est celui
 * du projet (`testTimeout`, dans `vite.config.ts` : 20 s, soit quatre fois les 5 s qu'on accorde d'ordinaire ici) ; chaque test du
 * bloc vérifie qu'il atteint le double de `ms` avant de tourner, et sinon échoue en disant quoi relever (`assertOutlasts`).
 *
 * (Pas de `use…` dans le nom : ce n'est pas un hook React, et le lint le prendrait pour tel. Voir `withTimeZone`.)
 */
export function withAsyncTimeout(ms: number): void {
  let previous = getConfig().asyncUtilTimeout;
  beforeAll(() => {
    previous = getConfig().asyncUtilTimeout;
    configure({ asyncUtilTimeout: ms });
  });
  beforeEach(({ task }) => {
    assertOutlasts(task.timeout, ms);
  });
  afterAll(() => {
    configure({ asyncUtilTimeout: previous });
  });
}

/**
 * Refuse un délai de test (`testTimeout`, en ms ; 0 ou moins : pas de délai) qui n'atteint pas le double de l'attente `wait` qu'il
 * contient : c'est la règle de `withAsyncTimeout`. Le double exactement passe.
 */
export function assertOutlasts(testTimeout: number, wait: number): void {
  if (testTimeout > 0 && testTimeout < WAITS_PER_TEST * wait) {
    throw new Error(
      `Le délai du test (${testTimeout} ms) n'atteint pas le double de l'attente de Testing Library (${wait} ms) : « Test timed out » la couperait avant qu'elle ne montre le DOM, dès que le test attend plus d'une fois. Relevez le délai du test (testTimeout, vite.config.ts) ou raccourcissez l'attente (withAsyncTimeout).`,
    );
  }
}
