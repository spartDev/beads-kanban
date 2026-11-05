import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { describe, expect, it } from 'vitest';
import { focusElement } from '../lib/focus';
import { ShortcutsProvider } from '../shortcuts/ShortcutsProvider';
import { Tip, TooltipProvider } from './Tip';

/** Deux boutons, le second avec son infobulle : de quoi aller au clavier de l'un à l'autre. */
function renderTip() {
  render(
    <ShortcutsProvider isMac>
      <TooltipProvider>
        <button type="button">Avant</button>
        <Tip label="Raccourcis clavier" shortcut="?">
          <button type="button" aria-label="Afficher les raccourcis clavier">
            Aide
          </button>
        </Tip>
      </TooltipProvider>
    </ShortcutsProvider>,
  );
  return userEvent.setup();
}

const button = () => screen.getByRole('button', { name: 'Afficher les raccourcis clavier' });

describe('l’infobulle d’un bouton (Tip)', () => {
  it('s’ouvre quand le clavier atteint le bouton : c’est ainsi qu’on lit sans souris le libellé d’un bouton qui n’a qu’une icône', async () => {
    const user = renderTip();

    await user.tab(); // « Avant »
    expect(screen.queryByRole('tooltip')).toBeNull();
    await user.tab(); // le bouton à infobulle

    expect(document.activeElement).toBe(button());
    expect((await screen.findByRole('tooltip')).textContent).toContain('Raccourcis clavier');
  });

  it('ne s’ouvre pas quand le focus est rendu au bouton par programme (la boîte de dialogue qu’il a ouverte se referme)', () => {
    renderTip();

    // `act` : React applique ce que le focus déclenche avant qu'on regarde ; sans lui, une infobulle qui s'ouvrirait ne serait pas encore là.
    let given = false;
    act(() => {
      given = focusElement(button());
    });

    expect(given).toBe(true);
    expect(document.activeElement).toBe(button());
    expect(screen.queryByRole('tooltip')).toBeNull();
  });

  it('s’ouvre de nouveau au focus clavier suivant, après un focus rendu par programme', async () => {
    const user = renderTip();
    act(() => {
      focusElement(button());
    });
    expect(screen.queryByRole('tooltip')).toBeNull();

    await user.tab({ shift: true }); // « Avant » : le focus a quitté le bouton
    await user.tab(); // et y revient, au clavier

    expect(document.activeElement).toBe(button());
    expect((await screen.findByRole('tooltip')).textContent).toContain('Raccourcis clavier');
  });
});
