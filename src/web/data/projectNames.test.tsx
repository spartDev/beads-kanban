import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { renderHook, waitFor } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { MetricsResponse } from '../../shared/api';
import { metricsFixture, metricsOf } from '../metrics/testing';
import { useMetrics } from '../metrics/api';
import { UNTITLED } from '../test/blankTitles';
import { projects } from '../test/fixtures';
import { INVISIBLE_TEXTS, VISIBLE_TEXTS } from '../test/invisibleTexts';
import { useProjects } from './hooks';
import { namedProjects, withProjectLabels, withProjectNames } from './projectNames';
import type { Project, ProjectsResponse } from './types';

/**
 * Le nom d'un Projet est celui de son dossier (`basename`), que le serveur ne contrôle pas : il peut être vide, fait d'espaces ou de caractères sans largeur, d'un remplisseur hangul (U+3164) ou d'un blanc
 * braille (U+2800). Un Projet dont le nom ne se voit pas n'avait rien à l'écran (un lien sans nom au fil d'Ariane, axe `link-name`) et mettait ce nom blanc dans l'onglet quand son `<h1>` disait « Sans titre » :
 * l'interface le nomme à l'entrée des données (bdesk-38k.65), une fois pour toutes.
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

/** Le nom que l'interface écrit pour un Projet dont le dossier s'appelle `name`. */
const written = (name: string): string => withProjectNames([project(name)])[0]!.name;

describe('le nom écrit d’un Projet', () => {
  it.each(INVISIBLE_TEXTS)('un nom %s s’écrit « Sans titre », comme le titre d’un ticket et celui d’une page', (_kind, name) => {
    expect(written(name)).toBe(UNTITLED);
  });

  it.each(VISIBLE_TEXTS)('%s : le nom reste tel quel, jusqu’à ses blancs et à sa ponctuation', (_kind, name) => {
    expect(written(name)).toBe(name);
  });
});

describe('withProjectNames', () => {
  it('rend les Projets sous leur nom écrit, et ne change rien d’autre', () => {
    const blank = project('\u3164', { id: 'x', prefix: 'x', status: 'unreadable', reason: 'Base Dolt verrouillée' });

    const [named] = withProjectNames([blank]);

    expect(named).toEqual({ ...blank, name: UNTITLED });
    expect(blank.name).toBe('\u3164');
  });

  it('rend la même liste quand tous les noms se voient : les données gardent leur identité, rien ne se redessine pour rien', () => {
    const list = [project('Mon Projet'), project('-', { id: 'tiret' })];

    expect(withProjectNames(list)).toBe(list);
  });

  it('rend une nouvelle liste dès qu’un nom change, en gardant l’ordre et les objets inchangés', () => {
    const first = project('Mon Projet', { id: 'a' });
    const list = [first, project('   ', { id: 'b' })];

    const result = withProjectNames(list);

    expect(result).not.toBe(list);
    expect(result.map((entry) => entry.name)).toEqual(['Mon Projet', UNTITLED]);
    expect(result[0]).toBe(first);
  });

  it('nomme aussi les Projets de la réponse des métriques (identifiant et nom seulement)', () => {
    expect(withProjectNames([{ id: 'x', name: '\u2800' }])).toEqual([{ id: 'x', name: UNTITLED }]);
  });
});

describe('withProjectLabels', () => {
  const row = (label: string) => ({ key: 'blanc', label, throughput: 3 });

  it.each(INVISIBLE_TEXTS)('écrit « Sans titre » le libellé %s d’une ligne du découpage par Projet, sans toucher au reste de la ligne', (_kind, label) => {
    expect(withProjectLabels([row(label)])).toEqual([{ key: 'blanc', label: UNTITLED, throughput: 3 }]);
  });

  it.each(VISIBLE_TEXTS)('%s : le libellé reste tel quel, jusqu’à ses blancs et à sa ponctuation', (_kind, label) => {
    expect(withProjectLabels([row(label)])[0]?.label).toBe(label);
  });

  it('rend la même liste quand tous les libellés se voient, une nouvelle dès qu’un change', () => {
    const seen = [row('beads-desktop'), row('-')];
    const hidden = [row('beads-desktop'), row('\u2800')];

    expect(withProjectLabels(seen)).toBe(seen);
    expect(withProjectLabels(hidden)).not.toBe(hidden);
    expect(withProjectLabels(hidden)[0]).toBe(hidden[0]);
  });
});

