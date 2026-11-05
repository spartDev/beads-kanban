import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import type { Issue } from '../data/types';
import { shownText, spokenText } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, issueDetail, projectsResponse } from '../test/fixtures';
import { httpFailure, renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const DAY = 86_400_000;
const NBSP = ' ';
/** Jeudi 5 novembre 2026, midi à Paris (UTC+1 depuis le 25 octobre). */
const NOW = '2026-11-05T11:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

/** Fige l'heure (seule `Date`) et le fuseau du navigateur : la prévision, les âges et les dates en dépendent. */
function freezeClock() {
  withTimeZone('Europe/Paris');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  });
  afterEach(() => {
    vi.useRealTimers();
  });
}

const EPIC = issue({ id: 'bdesk-e1', title: 'Shell UI : thèmes, navigation et raccourcis', type: 'epic', priority: 1, createdAt: ago(100) });
const child = (id: string, title: string, overrides: Partial<Issue> = {}) => issue({ id, title, parentId: 'bdesk-e1', ...overrides });
const closedChild = (id: string, title: string, days: number, overrides: Partial<Issue> = {}) =>
  child(id, title, { status: 'closed', closedAt: ago(days), updatedAt: ago(days), ...overrides });

const stub = (issues: Issue[]) => stubApi({ projects: projectsResponse, issues: { bdesk: issues } });

async function openEpic(issues: Issue[], path = '/p/bdesk/epics?epic=bdesk-e1') {
  stub(issues);
  const app = renderApp(path);
  // Le titre de la silhouette est vide : on attend celui de la page.
  await screen.findByRole('heading', { level: 1, name: /\S/ });
  return app;
}

const section = (name: string | RegExp) => screen.getByRole('region', { name });
const titlesIn = (region: HTMLElement) => within(region).getAllByRole('link').map((link) => link.textContent);

describe('la page Epic : l’avancement', () => {
  freezeClock();

  it('a pour titre celui de l’Epic, et le nomme dans l’onglet', async () => {
    await openEpic([EPIC, child('bdesk-a', 'Palette')]);

    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Shell UI : thèmes, navigation et raccourcis');
    await waitFor(() => expect(document.title).toBe('Shell UI : thèmes, navigation et raccourcis · beads-desktop · beads-desktop'));
  });

  it('compte les Livraisons parmi les Enfants, en nombre, avec la barre qui les dit', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré 1', 3),
      closedChild('bdesk-b', 'Livré 2', 4),
      child('bdesk-c', 'En cours', { status: 'in_progress' }),
      child('bdesk-d', 'Prêt'),
      child('bdesk-f', 'Reporté', { status: 'deferred' }),
    ]);

    const progress = section('Avancement');

    expect(within(progress).getByText(/2 Livraisons sur 5 Enfants/)).toBeTruthy();
    expect(within(progress).getByText(/40\s%/)).toBeTruthy();
    const bar = within(progress).getByRole('progressbar', { name: 'Avancement de l’Epic' });
    expect(bar.getAttribute('aria-valuenow')).toBe('2');
    expect(bar.getAttribute('aria-valuemax')).toBe('5');
    expect(bar.getAttribute('aria-valuetext')).toBe('2 Livraisons sur 5 Enfants');
    expect(bar.firstElementChild?.getAttribute('style')).toContain('width: 40%');
  });

  it('accorde le singulier : 1 Livraison sur 1 Enfant', async () => {
    await openEpic([EPIC, closedChild('bdesk-a', 'Seul Enfant', 2)]);

    expect(within(section('Avancement')).getByText(/1 Livraison sur 1 Enfant\b/)).toBeTruthy();
    expect(within(section('Avancement')).getByText(/100\s%/)).toBeTruthy();
  });

  it('ne compte pas un Abandon comme une Livraison, ni parmi les Enfants à livrer, et le dit', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré', 3),
      closedChild('bdesk-b', 'Doublon du livré', 4, { abandon: { cause: 'duplicate', of: 'bdesk-a' } }),
      child('bdesk-c', 'À faire'),
    ]);

    const progress = section('Avancement');

    expect(within(progress).getByText(/1 Livraison sur 2 Enfants/)).toBeTruthy();
    expect(within(progress).getByText(/Abandon \(doublon ou remplacé\)/).textContent).toBe(
      '1 Abandon (doublon ou remplacé) n’est compté ni parmi les Livraisons ni parmi les Enfants à livrer.',
    );
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuemax')).toBe('2');
  });

  it('atteint 100 % quand il ne reste rien à livrer, des Abandons ne l’en empêchent pas', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré', 3),
      closedChild('bdesk-b', 'Remplacé', 4, { abandon: { cause: 'superseded', of: 'bdesk-a' } }),
    ]);

    expect(within(section('Avancement')).getByText(/1 Livraison sur 1 Enfant\b/)).toBeTruthy();
    expect(within(section('Avancement')).getByText(/100\s%/)).toBeTruthy();
  });

  it('compte les Enfants indirects, et laisse à part les Epics imbriquées : elles ne sont pas une Livraison', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré direct', 3),
      child('bdesk-sub', 'Sous-Epic', { type: 'epic' }),
      issue({ id: 'bdesk-s1', title: 'Enfant de la sous-Epic', parentId: 'bdesk-sub', status: 'closed', closedAt: ago(2) }),
      issue({ id: 'bdesk-s2', title: 'Autre enfant de la sous-Epic', parentId: 'bdesk-sub' }),
      issue({ id: 'bdesk-petit', title: 'Petit-enfant', parentId: 'bdesk-s2' }),
      issue({ id: 'bdesk-ailleurs', title: 'Sans rapport' }),
    ]);

    expect(within(section('Avancement')).getByText(/2 Livraisons sur 4 Enfants/)).toBeTruthy();
    const nested = section(/Epics imbriquées/);
    expect(within(nested).getByRole('link', { name: /Sous-Epic/ }).getAttribute('href')).toBe('/p/bdesk/epics?epic=bdesk-sub');
    expect(screen.queryByText('Sans rapport')).toBeNull();
  });

  it('dit qu’il n’y a pas d’Enfant plutôt que d’afficher 0 %', async () => {
    await openEpic([EPIC]);

    expect(screen.queryByRole('progressbar')).toBeNull();
    expect(within(section('Avancement')).getByText(/Aucun Enfant/)).toBeTruthy();
  });

  it('répartit les Enfants par colonne dans un résumé, Abandons dans Terminé, sans compter les colonnes vides', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré', 3),
      closedChild('bdesk-b', 'Doublon', 4, { abandon: { cause: 'duplicate', of: 'bdesk-a' } }),
      child('bdesk-c', 'En cours', { status: 'in_progress' }),
      child('bdesk-d', 'Prêt'),
      child('bdesk-f', 'Reporté', { status: 'deferred' }),
    ]);

    const summary = within(section('Avancement')).getByRole('list', { name: 'Enfants par colonne' });

    expect(within(summary).getAllByRole('listitem').map((item) => item.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      'Prêt 1',
      'En cours 1',
      'Terminé 2 dont 1 Abandon',
      'En pause 1',
    ]);
  });

  it('dit combien de Terminé sont des Abandons, comme la section des Enfants : au pluriel, et pas du tout sans Abandon', async () => {
    const { unmount } = await openEpic([
      EPIC,
      closedChild('bdesk-a', 'Livré', 3),
      closedChild('bdesk-b', 'Doublon', 4, { abandon: { cause: 'duplicate', of: 'bdesk-a' } }),
      closedChild('bdesk-c', 'Remplacé', 5, { abandon: { cause: 'superseded', of: 'bdesk-a' } }),
    ]);
    const pills = () =>
      within(within(section('Avancement')).getByRole('list', { name: 'Enfants par colonne' }))
        .getAllByRole('listitem')
        .map((item) => item.textContent?.replace(/\s+/g, ' ').trim());

    expect(pills()).toEqual(['Terminé 3 dont 2 Abandons']);
    expect(within(section('Terminé')).getByText(/dont 2 Abandons/)).toBeTruthy();
    unmount();

    await openEpic([EPIC, closedChild('bdesk-a', 'Livré', 3), child('bdesk-c', 'À faire')]);

    expect(pills()).toEqual(['Prêt 1', 'Terminé 1']);
  });
});

