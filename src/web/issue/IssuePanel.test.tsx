import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, chronology, issue, issueDetail, mpmIssues, projectsResponse } from '../test/fixtures';
import { failRequests, httpFailure, renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const HOUR = 3_600_000;
const DAY = 24 * HOUR;
/** L'espace insécable que la page Métriques met entre un nombre et son unité (« 1,5 j ») : le panneau écrit les durées comme elle. */
const NBSP = '\u00a0';

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const requested = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([input]) => String(input));
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

/** Le panneau du ticket : une boîte de dialogue nommée par l'identifiant et le titre. */
const openPanel = (title: RegExp | string) => screen.findByRole('dialog', { name: title });

describe('le panneau d’un ticket : son adresse', () => {
  it('s’ouvre sur /p/<projet>/t/<id>, par-dessus le kanban du Projet qui reste en place', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel(/Shell UI façon Linear/);

    expect(within(dialog).getByRole('heading', { level: 2, name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(screen.getByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
    expect(await screen.findByRole('region', { name: 'En cours' })).toBeTruthy();
  });

  it('s’ouvre quand une carte du kanban est ouverte, sans remonter le tableau', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    const board = await screen.findByRole('region', { name: 'En cours' });

    await user.click(within(board).getByRole('link', { name: /Shell UI façon Linear/ }));

    await openPanel(/Shell UI façon Linear/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');
    // Le même tableau, pas un nouveau : ce que l'utilisateur y a fait (ici, un tiroir ouvert) est resté en place.
    expect(screen.getByRole('region', { name: 'En cours' })).toBe(board);
  });

  it('ne charge que la fiche et la chronologie du ticket, jamais la fiche de son parent', async () => {
    const fetchMock = stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await waitFor(() => expect(requested(fetchMock)).toContain('/api/projects/bdesk/issues/bdesk-38k.6/chronology'));

    const urls = requested(fetchMock);
    expect(urls).toContain('/api/projects/bdesk/issues/bdesk-38k.6');
    expect(urls.filter((url) => /issues\/bdesk-38k$/.test(url))).toEqual([]);
  });

  it('donne le Parent avec la fiche, dans la même réponse : pas de ligne qui apparaît après coup', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel(/Shell UI façon Linear/);

    // Dès que le titre est là, le Parent y est aussi : aucun `findBy`, aucune attente.
    const parent = within(dialog).getByRole('link', { name: /^Epic : beads-desktop V1/ });
    expect(parent.getAttribute('href')).toBe('/p/bdesk/t/bdesk-38k');
  });
});

describe('le panneau d’un ticket : l’en-tête', () => {
  it('donne l’identifiant, le titre, le type, la priorité, le statut et l’assigné', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-9', title: 'Un bug urgent', type: 'bug', priority: 0, status: 'in_progress', assignee: 'spartDev' })] },
    });
    renderApp('/p/bdesk/t/bdesk-9');

    const dialog = await openPanel(/Un bug urgent/);

    expect(within(dialog).getByText('bdesk-9')).toBeTruthy();
    expect(within(dialog).getByText('Bug')).toBeTruthy();
    expect(within(dialog).getByText('P0')).toBeTruthy();
    expect(within(dialog).getByText('en cours')).toBeTruthy();
    expect(within(dialog).getByText('spartDev')).toBeTruthy();
  });

  it('ne parle pas d’assigné quand il n’y en a pas', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.7');

    const dialog = await openPanel(/Kanban par Projet/);

    expect(within(dialog).queryByText(/Assigné/)).toBeNull();
  });

  it('montre le parent d’une Epic comme une pastille Epic qui ouvre le ticket de l’Epic', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel(/Shell UI façon Linear/);

    const pill = within(dialog).getByRole('link', { name: /^Epic : beads-desktop V1/ });
    expect(pill.getAttribute('href')).toBe('/p/bdesk/t/bdesk-38k');
  });

  it('dit ce qui retient un ticket en Blocage : les tickets non fermés dont il dépend, cliquables', async () => {
    stubApi({
      projects: projectsResponse,
      issues: {
        bdesk: [
          issue({ id: 'bdesk-1', title: 'Attend deux tickets', blockedBy: ['bdesk-2', 'bdesk-3'] }),
          issue({ id: 'bdesk-2', title: 'Premier bloquant', status: 'in_progress' }),
          issue({ id: 'bdesk-3', title: 'Second bloquant' }),
        ],
      },
    });
    renderApp('/p/bdesk/t/bdesk-1');

    const dialog = await openPanel(/Attend deux tickets/);

    const blocking = within(dialog).getByText(/^Bloqué : attend/).closest('p') as HTMLElement;
    expect(within(blocking).getByRole('link', { name: 'bdesk-2' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-2');
    expect(within(blocking).getByRole('link', { name: 'bdesk-3' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-3');
  });

  it('dit « Statut bloqué » quand le ticket porte ce statut sans dépendance : le Blocage se déduit des dépendances, pas du statut', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Statut posé à la main', status: 'blocked' })] } });
    renderApp('/p/bdesk/t/bdesk-1');

    const dialog = await openPanel(/Statut posé à la main/);

    expect(within(dialog).getByText('Statut bloqué, sans dépendance en suspens')).toBeTruthy();
    expect(within(dialog).queryByText(/^Bloqué : attend/)).toBeNull();
  });

  it('ne dit rien d’un Blocage pour un ticket ouvert ou en cours dont aucune dépendance n’est en suspens', async () => {
    stubApi({
      projects: projectsResponse,
      issues: {
        bdesk: [
          issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }),
          issue({ id: 'bdesk-2', title: 'En cours', status: 'in_progress' }),
          issue({ id: 'bdesk-3', title: 'Rattaché à un agent', status: 'hooked' }),
        ],
      },
    });
    for (const [id, title] of [['bdesk-1', /Prêt à démarrer/], ['bdesk-2', /En cours/], ['bdesk-3', /Rattaché à un agent/]] as const) {
      const { unmount } = renderApp(`/p/bdesk/t/${id}`);
      const dialog = await openPanel(title);

      expect(within(dialog).queryByText(/Bloqué : attend|Statut bloqué/), id).toBeNull();
      unmount();
    }
  });

  it('ne dit rien d’un Blocage pour un ticket fermé, même s’il dépend d’un ticket qui ne l’est pas', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Fermé', status: 'closed', closedAt: '2026-10-05T09:00:00Z', blockedBy: [] })] },
    });
    renderApp('/p/bdesk/t/bdesk-1');

    const dialog = await openPanel(/Fermé/);

    expect(within(dialog).queryByText(/Bloqué/)).toBeNull();
  });
});

describe('le panneau d’un ticket : les états', () => {
  it('annonce le chargement, avec l’identifiant du ticket déjà là', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await screen.findByRole('dialog');
    expect(within(dialog).getByRole('status', { name: 'Chargement du ticket' })).toBeTruthy();
    expect(within(dialog).getByText('bdesk-38k.6')).toBeTruthy();
    await openPanel(/Shell UI façon Linear/);
  });

  it('annonce un ticket introuvable dès la réponse 404, avec le chemin du retour', async () => {
    const fetchMock = stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/inexistant');

    const dialog = await openPanel(/Ticket introuvable/);

    expect(within(dialog).getByRole('heading', { level: 2, name: 'Ticket introuvable' })).toBeTruthy();
    expect(within(dialog).getByText('Aucun ticket « inexistant » dans beads-desktop')).toBeTruthy();
    expect(requested(fetchMock).filter((url) => url.endsWith('/issues/inexistant'))).toHaveLength(1);
    await user.click(within(dialog).getByRole('button', { name: 'Retour au kanban' }));
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });

  it('titre « Projet illisible » un 503 avec raison, et laisse réessayer', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      details: {
        'bdesk/bdesk-38k.6': httpFailure(503, {
          statusCode: 503,
          error: 'Service Unavailable',
          message: 'Projet illisible : bdesk (Base Dolt verrouillée)',
          reason: 'Base Dolt verrouillée',
        }),
      },
    });
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');

    const alert = await within(await screen.findByRole('dialog')).findByRole('alert');
    expect(alert.querySelector('p')?.textContent).toBe('Projet illisible');
    expect(alert.textContent).toContain('Base Dolt verrouillée');

    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-38k.6', title: 'Shell UI rétabli' })] } });
    await user.click(within(alert).getByRole('button', { name: /Réessayer/ }));

    expect(await openPanel(/Shell UI rétabli/)).toBeTruthy();
  });

  it('garde une page d’erreur utile pour une panne serveur (500)', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: new Error('database is locked') } });
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const alert = await within(await screen.findByRole('dialog')).findByRole('alert');
    expect(within(alert).getByText('Impossible de charger le ticket')).toBeTruthy();
    expect(within(alert).getByText('database is locked')).toBeTruthy();
  });
});

