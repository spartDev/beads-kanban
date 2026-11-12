import { fireEvent, render, screen, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue, IssueChronology, IssueDetail, IssueRef } from '../data/types';
import { AgePanel } from '../metrics/AgeChart';
import { CycleTimePanel } from '../metrics/CycleTimeChart';
import { ReadyAgePanel } from '../metrics/ReadyAgeChart';
import { healthFixture, metricsFixture, stubChartWidth } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { chronology, issue, issueDetail, projectsResponse } from '../test/fixtures';
import { classesOf, declared, FLEX_SHRINK, flexShrinkOf, lengthOf, ownRules, rulesFor, seenBy, selectorOf } from '../test/compiledCss';
import { declaredOf, faultsOf } from '../test/idLayout';
import { renderApp, stubApi } from '../test/render';

/**
 * Les identifiants de ticket de plus de 100 caractères ne débordent d'aucun conteneur (bdesk-38k.90). Le préfixe des tickets est celui de la base, que rien ne borne : bd y met le nom du dossier du Projet, et un identifiant fait
 * jusqu'à 255 caractères (`varchar(255)`). Un tel identifiant peut n'avoir ni espace ni tiret où passer à la ligne : à 152 caractères il fait 1 090 px, et dans le panneau d'un ticket (670 px), sur la page d'une Epic ou dans la liste des Epics, ses `<span>` qui
 * ne rétrécissaient pas poussaient le contenu du conteneur à défiler d'un côté (1 104 px de contenu pour 670, 2 078 pour 1 030 sur la page d'une Epic) : le défilement horizontal n'est pas dans le document, que le shell rogne (`overflow-x-clip`), mais dans
 * le corps du panneau et dans `<main>`.
 *
 * jsdom ne met rien en page : ce test lit, pour chaque endroit où l'identifiant s'écrit, ce que les classes de l'élément et de ses ancêtres déclarent dans la feuille de style de l'application, compilée par Tailwind (test/idLayout.ts, qui dit ce qu'il lit
 * et ce qu'il ne voit pas), à 375 et à 1280 px. Ce que Chromium en fait (que plus aucun conteneur ne défile, la largeur de chaque conteneur, les captures) se mesure en navigateur : voir la preuve de bdesk-38k.90.
 *
 * Les endroits qui coupaient déjà l'identifiant (l'en-tête du panneau, la carte du kanban, les phrases « Bloqué : attend… » et « Doublon de… ») sont lus aussi : le contrat est le même partout, et il tient à quelques classes qu'une retouche voisine
 * peut ôter sans le voir.
 *
 * Ce que la lecture exige d'une ligne qui range l'identifiant dans une boîte flex (test/idLayout.ts) : qu'il rétrécisse, ou qu'il soit plafonné à la largeur de la ligne ET que la boîte passe à la ligne (`flex-wrap` : sans cela ses voisins prennent la place
 * que le plafond lui laisse) ; et qu'une largeur maximale s'applique à une boîte (le lien du tableau de données est une boîte flex : sur un élément en ligne, `max-width` ne fait rien). Chacune de ces deux règles a son mutant (`flex-wrap` ôté, `flex flex-col` ôté).
 *
 * Le fil d'Ariane tronque l'identifiant par une ellipse et le dit en infobulle (le panneau de ticket, au-dessus de lui, l'écrit en entier). La palette, elle, l'écrit en entier dans la ligne, coupé là où il le faut : la ligne grandit avec lui et ne change jamais de taille avec la
 * sélection, le survol ou la dernière touche (une ligne qui bouge entre un appui et son clic envoie le clic sur une autre ligne : palette/CommandPalette.rows.test.tsx).
 */

withAsyncTimeout(5_000);
afterEach(() => vi.restoreAllMocks());

/** 375 px : un téléphone (le panneau prend l'écran) ; 1280 px : le bureau (le panneau fait 42 rem, la page d'une Epic 4xl). */
const VIEWPORTS = [375, 1280];

/** Un préfixe sans aucune occasion de coupure, de 149 caractères : avec « -xx », des identifiants de 152 caractères, comme à la revue de bdesk-38k.88. */
const STEM = Array.from({ length: 38 }, (_, index) => `k${String(index + 1).padStart(3, '0')}`)
  .join('')
  .slice(0, 149);