describe('la page Epic : les Enfants par colonne', () => {
  freezeClock();

  const PROJECT: Issue[] = [
    EPIC,
    child('bdesk-b', 'Attend le prêt', { blockedBy: ['bdesk-r'] }),
    child('bdesk-r', 'Prêt P2', { priority: 2 }),
    child('bdesk-r0', 'Prêt P0', { priority: 0 }),
    child('bdesk-p', 'En cours', { status: 'in_progress' }),
    child('bdesk-h', 'Rattaché à un agent', { status: 'hooked' }),
    child('bdesk-x', 'Coincé', { status: 'in_progress', blockedBy: ['bdesk-r'] }),
    child('bdesk-sb', 'Marqué bloqué', { status: 'blocked' }),
    closedChild('bdesk-d1', 'Fermé hier', 1),
    closedChild('bdesk-d2', 'Fermé il y a quarante jours', 40),
    closedChild('bdesk-d3', 'Doublon', 2, { abandon: { cause: 'duplicate', of: 'bdesk-d1' } }),
    child('bdesk-g', 'Reporté', { status: 'deferred' }),
    child('bdesk-g2', 'Épinglé', { status: 'pinned' }),
  ];

  it('range chaque Enfant dans la colonne que lui donne la règle du kanban, et dans l’ordre du flux', async () => {
    await openEpic(PROJECT);

    const groups = screen.getAllByRole('region').filter((region) => region.hasAttribute('data-epic-group'));

    expect(groups.map((group) => group.getAttribute('data-epic-group'))).toEqual(['backlog', 'ready', 'inProgress', 'blocked', 'done', 'paused']);
    const titles = (name: string) => titlesIn(section(name)).map((text) => (text ?? '').replace(/\s+/g, ' '));
    const has = (name: string, expected: string[]) => expected.forEach((title, index) => expect(titles(name)[index], `${name} / ${title}`).toContain(title));

    expect(titles('Backlog')).toHaveLength(1);
    has('Backlog', ['Attend le prêt']);
    expect(titles('Prêt')).toHaveLength(2);
    expect(titles('En cours')).toHaveLength(2);
    expect(titles('Bloqué')).toHaveLength(2);
    expect(titles('En pause')).toHaveLength(2);
    expect(titles('Terminé')).toHaveLength(3);
  });

  it('range une colonne par priorité (P0 d’abord) puis par mise à jour, comme le tableau', async () => {
    await openEpic(PROJECT);

    const ready = within(section('Prêt')).getAllByRole('link');

    expect(ready.map((link) => link.textContent)).toEqual([expect.stringContaining('Prêt P0'), expect.stringContaining('Prêt P2')]);
  });

  it('garde dans Terminé tous les Enfants fermés, sans la fenêtre de jours du tableau, du plus récent au plus ancien', async () => {
    await openEpic(PROJECT);

    const done = within(section('Terminé')).getAllByRole('link');

    expect(done.map((link) => link.textContent)).toEqual([
      expect.stringContaining('Fermé hier'),
      expect.stringContaining('Doublon'),
      expect.stringContaining('Fermé il y a quarante jours'),
    ]);
  });

  it('range Terminé par clôture, la plus récente d’abord, quelles que soient la priorité et la mise à jour : un journal des Livraisons', async () => {
    await openEpic([
      EPIC,
      closedChild('bdesk-p0', 'Critique fermé il y a dix jours', 10, { priority: 0, updatedAt: ago(0.1) }),
      closedChild('bdesk-p2', 'Moyen fermé hier', 1, { priority: 2, updatedAt: ago(20) }),
      closedChild('bdesk-p4', 'Minimal fermé il y a cinq jours', 5, { priority: 4, updatedAt: ago(0.2) }),
    ]);

    expect(within(section('Terminé')).getAllByRole('link').map((link) => link.textContent)).toEqual([
      expect.stringContaining('Moyen fermé hier'),
      expect.stringContaining('Minimal fermé il y a cinq jours'),
      expect.stringContaining('Critique fermé il y a dix jours'),
    ]);
  });

  it('marque l’Abandon d’une pastille, et dit combien Terminé en compte', async () => {
    await openEpic(PROJECT);

    const done = section('Terminé');

    expect(within(done).getAllByText('Abandon')).toHaveLength(1);
    const abandoned = within(done).getByRole('link', { name: /Doublon/ });
    expect(within(abandoned).getByText('Abandon').getAttribute('title')).toBe('Abandon : doublon de bdesk-d1');
    expect(within(done).getByText(/dont 1 Abandon/)).toBeTruthy();
    expect(within(section('Prêt')).queryByText('Abandon')).toBeNull();
  });

  it('aligne les titres : l’identifiant de chaque ligne a la largeur du plus long, d’une colonne à l’autre', async () => {
    await openEpic(PROJECT);

    const widths = screen
      .getAllByRole('region')
      .filter((region) => region.hasAttribute('data-epic-group'))
      .flatMap((region) => within(region).getAllByRole('link'))
      .map((link) => (link.querySelector('.font-mono') as HTMLElement).style.minWidth);

    // `bdesk-r0`, `bdesk-d1`… : huit caractères ; `bdesk-b`, `bdesk-r`… n'en ont que sept et prennent la largeur des autres.
    expect(new Set(widths)).toEqual(new Set(['8ch']));
    expect(widths.length).toBeGreaterThan(10);
  });

  it('ouvre le ticket d’un Enfant dans son panneau', async () => {
    const { user, router } = await openEpic(PROJECT);

    await user.click(within(section('En cours')).getByRole('link', { name: /Rattaché à un agent/ }));

    await waitFor(() => expect(router.state.location.pathname).toBe('/p/bdesk/t/bdesk-h'));
  });

  it('dit ce qui retient un Enfant bloqué', async () => {
    await openEpic(PROJECT);

    expect(within(section('Bloqué')).getByText(/Attend bdesk-r/)).toBeTruthy();
    expect(within(section('Bloqué')).getByText(/Statut bloqué/, { selector: 'span' })).toBeTruthy();
  });
});