describe('le panneau d’un ticket : jamais de titre vide (bdesk-38k.25)', () => {
  /**
   * Les titres du panneau qui n'ont pas de nom accessible. Un titre vide est une violation d'accessibilité (axe `empty-heading`) :
   * le squelette du titre, posé dans le `<h2>` pendant le chargement de la fiche, en faisait un.
   */
  const unnamedHeadings = (dialog: HTMLElement) => {
    const named = within(dialog).queryAllByRole('heading', { name: /\S/ });
    return within(dialog)
      .queryAllByRole('heading')
      .filter((heading) => !named.includes(heading));
  };
  /** Ce qui nomme le dialogue (`aria-labelledby`) : chaque élément désigné doit exister, sinon le nom se déduit d'un titre absent. */
  const namingElements = (dialog: HTMLElement) =>
    (dialog.getAttribute('aria-labelledby') ?? '')
      .split(/\s+/)
      .filter(Boolean)
      .map((id) => document.getElementById(id));
  /** La fiche du ticket est lente à arriver : sa réponse, et elle seule (ni la liste, ni la chronologie), attend `release()`. */
  function holdDetail(fetchMock: ReturnType<typeof stubApi>) {
    const healthy = fetchMock.getMockImplementation();
    if (!healthy) throw new Error('holdDetail attend le mock renvoyé par stubApi.');
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (/\/issues\/[^/]+$/.test(String(input))) await gate;
      return healthy(input);
    });
    return release;
  }

  it('tant que la fiche charge, n’a aucun titre vide : le dialogue se nomme par l’identifiant du ticket, déjà connu par l’adresse', async () => {
    const fetchMock = stubDefaultApi();
    const release = holdDetail(fetchMock);
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });

    expect(within(loading).getByRole('status', { name: 'Chargement du ticket' })).toBeTruthy();
    expect(unnamedHeadings(loading)).toEqual([]);
    expect(namingElements(loading)).not.toContain(null);

    release();
    const loaded = await openPanel(/^bdesk-38k\.6 Shell UI façon Linear/);
    expect(within(loaded).getByRole('heading', { level: 2, name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(unnamedHeadings(loaded)).toEqual([]);
    expect(namingElements(loaded)).toHaveLength(2); // l'identifiant et le titre, tous deux là
    expect(namingElements(loaded)).not.toContain(null);
  });

  it('en passant à un autre ticket depuis le panneau, ne garde pas le titre de l’ancien et n’en rend pas un vide pendant le chargement', async () => {
    const fetchMock = stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    const first = await openPanel(/Shell UI façon Linear/);
    const release = holdDetail(fetchMock);

    await user.click(within(first).getByRole('link', { name: /^Epic : beads-desktop V1/ }));

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k' });
    expect(within(loading).getByRole('status', { name: 'Chargement du ticket' })).toBeTruthy();
    expect(within(loading).queryByText(/Shell UI façon Linear/)).toBeNull();
    expect(unnamedHeadings(loading)).toEqual([]);
    expect(namingElements(loading)).not.toContain(null);

    release();
    await openPanel(/^bdesk-38k beads-desktop V1/);
  });

  it('quand on réessaie après un échec, redevient un panneau qui charge, sans titre vide ni « Ticket indisponible » périmé, puis donne le titre', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues }, details: { 'bdesk/bdesk-38k.6': new Error('database is locked') } });
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    const failed = await openPanel(/Ticket indisponible/);
    const release = holdDetail(stubDefaultApi()); // le serveur est rétabli, mais lent

    await user.click(within(failed).getByRole('button', { name: /Réessayer/ }));

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    expect(within(loading).getByRole('status', { name: 'Chargement du ticket' })).toBeTruthy();
    expect(within(loading).queryByText('Ticket indisponible')).toBeNull();
    expect(unnamedHeadings(loading)).toEqual([]);
    expect(namingElements(loading)).not.toContain(null);

    release();
    await openPanel(/^bdesk-38k\.6 Shell UI façon Linear/);
  });

  it('quand la fiche ne peut pas être lue (500), dit « Ticket indisponible » dans un titre nommé : le dialogue se nomme par l’identifiant et ce titre', async () => {
    // La fiche seule échoue (500) ; la liste des tickets du Projet, elle, se lit : en faisant échouer la liste, le faux serveur ferait échouer la fiche par ricochet.
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues }, details: { 'bdesk/bdesk-38k.6': new Error('database is locked') } });
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel('bdesk-38k.6 Ticket indisponible');

    expect(within(dialog).getByRole('heading', { level: 2, name: 'Ticket indisponible' })).toBeTruthy();
    expect(within(dialog).getByRole('alert')).toBeTruthy();
    expect(unnamedHeadings(dialog)).toEqual([]);
    expect(namingElements(dialog)).toHaveLength(2);
    expect(namingElements(dialog)).not.toContain(null);
    expect(await screen.findByRole('region', { name: 'En cours' })).toBeTruthy(); // le tableau dessous se lit : seule la fiche est en échec
  });

  it('quand le ticket n’existe pas (404), dit « Ticket introuvable » dans un titre nommé : le dialogue se nomme par l’identifiant et ce titre', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/inexistant');

    const dialog = await openPanel('inexistant Ticket introuvable');

    expect(within(dialog).getByRole('heading', { level: 2, name: 'Ticket introuvable' })).toBeTruthy();
    expect(unnamedHeadings(dialog)).toEqual([]);
    expect(namingElements(dialog)).toHaveLength(2);
    expect(namingElements(dialog)).not.toContain(null);
  });
});

describe('le panneau d’un ticket : un rafraîchissement qui échoue', () => {
  /** Le serveur rend le ticket introuvable ou flanche au prochain rafraîchissement ; les données en cache restent. */
  async function refresh(app: ReturnType<typeof renderApp>, fetchMock: ReturnType<typeof stubApi>, reply: Response | 'down') {
    const repair =
      reply === 'down'
        ? failRequests(fetchMock, (url) => url.endsWith('/issues/bdesk-38k.6'))
        : (() => {
            const healthy = fetchMock.getMockImplementation();
            if (!healthy) throw new Error('refresh attend le mock renvoyé par stubApi.');
            fetchMock.mockImplementation(async (input) => (String(input).endsWith('/issues/bdesk-38k.6') ? reply.clone() : healthy(input)));
            return () => void fetchMock.mockImplementation(healthy);
          })();
    await act(() => app.queryClient.refetchQueries({ queryKey: queryKeys.issue('bdesk', 'bdesk-38k.6'), exact: true }).catch(() => undefined));
    await waitFor(() => expect(app.queryClient.getQueryState(queryKeys.issue('bdesk', 'bdesk-38k.6'))?.status).toBe('error'));
    return repair;
  }
  const gone = () =>
    new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'Ticket inconnu dans bdesk : bdesk-38k.6' }), {
      status: 404,
      headers: { 'Content-Type': 'application/json' },
    });

  it('affiche « Ticket introuvable » quand le ticket a été supprimé, et non le bandeau générique', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);

    await refresh(app, fetchMock, gone());

    const dialog = await openPanel(/Ticket introuvable/);
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Ticket introuvable' })).toBeTruthy();
    expect(within(dialog).queryByText(/Shell UI façon Linear/)).toBeNull();
    expect(screen.queryByText(/Actualisation impossible/)).toBeNull();
  });

  it('garde le ticket affiché, avec le bandeau, quand le serveur flanche (500) : seul un 404 dit que le ticket n’existe plus', async () => {
    const fetchMock = stubDefaultApi();
    const app = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);

    await refresh(app, fetchMock, 'down');

    expect(await screen.findByText(/Actualisation impossible/)).toBeTruthy();
    expect(within(screen.getByRole('dialog')).getByRole('heading', { level: 2, name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(screen.queryByText('Ticket introuvable')).toBeNull();
  });
});

describe('le panneau d’un ticket : le fermer', () => {
  it('« Retour » du navigateur le ferme et rend le kanban tel qu’il était', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban?col=ready');
    const link = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: /Shell UI façon Linear/ });
    await user.click(link);
    await openPanel(/Shell UI façon Linear/);

    await act(() => router.navigate(-1));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban?col=ready');
  });

  it('le bouton « Fermer le panneau » revient au kanban d’où l’on vient, sans empiler l’historique', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    const link = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: /Shell UI façon Linear/ });
    await user.click(link);
    const dialog = await openPanel(/Shell UI façon Linear/);

    await user.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
    expect(router.state.historyAction).toBe('POP'); // un retour en arrière, pas une nouvelle entrée
  });

  it('ouvert directement, il se ferme vers le kanban du Projet en remplaçant son entrée : « Retour » ne le rouvre pas', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    const dialog = await openPanel(/Shell UI façon Linear/);

    await user.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(router.state.historyAction).toBe('REPLACE');
    expect(screen.queryByRole('dialog')).toBeNull();
  });
});

