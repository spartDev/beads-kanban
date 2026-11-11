import { act, fireEvent, render, screen, waitFor, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { withHeldExitAnimations } from '../test/exitAnimation';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { clickLikeWebKit } from '../test/webkitClick';
import { ShortcutsProvider } from '../shortcuts/ShortcutsProvider';
import { OverlayProvider, useShortcutsHelp } from './OverlayProvider';
import { ShortcutsHelp } from './ShortcutsHelp';

/**
 * D'où la palette ⌘K et l'aide des raccourcis sont ouvertes, et où le focus retourne à leur fermeture (bdesk-38k.76). `OverlayProvider` retenait l'élément qui a le focus au moment de l'ouverture
 * (`document.activeElement`). Chromium et Firefox donnent le focus au bouton qu'on clique ; WebKit ne le fait pas (ni à un bouton qu'on touche), et son clic retire le focus à ce qui l'avait : à l'ouverture,
 * le corps de la page l'a, et la boîte de dialogue rendait le focus au contenu principal (au panneau d'un ticket, s'il y en avait un), non au bouton. Le bouton dit maintenant lui-même d'où vient l'ouverture :
 * l'élément du clic (`currentTarget`), sans rien lire du focus. Le clavier (un raccourci) ne change pas : le focus y est là où l'utilisateur l'a mis, dans tous les moteurs.
 * Les clics de WebKit sont joués par `clickLikeWebKit` (le focus n'est pas donné à l'élément cliqué), ceux de Chromium et de Firefox par `user.click` (le bouton cliqué prend le focus).
 *
 * Chaque cas se joue deux fois, comme dans `overlays.focus.test.tsx` : sans animation de sortie (ce que fait jsdom) et avec celle du navigateur, qui garde la boîte de dialogue montée, fermée, 90 ms avant de la retirer.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });

const BOARD = '/p/bdesk/kanban';
const TICKET = '/p/bdesk/t/bdesk-38k.6';
const TITLE = /Shell UI façon Linear/;
const OTHER_TITLE = /Kanban par Projet/;
const pathname = (router: { state: { location: { pathname: string; search: string } } }) => router.state.location.pathname + router.state.location.search;

/** Un écran dont la largeur répond ou non à `(max-width: 767.98px)`, le seuil de `md:` de Tailwind. */
function screenIs(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /max-width: 767\.98px/.test(query) ? narrow : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

async function start(path: string, { narrow = false }: { narrow?: boolean } = {}) {
  screenIs(narrow);
  stubDefaultApi();
  const app = renderApp(path);
  // `hidden` : sur mobile, un panneau ouvert rend la page inerte, et une boîte de dialogue ouverte la cache aux technologies d'assistance.
  await screen.findByRole('navigation', { name: 'Navigation principale', hidden: true });
  return app;
}
type App = Awaited<ReturnType<typeof start>>;

const palette = () => screen.findByRole('dialog', { name: 'Palette de commandes' });
const help = () => screen.findByRole('dialog', { name: 'Raccourcis clavier' });
const main = () => document.querySelector<HTMLElement>('main');
/** Rien de ce nom n'est plus dans le DOM, même caché aux technologies d'assistance. */
const removed = (name: string) => waitFor(() => expect(screen.queryByRole('dialog', { name, hidden: true })).toBeNull());
/** Laisse passer les minuteries de 0 ms (celle de Radix qui rend le focus) : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const afterRestore = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));
/** L'infobulle ouverte, s'il y en a une : une infobulle fermée reste montée le temps de son animation de sortie. */
const openTooltip = () => screen.queryAllByRole('tooltip').find((tooltip) => tooltip.getAttribute('data-state') !== 'closed') ?? null;

/**
 * Les boutons qui ouvrent une surcouche. Deux boutons se nomment « Rechercher » : celui de la barre latérale (cachée sur mobile par la feuille de style, que jsdom n'a pas)
 * et celui du bandeau du haut, qui est le seul de l'écran étroit.
 */
const searchIn = (zone: 'aside' | 'header') => {
  const found = screen.getAllByRole('button', { name: /^Rechercher/ }).find((button) => button.closest(zone));
  if (!found) throw new Error(`attendu : le bouton « Rechercher » de ${zone}`);
  return found;
};
const sidebarHelp = () => screen.getByRole('button', { name: 'Afficher les raccourcis clavier' });
const projectSwitcher = () => screen.getByRole('button', { name: /changer de Projet/ });

/** Une carte de la colonne « En cours » du tableau, qui prend le focus comme au clavier (`j`, Tab). */
async function focusBoardCard() {
  const column = await screen.findByRole('region', { name: 'En cours' });
  const card = within(column).getByRole('link', { name: TITLE });
  act(() => card.focus());
  expect(document.activeElement).toBe(card);
  return card;
}

/** Ce que fait jsdom des animations de sortie : rien, la boîte de dialogue est retirée à l'instant où elle se ferme. */
const NO_EXIT_ANIMATION: { finish: (only?: Element) => void } = { finish: () => undefined };
const MODES = [
  ['sans animation de sortie', false],
  ['avec l’animation de sortie du navigateur', true],
] as const;
const SCREENS = [
  ['sur bureau (1280 px)', false],
  ['sur mobile (375 px)', true],
] as const;

/** Comment la boîte de dialogue se ferme : Échap, un clic en dehors (le fond), le choix d'une ligne (qui n'ouvre aucun panneau), ou le bouton « Fermer » de l'aide. */
type Closer = 'escape' | 'outside' | 'choice' | 'close';
const PALETTE_CLOSERS = [
  ['Échap', 'escape'],
  ['un clic en dehors', 'outside'],
  ['le choix d’une ligne', 'choice'],
] as const;
const HELP_CLOSERS = [
  ['Échap', 'escape'],
  ['un clic en dehors', 'outside'],
  ['le bouton « Fermer »', 'close'],
] as const;

describe.each(SCREENS)('une surcouche ouverte d’un clic de WebKit rend le focus au bouton qui l’a ouverte : %s', (_screen, narrow) => {
  describe.each(MODES)('%s', (_mode, held) => {
    const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;
    const searchButton = () => searchIn(narrow ? 'header' : 'aside');

    /** Ferme la boîte de dialogue ouverte (`dialog`) comme `how` le dit, avec les clics de WebKit. */
    async function close(how: Closer, { user }: App, dialog: HTMLElement, name: string) {
      if (how === 'escape') await user.keyboard('{Escape}');
      else if (how === 'outside') {
        const backdrop = dialog.previousElementSibling;
        if (!(backdrop instanceof HTMLElement)) throw new Error('attendu : le fond de la boîte de dialogue, juste avant elle');
        clickLikeWebKit(backdrop);
      } else if (how === 'close') clickLikeWebKit(within(dialog).getByRole('button', { name: 'Fermer' }));
      else {
        // Un choix qui change de page sans retirer le bouton : le bandeau et la barre latérale sont ceux du shell, ils restent.
        await user.keyboard('metriques');
        clickLikeWebKit(await within(dialog).findByRole('option', { name: /Métriques/ }));
      }
      exit.finish();
      await removed(name);
    }

    it('le clic simulé de WebKit ne donne jamais le focus au bouton (ni à ce qui l’avait avant) : c’est le corps de la page qui l’a à l’ouverture', async () => {
      const { user } = await start(BOARD, { narrow });
      const card = await focusBoardCard();
      const button = searchButton();
      const received: string[] = [];
      button.addEventListener('focus', () => received.push('le bouton'));
      card.addEventListener('blur', () => received.push('la carte a perdu le focus'));

      clickLikeWebKit(button);
      await palette();

      expect(received).toEqual(['la carte a perdu le focus']);
      await user.keyboard('{Escape}');
      exit.finish();
      await removed('Palette de commandes');
    });

    describe.each(PALETTE_CLOSERS)('la palette, fermée par %s', (_how, how) => {
      it(`le bouton « Rechercher » ${narrow ? 'du bandeau' : 'de la barre latérale'} retrouve le focus`, async () => {
        const app = await start(BOARD, { narrow });
        await focusBoardCard();
        const button = searchButton();

        clickLikeWebKit(button); // le clic retire le focus à la carte (WebKit) et ne le donne pas au bouton
        const dialog = await palette();
        await close(how, app, dialog, 'Palette de commandes');

        await waitFor(() => expect(document.activeElement).toBe(button));
        expect(openTooltip()).toBeNull(); // le focus rendu par programme n'ouvre pas l'infobulle du bouton : sa couche Radix prendrait le prochain Échap
        if (how === 'choice') expect(pathname(app.router)).toBe('/p/bdesk/metrics');
      });
    });

    describe.skipIf(narrow).each(HELP_CLOSERS)('l’aide, fermée par %s', (_how, how) => {
      it('le bouton « Afficher les raccourcis clavier » de la barre latérale retrouve le focus', async () => {
        const app = await start(BOARD, { narrow });
        await focusBoardCard();
        const button = sidebarHelp();

        clickLikeWebKit(button);
        const dialog = await help();
        await close(how, app, dialog, 'Raccourcis clavier');

        await waitFor(() => expect(document.activeElement).toBe(button));
        expect(openTooltip()).toBeNull();
      });
    });

    it.skipIf(!narrow)('le sélecteur de Projet du bandeau (la palette sur la liste des Projets) : le bouton retrouve le focus, par Échap et par le choix d’un Projet', async () => {
      const { user, router } = await start(BOARD, { narrow });
      const button = projectSwitcher();

      clickLikeWebKit(button);
      await palette();
      await user.keyboard('{Escape}');
      exit.finish();
      await removed('Palette de commandes');
      await waitFor(() => expect(document.activeElement).toBe(button));

      clickLikeWebKit(button);
      const dialog = await palette();
      clickLikeWebKit(await within(dialog).findByRole('option', { name: /My-Prompt-Manager/ }));
      await waitFor(() => expect(pathname(router)).toBe('/p/mpm/kanban'));
      exit.finish();
      await removed('Palette de commandes');
      await waitFor(() => expect(document.activeElement).toBe(button));
    });

    it.skipIf(narrow)('le panneau d’un ticket est ouvert à côté, la palette ouverte d’un clic de WebKit : le bouton retrouve le focus, pas le panneau', async () => {
      const { user } = await start(TICKET);
      const panel = await screen.findByRole('dialog', { name: TITLE });
      const button = searchButton();

      clickLikeWebKit(button);
      await palette();
      await user.keyboard('{Escape}');
      exit.finish();
      await removed('Palette de commandes');

      await waitFor(() => expect(document.activeElement).toBe(button));
      expect(panel.isConnected).toBe(true);
    });

    it.skipIf(narrow)('le panneau d’un ticket est ouvert à côté, l’aide ouverte d’un clic de WebKit : le bouton retrouve le focus sans son infobulle, et le second Échap ferme le panneau', async () => {
      const { user, router } = await start(TICKET);
      await screen.findByRole('dialog', { name: TITLE });
      const button = sidebarHelp();

      clickLikeWebKit(button);
      await help();
      await user.keyboard('{Escape}');
      exit.finish();
      await removed('Raccourcis clavier');

      await waitFor(() => expect(document.activeElement).toBe(button));
      expect(openTooltip()).toBeNull();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(pathname(router)).toBe(BOARD));
    });

    it('de la palette à l’aide (commande « Raccourcis clavier », clic de WebKit sur la ligne) : à la fermeture de l’aide, le bouton d’origine retrouve le focus', async () => {
      const { user } = await start(BOARD, { narrow });
      const button = searchButton();

      clickLikeWebKit(button);
      const dialog = await palette();
      await user.keyboard('raccourcis');
      clickLikeWebKit(await within(dialog).findByRole('option', { name: /Raccourcis clavier/ }));
      const shortcuts = await screen.findByRole('dialog', { name: 'Raccourcis clavier', hidden: true });
      exit.finish(); // la palette, remplacée, finit de se retirer : l'aide garde le focus
      await removed('Palette de commandes');
      await afterRestore();
      expect(shortcuts.contains(document.activeElement)).toBe(true);

      await user.keyboard('{Escape}');
      exit.finish();

      await removed('Raccourcis clavier');
      await waitFor(() => expect(document.activeElement).toBe(button));
    });

    it('la palette ouverte d’un clic de WebKit, un choix ouvre un ticket : le focus est dans le nouveau panneau, il ne retourne pas au bouton', async () => {
      const { user, router } = await start(BOARD, { narrow });
      const button = searchButton();

      clickLikeWebKit(button);
      const dialog = await palette();
      await user.keyboard('38k.7');
      clickLikeWebKit(await within(dialog).findByRole('option', { name: OTHER_TITLE }));
      const panel = await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
      await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7'));
      exit.finish();

      await removed('Palette de commandes');
      await afterRestore();
      expect(document.activeElement).toBe(panel);
      expect(document.activeElement).not.toBe(button);
    });
  });
});

/*
 * Le clavier ne change pas : le focus y est là où l'utilisateur l'a mis, dans tous les moteurs, et la surcouche le rend à cet élément. Ces cas passent avant comme après (bdesk-38k.76) ; ils gardent contre un
 * correctif qui ferait des boutons le seul point de départ, ou qui lirait autre chose que le focus pour un raccourci.
 */
describe.each(MODES)('le clavier ouvre la palette et l’aide comme avant : %s', (_mode, held) => {
  const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;

  it.each([
    ['⌘K', '{Control>}k{/Control}', 'Palette de commandes'],
    ['« ? »', '?', 'Raccourcis clavier'],
    ['« g p » (changer de Projet)', 'gp', 'Palette de commandes'],
  ])('%s depuis une carte qui a le focus : la carte, après Échap', async (_keys, keys, name) => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();

    await user.keyboard(keys);
    await screen.findByRole('dialog', { name });
    await user.keyboard('{Escape}');
    exit.finish();

    await removed(name);
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it.each([
    ['⌘K', '{Control>}k{/Control}', 'Palette de commandes'],
    ['« ? »', '?', 'Raccourcis clavier'],
  ])('%s, rien n’a le focus : le contenu principal, jamais le corps de la page', async (_keys, keys, name) => {
    const { user } = await start(BOARD);
    expect(document.activeElement).toBe(document.body);

    await user.keyboard(keys);
    await screen.findByRole('dialog', { name });
    await user.keyboard('{Escape}');
    exit.finish();

    await removed(name);
    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it.each([
    ['Entrée', '{Enter}'],
    ['Espace', ' '],
  ])('le bouton de la barre latérale, atteint au clavier et activé par %s : le bouton, après Échap', async (_key, key) => {
    const { user } = await start(BOARD);
    const button = searchIn('aside');
    act(() => button.focus());

    await user.keyboard(key);
    await palette();
    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  it('le bouton de l’aide, atteint au clavier et activé par Entrée : le bouton, après Échap', async () => {
    const { user } = await start(BOARD);
    const button = sidebarHelp();
    act(() => button.focus());

    await user.keyboard('{Enter}');
    await help();
    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(button));
  });

  /*
   * Le raccourci dit d'où il vient comme le bouton : par l'événement. Une touche part toujours de l'élément qui a le focus, et c'est l'élément qui la reçoit (`event.target`) qu'il passe à la surcouche, non ce que
   * `document.activeElement` en dit à l'instant où elle s'ouvre. Un vrai clavier ne les sépare jamais ; ce cas les sépare pour que le contrat soit vérifié : la touche est reçue par le bouton, la carte a le focus.
   */
  it.each([
    ['⌘K', [{ key: 'k', ctrlKey: true }], 'Palette de commandes'],
    ['« ? »', [{ key: '?', shiftKey: true }], 'Raccourcis clavier'],
    ['« g p »', [{ key: 'g' }, { key: 'p' }], 'Palette de commandes'],
  ] as const)('%s : l’origine est l’élément qui reçoit la touche, pas celui que `document.activeElement` désigne', async (_keys, steps, name) => {
    const { user } = await start(BOARD);
    await focusBoardCard();
    const receiver = sidebarHelp(); // un élément qui n'a pas le focus
    expect(document.activeElement).not.toBe(receiver);

    for (const step of steps) fireEvent.keyDown(receiver, step);
    await screen.findByRole('dialog', { name });
    await user.keyboard('{Escape}');
    exit.finish();

    await removed(name);
    await waitFor(() => expect(document.activeElement).toBe(receiver));
  });

  it('un clic de Chromium ou de Firefox (le bouton cliqué prend le focus) : le bouton, comme avant', async () => {
    const { user } = await start(BOARD);
    const button = searchIn('aside');

    await user.click(button);
    await palette();
    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(button));
  });
});

/*
 * `OverlayProvider` seul, sans l'application : un bouton qui ouvre l'aide en disant d'où il vient, et un autre bouton. Le focus que l'utilisateur a mis ailleurs n'est jamais repris (`focusIsAdrift`), l'élément
 * d'origine qui ne peut plus le recevoir passe la main (le contenu principal), et ce que le bouton passe à l'ouverture n'est pris que pour ce qu'il est : un élément qui n'est pas dans une boîte de dialogue ouverte.
 */
describe('une aide ouverte par un bouton qui dit d’où elle vient', () => {
  type Origin = 'ready' | 'disabled' | 'gone';
  let change: (next: Origin) => void = () => undefined;
  let api: ReturnType<typeof useShortcutsHelp> | undefined;

  function Page() {
    api = useShortcutsHelp();
    const [origin, setOrigin] = useState<Origin>('ready');
    change = setOrigin;
    return (
      <main>
        {origin === 'gone' ? null : (
          <button type="button" disabled={origin === 'disabled'} onClick={(event) => api?.show(event.currentTarget)}>
            Ouvrir l’aide
          </button>
        )}
        <button type="button">Autre bouton</button>
      </main>
    );
  }

  function renderPage() {
    return render(
      <ShortcutsProvider isMac>
        <OverlayProvider>
          <Page />
          <ShortcutsHelp />
        </OverlayProvider>
      </ShortcutsProvider>,
    );
  }

  it.each([
    ['désactivé', 'disabled'],
    ['retiré de la page', 'gone'],
  ] as const)('bouton %s pendant que l’aide est ouverte (clic de WebKit) : le contenu principal, pas le corps de la page', async (_state, next) => {
    const user = userEvent.setup();
    renderPage();
    clickLikeWebKit(screen.getByRole('button', { name: 'Ouvrir l’aide' }));
    await help();
    act(() => change(next));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it('le bouton qui a ouvert l’aide (clic de WebKit) n’est pas repris quand l’utilisateur a mis le focus ailleurs entre-temps', async () => {
    const user = userEvent.setup();
    renderPage();
    const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
    clickLikeWebKit(opener);
    await help();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(opener));
    const other = screen.getByRole('button', { name: 'Autre bouton' });
    act(() => other.focus());

    act(() => change('gone')); // le bouton part (une page arrive) : le focus est ailleurs, on n'y touche pas
    await afterRestore();

    expect(document.activeElement).toBe(other);
  });

  it('un élément d’une boîte de dialogue ouverte, passé à l’ouverture, ne remplace pas l’origine déjà notée', async () => {
    const user = userEvent.setup();
    renderPage();
    const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
    clickLikeWebKit(opener);
    const dialog = await help();

    act(() => api?.show(within(dialog).getByRole('button', { name: 'Fermer' }))); // l'aide demandée depuis elle-même (rouverte pendant son animation de sortie)
    await user.keyboard('{Escape}');

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('ce que le registre ou cmdk passent à l’ouverture sans être un élément (l’événement d’une touche, la valeur d’une ligne) est ignoré : le focus d’alors', async () => {
    const user = userEvent.setup();
    renderPage();
    const other = screen.getByRole('button', { name: 'Autre bouton' });
    act(() => other.focus());

    act(() => api?.show('action:shortcuts' as never));
    await help();
    await user.keyboard('{Escape}');

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(other));
  });

  it('sans rien à dire sur l’origine (un raccourci, un effet) : l’élément qui a le focus, comme avant', async () => {
    const user = userEvent.setup();
    renderPage();
    const other = screen.getByRole('button', { name: 'Autre bouton' });
    act(() => other.focus());

    act(() => api?.show());
    await help();
    await user.keyboard('{Escape}');

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(other));
  });
});
