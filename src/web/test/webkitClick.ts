import { act, fireEvent } from '@testing-library/react';

/** Ce que le navigateur donne au focus d'un clic de souris sur lui-même (ou dans ce qu'il contient) : un champ de saisie, ou ce qui porte un `tabindex`. */
const MOUSE_FOCUSABLE = 'input:not([type="button"], [type="submit"], [type="checkbox"], [type="radio"]), textarea, select, [contenteditable]:not([contenteditable="false"]), [tabindex]';

/**
 * Un clic de souris (ou un toucher) tel que WebKit le traite : un lien ou un bouton cliqué ne prend pas le focus, et le clic le retire à ce qui l'avait. Le focus va au plus proche
 * ancêtre que WebKit donne au clic (un champ de saisie, un élément à `tabindex` : le panneau d'un ticket, la boîte de dialogue de la palette), sinon au corps de la page.
 * Mesuré le 2026-11-06 sur l'application construite (bdesk-38k.72), Playwright WebKit 18.2 (le moteur de Safari 18.2) : un clic sur la carte `bdesk-38k.64` laisse le corps de la page l'élément actif de `mouseup` à l'ouverture
 * du panneau, que rien n'ait eu le focus ou que ce soit la carte `bdesk-38k.69` (`j`) ou un lien de la barre latérale, dont le focus est retiré à la fin de `mousedown` ; le contenu principal, qui avait le focus, le garde ; puis Échap
 * rend le focus au contenu principal. Un clic sur « Fermer le panneau » donne le focus au panneau, un clic sur une ligne de la palette à sa liste. Chromium 156 et Firefox 137, eux, donnent le focus au lien à la fin de `mousedown`.
 * jsdom ne choisit pas : `user.click` (user-event) fait comme Chromium, le lien cliqué prend le focus, et `fireEvent.click` n'y touche pas. Ce clic-ci fait comme WebKit.
 */
export function clickLikeWebKit(element: Element): void {
  fireEvent.pointerDown(element);
  fireEvent.mouseDown(element);
  act(() => {
    const target = element.closest<HTMLElement>(MOUSE_FOCUSABLE);
    if (target) target.focus();
    else if (document.activeElement instanceof HTMLElement) document.activeElement.blur();
  });
  fireEvent.pointerUp(element);
  fireEvent.mouseUp(element);
  fireEvent.click(element);
}
