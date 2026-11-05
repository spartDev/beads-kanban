import { type RefObject, useEffect, useState } from 'react';

/**
 * Le contenu de l'élément dépasse-t-il sa zone, en largeur (`x`) ou en hauteur (`y`) ? Une zone qui défile n'est utilisable
 * au clavier que si elle prend le focus (WCAG 2.1.1, axe `scrollable-region-focusable`) ; une zone qui ne défile pas n'a pas
 * à devenir un arrêt de tabulation de plus (c'est `useScrollFocusable` qui en décide). La taille est relue quand l'élément change de taille (la fenêtre) et quand son
 * contenu change (un chargement qui l'agrandit) : un `ResizeObserver` seul ne verrait pas grandir le contenu d'une zone de taille fixe.
 */
export function useOverflow(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y'): boolean {
  const [overflows, setOverflows] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const measure = () =>
      setOverflows(axis === 'x' ? element.scrollWidth > element.clientWidth + 1 : element.scrollHeight > element.clientHeight + 1);
    measure();
    const resized = new ResizeObserver(measure);
    resized.observe(element);
    const changed = new MutationObserver(measure);
    changed.observe(element, { childList: true, subtree: true, characterData: true });
    return () => {
      resized.disconnect();
      changed.disconnect();
    };
  }, [ref, axis]);
  return overflows;
}

/**
 * La zone doit-elle être focalisable (`tabindex="0"`) ? Oui tant que son contenu dépasse (`useOverflow`) : sans cela, personne ne pourrait la faire défiler au clavier. Et oui tant qu'elle a le focus :
 * lui retirer son `tabindex` parce que son contenu a raccourci (un commit en direct qui réécrit le texte, la fenêtre qu'on agrandit) la ferait perdre le focus, que le navigateur laisse alors tomber sur le
 * corps de la page, hors du panneau ou de la boîte de dialogue modale qui la contient (mesuré dans Chromium 156, Firefox 137 et WebKit 18.2). Elle garde donc son `tabindex`, et tout ce qui va avec (son rôle, son
 * nom), le temps que le focus est sur elle ; dès qu'il la quitte, elle cesse d'être focalisable : un arrêt de tabulation de moins. Aucun focus n'est pris ni rendu : celui qu'elle a, elle le garde, c'est tout.
 *
 * Le focus est sur la zone elle-même, pas sur ce qu'elle contient (un lien : le `focusin` des descendants monte jusqu'à elle). Au `focusout`, on regarde au tour suivant (une micro-tâche, comme `watchContent`)
 * si la zone est encore l'élément actif : quand la fenêtre passe au second plan, le navigateur envoie `focusout` à la zone, qui reste l'élément actif du document, et le commit que l'utilisateur ne voit pas
 * peut la raccourcir. Ce cas n'a pas été mesuré dans un vrai navigateur (un navigateur sans tête ne peut pas défocaliser sa fenêtre) : il tient aux tests.
 */
export function useScrollFocusable(ref: RefObject<HTMLElement | null>, axis: 'x' | 'y'): boolean {
  const overflows = useOverflow(ref, axis);
  const [focused, setFocused] = useState(false);
  useEffect(() => {
    const element = ref.current;
    if (!element) return;
    const entered = (event: FocusEvent) => setFocused(event.target === element);
    const left = (event: FocusEvent) => {
      if (event.target === element) queueMicrotask(() => setFocused(document.activeElement === element));
    };
    element.addEventListener('focusin', entered);
    element.addEventListener('focusout', left);
    setFocused(document.activeElement === element);
    return () => {
      element.removeEventListener('focusin', entered);
      element.removeEventListener('focusout', left);
    };
  }, [ref]);
  return overflows || focused;
}
