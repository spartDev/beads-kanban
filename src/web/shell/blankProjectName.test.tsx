import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsFixture, metricsOf, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { UNTITLED } from '../test/blankTitles';
import { bdeskIssues } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * Un Projet dont le dossier a un nom qu'on ne voit pas (bdesk-38k.65). Son nom, que le serveur tire du nom du dossier (`basename`), est vide, fait d'espaces, de caractères sans largeur, d'un
 * remplisseur hangul (U+3164) ou d'un blanc braille (U+2800) : le fil d'Ariane en faisait un lien sans nom (axe `link-name`, relevé à 1280 px), la barre latérale une ligne sans texte, et l'onglet
 * écrivait ce nom blanc quand le titre de la page disait « Sans titre ». L'interface l'écrit « Sans titre » partout : les données le lui donnent (`useProjects`).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`. La Vue globale monte aussi les graphiques, lus une fois.
warmUpMetricsPages();
withAsyncTimeout(5_000);

// Le navigateur est à Paris, comme les fixtures : la page compte « aujourd'hui » dans son fuseau et le donne au serveur (`timeZone`, bdesk-38k.48).
withTimeZone('Europe/Paris');

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : comme dans GlobalPage.test.tsx, dont la Vue globale lit la date du jour.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

const NAMES = [
  ['vide', ''],
  ['fait d’espaces', '   '],
  ['fait d’une espace sans largeur (U+200B)', '\u200b'],
  ['fait d’un remplisseur hangul (U+3164)', '\u3164'],
  ['fait d’un blanc braille (U+2800)', '\u2800'],
] as const;

const readable = (name: string, overrides: Partial<Project> = {}): Project => ({
  id: 'blanc',
  name,
  path: '/dev/blanc',
  prefix: 'bd',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});
const unreadable = (name: string): Project => ({ ...readable(name), status: 'unreadable', reason: 'Base Dolt verrouillée par un autre processus' });

/** La barre latérale, une fois la liste des Projets arrivée : jusque-là, le fil d'Ariane dit l'identifiant du Projet, et la barre un squelette. */
async function loadedSidebar() {
  const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
  await waitFor(() => expect(within(nav).queryByRole('status', { name: 'Chargement des Projets' })).toBeNull());
  return nav;
}
const breadcrumb = () => screen.getByRole('navigation', { name: 'Fil d\'Ariane' });
/** Le lien se nomme du nom du Projet puis de son préfixe, que jsdom accole sans espace : on ne regarde que le début. */
const startingWith = (text: string) => (name: string) => name.startsWith(text);

describe('un Projet lisible dont le nom ne se voit pas', () => {
  it.each(NAMES)('le fil d’Ariane et le sélecteur mobile le nomment « Sans titre » quand le nom est %s : aucun lien ni bouton sans nom', async (_kind, name) => {
    stubApi({ projects: { projects: [readable(name)], ignored: [] }, issues: { blanc: bdeskIssues } });
    renderApp('/p/blanc/kanban');

    await loadedSidebar();

    expect(within(breadcrumb()).getByRole('link', { name: UNTITLED })).toBeTruthy();
    expect(screen.getByRole('button', { name: `${UNTITLED}, changer de Projet` })).toBeTruthy();
    expect(screen.queryAllByRole('link', { name: '' })).toEqual([]);
    expect(screen.queryAllByRole('button', { name: '' })).toEqual([]);
  });

  it.each(NAMES)('la barre latérale l’écrit « Sans titre » dans le lien du Projet courant quand le nom est %s', async (_kind, name) => {
    stubApi({ projects: { projects: [readable(name)], ignored: [] }, issues: { blanc: bdeskIssues } });
    renderApp('/p/blanc/kanban');

    const link = within(await loadedSidebar()).getByRole('link', { name: startingWith(UNTITLED) });

    expect(link.getAttribute('aria-current')).toBe('true');
  });

  it('garde à un Projet dont le nom se voit son nom, tel qu’il est écrit : « - » et « : » en sont', async () => {
    stubApi({
      projects: { projects: [readable('-', { id: 'tiret', prefix: 'a' }), readable(':', { id: 'deux-points', prefix: 'b' }), readable('Mon Projet', { id: 'mon', prefix: 'c' })], ignored: [] },
      issues: { tiret: bdeskIssues },
    });
    renderApp('/p/tiret/kanban');

    const nav = await loadedSidebar();

    expect(within(nav).getByRole('link', { name: startingWith('-') })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: startingWith(':') })).toBeTruthy();
    expect(within(nav).getByRole('link', { name: startingWith('Mon Projet') })).toBeTruthy();
    expect(within(breadcrumb()).getByRole('link', { name: '-' })).toBeTruthy();
    expect(screen.queryByText(UNTITLED)).toBeNull();
  });
});

describe('un Projet illisible dont le nom ne se voit pas', () => {
  it.each(NAMES)('la barre latérale l’écrit « Sans titre » et dit pourquoi il est illisible quand le nom est %s', async (_kind, name) => {
    stubApi({ projects: { projects: [unreadable(name)], ignored: [] } });
    renderApp('/');

    const nav = await loadedSidebar();

    expect(within(nav).getByText(UNTITLED)).toBeTruthy();
    expect(within(nav).getByText(/Base Dolt verrouillée par un autre processus/)).toBeTruthy();
    expect(within(nav).queryAllByRole('link', { name: '' })).toEqual([]);
  });
});

describe('la Vue globale et la palette', () => {
  it.each(NAMES)('la Vue globale liste le Projet « Sans titre », sous un lien nommé, quand le nom est %s', async (_kind, name) => {
    stubMetricsApi({ projects: { projects: [readable(name), readable('beads-desktop', { id: 'bdesk', prefix: 'bdesk' })], ignored: [] }, issues: { blanc: bdeskIssues, bdesk: bdeskIssues } }, () => metricsFixture());
    renderApp('/');

    const list = within(await screen.findByRole('region', { name: 'Projets suivis' }));

    expect(await list.findByRole('link', { name: startingWith(UNTITLED) })).toBeTruthy();
    expect(list.getByRole('link', { name: startingWith('beads-desktop') })).toBeTruthy();
  });

  it.each(NAMES)('la palette trouve le Projet par « Sans titre » quand le nom est %s', async (_kind, name) => {
    stubApi({ projects: { projects: [readable(name), readable('beads-desktop', { id: 'bdesk', prefix: 'bdesk' })], ignored: [] }, issues: { blanc: bdeskIssues, bdesk: bdeskIssues } });
    const { user } = renderApp('/p/bdesk/kanban');
    await loadedSidebar();

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('sans titre');

    expect(await within(dialog).findByRole('option', { name: /Sans titre/ })).toBeTruthy();
  });
});

/**
 * Le tableau « Métriques de la période par projet » de la Vue globale (bdesk-38k.65, revue). Chaque ligne y est un lien vers la page Métriques du Projet, dont le texte est le libellé que l'API donne à
 * la ligne du découpage par Projet : le serveur y écrit le nom du dossier, une deuxième fois à côté de `projects`. Les noms des Projets sont donnés à l'entrée des données (`useMetrics`) : un libellé
 * resté tel que le serveur l'écrit faisait de ce lien un lien sans nom (axe `link-name`) dans une cellule d'en-tête sans nom (`empty-table-header`), sur la page d'accueil.
 */
describe('le tableau des métriques par Projet, sur la Vue globale', () => {
  const table = async () => within(await screen.findByRole('table', { name: 'Métriques de la période par projet' }));

  it.each(NAMES)('le lien de la ligne d’un Projet dont le nom est %s se nomme « Sans titre », et son en-tête de ligne aussi', async (_kind, name) => {
    const measured = [{ id: 'blanc', name }, { id: 'bdesk', name: 'beads-desktop' }];
    stubMetricsApi({ projects: { projects: [readable(name), readable('beads-desktop', { id: 'bdesk', prefix: 'bdesk' })], ignored: [] }, issues: { blanc: bdeskIssues, bdesk: bdeskIssues } }, () => metricsOf(measured));
    renderApp('/');

    const rows = await table();

    expect(rows.getByRole('link', { name: UNTITLED }).getAttribute('href')).toBe('/p/blanc/metrics');
    expect(rows.getByRole('link', { name: 'beads-desktop' }).getAttribute('href')).toBe('/p/bdesk/metrics');
    expect(rows.getByRole('rowheader', { name: UNTITLED })).toBeTruthy();
    expect(rows.queryAllByRole('link', { name: '' })).toEqual([]);
    expect(rows.queryAllByRole('rowheader', { name: '' })).toEqual([]);
  });

  it('écrit tels quels les noms qui se voient : « - », « : », « Mon Projet »', async () => {
    const names = ['-', ':', 'Mon Projet'];
    const measured = names.map((name, index) => ({ id: `p${index}`, name }));
    stubMetricsApi({ projects: { projects: measured.map(({ id, name }) => readable(name, { id, prefix: id })), ignored: [] }, issues: Object.fromEntries(measured.map(({ id }) => [id, bdeskIssues])) }, () => metricsOf(measured));
    renderApp('/');

    const rows = await table();

    for (const name of names) expect(rows.getByRole('link', { name }), name).toBeTruthy();
    expect(rows.queryByRole('link', { name: UNTITLED })).toBeNull();
  });
});
