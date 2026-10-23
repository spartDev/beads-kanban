/**
 * jsdom n'a pas matchMedia. Ce stub répond à `(prefers-color-scheme: dark)` et permet à un test
 * de changer le thème du système en cours de route.
 */
export function installMatchMedia(initialDark = false): { setDark: (dark: boolean) => void } {
  let dark = initialDark;
  const listeners = new Set<(event: MediaQueryListEvent) => void>();

  window.matchMedia = (query: string): MediaQueryList =>
    ({
      get matches() {
        return /prefers-color-scheme:\s*dark/.test(query) ? dark : false;
      },
      media: query,
      onchange: null,
      addEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') listeners.add(listener);
      },
      removeEventListener: (type: string, listener: (event: MediaQueryListEvent) => void) => {
        if (type === 'change') listeners.delete(listener);
      },
      addListener: () => undefined,
      removeListener: () => undefined,
      dispatchEvent: () => false,
    }) as unknown as MediaQueryList;

  return {
    setDark(next) {
      dark = next;
      listeners.forEach((listener) => listener({ matches: next } as MediaQueryListEvent));
    },
  };
}
