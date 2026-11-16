import type { MetricsResponse } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { dayInZone, FORMATS, formatTime } from './format';

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
}: Pick<MetricsResponse, 'period' | 'previousPeriod' | 'asOf' | 'previousAsOf' | 'timeZone'>, language: Language): Comparison {
  const { formatDay, formatDayRange } = FORMATS[language];
  const texts = CATALOGS[language].metrics.comparison;
  const running = Date.parse(asOf) < Date.parse(period.end);
  const current = formatDayRange(period.from, period.to);
  const previous = formatDayRange(previousPeriod.from, previousPeriod.to);
  const until = (instant: string) => texts.at(formatDay(dayInZone(instant, timeZone)), formatTime(instant, timeZone));

  if (!running) {
    return {
      running,
      asOfTime: formatTime(asOf, timeZone),
      current,
      previous,
      currentUntil: null,
      previousUntil: null,
      summary: texts.finishedSummary(current, previous),
      tooltip: texts.finishedTooltip(previous),
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
    summary: texts.runningSummary(current, currentUntil, previous, previousUntil),
    tooltip: texts.runningTooltip(currentUntil, previousUntil),
  };
}
