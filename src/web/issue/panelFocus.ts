import { focusElement } from '../lib/focus';

/** Marque le panneau d'un ticket (`IssuePanel`), que la palette et l'aide cherchent pour lui rendre le focus (voir `OverlayProvider`) : pas un `role="dialog"` quelconque. */
const ISSUE_PANEL = '[data-issue-panel]';

/**
 * Donne le focus au panneau du ticket qui contient `from`. À faire avant de retirer l'élément qui l'a (le bouton « Réessayer » que le squelette
 * remplace) : sans cela, le focus tomberait sur le corps de la page, hors du panneau (sur mobile, hors d'une boîte de dialogue modale).
 */
export function focusPanelOf(from: Element): boolean {
  return focusElement(from.closest(ISSUE_PANEL));
}

/**
 * Ref à poser sur ce qui, dans le panneau, change d'un coup d'état et peut tenir le focus : le corps du panneau (l'avis d'erreur et son bouton
 * « Réessayer » que le squelette remplace, le contenu qu'un 404 remplace) et la chronologie. Quelle que soit la cause du changement : un réessai,
 * la fiche relue au retour sur l'onglet, le direct. React détache les références avant de retirer le nœud du document, quand le focus y est
 * encore : il passe alors au panneau, au lieu de tomber sur le corps de la page.
 *
 * Ni `blur` ni un effet ne le disent à temps : Chromium envoie `blur` au retrait, l'élément encore dans le document, ce qu'un clic dans le vide
 * fait aussi ; un effet de mise en page vient après le retrait. Le focus qu'un utilisateur a mis ailleurs (un clic dans le vide, une carte du
 * tableau) n'est pas dans le nœud : on n'y touche pas.
 *
 * À garder la même fonction d'un rendu à l'autre : React rejouerait le nettoyage à chaque rendu, et le focus serait pris à chacun.
 */
export function keepFocusInPanel(node: HTMLElement | null): (() => void) | undefined {
  if (node === null) return undefined;
  return () => {
    if (node.contains(document.activeElement)) focusPanelOf(node);
  };
}
