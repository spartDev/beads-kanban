import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  SEQUENCE_TIMEOUT_MS,
  createShortcutRegistry,
  describeKeyEvent,
  normalizeStep,
  usesKeyNatively,
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

/** Un élément (et ce qui l'entoure) ajouté au document ; renvoie l'élément à focaliser, repéré par `data-target`. */
function mount(html: string): HTMLElement {
  const host = document.body.appendChild(document.createElement('div'));
  host.innerHTML = html;
  const target = host.querySelector<HTMLElement>('[data-target]');
  if (!target) throw new Error('Le fragment doit marquer son élément focalisé avec data-target.');
  return target;
}

/** Des éléments où « Entrée » (ou « Espace ») fait déjà quelque chose, hors champ de saisie : un clic, une soumission, une ouverture. */
const ACTIVATED_BY_ENTER: readonly (readonly [name: string, html: string])[] = [
  ['un bouton', '<button data-target>Ouvrir</button>'],
  ['un lien', '<a href="/ticket" data-target>Ticket</a>'],
  ['un résumé de <details>', '<details><summary data-target>Plus</summary>texte</details>'],
  ['un bouton d’envoi', '<input type="submit" data-target value="Envoyer">'],
  ['un bouton de réinitialisation', '<input type="reset" data-target>'],
  ['un champ de fichier', '<input type="file" data-target>'],
  ['un bouton radio', '<input type="radio" data-target>'],
  ['une case à cocher', '<input type="checkbox" data-target>'],
  ['un curseur', '<input type="range" data-target>'],
  ['un sélecteur de couleur', '<input type="color" data-target>'],
  ['un champ de saisie', '<input type="text" data-target>'],
  ['une liste déroulante', '<select data-target><option>a</option></select>'],
  ['une zone de texte', '<textarea data-target></textarea>'],
  ['un élément éditable', '<div contenteditable="true" data-target>texte</div>'],
  ['un role=button', '<div role="button" tabindex="0" data-target>Ouvrir</div>'],
  ['un role=link', '<span role="link" tabindex="0" data-target>Ticket</span>'],
  ['un role=tab', '<div role="tablist"><div role="tab" tabindex="0" data-target>Onglet</div></div>'],
  ['un role=radio', '<div role="radiogroup"><div role="radio" tabindex="0" data-target>Choix</div></div>'],
  ['un role=option', '<div role="listbox"><div role="option" tabindex="0" data-target>Option</div></div>'],
  ['un role=menuitem', '<div role="menu"><div role="menuitem" tabindex="0" data-target>Action</div></div>'],
  ['un role=switch', '<div role="switch" tabindex="0" data-target></div>'],
  ['un role=combobox', '<input role="combobox" data-target>'],
];

/** Des éléments où les flèches déplacent déjà quelque chose : le curseur, le choix d'un groupe, une valeur, une liste. */
const MOVED_BY_ARROWS: readonly (readonly [name: string, html: string])[] = [
  ['un bouton radio', '<input type="radio" name="g" data-target><input type="radio" name="g">'],
  ['un curseur', '<input type="range" data-target>'],
  ['un champ numérique', '<input type="number" data-target>'],
  ['un champ de saisie', '<input type="text" data-target>'],
  ['un bouton d’envoi (tout champ <input>)', '<input type="submit" data-target>'],
  ['un champ de fichier', '<input type="file" data-target>'],
  ['une liste déroulante', '<select data-target><option>a</option><option>b</option></select>'],
  ['une zone de texte', '<textarea data-target></textarea>'],
  ['un élément éditable', '<div contenteditable="true" data-target>texte</div>'],
  ['un onglet', '<div role="tablist"><div role="tab" tabindex="0" data-target>Onglet</div></div>'],
  ['un role=radio dans son groupe', '<div role="radiogroup"><div role="radio" tabindex="0" data-target>Choix</div></div>'],
  ['une option de liste', '<div role="listbox"><div role="option" tabindex="0" data-target>Option</div></div>'],
  ['une liste', '<ul role="listbox" tabindex="0" data-target></ul>'],
  ['un élément de menu', '<div role="menu"><div role="menuitem" tabindex="0" data-target>Action</div></div>'],
  ['un curseur ARIA', '<div role="slider" tabindex="0" data-target></div>'],
  ['un champ numérique ARIA', '<div role="spinbutton" tabindex="0" data-target></div>'],
  ['un élément d’arbre', '<div role="tree"><div role="treeitem" tabindex="0" data-target>Noeud</div></div>'],
  ['une cellule de grille', '<div role="grid"><div role="gridcell" tabindex="0" data-target>Cellule</div></div>'],
  ['un bouton de barre d’outils', '<div role="toolbar"><button data-target>Gras</button></div>'],
];

