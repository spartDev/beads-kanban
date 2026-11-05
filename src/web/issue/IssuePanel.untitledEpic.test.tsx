import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Une Epic sans titre (bdesk-38k.39). Le titre d'un ticket peut être vide ou ne faire que d'espaces (une base modifiée à la main) : là où
 * l'interface nomme l'Epic, elle ne dit pas « Epic : » sans rien derrière, ni une infobulle aux guillemets vides, elle la nomme par son
 * identifiant. La règle est une seule (`epicName`, `epicShortName`) : la pastille de la carte, le lien Parent du panneau, le lien « Page Epic »
 * et son infobulle, le titre et l'onglet de la page de l'Epic, la barre d'avancement de la liste des Epics la suivent tous.
 *
 * Et là où l'interface titre un ticket qui n'a pas de titre, elle n'écrit pas de titre vide (axe `empty-heading`) : la page d'une Epic le titre de son
 * identifiant (sa règle), le panneau d'un ticket, quel qu'il soit, « Sans titre » (son identifiant est déjà juste au-dessus, et le dialogue, nommé par
 * l'identifiant puis le titre, ne le dirait pas deux fois).
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/** L'espace insécable que la typographie française met à l'intérieur des guillemets : le nom ne s'y coupe pas de ses guillemets. */
const NBSP = '\u00a0';
const EPIC = 'bdesk-vide';
/** Ce que le panneau écrit à la place du titre d'un ticket qui n'en a pas. */
const UNTITLED = 'Sans titre';

/** Le tooltip du lien « Page Epic » : il dit ce que la page montre, puis nomme l'Epic entre guillemets. */
const tooltip = (name: string) => `Avancement, Enfants, Lead Time et prévision de l’Epic «${NBSP}${name}${NBSP}»`;

/**
 *   bdesk-vide (Epic, de titre `title`)
 *   └─ bdesk-fils        Enfant direct
 *      └─ bdesk-petit    petit-enfant
 */
const project = (title: string): Issue[] => [
  issue({ id: EPIC, title, type: 'epic' }),
  issue({ id: 'bdesk-fils', title: 'Un Enfant', parentId: EPIC }),
  issue({ id: 'bdesk-petit', title: 'Un petit-enfant', parentId: 'bdesk-fils' }),
];

const TITLES = [
  ['vide', ''],
  ['fait d’espaces', '   '],
] as const;

/** Les titres de `container` dont le nom accessible est vide : ce que signale axe (`empty-heading`). */
const unnamedHeadings = (container: HTMLElement) => {
  const named = within(container).queryAllByRole('heading', { name: /\S/ });
  return within(container)
    .queryAllByRole('heading')
    .filter((heading) => !named.includes(heading));
};

/** Le panneau d'un ticket ouvert par son adresse, dès que sa fiche est là : le titre nomme la boîte de dialogue avec l'identifiant. */
async function openPanel(epicTitle: string, id: string, name: string) {
  stubApi({ projects: projectsResponse, issues: { bdesk: project(epicTitle) } });
  const app = renderApp(`/p/bdesk/t/${id}`);
  return { ...app, dialog: await screen.findByRole('dialog', { name }) };
}

describe.each(TITLES)('le panneau d’un ticket sous une Epic dont le titre est %s', (_kind, epicTitle) => {
  it('nomme l’Epic de son lien Parent par son identifiant : « Epic : » ne reste pas sans rien derrière', async () => {
    const { dialog } = await openPanel(epicTitle, 'bdesk-fils', 'bdesk-fils Un Enfant');

    const parent = within(dialog).getByRole('link', { name: `Epic : ${EPIC}` });

    expect(parent.getAttribute('href')).toBe(`/p/bdesk/t/${EPIC}`);
    expect(parent.textContent).toBe(`Epic : ${EPIC}`);
    expect(within(dialog).queryByRole('link', { name: 'Epic :' })).toBeNull();
  });

  it('donne à ce lien Parent l’identifiant en infobulle, comme à celui d’une Epic qui a un titre', async () => {
    const { dialog } = await openPanel(epicTitle, 'bdesk-fils', 'bdesk-fils Un Enfant');

    expect(within(dialog).getByRole('link', { name: `Epic : ${EPIC}` }).getAttribute('title')).toBe(EPIC);
  });

  it('nomme l’Epic du lien « Page Epic » par son identifiant, dans son texte', async () => {
    const { dialog } = await openPanel(epicTitle, 'bdesk-fils', 'bdesk-fils Un Enfant');

    const link = within(dialog).getByRole('link', { name: `Page Epic : ${EPIC}` });

    expect(link.getAttribute('href')).toBe(`/p/bdesk/epics?epic=${EPIC}`);
  });

  it('la nomme aussi dans l’infobulle de ce lien : pas de guillemets vides', async () => {
    const { dialog } = await openPanel(epicTitle, 'bdesk-fils', 'bdesk-fils Un Enfant');

    const link = within(dialog).getByRole('link', { name: `Page Epic : ${EPIC}` });

    expect(link.getAttribute('title')).toBe(tooltip(EPIC));
  });

  it('fait de même pour un petit-enfant : sa fiche nomme l’Epic (`epic`), l’Epic la plus proche au-dessus de lui', async () => {
    const { dialog } = await openPanel(epicTitle, 'bdesk-petit', 'bdesk-petit Un petit-enfant');

    const link = within(dialog).getByRole('link', { name: `Page Epic : ${EPIC}` });

    expect(link.getAttribute('href')).toBe(`/p/bdesk/epics?epic=${EPIC}`);
    expect(link.getAttribute('title')).toBe(tooltip(EPIC));
  });

  it('fait de même dans le panneau de l’Epic elle-même, dont la page est la sienne', async () => {
    const { dialog } = await openPanel(epicTitle, EPIC, `${EPIC} ${UNTITLED}`);

    const link = within(dialog).getByRole('link', { name: `Page Epic : ${EPIC}` });

    expect(link.getAttribute('href')).toBe(`/p/bdesk/epics?epic=${EPIC}`);
    expect(link.getAttribute('title')).toBe(tooltip(EPIC));
  });

  it('est nommée de la même façon sur la carte : la pastille de l’Epic dit son identifiant, le panneau la même', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(epicTitle) } });
    const { user } = renderApp('/p/bdesk/kanban');
    const card = (await screen.findByRole('link', { name: 'Un Enfant' })).closest('li') as HTMLElement;

    const pill = within(card).getByRole('link', { name: `Epic : ${EPIC}` });

    expect(pill.getAttribute('href')).toBe(`/p/bdesk/epics?epic=${EPIC}`);
    expect(pill.getAttribute('title')).toBe(EPIC);
    expect(within(card).queryByRole('link', { name: 'Epic :' })).toBeNull();
    await user.click(within(card).getByRole('link', { name: 'Un Enfant' }));
    const dialog = await screen.findByRole('dialog', { name: 'bdesk-fils Un Enfant' });
    expect(within(dialog).getByRole('link', { name: `Page ${pill.textContent}` }).getAttribute('href')).toBe(pill.getAttribute('href'));
  });
});

