import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsProvider, useShortcut, useShortcutList } from './ShortcutsProvider';
import type { Shortcut } from './registry';

function Counter({ enabled = true }: { enabled?: boolean }) {
  const [count, setCount] = useState(0);
  useShortcut({
    id: 'count',
    keys: 'c',
    label: 'Compter',
    group: 'Test',
    enabled,
    // Cette fermeture lit `count` : elle doit rester à jour sans que le raccourci soit ré-enregistré.
    run: () => setCount(count + 1),
  });
  return <output aria-label="compte">{count}</output>;
}

function ListProbe() {
  const list = useShortcutList();
  return <ul aria-label="raccourcis">{list.map((s) => <li key={s.id}>{`${s.group}: ${s.label} (${s.keys})`}</li>)}</ul>;
}

describe('ShortcutsProvider et useShortcut', () => {
  it('déclenche le raccourci tant que le composant est monté, avec la dernière fermeture', async () => {
    const user = userEvent.setup();
    render(<ShortcutsProvider isMac><Counter /></ShortcutsProvider>);

    await user.keyboard('ccc');

    expect(screen.getByLabelText('compte').textContent).toBe('3');
  });

  it('retire le raccourci au démontage', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    function Once() {
      useShortcut({ id: 'once', keys: 'o', label: 'Une fois', group: 'Test', run });
      return null;
    }
    const view = render(<ShortcutsProvider isMac><Once /></ShortcutsProvider>);

    await user.keyboard('o');
    view.rerender(<ShortcutsProvider isMac>{null}</ShortcutsProvider>);
    await user.keyboard('o');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('n’enregistre pas un raccourci désactivé', async () => {
    const user = userEvent.setup();
    render(<ShortcutsProvider isMac><Counter enabled={false} /></ShortcutsProvider>);

    await user.keyboard('c');

    expect(screen.getByLabelText('compte').textContent).toBe('0');
  });

  it('ignore les touches tapées dans un champ', async () => {
    const user = userEvent.setup();
    render(
      <ShortcutsProvider isMac>
        <Counter />
        <input aria-label="saisie" />
      </ShortcutsProvider>,
    );

    await user.click(screen.getByLabelText('saisie'));
    await user.keyboard('ccc');

    expect(screen.getByLabelText('compte').textContent).toBe('0');
  });

  it('liste les raccourcis enregistrés, et ceux qui apparaissent ensuite', () => {
    function Late() {
      const [visible, setVisible] = useState(false);
      return (
        <>
          <button onClick={() => setVisible(true)}>afficher</button>
          {visible ? <Counter /> : null}
        </>
      );
    }
    render(<ShortcutsProvider isMac><ListProbe /><Late /></ShortcutsProvider>);
    expect(screen.queryByText(/Compter/)).toBeNull();

    act(() => screen.getByRole('button', { name: 'afficher' }).click());

    expect(screen.getByText('Test: Compter (c)')).toBeTruthy();
  });

  it('exige son provider', () => {
    const spy = vi.spyOn(console, 'error').mockImplementation(() => undefined);
    expect(() => render(<Counter />)).toThrow(/ShortcutsProvider/);
    spy.mockRestore();
  });
});

describe('touches alternatives', () => {
  function Both({ alternate }: { alternate: string[] }) {
    const [count, setCount] = useState(0);
    useShortcut({
      id: 'previous',
      keys: 'h',
      alternateKeys: alternate,
      label: 'Précédent',
      group: 'Test',
      run: () => setCount(count + 1),
    });
    return <output aria-label="compte">{count}</output>;
  }

  it('lance la même action avec la touche et avec ses alternatives, sans les lister deux fois', async () => {
    const user = userEvent.setup();
    render(
      <ShortcutsProvider isMac>
        <Both alternate={['arrowleft']} />
        <ListProbe />
      </ShortcutsProvider>,
    );

    await user.keyboard('h{ArrowLeft}');

    expect(screen.getByLabelText('compte').textContent).toBe('2');
    expect(screen.getAllByText(/Précédent/)).toHaveLength(1);
  });

  it('ré-enregistre le raccourci quand ses touches alternatives changent', async () => {
    const user = userEvent.setup();
    const view = render(
      <ShortcutsProvider isMac>
        <Both alternate={['arrowleft']} />
      </ShortcutsProvider>,
    );

    view.rerender(
      <ShortcutsProvider isMac>
        <Both alternate={['arrowright']} />
      </ShortcutsProvider>,
    );

    // L'ancienne touche alternative n'est plus enregistrée, la nouvelle l'est.
    await user.keyboard('{ArrowLeft}');
    expect(screen.getByLabelText('compte').textContent).toBe('0');
    await user.keyboard('{ArrowRight}');
    expect(screen.getByLabelText('compte').textContent).toBe('1');
  });
});

describe('les touches que le focus utilise déjà', () => {
  it('« Entrée » sur un bouton : le bouton agit une fois, le raccourci reste à l’écart', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const clicked = vi.fn();
    function Page() {
      useShortcut({ id: 'open', keys: 'enter', label: 'Ouvrir', group: 'Test', run });
      return <button onClick={clicked}>Bouton</button>;
    }
    render(<ShortcutsProvider isMac><Page /></ShortcutsProvider>);
    const seen: boolean[] = [];
    // Écoutée après le registre (même cible, enregistrée plus tard) : lit l'événement une fois que le registre l'a vu.
    window.addEventListener('keydown', (event) => seen.push(event.defaultPrevented));

    screen.getByRole('button', { name: 'Bouton' }).focus();
    await user.keyboard('{Enter}');

    expect(clicked).toHaveBeenCalledTimes(1);
    expect(run).not.toHaveBeenCalled();
    expect(seen).toEqual([false]);
  });

  it('« Entrée » hors de tout élément qui l’utilise : le raccourci la prend', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    function Page() {
      useShortcut({ id: 'open', keys: 'enter', label: 'Ouvrir', group: 'Test', run });
      return <button>Bouton</button>;
    }
    render(<ShortcutsProvider isMac><Page /></ShortcutsProvider>);

    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledTimes(1);
  });

  it('les flèches d’un groupe de boutons radio gardent leur effet : le choix se déplace, le raccourci reste à l’écart', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    function Page() {
      useShortcut({ id: 'next', keys: 'arrowright', label: 'Suivant', group: 'Test', run });
      return (
        <fieldset>
          <input type="radio" name="vue" aria-label="liste" defaultChecked />
          <input type="radio" name="vue" aria-label="tableau" />
        </fieldset>
      );
    }
    render(<ShortcutsProvider isMac><Page /></ShortcutsProvider>);

    screen.getByRole('radio', { name: 'liste' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(screen.getByRole('radio', { name: 'tableau' })).toHaveProperty('checked', true);
    expect(run).not.toHaveBeenCalled();
  });

  it('`overrideNative` reprend la touche au bouton', async () => {
    const user = userEvent.setup();
    const run = vi.fn();
    const clicked = vi.fn();
    function Page() {
      useShortcut({ id: 'open', keys: 'enter', label: 'Ouvrir', group: 'Test', run, overrideNative: true });
      return <button onClick={clicked}>Bouton</button>;
    }
    render(<ShortcutsProvider isMac><Page /></ShortcutsProvider>);

    screen.getByRole('button', { name: 'Bouton' }).focus();
    await user.keyboard('{Enter}');

    expect(run).toHaveBeenCalledTimes(1);
    expect(clicked).not.toHaveBeenCalled();
  });
});

