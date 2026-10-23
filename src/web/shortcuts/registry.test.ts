import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEQUENCE_TIMEOUT_MS,
  createShortcutRegistry,
  describeKeyEvent,
  normalizeStep,
  type Shortcut,
  type ShortcutRegistry,
} from './registry';

/** Branche le registre sur le document, comme le fait ShortcutsProvider avec window. */
function setup(isMac = true) {
  const registry = createShortcutRegistry({ isMac });
  const listener = (event: KeyboardEvent) => void registry.handleKeyDown(event);
  document.addEventListener('keydown', listener);
  const cleanup = () => document.removeEventListener('keydown', listener);
  return { registry, cleanup };
}

function press(init: KeyboardEventInit, target: EventTarget = document.body): KeyboardEvent {
  const event = new KeyboardEvent('keydown', { bubbles: true, cancelable: true, ...init });
  target.dispatchEvent(event);
  return event;
}

const shortcut = (keys: string, run: Shortcut['run'], extra: Partial<Shortcut> = {}): Shortcut => ({
  id: keys,
  keys,
  label: keys,
  group: 'Test',
  run,
  ...extra,
});

let registry: ShortcutRegistry;
let cleanup: () => void;

afterEach(() => {
  cleanup?.();
  document.body.innerHTML = '';
  vi.useRealTimers();
});

describe('normalizeStep et describeKeyEvent', () => {
  it('range les modificateurs dans un ordre fixe', () => {
    expect(normalizeStep('Shift+Mod+K')).toBe('mod+shift+k');
    expect(normalizeStep('?')).toBe('?');
  });

  it('traduit un événement : mod = ⌘ sur Mac, Ctrl ailleurs', () => {
    const cmdK = new KeyboardEvent('keydown', { key: 'k', metaKey: true });
    const ctrlK = new KeyboardEvent('keydown', { key: 'k', ctrlKey: true });
    expect(describeKeyEvent(cmdK, true)).toBe('mod+k');
    expect(describeKeyEvent(ctrlK, true)).toBe('ctrl+k');
    expect(describeKeyEvent(ctrlK, false)).toBe('mod+k');
    expect(describeKeyEvent(cmdK, false)).toBe('meta+k');
  });

  it('ne note Maj que pour les touches nommées ou combinées (« ? » reste « ? »)', () => {
    expect(describeKeyEvent(new KeyboardEvent('keydown', { key: '?', shiftKey: true }), true)).toBe('?');
    expect(describeKeyEvent(new KeyboardEvent('keydown', { key: 'K', shiftKey: true, metaKey: true }), true)).toBe('mod+shift+k');
    expect(describeKeyEvent(new KeyboardEvent('keydown', { key: 'ArrowDown', shiftKey: true }), true)).toBe('shift+arrowdown');
  });

  it('ignore les touches de modification seules', () => {
    expect(describeKeyEvent(new KeyboardEvent('keydown', { key: 'Meta', metaKey: true }), true)).toBeNull();
    expect(describeKeyEvent(new KeyboardEvent('keydown', { key: 'Shift', shiftKey: true }), true)).toBeNull();
  });
});

