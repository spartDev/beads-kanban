import { act, render, screen, waitFor, within } from '@testing-library/react';
import userEvent, { type UserEvent } from '@testing-library/user-event';
import { StrictMode, useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import { ShortcutsProvider, useShortcut } from '../shortcuts/ShortcutsProvider';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { withHeldExitAnimations } from '../test/exitAnimation';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';
import { OverlayProvider, useShortcutsHelp } from './OverlayProvider';
import { ShortcutsHelp } from './ShortcutsHelp';

/**
 * Où va le focus quand la palette ⌘K ou l'aide des raccourcis se referment (bdesk-38k.23). Radix ne le rend qu'à un déclencheur
 * (`Dialog.Trigger`), et ces deux boîtes de dialogue s'ouvrent par le registre des raccourcis ou par un bouton qui n'en est pas un :
 * il tombait sur le corps de la page. Le panneau d'un ticket perdait le focus (Tab repartait du début de la page) et, sur mobile, les
 * raccourcis à touche simple repartaient derrière le panneau modal.
 *
 * Chaque cas se joue deux fois : sans animation de sortie (ce que fait jsdom) et avec celle du navigateur, qui garde la boîte de
 * dialogue montée, fermée, pendant 90 ms avant de la retirer, et c'est alors seulement que le focus peut être rendu.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`. Chaque cas ouvre une boîte de
// dialogue, la ferme et attend le focus : le délai d'un test (5 s) y est court aussi.
withAsyncTimeout(5_000);
vi.setConfig({ testTimeout: 20_000 });

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const BOARD = '/p/bdesk/kanban';
const METRICS = '/p/bdesk/metrics';
const TICKET = '/p/bdesk/t/bdesk-38k.6';
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

/** L'application, sur desktop ou sur mobile, prête à recevoir le clavier. */
async function start(path: string, { narrow = false }: { narrow?: boolean } = {}) {
  screenIs(narrow);
  stubDefaultApi();
  const app = renderApp(path);
  // `hidden` : sur mobile, un panneau ouvert rend la page inerte, et une boîte de dialogue ouverte la cache aux technologies d'assistance.
  await screen.findByRole('navigation', { name: 'Navigation principale', hidden: true });
  return app;
}

/** Le panneau du ticket `TICKET`, une fois sa fiche chargée : la boîte de dialogue prend alors son titre pour nom. */
const ticketPanel = () => screen.findByRole('dialog', { name: TITLE });

/** Une carte de la colonne « En cours » du tableau, qui prend le focus comme au clavier (`j`, Tab). */
async function focusBoardCard() {
  const column = await screen.findByRole('region', { name: 'En cours' });
  const card = within(column).getByRole('link', { name: TITLE });
  act(() => card.focus());
  expect(document.activeElement).toBe(card);
  return card;
}

const main = () => document.querySelector<HTMLElement>('main');
/** L'infobulle ouverte, s'il y en a une : une infobulle fermée reste montée le temps de son animation de sortie. */
const openTooltip = () => screen.queryAllByRole('tooltip').find((tooltip) => tooltip.getAttribute('data-state') !== 'closed') ?? null;
const palette = () => screen.findByRole('dialog', { name: 'Palette de commandes' });
const help = () => screen.findByRole('dialog', { name: 'Raccourcis clavier' });
/** Rien de ce nom n'est plus dans le DOM, même caché aux technologies d'assistance. */
const removed = (name: string) =>
  waitFor(() => expect(screen.queryByRole('dialog', { name, hidden: true })).toBeNull());
/** Laisse passer les minuteries de 0 ms (celle de Radix qui rend le focus) : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const afterRestore = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

/** Ce que fait jsdom des animations de sortie : rien, la boîte de dialogue est retirée à l'instant où elle se ferme. */
const NO_EXIT_ANIMATION: { finish: (only?: Element) => void } = { finish: () => undefined };

const MODES = [
  ['sans animation de sortie', false],
  ['avec l’animation de sortie du navigateur', true],
] as const;

async function openPalette(user: UserEvent) {
  await user.keyboard('{Control>}k{/Control}');
  return palette();
}

describe.each(MODES)('la palette ⌘K rend le focus à ce qui l’avait avant son ouverture : %s', (_mode, held) => {
  const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;

  it('Échap : la carte du tableau qui l’avait la retrouve, et le clavier reprend où il en était', async () => {
    const { user, router } = await start(BOARD);
    const card = await focusBoardCard();
    await openPalette(user);
    expect(document.activeElement).not.toBe(card);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(card));
    await user.keyboard('{Enter}'); // la carte est un lien : Entrée ouvre son ticket
    await waitFor(() => expect(pathname(router)).toBe(TICKET));
  });

  it('Échap : le panneau d’un ticket (desktop) qui l’avait la retrouve, et Échap le ferme encore', async () => {
    const { user, router } = await start(TICKET);
    const panel = await ticketPanel();
    expect(document.activeElement).toBe(panel);
    await openPalette(user);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(panel));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(pathname(router)).toBe(BOARD));
  });

  it('Échap : le lien du panneau qui l’avait la retrouve, pas le panneau', async () => {
    const { user } = await start(TICKET);
    const panel = await ticketPanel();
    const link = within(panel).getByRole('link', { name: /Epic : beads-desktop V1/ });
    act(() => link.focus());
    await openPalette(user);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(link));
  });

  it('Échap sur la page Métriques, où rien n’avait le focus : le contenu principal, jamais le corps de la page', async () => {
    const { user } = await start(METRICS);
    expect(document.activeElement).toBe(document.body);
    expect(main()?.hasAttribute('tabindex')).toBe(false);
    await openPalette(user);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(main()));
    // Le style de base donne un contour à tout élément à `tabindex` qui prend le focus : le contenu principal n'en veut pas.
    expect(main()?.className).toContain('outline-none');
    // Il n'est focalisable que le temps qu'il a le focus : un clic dans le vide ne le lui donnera pas.
    act(() => main()?.blur());
    expect(main()?.hasAttribute('tabindex')).toBe(false);
  });

  it('un clic en dehors : la carte du tableau qui avait le focus la retrouve', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    const dialog = await openPalette(user);
    const backdrop = dialog.previousElementSibling;
    if (!(backdrop instanceof HTMLElement)) throw new Error('attendu : le fond de la palette, juste avant elle');

    await user.click(backdrop);
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it.each([
    ['Entrée', 'keyboard'],
    ['un clic', 'click'],
  ] as const)('un choix qui change de page (%s) : la carte a disparu, le contenu principal prend le focus', async (_how, how) => {
    const { user, router } = await start(BOARD);
    const card = await focusBoardCard();
    const dialog = await openPalette(user);
    await user.keyboard('metriques');
    const option = await within(dialog).findByRole('option', { name: /Métriques/ });

    if (how === 'keyboard') await user.keyboard('{Enter}');
    else await user.click(option);
    await waitFor(() => expect(pathname(router)).toBe(METRICS));
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(main()));
    expect(card.isConnected).toBe(false);
  });

  it.each([
    ['Entrée', 'keyboard'],
    ['un clic', 'click'],
  ] as const)('un choix qui ouvre un ticket (%s) : le focus est dans le nouveau panneau, il ne retourne pas à la carte', async (_how, how) => {
    const { user, router } = await start(BOARD);
    const card = await focusBoardCard();
    const dialog = await openPalette(user);
    await user.keyboard('38k.7');
    const option = await within(dialog).findByRole('option', { name: OTHER_TITLE });

    if (how === 'keyboard') await user.keyboard('{Enter}');
    else await user.click(option);
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE, hidden: true });
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7'));
    exit.finish();

    await removed('Palette de commandes');
    await afterRestore();
    expect(card.isConnected).toBe(true); // le tableau est toujours là : c'est le choix du panneau qui compte
    expect(document.activeElement).toBe(panel);
  });

  it('un choix qui ouvre un autre ticket depuis le panneau : le focus reste dans le panneau', async () => {
    const { user, router } = await start(TICKET);
    await ticketPanel();
    const dialog = await openPalette(user);
    await user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7'));
    exit.finish();

    await removed('Palette de commandes');
    await afterRestore();
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE });
    expect(document.activeElement).toBe(panel);
  });

  it('l’élément d’origine disparaît pendant que la palette est ouverte (une mise à jour retire sa carte), un panneau est ouvert à côté : le focus va au panneau', async () => {
    screenIs(false);
    const issues = [...bdeskIssues];
    stubApi({ projects: projectsResponse, issues: { bdesk: issues, mpm: mpmIssues } });
    const { user, queryClient } = renderApp('/p/bdesk/t/bdesk-38k.7');
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE });
    const card = await focusBoardCard();
    await openPalette(user);
    issues.splice(issues.findIndex((candidate) => candidate.id === 'bdesk-38k.6'), 1);
    await act(() => queryClient.invalidateQueries({ queryKey: queryKeys.issues('bdesk') }));
    await waitFor(() => expect(card.isConnected).toBe(false));

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(panel));
  });

  it('« g m » juste après le focus rendu : la navigation n’est pas la suite de la fermeture, le focus finit comme sans palette', async () => {
    /** Où est le focus une fois sur les Métriques, avec ou sans palette ouverte puis fermée avant « g m ». */
    async function focusAfterGoToMetrics(throughPalette: boolean) {
      const { user, router, unmount } = await start(BOARD);
      const card = await focusBoardCard();
      if (throughPalette) {
        await openPalette(user);
        await user.keyboard('{Escape}');
        exit.finish();
        await waitFor(() => expect(document.activeElement).toBe(card));
      }
      await user.keyboard('gm');
      await waitFor(() => expect(pathname(router)).toBe(METRICS));
      await afterRestore();
      const active = document.activeElement;
      unmount();
      return active === document.body ? 'body' : `${active?.tagName.toLowerCase()}#${active?.id}`;
    }

    const without = await focusAfterGoToMetrics(false);
    const through = await focusAfterGoToMetrics(true);

    expect(through).toBe(without);
  });

  it.runIf(held)('rouverte pendant son animation de sortie, elle garde l’origine du premier appel, pas son propre champ', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    const first = await openPalette(user);
    await user.keyboard('{Escape}');
    expect(first.getAttribute('data-state')).toBe('closed');

    await user.keyboard('{Control>}k{/Control}');
    expect(first.getAttribute('data-state')).toBe('open'); // la même boîte, rouverte avant d'avoir disparu
    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
});