describe('namedProjects', () => {
  it('nomme les Projets de la réponse et laisse les dossiers ignorés', () => {
    const response: ProjectsResponse = { projects: [project('\u200b'), project('beads-desktop', { id: 'bdesk' })], ignored: [{ path: '/dev/notes', reason: 'Workspace non-Dolt' }] };

    const result = namedProjects(response);

    expect(result.projects.map((entry) => entry.name)).toEqual([UNTITLED, 'beads-desktop']);
    expect(result.ignored).toBe(response.ignored);
  });

  it('rend la même réponse quand aucun nom ne change', () => {
    const response: ProjectsResponse = { projects, ignored: [] };

    expect(namedProjects(response)).toBe(response);
  });
});

/** Les feuilles texte d'une valeur JSON, par chemin (« slices.project.0.label ») : de quoi dire où un nom est écrit dans une réponse, sans connaître sa forme. */
function leavesOf(value: unknown, path = '', found = new Map<string, string>()): Map<string, string> {
  if (typeof value === 'string') found.set(path, value);
  else if (Array.isArray(value)) value.forEach((item, index) => leavesOf(item, path ? `${path}.${index}` : String(index), found));
  else if (typeof value === 'object' && value !== null) for (const [key, item] of Object.entries(value)) leavesOf(item, path ? `${path}.${key}` : key, found);
  return found;
}

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

const wrapper = ({ children }: { children: ReactNode }) => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  return <QueryClientProvider client={client}>{children}</QueryClientProvider>;
};

describe('useProjects', () => {
  it.each(INVISIBLE_TEXTS)('rend « Sans titre » pour le nom d’un Projet %s : aucun écran n’a rien à réécrire', async (_kind, name) => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ projects: [project(name)], ignored: [] })));

    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects.map((entry) => entry.name)).toEqual([UNTITLED]);
  });

  it('garde le nom d’un Projet qui s’en voit un', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => json({ projects, ignored: [] })));

    const { result } = renderHook(() => useProjects(), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects.map((entry) => entry.name)).toEqual(['beads-desktop', 'My-Prompt-Manager', 'legacy-api']);
  });
});

