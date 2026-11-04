import { act, renderHook } from '@testing-library/react';
import { afterEach, describe, expect, it } from 'vitest';
import { useMediaQuery } from './useMediaQuery';

/** Un `matchMedia` dont on change le verdict à la main, comme le ferait le redimensionnement de la fenêtre. */
function stubMatchMedia(initial: boolean) {
  let matches = initial;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();
  window.matchMedia = ((query: string) => ({
    get matches() {
      return matches;
    },
    media: query,
    addEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.add(listener),
    removeEventListener: (_type: string, listener: (event: MediaQueryListEvent) => void) => listeners.delete(listener),
  })) as unknown as typeof window.matchMedia;
  return {
    set(next: boolean) {
      matches = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
    listeners: () => listeners.size,
  };
}

afterEach(() => {
  // setup.ts réinstalle son propre matchMedia avant chaque test.
});

describe('useMediaQuery', () => {
  it('dit si la requête est vraie maintenant', () => {
    stubMatchMedia(true);
    expect(renderHook(() => useMediaQuery('(max-width: 767.98px)')).result.current).toBe(true);
    stubMatchMedia(false);
    expect(renderHook(() => useMediaQuery('(max-width: 767.98px)')).result.current).toBe(false);
  });

  it('suit la requête quand la fenêtre est redimensionnée, et se désabonne en partant', () => {
    const media = stubMatchMedia(false);
    const { result, unmount } = renderHook(() => useMediaQuery('(max-width: 767.98px)'));
    expect(media.listeners()).toBe(1);

    act(() => media.set(true));
    expect(result.current).toBe(true);
    act(() => media.set(false));
    expect(result.current).toBe(false);

    unmount();
    expect(media.listeners()).toBe(0);
  });

  it('vaut faux dans un navigateur sans matchMedia', () => {
    Object.defineProperty(window, 'matchMedia', { configurable: true, value: undefined });
    expect(renderHook(() => useMediaQuery('(max-width: 767.98px)')).result.current).toBe(false);
  });
});