describe('registre', () => {
  beforeEach(() => ({ registry, cleanup } = setup(true)));

  it('déclenche ⌘K sur Mac et pas Ctrl+K', () => {
    const run = vi.fn();
    registry.register(shortcut('mod+k', run));

    press({ key: 'k', ctrlKey: true });
    expect(run).not.toHaveBeenCalled();

    const event = press({ key: 'k', metaKey: true });
    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('déclenche Ctrl+K hors Mac', () => {
    cleanup();
    ({ registry, cleanup } = setup(false));
    const run = vi.fn();
    registry.register(shortcut('mod+k', run));

    press({ key: 'k', ctrlKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('suit la disposition du clavier : « ? » s’obtient avec Maj sur AZERTY', () => {
    const run = vi.fn();
    registry.register(shortcut('?', run));

    press({ key: '?', shiftKey: true });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('reconnaît une séquence « g puis k »', () => {
    const run = vi.fn();
    registry.register(shortcut('g k', run));

    press({ key: 'g' });
    expect(run).not.toHaveBeenCalled();
    press({ key: 'k' });
    expect(run).toHaveBeenCalledTimes(1);

    // La séquence est consommée : « k » seul ne refait rien.
    press({ key: 'k' });
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('abandonne la séquence après le délai', () => {
    vi.useFakeTimers();
    const run = vi.fn();
    registry.register(shortcut('g k', run));

    press({ key: 'g' });
    vi.advanceTimersByTime(SEQUENCE_TIMEOUT_MS + 1);
    press({ key: 'k' });

    expect(run).not.toHaveBeenCalled();
  });

  it('abandonne la séquence quand une autre touche s’intercale, sans la perdre', () => {
    const goKanban = vi.fn();
    const goEpics = vi.fn();
    const plain = vi.fn();
    registry.register(shortcut('g k', goKanban));
    registry.register(shortcut('g e', goEpics));
    registry.register(shortcut('x', plain));

    press({ key: 'g' });
    press({ key: 'x' }); // casse la séquence, et « x » compte comme une touche à part entière
    press({ key: 'k' });
    expect(goKanban).not.toHaveBeenCalled();
    expect(plain).toHaveBeenCalledTimes(1);

    press({ key: 'g' });
    press({ key: 'e' });
    expect(goEpics).toHaveBeenCalledTimes(1);
  });

  it('ignore les touches simples dans un champ de saisie', () => {
    const run = vi.fn();
    registry.register(shortcut('g k', run));
    registry.register(shortcut('?', run));
    const input = document.body.appendChild(document.createElement('input'));
    const textarea = document.body.appendChild(document.createElement('textarea'));

    for (const field of [input, textarea]) {
      press({ key: 'g' }, field);
      press({ key: 'k' }, field);
      press({ key: '?', shiftKey: true }, field);
    }

    expect(run).not.toHaveBeenCalled();
  });

  it('laisse passer les combinaisons ⌘/Ctrl dans un champ, et les raccourcis qui le demandent', () => {
    const palette = vi.fn();
    const forced = vi.fn();
    registry.register(shortcut('mod+k', palette));
    registry.register(shortcut('f', forced, { allowInInput: true }));
    const input = document.body.appendChild(document.createElement('input'));

    press({ key: 'k', metaKey: true }, input);
    press({ key: 'f' }, input);

    expect(palette).toHaveBeenCalledTimes(1);
    expect(forced).toHaveBeenCalledTimes(1);
  });

  it('traite une case à cocher comme autre chose qu’un champ de texte', () => {
    const run = vi.fn();
    registry.register(shortcut('?', run));
    const checkbox = document.body.appendChild(document.createElement('input'));
    checkbox.type = 'checkbox';

    press({ key: '?', shiftKey: true }, checkbox);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('ignore les touches simples quand le focus est dans une boîte de dialogue', () => {
    const run = vi.fn();
    registry.register(shortcut('?', run));
    const dialog = document.body.appendChild(document.createElement('div'));
    dialog.setAttribute('role', 'dialog');
    const button = dialog.appendChild(document.createElement('button'));

    press({ key: '?', shiftKey: true }, button);

    expect(run).not.toHaveBeenCalled();
  });

  it('respecte un événement déjà consommé par un composant', () => {
    const run = vi.fn();
    registry.register(shortcut('mod+k', run));
    document.body.addEventListener('keydown', (e) => e.preventDefault(), { once: true });

    press({ key: 'k', metaKey: true });

    expect(run).not.toHaveBeenCalled();
  });

  it('ignore la saisie en cours de composition (IME)', () => {
    const run = vi.fn();
    registry.register(shortcut('g', run));

    press({ key: 'g', isComposing: true });

    expect(run).not.toHaveBeenCalled();
  });

  it('retire un raccourci quand on appelle la fonction renvoyée', () => {
    const run = vi.fn();
    const unregister = registry.register(shortcut('x', run));

    press({ key: 'x' });
    unregister();
    press({ key: 'x' });

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('donne la priorité au dernier raccourci enregistré sur les mêmes touches', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(shortcut('x', first));
    const unregister = registry.register(shortcut('x', second, { id: 'x2' }));

    press({ key: 'x' });
    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();

    unregister();
    press({ key: 'x' });
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('ignore la répétition d’une touche maintenue : ⌘K ne fait pas clignoter la palette', () => {
    cleanup();
    ({ registry, cleanup } = setup(false));
    const toggle = vi.fn();
    registry.register(shortcut('mod+k', toggle, { allowInInput: true }));

    press({ key: 'k', ctrlKey: true });
    const repeated = press({ key: 'k', ctrlKey: true, repeat: true });
    press({ key: 'k', ctrlKey: true, repeat: true });

    expect(toggle).toHaveBeenCalledTimes(1);
    // Le navigateur n'agit pas non plus sur la répétition (Ctrl+K est la recherche de Firefox).
    expect(repeated.defaultPrevented).toBe(true);

    // Une fois la touche relâchée, un nouvel appui compte.
    press({ key: 'k', ctrlKey: true });
    expect(toggle).toHaveBeenCalledTimes(2);
  });

  it('ne lance pas un raccourci d’une seule touche quand la fin d’une séquence reste enfoncée', () => {
    const goKanban = vi.fn();
    const moveUp = vi.fn();
    registry.register(shortcut('g k', goKanban));
    registry.register(shortcut('k', moveUp));

    press({ key: 'g' });
    press({ key: 'k' });
    press({ key: 'k', repeat: true });
    press({ key: 'k', repeat: true });

    expect(goKanban).toHaveBeenCalledTimes(1);
    expect(moveUp).not.toHaveBeenCalled();
  });

  it('ne touche pas aux événements qu’il ne connaît pas', () => {
    registry.register(shortcut('x', vi.fn()));

    const event = press({ key: 'y' });

    expect(event.defaultPrevented).toBe(false);
  });

  it('expose la liste des raccourcis, avec une référence qui ne change que si la liste change', () => {
    const listener = vi.fn();
    registry.subscribe(listener);
    const before = registry.list();
    expect(registry.list()).toBe(before);

    const unregister = registry.register(shortcut('x', vi.fn()));
    expect(listener).toHaveBeenCalledTimes(1);
    expect(registry.list()).not.toBe(before);
    expect(registry.list().map((s) => s.id)).toEqual(['x']);

    unregister();
    expect(registry.list()).toEqual([]);
  });
});
