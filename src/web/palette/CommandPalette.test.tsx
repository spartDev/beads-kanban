import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { StrictMode } from 'react';
import { createMemoryRouter, RouterProvider } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { issuesQuery, queryKeys } from '../data/hooks';
import { routes } from '../routes';
import { OverlayProvider, usePalette } from '../shell/OverlayProvider';
import { ShortcutsProvider, useShortcut } from '../shortcuts/ShortcutsProvider';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { withHeldExitAnimations } from '../test/exitAnimation';
import { bdeskIssues, issue, mpmIssues, projects, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { ThemeProvider } from '../theme/ThemeProvider';
import { CommandPalette } from './CommandPalette';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

/** Rôles que WAI-ARIA admet dans une listbox : des options, éventuellement rangées en groupes. */
const LISTBOX_ROLES = new Set(['option', 'group', 'presentation', 'none']);

async function openPalette(path: string) {
  const app = renderApp(path);
  await screen.findByRole('navigation', { name: 'Navigation principale' });
  await app.user.keyboard('{Control>}k{/Control}');
  const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
  return { ...app, dialog, listbox: within(dialog).getByRole('listbox') };
}

/** Ce que la listbox contient d'étranger à son rôle : un message d'état ou d'alerte n'a rien à y faire. */
const foreignRoles = (listbox: HTMLElement) =>
  [...listbox.querySelectorAll('[role]')].map((el) => el.getAttribute('role') ?? '').filter((role) => !LISTBOX_ROLES.has(role));

describe('ARIA de la palette : la listbox ne contient que des options', () => {
  it('pendant le chargement des tickets, le message d’attente est hors de la liste', async () => {
    const fetchMock = stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const healthy = fetchMock.getMockImplementation()!;
    // Les tickets n'arrivent jamais : la palette reste en attente.
    fetchMock.mockImplementation((input) =>
      String(input).endsWith('/issues') ? new Promise<Response>(() => undefined) : healthy(input),
    );

    const { dialog, listbox } = await openPalette('/');

    const loading = await within(dialog).findByText('Chargement des tickets…');
    expect(loading.getAttribute('role')).toBe('status');
    expect(listbox.contains(loading)).toBe(false);
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('quand des tickets sont indisponibles, l’alerte est hors de la liste et « Réessayer » reste une option', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });

    const { dialog, listbox } = await openPalette('/');

    const alert = await within(dialog).findByRole('alert');
    expect(alert.textContent).toContain('Tickets indisponibles : beads-desktop');
    expect(listbox.contains(alert)).toBe(false);
    expect(within(listbox).getByRole('option', { name: /Réessayer/ })).toBeTruthy();
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('quand rien ne correspond, le message est hors de la liste', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { dialog, listbox, user } = await openPalette('/');
    await user.keyboard('zzzzzz');

    const empty = await within(dialog).findByText('Aucun résultat pour « zzzzzz ».');
    expect(empty.getAttribute('role')).toBe('status');
    expect(listbox.contains(empty)).toBe(false);
    expect(foreignRoles(listbox)).toEqual([]);
  });

  it('avec des résultats, la liste ne porte que des options et des groupes', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

    const { listbox, user } = await openPalette('/');
    await user.keyboard('shell');

    expect(await within(listbox).findByRole('option', { name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(foreignRoles(listbox)).toEqual([]);
  });
});

/** Le panneau d'un ticket. Tant que la palette n'est pas retirée, elle cache la page aux technologies d'assistance : `hidden`. */
const panel = (title: RegExp) => screen.findByRole('dialog', { name: title, hidden: true });

describe('Échap pendant que la palette se retire : la touche revient à la page, elle n’est pas avalée', () => {
  const exit = withHeldExitAnimations();

  it('ferme le panneau qu’un choix de la palette vient d’ouvrir', async () => {
    stubDefaultApi();
    const { user, router, dialog: palette } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k.7');
    await within(palette).findByRole('option', { name: /Kanban par Projet/ });

    await user.keyboard('{Enter}');

    await panel(/Kanban par Projet/);
    // L'état à tester : le choix est fait, le panneau est ouvert, et la palette n'a pas fini de se retirer.
    expect(palette.isConnected).toBe(true);
    expect(palette.getAttribute('data-state')).toBe('closed');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(screen.queryByRole('dialog', { name: /Kanban par Projet/, hidden: true })).toBeNull();
    // La palette, elle, finit de se retirer : rien n'est resté monté.
    exit.finish();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });

  it('ferme aussi le panneau quand le choix est fait au clic', async () => {
    stubDefaultApi();
    const { user, router, dialog: palette } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k.7');
    await user.click(await within(palette).findByRole('option', { name: /Kanban par Projet/ }));
    await panel(/Kanban par Projet/);
    expect(palette.getAttribute('data-state')).toBe('closed');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });

  it('ferme le panneau quand Échap suit de près celui qui vient de fermer la palette', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await panel(/Shell UI façon Linear/);
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('{Escape}');
    expect(palette.getAttribute('data-state')).toBe('closed');
    expect(palette.isConnected).toBe(true);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });

  it('laisse Échap à la palette tant qu’elle est ouverte : elle se ferme, le panneau reste', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await panel(/Shell UI façon Linear/);
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    await user.keyboard('{Escape}');

    expect(palette.getAttribute('data-state')).toBe('closed');
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');
    exit.finish();
    expect((await panel(/Shell UI façon Linear/)).isConnected).toBe(true);
  });
});

describe('la palette rend Échap au registre des raccourcis dès qu’elle se ferme, et pas avant', () => {
  const exit = withHeldExitAnimations();

  /** Une page qui n'a qu'un raccourci Échap valable partout, même dans une boîte de dialogue, et un bouton pour ouvrir la palette. */
  function Page({ onEscape }: { onEscape: () => void }) {
    const { openPalette } = usePalette();
    useShortcut({ id: 'test.escape', keys: 'escape', label: 'Échap de la page', group: 'Test', allowInInput: true, run: onEscape });
    return (
      <button type="button" onClick={() => openPalette()}>
        Ouvrir la palette
      </button>
    );
  }

  function renderPage(onEscape: () => void) {
    stubDefaultApi();
    const router = createMemoryRouter(
      [
        {
          path: '*',
          element: (
            <ShortcutsProvider>
              <OverlayProvider>
                <Page onEscape={onEscape} />
                <CommandPalette />
              </OverlayProvider>
            </ShortcutsProvider>
          ),
        },
      ],
      { initialEntries: ['/'] },
    );
    render(
      <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
        <ThemeProvider>
          <RouterProvider router={router} />
        </ThemeProvider>
      </QueryClientProvider>,
    );
    return userEvent.setup();
  }

  it('ouverte, la palette garde Échap pour se fermer ; fermée mais encore là, elle le rend à la page', async () => {
    const onEscape = vi.fn();
    const user = renderPage(onEscape);
    await user.click(await screen.findByRole('button', { name: 'Ouvrir la palette' }));
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    await user.keyboard('{Escape}');

    expect(palette.getAttribute('data-state')).toBe('closed');
    expect(onEscape).not.toHaveBeenCalled();

    await user.keyboard('{Escape}');

    expect(onEscape).toHaveBeenCalledTimes(1);
    exit.finish();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});

/**
 * Les listes de tickets (de ces Projets, ou de tous) n'arrivent qu'à l'appel de `release` : un cache froid, comme celui d'une page
 * qui ne les charge pas (Métriques). Les fiches et le reste de l'API répondent tout de suite.
 */
function holdIssueLists(fetchMock: ReturnType<typeof stubApi>, projectIds?: readonly string[]) {
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('holdIssueLists attend le mock renvoyé par stubApi.');
  let resolve: () => void = () => undefined;
  const released = new Promise<void>((done) => {
    resolve = done;
  });
  fetchMock.mockImplementation(async (input) => {
    const match = /^\/api\/projects\/([^/]+)\/issues$/.exec(new URL(String(input), 'http://localhost').pathname);
    if (match?.[1] && (!projectIds || projectIds.includes(decodeURIComponent(match[1])))) await released;
    return healthy(input);
  });
  return () => act(async () => resolve());
}

/**
 * La liste des PROJETS n'arrive qu'à l'appel de `release` : un cache plus froid encore. Tant qu'on ne sait pas quels Projets lire, la portée
 * de la recherche de tickets est vide : rien n'est en cours de lecture, et pourtant les tickets ne sont pas là.
 */
function holdProjects(fetchMock: ReturnType<typeof stubApi>) {
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('holdProjects attend le mock renvoyé par stubApi.');
  let resolve: () => void = () => undefined;
  const released = new Promise<void>((done) => {
    resolve = done;
  });
  fetchMock.mockImplementation(async (input) => {
    if (new URL(String(input), 'http://localhost').pathname === '/api/projects') await released;
    return healthy(input);
  });
  return () => act(async () => resolve());
}

/** Laisse passer les effets d'un rendu : à appeler avant d'affirmer qu'une demande n'a rien ouvert. */
const settle = () => act(async () => undefined);

const selected = (option: HTMLElement) => option.getAttribute('aria-selected') === 'true';

/**
 * Le délai sans réponse des tickets du Projet, compté depuis la dernière frappe, après lequel « Chercher … dans tous les Projets » est
 * proposé quand même : 2 s. Écrit ici plutôt qu'importé, pour qu'un autre délai casse ces tests et soit une décision, pas un détail.
 */
const WIDEN_AFTER_MS = 2_000;

/**
 * Truque les minuteries (celle du délai ci-dessus) : `elapse` fait passer le temps d'un coup ; entre deux, il passe au rythme du temps
 * réel, ce qu'attendent user-event et Testing Library. Ce temps truqué ne va jamais plus vite que le temps réel, et prend du retard quand
 * la machine est chargée (20 ms par tour de boucle) : un test qui tient des listes de tickets l'appelle pour que la lenteur ne fasse pas
 * passer le délai à sa place. `afterEach` rend les vraies minuteries.
 */
const fakeClock = () => vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
afterEach(() => {
  vi.useRealTimers();
});

/** Saisie et touches d'un trait, sans rien attendre : le temps truqué n'avance pas entre deux, le décompte part à cet instant précis. */
const typeNow = (dialog: HTMLElement, text: string) =>
  fireEvent.change(within(dialog).getByRole('combobox'), { target: { value: text } });
const pressNow = (dialog: HTMLElement, key: string) => fireEvent.keyDown(within(dialog).getByRole('combobox'), { key });
const pressEnterNow = (dialog: HTMLElement) => pressNow(dialog, 'Enter');

/** La ligne de repli si elle est là (`null` sinon), et la même qui échoue en le disant quand on l'attend. */
const widenRow = (dialog: HTMLElement) => within(dialog).queryByRole('option', { name: /dans tous les Projets/ });
const widenOption = (dialog: HTMLElement) => within(dialog).getByRole('option', { name: /dans tous les Projets/ });

describe('Entrée prend la première ligne, sur toutes les pages : une ligne de repli ne prend jamais la sélection devant un résultat', () => {
  it.each([
    ['Kanban', '/p/bdesk/kanban'],
    ['Epics', '/p/bdesk/epics'],
    ['Métriques', '/p/bdesk/metrics'],
  ])('page %s : les tickets du Projet arrivent après la saisie, Entrée ouvre le ticket tapé', async (_page, path) => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette(path);
    fakeClock();
    await user.keyboard('38k.6');

    await release();

    const option = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(option)).toBe(true));
    expect(selected(within(dialog).getByRole('option', { name: /dans tous les Projets/ }))).toBe(false);
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('page Vue globale : les tickets de tous les Projets arrivent après la saisie, Entrée ouvre le ticket tapé', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/');
    await user.keyboard('mpm-12');

    await release();

    const option = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(option)).toBe(true));
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
  });

  it('tickets déjà chargés : le ticket tapé est la première ligne, avant « Chercher … dans tous les Projets »', async () => {
    stubDefaultApi();
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    await user.keyboard('38k.6');

    const option = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(option)).toBe(true));
    const names = within(dialog).getAllByRole('option').map((row) => row.textContent ?? '');
    expect(names.at(-1)).toContain('dans tous les Projets');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('tant que les tickets du Projet se chargent, « Chercher … dans tous les Projets » n’est pas là pour recevoir Entrée', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.keyboard('38k.6');
    await within(dialog).findByText('Chargement des tickets…');
    expect(within(dialog).queryByRole('option', { name: /dans tous les Projets/ })).toBeNull();

    await user.keyboard('{Enter}');

    expect(within(dialog).queryByText('Tous les Projets')).toBeNull(); // la portée de la recherche n'a pas changé
    expect(pathname(router)).toBe('/p/bdesk/metrics');

    await release();

    const option = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(option)).toBe(true));
  });

  it('Entrée élargit la recherche quand le Projet n’a rien d’autre à proposer', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('mpm-12');

    const widen = await within(dialog).findByRole('option', { name: /dans tous les Projets/ });
    await waitFor(() => expect(selected(widen)).toBe(true));
    await user.keyboard('{Enter}');

    const found = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(found)).toBe(true));
    expect(within(dialog).getByText('Tous les Projets')).toBeTruthy();
  });

  it.each([
    ['une commande de navigation', 'metriques', 'Métriques', '/p/bdesk/metrics'],
    ['un Projet', 'prompt', 'My-Prompt-Manager', '/p/mpm/kanban'],
    ['une Epic', 'V1', 'beads-desktop V1', '/p/bdesk/epics?epic=bdesk-38k'],
    ['un ticket', '38k.6', 'Shell UI façon Linear', '/p/bdesk/t/bdesk-38k.6'],
  ])('la première ligne est %s : sélectionnée dès la frappe, Entrée la prend', async (_kind, typed, title, target) => {
    stubDefaultApi();
    const { dialog, user, router } = await openPalette('/p/bdesk/kanban');
    await user.keyboard(typed);

    const first = await waitFor(() => {
      const [row] = within(dialog).getAllByRole('option');
      if (!row?.textContent?.includes(title)) throw new Error(`« ${title} » n’est pas encore en tête`);
      return row;
    });
    await waitFor(() => expect(selected(first)).toBe(true));
    expect(within(dialog).getAllByRole('option').filter(selected)).toHaveLength(1);
    await user.keyboard('{Enter}');

    await waitFor(() => expect(pathname(router)).toBe(target));
  });

  it('la première ligne est une action : Entrée la lance', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('sombre');

    const first = await within(dialog).findByRole('option', { name: /Thème sombre/ });
    await waitFor(() => expect(selected(first)).toBe(true));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(document.documentElement.dataset.theme).toBe('dark'));
  });

  it('la première ligne est « Réessayer » quand les tickets d’un Projet sont indisponibles : Entrée relance la lecture', async () => {
    const fetchMock = stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });
    const { dialog, user } = await openPalette('/');
    await user.keyboard('zzzz');
    const retry = await within(dialog).findByRole('option', { name: /Réessayer/ });
    await waitFor(() => expect(selected(retry)).toBe(true));
    const reads = () => fetchMock.mock.calls.filter(([input]) => String(input) === '/api/projects/bdesk/issues').length;
    const before = reads();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(reads()).toBeGreaterThan(before));
  });

  it('en mode « changer de Projet », un Projet illisible placé en tête ne prend pas la sélection : la première ligne est le premier Projet lisible', async () => {
    const [bdesk, mpm, legacy] = projects;
    if (!bdesk || !mpm || !legacy) throw new Error('Les Projets de test manquent.');
    stubApi({ projects: { projects: [legacy, bdesk, mpm], ignored: [] }, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const { user, router } = renderApp('/p/mpm/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('gp');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    const options = await within(dialog).findAllByRole('option');
    expect(options.map((option) => option.textContent)).toEqual([
      expect.stringContaining('legacy-api'),
      expect.stringContaining('beads-desktop'),
      expect.stringContaining('My-Prompt-Manager'),
    ]);
    await waitFor(() => expect(options.map(selected)).toEqual([false, true, false]));
    await user.keyboard('{Enter}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });

  it('le verbe d’Entrée, en pied de palette, dit ce que fait la ligne sélectionnée', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    expect(within(dialog).getByText('Aller à')).toBeTruthy(); // sans saisie, la première ligne est une commande de navigation

    await user.keyboard('38k.6');
    await waitFor(() => expect(within(dialog).getByText('Ouvrir le ticket')).toBeTruthy());

    await user.keyboard('{Control>}a{/Control}{Backspace}mpm-12');
    await waitFor(() => expect(within(dialog).getByText('Élargir la recherche')).toBeTruthy());
  });

  describe('des lignes arrivent après la saisie (le second Projet répond plus tard)', () => {
    const alpha = (id: string, title: string, updatedAt: string) => issue({ id, title, updatedAt });
    const slowSecondProject = () =>
      stubApi({
        projects: projectsResponse,
        issues: {
          bdesk: [alpha('bdesk-1', 'Alpha rapport', '2026-10-20T09:00:00Z'), alpha('bdesk-2', 'Alpha rapport bis', '2026-10-19T09:00:00Z')],
          mpm: [alpha('mpm-9', 'Alpha', '2026-10-01T09:00:00Z')],
        },
      });

    it('la ligne en surbrillance ne saute pas sous les yeux : les lignes qui arrivent se rangent sans la déplacer', async () => {
      const release = holdIssueLists(slowSecondProject(), ['mpm']);
      const { dialog, user, router } = await openPalette('/');
      await user.keyboard('alpha');
      const seen = await within(dialog).findByRole('option', { name: /bdesk-1/ });
      await waitFor(() => expect(selected(seen)).toBe(true));

      await release();

      // « Alpha » est le titre exact de mpm-9 : il passe devant, mais la surbrillance reste sur la ligne qu'on avait sous les yeux.
      const exact = await within(dialog).findByRole('option', { name: /mpm-9/ });
      expect(within(dialog).getAllByRole('option')[0]).toBe(exact);
      expect(selected(seen)).toBe(true);
      expect(selected(exact)).toBe(false);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-1'));
    });

    it('la ligne choisie aux flèches reste choisie quand d’autres lignes arrivent', async () => {
      const release = holdIssueLists(slowSecondProject(), ['mpm']);
      const { dialog, user, router } = await openPalette('/');
      await user.keyboard('alpha');
      await within(dialog).findByRole('option', { name: /bdesk-2/ });

      await user.keyboard('{ArrowDown}');
      const chosen = within(dialog).getByRole('option', { name: /bdesk-2/ });
      await waitFor(() => expect(selected(chosen)).toBe(true));
      await release();

      await within(dialog).findByRole('option', { name: /mpm-9/ });
      expect(selected(chosen)).toBe(true);
      await user.keyboard('{Enter}');
      await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-2'));
    });

    it('taper reprend la première ligne, même après un choix aux flèches', async () => {
      slowSecondProject();
      const { dialog, user } = await openPalette('/');
      await user.keyboard('alph');
      await within(dialog).findByRole('option', { name: /mpm-9/ });
      await user.keyboard('{ArrowDown}');
      await waitFor(() => expect(selected(within(dialog).getByRole('option', { name: /bdesk-2/ }))).toBe(true));

      await user.keyboard('a');

      // « alpha » est le titre exact de mpm-9 : il passe devant, et c'est lui qui est sélectionné, pas la ligne choisie avant la frappe.
      const top = await waitFor(() => {
        const [row] = within(dialog).getAllByRole('option');
        if (!row?.textContent?.includes('mpm-9')) throw new Error('mpm-9 n’est pas encore en tête');
        return row;
      });
      await waitFor(() => expect(selected(top)).toBe(true));
      expect(selected(within(dialog).getByRole('option', { name: /bdesk-2/ }))).toBe(false);
    });
  });
});

describe('les tickets du Projet tardent : « Chercher … dans tous les Projets » revient au bout d’un délai', () => {
  it('liste qui ne répond jamais : la ligne revient 2 s après la saisie, flèche bas puis Entrée élargissent la recherche', async () => {
    holdIssueLists(stubDefaultApi(), ['bdesk']); // la liste de beads-desktop n'est jamais relâchée
    const { dialog, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();

    typeNow(dialog, 'mpm-12');
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull();
    expect(within(dialog).getByText('Chargement des tickets…')).toBeTruthy();

    elapse(1);
    // Les tickets chargent toujours : la ligne ne fait pas taire le message qui le dit. Elle n'est pas en surbrillance (voir plus bas).
    expect(within(dialog).getByText('Chargement des tickets…')).toBeTruthy();
    expect(selected(widenOption(dialog))).toBe(false);
    pressNow(dialog, 'ArrowDown');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

    pressEnterNow(dialog);

    const found = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(found)).toBe(true));
    pressEnterNow(dialog);
    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
  });

  it('revenue sans être sélectionnée, la ligne laisse la sélection aux tickets qui arrivent ensuite : Entrée ouvre le ticket tapé', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(selected(widenOption(dialog))).toBe(false); // rien n'est en surbrillance : rien ne peut sauter quand les tickets arrivent

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    const rows = within(dialog).getAllByRole('option');
    expect(rows[0]).toBe(ticket);
    expect(rows[1]).toBe(widenOption(dialog));
    expect(selected(widenOption(dialog))).toBe(false);
    pressEnterNow(dialog);
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('les tickets arrivent sans correspondance : « Chercher … », seule ligne, devient la ligne sélectionnée et Entrée élargit la recherche', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, 'mpm-12'); // un ticket de l'autre Projet : la liste de beads-desktop n'a rien d'autre à proposer
    elapse(WIDEN_AFTER_MS);
    expect(selected(widenOption(dialog))).toBe(false);

    await release();

    await waitFor(() => expect(within(dialog).queryByText('Chargement des tickets…')).toBeNull());
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
    await expectActiveDescendantToFollowSelection(dialog, 'les tickets sont arrivés, sans correspondance');
    pressEnterNow(dialog);
    const found = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(found)).toBe(true));
  });

  it('la ligne choisie à la flèche reste choisie quand les tickets arrivent : elle ne saute pas sous les yeux', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    pressNow(dialog, 'ArrowDown');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    expect(within(dialog).getAllByRole('option')[0]).toBe(ticket);
    expect(selected(widenOption(dialog))).toBe(true);
    expect(selected(ticket)).toBe(false);
  });

  it('taper après le retour de la ligne ne la sélectionne pas : les tickets, à leur arrivée, prennent la sélection', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.');
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();

    typeNow(dialog, '38k.6'); // cmdk choisit d'office la première ligne à chaque frappe : ici la seule

    expect(selected(widenOption(dialog))).toBe(false);
    await release();
    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    expect(selected(widenOption(dialog))).toBe(false);
    pressEnterNow(dialog);
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End'])(
    'la touche %s, après une frappe, choisit la ligne revenue : c’est un choix, il tient quand les tickets arrivent',
    async (key) => {
      const release = holdIssueLists(stubDefaultApi());
      const { dialog } = await openPalette('/p/bdesk/metrics');
      fakeClock();
      typeNow(dialog, '38k.');
      elapse(WIDEN_AFTER_MS);
      typeNow(dialog, '38k.6');
      pressNow(dialog, key);
      await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

      await release();

      const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
      expect(selected(widenOption(dialog))).toBe(true);
      expect(selected(ticket)).toBe(false);
    },
  );

  it('le survol de la ligne revenue la choisit, et le choix tient quand les tickets arrivent', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(selected(widenOption(dialog))).toBe(false);

    await user.hover(widenOption(dialog));
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));
    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    expect(selected(widenOption(dialog))).toBe(true);
    expect(selected(ticket)).toBe(false);
  });

  it('un choix ne vaut que jusqu’à la frappe suivante : la ligne revenue une seconde fois n’est pas choisie d’office', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    pressNow(dialog, 'ArrowDown');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

    typeNow(dialog, ''); // vidée : la ligne part, et avec elle le choix
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS); // elle revient, en retrait
    expect(selected(widenOption(dialog))).toBe(false);
    typeNow(dialog, '38k.60');

    expect(selected(widenOption(dialog))).toBe(false);
  });

  it('des tickets qui arrivent avant la fin du délai gardent la sélection : plus rien n’attend quand il passe', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS / 2);

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    const before = within(dialog).getAllByRole('option').map((row) => row.textContent);
    elapse(WIDEN_AFTER_MS);

    expect(within(dialog).getAllByRole('option').map((row) => row.textContent)).toEqual(before);
    expect(selected(ticket)).toBe(true);
    pressEnterNow(dialog);
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('le délai court depuis la saisie, pas depuis l’ouverture de la palette', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    elapse(3 * WIDEN_AFTER_MS); // la palette reste ouverte, rien n'est tapé

    typeNow(dialog, '38k.6');
    expect(widenRow(dialog)).toBeNull();
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull();
    elapse(1);
    expect(widenRow(dialog)).not.toBeNull();
  });

  it('le délai repart à chaque frappe : la ligne ne vient pas au milieu de la saisie, mais 2 s après la dernière touche', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k');
    elapse(WIDEN_AFTER_MS - 1);
    typeNow(dialog, '38k.'); // une touche de plus, juste avant l'échéance de la première
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull(); // la première échéance est passée : elle n'a plus cours
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull();

    elapse(1);

    expect(widenRow(dialog)).not.toBeNull();
  });

  it('revenue, la ligne reste quand on tape encore : elle ne disparaît pas pour revenir 2 s plus tard', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();

    typeNow(dialog, '38k.60');

    expect(widenRow(dialog)).not.toBeNull();
    expect(within(dialog).getByText('Chargement des tickets…')).toBeTruthy();
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();
  });

  it('vider la saisie arrête le décompte, et retaper le relance à zéro', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS - 1);

    typeNow(dialog, ''); // vidée avant la fin : le décompte s'arrête, il ne viendra pas à échéance plus tard
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).toBeNull(); // sans saisie, rien à proposer

    typeNow(dialog, '38k.6');
    expect(widenRow(dialog)).toBeNull(); // le décompte d'avant n'a rien laissé d'« écoulé »
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull();
    elapse(1);
    expect(widenRow(dialog)).not.toBeNull();
  });

  it('une fois la ligne revenue, vider puis retaper la saisie demande un nouveau délai complet', async () => {
    holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();

    typeNow(dialog, '');
    expect(widenRow(dialog)).toBeNull();
    typeNow(dialog, '38k.6');

    expect(widenRow(dialog)).toBeNull(); // l'attente d'avant est finie : celle-ci repart de zéro
    elapse(WIDEN_AFTER_MS - 1);
    expect(widenRow(dialog)).toBeNull();
    elapse(1);
    expect(widenRow(dialog)).not.toBeNull();
  });

  it('si l’échec n’arrive qu’après le retour de la ligne, « Réessayer » prend la sélection : c’est elle, la première ligne', async () => {
    const release = holdIssueLists(
      stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } }),
    );
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();

    await release(); // la lecture finit par échouer, après le délai

    const retry = await within(dialog).findByRole('option', { name: /Réessayer/ });
    await waitFor(() => expect(selected(retry)).toBe(true));
    expect(within(dialog).getAllByRole('option')[0]).toBe(retry);
    expect(selected(widenOption(dialog))).toBe(false);
  });
});

