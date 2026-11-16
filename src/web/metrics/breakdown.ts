import type { MetricsDurationStats, MetricsLeadTimeBreakdown } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from './format';

/**
 * Décomposition du Lead Time : le Lead Time cumulé des Livraisons de la période, en cinq parts qui s'additionnent. Chaque part
 * prend la couleur de la colonne du flux qu'elle rappelle (Backlog, Prêt, En cours, Bloqué) : l'Attente de dépendance est du
 * temps passé en Backlog, l'Attente en Prêt du temps Prêt, le travail du temps En cours, le Blocage du temps Bloqué. L'autre
 * attente (le reste) reprend la couleur du Backlog, hachurée : elle s'en distingue autrement que par la couleur.
 */

export type PartKey = 'dependencyWait' | 'readyWait' | 'otherWait' | 'work' | 'blocked';

export interface BreakdownPart {
  key: PartKey;
  label: string;
  description: string;
  /** Référence CSS `var(--flow-…)` de la colonne du flux que la part rappelle. */
  color: string;
  /** La part est dessinée de hachures de cette couleur plutôt que de son aplat : elle partage la couleur d'une autre part. */
  hatched: boolean;
  /** Durée cumulée sur les Livraisons (ms). */
  duration: number;
  /** La durée écrite : « 21 j », ou « Aucun » (« Aucune » pour une attente) quand elle est exactement nulle, jamais « < 1 min ». */
  text: string;
  /** La durée dite aux lecteurs d'écran : « 21 jours », « moins d'une minute » là où `text` s'écrit « < 1 min », ou « Aucun » (« Aucune »). */
  spoken: string;
  /** Part du Lead Time cumulé, de 0 à 1 ; null quand il n'y a rien à répartir. */
  share: number | null;
}

export interface BreakdownView {
  parts: BreakdownPart[];
  /** Lead Time cumulé (ms). */
  total: number;
  deliveries: number;
  /** Livraisons qui ont attendu une dépendance avant leur premier démarrage, et la durée de leur attente. */
  waited: number;
  waits: MetricsDurationStats;
  /** Aucune Livraison, ou aucun Lead Time cumulé : pas de pourcentage à donner. */
  empty: boolean;
}

/** Une part sans ses mesures ni ses textes (libellé, description, et `none`, ce qu'on écrit d'une durée exactement nulle) : ceux-là sont au catalogue. */
type PartSpec = Pick<BreakdownPart, 'key' | 'color' | 'hatched'>;

const PARTS: readonly PartSpec[] = [
  { key: 'dependencyWait', color: 'var(--flow-backlog)', hatched: false },
  { key: 'readyWait', color: 'var(--flow-ready)', hatched: false },
  { key: 'otherWait', color: 'var(--flow-backlog)', hatched: true },
  { key: 'work', color: 'var(--flow-progress)', hatched: false },
  { key: 'blocked', color: 'var(--flow-blocked)', hatched: false },
];

export function describeBreakdown(breakdown: MetricsLeadTimeBreakdown, language: Language): BreakdownView {
  const { formatDuration, spokenDuration } = FORMATS[language];
  const texts = CATALOGS[language].metrics.leadTimeBreakdown.parts;
  const empty = breakdown.deliveries === 0 || breakdown.total === 0;
  return {
    parts: PARTS.map((part) => ({
      ...part,
      label: texts[part.key].label,
      description: texts[part.key].description,
      duration: breakdown[part.key],
      // `formatDuration(0)` dirait « < 1 min » : une part exactement nulle n'a pas eu lieu, elle ne s'écrit pas comme une part minuscule.
      text: breakdown[part.key] > 0 ? formatDuration(breakdown[part.key]) : texts[part.key].none,
      spoken: breakdown[part.key] > 0 ? spokenDuration(breakdown[part.key]) : texts[part.key].none,
      share: empty ? null : breakdown[part.key] / breakdown.total,
    })),
    total: breakdown.total,
    deliveries: breakdown.deliveries,
    waited: breakdown.waited,
    waits: breakdown.waits,
    empty,
  };
}
