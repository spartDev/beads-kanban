import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { useMetrics } from '../metrics/api';
import { metricsOf } from '../metrics/testing';
import { UNTITLED } from '../test/blankTitles';
import { projects } from '../test/fixtures';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { useProjects } from './hooks';
import { namedProjects, projectInSentence, projectLabel, projectList, withProjectLabels, withProjectNames } from './projectNames';
import type { Project, ProjectsResponse } from './types';

/**
 * Un Projet dont le dossier n'a pas de nom qu'on voie est écrit « Sans titre » (bdesk-38k.65), et les données le disent (bdesk-38k.73) : `unnamed`. « Sans titre » est alors un repli et non un nom :
 * c'est ce qui permet à la pastille de ne pas en prendre les initiales ni la teinte, et à une phrase de ne pas l'écrire après « de » (« Les tickets de Sans titre »). Un dossier qui s'appelle
 * vraiment « Sans titre » a un nom qui se voit : il n'est pas marqué, et rien de ce qui l'écrit ne change.
 */
const timeZone = 'Europe/Paris';

afterEach(() => {
  vi.unstubAllGlobals();
});

const project = (name: string, overrides: Partial<Project> = {}): Project => ({
  id: 'blanc',
  name,
  path: '/dev/blanc',
  prefix: 'blanc',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('withProjectNames marque le Projet dont il a remplacé le nom', () => {
  it.each(INVISIBLE_TEXTS)('un nom %s s’écrit « Sans titre » et le Projet porte `unnamed`', (_kind, name) => {
    const [named] = withProjectNames([project(name)]);

    expect(named?.name).toBe(UNTITLED);
    expect(named?.unnamed).toBe(true);
  });

  it.each(VISIBLE_TEXTS)('%s : le Projet reste le même objet, sans `unnamed`', (_kind, name) => {
    const list = [project(name)];

    const [named] = withProjectNames(list);

    expect(named).toBe(list[0]);
    expect(named).not.toHaveProperty('unnamed');
  });

  it('ne marque pas un dossier qui s’appelle vraiment « Sans titre » : son nom se voit, ce n’est pas un repli', () => {
    const list = [project('Sans titre', { id: 'sans-titre' })];

    const [named] = withProjectNames(list);

    expect(named).toBe(list[0]);
    expect(named).not.toHaveProperty('unnamed');
  });

  it('ne change rien d’autre au Projet, et ne touche pas à celui qu’il reçoit', () => {
    const blank = project('\u3164', { id: 'x', prefix: 'x', status: 'unreadable', reason: 'Base Dolt verrouillée' });

    const [named] = withProjectNames([blank]);

    expect(named).toEqual({ ...blank, name: UNTITLED, unnamed: true });
    expect(blank).not.toHaveProperty('unnamed');
    expect(blank.name).toBe('\u3164');
  });

  it('marque les Projets de la réponse des métriques (identifiant et nom) comme les autres', () => {
    expect(withProjectNames([{ id: 'x', name: '\u2800' }, { id: 'y', name: 'beads-desktop' }])).toEqual([{ id: 'x', name: UNTITLED, unnamed: true }, { id: 'y', name: 'beads-desktop' }]);
  });

  it('ne marque pas le libellé d’une ligne du découpage par Projet : il n’a ni pastille ni phrase', () => {
    expect(withProjectLabels([{ key: 'blanc', label: '\u3164' }])).toEqual([{ key: 'blanc', label: UNTITLED }]);
  });
});

describe('namedProjects', () => {
  it('marque les Projets au nom invisible de la réponse, et laisse les autres et les dossiers ignorés', () => {
    const response: ProjectsResponse = { projects: [project('\u200b'), project('beads-desktop', { id: 'bdesk' }), project('Sans titre', { id: 'sans-titre' })], ignored: [{ path: '/dev/notes', reason: 'Workspace non-Dolt' }] };

    const result = namedProjects(response);

    expect(result.projects.map((entry) => [entry.name, entry.unnamed])).toEqual([
      [UNTITLED, true],
      ['beads-desktop', undefined],
      ['Sans titre', undefined],
    ]);
    expect(result.projects[1]).toBe(response.projects[1]);
    expect(result.ignored).toBe(response.ignored);
  });

  it('rend la même réponse quand aucun nom ne change', () => {
    const response: ProjectsResponse = { projects, ignored: [] };

    expect(namedProjects(response)).toBe(response);
  });
});

describe('useProjects', () => {
  it.each(INVISIBLE_TEXTS)('rend le Projet %s marqué `unnamed`', async (_kind, name) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ projects: [project(name)], ignored: [] })));

    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects.map((entry) => [entry.name, entry.unnamed])).toEqual([[UNTITLED, true]]);
  });

  it('ne marque ni les Projets dont le nom se voit, ni un dossier qui s’appelle « Sans titre »', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ projects: [...projects, project('Sans titre', { id: 'sans-titre' })], ignored: [] })));

    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects.map((entry) => entry.unnamed)).toEqual([undefined, undefined, undefined, undefined]);
  });
});

