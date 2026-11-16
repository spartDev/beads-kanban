import type { MetricsSlice } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { legendOf, type SeriesInfo } from './series';

/**
 * Répartition par type : la part de chaque type de ticket parmi les Arrivées, les Livraisons et le WIP de la période. L'API
 * la sert déjà, dans le découpage par type (`slices.type`) ; les couleurs et l'ordre sont ceux du code couleur fixe des tickets,
 * comme dans les autres graphiques.
 */

export type MixKey = 'arrivals' | 'deliveries' | 'wip';

export interface MixSegment {
  type: string;
  label: string;
  color: string;
  count: number;
  /** Part de la ligne, de 0 à 1 ; 0 quand la ligne est vide. */
  share: number;
}

/** Une ligne : le même ensemble de types pour toutes, du plus ancien dans le code couleur au plus récent. */
export interface MixRow {
  key: MixKey;
  label: string;
  total: number;
  segments: MixSegment[];
}

export interface TypeMixView {
  /** Les types présents, dans l'ordre des segments. */
  types: { type: string; label: string; color: string }[];
  rows: MixRow[];
  /** Ni Arrivée, ni Livraison, ni WIP : rien à répartir. */
  empty: boolean;
}

const ROWS: readonly { key: MixKey; count: (slice: MetricsSlice) => number }[] = [
  { key: 'arrivals', count: (slice) => slice.arrivals },
  { key: 'deliveries', count: (slice) => slice.throughput },
  { key: 'wip', count: (slice) => slice.wip },
];

/** Un type n'a ni Projet ni priorité qui compte ici : la légende des types ne lit que son identifiant. */
const NO_CONTEXT = { projectName: (id: string) => id, projectHue: () => 0 };

/** Les libellés des types viennent du code couleur (`design/issue-palette.ts`) ; ceux des lignes, du catalogue. */
export function describeTypeMix(slices: readonly MetricsSlice[], language: Language): TypeMixView {
  const labels = CATALOGS[language].metrics.typeMix.rows;
  const ordered: SeriesInfo[] = legendOf('type', slices.map((slice) => ({ type: slice.key, priority: 0, project: '' })), NO_CONTEXT, []);
  const byType = new Map(slices.map((slice) => [slice.key, slice]));

  const rows = ROWS.map(({ key, count }): MixRow => {
    const counts = ordered.map((info) => ({ info, count: byType.get(info.key) ? count(byType.get(info.key) as MetricsSlice) : 0 }));
    const total = counts.reduce((sum, entry) => sum + entry.count, 0);
    return {
      key,
      label: labels[key],
      total,
      segments: counts.map(({ info, count: n }) => ({ type: info.key, label: info.label, color: info.color, count: n, share: total === 0 ? 0 : n / total })),
    };
  });

  return {
    types: ordered.map(({ key, label, color }) => ({ type: key, label, color })),
    rows,
    empty: rows.every((row) => row.total === 0),
  };
}
