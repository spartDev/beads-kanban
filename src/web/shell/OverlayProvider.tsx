import { createContext, use, useCallback, useMemo, useState, type ReactNode } from 'react';

/** `projects` : la palette ne propose que les Projets (bouton « changer de Projet » du mobile). */
export type PaletteMode = 'all' | 'projects';

interface OverlayState {
  /** La surcouche ouverte : une seule à la fois, en ouvrir une ferme l'autre. */
  open: 'palette' | 'help' | null;
  /** Garde le dernier mode demandé tant que la palette se ferme : son contenu ne change pas pendant l'animation de sortie. */
  mode: PaletteMode;
}

interface OverlayContextValue extends OverlayState {
  openPalette: (mode?: PaletteMode) => void;
  closePalette: () => void;
  togglePalette: () => void;
  showHelp: () => void;
  closeHelp: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

/**
 * Qui est ouvert, de la palette ⌘K ou de l'aide des raccourcis : deux boîtes de dialogue modales ne
 * s'empilent jamais. Les fermetures ne ferment que leur propre surcouche (fermer la palette n'emporte pas l'aide
 * qui vient de la remplacer).
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OverlayState>({ open: null, mode: 'all' });

  const openPalette = useCallback((mode: PaletteMode = 'all') => setState({ open: 'palette', mode }), []);
  const closePalette = useCallback(
    () => setState((s) => (s.open === 'palette' ? { ...s, open: null } : s)),
    [],
  );
  const togglePalette = useCallback(
    () => setState((s) => (s.open === 'palette' ? { ...s, open: null } : { open: 'palette', mode: 'all' })),
    [],
  );
  const showHelp = useCallback(() => setState((s) => ({ ...s, open: 'help' })), []);
  const closeHelp = useCallback(() => setState((s) => (s.open === 'help' ? { ...s, open: null } : s)), []);

  const value = useMemo(
    () => ({ ...state, openPalette, closePalette, togglePalette, showHelp, closeHelp }),
    [state, openPalette, closePalette, togglePalette, showHelp, closeHelp],
  );
  return <OverlayContext value={value}>{children}</OverlayContext>;
}

function useOverlays(): OverlayContextValue {
  const context = use(OverlayContext);
  if (!context) throw new Error('Les surcouches exigent <OverlayProvider>.');
  return context;
}

/** La palette ⌘K : état et commandes d'ouverture. */
export function usePalette() {
  const { open, mode, openPalette, closePalette, togglePalette } = useOverlays();
  return { open: open === 'palette', mode, openPalette, closePalette, togglePalette };
}

/** L'aide des raccourcis clavier. */
export function useShortcutsHelp() {
  const { open, showHelp, closeHelp } = useOverlays();
  return { open: open === 'help', show: showHelp, close: closeHelp };
}