describe.each(TITLES)('la page d’une Epic dont le titre est %s', (_kind, epicTitle) => {
  /** La page de l'Epic, dès qu'elle est chargée (son lien « Ouvrir le ticket » est là) : la silhouette du chargement a un titre vide, que l'on n'a pas à juger. */
  async function openEpicPage() {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(epicTitle) } });
    renderApp(`/p/bdesk/epics?epic=${EPIC}`);
    await screen.findByRole('link', { name: 'Ouvrir le ticket' });
  }

  it('a pour titre l’identifiant de l’Epic : pas de titre de niveau 1 vide', async () => {
    await openEpicPage();

    expect(screen.getByRole('heading', { level: 1, name: EPIC })).toBeTruthy();
    expect(unnamedHeadings(document.body)).toEqual([]);
  });

  it('nomme l’onglet de l’identifiant, sans espaces ni « · » en tête', async () => {
    await openEpicPage();

    await waitFor(() => expect(document.title).toBe(`${EPIC} · beads-desktop · beads-desktop`));
  });
});

describe.each(TITLES)('la liste des Epics, pour une Epic dont le titre est %s', (_kind, epicTitle) => {
  it('nomme sa barre d’avancement par l’identifiant : « Avancement de » ne reste pas sans rien derrière', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(epicTitle) } });
    renderApp('/p/bdesk/epics');

    expect(await screen.findByRole('progressbar', { name: `Avancement de ${EPIC}` })).toBeTruthy();
  });
});

