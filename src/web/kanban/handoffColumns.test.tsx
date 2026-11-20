import type { QueryClient } from '@tanstack/react-query';
import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { DeclaredStatuses, Issue } from '../data/types';
import { refreshProject } from '../live/refresh';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { classesOf, rulesFor, selectorOf } from '../test/compiledCss';
import { renderApp, stubApi } from '../test/render';
import { installFakeResizeObserver } from '../test/resizeObserver';

/**
 * Les colonnes des Statuts de relais au tableau (bdesk-pz0.4, ADR 0007) : En relecture, En intégration et À valider, entre En cours et Bloqué. Une
 * colonne de relais n'est là que si le Projet déclare son statut ou qu'un de ses tickets le porte ; sinon, le tableau garde ses cinq colonnes, comme
 * avant. Un ticket d'un Statut de relais est dans sa colonne, et dans Bloqué en Blocage ; sa carte dit alors son statut, que la colonne ne dit plus.
 */

withAsyncTimeout(5_000);

const ALL_HANDOFF: DeclaredStatuses = { handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] };
const WITH_QA: DeclaredStatuses = { handoff: [], others: [{ name: 'qa_testing', category: 'wip' }] };

const TICKETS: Issue[] = [
  issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }),
  issue({ id: 'bdesk-2', title: 'En développement', status: 'in_progress' }),
  issue({ id: 'bdesk-3', title: 'Relu par un agent', status: 'in_review' }),
  issue({ id: 'bdesk-4', title: 'Demande de fusion ouverte', status: 'in_integration' }),
  issue({ id: 'bdesk-5', title: 'Attend votre test', status: 'awaiting_human' }),
  issue({ id: 'bdesk-6', title: 'Relecture coincée', status: 'in_review', blockedBy: ['bdesk-1'] }),
];

const PLAIN: Issue[] = [
  issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }),
  issue({ id: 'bdesk-2', title: 'En développement', status: 'in_progress' }),
  issue({ id: 'bdesk-7', title: 'Rattaché', status: 'hooked' }),
  issue({ id: 'bdesk-8', title: 'Statut bloqué', status: 'blocked' }),
];

async function openBoard(issues: Issue[], { declared, path = '/p/bdesk/kanban', language }: { declared?: DeclaredStatuses; path?: string; language?: 'en' } = {}) {
  if (language) setBrowserLanguages(['en-US']);
  stubApi({ projects: projectsResponse, issues: { bdesk: issues }, ...(declared ? { declared: { bdesk: declared } } : {}) });
  const app = renderApp(path, language ? { languageSwitch: true } : {});
  await screen.findByRole('region', { name: language ? 'Ready' : 'Prêt' });
  return app;
}

/** Les régions des colonnes, dans l'ordre du DOM. */
const columns = () => screen.getAllByRole('region').filter((region) => region.hasAttribute('data-column'));
const headings = () => columns().map((region) => region.querySelector('h2')?.textContent);
const titlesIn = (region: HTMLElement) =>
  within(region)
    .queryAllByRole('listitem')
    .map((card) => within(card).getAllByRole('link')[0]?.textContent);
const card = (id: string) => document.querySelector<HTMLElement>(`[data-card-id="${id}"]`) as HTMLElement;
/** La pastille de statut d'une carte : son texte, ou null sans pastille. */
const statusPill = (id: string) => card(id).querySelector('[data-card-status]')?.textContent ?? null;
const selectorButtons = () => within(screen.getByRole('group', { name: /^(Colonne affichée|Column shown)$/ })).getAllByRole('button');

describe('sans Statut de relais déclaré ni porté', () => {
  it('garde ses cinq colonnes et son sélecteur de cinq boutons, comme avant', async () => {
    await openBoard(PLAIN);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'Bloqué', 'Terminé']);
    expect(selectorButtons()).toHaveLength(5);
    expect(document.querySelector('[data-column-selector] [role="group"]')?.className).toContain('grid-cols-5');
  });

  it('n’écrit aucun statut sur les cartes de ses colonnes : en cours, rattaché à un agent (sa pastille « agent ») et statut bloqué', async () => {
    await openBoard(PLAIN);

    for (const id of ['bdesk-1', 'bdesk-2', 'bdesk-7', 'bdesk-8']) expect(statusPill(id), id).toBeNull();
    expect(within(card('bdesk-7')).getByText('agent')).toBeTruthy();
  });
});

