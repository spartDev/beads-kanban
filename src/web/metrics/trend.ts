import type { MetricsTrend } from '../../shared/api';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { FORMATS } from './format';

/**
 * Comment lire une grandeur dans le temps : son sens (plus de Livraisons est un mieux, un Lead Time plus long un
 * pire, un WIP plus haut ni l'un ni l'autre : seul l'utilisateur sait ce qu'il vise), son écriture, et l'écart
 * en dessous duquel l'affichage dirait « 0 » (la tendance est alors « stable »). Une mesure est écrite dans une langue
 * (`MEASURES[langue]`) : `describeTrend` fait ses phrases dans la sienne.
 */
export interface Measure {
  language: Language;
  polarity: 'higher-is-better' | 'lower-is-better' | 'neutral';
  /** Une valeur : « 64 », « 3,4 j », « 11 % ». */
  format: (value: number) => string;
  /** Un écart signé : « +55 », « +3,3 j », « −9,5 pts ». */
  formatDelta: (delta: number) => string;
  /**
   * Une valeur telle qu'on la dit, pour la phrase : « 3,4 jours », « plus de 99,9 % ». Jamais de chevron, « < » ou « > » : un
   * lecteur d'écran le lirait tel quel (« < 1 min » se dit « moins d'une minute »).
   */
  speak: (value: number) => string;
  /** La taille d'un écart (sans signe) telle qu'on la dit : « 55 », « 3,3 jours », « 9,5 points ». */
  speakDelta: (magnitude: number) => string;
  /** L'écart est-il trop petit pour apparaître à l'écran ? */
  negligible: (delta: number) => boolean;
  /** La variation relative a-t-elle un sens ? Pas pour une part : « −86 % » d'un taux se lit comme des points. */
  showRatio: boolean;
}

const MINUTE = 60_000;

/** La part qu'une Efficacité presque entière ne dépasse pas à l'écran : 99,9 %, écrite dans la langue. */
const almostAll = (language: Language) => FORMATS[language].formatPercent(0.999, { precise: true });

/**
 * Une Efficacité qui arrondirait à « 100 % » sans l'être (3,5 s de Blocage sur 124 j de Cycle Time) : « 100 % » dirait qu'il
 * n'y a pas eu de Blocage, alors qu'il y en a eu. `written` est l'écriture à une décimale de la part.
 */
const roundsUpToWhole = (ratio: number | null | undefined, written: string, language: Language): boolean =>
  typeof ratio === 'number' && ratio < 1 && written === FORMATS[language].formatPercent(1);

/**
 * L'Efficacité du flux écrite : « 100 % » seulement quand elle vaut exactement 1, c'est-à-dire sans le moindre Blocage. Une part
 * qui arrondirait à 100 % sans l'être s'écrit « > 99,9 % ».
 */
export function formatEfficiency(ratio: number | null | undefined, language: Language): string {
  const text = FORMATS[language].formatPercent(ratio, { precise: true });
  return roundsUpToWhole(ratio, text, language) ? CATALOGS[language].metrics.trend.almostAllWritten(almostAll(language)) : text;
}

/**
 * L'Efficacité du flux telle qu'on la dit, pour les lecteurs d'écran : « plus de 99,9 % » là où elle s'écrit « > 99,9 % », car un
 * lecteur d'écran lit le chevron tel quel, ou l'omet selon son réglage de ponctuation. Le reste se dit comme il s'écrit.
 */
export function spokenEfficiency(ratio: number | null | undefined, language: Language): string {
  const text = FORMATS[language].formatPercent(ratio, { precise: true });
  return roundsUpToWhole(ratio, text, language) ? CATALOGS[language].metrics.trend.almostAllSpoken(almostAll(language)) : text;
}

