import { render, screen, within } from '@testing-library/react';
import type { ReactElement } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { metricsOf, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { fallbackInSentences, fallbackInTitle, FALLBACK } from '../test/fallbackInSentences';
import { bdeskIssues } from '../test/fixtures';
import { renderApp } from '../test/render';
import { withTimeZone } from '../test/timeZone';
import type { Project } from './types';

/**
 * « Sans titre » n'est écrit qu'en libellé (bdesk-38k.73, relecture). Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » dans une ligne, un lien, une cellule ; dans une phrase il se lirait comme
 * le nom d'un Projet (« Les tickets de Sans titre »). Ce test monte l'application avec des Projets dont le dossier n'a pas de nom, état après état (le kanban, les Epics et leurs avis, le panneau d'un ticket, les
 * métriques, la Vue globale, la palette et son alerte, la porte d'un Projet illisible, les avis d'un Projet sans ticket), et cherche le repli au milieu d'un autre texte : dans le texte propre d'un élément, dans un attribut qu'on lit (`title`, `aria-label`…),
 * dans le titre de l'onglet (`test/fallbackInSentences.ts`). Il ne lit pas le code : quelle que soit la forme où une phrase est écrite (du texte JSX à côté du nom, un gabarit, une concaténation, un nom qui passe de
 * composant en composant sous un autre nom, une fonction d'un autre fichier), elle rend le même texte, et il la voit. C'est ce que `data/projectSentences.test.ts`, qui lit le code, ne voit pas.
 *
 * Ce qu'il ne voit pas : un état qu'il ne monte pas (un nouvel état d'une page, un avis qu'aucune de ses données ne fait paraître), et un nom écrit seul dans son élément au milieu d'une phrase
 * (`<p>Les tickets de <strong>Sans titre</strong>, en colonnes.</p>`, ou `<p>Les tickets de <a href="…">Sans titre</a>, en colonnes.</p>` que rend un `<Link>` : le texte propre de l'élément est le repli seul, un libellé comme un autre pour lui) : celui-là,
 * c'est le balayage du code qui le lit, en tenant tout composant pour un élément de la ligne ; un composant du fichier qui rend ce nom seul (`<Nom />`) n'est lu par aucun des deux.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée, et la vue des métriques est un morceau chargé à la demande : voir `warmUpMetricsPages`.
warmUpMetricsPages();
withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : la Vue globale et les métriques lisent la date du jour.
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

const folder = (overrides: Partial<Project> = {}): Project => ({
  id: 'blanc',
  name: '\u3164',
  path: '/dev/blanc',
  prefix: '',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});

/** Trois dossiers dont le nom ne se voit pas (un lisible sans préfixe, un lisible avec un préfixe, un illisible) et un Projet nommé, que le serveur envoie tels quels : c'est l'interface qui les écrit « Sans titre ». */
const PROJECTS: Project[] = [
  folder(),
  folder({ id: 'ghost', name: ' ', prefix: 'ghost', path: '/dev/ghost' }),
  folder({ id: 'vide', name: '   ', path: '/dev/vide', status: 'unreadable', reason: 'Base Dolt verrouillée par un autre processus' }),
  folder({ id: 'bdesk', name: 'beads-desktop', prefix: 'bdesk', path: '/dev/beads-desktop' }),
];

/** Le faux serveur : les Projets, leurs tickets (ou leur panne), et des métriques où les mêmes Projets sont nommés de même (les mesurés, les illisibles, le découpage par Projet). */
function serve(issues: Record<string, Error | typeof bdeskIssues> = { blanc: bdeskIssues, ghost: bdeskIssues, bdesk: bdeskIssues }) {
  return stubMetricsApi({ projects: { projects: PROJECTS, ignored: [] }, issues }, () =>
    metricsOf(
      [
        { id: 'blanc', name: '\u3164' },
        { id: 'ghost', name: ' ' },
        { id: 'bdesk', name: 'beads-desktop' },
      ],
      { unreadable: [{ id: 'vide', name: '   ', reason: 'Base Dolt verrouillée par un autre processus' }] },
    ),
  );
}

/** Tout ce que la page écrit du repli au milieu d'un autre texte. */
const writtenAmongWords = (): string[] => [...fallbackInSentences(document.body), ...fallbackInTitle(document.title)];

/** Chaque état : son nom, son adresse, et ce qu'on attend pour qu'il soit dessiné. */
const STATES: [string, string, () => Promise<unknown>][] = [
  ['le kanban', '/p/blanc/kanban', () => screen.findByRole('link', { name: /Shell UI façon Linear/ })],
  ['la liste des Epics', '/p/blanc/epics', () => screen.findByRole('link', { name: /beads-desktop V1 : suivi des tickets/ })],
  ['la page d’une Epic', '/p/blanc/epics?epic=bdesk-38k', () => screen.findByRole('heading', { level: 1, name: 'beads-desktop V1 : suivi des tickets' })],
  ['l’avis d’une Epic absente', '/p/blanc/epics?epic=nope-1', () => screen.findByRole('status', { name: /^Aucune Epic/ })],
  ['le panneau d’un ticket', '/p/blanc/t/bdesk-38k.6', () => screen.findByRole('heading', { name: /Shell UI façon Linear/ })],
  ['l’avis d’un ticket absent', '/p/blanc/t/nope-1', () => screen.findByRole('status', { name: /^Aucun ticket/ })],
  ['les métriques du Projet', '/p/blanc/metrics', () => screen.findByRole('heading', { level: 2, name: 'Indicateurs' })],
  ['la Vue globale', '/', () => screen.findByRole('table', { name: 'Métriques de la période par projet' })],
  ['la porte d’un Projet illisible', '/p/vide/kanban', () => screen.findByText('Ce Projet est illisible')],
];

/** Les états d'un Projet qui n'a aucun ticket : les avis qu'on lui écrit quand il n'a rien à montrer (relecture finale : l'un d'eux, `Aucun ticket dans ce Projet`, n'était monté par aucun essai). */
const EMPTY_STATES: [string, string, () => Promise<unknown>][] = [
  ['le kanban d’un Projet sans ticket', '/p/blanc/kanban', () => screen.findByRole('status', { name: 'Aucun ticket dans ce Projet' })],
  ['la liste des Epics d’un Projet sans ticket', '/p/blanc/epics', () => screen.findByRole('status', { name: 'Aucune Epic dans ce Projet' })],
];

describe('l’application, avec des Projets dont le dossier n’a pas de nom', () => {
  it.each(STATES)('%s : « Sans titre » n’est écrit que seul', async (_state, path, ready) => {
    serve();
    renderApp(path);

    await ready();

    // Le repli est bien à l'écran (un libellé) : le test ne passe pas faute d'avoir un Projet sans nom à regarder.
    expect(screen.getAllByText(FALLBACK).length).toBeGreaterThan(0);
    expect(writtenAmongWords()).toEqual([]);
  });

  it.each(EMPTY_STATES)('%s : « Sans titre » n’est écrit que seul', async (_state, path, ready) => {
    serve({ blanc: [], ghost: bdeskIssues, bdesk: bdeskIssues });
    renderApp(path);

    await ready();

    expect(screen.getAllByText(FALLBACK).length).toBeGreaterThan(0);
    expect(writtenAmongWords()).toEqual([]);
  });

  it('la palette (les Projets, la portée, les commandes de navigation) : « Sans titre » n’est écrit que seul', async () => {
    serve();
    const { user } = renderApp('/p/blanc/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await within(dialog).findAllByRole('option', { name: /beads-desktop/ });

    expect(within(dialog).getAllByText(FALLBACK).length).toBeGreaterThan(0);
    expect(writtenAmongWords()).toEqual([]);
  });

  it('l’alerte de la palette, quand les tickets de ces Projets sont indisponibles : « Sans titre » n’y est pas', async () => {
    const lock = () => new Error('database is locked');
    serve({ blanc: lock(), ghost: lock(), bdesk: lock() });
    const { user } = renderApp('/');
    await screen.findByRole('navigation', { name: 'Navigation principale' });

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    const alert = await within(dialog).findByRole('alert');

    expect(alert.textContent).toBe('Tickets indisponibles : « beads-desktop », 2 Projets sans nom.');
    expect(writtenAmongWords()).toEqual([]);
  });
});

describe('la garde du rendu sait lire ce qu’elle garde', () => {
  const unnamed: Project = { id: 'blanc', name: FALLBACK, unnamed: true, path: '/dev/blanc', prefix: '', mode: 'embedded', status: 'ok' };
  const maybe = unnamed as Project | undefined;
  const projects: Project[] = [unnamed];
  const failed: Project[] = [unnamed];
  const ctx = { projectName: (id: string) => (id === 'blanc' ? unnamed.name : id) };
  const { name } = unnamed;
  const p = unnamed;
  // Un composant dont la phrase ne se lit pas dans le code qui l'appelle : le nom lui vient d'une propriété, sous un autre nom (ce que le balayage du code ne voit pas).
  const Phrase = ({ libelle }: { libelle: string }) => <p>Les tickets de {libelle}, en colonnes.</p>;

  // Les formes de la relecture de bdesk-38k.73, écrites comme du code : chacune rend le repli au milieu d'un texte.
  const REFUSED: [string, ReactElement][] = [
    ['du texte JSX à côté du nom', <p>Les tickets de {unnamed.name}, en colonnes.</p>],
    ['une alerte écrite en JSX', <p role="alert">Tickets indisponibles : {unnamed.name}.</p>],
    ['un gabarit', <p>{`Les tickets de ${unnamed.name}`}</p>],
    ['un nom suivi de `!`', <p>{`Les tickets de ${maybe!.name}`}</p>],
    ['un nom d’un objet converti par `as`', <p>{`Les tickets de ${(unnamed as Project).name}`}</p>],
    ['un nom déstructuré', <p>{`Les tickets de ${name}`}</p>],
    ['une variable courte, `p.name`', <p>{`Les tickets de ${p.name}`}</p>],
    ['un élément de liste, `projects[0].name`', <p>{`Dans ${projects[0]!.name}`}</p>],
    ['une concaténation', <p>{'Les tickets de ' + unnamed.name}</p>],
    ['`ctx.projectName(…)`', <p>{`Cycle Time de ${ctx.projectName('blanc')}`}</p>],
    ['une flèche à corps de bloc', <p>Tickets indisponibles : {failed.map((project) => { return project.name; }).join(', ')}.</p>],
    ['une flèche déstructurée', <p>Tickets indisponibles : {failed.map(({ name: titre }) => titre).join(', ')}.</p>],
    ['un attribut', <a href="/" title={`Ouvrir ${unnamed.name}`}>Projet</a>],
    ['un nom qui passe de composant en composant', <Phrase libelle={unnamed.name} />],
  ];

  const ACCEPTED: [string, ReactElement][] = [
    ['un nom seul dans son élément', <span>{unnamed.name}</span>],
    ['une ligne et son préfixe, en deux éléments', <a href="/"><span>{unnamed.name}</span><span>ghost</span></a>],
    ['un libellé et sa raison, en deux éléments', <ul><li><strong>{unnamed.name}</strong> : Base Dolt introuvable</li></ul>],
    ['un nom seul en attribut', <a href="/" title={unnamed.name}>x</a>],
    ['« ce Projet »', <p>Les tickets de ce Projet, en colonnes.</p>],
  ];

  it.each(REFUSED)('refuse %s', (_form, element) => {
    const { container } = render(element);

    expect(fallbackInSentences(container)).toHaveLength(1);
  });

  it.each(ACCEPTED)('accepte %s', (_form, element) => {
    const { container } = render(element);

    expect(fallbackInSentences(container)).toEqual([]);
  });

  it('lit le titre de l’onglet par parties : le repli seul dans une partie passe, au milieu d’un texte non', () => {
    expect(fallbackInTitle('Kanban · Sans titre · beads-desktop')).toEqual([]);
    expect(fallbackInTitle('Les tickets de Sans titre · beads-desktop')).toHaveLength(1);
  });

  // La limite, écrite : le texte propre du `<strong>` est le repli seul. C'est le balayage du code qui lit cette forme (`data/projectSentences.test.ts`).
  it('ne voit pas un nom en gras au milieu d’une phrase : il le laisse au balayage du code', () => {
    const { container } = render(<p>Les tickets de <strong>{unnamed.name}</strong>, en colonnes.</p>);

    expect(fallbackInSentences(container)).toEqual([]);
  });
});
