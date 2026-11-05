import { render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsProvider, useShortcut } from '../shortcuts/ShortcutsProvider';
import { withHeldExitAnimations } from '../test/exitAnimation';
import { OverlayProvider, useShortcutsHelp } from './OverlayProvider';
import { ShortcutsHelp } from './ShortcutsHelp';

afterEach(() => {
  vi.restoreAllMocks();
});

/** Enregistre des raccourcis, puis ouvre l'aide. */
function Open({ keys }: { keys: string[] }) {
  const { show } = useShortcutsHelp();
  useShortcut({ id: 'test.premier', keys: keys[0] ?? 'x', label: 'Premier', group: 'Test', run: () => undefined });
  useShortcut({ id: 'test.second', keys: keys[1] ?? 'y', label: 'Second', group: 'Test', run: () => undefined });
  useEffect(() => show(), [show]);
  return null;
}

function renderHelp(keys: string[]) {
  return render(
    <ShortcutsProvider isMac>
      <OverlayProvider>
        <Open keys={keys} />
        <ShortcutsHelp />
      </OverlayProvider>
    </ShortcutsProvider>,
  );
}

describe('aide des raccourcis', () => {
  it('écrit une séquence « G puis K », une combinaison « ⌘ K »', async () => {
    renderHelp(['g k', 'mod+k']);

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const sequence = within(help).getByText('Premier').closest('li') as HTMLElement;

    expect(sequence.textContent).toBe('PremierGpuisK');
    expect((within(help).getByText('Second').closest('li') as HTMLElement).textContent).toBe('Second⌘K');
  });

  it('écrit sur une seule ligne une action qui a plusieurs touches : « H ou ← »', async () => {
    function Alternates() {
      const { show } = useShortcutsHelp();
      useShortcut({
        id: 'test.previous',
        keys: 'h',
        alternateKeys: ['arrowleft'],
        label: 'Colonne précédente',
        group: 'Test',
        run: () => undefined,
      });
      useEffect(() => show(), [show]);
      return null;
    }
    render(
      <ShortcutsProvider isMac>
        <OverlayProvider>
          <Alternates />
          <ShortcutsHelp />
        </OverlayProvider>
      </ShortcutsProvider>,
    );

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    const lines = within(help).getAllByText('Colonne précédente');
    expect(lines).toHaveLength(1);
    expect((lines[0]!.closest('li') as HTMLElement).textContent).toBe('Colonne précédenteHou←');
  });

  it('écrit « ou » entre deux séquences alternatives aussi', async () => {
    function Alternates() {
      const { show } = useShortcutsHelp();
      useShortcut({ id: 'test.go', keys: 'g k', alternateKeys: ['mod+shift+k'], label: 'Aller au kanban', group: 'Test', run: () => undefined });
      useEffect(() => show(), [show]);
      return null;
    }
    render(
      <ShortcutsProvider isMac>
        <OverlayProvider>
          <Alternates />
          <ShortcutsHelp />
        </OverlayProvider>
      </ShortcutsProvider>,
    );

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    expect((within(help).getByText('Aller au kanban').closest('li') as HTMLElement).textContent).toBe('Aller au kanbanGpuisKou⌘⇧K');
  });

  it('garde sa liste accessible au clavier : une zone qui défile doit pouvoir prendre le focus', async () => {
    renderHelp(['g k', 'mod+k']);

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const list = within(help).getByRole('region', { name: 'Liste des raccourcis' });

    // La liste s'allonge avec les raccourcis des pages (le kanban en ajoute huit) : elle finit par défiler.
    expect(list.getAttribute('tabindex')).toBe('0');
    expect(list.className).toContain('overflow-y-auto');
    expect(within(list).getByText('Premier')).toBeTruthy();
  });

  it('accepte une séquence qui répète la même touche (« g g ») sans clé React en double', async () => {
    const error = vi.spyOn(console, 'error').mockImplementation(() => undefined);

    renderHelp(['g g', 'x']);

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    expect(within(help).getByText('Premier').closest('li')?.textContent).toBe('PremierGpuisG');
    expect(error.mock.calls.map((call) => String(call[0]))).not.toContainEqual(expect.stringMatching(/same key|unique "key"/));
  });
});

describe('l’aide rend Échap au registre des raccourcis dès qu’elle se ferme, et pas avant', () => {
  const exit = withHeldExitAnimations();

  /** Une page qui n'a qu'un raccourci Échap valable partout, même dans une boîte de dialogue, et un bouton pour ouvrir l'aide. */
  function Page({ onEscape }: { onEscape: () => void }) {
    const { show } = useShortcutsHelp();
    useShortcut({ id: 'test.escape', keys: 'escape', label: 'Échap de la page', group: 'Test', allowInInput: true, run: onEscape });
    return (
      <button type="button" onClick={show}>
        Ouvrir l’aide
      </button>
    );
  }

  function renderPage(onEscape: () => void) {
    render(
      <ShortcutsProvider isMac>
        <OverlayProvider>
          <Page onEscape={onEscape} />
          <ShortcutsHelp />
        </OverlayProvider>
      </ShortcutsProvider>,
    );
    return userEvent.setup();
  }

  it('ouverte, l’aide garde Échap pour se fermer ; fermée mais encore là, elle le rend à la page', async () => {
    const onEscape = vi.fn();
    const user = renderPage(onEscape);
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’aide' }));
    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    await user.keyboard('{Escape}');

    expect(help.getAttribute('data-state')).toBe('closed');
    expect(help.isConnected).toBe(true); // l'animation de sortie n'est pas finie : la boîte de dialogue est encore là
    expect(onEscape).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
    exit.finish();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('une fois retirée, elle rend le focus au bouton qui l’a ouverte', async () => {
    const user = renderPage(vi.fn());
    const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
    await user.click(opener);
    await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    await user.keyboard('{Escape}');
    expect(document.activeElement).not.toBe(opener); // le focus est encore dans la boîte de dialogue qui se retire

    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
