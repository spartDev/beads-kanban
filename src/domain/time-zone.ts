/**
 * Le fuseau horaire qu'on donne au domaine : un nom IANA que `Intl` connaît, ou rien. Les jours et les heures du domaine (`calendar.ts`, `health.ts`)
 * se comptent avec `Intl.DateTimeFormat`, qui lève une `RangeError` sur un nom qu'il ne connaît pas : celui qui lit un fuseau (le serveur, la page)
 * le passe ici avant de le donner. Un module à part, que la page importe sans tirer le calcul des périodes dans son code principal.
 */

/** Le dernier recours quand aucun fuseau n'est reconnu : UTC existe partout et ne change jamais d'heure. */
export const FALLBACK_TIME_ZONE = 'UTC';

/**
 * Le nombre de fuseaux dont le domaine garde les formateurs `Intl` (jours dans `calendar.ts`, Carte d'activité dans `health.ts`) : voir `lruMemo`.
 * Un utilisateur en a un, rarement deux ; plus, c'est un client qui varie le fuseau de ses requêtes, et les plus anciens sont refaits à la demande
 * (une trentaine de microsecondes chacun). Un formateur gardé pèse environ 20 Ko de mémoire native, hors du tas JS : 32 de chaque sorte, 64 en tout,
 * font environ 1,3 Mo.
 */
export const MAX_ZONE_FORMATTERS = 32;

/**
 * Le nom que le moteur donne à ce fuseau, ou rien s'il ne le connaît pas. `Intl` accepte un nom quelle que soit sa casse et en garde plusieurs pour un
 * même fuseau (`eUrOpE/pArIs`, `utc`, `Etc/UTC`) : `resolvedOptions().timeZone` les ramène à un seul, `Europe/Paris`, `UTC`. Qui garde des choses par
 * fuseau (les formateurs du domaine, la réponse de l'API) les clé par ce nom : il n'y en a que quelques centaines, et non autant que de façons de l'écrire.
 *
 * Un `undefined` n'est pas un nom, même si `new Intl.DateTimeFormat(…, { timeZone })` le prend pour « le fuseau par défaut » sans rien lever. Le moteur ne rend
 * pas toujours un nom qu'il accepte pour son propre fuseau (`Intl.DateTimeFormat().resolvedOptions().timeZone` vaut `Etc/Unknown` quand TZ est vide, et rien
 * quand il ne sait pas le nommer). Un fuseau que ce moteur ne connaît pas peut l'être d'un autre : un fuseau ajouté à la base IANA après la version d'ICU de Node
 * (`America/Coyhaique`, tz 2025b, que Chromium connaît et que Node 22.13 ignore).
 */
export function canonicalTimeZone(name: unknown): string | undefined {
  if (typeof name !== 'string') return undefined;
  try {
    return new Intl.DateTimeFormat('en-US', { timeZone: name }).resolvedOptions().timeZone;
  } catch {
    return undefined;
  }
}

/** Vrai si `name` est un fuseau que `Intl` connaît (voir `canonicalTimeZone`). */
export function isKnownTimeZone(name: unknown): name is string {
  return canonicalTimeZone(name) !== undefined;
}
