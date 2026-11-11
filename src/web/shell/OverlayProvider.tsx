import { createContext, use, useCallback, useMemo, useRef, useState, type ReactNode } from 'react';
import { movedCardLink } from '../kanban/boardFocus';
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

/**
 * `from` : l'élément qui demande l'ouverture, quand l'événement le dit (voir `useFocusReturn`) : le bouton d'un clic ou d'un toucher (`currentTarget`), l'élément qui reçoit la touche d'un raccourci. Sans lui (un effet, une commande de la
 * palette), c'est l'élément qui a le focus.
 */
interface OverlayContextValue extends OverlayState {
  openPalette: (mode?: PaletteMode, from?: Element | null) => void;
  closePalette: () => void;
  togglePalette: (from?: Element | null) => void;
  showHelp: (from?: Element | null) => void;
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
    (mode: PaletteMode = 'all', from?: Element | null) => {
      remember(from);
      setState({ open: 'palette', mode });
    },
    [remember],
  );
  const closePalette = useCallback(
    () => setState((s) => (s.open === 'palette' ? { ...s, open: null } : s)),
    [],
  );
  const togglePalette = useCallback(
    (from?: Element | null) => {
      remember(from);
      setState((s) => (s.open === 'palette' ? { ...s, open: null } : { open: 'palette', mode: 'all' }));
    },
    [remember],
  );
  const showHelp = useCallback(
    (from?: Element | null) => {
      remember(from);
      setState((s) => ({ ...s, open: 'help' }));
    },
    [remember],
  );
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
 * - `remember` note d'où vient l'ouverture d'une surcouche, au moment où elle est demandée et d'après l'événement qui la demande, non d'après l'état du
 *   focus. Un bouton dit lui-même qui il est (`from`, le `currentTarget` de son clic ou de son toucher). Mesuré le 2026-11-06 sur l'application construite (bdesk-38k.76),
 *   Playwright : Chromium 156 et Firefox 137 donnent le focus au bouton à la fin de `mousedown` ; WebKit 18.2 ne le fait pas (ni pour un toucher) et retire le focus à ce
 *   qui l'avait : le corps de la page est l'élément actif de `pointerdown` à `click`, au moment où le bouton appelle `openPalette`. La boîte de dialogue rendait alors le focus
 *   au contenu principal (au panneau d'un ticket, s'il y en avait un), non au bouton. Un raccourci du clavier (⌘K, ?, g p) passe l'élément qui reçoit la touche, celui qui a
 *   le focus : le clavier le déplace lui-même, dans tous les moteurs. Sans rien (un effet, une commande de la palette), c'est l'élément qui a le focus, la boîte de dialogue
 *   ne l'a pas pris encore. Il ne note rien quand l'origine est dans une surcouche (rouverte pendant son animation de sortie, ou remplacée par l'autre : l'aide ouverte
 *   depuis la palette) : l'origine déjà notée tient.
 * - `restore` rend le focus quand une surcouche vient d'être retirée de la page (`onCloseAutoFocus`, à la fin de son animation de sortie),
 *   sauf si une autre y est encore, ouverte ou qui finit de se retirer : c'est à la dernière de le rendre. Le focus va, dans l'ordre :
 *   1. à l'élément d'origine, s'il est encore dans le document et peut le recevoir ;
 *   2. à la carte du tableau dont il était, là où elle est maintenant, quand c'était le lien d'une carte qu'un commit a changée de colonne pendant que la
 *      surcouche était ouverte (`movedCardLink` : ce lien est retiré, et la carte est ailleurs) ;
 *   3. au panneau d'un ticket ouvert sur la page (`data-issue-panel`), s'il y en a un ;
 *   4. au contenu principal.
 *   Jamais au corps de la page. Si le focus est déjà ailleurs, on n'y touche pas : un choix de la palette a pu ouvrir un panneau, qui a
 *   pris le focus, et c'est lui qui doit le garder, non la carte d'où l'on venait (le panneau, fermé, ne la lui rend pas non plus : voir `panelOpener`). Et si l'élément qui le reçoit est retiré aussitôt après
 *   (le choix change de page, et la page n'était pas encore montée à la fin de l'animation : sur un appareil lent, elle arrive après), le
 *   focus passe à la suite de la liste (`watchRemoval`), tant que l'utilisateur n'a rien fait entre-temps : une touche ou un clic de sa part
 *   (« g m » après Échap) fait de ce qui retire l'élément une navigation qu'il demande, sans rapport avec la boîte fermée.
 */
function useFocusReturn() {
  const origin = useRef<Element | null>(null);

  const remember = useCallback((from?: Element | null) => {
    // Ce que le registre ou cmdk passent à une commande n'est pas toujours un élément (l'événement d'une touche, la valeur d'une ligne) : seul un élément dit d'où l'on vient.
    const opener = from instanceof Element ? from : document.activeElement;
    if (opener?.closest(OVERLAY)) return;
    origin.current = opener;
  }, []);

  const restore = useCallback(() => {
    if (document.querySelector(OVERLAY)) return;
    const from = origin.current;
    origin.current = null;
    if (focusIsAdrift()) giveFocus(from);
  }, []);

  return { remember, restore };
}

/** Rend le focus à `from`, sinon à la carte qu'il était et que le commit a remontée ailleurs, sinon au panneau d'un ticket ouvert, sinon au contenu principal. */
function giveFocus(from: Element | null): void {
  for (const candidate of [from, movedCardLink(document.body, from), document.querySelector(ISSUE_PANEL)]) {
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
