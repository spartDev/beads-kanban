import { realpathSync } from 'node:fs';

/**
 * Le fuseau horaire qui découpe les jours des métriques : les jours et les semaines des périodes, le CFD, l'Âge calendaire d'un Prêt
 * et la Carte d'activité (CONTEXT.md). Les Durées écoulées (Lead Time, Cycle Time…) n'en dépendent pas : elles se calculent sur des
 * instants, et seule la façon de découper le temps en jours change d'un fuseau à l'autre.
 *
 * Le domaine reçoit ce fuseau en paramètre et compte ses jours avec `Intl.DateTimeFormat`, qui lève une `RangeError` sur un nom qu'il ne
 * connaît pas. Or le fuseau local, tel que le moteur le nomme (`Intl.DateTimeFormat().resolvedOptions().timeZone`), n'est pas toujours un
 * nom qu'il accepte. Selon la variable TZ du processus (toutes les versions de Node essayées, 18 à 25, sur macOS) :
 * - vide, ou « : » : `Etc/Unknown`, que `Intl` refuse. Chaque requête de `/api/metrics` répondait alors 500 (bdesk-38k.38) ;
 * - que le moteur ne sait pas nommer (`Invalid/Zone`, `:/etc/localtime`, `EST5`) : `undefined`, alors que le type dit `string`. `Intl` le prend
 *   pour « le fuseau par défaut » sans rien lever : la réponse sortait sans `timeZone`, et ses jours se comptaient dans un fuseau sans nom.
 */

/** Le fuseau choisi pour les métriques et, quand ce n'est pas celui qu'on demandait, de quoi le dire. */
export interface MetricsTimeZone {
  /** Un nom que `Intl` construit : le domaine l'utilise sans jamais lever de `RangeError`. */
  timeZone: string;
  /** Présent quand le fuseau demandé n'était pas reconnu : une ligne pour le journal du serveur, qui nomme celui qui a pris sa place. */
  warning?: string;
}

/** Le dernier recours : UTC existe partout et ne change jamais d'heure. */
const FALLBACK_TIME_ZONE = 'UTC';

const LOCALTIME = '/etc/localtime';
const ZONEINFO = 'zoneinfo/';
/** Les copies de l'arbre `zoneinfo` que certaines distributions Linux gardent dedans (`zoneinfo/posix/Europe/Paris`, `zoneinfo/right/Europe/Paris`) : le nom du fuseau est ce qui les suit. */
const COPIES_OF_ZONEINFO = /^(?:posix|right)\//;

/**
 * Vrai si `name` est un fuseau que `Intl` connaît. Un `undefined` n'en est pas un, même si `new Intl.DateTimeFormat(…, { timeZone })`
 * le prend pour « le fuseau par défaut » sans rien lever.
 */
export function isKnownTimeZone(name: unknown): name is string {
  if (typeof name !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/**
 * Le fuseau que le système déclare, quelle que soit la variable TZ : `/etc/localtime` mène au fichier du fuseau (`…/zoneinfo/Europe/Paris`,
 * sur macOS comme sur Linux), par un lien ou par une chaîne de liens (`/etc/localtime` → `/etc/alternatives/localtime` → `/usr/share/zoneinfo/…`).
 * `resolve` (`realpathSync`) les suit jusqu'au bout ; le nom est ce qui suit le dernier dossier `zoneinfo`, sans le `posix/` ou le `right/` des
 * distributions qui en gardent une copie. Rien si ce n'est pas un lien (un fichier recopié, un conteneur sans fuseau), s'il n'existe pas, s'il boucle
 * ou s'il ne mène pas à un dossier `zoneinfo`. Le nom lu n'est pas vérifié ici : voir `resolveMetricsTimeZone`.
 */
export function systemTimeZone(resolve: (path: string) => string = (path) => realpathSync(path), path = LOCALTIME): string | undefined {
  try {
    const target = resolve(path);
    const start = target.lastIndexOf(ZONEINFO);
    const name = start === -1 ? '' : target.slice(start + ZONEINFO.length).replace(COPIES_OF_ZONEINFO, '');
    return name === '' ? undefined : name;
  } catch {
    return undefined;
  }
}

/**
 * Le fuseau des jours des métriques : `requested` s'il est reconnu, sinon celui du système (`system`, par défaut `/etc/localtime`)
 * s'il l'est, sinon UTC, avec dans ces deux cas une phrase pour le journal.
 *
 * Le fuseau du système passe avant UTC parce que c'est celui de l'utilisateur : la page des métriques compte « aujourd'hui » dans le
 * fuseau de son navigateur, et un serveur en UTC la contredirait chaque nuit tant que leurs dates diffèrent (une plage qui finit
 * aujourd'hui pour l'une serait dans le futur pour l'autre, et refusée). La réponse ne dépend que des arguments : ni horloge ni hasard.
 */
export function resolveMetricsTimeZone(requested: unknown, system: () => string | undefined = systemTimeZone): MetricsTimeZone {
  if (isKnownTimeZone(requested)) return { timeZone: requested };
  const found = system();
  const fromSystem = isKnownTimeZone(found);
  const timeZone = fromSystem ? found : FALLBACK_TIME_ZONE;
  return { timeZone, warning: warningOf(requested, timeZone, fromSystem) };
}

/**
 * Une ligne, qui dit ce qui n'a pas été reconnu, ce qui compte à la place, ce que ça change et comment choisir. Elle ne devine pas la cause : le moteur
 * ne nomme pas le fuseau local d'un nom IANA, par exemple quand TZ est vide, invalide, ou valide mais en notation POSIX sans nom IANA (`EST5`).
 */
function warningOf(requested: unknown, used: string, fromSystem: boolean): string {
  const refused = typeof requested === 'string' ? `Fuseau « ${requested} » non reconnu` : 'Fuseau local sans nom reconnu';
  const instead = fromSystem ? `${used}, le fuseau du système` : 'UTC, faute de fuseau du système lisible';
  return (
    `${refused} : les jours, les semaines et les heures des métriques sont comptés en ${instead} ; les durées n'en dépendent pas. ` +
    'Le moteur ne donne pas de nom IANA au fuseau local, par exemple quand TZ est vide, invalide ou écrit en notation POSIX sans nom IANA (EST5) : ' +
    'définissez TZ avec un nom IANA (TZ=Europe/Paris) pour choisir le fuseau.'
  );
}
