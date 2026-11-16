import { useCallback } from 'react';
import { useLocation, useNavigate } from 'react-router';
import { kanban } from '../i18n/catalog/kanban';
import type { Language } from '../i18n/language';
import { useLanguage } from '../i18n';
import { parsePath, paths } from '../paths';
import { panelSession, useVisits } from './HistoryTrail';

/** Où mène la fermeture : le kanban, la Vue globale, les Epics, les Métriques ou la page précédente. */
type Destination = keyof (typeof kanban)['fr']['panel']['back'];

function destinationOf(origin: string | null, projectId: string): Destination {
  if (origin === null) return 'kanban';
  const { projectId: from, section } = parsePath(origin);
  if (from === undefined) return 'overview';
  if (from !== projectId) return 'previous';
  return section === 'kanban' ? 'kanban' : section === 'epics' ? 'epics' : section === 'metrics' ? 'metrics' : 'previous';
}

/** Le bouton de retour, dans `language` : « Retour au kanban », « Back to Metrics ». */
const backLabel = (destination: Destination, language: Language): string => kanban[language].panel.back[destination];

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
 * `back` nomme le bouton de retour d'après où il mène (« Retour au kanban », « Retour aux Métriques », « Retour à la page précédente »), dans la langue affichée.
 */
export function useClosePanel(projectId: string): { close: () => void; back: string } {
  const { language } = useLanguage();
  const navigate = useNavigate();
  const { key, search } = useLocation();
  const { depth, origin } = panelSession(useVisits(), key);
  const close = useCallback(() => {
    if (origin !== null) void navigate(-depth);
    else void navigate({ pathname: paths.kanban(projectId), search }, { replace: true });
  }, [navigate, projectId, search, origin, depth]);
  return { close, back: backLabel(destinationOf(origin, projectId), language) };
}