describe('useMetrics', () => {
  it('marque les Projets mesurés et les Projets illisibles dont le nom ne se voit pas, et eux seuls', async () => {
    const data = metricsOf(
      [
        { id: 'bdesk', name: 'beads-desktop' },
        { id: 'blanc', name: '\u3164' },
        { id: 'vrai', name: 'Sans titre' },
      ],
      { unreadable: [{ id: 'vide', name: '   ', reason: 'Base Dolt verrouillée' }, { id: 'verrou', name: 'verrou', reason: 'Base Dolt verrouillée' }] },
    );
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects).toEqual([
      { id: 'bdesk', name: 'beads-desktop' },
      { id: 'blanc', name: UNTITLED, unnamed: true },
      { id: 'vrai', name: 'Sans titre' },
    ]);
    expect(result.current.data?.unreadable).toEqual([
      { id: 'vide', name: UNTITLED, unnamed: true, reason: 'Base Dolt verrouillée' },
      { id: 'verrou', name: 'verrou', reason: 'Base Dolt verrouillée' },
    ]);
  });
});

describe('projectInSentence : le Projet après « de » ou « dans »', () => {
  it('est le nom du Projet, tel qu’il est écrit, quand il se voit', () => {
    expect(projectInSentence(project('beads-desktop'))).toBe('beads-desktop');
    expect(projectInSentence(project('Mon Projet'))).toBe('Mon Projet');
    expect(projectInSentence(project(' lead'))).toBe(' lead');
    expect(projectInSentence(project('-'))).toBe('-');
  });

  it('est « ce Projet » quand le nom est un repli : « Les tickets de Sans titre » se lirait comme le nom d’un Projet', () => {
    expect(projectInSentence(project(UNTITLED, { unnamed: true }))).toBe('ce Projet');
  });

  it('reste « Sans titre » pour un dossier qui s’appelle vraiment ainsi', () => {
    expect(projectInSentence(project('Sans titre'))).toBe('Sans titre');
  });
});

