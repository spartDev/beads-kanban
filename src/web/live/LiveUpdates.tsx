import { isReadable } from '../data/helpers';
import { useProjects } from '../data/hooks';
import { RefreshFailedBanner } from '../shell/RefreshFailedBanner';
import { useRouteInfo } from '../shell/navigation';
import { LiveBanner } from './LiveBanner';
import { useLiveUpdates } from './useLiveUpdates';

/**
 * Les mises à jour en direct du shell : suit le Projet de l'adresse (`/p/:projectId/…`) et relit ses tickets à chaque
 * commit, sur les pages qui en affichent (kanban, Epics, fiche d'un ticket). Rien à suivre sur la Vue globale, ni pour un
 * Projet inconnu ou illisible (il n'a pas de tickets à rafraîchir, et le serveur n'aurait rien à lire), ni sur la page
 * Métriques : rien n'y est en direct, les chiffres sont calculés à la demande, et suivre le Projet ferait sonder sa base
 * pour rien.
 *
 * Porte aussi les deux bandeaux qui disent que ce qui est affiché peut être périmé, pour qu'un seul parle à la fois :
 * quand les mises à jour sont interrompues (serveur coupé), « interrompues » explique tout et « actualisation impossible »
 * se tait ; il reprend la parole au retour de la connexion si l'échec dure.
 */
export function LiveUpdates() {
  const { projectId, section } = useRouteInfo();
  const { data } = useProjects();
  const project = projectId ? data?.projects.find((candidate) => candidate.id === projectId) : undefined;
  const followed = project && isReadable(project) && section !== 'metrics' ? project.id : undefined;
  const { status, failedAttempt, reconnect } = useLiveUpdates(followed);

  return (
    <>
      <RefreshFailedBanner muted={status === 'lost'} />
      <LiveBanner status={status} failedAttempt={failedAttempt} onReconnect={reconnect} />
    </>
  );
}
