import { afterEach, beforeEach } from 'vitest';

/** Ce que le navigateur fait focalisable sans `tabindex`. */
const NATIVELY_FOCUSABLE = 'a[href], area[href], button, input, select, textarea, summary, iframe, [contenteditable]';

/** Le navigateur peut-il donner le focus à `element` ? Ni un `tabindex`, ni un élément focalisable par nature : non. */
const canHoldFocus = (element: Element) => element.hasAttribute('tabindex') || element.matches(NATIVELY_FOCUSABLE);

/**
 * Le navigateur retire le focus à l'élément qui cesse d'être focalisable (on lui retire son `tabindex`) : l'élément envoie `blur` et `focusout`, et le corps de la page a le focus.
 * Mesuré le 2026-11-05 sur l'application construite (bdesk-38k.59) : la zone de défilement du panneau, dont un commit raccourcit le contenu, laisse le focus au corps de la page dans Chromium 156,
 * Firefox 137 et WebKit 18.2, à 1280 et à 375 px ; sur une page minimale (bdesk-38k.46), `blur` et `focusout` partent aussitôt dans Chromium, au rendu suivant dans Firefox et WebKit.
 * jsdom ne le fait pas : l'élément y reste l'élément actif, et un test qui ne regarde que `document.activeElement` passerait même quand le navigateur perdrait le focus.
 * Le temps d'un bloc de tests, jsdom fait comme les navigateurs : un changement de `tabindex` qui laisse l'élément actif sans de quoi tenir le focus le lui retire.
 */
export function withFocusFixup(): void {
  let observer: MutationObserver | undefined;
  beforeEach(() => {
    observer = new MutationObserver(() => {
      const active = document.activeElement;
      if (!(active instanceof HTMLElement) || active === document.body || canHoldFocus(active)) return;
      // jsdom ne laisse `blur()` agir que sur un élément focalisable : on lui rend un `tabindex` le temps de lui retirer le focus.
      active.setAttribute('tabindex', '-1');
      active.blur();
      active.removeAttribute('tabindex');
    });
    observer.observe(document, { attributes: true, attributeFilter: ['tabindex'], subtree: true });
  });
  afterEach(() => observer?.disconnect());
}
