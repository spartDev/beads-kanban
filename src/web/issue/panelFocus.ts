import { focusElement } from '../lib/focus';
import { keepFocusIn } from '../lib/zoneFocus';

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
 * C'est la règle de toute zone qui se recharge, la même que celle des pages (voir `keepFocusIn` dans `lib/zoneFocus.ts`, qui en donne les raisons) : ici
 * la zone est le panneau, et rien d'autre.
 */
export const keepFocusInPanel = keepFocusIn(focusPanelOf);