describe('le Projet courant répond autrement que par une liste (gardes issues des sondes de la relecture)', () => {
  it('tickets en échec : « Réessayer » en tête, puis « Chercher … dans tous les Projets », sans attendre', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });
    const { dialog, user } = await openPalette('/p/bdesk/metrics');
    await user.keyboard('38k.6');

    const retry = await within(dialog).findByRole('option', { name: /Réessayer/ });
    await waitFor(() => expect(selected(retry)).toBe(true));
    expect(within(dialog).getAllByRole('option').map((row) => row.textContent)).toEqual([
      expect.stringContaining('Réessayer'),
      expect.stringContaining('dans tous les Projets'),
    ]);
  });

  it('Projet sans aucun ticket : « Chercher … dans tous les Projets » est la seule ligne, et la sélectionnée', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: mpmIssues } });
    const { dialog, user } = await openPalette('/p/bdesk/metrics');
    await user.keyboard('mpm-12');

    const widen = await within(dialog).findByRole('option', { name: /dans tous les Projets/ });
    await waitFor(() => expect(selected(widen)).toBe(true));
    expect(within(dialog).getAllByRole('option')).toHaveLength(1);
  });
});

describe('Entrée pressée avant l’arrivée des tickets : elle ouvre le ticket tapé à leur arrivée', () => {
  it('un id collé puis Entrée : rien ne s’ouvre d’abord, le ticket s’ouvre quand les tickets arrivent', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');

    await user.keyboard('{Enter}');

    expect(pathname(router)).toBe('/p/bdesk/metrics'); // rien à ouvrir encore
    expect(within(dialog).getByText('Chargement des tickets…')).toBeTruthy();

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('l’id d’une Epic ouvre la page Epics sur elle, comme sa ligne', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k');
    await user.keyboard('{Enter}');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/epics?epic=bdesk-38k'));
  });

  it('l’id d’un ticket d’un autre Projet, sur la Vue globale, s’ouvre quand sa liste arrive', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { user, router } = await openPalette('/');
    fakeClock();
    await user.paste('mpm-12');
    await user.keyboard('{Enter}');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
  });

  it('même quand « Chercher … dans tous les Projets » est revenue entre-temps, le ticket tapé s’ouvre à l’arrivée des tickets', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');
    elapse(WIDEN_AFTER_MS);
    expect(widenRow(dialog)).not.toBeNull();
    expect(pathname(router)).toBe('/p/bdesk/metrics');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('Entrée pressée quand la ligne est revenue sans être choisie ne l’active pas : la demande est retenue', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(selected(widenOption(dialog))).toBe(false);

    await user.keyboard('{Enter}');

    expect(within(dialog).queryByText('Tous les Projets')).toBeNull(); // la portée de la recherche n'a pas changé
    expect(pathname(router)).toBe('/p/bdesk/metrics');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('élargir à la flèche fait tomber la demande : Entrée élargit, le ticket de l’autre Projet attend un Entrée de plus', async () => {
    holdIssueLists(stubDefaultApi(), ['bdesk']); // la liste du Projet courant ne répond jamais
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('mpm-12');
    await user.keyboard('{Enter}');
    elapse(WIDEN_AFTER_MS);
    await user.keyboard('{ArrowDown}');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

    await user.keyboard('{Enter}'); // la ligne « Chercher … » est choisie : elle élargit, et rien de plus

    const found = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(found)).toBe(true));
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
  });

  it('un id qui n’est pas exactement celui d’un ticket n’ouvre rien : « 38k.6 » le retrouve, un second Entrée l’ouvre', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('38k.6');
    await user.keyboard('{Enter}');

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    expect(screen.getByRole('dialog', { name: 'Palette de commandes' })).toBeTruthy();

    await user.keyboard('{Enter}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('un id partagé par deux Projets est ambigu : rien ne s’ouvre, les deux lignes sont là', async () => {
    const twin = (title: string) => issue({ id: 'dup-1', title });
    const fetchMock = stubApi({
      projects: projectsResponse,
      issues: { bdesk: [...bdeskIssues, twin('Doublon côté beads-desktop')], mpm: [...mpmIssues, twin('Doublon côté My-Prompt-Manager')] },
    });
    const release = holdIssueLists(fetchMock);
    const { dialog, user, router } = await openPalette('/');
    fakeClock();
    await user.paste('dup-1');
    await user.keyboard('{Enter}');

    await release();

    expect(await within(dialog).findAllByRole('option', { name: /dup-1/ })).toHaveLength(2);
    expect(pathname(router)).toBe('/');
  });

  it('changer la saisie annule : le texte rétabli ensuite n’est pas la même demande', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');

    await user.keyboard('x{Backspace}'); // le texte d'avant Entrée est rétabli, mais Entrée, elle, a eu lieu sur un autre texte

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    expect(pathname(router)).toBe('/p/bdesk/metrics');
  });

  it('une autre saisie, même l’id exact d’un autre ticket, n’hérite pas de la demande', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');

    await user.clear(within(dialog).getByRole('combobox'));
    await user.paste('bdesk-38k.7');
    await release();

    const other = await within(dialog).findByRole('option', { name: /Kanban par Projet/ });
    await waitFor(() => expect(selected(other)).toBe(true));
    expect(pathname(router)).toBe('/p/bdesk/metrics');
  });

  it('seule la touche Entrée demande : une autre touche, avec l’id tapé, n’ouvre rien à l’arrivée des tickets', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.keyboard('bdesk-38k.6');
    await user.keyboard('{ArrowDown}');

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    expect(pathname(router)).toBe('/p/bdesk/metrics');
  });

  it('la casse ne compte pas : « BDESK-38K.6 » ouvre bdesk-38k.6', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('BDESK-38K.6');
    await user.keyboard('{Enter}');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('elle ne vaut que pour la première réponse : un ticket qui prend cet id plus tard ne s’ouvre pas', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user, router, queryClient } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-99z');
    await user.keyboard('{Enter}');
    await release();
    const widen = await within(dialog).findByRole('option', { name: /dans tous les Projets/ }); // aucun ticket ne porte cet id
    await waitFor(() => expect(selected(widen)).toBe(true));

    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), {
        issues: [...bdeskIssues, issue({ id: 'bdesk-99z', title: 'Arrivé après coup' })],
      });
    });

    await within(dialog).findByRole('option', { name: /Arrivé après coup/ });
    expect(pathname(router)).toBe('/p/bdesk/metrics');
  });
});