describe('projectList : des Projets dans une phrase, après deux-points', () => {
  const blank = (id: string) => project(UNTITLED, { id, unnamed: true });

  it('sépare les noms par une virgule, dans l’ordre, comme avant', () => {
    expect(projectList([project('beads-desktop'), project('My-Prompt-Manager')])).toBe('beads-desktop, My-Prompt-Manager');
    expect(projectList([project('legacy-api')])).toBe('legacy-api');
  });

  it('dit « un Projet sans nom » d’un Projet dont le nom est un repli', () => {
    expect(projectList([blank('a')])).toBe('un Projet sans nom');
  });

  it('range les Projets sans nom après les autres, en un seul groupe qui les compte', () => {
    expect(projectList([blank('a'), blank('b')])).toBe('2 Projets sans nom');
    expect(projectList([blank('a'), project('beads-desktop')])).toBe('« beads-desktop », un Projet sans nom');
    expect(projectList([project('beads-desktop'), blank('a'), project('mpm'), blank('b')])).toBe('« beads-desktop », « mpm », 2 Projets sans nom');
  });

  // Bdesk-38k.73, relecture : « Sans titre, 3 Projets sans titre » se lisait comme quatre Projets sans titre. Dès que la liste compte un Projet sans nom, les noms qui se voient sont entre guillemets :
  // ce qui n'en a pas est le groupe, jamais un nom, quel que soit le nom d'un dossier.
  it('met entre guillemets les noms qui se voient dès que la liste compte un Projet sans nom : le groupe ne se lit pas comme un nom', () => {
    expect(projectList([project('Sans titre'), blank('a'), blank('b'), blank('c')])).toBe('« Sans titre », 3 Projets sans nom');
    expect(projectList([project('3 Projets sans nom'), blank('a')])).toBe('« 3 Projets sans nom », un Projet sans nom');
    expect(projectList([project('un Projet sans nom'), blank('a'), blank('b')])).toBe('« un Projet sans nom », 2 Projets sans nom');
  });

  it('garde « Sans titre » tel quel, sans guillemets, quand aucun Projet n’est sans nom : la liste est de noms, rien ne s’y confond', () => {
    expect(projectList([project('Sans titre')])).toBe('Sans titre');
    expect(projectList([project('Sans titre'), project('beads-desktop')])).toBe('Sans titre, beads-desktop');
  });
});

// Bdesk-38k.73, relecture finale : l'avis « Projets illisibles » écrit une ligne par Projet, chacune avec sa raison (« Sans titre : verrou »). Avec un dossier qui s'appelle vraiment « Sans titre » et un Projet sans nom,
// deux lignes se lisaient de la même façon : `projectLabel` nomme un Projet comme `projectList` le fait dans la phrase de l'alerte de la palette.
describe('projectLabel : un Projet dans une liste où chacun a sa ligne', () => {
  const blank = (id: string) => project(UNTITLED, { id, unnamed: true });

  it('écrit le nom tel quel tant qu’aucun Projet de la liste n’est sans nom : comme avant', () => {
    const among = [project('beads-desktop'), project('My-Prompt-Manager')];

    expect(among.map((one) => projectLabel(one, among))).toEqual(['beads-desktop', 'My-Prompt-Manager']);
    expect(projectLabel(project('Sans titre'), [project('Sans titre')])).toBe('Sans titre');
  });

  it('dit « Un Projet sans nom » d’un Projet dont le nom est un repli, et met les autres noms entre guillemets : comme l’alerte de la palette', () => {
    const among = [project('Sans titre'), blank('a'), project('beads-desktop')];

    expect(among.map((one) => projectLabel(one, among))).toEqual(['« Sans titre »', 'Un Projet sans nom', '« beads-desktop »']);
    expect(projectLabel(blank('a'), [blank('a')])).toBe('Un Projet sans nom');
  });

  it('ne confond pas un dossier qui s’appelle « Un Projet sans nom » avec un Projet sans nom : son nom est entre guillemets', () => {
    const among = [project('Un Projet sans nom'), blank('a')];

    expect(among.map((one) => projectLabel(one, among))).toEqual(['« Un Projet sans nom »', 'Un Projet sans nom']);
  });

  it('écrit les noms comme `projectList` le fait de la même liste : les mêmes guillemets, le même mot', () => {
    const among = [project('beads-desktop'), blank('a'), project('Sans titre')];
    const [first, unnamed, last] = among.map((one) => projectLabel(one, among));

    expect(projectList(among)).toBe(`${first}, ${last}, ${unnamed?.replace(/^U/, 'u')}`);
  });
});
