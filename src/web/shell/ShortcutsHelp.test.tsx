import { render, screen, within } from '@testing-library/react';
import { useEffect } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { ShortcutsProvider, useShortcut } from '../shortcuts/ShortcutsProvider';
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
