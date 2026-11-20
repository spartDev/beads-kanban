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
  const WIDE = '@min-[61.6rem]';
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
      expect(item.className).toContain(`${WIDE}:px-1.5`);
      expect((item.parentElement as HTMLElement).className).toContain(`${WIDE}:px-0.5`);
      // La priorité ne garde que ses barres ; son libellé reste pour les lecteurs d'écran.
      const priority = item.querySelector('[title]') as HTMLElement;
      expect(priority.querySelector('.tnum')?.getAttribute('class')).toContain(`${WIDE}:hidden`);
      expect(priority.querySelector('.sr-only')?.textContent).not.toBe('');
      const link = item.querySelector('a[data-card-link]') as HTMLElement;
      expect(await cutsOf(link, { inWord: false }), link.textContent ?? '').toEqual([]);
    }
    // Les pastilles perdent leur pictogramme et passent à la ligne entre deux mots, jamais dans un mot.
    const agent = within(card('bdesk-7')).getByText('agent');
    const badges = agent.parentElement as HTMLElement;
    expect(badges.className).toContain(`${WIDE}:[&>span>svg]:hidden`);
    expect(badges.className).toContain(`${WIDE}:[&>span]:shrink`);
    expect(await cutsOf(agent, { inWord: true })).toEqual([]);
    const pill = card('bdesk-6').querySelector('[data-card-status]') as HTMLElement;
    expect(pill.textContent).toBe(language === 'en' ? 'in review' : 'en relecture');
    expect(await cutsOf(pill, { inWord: false })).toEqual([]);
    // Un statut inconnu d'un seul long mot se coupe plutôt que de déborder de la carte.
    expect((await rulesFor(classesOf(pill))).some((rule) => rule.declarations['overflow-wrap'] === 'break-word')).toBe(true);
    // Témoin : le nom d'un bouton du sélecteur, qui ne passe jamais à la ligne, est bien vu.
    const label = selectorButtons()[0]?.querySelector('span') as HTMLElement;
    expect(await cutsOf(label, { inWord: false })).toEqual([expect.stringContaining('white-space: nowrap')]);
  });

  it('laisse au tiroir « En pause » ses cartes sur toute la largeur, sans les marges resserrées', async () => {
    const { user } = await openBoard([...TICKETS, issue({ id: 'bdesk-11', title: 'Reporté', status: 'deferred' })], { declared: ALL_HANDOFF });

    await user.click(screen.getByRole('button', { name: /^En pause/ }));
    expect(card('bdesk-11').className).not.toContain(`${WIDE}:`);
    expect(card('bdesk-11').innerHTML).not.toContain(`${WIDE}:`);
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
      expect(card(id).className).not.toMatch(/@min-\[[\d.]+rem\]:px-/);
      expect(card(id).innerHTML).not.toMatch(/@min-\[[\d.]+rem\]:/);
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

  /** Des boutons de 100 px séparés de 2,25 px, dans une rangée de 300 px de large au remplissage de 4,5 px ; son défilement, retenu. */
  function measure(group: HTMLElement) {
    let scrollLeft = 0;
    Object.defineProperty(group, 'scrollLeft', { configurable: true, get: () => scrollLeft, set: (value: number) => (scrollLeft = value) });
    Object.defineProperty(group, 'clientWidth', { configurable: true, get: () => 300 });
    group.style.paddingLeft = '4.5px';
    within(group)
      .getAllByRole('button')
      .forEach((button, index) => {
        Object.defineProperty(button, 'offsetLeft', { configurable: true, get: () => 4.5 + index * 102.25 });
        Object.defineProperty(button, 'offsetWidth', { configurable: true, get: () => 100 });
      });
    return { scrollLeft: () => scrollLeft };
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
