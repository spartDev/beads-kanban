import type { MetricsFailureRateTile } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from './format';

/**
 * Le motif d'un Taux d'échec non significatif, écrit dans la langue de l'interface à partir des codes de l'API (`reasons`), de la
 * Couverture et des seuils : « Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %). ». Le serveur écrit
 * aussi ce motif (`reason`), mais en français seulement ; l'interface ne lit que les codes. null quand le taux est significatif.
 */
export function failureRateReason(
  { reasons, coverage, thresholds }: Pick<MetricsFailureRateTile, 'reasons' | 'coverage' | 'thresholds'>,
  language: Language,
): string | null {
  if (reasons.length === 0) return null;
  const { formatCount, formatPercent } = FORMATS[language];
  const texts = CATALOGS[language].metrics.failureReason;
  // Des pourcentages entiers, comme le serveur les écrit (« 19 % », « 50 % »).
  const percent = (ratio: number) => formatPercent(Math.round(ratio * 100) / 100);
  const text = reasons
    .map((reason) =>
      reason === 'low-coverage'
        ? texts.lowCoverage(percent(coverage.ratio ?? 0), percent(thresholds.minCoverage))
        : texts.fewBugs(formatCount(coverage.bugs), formatCount(thresholds.minBugs)),
    )
    .join(texts.separator);
  return `${text.charAt(0).toUpperCase()}${text.slice(1)}.`;
}