describe('le panneau d’un ticket : le fermer, quelle que soit la façon dont on y est arrivé', () => {
  const cardIn = async (column: string, name: RegExp) => within(await screen.findByRole('region', { name: column })).getByRole('link', { name });

  /** Ouvre un ticket par la palette ⌘K, comme le ferait un utilisateur : l'adresse change par un lien de l'application, pas par une carte. */
  async function openFromPalette(user: ReturnType<typeof renderApp>['user'], search: string, title: RegExp) {
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard(search);
    await user.click(await within(palette).findByRole('option', { name: title }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    return openPanel(title);
  }

  it('le bouton « Fermer le panneau » ferme d’un coup le panneau d’un ticket ouvert par la palette, et rend la page d’où l’on vient', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    await openPanel(/Shell UI façon Linear/);
    const dialog = await openFromPalette(user, '38k.7', /Kanban par Projet/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7');

    await user.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
    expect(router.state.historyAction).toBe('POP'); // un retour en arrière, pas une entrée de plus
  });

  it('le bouton « Fermer le panneau » ne revient que d’une entrée après des liens du panneau, qui remplacent la leur : la page d’avant le tableau reste en place', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/metrics');
    await screen.findByRole('heading', { level: 1, name: 'Métriques' });
    await act(() => router.navigate('/p/bdesk/kanban'));
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    const dialog = await openPanel(/Shell UI façon Linear/);
    await user.click(await within(dialog).findByRole('link', { name: /^Epic : beads-desktop V1/ }));
    await openPanel(/beads-desktop V1/);

    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
    expect(router.state.historyAction).toBe('POP');
  });

  it('Échap le ferme d’un coup aussi, après plusieurs tickets ouverts par la palette', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    await openPanel(/Shell UI façon Linear/);
    await openFromPalette(user, '38k.7', /Kanban par Projet/);
    await openFromPalette(user, 'debit', /Le graphique du Débit/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-b7q');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('« Retour » du navigateur reste cohérent : il revient au ticket d’avant, puis ferme le panneau', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    await openPanel(/Shell UI façon Linear/);
    await openFromPalette(user, '38k.7', /Kanban par Projet/);

    await act(() => router.navigate(-1));
    await openPanel(/Shell UI façon Linear/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');
    await act(() => router.navigate(-1));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('revient à la page d’où l’on vient quand ce n’est pas le kanban, même après un autre ticket ouvert par la palette', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/metrics?range=7d');
    await screen.findByRole('heading', { level: 1, name: 'Métriques' });
    await act(() => router.navigate('/p/bdesk/t/bdesk-38k.6'));
    await openPanel(/Shell UI façon Linear/);
    await openFromPalette(user, '38k.7', /Kanban par Projet/);

    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/metrics?range=7d');
  });

  it('ouvert directement puis changé de ticket par la palette, il se ferme d’un coup vers le kanban du Projet', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await openFromPalette(user, '38k.7', /Kanban par Projet/);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('rouvert par « Avancer », il se ferme encore en revenant d’une entrée : « Retour » ne tombe pas sur un doublon du kanban', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    await openPanel(/Shell UI façon Linear/);
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await act(() => router.navigate(1));
    await openPanel(/Shell UI façon Linear/);

    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
    expect(router.state.historyAction).toBe('POP');
  });
});

describe('le panneau d’un ticket introuvable : son bouton de retour dit où il mène', () => {
  it.each([
    ['la Vue globale', 'Retour à la Vue globale', '/'],
    ['les Métriques du Projet', 'Retour aux Métriques', '/p/bdesk/metrics?range=7d'],
    ['les Epics du Projet', 'Retour aux Epics', '/p/bdesk/epics'],
    ['le kanban du Projet', 'Retour au kanban', '/p/bdesk/kanban?col=ready'],
    ['le kanban d’un autre Projet', 'Retour à la page précédente', '/p/mpm/kanban'],
    ['une page du Projet que l’application ne connaît pas', 'Retour à la page précédente', '/p/bdesk/inconnue'],
  ])('ouvert depuis %s, il se nomme « %s » et y revient', async (_origin, label, start) => {
    stubDefaultApi();
    const { user, router } = renderApp(start);
    await waitFor(() => expect(document.querySelector('main h1')).not.toBeNull());
    await act(() => router.navigate('/p/bdesk/t/inexistant'));
    const dialog = await openPanel(/Ticket introuvable/);

    await user.click(within(dialog).getByRole('button', { name: label }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(start);
  });

  it('ouvert directement, il se nomme « Retour au kanban » : il n’a rien derrière lui, il remplace son entrée par le kanban du Projet', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/inexistant?col=ready');
    const dialog = await openPanel(/Ticket introuvable/);

    await user.click(within(dialog).getByRole('button', { name: 'Retour au kanban' }));

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban?col=ready'));
    expect(router.state.historyAction).toBe('REPLACE');
  });
});

describe('le panneau d’un ticket : le clavier', () => {
  const cardLink = async (name: RegExp) => within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name });

  it('Échap le ferme et rend le focus à la carte qui l’avait ouvert', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    const link = await cardLink(/Shell UI façon Linear/);
    await user.click(link);
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
    expect(document.activeElement).toBe(link);
  });

  it('Échap ferme un panneau ouvert directement, vers le kanban du Projet', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(screen.queryByRole('dialog')).toBeNull();
  });

  it('Échap ferme le panneau, puis désélectionne la carte : le kanban garde sa touche', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    const link = await cardLink(/Shell UI façon Linear/);
    await user.click(link);
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(link); // la carte est de nouveau sélectionnée

    await user.keyboard('{Escape}');

    expect(document.activeElement).toBe(document.body); // désélectionnée
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it.each([
    ['par l’adresse (le tableau s’enregistre après le panneau)', '/p/bdesk/t/bdesk-38k.6'],
    ['par une carte (le panneau s’enregistre après le tableau)', '/p/bdesk/kanban'],
  ])('Échap ferme le panneau ouvert %s même quand une carte a le focus : il passe avant la désélection', async (_how, start) => {
    stubDefaultApi();
    const { user, router } = renderApp(start);
    const link = await cardLink(/Shell UI façon Linear/);
    if (start.endsWith('/kanban')) await user.click(link);
    await openPanel(/Shell UI façon Linear/);
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('Échap laisse le panneau ouvert quand la palette est ouverte : elle se ferme d’abord', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Palette de commandes' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    expect(screen.getByRole('dialog', { name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
  });

  it('Échap laisse le panneau ouvert quand l’aide des raccourcis est ouverte : elle se ferme d’abord', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await user.click(screen.getByRole('button', { name: 'Afficher les raccourcis clavier' }));
    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Raccourcis clavier' })).toBeNull());
    expect(screen.getByRole('dialog', { name: /Shell UI façon Linear/ })).toBeTruthy();
    expect(help.isConnected).toBe(false);
  });

  it('figure dans l’aide « ? », sous la rubrique Ticket, tant que le panneau est ouvert, et plus après', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await user.click(screen.getByRole('button', { name: 'Afficher les raccourcis clavier' }));

    const help = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    const group = within(help).getByRole('region', { name: 'Ticket' });
    expect(within(group).getByText('Fermer le ticket')).toBeTruthy();
    expect(group.textContent).toContain('Échap');

    await user.keyboard('{Escape}'); // l'aide
    await user.keyboard('{Escape}'); // le panneau
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await user.click(screen.getByRole('button', { name: 'Afficher les raccourcis clavier' }));
    const again = await screen.findByRole('dialog', { name: 'Raccourcis clavier' });
    expect(within(again).queryByText('Fermer le ticket')).toBeNull();
  });

  it('Entrée sur la carte sélectionnée ouvre le panneau', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await cardLink(/Shell UI façon Linear/);

    await user.keyboard('j{Enter}');

    await openPanel(/Shell UI façon Linear/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');
  });

  it('les raccourcis à touche simple du kanban se taisent tant que le focus est dans le panneau : « j » ne vole pas le focus', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    const dialog = await openPanel(/Shell UI façon Linear/);
    expect(document.activeElement).toBe(dialog);

    await user.keyboard('jjk');

    expect(document.activeElement).toBe(dialog);
  });
});

type Chronologies = NonNullable<Parameters<typeof stubApi>[0]['chronologies']>;

