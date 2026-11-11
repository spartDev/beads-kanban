import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { withHeldExitAnimations } from '../test/exitAnimation';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { clickLikeWebKit } from '../test/webkitClick';

/**
 * Où va le focus quand se ferme un panneau qu'un choix de la palette ⌘K a ouvert (bdesk-38k.76). Le panneau retenait pour origine l'élément qui avait le focus à son premier rendu, et ce que c'était dépendait du minutage,
 * non de ce que l'utilisateur avait fait. Un choix ferme la palette (qui reste montée 90 ms, le temps de son animation de sortie) et ouvre le panneau, rendu un peu après :
 * - le panneau est rendu pendant que la palette est encore là : le focus est dans la palette, l'origine est son champ, retiré avec elle, et la fermeture du panneau donne le focus au contenu principal ;
 * - le panneau est rendu après le retrait de la palette (un appareil lent, une page lourde) : la palette a rendu le focus à l'élément d'où elle s'était ouverte, la carte ou le bouton, et la fermeture du panneau le lui donne.
 * Le même geste finissait donc tantôt sur le contenu principal, tantôt sur la carte. Le panneau n'est pourtant ouvert par aucun de ces éléments : le choix d'une ligne de la palette ouvre un ticket, que la palette ait ou non
 * rendu le focus avant qu'il apparaisse. Le choix écrit donc d'où vient l'entrée d'historique qu'il ouvre (`openedFromPalette`), et le panneau n'en retient aucune origine : le contenu principal, dans tous les cas (comme le panneau
 * qu'une adresse collée ouvre, bdesk-38k.32).
 *
 * Le second ordre est joué en retenant la navigation du choix (`holdNavigation`) jusqu'à ce que la palette ait fini de se retirer et rendu le focus : c'est ce que fait un appareil lent, sans que le test dépende d'une horloge.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;

const BOARD = '/p/bdesk/kanban';
const TITLE = /Shell UI façon Linear/;
const OTHER_TITLE = /Kanban par Projet/;
const OTHER = '/p/bdesk/t/bdesk-38k.7';

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

const palette = () => screen.findByRole('dialog', { name: 'Palette de commandes' });
const main = () => document.querySelector<HTMLElement>('main');
const removed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name, hidden: true })).toBeNull());
/** Laisse passer les effets et les minuteries de 0 ms : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

/**
 * Retient la navigation du routeur jusqu'à `release()` : la palette se ferme et se retire, mais la page qu'elle ouvre n'arrive pas encore. C'est l'ordre d'un appareil lent, où le panneau est rendu après la palette
 * (voir `useNavigate`, qui appelle `router.navigate` à chaque fois).
 */
function holdNavigation(router: ReturnType<typeof renderApp>['router']) {
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const navigate = router.navigate.bind(router);
  router.navigate = ((...args: Parameters<typeof navigate>) => gate.then(() => navigate(...args))) as typeof router.navigate;
  return () => act(async () => release());
}

/** Les éléments d'où la palette peut s'ouvrir. */
const FROMS = [
  ['une carte du tableau qui a le focus (⌘K au clavier)', 'card'],
  ['le bouton « Rechercher », cliqué comme le fait Chromium (il prend le focus)', 'button'],
  ['le bouton « Rechercher », cliqué comme le fait WebKit (il ne prend pas le focus)', 'webkit-button'],
] as const;
type From = (typeof FROMS)[number][1];

/** Les façons de choisir la ligne du ticket. */
const CHOICES = [
  ['Entrée', 'keyboard'],
  ['un clic', 'click'],
] as const;
type Choice = (typeof CHOICES)[number][1];

/** Dans quel ordre le panneau et la palette arrivent : le panneau est rendu pendant que la palette est encore là, ou après qu'elle s'est retirée en rendant le focus. */
const ORDERS = [
  ['le panneau est rendu pendant que la palette est encore là', 'panel-first'],
  ['le panneau est rendu après le retrait de la palette, qui a rendu le focus', 'palette-first'],
] as const;
type Order = (typeof ORDERS)[number][1];