describe('la page Epic : l’arborescence', () => {
  freezeClock();

  const TREE: Issue[] = [
    EPIC,
    child('bdesk-f1', 'Grosse fonctionnalité', { type: 'feature', createdAt: ago(50) }),
    issue({ id: 'bdesk-f1.1', title: 'Sous-tâche', parentId: 'bdesk-f1', createdAt: ago(40), status: 'in_progress' }),
    issue({ id: 'bdesk-f1.1.a', title: 'Détail de la sous-tâche', parentId: 'bdesk-f1.1', createdAt: ago(30) }),
    child('bdesk-sub', 'Sous-Epic', { type: 'epic', createdAt: ago(20) }),
    issue({ id: 'bdesk-s1', title: 'Tâche de la sous-Epic', parentId: 'bdesk-sub', status: 'closed', closedAt: ago(1), createdAt: ago(10) }),
    child('bdesk-f2', 'Seconde', { createdAt: ago(5) }),
  ];

  it('est affichée à la demande, dans l’adresse, et la page par colonne reste la page de départ', async () => {
    const { user, router } = await openEpic(TREE);
    expect(screen.queryByRole('tree')).toBeNull();
    expect(screen.queryByRole('list', { name: 'Arborescence' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Arbre' }));

    expect(router.state.location.search).toBe('?epic=bdesk-e1&view=tree');
    expect(screen.getByRole('list', { name: 'Arborescence' })).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Arbre' }).getAttribute('aria-pressed')).toBe('true');
    expect(screen.getByRole('button', { name: 'Par colonne' }).getAttribute('aria-pressed')).toBe('false');
    expect(screen.queryByRole('region', { name: 'Prêt' })).toBeNull();

    await user.click(screen.getByRole('button', { name: 'Par colonne' }));

    expect(router.state.location.search).toBe('?epic=bdesk-e1');
    expect(screen.queryByRole('list', { name: 'Arborescence' })).toBeNull();
  });

  it('s’ouvre directement sur l’adresse partagée', async () => {
    await openEpic(TREE, '/p/bdesk/epics?epic=bdesk-e1&view=tree');

    expect(screen.getByRole('list', { name: 'Arborescence' })).toBeTruthy();
  });

  it('range chaque ticket sous son parent, à tous les niveaux, dans l’ordre de création', async () => {
    await openEpic(TREE, '/p/bdesk/epics?epic=bdesk-e1&view=tree');

    const root = screen.getByRole('list', { name: 'Arborescence' });
    const depthOf = (title: string) => {
      let depth = 0;
      for (let list = within(root).getByText(title).closest('ul'); list && list !== root; list = list.parentElement?.closest('ul') ?? null) depth++;
      return depth;
    };

    expect(within(root).getAllByRole('listitem').map((item) => within(item).getAllByRole('link')[0]?.textContent?.replace(/\s+/g, ' ').trim())).toEqual([
      expect.stringContaining('Grosse fonctionnalité'),
      expect.stringContaining('Sous-tâche'),
      expect.stringContaining('Détail de la sous-tâche'),
      expect.stringContaining('Sous-Epic'),
      expect.stringContaining('Tâche de la sous-Epic'),
      expect.stringContaining('Seconde'),
    ]);
    expect([depthOf('Grosse fonctionnalité'), depthOf('Sous-tâche'), depthOf('Détail de la sous-tâche'), depthOf('Seconde')]).toEqual([0, 1, 2, 0]);
    expect([depthOf('Sous-Epic'), depthOf('Tâche de la sous-Epic')]).toEqual([0, 1]);
  });

  it('dit la colonne de chaque ticket, Terminé compris', async () => {
    await openEpic(TREE, '/p/bdesk/epics?epic=bdesk-e1&view=tree');

    const row = (title: string) => within(screen.getByRole('list', { name: 'Arborescence' })).getByText(title).closest('a');

    expect(row('Sous-tâche')?.textContent).toContain('En cours');
    expect(row('Seconde')?.textContent).toContain('Prêt');
    expect(row('Tâche de la sous-Epic')?.textContent).toContain('Terminé');
  });

  it('ouvre une Epic imbriquée sur sa propre page, avec son avancement, et un ticket sur son panneau', async () => {
    await openEpic(TREE, '/p/bdesk/epics?epic=bdesk-e1&view=tree');
    const root = screen.getByRole('list', { name: 'Arborescence' });

    const sub = within(root).getByText('Sous-Epic').closest('a');
    expect(sub?.getAttribute('href')).toBe('/p/bdesk/epics?epic=bdesk-sub');
    expect(sub?.textContent).toContain('1 sur 1');
    expect(within(root).getByText('Seconde').closest('a')?.getAttribute('href')).toBe('/p/bdesk/t/bdesk-f2');
  });

  it('marque l’Abandon d’une pastille, comme les colonnes', async () => {
    await openEpic([EPIC, closedChild('bdesk-d', 'Doublon', 2, { abandon: { cause: 'superseded', of: 'bdesk-n' } })], '/p/bdesk/epics?epic=bdesk-e1&view=tree');

    expect(within(screen.getByRole('list', { name: 'Arborescence' })).getByText('Abandon').getAttribute('title')).toBe('Abandon : remplacé par bdesk-n');
  });
});

describe('la page Epic : le Lead Time', () => {
  freezeClock();

  it('est celui de l’Epic fermée : de sa création à sa dernière clôture, en Durée écoulée', async () => {
    const closed = issue({
      id: 'bdesk-e1',
      title: 'Epic finie',
      type: 'epic',
      status: 'closed',
      createdAt: '2026-10-01T09:00:00.000Z',
      closedAt: '2026-10-04T13:00:00.000Z',
    });
    await openEpic([closed, closedChild('bdesk-a', 'Livré', 3)]);

    const leadTime = within(section('Lead Time et prévision')).getByText('Lead Time').closest('div');

    expect(leadTime?.textContent).toContain(`3,2${NBSP}j`);
    expect(leadTime?.textContent).toMatch(/créée le 1 oct\. 2026, 11:00/);
    expect(leadTime?.textContent).toMatch(/fermée le 4 oct\. 2026, 15:00/);
  });

  it('n’est pas défini tant que l’Epic est ouverte : on dit depuis quand elle l’est', async () => {
    await openEpic([{ ...EPIC, createdAt: ago(16) }, child('bdesk-a', 'Ouvert')]);

    const leadTime = within(section('Lead Time et prévision')).getByText('Lead Time').closest('div');

    expect(leadTime?.textContent).toContain('—');
    expect(leadTime?.textContent).toMatch(/pas encore fermée/);
    expect(leadTime?.textContent).toContain(`ouverte depuis 16${NBSP}j`);
  });

  it('dit qu’il manque la date de clôture d’une Epic fermée sans date', async () => {
    await openEpic([{ ...EPIC, status: 'closed', closedAt: null }, child('bdesk-a', 'Ouvert')]);

    expect(within(section('Lead Time et prévision')).getByText(/sans date de clôture/)).toBeTruthy();
  });
});

describe('la page Epic : la prévision de fin', () => {
  freezeClock();

  /** `shipped` Livraisons réparties sur les 26 derniers jours, `left` Enfants ouverts. */
  const withThroughput = (shipped: number, left: number, epic: Issue = EPIC): Issue[] => [
    epic,
    ...Array.from({ length: shipped }, (_, i) => closedChild(`bdesk-l${i}`, `Livré ${i}`, 1 + (i * 25) / Math.max(1, shipped - 1))),
    ...Array.from({ length: left }, (_, i) => child(`bdesk-o${i}`, `Ouvert ${i}`)),
  ];
  const forecast = () => within(section('Lead Time et prévision')).getByText('Prévision de fin').closest('div') as HTMLElement;

  it('est masquée sans assez de Débit, et dit combien de Livraisons il y a et combien il en faut', async () => {
    await openEpic(withThroughput(3, 5));

    expect(forecast().textContent).toContain('Masquée');
    expect(forecast().textContent).toContain('Pas assez de Débit : 3 Livraisons sur les 28 derniers jours, il en faut au moins 4.');
    expect(forecast().textContent).not.toMatch(/semaines|jours\b.*entre le/);
  });

  it('est affichée avec assez de Débit : une fourchette en semaines, les jours où elle tombe, et le rythme sur lequel elle repose', async () => {
    await openEpic(withThroughput(8, 6));

    expect(forecast().textContent).toContain(`2 à 5${NBSP}semaines`);
    expect(forecast().textContent).toContain('entre le 21 nov. et le 7 déc. 2026');
    expect(forecast().textContent).toContain('8 Livraisons en 28 jours');
    expect(forecast().textContent).toContain('6 Enfants restants');
  });

  it('se dit en toutes lettres aux lecteurs d’écran', async () => {
    await openEpic(withThroughput(8, 6));

    expect(within(forecast()).getByText('entre 2 et 5 semaines').className).toContain('sr-only');
  });

  // 4 Livraisons en 28 jours, 150 Enfants restants : de 700 à 2 100 jours. « Plus d'un an » ne prétend à rien de précis, des jours si.
  it('n’écrit aucun jour quand la case dit « plus d’un an » : rien de plus précis que la fourchette', async () => {
    await openEpic(withThroughput(4, 150));

    expect(forecast().textContent).toContain('plus d’un an');
    expect(forecast().textContent).not.toMatch(/Fin estimée|entre le|\b20\d\d\b/);
    expect(forecast().textContent).toContain('4 Livraisons en 28 jours');
    expect(forecast().textContent).toContain('150 Enfants restants');
  });

  // 4 Livraisons en 28 jours, 60 Enfants restants : de 280 à 840 jours, soit de 9 à 28 mois.
  it('écrit les jours tant que la case ne dit pas « plus d’un an », même si sa fin la plus lointaine le dépasse', async () => {
    await openEpic(withThroughput(4, 60));

    expect(forecast().textContent).toContain(`9 à 28${NBSP}mois`);
    expect(forecast().textContent).not.toContain('plus d’un an');
    expect(forecast().textContent).toMatch(/Fin estimée entre le \d+ \S+ 2027 et le \d+ \S+ 2029/);
  });

  it('explique sa méthode, qu’elle soit affichée ou masquée', async () => {
    const { unmount } = await openEpic(withThroughput(8, 6));
    const method = () => within(section('Lead Time et prévision')).getByText(/^Méthode/).closest('p')?.textContent ?? '';

    for (const expected of [
      'Débit récent',
      '28 derniers jours',
      'depuis sa création',
      'jamais sur moins de 7 jours',
      'remonte donc avant sa création',
      'racine',
      'aucun Enfant n’est ajouté',
      'pas un engagement',
      '4 Livraisons',
    ]) {
      expect(method(), expected).toContain(expected);
    }
    unmount();

    await openEpic(withThroughput(1, 5));
    expect(method()).toContain('pas un engagement');
  });

  it('est mesurée depuis la création d’une Epic récente : 12 Livraisons en 14 jours', async () => {
    await openEpic([
      { ...EPIC, createdAt: ago(14) },
      ...Array.from({ length: 12 }, (_, i) => closedChild(`bdesk-l${i}`, `Livré ${i}`, 0.5 + i)),
      ...Array.from({ length: 6 }, (_, i) => child(`bdesk-o${i}`, `Ouvert ${i}`)),
    ]);

    expect(forecast().textContent).toContain('12 Livraisons en 14 jours');
  });

  describe('pour une Epic de moins de 7 jours', () => {
    /** `delivered` Livraisons de ces derniers jours (la plus récente d'il y a 12 h), `left` Enfants ouverts. */
    const lately = (epic: Issue, delivered: number, left: number): Issue[] => [
      epic,
      ...Array.from({ length: delivered }, (_, i) => closedChild(`bdesk-l${i}`, `Livré ${i}`, 0.5 + i)),
      ...Array.from({ length: left }, (_, i) => child(`bdesk-o${i}`, `Ouvert ${i}`)),
    ];

    // La fenêtre du Débit ne descend pas sous 7 jours : elle remonte avant la création de l'Epic, dont des Enfants peuvent avoir été livrés avant.
    // « 3 Livraisons sur les 7 derniers jours » sur une Epic de 13 h surprend : la phrase dit pourquoi.
    it('dit, quand elle est masquée, que la mesure remonte avant sa création : « 3 Livraisons sur les 7 derniers jours » ne surprend pas', async () => {
      await openEpic(lately({ ...EPIC, createdAt: ago(13 / 24) }, 3, 5));

      expect(shownText(forecast())).toContain(
        `Pas assez de Débit : 3 Livraisons sur les 7 derniers jours (l’Epic n’a que 13${NBSP}h : la mesure remonte avant sa création), il en faut au moins 4.`,
      );
      expect(spokenText(forecast())).toContain('l’Epic n’a que 13 heures : la mesure remonte avant sa création');
    });

    it('le dit aussi quand elle est affichée : le rythme est celui des 7 jours, pas celui de la vie de l’Epic', async () => {
      await openEpic(lately({ ...EPIC, createdAt: ago(1.5) }, 5, 7));

      expect(shownText(forecast())).toContain(
        `Au rythme de 5 Livraisons en 7 jours (l’Epic n’a que 1,5${NBSP}j : la mesure remonte avant sa création), pour 7 Enfants restants.`,
      );
      expect(spokenText(forecast())).toContain('l’Epic n’a que 1,5 jour : la mesure remonte avant sa création');
    });

    it('ne dit rien de tel quand la fenêtre ne dépasse pas la vie de l’Epic : à 10 jours, elle commence à sa création', async () => {
      await openEpic(lately({ ...EPIC, createdAt: ago(10) }, 3, 5));

      expect(forecast().textContent).toContain('Pas assez de Débit : 3 Livraisons sur les 10 derniers jours, il en faut au moins 4.');
      expect(forecast().textContent).not.toContain('remonte avant');
    });
  });

  it('est masquée pour une Epic fermée', async () => {
    await openEpic(withThroughput(8, 6, { ...EPIC, status: 'closed', closedAt: ago(1) }));

    expect(forecast().textContent).toContain('Epic fermée : il n’y a plus de fin à prévoir.');
  });

  it('est masquée quand tout est livré, et le dit', async () => {
    await openEpic(withThroughput(8, 0));

    expect(forecast().textContent).toContain('Tous les Enfants sont livrés ou abandonnés : l’Epic peut être fermée.');
  });

  it('est masquée pour une Epic sans Enfant', async () => {
    await openEpic([EPIC]);

    expect(forecast().textContent).toContain('Aucun Enfant à livrer.');
  });

  it('ne compte pas un Abandon dans le Débit', async () => {
    const issues = withThroughput(3, 5);
    issues.push(closedChild('bdesk-ab', 'Doublon', 2, { abandon: { cause: 'duplicate', of: 'bdesk-l0' } }));
    await openEpic(issues);

    expect(forecast().textContent).toContain('Pas assez de Débit : 3 Livraisons');
  });
});

describe('la page Epic : y arriver et en repartir', () => {
  freezeClock();

  const PROJECT: Issue[] = [
    EPIC,
    child('bdesk-a', 'Palette', { status: 'in_progress' }),
    issue({ id: 'bdesk-sous', title: 'Sous-ticket de la palette', parentId: 'bdesk-a' }),
    issue({ id: 'bdesk-z', title: 'Hors Epic' }),
  ];

  it('s’ouvre depuis la pastille Epic d’une carte du kanban', async () => {
    stub(PROJECT);
    const { user, router } = renderApp('/p/bdesk/kanban');
    const card = (await screen.findByRole('link', { name: 'Palette' })).closest('li') as HTMLElement;

    await user.click(within(card).getByRole('link', { name: /Epic : Shell UI/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Shell UI : thèmes, navigation et raccourcis' })).toBeTruthy();
    expect(router.state.location.pathname + router.state.location.search).toBe('/p/bdesk/epics?epic=bdesk-e1');
  });

  it('s’ouvre aussi depuis la pastille d’un sous-ticket, qui garde l’Epic de son parent', async () => {
    stub(PROJECT);
    const { user, router } = renderApp('/p/bdesk/kanban');
    const card = (await screen.findByRole('link', { name: 'Sous-ticket de la palette' })).closest('li') as HTMLElement;

    await user.click(within(card).getByRole('link', { name: /Epic : Shell UI/ }));

    await waitFor(() => expect(router.state.location.search).toBe('?epic=bdesk-e1'));
  });

  it('s’ouvre depuis le panneau de l’Epic : un lien « Page Epic »', async () => {
    stub(PROJECT);
    const { user, router } = renderApp('/p/bdesk/t/bdesk-e1');
    const dialog = await screen.findByRole('dialog', { name: /Shell UI/ });

    await user.click(within(dialog).getByRole('link', { name: 'Page Epic : Shell UI' }));

    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI/ })).toBeTruthy();
    expect(router.state.location.pathname + router.state.location.search).toBe('/p/bdesk/epics?epic=bdesk-e1');
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('s’ouvre depuis le panneau d’un Enfant de l’Epic', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/t/bdesk-a');
    const dialog = await screen.findByRole('dialog', { name: /Palette/ });

    expect(within(dialog).getByRole('link', { name: 'Page Epic : Shell UI' }).getAttribute('href')).toBe('/p/bdesk/epics?epic=bdesk-e1');
  });

  it('n’est pas proposée dans le panneau d’un ticket qui n’est dans aucune Epic', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/t/bdesk-z');
    const dialog = await screen.findByRole('dialog', { name: /Hors Epic/ });

    expect(within(dialog).queryByRole('link', { name: /^Page Epic/ })).toBeNull();
  });

  it('ramène à la liste des Epics par un lien en tête de page', async () => {
    stub(PROJECT);
    const { user, router } = renderApp('/p/bdesk/epics?epic=bdesk-e1');
    await screen.findByRole('heading', { level: 1, name: /Shell UI/ });

    const header = screen.getByRole('heading', { level: 1, name: /Shell UI/ }).closest('header') as HTMLElement;
    await user.click(within(header).getByRole('link', { name: 'Epics' }));

    expect(router.state.location.pathname + router.state.location.search).toBe('/p/bdesk/epics');
    expect(await screen.findByRole('heading', { level: 1, name: 'Epics' })).toBeTruthy();
  });

  it('propose le ticket de l’Epic et son kanban', async () => {
    await openEpic(PROJECT);

    expect(screen.getByRole('link', { name: 'Ouvrir le ticket' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-e1');
    expect(screen.getByRole('link', { name: 'Voir au kanban' }).getAttribute('href')).toBe('/p/bdesk/kanban?epic=bdesk-e1');
  });

  it('revient à la page Epic en fermant le panneau d’un Enfant ouvert depuis elle', async () => {
    const { user, router } = await openEpic(PROJECT);

    await user.click(within(section('En cours')).getByRole('link', { name: /Palette/ }));
    const dialog = await screen.findByRole('dialog', { name: /Palette/ });
    await user.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(router.state.location.pathname + router.state.location.search).toBe('/p/bdesk/epics?epic=bdesk-e1'));
    expect(screen.getByRole('heading', { level: 1, name: /Shell UI/ })).toBeTruthy();
  });
});

/**
 * Le lien « Page Epic » du panneau, à tous les niveaux (bdesk-38k.29). Un petit-enfant est un Enfant de l’Epic au sens du glossaire, comme
 * l’Enfant direct : son panneau propose la page de l’Epic la plus proche au-dessus de lui, celle que sa pastille mène à sur le kanban, et la
 * nomme (« Page Epic : <titre court> », comme la pastille « Epic : … »). C’est la fiche qui la nomme (`epic`, calculée par le serveur avec la règle
 * du domaine, `epicOf`) : le lien vient avec le titre, sans autre lecture. Une Epic imbriquée garde son propre lien ; un ticket hors de toute
 * Epic n’en a pas.
 */
describe('le panneau d’un ticket : le lien « Page Epic » à tous les niveaux', () => {
  freezeClock();

  //   bdesk-e1 (Epic)                                  bdesk-x     un chantier hors de toute Epic
  //   ├─ bdesk-a          Enfant direct                └─ bdesk-y
  //   │  └─ bdesk-sous    petit-enfant                    └─ bdesk-w
  //   │     └─ bdesk-detail   arrière-petit-enfant
  //   └─ bdesk-sub (Epic imbriquée)
  //      └─ bdesk-s1
  //         └─ bdesk-s2
  const PROJECT: Issue[] = [
    EPIC,
    child('bdesk-a', 'Palette', { status: 'in_progress' }),
    issue({ id: 'bdesk-sous', title: 'Sous-ticket de la palette', parentId: 'bdesk-a' }),
    issue({ id: 'bdesk-detail', title: 'Détail du sous-ticket', parentId: 'bdesk-sous' }),
    child('bdesk-sub', 'Sous-Epic', { type: 'epic' }),
    issue({ id: 'bdesk-s1', title: 'Enfant de la sous-Epic', parentId: 'bdesk-sub' }),
    issue({ id: 'bdesk-s2', title: 'Petit-enfant de la sous-Epic', parentId: 'bdesk-s1' }),
    issue({ id: 'bdesk-x', title: 'Chantier hors Epic' }),
    issue({ id: 'bdesk-y', title: 'Sous-chantier hors Epic', parentId: 'bdesk-x' }),
    issue({ id: 'bdesk-w', title: 'Détail du sous-chantier hors Epic', parentId: 'bdesk-y' }),
  ];

  const titleOf = (id: string) => {
    const found = PROJECT.find((candidate) => candidate.id === id);
    if (!found) throw new Error(`Pas de ticket ${id} dans le Projet du test.`);
    return found.title;
  };

  /** Le nom du panneau d’un ticket une fois sa fiche arrivée : l’identifiant, puis le titre. */
  const panelName = (id: string) => `${id} ${titleOf(id)}`;

  /** Où mène le lien « Page Epic » du panneau (celui qui porte ce nom, par défaut n’importe lequel), ou `null` quand le panneau n’en a pas. */
  const pageEpic = (dialog: HTMLElement, name: string | RegExp = /^Page Epic/) => within(dialog).queryByRole('link', { name })?.getAttribute('href') ?? null;

  /** Le panneau d’un ticket ouvert par son adresse, dès que sa fiche est là (le titre) : le lien, s’il y en a un, vient avec elle. */
  async function openPanelOf(id: string) {
    stub(PROJECT);
    const app = renderApp(`/p/bdesk/t/${id}`);
    const dialog = await screen.findByRole('dialog', { name: panelName(id) });
    return { ...app, dialog };
  }

  /** La liste des tickets du Projet tarde : sa réponse, et elle seule (ni les fiches, ni les chronologies), attend `release()`. */
  function holdList(fetchMock: ReturnType<typeof stubApi>) {
    const healthy = fetchMock.getMockImplementation();
    if (!healthy) throw new Error('holdList attend le mock renvoyé par stubApi.');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (/\/issues$/.test(String(input))) await gate;
      return healthy(input);
    });
    return release;
  }

  it('est proposé dans le panneau d’un petit-enfant de l’Epic, et mène à elle', async () => {
    const { dialog } = await openPanelOf('bdesk-sous');

    expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-e1');
  });

  it('l’est aussi à trois niveaux sous l’Epic', async () => {
    const { dialog } = await openPanelOf('bdesk-detail');

    expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-e1');
  });

  it('mène à une page qui compte ce petit-enfant parmi les Enfants de l’Epic, comme le filtre Epic du kanban', async () => {
    const { user, dialog } = await openPanelOf('bdesk-detail');

    await user.click(within(dialog).getByRole('link', { name: /^Page Epic/ }));

    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI/ })).toBeTruthy();
    expect(within(section('Prêt')).getByRole('link', { name: /Détail du sous-ticket/ })).toBeTruthy();
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('mène, sous une Epic imbriquée, à la plus proche des deux : celle de la pastille du kanban', async () => {
    const { dialog } = await openPanelOf('bdesk-s2');

    expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-sub');
  });

  it('mène une Epic imbriquée à sa propre page, non à celle de l’Epic qui la contient', async () => {
    const { dialog } = await openPanelOf('bdesk-sub');

    expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-sub');
  });

  it('mène l’Enfant direct d’une Epic imbriquée à cette Epic, non à celle qui la contient', async () => {
    const { dialog } = await openPanelOf('bdesk-s1');

    expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-sub');
  });

  it.each(['bdesk-x', 'bdesk-y', 'bdesk-w'])('n’est pas proposé dans le panneau de %s, hors de toute Epic, quelle que soit sa profondeur', async (id) => {
    const { dialog } = await openPanelOf(id);

    expect(pageEpic(dialog)).toBeNull();
  });

  it('n’est pas proposé, et ne fige rien, quand les parents se bouclent : aucune Epic au bout', async () => {
    stub([
      issue({ id: 'bdesk-b1', title: 'Boucle un', parentId: 'bdesk-b2' }),
      issue({ id: 'bdesk-b2', title: 'Boucle deux', parentId: 'bdesk-b1' }),
    ]);
    renderApp('/p/bdesk/t/bdesk-b1');
    const dialog = await screen.findByRole('dialog', { name: 'bdesk-b1 Boucle un' });

    expect(pageEpic(dialog)).toBeNull();
  });

  describe('nomme l’Epic visée', () => {
    it('par « Page Epic : » et son titre court, comme la pastille « Epic : … » de la carte : le petit-enfant sait vers quelle Epic il va', async () => {
      const { dialog } = await openPanelOf('bdesk-sous');

      expect(pageEpic(dialog, 'Page Epic : Shell UI')).toBe('/p/bdesk/epics?epic=bdesk-e1');
    });

    it.each([
      ['l’Enfant direct d’une Epic', 'bdesk-a', 'Page Epic : Shell UI', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un arrière-petit-enfant', 'bdesk-detail', 'Page Epic : Shell UI', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un petit-enfant sous une Epic imbriquée : la plus proche', 'bdesk-s2', 'Page Epic : Sous-Epic', '/p/bdesk/epics?epic=bdesk-sub'],
      ['une Epic imbriquée : la sienne', 'bdesk-sub', 'Page Epic : Sous-Epic', '/p/bdesk/epics?epic=bdesk-sub'],
      ['l’Epic elle-même', 'bdesk-e1', 'Page Epic : Shell UI', '/p/bdesk/epics?epic=bdesk-e1'],
    ])('la nomme aussi pour %s', async (_who, id, name, href) => {
      const { dialog } = await openPanelOf(id);

      expect(pageEpic(dialog, name)).toBe(href);
    });

    it('porte le même titre court que la pastille « Epic : … » de la carte du même ticket : la carte et le panneau nomment la même Epic', async () => {
      stub(PROJECT);
      const { user } = renderApp('/p/bdesk/kanban');
      const card = (await screen.findByRole('link', { name: 'Détail du sous-ticket' })).closest('li') as HTMLElement;
      const pill = within(card).getByRole('link', { name: /^Epic : / });

      await user.click(within(card).getByRole('link', { name: 'Détail du sous-ticket' }));
      const dialog = await screen.findByRole('dialog', { name: panelName('bdesk-detail') });

      expect(pill.textContent).toBe('Epic : Shell UI');
      expect(pageEpic(dialog, `Page ${pill.textContent}`)).toBe(pill.getAttribute('href'));
    });

    it('abrège un long titre comme la pastille, et donne le titre entier en infobulle', async () => {
      const LONG = 'Une très longue Epic sans séparateur qui dépasse largement la limite';
      stub([issue({ id: 'bdesk-long', title: LONG, type: 'epic' }), issue({ id: 'bdesk-fils', title: 'Un Enfant', parentId: 'bdesk-long' })]);
      renderApp('/p/bdesk/t/bdesk-fils');
      const dialog = await screen.findByRole('dialog', { name: 'bdesk-fils Un Enfant' });

      const link = within(dialog).getByRole('link', { name: 'Page Epic : Une très longue Epic…' });

      expect(link.getAttribute('title')).toContain(LONG);
    });

    it('dit l’identifiant d’une Epic sans titre : pas de « Page Epic : » qui ne nomme rien', async () => {
      stub([issue({ id: 'bdesk-vide', title: '', type: 'epic' }), issue({ id: 'bdesk-fils', title: 'Un Enfant', parentId: 'bdesk-vide' })]);
      renderApp('/p/bdesk/t/bdesk-fils');
      const dialog = await screen.findByRole('dialog', { name: 'bdesk-fils Un Enfant' });

      expect(pageEpic(dialog, 'Page Epic : bdesk-vide')).toBe('/p/bdesk/epics?epic=bdesk-vide');
    });
  });

  describe('vient avec la fiche', () => {
    it.each([
      ['un petit-enfant', 'bdesk-sous', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un arrière-petit-enfant', 'bdesk-detail', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un petit-enfant sous une Epic imbriquée', 'bdesk-s2', '/p/bdesk/epics?epic=bdesk-sub'],
      ['l’Enfant direct d’une Epic', 'bdesk-a', '/p/bdesk/epics?epic=bdesk-e1'],
      ['une Epic imbriquée', 'bdesk-sub', '/p/bdesk/epics?epic=bdesk-sub'],
    ])('pour %s, est là avec le titre, sans attendre la liste des tickets : la fiche nomme l’Epic', async (_who, id, href) => {
      holdList(stub(PROJECT)); // la liste n’arrive jamais
      renderApp(`/p/bdesk/t/${id}`);
      const dialog = await screen.findByRole('dialog', { name: panelName(id) });

      expect(pageEpic(dialog)).toBe(href);
    });

    it('est là dès que le titre l’est quand le panneau s’ouvre depuis une carte du tableau', async () => {
      stub(PROJECT);
      const { user } = renderApp('/p/bdesk/kanban');
      await user.click(await screen.findByRole('link', { name: 'Détail du sous-ticket' }));

      const dialog = await screen.findByRole('dialog', { name: panelName('bdesk-detail') });

      expect(pageEpic(dialog)).toBe('/p/bdesk/epics?epic=bdesk-e1');
    });

    it('ne demande ni la fiche des ancêtres ni une seconde liste : le tableau dessous a déjà demandé celle-ci', async () => {
      const fetchMock = stub(PROJECT);
      renderApp('/p/bdesk/t/bdesk-detail');
      const dialog = await screen.findByRole('dialog', { name: panelName('bdesk-detail') });
      await screen.findByRole('region', { name: 'En cours' });

      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(pageEpic(dialog)).not.toBeNull();
      expect(urls.filter((url) => url === '/api/projects/bdesk/issues')).toHaveLength(1);
      expect(urls.filter((url) => /\/issues\/[^/]+$/.test(url))).toEqual(['/api/projects/bdesk/issues/bdesk-detail']);
    });

    it.each([
      ['l’Enfant direct d’une Epic', 'bdesk-a', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un petit-enfant', 'bdesk-sous', '/p/bdesk/epics?epic=bdesk-e1'],
      ['un ticket sans parent', 'bdesk-x', null],
    ])('ne relit jamais la liste des tickets, même périmée, pour %s : le panneau ne la lit pas', async (_who, id, href) => {
      const fetchMock = stub(PROJECT);
      const { user } = renderApp('/p/bdesk/kanban');
      const card = await screen.findByRole('link', { name: titleOf(id) });
      vi.setSystemTime(Date.parse(NOW) + 60_000); // la liste date de plus de 15 s : une relecture serait permise

      await user.click(card);
      const dialog = await screen.findByRole('dialog', { name: panelName(id) });

      expect(pageEpic(dialog)).toBe(href);
      const urls = fetchMock.mock.calls.map(([input]) => String(input));
      expect(urls.filter((url) => url === '/api/projects/bdesk/issues')).toHaveLength(1);
    });

    it('ne dépend pas de la liste des tickets : la fiche nomme l’Epic même quand la liste ne peut pas être lue', async () => {
      stubApi({
        projects: projectsResponse,
        issues: { bdesk: new Error('database is locked') },
        details: {
          'bdesk/bdesk-sous': issueDetail({
            id: 'bdesk-sous',
            title: 'Sous-ticket de la palette',
            parentId: 'bdesk-a',
            linked: { 'bdesk-a': { id: 'bdesk-a', title: 'Palette', type: 'task', status: 'in_progress', priority: 2 } },
            epic: { id: 'bdesk-e1', title: 'Shell UI : thèmes, navigation et raccourcis' },
          }),
        },
      });
      renderApp('/p/bdesk/t/bdesk-sous');
      const dialog = await screen.findByRole('dialog', { name: panelName('bdesk-sous') });
      await screen.findByText('Impossible de charger les tickets');

      expect(pageEpic(dialog, 'Page Epic : Shell UI')).toBe('/p/bdesk/epics?epic=bdesk-e1');
    });
  });
});

describe('la page Epic : une page qui vit', () => {
  freezeClock();

  it('suit les mises à jour des tickets : une Livraison de plus, sans recharger', async () => {
    const issues = [EPIC, closedChild('bdesk-a', 'Livré', 3), child('bdesk-b', 'En cours', { status: 'in_progress' }), child('bdesk-c', 'À faire')];
    const { queryClient } = await openEpic(issues);
    expect(within(section('Avancement')).getByText(/1 Livraison sur 3 Enfants/)).toBeTruthy();

    stub(issues.map((t) => (t.id === 'bdesk-b' ? { ...t, status: 'closed', closedAt: ago(0.1) } : t)));
    await act(async () => {
      await queryClient.invalidateQueries({ queryKey: queryKeys.issues('bdesk') });
    });

    expect(await within(section('Avancement')).findByText(/2 Livraisons sur 3 Enfants/)).toBeTruthy();
    expect(within(section('Terminé')).getAllByRole('listitem')).toHaveLength(2);
    // La colonne vidée par la mise à jour disparaît : on ne montre pas une colonne sans Enfant.
    expect(screen.queryByRole('region', { name: 'En cours' })).toBeNull();
  });

  it('ouvre la liste des Epics quand ?epic= est vide', async () => {
    stub([EPIC]);
    renderApp('/p/bdesk/epics?epic=');

    expect(await screen.findByRole('heading', { level: 1, name: 'Epics' })).toBeTruthy();
  });

  it('enchaîne ses titres sans sauter de niveau : le titre de l’Epic, ses sections, puis les colonnes', async () => {
    await openEpic([EPIC, closedChild('bdesk-a', 'Livré', 3), child('bdesk-b', 'En cours', { status: 'in_progress' }), child('bdesk-c', 'À faire')]);

    const headings = within(screen.getByRole('main')).getAllByRole('heading');

    expect(headings.map((heading) => [Number(heading.tagName.slice(1)), heading.textContent])).toEqual([
      [1, 'Shell UI : thèmes, navigation et raccourcis'],
      [2, 'Avancement'],
      [2, 'Lead Time et prévision'],
      [2, 'Enfants'],
      [3, 'Prêt1 ticket'],
      [3, 'En cours1 ticket'],
      [3, 'Terminé1 ticket'],
    ]);
  });
});

describe('la page Epic : d’une Epic à l’autre', () => {
  freezeClock();

  const PROJECT: Issue[] = [
    EPIC,
    child('bdesk-sub', 'Sous-Epic', { type: 'epic' }),
    issue({ id: 'bdesk-s1', title: 'Enfant de la sous-Epic', parentId: 'bdesk-sub' }),
  ];

  it('revient en haut de la page quand on passe à une autre Epic : le panneau de contenu garde sinon son défilement', async () => {
    const { user } = await openEpic(PROJECT, '/p/bdesk/epics?epic=bdesk-e1&view=tree');
    const main = screen.getByRole('main');
    let offset = 480;
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => offset, set: (value: number) => void (offset = value) });

    await user.click(within(screen.getByRole('list', { name: 'Arborescence' })).getByRole('link', { name: /Sous-Epic/ }));

    expect(await screen.findByRole('heading', { level: 1, name: 'Sous-Epic' })).toBeTruthy();
    expect(offset).toBe(0);
  });

  it('ne touche pas au défilement quand seule la façon de lire les Enfants change', async () => {
    const { user } = await openEpic(PROJECT);
    const main = screen.getByRole('main');
    let offset = 480;
    Object.defineProperty(main, 'scrollTop', { configurable: true, get: () => offset, set: (value: number) => void (offset = value) });

    await user.click(screen.getByRole('button', { name: 'Arbre' }));

    expect(screen.getByRole('list', { name: 'Arborescence' })).toBeTruthy();
    expect(offset).toBe(480);
  });
});

describe('la page Epic : ce qui ne va pas', () => {
  freezeClock();

  it('dit quand l’Epic n’existe pas, et renvoie à la liste', async () => {
    stub([EPIC]);
    renderApp('/p/bdesk/epics?epic=bdesk-fantome');

    expect(await screen.findByText('Aucune Epic « bdesk-fantome » dans beads-desktop')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Voir les Epics du Projet' }).getAttribute('href')).toBe('/p/bdesk/epics');
  });

  it('dit quand le ticket n’est pas une Epic, et propose de l’ouvrir', async () => {
    stub([EPIC, child('bdesk-a', 'Palette')]);
    renderApp('/p/bdesk/epics?epic=bdesk-a');

    // La page est prête dès qu'elle a un titre ; ce qu'il dit, lui, est une assertion (qui échoue tout de suite si la page est celle d'une Epic).
    await screen.findByRole('heading', { level: 1, name: /\S/ });
    expect(screen.getByRole('heading', { level: 1 }).textContent).toBe('Ce n’est pas une Epic');
    expect(screen.getByText('« bdesk-a » est de type Tâche')).toBeTruthy();
    expect(screen.getByRole('link', { name: 'Ouvrir le ticket' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-a');
  });

  it('montre un état de chargement, puis l’erreur et la nouvelle tentative quand les tickets ne viennent pas', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: httpFailure(500, { statusCode: 500, error: 'Internal Server Error', message: 'database is locked' }) } });
    renderApp('/p/bdesk/epics?epic=bdesk-e1');

    expect(await screen.findByText('Impossible de charger les tickets')).toBeTruthy();
    expect(screen.getByRole('button', { name: /Réessayer/ })).toBeTruthy();
  });

  it('montre une silhouette en attendant les tickets', async () => {
    const fetchMock = stub([EPIC]);
    const healthy = fetchMock.getMockImplementation();
    if (!healthy) throw new Error('stubApi attendu');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/issues')) await gate;
      return healthy(input);
    });
    renderApp('/p/bdesk/epics?epic=bdesk-e1');

    expect(await screen.findByRole('status', { name: 'Chargement de l’Epic' })).toBeTruthy();
    release();
    expect(await screen.findByRole('heading', { level: 1, name: /Shell UI/ })).toBeTruthy();
    expect(screen.queryByRole('status', { name: 'Chargement de l’Epic' })).toBeNull();
  });
});

