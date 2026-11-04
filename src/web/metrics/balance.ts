import type { MetricsBucket, MetricsBucketUnit, MetricsTiles, MetricsTrend } from '../../shared/api';
import { type BucketView, normalizeBuckets } from './buckets';

/**
 * Arrivées vs Débit. L'API sert déjà les Arrivées et les Livraisons de la période (`tiles.arrivals`, `tiles.throughput`)
 * et de chacune de ses tranches (`buckets`) : la page en tire l'écart (Arrivées moins Débit), sa tendance, et le cumul des
 * deux courbes. L'écart d'une période est la somme de celui de ses tranches : les comptes restent bruts, comme à l'histogramme
 * du Débit, dont la tranche incomplète est dite telle quelle.
 */

export interface BalanceSummary {
  arrivals: number;
  throughput: number;
  /** Arrivées moins Débit : positif, il arrive plus de tickets qu'il n'en est livré. */
  net: number;
  /** L'écart contre celui de la période précédente (à durée écoulée égale), de leurs Arrivées et de leur Débit. */
  trend: MetricsTrend;
}

export function balanceOf({ arrivals, throughput }: Pick<MetricsTiles, 'arrivals' | 'throughput'>): BalanceSummary {
  const net = arrivals.total - throughput.total;
  const previous = arrivals.trend.previous === null || throughput.trend.previous === null ? null : arrivals.trend.previous - throughput.trend.previous;
  if (previous === null) return { arrivals: arrivals.total, throughput: throughput.total, net, trend: { previous: null, delta: null, ratio: null } };
  const delta = net - previous;
  return { arrivals: arrivals.total, throughput: throughput.total, net, trend: { previous, delta, ratio: previous === 0 ? null : delta / previous } };
}

/** Une tranche de la période : ses Arrivées et ses Livraisons, leur écart, et les cumuls jusqu'à sa fin. */
export interface BalanceRow extends BucketView {
  arrivals: number;
  /** Arrivées moins Livraisons de la tranche. */
  net: number;
  cumulativeArrivals: number;
  cumulativeDeliveries: number;
  /** Arrivées cumulées moins Livraisons cumulées. */
  cumulativeNet: number;
}

export function describeBalance(
  buckets: readonly MetricsBucket[],
  options: { unit: MetricsBucketUnit; running: boolean; asOfTime: string },
): BalanceRow[] {
  let [arrivals, deliveries] = [0, 0];
  return normalizeBuckets(buckets, options).map((view, index): BalanceRow => {
    const bucketArrivals = buckets[index]?.arrivals ?? 0;
    arrivals += bucketArrivals;
    deliveries += view.deliveries;
    return {
      ...view,
      arrivals: bucketArrivals,
      net: bucketArrivals - view.deliveries,
      cumulativeArrivals: arrivals,
      cumulativeDeliveries: deliveries,
      cumulativeNet: arrivals - deliveries,
    };
  });
}