const id = (tag: string) => `${STEM}-${tag}`;

const title = (tag: string) => `Ticket ${tag}`;
const ref = (tag: string, overrides: Partial<IssueRef> = {}): IssueRef => ({ id: id(tag), title: title(tag), type: 'task', status: 'open', priority: 2, ...overrides });

const EPIC = issue({ id: id('e1'), title: 'Une Epic au long identifiant', type: 'epic', priority: 1 });
const CLOSED_EPIC = issue({ id: id('e3'), title: 'Une Epic terminée', type: 'epic', status: 'closed', closedAt: '2026-10-09T09:00:00Z' });
const NESTED = issue({ id: id('e2'), title: 'Une Epic imbriquée', type: 'epic', parentId: EPIC.id });
const CHILDREN: Issue[] = [
  issue({ id: id('c1'), title: title('c1'), status: 'in_progress', parentId: EPIC.id, assignee: 'tom' }),
  issue({ id: id('c2'), title: title('c2'), parentId: EPIC.id }),
  issue({ id: id('c3'), title: title('c3'), status: 'in_progress', parentId: EPIC.id, blockedBy: [id('c1'), id('c2'), id('c4')] }),
  issue({ id: id('c4'), title: title('c4'), status: 'closed', parentId: EPIC.id, closedAt: '2026-10-09T09:00:00Z' }),
  issue({ id: id('n1'), title: title('n1'), parentId: NESTED.id }),
];
const ISSUES: Issue[] = [EPIC, NESTED, CLOSED_EPIC, ...CHILDREN, issue({ id: id('k1'), title: title('k1'), parentId: id('c3') }), issue({ id: id('c5'), title: title('c5') })];

/** Ce que les vérifications ont trouvé, par endroit : vide quand chaque identifiant se coupe et tient dans sa ligne. */
type Faults = Record<string, string[]>;
const found = (faults: Faults): Faults => Object.fromEntries(Object.entries(faults).filter(([, list]) => list.length > 0));

/** L'élément qui écrit `text` seul (l'identifiant) dans `scope` ; il y en a un, ou le test échoue. */
const textOf = (scope: ReturnType<typeof within>, text: string) => scope.getByText(text);

/** Le panneau du ticket `detail`, ouvert par son adresse, sur le kanban d'un Projet dont les tickets sont `ISSUES`. */
async function openPanel(detail: IssueDetail, chronologies: Record<string, IssueChronology> = {}) {
  stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES }, details: { [`bdesk/${detail.id}`]: detail }, chronologies });
  renderApp(`/p/bdesk/t/${detail.id}`);
  return within(await screen.findByRole('dialog', { name: new RegExp(detail.title) }));
}

/** La fiche d'un ticket à relations de chaque genre : un parent, un Enfant, ce qui le bloque, ce qu'il bloque, ce qui lui est lié, et un ticket hors du Projet. */
const RELATED: IssueDetail = issueDetail({
  id: id('c3'),
  title: title('c3'),
  parentId: id('e1'),
  blockedBy: [id('c2')],
  dependencies: [
    { to: id('e1'), type: 'parent-child' },
    { to: id('c2'), type: 'blocks' },
    { to: id('zz'), type: 'relates-to' },
  ],
  dependents: [
    { from: id('c4'), type: 'blocks' },
    { from: id('k1'), type: 'parent-child' },
    { from: id('c5'), type: 'relates-to' },
  ],
  linked: { [id('e1')]: ref('e1', { type: 'epic' }), [id('c2')]: ref('c2'), [id('c4')]: ref('c4'), [id('k1')]: ref('k1'), [id('c5')]: ref('c5') },
  epic: { id: id('e1'), title: EPIC.title },
});

