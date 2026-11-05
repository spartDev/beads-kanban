import { type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { type UserEvent } from '@testing-library/user-event';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import { refreshProject } from '../live/refresh';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Où est le focus quand ce qui l'avait quitte le panneau d'un ticket (bdesk-38k.32). Le bouton « Réessayer » (de la fiche, de la chronologie)
 * disparaît dès que la requête repart, qu'on l'ait pressé ou que la fiche se relise d'elle-même (retour sur l'onglet, direct) ; et le panneau
 * qu'un choix de la palette ⌘K a ouvert retenait pour origine le champ de la palette, retiré avec elle : dans tous les cas le focus tombait sur
 * le corps de la page, hors du panneau (sur mobile, hors d'une boîte de dialogue modale).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`. Le délai d'un test (5 s par
// défaut) monte avec lui : sinon « Test timed out » couperait l'attente avant que Testing Library ne dise ce qui était à l'écran.
withAsyncTimeout(5_000);
vi.setConfig({ testTimeout: 10_000 });

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