describe('les colonnes de relais', () => {
  it('apparaissent entre En cours et Bloqué quand des tickets portent leur statut, sans déclaration', async () => {
    await openBoard(TICKETS);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'En relecture', 'En intégration', 'À valider', 'Bloqué', 'Terminé']);
    expect(selectorButtons().map((button) => button.textContent)).toEqual([
      'Backlog0 ticket',
      'Prêt1 ticket',
      'En cours1 ticket',
      'En relecture1 ticket',
      'En intégration1 ticket',
      'À valider1 ticket',
      'Bloqué1 ticket',
      'Terminé0 ticket',
    ]);
  });

  it('rangent chaque ticket dans la colonne de son statut, et un ticket en Blocage dans Bloqué', async () => {
    await openBoard(TICKETS);

    expect(titlesIn(screen.getByRole('region', { name: 'En cours' }))).toEqual(['En développement']);
    expect(titlesIn(screen.getByRole('region', { name: 'En relecture' }))).toEqual(['Relu par un agent']);
    expect(titlesIn(screen.getByRole('region', { name: 'En intégration' }))).toEqual(['Demande de fusion ouverte']);
    expect(titlesIn(screen.getByRole('region', { name: 'À valider' }))).toEqual(['Attend votre test']);
    expect(titlesIn(screen.getByRole('region', { name: 'Bloqué' }))).toEqual(['Relecture coincée']);
  });

  it('apparaissent vides quand le Projet déclare leur statut et qu’aucun ticket ne le porte', async () => {
    await openBoard(PLAIN, { declared: ALL_HANDOFF });

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'En relecture', 'En intégration', 'À valider', 'Bloqué', 'Terminé']);
    for (const name of ['En relecture', 'En intégration', 'À valider']) expect(within(screen.getByRole('region', { name })).getByText('Aucun ticket')).toBeTruthy();
  });

  it('n’apparaissent que pour les statuts déclarés ou portés : une seule colonne de relais, à sa place', async () => {
    await openBoard([...PLAIN, issue({ id: 'bdesk-5', title: 'Attend votre test', status: 'awaiting_human' })]);

    expect(headings()).toEqual(['Backlog', 'Prêt', 'En cours', 'À valider', 'Bloqué', 'Terminé']);
  });

  it('disent leur règle en infobulle, avec les mots du glossaire', async () => {
    await openBoard(TICKETS);

    const hint = (name: string, text: string) => within(screen.getByRole('region', { name })).getByText(text).getAttribute('title');
    expect(hint('En relecture', 'Agent relecteur, hors Blocage')).toBe('Ticket qu’un agent relecteur examine, sans dépendance en suspens.');
    expect(hint('En intégration', 'Fusion demandée, hors Blocage')).toContain('la demande de fusion est ouverte');
    expect(hint('À valider', 'Vous attend, hors Blocage')).toContain('un test à la main, une décision ou votre feu vert');
  });

  it('s’affichent seules sur mobile avec ?col=, et retombent sur la colonne d’ouverture pour une colonne que le Projet n’a pas', async () => {
    await openBoard(TICKETS, { path: '/p/bdesk/kanban?col=awaitingHuman' });
    expect(columns().filter((region) => region.dataset.shown === 'true').map((region) => region.dataset.column)).toEqual(['awaitingHuman']);
    expect(selectorButtons().find((button) => button.getAttribute('aria-pressed') === 'true')?.textContent).toMatch(/^À valider/);
  });

  it('ne montrent pas une colonne de relais absente du Projet, même demandée par l’adresse', async () => {
    await openBoard(PLAIN, { path: '/p/bdesk/kanban?col=inReview' });

    expect(columns().filter((region) => region.dataset.shown === 'true').map((region) => region.dataset.column)).toEqual(['inProgress']);
  });

  it('remplacent une seule fois la colonne d’ouverture qui disparaît en direct : la remplaçante reste, rafraîchissement après rafraîchissement', async () => {
    const ready = issue({ id: 'bdesk-1', title: 'Prêt à démarrer' });
    const relayed = (status: string, extra: Partial<Issue> = {}) => [ready, issue({ id: 'bdesk-2', title: 'Relu', status, ...extra })];
    const shown = () => columns().filter((region) => region.dataset.shown === 'true').map((region) => region.dataset.column);
    const serve = (issues: Issue[]) => stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
    const commit = (queryClient: QueryClient) => act(() => refreshProject(queryClient, 'bdesk'));

    // La colonne d'ouverture est En relecture, la seule qui ait un ticket en travail.
    const { queryClient } = await openBoard(relayed('in_review'));
    const seen = [shown()];
    // Le ticket passe en cours : la colonne En relecture disparaît, le tableau prend celle qu'on choisirait à l'ouverture.
    serve(relayed('in_progress'));
    await commit(queryClient);
    await waitFor(() => expect(screen.queryByRole('region', { name: 'En relecture' })).toBeNull());
    seen.push(shown());
    // Il est fermé : En cours se vide, sans faire sauter le tableau ailleurs.
    serve(relayed('closed', { closedAt: new Date().toISOString() }));
    await commit(queryClient);
    await waitFor(() => expect(card('bdesk-2').closest('section')?.dataset.column).toBe('done'));
    seen.push(shown());
    // Il revient en relecture : la colonne reparaît, sans reprendre la place de la remplaçante.
    serve(relayed('in_review'));
    await commit(queryClient);
    await screen.findByRole('region', { name: 'En relecture' });
    seen.push(shown());

    expect(seen).toEqual([['inReview'], ['inProgress'], ['inProgress'], ['inProgress']]);
  });

  it('ne citent dans la règle de Bloqué, en infobulle, que les Statuts de relais dont le tableau a la colonne', async () => {
    const rule = () => screen.getByRole('region', { name: 'Bloqué' }).querySelector('header p')?.getAttribute('title') ?? '';

    const plain = await openBoard(PLAIN);
    expect(rule()).toContain('en cours, rattaché à un agent ou un autre statut');
    for (const relay of ['en relecture', 'en intégration', 'à valider']) expect(rule(), relay).not.toContain(relay);
    plain.unmount();

    // Un seul ticket en relecture : le tableau a la colonne En relecture, et elle seule.
    await openBoard([issue({ id: 'bdesk-1', title: 'Prêt à démarrer' }), issue({ id: 'bdesk-2', title: 'Relu', status: 'in_review' })]);
    expect(headings()).toContain('En relecture');
    expect(rule()).toContain('rattaché à un agent, en relecture ou un autre statut');
  });

  it('se suivent aux raccourcis h et l, comme les autres colonnes', async () => {
    const { user, router } = await openBoard(TICKETS, { path: '/p/bdesk/kanban?col=inProgress' });

    await user.keyboard('l');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inReview'));
    await user.keyboard('l');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inIntegration'));
    await user.keyboard('h');
    await waitFor(() => expect(router.state.location.search).toBe('?col=inReview'));
  });

  it('passent côte à côte à 7,7 rem par colonne : huit dès 61,6 rem, qui tiennent dans le panneau à 1 440 px', async () => {
    await openBoard(TICKETS);

    const grid = columns()[0]?.parentElement as HTMLElement;
    expect(grid.className).toContain('@min-[61.6rem]:grid-cols-8');
    expect(grid.className).not.toContain('@min-[60rem]');
  });
});

