import { abortable, ReadAborted } from '../abort';
import { Flight } from '../flight';
import type { ProjectService } from './service';

/**
 * Lecteur du HEAD pour les services qui mettent leurs calculs en cache par HEAD (métriques, chronologie). Il lit le HEAD du Projet
 * à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : un processus dolt par demande saturerait vite la
 * file des lectures quand des requêtes arrivent ensemble. Une demande qui arrive pendant une lecture ne s'y raccroche pas, car
 * cette lecture a pu précéder un commit tout récent ; elle attend la suivante, que partagent toutes les demandes arrivées
 * entre-temps. Chaque demande est ainsi servie par une lecture lancée après son arrivée, et il n'y a jamais plus de deux lectures
 * par Projet qu'on attende, une en cours et une en attente.
 *
 * Une demande abandonnée (`signal`) est libérée aussitôt. Une lecture que plus aucune demande n'attend est abandonnée à son tour
 * (`Flight`) : encore en file dans la voie `light` (voir `QueryOptions.lane`), elle en sort sans jamais lancer de processus ; déjà lancée,
 * elle va au bout, sans être tuée, et son résultat est jeté (ADR 0003). Sans cela, la Vue globale quittée laissait en file les lectures du HEAD
 * de tous ses Projets (une par Projet, quatre à la fois), qui partaient pour personne devant la lecture du HEAD de la chronologie qu'on ouvre en
 * partant (bdesk-38k.42). Une demande sans signal garde la lecture en vie ; il n'y a pas de délai de grâce : la lecture ne dure que quelques
 * dizaines de millisecondes, et la redemander n'est pas plus long que la reprendre.
 *
 * Ce lecteur n'est partagé avec personne : chaque service (métriques, chronologie) a le sien, et le sondage du direct n'en emprunte aucun, il appelle
 * `ProjectService.head` sans signal. Ce qui garde en file une lecture que ces demandeurs ont en commun est la file du client Dolt : les lectures
 * identiques qui attendent encore une place n'y font qu'un `Flight`, retiré quand son dernier demandeur part (ADR 0003, règle 3) ; le sondage, qui ne
 * part jamais, la garde. Une lecture déjà lancée n'y est jamais rejointe : la chronologie ne rejoint donc pas celle que la Vue globale a déjà lancée, elle lance la sienne.
 */
export function createHeadReader(projects: Pick<ProjectService, 'head'>): (projectId: string, signal?: AbortSignal) => Promise<string> {
  /** Par Projet : la lecture en cours (la dernière lancée), et la suivante, que les demandes arrivées entre-temps attendent ensemble. */
  const reads = new Map<string, { running: Flight<string>; waiting?: Flight<string> }>();

  /** `flight` est maintenant la lecture en cours du Projet, jusqu'à sa fin (qu'elle réussisse, échoue ou soit abandonnée). */
  function run(projectId: string, flight: Flight<string>): void {
    reads.set(projectId, { running: flight });
    void flight.settled.then(() => {
      const read = reads.get(projectId);
      // La lecture d'après, encore attendue, prend la place (`follow`) : on n'efface pas l'entrée avant elle. Entre la fin de celle-ci et sa promotion, quelques
      // microtâches, une demande qui trouverait le Projet sans entrée lancerait une troisième lecture, que le `Map` ne suivrait plus. Si la lecture d'après est
      // abandonnée à son tour, l'entrée garde une lecture finie, que la demande suivante dépasse aussitôt (`next`) : une entrée par Projet au plus.
      if (read?.running === flight && !(read.waiting && !read.waiting.abandoned)) reads.delete(projectId);
    });
  }

  function start(projectId: string): Flight<string> {
    const flight: Flight<string> = new Flight((signal) => projects.head(projectId, { signal }));
    run(projectId, flight);
    flight.start();
    return flight;
  }

  /**
   * La lecture d'après : elle ne lit qu'une fois `running` finie, qu'elle ait réussi, échoué ou été abandonnée (l'échec de l'une ne condamne pas
   * les demandes qui attendaient la suivante). Abandonnée par tous ses demandeurs avant d'avoir commencé, elle ne lit jamais.
   */
  function follow(projectId: string, running: Flight<string>): Flight<string> {
    const flight: Flight<string> = new Flight(async (signal) => {
      await abortable(running.settled, signal);
      run(projectId, flight);
      return projects.head(projectId, { signal });
    });
    flight.start();
    return flight;
  }

  /** La lecture que sert une demande qui arrive maintenant. Jamais une lecture abandonnée : elle ne sert plus personne (qui la rejoindrait serait libéré par `ReadAborted`). */
  function next(projectId: string): Flight<string> {
    const read = reads.get(projectId);
    if (read?.waiting && !read.waiting.abandoned) return read.waiting;
    if (!read || read.running.abandoned) return start(projectId); // une lecture abandonnée et déjà lancée va au bout sans personne : inutile de l'attendre
    return (read.waiting = follow(projectId, read.running));
  }

  return (projectId, signal) => {
    if (signal?.aborted) return Promise.reject(new ReadAborted()); // personne n'attend plus : inutile de lancer une lecture
    return next(projectId).join(signal);
  };
}
