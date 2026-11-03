/**
 * Registre de raccourcis clavier global, indépendant de React (testable seul).
 *
 * - `keys` : une étape (`mod+k`, `?`, `escape`) ou une séquence (`g k` : G puis K, à moins de 1,2 s).
 *   `mod` vaut ⌘ sur macOS et Ctrl ailleurs.
 * - Les touches sont lues par `event.key` (et non `event.code`) : les raccourcis suivent la disposition
 *   du clavier, AZERTY compris.
 * - Hors combinaisons ⌘/Ctrl/Alt, un raccourci est ignoré quand le focus est dans un champ de saisie ou
 *   dans une boîte de dialogue : taper « g » dans la palette ne doit rien déclencher.
 * - Hors combinaisons ⌘/Ctrl/Alt, un raccourci cède aussi la touche à l'élément qui l'utilise déjà et qui a le focus :
 *   Entrée sur un bouton ou un lien, les flèches sur un groupe de boutons radio, un onglet, un curseur ou une liste
 *   (`usesKeyNatively`). Le raccourci ne se lance pas et la touche n'est pas détournée (`preventDefault`) : le
 *   navigateur ou le composant garde la main. Un raccourci qui veut quand même la touche le demande avec `overrideNative`.
 * - Un raccourci peut ne valoir que dans certains états (`when`) : Échap qui désélectionne, quand quelque chose l'est. Sa
 *   condition fausse, il n'existe pas pour cette touche : rien ne se lance, rien n'est détourné, un raccourci enregistré
 *   plus tôt sur les mêmes touches peut la prendre.
 * - En cas de conflit sur les mêmes touches, le dernier raccourci enregistré l'emporte.
 * - Une touche maintenue ne déclenche qu'une fois : les répétitions (`event.repeat`) d'un raccourci reconnu sont
 *   consommées sans rien lancer. Sinon ⌘K ouvrirait puis fermerait la palette en boucle, et la fin d'une
 *   séquence (`g k`) tenue enfoncée lancerait le raccourci à touche simple `k`.
 */

export interface Shortcut {
  /** Identifiant stable (`nav.kanban`). */
  id: string;
  keys: string;
  /** Autres touches (ou séquences) qui lancent la même action : `h` et `←`. L'aide les écrit sur la même ligne. */
  alternateKeys?: readonly string[];
  /** Libellé affiché dans l'aide. */
  label: string;
  /** Rubrique de l'aide (`Navigation`, `Général`…). */
  group: string;
  run: (event: KeyboardEvent) => void;
  /** Autoriser le raccourci quand le focus est dans un champ. Les combinaisons ⌘/Ctrl/Alt le sont toujours. */
  allowInInput?: boolean;
  /**
   * Prendre la touche même quand le focus est sur un élément qui l'utilise déjà (Entrée sur un bouton, flèche sur un
   * bouton radio) : le raccourci détourne alors l'action native. Par défaut il s'efface devant elle.
   */
  overrideNative?: boolean;
  /**
   * Condition d'application, relue à chaque touche (à chaque étape d'une séquence), après les règles du focus : fausse, le
   * raccourci ne lance rien et ne détourne pas la touche (`preventDefault`) : le navigateur et les autres écouteurs la
   * gardent, et un raccourci enregistré plus tôt sur les mêmes touches peut la prendre. Sans elle, le raccourci vaut toujours.
   */
  when?: (event: KeyboardEvent) => boolean;
}

export interface ShortcutRegistry {
  readonly isMac: boolean;
  /** Enregistre un raccourci ; renvoie la fonction qui le retire. */
  register: (shortcut: Shortcut) => () => void;
  /** À brancher sur `keydown`. Renvoie true quand l'événement a été consommé. */
  handleKeyDown: (event: KeyboardEvent) => boolean;
  /** Raccourcis actuellement enregistrés ; la référence ne change que lorsque la liste change. */
  list: () => readonly Shortcut[];
  subscribe: (listener: () => void) => () => void;
  /** Annule la séquence en cours. */
  dispose: () => void;
}

export const SEQUENCE_TIMEOUT_MS = 1200;

const MODIFIER_ORDER = ['mod', 'ctrl', 'meta', 'alt', 'shift'];
const MODIFIER_KEYS = new Set(['Meta', 'Control', 'Alt', 'Shift', 'AltGraph', 'CapsLock', 'Dead', 'Unidentified']);
const NON_TEXT_INPUT_TYPES = new Set(['button', 'checkbox', 'radio', 'submit', 'reset', 'range', 'file']);
const MOVE_KEYS = new Set(['arrowleft', 'arrowright', 'arrowup', 'arrowdown', 'home', 'end', 'pageup', 'pagedown']);

