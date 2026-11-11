import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Un `ResizeObserver` que le test pilote : jsdom n'a aucune mise en page, donc aucune taille ne change d'elle-même (le stub de `setup.ts` n'observe rien).
 * `emit(nœud, hauteur)` fait ce que ferait le navigateur quand ce nœud prend cette hauteur ; `observed()` dit ce que la page observe.
 */
export interface FakeResizeObservers {
  /** Les nœuds que la page observe en ce moment, tous observateurs confondus. */
  observed: () => Element[];
  /** Le navigateur dit que ce nœud mesure maintenant cette hauteur (px). Rend le nombre d'observateurs prévenus : zéro si rien ne l'observe. */
  emit: (node: Element, height: number) => number;
  /** Comme `emit`, sans `act` : pour une mesure que le navigateur donne pendant que React travaille (dans un effet de mise en page), où `act` n'a rien à attendre. */
  notify: (node: Element, height: number) => number;
}

/** Remplace `ResizeObserver` par le faux pour la durée du test (à défaire avec `vi.unstubAllGlobals`). */
export function installFakeResizeObserver(): FakeResizeObservers {
  const live = new Set<FakeResizeObserver>();

  class FakeResizeObserver implements ResizeObserver {
    readonly nodes = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
      live.add(this);
    }
    observe(node: Element): void {
      this.nodes.add(node);
    }
    unobserve(node: Element): void {
      this.nodes.delete(node);
    }
    disconnect(): void {
      this.nodes.clear();
      live.delete(this);
    }
    notify(node: Element, height: number): boolean {
      if (!this.nodes.has(node)) return false;
      // Ce que les pages lisent d'une entrée : le nœud et sa boîte de contenu.
      const contentRect = { x: 0, y: 0, top: 0, left: 0, width: 0, height, right: 0, bottom: height, toJSON: () => ({}) } as DOMRectReadOnly;
      this.callback([{ target: node, contentRect } as ResizeObserverEntry], this);
      return true;
    }
  }

  const notify = (node: Element, height: number) => [...live].filter((observer) => observer.notify(node, height)).length;

  vi.stubGlobal('ResizeObserver', FakeResizeObserver);
  return {
    observed: () => [...live].flatMap((observer) => [...observer.nodes]),
    notify,
    emit: (node, height) => {
      let notified = 0;
      // Dans `act` : la page peut se redessiner à ce que le navigateur lui dit, comme à un événement.
      act(() => {
        notified = notify(node, height);
      });
      return notified;
    },
  };
}