describe('when : une condition d’application relue à chaque touche', () => {
  function Conditional({ active }: { active: boolean }) {
    const [count, setCount] = useState(0);
    useShortcut({
      id: 'parfois',
      keys: 'escape',
      label: 'Parfois',
      group: 'Test',
      // Cette fermeture lit `active` : elle doit rester à jour sans que le raccourci soit ré-enregistré.
      when: () => active,
      run: () => setCount(count + 1),
    });
    return <output aria-label="compte">{count}</output>;
  }

  /** Note si le registre a détourné la touche. Écoutée après lui, sur la même cible (window). */
  function watchDefaults() {
    const seen: boolean[] = [];
    const controller = new AbortController();
    window.addEventListener('keydown', (event) => seen.push(event.defaultPrevented), { signal: controller.signal });
    return { seen, stop: () => controller.abort() };
  }

  it('ne lance le raccourci, et ne détourne la touche, que tant que la condition est vraie', async () => {
    const user = userEvent.setup();
    const view = render(<ShortcutsProvider isMac><Conditional active={false} /></ShortcutsProvider>);
    const keys = watchDefaults();

    await user.keyboard('{Escape}');
    view.rerender(<ShortcutsProvider isMac><Conditional active /></ShortcutsProvider>);
    await user.keyboard('{Escape}');
    view.rerender(<ShortcutsProvider isMac><Conditional active={false} /></ShortcutsProvider>);
    await user.keyboard('{Escape}');
    keys.stop();

    expect(screen.getByLabelText('compte').textContent).toBe('1');
    expect(keys.seen).toEqual([false, true, false]);
  });

  it('ne ré-enregistre rien quand la condition change : la liste des raccourcis garde sa référence', () => {
    const lists: (readonly Shortcut[])[] = [];
    function ListSpy() {
      lists.push(useShortcutList());
      return null;
    }
    const view = render(<ShortcutsProvider isMac><ListSpy /><Conditional active={false} /></ShortcutsProvider>);
    // Une fois monté, le raccourci est enregistré : c'est la liste que les rendus suivants doivent garder.
    const registered = lists.at(-1);
    expect(registered).toHaveLength(1);
    const rendered = lists.length;

    view.rerender(<ShortcutsProvider isMac><ListSpy /><Conditional active /></ShortcutsProvider>);
    view.rerender(<ShortcutsProvider isMac><ListSpy /><Conditional active={false} /></ShortcutsProvider>);

    expect(lists.length).toBeGreaterThan(rendered);
    expect(lists.slice(rendered).every((list) => list === registered)).toBe(true);
  });
});