/** Forme canonique d'une étape : modificateurs dans un ordre fixe, touche en minuscules. */
export function normalizeStep(step: string): string {
  const tokens = step.toLowerCase().split('+');
  const key = tokens.pop() ?? '';
  const modifiers = MODIFIER_ORDER.filter((modifier) => tokens.includes(modifier));
  return [...modifiers, key].join('+');
}

/** Étape décrite par un événement clavier, au même format que `normalizeStep` ; null pour une touche seule de modification. */
export function describeKeyEvent(event: KeyboardEvent, mac: boolean): string | null {
  if (!event.key || MODIFIER_KEYS.has(event.key)) return null;
  const key = event.key === ' ' ? 'space' : event.key.toLowerCase();
  const parts: string[] = [];
  if (mac) {
    if (event.metaKey) parts.push('mod');
    if (event.ctrlKey) parts.push('ctrl');
  } else {
    if (event.ctrlKey) parts.push('mod');
    if (event.metaKey) parts.push('meta');
  }
  if (event.altKey) parts.push('alt');
  // Maj fait partie du caractère (« ? », « K ») ; on ne la note que pour les touches nommées ou combinées.
  if (event.shiftKey && (key.length > 1 || parts.length > 0)) parts.push('shift');
  return [...parts, key].join('+');
}

const isModified = (step: string): boolean => /^(mod|ctrl|meta|alt)\+/.test(step);

const EDITABLE = '[contenteditable]:not([contenteditable="false"])';

// jsdom n'implémente pas `isContentEditable` : l'attribut dit la même chose.
const isEditable = (element: HTMLElement): boolean => element.isContentEditable === true || element.closest(EDITABLE) !== null;

/** Focus dans un champ de saisie ou une boîte de dialogue : les raccourcis à touche simple se taisent. */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (isEditable(target)) return true;
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

const roles = (names: readonly string[]): string => names.map((name) => `[role="${name}"]`).join(', ');

/** Rôles dont l'élément réagit à Entrée et Espace (un composant ARIA les implémente, ou compte sur le navigateur). */
const ACTIVATION_ROLES = roles([
  'button', 'checkbox', 'switch', 'radio', 'tab', 'option', 'menuitem', 'menuitemcheckbox', 'menuitemradio',
  'treeitem', 'gridcell', 'row', 'combobox', 'textbox', 'searchbox', 'spinbutton', 'slider',
]);

/** Rôles des widgets composites : les flèches, Début, Fin et les pages y déplacent le choix, le curseur ou la valeur. */
const MOVE_ROLES = roles([
  'radiogroup', 'radio', 'tablist', 'tab', 'listbox', 'option', 'menu', 'menubar', 'menuitem', 'menuitemcheckbox',
  'menuitemradio', 'tree', 'treeitem', 'grid', 'treegrid', 'gridcell', 'row', 'toolbar', 'slider', 'spinbutton',
  'scrollbar', 'combobox', 'textbox', 'searchbox',
]);

/** Rôles où une lettre saute à l'entrée qui commence par elle (recherche au clavier). */
const TYPEAHEAD_ROLES = roles([
  'listbox', 'option', 'tree', 'treeitem', 'grid', 'treegrid', 'gridcell', 'combobox', 'menu', 'menubar', 'menuitem',
  'menuitemcheckbox', 'menuitemradio',
]);

// Un <input> de tout type : bouton d'envoi, fichier, case, radio, curseur… tous réagissent à Entrée, Espace ou aux flèches.
const FORM_CONTROLS = `input, select, textarea, ${EDITABLE}`;
const ENTER_TARGETS = `button, summary, a[href], area[href], [role="link"], ${FORM_CONTROLS}, ${ACTIVATION_ROLES}`;
// Espace ne suit pas un lien : il fait défiler la page.
const SPACE_TARGETS = `button, summary, ${FORM_CONTROLS}, ${ACTIVATION_ROLES}`;
const MOVE_TARGETS = `${FORM_CONTROLS}, ${MOVE_ROLES}`;

const keyOf = (step: string): string => (step.endsWith('+') ? '+' : (step.split('+').pop() ?? step));

/**
 * L'élément qui a le focus fait-il déjà quelque chose de cette touche ? Entrée active un bouton, un lien, un résumé,
 * envoie un champ ; Espace coche et active ; les flèches, Début, Fin et les pages déplacent le curseur d'un champ, le
 * choix d'un groupe de boutons radio, d'onglets, d'une liste ou d'un menu, la valeur d'un curseur ; une lettre
 * cherche dans une liste. Un lien ou un bouton ordinaire n'utilise pas les flèches : une carte du kanban, qui est
 * un lien, les laisse au raccourci. Les combinaisons ⌘/Ctrl/Alt ne sont jamais prises pour des touches natives.
 *
 * Le focus peut être sur le contenu de l'élément (un `<span>` dans un bouton) : on remonte jusqu'à lui.
 */
