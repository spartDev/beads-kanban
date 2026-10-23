import { useEffect } from 'react';

const APP_NAME = 'beads-desktop';

/**
 * Titre de l'onglet du navigateur : « Kanban · bdesk · beads-desktop ».
 * Sans aucune partie, le titre n'est pas touché : un composant parent peut ainsi laisser la main à la page qu'il affiche
 * (les effets des enfants s'exécutent avant ceux du parent, qui écraserait sinon leur titre).
 */
export function useDocumentTitle(...parts: (string | undefined)[]): void {
  const title = parts.some(Boolean) ? [...parts.filter(Boolean), APP_NAME].join(' · ') : undefined;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