describe('Entrée retenue : une ligne sélectionnée la fait tomber, car Entrée prendrait celle-là', () => {
  /** Entrée retenue sur un id collé, la liste du Projet courant tarde, et la ligne « Chercher … » est revenue (non choisie). */
  async function heldWithLineBack() {
    const release = holdIssueLists(stubDefaultApi());
    const palette = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await palette.user.paste('bdesk-38k.6');
    await palette.user.keyboard('{Enter}');
    elapse(WIDEN_AFTER_MS);
    expect(selected(widenOption(palette.dialog))).toBe(false);
    return { ...palette, release };
  }

  it.each(['ArrowDown', 'ArrowUp', 'Home', 'End'])(
    'la touche %s qui choisit la ligne revenue : à l’arrivée des tickets rien ne s’ouvre, et le choix tient',
    async (key) => {
      const { dialog, router, release } = await heldWithLineBack();
      pressNow(dialog, key);
      await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

      await release();

      const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
      await settle();
      expect(pathname(router)).toBe('/p/bdesk/metrics');
      expect(selected(widenOption(dialog))).toBe(true);
      expect(selected(ticket)).toBe(false);
    },
  );

  it('le survol qui choisit la ligne revenue : à l’arrivée des tickets rien ne s’ouvre, et le choix tient', async () => {
    const { dialog, user, router, release } = await heldWithLineBack();
    await user.hover(widenOption(dialog));
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    expect(selected(widenOption(dialog))).toBe(true);
    expect(selected(ticket)).toBe(false);
  });

  it('un clic sur la ligne revenue élargit la recherche et fait tomber la demande : le ticket attend Entrée', async () => {
    const { dialog, user, router, release } = await heldWithLineBack();

    await user.click(widenOption(dialog));
    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('un survol et un clic dans le même instant (un pilote automatique) : la sélection ne reste pas sur la ligne disparue', async () => {
    const { dialog, user, router, release } = await heldWithLineBack();
    const line = widenOption(dialog);

    act(() => {
      fireEvent.pointerMove(line); // la souris arrive sur la ligne et clique avant le rendu du survol
      fireEvent.click(line);
    });
    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await waitFor(() => expect(selected(ticket)).toBe(true)); // les tickets prennent la sélection, comme après un clic d'une main
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });

  it('une ligne sélectionnée d’office la fait tomber aussi : Entrée prendrait celle-là, pas le ticket qui arrive ensuite', async () => {
    const fetchMock = stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues, mpm: [...mpmIssues, issue({ id: 'mpm-99', title: 'Suite de bdesk-38k' })] },
    });
    const releaseMpm = holdIssueLists(fetchMock, ['mpm']);
    const releaseBdesk = holdIssueLists(fetchMock, ['bdesk']);
    const { dialog, user, router } = await openPalette('/');
    fakeClock();
    await user.paste('bdesk-38k');
    await user.keyboard('{Enter}');

    await releaseMpm(); // une ligne qui ne porte pas l'id exact arrive la première : cmdk la sélectionne

    const other = await within(dialog).findByRole('option', { name: /mpm-99/ });
    await waitFor(() => expect(selected(other)).toBe(true));
    await releaseBdesk(); // l'Epic dont l'id est exactement la saisie arrive ensuite
    await within(dialog).findByRole('option', { name: /beads-desktop V1/ });
    await settle();
    expect(pathname(router)).toBe('/');
    expect(selected(other)).toBe(true);
  });

  it('elle n’expire pas : une liste qui n’arrive qu’après une minute ouvre encore le ticket tapé', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { user, router } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');
    elapse(60_000);
    expect(pathname(router)).toBe('/p/bdesk/metrics');

    await release();

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });
});

