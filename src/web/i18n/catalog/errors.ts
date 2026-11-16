import type { ApiErrorCode, ApiErrorParams } from '../../../shared/errors';
import type { Zone } from './zone';

/**
 * Zone « errors » (bdesk-ewr.6) : ce que l'interface écrit pour chaque code d'erreur que le serveur lui envoie (code + paramètres, voir
 * `src/shared/errors.ts`). Les erreurs que le client constate lui-même (serveur injoignable, réponse sans corps lisible) sont écrites par
 * `shell.loadErrors`. Lu par `errorText` (`src/web/data/apiError.ts`), jamais
 * directement par un composant. Fichiers de la zone : ce module, `src/web/data/apiError.ts` (`ApiError` et `errorText`), `src/shared/errors.ts`
 * et les réponses d'erreur du serveur.
 *
 * Les paramètres sont des morceaux du message du serveur : un identifiant, une valeur reçue, un nom de paramètre de l'API, la raison d'un Projet
 * illisible. Aucun n'est traduit : la raison est une phrase française du serveur (un gabarit par classe de cause) tant que ses causes
 * n'ont pas leur code (bdesk-ewr.8). Les nombres arrivent déjà formatés dans la langue (`errorText` les passe par `formatCount`).
 */

/** Les paramètres tels que le catalogue les reçoit : les nombres déjà écrits. */
type Texts<C extends ApiErrorCode> = { [K in keyof ApiErrorParams<C>]: ApiErrorParams<C>[K] extends number ? string : ApiErrorParams<C>[K] };

/** Une phrase par code de l'API. */
export type ApiErrorSentences = { [C in ApiErrorCode]: (params: Texts<C>) => string };

const quotedFr = (name: string) => `« ${name} »`;
const quotedEn = (name: string) => `“${name}”`;

/** « 7d, 30d ou 90d » : la liste fermée des valeurs permises. */
const orFr = (items: readonly string[]) => (items.length <= 1 ? items.join('') : `${items.slice(0, -1).join(', ')} ou ${items.at(-1)}`);
const orEn = (items: readonly string[]) => {
  if (items.length <= 2) return items.join(' or ');
  return `${items.slice(0, -1).join(', ')}, or ${items.at(-1)}`;
};

const api = {
  unexpected: () => 'Erreur inattendue.',
  'request-aborted': () => 'Requête abandonnée par le client.',
  'read-aborted': () => 'Lecture abandonnée par son demandeur.',
  'host-not-allowed': () => "Hôte non autorisé : l'application n'est joignable que par 127.0.0.1 ou localhost.",
  'origin-not-allowed': () => "Origine non autorisée : l'API n'est jointe que par l'application elle-même (127.0.0.1 ou localhost).",
  'project-not-found': ({ project }) => `Projet inconnu : ${project}`,
  'issue-not-found': ({ project, issue }) => `Ticket inconnu dans ${project} : ${issue}`,
  'project-unreadable': ({ reason }) => `Projet illisible : ${reason}`,
  'query-unknown-parameter': ({ parameter, expected }) => `Paramètre inconnu : ${quotedFr(parameter)} (attendus : ${expected.join(', ')}).`,
  'query-empty-project': () => '« project » ne peut pas être vide.',
  'query-range-and-dates': () => 'Choisissez « range » ou « from » et « to », pas les deux.',
  'query-dates-together': () => '« from » et « to » vont ensemble.',
  'query-empty-time-zone': () => '« timeZone » ne peut pas être vide.',
  'query-invalid-range': ({ received, expected }) => `« range » doit valoir ${orFr(expected)} : reçu ${quotedFr(received)}.`,
  'query-not-text': ({ parameter }) => `${quotedFr(parameter)} doit être un texte.`,
  'query-repeated': ({ parameter }) => `${quotedFr(parameter)} ne peut être donné qu'une fois.`,
  'period-inverted': ({ from, to }) => `La plage commence après sa fin : « from » (${from}) doit être avant « to » (${to}).`,
  'period-in-future': ({ to, today }) => `« to » (${to}) est dans le futur : la plage ne peut pas dépasser aujourd'hui (${today}).`,
  'period-too-early': ({ from }) => `La plage doit commencer le 1er janvier 1970 ou après : « from » (${from}) est trop tôt.`,
  'period-too-long': ({ days, max }) => `La plage est trop longue : ${days} jours, au plus ${max}.`,
  'period-invalid-day': ({ parameter, received }) =>
    `${quotedFr(parameter)} doit être un jour qui existe, au format AAAA-MM-JJ : reçu ${quotedFr(received)}.`,
} satisfies ApiErrorSentences;

const fr = {
  /** Les erreurs que l'API envoie, par code. */
  api,
};

const en: typeof fr = {
  api: {
    unexpected: () => 'Unexpected error.',
    'request-aborted': () => 'Request canceled by the client.',
    'read-aborted': () => 'Read canceled by its requester.',
    'host-not-allowed': () => 'Host not allowed: the app can only be reached at 127.0.0.1 or localhost.',
    'origin-not-allowed': () => 'Origin not allowed: the API only answers the app itself (127.0.0.1 or localhost).',
    'project-not-found': ({ project }) => `Unknown Project: ${project}`,
    'issue-not-found': ({ project, issue }) => `Unknown ticket in ${project}: ${issue}`,
    'project-unreadable': ({ reason }) => `Unreadable Project: ${reason}`,
    'query-unknown-parameter': ({ parameter, expected }) => `Unknown parameter: ${quotedEn(parameter)} (expected: ${expected.join(', ')}).`,
    'query-empty-project': () => '“project” cannot be empty.',
    'query-range-and-dates': () => 'Choose “range” or “from” and “to”, not both.',
    'query-dates-together': () => '“from” and “to” go together.',
    'query-empty-time-zone': () => '“timeZone” cannot be empty.',
    'query-invalid-range': ({ received, expected }) => `“range” must be ${orEn(expected)}: got ${quotedEn(received)}.`,
    'query-not-text': ({ parameter }) => `${quotedEn(parameter)} must be a string.`,
    'query-repeated': ({ parameter }) => `${quotedEn(parameter)} can only be given once.`,
    'period-inverted': ({ from, to }) => `The range starts after it ends: “from” (${from}) must be before “to” (${to}).`,
    'period-in-future': ({ to, today }) => `“to” (${to}) is in the future: the range cannot go past today (${today}).`,
    'period-too-early': ({ from }) => `The range must start on or after January 1, 1970: “from” (${from}) is too early.`,
    'period-too-long': ({ days, max }) => `The range is too long: ${days} days, at most ${max}.`,
    'period-invalid-day': ({ parameter, received }) => `${quotedEn(parameter)} must be a real day, formatted YYYY-MM-DD: got ${quotedEn(received)}.`,
  },
};

export const errors: Zone<typeof fr> = { fr, en };