describe.each(MODES)('l’aide des raccourcis rend le focus à ce qui l’avait avant son ouverture : %s', (_mode, held) => {
  const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;

  it('Échap : la carte du tableau qui l’avait la retrouve', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    await user.keyboard('?');
    const dialog = await help();
    expect(dialog.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('Échap : le panneau d’un ticket (desktop), où « ? » l’a ouverte, retrouve le focus ; Échap ferme alors le panneau', async () => {
    const { user, router } = await start(TICKET);
    const panel = await ticketPanel();
    await user.keyboard('?');
    await help();

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(panel));
    await user.keyboard('{Escape}');
    await waitFor(() => expect(pathname(router)).toBe(BOARD));
  });

  it.runIf(held)('Échap, deux fois de suite : l’aide se ferme, puis le panneau, sans attendre la fin de l’animation de l’aide', async () => {
    const { user, router } = await start(TICKET);
    await ticketPanel();
    await user.keyboard('?');
    const dialog = await help();

    await user.keyboard('{Escape}');
    expect(dialog.getAttribute('data-state')).toBe('closed');
    expect(dialog.isConnected).toBe(true); // l'aide n'a pas fini de se retirer : sa couche Radix prend encore Échap
    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe(BOARD));
  });

  it('le bouton « Fermer » : le focus retourne au bouton de la barre latérale qui l’avait ouverte', async () => {
    const { user } = await start(BOARD);
    const opener = screen.getByRole('button', { name: 'Afficher les raccourcis clavier' });
    await user.click(opener);
    const dialog = await help();

    await user.click(within(dialog).getByRole('button', { name: 'Fermer' }));
    exit.finish();

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });

  it('ouverte par le bouton de la barre latérale, un panneau dessous : le bouton retrouve le focus sans son infobulle, et le second Échap ferme le panneau', async () => {
    const { user, router } = await start(TICKET);
    await ticketPanel();
    const opener = screen.getByRole('button', { name: 'Afficher les raccourcis clavier' });
    await user.click(opener);
    await help();

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(opener));
    // Rendu par programme, le focus n'ouvre pas l'infobulle du bouton : sa couche Radix prendrait le prochain Échap.
    expect(openTooltip()).toBeNull();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(pathname(router)).toBe(BOARD));
  });

  it('le clavier qui revient au bouton de la barre latérale en rouvre l’infobulle : seul le focus rendu par programme la laisse fermée', async () => {
    const { user } = await start(BOARD);
    const opener = screen.getByRole('button', { name: 'Afficher les raccourcis clavier' });
    await user.click(opener);
    await help();
    await user.keyboard('{Escape}');
    exit.finish();
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(openTooltip()).toBeNull();

    await user.tab({ shift: true });
    await user.tab();

    expect(document.activeElement).toBe(opener);
    await waitFor(() => expect(openTooltip()).not.toBeNull());
    expect(openTooltip()?.textContent).toContain('Raccourcis clavier');
  });

  it('Échap sur la page Métriques : le contenu principal, jamais le corps de la page', async () => {
    const { user } = await start(METRICS);
    await user.keyboard('?');
    await help();

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it('un clic en dehors : la carte du tableau qui avait le focus la retrouve', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    await user.keyboard('?');
    const dialog = await help();
    const backdrop = dialog.previousElementSibling;
    if (!(backdrop instanceof HTMLElement)) throw new Error('attendu : le fond de l’aide, juste avant elle');

    await user.click(backdrop);
    exit.finish();

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
});

describe.each(MODES)('la palette et l’aide se remplacent sans perdre l’origine : %s', (_mode, held) => {
  const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;

  it.runIf(held)('l’aide fermée avant que la palette qu’elle remplaçait ait fini de se retirer : la carte d’origine retrouve quand même le focus, quand la dernière a disparu', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    const dialog = await openPalette(user);
    await user.keyboard('raccourcis');
    await user.click(await within(dialog).findByRole('option', { name: /^Raccourcis clavier/ }));
    const shortcuts = await screen.findByRole('dialog', { name: 'Raccourcis clavier', hidden: true });
    await user.keyboard('{Escape}'); // l'aide se ferme à son tour : les deux boîtes de dialogue finissent de se retirer

    exit.finish(dialog); // la palette a fini la première ; l'aide est encore là, et le focus y est encore
    await afterRestore();

    expect(shortcuts.isConnected).toBe(true);
    expect(shortcuts.contains(document.activeElement)).toBe(true);
    exit.finish();
    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('de la palette à l’aide (commande « Raccourcis clavier ») : à la fermeture de l’aide, la carte d’origine retrouve le focus', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    const dialog = await openPalette(user);
    await user.keyboard('raccourcis');
    await within(dialog).findByRole('option', { name: /Raccourcis clavier/ });

    await user.keyboard('{Enter}');
    const shortcuts = await screen.findByRole('dialog', { name: 'Raccourcis clavier', hidden: true });
    exit.finish(); // la palette, remplacée, finit de se retirer : l'aide garde le focus
    await removed('Palette de commandes');
    await afterRestore();
    expect(shortcuts.contains(document.activeElement)).toBe(true);

    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });

  it('de l’aide à la palette (⌘K) : à la fermeture de la palette, la carte d’origine retrouve le focus', async () => {
    const { user } = await start(BOARD);
    const card = await focusBoardCard();
    await user.keyboard('?');
    const shortcuts = await help();

    await user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes', hidden: true });
    exit.finish();
    await removed('Raccourcis clavier');
    await afterRestore();
    expect(dialog.contains(document.activeElement)).toBe(true);
    expect(shortcuts.isConnected).toBe(false);

    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(card));
  });
});

