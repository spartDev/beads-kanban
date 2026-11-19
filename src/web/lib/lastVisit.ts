import { useCallback, useState } from 'react';
import { readStorage, writeStorage } from './storage';

/**
 * La Dernière visite (voir CONTEXT.md) : l'instant jusqu'où l'utilisateur a dit avoir tout vu, propre à ce navigateur. Elle ne bouge que sur son geste
 * (« Tout vu »), jamais à l'ouverture ni au rechargement de l'application. C'est l'instant des données qu'il avait sous les yeux (`asOf` de la réponse), pas
 * l'heure de son clic : un événement commité entre l'affichage et le clic reste à voir.
 */
export const LAST_VISIT_KEY = 'throughline:last-visit';

/**
 * La visite notée par cet onglet, gardée par le module : elle survit au démontage de l'accueil (on va sur une autre page, on revient), même quand le
 * stockage refuse l'écriture (navigation privée, stockage bloqué, quota). Un rechargement de la page la perd ; le stockage, quand il marche, la garde.
 */
let noted: string | null = null;

/** Oublie la visite notée pendant la session : pour les tests, qui vident aussi le stockage entre deux essais (`test/setup.ts`). */
export function forgetNotedVisit(): void {
  noted = null;
}

/** La Dernière visite du stockage, en ISO 8601 ; `null` sans elle, quand le stockage ne lit pas (`readStorage`) ou quand la valeur n'est pas un instant. */
function storedVisit(): string | null {
  const stored = readStorage(LAST_VISIT_KEY);
  if (stored === null) return null;
  const instant = Date.parse(stored);
  return Number.isNaN(instant) ? null : new Date(instant).toISOString();
}

/**
 * La Dernière visite, en ISO 8601 : la plus récente de celle que cet onglet a notée et de celle du stockage. Elle est propre au navigateur, pas à l'onglet
 * (CONTEXT.md) : une visite notée plus tard dans un autre onglet, que le stockage porte, l'emporte sur celle d'ici. La visite d'ici vaut seule quand le
 * stockage ne lit pas ou garde une valeur plus ancienne (une écriture refusée). `null` sans aucune des deux : on remonte alors 24 heures.
 */
export function readLastVisit(): string | null {
  const stored = storedVisit();
  if (noted === null) return stored;
  if (stored === null) return noted;
  return Date.parse(stored) > Date.parse(noted) ? stored : noted;
}

/**
 * La Dernière visite de ce navigateur, lue au montage (`readLastVisit`), et le geste qui la déplace. Un stockage indisponible n'empêche rien : la visite notée
 * vaut pour la session (`noted`), et l'écriture, protégée, n'est simplement pas gardée.
 */
export function useLastVisit(): { lastVisit: string | null; markSeen: (asOf: string) => void } {
  const [lastVisit, setLastVisit] = useState(readLastVisit);
  const markSeen = useCallback((asOf: string) => {
    noted = asOf;
    setLastVisit(asOf);
    writeStorage(LAST_VISIT_KEY, asOf);
  }, []);
  return { lastVisit, markSeen };
}