function measuresIn(language: Language) {
  const { formatCount, formatDecimal, formatDuration, formatPercent, formatPoints, formatSigned, formatSignedDuration, spokenDuration, spokenPoints } =
    FORMATS[language];
  return {
    /** Débit : un nombre de Livraisons. */
    count: {
      language,
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
      language,
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
      language,
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
      language,
      polarity: 'neutral',
      format: (value) => formatDecimal(value, 1),
      formatDelta: (delta) => formatSigned(delta, 1),
      speak: (value) => formatDecimal(value, 1),
      speakDelta: (magnitude) => formatDecimal(magnitude, 1),
      negligible: (delta) => Math.abs(delta) < 0.05,
      showRatio: true,
    },
    /** Efficacité du flux : une part de 0 à 1, dont l'écart se lit en points ; plus haute, c'est mieux. Jamais « 100 % » avec du Blocage. */
    efficiency: {
      language,
      polarity: 'higher-is-better',
      format: (value) => formatEfficiency(value, language),
      formatDelta: formatPoints,
      speak: (value) => spokenEfficiency(value, language),
      speakDelta: spokenPoints,
      negligible: (delta) => Math.abs(delta) < 0.0005,
      showRatio: false,
    },
    /** Taux d'abandon : une part de 0 à 1 lue en points, ni bonne ni mauvaise à la hausse (fermer des doublons relève de la bonne hygiène). */
    abandonment: {
      language,
      polarity: 'neutral',
      format: (value) => formatPercent(value, { precise: true }),
      formatDelta: formatPoints,
      speak: (value) => formatPercent(value, { precise: true }),
      speakDelta: spokenPoints,
      negligible: (delta) => Math.abs(delta) < 0.0005,
      showRatio: false,
    },
    /** Écart Arrivées–Débit : un nombre de tickets signé, sans bon ni mauvais sens (tout dépend de ce que l'équipe vise). */
    balance: {
      language,
      polarity: 'neutral',
      format: (value) => formatSigned(value),
      formatDelta: (delta) => formatSigned(delta),
      speak: (value) => formatSigned(value),
      speakDelta: formatCount,
      negligible: (delta) => Math.abs(delta) < 0.5,
      showRatio: false,
    },
    /** Un nombre de tickets dont moins, c'est mieux (les Prêts qui stagnent). */
    fewer: {
      language,
      polarity: 'lower-is-better',
      format: formatCount,
      formatDelta: (delta) => formatSigned(delta),
      speak: formatCount,
      speakDelta: formatCount,
      negligible: (delta) => Math.abs(delta) < 0.5,
      showRatio: true,
    },
  } as const satisfies Record<string, Measure>;
}

export type Measures = ReturnType<typeof measuresIn>;

/** Les mesures de chaque langue, créées une fois : dans un composant, `MEASURES[useLanguage().language]`. */
export const MEASURES: Record<Language, Measures> = { fr: measuresIn('fr'), en: measuresIn('en') };

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
  const texts = CATALOGS[measure.language].metrics.trend;

  if (previous === null || delta === null) {
    return {
      direction: 'none',
      tone: 'neutral',
      delta: null,
      previous: previous === null ? null : measure.format(previous),
      ratio: null,
      sentence: previous === null ? texts.noPrevious : texts.noCurrent(measure.speak(previous)),
    };
  }

  const current = previous + delta;
  const direction: TrendDirection = measure.negligible(delta) ? 'flat' : delta > 0 ? 'up' : 'down';
  const ratio = measure.showRatio && trend.ratio !== null ? (direction === 'flat' ? FORMATS[measure.language].formatPercent(0) : signedPercent(trend.ratio, measure.language)) : null;

  const [now, before] = [measure.speak(current), measure.speak(previous)];
  const comparison = texts.comparison(now, before);
  // Un écart sous le seuil est « stable » même quand l'arrondi sépare les deux valeurs (« > 99,9 % » contre « 100 % », 30 min contre 29 min) :
  // « comme sur la période précédente » ne se dit que si les deux valeurs se disent pareil. Sinon la phrase dit les deux, comme la tuile
  // (la valeur) et la puce (« avant … ») les écrivent.
  const unchanged = now === before;

  return {
    direction,
    tone: toneOf(direction, measure.polarity),
    delta: measure.formatDelta(delta),
    previous: measure.format(previous),
    ratio,
    sentence:
      direction === 'flat'
        ? unchanged
          ? texts.flatSame(now)
          : texts.flat(comparison)
        : texts.moved(direction === 'up', measure.speakDelta(Math.abs(delta)), ratio, comparison),
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
function signedPercent(ratio: number, language: Language): string {
  const { formatSigned, formatPercent } = FORMATS[language];
  const text = formatSigned(ratio * 100);
  if (text === '0') return CATALOGS[language].metrics.trend.underOnePercent(formatPercent(0.01));
  // Le signe et le nombre déjà écrits, suivis de « % » comme la langue l'accole (« +611 % », « +611% ») : ce qui suit le « 0 » de « 0 % ».
  return `${text}${formatPercent(0).slice(1)}`;
}