describe.each(MODES)('sur mobile, le panneau modal garde le focus et le clavier après la palette et l’aide : %s', (_mode, held) => {
  const exit = held ? withHeldExitAnimations() : NO_EXIT_ANIMATION;

  /** « ? » et « g » puis une lettre : ni l'aide, ni la palette, ni un changement de page ne doivent partir derrière le panneau. */
  async function expectShortcutsMuted(user: UserEvent, router: { state: { location: { pathname: string; search: string } } }) {
    await user.keyboard('?gmgkgpgv');
    expect(screen.queryByRole('dialog', { name: 'Raccourcis clavier', hidden: true })).toBeNull();
    expect(screen.queryByRole('dialog', { name: 'Palette de commandes', hidden: true })).toBeNull();
    expect(pathname(router)).toBe(TICKET);
  }

  it('Échap sur la palette : le focus est dans le panneau, « ? » et « g … » ne partent pas derrière lui', async () => {
    const { user, router } = await start(TICKET, { narrow: true });
    const panel = await ticketPanel();
    expect(panel.getAttribute('aria-modal')).toBe('true');
    await openPalette(user);

    await user.keyboard('{Escape}');
    exit.finish();

    await waitFor(() => expect(document.activeElement).toBe(panel));
    await expectShortcutsMuted(user, router);
  });

  it('un clic en dehors de la palette : de même', async () => {
    const { user, router } = await start(TICKET, { narrow: true });
    const panel = await ticketPanel();
    const dialog = await openPalette(user);
    const backdrop = dialog.previousElementSibling;
    if (!(backdrop instanceof HTMLElement)) throw new Error('attendu : le fond de la palette, juste avant elle');

    await user.click(backdrop);
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(panel));
    await expectShortcutsMuted(user, router);
  });

  it('Échap sur l’aide, ouverte depuis la palette (la seule voie sur mobile) : de même', async () => {
    const { user, router } = await start(TICKET, { narrow: true });
    const panel = await ticketPanel();
    const dialog = await openPalette(user);
    await user.keyboard('raccourcis');
    await within(dialog).findByRole('option', { name: /Raccourcis clavier/ });
    await user.keyboard('{Enter}');
    await screen.findByRole('dialog', { name: 'Raccourcis clavier', hidden: true });
    exit.finish();

    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Raccourcis clavier');
    await waitFor(() => expect(document.activeElement).toBe(panel));
    await expectShortcutsMuted(user, router);
  });

  it('un choix qui ferme le panneau (changer de page) : le contenu principal prend le focus', async () => {
    const { user, router } = await start(TICKET, { narrow: true });
    await ticketPanel();
    const dialog = await openPalette(user);
    await user.keyboard('metriques');
    await within(dialog).findByRole('option', { name: /Métriques/ });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe(METRICS));
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it('un choix qui ouvre un autre ticket : le focus est dans le nouveau panneau', async () => {
    const { user, router } = await start(TICKET, { narrow: true });
    await ticketPanel();
    const dialog = await openPalette(user);
    await user.keyboard('38k.7');
    await within(dialog).findByRole('option', { name: OTHER_TITLE });

    await user.keyboard('{Enter}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/t/bdesk-38k.7'));
    exit.finish();

    await removed('Palette de commandes');
    await afterRestore();
    const panel = await screen.findByRole('dialog', { name: OTHER_TITLE });
    expect(document.activeElement).toBe(panel);
  });

  it('le bouton « Rechercher » de la barre du haut : le focus lui retourne', async () => {
    const { user } = await start(BOARD, { narrow: true });
    // Deux boutons se nomment « Rechercher » : celui de la barre latérale (cachée sur mobile par la feuille de style, que jsdom n'a pas) et
    // celui du bandeau du haut, qui est le seul de l'écran étroit.
    const opener = screen.getAllByRole('button', { name: 'Rechercher' }).find((button) => button.closest('header'));
    if (!opener) throw new Error('attendu : le bouton « Rechercher » du bandeau du haut');
    await user.click(opener);
    await palette();

    await user.keyboard('{Escape}');
    exit.finish();

    await removed('Palette de commandes');
    await waitFor(() => expect(document.activeElement).toBe(opener));
    expect(openTooltip()).toBeNull(); // le bouton a une infobulle (« Rechercher »), que le focus rendu n'ouvre pas
  });
});

