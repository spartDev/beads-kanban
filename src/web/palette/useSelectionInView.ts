import { useLayoutEffect, type RefObject } from 'react';

/** La ligne que cmdk montre sélectionnée dans sa liste. */
const SELECTED_ROW = '[cmdk-list] [cmdk-item][aria-selected="true"]';
const ROW = '[cmdk-item]';
const GROUP = '[cmdk-group]';
const GROUP_HEADING = '[cmdk-group-heading]';

/**
 * Amène `row` dans la zone visible de la liste, comme le fait cmdk (son `scrollSelectedIntoView`) : au plus près, c'est-à-dire sans rien
 * faire pour une ligne déjà entièrement visible, et son en-tête de groupe d'abord quand c'en est la première ligne, pour qu'il reste sous les yeux.
 */
function reveal(row: Element): void {
  if (row.parentElement?.firstElementChild === row) row.closest(GROUP)?.querySelector(GROUP_HEADING)?.scrollIntoView({ block: 'nearest' });
  row.scrollIntoView({ block: 'nearest' });
}

/**
 * La ligne sélectionnée est visible dans la liste, après une sélection d'office comme au clavier ; le survol, lui, ne fait pas défiler.
 *
 * cmdk 1.1.1 défile lui-même après chaque changement de valeur qui n'est pas un survol (`scrollSelectedIntoView`, tâche 5 de sa file, 6 au
 * montage), mais vers la ligne que le DOM montre sélectionnée à cet instant. Quand l'utilisateur déplace la sélection (flèche, Début, Fin),
 * React a rendu le changement avant que la tâche passe : juste. Quand cmdk choisit d'office (`selectFirstItem`, à la frappe, quand une ligne se
 * monte alors qu'il n'a aucune valeur, quand la ligne qu'il montre sélectionnée disparaît), il le fait depuis le vidage de sa file, et la
 * tâche de défilement qu'il y ajoute passe dans la même passe, avant que React ait rendu la nouvelle sélection : il défile vers la ligne
 * d'avant. Si elle est hors de la zone visible (des tickets arrivés au-dessus d'elle pendant la frappe l'ont repoussée), la liste saute vers
 * une ligne qui n'est plus sélectionnée, et la nouvelle reste hors de vue. Si elle est visible (la liste est restée en bas après Fin, la
 * nouvelle première ligne est en haut), rien ne défile du tout, et la nouvelle reste hors de vue de même. Même lecture trop tôt que celle
 * d'`aria-activedescendant` (voir `useActiveDescendant`). Les choix de la palette elle-même (`useSelectionGuard`, `useQuietRow`) ne passent
 * pas par cmdk, qui ne défile alors pas non plus.
 *
 * cmdk n'a aucune option pour couper ce défilement. On le laisse faire et on a le dernier mot, dans la même tâche et avant l'image suivante
 * (jamais d'image avec la liste au mauvais endroit) : `aria-selected` de la ligne est la vérité, et un `MutationObserver` voit tout ce qui la
 * déplace, quelle que soit la façon dont cmdk (ou la palette) a choisi. Quand cmdk avait raison, le second appel ne fait rien : au plus
 * près, une ligne entièrement visible ne bouge pas, et la liste ne saute pas.
 *
 * Le hook ne défile que lorsque la ligne sélectionnée change, y compris quand la précédente a disparu : un rafraîchissement des tickets qui
 * retire la ligne sélectionnée fait amener la nouvelle, même si l'utilisateur avait fait défiler la liste ailleurs à la molette (le but est
 * que la ligne sélectionnée soit toujours visible ; le hook ne lit aucune position de défilement). Il ne défile jamais quand des lignes
 * arrivent ou partent autour d'une sélection qui ne change pas (une liste que l'utilisateur fait défiler à la molette ne revient donc pas
 * d'elle-même vers la sélection à chaque rafraîchissement), ni au survol.
 *
 * Le survol sélectionne la ligne sous le pointeur sans défiler : cmdk ne le fait pas non plus (il demande alors la sélection sans le
 * défilement), et une liste qui glisserait sous un pointeur immobile amènerait dessous la ligne suivante, à survoler à son tour, de proche
 * en proche. On le reconnaît à un `pointermove` sur la ligne (comme `useQuietRow`), et il vaut jusqu'à la prochaine touche, jusqu'à un
 * `pointermove` sur autre chose qu'une ligne, ou jusqu'à ce que le pointeur quitte `root` (la palette) : la même ligne, choisie ensuite à la
 * flèche, ou alors que le pointeur n'est plus sur elle, est amenée.
 *
 * `root` est l'élément racine de `Command`. Comme `useActiveDescendant`, cela lit le DOM de cmdk 1.1.1 (`cmdk-list`, `cmdk-group`,
 * `cmdk-group-heading`, `cmdk-item`) ; branché de même dans le commit qui monte la liste.
 */
export function useSelectionInView(root: RefObject<HTMLElement | null>): void {
  useLayoutEffect(() => {
    const element = root.current;
    if (!element) return undefined;
    // La ligne que la liste montrait sélectionnée à la dernière observation : le premier affichage n'est pas un changement, et seul un changement défile.
    let shown = element.querySelector(SELECTED_ROW);
    // La ligne que le pointeur survole : sa sélection vient du survol, elle ne fait pas défiler.
    let hovered: Element | null = null;

    const observer = new MutationObserver(() => {
      const row = element.querySelector(SELECTED_ROW);
      if (row === shown) return;
      shown = row;
      if (row && row !== hovered) reveal(row);
    });
    observer.observe(element, { subtree: true, childList: true, attributes: true, attributeFilter: ['aria-selected'] });

    const onPointerMove = (event: Event) => {
      hovered = event.target instanceof Element ? event.target.closest(ROW) : null;
    };
    // `keydown` (une touche rend la main au clavier) et `pointerleave` (le pointeur sort de `root`, donc de la palette, sans plus de `pointermove`
    // pour l'annoncer) : l'un et l'autre oublient la ligne survolée. `pointerleave` ne remonte pas : sans capture, c'est `root` lui-même qu'on quitte,
    // pas une ligne que le pointeur laisse pour une autre.
    const onForget = () => {
      hovered = null;
    };
    element.addEventListener('pointermove', onPointerMove, true);
    element.addEventListener('keydown', onForget, true);
    element.addEventListener('pointerleave', onForget);

    return () => {
      observer.disconnect();
      element.removeEventListener('pointermove', onPointerMove, true);
      element.removeEventListener('keydown', onForget, true);
      element.removeEventListener('pointerleave', onForget);
    };
  }, [root]);
}
