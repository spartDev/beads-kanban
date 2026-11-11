import { type QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import type { Issue, IssueRef, Project } from '../data/types';
import { openedFromCard } from '../kanban/boardFocus';
import { focusContainer } from '../lib/focus';
import { refreshProject } from '../live/refresh';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, issueDetail, mpmIssues, projects, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { clickLikeWebKit } from '../test/webkitClick';

/**
 * Où va le focus quand se ferme un panneau que la souris, ou le toucher, a ouvert depuis une carte (bdesk-38k.72). Le panneau retient pour origine l'élément qui a le focus quand il s'ouvre, le lien de la
 * carte, pour le lui rendre à sa fermeture. Chromium et Firefox donnent le focus au lien qu'on clique ; WebKit ne le fait pas, et le clic retire le focus à ce qui l'avait : à l'ouverture du panneau, le corps de la page
 * a le focus, le panneau le retient pour origine, et à sa fermeture le focus allait au contenu principal, non à la carte. Le lien de la carte dit maintenant de quelle carte vient le panneau (l'entrée d'historique
 * qu'il ouvre le garde) : WebKit rend le focus à la carte comme les autres moteurs, au clavier comme à la souris, là où elle est si un commit l'a changée de colonne, dans son Projet. Une autre carte cliquée pendant que le panneau est
 * ouvert en devient l'origine, la dernière carte cliquée et non la première. Tout le reste est inchangé :
 * le focus qu'un utilisateur a mis ailleurs reste où il est, et ce que la carte n'a pas ouvert (la pastille d'Epic, une ligne de la page Epics, l'adresse collée, « Retour » et « Avancer ») garde l'origine qu'il avait. La palette n'en laisse aucune (bdesk-38k.76 : `IssuePanel.palette.test.tsx`).
 * Les clics de WebKit sont joués par `clickLikeWebKit` (le focus n'est pas donné à l'élément cliqué), ceux de Chromium et de Firefox par `user.click` (le lien cliqué prend le focus).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const BOARD = '/p/bdesk/kanban';
const TITLE = /Shell UI façon Linear/;
const OTHER_TITLE = /Kanban par Projet/;
/** Le ticket de la carte qui ouvre le panneau, et que le commit déplace. */
const MOVING = 'bdesk-38k.6';

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

/** Comment la carte est activée : le clavier et la souris de Chromium et de Firefox donnent le focus au lien, la souris et le toucher de WebKit ne le donnent pas. */
const OPENINGS = [
  ['au clavier (Entrée sur la carte qui a le focus)', 'keyboard'],
  ['à la souris dans Chromium et Firefox (le lien cliqué prend le focus)', 'click'],
  ['à la souris ou au toucher dans WebKit (le lien cliqué ne prend pas le focus)', 'webkit'],
] as const;
type Opening = (typeof OPENINGS)[number][1];

/** Les tickets du tableau après un commit qui change `MOVING`. */
const afterCommit = (change: Partial<Issue>) => bdeskIssues.map((candidate) => (candidate.id === MOVING ? { ...candidate, ...change } : candidate));
const closedNow = (): Partial<Issue> => {
  const now = new Date().toISOString();
  return { status: 'closed', closedAt: now, updatedAt: now };
};
const serveBoard = (issues: Issue[]) => stubApi({ projects: projectsResponse, issues: { bdesk: issues, mpm: mpmIssues } });
/** Un commit du Projet, en direct : la liste des tickets est relue. */
const commit = (queryClient: QueryClient) => act(() => refreshProject(queryClient, 'bdesk'));
const cardLinkOf = (id: string) => document.querySelector<HTMLElement>(`a[data-card-link="${id}"]`)!;
const mainOf = () => document.querySelector('main');
/** Laisse passer les effets et les minuteries de 0 ms : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

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

/** Le tableau, et la carte de `MOVING` (En cours), activée comme `how` le dit : le panneau de son ticket est ouvert. */
async function openFromCard(narrow: boolean, how: Opening, { drawer = false } = {}) {
  screenIs(narrow);
  serveBoard(bdeskIssues);
  const app = renderApp(BOARD);
  const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
  if (drawer) await app.user.click(screen.getByRole('button', { name: /^En pause/ }));
  if (how === 'keyboard') {
    act(() => card.focus());
    await app.user.keyboard('{Enter}');
  } else if (how === 'click') await app.user.click(card);
  else clickLikeWebKit(card);
  const dialog = await screen.findByRole('dialog', { name: TITLE });
  expect(dialog.getAttribute('aria-modal')).toBe(String(narrow));
  expect(pathname(app.router)).toBe(`/p/bdesk/t/${MOVING}`);
  return { ...app, card, dialog };
}

/** Ferme le panneau avec son bouton, d'un clic comme `how` le joue. */
async function clickClose(user: Awaited<ReturnType<typeof openFromCard>>['user'], dialog: HTMLElement, how: Opening) {
  const button = within(dialog).getByRole('button', { name: 'Fermer le panneau' });
  if (how === 'webkit') clickLikeWebKit(button);
  else await user.click(button);
}

describe.each(SCREENS)('le panneau ouvert depuis une carte se ferme sur elle, quelle que soit la façon de l’activer : %s', (_screen, narrow) => {
  it('le clic simulé de WebKit ne donne jamais le focus à la carte (ni à ce qui l’avait avant) : c’est le corps de la page que le panneau trouve à son ouverture', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    const other = cardLinkOf('bdesk-38k.7');
    act(() => other.focus());
    const received: string[] = [];
    card.addEventListener('focus', () => received.push('la carte'));
    other.addEventListener('blur', () => received.push('l’autre carte a perdu le focus'));

    clickLikeWebKit(card);

    await screen.findByRole('dialog', { name: TITLE });
    expect(received).toEqual(['l’autre carte a perdu le focus']);
  });

  it.each(OPENINGS)('ouvert %s, Échap rend le focus à la carte', async (_how, how) => {
    const { user, card, router } = await openFromCard(narrow, how);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(BOARD);
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card.isConnected).toBe(true);
  });

  it.each(OPENINGS)('ouvert %s, « Fermer le panneau » rend le focus à la carte, cliqué comme dans le même moteur', async (_how, how) => {
    const { user, card, dialog, router } = await openFromCard(narrow, how);

    await clickClose(user, dialog, how);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(BOARD);
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('ouvert à la souris dans WebKit alors qu’une autre carte avait le focus : la carte cliquée le reçoit, pas l’autre', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const { user } = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    const other = cardLinkOf('bdesk-38k.7');
    act(() => other.focus());

    clickLikeWebKit(card);
    await screen.findByRole('dialog', { name: TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('ouvert à la souris dans WebKit alors que le contenu principal avait le focus (l’application le lui donne à défaut de mieux) : WebKit le lui laisse, la carte cliquée le reçoit', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const { user } = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    act(() => void focusContainer(mainOf())); // `tabindex="-1"` le temps qu'il a le focus : le clic sur la carte tombe dans un ancêtre que WebKit focalise, et ne le quitte pas
    expect(document.activeElement).toBe(mainOf());

    clickLikeWebKit(card);
    await screen.findByRole('dialog', { name: TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('ouvert à la souris dans WebKit alors qu’un lien de la barre latérale avait le focus : la carte cliquée le reçoit', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const { user } = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale', hidden: true })).getByRole('link', { name: /^Métriques/, hidden: true });
    act(() => sidebarLink.focus());

    clickLikeWebKit(card);
    await screen.findByRole('dialog', { name: TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
});

describe.each(SCREENS)('le panneau ouvert à la souris dans WebKit depuis une carte que le commit change de colonne se ferme : %s', (_screen, narrow) => {
  if (narrow) withHiddenColumns();
  /** Où doit aller le focus pour une carte qui arrive dans Terminé : sa carte, ou le contenu principal quand la colonne est cachée. */
  const expectedTarget = () => (narrow ? mainOf() : cardLinkOf(MOVING));

  /** Le commit change la carte de colonne : son lien est retiré, un autre est monté dans la colonne d'arrivée. */
  async function moveCard(queryClient: QueryClient, card: HTMLElement, change: Partial<Issue>) {
    serveBoard(afterCommit(change));
    await commit(queryClient);
    await waitFor(() => expect(card.isConnected).toBe(false));
    await settle();
  }

  it('Échap : la carte, là où elle est maintenant, prend le focus (le contenu principal quand sa colonne est cachée)', async () => {
    const { user, card, queryClient, router } = await openFromCard(narrow, 'webkit');
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe(BOARD));
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
    expect(card.isConnected).toBe(false);
    expect(cardLinkOf(MOVING).closest('li')?.dataset.column).toBe('done');
    expect(router.state.location.search).toBe(''); // seul un choix de l'utilisateur change la colonne affichée : rien n'est écrit dans l'adresse
  });

  it('le bouton « Fermer le panneau » le ferme de même', async () => {
    const { user, dialog, card, queryClient } = await openFromCard(narrow, 'webkit');
    await moveCard(queryClient, card, closedNow());

    await clickClose(user, dialog, 'webkit');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
  });

  it('la carte change de colonne deux fois (fermée, puis rouverte) pendant que le panneau est ouvert : le focus va à la carte, dans sa colonne finale', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
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
    const { user, card } = await openFromCard(narrow, 'webkit');

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
    expect(card.isConnected).toBe(true);
  });

  it('le ticket part dans le tiroir « En pause », fermé : la carte n’est plus dans le document, le contenu principal prend le focus', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
    await moveCard(queryClient, card, { status: 'deferred' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(mainOf()));
    expect(document.querySelector(`[data-card-id="${MOVING}"]`)).toBeNull();
  });

  it('le ticket part dans le tiroir « En pause », ouvert : la carte y arrive, et le panneau lui rend le focus', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit', { drawer: true }); // le tiroir est affiché sur un écran étroit aussi : rien ne le cache
    await moveCard(queryClient, card, { status: 'deferred' });

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cardLinkOf(MOVING)));
    expect(cardLinkOf(MOVING).closest('li')?.dataset.column).toBe('paused');
  });

  it('le ticket est supprimé : le contenu principal prend le focus', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
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
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
    const other = cardLinkOf('bdesk-38k.7');
    act(() => other.focus());
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(other);
  });

  it.skipIf(narrow)('un lien de la barre latérale a le focus : la carte déplacée ne le lui prend pas', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });
    act(() => sidebarLink.focus());
    await moveCard(queryClient, card, closedNow());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(sidebarLink);
  });

  it.skipIf(narrow)('l’utilisateur a mis le focus sur une autre carte, puis « g k » ferme le panneau en changeant de page : la carte qui l’avait ouvert ne lui prend rien', async () => {
    const { user, card } = await openFromCard(narrow, 'webkit');
    const other = cardLinkOf('bdesk-38k.7');
    act(() => other.focus());
    expect(card.isConnected).toBe(true);

    await user.keyboard('gk'); // « g k » : le kanban du Projet affiché, sans le panneau

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(other);
  });

  it('un clic dans le vide a laissé le focus sur le corps de la page : le panneau le rend à la carte, comme sans clic', async () => {
    const { user, card, queryClient } = await openFromCard(narrow, 'webkit');
    await moveCard(queryClient, card, closedNow());
    clickLikeWebKit(document.body);
    expect(document.activeElement).toBe(document.body);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(expectedTarget()));
  });
});