describe('le panneau d’un ticket : la chronologie', () => {
  // Les heures s'écrivent dans le fuseau du navigateur ; l'heure « maintenant » (durée d'un statut qui dure encore) est figée.
  withTimeZone('Europe/Paris');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-10T09:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  const DELIVERED = chronology({
    transitions: [
      { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: DAY },
      { status: 'in_progress', at: '2026-10-02T09:00:00.000Z', duration: 1.5 * DAY },
      { status: 'closed', at: '2026-10-03T21:00:00.000Z', duration: null },
    ],
    outcome: { kind: 'delivered', at: '2026-10-03T21:00:00.000Z' },
    leadTime: 2.5 * DAY,
    cycleTime: 1.5 * DAY,
    blockedTime: DAY,
  });
  const CLOSED = issue({ id: 'bdesk-1', title: 'Un ticket livré', status: 'closed', closedAt: '2026-10-03T21:00:00Z' });
  const OPEN = issue({ id: 'bdesk-2', title: 'Un ticket en cours', status: 'in_progress' });
  const stubChronology = (chronologies: Chronologies) =>
    stubApi({ projects: projectsResponse, issues: { bdesk: [CLOSED, OPEN] }, chronologies });
  /** La section Chronologie d'un ticket, une fois chargée. */
  async function chronologyOf(id: string, title: RegExp, chronologies: Chronologies) {
    stubChronology(chronologies);
    const app = renderApp(`/p/bdesk/t/${id}`);
    const dialog = await openPanel(title);
    // La section est là dès le chargement ; le contenu y arrive avec la réponse.
    await within(dialog).findByRole('list', { name: 'Transitions' });
    const region = within(dialog).getByRole('region', { name: 'Chronologie' });
    return { ...app, dialog, region, view: within(region) };
  }

  it('s’affiche après la fiche, qui n’attend pas l’historique du Projet : « Chargement de la chronologie » en attendant', async () => {
    const fetchMock = stubChronology({ 'bdesk/bdesk-1': DELIVERED });
    const healthy = fetchMock.getMockImplementation();
    let release = () => {};
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    fetchMock.mockImplementation(async (input) => {
      if (String(input).endsWith('/chronology')) await gate;
      return healthy?.(input) as Promise<Response>;
    });
    renderApp('/p/bdesk/t/bdesk-1');

    const dialog = await openPanel(/Un ticket livré/);
    const loading = within(dialog).getByRole('status', { name: 'Chargement de la chronologie' });
    expect(loading).toBeTruthy();
    // La silhouette porte les intitulés des trois durées : un intitulé qui passe à la ligne (mobile) donne aux cases la même hauteur
    // qu'à l'arrivée de la chronologie, et le texte qui suit ne saute pas.
    for (const label of ['Lead Time', 'Cycle Time', 'Temps bloqué en cours de travail']) expect(within(loading).getByText(label), label).toBeTruthy();

    release();
    expect(await within(dialog).findByRole('list', { name: 'Transitions' })).toBeTruthy();
    expect(within(dialog).queryByRole('status', { name: 'Chargement de la chronologie' })).toBeNull();
  });

  it('donne le Lead Time, le Cycle Time et le temps bloqué, en Durée écoulée', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, { 'bdesk/bdesk-1': DELIVERED });

    expect(view.getByText('Lead Time').closest('div')?.textContent).toContain(`2,5${NBSP}j`);
    expect(view.getByText('Cycle Time').closest('div')?.textContent).toContain(`1,5${NBSP}j`);
    expect(view.getByText('Temps bloqué en cours de travail').closest('div')?.textContent).toContain(`1${NBSP}j`);
    // En toutes lettres pour les lecteurs d'écran.
    expect(view.getByText('2,5 jours')).toBeTruthy();
  });

  it('liste les Transitions avec leur heure dans le fuseau du navigateur et le temps passé dans chaque statut', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, { 'bdesk/bdesk-1': DELIVERED });

    const items = within(view.getByRole('list', { name: 'Transitions' })).getAllByRole('listitem');
    expect(items).toHaveLength(3);
    expect(items[0]?.textContent).toMatch(/Créé.*1 oct\. 2026.*11:00.*1\sj/);
    expect(items[1]?.textContent).toMatch(/En cours.*2 oct\. 2026.*11:00.*1,5\sj/);
    // Fermé : le ticket n'y passe pas de temps.
    expect(items[2]?.textContent).toMatch(/Fermé.*3 oct\. 2026.*23:00/);
    expect(items[2]?.textContent).not.toMatch(/pendant|depuis/);
    expect(within(items[0] as HTMLElement).getByText(/1 oct\./).closest('time')?.getAttribute('datetime')).toBe('2026-10-01T09:00:00.000Z');
  });

  it('dit dans quel fuseau les heures sont écrites', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, { 'bdesk/bdesk-1': DELIVERED });

    expect(view.getByText(/fuseau Europe\/Paris/)).toBeTruthy();
  });

  it('dit « depuis » pour le statut qui dure encore, avec le temps écoulé à maintenant', async () => {
    // Maintenant : le 10 octobre à 09:00 UTC ; en cours depuis le 8 à 03:00 UTC : 2 j 6 h, soit 2,25 jours, écrits « 2,3 j ».
    const { view } = await chronologyOf('bdesk-2', /Un ticket en cours/, {
      'bdesk/bdesk-2': chronology({
        transitions: [
          { status: 'open', at: '2026-10-05T09:00:00.000Z', duration: 3 * DAY - 6 * HOUR },
          { status: 'in_progress', at: '2026-10-08T03:00:00.000Z', duration: null },
        ],
      }),
    });

    const last = within(view.getByRole('list', { name: 'Transitions' })).getAllByRole('listitem')[1];
    expect(last?.textContent).toMatch(/En cours.*depuis 2,3\sj/);
  });

  it('ne donne ni Lead Time, ni Cycle Time, ni temps bloqué à un ticket qui n’est pas fermé, et dit pourquoi', async () => {
    const { view } = await chronologyOf('bdesk-2', /Un ticket en cours/, {
      'bdesk/bdesk-2': chronology({ transitions: [{ status: 'in_progress', at: '2026-10-08T03:00:00.000Z', duration: null }] }),
    });

    for (const label of ['Lead Time', 'Cycle Time', 'Temps bloqué en cours de travail']) {
      const figure = view.getByText(label).closest('div') as HTMLElement;
      expect(figure.textContent, label).toContain('—');
      expect(figure.textContent, label).toContain('ticket non fermé');
    }
    expect(view.getByText('Pas encore fermé')).toBeTruthy();
  });

  it('dit qu’un ticket fermé sans avoir été démarré n’a pas de Cycle Time', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
      'bdesk/bdesk-1': chronology({
        transitions: [
          { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: DAY },
          { status: 'closed', at: '2026-10-02T09:00:00.000Z', duration: null },
        ],
        outcome: { kind: 'delivered', at: '2026-10-02T09:00:00.000Z' },
        leadTime: DAY,
        cycleTime: null,
        blockedTime: 0,
      }),
    });

    const figure = view.getByText('Cycle Time').closest('div') as HTMLElement;
    expect(figure.textContent).toContain('—');
    expect(figure.textContent).toContain('jamais démarré');
  });

  it.each([
    [{ kind: 'delivered', at: '2026-10-03T21:00:00.000Z' } as const, /Livraison le 3 oct\. 2026.*23:00/],
    [{ kind: 'abandoned', at: '2026-10-03T21:00:00.000Z', cause: 'duplicate' } as const, /Abandon \(doublon\) le 3 oct\. 2026/],
    [{ kind: 'abandoned', at: '2026-10-03T21:00:00.000Z', cause: 'superseded' } as const, /Abandon \(remplacé\) le 3 oct\. 2026/],
    [{ kind: 'closed', at: '2026-10-03T21:00:00.000Z' } as const, /Fermé le 3 oct\. 2026/],
  ])('dit comment le ticket s’est terminé : %j', async (outcome, sentence) => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, { 'bdesk/bdesk-1': { ...DELIVERED, outcome } });

    expect(view.getByText(sentence)).toBeTruthy();
  });

  it('marque la Réouverture, la compte, et ne dit pas « pendant » de la durée passée fermé comme d’un statut de travail', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
      'bdesk/bdesk-1': chronology({
        transitions: [
          { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: DAY },
          { status: 'closed', at: '2026-10-02T09:00:00.000Z', duration: 3 * DAY },
          { status: 'open', at: '2026-10-05T09:00:00.000Z', duration: HOUR },
          { status: 'in_progress', at: '2026-10-05T10:00:00.000Z', duration: DAY },
          { status: 'closed', at: '2026-10-06T10:00:00.000Z', duration: null },
        ],
        outcome: { kind: 'delivered', at: '2026-10-06T10:00:00.000Z' },
        leadTime: 5 * DAY + HOUR,
        cycleTime: DAY,
        blockedTime: 0,
        reopenings: 1,
      }),
    });

    const items = within(view.getByRole('list', { name: 'Transitions' })).getAllByRole('listitem');
    expect(items.map((item) => /^(Créé|Fermé|Rouvert|En cours)/.exec(item.textContent ?? '')?.[0])).toEqual(['Créé', 'Fermé', 'Rouvert', 'En cours', 'Fermé']);
    expect(view.getByText(/Rouvert 1 fois/)).toBeTruthy();
  });

  it('liste les Blocages : leur période, leur durée, et les tickets attendus, cliquables', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
      'bdesk/bdesk-1': {
        ...DELIVERED,
        blockages: [
          {
            from: '2026-10-02T12:00:00.000Z',
            to: '2026-10-03T00:00:00.000Z',
            blockedBy: ['bdesk-2', 'bdesk-3'],
            statusBlocked: false,
            phases: [{ kind: 'work', from: '2026-10-02T12:00:00.000Z', to: '2026-10-03T00:00:00.000Z' }],
          },
        ],
      },
    });

    const blockages = within(view.getByRole('list', { name: 'Blocages' }));
    const [blockage] = blockages.getAllByRole('listitem');
    expect(blockage?.textContent).toMatch(/2 oct\. 2026.*14:00.*3 oct\. 2026.*02:00.*12\sh/);
    expect(blockage?.textContent).toContain('attend bdesk-2, bdesk-3');
    expect(within(blockage as HTMLElement).getByRole('link', { name: 'bdesk-2' }).getAttribute('href')).toBe('/p/bdesk/t/bdesk-2');
  });

  it('dit « statut bloqué » quand seul le statut a bloqué le ticket, et « en cours » pour un Blocage qui dure', async () => {
    const { view } = await chronologyOf('bdesk-2', /Un ticket en cours/, {
      'bdesk/bdesk-2': chronology({
        transitions: [{ status: 'in_progress', at: '2026-10-08T03:00:00.000Z', duration: null }],
        blockages: [
          {
            from: '2026-10-08T05:00:00.000Z',
            to: '2026-10-08T07:00:00.000Z',
            blockedBy: [],
            statusBlocked: true,
            phases: [{ kind: 'work', from: '2026-10-08T05:00:00.000Z', to: '2026-10-08T07:00:00.000Z' }],
          },
          {
            from: '2026-10-09T09:00:00.000Z',
            to: null,
            blockedBy: ['bdesk-1'],
            statusBlocked: false,
            phases: [{ kind: 'work', from: '2026-10-09T09:00:00.000Z', to: null }],
          },
        ],
      }),
    });

    const [byStatus, ongoing] = within(view.getByRole('list', { name: 'Blocages' })).getAllByRole('listitem');
    expect(byStatus?.textContent).toContain('statut bloqué');
    expect(byStatus?.textContent).toContain(`2${NBSP}h`);
    // Maintenant : le 10 octobre à 09:00 UTC, soit exactement un jour après le début du Blocage.
    expect(ongoing?.textContent).toMatch(/En cours depuis le 9 oct\. 2026.*11:00.*1\sj/);
  });

  describe('le temps bloqué et les Blocages listés disent la même chose', () => {
    // Le ticket attend 17 h en Backlog (avant son premier démarrage), puis 3 h en travail ; un second Blocage, hors du travail, est revenu à ouvert.
    const BEFORE_START = { kind: 'dependencyWait', from: '2026-10-01T09:00:00.000Z', to: '2026-10-02T02:00:00.000Z' } as const;
    const AT_WORK = { kind: 'work', from: '2026-10-02T02:00:00.000Z', to: '2026-10-02T05:00:00.000Z' } as const;
    const WAITING = { kind: 'otherWait', from: '2026-10-02T09:00:00.000Z', to: '2026-10-02T11:00:00.000Z' } as const;
    const blockage = (phases: readonly (typeof BEFORE_START | typeof AT_WORK | typeof WAITING)[], blockedBy = ['bdesk-2']) => ({
      from: phases[0]?.from ?? '',
      to: phases.at(-1)?.to ?? null,
      blockedBy,
      statusBlocked: false,
      phases: [...phases],
    });

    it('nomme le temps bloqué par ce qu’il compte, le Blocage en cours de travail, et le dit sous les Blocages', async () => {
      const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
        'bdesk/bdesk-1': { ...DELIVERED, blockedTime: 0, blockages: [blockage([BEFORE_START])] },
      });

      const figure = view.getByText('Temps bloqué en cours de travail').closest('div') as HTMLElement;
      expect(figure.textContent).toContain('Aucun');
      expect(view.queryByText('Temps bloqué')).toBeNull(); // l'ancien nom, qui laissait croire que rien n'avait jamais bloqué le ticket
      expect(view.getByText(/Seul le Blocage en cours de travail compte dans le temps bloqué/)).toBeTruthy();
    });

    it('dit de chaque Blocage s’il tombe avant le premier démarrage, en cours de travail ou hors du travail', async () => {
      const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
        'bdesk/bdesk-1': {
          ...DELIVERED,
          blockedTime: 3 * HOUR,
          blockages: [blockage([BEFORE_START]), blockage([AT_WORK]), blockage([WAITING])],
        },
      });

      const [before, working, waiting] = within(view.getByRole('list', { name: 'Blocages' })).getAllByRole('listitem');
      expect(before?.textContent).toContain('avant le premier démarrage');
      expect(before?.textContent).not.toContain('en cours de travail');
      expect(working?.textContent).toContain('en cours de travail');
      expect(working?.textContent).not.toContain('avant le premier démarrage');
      expect(waiting?.textContent).toContain('hors du travail');
    });

    it('chiffre chaque phase d’un Blocage qui en traverse plusieurs, dans l’ordre : l’attente puis le travail', async () => {
      const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
        'bdesk/bdesk-1': {
          ...DELIVERED,
          blockedTime: 3 * HOUR,
          blockages: [blockage([BEFORE_START, AT_WORK])],
        },
      });

      const [mixed] = within(view.getByRole('list', { name: 'Blocages' })).getAllByRole('listitem');
      // 1 oct. 09:00 → 2 oct. 02:00 : 17 h avant le démarrage ; puis 3 h en travail, les seules que « Temps bloqué » compte.
      expect(mixed?.textContent).toMatch(new RegExp(`17${NBSP}h.*avant le premier démarrage.*puis.*3${NBSP}h.*en cours de travail`));
    });

    it('compte le temps d’une phase qui dure encore jusqu’à maintenant', async () => {
      const { view } = await chronologyOf('bdesk-2', /Un ticket en cours/, {
        'bdesk/bdesk-2': chronology({
          transitions: [
            { status: 'open', at: '2026-10-09T03:00:00.000Z', duration: 6 * HOUR },
            { status: 'in_progress', at: '2026-10-09T09:00:00.000Z', duration: null },
          ],
          blockages: [
            {
              from: '2026-10-09T03:00:00.000Z',
              to: null,
              blockedBy: ['bdesk-1'],
              statusBlocked: false,
              phases: [
                { kind: 'dependencyWait', from: '2026-10-09T03:00:00.000Z', to: '2026-10-09T09:00:00.000Z' },
                { kind: 'work', from: '2026-10-09T09:00:00.000Z', to: null },
              ],
            },
          ],
        }),
      });

      // Maintenant : le 10 octobre à 09:00 UTC. Le Blocage dure depuis 30 h : 6 h avant le démarrage, puis 1 j en travail.
      const [ongoing] = within(view.getByRole('list', { name: 'Blocages' })).getAllByRole('listitem');
      expect(ongoing?.textContent).toMatch(new RegExp(`En cours depuis le 9 oct\\. 2026.*6${NBSP}h.*avant le premier démarrage.*puis.*1${NBSP}j.*en cours de travail`));
    });
  });

  it('écrit les durées comme la page Métriques : 9,96 jours font « 10 j » ici aussi, et non « 9 j 23 h »', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
      'bdesk/bdesk-1': { ...DELIVERED, leadTime: 9.96 * DAY, cycleTime: 36 * HOUR + 40 * 60_000 },
    });

    expect(view.getByText('Lead Time').closest('div')?.textContent).toContain(`10${NBSP}j`);
    expect(view.getByText('Lead Time').closest('div')?.textContent).not.toContain('9 j');
    expect(view.getByText('10 jours')).toBeTruthy();
    expect(view.getByText('Cycle Time').closest('div')?.textContent).toContain(`1,5${NBSP}j`);
  });

  it('ne parle pas de Blocage quand il n’y en a pas', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, { 'bdesk/bdesk-1': { ...DELIVERED, blockedTime: 0, blockages: [] } });

    expect(view.queryByRole('list', { name: 'Blocages' })).toBeNull();
  });

  it('prévient quand le ticket n’a pas d’historique : seules ses dates de création et de clôture sont connues', async () => {
    const { view } = await chronologyOf('bdesk-1', /Un ticket livré/, {
      'bdesk/bdesk-1': chronology({
        source: 'dates',
        transitions: [
          { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: 2.5 * DAY },
          { status: 'closed', at: '2026-10-03T21:00:00.000Z', duration: null },
        ],
        outcome: { kind: 'closed', at: '2026-10-03T21:00:00.000Z' },
        leadTime: 2.5 * DAY,
      }),
    });

    expect(view.getByText(/Historique indisponible pour ce ticket/)).toBeTruthy();
    expect((view.getByText('Cycle Time').closest('div') as HTMLElement).textContent).toContain('sans historique');
  });

  it('ne fait pas échouer la fiche quand l’historique est illisible : la chronologie le dit, et laisse réessayer', async () => {
    stubChronology({
      'bdesk/bdesk-1': httpFailure(503, {
        statusCode: 503,
        error: 'Service Unavailable',
        message: 'Projet illisible : bdesk (Historique trop long)',
        reason: 'Historique trop long (plus de 10 000 commits)',
      }),
    });
    const { user } = renderApp('/p/bdesk/t/bdesk-1');
    const dialog = await openPanel(/Un ticket livré/);

    const alert = await within(dialog).findByRole('alert');
    // Le Projet n'est pas illisible, puisque la fiche s'affiche : c'est son historique, et le titre le dit.
    expect(within(alert).getByText('Chronologie indisponible')).toBeTruthy();
    expect(within(alert).queryByText('Projet illisible')).toBeNull();
    expect(alert.textContent).toContain('Historique trop long (plus de 10 000 commits)');
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Un ticket livré' })).toBeTruthy();

    stubChronology({ 'bdesk/bdesk-1': DELIVERED });
    await user.click(within(alert).getByRole('button', { name: /Réessayer/ }));
    expect(await within(dialog).findByRole('list', { name: 'Transitions' })).toBeTruthy();
  });
});

