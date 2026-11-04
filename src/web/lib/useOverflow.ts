import { type RefObject, useEffect, useState } from 'react';

/**
 * Le contenu de l'élément dépasse-t-il sa zone, en largeur (`x`) ou en hauteur (`y`) ? Une zone qui défile n'est utilisable
 * au clavier que si elle prend le focus (WCAG 2.1.1, axe `scrollable-region-focusable`) ; une zone qui ne défile pas n'a pas
 * à devenir un arrêt de tabulation de plus. La taille est relue quand l'élément change de taille (la fenêtre) et quand son
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
