import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { focusContainer, focusElement, focusIsAdrift, watchRemoval } from '../lib/focus';
import { useShortcutRegistry } from '../shortcuts/ShortcutsProvider';

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
  /** À appeler quand une surcouche vient d'être retirée de la page : rend le focus (voir `useOverlayContent`). */
  restoreFocus: () => void;
}

const OverlayContext = createContext<OverlayContextValue | null>(null);

/** Marque la boîte de dialogue d'une surcouche (palette, aide), pour la distinguer de toute autre : le panneau d'un ticket, par exemple. */
const OVERLAY = '[data-overlay]';
/** Marque le panneau d'un ticket (`IssuePanel`) : le repli du focus, quand l'élément d'origine a disparu. Pas un `role="dialog"` quelconque. */
const ISSUE_PANEL = '[data-issue-panel]';

/**
 * Qui est ouvert, de la palette ⌘K ou de l'aide des raccourcis : deux boîtes de dialogue modales ne
 * s'empilent jamais. Les fermetures ne ferment que leur propre surcouche (fermer la palette n'emporte pas l'aide
 * qui vient de la remplacer).
 *
 * Il retient aussi d'où l'on vient, pour y rendre le focus quand la dernière se referme (`useOverlayContent`).
 */
export function OverlayProvider({ children }: { children: ReactNode }) {
  const [state, setState] = useState<OverlayState>({ open: null, mode: 'all' });
  const { remember, restore } = useFocusReturn();

  const openPalette = useCallback(
    (mode: PaletteMode = 'all') => {
      remember();
      setState({ open: 'palette', mode });
    },
    [remember],
  );
  const closePalette = useCallback(
    () => setState((s) => (s.open === 'palette' ? { ...s, open: null } : s)),
    [],
  );
  const togglePalette = useCallback(() => {
    remember();
    setState((s) => (s.open === 'palette' ? { ...s, open: null } : { open: 'palette', mode: 'all' }));
  }, [remember]);
  const showHelp = useCallback(() => {
    remember();
    setState((s) => ({ ...s, open: 'help' }));
  }, [remember]);
  const closeHelp = useCallback(() => setState((s) => (s.open === 'help' ? { ...s, open: null } : s)), []);

  const value = useMemo(
    () => ({ ...state, openPalette, closePalette, togglePalette, showHelp, closeHelp, restoreFocus: restore }),
    [state, openPalette, closePalette, togglePalette, showHelp, closeHelp, restore],
  );
  return <OverlayContext value={value}>{children}</OverlayContext>;
}

/**
 * D'où l'on vient. Radix ne rend le focus qu'à un déclencheur (`Dialog.Trigger`), et la palette et l'aide n'en ont pas : elles s'ouvrent par
 * le registre des raccourcis (⌘K, ?) ou par un bouton qui n'en est pas un. Sans cela, le focus tomberait sur le corps de la page à la
 * fermeture : le panneau d'un ticket le perdrait, et sur mobile (le panneau est une boîte de dialogue modale) les raccourcis à touche
 * simple repartiraient derrière lui.
 *
 * - `remember` note l'élément qui a le focus, juste avant l'ouverture d'une surcouche, depuis la touche ou le clic qui la demande : le
 *   focus est alors encore à l'élément d'origine, la boîte de dialogue ne l'a pas pris. Il ne note rien quand le focus est déjà dans
 *   une surcouche (rouverte pendant son animation de sortie, ou remplacée par l'autre : l'aide ouverte depuis la palette) : l'origine
 *   déjà notée tient.
 * - `restore` rend le focus quand une surcouche vient d'être retirée de la page (`onCloseAutoFocus`, à la fin de son animation de sortie),
 *   sauf si une autre y est encore, ouverte ou qui finit de se retirer : c'est à la dernière de le rendre. Le focus va, dans l'ordre :
 *   1. à l'élément d'origine, s'il est encore dans le document et peut le recevoir ;
 *   2. au panneau d'un ticket ouvert sur la page (`data-issue-panel`), s'il y en a un ;
 *   3. au contenu principal.
 *   Jamais au corps de la page. Si le focus est déjà ailleurs, on n'y touche pas : un choix de la palette a pu ouvrir un panneau, qui a
 *   pris le focus, et c'est lui qui doit le garder, non la carte d'où l'on venait. Et si l'élément qui le reçoit est retiré aussitôt après
 *   (le choix change de page, et la page n'était pas encore montée à la fin de l'animation : sur un appareil lent, elle arrive après), le
 *   focus passe à la suite de la liste (`watchRemoval`), tant que l'utilisateur n'a rien fait entre-temps : une touche ou un clic de sa part
 *   (« g m » après Échap) fait de ce qui retire l'élément une navigation qu'il demande, sans rapport avec la boîte fermée.
 */