describe.each([
  ['Métriques', '/p/bdesk/metrics'],
  ['la Vue globale', '/'],
])('Entrée pressée avant la liste des Projets (cache froid), sur %s', (_page, path) => {
  it('est retenue comme les autres : le ticket tapé s’ouvre quand les Projets, puis les tickets, arrivent', async () => {
    const release = holdProjects(stubDefaultApi());
    const { user, router } = await openPalette(path);
    fakeClock();
    await user.paste('bdesk-38k.6');

    await user.keyboard('{Enter}');

    expect(pathname(router)).toBe(path); // rien à ouvrir encore
    await release();
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6'));
  });
});

describe('la liste des Projets n’est pas encore là : ni la ligne de repli, ni la demande retenue ne changent', () => {
  it('la ligne « Chercher … » n’est pas proposée tant que les Projets manquent, et son délai court quand les tickets sont demandés', async () => {
    const fetchMock = stubDefaultApi();
    const releaseProjects = holdProjects(fetchMock);
    holdIssueLists(fetchMock, ['bdesk']); // la liste de beads-desktop ne répond jamais
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(3 * WIDEN_AFTER_MS);
    expect(widenRow(dialog)).toBeNull(); // on ne sait pas quels Projets lire, ni s'il y en a d'autres

    await releaseProjects();

    await within(dialog).findByText('Chargement des tickets…'); // les tickets sont demandés : le décompte part
    elapse(WIDEN_AFTER_MS - 500);
    expect(widenRow(dialog)).toBeNull();
    elapse(1_000);
    expect(widenRow(dialog)).not.toBeNull();
  });

  it('la liste des Projets en échec : rien ne s’ouvre, et la demande, tombée, ne revient pas avec les Projets', async () => {
    const release = holdProjects(
      stubApi({ projects: new Error('database is locked'), issues: { bdesk: bdeskIssues, mpm: mpmIssues } }),
    );
    const { dialog, user, router, queryClient } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');

    await release();

    await within(dialog).findByText('Impossible de charger les Projets : le serveur ne répond pas.');
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    act(() => {
      queryClient.setQueryData(queryKeys.projects, projectsResponse); // les Projets reviennent plus tard
    });
    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await settle();
    expect(pathname(router)).toBe('/p/bdesk/metrics');
    expect(selected(ticket)).toBe(true);
  });
});