describe('useMetrics', () => {
  it('nomme les Projets mesurés et les Projets illisibles de la réponse, dont le nom ne se voit pas', async () => {
    const data = metricsOf(
      [
        { id: 'bdesk', name: 'beads-desktop' },
        { id: 'blanc', name: '\u3164' },
      ],
      { unreadable: [{ id: 'vide', name: '   ', reason: 'Base Dolt verrouillée' }] },
    );
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.projects).toEqual([
      { id: 'bdesk', name: 'beads-desktop' },
      { id: 'blanc', name: UNTITLED },
    ]);
    expect(result.current.data?.unreadable).toEqual([{ id: 'vide', name: UNTITLED, reason: 'Base Dolt verrouillée' }]);
  });

  it('nomme aussi le libellé du Projet dans le découpage par Projet : le serveur y écrit le nom du dossier, et le tableau des métriques par Projet en fait le texte de son lien', async () => {
    const data = metricsOf([
      { id: 'bdesk', name: 'beads-desktop' },
      { id: 'blanc', name: '\u3164' },
    ]);
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const rows = result.current.data?.slices.project ?? [];
    expect(rows.map(({ key, label }) => [key, label])).toEqual([
      ['bdesk', 'beads-desktop'],
      ['blanc', UNTITLED],
    ]);
    // Le reste de la ligne est celui du serveur, chiffre pour chiffre.
    expect(rows[1]).toEqual({ ...data.slices.project[1], label: UNTITLED });
  });

  // Chaque endroit est nommé pour lui-même : un nom blanc seul à un endroit, les deux autres se voyant, est nommé quand même (le serveur les écrit ensemble, mais la réponse n'est rendue telle quelle que
  // si AUCUN des trois ne change, et un test qui les blanchit tous à la fois ne le voit pas).
  const visible = metricsOf([{ id: 'bdesk', name: 'beads-desktop' }], { unreadable: [{ id: 'verrou', name: 'verrou', reason: 'Base Dolt verrouillée' }] });
  it.each<[string, MetricsResponse, (data: MetricsResponse | undefined) => string | undefined]>([
    ['les Projets mesurés', { ...visible, projects: [{ id: 'bdesk', name: '\u3164' }] }, (data) => data?.projects[0]?.name],
    ['les Projets illisibles', { ...visible, unreadable: [{ id: 'verrou', name: '\u3164', reason: 'Base Dolt verrouillée' }] }, (data) => data?.unreadable[0]?.name],
    ['le découpage par Projet', { ...visible, slices: { ...visible.slices, project: visible.slices.project.map((row) => ({ ...row, label: '\u3164' })) } }, (data) => data?.slices.project[0]?.label],
  ])('nomme %s quand c’est le seul endroit où le nom ne se voit pas', async (_where, data, read) => {
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(read(result.current.data)).toBe(UNTITLED);
  });

  it('ne touche ni au découpage par type ni au découpage par priorité : le nom d’un Projet n’est pas leur libellé', async () => {
    const base = metricsOf([{ id: 'blanc', name: '\u3164' }]);
    const data = {
      ...base,
      slices: { ...base.slices, type: base.slices.type.map((row) => ({ ...row, label: '\u200b' })), priority: base.slices.priority.map((row) => ({ ...row, label: ' ' })) },
    };
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    expect(result.current.data?.slices.type).toEqual(data.slices.type);
    expect(result.current.data?.slices.priority).toEqual(data.slices.priority);
  });

  it('ne laisse nulle part dans la réponse le nom blanc d’un Projet : chaque endroit où le serveur l’écrit est renommé', async () => {
    const blank = '\u3164';
    // `metricsFixture` écrit « beads-desktop » à chaque endroit où le serveur nomme le Projet `bdesk` : on y met le nom blanc, où qu'il soit, sans dire où.
    const raw = JSON.parse(JSON.stringify(metricsFixture()), (_key, value: unknown) => (value === 'beads-desktop' ? blank : value)) as unknown;
    vi.stubGlobal('fetch', vi.fn(async () => json(raw)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toBeDefined());
    const before = leavesOf(raw);
    const after = leavesOf(result.current.data);
    const written = [...before].filter(([, value]) => value === blank).map(([path]) => path);
    // Le test ne prouve rien si le nom n'est écrit nulle part : il l'est au moins dans `projects` et dans le découpage par Projet.
    expect(written).toEqual(expect.arrayContaining(['projects.0.name', 'slices.project.0.label']));
    for (const path of written) expect(after.get(path), path).toBe(UNTITLED);
    expect([...after].filter(([, value]) => value === blank)).toEqual([]);
  });

  it('rend la réponse telle quelle quand tous les noms se voient', async () => {
    const data = metricsFixture();
    vi.stubGlobal('fetch', vi.fn(async () => json(data)));

    const { result } = renderHook(() => useMetrics({ period: { kind: 'preset', range: '7d' }, timeZone }), { wrapper });

    await waitFor(() => expect(result.current.data).toEqual(data));
  });

  it('nomme aussi les chiffres gardés à l’écran pendant qu’une autre période se charge (`placeholderData`)', async () => {
    const first = metricsFixture({ projects: [{ id: 'blanc', name: '\u3164' }] });
    let release: (response: Response) => void = () => undefined;
    // La première réponse arrive, la seconde est retenue : la page garde les chiffres de la première (`isPlaceholderData`) en attendant.
    vi.stubGlobal(
      'fetch',
      vi
        .fn<(url: string) => Promise<Response>>()
        .mockResolvedValueOnce(json(first))
        .mockImplementationOnce(() => new Promise<Response>((resolve) => (release = resolve))),
    );
    const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
    const shared = ({ children }: { children: ReactNode }) => <QueryClientProvider client={client}>{children}</QueryClientProvider>;

    const { result, rerender } = renderHook(({ range }) => useMetrics({ period: { kind: 'preset', range }, timeZone }), { wrapper: shared, initialProps: { range: '7d' as '7d' | '30d' } });
    await waitFor(() => expect(result.current.data?.projects).toEqual([{ id: 'blanc', name: UNTITLED }]));

    rerender({ range: '30d' });

    await waitFor(() => expect(result.current.isPlaceholderData).toBe(true));
    expect(result.current.data?.projects).toEqual([{ id: 'blanc', name: UNTITLED }]);
    release(json(first));
  });
});