describe('quand l’élément d’origine ne peut plus recevoir le focus : le panneau ouvert, sinon le contenu principal', () => {
  type Origin = 'ready' | 'disabled' | 'gone';
  let change: (next: Origin) => void = () => undefined;

  /**
   * Une page avec un bouton qui ouvre l'aide (ou « ? »), un contenu principal comme celui du shell (sans `tabindex`) et, selon le cas, un
   * panneau de ticket posé sur la page (il porte `data-issue-panel`, comme `IssuePanel`) ou une autre boîte de dialogue non modale, qui n'est
   * pas un panneau de ticket.
   */
  function Page({ withPanel, withOtherDialog, mainHidden }: { withPanel: boolean; withOtherDialog: boolean; mainHidden: boolean }) {
    const { show } = useShortcutsHelp();
    useShortcut({ id: 'test.help', keys: '?', label: 'Aide', group: 'Test', run: show });
    const [origin, setOrigin] = useState<Origin>('ready');
    change = setOrigin;
    return (
      <main hidden={mainHidden}>
        {origin === 'gone' ? null : (
          <button type="button" disabled={origin === 'disabled'} onClick={show}>
            Ouvrir l’aide
          </button>
        )}
        <button type="button">Autre bouton</button>
        {withPanel ? <div role="dialog" aria-modal="false" aria-label="Panneau" data-issue-panel="" tabIndex={-1} /> : null}
        {withOtherDialog ? <div role="dialog" aria-modal="false" aria-label="Autre boîte" tabIndex={-1} /> : null}
      </main>
    );
  }

  function renderPage({ withPanel = false, withOtherDialog = false, mainHidden = false, strict = false } = {}) {
    const page = (
      <ShortcutsProvider isMac>
        <OverlayProvider>
          <Page withPanel={withPanel} withOtherDialog={withOtherDialog} mainHidden={mainHidden} />
          <ShortcutsHelp />
        </OverlayProvider>
      </ShortcutsProvider>
    );
    return render(strict ? <StrictMode>{page}</StrictMode> : page);
  }

  it.each([
    ['désactivé', 'disabled'],
    ['retiré de la page', 'gone'],
  ] as const)('bouton %s pendant que l’aide est ouverte : le contenu principal', async (_state, next) => {
    const user = userEvent.setup();
    renderPage();
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’aide' }));
    await help();
    act(() => change(next));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it.each([
    ['désactivé', 'disabled'],
    ['retiré de la page', 'gone'],
  ] as const)('bouton %s, un panneau ouvert sur la page : le panneau, avant le contenu principal', async (_state, next) => {
    const user = userEvent.setup();
    renderPage({ withPanel: true });
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’aide' }));
    await help();
    act(() => change(next));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('dialog', { name: 'Panneau' })));
  });

  it.each([
    ['sans panneau', false],
    ['un panneau ouvert sur la page', true],
  ] as const)(
    'l’élément qui vient de retrouver le focus quitte la page aussitôt après (la page qu’un choix ouvre n’est pas encore montée, sur un appareil lent) : %s',
    async (_case, withPanel) => {
      const user = userEvent.setup();
      renderPage({ withPanel });
      const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
      await user.click(opener);
      await help();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(opener));

      act(() => change('gone')); // la page arrive et retire le bouton : le focus ne doit pas tomber sur le corps de la page

      await waitFor(() => expect(document.activeElement).toBe(withPanel ? screen.getByRole('dialog', { name: 'Panneau' }) : main()));
    },
  );

  it('une autre boîte de dialogue que le panneau d’un ticket n’est pas un repli : le contenu principal, pas elle', async () => {
    const user = userEvent.setup();
    renderPage({ withOtherDialog: true });
    await user.click(screen.getByRole('button', { name: 'Ouvrir l’aide' }));
    await help();
    act(() => change('gone'));

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(main()));
    expect(document.activeElement).not.toBe(screen.getByRole('dialog', { name: 'Autre boîte' }));
  });

  it.each([
    ['une touche', 'keyboard'],
    ['un clic dans le vide', 'click'],
  ] as const)(
    'l’utilisateur agit après le focus rendu (%s) : ce qui retire ensuite l’élément n’est plus la suite de la fermeture, la veille est finie',
    async (_how, how) => {
      const user = userEvent.setup();
      renderPage();
      const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
      await user.click(opener);
      await help();
      await user.keyboard('{Escape}');
      await waitFor(() => expect(document.activeElement).toBe(opener));

      if (how === 'keyboard') await user.keyboard('x');
      else await user.click(document.body);
      act(() => change('gone')); // une navigation que l'utilisateur vient de demander, sans rapport avec la boîte fermée
      await afterRestore();

      expect(document.activeElement).toBe(document.body); // comme sans boîte de dialogue : rien ne rattrape le focus
    },
  );

  it('l’élément retiré n’a plus le focus (l’utilisateur ou la nouvelle page l’a pris ailleurs entre-temps) : on n’y touche pas', async () => {
    const user = userEvent.setup();
    renderPage();
    const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
    await user.click(opener);
    await help();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(opener));
    const other = screen.getByRole('button', { name: 'Autre bouton' });
    act(() => other.focus());

    act(() => change('gone'));
    await afterRestore();

    expect(document.activeElement).toBe(other);
  });

  it('rien n’avait le focus avant l’ouverture : le contenu principal, pas le corps de la page', async () => {
    const user = userEvent.setup();
    renderPage();
    expect(document.activeElement).toBe(document.body);
    await user.keyboard('?');
    await help();

    await user.keyboard('{Escape}');

    await waitFor(() => expect(document.activeElement).toBe(main()));
  });

  it('un contenu principal caché ne peut pas recevoir le focus : il reste au corps de la page, et la page ne garde pas de tabindex de ce passage', async () => {
    const user = userEvent.setup();
    renderPage({ mainHidden: true });
    await user.keyboard('?');
    await help();

    await user.keyboard('{Escape}');
    await removed('Raccourcis clavier');
    await afterRestore();

    expect(document.activeElement).toBe(document.body);
    expect(main()?.hasAttribute('tabindex')).toBe(false);
  });

  it('en développement (StrictMode, comme main.tsx), React rejoue les effets de la boîte au montage : l’aide ouverte garde le focus, et le rend à la fermeture', async () => {
    const user = userEvent.setup();
    renderPage({ strict: true });
    const opener = screen.getByRole('button', { name: 'Ouvrir l’aide' });
    await user.click(opener);
    const dialog = await help();

    // Tant que l'aide est ouverte, rien ne doit rendre le focus à l'origine, même quand React rejoue ses effets.
    await afterRestore();

    expect(dialog.isConnected).toBe(true);
    expect(dialog.contains(document.activeElement)).toBe(true);
    await user.keyboard('{Escape}');
    await waitFor(() => expect(document.activeElement).toBe(opener));
  });
});