export function usesKeyNatively(target: EventTarget | null, step: string): boolean {
  if (!(target instanceof Element) || isModified(step)) return false;
  const key = keyOf(step);
  if (key === 'enter') return target.closest(ENTER_TARGETS) !== null;
  if (key === 'space') return target.closest(SPACE_TARGETS) !== null;
  if (MOVE_KEYS.has(key)) return target.closest(MOVE_TARGETS) !== null;
  if (key.length === 1) return target.closest(TYPEAHEAD_ROLES) !== null;
  return false;
}

interface Entry {
  shortcut: Shortcut;
  steps: string[];
}

/** Où est le focus, pour la touche qui vient d'être pressée. */
interface KeyContext {
  /** Champ de saisie ou boîte de dialogue. */
  typing: boolean;
  /** Élément qui utilise déjà cette touche (`usesKeyNatively`). */
  native: boolean;
}

export function createShortcutRegistry({ isMac }: { isMac: boolean }): ShortcutRegistry {
  // Une entrée par suite de touches : un raccourci à touches alternatives en a plusieurs, pour une seule ligne dans `list()`.
  let entries: Entry[] = [];
  let shortcuts: Shortcut[] = [];
  let snapshot: readonly Shortcut[] = [];
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = [...shortcuts];
    listeners.forEach((listener) => listener());
  };

  const clearPending = () => {
    pending = [];
    clearTimeout(timer);
    timer = undefined;
  };

  // Dans un champ, `allowInInput` décide ; ailleurs, la touche reste à l'élément qui l'utilise, sauf `overrideNative`.
  const allowedByFocus = (entry: Entry, { typing, native }: KeyContext): boolean => {
    if (isModified(entry.steps[0] ?? '')) return true;
    if (typing) return Boolean(entry.shortcut.allowInInput);
    return !native || Boolean(entry.shortcut.overrideNative);
  };

  // Puis la condition du raccourci (`when`), qu'on ne demande que si le focus lui laisse la touche.
  const allowed = (entry: Entry, context: KeyContext, event: KeyboardEvent): boolean =>
    allowedByFocus(entry, context) && (entry.shortcut.when?.(event) ?? true);

  const sameSteps = (entry: Entry, steps: string[]): boolean =>
    entry.steps.length === steps.length && entry.steps.every((step, i) => step === steps[i]);

  const startsWith = (entry: Entry, steps: string[]): boolean =>
    entry.steps.length > steps.length && steps.every((step, i) => step === entry.steps[i]);

  // Le dernier enregistré gagne : on parcourt à l'envers.
  const findLast = (predicate: (entry: Entry) => boolean): Entry | undefined => {
    for (let i = entries.length - 1; i >= 0; i--) {
      const entry = entries[i];
      if (entry && predicate(entry)) return entry;
    }
    return undefined;
  };

  return {
    isMac,

    register(shortcut) {
      const added: Entry[] = [shortcut.keys, ...(shortcut.alternateKeys ?? [])].map((keys) => ({
        shortcut,
        steps: keys.split(' ').map(normalizeStep),
      }));
      entries = [...entries, ...added];
      shortcuts = [...shortcuts, shortcut];
      emit();
      return () => {
        entries = entries.filter((candidate) => !added.includes(candidate));
        shortcuts = shortcuts.filter((candidate) => candidate !== shortcut);
        emit();
      };
    },

    handleKeyDown(event) {
      if (event.defaultPrevented || event.isComposing) return false;
      const step = describeKeyEvent(event, isMac);
      if (step === null) return false;
      const context: KeyContext = { typing: isTypingContext(event.target), native: usesKeyNatively(event.target, step) };

      // Le navigateur n'agit pas non plus sur une répétition (Ctrl+K est la recherche de Firefox) : on la consomme.
      const fire = (entry: Entry): true => {
        event.preventDefault();
        if (!event.repeat) entry.shortcut.run(event);
        return true;
      };

      if (pending.length > 0) {
        const steps = [...pending, step];
        const done = findLast((entry) => sameSteps(entry, steps) && allowed(entry, context, event));
        if (done) {
          clearPending();
          return fire(done);
        }
        if (findLast((entry) => startsWith(entry, steps) && allowed(entry, context, event))) {
          pending = steps;
          clearTimeout(timer);
          timer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
          return true;
        }
        // La séquence n'aboutit pas : cette touche est traitée comme un nouveau départ.
        clearPending();
      }

      const single = findLast((entry) => sameSteps(entry, [step]) && allowed(entry, context, event));
      if (single) return fire(single);
      if (findLast((entry) => startsWith(entry, [step]) && allowed(entry, context, event))) {
        pending = [step];
        timer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
        return true;
      }
      return false;
    },

    list: () => snapshot,

    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },

    dispose: clearPending,
  };
}