describe('la liste des Epics', () => {
  freezeClock();

  const PROJECT: Issue[] = [
    EPIC,
    closedChild('bdesk-a', 'Livré', 3),
    child('bdesk-b', 'À faire'),
    issue({ id: 'bdesk-e2', title: 'Seconde Epic', type: 'epic', priority: 2 }),
    issue({ id: 'bdesk-e3', title: 'Epic finie', type: 'epic', status: 'closed', closedAt: ago(10) }),
    issue({ id: 'bdesk-e3.1', title: 'Fini', parentId: 'bdesk-e3', status: 'closed', closedAt: ago(10) }),
    issue({ id: 'bdesk-z', title: 'Hors Epic' }),
  ];

  it('dit combien d’Epics regroupent combien d’Enfants', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/epics');

    const summary = await screen.findByText(/regroupant/);

    expect(summary.textContent).toBe('3 Epics regroupant 3 Enfants');
  });

  it('accorde le singulier', async () => {
    stub([EPIC, child('bdesk-a', 'Seul')]);
    renderApp('/p/bdesk/epics');

    expect((await screen.findByText(/regroupant/)).textContent).toBe('1 Epic regroupant 1 Enfant');
  });

  it('liste chaque Epic avec sa barre d’avancement, les ouvertes avant les fermées', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/epics');
    await screen.findByText(/regroupant/);

    const open = screen.getByRole('list', { name: 'Epics ouvertes' });
    const closed = screen.getByRole('list', { name: 'Epics fermées' });

    expect(within(open).getAllByRole('listitem').map((item) => within(item).getAllByRole('link')[0]?.textContent)).toEqual([
      expect.stringContaining('Shell UI'),
      expect.stringContaining('Seconde Epic'),
    ]);
    expect(within(closed).getAllByRole('link')[0]?.textContent).toContain('Epic finie');
    // Les fermées le disent sur leur ligne : rien d'autre ne les distingue des ouvertes à l'écran.
    expect(within(closed).getByText('fermée')).toBeTruthy();
    expect(within(open).queryByText('fermée')).toBeNull();
    const first = within(open).getAllByRole('listitem')[0] as HTMLElement;
    expect(within(first).getByRole('progressbar').getAttribute('aria-valuetext')).toBe('1 Livraison sur 2 Enfants');
    expect(first.textContent).toContain('1 sur 2');
    expect(within(closed).getByRole('progressbar').getAttribute('aria-valuenow')).toBe('1');
  });

  it('ouvre la page d’une Epic', async () => {
    stub(PROJECT);
    const { user, router } = renderApp('/p/bdesk/epics');

    await user.click(await screen.findByRole('link', { name: /Seconde Epic/ }));

    expect(router.state.location.pathname + router.state.location.search).toBe('/p/bdesk/epics?epic=bdesk-e2');
    expect(await screen.findByRole('heading', { level: 1, name: 'Seconde Epic' })).toBeTruthy();
  });

  it('dit « sans Enfant » d’une Epic vide plutôt que d’afficher une barre', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/epics');
    await screen.findByText(/regroupant/);

    const second = screen.getByRole('link', { name: /Seconde Epic/ });

    expect(second.textContent).toContain('Aucun Enfant');
    expect(within(second).queryByRole('progressbar')).toBeNull();
  });

  it('explique ce qu’est une Epic quand le Projet n’en a pas', async () => {
    stub([child('bdesk-a', 'Seul')].map((t) => ({ ...t, parentId: null })));
    renderApp('/p/bdesk/epics');

    expect(await screen.findByText('Aucune Epic dans ce Projet')).toBeTruthy();
  });

  it('a pour titre « Epics » et nomme le Projet dans l’onglet', async () => {
    stub(PROJECT);
    renderApp('/p/bdesk/epics');

    expect(await screen.findByRole('heading', { level: 1, name: 'Epics' })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe('Epics · beads-desktop · beads-desktop'));
  });
});