describe('Entrée pressée quand les tickets sont déjà là : elle ne retient rien', () => {
  it('rien ne correspond, Entrée est sans effet, et un ticket qui prend cet id plus tard ne s’ouvre pas', async () => {
    stubDefaultApi();
    const { dialog, user, router, queryClient } = await openPalette('/');
    await waitFor(() => {
      expect(queryClient.getQueryData(queryKeys.issues('bdesk'))).toBeDefined();
      expect(queryClient.getQueryData(queryKeys.issues('mpm'))).toBeDefined();
    });
    await user.paste('bdesk-99z');
    await within(dialog).findByText('Aucun résultat pour « bdesk-99z ».');

    await user.keyboard('{Enter}');
    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), {
        issues: [...bdeskIssues, issue({ id: 'bdesk-99z', title: 'Arrivé après coup' })],
      });
    });

    await within(dialog).findByRole('option', { name: /Arrivé après coup/ });
    expect(pathname(router)).toBe('/');
  });
});

describe('Entrée pressée avant l’arrivée des tickets : fermer la palette annule, même encore montée pour sa sortie', () => {
  const exit = withHeldExitAnimations();

  it('Échap puis l’arrivée des tickets : la palette se retire, rien ne s’ouvre', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog: palette, user, router, queryClient } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    await user.paste('bdesk-38k.6');
    await user.keyboard('{Enter}');

    await user.keyboard('{Escape}');

    // L'état à tester : la palette est fermée mais encore montée, avec son intention et sa saisie.
    expect(palette.getAttribute('data-state')).toBe('closed');
    expect(palette.isConnected).toBe(true);

    await release();
    await waitFor(() => expect(queryClient.getQueryData(queryKeys.issues('bdesk'))).toBeDefined());
    await act(async () => undefined); // les effets de l'arrivée ont passé

    expect(pathname(router)).toBe('/p/bdesk/metrics');
    exit.finish();
    expect(screen.queryByRole('dialog', { hidden: true })).toBeNull();
  });
});

/** Une ligne nommée par son texte, pour les messages d'échec. */
const rowName = (row: Element | null | undefined) => `« ${(row?.textContent ?? '').trim().slice(0, 40)} »`;

/** Le texte des lignes sélectionnées (il n'y en a qu'une, ou aucune). */
const selectedRows = (dialog: HTMLElement) =>
  within(dialog)
    .queryAllByRole('option')
    .filter(selected)
    .map((row) => row.textContent ?? '');

/**
 * Ce que `aria-activedescendant` a de faux, vu de l'extérieur. Sur le champ (le combobox, qui garde le focus) comme sur la liste, il doit
 * désigner la ligne sélectionnée, présente dans la liste, et il est absent quand aucune ligne ne l'est. Un id qui ne désigne rien dans
 * la page est la violation `aria-valid-attr-value` d'axe (critique) ; un id qui désigne une autre ligne que celle en surbrillance fait
 * annoncer la mauvaise ligne par le lecteur d'écran ; un id absent alors qu'une ligne est sélectionnée l'en prive. Sélecteurs bruts et non
 * requêtes par rôle : `watchActiveDescendant` l'appelle à chaque changement du DOM.
 */
function activeDescendantProblems(dialog: HTMLElement): string[] {
  const input = dialog.querySelector<HTMLElement>('[role="combobox"]');
  const listbox = dialog.querySelector<HTMLElement>('[role="listbox"]');
  if (!input || !listbox) return ['la palette n’a plus son champ ou sa liste'];
  const chosen = [...listbox.querySelectorAll<HTMLElement>('[role="option"]')].filter(selected);
  const problems = chosen.length > 1 ? [`${chosen.length} lignes sont sélectionnées`] : [];
  for (const [owner, element] of [['le champ', input], ['la liste', listbox]] as const) {
    const id = element.getAttribute('aria-activedescendant');
    const target = id === null ? null : document.getElementById(id);
    if (id === null) {
      if (chosen[0]) problems.push(`${owner} ne désigne rien alors que ${rowName(chosen[0])} est sélectionnée`);
    } else if (!target || !listbox.contains(target)) {
      problems.push(`${owner} désigne « ${id} », qui n’est dans aucune ligne de la liste`);
    } else if (target !== chosen[0]) {
      problems.push(
        chosen[0]
          ? `${owner} désigne ${rowName(target)} alors que ${rowName(chosen[0])} est sélectionnée`
          : `${owner} désigne ${rowName(target)} alors qu’aucune ligne n’est sélectionnée`,
      );
    }
  }
  return problems;
}