describe('le panneau d’un ticket : les identifiants longs des relations', () => {
  // Chaque genre de relation, et l'identifiant qu'il écrit : un lien (titre, statut) ou, hors du Projet, un simple texte.
  const RELATIONS: [group: string, tags: string[]][] = [
    ['Parent', ['e1']],
    ['Enfants', ['k1']],
    ['Bloqué par', ['c2']],
    ['Bloque', ['c4']],
    ['Lié à', ['c5', 'zz']],
  ];

  it.each(VIEWPORTS)('à %i px, chaque identifiant se coupe et tient dans sa ligne', async (viewport) => {
    const panel = await openPanel(RELATED);

    const faults: Faults = {};
    for (const [group, tags] of RELATIONS) {
      for (const tag of tags) {
        const element = textOf(within(panel.getByRole('list', { name: group })), id(tag));
        faults[`${group} : ${tag}`] = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });
      }
    }

    expect(found(faults)).toEqual({});
  });
});

describe('le panneau d’un ticket : l’en-tête', () => {
  const PARENT = issueDetail({
    id: id('c6'),
    title: title('c6'),
    status: 'in_progress',
    parentId: id('c2'),
    blockedBy: [id('c1'), id('c2')],
    linked: { [id('c2')]: ref('c2'), [id('c1')]: ref('c1') },
  });
  const ABANDONED = issueDetail({ id: id('c5'), title: title('c5'), status: 'closed', closedAt: '2026-10-09T09:00:00Z', abandon: { cause: 'duplicate', of: id('c2') }, linked: { [id('c2')]: ref('c2') } });
  const ABROAD = issueDetail({ id: id('cb'), title: title('cb'), status: 'closed', closedAt: '2026-10-09T09:00:00Z', abandon: { cause: 'superseded', of: id('zz') } });

  it.each(VIEWPORTS)('à %i px, son propre identifiant se coupe', async (viewport) => {
    const panel = await openPanel(PARENT);

    const element = panel.getByText(id('c6'), { selector: 'p' });

    expect(await faultsOf(element, { within: element.closest('header') as HTMLElement, viewport })).toEqual([]);
  });

  it.each(VIEWPORTS)('à %i px, ceux du Parent et des tickets qui le bloquent se coupent', async (viewport) => {
    const panel = await openPanel(PARENT);

    const faults: Faults = {};
    const blocking = panel.getByText(/^Bloqué : attend/);
    for (const [place, element] of [
      ['Parent', panel.getByText(id('c2'), { selector: 'span.font-mono' })],
      ['bloqué par c1', within(blocking).getByRole('link', { name: id('c1') })],
      ['bloqué par c2', within(blocking).getByRole('link', { name: id('c2') })],
    ] as const) {
      faults[place] = await faultsOf(element, { within: element.closest('dl, p') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });

  it.each(VIEWPORTS.flatMap((viewport) => [[viewport, 'dans le Projet', ABANDONED, 'c2'] as const, [viewport, 'hors du Projet', ABROAD, 'zz'] as const]))(
    'à %i px, celui du ticket dont il est le doublon, %s, se coupe',
    async (viewport, _place, detail, tag) => {
      const panel = await openPanel(detail);
      const sentence = panel.getByText(/Fermé sans être une Livraison/);

      const element = within(sentence).getByText(id(tag));

      expect(await faultsOf(element, { within: sentence.closest('p') as HTMLElement, viewport })).toEqual([]);
    },
  );
});

describe('le panneau d’un ticket : la chronologie nomme les tickets qui le bloquent', () => {
  const BLOCKED = chronology({
    transitions: [
      { status: 'open', at: '2026-10-01T09:00:00.000Z', duration: 86_400_000 },
      { status: 'in_progress', at: '2026-10-02T09:00:00.000Z', duration: null },
    ],
    blockages: [
      {
        from: '2026-10-03T09:00:00.000Z',
        to: null,
        blockedBy: [id('c1'), id('c2')],
        statusBlocked: false,
        phases: [{ kind: 'work', from: '2026-10-03T09:00:00.000Z', to: null }],
      },
    ],
  });

  it.each(VIEWPORTS)('à %i px, chaque identifiant du Blocage se coupe', async (viewport) => {
    const panel = await openPanel(issueDetail({ id: id('c3'), title: title('c3'), status: 'in_progress', blockedBy: [id('c1'), id('c2')] }), { [`bdesk/${id('c3')}`]: BLOCKED });
    const blockage = within(await panel.findByRole('list', { name: 'Blocages' }));

    const faults: Faults = {};
    for (const tag of ['c1', 'c2']) {
      const link = blockage.getByRole('link', { name: id(tag) });
      faults[`attend ${tag}`] = await faultsOf(link, { within: link.closest('li') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });
});

describe('la liste des Epics : l’identifiant de chaque Epic', () => {
  it.each(VIEWPORTS)('à %i px, se coupe et tient dans la ligne de l’Epic, ouverte ou fermée', async (viewport) => {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    renderApp('/p/bdesk/epics');
    const open = within(await screen.findByRole('list', { name: 'Epics ouvertes' }));
    const closed = within(screen.getByRole('list', { name: 'Epics fermées' }));

    const faults: Faults = {};
    for (const [scope, tag] of [[open, 'e1'], [open, 'e2'], [closed, 'e3']] as const) {
      const element = textOf(scope, id(tag));
      faults[`Epic ${tag}`] = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });
});

describe.each([
  ['par colonne', '/p/bdesk/epics?epic='],
  ['en arbre', '/p/bdesk/epics?view=tree&epic='],
])('la page d’une Epic, Enfants %s', (_view, address) => {
  const open = async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    renderApp(`${address}${id('e1')}`);
    await screen.findByRole('heading', { level: 1, name: EPIC.title });
  };

  /** La ligne d'un Enfant : son lien, le seul de la page dont le nom cite son titre et son identifiant. */
  const rowOf = (tag: string) => screen.getAllByText(id(tag)).find((element) => element.closest('li') !== null) as HTMLElement;

  it.each(VIEWPORTS)('à %i px, l’identifiant de chaque Enfant se coupe et tient dans sa ligne', async (viewport) => {
    await open();

    const faults: Faults = {};
    for (const tag of ['c1', 'c2', 'c3', 'c4', 'e2']) {
      const element = rowOf(tag);
      faults[`Enfant ${tag}`] = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });

  it.each(VIEWPORTS)('à %i px, ce qui retient un Enfant (« Attend … ») cite des identifiants qui se coupent et tiennent dans sa ligne', async (viewport) => {
    await open();
    const element = screen.getByText((_content, node) => node?.tagName === 'SPAN' && /^Attend /.test(node.textContent ?? '') && node.children.length === 0);

    const faults = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });

    expect(element.textContent).toContain(id('c1'));
    expect(faults).toEqual([]);
  });
});

describe('la page d’une Epic : son propre identifiant', () => {
  it.each(VIEWPORTS)('à %i px, se coupe sous le titre', async (viewport) => {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    renderApp(`/p/bdesk/epics?epic=${id('e1')}`);
    await screen.findByRole('heading', { level: 1, name: EPIC.title });

    const element = screen.getByText(id('e1'), { selector: 'dd' });

    expect(await faultsOf(element, { within: element.closest('dl') as HTMLElement, viewport })).toEqual([]);
  });
});

describe('le kanban : les identifiants d’une carte', () => {
  it.each(VIEWPORTS)('à %i px, le sien et ceux qui la retiennent se coupent et tiennent dans la carte', async (viewport) => {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    renderApp('/p/bdesk/kanban');
    const card = within((await screen.findByRole('link', { name: title('c3') })).closest('li') as HTMLElement);

    const faults: Faults = {};
    const reason = card.getByText(/^Attend/);
    for (const [place, element] of [['son identifiant', card.getByText(id('c3'))], ['le premier qui la retient', within(reason).getByText(id('c1'))]] as const) {
      faults[place] = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });
});

describe('la page Métriques : l’identifiant d’un ticket dans l’infobulle et dans les tableaux de données', () => {
  beforeEach(() => stubChartWidth(640));

  const POINT = { ...metricsFixture().cycleTimeScatter[0]!, id: id('c4'), title: title('c4') };
  const READY = { ...healthFixture().readyAges.tickets[0]!, id: id('c4'), title: title('c4') };

  const renderCycleTime = () => {
    const data = metricsFixture();
    return render(
      <MemoryRouter>
        <CycleTimePanel
          points={[POINT]}
          span={{ from: data.period.from, days: data.period.days, start: Date.parse(data.period.start), end: Date.parse(data.asOf) }}
          dimension="type"
          ctx={{ projectName: (project) => project, projectHue: () => 120 }}
          projectOrder={['bdesk']}
          timeZone={data.timeZone}
          median={data.tiles.cycleTime.median}
          p85={data.tiles.cycleTime.p85}
          showProject={false}
        />
      </MemoryRouter>,
    );
  };

  it.each(VIEWPORTS)('à %i px, l’infobulle du Cycle Time coupe l’identifiant du ticket désigné', async (viewport) => {
    const { container } = renderCycleTime();
    const dot = container.querySelector('[data-dot]') as SVGCircleElement;

    fireEvent.pointerMove(container.querySelector('[data-chart-hit]') as SVGRectElement, { clientX: Number(dot.getAttribute('cx')), clientY: Number(dot.getAttribute('cy')), pointerType: 'mouse' });
    const tooltip = container.querySelector('[data-chart-tooltip]') as HTMLElement;
    const element = within(tooltip).getByText(id('c4'));

    expect(await faultsOf(element, { within: tooltip, viewport })).toEqual([]);
  });

  // Les listes des tickets en cours et des Prêts coupaient déjà l'identifiant : le contrat est gardé.
  it.each(VIEWPORTS)('à %i px, les listes des tickets en cours et des Prêts coupent l’identifiant', async (viewport) => {
    const data = metricsFixture();
    const ctx = { projectName: (project: string) => project, projectHue: () => 120 };
    render(
      <MemoryRouter>
        <AgePanel tickets={[{ ...data.inProgress[0]!, id: id('c1') }]} dimension="type" ctx={ctx} projectOrder={['bdesk']} median={data.tiles.cycleTime.median} p85={data.tiles.cycleTime.p85} showProject={false} />
        <ReadyAgePanel ages={{ ...healthFixture().readyAges, tickets: [READY] }} dimension="type" ctx={ctx} projectOrder={['bdesk']} showProject={false} timeZone="Europe/Paris" moment="à 20:00" />
      </MemoryRouter>,
    );

    const faults: Faults = {};
    for (const [place, list, tag] of [
      ['en cours', 'Tickets en cours, du plus ancien au plus récent', 'c1'],
      ['Prêts', 'Prêts, du plus ancien au plus récent', 'c4'],
    ] as const) {
      const element = within(screen.getByRole('list', { name: list })).getByText(id(tag));
      faults[place] = await faultsOf(element, { within: element.closest('li') as HTMLElement, viewport });
    }

    expect(found(faults)).toEqual({});
  });

  // Une cellule de tableau prend la largeur de son contenu : un identifiant de 152 caractères la fait de 1 090 px, et la région de données défile d'autant (1 309 px pour 546 avec des identifiants courts). L'identifiant y est donc plafonné à
  // 40 caractères, et coupé là où il dépasse. Il ne se coupe pas « n'importe où » (`anywhere`, `break-all`) : cela réduit la plus petite largeur du texte, donc celle de la colonne, et le tableau reprendrait la place sur les identifiants courts,
  // qui passeraient à la ligne (la mise en page d'un tableau d'identifiants courts ne doit pas bouger). `break-word` laisse sa plus petite largeur à un identifiant qui tient, et ne coupe que celui qui dépasse son plafond.
  it.each(VIEWPORTS)('à %i px, le tableau du Cycle Time plafonne et coupe l’identifiant, sans toucher à la largeur d’un identifiant court', async (viewport) => {
    const { container } = renderCycleTime();
    const element = within(container.querySelector('table') as HTMLElement).getByText(id('c4'), { selector: 'span' });

    const cap = await declaredOf(element, 'max-width', viewport);

    expect(cap ?? 'aucun plafond', 'plafond de largeur').toMatch(/^\d+ch$/);
    expect(Number.parseInt(cap ?? '', 10)).toBeLessThanOrEqual(40);
    expect(await faultsOf(element, { within: element.closest('tr') as HTMLElement, viewport })).toEqual([]);
    expect(await declaredOf(element, 'overflow-wrap', viewport), 'coupure').toBe('break-word');
  });

  it.each(VIEWPORTS)('à %i px, le tableau des Prêts plafonne et coupe l’identifiant de même', async (viewport) => {
    const data = healthFixture().readyAges;
    render(
      <MemoryRouter>
        <ReadyAgePanel
          ages={{ ...data, tickets: [READY] }}
          dimension="type"
          ctx={{ projectName: (project) => project, projectHue: () => 120 }}
          projectOrder={['bdesk']}
          showProject={false}
          timeZone="Europe/Paris"
          moment="à 20:00"
        />
      </MemoryRouter>,
    );
    const element = within(screen.getByRole('table', { hidden: true })).getByText(id('c4'), { selector: 'span' });

    const cap = await declaredOf(element, 'max-width', viewport);

    expect(cap ?? 'aucun plafond', 'plafond de largeur').toMatch(/^\d+ch$/);
    expect(Number.parseInt(cap ?? '', 10)).toBeLessThanOrEqual(40);
    expect(await faultsOf(element, { within: element.closest('tr') as HTMLElement, viewport })).toEqual([]);
    expect(await declaredOf(element, 'overflow-wrap', viewport), 'coupure').toBe('break-word');
  });
});

describe('les identifiants que la mise en page tronque (ellipse) disent leur texte entier', () => {
  // Au bureau, le fil d'Ariane n'est là que quand le panneau d'un ticket est ouvert : le panneau (42 rem, collé à droite, au-dessus de la barre) en recouvre la droite, et son en-tête écrit l'identifiant entier, coupé où il le faut (G4 de la preuve de
  // bdesk-38k.90). Le nom de la page n'est pas un arrêt de tabulation (`aria-current`, pas un lien) : il n'y a pas de focus où le déplier, et le texte entier est dans son nom accessible. Reste la souris : `title`.
  it('le fil d’Ariane, au bureau, quand le panneau d’un ticket est ouvert : en infobulle, et en entier dans l’en-tête du panneau', async () => {
    const panel = await openPanel(RELATED);

    const crumb = within(screen.getByRole('navigation', { name: "Fil d'Ariane" })).getByText(id('c3'));
    const header = panel.getByText(id('c3'), { selector: 'p' });

    expect(crumb.getAttribute('title')).toBe(id('c3'));
    expect(crumb.textContent).toBe(id('c3'));
    expect(header.textContent).toBe(id('c3'));
    expect(await faultsOf(header, { within: header.closest('header') as HTMLElement, viewport: 1280 })).toEqual([]);
  });

  async function openPalette() {
    stubApi({ projects: projectsResponse, issues: { bdesk: ISSUES } });
    const { user } = renderApp('/p/bdesk/kanban');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await user.keyboard('{Control>}k{/Control}');
    const dialog = within(await screen.findByRole('dialog', { name: 'Palette de commandes' }));
    await user.keyboard(STEM.slice(0, 12));
    return { user, dialog };
  }

  // La palette n'a pas de focus sur ses lignes (il reste dans le champ) : un identifiant tronqué par une ellipse n'y serait entier qu'en `title`, que ni le clavier ni le doigt n'atteignent. Elle l'écrit donc en entier dans la ligne, coupé là où il le faut, et la ligne
  // grandit avec lui. Elle ne change jamais de taille avec la sélection, le survol ou la dernière touche : une ligne qui s'ouvrait à la sélection pour y montrer l'identifiant entier (essayé dans bdesk-38k.90) bougeait sous un pointeur ou un doigt immobile, et le clic tombait sur une autre ligne
  // (palette/CommandPalette.rows.test.tsx garde cela). jsdom ne met rien en page : on lit les règles que Tailwind écrit pour les classes de l'identifiant et de la ligne.
  describe('la palette : l’identifiant d’une ligne est écrit en entier, et la ligne grandit avec lui', () => {
    const ROOT = 16;
    const identifierOf = async (tag: string) => {
      const { dialog } = await openPalette();
      const span = await dialog.findByText(id(tag));
      const row = span.closest('[cmdk-item]') as HTMLElement;
      const rules = await rulesFor(classesOf(span));
      const own = classesOf(span).map(selectorOf);
      return { dialog, span, row, rules, /** Ce que ses classes posent seules : au repos, au survol, au toucher. */ alone: rules.filter((rule) => own.includes(rule.selector)) };
    };
    const KINDS = [['un ticket', 'c1'], ['une Epic', 'e1']] as const;

    it.each(KINDS)('%s : le texte entier est dans la ligne, une seule fois pour un lecteur d’écran, sans infobulle qui le répète', async (_name, tag) => {
      const { dialog, span, row } = await identifierOf(tag);

      expect(span.textContent).toBe(id(tag));
      expect(row.textContent?.split(id(tag)).length, 'le texte de la ligne cite l’identifiant une fois').toBe(2);
      expect(dialog.getAllByRole('option', { name: new RegExp(id(tag)) }), 'une ligne, nommée par son texte').toHaveLength(1);
      expect([...row.querySelectorAll('[title], [aria-label], [aria-description]')].filter((element) => ['title', 'aria-label', 'aria-description'].some((attribute) => element.getAttribute(attribute)?.includes(id(tag)))), 'rien ne le répète en infobulle ni en nom').toEqual([]);
    });

    it.each(VIEWPORTS.flatMap((viewport) => KINDS.map(([name, tag]) => [viewport, name, tag] as const)))('à %i px, %s : coupé n’importe où, ni tronqué ni rogné, plafonné à la moitié de la ligne au plus, et sans rétrécir', async (viewport, _name, tag) => {
      const { span, rules, alone } = await identifierOf(tag);

      expect(['white-space', 'overflow', 'text-overflow'].map((property) => declared(alone, [property], viewport)), 'rien ne le tronque ni ne le rogne').toEqual([undefined, undefined, undefined]);
      expect(declared(alone, ['overflow-wrap'], viewport), 'coupé là où il le faut').toBe('anywhere');
      const cap = /^(\d+(?:\.\d+)?)%$/.exec(declared(alone, ['max-width'], viewport) ?? '');
      expect(cap, 'plafonné en pourcentage de la ligne : le titre garde sa place').not.toBeNull();
      expect(Number(cap?.[1])).toBeLessThanOrEqual(50);
      // Sa largeur ne dépend pas de ses voisins (l'icône « Entrée » n'est là que sur la ligne sélectionnée) : le texte ne passe pas à la ligne ailleurs selon la sélection.
      expect(flexShrinkOf(seenBy(rules, span, [span]), ownRules(rules, span, ['flex', FLEX_SHRINK]), viewport), 'il garde sa largeur, quelle que soit la place que prennent ses voisins').toBe(0);
    });

    // L'identifiant d'une ligne qui n'a rien à couper ne change pas sa hauteur : sa ligne de texte et ses marges tiennent dans les 36 px de la ligne.
    it.each(KINDS)('%s : une ligne dont l’identifiant tient sur une ligne garde ses 36 px', async (_name, tag) => {
      const { span, row, rules, alone } = await identifierOf(tag);
      const sheet = seenBy(rules, span, [span]);
      const fontSize = lengthOf(sheet, declared(alone, ['font-size'], 375) as string, ROOT);
      const line = lengthOf(sheet, declared(alone, ['line-height'], 375) as string, ROOT, () => fontSize);
      const margin = lengthOf(sheet, declared(alone, ['margin-block'], 375) ?? '0px', ROOT);
      const rowRules = await rulesFor(classesOf(row));
      const rowMinimum = lengthOf(rowRules, declared(ownRules(rowRules, row, ['min-height', 'height']), ['min-height'], 375) as string, ROOT);

      expect(declared(ownRules(rowRules, row, ['min-height', 'height']), ['height'], 375), 'hauteur fixe de la ligne : elle ne grandirait pas').toBeUndefined();
      expect(rowMinimum).toBe(36);
      expect(line + 2 * margin, 'hauteur de l’identifiant sur une ligne, marges comprises').toBeLessThanOrEqual(rowMinimum);
    });

    it('la ligne grandit avec l’identifiant : `min-height`, non `height`, et rien ne rogne son contenu', async () => {
      const { row } = await identifierOf('c1');

      expect(classesOf(row)).toContain('min-h-9');
      expect(classesOf(row)).not.toContain('h-9');
      expect(classesOf(row)).not.toContain('overflow-hidden');
    });
  });
});
