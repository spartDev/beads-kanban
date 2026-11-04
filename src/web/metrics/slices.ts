import type { MetricsCoverage, MetricsDurationStats, MetricsSlice, MetricsTiles } from '../../shared/api';
import { formatCount, formatPercent, tidy } from './format';
import type { Dimension } from './params';
import { seriesOf, type SeriesContext, type SeriesInfo } from './series';

/**
 * Le tableau des découpages. Le contrat dit une chose qu'il serait facile de défaire à l'affichage : la Couverture
 * d'un découpage par type ou par priorité est celle de tous les Projets mesurés, car le bug qui met une Livraison en
 * échec n'a ni son type ni sa priorité. Le `significant` d'une ligne « Bug » n'est donc pas propre aux bugs, et on ne
 * l'écrit pas ligne à ligne comme s'il l'était : la colonne du Taux d'échec disparaît quand aucune ligne n'a de taux
 * à montrer, et une phrase sous le tableau dit pourquoi, une seule fois. Par Projet, la Couverture est bien celle du
 * Projet, et chaque ligne se juge elle-même.
 */

/** Ce que dit la cellule du Taux d'échec d'une ligne. */
export type FailureCell =
  /** Un taux significatif : `failed` Livraisons en échec sur `deliveries`. */
  | { kind: 'rate'; rate: number; failed: number; deliveries: number }
  /** Aucune Livraison : il n'y a pas de taux à juger. */
  | { kind: 'empty' }
  /** Des Livraisons, mais une Couverture trop faible pour que le taux veuille dire quelque chose. */
  | { kind: 'insignificant'; reason: string };

export interface SliceRow {
  key: string;
  label: string;
  /** La couleur du groupe ; null pour la ligne « Ensemble ». */
  series: SeriesInfo | null;
  /** La page Métriques du Projet (découpage par Projet) ; null sinon. */
  href: string | null;
  throughput: number;
  leadTime: MetricsDurationStats;
  cycleTime: MetricsDurationStats;
  failure: FailureCell;
  wip: number;
}

export interface SliceTableView {
  rows: SliceRow[];
  /** Les tuiles, en dernière ligne : de quoi comparer chaque groupe à l'ensemble et recouper les totaux. */
  overall: SliceRow;
  /** Au moins une ligne a un taux à montrer. */
  failureColumn: boolean;
  /** Sous le tableau : la Couverture dont dépend le Taux d'échec, dite une fois ; null quand il n'y a rien à dire. */
  coverageNote: string | null;
}

type Tiles = Pick<MetricsTiles, 'throughput' | 'leadTime' | 'cycleTime' | 'failureRate' | 'wip'>;
type Thresholds = MetricsTiles['failureRate']['thresholds'];

const SHARED_COVERAGE = 'tous les Projets mesurés';
const WHY_SHARED = 'un bug n’a ni le type ni la priorité de la Livraison qu’il met en échec';

export function describeSlices({
  slices,
  dimension,
  tiles,
  ctx,
  projectHref,
}: {
  slices: readonly MetricsSlice[];
  dimension: Dimension;
  tiles: Tiles;
  ctx: SeriesContext;
  projectHref?: (projectId: string) => string;
}): SliceTableView {
  const { thresholds } = tiles.failureRate;
  const rows = slices.map((slice): SliceRow => {
    const subject = { type: slice.key, priority: Number(slice.key), project: slice.key };
    // Le nom d'un Projet est celui que l'API donne (`slice.label`) ; type et priorité se disent en français, comme au kanban.
    const series = dimension === 'project' ? { ...seriesOf(dimension, subject, ctx), label: slice.label } : seriesOf(dimension, subject, ctx);
    return {
      key: slice.key,
      label: series.label,
      series,
      href: dimension === 'project' && projectHref ? projectHref(slice.key) : null,
      throughput: slice.throughput,
      leadTime: slice.leadTime,
      cycleTime: slice.cycleTime,
      failure: failureOf(slice, thresholds),
      wip: slice.wip,
    };
  });

  const { failureRate } = tiles;
  const overall: SliceRow = {
    key: 'all',
    label: 'Ensemble',
    series: null,
    href: null,
    throughput: tiles.throughput.total,
    leadTime: pickStats(tiles.leadTime),
    cycleTime: pickStats(tiles.cycleTime),
    failure:
      failureRate.deliveries === 0 || failureRate.rate === null
        ? { kind: 'empty' }
        : failureRate.significant
          ? { kind: 'rate', rate: failureRate.rate, failed: failureRate.failed, deliveries: failureRate.deliveries }
          : { kind: 'insignificant', reason: failureRate.reason ?? explainInsignificance(failureRate.coverage, thresholds) },
    wip: tiles.wip.current,
  };

  return {
    rows,
    overall,
    failureColumn: rows.some((row) => row.failure.kind === 'rate'),
    coverageNote: coverageNote(dimension, rows, overall, tiles.failureRate, slices.some((slice) => slice.significant)),
  };
}

