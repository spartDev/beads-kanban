import { breakdowns } from './metrics/breakdowns';
import { charts } from './metrics/charts';
import { core } from './metrics/core';
import { page } from './metrics/page';
import { tiles } from './metrics/tiles';
import type { Zone } from './zone';

/**
 * Zone « metrics » (bdesk-ewr.5) : `metrics/`, la page Métriques et le Rapport de rétrospective.
 *
 * La plus grosse zone : ses textes sont rangés dans `catalog/metrics/`, un module par famille de composants, chacun avec ses objets
 * `fr` et `en` dont les clés de premier niveau sont des groupes (un composant ou un écran). Ce module les réunit : `t.metrics.<groupe>.<clé>`.
 * Un groupe n'est défini que dans un seul module (le test « groupes uniques » de `metrics/i18n.test.ts` le vérifie).
 */
const fr = { ...core.fr, ...tiles.fr, ...charts.fr, ...breakdowns.fr, ...page.fr };

const en: typeof fr = { ...core.en, ...tiles.en, ...charts.en, ...breakdowns.en, ...page.en };

export const metrics: Zone<typeof fr> = { fr, en };

/** Les modules de groupes, pour le test qui vérifie qu'aucun groupe n'est défini deux fois. */
export const METRICS_GROUP_MODULES = { core, tiles, charts, breakdowns, page };
