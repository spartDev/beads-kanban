import { screen, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { renderApp, stubApi } from '../test/render';

/**
 * Le titre de la page d'un Projet dont le nom ne dit rien (bdesk-38k.61). `ProjectGate` titre la page d'un Projet illisible de son nom, que le serveur tire du nom du dossier :
 * vide, fait d'espaces ou de caractères sans largeur, il ferait un `<h1>` muet. `Page` l'écrit « Sans titre » (voir `Page.test.tsx`) ; ici, la vraie porte du Projet, dans l'application entière.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

const unreadable = (name: string): Project => ({
  id: 'blanc',
  name,
  path: '/dev/blanc',
  prefix: 'blanc',
  mode: 'embedded',
  status: 'unreadable',
  reason: 'Base Dolt verrouillée par un autre processus',
});

describe('la page d’un Projet illisible dont le nom est blanc', () => {
  it.each([
    ['vide', ''],
    ['fait d’espaces', '   '],
    ['fait d’une espace sans largeur', '\u200b'],
  ])('a pour titre « Sans titre » quand le nom est %s, et dit pourquoi le Projet est illisible', async (_kind, name) => {
    stubApi({ projects: { projects: [unreadable(name)], ignored: [] } });
    renderApp('/p/blanc/kanban');

    const title = await screen.findByRole('heading', { level: 1, name: 'Sans titre' });

    expect(title.textContent).toBe('Sans titre');
    expect(screen.queryAllByRole('heading', { level: 1, name: '' })).toEqual([]);
    expect(within(screen.getByRole('main')).getByText('Ce Projet est illisible')).toBeTruthy();
    expect(within(screen.getByRole('main')).getByText('Base Dolt verrouillée par un autre processus')).toBeTruthy();
  });

  it('garde à un Projet illisible qui a un nom son nom pour titre', async () => {
    stubApi({ projects: { projects: [unreadable('legacy-api')], ignored: [] } });
    renderApp('/p/blanc/kanban');

    expect(await screen.findByRole('heading', { level: 1, name: 'legacy-api' })).toBeTruthy();
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();
  });
});

/**
 * Le nom d'un dossier qui est de la ponctuation seule reste le titre de la page de son Projet (bdesk-38k.61, revue) : ce n'est pas un titre de ticket, « - » ou « : » se voient, et c'est
 * ce que la barre latérale écrit aussi. La porte du Projet passe le nom tel quel à `Page` (voir `Page.test.tsx`) : la règle des titres de ticket n'a pas à s'y appliquer, même quand elle
 * compte un séparateur seul pour un titre vide.
 */
describe('la page d’un Projet illisible dont le nom est de la ponctuation', () => {
  it.each([
    ['un tiret', '-'],
    ['deux tirets', '--'],
    ['deux-points', ':'],
    ['un tiret demi-cadratin entre des espaces', ' – '],
  ])('garde pour titre le nom du dossier, tel quel, quand il est %s', async (_kind, name) => {
    stubApi({ projects: { projects: [unreadable(name)], ignored: [] } });
    renderApp('/p/blanc/kanban');

    const main = within(await screen.findByRole('main'));
    await main.findByText('Ce Projet est illisible');

    expect(main.getByRole('heading', { level: 1 }).textContent).toBe(name);
    expect(screen.queryByRole('heading', { name: 'Sans titre' })).toBeNull();
  });
});
