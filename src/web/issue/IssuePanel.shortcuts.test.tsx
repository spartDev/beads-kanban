import { act, screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

const stubDefaultApi = () => stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } });
const pathname = (router: { state: { location: { pathname: string; search: string } } }) =>
  router.state.location.pathname + router.state.location.search;

const TICKET = '/p/bdesk/t/bdesk-38k.6';
const TITLE = /Shell UI façon Linear/;

/** Le panneau du ticket, tel que le voit l'arbre d'accessibilité. */
const openPanel = () => screen.findByRole('dialog', { name: TITLE });
/** Le panneau lu dans le DOM, par son titre : une boîte de dialogue modale (palette, aide) cache le reste de la page aux technologies d'assistance. */
const panel = () =>
  [...document.querySelectorAll('[role="dialog"]')].find((dialog) => TITLE.test(dialog.querySelector('h2')?.textContent ?? '')) ?? null;
const help = () => screen.findByRole('dialog', { name: 'Raccourcis clavier' });
const palette = () => screen.findByRole('dialog', { name: 'Palette de commandes' });
const noHelp = () => expect(screen.queryByRole('dialog', { name: 'Raccourcis clavier' })).toBeNull();

/** Un écran dont la largeur répond ou non à `(max-width: 767.98px)`, le seuil de `md:` de Tailwind. */
function screenIs(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /max-width: 767\.98px/.test(query) ? narrow : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

describe('le panneau d’un ticket sur desktop : une couche posée sur la page, pas une boîte de dialogue modale', () => {
  it('se dit non modal (`aria-modal="false"`) : le registre des raccourcis le lit pour savoir que la page dessous reste utilisable', async () => {
    screenIs(false);
    stubDefaultApi();
    renderApp(TICKET);

    const dialog = await openPanel();

    expect(dialog.getAttribute('aria-modal')).toBe('false');
  });

  it('« ? » ouvre l’aide des raccourcis quand le focus est dans le panneau ; Échap ferme l’aide seule, puis le panneau', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    const dialog = await openPanel();
    expect(document.activeElement).toBe(dialog);

    await user.keyboard('?');

    const shortcuts = await help();
    expect(within(shortcuts).getByText('Fermer le ticket')).toBeTruthy(); // l'aide dit ce que le panneau permet
    expect(pathname(router)).toBe(TICKET);
    await user.keyboard('{Escape}');
    await waitFor(() => noHelp());
    expect(panel()).toBeTruthy(); // Échap n'a fermé que l'aide
    await user.keyboard('{Escape}');
    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(panel()).toBeNull();
  });

  it.each([
    ['m', '/p/bdesk/metrics'],
    ['e', '/p/bdesk/epics'],
    ['k', '/p/bdesk/kanban'],
    ['v', '/'],
  ])('« g » puis « %s » navigue quand le focus est dans le panneau', async (second, destination) => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    const dialog = await openPanel();
    expect(document.activeElement).toBe(dialog);

    await user.keyboard(`g${second}`);

    await waitFor(() => expect(pathname(router)).toBe(destination));
    expect(panel()).toBeNull(); // la page a changé, le panneau avec elle
  });

  it('« g » puis « p » ouvre la palette sur les Projets, par-dessus le panneau', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();

    await user.keyboard('gp');

    const dialog = await palette();
    expect(within(dialog).getAllByRole('option').map((option) => option.textContent)).toEqual([
      expect.stringContaining('beads-desktop'),
      expect.stringContaining('My-Prompt-Manager'),
      expect.stringContaining('legacy-api'),
    ]);
    expect(pathname(router)).toBe(TICKET);
  });

  it('les touches du tableau dessous restent muettes tant que le focus est dans le panneau : ni « j », « k », « h », « l », ni les flèches, ni Entrée', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    const dialog = await openPanel();

    await user.keyboard('jkhl{ArrowLeft}{ArrowRight}{Enter}');

    expect(document.activeElement).toBe(dialog); // aucune carte n'a pris le focus
    expect(pathname(router)).toBe(TICKET);
    expect(panel()).toBeTruthy();
  });

  it('les touches du tableau valent toujours quand le focus est sur une carte, panneau ouvert à côté : « j » et « k » la déplacent', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();
    const ready = within(await screen.findByRole('region', { name: 'Prêt' }));
    const [first, second] = ready.getAllByRole('link');
    if (!first || !second) throw new Error('attendu : deux cartes dans la colonne « Prêt »');
    act(() => first.focus());

    await user.keyboard('j');
    expect(document.activeElement).toBe(second);
    await user.keyboard('k');
    expect(document.activeElement).toBe(first);

    expect(panel()).toBeTruthy(); // le panneau est resté ouvert pendant ce temps
    expect(pathname(router)).toBe(TICKET);
  });

  it('Échap ferme toujours le panneau, en priorité : même après l’aide, et même avec une carte qui a le focus', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();
    await user.keyboard('?');
    await help();
    await user.keyboard('{Escape}');
    await waitFor(() => noHelp());

    const board = await screen.findByRole('region', { name: 'En cours' });
    within(board).getByRole('link', { name: TITLE }).focus();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(panel()).toBeNull();
  });
});

