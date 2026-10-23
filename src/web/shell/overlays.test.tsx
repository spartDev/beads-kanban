import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

/** Toutes les boîtes de dialogue présentes dans le DOM, y compris celles que Radix masque aux lecteurs d'écran. */
const dialogs = () => screen.queryAllByRole('dialog', { hidden: true });
const titles = () => dialogs().map((dialog) => dialog.getAttribute('aria-label') ?? dialog.querySelector('h2')?.textContent);

async function ready() {
  stubDefaultApi();
  const app = renderApp('/p/bdesk/kanban');
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  return app;
}

describe('aide des raccourcis et palette : une seule boîte de dialogue à la fois', () => {
  it('ouvrir la palette (⌘K) ferme l’aide', async () => {
    const { user } = await ready();
    await user.keyboard('?');
    await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    await user.keyboard('{Control>}k{/Control}');

    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await waitFor(() => expect(titles()).toEqual(['Palette de commandes']));
    expect(within(palette).getByRole('combobox')).toBe(document.activeElement);
  });

  it('ouvrir l’aide depuis la palette ferme la palette', async () => {
    const { user } = await ready();
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('raccourcis');

    await user.click(await within(palette).findByRole('option', { name: /Raccourcis clavier/ }));

    await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    await waitFor(() => expect(titles()).toEqual(['Raccourcis clavier']));
  });

  it('⌘K / Ctrl+K referme la palette depuis son champ : cmdk n’emporte pas Ctrl+K pour « ligne précédente »', async () => {
    const { user } = await ready();

    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    expect(within(palette).getByRole('combobox')).toBe(document.activeElement);
    await user.keyboard('{Control>}k{/Control}');

    await waitFor(() => expect(dialogs()).toHaveLength(0));
  });

  it('Échap ferme la boîte de dialogue ouverte, palette ou aide, sans rien laisser derrière', async () => {
    const { user } = await ready();

    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialogs()).toHaveLength(0));

    await user.keyboard('?');
    await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialogs()).toHaveLength(0));
  });

  it('le mode « changer de Projet » (g p) n’emporte pas l’aide avec lui', async () => {
    const { user } = await ready();
    await user.keyboard('?');
    await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    // Dans une boîte de dialogue, « g p » est ignoré : l'aide reste seule ouverte.
    await user.keyboard('gp');

    expect(titles()).toEqual(['Raccourcis clavier']);
  });
});
