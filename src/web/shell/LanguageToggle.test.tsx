import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { LANGUAGE_STORAGE_KEY } from '../i18n/language';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

async function mount(languageSwitch?: boolean) {
  stubDefaultApi();
  const app = renderApp('/', { languageSwitch });
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  return app;
}

describe('sélecteur de langue', () => {
  it('n’apparaît pas tant que le sélecteur n’est pas activé, ni dans la barre ni dans la palette', async () => {
    const { user } = await mount();

    expect(screen.queryByRole('group', { name: 'Langue' })).toBeNull();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('English');
    expect(within(dialog).queryByRole('option', { name: /English/ })).toBeNull();
    expect(document.documentElement.lang).toBe('fr');
  });

  it('propose trois positions, les langues écrites dans leur langue, celle du navigateur cochée par défaut', async () => {
    await mount(true);

    const group = screen.getByRole('group', { name: 'Langue' });
    const buttons = within(group).getAllByRole('button');
    expect(buttons.map((button) => button.getAttribute('aria-label'))).toEqual(['Langue du navigateur', 'Français', 'English']);
    expect(buttons.map((button) => button.getAttribute('lang'))).toEqual([null, 'fr', 'en']);
    expect(buttons.map((button) => button.getAttribute('aria-pressed'))).toEqual(['true', 'false', 'false']);
    // Ce que l'on voit : un globe, puis le code de chaque langue sur le bouton qui y mène.
    expect(buttons.map((button) => button.textContent)).toEqual(['', 'FR', 'EN']);
    expect(buttons[0]!.querySelector('svg')).not.toBeNull();
  });

  it('bascule l’interface sans recharger, met à jour <html lang> et mémorise le choix', async () => {
    const { user } = await mount(true);

    await user.click(screen.getByRole('button', { name: 'English' }));

    // Le groupe porte désormais son nom anglais, et la position « navigateur » aussi.
    const group = await screen.findByRole('group', { name: 'Language' });
    expect(within(group).getByRole('button', { name: 'Browser language' }).getAttribute('aria-pressed')).toBe('false');
    expect(within(group).getByRole('button', { name: 'English' }).getAttribute('aria-pressed')).toBe('true');
    expect(document.documentElement.lang).toBe('en');
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');

    await user.click(within(group).getByRole('button', { name: 'Browser language' }));
    expect(await screen.findByRole('group', { name: 'Langue' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('fr');
  });

  it('suit un navigateur anglais par défaut', async () => {
    setBrowserLanguages(['en-US']);
    await mount(true);

    expect(screen.getByRole('group', { name: 'Language' })).toBeTruthy();
    expect(document.documentElement.lang).toBe('en');
  });

  it('est au pied de la barre latérale, pas dans la barre du haut', async () => {
    await mount(true);

    const group = screen.getByRole('group', { name: 'Langue' });
    expect(group.closest('aside')).not.toBeNull();
    expect(group.closest('header')).toBeNull();
  });

  it('le choix fait porte la marque, une seule couleur d’encre par bouton (sinon la feuille compilée choisit l’encre claire sur le jaune)', async () => {
    await mount(true);

    const buttons = within(screen.getByRole('group', { name: 'Langue' })).getAllByRole('button');
    const inks = (button: HTMLElement) => [...button.classList].filter((name) => /^(hover:)?text-(ink|side-ink|mark-ink)/.test(name));
    expect(inks(buttons[0]!)).toEqual(['text-mark-ink']);
    expect(buttons[0]!.classList.contains('bg-mark')).toBe(true);
    for (const button of buttons.slice(1)) expect(inks(button)).toEqual(['text-side-ink-3', 'hover:text-side-ink']);
  });

  it('la palette coche « Langue du navigateur » tant qu’on suit le navigateur, même quand il est en français', async () => {
    const { user } = await mount(true);

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('langue');
    const browser = await within(dialog).findByRole('option', { name: /Langue du navigateur/ });
    expect(within(browser).queryByLabelText('Actif')).not.toBeNull();
    expect(within(within(dialog).getByRole('option', { name: /Français/ })).queryByLabelText('Actif')).toBeNull();
  });

  it('dit le nom de chaque langue dans sa langue, jusque dans l’infobulle', async () => {
    const { user } = await mount(true);

    await user.hover(screen.getByRole('button', { name: 'English' }));
    const tip = await screen.findByRole('tooltip');
    expect(within(tip).getByText('English').getAttribute('lang')).toBe('en');
  });

  it('la palette coche la langue choisie, écrit ses lignes dans la langue affichée, et chaque nom de langue dans sa langue', async () => {
    const { user } = await mount(true);
    await user.click(screen.getByRole('button', { name: 'English' }));

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog');
    await user.keyboard('language');
    const browser = await within(dialog).findByRole('option', { name: /Browser language/ });
    const english = within(dialog).getByRole('option', { name: /English/ });
    const french = within(dialog).getByRole('option', { name: /Français/ });
    expect(within(english).queryByLabelText('Actif')).not.toBeNull();
    expect(within(browser).queryByLabelText('Actif')).toBeNull();
    expect(within(french).getByText('Français').getAttribute('lang')).toBe('fr');
  });

  it('se change aussi depuis la palette', async () => {
    const { user } = await mount(true);

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('anglais');
    const english = await within(dialog).findByRole('option', { name: /English/ });
    await user.click(english);

    await waitFor(() => expect(document.documentElement.lang).toBe('en'));
    expect(window.localStorage.getItem(LANGUAGE_STORAGE_KEY)).toBe('en');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});
