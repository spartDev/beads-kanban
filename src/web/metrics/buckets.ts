import type { MetricsBucket, MetricsBucketUnit } from '../../shared/api';
import { formatDay } from './format';

/**
 * Une tranche de l'histogramme du Débit, prête à dessiner. Les comptes restent bruts : leur somme est celle de la tuile
 * Débit, qu'on peut ainsi recouper. Ce qui rend une tranche incomparable aux autres est dit, pas corrigé :
 *
 * - tronquée : une semaine commencée avant la période, ou qui la dépasse, compte moins de 7 jours (`days`) ;
 * - en cours : la dernière tranche d'une période qui court encore n'est comptée que jusqu'à maintenant, même quand
 *   elle compte tous ses jours (un dimanche, ou un jour entier : `days` ne suffit pas à le dire).
 */
export interface BucketView {
  from: string;
  to: string;
  days: number;
  deliveries: number;
  /** Jours d'une tranche pleine : 1 par jour, 7 par semaine. */
  fullDays: 1 | 7;
  truncated: boolean;
  running: boolean;
  /** Tronquée ou en cours : à ne pas lire comme les autres. */
  partial: boolean;
  /** Livraisons par jour couvert : de quoi comparer des tranches de longueurs différentes. */
  perDay: number;
  /** Étiquette de l'axe : le premier jour de la tranche. */
  label: string;
  /** Titre de l'infobulle et du tableau : le jour, ou les deux bornes de la semaine. */
  title: string;
  /** Pourquoi la tranche est partielle, en une phrase ; null quand elle ne l'est pas. */
  note: string | null;
}

const FULL_DAYS = { day: 1, week: 7 } as const;

export function normalizeBuckets(
  buckets: readonly MetricsBucket[],
  { unit, running, asOfTime }: { unit: MetricsBucketUnit; running: boolean; asOfTime: string },
): BucketView[] {
  const fullDays = FULL_DAYS[unit];
  return buckets.map((bucket, index) => {
    const truncated = bucket.days < fullDays;
    const current = running && index === buckets.length - 1;
    return {
      from: bucket.from,
      to: bucket.to,
      days: bucket.days,
      deliveries: bucket.deliveries,
      fullDays,
      truncated,
      running: current,
      partial: truncated || current,
      perDay: bucket.days > 0 ? bucket.deliveries / bucket.days : 0,
      label: formatDay(bucket.from),
      title: titleOf(bucket),
      note: noteOf(unit, bucket.days, truncated, current, asOfTime),
    };
  });
}

/** Le jour (« lun. 2 nov. 2026 »), ou les deux bornes de la tranche (« mer. 5 août – dim. 9 août 2026 »). */
function titleOf({ from, to }: MetricsBucket): string {
  if (from === to) return formatDay(from, { weekday: true, year: true });
  const crossesYears = from.slice(0, 4) !== to.slice(0, 4);
  return `${formatDay(from, { weekday: true, year: crossesYears })} – ${formatDay(to, { weekday: true, year: true })}`;
}

function noteOf(unit: MetricsBucketUnit, days: number, truncated: boolean, running: boolean, asOfTime: string): string | null {
  if (unit === 'day') return running ? `Jour en cours, jusqu’à ${asOfTime}.` : null;
  const covered = `${days} ${days > 1 ? 'jours' : 'jour'} sur 7`;
  if (truncated) return running ? `Semaine en cours : ${covered}, jusqu’à ${asOfTime}.` : `Semaine incomplète : ${covered} dans la période.`;
  return running ? `Semaine en cours, jusqu’à ${asOfTime}.` : null;
}

/** Somme des Livraisons des tranches : celle de la tuile Débit. */
export function totalDeliveries(views: readonly Pick<BucketView, 'deliveries'>[]): number {
  return views.reduce((total, view) => total + view.deliveries, 0);
}
