import type { MetricsLongTrend, MetricsLongTrendWeek } from '../shared/api';
import { weeksUntil } from './calendar';
import { closuresIn } from './health';
import { percentile, significanceOf, type MetricsInput } from './metrics';

/** Combien de semaines la Tendance longue montre, la semaine en cours comprise. */
export const LONG_TREND_WEEKS = 12;
/** Sous ce nombre de Livraisons, le P85 d'une semaine est montré en pointillé : il ne dit pas grand-chose. */
export const MIN_TREND_DELIVERIES = 4;

/**
 * La Tendance longue (CONTEXT.md) : Débit, Débit sain, Lead Time au P85 et Taux de Réouverture, semaine par semaine sur les 12 semaines du
 * fuseau qui finissent par la semaine en cours, sans lissage. Indépendante de la période choisie. La semaine en cours est comptée
 * jusqu'à `now` exclu : ce qui est daté plus tard n'est pas encore arrivé. Le Débit sain d'une semaine compte les Livraisons saines parmi
 * celles de son Débit ; il est significatif, ou non, pour les 12 à la fois : la Couverture porte sur tous les bugs, toutes dates confondues.
 */
export function longTrendOf(projects: MetricsInput[], { now, timeZone }: { now: Date; timeZone: string }): MetricsLongTrend {
  const instant = now.getTime();
  const entries = projects.flatMap((project) => project.analysis.tickets.map((ticket) => ({ ticket })));
  const weeks = weeksUntil(instant, LONG_TREND_WEEKS, timeZone).map((week): MetricsLongTrendWeek => {
    const window = { start: week.start, end: Math.min(week.end, instant) };
    const delivered = entries.filter(({ ticket }) => within(ticket.deliveredAt, window));
    const leadTimes = delivered.flatMap(({ ticket }) => (ticket.leadTime === null ? [] : [ticket.leadTime])).sort((a, b) => a - b);
    const { closures, reopened } = closuresIn(entries, window);
    return {
      from: week.from,
      to: week.to,
      start: new Date(week.start).toISOString(),
      end: new Date(week.end).toISOString(),
      partial: week.end > instant,
      throughput: leadTimes.length,
      soundThroughput: delivered.filter(({ ticket }) => ticket.sound).length,
      leadTimeP85: percentile(leadTimes, 85),
      reliable: leadTimes.length >= MIN_TREND_DELIVERIES,
      closures,
      reopened,
      reopeningRate: closures === 0 ? null : reopened / closures,
    };
  });
  return { weeks, minDeliveries: MIN_TREND_DELIVERIES, soundSignificance: significanceOf(projects) };
}

interface Window {
  start: number;
  end: number;
}

const within = (instant: number | null, window: Window): instant is number => instant !== null && instant >= window.start && instant < window.end;