describe.each(SCREENS)('un panneau ouvert par un choix de la palette se ferme sur le contenu principal, quel que soit l’ordre où il arrive : %s', (_screen, narrow) => {
  const exit = withHeldExitAnimations();

  /** Ouvre la palette depuis `from`, choisit `OTHER_TITLE` comme `choice` le dit, et laisse arriver le panneau dans l'ordre `order`. Renvoie le panneau et d'où la palette s'est ouverte. */
  async function openFromPalette(from: From, choice: Choice, order: Order) {
    screenIs(narrow);
    stubDefaultApi();
    const app = renderApp(BOARD);
    await screen.findByRole('navigation', { name: 'Navigation principale', hidden: true });
    const column = await screen.findByRole('region', { name: 'En cours' });
    const origin =
      from === 'card'
        ? within(column).getByRole('link', { name: TITLE })
        : screen.getAllByRole('button', { name: /^Rechercher/ }).find((button) => button.closest(narrow ? 'header' : 'aside'))!;

    if (from === 'card') {
      act(() => origin.focus());
      await app.user.keyboard('{Control>}k{/Control}');
    } else if (from === 'button') await app.user.click(origin);
    else clickLikeWebKit(origin);
    const dialog = await palette();
    await app.user.keyboard('38k.7');
    const option = await within(dialog).findByRole('option', { name: OTHER_TITLE });

    const release = order === 'palette-first' ? holdNavigation(app.router) : null;
    if (choice === 'keyboard') await app.user.keyboard('{Enter}');
    else await app.user.click(option);

    if (release) {
      // La palette finit de se retirer et rend le focus à son origine, avant que le panneau n'arrive : c'est ce que le panneau trouvera à son rendu.
      exit.finish();
      await removed('Palette de commandes');
      await waitFor(() => expect(document.activeElement).toBe(origin));
      expect(pathname(app.router)).toBe(BOARD);
      await release();
    }
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
    await waitFor(() => expect(pathname(app.router)).toBe(OTHER));
    if (!release) {
      expect(dialog.isConnected).toBe(true); // la palette n'a pas fini de se retirer : le focus est encore dans la palette quand le panneau est rendu
      exit.finish();
      await removed('Palette de commandes');
    }
    await settle();
    expect(document.activeElement).toBe(panel); // le panneau a pris le focus, la carte ou le bouton ne le lui reprend pas
    return { ...app, panel, origin };
  }

  describe.each(FROMS)('palette ouverte depuis %s', (_from, from) => {
    describe.each(ORDERS)('%s', (_order, order) => {
      it.each(CHOICES)('ticket choisi par %s : Échap ferme le panneau, le contenu principal a le focus', async (_choice, choice) => {
        const { user, router, origin } = await openFromPalette(from, choice, order);

        await user.keyboard('{Escape}');

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await settle();
        expect(pathname(router)).toBe(BOARD);
        expect(document.activeElement).toBe(main());
        expect(document.activeElement).not.toBe(origin);
      });

      it('le bouton « Fermer le panneau » le ferme de même', async () => {
        const { user, panel, origin } = await openFromPalette(from, 'click', order);

        await user.click(within(panel).getByRole('button', { name: 'Fermer le panneau' }));

        await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
        await settle();
        expect(document.activeElement).toBe(main());
        expect(document.activeElement).not.toBe(origin);
      });
    });
  });

  it.each(ORDERS)('rien n’avait le focus avant ⌘K (%s) : le contenu principal, comme avant', async (_order, order) => {
    screenIs(narrow);
    stubDefaultApi();
    const app = renderApp(BOARD);
    await screen.findByRole('region', { name: 'En cours' });
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await app.user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });
    const release = order === 'palette-first' ? holdNavigation(app.router) : null;

    await app.user.keyboard('{Enter}');
    if (release) {
      exit.finish();
      await removed('Palette de commandes');
      await settle();
      await release();
    }
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
    exit.finish();
    await removed('Palette de commandes');
    await settle();
    expect(document.activeElement).toBe(panel);
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(main());
  });
});