function useFocusReturn() {
  const origin = useRef<Element | null>(null);

  const remember = useCallback(() => {
    const active = document.activeElement;
    if (active?.closest(OVERLAY)) return;
    origin.current = active;
  }, []);

  const restore = useCallback(() => {
    if (document.querySelector(OVERLAY)) return;
    const from = origin.current;
    origin.current = null;
    if (focusIsAdrift()) giveFocus(from);
  }, []);

  return { remember, restore };
}

/** Rend le focus à `from`, sinon au panneau d'un ticket ouvert, sinon au contenu principal. */
function giveFocus(from: Element | null): void {
  for (const candidate of [from, document.querySelector(ISSUE_PANEL)]) {
    if (candidate && focusElement(candidate)) {
      // La page qu'un choix de la palette ouvre peut arriver juste après, et le retirer : le focus passe alors à la suite.
      watchRemoval(candidate, () => giveFocus(null));
      return;
    }
  }
  focusContainer(document.querySelector('main'));
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

/** Ce que la palette et l'aide ont en commun, à poser sur leur `Dialog.Content`. */
interface OverlayContentProps {
  'data-overlay': '';
  onEscapeKeyDown: (event: KeyboardEvent) => void;
  onCloseAutoFocus: (event: Event) => void;
}

/**
 * Ce que la palette et l'aide doivent à l'application, à poser sur leur `Dialog.Content` (`<Dialog.Content {...useOverlayContent(open)}>`),
 * `open` disant si la surcouche est ouverte :
 *
 * - **Échap.** Une boîte de dialogue qui se ferme reste montée le temps de son animation de sortie, et sa couche Radix, encore la plus
 *   haute, prend Échap et le consomme (`preventDefault`) avant que le registre des raccourcis le voie : le panneau qu'un choix de la
 *   palette vient d'ouvrir, ou que l'aide laisse dessous, resterait ouvert. Fermée, elle rend alors la touche au registre, qui applique ses
 *   règles de focus (le focus est dans une boîte de dialogue) : seul Échap du panneau d'un ticket (`issue.close`, `allowInInput`) la reçoit
 *   par ce chemin, pas la désélection du tableau (`kanban.deselect`), qui ne traverse ni boîte de dialogue ni couche. Ouverte, elle la
 *   garde pour se fermer.
 * - **Le focus.** Retiré de la page, elle le rend à l'élément qui l'avait avant l'ouverture (voir `useFocusReturn`).
 */
export function useOverlayContent(open: boolean): OverlayContentProps {
  const registry = useShortcutRegistry();
  const { restoreFocus } = useOverlays();
  return {
    'data-overlay': '',
    onEscapeKeyDown: (event) => {
      if (!open) registry.handleKeyDown(event);
    },
    onCloseAutoFocus: (event) => {
      // Sans cela, Radix rend le focus à son déclencheur, qui n'existe pas : le focus tomberait sur le corps de la page.
      event.preventDefault();
      restoreFocus();
    },
  };
}
