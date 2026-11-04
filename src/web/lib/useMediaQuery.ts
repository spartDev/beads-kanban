import { useCallback, useSyncExternalStore } from 'react';

/** Le verdict d'une requête média (`(max-width: 767.98px)`), tenu à jour quand la fenêtre change de taille ; faux sans `matchMedia`. */
export function useMediaQuery(query: string): boolean {
  const subscribe = useCallback(
    (notify: () => void) => {
      const media = typeof window.matchMedia === 'function' ? window.matchMedia(query) : undefined;
      media?.addEventListener('change', notify);
      return () => media?.removeEventListener('change', notify);
    },
    [query],
  );
  return useSyncExternalStore(
    subscribe,
    () => (typeof window.matchMedia === 'function' ? window.matchMedia(query).matches : false),
    () => false,
  );
}
