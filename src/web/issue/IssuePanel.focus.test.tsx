import { type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import type { Issue, IssueChronology, IssueDetail, IssueRef, Project } from '../data/types';
import { refreshProject } from '../live/refresh';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, chronology, issueDetail, mpmIssues, projects, projectsResponse } from '../test/fixtures';
import { withFocusFixup } from '../test/focusFixup';
import { renderApp, stubApi } from '../test/render';

/**
 * Où est le focus quand ce qui l'avait quitte le panneau d'un ticket (bdesk-38k.32). Le bouton « Réessayer » (de la fiche, de la chronologie)
 * disparaît dès que la requête repart, qu'on l'ait pressé ou que la fiche se relise d'elle-même (retour sur l'onglet, direct) ; et le panneau
 * qu'un choix de la palette ⌘K a ouvert retenait pour origine le champ de la palette, retiré avec elle : dans tous les cas le focus tombait sur
 * le corps de la page, hors du panneau (sur mobile, hors d'une boîte de dialogue modale).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
/** Seule la fiche du ticket échoue (500, « database is locked ») : la liste des tickets du Projet reste lisible. */
const stubUnreadableDetail = () =>
  stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues }, details: { 'bdesk/bdesk-38k.6': new Error('database is locked') } });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const TICKET = '/p/bdesk/t/bdesk-38k.6';
const BOARD = '/p/bdesk/kanban';
const TITLE = /Shell UI façon Linear/;
const OTHER_TITLE = /Kanban par Projet/;

/** Un écran dont la largeur répond ou non à `(max-width: 767.98px)`, le seuil de `md:` de Tailwind. */
function screenIs(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /max-width: 767\.98px/.test(query) ? narrow : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

const SCREENS = [
  ['sur bureau (1280 px)', false],
  ['sur mobile (375 px), où le panneau est une boîte de dialogue modale', true],
] as const;

/** Les requêtes dont l'adresse passe `pattern` sont lentes à répondre : leur réponse, et elle seule, attend `release()`. */
function holdRequests(fetchMock: ReturnType<typeof stubApi>, pattern: RegExp) {
  const current = fetchMock.getMockImplementation();
  if (!current) throw new Error('holdRequests attend le mock renvoyé par stubApi.');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (input) => {
    if (pattern.test(String(input))) await gate;
    return current(input);
  });
  return release;
}
/** La fiche du ticket est lente à arriver (ni la liste, ni la chronologie ne le sont). */
const holdDetail = (fetchMock: ReturnType<typeof stubApi>) => holdRequests(fetchMock, /\/issues\/[^/]+$/);
/** La chronologie du ticket est lente à arriver. */
const holdChronology = (fetchMock: ReturnType<typeof stubApi>) => holdRequests(fetchMock, /\/issues\/[^/]+\/chronology$/);

/** Active « Réessayer » au clavier : le bouton a le focus (Tab), puis Entrée. */
async function pressRetry(user: UserEvent, dialog: HTMLElement) {
  act(() => within(dialog).getByRole('button', { name: /Réessayer/ }).focus());
  await user.keyboard('{Enter}');
}

/** Le navigateur reprend la fenêtre (retour sur l'onglet) : TanStack Query relit ce qui est périmé (`refetchOnWindowFocus`), sans que personne ait rien pressé. */
const windowRegained = () =>
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });

/** Ce qui relit la fiche et la chronologie sans que personne ait pressé « Réessayer » : le retour sur la fenêtre, ou un nouveau commit du Projet en direct. */
const AUTOMATIC_RELOADS = [
  ['le retour sur la fenêtre', () => windowRegained()],
  ['un nouveau commit en direct', (queryClient: QueryClient) => act(() => void refreshProject(queryClient, 'bdesk'))],
] as const;

