/**
 * Zone « metrics », groupes communs : la tendance d'une grandeur (`metrics/trend.ts`) et la comparaison des périodes
 * (`metrics/comparison.ts`), que les tuiles, le Parcours d'un ticket et le Rapport de rétrospective partagent.
 */
const fr = {
  /** Pourquoi le Taux d'échec ne dit rien (`metrics/failureReason.ts`) : les nombres et pourcentages arrivent écrits. */
  failureReason: {
    lowCoverage: (percent: string, minimum: string) => `couverture insuffisante : ${percent} des bugs ont une origine renseignée (minimum ${minimum})`,
    fewBugs: (bugs: string, minimum: string) => `trop peu de bugs pour conclure : ${bugs} (minimum ${minimum})`,
    separator: ' ; ',
  },
  trend: {
    /** La variation relative quand l'arrondi à l'entier l'effacerait ; `percent` est « 1 % » déjà écrit. */
    underOnePercent: (percent: string) => `moins de ${percent}`,
    /** Une part qui arrondirait à 100 % sans l'être ; `percent` est « 99,9 % » déjà écrit. */
    almostAllWritten: (percent: string) => `> ${percent}`,
    almostAllSpoken: (percent: string) => `plus de ${percent}`,
    noPrevious: 'Pas de comparaison : la période précédente n’a pas de valeur.',
    noCurrent: (previous: string) => `Pas de comparaison : la période courante n’a pas de valeur (précédente : ${previous}).`,
    comparison: (now: string, before: string) => `${now} contre ${before} sur la période précédente.`,
    flatSame: (now: string) => `Stable : ${now} comme sur la période précédente.`,
    flat: (comparison: string) => `Stable : ${comparison}`,
    moved: (up: boolean, delta: string, ratio: string | null, comparison: string) =>
      `En ${up ? 'hausse' : 'baisse'} de ${delta}${ratio ? ` (${ratio})` : ''} : ${comparison}`,
  },
  comparison: {
    /** « 2 nov. à 20:00 » : un jour et une heure déjà écrits. */
    at: (day: string, time: string) => `${day} à ${time}`,
    finishedSummary: (current: string, previous: string) =>
      `Période terminée (${current}). Les tendances la comparent à la période précédente de même durée (${previous}).`,
    finishedTooltip: (previous: string) => `Comparé à la période précédente de même durée : ${previous}.`,
    runningSummary: (current: string, currentUntil: string, previous: string, previousUntil: string) =>
      `Période en cours (${current}), comptée jusqu’au ${currentUntil}. ` +
      `Les tendances la comparent à la période précédente (${previous}) à durée écoulée égale, ` +
      `c’est-à-dire jusqu’au ${previousUntil}.`,
    runningTooltip: (currentUntil: string, previousUntil: string) =>
      `Comparé à la période précédente à durée écoulée égale, jusqu’au ${previousUntil}. ` +
      `La période en cours n’est pas finie : elle est comptée jusqu’au ${currentUntil}.`,
  },
};

const en: typeof fr = {
  failureReason: {
    lowCoverage: (percent, minimum) => `Coverage too low: ${percent} of bugs have a recorded origin (minimum ${minimum})`,
    fewBugs: (bugs, minimum) => `too few bugs to conclude: ${bugs} (minimum ${minimum})`,
    separator: '; ',
  },
  trend: {
    underOnePercent: (percent) => `less than ${percent}`,
    almostAllWritten: (percent) => `> ${percent}`,
    almostAllSpoken: (percent) => `more than ${percent}`,
    noPrevious: 'No comparison: the previous period has no value.',
    noCurrent: (previous) => `No comparison: the current period has no value (previous: ${previous}).`,
    comparison: (now, before) => `${now} versus ${before} in the previous period.`,
    flatSame: (now) => `Steady: ${now}, as in the previous period.`,
    flat: (comparison) => `Steady: ${comparison}`,
    moved: (up, delta, ratio, comparison) => `${up ? 'Up' : 'Down'} by ${delta}${ratio ? ` (${ratio})` : ''}: ${comparison}`,
  },
  comparison: {
    at: (day, time) => `${day} at ${time}`,
    finishedSummary: (current, previous) =>
      `Period ended (${current}). Trends compare it with the previous period of the same length (${previous}).`,
    finishedTooltip: (previous) => `Compared with the previous period of the same length: ${previous}.`,
    runningSummary: (current, currentUntil, previous, previousUntil) =>
      `Period in progress (${current}), counted up to ${currentUntil}. ` +
      `Trends compare it with the previous period (${previous}) over the same elapsed time, ` +
      `that is up to ${previousUntil}.`,
    runningTooltip: (currentUntil, previousUntil) =>
      `Compared with the previous period over the same elapsed time, up to ${previousUntil}. ` +
      `The current period is not over: it is counted up to ${currentUntil}.`,
  },
};

export const core = { fr, en };
