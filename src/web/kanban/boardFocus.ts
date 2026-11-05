import { type RefObject, useEffect } from 'react';
import { focusElement } from '../lib/focus';
import { focusZoneOf, watchContent } from '../lib/zoneFocus';
import { cardLink } from './useBoardShortcuts';

/**
 * Où le focus va quand ce qui l'avait dans le tableau en part, retiré du document (voir `watchContent`). Le plus souvent, c'est une carte que le commit change
 * de colonne : React ne déplace pas un nœud d'un parent à l'autre, il remonte la carte dans la nouvelle colonne, et le focus qu'elle avait, la sélection du clavier
 * (voir `useBoardShortcuts`), tombait sur le corps de la page. Il suit la carte, par son identifiant, jusqu'à son lien : celui de son titre, même quand c'était la pastille d'Epic qui l'avait,
 * puisque c'est ce que « la carte sélectionnée » a pour focus. Sans carte à l'écran (la colonne où elle arrive est cachée sur un écran étroit, le ticket est supprimé ou part dans le tiroir
 * « En pause » fermé), c'est la zone la plus proche, le contenu principal. Jamais le corps de la page, et jamais une colonne que l'utilisateur n'a pas choisie : seul son choix change celle
 * qu'un écran étroit affiche (voir `Board`).
 * Sans défilement (`focusElement`) : le focus n'est pas l'attention de l'utilisateur, qui a pu faire défiler la page ailleurs ; la carte le garde, où qu'elle soit.
 */
export function focusCardOrZone(board: Element, gone?: Element): boolean {
  const id = gone?.closest('[data-card-id]')?.getAttribute('data-card-id');
  const link = id ? cardLink(board, id) : undefined;
  return focusElement(link ?? null) || focusZoneOf(board);
}

/**
 * Veille le tableau (`rootRef`) tant qu'il est monté : le focus qu'une carte tient ne tombe pas sur le corps de la page quand un commit la change de colonne (voir `focusCardOrZone`).
 * C'est la veille de `keepFocusInContent` (`watchContent`, dans `lib/zoneFocus.ts`) et ses garanties : seul le focus qu'un élément du tableau a *maintenant* est rendu, jamais celui que l'utilisateur
 * a mis ailleurs (la barre latérale, le panneau d'un ticket, un clic dans le vide). Quand c'est le tableau lui-même qui part (une autre page), la veille s'arrête sans rien rendre : où va le focus
 * d'une navigation n'est pas son affaire.
 */
export function useKeepFocusInBoard(rootRef: RefObject<HTMLElement | null>): void {
  useEffect(() => {
    const board = rootRef.current;
    return board ? watchContent(board, focusCardOrZone) : undefined;
  }, [rootRef]);
}