/** Laisse passer les effets du rendu, puis vérifie `aria-activedescendant` ; `step` dit où l'on en est si l'assertion échoue. */
async function expectActiveDescendantToFollowSelection(dialog: HTMLElement, step: string) {
  await settle();
  expect(activeDescendantProblems(dialog), step).toEqual([]);
}

/**
 * Vérifie `aria-activedescendant` à chaque changement du DOM de la palette, pas seulement aux étapes du scénario. Créée après l'ouverture
 * de la palette, la veille passe après tout ce que la palette fait elle-même pour le corriger ; `stop` rend les problèmes vus.
 */
function watchActiveDescendant(dialog: HTMLElement) {
  const seen = new Set<string>();
  const watcher = new MutationObserver(() => activeDescendantProblems(dialog).forEach((problem) => seen.add(problem)));
  watcher.observe(dialog, { subtree: true, childList: true, attributes: true });
  return () => {
    watcher.disconnect();
    return [...seen];
  };
}

describe('aria-activedescendant : le champ désigne la ligne sélectionnée, présente dans la liste, et rien quand aucune ne l’est', () => {
  it('à l’ouverture, la première ligne est sélectionnée d’office : le champ la désigne', async () => {
    stubDefaultApi();
    const { dialog } = await openPalette('/p/bdesk/kanban');

    await expectActiveDescendantToFollowSelection(dialog, 'à l’ouverture');
    expect(selectedRows(dialog)).toEqual([expect.stringContaining('Vue globale')]);
  });

  it('Kanban, « bdesk-38k » tapé touche à touche : après chaque caractère, le champ désigne la ligne sélectionnée', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    const stopWatching = watchActiveDescendant(dialog);

    for (const character of 'bdesk-38k') {
      await user.keyboard(character);
      await expectActiveDescendantToFollowSelection(dialog, `après « ${character} »`);
    }

    expect(selectedRows(dialog)).toHaveLength(1);
    expect(stopWatching(), 'à aucun moment entre deux étapes').toEqual([]);
  });

  it('texte collé d’un trait : le champ désigne la première ligne qui s’affiche', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');

    await user.paste('bdesk-38k');

    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await expectActiveDescendantToFollowSelection(dialog, 'après le collage');
    expect(selectedRows(dialog)).toHaveLength(1);
  });

  it('saisie vidée : les lignes du départ reviennent, la première est sélectionnée et le champ la désigne', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k.6');
    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });

    await user.keyboard('{Control>}a{/Control}{Backspace}');

    await waitFor(() => expect(within(dialog).getAllByRole('option')[0]?.textContent).toContain('Vue globale'));
    await expectActiveDescendantToFollowSelection(dialog, 'saisie vidée');
    expect(selectedRows(dialog)).toEqual([expect.stringContaining('Vue globale')]);
  });

  it('flèches, Début, Fin et survol : le champ désigne la ligne choisie', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    await within(dialog).findByRole('option', { name: /Kanban par Projet/ });

    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowUp}', '{End}', '{Home}']) {
      await user.keyboard(key);
      await expectActiveDescendantToFollowSelection(dialog, key);
    }
    await user.hover(within(dialog).getByRole('option', { name: /Kanban par Projet/ }));

    await waitFor(() => expect(selectedRows(dialog)).toEqual([expect.stringContaining('Kanban par Projet')]));
    await expectActiveDescendantToFollowSelection(dialog, 'survol');
  });

  describe('des lignes arrivent et disparaissent', () => {
    it.each([
      ['Métriques', '/p/bdesk/metrics', 'bdesk-38k.6', /Shell UI façon Linear/],
      ['la Vue globale', '/', 'mpm-12', /Recherche plein texte/],
    ])('page %s, tickets lents : la première ligne qui arrive est sélectionnée d’office, le champ la désigne', async (_page, path, typed, name) => {
      const release = holdIssueLists(stubDefaultApi());
      const { dialog, user } = await openPalette(path);
      await user.keyboard(typed);
      const stopWatching = watchActiveDescendant(dialog);

      await release();

      const ticket = await within(dialog).findByRole('option', { name });
      await waitFor(() => expect(selected(ticket)).toBe(true));
      await expectActiveDescendantToFollowSelection(dialog, 'les tickets sont arrivés');
      expect(stopWatching()).toEqual([]);
    });

    it('des lignes arrivent au-dessus de la ligne sélectionnée : le champ désigne toujours celle-ci', async () => {
      const alpha = (id: string, title: string, updatedAt: string) => issue({ id, title, updatedAt });
      const release = holdIssueLists(
        stubApi({
          projects: projectsResponse,
          issues: {
            bdesk: [alpha('bdesk-1', 'Alpha rapport', '2026-10-20T09:00:00Z'), alpha('bdesk-2', 'Alpha rapport bis', '2026-10-19T09:00:00Z')],
            mpm: [alpha('mpm-9', 'Alpha', '2026-10-01T09:00:00Z')],
          },
        }),
        ['mpm'],
      );
      const { dialog, user } = await openPalette('/');
      await user.keyboard('alpha');
      const seen = await within(dialog).findByRole('option', { name: /bdesk-1/ });
      await waitFor(() => expect(selected(seen)).toBe(true));
      await expectActiveDescendantToFollowSelection(dialog, 'avant l’arrivée du second Projet');

      await release();

      await within(dialog).findByRole('option', { name: /mpm-9/ });
      expect(selected(seen)).toBe(true); // la surbrillance ne saute pas (règle de bdesk-38k.21) : le champ doit rester sur elle
      await expectActiveDescendantToFollowSelection(dialog, 'après l’arrivée du second Projet');
    });

    it('la ligne sélectionnée disparaît (la liste change) : la première ligne est sélectionnée d’office et le champ la désigne', async () => {
      stubDefaultApi();
      const { dialog, user, queryClient } = await openPalette('/p/bdesk/kanban');
      await user.keyboard('bdesk');
      const bug = await within(dialog).findByRole('option', { name: /Le graphique du Débit/ });
      await user.hover(bug);
      await waitFor(() => expect(selected(bug)).toBe(true));
      await expectActiveDescendantToFollowSelection(dialog, 'ligne choisie au survol');

      act(() => {
        queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: bdeskIssues.filter((candidate) => candidate.id !== 'bdesk-b7q') });
      });

      await waitFor(() => expect(within(dialog).queryByRole('option', { name: /Le graphique du Débit/ })).toBeNull());
      await expectActiveDescendantToFollowSelection(dialog, 'la ligne choisie a disparu');
      expect(selectedRows(dialog)).toHaveLength(1);
    });
  });

  it('plusieurs lignes disparaissent d’un coup, dont la sélectionnée : la première ligne restante est sélectionnée et le champ la désigne', async () => {
    stubDefaultApi();
    const { dialog, user, queryClient } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk');
    const tickets = await within(dialog).findAllByRole('option', { name: /bdesk-38k\.|bdesk-b7q/ });
    expect(tickets.length).toBeGreaterThan(1);
    await user.hover(tickets[0]!); // la sélectionnée est la première des lignes qui vont partir
    await waitFor(() => expect(selected(tickets[0]!)).toBe(true));

    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: [] }); // un rafraîchissement : tous les tickets du Projet partent à la fois
    });

    await waitFor(() => expect(within(dialog).queryByRole('option', { name: /bdesk-b7q/ })).toBeNull());
    await waitFor(() => expect(selectedRows(dialog)).toHaveLength(1));
    await expectActiveDescendantToFollowSelection(dialog, 'les tickets sont partis');
    expect(within(dialog).getAllByRole('option')[0]).toBe(within(dialog).getAllByRole('option').find(selected));
  });

  it('élargir la recherche à tous les Projets : la ligne de repli, puis le ticket de l’autre Projet, sont désignés', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    const stopWatching = watchActiveDescendant(dialog);
    await user.keyboard('mpm-12');
    await within(dialog).findByRole('option', { name: /dans tous les Projets/ });
    await expectActiveDescendantToFollowSelection(dialog, 'ligne de repli sélectionnée d’office');
    expect(selectedRows(dialog)).toEqual([expect.stringContaining('dans tous les Projets')]);

    await user.keyboard('{Enter}');

    const ticket = await within(dialog).findByRole('option', { name: /Recherche plein texte/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    await expectActiveDescendantToFollowSelection(dialog, 'recherche élargie');
    expect(stopWatching()).toEqual([]);
  });

  it('aucune ligne sélectionnée (la ligne de repli, revenue en retrait) : le champ ne désigne rien, puis la ligne choisie', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog } = await openPalette('/p/bdesk/metrics');
    fakeClock();
    typeNow(dialog, '38k.6');
    elapse(WIDEN_AFTER_MS);
    expect(selectedRows(dialog)).toEqual([]);
    await expectActiveDescendantToFollowSelection(dialog, 'ligne revenue, non sélectionnée');
    expect(within(dialog).getByRole('combobox').hasAttribute('aria-activedescendant')).toBe(false);

    pressNow(dialog, 'ArrowDown');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));
    await expectActiveDescendantToFollowSelection(dialog, 'ligne choisie à la flèche');
    expect(within(dialog).getByRole('combobox').getAttribute('aria-activedescendant')).toBe(widenOption(dialog).id);

    await release();

    const ticket = await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    expect(selected(widenOption(dialog))).toBe(true); // le choix tient
    expect(selected(ticket)).toBe(false);
    await expectActiveDescendantToFollowSelection(dialog, 'les tickets sont arrivés');
  });

  it('mode « changer de Projet » : le premier Projet lisible est sélectionné, le champ le désigne', async () => {
    const [bdesk, mpm, legacy] = projects;
    if (!bdesk || !mpm || !legacy) throw new Error('Les Projets de test manquent.');
    stubApi({ projects: { projects: [legacy, bdesk, mpm], ignored: [] }, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const { user } = renderApp('/p/mpm/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('gp');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await within(dialog).findAllByRole('option');

    await expectActiveDescendantToFollowSelection(dialog, 'Projets');
    expect(selectedRows(dialog)).toEqual([expect.stringContaining('beads-desktop')]);
  });

  it('« Réessayer » en tête quand les tickets d’un Projet sont indisponibles : le champ le désigne', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked'), mpm: mpmIssues } });
    const { dialog, user } = await openPalette('/');
    await user.keyboard('zzzz');
    const retry = await within(dialog).findByRole('option', { name: /Réessayer/ });
    await waitFor(() => expect(selected(retry)).toBe(true));

    await expectActiveDescendantToFollowSelection(dialog, 'Réessayer');
  });

  it('sous StrictMode (comme en développement, où React rejoue les effets au montage), le champ désigne la ligne sélectionnée', async () => {
    stubDefaultApi();
    const router = createMemoryRouter(routes, { initialEntries: ['/p/bdesk/kanban'] });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await expectActiveDescendantToFollowSelection(dialog, 'à l’ouverture');

    for (const character of 'bdesk-38k') {
      await user.keyboard(character);
      await expectActiveDescendantToFollowSelection(dialog, `après « ${character} »`);
    }

    expect(selectedRows(dialog)).toHaveLength(1);
  });

  it('refermée puis rouverte, la palette désigne encore la bonne ligne', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog.isConnected).toBe(false));

    await user.keyboard('{Control>}k{/Control}');

    const reopened = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await expectActiveDescendantToFollowSelection(reopened, 'rouverte');
    expect(selectedRows(reopened)).toHaveLength(1);
    await user.keyboard('bdesk');
    await expectActiveDescendantToFollowSelection(reopened, 'rouverte, puis saisie');
  });
});