describe('le panneau d’un ticket : la chronologie dans un autre fuseau', () => {
  // Même instant, 09:00 UTC : 11:00 à Paris (UTC+2 en octobre), 18:00 à Tokyo.
  withTimeZone('Asia/Tokyo');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-10T09:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit les heures dans le fuseau du navigateur, quel qu’il soit, et le dit', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Un ticket livré' })] },
      chronologies: {
        'bdesk/bdesk-1': chronology({ transitions: [{ status: 'open', at: '2026-10-01T09:00:00.000Z', duration: null }] }),
      },
    });
    renderApp('/p/bdesk/t/bdesk-1');
    const dialog = await openPanel(/Un ticket livré/);

    const list = await within(dialog).findByRole('list', { name: 'Transitions' });
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toMatch(/1 oct\. 2026.*18:00/);
    expect(within(dialog).getByText(/fuseau Asia\/Tokyo/)).toBeTruthy();
  });
});

describe('le panneau d’un ticket : la chronologie quand le navigateur ne nomme pas son fuseau (TZ vide)', () => {
  // Le moteur nomme « Etc/Unknown » le fuseau d'un navigateur lancé avec TZ vide, et `Date` y compte en UTC (bdesk-38k.48).
  withTimeZone('');
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['Date'], now: new Date('2026-10-10T09:00:00Z') });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit les heures comme Date les compte, en UTC, et dit « UTC » plutôt que « Etc/Unknown »', async () => {
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Un ticket livré' })] },
      chronologies: {
        'bdesk/bdesk-1': chronology({ transitions: [{ status: 'open', at: '2026-10-01T09:00:00.000Z', duration: null }] }),
      },
    });
    renderApp('/p/bdesk/t/bdesk-1');
    const dialog = await openPanel(/Un ticket livré/);

    const list = await within(dialog).findByRole('list', { name: 'Transitions' });
    expect(within(list).getAllByRole('listitem')[0]?.textContent).toMatch(/1 oct\. 2026.*09:00/);
    expect(within(dialog).getByText(/Heures du fuseau UTC$/)).toBeTruthy();
  });
});

