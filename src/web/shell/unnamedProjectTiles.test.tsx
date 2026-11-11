import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { metricsFixture, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues } from '../test/fixtures';
import { renderApp } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * La pastille des Projets, dans l'application entière (bdesk-38k.73). Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » (bdesk-38k.65) : sa pastille portait « ST » et la
 * teinte du mot « Sans titre », la même pour tous les Projets sans préfixe. Elle porte « ? » et une teinte tirée du chemin de son dossier, dans la barre latérale, le fil d'Ariane, le sélecteur
 * mobile, la Vue globale et la palette. Les Projets dont le nom se voit gardent leurs initiales et leur teinte (attendus écrits en dur, relevés sur HEAD, 173b090), et un dossier qui s'appelle vraiment
 * « Sans titre » garde « ST ».
 */

warmUpMetricsPages();
withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

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

const project = (overrides: Partial<Project>): Project => ({
  id: 'bdesk',
  name: 'beads-desktop',
  path: '/dev/beads-desktop',
  prefix: 'bdesk',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});

// Les dossiers, dans l'ordre où le serveur les liste. Les noms blancs sont ceux du dossier, envoyés tels quels : c'est l'interface qui les écrit « Sans titre ».
const FOLDERS: Project[] = [
  project({}),
  project({ id: 'notes', name: 'notes perso', path: '/dev/notes perso', prefix: '' }),
  project({ id: 'projet', name: '\u3164', path: '/dev/\u3164', prefix: '' }),
  project({ id: 'projet-2', name: '\u200b', path: '/dev/\u200b', prefix: '' }),
  project({ id: 'projet-3', name: ' ', path: '/dev/ ', prefix: 'ghost' }),
  project({ id: 'projet-4', name: '   ', path: '/dev/   ', prefix: '', status: 'unreadable', reason: 'Base Dolt verrouillée par un autre processus' }),
  project({ id: 'sans-titre', name: 'Sans titre', path: '/dev/Sans titre', prefix: '' }),
];

/** [initiales, teinte] de chaque dossier de `FOLDERS` : relevé sur HEAD pour ceux dont le nom se voit, et attendu du correctif pour les autres. */
const EXPECTED: [string, string][] = [
  ['BD', '11'], // beads-desktop, préfixe bdesk
  ['NP', '42'], // notes perso, sans préfixe : le nom
  ['?', '187'], // U+3164, sans préfixe : le chemin /dev/\u3164 (HEAD : « ST » et 229)
  ['?', '66'], // U+200B, sans préfixe : le chemin /dev/\u200b (HEAD : « ST » et 229)
  ['?', '159'], // espace, préfixe ghost : le préfixe (HEAD : « ST » et 159)
  ['?', '7'], // trois espaces, illisible : pastille grise, sa teinte ne se voit pas (HEAD : « ST »)
  ['ST', '229'], // un dossier qui s'appelle vraiment « Sans titre » : un nom qui se voit
];

/** Les pastilles sous `root`, dans l'ordre du document : leur texte et la teinte qu'elles posent. */
const tilesOf = (root: Element): [string, string][] =>
  [...root.querySelectorAll<HTMLElement>('[aria-hidden="true"]')]
    .filter((element) => element.style.getPropertyValue('--h') !== '')
    .map((element) => [element.textContent ?? '', element.style.getPropertyValue('--h')]);

const api = () =>
  stubMetricsApi({ projects: { projects: FOLDERS, ignored: [] }, issues: { bdesk: bdeskIssues } }, () => metricsFixture());

async function loadedSidebar() {
  const nav = await screen.findByRole('navigation', { name: 'Navigation principale' });
  await waitFor(() => expect(within(nav).queryByRole('status', { name: 'Chargement des Projets' })).toBeNull());
  return nav;
}

describe('la barre latérale', () => {
  it('donne à chaque Projet ses initiales et sa teinte : « ? » et le chemin pour ceux dont le nom ne se voit pas, deux couleurs différentes pour deux Projets sans préfixe ni nom', async () => {
    api();
    renderApp('/p/bdesk/kanban');

    const nav = await loadedSidebar();

    expect(tilesOf(nav)).toEqual(EXPECTED);
  });

  it('écrit toujours « Sans titre » à côté de la pastille d’un Projet sans nom : les trois lisibles, l’illisible, et le dossier qui s’appelle vraiment ainsi', async () => {
    api();
    renderApp('/p/bdesk/kanban');

    const nav = await loadedSidebar();

    expect(within(nav).getAllByText('Sans titre')).toHaveLength(5);
  });
});

describe('le fil d’Ariane et le sélecteur mobile', () => {
  it('portent la pastille « ? » du Projet courant sans nom, de la teinte de son chemin', async () => {
    api();
    renderApp('/p/projet-2/kanban');
    await loadedSidebar();

    const breadcrumb = screen.getByRole('navigation', { name: "Fil d'Ariane" });
    const switcher = screen.getByRole('button', { name: 'Sans titre, changer de Projet' });

    expect(tilesOf(breadcrumb)).toEqual([['?', '66']]);
    expect(tilesOf(switcher)).toEqual([['?', '66']]);
  });
});

describe('la Vue globale', () => {
  it('liste les Projets avec les mêmes pastilles que la barre latérale', async () => {
    api();
    renderApp('/');

    const list = await screen.findByRole('region', { name: 'Projets suivis' });

    await waitFor(() => expect(tilesOf(list)).toEqual(EXPECTED));
  });
});

describe('la palette', () => {
  it('montre les mêmes pastilles dans la liste « Changer de Projet »', async () => {
    api();
    const { user } = renderApp('/p/bdesk/kanban');
    await loadedSidebar();

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    const projects = within(dialog).getAllByRole('option').filter((option) => (option.getAttribute('data-value') ?? '').startsWith('project:'));

    expect(projects.map((option) => tilesOf(option)[0])).toEqual(EXPECTED);
  });
});
