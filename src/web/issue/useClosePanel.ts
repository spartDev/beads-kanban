import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { parsePath, paths } from '../paths';
import { panelSession, useVisits } from './HistoryTrail';

/** Où mène la fermeture, dit comme la fin de « Retour … » : « au kanban », « aux Métriques ». */
function destinationOf(origin: string | null, projectId: string): string {
  if (origin === null) return 'au kanban';
  const { projectId: from, section } = parsePath(origin);
  if (from === undefined) return 'à la Vue globale';
  if (from !== projectId) return 'à la page précédente';
  return section === 'kanban' ? 'au kanban' : section === 'epics' ? 'aux Epics' : section === 'metrics' ? 'aux Métriques' : 'à la page précédente';
}

/**
 * La fermeture du panneau d'un ticket. Le panneau est une couche posée sur la page d'où l'on vient (le plus souvent le
 * tableau) : on le ferme en revenant à cette page, d'autant d'entrées en arrière qu'il en a empilé (`panelSession`), exactement
 * comme « Retour » du navigateur répété jusqu'à lui, et l'historique ne s'allonge pas. Cela vaut quel que soit le chemin pris :
 * une carte, un lien du panneau, la palette ⌘K ou un lien des Métriques ouvrent chacun une entrée de plus ou en remplacent une.
 *
 * Sans page d'origine connue (adresse collée, rechargement, entrée oubliée), le panneau n'a rien derrière lui dans
 * l'application : un retour en arrière en sortirait peut-être, il remplace donc son entrée par le kanban du Projet. Ce qui
 * est connu est relu à chaque entrée d'historique, pas figé à l'ouverture.
 *
 * `destination` dit où cela mène (« au kanban », « aux Métriques », « à la page précédente »), pour nommer les boutons de retour.
 */
export function useClosePanel(projectId: string): { close: () => void; destination: string } {
  const navigate = useNavigate();
  const { key, search } = useLocation();
  const { depth, origin } = panelSession(useVisits(), key);
  const close = useCallback(() => {
    if (origin !== null) void navigate(-depth);
    else void navigate({ pathname: paths.kanban(projectId), search }, { replace: true });
  }, [navigate, projectId, search, origin, depth]);
  return { close, destination: destinationOf(origin, projectId) };
}