describe('le panneau d’un ticket : les textes', () => {
  const FULL = issueDetail({
    id: 'bdesk-5',
    title: 'Un ticket complet',
    description: 'Une **description** avec `du code`.',
    design: '- point un\n- point deux',
    acceptanceCriteria: '1. critère un\n2. critère deux',
    notes: '2026-11-02 triage\n2026-11-03 suite',
    closeReason: 'Livré dans abc123',
    labels: ['backend', 'ui'],
  });
  const show = async (detail = FULL) => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: detail.id, title: detail.title })] }, details: { [`bdesk/${detail.id}`]: detail } });
    const app = renderApp(`/p/bdesk/t/${detail.id}`);
    const dialog = await openPanel(new RegExp(detail.title));
    return { ...app, dialog };
  };

  it('écrit en Markdown la description, la conception, les critères d’acceptation, les notes et la raison de fermeture, chacune sous son intertitre', async () => {
    const { dialog } = await show();

    const description = within(dialog).getByRole('region', { name: 'Description' });
    expect(description.querySelector('strong')?.textContent).toBe('description');
    expect(description.querySelector('code')?.textContent).toBe('du code');
    expect(within(within(dialog).getByRole('region', { name: 'Conception' })).getAllByRole('listitem')).toHaveLength(2);
    expect(within(dialog).getByRole('region', { name: 'Critères d’acceptation' }).querySelector('ol')).toBeTruthy();
    expect(within(dialog).getByRole('region', { name: 'Notes' }).querySelectorAll('br')).toHaveLength(1);
    expect(within(dialog).getByRole('region', { name: 'Raison de fermeture' }).textContent).toContain('Livré dans abc123');
  });

  it('n’écrit pas une section vide, et dit qu’il n’y a rien quand aucun texte n’est renseigné', async () => {
    const { dialog } = await show(issueDetail({ id: 'bdesk-6', title: 'Un ticket nu' }));

    for (const name of ['Description', 'Conception', 'Critères d’acceptation', 'Notes', 'Raison de fermeture']) {
      expect(within(dialog).queryByRole('region', { name }), name).toBeNull();
    }
    expect(within(dialog).getByText('Aucun texte n’est renseigné pour ce ticket.')).toBeTruthy();
  });

  it('n’interprète jamais le HTML d’un texte : il s’affiche tel quel', async () => {
    const { dialog } = await show(
      issueDetail({ id: 'bdesk-7', title: 'Un texte piégé', description: '<img src=x onerror="window.pwned = 1"> et <script>window.pwned = 2</script>' }),
    );

    expect(dialog.querySelector('img, script')).toBeNull();
    expect(within(dialog).getByRole('region', { name: 'Description' }).textContent).toContain('<img src=x onerror="window.pwned = 1">');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('liste les étiquettes', async () => {
    const { dialog } = await show();

    const labels = within(dialog).getByRole('list', { name: 'Étiquettes' });
    expect(within(labels).getAllByRole('listitem').map((item) => item.textContent)).toEqual(['backend', 'ui']);
  });

  it('ne parle pas d’étiquettes quand il n’y en a pas', async () => {
    const { dialog } = await show(issueDetail({ id: 'bdesk-6', title: 'Un ticket nu' }));

    expect(within(dialog).queryByRole('list', { name: 'Étiquettes' })).toBeNull();
  });
});