describe('survol d’une ligne que la liste retire dans le même instant (un rafraîchissement des tickets)', () => {
  it('la première ligne est sélectionnée, comme quand la ligne sélectionnée disparaît : la sélection ne reste pas sur la ligne retirée', async () => {
    stubDefaultApi();
    const { dialog, user, queryClient } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk');
    const bug = await within(dialog).findByRole('option', { name: /Le graphique du Débit/ });
    fakeClock();

    act(() => {
      fireEvent.pointerMove(bug); // le survol arrive avec une priorité « continue » : après le rendu, immédiat, de la liste qui change
      queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: bdeskIssues.filter((candidate) => candidate.id !== 'bdesk-b7q') });
      vi.advanceTimersByTime(0); // TanStack Query prévient les composants une minuterie plus tard
    });

    await waitFor(() => expect(within(dialog).queryByRole('option', { name: /Le graphique du Débit/ })).toBeNull());
    await waitFor(() => expect(selectedRows(dialog)).toHaveLength(1));
    await expectActiveDescendantToFollowSelection(dialog, 'la ligne survolée a été retirée');
    expect(within(dialog).getAllByRole('option')[0]).toBe(within(dialog).getAllByRole('option').find(selected));
  });

  it('en mode « changer de Projet », la ligne reprise est la première activable : le Projet illisible placé en tête n’est pas choisi', async () => {
    const [bdesk, mpm, legacy] = projects;
    if (!bdesk || !mpm || !legacy) throw new Error('Les Projets de test manquent.');
    stubApi({ projects: { projects: [legacy, bdesk, mpm], ignored: [] }, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
    const { user, queryClient } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('gp');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    const row = await within(dialog).findByRole('option', { name: /My-Prompt-Manager/ });
    fakeClock();

    act(() => {
      fireEvent.pointerMove(row);
      queryClient.setQueryData(queryKeys.projects, { projects: [legacy, bdesk], ignored: [] }); // la liste des Projets change dans le même instant
      vi.advanceTimersByTime(0);
    });

    await waitFor(() => expect(within(dialog).queryByRole('option', { name: /My-Prompt-Manager/ })).toBeNull());
    await waitFor(() => expect(selectedRows(dialog)).toEqual([expect.stringContaining('beads-desktop')]));
    await expectActiveDescendantToFollowSelection(dialog, 'le Projet survolé a été retiré');
  });
});

describe('survol et clic quasi simultanés sur « Chercher … dans tous les Projets », les tickets de l’autre Projet étant déjà en cache', () => {
  it('le ticket arrivé est sélectionné et désigné, Entrée l’ouvre : la sélection ne reste pas sur la ligne disparue', async () => {
    const release = holdIssueLists(stubDefaultApi(), ['bdesk']); // la liste du Projet courant tarde : la ligne de repli revient
    const { dialog, user, router, queryClient } = await openPalette('/p/bdesk/metrics');
    await act(() => queryClient.prefetchQuery(issuesQuery('mpm'))); // une visite de l'autre Projet les a laissés en cache
    fakeClock();
    typeNow(dialog, 'mpm-12');
    elapse(WIDEN_AFTER_MS);
    const line = widenOption(dialog);
    expect(selected(line)).toBe(false);

    act(() => {
      fireEvent.pointerMove(line); // la souris arrive sur la ligne et clique avant le rendu du survol : un pilote automatique
      fireEvent.click(line);
    });

    const ticket = await within(dialog).findByRole('option', { name: /mpm-12/ });
    await waitFor(() => expect(selected(ticket)).toBe(true));
    expect(selectedRows(dialog)).toHaveLength(1);
    await expectActiveDescendantToFollowSelection(dialog, 'recherche élargie');
    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/mpm/t/mpm-12'));
    await release();
  });
});

