import { afterAll, beforeAll } from 'vitest';

/**
 * Fait tourner le fuseau de Node pour le temps d'un bloc de tests. C'est aussi celui de `Date` : le kanban compte ses
 * jours (Terminé, l'âge des cartes) en jours calendaires du fuseau du navigateur, que les tests choisissent au lieu de
 * subir celui de la machine qui les lance. Les blocs s'emboîtent : chacun rend le fuseau qu'il a trouvé. Une variable `TZ`
 * absente au départ est supprimée à la fin, et Node remet alors le fuseau du système (c'est vérifié par `timeZone.test.ts`).
 *
 * Seul `Date` suit ce changement de lui-même. Un `Intl.DateTimeFormat` créé avant le bloc, à l'import d'un module par
 * exemple, garde le fuseau d'avant : le code testé écrit ses dates par `localDateFormat` (`lib/localDay`), qui lit le fuseau
 * par `Date` à chaque appel.
 *
 * (Pas de `use…` dans le nom : ce n'est pas un hook React, et le lint le prendrait pour tel.)
 */
export function withTimeZone(timeZone: string): void {
  let previous: string | undefined;
  beforeAll(() => {
    previous = process.env.TZ;
    process.env.TZ = timeZone;
  });
  afterAll(() => {
    if (previous === undefined) delete process.env.TZ;
    else process.env.TZ = previous;
  });
}
