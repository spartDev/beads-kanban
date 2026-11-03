import type { MetricsTrend } from '../../shared/api';
import {
  formatCount,
  formatDecimal,
  formatDuration,
  formatPercent,
  formatPoints,
  formatSigned,
  formatSignedDuration,
  spokenDuration,
  spokenPoints,
} from './format';

const NBSP = ' ';

/**
 * Comment lire une grandeur dans le temps : son sens (plus de Livraisons est un mieux, un Lead Time plus long un
 * pire, un WIP plus haut ni l'un ni l'autre : seul l'utilisateur sait ce qu'il vise), son écriture, et l'écart
 * en dessous duquel l'affichage dirait « 0 » (la tendance est alors « stable »).
 */
export interface Measure {
  polarity: 'higher-is-better' | 'lower-is-better' | 'neutral';
  /** Une valeur : « 64 », « 3,4 j », « 11 % ». */
  format: (value: number) => string;
  /** Un écart signé : « +55 », « +3,3 j », « −9,5 pts ». */
  formatDelta: (delta: number) => string;
  /** Une valeur telle qu'on la dit, pour la phrase. */
  speak: (value: number) => string;
  /** La taille d'un écart (sans signe) telle qu'on la dit : « 55 », « 3,3 jours », « 9,5 points ». */
  speakDelta: (magnitude: number) => string;
  /** L'écart est-il trop petit pour apparaître à l'écran ? */
  negligible: (delta: number) => boolean;
  /** La variation relative a-t-elle un sens ? Pas pour une part : « −86 % » d'un taux se lit comme des points. */
  showRatio: boolean;
}

const MINUTE = 60_000;

export const MEASURES = {
  /** Débit : un nombre de Livraisons. */
  count: {
    polarity: 'higher-is-better',
    format: formatCount,
    formatDelta: (delta) => formatSigned(delta),
    speak: formatCount,
    speakDelta: formatCount,
    negligible: (delta) => Math.abs(delta) < 0.5,
    showRatio: true,
  },
  /** Lead Time, Cycle Time, Temps de rétablissement : plus court est mieux. */
  duration: {
    polarity: 'lower-is-better',
    format: formatDuration,
    formatDelta: formatSignedDuration,
    speak: spokenDuration,
    speakDelta: spokenDuration,
    negligible: (delta) => Math.abs(delta) < MINUTE / 2,
    showRatio: true,
  },
  /** Taux d'échec : une part de 0 à 1, dont l'écart se lit en points. */
  rate: {
    polarity: 'lower-is-better',
    format: (value) => formatPercent(value, { precise: true }),
    formatDelta: formatPoints,
    speak: (value) => formatPercent(value, { precise: true }),
    speakDelta: spokenPoints,
    negligible: (delta) => Math.abs(delta) < 0.0005,
    showRatio: false,
  },
  /** WIP : une moyenne de tickets, sans bon ni mauvais sens. */
  average: {
    polarity: 'neutral',
    format: (value) => formatDecimal(value, 1),
    formatDelta: (delta) => formatSigned(delta, 1),
    speak: (value) => formatDecimal(value, 1),
    speakDelta: (magnitude) => formatDecimal(magnitude, 1),
    negligible: (delta) => Math.abs(delta) < 0.05,
    showRatio: true,
  },
} as const satisfies Record<string, Measure>;

export type TrendDirection = 'up' | 'down' | 'flat' | 'none';
export type TrendTone = 'good' | 'bad' | 'neutral';

export interface TrendView {
  /** `none` : il n'y a rien à comparer (l'une des deux valeurs n'existe pas). */
  direction: TrendDirection;
  /** Bon, mauvais ou neutre selon le sens de la grandeur ; jamais porté par la couleur seule (flèche, signe, phrase). */
  tone: TrendTone;
  /** L'écart signé, null quand il n'y a rien à comparer. */
  delta: string | null;
  /** La valeur de la période précédente, null quand elle n'existe pas. */
  previous: string | null;
  /** La variation relative signée (« +611 % »), « moins de 1 % » quand l'arrondi l'effacerait, null quand elle n'a pas de sens ou n'est pas définie. */
  ratio: string | null;
  /** Une phrase complète, pour l'infobulle et les lecteurs d'écran. */
  sentence: string;
}

/** Ce que dit la tendance d'une grandeur : sens, ton, et les textes à afficher. */
export function describeTrend(trend: MetricsTrend, measure: Measure): TrendView {
  const { previous, delta } = trend;

  if (previous === null || delta === null) {
    return {
      direction: 'none',
      tone: 'neutral',
      delta: null,
      previous: previous === null ? null : measure.format(previous),
      ratio: null,
      sentence:
        previous === null
          ? 'Pas de comparaison : la période précédente n’a pas de valeur.'
          : `Pas de comparaison : la période courante n’a pas de valeur (précédente : ${measure.speak(previous)}).`,
    };
  }

  const current = previous + delta;
  const direction: TrendDirection = measure.negligible(delta) ? 'flat' : delta > 0 ? 'up' : 'down';
  const ratio = measure.showRatio && trend.ratio !== null ? (direction === 'flat' ? `0${NBSP}%` : signedPercent(trend.ratio)) : null;

  return {
    direction,
    tone: toneOf(direction, measure.polarity),
    delta: measure.formatDelta(delta),
    previous: measure.format(previous),
    ratio,
    sentence:
      direction === 'flat'
        ? `Stable : ${measure.speak(current)} comme sur la période précédente.`
        : `En ${direction === 'up' ? 'hausse' : 'baisse'} de ${measure.speakDelta(Math.abs(delta))}${ratio ? ` (${ratio})` : ''} : ` +
          `${measure.speak(current)} contre ${measure.speak(previous)} sur la période précédente.`,
  };
}

function toneOf(direction: TrendDirection, polarity: Measure['polarity']): TrendTone {
  if (direction !== 'up' && direction !== 'down') return 'neutral';
  if (polarity === 'neutral') return 'neutral';
  const better = polarity === 'higher-is-better' ? direction === 'up' : direction === 'down';
  return better ? 'good' : 'bad';
}

/**
 * Variation relative signée en pourcentage entier (« +611 % », « −44 % »). Sous 1 %, l'arrondi à l'entier ferait écrire
 * « 0 % » à côté d'une hausse ou d'une baisse : « En hausse de 1 (0 %) » se contredit. On dit alors « moins de 1 % » ;
 * le sens, lui, est dit par « hausse » ou « baisse ».
 */
function signedPercent(ratio: number): string {
  const text = formatSigned(ratio * 100);
  return text === '0' ? `moins de 1${NBSP}%` : `${text}${NBSP}%`;
}