/** Le serveur dit que la fiche n'existe plus (404) ; les autres réponses sont inchangées. Renvoie la fonction qui le rétablit. */
function detailGone(fetchMock: ReturnType<typeof stubApi>) {
  const current = fetchMock.getMockImplementation();
  if (!current) throw new Error('detailGone attend le mock renvoyé par stubApi.');
  fetchMock.mockImplementation(async (input) =>
    /\/issues\/bdesk-38k\.6$/.test(String(input))
      ? new Response(JSON.stringify({ statusCode: 404, error: 'Not Found', message: 'Ticket inconnu dans bdesk : bdesk-38k.6' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        })
      : current(input),
  );
  return () => void fetchMock.mockImplementation(current);
}

/** Combien de fois la fiche du ticket `bdesk-38k.6` a été demandée au serveur. */
const detailRequests = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls.filter(([input]) => /\/issues\/bdesk-38k\.6$/.test(String(input))).length;

/** Laisse passer les effets et les minuteries de 0 ms : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

describe.each(SCREENS)('« Réessayer » dans le panneau d’un ticket qui ne se charge pas : %s', (_screen, narrow) => {
  /** La fiche ne se charge pas : le panneau dit « Ticket indisponible » et propose « Réessayer ». */
  async function openUnreadable() {
    screenIs(narrow);
    const fetchMock = stubUnreadableDetail();
    const app = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    expect(dialog.getAttribute('aria-modal')).toBe(String(narrow));
    return { ...app, fetchMock, dialog };
  }

  it('le bouton disparaît quand la fiche se recharge : le focus reste dans le panneau, puis le titre le prend à son arrivée', async () => {
    const { user, dialog } = await openUnreadable();
    const release = holdDetail(stubDefaultApi()); // le serveur est rétabli, mais lent

    await pressRetry(user, dialog);

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    expect(loading).toBe(dialog); // le même panneau : il n'est pas remonté
    expect(within(loading).queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(loading.contains(document.activeElement)).toBe(true); // le clavier est toujours dans le panneau, pas sur le corps de la page

    release();
    const loaded = await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    const title = within(loaded).getByRole('heading', { level: 2, name: TITLE });
    // Le lecteur d'écran lit l'élément qui prend le focus : le titre arrive, il est dit (le nom du dialogue qui change ne l'est pas).
    await waitFor(() => expect(document.activeElement).toBe(title));
    // Le titre n'est pas dans l'ordre de Tab, mais il garde le contour de base des éléments à `tabindex` (l'accent du thème, au clavier seulement) :
    // l'utilisateur au clavier voit où le focus est allé. jsdom ne calcule pas ce contour (le navigateur le vérifie) : on s'assure qu'aucune classe ne le retire.
    expect(title.getAttribute('tabindex')).toBe('-1');
    expect(title.className).not.toMatch(/\boutline-(none|hidden)\b/);
  });

  it('la fiche revient aussitôt, sans rien à attendre : le focus passe du bouton au titre sans passer par le corps de la page', async () => {
    const { user, dialog } = await openUnreadable();
    stubDefaultApi(); // le serveur est rétabli et répond tout de suite : le rechargement n'est peut-être jamais dessiné

    await pressRetry(user, dialog);

    const loaded = await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await waitFor(() => expect(document.activeElement).toBe(within(loaded).getByRole('heading', { level: 2, name: TITLE })));
  });

  it.each(AUTOMATIC_RELOADS)('la fiche se recharge d’elle-même (%s) pendant que « Réessayer » a le focus : le bouton part, le focus reste dans le panneau', async (_cause, reload) => {
    const { dialog, queryClient } = await openUnreadable();
    act(() => within(dialog).getByRole('button', { name: /Réessayer/ }).focus());
    const release = holdDetail(stubDefaultApi()); // le serveur est rétabli, mais lent

    reload(queryClient); // personne n'a pressé « Réessayer »

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    expect(within(loading).queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(loading.contains(document.activeElement)).toBe(true); // ni le corps de la page, ni rien : le clavier est toujours dans le panneau

    release();
    await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await settle();
    // Personne n'a demandé ce succès : le panneau garde le focus, le titre ne le prend pas.
    expect(document.activeElement).toBe(dialog);
  });

  it('la fiche échoue encore : le focus reste dans le panneau, qui propose de nouveau « Réessayer »', async () => {
    const { user, dialog, fetchMock } = await openUnreadable();
    const release = holdDetail(fetchMock); // toujours en panne, et lent

    await pressRetry(user, dialog);
    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    expect(loading.contains(document.activeElement)).toBe(true);
    release();

    const again = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    await settle();
    expect(within(again).getByRole('button', { name: /Réessayer/ })).toBeTruthy();
    expect(again.contains(document.activeElement)).toBe(true);
    // L'alerte dit l'échec : le titre « Ticket indisponible » n'a pas à le redire en prenant le focus.
    expect(document.activeElement).toBe(again);
  });
});

describe.each(SCREENS)('« Réessayer » de la chronologie, dans le panneau d’un ticket dont la fiche se lit : %s', (_screen, narrow) => {
  it('le bouton disparaît quand la chronologie se recharge : le focus reste dans le panneau', async () => {
    screenIs(narrow);
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      chronologies: { 'bdesk/bdesk-38k.6': new Error('database is locked') }, // la fiche se lit, son historique non
    });
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByText('Chronologie indisponible');
    const release = holdChronology(stubDefaultApi()); // le serveur est rétabli, mais lent

    await pressRetry(user, dialog);

    await within(dialog).findByRole('status', { name: 'Chargement de la chronologie' });
    expect(within(dialog).queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true); // le clavier est toujours dans le panneau, pas sur le corps de la page

    release();
    await within(dialog).findByRole('list', { name: 'Transitions' });
    await settle();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });

  it('son « Réessayer » est activé sans que le bouton ait pris le focus (toucher, lecteur d’écran, Safari) : le panneau prend le focus', async () => {
    screenIs(narrow);
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      chronologies: { 'bdesk/bdesk-38k.6': new Error('database is locked') },
    });
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByText('Chronologie indisponible');
    await user.click(document.body); // le focus est sur le corps de la page
    expect(document.activeElement).toBe(document.body);
    const release = holdChronology(stubDefaultApi());

    act(() => within(dialog).getByRole('button', { name: /Réessayer/ }).click()); // le clic n'a pas mis le focus sur le bouton

    await within(dialog).findByRole('status', { name: 'Chargement de la chronologie' });
    expect(dialog.contains(document.activeElement)).toBe(true);
    release();
    await within(dialog).findByRole('list', { name: 'Transitions' });
  });

  it.each(AUTOMATIC_RELOADS)('la chronologie se recharge d’elle-même (%s) pendant que son « Réessayer » a le focus : le focus reste dans le panneau', async (_cause, reload) => {
    screenIs(narrow);
    stubApi({
      projects: projectsResponse,
      issues: { bdesk: bdeskIssues },
      chronologies: { 'bdesk/bdesk-38k.6': new Error('database is locked') },
    });
    const { queryClient } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    await within(dialog).findByText('Chronologie indisponible');
    act(() => within(dialog).getByRole('button', { name: /Réessayer/ }).focus());
    const release = holdChronology(stubDefaultApi());

    reload(queryClient);

    await within(dialog).findByRole('status', { name: 'Chargement de la chronologie' });
    expect(within(dialog).queryByRole('button', { name: /Réessayer/ })).toBeNull();
    expect(dialog.contains(document.activeElement)).toBe(true);
    release();
    await within(dialog).findByRole('list', { name: 'Transitions' });
    await settle();
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

describe('« Réessayer » dans le panneau d’un ticket qui ne se charge pas : ce que l’utilisateur a décidé entre-temps', () => {
  it('il a mis le focus ailleurs dans le panneau pendant le rechargement : le titre ne le lui prend pas', async () => {
    screenIs(false);
    stubUnreadableDetail();
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    const release = holdDetail(stubDefaultApi());
    await pressRetry(user, dialog);
    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    const close = within(loading).getByRole('button', { name: 'Fermer le panneau' });
    act(() => close.focus());

    release();
    await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await settle();

    expect(document.activeElement).toBe(close);
  });

  it.each([
    ['un clic dans le vide : le focus est sur le corps de la page', 'void'],
    ['une carte du tableau, que le panneau laisse utilisable : le focus est sur la carte', 'card'],
  ] as const)('il met le focus hors du panneau pendant le rechargement (%s) : ni le panneau ni le titre ne le reprennent', async (_where, where) => {
    screenIs(false);
    stubUnreadableDetail();
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    const release = holdDetail(stubDefaultApi());
    await pressRetry(user, dialog);
    await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    if (where === 'void') await user.click(document.body);
    else act(() => card.focus());
    const elsewhere = document.activeElement;
    expect(elsewhere).toBe(where === 'void' ? document.body : card);

    release();
    await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await settle();

    expect(document.activeElement).toBe(elsewhere);
  });

  it('« Réessayer » est activé sans que le bouton ait pris le focus (toucher, lecteur d’écran, Safari) : le panneau le prend, puis le titre', async () => {
    screenIs(false);
    stubUnreadableDetail();
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    await user.click(document.body); // le focus est sur le corps de la page
    expect(document.activeElement).toBe(document.body);
    const release = holdDetail(stubDefaultApi());

    act(() => within(dialog).getByRole('button', { name: /Réessayer/ }).click()); // le clic n'a pas mis le focus sur le bouton

    const loading = await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    expect(loading.contains(document.activeElement)).toBe(true);
    release();
    const loaded = await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await waitFor(() => expect(document.activeElement).toBe(within(loaded).getByRole('heading', { level: 2, name: TITLE })));
  });

  it('le ticket n’existe plus (404) : le titre « Ticket introuvable » prend le focus, comme celui d’une fiche', async () => {
    screenIs(false);
    stubUnreadableDetail();
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    const release = holdDetail(stubApi({ projects: projectsResponse, issues: { bdesk: [] } })); // le ticket a été supprimé entre-temps

    await pressRetry(user, dialog);
    await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    release();

    const gone = await screen.findByRole('dialog', { name: 'bdesk-38k.6 Ticket introuvable' });
    const title = within(gone).getByRole('heading', { level: 2, name: 'Ticket introuvable' });
    await waitFor(() => expect(document.activeElement).toBe(title));
  });

  it('il ouvre un autre ticket avant la fin du rechargement : le focus que le panneau prend pour lui reste au panneau, le titre ne le prend pas', async () => {
    screenIs(false);
    stubUnreadableDetail();
    const { user, router } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    const release = holdDetail(stubDefaultApi());
    await pressRetry(user, dialog);
    await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    await act(() => router.navigate('/p/bdesk/t/bdesk-38k.7'));
    const next = await screen.findByRole('dialog', { name: 'bdesk-38k.7' });

    release();
    await screen.findByRole('dialog', { name: /^bdesk-38k\.7 Kanban par Projet/ });
    await settle();

    expect(document.activeElement).toBe(next);
  });
});

describe.each([
  ['le rechargement est dessiné (réponse lente)', true],
  ['la réponse revient aussitôt, le rechargement n’est peut-être jamais dessiné', false],
] as const)('« Réessayer » échoue encore, puis la fiche se relit d’elle-même avec succès : %s', (_case, slow) => {
  it('personne n’a demandé ce succès : le panneau garde le focus, le titre ne le prend pas', async () => {
    screenIs(false);
    const failing = stubUnreadableDetail();
    const { user } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    const release = slow ? holdDetail(failing) : () => undefined; // toujours en panne
    await pressRetry(user, dialog); // l'utilisateur réessaie : la fiche échoue encore
    if (slow) await screen.findByRole('dialog', { name: 'bdesk-38k.6' });
    release();
    await waitFor(() => expect(detailRequests(failing)).toBe(2));
    await screen.findByRole('dialog', { name: /Ticket indisponible/ });
    await settle();
    expect(document.activeElement).toBe(dialog);

    stubDefaultApi(); // le serveur est rétabli
    windowRegained(); // l'utilisateur revient sur l'onglet : la fiche se relit toute seule

    const loaded = await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await settle();
    expect(within(loaded).getByRole('heading', { level: 2, name: TITLE })).toBeTruthy();
    expect(document.activeElement).toBe(dialog);
  });
});

describe('ce qui a le focus dans le panneau part avec le corps qui change d’état : le panneau le prend, quelle que soit la cause', () => {
  it('la fiche est supprimée (404) à une relecture pendant qu’un lien du contenu a le focus : il part avec la fiche, le focus reste dans le panneau', async () => {
    screenIs(false);
    const fetchMock = stubDefaultApi();
    const { queryClient } = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    const link = within(dialog).getByRole('link', { name: /^Epic : beads-desktop V1/ });
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    detailGone(fetchMock);
    await act(() => queryClient.refetchQueries({ queryKey: queryKeys.issue('bdesk', 'bdesk-38k.6'), exact: true }).catch(() => undefined));

    await screen.findByRole('dialog', { name: /Ticket introuvable/ });
    expect(link.isConnected).toBe(false);
    expect(dialog.contains(document.activeElement)).toBe(true);
  });
});

/*
 * Ce qui a le focus dans le panneau part SANS que le panneau change d'état (bdesk-38k.46) : la fiche reste une fiche, la chronologie une chronologie, et c'est un
 * de leurs liens qui disparaît (un commit en direct retire le parent, une relation, un Blocage, un lien du texte). L'enveloppe du corps reste : aucune ref ne se
 * détache (bdesk-38k.32), et le focus tombait sur le corps de la page, hors du panneau (sur mobile, hors d'une boîte de dialogue modale).
 */
const PARENT: IssueRef = { id: 'bdesk-38k.7', title: 'Kanban par Projet (lecture seule)', type: 'feature', status: 'open', priority: 1 };
const BLOCKER: IssueRef = { id: 'bdesk-b7q', title: 'Le graphique du Débit se décale après minuit', type: 'bug', status: 'open', priority: 0 };
const EPIC = { id: 'bdesk-38k', title: 'beads-desktop V1 : suivi des tickets' };

const SHELL_UI = bdeskIssues.find((candidate) => candidate.id === 'bdesk-38k.6')!;
/** La fiche avec tout ce qu'elle porte de liens : son parent, son Epic, un ticket qui la bloque (en-tête et relations), un lien dans sa description. */
const LINKED_DETAIL: IssueDetail = issueDetail({
  ...SHELL_UI,
  parentId: PARENT.id,
  blockedBy: [BLOCKER.id],
  dependencies: [
    { to: PARENT.id, type: 'parent-child' },
    { to: BLOCKER.id, type: 'blocks' },
  ],
  linked: { [PARENT.id]: PARENT, [BLOCKER.id]: BLOCKER },
  epic: EPIC,
  description: 'Voir [la maquette](https://example.org/maquette).',
});
/** La même fiche après un commit qui lui retire tout cela : toujours une fiche (le texte reste, sans lien), mais plus aucun de ses liens. */
const BARE_DETAIL: IssueDetail = issueDetail({ ...SHELL_UI, parentId: null, blockedBy: [], dependencies: [], linked: {}, epic: null, description: 'Voir la maquette.' });
/** Sa chronologie avec un Blocage (qui attend `bdesk-b7q`), puis sans. */
const BLOCKED_CHRONOLOGY: IssueChronology = chronology({
  blockages: [
    {
      from: '2026-10-02T09:00:00.000Z',
      to: null,
      blockedBy: [BLOCKER.id],
      statusBlocked: false,
      phases: [{ kind: 'dependencyWait', from: '2026-10-02T09:00:00.000Z', to: null }],
    },
  ],
});

/** Ce que le serveur dit de la fiche et de la chronologie du ticket, à partir de maintenant. */
const serve = (detail: IssueDetail, history: IssueChronology) =>
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: bdeskIssues, mpm: mpmIssues },
    details: { 'bdesk/bdesk-38k.6': detail },
    chronologies: { 'bdesk/bdesk-38k.6': history },
  });
