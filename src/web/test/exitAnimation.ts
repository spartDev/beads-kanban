import { act } from '@testing-library/react';
import { afterEach, beforeEach, vi } from 'vitest';

const EXIT_ANIMATION = 'palette-out';

/**
 * jsdom ne joue aucune animation CSS : Radix y retire une boîte de dialogue à l'instant où elle se ferme. Un navigateur la garde
 * montée le temps de son animation de sortie (`data-[state=closed]:animate-…`, 90 ms), et sa couche, encore la plus haute, réagit
 * alors à Échap. Ce faux `getComputedStyle` donne une animation de sortie à tout élément fermé (c'est ce que Radix lit pour savoir
 * s'il doit attendre) ; `finish` la termine, comme le ferait le navigateur : pour tous les éléments fermés, ou pour `only` seul, quand un test
 * veut qu'une boîte de dialogue en ait fini avant une autre.
 */
export function holdExitAnimations() {
  const real = window.getComputedStyle;
  const spy = vi.spyOn(window, 'getComputedStyle').mockImplementation((element, pseudo) => {
    const style = real.call(window, element, pseudo);
    return new Proxy(style, {
      get(target, property) {
        if (property === 'animationName') return element.getAttribute('data-state') === 'closed' ? EXIT_ANIMATION : 'none';
        const value: unknown = Reflect.get(target, property, target);
        return typeof value === 'function' ? value.bind(target) : value;
      },
    });
  });
  return {
    finish(only?: Element) {
      act(() => {
        for (const element of only ? [only] : document.querySelectorAll('[data-state="closed"]')) {
          const end = new Event('animationend', { bubbles: true });
          Object.defineProperty(end, 'animationName', { value: EXIT_ANIMATION });
          element.dispatchEvent(end);
        }
      });
    },
    restore: () => spy.mockRestore(),
  };
}

/** Garde les animations de sortie pendant chaque test du bloc qui l'appelle. */
export function withHeldExitAnimations() {
  let held: ReturnType<typeof holdExitAnimations> | undefined;
  beforeEach(() => {
    held = holdExitAnimations();
  });
  afterEach(() => {
    held?.restore();
  });
  return { finish: (only?: Element) => held?.finish(only) };
}
