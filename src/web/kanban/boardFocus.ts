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
 * `within` est le tableau, ou le contenu principal qui le contient quand l'appelant ne connaît pas le nœud du tableau (le panneau d'un ticket, la palette : voir `movedCardLink`).
 */
export function focusCardOrZone(within: Element, gone?: Element): boolean {
  return focusElement(movedCardLink(within, gone)) || focusZoneOf(within);
}

/**
 * Le lien de la carte dont `gone` faisait partie, là où elle est maintenant dans `within` (le tableau, ou le contenu principal qui le contient). `gone` est un élément de carte, le plus souvent
 * son lien, retiré du document parce qu'un commit a changé la carte de colonne : le sous-arbre qui est parti avec lui tient (`closest`), et l'identifiant de la carte la retrouve. Le panneau
 * d'un ticket et la palette retiennent ainsi le lien de la carte qui les a ouverts pour le lui rendre à leur fermeture, et ce lien n'est plus là quand la carte a changé de colonne entre-temps.
 * Aucune carte : `gone` n'est pas dans une carte (le champ de la palette, un bouton), ou la carte n'est plus dans `within` (le ticket est supprimé, ou dans le tiroir « En pause » fermé).
 * Pour un élément encore dans le document, c'est le lien de sa propre carte.
 *
 * La carte est celle du **même Projet** (`data-card-project`, que le sous-arbre parti garde aussi) : les identifiants de tickets ne sont uniques que dans un Projet, et deux Projets (deux copies, deux clones
 * d'un même dépôt) peuvent avoir les mêmes. Le panneau d'un ticket reste monté d'un Projet à l'autre (un choix de la palette ouvre un ticket de l'autre, sur la même route) : il retient le lien d'une carte
 * du premier, et le tableau qui arrive est celui du second, dont la carte de même identifiant n'est pas la carte d'où l'on venait.
 */
export function movedCardLink(within: Element, gone: Element | null | undefined): HTMLAnchorElement | null {
  const card = gone?.closest('[data-card-id]');
  const id = card?.getAttribute('data-card-id');
  return (card && id ? cardLink(within, id, card.getAttribute('data-card-project')) : undefined) ?? null;
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
