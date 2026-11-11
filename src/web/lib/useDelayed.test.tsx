import { act, renderHook } from '@testing-library/react';
import { StrictMode } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { useDelayed } from './useDelayed';

beforeEach(() => vi.useFakeTimers());
afterEach(() => vi.useRealTimers());

const advance = (ms: number) => act(() => void vi.advanceTimersByTime(ms));

describe('useDelayed', () => {
  it('ne vaut vrai qu’une fois l’attente écoulée', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayed(active, 300), { initialProps: { active: false } });
    expect(result.current).toBe(false);

    rerender({ active: true });
    expect(result.current).toBe(false); // pas aussitôt : une réponse rapide ne fait pas clignoter ce qu'il commande
    advance(299);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('retombe aussitôt que l’attente cesse, et repart de zéro à la suivante', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayed(active, 300), { initialProps: { active: true } });
    advance(300);
    expect(result.current).toBe(true);

    rerender({ active: false });
    expect(result.current).toBe(false); // dans le même rendu : aucun rendu de plus où il vaudrait encore vrai

    rerender({ active: true });
    expect(result.current).toBe(false); // l'attente suivante a son propre délai : l'ancien ne compte plus
    advance(299);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true);
  });

  it('ne vaut vrai dans aucun rendu où l’attente a déjà cessé : le trait et le texte d’une attente finie ne reparaissent pas un instant avec les chiffres de la suivante', () => {
    const rendered: [active: boolean, delayed: boolean][] = [];
    const { rerender } = renderHook(
      ({ active }) => {
        const delayed = useDelayed(active, 300);
        rendered.push([active, delayed]);
        return delayed;
      },
      { initialProps: { active: true } },
    );
    advance(300);
    rerender({ active: false });
    rerender({ active: true });
    advance(300);
    rerender({ active: false });

    expect(rendered.some(([active, delayed]) => active && delayed)).toBe(true); // le test voit bien des rendus où il vaut vrai
    expect(rendered.filter(([active, delayed]) => delayed && !active)).toEqual([]); // et aucun où l'attente a cessé
  });

  // Relecture de bdesk-38k.80 (R5) : d'une période en attente à la suivante, les chiffres gardés sont les mêmes (`isPlaceholderData` reste vrai) : le délai court depuis le début de l'attente, pas de
  // chaque changement de période, qui ne la recommence pas.
  it('ne repart pas de zéro tant que l’attente dure : un rendu de plus ne retarde pas ce qu’il commande', () => {
    const { result, rerender } = renderHook((props: { active: boolean; change: number }) => useDelayed(props.active, 300), { initialProps: { active: true, change: 0 } });
    advance(200);
    rerender({ active: true, change: 1 }); // la période change pendant l'attente, les chiffres gardés sont encore ceux de la première
    advance(99);
    expect(result.current).toBe(false);
    advance(1);
    expect(result.current).toBe(true); // 300 ms après le premier changement, pas après le second
  });

  it('ne vaut jamais vrai pour une attente qui cesse avant le délai', () => {
    const { result, rerender } = renderHook(({ active }) => useDelayed(active, 300), { initialProps: { active: true } });
    advance(250);
    rerender({ active: false });
    advance(1000);
    expect(result.current).toBe(false);
    expect(vi.getTimerCount()).toBe(0); // la minuterie est annulée, pas seulement ignorée
  });

  it('annule sa minuterie quand la vue part', () => {
    const { unmount } = renderHook(() => useDelayed(true, 300));
    expect(vi.getTimerCount()).toBe(1);
    unmount();
    expect(vi.getTimerCount()).toBe(0);
  });

  it('tient aussi sous StrictMode, qui monte, démonte et remonte la vue', () => {
    const { result } = renderHook(() => useDelayed(true, 300), { wrapper: StrictMode });
    expect(result.current).toBe(false);
    advance(300);
    expect(result.current).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});