/**
 * Le tableau à huit colonnes, côte à côte dès 61,6 rem : des colonnes de 130,7 px au seuil, 132,75 px à 1 440 px. Ce rendu vérifie que chaque élément
 * porte les classes qui le gardent lisible (layout.test.ts mesure, mot par mot, que les textes y tiennent), et ce que les règles compilées de ses
 * classes et de celles de ses ancêtres disent du retour à la ligne : un libellé de colonne se coupe entre deux mots, jamais dans un mot ; un titre de
 * carte passe à la ligne, jamais tronqué ; une pastille aussi, entre deux mots ; rien n'interdit le retour à la ligne.
 */
describe('à huit colonnes, côte à côte', () => {
  /** Le seuil du tableau, nommé : chaque colonne y est elle-même un conteneur. */
  const WIDE = '@min-[61.6rem]/board';
  /** Une colonne de moins de 9,5 rem de contenu : la carte s'y allège. */
  const NARROW = '@max-[9.5rem]/column';
  /** Les classes de la carte d'avant, telles quelles : celles d'une carte qui ne s'allège jamais. */
  const PLAIN_CARD = {
    item: 'relative flex scroll-mb-20 scroll-mt-28 flex-col gap-1.5 rounded-lg border border-line bg-panel px-2.5 py-2 shadow-panel transition-colors hover:border-line-strong has-[a[data-card-link]:focus-visible]:border-accent has-[a[data-card-link]:focus-visible]:ring-2 has-[a[data-card-link]:focus-visible]:ring-accent',
    title: 'wrap-anywhere text-ui text-ink',
    badges: 'flex min-w-0 flex-wrap items-center gap-1',
  };
  const CUTTING: Record<string, readonly string[]> = {
    'white-space': ['nowrap', 'pre'],
    'text-overflow': ['ellipsis', 'clip'],
    '-webkit-line-clamp': [],
    overflow: ['hidden', 'clip'],
  };

  /** Ce que les classes de l'élément et de ses ancêtres, jusqu'à la colonne, déclarent pour couper ou tronquer un texte. */
  async function cutsOf(element: Element, { inWord }: { inWord: boolean }): Promise<string[]> {
    const chain: Element[] = [];
    for (let at: Element | null = element; at && !at.hasAttribute('data-column-selector'); at = at.parentElement) {
      chain.push(at);
      if (at.tagName === 'SECTION') break;
    }
    const rules = await rulesFor(chain.flatMap(classesOf));
    const own = new Set(chain.flatMap(classesOf).map(selectorOf));
    const found: string[] = [];
    for (const rule of rules) {
      if (!own.has(rule.selector)) continue;
      for (const [property, value] of Object.entries(rule.declarations)) {
        const values = CUTTING[property];
        if (values && (values.length === 0 || values.includes(value))) found.push(`${rule.selector} ${property}: ${value}`);
        if (inWord && ((property === 'overflow-wrap' && value === 'anywhere') || (property === 'word-break' && value === 'break-all'))) {
          found.push(`${rule.selector} ${property}: ${value}`);
        }
      }
    }
    return found;
  }

  it.each(['fr', 'en'] as const)('en %s, chaque en-tête passe à la ligne entre deux mots, et chaque carte s’allège sans rien tronquer', async (language) => {
    await openBoard([...TICKETS, issue({ id: 'bdesk-7', title: 'Rattaché', status: 'hooked' }), issue({ id: 'bdesk-11', title: 'Reporté', status: 'deferred' })], {
      declared: ALL_HANDOFF,
      ...(language === 'en' ? { language } : {}),
    });

    expect(headings()).toHaveLength(8);
    for (const region of columns()) {
      const title = region.querySelector('h2') as HTMLElement;
      const row = title.parentElement as HTMLElement;
      // Une ligne de texte : pictogramme, libellé, compte (et la liste de Terminé), séparés d'espaces où elle passe à la ligne.
      expect(row.className).toContain(`${WIDE}:block`);
      expect(title.className, title.textContent ?? '').toContain(`${WIDE}:inline`);
      expect(row.querySelector('svg')?.getAttribute('class')).toContain(`${WIDE}:inline`);
      expect(title.nextSibling?.textContent).toBe(' ');
      if (region.dataset.column === 'done') expect(row.querySelector('label')?.previousSibling?.textContent).toBe(' ');
      expect(await cutsOf(title, { inWord: true }), title.textContent ?? '').toEqual([]);
      expect(await cutsOf(region.querySelector('header p') as HTMLElement, { inWord: true })).toEqual([]);
    }
    expect(headings()).toContain(language === 'en' ? 'Awaiting validation' : 'À valider');

    for (const item of document.querySelectorAll<HTMLElement>('section[data-column] li[data-card-id]')) {
      // La carte ne s'allège que dans une colonne étroite : le bloc qui suit l'en-tête, de la largeur de la colonne, est le conteneur qu'elle interroge.
      const body = item.closest('[data-column-body]') as HTMLElement;
      expect(body.className).toBe('@container/column');
      expect(body.parentElement?.tagName).toBe('SECTION');
      expect((body.parentElement as HTMLElement).className).not.toContain('@container');
      expect(item.className).toContain(`${NARROW}:px-1.5`);
      // Remontée au clavier, la carte s'arrête sous les en-têtes collants (layout.test.ts mesure la marge contre l'en-tête le plus haut).
      expect(item.className).toContain(`${WIDE}:scroll-mt-41`);
      expect((item.parentElement as HTMLElement).className).toContain(`${NARROW}:px-0.5`);
      // Le titre peut se couper en fin de ligne, d'un trait d'union, dans la langue de la page.
      expect(item.querySelector('p')?.className).toBe(`${PLAIN_CARD.title} ${NARROW}:hyphens-auto`);
      expect(document.documentElement.lang).toBe(language);
      // La priorité perd ses barres, et garde son code (P0 à P4) en clair ; son libellé reste pour les lecteurs d'écran.
      const priority = item.querySelector('[title]') as HTMLElement;
      expect(priority.querySelector('.tnum')?.getAttribute('class')).toBe('tnum');
      expect(priority.querySelector('.tnum')?.textContent).toMatch(/^P[0-4]$/);
      expect(priority.querySelector('svg')?.getAttribute('class')).toContain(`${NARROW}:hidden`);
      expect(priority.querySelector('.sr-only')?.textContent).not.toBe('');
      const link = item.querySelector('a[data-card-link]') as HTMLElement;
      expect(await cutsOf(link, { inWord: false }), link.textContent ?? '').toEqual([]);
    }
    // Les pastilles perdent leur pictogramme et passent à la ligne entre deux mots, jamais dans un mot.
    const agent = within(card('bdesk-7')).getByText('agent');
    const badges = agent.parentElement as HTMLElement;
    expect(badges.className).toBe(`${PLAIN_CARD.badges} ${NARROW}:[&>span]:shrink ${NARROW}:[&>span>svg]:hidden`);
    expect(await cutsOf(agent, { inWord: true })).toEqual([]);
    const pill = card('bdesk-6').querySelector('[data-card-status]') as HTMLElement;
    expect(pill.textContent).toBe(language === 'en' ? 'in review' : 'en relecture');
    expect(await cutsOf(pill, { inWord: false })).toEqual([]);
    // Témoin : le nom d'un bouton du sélecteur, qui ne passe jamais à la ligne, est bien vu.
    const label = selectorButtons()[0]?.querySelector('span') as HTMLElement;
    expect(await cutsOf(label, { inWord: false })).toEqual([expect.stringContaining('white-space: nowrap')]);
  });

  it('laisse au tiroir « En pause » ses cartes d’avant, jamais allégées', async () => {
    const { user } = await openBoard([...TICKETS, issue({ id: 'bdesk-11', title: 'Reporté', status: 'deferred', priority: 0 })], { declared: ALL_HANDOFF });

    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    const paused = card('bdesk-11');
    expect(paused.closest('section')).toBeNull();
    expect(paused.className).toBe(PLAIN_CARD.item);
    expect(paused.querySelector('p')?.className).toBe(PLAIN_CARD.title);
    expect(paused.outerHTML).not.toMatch(/@(min|max)-\[/);
    // La priorité garde ses barres (P0 : le carré plein) et son code.
    expect(paused.querySelector('[title] svg')?.getAttribute('class')).toBe('shrink-0');
    expect(paused.querySelector('[title] .tnum')?.textContent).toBe('P0');
  });

  it('garde dans la carte la pastille d’un statut d’un seul long mot, déclaré de travail ou inconnu, dans une colonne comme dans le tiroir', async () => {
    const LONG_WIP = 'verification_securite_par_le_comite_externe';
    const LONG_UNKNOWN = 'attente_du_fournisseur_externe_principal';
    const { user } = await openBoard(
      [...TICKETS, issue({ id: 'bdesk-12', title: 'Recette longue', status: LONG_WIP }), issue({ id: 'bdesk-13', title: 'Attend le fournisseur', status: LONG_UNKNOWN })],
      { declared: { ...ALL_HANDOFF, others: [{ name: LONG_WIP, category: 'wip' }] } },
    );
    await user.click(screen.getByRole('button', { name: /^En pause/ }));

    for (const [id, status] of [
      ['bdesk-12', LONG_WIP],
      ['bdesk-13', LONG_UNKNOWN],
    ] as const) {
      const item = card(id);
      const pill = item.querySelector('[data-card-status]') as HTMLElement;
      expect(pill.textContent).toBe(status);
      // La pastille est un enfant de la carte (une boîte flex en colonne) : 100 % y est la largeur de la carte.
      expect(pill.parentElement).toBe(item);
      // Alignée à gauche, elle prendrait la largeur du mot entier : seule une largeur maximale la retient, sans condition, et le mot s'y coupe.
      const own = (await rulesFor(classesOf(pill))).filter((rule) => rule.within.length === 0 && classesOf(pill).some((name) => rule.selector === selectorOf(name)));
      const declared = (property: string) => own.filter((rule) => property in rule.declarations).map((rule) => rule.declarations[property]);
      expect(declared('max-width'), id).toEqual(['100%']);
      expect(declared('align-self'), id).toEqual(['flex-start']);
      expect(declared('overflow-wrap'), id).toEqual(['break-word']);
      expect(declared('min-width'), id).toEqual([]);
      expect(declared('white-space'), id).toEqual([]);
    }
    // L'une dans sa colonne (En cours), l'autre dans le tiroir.
    expect(card('bdesk-12').closest('section')?.dataset.column).toBe('inProgress');
    expect(card('bdesk-13').closest('section')).toBeNull();
  });

  it('garde à cinq colonnes les en-têtes et les cartes d’avant', async () => {
    await openBoard(PLAIN);

    for (const region of columns()) {
      const title = region.querySelector('h2') as HTMLElement;
      expect(title.className).toBe('text-ui font-semibold text-ink');
      expect((title.parentElement as HTMLElement).className).toBe('flex min-h-6 min-w-0 items-center gap-2');
      // Pas d'espace entre les morceaux de l'en-tête : la boîte flex d'avant, telle quelle.
      expect([...(title.parentElement as HTMLElement).childNodes].filter((node) => node.nodeType === Node.TEXT_NODE)).toEqual([]);
    }
    for (const id of ['bdesk-1', 'bdesk-7']) {
      expect(card(id).className).toBe(PLAIN_CARD.item);
      expect(card(id).querySelector('p')?.className).toBe(PLAIN_CARD.title);
      expect(card(id).outerHTML).not.toMatch(/@(min|max)-\[/);
      expect(card(id).querySelector('[title] svg')?.getAttribute('class')).toBe('shrink-0');
    }
    // Ni conteneur dans la colonne, ni bloc autour de la liste : le DOM d'avant.
    for (const region of columns()) {
      expect(region.className).not.toContain('@container');
      expect(region.querySelector('[data-column-body]')).toBeNull();
    }
  });
});

/**
 * Le sélecteur de plus de cinq colonnes défile en lui-même : il ramène à la vue le bouton de la colonne affichée, avec de chaque côté la place de son
 * anneau de focus (le remplissage de la rangée), et le fait encore quand la rangée change de largeur. jsdom ne met rien en page : le test donne aux
 * boutons et à la rangée les mesures que le navigateur leur donnerait, et dit à la page quand la rangée change de largeur (`installFakeResizeObserver`).
 */
describe('le sélecteur de plus de cinq colonnes, qui défile', () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  /**
   * Des boutons de 100 px séparés de 2,25 px, dans une rangée de 300 px de large au remplissage de 4,5 px ; son défilement, retenu. `resize` : la
   * rangée prend une autre largeur, avant que le navigateur ne le dise à la page (`emit`).
   */
  function measure(group: HTMLElement) {
    let scrollLeft = 0;
    let width = 300;
    Object.defineProperty(group, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (value: number) => (scrollLeft = value) });
    Object.defineProperty(group, 'clientWidth', { configurable: true, get: () => width });
    group.style.paddingLeft = '4.5px';
    within(group)
      .getAllByRole('button')
      .forEach((button, index) => {
        Object.defineProperty(button, 'offsetLeft', { configurable: true, get: () => 4.5 + index * 102.25 });
        Object.defineProperty(button, 'offsetWidth', { configurable: true, get: () => 100 });
      });
    return { scrollLeft: () => scrollLeft, resize: (next: number) => (width = next) };
  }

  it('ramène le bouton de la colonne affichée à la vue quand la rangée change de largeur, et garde la place de l’anneau de focus', async () => {
    const resize = installFakeResizeObserver();
    const { user } = await openBoard(TICKETS, { declared: ALL_HANDOFF, path: '/p/bdesk/kanban?col=awaitingHuman' });
    const group = screen.getByRole('group', { name: 'Colonne affichée' });
    expect(resize.observed()).toContain(group);
    const row = measure(group);

    // La rangée change de largeur : le bouton À valider (le sixième, de 515,75 à 615,75 px) vient au bord droit, 4,5 px avant lui.
    resize.emit(group, 54);
    expect(row.scrollLeft()).toBeCloseTo(615.75 + 4.5 - 300);

    // En relecture (de 311,25 à 411,25 px) est à gauche de la vue : il vient au bord gauche, 4,5 px après lui.
    await user.click(within(group).getByRole('button', { name: /^En relecture/ }));
    expect(row.scrollLeft()).toBeCloseTo(311.25 - 4.5);
  });

  it('ramène à la vue, quand la rangée change de largeur, le bouton qui a le focus plutôt que celui de la colonne affichée', async () => {
    const resize = installFakeResizeObserver();
    await openBoard(TICKETS, { declared: ALL_HANDOFF, path: '/p/bdesk/kanban?col=awaitingHuman' });
    const group = screen.getByRole('group', { name: 'Colonne affichée' });
    const row = measure(group);
    resize.emit(group, 54);
    expect(row.scrollLeft()).toBeCloseTo(320.25);

    // On parcourt la rangée au clavier : le focus est sur Backlog, le premier bouton, hors de la vue. La rangée change de largeur : il y revient.
    within(group).getByRole('button', { name: /^Backlog/ }).focus();
    row.resize(280);
    resize.emit(group, 54);
    expect(row.scrollLeft()).toBeCloseTo(0);
  });

  it('ne bouge pas la rangée quand le navigateur la signale sans qu’elle ait changé de largeur', async () => {
    const resize = installFakeResizeObserver();
    await openBoard(TICKETS, { declared: ALL_HANDOFF, path: '/p/bdesk/kanban?col=awaitingHuman' });
    const group = screen.getByRole('group', { name: 'Colonne affichée' });
    const row = measure(group);
    resize.emit(group, 54);
    expect(row.scrollLeft()).toBeCloseTo(320.25);

    within(group).getByRole('button', { name: /^Backlog/ }).focus();
    resize.emit(group, 54);
    expect(row.scrollLeft()).toBeCloseTo(320.25);
  });

  it('garde à la vue la colonne où mène l, même quand le focus est dans la rangée et que le navigateur prévient l’observateur à la prochaine image', async () => {
    const resize = installFakeResizeObserver({ initial: true });
    const { user } = await openBoard(TICKETS, { declared: ALL_HANDOFF, path: '/p/bdesk/kanban?col=awaitingHuman' });
    const group = screen.getByRole('group', { name: 'Colonne affichée' });
    const row = measure(group);
    // La première image : la rangée a sa largeur, le bouton d'À valider vient à la vue.
    resize.flushInitial();
    expect(row.scrollLeft()).toBeCloseTo(320.25);

    // Le focus est sur Backlog, dans la rangée ; l mène à Bloqué (le septième bouton, de 618 à 718 px) : il vient au bord droit.
    within(group).getByRole('button', { name: /^Backlog/ }).focus();
    await user.keyboard('l');
    await waitFor(() => expect(within(group).getByRole('button', { name: /^Bloqué/ }).getAttribute('aria-pressed')).toBe('true'));
    expect(row.scrollLeft()).toBeCloseTo(718 + 4.5 - 300);
    // L'image suivante. Dans le navigateur, elle vient avant que le focus ne quitte la rangée pour la première carte de Bloqué : le test le remet sur
    // Backlog pour garder cet ordre. Le navigateur prévient alors tout observateur qui vient de commencer à observer ; la rangée n'a pas changé de
    // largeur, rien ne défait le défilement vers Bloqué.
    within(group).getByRole('button', { name: /^Backlog/ }).focus();
    resize.flushInitial();
    expect(row.scrollLeft()).toBeCloseTo(718 + 4.5 - 300);
    expect(resize.observed().filter((node) => node === group)).toHaveLength(1);
  });

  it('cesse d’observer la rangée quand le tableau est démonté, sans observation en double quand la colonne change', async () => {
    const resize = installFakeResizeObserver();
    const { user, unmount } = await openBoard(TICKETS, { declared: ALL_HANDOFF });
    const group = screen.getByRole('group', { name: 'Colonne affichée' });
    const observing = () => resize.observed().filter((node) => node === group).length;
    expect(observing()).toBe(1);

    await user.click(within(group).getByRole('button', { name: /^Backlog/ }));
    expect(observing()).toBe(1);

    unmount();
    expect(observing()).toBe(0);
    expect(resize.active()).toBe(0);
  });
});

