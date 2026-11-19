import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';

/**
 * Sur mobile, la barre d'onglets n'a qu'une case pour les deux pages de tous les Projets (« Accueil ») : chacune porte en tête les liens de l'une à l'autre
 * (`GlobalTabs`). Le CSS (`md:hidden`) les cache sur desktop, où la barre latérale les liste : jsdom ne l'applique pas, les liens sont donc lus ici à toutes
 * les largeurs.
 */

withAsyncTimeout(5_000);

const stub = () => stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: [] }, signals: {} });
const current = (link: HTMLElement) => link.getAttribute('aria-current');

describe('les liens entre l’accueil et la Vue globale', () => {
  it('sont en tête de l’accueil, « À regarder » courant', async () => {
    stub();
    renderApp('/');

    const nav = within(await screen.findByRole('navigation', { name: 'Pages de tous les Projets' }));
    expect(nav.getAllByRole('link').map((link) => [link.textContent, link.getAttribute('href'), current(link)])).toEqual([
      ['À regarder', '/', 'page'],
      ['Vue globale', '/overview', null],
    ]);
  });

  it('sont en tête de la Vue globale, elle courante, même écrite avec une barre oblique finale', async () => {
    for (const path of ['/overview', '/overview/']) {
      stub();
      const app = renderApp(path);

      const nav = within(await screen.findByRole('navigation', { name: 'Pages de tous les Projets' }));
      expect(current(nav.getByRole('link', { name: 'Vue globale' })), path).toBe('page');
      expect(current(nav.getByRole('link', { name: 'À regarder' })), path).toBeNull();
      app.unmount();
    }
  });

  it('mènent de l’une à l’autre', async () => {
    stub();
    const { user, router } = renderApp('/');
    const nav = () => within(screen.getByRole('navigation', { name: 'Pages de tous les Projets' }));
    await screen.findByRole('navigation', { name: 'Pages de tous les Projets' });

    await user.click(nav().getByRole('link', { name: 'Vue globale' }));
    expect(router.state.location.pathname).toBe('/overview');
    expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
    expect(current(nav().getByRole('link', { name: 'Vue globale' }))).toBe('page');

    await user.click(nav().getByRole('link', { name: 'À regarder' }));
    expect(router.state.location.pathname).toBe('/');
    expect(await screen.findByRole('heading', { level: 1, name: 'À regarder' })).toBeTruthy();
    expect(current(nav().getByRole('link', { name: 'À regarder' }))).toBe('page');
  });

  it('ne sont pas sur les pages d’un Projet', async () => {
    stub();
    renderApp('/p/bdesk/signals');

    await screen.findByRole('heading', { level: 1, name: 'À regarder' });
    expect(screen.queryByRole('navigation', { name: 'Pages de tous les Projets' })).toBeNull();
  });

  it('se disent en anglais', async () => {
    setBrowserLanguages(['en-US', 'en']);
    stub();
    const { user, router } = renderApp('/overview', { languageSwitch: true });

    const nav = within(await screen.findByRole('navigation', { name: 'Pages for all projects' }));
    expect(nav.getAllByRole('link').map((link) => [link.textContent, current(link)])).toEqual([
      ['Watch list', null],
      ['Overview', 'page'],
    ]);
    await user.click(nav.getByRole('link', { name: 'Watch list' }));
    await waitFor(() => expect(router.state.location.pathname).toBe('/'));
  });
});

describe('la Vue globale écrite autrement : le routeur l’affiche, le shell la reconnaît', () => {
  it.each([
    ['avec une barre oblique finale', '/overview/'],
    ['avec une majuscule', '/Overview'],
    ['en capitales, avec une barre oblique finale', '/OVERVIEW/'],
  ])('%s (%s) : la barre latérale, la barre d’onglets, le bandeau du haut et les liens du mobile', async (_kind, path) => {
    stub();
    renderApp(path);

    expect(await screen.findByRole('heading', { level: 1, name: 'Vue globale' })).toBeTruthy();
    const sidebar = within(await screen.findByRole('navigation', { name: 'Navigation principale' }));
    expect(current(sidebar.getByRole('link', { name: /^Vue globale/ }))).toBe('page');
    expect(current(within(screen.getByRole('navigation', { name: 'Onglets' })).getByRole('link', { name: 'Accueil' }))).toBe('true');
    expect(within(screen.getByRole('navigation', { name: "Fil d'Ariane" })).getByText('Vue globale')).toBeTruthy();
    expect(current(within(screen.getByRole('navigation', { name: 'Pages de tous les Projets' })).getByRole('link', { name: 'Vue globale' }))).toBe('page');
  });
});
