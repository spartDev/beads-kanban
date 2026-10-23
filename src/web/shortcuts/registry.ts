/**
 * Registre de raccourcis clavier global, indépendant de React (testable seul).
 *
 * - `keys` : une étape (`mod+k`, `?`, `escape`) ou une séquence (`g k` : G puis K, à moins de 1,2 s).
 *   `mod` vaut ⌘ sur macOS et Ctrl ailleurs.
 * - Les touches sont lues par `event.key` (et non `event.code`) : les raccourcis suivent la disposition
 *   du clavier, AZERTY compris.
 * - Hors combinaisons ⌘/Ctrl/Alt, un raccourci est ignoré quand le focus est dans un champ de saisie ou
 *   dans une boîte de dialogue : taper « g » dans la palette ne doit rien déclencher.
 * - En cas de conflit sur les mêmes touches, le dernier raccourci enregistré l'emporte.
 * - Une touche maintenue ne déclenche qu'une fois : les répétitions (`event.repeat`) d'un raccourci reconnu sont
 *   consommées sans rien lancer. Sinon ⌘K ouvrirait puis fermerait la palette en boucle, et la fin d'une
 *   séquence (`g k`) tenue enfoncée lancerait le raccourci à touche simple `k`.
 */

export interface Shortcut {
  /** Identifiant stable (`nav.kanban`). */
  id: string;
  keys: string;
  /** Libellé affiché dans l'aide. */
  label: string;
  /** Rubrique de l'aide (`Navigation`, `Général`…). */
  group: string;
  run: (event: KeyboardEvent) => void;
  /** Autoriser le raccourci quand le focus est dans un champ. Les combinaisons ⌘/Ctrl/Alt le sont toujours. */
  allowInInput?: boolean;
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

/** Focus dans un champ de saisie ou une boîte de dialogue : les raccourcis à touche simple se taisent. */
export function isTypingContext(target: EventTarget | null): boolean {
  if (!(target instanceof HTMLElement)) return false;
  if (target.isContentEditable) return true;
  if (target.closest('[role="dialog"], [role="alertdialog"], [role="menu"]')) return true;
  if (target instanceof HTMLInputElement) return !NON_TEXT_INPUT_TYPES.has(target.type);
  return target instanceof HTMLTextAreaElement || target instanceof HTMLSelectElement;
}

interface Entry {
  shortcut: Shortcut;
  steps: string[];
}

export function createShortcutRegistry({ isMac }: { isMac: boolean }): ShortcutRegistry {
  let entries: Entry[] = [];
  let snapshot: readonly Shortcut[] = [];
  let pending: string[] = [];
  let timer: ReturnType<typeof setTimeout> | undefined;
  const listeners = new Set<() => void>();

  const emit = () => {
    snapshot = entries.map((entry) => entry.shortcut);
    listeners.forEach((listener) => listener());
  };

  const clearPending = () => {
    pending = [];
    clearTimeout(timer);
    timer = undefined;
  };

  const allowed = (entry: Entry, typing: boolean): boolean =>
    !typing || Boolean(entry.shortcut.allowInInput) || isModified(entry.steps[0] ?? '');

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
      const entry: Entry = { shortcut, steps: shortcut.keys.split(' ').map(normalizeStep) };
      entries = [...entries, entry];
      emit();
      return () => {
        entries = entries.filter((candidate) => candidate !== entry);
        emit();
      };
    },

    handleKeyDown(event) {
      if (event.defaultPrevented || event.isComposing) return false;
      const step = describeKeyEvent(event, isMac);
      if (step === null) return false;
      const typing = isTypingContext(event.target);

      // Le navigateur n'agit pas non plus sur une répétition (Ctrl+K est la recherche de Firefox) : on la consomme.
      const fire = (entry: Entry): true => {
        event.preventDefault();
        if (!event.repeat) entry.shortcut.run(event);
        return true;
      };

      if (pending.length > 0) {
        const steps = [...pending, step];
        const done = findLast((entry) => sameSteps(entry, steps) && allowed(entry, typing));
        if (done) {
          clearPending();
          return fire(done);
        }
        if (findLast((entry) => startsWith(entry, steps) && allowed(entry, typing))) {
          pending = steps;
          clearTimeout(timer);
          timer = setTimeout(clearPending, SEQUENCE_TIMEOUT_MS);
          return true;
        }
        // La séquence n'aboutit pas : cette touche est traitée comme un nouveau départ.
        clearPending();
      }

      const single = findLast((entry) => sameSteps(entry, [step]) && allowed(entry, typing));
      if (single) return fire(single);
      if (findLast((entry) => startsWith(entry, [step]) && allowed(entry, typing))) {
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