describe('la pastille de statut d’une carte : le statut que sa colonne ne dit pas', () => {
  it('dit le Statut de relais d’une carte en Bloqué, pour savoir à quelle étape elle est bloquée', async () => {
    await openBoard(TICKETS);

    expect(within(screen.getByRole('region', { name: 'Bloqué' })).getByText('en relecture')).toBeTruthy();
    expect(statusPill('bdesk-6')).toBe('en relecture');
  });

  it('ne dit rien d’une carte de relais dans sa propre colonne, ni d’une carte en cours en En cours', async () => {
    await openBoard(TICKETS);

    for (const id of ['bdesk-2', 'bdesk-3', 'bdesk-4', 'bdesk-5']) expect(statusPill(id), id).toBeNull();
  });

  it('dit un autre statut que le Projet déclare comme travail, en En cours comme en Bloqué', async () => {
    const issues = [
      ...PLAIN,
      issue({ id: 'bdesk-9', title: 'En recette', status: 'qa_testing' }),
      issue({ id: 'bdesk-10', title: 'Recette coincée', status: 'qa_testing', blockedBy: ['bdesk-1'] }),
    ];
    await openBoard(issues, { declared: WITH_QA });

    expect(within(screen.getByRole('region', { name: 'En cours' })).getByText('qa_testing')).toBeTruthy();
    expect(statusPill('bdesk-9')).toBe('qa_testing');
    expect(statusPill('bdesk-10')).toBe('qa_testing');
    expect(statusPill('bdesk-2')).toBeNull();
  });

  it('garde la pastille du tiroir « En pause »', async () => {
    const { user } = await openBoard([...PLAIN, issue({ id: 'bdesk-11', title: 'Reporté', status: 'deferred' })]);

    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    expect(statusPill('bdesk-11')).toBe('reporté');
  });
});

describe('en anglais', () => {
  it('nomme les colonnes de relais avec les termes de CONTEXT.md, chacune avec sa règle', async () => {
    await openBoard(TICKETS, { language: 'en' });

    expect(headings()).toEqual(['Backlog', 'Ready', 'In progress', 'In review', 'In integration', 'Awaiting validation', 'Blocked', 'Done']);
    const hint = (name: string, text: string) => within(screen.getByRole('region', { name })).getByText(text).getAttribute('title');
    expect(hint('In review', 'Agent reviewing, not Blocked')).toBe('Ticket that an agent reviewer is examining, with no pending dependency.');
    expect(hint('In integration', 'Merge requested, not Blocked')).toBe(
      'Ticket whose merge request is open, during its automated checks and external review, with no pending dependency.',
    );
    expect(hint('Awaiting validation', 'Waiting for you, not Blocked')).toBe(
      'Ticket waiting for you: a manual test, a decision or your go-ahead to merge, with no pending dependency.',
    );
    expect(statusPill('bdesk-6')).toBe('in review');
  });
});