describe('le panneau d’un ticket sur desktop : les boîtes de dialogue modales, ouvertes par-dessus, gardent le clavier', () => {
  it('la palette : « g » puis « m » tapés dans son champ s’y écrivent et ne naviguent pas, « ? » non plus n’ouvre pas l’aide', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();
    await user.keyboard('{Control>}k{/Control}');
    const dialog = await palette();
    const field = within(dialog).getByRole('combobox') as HTMLInputElement;
    expect(document.activeElement).toBe(field);

    await user.keyboard('gm?');

    expect(field.value).toBe('gm?');
    expect(pathname(router)).toBe(TICKET);
    noHelp();
  });

  it('l’aide : « g » puis « m », « g » puis « p » et « ? » s’y taisent, le panneau dessous ne bouge pas', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();
    await user.keyboard('?');
    await help();

    await user.keyboard('gmgp?');

    expect(pathname(router)).toBe(TICKET);
    expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull();
    expect(screen.getAllByRole('dialog', { name: 'Raccourcis clavier' })).toHaveLength(1);
    expect(panel()).toBeTruthy();
  });

  it('⌘K ouvre la palette depuis le panneau, comme avant', async () => {
    screenIs(false);
    stubDefaultApi();
    const { user } = renderApp(TICKET);
    await openPanel();

    await user.keyboard('{Control>}k{/Control}');

    await palette();
  });
});

describe('le panneau d’un ticket sur mobile : une vraie boîte de dialogue modale, qui garde le clavier comme la palette et l’aide', () => {
  it('se dit modal (`aria-modal="true"`)', async () => {
    screenIs(true);
    stubDefaultApi();
    renderApp(TICKET);

    const dialog = await openPanel();

    expect(dialog.getAttribute('aria-modal')).toBe('true');
  });

  it('« ? » et « g » puis « m » s’y taisent : l’aide et la navigation ne passent pas derrière un écran modal', async () => {
    screenIs(true);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    const dialog = await openPanel();
    expect(document.activeElement).toBe(dialog);

    await user.keyboard('?gmgkgpgv');

    noHelp();
    expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull();
    expect(pathname(router)).toBe(TICKET);
    expect(panel()).toBeTruthy();
  });

  it('Échap le ferme, et ⌘K ouvre la palette par-dessus : ce sont les deux issues du clavier', async () => {
    screenIs(true);
    stubDefaultApi();
    const { user, router } = renderApp(TICKET);
    await openPanel();

    await user.keyboard('{Control>}k{/Control}');
    await palette();
    await user.keyboard('{Escape}');
    await waitFor(() => expect(screen.queryByRole('dialog', { name: 'Palette de commandes' })).toBeNull());
    expect(panel()).toBeTruthy();
    await user.keyboard('{Escape}');

    await waitFor(() => expect(pathname(router)).toBe('/p/bdesk/kanban'));
    expect(panel()).toBeNull();
  });
});