/** Un commit du Projet, en direct : la fiche et la chronologie affichées sont relues. */
const commit = (queryClient: QueryClient) => act(() => refreshProject(queryClient, 'bdesk'));

/** Les liens du panneau qui peuvent avoir le focus et partir : chacun est cherché dans le panneau tel que `LINKED_DETAIL` l'écrit. */
const FOCUSABLE_LINKS: readonly [string, (dialog: HTMLElement) => HTMLElement][] = [
  ['le lien « Parent » de l’en-tête (un ticket qui n’est pas une Epic)', (dialog) => within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / })],
  ['le lien de la page Epic', (dialog) => within(dialog).getByRole('link', { name: /^Page Epic : / })],
  // Le premier dans l'ordre du document : l'en-tête précède la chronologie, qui nomme aussi le ticket (un Blocage), et les relations, qui ajoutent son titre au nom du lien.
  ['le ticket qui bloque, dans « Bloqué : attend » de l’en-tête', (dialog) => within(dialog).getAllByRole('link', { name: 'bdesk-b7q' })[0]!],
  ['un ticket de la liste des relations (« Parent »)', (dialog) => within(within(dialog).getByRole('list', { name: 'Parent' })).getByRole('link')],
  ['un ticket de la liste des relations (« Bloqué par »)', (dialog) => within(within(dialog).getByRole('list', { name: 'Bloqué par' })).getByRole('link')],
  ['un lien du texte de la description (du Markdown, pas un lien de ticket)', (dialog) => within(dialog).getByRole('link', { name: 'la maquette' })],
];

