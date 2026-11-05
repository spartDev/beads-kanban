import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { renderApp, stubApi } from '../test/render';

/**
 * Le titre de la page d'un Projet dont le nom ne dit rien (bdesk-38k.61). `ProjectGate` titre la page d'un Projet illisible de son nom, que le serveur tire du nom du dossier :
 * vide, fait d'espaces ou de caractères sans largeur, il ferait un `<h1>` muet. `Page` l'écrit « Sans titre » (voir `Page.test.tsx`) ; ici, la vraie porte du Projet, dans l'application entière.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

// L'onglet est celui du fichier entier : chaque test repart d'un onglet sans titre, sans quoi le titre d'un test précédent ferait passer le suivant.
beforeEach(() => {
  document.title = '';
});
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
    ['fait d’un remplisseur hangul (U+3164)', '\u3164'],
    ['fait d’un blanc braille (U+2800)', '\u2800'],
  ])('a pour titre « Sans titre » quand le nom est %s, et dit pourquoi le Projet est illisible', async (_kind, name) => {
    stubApi({ projects: { projects: [unreadable(name)], ignored: [] } });
    renderApp('/p/blanc/kanban');

    const title = await screen.findByRole('heading', { level: 1, name: 'Sans titre' });

    expect(title.textContent).toBe('Sans titre');
    expect(screen.queryAllByRole('heading', { level: 1, name: '' })).toEqual([]);
    // L'onglet dit comme le titre : le nom blanc du dossier n'y est pas écrit tel quel (bdesk-38k.65).
    await waitFor(() => expect(document.title).toBe('Sans titre · beads-desktop'));
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
 * ce que la barre latérale écrit aussi. La porte du Projet passe le nom tel quel à `Page` (voir `Page.test.tsx`) : ni la règle des titres de ticket ni celle du nom d'une Epic n'ont à s'y appliquer,
 * celle-ci prenant un séparateur seul pour un titre sans nom.
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

/**
 * L'onglet du navigateur d'un Projet dont le nom ne se voit pas (bdesk-38k.65). Les pages d'un Projet lisible titrent l'onglet de leur nom (« Kanban · bdesk · beads-desktop ») : un nom blanc y
 * laissait des blancs au milieu du titre (« Kanban ·    · beads-desktop »), et un nom vide un onglet sans lui. Il y est « Sans titre », comme dans le fil d'Ariane et dans la barre latérale.
 */
describe('l’onglet d’un Projet lisible dont le nom ne se voit pas', () => {
  const readable = (name: string): Project => ({ ...unreadable(name), status: 'ok', reason: undefined });

  it.each([
    ['vide', ''],
    ['fait d’espaces', '   '],
    ['fait d’un remplisseur hangul (U+3164)', '\u3164'],
    ['fait d’un blanc braille (U+2800)', '\u2800'],
  ])('le kanban titre l’onglet « Kanban · Sans titre · beads-desktop » quand le nom est %s', async (_kind, name) => {
    stubApi({ projects: { projects: [readable(name)], ignored: [] }, issues: { blanc: [] } });
    renderApp('/p/blanc/kanban');

    await waitFor(() => expect(document.title).toBe('Kanban · Sans titre · beads-desktop'));
  });

  it('les Epics aussi', async () => {
    stubApi({ projects: { projects: [readable('   ')], ignored: [] }, issues: { blanc: [] } });
    renderApp('/p/blanc/epics');

    await waitFor(() => expect(document.title).toBe('Epics · Sans titre · beads-desktop'));
  });
});