/*
 * Ce que le choix de la palette n'est pas : une carte. Le panneau qu'il ouvre garde ce qui lui arrive ensuite (une carte cliquée pendant qu'il est ouvert en devient l'origine, comme au panneau d'une carte), et
 * le choix qui tombe sur un panneau déjà ouvert ne change pas l'origine de celui-ci (le panneau n'est pas remonté : un autre ticket prend sa place).
 */
describe('ce que le choix de la palette laisse au panneau', () => {
  const exit = withHeldExitAnimations();

  async function boardWithPanelOpenedByPalette(order: Order = 'panel-first') {
    screenIs(false);
    stubDefaultApi();
    const app = renderApp(BOARD);
    const column = await screen.findByRole('region', { name: 'En cours' });
    const card = within(column).getByRole('link', { name: TITLE });
    act(() => card.focus());
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await app.user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });
    const release = order === 'palette-first' ? holdNavigation(app.router) : null;
    await app.user.keyboard('{Enter}');
    if (release) {
      exit.finish();
      await removed('Palette de commandes');
      await waitFor(() => expect(document.activeElement).toBe(card));
      await release();
    }
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
    exit.finish();
    await removed('Palette de commandes');
    await settle();
    return { ...app, card, panel };
  }

  it.each(ORDERS)('une carte cliquée pendant que le panneau est ouvert (%s) en devient l’origine : la carte, à la fermeture', async (_order, order) => {
    const { user, router } = await boardWithPanelOpenedByPalette(order);
    const third = document.querySelector<HTMLElement>('a[data-card-link="bdesk-b7q"]')!;

    await user.click(third);
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-b7q'));
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(third);
  });

  it('la palette ouvre un autre ticket pendant qu’un panneau est ouvert (il n’est pas remonté) : l’origine d’avant reste, la carte qui avait ouvert le premier', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(BOARD);
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    await user.click(card); // le panneau de la carte (Chromium : le lien prend le focus)
    await screen.findByRole('dialog', { name: TITLE });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe(OTHER));
    exit.finish(); // tant que la palette est montée, le reste de la page est caché aux technologies d'assistance : le panneau n'a pas encore son nom
    await removed('Palette de commandes');
    await screen.findByRole('dialog', { name: OTHER_TITLE });
    await settle();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(pathname(router)).toBe(BOARD);
    expect(document.activeElement).toBe(card);
  });

  it.each(ORDERS)('en développement (StrictMode, comme main.tsx), React rend et rejoue les effets deux fois (%s) : le panneau n’a toujours aucune origine, le contenu principal', async (_order, order) => {
    screenIs(false);
    stubDefaultApi();
    const app = renderApp(BOARD, { strict: true });
    const card = within(await screen.findByRole('region', { name: 'En cours' })).getByRole('link', { name: TITLE });
    act(() => card.focus());
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    await app.user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });
    const release = order === 'palette-first' ? holdNavigation(app.router) : null;

    await app.user.keyboard('{Enter}');
    if (release) {
      exit.finish();
      await removed('Palette de commandes');
      await waitFor(() => expect(document.activeElement).toBe(card));
      await release();
    }
    await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
    exit.finish();
    await removed('Palette de commandes');
    await settle();
    await app.user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(main());
  });

  it('le panneau ouvert par la palette est quitté par « Retour » puis rouvert par « Avancer » (POP) : l’entrée garde son état, mais la palette n’y est plus pour rien', async () => {
    const { user, router, card } = await boardWithPanelOpenedByPalette();
    expect(router.state.location.state).toEqual({ openedFromPalette: true });

    await act(() => router.navigate(-1)); // « Retour » ferme le panneau
    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    expect(document.activeElement).toBe(main());
    act(() => card.focus()); // l'utilisateur met le focus sur une carte, puis « Avancer » rouvre le panneau
    await act(() => router.navigate(1));
    await screen.findByRole('dialog', { name: OTHER_TITLE });
    expect(router.state.historyAction).toBe('POP');
    await user.keyboard('{Escape}');

    await waitFor(() => expect(screen.queryByRole('dialog')).toBeNull());
    await settle();
    // Rouvert par le navigateur, le panneau retient ce qui a le focus (comme avant : la palette n'y est pour rien), ici la carte que l'utilisateur avait choisie.
    expect(document.activeElement).toBe(card);
  });
});