describe('le panneau d’un ticket : les relations', () => {
  const ref = (id: string, title: string, extra: Record<string, unknown> = {}) => ({ id, title, type: 'task', status: 'open', priority: 2, ...extra });
  const RELATED = issueDetail({
    id: 'bdesk-9',
    title: 'Un ticket très relié',
    parentId: 'bdesk-e1',
    dependencies: [
      { to: 'bdesk-e1', type: 'parent-child' },
      { to: 'bdesk-1', type: 'blocks' },
      { to: 'bdesk-2', type: 'blocks' },
      { to: 'bdesk-3', type: 'relates-to' },
      { to: 'bdesk-4', type: 'discovered-from' },
      { to: 'external:autre:x-1', type: 'blocks' },
    ],
    dependents: [
      { from: 'bdesk-5', type: 'parent-child' },
      { from: 'bdesk-6', type: 'blocks' },
      { from: 'bdesk-7', type: 'discovered-from' },
    ],
    linked: {
      'bdesk-e1': ref('bdesk-e1', 'Une Epic', { type: 'epic' }),
      'bdesk-1': ref('bdesk-1', 'Bloquant fermé', { status: 'closed' }),
      'bdesk-2': ref('bdesk-2', 'Bloquant ouvert', { status: 'in_progress' }),
      'bdesk-3': ref('bdesk-3', 'Lié'),
      'bdesk-4': ref('bdesk-4', 'Origine'),
      'bdesk-5': ref('bdesk-5', 'Enfant', { type: 'bug' }),
      'bdesk-6': ref('bdesk-6', 'Bloqué par celui-ci'),
      'bdesk-7': ref('bdesk-7', 'Bug découvert ici', { type: 'bug' }),
    },
    blockedBy: ['bdesk-2'],
  });
  const show = async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-9', title: 'Un ticket très relié' }), issue({ id: 'bdesk-2', title: 'Bloquant ouvert' })] }, details: { 'bdesk/bdesk-9': RELATED } });
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('heading', { level: 1, name: 'Kanban' });
    await act(() => app.router.navigate('/p/bdesk/t/bdesk-9'));
    const dialog = await openPanel(/Un ticket très relié/);
    return { ...app, dialog, relations: within(await within(dialog).findByRole('region', { name: 'Relations' })) };
  };

  it('range les relations par genre, chaque ticket lié avec son titre et son statut, cliquable', async () => {
    const { relations } = await show();

    for (const [group, ids] of [
      ['Parent', ['bdesk-e1']],
      ['Enfants', ['bdesk-5']],
      ['Bloqué par', ['bdesk-1', 'bdesk-2', 'external:autre:x-1']],
      ['Bloque', ['bdesk-6']],
      ['Lié à', ['bdesk-3']],
      ['Découvert à partir de', ['bdesk-4']],
      ['À l’origine de', ['bdesk-7']],
    ] as const) {
      const list = relations.getByRole('list', { name: group });
      expect(within(list).getAllByRole('listitem').map((item) => /^[^\s]+/.exec(item.textContent ?? '')?.[0]), group).toEqual(ids);
    }
    const blocker = relations.getByRole('link', { name: /bdesk-2 Bloquant ouvert/ });
    expect(blocker.getAttribute('href')).toBe('/p/bdesk/t/bdesk-2');
    expect(blocker.textContent).toContain('en cours');
  });

  it('dit qu’un ticket bloquant est fermé : il ne bloque plus', async () => {
    const { relations } = await show();

    const closed = relations.getByRole('link', { name: /bdesk-1 Bloquant fermé/ }).closest('li') as HTMLElement;
    const open = relations.getByRole('link', { name: /bdesk-2 Bloquant ouvert/ }).closest('li') as HTMLElement;
    expect(closed.textContent).toContain('fermé');
    expect(closed.textContent).not.toContain('Bloque encore');
    expect(open.textContent).toContain('Bloque encore');
  });

  it('ne dit pas « Bloque encore » d’un ticket bloquant quand le ticket lui-même est fermé : un ticket fermé n’est plus retenu', async () => {
    const closed = { status: 'closed', closedAt: '2026-10-05T09:00:00Z' };
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-9', title: 'Un ticket fermé', ...closed }), issue({ id: 'bdesk-2', title: 'Bloquant resté ouvert', status: 'in_progress' })] },
      details: {
        'bdesk/bdesk-9': issueDetail({
          id: 'bdesk-9',
          title: 'Un ticket fermé',
          ...closed,
          dependencies: [{ to: 'bdesk-2', type: 'blocks' }],
          linked: { 'bdesk-2': ref('bdesk-2', 'Bloquant resté ouvert', { status: 'in_progress' }) },
        }),
      },
    });
    renderApp('/p/bdesk/t/bdesk-9');
    const dialog = await openPanel(/Un ticket fermé/);

    const relations = within(await within(dialog).findByRole('region', { name: 'Relations' }));

    const blocker = relations.getByRole('link', { name: /bdesk-2 Bloquant resté ouvert/ }).closest('li') as HTMLElement;
    expect(blocker.textContent).toContain('en cours');
    expect(blocker.textContent).not.toContain('Bloque encore');
  });

  it('ne fait pas un lien d’un ticket hors du Projet', async () => {
    const { relations } = await show();

    const external = relations.getByText('external:autre:x-1');
    expect(external.closest('a')).toBeNull();
    expect(external.closest('li')?.textContent).toContain('hors du Projet');
  });

  it('ouvre le ticket lié dans le même panneau, et « Retour » le ferme toujours : le lien remplace l’entrée d’historique', async () => {
    const { user, router, relations } = await show();

    await user.click(relations.getByRole('link', { name: /bdesk-2 Bloquant ouvert/ }));

    await openPanel(/Bloquant ouvert/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-2');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('garde le focus dans le panneau et reprend le haut de la page en changeant de ticket', async () => {
    const { user, dialog, relations } = await show();
    const body = dialog.querySelector<HTMLElement>('[data-panel-body]');
    if (body) body.scrollTop = 120;

    await user.click(relations.getByRole('link', { name: /bdesk-2 Bloquant ouvert/ }));

    const same = await openPanel(/Bloquant ouvert/);
    expect(same).toBe(dialog); // le même panneau : il n'est pas remonté
    expect(same.contains(document.activeElement)).toBe(true);
    expect(body?.scrollTop).toBe(0);
  });

  it('ne parle pas de relations quand il n’y en a pas', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-6', title: 'Un ticket isolé' })] } });
    renderApp('/p/bdesk/t/bdesk-6');
    const dialog = await openPanel(/Un ticket isolé/);
    await within(dialog).findByRole('list', { name: 'Transitions' });

    expect(within(dialog).queryByRole('region', { name: 'Relations' })).toBeNull();
  });
});

describe('le panneau d’un ticket : les commentaires', () => {
  withTimeZone('Europe/Paris');
  const WITH_COMMENTS = issueDetail({
    id: 'bdesk-8',
    title: 'Un ticket commenté',
    comments: [
      { author: 'tom', text: 'Un **premier** commentaire\net sa suite', createdAt: '2026-10-05T09:00:00.000Z' },
      { author: 'agent-7', text: 'Le second, avec <b>du HTML</b>', createdAt: '2026-10-06T15:30:00.000Z' },
    ],
  });

  it('liste les commentaires dans l’ordre, avec leur auteur, leur date et leur texte en Markdown', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-8', title: 'Un ticket commenté' })] }, details: { 'bdesk/bdesk-8': WITH_COMMENTS } });
    renderApp('/p/bdesk/t/bdesk-8');
    const dialog = await openPanel(/Un ticket commenté/);

    const section = within(dialog).getByRole('region', { name: /^Commentaires/ });
    expect(section.textContent).toContain('2'); // le nombre de commentaires
    const comments = within(section).getAllByRole('article');
    expect(comments).toHaveLength(2);
    expect(comments[0]?.textContent).toContain('tom');
    expect(comments[0]?.textContent).toMatch(/5 oct\. 2026.*11:00/);
    expect(comments[0]?.querySelector('strong')?.textContent).toBe('premier');
    expect(comments[0]?.querySelectorAll('br')).toHaveLength(1);
    expect(comments[1]?.textContent).toContain('agent-7');
    expect(comments[1]?.textContent).toContain('<b>du HTML</b>');
    expect(comments[1]?.querySelector('b')).toBeNull();
  });

  it('ne parle pas de commentaires quand il n’y en a pas', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-6', title: 'Un ticket nu' })] } });
    renderApp('/p/bdesk/t/bdesk-6');
    const dialog = await openPanel(/Un ticket nu/);

    expect(within(dialog).queryByRole('region', { name: /Commentaires/ })).toBeNull();
  });
});

describe('le panneau d’un ticket : le tableau qui reste dessous', () => {
  const cardIn = async (column: string, name: RegExp) => within(await screen.findByRole('region', { name: column })).getByRole('link', { name });

  it('garde les réglages du tableau dans l’adresse du ticket, et le tableau qu’elle recouvre les garde', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban?epic=bdesk-38k&done=30');
    const link = await cardIn('En cours', /Shell UI façon Linear/);
    expect(link.getAttribute('href')).toBe('/p/bdesk/t/bdesk-38k.6?epic=bdesk-38k&done=30');

    await user.click(link);

    await openPanel(/Shell UI façon Linear/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6?epic=bdesk-38k&done=30');
    expect((screen.getByRole('combobox', { name: 'Epic' }) as HTMLSelectElement).value).toBe('bdesk-38k');
  });

  it('se ferme, ouvert directement, sur le kanban avec ses réglages', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6?epic=bdesk-38k');
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban?epic=bdesk-38k'));
  });

  it('change de ticket quand on ouvre une autre carte, panneau ouvert, sans empiler l’historique : « Retour » le ferme', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/kanban');
    await user.click(await cardIn('En cours', /Shell UI façon Linear/));
    await openPanel(/Shell UI façon Linear/);

    await user.click(await cardIn('Prêt', /Kanban par Projet/));

    await openPanel(/Kanban par Projet/);
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7');
    await act(() => router.navigate(-1));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe('/p/bdesk/kanban');
  });

  it('ne donne pas de réglages à un ticket ouvert depuis une autre page que le tableau (la palette, les métriques)', async () => {
    stubDefaultApi();
    const { router } = renderApp('/p/bdesk/metrics?range=7d');
    await screen.findByRole('heading', { level: 1, name: 'Métriques' });

    await act(() => router.navigate('/p/bdesk/t/bdesk-38k.6'));

    await openPanel(/Shell UI façon Linear/);
    expect(await screen.findByRole('heading', { level: 1, name: 'Kanban' })).toBeTruthy();
  });
});

