import type { IncomingHttpHeaders } from 'node:http';

/** Ce que le serveur sait de lui-même, et d'où une origine est la sienne (voir `isOwnRequest`). */
export interface OriginPolicy {
  /** Le port sur lequel le serveur écoute ; inconnu tant qu'il n'écoute pas (tests avec `app.inject`) : toute origine locale passe alors. */
  port: number | undefined;
  /**
   * Toute origine locale passe, quel que soit son port. Pour le développement : la page est servie par Vite (`localhost:5173`), dont le
   * proxy relaie les requêtes à l'API avec les en-têtes du navigateur, `Origin` et `Sec-Fetch-Site` compris, tels quels.
   */
  anyPort: boolean;
}

/**
 * L'origine de l'application : `http://127.0.0.1:<port>` ou `http://localhost:<port>` (les deux noms que prend l'en-tête Host), sans chemin ni
 * identifiants : le navigateur écrit une origine ainsi, et rien d'autre. Le serveur ne parle pas TLS : `https` n'est pas la sienne.
 *
 * Deux écritures sont acceptées sans que le navigateur les envoie jamais (relecture finale de bdesk-38k.64, remarque 3 ; bdesk-38k.67) : la casse (`HTTP://LOCALHOST:5179`,
 * l'expression ignore la casse, comme celle de l'en-tête Host) et un port complété de zéros à gauche, dans la limite de cinq chiffres (`http://127.0.0.1:05179`, que `isOwnOrigin` compare comme un nombre :
 * `:05180` reste un autre port). Le navigateur écrit l'origine en minuscules, le port sans zéros initiaux ; seul un client qui n'est pas un navigateur peut envoyer l'autre écriture, et il
 * passe déjà en n'envoyant pas `Origin`. Ce contrôle arrête les pages web : normaliser ce qu'aucune d'elles n'écrit n'ajouterait rien, et refuserait ce client-là pour rien.
 */
const LOCAL_ORIGIN = /^http:\/\/(?:127\.0\.0\.1|localhost)(?::(\d{1,5}))?$/i;

/**
 * Les seules valeurs de `Sec-Fetch-Site` qui sont les nôtres : `same-origin` (la page de l'application, qui appelle son API ou ouvre son
 * flux) et `none` (une adresse tapée dans la barre d'adresse, un signet : l'utilisateur lui-même, mais pas un préchargement : voir
 * `isOwnRequest`). `same-site` (même hôte, autre port : une autre application locale) et `cross-site` ne le sont pas, ni rien de ce qu'un
 * navigateur n'envoie pas : on ne devine pas.
 */
const OWN_FETCH_SITES = new Set(['same-origin', 'none']);