const pickStats = ({ median, p85, n }: MetricsDurationStats): MetricsDurationStats => ({ median, p85, n });

function failureOf(slice: MetricsSlice, thresholds: Thresholds): FailureCell {
  if (slice.throughput === 0 || slice.failureRate === null) return { kind: 'empty' };
  if (!slice.significant) return { kind: 'insignificant', reason: explainInsignificance(slice.coverage, thresholds) };
  return { kind: 'rate', rate: slice.failureRate, failed: slice.failedDeliveries, deliveries: slice.throughput };
}

/**
 * Pourquoi un taux ne dit rien, avec les chiffres de l'API : la Couverture sous le minimum, le nombre de bugs sous le
 * minimum, ou les deux. Même règle que le domaine (`insignificance`, src/domain/metrics.ts).
 */
export function explainInsignificance(coverage: MetricsCoverage, thresholds: Thresholds): string {
  const reasons: string[] = [];
  if (coverage.ratio !== null && coverage.ratio < thresholds.minCoverage) {
    reasons.push(`Couverture ${formatPercent(coverage.ratio)} (minimum ${formatPercent(thresholds.minCoverage)})`);
  }
  if (coverage.bugs < thresholds.minBugs) {
    reasons.push(`${formatCount(coverage.bugs)} ${coverage.bugs > 1 ? 'bugs' : 'bug'} (minimum ${thresholds.minBugs})`);
  }
  return reasons.join(' ; ');
}

/**
 * `covered` : au moins un Projet a assez de Couverture (c'est le `significant` de l'API, qui par Projet ne dépend que de sa
 * Couverture). Quand aucun taux ne s'affiche, ce n'est pas toujours faute de Couverture : un Projet qui en a assez mais n'a rien
 * livré n'a pas de taux à montrer non plus, et la note ne doit pas dire que la Couverture manque partout.
 *
 * Par Projet, quand des taux s'affichent, la note est la légende des cellules « n. s. » : elle n'existe que si le tableau en
 * montre au moins une, dans une ligne de Projet ou dans la ligne « Ensemble ». Elle ne parle donc d'aucun Projet en particulier :
 * la ligne « Ensemble » peut être la seule à dire « n. s. ».
 */
function coverageNote(dimension: Dimension, rows: readonly SliceRow[], overall: SliceRow, failureRate: MetricsTiles['failureRate'], covered: boolean): string | null {
  if (!rows.some((row) => row.throughput > 0)) return null;
  const { thresholds, coverage } = failureRate;

  if (dimension === 'project') {
    if (rows.some((row) => row.failure.kind === 'rate')) {
      if (![...rows, overall].some((row) => row.failure.kind === 'insignificant')) return null;
      return (
        'n. s. : Taux d’échec non significatif, faute de Couverture ou de bugs ' +
        `(moins de ${formatPercent(thresholds.minCoverage)} des bugs avec une origine, ou moins de ${thresholds.minBugs} bugs).`
      );
    }
    const required = `(au moins ${formatPercent(thresholds.minCoverage)} des bugs avec une origine, et ${thresholds.minBugs} bugs)`;
    return covered
      ? `Taux d’échec non affiché : aucun Projet n’a à la fois assez de Couverture ${required} et des Livraisons sur la période.`
      : `Taux d’échec non affiché : aucun Projet n’a assez de Couverture ${required}.`;
  }

  // Par type ou par priorité : une seule Couverture, celle de l'ensemble, dite une fois.
  if (failureRate.significant) {
    return `Taux d’échec : Couverture de ${formatPercent(coverage.ratio)} des bugs, celle de ${SHARED_COVERAGE} (${WHY_SHARED}).`;
  }
  const reason = tidy(failureRate.reason ?? `${explainInsignificance(coverage, thresholds)}.`);
  return `Taux d’échec non affiché, car non significatif. ${reason} Cette Couverture est celle de ${SHARED_COVERAGE} : ${WHY_SHARED}.`;
}
