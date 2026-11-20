import { act } from '@testing-library/react';
import { vi } from 'vitest';

/**
 * Un `ResizeObserver` que le test pilote : jsdom n'a aucune mise en page, donc aucune taille ne change d'elle-même (le stub de `setup.ts` n'observe rien).
 * `emit(nœud, hauteur)` fait ce que ferait le navigateur quand ce nœud prend cette hauteur ; `observed()` dit ce que la page observe.
 */
export interface FakeResizeObservers {
  /** Les nœuds que la page observe en ce moment, tous observateurs confondus. */
  observed: () => Element[];
  /** Combien d'observations sont actives en ce moment : un nœud par observateur qui l'observe, tous observateurs confondus. Zéro quand tout est démonté. */
  active: () => number;
  /** Le navigateur dit que ce nœud mesure maintenant cette hauteur (px). Rend le nombre d'observateurs prévenus : zéro si rien ne l'observe. */
  emit: (node: Element, height: number) => number;
  /** Comme `emit`, sans `act` : pour une mesure que le navigateur donne pendant que React travaille (dans un effet de mise en page), où `act` n'a rien à attendre. */
  notify: (node: Element, height: number) => number;
  /**
   * Avec `{ initial: true }` : délivre les notifications initiales en attente, comme le navigateur à la prochaine image, et rend leur nombre. Le
   * navigateur prévient un observateur dès qu'il commence à observer un nœud, même si rien n'a changé ; le faux les retient jusqu'ici.
   */
  flushInitial: () => number;
}

/**
 * Remplace `ResizeObserver` par le faux pour la durée du test (à défaire avec `vi.unstubAllGlobals`). `initial` : comme le navigateur, chaque
 * `observe` met en attente une notification initiale, que `flushInitial` délivre ; sans, le faux ne prévient que sur `emit` ou `notify`.
 */
export function installFakeResizeObserver({ initial = false }: { initial?: boolean } = {}): FakeResizeObservers {
  const live = new Set<FakeResizeObserver>();
  /** Les notifications initiales en attente : l'observateur et le nœud qu'il vient de commencer à observer. */
  const pending: [FakeResizeObserver, Element][] = [];

  class FakeResizeObserver implements ResizeObserver {
    readonly nodes = new Set<Element>();
    constructor(private readonly callback: ResizeObserverCallback) {
      live.add(this);
    }
    observe(node: Element): void {
      this.nodes.add(node);
      if (initial) pending.push([this, node]);
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
    active: () => [...live].reduce((count, observer) => count + observer.nodes.size, 0),
    notify,
    flushInitial: () => {
      const due = pending.splice(0);
      // Un observateur déconnecté, ou qui a cessé d'observer le nœud, n'est plus prévenu ; la hauteur, ici, ne compte pas.
      return due.filter(([observer, node]) => live.has(observer) && observer.notify(node, 0)).length;
    },
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