/*
 * Deux Projets ont les mêmes identifiants de tickets : deux copies, ou deux clones d'un même dépôt (même préfixe), bdesk-38k.68 (relecture). Le panneau reste monté d'un Projet à l'autre : la palette
 * (« Chercher dans tous les Projets ») ouvre un ticket de l'autre Projet sur la même route. La carte qui l'a ouvert est celle du Projet A, et le tableau de B, qui arrive, a une carte de même identifiant
 * qui n'est pas la carte d'où l'on venait : on la retrouve avec son Projet, jamais seule.
 */
const CLONE: Project = { ...projects[0]!, id: 'clone', name: 'bd-clone', path: '/dev/bd-clone' };
const serveTwoProjects = () =>
  stubApi({
    projects: { projects: [...projectsResponse.projects, CLONE], ignored: projectsResponse.ignored },
    issues: { bdesk: bdeskIssues, clone: bdeskIssues, mpm: mpmIssues },
  });

describe.each(SCREENS)('le panneau ouvert à la souris dans WebKit depuis une carte du Projet A reste monté quand le Projet B, de mêmes identifiants, ouvre un de ses tickets : %s', (_screen, narrow) => {
  async function openInOtherProject() {
    screenIs(narrow);
    serveTwoProjects();
    const app = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    clickLikeWebKit(card);
    const dialog = await screen.findByRole('dialog', { name: TITLE });

    await act(() => app.router.navigate('/p/clone/t/bdesk-38k.7')); // « Chercher dans tous les Projets », puis le ticket de bd-clone
    expect(await screen.findByRole('dialog', { name: OTHER_TITLE })).toBe(dialog); // le même panneau : il n'est pas remonté
    await waitFor(() => expect(card.isConnected).toBe(false)); // le tableau de bdesk est parti, celui de clone est là
    await waitFor(() => expect(cardLinkOf(MOVING)).not.toBeNull());
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

/*
 * Ce que la souris ouvre d'autre ne passe pas par la carte, dans WebKit comme ailleurs : seul le lien d'une carte reste dans la page quand le panneau s'ouvre (le tableau est la route mère du panneau), et c'est lui, et lui
 * seul, qui dit de quelle carte vient le panneau. La pastille d'Epic d'une carte (elle mène à la page Epics), une ligne de la page Epics, « Avancer » : l'origine du panneau est ce qui a le focus quand il s'ouvre, comme avant.
 * Un choix de la palette n'a aucune origine, quel que soit l'ordre où la palette se retire et où le panneau est rendu (bdesk-38k.76, `IssuePanel.palette.test.tsx`) : à la fermeture, le contenu principal a le focus.
 */
describe.each(SCREENS)('ce que la souris ouvre d’autre qu’une carte ne rend le focus à aucune carte, dans WebKit : %s', (_screen, narrow) => {
  async function openBoard() {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const app = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    return { ...app, card };
  }

  /** Ouvre `OTHER_TITLE` par la palette ⌘K, d'un clic de WebKit sur sa ligne, depuis le tableau. */
  async function openFromPalette(app: Awaited<ReturnType<typeof openBoard>>) {
    await app.user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await app.user.keyboard('38k.7');
    clickLikeWebKit(await within(palette).findByRole('option', { name: OTHER_TITLE }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    return screen.findByRole('dialog', { name: OTHER_TITLE });
  }

  it('un choix de la palette, cliqué : Échap ferme le panneau, le contenu principal a le focus (la carte du ticket choisi existe pourtant)', async () => {
    const app = await openBoard();
    await openFromPalette(app);
    expect(cardLinkOf('bdesk-38k.7')).not.toBeNull();

    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(pathname(app.router)).toBe(BOARD);
    expect(document.activeElement).toBe(mainOf());
  });

  it('la pastille d’Epic de la carte, cliquée : la page Epics, et le panneau qu’un choix de la palette ouvre ensuite se ferme sur le contenu principal, pas sur la carte de la pastille', async () => {
    const app = await openBoard();
    clickLikeWebKit(within(app.card.closest('li')!).getByRole('link', { name: /^Epic/ }));
    await waitFor(() => expect(pathname(app.router)).toBe('/p/bdesk/epics?epic=bdesk-38k'));

    await act(() => app.router.navigate(-1)); // « Retour » : le tableau
    await screen.findByRole('region', { name: 'En cours' });
    await openFromPalette(app);
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(mainOf());
  });

  it('une ligne de la page Epics, cliquée : le panneau se ferme sur la page Epics, le contenu principal a le focus', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const app = renderApp('/p/bdesk/epics?epic=bdesk-38k');
    const row = (await screen.findAllByRole('link', { name: /Kanban par Projet/ }))[0]!;

    clickLikeWebKit(row);
    await screen.findByRole('dialog', { name: OTHER_TITLE });
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(pathname(app.router)).toBe('/p/bdesk/epics?epic=bdesk-38k');
    expect(document.activeElement).toBe(mainOf());
  });

  it('le panneau est rouvert par « Avancer » alors que rien n’a le focus : il ne retient pas la carte qui l’avait ouvert la première fois, le contenu principal a le focus à la fermeture', async () => {
    const app = await openBoard();
    clickLikeWebKit(app.card);
    await screen.findByRole('dialog', { name: TITLE });
    await act(() => app.router.navigate(-1)); // « Retour » ferme le panneau
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    clickLikeWebKit(document.body); // un clic dans le vide : rien n'a le focus
    expect(document.activeElement).toBe(document.body);

    await act(() => app.router.navigate(1)); // « Avancer » rouvre le panneau : l'entrée garde la carte qui l'avait ouverte, mais ce n'est pas un clic sur elle
    await screen.findByRole('dialog', { name: TITLE });
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(mainOf());
  });
});

/*
 * La page est rechargée sur l'adresse du panneau (bdesk-38k.72, relecture). Le navigateur garde l'état de l'entrée d'historique avec elle : la carte que le lien avait écrite y est encore, mais c'est le navigateur
 * qui rouvre le panneau (`POP`, comme « Retour » et « Avancer »), non un clic sur la carte. Elle ne devient pas l'origine : à la fermeture, le contenu principal prend le focus. Au rechargement le tableau n'est pas encore
 * monté quand le panneau l'est (la carte n'est pas là pour être trouvée) ; « Avancer », lui, rouvre le panneau sur un tableau monté, et c'est le test précédent (`POP`) qui l'écarte.
 */
describe.each(SCREENS)('le panneau rouvert par le navigateur sur une entrée qui garde la carte (rechargement) : %s', (_screen, narrow) => {
  it('Échap le ferme sur le contenu principal, pas sur la carte que l’entrée nomme', async () => {
    screenIs(narrow);
    serveBoard(bdeskIssues);
    const entry = { pathname: `/p/bdesk/t/${MOVING}`, state: openedFromCard(MOVING, 'bdesk') };

    const app = renderApp(entry);
    expect(app.router.state.historyAction).toBe('POP'); // l'entrée initiale d'un rechargement
    expect(app.router.state.location.state).toEqual(entry.state); // et elle garde la carte
    await screen.findByRole('dialog', { name: TITLE });
    await waitFor(() => expect(document.querySelector(`a[data-card-link="${MOVING}"]`)).not.toBeNull()); // le tableau arrive après le panneau
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(app.router)).toBe(BOARD);
    await settle();
    expect(document.activeElement).toBe(mainOf());
    expect(document.activeElement).not.toBe(cardLinkOf(MOVING));
  });
});

/*
 * Une autre carte est cliquée pendant que le panneau est ouvert (bdesk-38k.72, relecture) : son lien remplace l'entrée d'historique (`replace`), le panneau n'est pas remonté et montre l'autre ticket. Il retenait pourtant
 * pour origine la première carte, une fois pour toutes : fermé, il lui rendait le focus, non à la dernière carte d'où il s'est ouvert. Il suit maintenant la dernière carte (le lien l'écrit à chaque clic), dans tous les
 * moteurs ; ce qui ne vient pas d'une carte (un lien du panneau, la palette) laisse l'origine où elle était.
 * Sur écran large seulement : sur écran étroit le panneau est modal et la page derrière lui est inerte, aucune autre carte ne peut être cliquée.
 */
const SECOND = 'bdesk-38k.7';
const THIRD = 'bdesk-b7q';
const BLOCKER: IssueRef = { id: THIRD, title: 'Le graphique du Débit se décale après minuit', type: 'bug', status: 'open', priority: 0 };
const BLOCKER_TITLE = /Le graphique du Débit/;
const afterCommitOf = (id: string, change: Partial<Issue>) => bdeskIssues.map((candidate) => (candidate.id === id ? { ...candidate, ...change } : candidate));
/** Le ticket `SECOND` est bloqué par `THIRD` : son panneau a un lien vers lui (« Bloqué par »), qui remplace l'entrée comme le fait un lien de ticket à ticket. */
const serveWithBlocker = () =>
  stubApi({
    projects: projectsResponse,
    issues: { bdesk: bdeskIssues, mpm: mpmIssues },
    details: {
      [`bdesk/${SECOND}`]: issueDetail({
        ...bdeskIssues.find((candidate) => candidate.id === SECOND)!,
        blockedBy: [THIRD],
        dependencies: [{ to: THIRD, type: 'blocks' }],
        linked: { [THIRD]: BLOCKER },
      }),
    },
  });

describe('une autre carte est cliquée pendant que le panneau est ouvert (1280 px) : le panneau rend le focus à la dernière carte', () => {
  /** Le panneau de `MOVING` ouvert par un clic de WebKit, puis la carte `SECOND` activée comme `how` le dit : le même panneau montre alors son ticket. */
  async function openThenOther(how: Opening, { blocker = false }: { blocker?: boolean } = {}) {
    const app = await openFromCard(false, 'webkit');
    if (blocker) serveWithBlocker();
    const other = cardLinkOf(SECOND);
    if (how === 'keyboard') {
      act(() => other.focus());
      await app.user.keyboard('{Enter}');
    } else if (how === 'click') await app.user.click(other);
    else clickLikeWebKit(other);
    const dialog = await screen.findByRole('dialog', { name: OTHER_TITLE });
    expect(dialog).toBe(app.dialog); // le même panneau : l'entrée est remplacée, il n'est pas remonté
    expect(pathname(app.router)).toBe(`/p/bdesk/t/${SECOND}`);
    return { ...app, other, dialog };
  }

  it.each(OPENINGS)('la seconde carte est activée %s : Échap rend le focus à elle, non à la première', async (_how, how) => {
    const { user, card, other, router } = await openThenOther(how);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    expect(pathname(router)).toBe(BOARD);
    await waitFor(() => expect(document.activeElement).toBe(other));
    expect(document.activeElement).not.toBe(card);
  });

  it.each(OPENINGS)('la seconde carte est activée %s : « Fermer le panneau » rend le focus à elle', async (_how, how) => {
    const { user, dialog, other } = await openThenOther(how);

    await clickClose(user, dialog, how);

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(other));
  });

  it('une troisième carte la remplace à son tour : c’est la dernière qui reçoit le focus', async () => {
    const { user, other } = await openThenOther('webkit');
    const third = cardLinkOf(THIRD);

    clickLikeWebKit(third);
    await screen.findByRole('dialog', { name: BLOCKER_TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(third));
    expect(document.activeElement).not.toBe(other);
  });

  it('un commit change la dernière carte de colonne pendant que le panneau est ouvert : la carte, là où elle est maintenant, prend le focus', async () => {
    const { user, other, queryClient } = await openThenOther('webkit');
    serveBoard(afterCommitOf(SECOND, closedNow()));
    await commit(queryClient);
    await waitFor(() => expect(other.isConnected).toBe(false));
    await settle();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(cardLinkOf(SECOND)));
    expect(cardLinkOf(SECOND).closest('li')?.dataset.column).toBe('done');
  });

  it('un lien du panneau (« Bloqué par ») remplace ensuite l’entrée sans écrire de carte : la dernière carte cliquée garde l’origine', async () => {
    const { user, other, dialog } = await openThenOther('webkit', { blocker: true });
    const link = await within(await within(dialog).findByRole('list', { name: 'Bloqué par' })).findByRole('link');

    clickLikeWebKit(link);
    await screen.findByRole('dialog', { name: BLOCKER_TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(other)); // `SECOND`, non la carte du ticket du lien, ni `MOVING`
  });

  it('seul un lien du panneau a remplacé l’entrée (aucune autre carte cliquée) : l’origine reste la première carte, comme avant', async () => {
    screenIs(false);
    serveWithBlocker();
    const app = renderApp(BOARD);
    const second = within(await screen.findByRole('region', { name: 'Prêt' })).getByRole('link', { name: OTHER_TITLE });
    clickLikeWebKit(second);
    const dialog = await screen.findByRole('dialog', { name: OTHER_TITLE });

    clickLikeWebKit(await within(await within(dialog).findByRole('list', { name: 'Bloqué par' })).findByRole('link'));
    await screen.findByRole('dialog', { name: BLOCKER_TITLE });
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(second));
  });

  it('la palette ouvre ensuite un ticket dans le même panneau (aucune carte écrite) : l’origine reste la dernière carte cliquée', async () => {
    const { user, other, router } = await openThenOther('webkit');
    await user.keyboard('{Control>}k{/Control}');
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('b7q');
    clickLikeWebKit(await within(palette).findByRole('option', { name: BLOCKER_TITLE }));
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    await screen.findByRole('dialog', { name: BLOCKER_TITLE });
    expect(pathname(router)).toBe(`/p/bdesk/t/${THIRD}`);

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(other));
  });

  it('« Retour » ramène le panneau à l’entrée d’une carte plus ancienne (POP) : ce n’est pas un clic sur elle, l’origine reste la dernière carte cliquée', async () => {
    const { user, router } = await openFromCard(false, 'webkit'); // entrée 1 : `MOVING`, que sa carte nomme
    await user.keyboard('{Control>}k{/Control}'); // la palette ouvre un autre ticket dans le même panneau : entrée 2
    const palette = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    await user.keyboard('38k.7');
    clickLikeWebKit(await within(palette).findByRole('option', { name: OTHER_TITLE }));
    await screen.findByRole('dialog', { name: OTHER_TITLE });
    const third = cardLinkOf(THIRD);
    clickLikeWebKit(third); // la troisième carte remplace l'entrée 2 : c'est la dernière carte cliquée
    await screen.findByRole('dialog', { name: BLOCKER_TITLE });
    clickLikeWebKit(document.body); // rien n'a le focus
    expect(document.activeElement).toBe(document.body);

    await act(() => router.navigate(-1)); // « Retour » : l'entrée 1, qui nomme `MOVING`, le panneau étant resté monté
    await screen.findByRole('dialog', { name: TITLE });
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(third));
  });

  it('l’utilisateur a mis le focus sur un lien de la barre latérale après la seconde carte : le panneau fermé ne le lui prend pas', async () => {
    const { user } = await openThenOther('webkit');
    const sidebarLink = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Métriques/ });
    act(() => sidebarLink.focus());

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(sidebarLink);
  });
});

