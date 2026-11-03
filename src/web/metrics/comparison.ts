import type { MetricsResponse } from '../../shared/api';
import { dayInZone, formatDay, formatDayRange, formatTime } from './format';

/**
 * Comment les tendances comparent les périodes. Une période qui court encore n'est pas finie : elle est comptée de son
 * début à maintenant (`asOf`), et mise en face de la précédente jusqu'à l'instant correspondant (`previousAsOf`), à
 * durée écoulée égale. Sans le dire, « 64 contre 9 » paraîtrait compter 30 jours contre 30 jours.
 */
export interface Comparison {
  /** La période courante n'est pas finie : `asOf` précède sa fin. */
  running: boolean;
  /** L'heure de `asOf` dans le fuseau de la réponse (« 20:00 »). */
  asOfTime: string;
  current: string;
  previous: string;
  /** Jusqu'où la période courante est comptée (« 2 nov. à 20:00 ») ; null quand elle est finie. */
  currentUntil: string | null;
  /** Jusqu'où la précédente est comptée pour la comparaison ; null quand la période est finie. */
  previousUntil: string | null;
  /** La phrase visible sous les tuiles. */
  summary: string;
  /** L'infobulle d'une tendance, plus courte. */
  tooltip: string;
}

export function describeComparison({
  period,
  previousPeriod,
  asOf,
  previousAsOf,
  timeZone,
}: Pick<MetricsResponse, 'period' | 'previousPeriod' | 'asOf' | 'previousAsOf' | 'timeZone'>): Comparison {
  const running = Date.parse(asOf) < Date.parse(period.end);
  const current = formatDayRange(period.from, period.to);
  const previous = formatDayRange(previousPeriod.from, previousPeriod.to);
  const until = (instant: string) => `${formatDay(dayInZone(instant, timeZone))} à ${formatTime(instant, timeZone)}`;

  if (!running) {
    return {
      running,
      asOfTime: formatTime(asOf, timeZone),
      current,
      previous,
      currentUntil: null,
      previousUntil: null,
      summary: `Période terminée (${current}). Les tendances la comparent à la période précédente de même durée (${previous}).`,
      tooltip: `Comparé à la période précédente de même durée : ${previous}.`,
    };
  }

  const [currentUntil, previousUntil] = [until(asOf), until(previousAsOf)];
  return {
    running,
    asOfTime: formatTime(asOf, timeZone),
    current,
    previous,
    currentUntil,
    previousUntil,
    summary:
      `Période en cours (${current}), comptée jusqu’au ${currentUntil}. ` +
      `Les tendances la comparent à la période précédente (${previous}) à durée écoulée égale, ` +
      `c’est-à-dire jusqu’au ${previousUntil}.`,
    tooltip:
      `Comparé à la période précédente à durée écoulée égale, jusqu’au ${previousUntil}. ` +
      `La période en cours n’est pas finie : elle est comptée jusqu’au ${currentUntil}.`,
  };
}
