import { useCallback, useState } from 'react';
import { readStorage, writeStorage } from './storage';

/**
 * La Dernière visite (voir CONTEXT.md) : l'instant jusqu'où l'utilisateur a dit avoir tout vu, propre à ce navigateur. Elle ne bouge que sur son geste
 * (« Tout vu »), jamais à l'ouverture ni au rechargement de l'application. C'est l'instant des données qu'il avait sous les yeux (`asOf` de la réponse), pas
 * l'heure de son clic : un événement commité entre l'affichage et le clic reste à voir.
 */
export const LAST_VISIT_KEY = 'throughline:last-visit';

/**
 * La Dernière visite enregistrée, en ISO 8601 ; `null` sans elle : jamais notée, stockage indisponible (lecture protégée, `readStorage`) ou valeur qui
 * n'est pas un instant (on remonte alors 24 heures, comme sans visite).
 */
export function readLastVisit(): string | null {
  const stored = readStorage(LAST_VISIT_KEY);
  if (stored === null) return null;
  const instant = Date.parse(stored);
  return Number.isNaN(instant) ? null : new Date(instant).toISOString();
}

/**
 * La Dernière visite de ce navigateur, lue une fois au montage, et le geste qui la déplace. Un stockage indisponible (navigation privée, stockage bloqué)
 * n'empêche rien : la visite notée vaut pour la session (l'état du composant), et l'écriture, protégée, n'est simplement pas gardée.
 */
export function useLastVisit(): { lastVisit: string | null; markSeen: (asOf: string) => void } {
  const [lastVisit, setLastVisit] = useState(readLastVisit);
  const markSeen = useCallback((asOf: string) => {
    setLastVisit(asOf);
    writeStorage(LAST_VISIT_KEY, asOf);
  }, []);
  return { lastVisit, markSeen };
}
