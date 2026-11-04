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
 * Un changement de cause est un nouveau message ; une nouvelle panne après un rétablissement aussi.
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

/** La cause en une phrase : la raison d'un Projet illisible vaut mieux que son message, qui nomme déjà le Projet. */
function describe(error: unknown): string {
  if (error instanceof ProjectUnreadableError) return error.reason;
  return error instanceof Error ? error.message : String(error);
}