describe.each(SCREENS)('un lien du panneau qui a le focus disparaît sans que le panneau change d’état (un commit en direct) : %s', (_screen, narrow) => {
  /** La fiche avec tous ses liens, sa chronologie avec un Blocage : le panneau est ouvert sur le ticket. */
  async function openLinked() {
    screenIs(narrow);
    serve(LINKED_DETAIL, BLOCKED_CHRONOLOGY);
    const app = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog.getAttribute('aria-modal')).toBe(String(narrow));
    await within(dialog).findByRole('list', { name: 'Blocages' });
    return { ...app, dialog };
  }
  /** Le commit retire tous les liens de la fiche et de la chronologie ; renvoie ce que le panneau en dit (le panneau ne change pas d'état). */
  async function commitWithoutLinks(queryClient: QueryClient, gone: HTMLElement) {
    serve(BARE_DETAIL, chronology());
    await commit(queryClient);
    await waitFor(() => expect(gone.isConnected).toBe(false));
    await settle();
  }

  it.each(FOCUSABLE_LINKS)('%s part : le panneau prend le focus, ni le corps de la page ni rien', async (_link, find) => {
    const { dialog, queryClient } = await openLinked();
    const link = find(dialog);
    act(() => link.focus());
    expect(document.activeElement).toBe(link);

    await commitWithoutLinks(queryClient, link);

    // Le panneau n'a pas changé d'état : le même panneau, la même fiche (un titre, pas « Ticket introuvable »), relue sans son parent.
    expect(screen.getByRole('dialog', { name: TITLE })).toBe(dialog);
    expect(within(dialog).getByRole('heading', { level: 2, name: TITLE })).toBeTruthy();
    expect(within(dialog).queryByRole('link', { name: /^Parent / })).toBeNull();
    expect(document.activeElement).toBe(dialog); // ni le corps de la page ni rien ; à 375, le focus ne sort pas de la boîte de dialogue modale
  });

  it('le lien d’un Blocage de la chronologie part (seule la chronologie est relue) : le panneau prend le focus', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(within(dialog).getByRole('list', { name: 'Blocages' })).getByRole('link', { name: 'bdesk-b7q' });
    act(() => link.focus());
    serve(LINKED_DETAIL, chronology()); // la fiche ne change pas : seule la chronologie perd son Blocage

    await commit(queryClient);
    await waitFor(() => expect(link.isConnected).toBe(false));
    await settle();

    expect(within(dialog).queryByRole('list', { name: 'Blocages' })).toBeNull();
    expect(within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / })).toBeTruthy(); // la fiche, elle, a gardé ses liens
    expect(document.activeElement).toBe(dialog);
  });

  it('le panneau prend le focus une fois rendu : l’utilisateur le met sur un autre lien, qui part à son tour, et le panneau le reprend', async () => {
    const { dialog, queryClient } = await openLinked();
    const parent = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    act(() => parent.focus());
    await commitWithoutLinks(queryClient, parent);
    expect(document.activeElement).toBe(dialog);
    serve(LINKED_DETAIL, BLOCKED_CHRONOLOGY); // un autre commit lui rend ses liens
    await commit(queryClient);
    const blocker = (await within(dialog).findAllByRole('link', { name: 'bdesk-b7q' }))[0]!;
    act(() => blocker.focus());

    await commitWithoutLinks(queryClient, blocker);

    expect(document.activeElement).toBe(dialog);
  });

  it('la fenêtre est en second plan quand le commit arrive (le lien garde le focus du document, sans l’avoir pour l’écran) : le panneau le prend', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    act(() => link.focus());
    act(() => void link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); // la fenêtre perd le focus : le navigateur envoie `blur` au lien, qui reste l'élément actif
    expect(document.activeElement).toBe(link);

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(dialog);
  });

  it('un premier commit ne retire pas le lien, la fenêtre étant en second plan (seule la chronologie change) : le lien garde le focus du document, et le commit qui le retire rend le focus au panneau', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    act(() => link.focus());
    act(() => void link.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); // la fenêtre perd le focus : le lien reste l'élément actif du document
    serve(LINKED_DETAIL, chronology()); // la chronologie perd son Blocage, la fiche garde le lien « Parent »
    await commit(queryClient);
    await waitFor(() => expect(within(dialog).queryByRole('list', { name: 'Blocages' })).toBeNull());
    await settle();
    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(link);

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(dialog);
  });

  it('le lien a perdu le focus sans événement (déplacé dans le document : Firefox et Safari n’en envoient pas), puis il part : le corps de la page, qui a le focus depuis, le garde', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    act(() => link.focus());
    act(() => void link.parentElement!.insertBefore(link, link.nextSibling)); // déplacé sur place : le focus est perdu, sans un événement, le lien est toujours dans le panneau
    await settle();
    expect(link.isConnected).toBe(true);
    expect(document.activeElement).toBe(document.body);

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(document.body); // le panneau ne reprend pas un focus que le lien n'avait plus
  });

  it('l’utilisateur a mis le focus sur le bouton « Fermer le panneau » : le lien qui part ensuite ne le lui prend pas', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    const close = within(dialog).getByRole('button', { name: 'Fermer le panneau' });
    act(() => link.focus());
    act(() => close.focus());

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(close);
  });

  it('l’utilisateur est passé à un autre lien du panneau (Tab) : le lien qui part ensuite ne le lui prend pas', async () => {
    const { dialog, queryClient } = await openLinked();
    const parent = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    const maquette = within(dialog).getByRole('link', { name: 'la maquette' });
    act(() => parent.focus());
    act(() => maquette.focus());
    serve(issueDetail({ ...LINKED_DETAIL, parentId: null, dependencies: [], linked: {}, epic: null }), BLOCKED_CHRONOLOGY); // le parent part, le texte garde son lien
    await commit(queryClient);
    await waitFor(() => expect(parent.isConnected).toBe(false));
    await settle();

    expect(document.activeElement).toBe(maquette);
  });

  it('l’utilisateur a cliqué dans le vide (le corps de la page a le focus) : le lien qui part ensuite ne lui rend pas le focus', async () => {
    const { user, dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    act(() => link.focus());
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(document.body);
  });

  it.skipIf(narrow)('l’utilisateur est passé à une carte du tableau, que le panneau laisse utilisable : le lien qui part ensuite ne la lui reprend pas', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    act(() => link.focus());
    act(() => card.focus());

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(card);
  });

  it.skipIf(narrow)('l’utilisateur est passé à la barre latérale : le lien qui part ensuite ne le lui reprend pas', async () => {
    const { dialog, queryClient } = await openLinked();
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });
    act(() => link.focus());
    act(() => sidebarLink.focus());

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(sidebarLink);
  });

  it('un élément du panneau qui part sans avoir le focus (rien n’en a dans le panneau) ne le donne à personne', async () => {
    const { dialog, queryClient } = await openLinked();
    act(() => (document.activeElement as HTMLElement).blur()); // le panneau avait le focus à son ouverture : le corps de la page l'a maintenant
    expect(document.activeElement).toBe(document.body);
    const link = within(dialog).getByRole('link', { name: /^Parent bdesk-38k\.7 / });

    await commitWithoutLinks(queryClient, link);

    expect(document.activeElement).toBe(document.body);
  });
});

