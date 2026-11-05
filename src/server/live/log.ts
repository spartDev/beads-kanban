import { ProjectUnreadableError } from '../projects/service';
import type { HeadWatcherOptions } from './watcher';

/** Là où le sondage écrit : l'avertissement d'un journal (celui du serveur). */
export interface WatcherLogTarget {
  warn(message: string): void;
}

/**
 * Ce que le sondage du HEAD (voir `createHeadWatcher`) dit au journal du serveur : un message quand un Projet se met à
 * échouer (avec la cause), un autre quand il est rétabli, rien entre les deux. Le sondage retente toutes les quelques
 * secondes, de plus en plus lentement : une ligne par lecture en échec noierait le journal sous une panne qui dure.
 * Un changement de cause est un nouveau message ; une nouvelle panne après un rétablissement aussi. Ce que dolt change
 * à chaque lecture dans sa cause, son heure et le nom tiré au sort de son manifeste temporaire, n'est pas un changement
 * de cause (voir `describe`).
 */
export function createWatcherLog(log: WatcherLogTarget): Required<Pick<HeadWatcherOptions, 'onError' | 'onRecover'>> {
  /** Les Projets en panne, avec la cause déjà signalée. */
  const reported = new Map<string, string>();

  return {
    onError(projectId, error) {
      const cause = describe(error);
      if (reported.get(projectId) === cause) return;
      reported.set(projectId, cause);
      log.warn(`Mises à jour en direct, Projet « ${projectId} » : ${cause}`);
    },

    onRecover(projectId) {
      if (reported.delete(projectId)) log.warn(`Mises à jour en direct, Projet « ${projectId} » : rétablies`);
    },
  };
}

/** Une date et une heure ISO 8601 : `2026-11-05T10:37:55+01:00`, `…Z`, avec ou sans fractions de seconde, fuseau ou `T`. */
const DATE_TIME = String.raw`\d{4}-\d{2}-\d{2}[T ]\d{2}:\d{2}:\d{2}(?:[.,]\d+)?(?:Z|[+-]\d{2}:?\d{2})?`;

/**
 * Ce qui, collé à une heure, en fait un bout de nom ou de chemin et non plus une heure : `/` et `\` (un dossier daté,
 * `/backups/2026-11-05T10:37:55Z/beta`), une lettre, un chiffre, `_` ou `-` (`snap-2026-11-05T10:37:55Z`), un point
 * avant (`x.2026-11-05T10:37:55Z`) ou une extension après (`2026-11-05T10:37:55Z.bak`). Un chemin que dolt cite est
 * celui du Projet : il ne change pas d'une lecture à l'autre, et la ligne doit le dire tel qu'il est.
 *
 * Après l'heure, la garde est aussi celle du retour arrière : le fuseau et les fractions de seconde sont facultatifs, et
 * devant `/Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta` l'expression, qui a refusé l'heure complète (suivie de
 * `/`), l'essaie sans son fuseau, puis sans ses fractions. Ce qui la suit alors est ce que l'heure a abandonné en route,
 * `+` ou `-` (un fuseau), `,` ou `.` et un chiffre (des fractions) : sans eux la garde laisserait passer l'heure raccourcie,
 * et le chemin deviendrait `Time Machine +01:00/beta`. Un point ou une virgule de fin de phrase, eux, laissent l'heure se retirer.
 */
const NOT_PRECEDED_BY_NAME = String.raw`(?<![\w/\\.-])`;
const NOT_FOLLOWED_BY_NAME = String.raw`(?![\w/\\+-]|[.,]\w)`;

/**
 * Le champ `time=` de logrus (entre guillemets ou non), ou à défaut une heure qui se tient seule, hors d'un nom ou d'un
 * chemin ; avec les espaces qui la suivent.
 */
const TIME = new RegExp(String.raw`${NOT_PRECEDED_BY_NAME}(?:time=("?)${DATE_TIME}\1|${DATE_TIME}${NOT_FOLLOWED_BY_NAME})\s*`, 'g');

/** Le nom tiré au sort du manifeste temporaire de dolt, `nbs_manifest_1933868292` : l'erreur le nomme, et il change à chaque lecture. */
const TEMP_NAME = /\b(nbs_manifest_)\d+\b/g;

/**
 * La cause en une phrase : la raison d'un Projet illisible vaut mieux que son message, qui nomme déjà le Projet. Sans ce
 * que dolt y change à chaque lecture (bdesk-38k.51) :
 * - son heure : ses avertissements sont des lignes de journal de logrus, `time="2026-11-05T10:37:55+01:00" level=warning
 *   msg="failed to load database…"`, que `DoltQueryError` garde telles quelles, et l'heure est celle de la lecture ;
 * - le nom tiré au sort de son manifeste temporaire, que dolt crée même pour lire un dossier en lecture seule :
 *   `open …/noms/nbs_manifest_1933868292: permission denied`, qui s'écrit `nbs_manifest_*`.
 * Sans cela la cause changerait à chaque sondage, ne serait jamais « déjà signalée », et chaque lecture en échec
 * écrirait sa ligne. Le journal du serveur date déjà ses lignes. La cause sert aussi bien de texte que de clé de
 * comparaison : deux causes qui ne diffèrent que par ces valeurs s'écrivent, et se comparent, à l'identique. Une date
 * dans un chemin n'est pas l'heure de la lecture : elle reste (voir `NOT_PRECEDED_BY_NAME`).
 */
function describe(error: unknown): string {
  const text = error instanceof ProjectUnreadableError ? error.reason : error instanceof Error ? error.message : String(error);
  const stable = text.replace(TIME, '').replace(TEMP_NAME, '$1*').trim();
  return stable === '' ? text : stable; // une cause qui n'est qu'une heure vaut mieux que rien
}