describe.each(TITLES)('le panneau d’un ticket dont le titre est %s', (_kind, title) => {
  it.each([
    ['une Epic', 'epic'],
    ['une tâche', 'task'],
  ])('n’a pas de titre vide pour %s : il dit « Sans titre », et le dialogue se nomme de l’identifiant puis de ce titre', async (_what, type) => {
    stubApi({ projects: projectsResponse, issues: { bdesk: [issue({ id: 'bdesk-sans', title, type })] } });
    renderApp('/p/bdesk/t/bdesk-sans');

    const dialog = await screen.findByRole('dialog', { name: `bdesk-sans ${UNTITLED}` });

    expect(within(dialog).getByRole('heading', { level: 2, name: UNTITLED })).toBeTruthy();
    expect(unnamedHeadings(dialog)).toEqual([]);
  });
});

describe('le panneau d’un ticket sous une Epic qui a un titre', () => {
  const LONG = 'Shell UI : thèmes, navigation et raccourcis';

  it('garde son titre : en infobulle du lien « Page Epic » comme du lien Parent, son titre court dans le texte du premier', async () => {
    const { dialog } = await openPanel(LONG, 'bdesk-fils', 'bdesk-fils Un Enfant');

    const page = within(dialog).getByRole('link', { name: 'Page Epic : Shell UI' });
    const parent = within(dialog).getByRole('link', { name: `Epic : ${LONG}` });

    expect(page.getAttribute('title')).toBe(tooltip(LONG));
    expect(parent.getAttribute('title')).toBe(LONG);
  });

  it('garde son titre sur la carte aussi : la pastille dit le titre court, son infobulle le titre entier', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(LONG) } });
    renderApp('/p/bdesk/kanban');
    const card = (await screen.findByRole('link', { name: 'Un Enfant' })).closest('li') as HTMLElement;

    const pill = within(card).getByRole('link', { name: 'Epic : Shell UI' });

    expect(pill.getAttribute('title')).toBe(LONG);
  });
});

describe('la page, la liste et le panneau d’une Epic qui a un titre', () => {
  const TITLE = 'Shell UI : thèmes, navigation et raccourcis';

  it('la page garde son titre de niveau 1 et le nomme dans l’onglet', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(TITLE) } });
    renderApp(`/p/bdesk/epics?epic=${EPIC}`);

    expect(await screen.findByRole('heading', { level: 1, name: TITLE })).toBeTruthy();
    await waitFor(() => expect(document.title).toBe(`${TITLE} · beads-desktop · beads-desktop`));
  });

  it('la liste nomme sa barre d’avancement de son titre', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(TITLE) } });
    renderApp('/p/bdesk/epics');

    expect(await screen.findByRole('progressbar', { name: `Avancement de ${TITLE}` })).toBeTruthy();
  });

  it('le panneau garde son titre, et le dialogue se nomme de l’identifiant puis de lui', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: project(TITLE) } });
    renderApp(`/p/bdesk/t/${EPIC}`);

    const dialog = await screen.findByRole('dialog', { name: `${EPIC} ${TITLE}` });

    expect(within(dialog).getByRole('heading', { level: 2, name: TITLE })).toBeTruthy();
  });
});