describe.each(SCREENS)('le panneau d’un ticket rend le focus à un élément utile en se fermant : %s', (_screen, narrow) => {
  /** Ouvre `OTHER_TITLE` par la palette ⌘K, depuis le kanban : le panneau retient pour origine le champ de la palette, qu'elle retire en se fermant. */
  async function openFromPalette(how: 'keyboard' | 'click') {
    screenIs(narrow);
    stubDefaultApi();
    const app = renderApp(BOARD);
    await screen.findByRole('region', { name: 'En cours' });
    await app.user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    const field = document.activeElement; // le champ de la palette : ce que le panneau retient pour origine
    await app.user.keyboard('38k.7');
    const option = await within(palette).findByRole('option', { name: OTHER_TITLE });

    if (how === 'keyboard') await app.user.keyboard('{Enter}');
    else await app.user.click(option);
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE });
    expect(pathname(app.router)).toBe('/p/bdesk/t/bdesk-38k.7');
    expect(document.activeElement).toBe(panel);
    expect(field?.isConnected).toBe(false); // la palette s'est retirée avec son champ : l'origine du panneau n'est plus dans la page
    return { ...app, panel };
  }

  it.each([
    ['Entrée', 'keyboard'],
    ['un clic', 'click'],
  ] as const)('ouvert par un choix de la palette (%s), Échap le ferme : le contenu principal a le focus, pas le corps de la page', async (_how, how) => {
    const { user, router } = await openFromPalette(how);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(BOARD);
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('ouvert par l’adresse, où rien n’avait le focus, Échap le ferme : le contenu principal a le focus, pas le corps de la page', async () => {
    screenIs(narrow);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    const panel = await screen.findByRole('dialog', { name: TITLE });
    expect(document.activeElement).toBe(panel);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(BOARD);
    expect(document.activeElement).toBe(document.querySelector('main'));
  });

  it('le bouton « Fermer le panneau » le ferme de même, un panneau ouvert par la palette', async () => {
    const { user, panel } = await openFromPalette('keyboard');

    await user.click(within(panel).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(document.querySelector('main'));
  });
});

describe('le panneau d’un ticket qui se ferme laisse le focus là où l’utilisateur l’a mis', () => {
  it('un lien de la barre latérale suivi pendant que le panneau est ouvert garde le focus : il n’est pas rendu au contenu principal', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await screen.findByRole('dialog', { name: TITLE });
    const link = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });

    await user.click(link);

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/metrics'));
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(link);
  });
});