/*
 * Le développement monte l'application dans `StrictMode` (`main.tsx`) : chaque rendu et chaque effet est joué deux fois. L'origine du panneau est un état ajusté au rendu (`IssuePanel`) : un rendu répété ne doit rien
 * y changer, ni à l'ouverture ni au remplacement de l'entrée par une autre carte.
 */
describe('en StrictMode (le développement monte les effets deux fois) : 1280 px', () => {
  async function openStrict() {
    screenIs(false);
    serveBoard(bdeskIssues);
    const app = renderApp(BOARD, { strict: true });
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    clickLikeWebKit(card);
    const dialog = await screen.findByRole('dialog', { name: TITLE });
    return { ...app, card, dialog };
  }

  it('la carte cliquée à la façon de WebKit : Échap lui rend le focus', async () => {
    const { user, card } = await openStrict();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('une autre carte cliquée pendant que le panneau est ouvert : Échap rend le focus à elle, non à la première', async () => {
    const { user, card, dialog } = await openStrict();
    const other = cardLinkOf(SECOND);

    clickLikeWebKit(other);
    expect(await screen.findByRole('dialog', { name: OTHER_TITLE })).toBe(dialog);
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await waitFor(() => expect(document.activeElement).toBe(other));
    expect(document.activeElement).not.toBe(card);
  });
});