/** Des éléments qui n'utilisent pas les flèches : une carte du kanban est un lien, et un lien n'en fait rien. */
const NOT_MOVED_BY_ARROWS: readonly (readonly [name: string, html: string])[] = [
  ['un lien', '<a href="/ticket" data-target>Ticket</a>'],
  ['un bouton', '<button data-target>Colonne</button>'],
  ['un bouton à bascule', '<div role="group"><button aria-pressed="false" data-target>Backlog</button></div>'],
  ['un résumé de <details>', '<details><summary data-target>Plus</summary>texte</details>'],
  ['un élément quelconque', '<div tabindex="0" data-target>zone</div>'],
  ['une carte', '<ul><li data-card-id="a"><a href="/t/a" data-target>Titre</a></li></ul>'],
];

describe('un raccourci laisse la touche à l’élément qui l’utilise déjà', () => {
  beforeEach(() => ({ registry, cleanup } = setup(true)));

  describe.each(ACTIVATED_BY_ENTER)('« Entrée » sur %s', (_name, html) => {
    it('ne lance pas le raccourci et ne détourne pas la touche', () => {
      const run = vi.fn();
      registry.register(shortcut('enter', run));

      const event = press({ key: 'Enter' }, mount(html));

      expect(run).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  it('« Entrée » reste un raccourci partout ailleurs : le document, une zone, une carte sans focus', () => {
    const run = vi.fn();
    registry.register(shortcut('enter', run));

    expect(press({ key: 'Enter' }).defaultPrevented).toBe(true);
    expect(press({ key: 'Enter' }, mount('<div tabindex="0" data-target>zone</div>')).defaultPrevented).toBe(true);
    expect(press({ key: 'Enter' }, mount('<li data-card-id="a" tabindex="-1" data-target>carte</li>')).defaultPrevented).toBe(true);

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('« Espace » reste à un bouton ou une case à cocher, mais pas à un lien (qui fait défiler la page)', () => {
    const run = vi.fn();
    registry.register(shortcut('space', run));

    press({ key: ' ' }, mount('<button data-target>Ouvrir</button>'));
    press({ key: ' ' }, mount('<input type="checkbox" data-target>'));
    expect(run).not.toHaveBeenCalled();

    press({ key: ' ' }, mount('<a href="/ticket" data-target>Ticket</a>'));
    expect(run).toHaveBeenCalledTimes(1);
  });

  describe.each(MOVED_BY_ARROWS)('les flèches sur %s', (_name, html) => {
    it.each(['ArrowLeft', 'ArrowRight'])('%s : ni lancée, ni détournée', (key) => {
      const run = vi.fn();
      registry.register(shortcut(key.toLowerCase(), run));

      const event = press({ key }, mount(html));

      expect(run).not.toHaveBeenCalled();
      expect(event.defaultPrevented).toBe(false);
    });
  });

  describe.each(NOT_MOVED_BY_ARROWS)('les flèches sur %s', (_name, html) => {
    it.each(['ArrowLeft', 'ArrowRight'])('%s : le raccourci les garde', (key) => {
      const run = vi.fn();
      registry.register(shortcut(key.toLowerCase(), run));

      const event = press({ key }, mount(html));

      expect(run).toHaveBeenCalledTimes(1);
      expect(event.defaultPrevented).toBe(true);
    });
  });

  it('Début, Fin, Page précédente et Page suivante suivent les flèches', () => {
    const run = vi.fn();
    for (const key of ['home', 'end', 'pageup', 'pagedown', 'arrowup', 'arrowdown']) registry.register(shortcut(key, run));
    const radio = mount('<input type="radio" data-target>');
    const link = mount('<a href="/ticket" data-target>Ticket</a>');

    for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown']) press({ key }, radio);
    expect(run).not.toHaveBeenCalled();

    for (const key of ['Home', 'End', 'PageUp', 'PageDown', 'ArrowUp', 'ArrowDown']) press({ key }, link);
    expect(run).toHaveBeenCalledTimes(6);
  });

  it('Maj + flèche (sélection de texte) reste au champ de saisie', () => {
    const run = vi.fn();
    registry.register(shortcut('shift+arrowright', run));

    press({ key: 'ArrowRight', shiftKey: true }, mount('<input type="radio" data-target>'));

    expect(run).not.toHaveBeenCalled();
  });

  it('les lettres restent au raccourci sur un bouton ou un lien, qui n’en font rien…', () => {
    const run = vi.fn();
    registry.register(shortcut('j', run));

    press({ key: 'j' }, mount('<button data-target>Ouvrir</button>'));
    press({ key: 'j' }, mount('<a href="/ticket" data-target>Ticket</a>'));
    press({ key: 'j' }, mount('<input type="radio" data-target>'));

    expect(run).toHaveBeenCalledTimes(3);
  });

  it('…mais vont à la recherche au clavier d’une liste ou d’un arbre', () => {
    const run = vi.fn();
    registry.register(shortcut('j', run));

    press({ key: 'j' }, mount('<div role="listbox"><div role="option" tabindex="0" data-target>Option</div></div>'));
    press({ key: 'j' }, mount('<div role="tree"><div role="treeitem" tabindex="0" data-target>Noeud</div></div>'));

    expect(run).not.toHaveBeenCalled();
  });

  it('ne touche pas aux combinaisons ⌘/Ctrl/Alt : « ⌘ Entrée » reste un raccourci sur un bouton', () => {
    const run = vi.fn();
    registry.register(shortcut('mod+enter', run));

    const event = press({ key: 'Enter', metaKey: true }, mount('<button data-target>Ouvrir</button>'));

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('laisse `allowInInput` décider dans un champ de saisie : « Entrée » y reste un raccourci qui le demande', () => {
    const run = vi.fn();
    registry.register(shortcut('enter', run, { allowInInput: true }));

    const event = press({ key: 'Enter' }, mount('<input type="text" data-target>'));

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('`overrideNative` détourne quand même la touche d’un bouton ou d’un lien', () => {
    const run = vi.fn();
    registry.register(shortcut('enter', run, { overrideNative: true }));

    const event = press({ key: 'Enter' }, mount('<button data-target>Ouvrir</button>'));

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('sur la même touche, le plus récent des raccourcis qui peuvent la prendre l’emporte', () => {
    const native = vi.fn();
    const plain = vi.fn();
    registry.register(shortcut('enter', native, { id: 'old', overrideNative: true }));
    registry.register(shortcut('enter', plain, { id: 'new' }));

    press({ key: 'Enter' }, mount('<button data-target>Ouvrir</button>'));

    // Le plus récent cède au bouton et ne peut pas la prendre ; le plus ancien, qui l'exige, le peut.
    expect(plain).not.toHaveBeenCalled();
    expect(native).toHaveBeenCalledTimes(1);
  });

  it('une séquence commencée est abandonnée quand « Entrée » tombe sur un bouton', () => {
    const run = vi.fn();
    const enter = vi.fn();
    registry.register(shortcut('g k', run));
    registry.register(shortcut('enter', enter));

    press({ key: 'g' });
    const event = press({ key: 'Enter' }, mount('<button data-target>Ouvrir</button>'));
    press({ key: 'k' });

    expect(event.defaultPrevented).toBe(false);
    expect(enter).not.toHaveBeenCalled();
    expect(run).not.toHaveBeenCalled();
  });

  it('une touche répétée sur un bouton n’est pas consommée non plus', () => {
    const run = vi.fn();
    registry.register(shortcut('enter', run));

    const event = press({ key: 'Enter', repeat: true }, mount('<button data-target>Ouvrir</button>'));

    expect(event.defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('usesKeyNatively', () => {
  const target = (html: string) => mount(html);

  it.each([
    ['<button data-target></button>', 'enter', true],
    ['<button data-target></button>', 'space', true],
    ['<button data-target></button>', 'arrowright', false],
    ['<button data-target></button>', 'j', false],
    ['<a href="/x" data-target></a>', 'enter', true],
    ['<a href="/x" data-target></a>', 'space', false],
    ['<a data-target></a>', 'enter', false],
    ['<input type="radio" data-target>', 'arrowleft', true],
    ['<input type="radio" data-target>', 'j', false],
    ['<div role="listbox" tabindex="0" data-target></div>', 'j', true],
    ['<div role="listbox" tabindex="0" data-target></div>', 'arrowdown', true],
    ['<div role="listbox" tabindex="0" data-target></div>', 'escape', false],
    ['<div tabindex="0" data-target></div>', 'enter', false],
  ] as const)('%s + %s : %s', (html, key, expected) => {
    expect(usesKeyNatively(target(html), key)).toBe(expected);
  });

  it('lit la touche d’une étape, modificateurs retirés', () => {
    const radio = target('<input type="radio" data-target>');
    expect(usesKeyNatively(radio, 'shift+arrowright')).toBe(true);
    expect(usesKeyNatively(radio, 'mod+arrowright')).toBe(false);
  });

  it('ne trouve rien sans cible ou hors élément', () => {
    expect(usesKeyNatively(null, 'enter')).toBe(false);
    expect(usesKeyNatively(document, 'enter')).toBe(false);
    expect(usesKeyNatively(window, 'enter')).toBe(false);
  });

  it('retrouve l’élément qui agit depuis un descendant (le focus peut être sur le contenu d’un bouton)', () => {
    const inner = target('<button><span data-target>Ouvrir</span></button>');
    expect(usesKeyNatively(inner, 'enter')).toBe(true);
  });
});

describe('touches alternatives : une action, plusieurs touches', () => {
  beforeEach(() => ({ registry, cleanup } = setup(true)));

  it('lance la même action avec chacune des touches', () => {
    const run = vi.fn();
    registry.register(shortcut('h', run, { alternateKeys: ['arrowleft'] }));

    press({ key: 'h' });
    press({ key: 'ArrowLeft' });

    expect(run).toHaveBeenCalledTimes(2);
  });

  it('ne compte qu’un raccourci dans la liste, avec ses touches alternatives', () => {
    const unregister = registry.register(shortcut('h', vi.fn(), { alternateKeys: ['arrowleft', 'shift+h'] }));

    expect(registry.list()).toHaveLength(1);
    expect(registry.list()[0]?.alternateKeys).toEqual(['arrowleft', 'shift+h']);

    unregister();
    expect(registry.list()).toEqual([]);
  });

  it('retire toutes les touches d’un coup', () => {
    const run = vi.fn();
    const unregister = registry.register(shortcut('h', run, { alternateKeys: ['arrowleft'] }));

    unregister();
    press({ key: 'h' });
    press({ key: 'ArrowLeft' });

    expect(run).not.toHaveBeenCalled();
  });

  it('une touche alternative cède elle aussi au dernier raccourci enregistré', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(shortcut('h', first, { alternateKeys: ['arrowleft'] }));
    registry.register(shortcut('arrowleft', second, { id: 'autre' }));

    press({ key: 'ArrowLeft' });
    press({ key: 'h' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });

  it('une touche alternative cède aussi à l’élément qui l’utilise (flèche sur un bouton radio)', () => {
    const run = vi.fn();
    registry.register(shortcut('h', run, { alternateKeys: ['arrowleft'] }));

    const event = press({ key: 'ArrowLeft' }, mount('<input type="radio" data-target>'));
    press({ key: 'h' }, mount('<input type="radio" data-target>'));

    expect(event.defaultPrevented).toBe(false);
    // « h » n'est pas une touche de bouton radio : il reste au raccourci.
    expect(run).toHaveBeenCalledTimes(1);
  });
});

describe('when : un raccourci qui ne s’applique que dans certains états', () => {
  beforeEach(() => ({ registry, cleanup } = setup(true)));

  it('se lance et détourne la touche quand la condition est vraie', () => {
    const run = vi.fn();
    registry.register(shortcut('escape', run, { when: () => true }));

    const event = press({ key: 'Escape' });

    expect(run).toHaveBeenCalledTimes(1);
    expect(event.defaultPrevented).toBe(true);
  });

  it('ne lance rien et ne détourne pas la touche quand la condition est fausse : le navigateur la garde', () => {
    const run = vi.fn();
    registry.register(shortcut('escape', run, { when: () => false }));

    const event = press({ key: 'Escape' });

    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
    expect(registry.handleKeyDown(new KeyboardEvent('keydown', { key: 'Escape', cancelable: true }))).toBe(false);
  });

  it('relit la condition à chaque touche', () => {
    let active = false;
    const run = vi.fn();
    registry.register(shortcut('escape', run, { when: () => active }));

    expect(press({ key: 'Escape' }).defaultPrevented).toBe(false);
    active = true;
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(true);
    active = false;
    expect(press({ key: 'Escape' }).defaultPrevented).toBe(false);

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('donne l’événement à la condition', () => {
    const when = vi.fn(() => true);
    registry.register(shortcut('escape', vi.fn(), { when }));

    const event = press({ key: 'Escape' });

    expect(when).toHaveBeenCalledWith(event);
  });

  it('cède la touche à un raccourci enregistré plus tôt quand sa condition est fausse', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(shortcut('escape', first, { id: 'premier' }));
    registry.register(shortcut('escape', second, { id: 'second', when: () => false }));

    const event = press({ key: 'Escape' });

    expect(first).toHaveBeenCalledTimes(1);
    expect(second).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(true);
  });

  it('prend la touche à un raccourci enregistré plus tôt quand sa condition est vraie', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(shortcut('escape', first, { id: 'premier' }));
    registry.register(shortcut('escape', second, { id: 'second', when: () => true }));

    press({ key: 'Escape' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('ne se demande que pour sa touche, et pas là où la touche ne lui serait pas confiée (champ de saisie)', () => {
    const when = vi.fn(() => true);
    registry.register(shortcut('escape', vi.fn(), { when }));

    press({ key: 'a' });
    press({ key: 'Escape' }, mount('<input data-target>'));

    expect(when).not.toHaveBeenCalled();
  });

  it('vaut pour chacune des touches alternatives', () => {
    const run = vi.fn();
    registry.register(shortcut('h', run, { alternateKeys: ['arrowleft'], when: () => false }));

    const letter = press({ key: 'h' });
    const arrow = press({ key: 'ArrowLeft' });

    expect(run).not.toHaveBeenCalled();
    expect([letter.defaultPrevented, arrow.defaultPrevented]).toEqual([false, false]);
  });

  it('vaut aussi pour une combinaison ⌘/Ctrl : sans condition remplie, elle reste au navigateur', () => {
    const run = vi.fn();
    registry.register(shortcut('mod+k', run, { when: () => false }));

    const event = press({ key: 'k', metaKey: true });

    expect(run).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('une touche maintenue dont la condition est fausse n’est pas consommée non plus', () => {
    registry.register(shortcut('escape', vi.fn(), { when: () => false }));

    expect(press({ key: 'Escape', repeat: true }).defaultPrevented).toBe(false);
  });

  it('une séquence dont la condition est fausse ne commence pas', () => {
    const run = vi.fn();
    registry.register(shortcut('g k', run, { when: () => false }));

    const first = press({ key: 'g' });
    press({ key: 'k' });

    expect(first.defaultPrevented).toBe(false);
    expect(run).not.toHaveBeenCalled();
  });
});

describe('priority : qui prend la touche quand plusieurs raccourcis le peuvent', () => {
  beforeEach(() => ({ registry, cleanup } = setup(true)));

  it('le plus prioritaire l’emporte, même enregistré avant les autres : l’ordre où les composants se montent n’y change rien', () => {
    const layer = vi.fn();
    const page = vi.fn();
    registry.register(shortcut('escape', layer, { id: 'couche', priority: 1 }));
    registry.register(shortcut('escape', page, { id: 'page' }));

    press({ key: 'Escape' });

    expect(layer).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
  });

  it('à priorité égale, le dernier enregistré l’emporte, comme sans priorité', () => {
    const first = vi.fn();
    const second = vi.fn();
    registry.register(shortcut('escape', first, { id: 'premier', priority: 2 }));
    registry.register(shortcut('escape', second, { id: 'second', priority: 2 }));

    press({ key: 'Escape' });

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).not.toHaveBeenCalled();
  });

  it('cède la touche aux autres quand sa condition est fausse ou quand il est retiré', () => {
    let open = true;
    const layer = vi.fn();
    const page = vi.fn();
    const unregister = registry.register(shortcut('escape', layer, { id: 'couche', priority: 1, when: () => open }));
    registry.register(shortcut('escape', page, { id: 'page' }));

    press({ key: 'Escape' });
    open = false;
    press({ key: 'Escape' });
    open = true;
    unregister();
    press({ key: 'Escape' });

    expect(layer).toHaveBeenCalledTimes(1);
    expect(page).toHaveBeenCalledTimes(2);
  });

  it('vaut aussi pour les touches alternatives et pour une séquence', () => {
    const layer = vi.fn();
    const page = vi.fn();
    registry.register(shortcut('g k', layer, { id: 'couche', priority: 1, alternateKeys: ['x'] }));
    registry.register(shortcut('g k', page, { id: 'page', alternateKeys: ['x'] }));

    press({ key: 'x' });
    press({ key: 'g' });
    press({ key: 'k' });

    expect(layer).toHaveBeenCalledTimes(2);
    expect(page).not.toHaveBeenCalled();
  });
});