/**
 * La requête est-elle celle de l'application elle-même, ou de ce qui n'est pas une page web (curl, un script, les tests) ? Non quand une
 * page d'un autre site, ou une autre application locale, l'a fait partir. Trois sortes d'en-têtes que le navigateur pose, chacune pour une sorte de requête, et
 * qui doivent toutes passer. Une page ne peut écrire ni `Origin` ni `Sec-Fetch-Site` ni `Sec-Purpose` : ce sont des noms interdits à `fetch` et à `XMLHttpRequest` (`Origin`
 * est dans la liste du Fetch Standard, les deux autres ont le préfixe `Sec-`). L'ancien `Purpose` n'en est pas un, et une page peut l'écrire : sans effet, il ne peut que
 * faire refuser (voir sa puce), et d'une autre origine il fait précéder la requête d'un contrôle préalable (OPTIONS, qui n'a pas de route : 404) qui l'empêche de partir :
 *
 * - `Origin` accompagne une requête `cors` d'une autre origine, et toute requête qui n'est pas un GET. La page de l'application est de même
 *   origine que le serveur et ne fait que des GET : le navigateur n'y met pas d'`Origin`. Un `Origin` qui n'est pas celui du serveur
 *   (`127.0.0.1` ou `localhost`, sur son port) est donc une autre page ;
 * - `Sec-Fetch-Site` accompagne toute requête, `no-cors` comprise. Or `fetch(url, { mode: 'no-cors' })`, `<img>`, `<script>`, `<iframe>`,
 *   un formulaire ou une navigation d'une page tierce partent SANS `Origin` : sans lui, elles feraient travailler l'API (lectures Dolt,
 *   calcul des métriques, caches) sans que la page puisse lire la réponse. On n'accepte que `same-origin` et `none` ;
 * - `Sec-Purpose` (et l'ancien `Purpose`) accompagne un préchargement. Les règles de spéculation de Chrome (`<script type="speculationrules">`,
 *   `eagerness: immediate`) font demander à l'API, sans aucun geste de l'utilisateur, les adresses que la page choisit, et le navigateur les
 *   demande comme une navigation que l'utilisateur aurait lancée : `Sec-Fetch-Site: none`, celui d'une adresse tapée, et pas d'`Origin`. Seul
 *   cet en-tête les trahit (relecture de bdesk-38k.64 : 20 requêtes en 200 et 49 appels à dolt dans Chromium et Chrome 156). Il est refusé,
 *   quelle que soit sa valeur, SAUF avec `Sec-Fetch-Site: same-origin` : Chrome peut précharger l'application elle-même (omnibox, signets, page
 *   d'accueil, règles de même origine), et CHAQUE requête de la page préchargée porte alors `Sec-Purpose: prefetch;prerender`, ses `fetch` vers
 *   l'API compris, qui sont `same-origin` ; les refuser montrait « Projets indisponibles » sans reprise (relecture finale, BUG A).
 *
 *   Cette exception suppose deux choses de l'application (relecture finale 2, B1). Une page tierce ne choisit pas l'adresse d'une requête
 *   `same-origin` (le DNS rebinding est refusé par le contrôle du Host ; l'application encadrée par une page tierce est refusée par `frame-ancestors` :
 *   `framing.ts`, bdesk-38k.67), mais elle en provoque pour les adresses que le HTML de l'application nomme : un `<link rel="prerender">` d'une page de l'application
 *   (le NoState Prefetch de Chrome, qui n'exécute aucun script) fait demander son script et sa feuille de style avec `Sec-Fetch-Site:
 *   same-origin` et `Sec-Purpose: prefetch`, et ces requêtes passent. Donc : (1) le HTML de l'application (`src/web/index.html`, que servent
 *   toutes les adresses qui ne sont pas de l'API) ne nomme jamais une adresse de l'API, par exemple un `<link rel="preload" as="fetch"
 *   href="/api/…">` ; (2) l'application n'envoie jamais `Supports-Loading-Mode`, l'accord d'une page d'une autre origine du même site (une autre
 *   application locale) à être préchargée, donc exécutée : sans lui Chrome annule la spéculation, et n'exécute pas une application dont les
 *   `fetch` seraient `same-origin`. `origin.test.ts` garde les deux ; l'ADR 0002 donne les mesures (Chrome 156 : ni requête `/api` ni appel à
 *   dolt pour un prerender, un prefetch ou un `<link rel=prerender>` de l'application par une page d'un autre site). curl et les scripts
 *   n'envoient pas ces en-têtes.
 *
 * L'absence d'un en-tête est un client qui n'est pas un navigateur, ou un navigateur qui n'envoie pas `Sec-Fetch-Site` (avant 2023) : il
 * passe. Ce contrôle arrête les pages web, pas les processus locaux, qui lisent déjà la base de Dolt eux-mêmes.
 */
export function isOwnRequest(headers: IncomingHttpHeaders, { port, anyPort }: OriginPolicy): boolean {
  const { origin, 'sec-fetch-site': site } = headers;
  if ((headers['sec-purpose'] !== undefined || headers.purpose !== undefined) && site !== 'same-origin') return false;
  if (origin !== undefined && !isOwnOrigin(origin, port, anyPort)) return false;
  return site === undefined || (typeof site === 'string' && OWN_FETCH_SITES.has(site));
}

/** `127.0.0.1:<port>` ou `localhost:<port>` ; sans port d'écoute connu, n'importe lequel (comme pour l'en-tête Host). */
function isOwnOrigin(origin: string, port: number | undefined, anyPort: boolean): boolean {
  const match = LOCAL_ORIGIN.exec(origin);
  if (!match) return false;
  return anyPort || port === undefined || Number(match[1] ?? 80) === port;
}