/*
 * La zone de défilement du panneau a le focus (le clavier la fait défiler) et un commit raccourcit le contenu au point qu'il ne défile plus (bdesk-38k.59) : elle cesse d'être
 * focalisable (plus de `tabindex`), et le navigateur lui retirait le focus, qui tombait sur le corps de la page : hors du panneau, et sur mobile hors de la boîte de dialogue modale.
 * Elle le garde tant que le focus est sur elle, et cesse d'être un arrêt de tabulation dès qu'il la quitte. Même chose pour un bloc de code ou un tableau du texte, qui défile en largeur.
 * `withFocusFixup` : jsdom retire le focus à un élément qui cesse d'être focalisable, comme les navigateurs ; jsdom ne mesure rien : on fixe la mesure, selon le texte.
 */
const LONG_MARK = 'FIN-LONGUE';
const LONG_DETAIL: IssueDetail = issueDetail({ ...SHELL_UI, description: `${'Un paragraphe de plus.\n\n'.repeat(40)}${LONG_MARK}` });
const SHORT_DETAIL: IssueDetail = issueDetail({ ...SHELL_UI, description: 'Court.' });
const WIDE_MARK = 'LIGNE-LONGUE';
const WIDE_DETAIL: IssueDetail = issueDetail({ ...SHELL_UI, description: `Un bloc de code :\n\n\`\`\`\nconst ${WIDE_MARK} = '${'x'.repeat(200)}';\n\`\`\`` });
const SHORT_CODE_DETAIL: IssueDetail = issueDetail({ ...SHELL_UI, description: 'Un bloc de code :\n\n```\nconst court = 1;\n```' });

/** Le contenu du panneau dépasse sa hauteur tant que le texte porte `LONG_MARK`, et le bloc de code sa largeur tant qu'il porte `WIDE_MARK`. */
function measureOverflow() {
  const text = (element: HTMLElement) => element.textContent ?? '';
  vi.spyOn(HTMLElement.prototype, 'scrollHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-panel-body') && text(this).includes(LONG_MARK) ? 2400 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientHeight', 'get').mockImplementation(function (this: HTMLElement) {
    return this.hasAttribute('data-panel-body') ? 700 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'scrollWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('overflow-x-auto') && text(this).includes(WIDE_MARK) ? 1600 : 0;
  });
  vi.spyOn(HTMLElement.prototype, 'clientWidth', 'get').mockImplementation(function (this: HTMLElement) {
    return this.classList.contains('overflow-x-auto') ? 400 : 0;
  });
}

describe.each(SCREENS)('une zone de défilement du panneau a le focus quand un commit raccourcit le contenu : %s', (_screen, narrow) => {
  withFocusFixup();
  afterEach(() => {
    vi.restoreAllMocks();
  });

  /** Le panneau d'un ticket au texte long : sa zone de défilement est une région nommée, focalisable. */
  async function openLong(detail: IssueDetail) {
    screenIs(narrow);
    measureOverflow();
    serve(detail, chronology());
    const app = renderApp(TICKET);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog.getAttribute('aria-modal')).toBe(String(narrow));
    return { ...app, dialog };
  }
  /** Le commit raccourcit le texte (`mark` n'y est plus) : plus rien ne défile. */
  async function commitShorter(queryClient: QueryClient, detail: IssueDetail, mark: string) {
    serve(detail, chronology());
    await commit(queryClient);
    await waitFor(() => expect(screen.queryByText(new RegExp(mark))).toBeNull());
    await settle();
  }

  it('la zone qui défile a le focus : le contenu raccourcit et elle le garde, au lieu de le laisser tomber sur le corps de la page', async () => {
    const { dialog, queryClient } = await openLong(LONG_DETAIL);
    const region = await within(dialog).findByRole('region', { name: 'Contenu du ticket' });
    act(() => region.focus());
    expect(document.activeElement).toBe(region);

    await commitShorter(queryClient, SHORT_DETAIL, LONG_MARK);

    expect(within(dialog).getByText('Court.')).toBeTruthy();
    expect(document.activeElement).toBe(region); // pas le corps de la page ; à 375, le focus ne sort pas de la boîte de dialogue modale
    expect(region.getAttribute('tabindex')).toBe('0');
    expect(within(dialog).getByRole('region', { name: 'Contenu du ticket' })).toBe(region); // toujours nommée : le lecteur d'écran dit où est le focus
  });

  it('le focus quitte la zone (Tab vers « Fermer le panneau » : elle ne défile plus) : elle n’est pas un arrêt de tabulation de plus', async () => {
    const { dialog, queryClient } = await openLong(LONG_DETAIL);
    const region = await within(dialog).findByRole('region', { name: 'Contenu du ticket' });
    act(() => region.focus());
    await commitShorter(queryClient, SHORT_DETAIL, LONG_MARK);
    const close = within(dialog).getByRole('button', { name: 'Fermer le panneau' });

    act(() => close.focus());
    await settle();

    expect(document.activeElement).toBe(close);
    expect(region.hasAttribute('tabindex')).toBe(false);
    expect(region.hasAttribute('role')).toBe(false);
    expect(within(dialog).queryByRole('region', { name: 'Contenu du ticket' })).toBeNull();
  });

  it('le focus a déjà quitté la zone (« Fermer le panneau » l’a) : le commit qui raccourcit le contenu ne le lui rend pas', async () => {
    const { dialog, queryClient } = await openLong(LONG_DETAIL);
    const region = await within(dialog).findByRole('region', { name: 'Contenu du ticket' });
    const close = within(dialog).getByRole('button', { name: 'Fermer le panneau' });
    act(() => region.focus());
    act(() => close.focus());

    await commitShorter(queryClient, SHORT_DETAIL, LONG_MARK);

    expect(document.activeElement).toBe(close);
    expect(region.hasAttribute('tabindex')).toBe(false);
  });

  it('l’utilisateur a cliqué dans le vide (le corps de la page a le focus) : le commit qui raccourcit le contenu ne lui reprend rien', async () => {
    const { user, dialog, queryClient } = await openLong(LONG_DETAIL);
    const region = await within(dialog).findByRole('region', { name: 'Contenu du ticket' });
    act(() => region.focus());
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);

    await commitShorter(queryClient, SHORT_DETAIL, LONG_MARK);

    expect(document.activeElement).toBe(document.body);
    expect(region.hasAttribute('tabindex')).toBe(false);
  });

  it('la fenêtre est en second plan quand le commit arrive (la zone reste l’élément actif du document) : elle garde le focus', async () => {
    const { dialog, queryClient } = await openLong(LONG_DETAIL);
    const region = await within(dialog).findByRole('region', { name: 'Contenu du ticket' });
    act(() => region.focus());
    act(() => void region.dispatchEvent(new FocusEvent('focusout', { bubbles: true }))); // la fenêtre perd le focus : le navigateur envoie `blur` à la zone, qui reste l'élément actif
    expect(document.activeElement).toBe(region);

    await commitShorter(queryClient, SHORT_DETAIL, LONG_MARK);

    expect(document.activeElement).toBe(region);
    expect(region.getAttribute('tabindex')).toBe('0');
  });

  it('un bloc de code du texte, qui défile en largeur, a le focus : le code raccourcit et il le garde', async () => {
    const { dialog, queryClient } = await openLong(WIDE_DETAIL);
    await waitFor(() => expect(dialog.querySelector('div.overflow-x-auto')?.getAttribute('tabindex')).toBe('0'));
    const box = dialog.querySelector<HTMLElement>('div.overflow-x-auto')!;
    act(() => box.focus());
    expect(document.activeElement).toBe(box);

    await commitShorter(queryClient, SHORT_CODE_DETAIL, WIDE_MARK);

    expect(within(dialog).getByText(/const court = 1;/)).toBeTruthy();
    expect(dialog.querySelector('div.overflow-x-auto')).toBe(box); // le même bloc : il n'est pas remonté
    expect(document.activeElement).toBe(box);
    expect(box.getAttribute('tabindex')).toBe('0');
  });

  it('le focus quitte le bloc de code qui ne défile plus : il n’est pas un arrêt de tabulation de plus', async () => {
    const { dialog, queryClient } = await openLong(WIDE_DETAIL);
    await waitFor(() => expect(dialog.querySelector('div.overflow-x-auto')?.getAttribute('tabindex')).toBe('0'));
    const box = dialog.querySelector<HTMLElement>('div.overflow-x-auto')!;
    act(() => box.focus());
    await commitShorter(queryClient, SHORT_CODE_DETAIL, WIDE_MARK);

    act(() => within(dialog).getByRole('button', { name: 'Fermer le panneau' }).focus());
    await settle();

    expect(box.hasAttribute('tabindex')).toBe(false);
  });
});