describe('le panneau d’un ticket : écran étroit (mobile) et large (bureau)', () => {
  /** Un écran dont la largeur répond ou non à `(max-width: 767.98px)`, le seuil de `md:` de Tailwind. */
  function screenIs(narrow: boolean) {
    window.matchMedia = ((query: string) => ({
      matches: /max-width: 767\.98px/.test(query) ? narrow : false,
      media: query,
      addEventListener: () => undefined,
      removeEventListener: () => undefined,
    })) as unknown as typeof window.matchMedia;
  }
  const inert = (element: Element | null) => element?.hasAttribute('inert') ?? false;

  it('sur mobile, il prend tout l’écran comme une boîte de dialogue modale : le reste de la page est inerte', async () => {
    screenIs(true);
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel(/Shell UI façon Linear/);

    expect(dialog.getAttribute('aria-modal')).toBe('true');
    expect(inert(document.querySelector('aside'))).toBe(true); // la barre latérale
    expect(inert(document.querySelector('header'))).toBe(true); // le bandeau du haut
    expect(inert(screen.getByRole('navigation', { name: 'Onglets' }))).toBe(true);
    expect(inert(screen.getByRole('heading', { level: 1, name: 'Kanban' }).closest('[class*="mx-auto"]'))).toBe(true); // le tableau
    expect(inert(dialog) || inert(dialog.parentElement)).toBe(false);
  });

  it('sur mobile, ce qui apparaît hors du panneau après son ouverture (un bandeau) est inerte aussi, et cesse de l’être à la fermeture', async () => {
    screenIs(true);
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    const dialog = await openPanel(/Shell UI façon Linear/);

    const banner = document.createElement('p');
    banner.textContent = 'Un bandeau arrivé après l’ouverture';
    (document.querySelector('main') as HTMLElement).append(banner);

    await waitFor(() => expect(banner.hasAttribute('inert')).toBe(true));
    expect(inert(dialog) || inert(dialog.parentElement)).toBe(false);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(banner.hasAttribute('inert')).toBe(false);
  });

  it('sur mobile, la fermeture rend la page et le focus à la carte', async () => {
    screenIs(true);
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    const link = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: /Shell UI façon Linear/ });
    await user.click(link);
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
    expect(document.activeElement).toBe(link);
  });

  it('sur mobile, la palette s’ouvre au-dessus du panneau et reste utilisable', async () => {
    screenIs(true);
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);

    await user.keyboard('{Control>}k{/Control}');

    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    expect(inert(palette) || inert(palette.parentElement)).toBe(false);
  });

  it('sur bureau, il se pose à côté du tableau sans le rendre inerte : la page reste utilisable', async () => {
    screenIs(false);
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');

    const dialog = await openPanel(/Shell UI façon Linear/);

    // Il le dit : le registre des raccourcis y lit une couche posée sur la page (voir IssuePanel.shortcuts.test.tsx).
    expect(dialog.getAttribute('aria-modal')).toBe('false');
    expect(document.querySelectorAll('[inert]')).toHaveLength(0);
  });
});

describe('les routes du kanban et du panneau', () => {
  it('n’émettent aucun avertissement de React Router : la route « kanban » de la route mère n’a rien à dessiner de plus', async () => {
    const warn = vi.spyOn(console, 'warn').mockImplementation(() => undefined);
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await user.click(within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: /Shell UI façon Linear/ }));
    await openPanel(/Shell UI façon Linear/);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());

    expect(warn.mock.calls.map(([message]) => String(message))).toEqual([]);
    warn.mockRestore();
  });
});

describe('le bouton « Fermer le panneau »', () => {
  it('n’a que son icône et son nom : l’indication « Échap » est à côté, hors du bouton (WCAG 2.5.3 : le texte visible d’un bouton doit être dans son nom)', async () => {
    stubDefaultApi();
    renderApp('/p/bdesk/t/bdesk-38k.6');
    const dialog = await openPanel(/Shell UI façon Linear/);

    const button = within(dialog).getByRole('button', { name: 'Fermer le panneau' });

    expect(button.textContent).toBe('');
    const hint = dialog.querySelector('kbd');
    expect(hint?.textContent).toBe('Échap');
    expect(button.contains(hint)).toBe(false);
    expect(hint?.closest('[aria-hidden="true"]')).toBeTruthy(); // décorative : le bouton dit déjà ce qu'il fait
  });
});

describe('le panneau d’un ticket : le titre de l’onglet', () => {
  it('prend celui du ticket tant que le panneau est ouvert, et rend celui de la page dessous à la fermeture', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'En cours' });
    await waitFor(() => expect(document.title).toBe('Kanban · beads-desktop · beads-desktop'));

    await user.click(within(screen.getByRole('region', { name: 'En cours' })).getByRole('link', { name: /Shell UI façon Linear/ }));
    await openPanel(/Shell UI façon Linear/);
    expect(document.title).toBe('bdesk-38k.6 · beads-desktop · beads-desktop');

    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.title).toBe('Kanban · beads-desktop · beads-desktop');
  });

  it('rend celui du kanban aussi quand le panneau, ouvert directement, se ferme', async () => {
    stubDefaultApi();
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    expect(document.title).toBe('bdesk-38k.6 · beads-desktop · beads-desktop');

    await user.click(screen.getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(document.title).toBe('Kanban · beads-desktop · beads-desktop'));
  });
});

describe('le raccourci Échap du panneau : sa condition', () => {
  it('ne ferme pas le panneau sous la palette, même quand la boîte de dialogue ne prend pas la touche (événement envoyé à la fenêtre)', async () => {
    stubDefaultApi();
    const { user, router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);
    await user.keyboard('{Control>}k{/Control}');
    await screen.findByRole('dialog', { name: 'Palette de commandes' });

    // Un événement adressé à la fenêtre ne passe pas par la boîte de dialogue (Radix écoute le document) : seul le registre le voit.
    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    // La palette modale cache le reste de la page aux technologies d'assistance (`aria-hidden`) : on lit donc le DOM.
    expect(document.querySelector('[role="dialog"][aria-labelledby]')?.textContent).toContain('Shell UI façon Linear');
    expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.6');
  });

  it('ferme le panneau quand rien n’est ouvert dessus, par le même chemin (événement envoyé à la fenêtre)', async () => {
    stubDefaultApi();
    const { router } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await openPanel(/Shell UI façon Linear/);

    act(() => {
      window.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true, cancelable: true }));
    });

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
  });
});

describe('le contenu du panneau : atteignable au clavier quand il défile', () => {
  afterEach(() => {
    vi.restoreAllMocks();
  });
  /** Une page dont le contenu du panneau dépasse la hauteur (jsdom ne mesure rien : on fixe la mesure, comme le ferait un navigateur). */
  function overflowing(does: boolean) {
    vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-panel-body') && does ? 2400 : 0;
    });
    vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
      return this.hasAttribute('data-panel-body') ? 700 : 0;
    });
  }

  it('prend le focus au clavier quand il défile : une région nommée (WCAG 2.1.1, axe « scrollable-region-focusable »)', async () => {
    overflowing(true);
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-6', title: 'Un ticket sans lien' })] } });
    const { user } = renderApp('/p/bdesk/t/bdesk-6');
    const dialog = await openPanel(/Un ticket sans lien/);

    const region = within(dialog).getByRole('region', { name: 'Contenu du ticket' });

    expect(region.getAttribute('tabindex')).toBe('0');
    expect(region.hasAttribute('data-panel-body')).toBe(true);
    await user.tab(); // le bouton de fermeture, dans l'en-tête
    expect(document.activeElement).toBe(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));
    await user.tab(); // puis la zone qui défile : le clavier peut la faire défiler
    expect(document.activeElement).toBe(region);
  });

  it('n’est pas un arrêt de tabulation de plus quand tout tient à l’écran', async () => {
    overflowing(false);
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-6', title: 'Un ticket sans lien' })] } });
    renderApp('/p/bdesk/t/bdesk-6');
    const dialog = await openPanel(/Un ticket sans lien/);

    expect(dialog.querySelector('[data-panel-body]')?.hasAttribute('tabindex')).toBe(false);
    expect(within(dialog).queryByRole('region', { name: 'Contenu du ticket' })).toBeNull();
  });
});

describe('la chronologie : un rafraîchissement qui renvoie 404', () => {
  it('dit « Chronologie indisponible » au lieu de garder la chronologie périmée, sans bandeau générique : la section affiche elle-même ce 404', async () => {
    const fetchMock = stubApi({
      projects: projectsResponse,
      issues: { bdesk: [issue({ id: 'bdesk-1', title: 'Un ticket suivi' })] },
      chronologies: { 'bdesk/bdesk-1': chronology({ transitions: [{ status: 'open', at: '2026-10-01T09:00:00.000Z', duration: null }] }) },
    });
    const app = renderApp('/p/bdesk/t/bdesk-1');
    const dialog = await openPanel(/Un ticket suivi/);
    await within(dialog).findByRole('list', { name: 'Transitions' });

    const healthy = fetchMock.getMockImplementation();
    if (!healthy) throw new Error('attendu : le mock de stubApi');
    fetchMock.mockImplementation(async (input) =>
      String(input).endsWith('/chronology')
        ? new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'Ticket inconnu' }), { status: 404, headers: { 'Content-Type': 'application/json' } })
        : healthy(input),
    );
    await act(() => app.queryClient.refetchQueries({ queryKey: queryKeys.chronology('bdesk', 'bdesk-1'), exact: true }).catch(() => undefined));

    const alert = await within(dialog).findByRole('alert');
    expect(within(alert).getByText('Chronologie indisponible')).toBeTruthy();
    expect(within(dialog).queryByRole('list', { name: 'Transitions' })).toBeNull();
    expect(within(dialog).getByRole('heading', { level: 2, name: 'Un ticket suivi' })).toBeTruthy(); // la fiche, elle, n'a pas bougé
    expect(screen.queryByText(/Actualisation impossible/)).toBeNull();
  });
});
