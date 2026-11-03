/**
 * Les jours du kanban sont les jours calendaires du fuseau du navigateur (la `Date` locale), pas des tranches de 24 h :
 * un jour de changement d'heure dure 23 ou 25 h, et « hier » comme « ces 14 derniers jours » commencent toujours à minuit.
 *
 * C'est la seule notion de jour du kanban : l'âge écrit sur une carte (`relativeTime`) et la fenêtre de Terminé
 * (`kanban/columns`) l'utilisent toutes deux, si bien qu'une carte qui dit « hier » est dans Terminé exactement quand
 * Terminé couvre hier. Les dates écrites en toutes lettres (« 5 sept. », « mardi 13 octobre ») passent par `localDateFormat`,
 * pour que le jour écrit soit le jour compté. (La page Métriques a la même convention avec un fuseau IANA explicite, dans
 * `src/domain/calendar.ts` ; le kanban lit l'horloge du navigateur et ne prend au domaine que sa règle de colonne.)
 */

const DAY_MS = 86_400_000;

/**
 * Le premier instant du jour calendaire de `ms`, décalé de `offsetDays` jours calendaires (négatif : en arrière) : minuit,
 * heure locale. Quand l'horloge saute ou recule autour de minuit (La Havane), le jour commence à son premier instant, ce
 * que `Date` donne à une heure locale qui n'existe pas ou qui se répète.
 */
export function startOfLocalDay(ms: number, offsetDays = 0): number {
  const date = new Date(ms);
  return new Date(date.getFullYear(), date.getMonth(), date.getDate() + offsetDays).getTime();
}

/**
 * Combien de jours calendaires séparent `then` de `now` : 0 le même jour, 1 la veille, 2 l'avant-veille… négatif pour un jour
 * à venir. C'est le `n` tel que `startOfLocalDay(now, -n) <= then < startOfLocalDay(now, -n + 1)` : un jour de 25 h reste un
 * seul jour, et 35 h peuvent séparer deux jours comme trois.
 */
export function calendarDaysAgo(then: number, now: number): number {
  const earlier = new Date(then);
  const later = new Date(now);
  // Les dates du calendrier, rapportées à UTC pour que les changements d'heure ne comptent pour rien : l'écart est exact.
  const dayOf = (date: Date) => Date.UTC(date.getFullYear(), date.getMonth(), date.getDate());
  return (dayOf(later) - dayOf(earlier)) / DAY_MS;
}

/**
 * Un écrivain de dates en français, pour ces `options`, qui écrit un instant comme le calendrier local le lit : le jour qu'il
 * écrit est celui que `startOfLocalDay` et `calendarDaysAgo` comptent. On le crée une fois (à l'import d'un module) et on le
 * rappelle autant qu'on veut.
 *
 * Un `Intl.DateTimeFormat` sans fuseau explicite garde celui de sa création, alors que `Date` suit le fuseau courant : gardé du
 * chargement du module, il écrirait « lundi 12 octobre » pour le minuit du 13 dès que le fuseau a changé depuis (réglage du
 * système pendant la session, tests). Ici le formateur est fixé sur UTC, qui ne change jamais, et reçoit les champs du
 * calendrier local que `Date` lit à chaque appel, comme `calendarDaysAgo` : rien de périmé à garder. En recréer un à chaque
 * appel coûterait une trentaine de microsecondes, contre moins d'une.
 *
 * Les `options` ne doivent pas écrire le nom du fuseau (`timeZoneName`, `timeStyle` long ou full) : il dirait UTC.
 * Comme `Intl.DateTimeFormat#format`, l'écrivain lève une `RangeError` sur une date illisible.
 */
export function localDateFormat(options: Intl.DateTimeFormatOptions): (at: number | Date) => string {
  const format = new Intl.DateTimeFormat('fr', { ...options, timeZone: 'UTC' });
  return (at) => {
    const date = new Date(at);
    return format.format(
      Date.UTC(
        date.getFullYear(),
        date.getMonth(),
        date.getDate(),
        date.getHours(),
        date.getMinutes(),
        date.getSeconds(),
        date.getMilliseconds(),
      ),
    );
  };
}