/*
 * Le panneau est ouvert depuis une carte du tableau, et un commit change cette carte de colonne (bdesk-38k.68). Le panneau retient pour origine l'élément qui avait le focus quand il
 * s'est ouvert, le lien de la carte, pour le lui rendre à sa fermeture. Le commit a remonté la carte dans l'autre colonne : ce lien n'est plus dans le document, et le focus allait au
 * contenu principal (le repli prévu), pas à la carte, que le clavier avait sélectionnée. Il va maintenant à la carte, là où elle est ; au contenu principal quand elle n'est pas à
 * l'écran (la colonne d'arrivée est cachée sur un écran étroit, le ticket est supprimé, le tiroir « En pause » est fermé). Jamais le focus qu'un utilisateur a mis ailleurs.
 */
const MOVING = 'bdesk-38k.6';
/** Les tickets du tableau après un commit qui change `MOVING`. */
const afterCommit = (change: Partial<Issue>) => bdeskIssues.map((candidate) => (candidate.id === MOVING ? { ...candidate, ...change } : candidate));
const closedNow = (): Partial<Issue> => {
  const now = new Date().toISOString();
  return { status: 'closed', closedAt: now, updatedAt: now };
};
const serveBoard = (issues: Issue[]) => stubApi({ projects: projectsResponse, issues: { bdesk: issues, mpm: mpmIssues } });
const cardLinkOf = (id: string) => document.querySelector<HTMLElement>(`a[data-card-link="${id}"]`)!;
const mainOf = () => document.querySelector('main');

/** Sur un écran étroit, une seule colonne est affichée : jsdom ne charge pas le CSS de l'application, on y reproduit la règle dont dépend le focus. */
function withHiddenColumns() {
  let style: HTMLStyleElement | undefined;
  beforeEach(() => {
    style = document.createElement('style');
    style.textContent = 'section[data-column]:not([data-shown="true"]) { display: none; }';
    document.head.append(style);
  });
  afterEach(() => style?.remove());
}

