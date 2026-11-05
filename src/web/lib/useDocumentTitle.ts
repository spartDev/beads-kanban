import { useEffect } from 'react';
import { isInvisibleText } from './invisibleText';

const APP_NAME = 'beads-desktop';

/**
 * Titre de l'onglet du navigateur : « Kanban · bdesk · beads-desktop ».
 * Sans aucune partie, le titre n'est pas touché : un composant parent peut ainsi laisser la main à la page qu'il affiche
 * (les effets des enfants s'exécutent avant ceux du parent, qui écraserait sinon leur titre). Une partie qu'on ne verrait pas
 * (vide, faite d'espaces ou de caractères sans largeur : `isInvisibleText`) n'en est pas une : écrite telle quelle, elle laisserait
 * du blanc dans le titre (« Kanban ·    · beads-desktop »). Le nom d'un Projet n'est jamais de cette sorte : il arrive écrit « Sans titre » (`namedProjects`), comme le dit son `<h1>`.
 */
export function useDocumentTitle(...parts: (string | undefined)[]): void {
  const shown = parts.filter((part): part is string => part !== undefined && !isInvisibleText(part));
  const title = shown.length > 0 ? [...shown, APP_NAME].join(' · ') : undefined;
  useEffect(() => {
    if (title) document.title = title;
  }, [title]);
}
