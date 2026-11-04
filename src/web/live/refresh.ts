import type { Query, QueryClient } from '@tanstack/react-query';
import { queryKeys } from '../data/hooks';

/** Relit la requête sans interrompre sa lecture en cours : si elle se lit déjà, c'est cette lecture-là que l'on rejoint. */
const readWithoutCancelling = (queryClient: QueryClient, query: Query): Promise<void> =>
  queryClient.refetchQueries({ predicate: (candidate) => candidate === query }, { cancelRefetch: false });

/**
 * Relit la requête de façon à ce que ce qu'elle affiche ensuite soit postérieur à l'appel. Sans lecture en cours, on lit
 * tout de suite. Sinon la lecture en cours va jusqu'au bout (elle a pu commencer avant le commit : ses données peuvent
 * être périmées, mais elles sont affichées en attendant) et UNE relecture la suit : les commits arrivés pendant la même
 * lecture attendent tous sa fin, le premier lance la relecture et les autres la rejoignent. Une requête n'a donc jamais
 * deux lectures à la fois, et une lecture n'est jamais abandonnée.
 */
function readAfter(queryClient: QueryClient, query: Query): Promise<void> {
  if (query.state.fetchStatus !== 'fetching') return readWithoutCancelling(queryClient, query);

  return readWithoutCancelling(queryClient, query).then(() => {
    if (!query.isActive()) {
      // On a quitté la page pendant la lecture : rien à relire pour personne, mais ce qu'elle a rapporté date d'avant le
      // commit (elle l'a effacé du « périmé ») ; la requête sera relue à son prochain affichage.
      query.invalidate();
      return;
    }
    return readWithoutCancelling(queryClient, query);
  });
}

/**
 * Un commit du Projet : la liste des tickets et les fiches qu'on en a lues sont périmées. Les requêtes affichées sont
 * relues (`readAfter`) ; les autres sont seulement marquées périmées et seront relues à leur prochain affichage. Les
 * fiches et chronologies sont rangées sous la liste (`queryKeys.issue`, `queryKeys.chronology`) ; les autres Projets et
 * la liste des Projets n'en font pas partie, et les métriques (clé `metrics`) ne sont pas en direct : elles sont
 * calculées à la demande.
 *
 * Une lecture plus longue que l'écart entre deux commits (la chronologie d'un gros Projet, un sondage à 500 ms) n'est pas
 * annulée par le commit suivant : annulée à chaque fois, elle ne s'achèverait jamais et l'écran resterait sur une donnée
 * périmée. Chaque requête avance à son rythme : une lecture lente ne retarde pas celles des autres.
 */
export function refreshProject(queryClient: QueryClient, projectId: string): Promise<void> {
  const filters = { queryKey: queryKeys.issues(projectId) };
  void queryClient.invalidateQueries({ ...filters, refetchType: 'none' });
  const displayed = queryClient.getQueryCache().findAll({ ...filters, type: 'active' });
  return Promise.all(displayed.map((query) => readAfter(queryClient, query))).then(() => undefined);
}

/**
 * Le flux vient de s'ouvrir : ce qui est affiché peut dater d'avant la connexion (retour sur un Projet resté en
 * cache, reconnexion après une coupure, onglet qui revient d'être caché), et les commits d'entre-temps n'ont pas été
 * annoncés. Même relecture qu'un commit, sauf pour ce qui est déjà en cours de lecture : cette lecture est postérieure
 * à l'ouverture, ou presque, et en lancer une seconde ferait lire deux fois chaque Projet à chaque chargement de page.
 *
 * La liste des Projets est relue aussi quand son dernier rafraîchissement a échoué : le serveur était coupé, et
 * « Actualisation impossible » ne doit pas survivre à son retour.
 */
export function resyncProject(queryClient: QueryClient, projectId: string): Promise<void> {
  const projects = queryClient.invalidateQueries({
    queryKey: queryKeys.projects,
    exact: true,
    predicate: (query) => query.state.status === 'error' && query.state.fetchStatus === 'idle',
  });
  const issues = queryClient.invalidateQueries({
    queryKey: queryKeys.issues(projectId),
    predicate: (query) => query.state.fetchStatus === 'idle',
  });
  return Promise.all([projects, issues]).then(() => undefined);
}