describe('la ligne sélectionnée est amenée dans la zone visible de la liste : celle qui l’est vraiment, pas celle que cmdk lisait avant son rendu', () => {
  // jsdom ne fait pas de mise en page : « la ligne est visible » ne s'y mesure pas. On y vérifie ce qui y mène, sur quoi la liste est invitée à
  // défiler (`scrollIntoView`, espionné) ; la mise en page réelle a été mesurée dans un navigateur (bdesk-38k.41). cmdk 1.1.1 défile lui-même
  // après chaque choix qui n'est pas un survol, mais vers la ligne que le DOM montrait sélectionnée à cet instant : après une sélection
  // d'office, c'est celle d'avant (voir `useSelectionInView`). Le dernier appel est donc celui qui compte.
  let scrolls: { target: Element; options: unknown }[] = [];
  let scrollSpy: { mockRestore: () => void };
  beforeEach(() => {
    scrolls = [];
    scrollSpy = vi.spyOn(Element.prototype, 'scrollIntoView').mockImplementation(function (this: Element, options?: boolean | ScrollIntoViewOptions) {
      scrolls.push({ target: this, options });
    });
  });
  afterEach(() => {
    scrollSpy.mockRestore();
  });

  /** Ce que désigne un élément : la valeur de sa ligne, ou son en-tête de groupe. */
  const valueOf = (element: Element | null | undefined) =>
    element ? (element.getAttribute('data-value') ?? `en-tête « ${element.textContent} »`) : undefined;
  /** Sur quoi la liste a été invitée à défiler en dernier. */
  const lastScrolled = () => valueOf(scrolls.at(-1)?.target);
  const chosen = (dialog: HTMLElement) => within(dialog).queryAllByRole('option').find(selected);
  const rowOf = (dialog: HTMLElement, value: string) => dialog.querySelector<HTMLElement>(`[cmdk-item][data-value="${value}"]`)!;

  /** Tape `text` touche à touche : chaque fois que la ligne sélectionnée change, la liste a été invitée à défiler vers elle en dernier. */
  async function typeAndExpectChosenRowRevealed(dialog: HTMLElement, user: ReturnType<typeof userEvent.setup>, text: string) {
    for (const character of text) {
      const before = chosen(dialog);
      scrolls = [];
      await user.keyboard(character);
      await settle();
      const now = chosen(dialog);
      expect(now, `une ligne est sélectionnée après « ${character} »`).toBeDefined();
      if (now !== before) expect(lastScrolled(), `après « ${character} »`).toBe(valueOf(now));
    }
  }

  it('les tickets arrivent sous la ligne sélectionnée, puis la frappe suivante en choisit une autre d’office : c’est la nouvelle qui est amenée', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk');
    await waitFor(() => expect(selected(rowOf(dialog, 'project:bdesk'))).toBe(true));
    await release();
    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    expect(selected(rowOf(dialog, 'project:bdesk'))).toBe(true); // la surbrillance ne saute pas à l'arrivée des tickets (règle de bdesk-38k.21)
    scrolls = [];

    await user.keyboard('-'); // « bdesk- » : l'Epic passe devant le Projet, qui reste dans la liste, plus bas

    await waitFor(() => expect(selected(rowOf(dialog, 'epic:bdesk/bdesk-38k'))).toBe(true));
    await settle();
    expect(lastScrolled()).toBe('epic:bdesk/bdesk-38k');
  });

  it('Fin sélectionne la dernière ligne, puis la frappe suivante sélectionne d’office la première : elle est amenée, la liste ne reste pas en bas', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk-3');
    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await user.keyboard('{End}');
    await waitFor(() => expect(selected(widenOption(dialog))).toBe(true));
    scrolls = [];

    await user.keyboard('8');

    await waitFor(() => expect(selected(rowOf(dialog, 'epic:bdesk/bdesk-38k'))).toBe(true));
    await settle();
    expect(lastScrolled()).toBe('epic:bdesk/bdesk-38k');
  });

  it('Kanban, « bdesk-38k » tapé touche à touche : à chaque changement de la ligne sélectionnée, c’est vers elle que la liste est invitée à défiler', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');

    await typeAndExpectChosenRowRevealed(dialog, user, 'bdesk-38k');

    expect(chosen(dialog)?.getAttribute('data-value')).toBe('epic:bdesk/bdesk-38k');
  });

  it('sous StrictMode (comme en développement, où React rejoue les effets au montage), la ligne sélectionnée est amenée de même', async () => {
    stubDefaultApi();
    const router = createMemoryRouter(routes, { initialEntries: ['/p/bdesk/kanban'] });
    const user = userEvent.setup();
    render(
      <StrictMode>
        <QueryClientProvider client={new QueryClient({ defaultOptions: { queries: { retry: false } } })}>
          <ThemeProvider>
            <RouterProvider router={router} />
          </ThemeProvider>
        </QueryClientProvider>
      </StrictMode>,
    );
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    await typeAndExpectChosenRowRevealed(dialog, user, 'bdesk-38k');

    expect(chosen(dialog)?.getAttribute('data-value')).toBe('epic:bdesk/bdesk-38k');
  });

  it('refermée puis rouverte, la palette amène encore la ligne sélectionnée', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    await user.keyboard('{Escape}');
    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await user.keyboard('{Control>}k{/Control}');
    const reopened = await screen.findByRole('dialog', { name: 'Palette de commandes' });

    await typeAndExpectChosenRowRevealed(reopened, user, 'bdesk-38k');
  });

  it('plusieurs lignes disparaissent d’un coup, dont la sélectionnée : la première ligne restante, choisie par la palette, est amenée', async () => {
    stubDefaultApi();
    const { dialog, user, queryClient } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk');
    const tickets = await within(dialog).findAllByRole('option', { name: /bdesk-38k\.|bdesk-b7q/ });
    await user.hover(tickets[0]!); // la sélectionnée est la première des lignes qui vont partir
    await waitFor(() => expect(selected(tickets[0]!)).toBe(true));
    scrolls = [];

    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: [] }); // un rafraîchissement : tous les tickets du Projet partent à la fois
    });

    await waitFor(() => expect(within(dialog).queryByRole('option', { name: /bdesk-b7q/ })).toBeNull());
    await waitFor(() => expect(chosen(dialog)).toBeDefined());
    await settle();
    expect(chosen(dialog)?.getAttribute('data-value')).toBe('project:bdesk');
    expect(lastScrolled()).toBe('project:bdesk');
  });

  it('flèches, Début, Fin, et le bouclage de la liste : chaque ligne choisie au clavier est amenée', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    await within(dialog).findByRole('option', { name: /Kanban par Projet/ });

    for (const key of ['{ArrowDown}', '{ArrowDown}', '{ArrowUp}', '{End}', '{ArrowDown}', '{ArrowUp}', '{Home}']) {
      scrolls = [];
      await user.keyboard(key);
      await settle();
      expect(lastScrolled(), key).toBe(valueOf(chosen(dialog)));
    }
  });

  it('le survol sélectionne la ligne sans faire défiler la liste ; une flèche, ensuite, amène la ligne qu’elle choisit', async () => {
    stubDefaultApi();
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    const row = await within(dialog).findByRole('option', { name: /Kanban par Projet/ });
    scrolls = [];

    await user.hover(row);

    await waitFor(() => expect(selected(row)).toBe(true));
    await settle();
    expect(scrolls.map(({ target }) => valueOf(target))).toEqual([]);

    await user.keyboard('{ArrowDown}');

    await settle();
    expect(chosen(dialog)).not.toBe(row);
    expect(lastScrolled()).toBe(valueOf(chosen(dialog)));
  });

  it('des tickets arrivent sans changer la ligne sélectionnée : la liste n’est pas invitée à défiler', async () => {
    const release = holdIssueLists(stubDefaultApi());
    const { dialog, user } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('bdesk');
    await waitFor(() => expect(selected(rowOf(dialog, 'project:bdesk'))).toBe(true));
    scrolls = [];

    await release();
    await within(dialog).findByRole('option', { name: /Shell UI façon Linear/ });
    await settle();

    expect(scrolls.map(({ target }) => valueOf(target))).toEqual([]);
  });

  it('un rafraîchissement retire la ligne sélectionnée : la nouvelle sélection est amenée, même choisie ailleurs dans la liste ; un autre rafraîchissement autour d’elle ne fait rien défiler', async () => {
    stubDefaultApi();
    const { dialog, user, queryClient } = await openPalette('/p/bdesk/kanban');
    await user.keyboard('38k');
    await within(dialog).findByRole('option', { name: /Kanban par Projet/ });
    for (let press = 0; press < 10 && chosen(dialog)?.getAttribute('data-value') !== 'issue:bdesk/bdesk-38k.7'; press++) {
      await user.keyboard('{ArrowDown}');
    }
    expect(chosen(dialog)?.getAttribute('data-value')).toBe('issue:bdesk/bdesk-38k.7'); // choisie au clavier, loin de la première ligne
    scrolls = [];

    const withoutIt = bdeskIssues.filter(({ id }) => id !== 'bdesk-38k.7');
    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: withoutIt }); // un rafraîchissement l'a retirée
    });

    await waitFor(() => expect(within(dialog).queryByRole('option', { name: /Kanban par Projet/ })).toBeNull());
    await waitFor(() => expect(chosen(dialog)).toBeDefined());
    await settle();
    // Le but est que la ligne sélectionnée soit toujours visible : la palette en a choisi une autre (la première), elle est amenée, quel que soit
    // l'endroit où l'utilisateur avait fait défiler la liste (le hook ne lit aucune position).
    expect(chosen(dialog)?.getAttribute('data-value')).toBe('epic:bdesk/bdesk-38k');
    expect(lastScrolled()).toBe('epic:bdesk/bdesk-38k');
    scrolls = [];

    const later = issue({ id: 'bdesk-38k.9', title: 'Un ticket arrivé plus tard' });
    act(() => {
      queryClient.setQueryData(queryKeys.issues('bdesk'), { issues: [...withoutIt, later] }); // un autre rafraîchissement : un ticket arrive, la sélection reste
    });

    await within(dialog).findByRole('option', { name: /Un ticket arrivé plus tard/ });
    await settle();
    expect(chosen(dialog)?.getAttribute('data-value')).toBe('epic:bdesk/bdesk-38k'); // la sélection n'a pas bougé…
    expect(scrolls.map(({ target }) => valueOf(target))).toEqual([]); // … et la liste non plus
  });
});