describe('priority : le raccourci d’une couche passe avant celui de la page, quel que soit l’ordre de montage', () => {
  function Key({ id, run, priority }: { id: string; run: () => void; priority?: number }) {
    useShortcut({ id, keys: 'escape', label: id, group: 'Test', run, priority });
    return null;
  }

  it('lance le plus prioritaire même s’il est monté avant l’autre', async () => {
    const user = userEvent.setup();
    const layer = vi.fn();
    const page = vi.fn();
    render(
      <ShortcutsProvider isMac>
        <Key id="couche" run={layer} priority={1} />
        <Key id="page" run={page} />
      </ShortcutsProvider>,
    );

    await user.keyboard('{Escape}');

    expect(layer).toHaveBeenCalledTimes(1);
    expect(page).not.toHaveBeenCalled();
  });

  it('prend en compte une priorité qui change : le raccourci est ré-enregistré avec elle', async () => {
    const user = userEvent.setup();
    const first = vi.fn();
    const second = vi.fn();
    const view = render(
      <ShortcutsProvider isMac>
        <Key id="premier" run={first} />
        <Key id="second" run={second} />
      </ShortcutsProvider>,
    );
    await user.keyboard('{Escape}'); // à priorité égale, le dernier monté

    view.rerender(
      <ShortcutsProvider isMac>
        <Key id="premier" run={first} priority={1} />
        <Key id="second" run={second} />
      </ShortcutsProvider>,
    );
    await user.keyboard('{Escape}');

    expect(second).toHaveBeenCalledTimes(1);
    expect(first).toHaveBeenCalledTimes(1);
  });
});

describe('allowInLayer : un raccourci de l’application qui vaut sous une couche non modale', () => {
  function Global({ layer }: { layer?: boolean }) {
    const [count, setCount] = useState(0);
    useShortcut({ id: 'aide', keys: '?', label: 'Aide', group: 'Test', allowInLayer: layer, run: () => setCount(count + 1) });
    return <output aria-label="compte">{count}</output>;
  }

  const Dialogs = () => (
    <>
      <div role="dialog" aria-modal="false" aria-label="couche">
        <button>dans la couche</button>
        <input aria-label="champ de la couche" />
      </div>
      <div role="dialog" aria-label="modale">
        <button>dans la modale</button>
      </div>
    </>
  );

  it('transmet l’option au registre : le raccourci vaut sous une couche non modale, ni sous une boîte modale ni dans un champ', async () => {
    const user = userEvent.setup();
    render(
      <ShortcutsProvider isMac>
        <Global layer />
        <Dialogs />
      </ShortcutsProvider>,
    );

    screen.getByRole('button', { name: 'dans la couche' }).focus();
    await user.keyboard('?');
    expect(screen.getByLabelText('compte').textContent).toBe('1');

    screen.getByRole('button', { name: 'dans la modale' }).focus();
    await user.keyboard('?');
    screen.getByLabelText('champ de la couche').focus();
    await user.keyboard('?');
    expect(screen.getByLabelText('compte').textContent).toBe('1');
  });

  it('sans l’option, le raccourci se tait sous une couche, comme dans toute boîte de dialogue', async () => {
    const user = userEvent.setup();
    render(
      <ShortcutsProvider isMac>
        <Global />
        <Dialogs />
      </ShortcutsProvider>,
    );

    screen.getByRole('button', { name: 'dans la couche' }).focus();
    await user.keyboard('?');

    expect(screen.getByLabelText('compte').textContent).toBe('0');
  });

  it('ré-enregistre le raccourci quand l’option change', async () => {
    const user = userEvent.setup();
    const view = render(
      <ShortcutsProvider isMac>
        <Global />
        <Dialogs />
      </ShortcutsProvider>,
    );
    const inLayer = () => screen.getByRole('button', { name: 'dans la couche' });
    inLayer().focus();
    await user.keyboard('?');
    expect(screen.getByLabelText('compte').textContent).toBe('0');

    view.rerender(
      <ShortcutsProvider isMac>
        <Global layer />
        <Dialogs />
      </ShortcutsProvider>,
    );
    inLayer().focus();
    await user.keyboard('?');
    expect(screen.getByLabelText('compte').textContent).toBe('1');

    view.rerender(
      <ShortcutsProvider isMac>
        <Global layer={false} />
        <Dialogs />
      </ShortcutsProvider>,
    );
    inLayer().focus();
    await user.keyboard('?');
    expect(screen.getByLabelText('compte').textContent).toBe('1');
  });
});