describe.each(SCREENS)('le panneau ouvert depuis une carte que le commit change de colonne se ferme : %s', (_screen, narrow) => {
  if (narrow) withHiddenColumns();
  /** Où doit aller le focus pour une carte qui arrive dans Terminé : sa carte, ou le contenu principal quand la colonne est cachée. */
  const expectedTarget = () => (narrow ? mainOf() : cardLinkOf(MOVING));

  /** Le tableau (le tiroir « En pause » ouvert, si on le demande), une carte (En cours) qui prend le focus comme au clavier, et Entrée ouvre son panneau : le panneau retient le lien de la carte. */
  async function openFromCard({ drawer = false } = {}) {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const app = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    if (drawer) await app.user.click(screen.getByRole('button', { name: /^En pause/ }));
    act(() => card.focus());
    await app.user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    expect(dialog.getAttribute('aria-modal')).toBe(String(narrow));
    return { ...app, card, dialog };
  }
  /** Le commit change la carte de colonne : son lien est retiré, un autre est monté dans la colonne d'arrivée. */
  async function moveCard(queryClient: QueryClient, card: HTMLElement, change: Partial<Issue>) {
    serveBoard(afterCommit(change));
    await commit(queryClient);
    await waitFor(() => expect(card.isConnected).toBe(false));
    await settle();
  }

  it('Échap : la carte, là où elle est maintenant, prend le focus (le contenu principal quand sa colonne est cachée)', async () => {
    const { user, card, queryClient, router } = await openFromCard();
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe(BOARD));
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
    expect(card.isConnected).toBe(false);
    expect(cardLinkOf(MOVING).closest('li')?.dataset.column).toBe('done');
    expect(router.state.location.search).toBe(''); // seul un choix de l'utilisateur change la colonne affichée : rien n'est écrit dans l'adresse
  });

  it('le bouton « Fermer le panneau » le ferme de même', async () => {
    const { user, dialog, card, queryClient } = await openFromCard();
    await moveCard(queryClient, card, closedNow());

    await user.click(within(dialog).getByRole('button', { name: 'Fermer le panneau' }));

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
  });

  it('la carte change de colonne deux fois (fermée, puis rouverte) pendant que le panneau est ouvert : le focus va à la carte, dans sa colonne finale', async () => {
    const { user, card, queryClient } = await openFromCard();
    await moveCard(queryClient, card, closedNow());
    const second = cardLinkOf(MOVING);
    serveBoard(bdeskIssues); // un autre commit la ramène dans En cours
    await commit(queryClient);
    await waitFor(() => expect(second.isConnected).toBe(false));
    await settle();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cardLinkOf(MOVING)));
    expect(cardLinkOf(MOVING).closest('li')?.dataset.column).toBe('inProgress');
  });

  it('la carte n’a pas bougé : le focus lui revient, c’est le même lien', async () => {
    const { user, card } = await openFromCard();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(document.activeElement).toBe(card);
    expect(card.isConnected).toBe(true);
  });

  it('le ticket part dans le tiroir « En pause », fermé : la carte n’est plus à l’écran, le contenu principal prend le focus', async () => {
    const { user, card, queryClient } = await openFromCard();
    await moveCard(queryClient, card, { status: 'deferred' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(mainOf()));
    expect(document.querySelector(`[data-card-id="${MOVING}"]`)).toBeNull();
  });

  it('le ticket est supprimé : de même', async () => {
    const { user, card, queryClient } = await openFromCard();
    serveBoard(bdeskIssues.filter((candidate) => candidate.id !== MOVING));
    await commit(queryClient);
    await waitFor(() => expect(card.isConnected).toBe(false));
    await settle();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(mainOf()));
  });

  /*
   * Jamais le focus qu'un utilisateur a mis ailleurs : le panneau ne rend le focus que quand il n'est nulle part (le corps de la page), et ce qu'il a mis ailleurs reste.
   */
  it.skipIf(narrow)('une autre carte du tableau, que le panneau laisse utilisable, a le focus : la carte déplacée ne la lui prend pas', async () => {
    const { user, card, queryClient } = await openFromCard();
    const other = cardLinkOf('bdesk-38k.7');
    act(() => other.focus());
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(other);
  });

  it.skipIf(narrow)('un lien de la barre latérale a le focus : la carte déplacée ne le lui prend pas', async () => {
    const { user, card, queryClient } = await openFromCard();
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });
    act(() => sidebarLink.focus());
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(sidebarLink);
  });

  it('un clic dans le vide a laissé le focus sur le corps de la page : le panneau le rend à la carte, comme sans clic', async () => {
    const { user, card, queryClient } = await openFromCard();
    await moveCard(queryClient, card, closedNow());
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
  });

  it('le tiroir « En pause » est ouvert : la carte y arrive, et le panneau lui rend le focus', async () => {
    const { user, card, queryClient } = await openFromCard({ drawer: true }); // le tiroir est affiché sur un écran étroit aussi : rien ne le cache
    await moveCard(queryClient, card, { status: 'deferred' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cardLinkOf(MOVING)));
    expect(cardLinkOf(MOVING).closest('li')?.dataset.column).toBe('paused');
  });
});

/*
 * Deux Projets ont les mêmes identifiants de tickets : deux copies, ou deux clones d'un même dépôt (même préfixe), bdesk-38k.68 (relecture). Le panneau reste monté d'un Projet à l'autre : la
 * palette (« Chercher dans tous les Projets ») ouvre un ticket de l'autre Projet sur la même route. Il retient toujours le lien de la carte du premier Projet, que le tableau de l'autre a
 * remplacé ; à la fermeture, la carte de même identifiant de ce tableau-là n'est pas celle d'où l'on venait, et le focus ne lui est pas rendu : il va au contenu principal.
 */
const CLONE: Project = { ...projects[0]!, id: 'clone', name: 'bd-clone', path: '/dev/bd-clone' };
const serveTwoProjects = () =>
  stubApi({
    projects: { projects: [...projectsResponse.projects, CLONE], ignored: projectsResponse.ignored },
    issues: { bdesk: bdeskIssues, clone: bdeskIssues, mpm: mpmIssues },
  });

describe.each(SCREENS)('le panneau ouvert depuis une carte du Projet A reste monté quand le Projet B, de mêmes identifiants, ouvre un de ses tickets : %s', (_screen, narrow) => {
  /** Le panneau de `bdesk-38k.6` ouvert depuis sa carte (Entrée) dans le Projet `bdesk`, puis un ticket de `clone` sur la même route : le même panneau, le tableau de `clone`. */
  async function openInOtherProject() {
    screenIs(narrow);
    serveTwoProjects();
    const app = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    act(() => card.focus());
    await app.user.keyboard('{Enter}');
    const dialog = await screen.findByRole('dialog', { name: TITLE });

    await act(() => app.router.navigate('/p/clone/t/bdesk-38k.7')); // « Chercher dans tous les Projets », puis le ticket de bd-clone
    expect(await screen.findByRole('dialog', { name: OTHER_TITLE })).toBe(dialog); // le même panneau : il n'est pas remonté, il retient toujours le lien de la carte de bdesk
    await waitFor(() => expect(card.isConnected).toBe(false)); // le tableau de bdesk est parti, celui de clone est là
    await waitFor(() => expect(cardLinkOf(MOVING)).not.toBeNull());
    expect(pathname(app.router)).toBe('/p/clone/t/bdesk-38k.7');
    return { ...app, card, dialog };
  }

  it('fermer le panneau sur le tableau de B : le contenu principal, pas la carte de même identifiant de B', async () => {
    const { router, dialog } = await openInOtherProject();

    await act(() => router.navigate('/p/clone/kanban')); // « g k » : le kanban du Projet affiché

    await waitFor(() => expect(dialog.isConnected).toBe(false));
    await settle();
    expect(pathname(router)).toBe('/p/clone/kanban');
    expect(document.activeElement).toBe(mainOf()); // ni le corps de la page, ni la carte `bdesk-38k.6` de bd-clone, où personne n'a rien sélectionné
    expect(document.activeElement).not.toBe(cardLinkOf(MOVING));
  });
});
