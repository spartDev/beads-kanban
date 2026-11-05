import { abortable, ReadAborted } from '../abort';
import type { ProjectService } from './service';

/**
 * Lecteur du HEAD pour les services qui mettent leurs calculs en cache par HEAD (métriques, chronologie). Il lit le HEAD du Projet
 * à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : un processus dolt par demande saturerait vite la
 * file des lectures quand des requêtes arrivent ensemble. Une demande qui arrive pendant une lecture ne s'y raccroche pas, car
 * cette lecture a pu précéder un commit tout récent ; elle attend la suivante, que partagent toutes les demandes arrivées
 * entre-temps. Chaque demande est ainsi servie par une lecture lancée après son arrivée, et il n'y a jamais plus de deux lectures
 * par Projet, une en cours et une en attente.
 *
 * Une demande abandonnée (`signal`) s'en détache aussitôt, sans interrompre la lecture que les autres partagent : elle ne dure que
 * quelques dizaines de millisecondes, par la voie `light` (voir `QueryOptions.lane`).
 */
export function createHeadReader(projects: Pick<ProjectService, 'head'>): (projectId: string, signal?: AbortSignal) => Promise<string> {
  const reads = new Map<string, { running: Promise<string>; waiting?: Promise<string> }>();

  function start(projectId: string): Promise<string> {
    const read = { running: projects.head(projectId) };
    reads.set(projectId, read);
    const finished = () => {
      if (reads.get(projectId) === read) reads.delete(projectId);
    };
    read.running.then(finished, finished);
    return read.running;
  }

  function next(projectId: string): Promise<string> {
    const read = reads.get(projectId);
    if (!read) return start(projectId);
    read.waiting ??= read.running.then(
      () => start(projectId),
      () => start(projectId), // l'échec d'une lecture ne condamne pas celles qui attendaient la suivante
    );
    return read.waiting;
  }

  return (projectId, signal) => {
    if (signal?.aborted) return Promise.reject(new ReadAborted()); // personne n'attend plus : inutile de lancer une lecture
    return abortable(next(projectId), signal);
  };
}
