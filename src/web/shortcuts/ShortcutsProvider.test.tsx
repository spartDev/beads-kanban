import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { ShortcutsProvider, useShortcut, useShortcutList } from './ShortcutsProvider';

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
