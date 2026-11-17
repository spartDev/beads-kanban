/**
 * Les codes des réponses d'erreur de l'API (bdesk-ewr.6) et la forme de leurs paramètres.
 *
 * Une réponse d'erreur garde son `message` français, pour le journal et les autres clients ; elle porte en plus `code` et `params`, d'où
 * l'interface écrit la phrase dans sa langue (`src/web/i18n/catalog/errors.ts`). Un code que l'interface ne connaît pas, ou dont les paramètres
 * n'ont pas la forme attendue (un serveur d'une autre version), s'affiche par son `message`. Les paramètres ne disent rien de plus que le
 * message : ce sont ses morceaux (un identifiant, une valeur reçue, la raison d'un Projet illisible).
 *
 * Ajouter un code : l'écrire ici avec ses paramètres, le lever côté serveur (`ApiErrorDetail`), puis l'écrire dans les deux langues du
 * catalogue `errors` : le compilateur refuse un code oublié.
 */

/**
 * Ce que vaut un paramètre : un texte, un nombre (un compte, que l'interface écrit par `formatCount` : « 1 200 » ; une autre sorte de nombre, une année
 * ou un port, demanderait sa propre sorte), une liste de textes (des noms de l'API).
 */
export type ApiErrorParamKind = 'string' | 'number' | 'string[]';

export const API_ERROR_PARAMS = {
  /**
   * Le message générique « Erreur inattendue. » : une valeur levée qui n'est pas une `Error`, un message qui n'est pas un texte non vide (500, ou le
   * 4xx/5xx que porte l'erreur), ou le filet du gestionnaire. Une erreur imprévue dont le message se lit part sans code.
   */
  unexpected: {},
  /** 499 : le client a fermé sa connexion avant la réponse. */
  'request-aborted': {},
  /** 500 : une lecture abandonnée alors que le client attend toujours (une lecture partagée annulée par d'autres). */
  'read-aborted': {},
  /** 403 : l'en-tête Host n'est pas 127.0.0.1 ou localhost. */
  'host-not-allowed': {},
  /** 403 : la requête ne vient pas de l'application elle-même. */
  'origin-not-allowed': {},
  /** 404 : Projet inconnu. */
  'project-not-found': { project: 'string' },
  /** 404 : ticket inconnu dans un Projet. */
  'issue-not-found': { project: 'string', issue: 'string' },
  /**
   * 503 : le Projet existe mais sa base ne se lit pas. `reason` est la raison telle que le serveur l'écrit : une phrase française, un gabarit par
   * classe de cause qui peut porter un chemin, un délai, un nom ou une valeur de la base (le client vérifié, `stored-sql.ts`, ne reprend pas le
   * texte de Dolt). L'interface l'affiche telle quelle tant que ces causes n'ont pas leur code et leurs paramètres (bdesk-ewr.8).
   */
  'project-unreadable': { reason: 'string' },
  /** 400 : un paramètre de requête que la route ne connaît pas. */
  'query-unknown-parameter': { parameter: 'string', expected: 'string[]' },
  /** 400 : un `project` vide. */
  'query-empty-project': {},
  /** 400 : `range` et `from`/`to` à la fois. */
  'query-range-and-dates': {},
  /** 400 : `from` sans `to`, ou l'inverse. */
  'query-dates-together': {},
  /** 400 : un `timeZone` vide. */
  'query-empty-time-zone': {},
  /** 400 : un `range` qui n'est pas un préréglage. */
  'query-invalid-range': { received: 'string', expected: 'string[]' },
  /** 400 : un paramètre qui n'est pas un texte. */
  'query-not-text': { parameter: 'string' },
  /** 400 : un paramètre donné plusieurs fois. */
  'query-repeated': { parameter: 'string' },
  /** 400 : `from` après `to`. */
  'period-inverted': { from: 'string', to: 'string' },
  /** 400 : `to` après aujourd'hui (`today`, dans le fuseau de la requête). */
  'period-in-future': { to: 'string', today: 'string' },
  /** 400 : `from` avant le 1er janvier 1970. */
  'period-too-early': { from: 'string' },
  /** 400 : plus de `max` jours. */
  'period-too-long': { days: 'number', max: 'number' },
  /** 400 : `from` ou `to` (`parameter`) n'est pas un jour qui existe au format AAAA-MM-JJ. */
  'period-invalid-day': { parameter: 'string', received: 'string' },
} as const satisfies Record<string, Record<string, ApiErrorParamKind>>;

export type ApiErrorCode = keyof typeof API_ERROR_PARAMS;

/** La valeur JSON d'un paramètre de chaque sorte. */
interface ParamValue {
  string: string;
  number: number;
  'string[]': readonly string[];
}

/** Les paramètres d'un code, tels que le serveur les envoie ; aucun pour un code qui n'en a pas (le compilateur refuse d'en ajouter). */
export type ApiErrorParams<C extends ApiErrorCode> = keyof (typeof API_ERROR_PARAMS)[C] extends never
  ? Record<string, never>
  : { -readonly [K in keyof (typeof API_ERROR_PARAMS)[C]]: ParamValue[(typeof API_ERROR_PARAMS)[C][K] & ApiErrorParamKind] };

/** Un code et ses paramètres, de la forme que son code demande. */
export type ApiErrorDetail = { [C in ApiErrorCode]: { code: C; params: ApiErrorParams<C> } }[ApiErrorCode];

/** Le code et les paramètres d'une erreur, s'ils ont la forme attendue ; `undefined` sinon (code inconnu, paramètre manquant, en trop ou mal typé). */
export function readApiErrorDetail(code: unknown, params: unknown): ApiErrorDetail | undefined {
  if (typeof code !== 'string' || !Object.hasOwn(API_ERROR_PARAMS, code)) return undefined;
  const expected: Record<string, ApiErrorParamKind> = API_ERROR_PARAMS[code as ApiErrorCode];
  const given = params === undefined ? {} : params;
  if (given === null || typeof given !== 'object' || Array.isArray(given)) return undefined;
  const entries = Object.entries(given);
  if (entries.length !== Object.keys(expected).length) return undefined;
  for (const [name, value] of entries) {
    if (!Object.hasOwn(expected, name) || !isKind(value, expected[name] as ApiErrorParamKind)) return undefined;
  }
  return { code, params: given } as ApiErrorDetail;
}

function isKind(value: unknown, kind: ApiErrorParamKind): boolean {
  if (kind === 'string') return typeof value === 'string';
  if (kind === 'number') return typeof value === 'number' && Number.isFinite(value);
  return Array.isArray(value) && value.every((item) => typeof item === 'string');
}
