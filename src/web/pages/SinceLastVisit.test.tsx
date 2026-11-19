import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { SinceLastVisitGroup, SinceLastVisitResponse } from '../data/types';
import { LAST_VISIT_KEY } from '../lib/lastVisit';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { httpFailure, renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * « Depuis votre dernière visite », en tête de l'accueil (bdesk-3e9.2). Les genres et leurs tickets viennent du serveur (`/api/since-last-visit`, calculés
 * par `src/domain/sinceLastVisit.ts`, testés là) ; la page lit et pose la Dernière visite, qui vit dans le stockage du navigateur, et la donne au serveur.
 */

withAsyncTimeout(5_000);
withTimeZone('Europe/Paris');

/** L'instant des données que le serveur renvoie : 20:00 à Paris. L'horloge du navigateur, elle, avance d'un quart d'heure : « Tout vu » ne doit pas la lire. */
const AS_OF = '2026-11-02T19:00:00.000Z';
const CLOCK = '2026-11-02T19:15:00.000Z';
const MARK = '2026-11-01T08:30:00.000Z';
const NBSP = /[\u00a0\u202f]/g;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date(CLOCK));
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

const ticket = (project: string, id: string, title: string, at: string, type = 'task') => ({ project, id, title, type, priority: 2, at });

const GROUPS: SinceLastVisitGroup[] = [
  { kind: 'reopenings', tickets: [ticket('bdesk', 'bdesk-r1', 'Le compteur repart de zéro', '2026-11-02T15:00:00.000Z', 'bug')] },
  {
    kind: 'escapedBugs',
    tickets: [{ ...ticket('mpm', 'mpm-b1', 'La recherche oublie la saisie', '2026-11-02T12:00:00.000Z', 'bug'), deliveries: ['mpm-7', 'mpm-9'] }],
  },
  {
    kind: 'deliveries',
    tickets: [ticket('bdesk', 'bdesk-d2', 'Exporter la période', '2026-11-02T18:00:00.000Z'), ticket('mpm', 'mpm-d1', '   ', '2026-11-02T10:00:00.000Z')],
  },
  { kind: 'newBlockages', tickets: [] },
  { kind: 'arrivals', tickets: [ticket('bdesk', 'bdesk-a1', 'Trier les colonnes', '2026-11-02T09:00:00.000Z')] },
];

const response = (since: string | null, groups: SinceLastVisitGroup[] = GROUPS): SinceLastVisitResponse => ({
  since: since ?? new Date(Date.parse(AS_OF) - 86_400_000).toISOString(),
  asOf: AS_OF,
  projects: [
    { id: 'bdesk', name: 'beads-desktop' },
    { id: 'mpm', name: 'Mon-Pommier-Malin' },
  ],
  unreadable: [],
  groups,
});

type Reply = NonNullable<Parameters<typeof stubApi>[0]['sinceLastVisit']>;

function serve(groups: SinceLastVisitGroup[] = GROUPS, reply: Reply = (since) => response(since, groups)) {
  return stubApi({ projects: projectsResponse, issues: { bdesk: [], mpm: [] }, signals: {}, sinceLastVisit: reply });
}

/** Les `since` demandés au serveur, dans l'ordre (`null` : aucun). */
const asked = (fetchMock: ReturnType<typeof stubApi>) =>
  fetchMock.mock.calls
    .map(([input]) => new URL(String(input), 'http://localhost'))
    .filter((url) => url.pathname === '/api/since-last-visit')
    .map((url) => url.searchParams.get('since'));

const text = (element: Element) => element.textContent?.replace(NBSP, ' ') ?? '';
const section = () => screen.findByRole('region', { name: 'Depuis votre dernière visite' });
/** Les lignes des genres (pas celles des tickets), et ce qu'un lecteur d'écran en dit. */
const rows = (region: HTMLElement) => within(region).getAllByRole('listitem').filter((item) => item.parentElement?.parentElement === region);
const spoken = (row: HTMLElement) => row.firstElementChild?.querySelector('.sr-only')?.textContent;
const seen = (row: HTMLElement) => [...(row.firstElementChild?.querySelectorAll('[aria-hidden="true"]:not(svg)') ?? [])].map((part) => part.textContent);

describe('« Depuis votre dernière visite », sans Dernière visite', () => {
  it('remonte 24 heures : ne demande pas de `since` au serveur, et le dit', async () => {
    const fetchMock = serve();
    renderApp('/');

    const region = await section();
    expect(text(region)).toContain('Ces dernières 24 heures, dans tous les Projets, les mauvaises nouvelles d’abord : aucune visite n’est encore notée dans ce navigateur.');
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(asked(fetchMock)).toEqual([null]);
  });

  it('dit chaque genre, dans l’ordre du serveur (mauvaises nouvelles d’abord), avec son compte ; un genre vide dit zéro et ne se déplie pas', async () => {
    serve();
    renderApp('/');

    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });

    expect(rows(region).map(spoken)).toEqual([
      'Réouvertures : 1 ticket',
      'Bugs d’origine : 1 ticket',
      'Livraisons : 2 tickets',
      'Nouveaux Blocages : 0 ticket',
      'Arrivées : 1 ticket',
    ]);
    expect(rows(region).map(seen)).toEqual([
      ['Réouvertures', '1'],
      ['Bugs d’origine', '1'],
      ['Livraisons', '2'],
      ['Nouveaux Blocages', '0'],
      ['Arrivées', '1'],
    ]);
    expect(within(region).getAllByRole('button', { expanded: false }).map((button) => button.getAttribute('aria-expanded'))).toEqual(['false', 'false', 'false', 'false']);
    expect(within(region).queryByRole('button', { name: /^Nouveaux Blocages/ })).toBeNull();
  });

  it('ne montre que les genres que le serveur rend : un genre indisponible n’a pas de ligne', async () => {
    serve(GROUPS.filter((group) => group.kind !== 'escapedBugs' && group.kind !== 'arrivals'));
    renderApp('/');

    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(rows(region).map(spoken)).toEqual(['Réouvertures : 1 ticket', 'Livraisons : 2 tickets', 'Nouveaux Blocages : 0 ticket']);
  });

  it('n’écrit rien dans le stockage tant qu’on n’a pas cliqué « Tout vu » : ouvrir la page ne fait pas une visite', async () => {
    serve();
    renderApp('/');

    await within(await section()).findByRole('button', { name: /^Réouvertures/ });
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBeNull();
  });
});

describe('« Depuis votre dernière visite », avec une Dernière visite', () => {
  it('demande au serveur ce qui s’est passé depuis elle, et la date', async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, MARK);
    const fetchMock = serve();
    renderApp('/');

    const region = await section();
    expect(text(region)).toContain('Depuis le 1 nov. 2026, 09:30, dans tous les Projets, les mauvaises nouvelles d’abord.');
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(asked(fetchMock)).toEqual([MARK]);
  });

  it('un rechargement ne la déplace pas : la même Dernière visite, demandée de nouveau, et le stockage intact', async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, MARK);
    const fetchMock = serve();
    const first = renderApp('/');
    await within(await section()).findByRole('button', { name: /^Réouvertures/ });
    first.unmount();

    renderApp('/');
    await within(await section()).findByRole('button', { name: /^Réouvertures/ });

    expect(asked(fetchMock)).toEqual([MARK, MARK]);
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBe(MARK);
  });

  it('une valeur stockée qui n’est pas un instant vaut comme pas de visite : 24 heures', async () => {
    window.localStorage.setItem(LAST_VISIT_KEY, 'hier soir');
    const fetchMock = serve();
    renderApp('/');

    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(text(region)).toContain('Ces dernières 24 heures');
    expect(asked(fetchMock)).toEqual([null]);
  });
});

describe('« Tout vu »', () => {
  it('pose la Dernière visite à l’instant des données affichées, pas à l’heure du clic, puis redemande depuis elle', async () => {
    const fetchMock = serve();
    const { user } = renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });

    const seeAll = within(region).getByRole('button', { name: 'Tout vu' });
    expect(seeAll.getAttribute('aria-describedby')).toBeTruthy();
    expect(text(document.getElementById(seeAll.getAttribute('aria-describedby')!)!)).toBe(
      'La prochaine fois, ne montrer que ce qui s’est passé après le 2 nov. 2026, 20:00',
    );
    await user.click(seeAll);

    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBe(AS_OF);
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).not.toBe(CLOCK);
    await waitFor(() => expect(asked(fetchMock)).toEqual([null, AS_OF]));
    expect(text(region)).toContain('Depuis le 2 nov. 2026, 20:00, dans tous les Projets');
    expect(text(within(region).getByRole('status', { name: 'Dernière visite' }))).toBe('Visite notée : tout est vu jusqu’au 2 nov. 2026, 20:00.');
    // Le bouton reste là, et garde le focus : la liste repart en chargement sous lui.
    expect(document.activeElement).toBe(seeAll);
  });

  it('est inerte tant que rien n’est affiché : il ne pose rien', async () => {
    const fetchMock = serve();
    const healthy = fetchMock.getMockImplementation()!;
    fetchMock.mockImplementation((input) => (String(input).startsWith('/api/since-last-visit') ? new Promise<Response>(() => undefined) : healthy(input)));
    const { user } = renderApp('/');
    const region = await section();
    expect(within(region).getByRole('status', { name: 'Chargement de ce qui s’est passé depuis votre dernière visite' })).toBeTruthy();

    const seeAll = within(region).getByRole('button', { name: 'Tout vu' });
    expect(seeAll.getAttribute('aria-disabled')).toBe('true');
    await user.click(seeAll);
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBeNull();
  });
});

describe('« Depuis votre dernière visite », stockage indisponible', () => {
  it('lit 24 heures sans lever, et « Tout vu » vaut pour la session', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    const setItem = vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota dépassé', 'QuotaExceededError');
    });
    const fetchMock = serve();
    const { user } = renderApp('/');

    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(text(region)).toContain('Ces dernières 24 heures');

    await user.click(within(region).getByRole('button', { name: 'Tout vu' }));

    expect(setItem).toHaveBeenCalledWith(LAST_VISIT_KEY, AS_OF);
    await waitFor(() => expect(asked(fetchMock)).toEqual([null, AS_OF]));
    expect(text(region)).toContain('Depuis le 2 nov. 2026, 20:00');
  });
});

describe('les tickets d’un genre', () => {
  it('se déplient au clavier : le bouton dit s’il est ouvert et quelle liste il commande', async () => {
    serve();
    const { user } = renderApp('/');
    const region = await section();
    const deliveries = await within(region).findByRole('button', { name: 'Livraisons : 2 tickets' });
    const list = document.getElementById(deliveries.getAttribute('aria-controls')!)!;
    expect(list.hidden).toBe(true);

    deliveries.focus();
    await user.keyboard('{Enter}');

    expect(deliveries.getAttribute('aria-expanded')).toBe('true');
    expect(list.hidden).toBe(false);
    const links = within(list).getAllByRole('link');
    // Les plus récents d'abord, comme le serveur les range ; un titre blanc s'écrit « Sans titre ».
    expect(links.map((link) => [link.textContent, link.getAttribute('href')])).toEqual([
      ['Exporter la période', '/p/bdesk/t/bdesk-d2'],
      ['Sans titre', '/p/mpm/t/mpm-d1'],
    ]);
    expect(text(within(list).getAllByRole('listitem')[0]!)).toBe('Exporter la périodebdesk-d2beads-desktop · il y a 1 h');
    expect(within(list).getAllByRole('listitem')[1]!.querySelector('time')?.getAttribute('dateTime')).toBe('2026-11-02T10:00:00.000Z');

    await user.keyboard(' ');
    expect(deliveries.getAttribute('aria-expanded')).toBe('false');
    expect(list.hidden).toBe(true);
  });

  it('un Bug d’origine dit quelles Livraisons il met en échec', async () => {
    serve();
    const { user } = renderApp('/');
    const region = await section();

    await user.click(await within(region).findByRole('button', { name: 'Bugs d’origine : 1 ticket' }));

    expect(text(within(region).getByRole('link', { name: 'La recherche oublie la saisie' }).closest('li')!)).toBe(
      'La recherche oublie la saisiempm-b1Mon-Pommier-Malin · il y a 7 h · Livraisons en échec : mpm-7, mpm-9',
    );
  });
});

describe('« Depuis votre dernière visite » en échec', () => {
  it('le dit dans la section, avec « Réessayer », sans gêner les Signaux', async () => {
    serve(GROUPS, () => new Error('database is locked'));
    const { user } = renderApp('/');

    const region = await section();
    expect(await within(region).findByText('Impossible de lire ce qui s’est passé depuis votre dernière visite')).toBeTruthy();
    expect(await screen.findByText(/Rien à regarder/)).toBeTruthy();

    serve();
    await user.click(within(region).getByRole('button', { name: /Réessayer/ }));
    expect(await within(region).findByRole('button', { name: /^Réouvertures/ })).toBeTruthy();
  });
});

describe('« Depuis votre dernière visite » en anglais', () => {
  it('dit les genres sous leurs noms anglais, et les comptes', async () => {
    setBrowserLanguages(['en-US', 'en']);
    serve();
    renderApp('/', { languageSwitch: true });

    const region = await screen.findByRole('region', { name: 'Since your last visit' });
    expect(await within(region).findByRole('button', { name: 'Deliveries: 2 tickets' })).toBeTruthy();
    expect(within(region).getByRole('button', { name: 'Reopens: 1 ticket' })).toBeTruthy();
    expect(spoken(rows(region)[3]!)).toBe('New blockages: 0 tickets');
    expect(within(region).getByRole('button', { name: 'Mark all seen' })).toBeTruthy();
  });
});

describe('« Depuis votre dernière visite » avec un Projet illisible', () => {
  const locked = (since: string | null): SinceLastVisitResponse => ({
    ...response(since),
    projects: [{ id: 'bdesk', name: 'beads-desktop' }],
    unreadable: [{ id: 'mpm', name: 'Mon-Pommier-Malin', reason: 'database is locked' }],
  });

  it('le dit dans la section, avec sa raison : ses événements ne sont pas dans les comptes', async () => {
    serve(GROUPS, locked);
    renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });

    const notice = within(region).getByRole('status', { name: 'Un Projet illisible, absent de ces chiffres' });
    expect(text(notice)).toContain('Mon-Pommier-Malin : database is locked');
  });

  it('« Tout vu » reste utilisable, mais dit à côté du bouton et dans l’annonce ce qu’il laisse de côté', async () => {
    const fetchMock = serve(GROUPS, locked);
    const { user } = renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });

    const skipped = '« Tout vu » laissera de côté ce qui s’est passé depuis le 1 nov. 2026, 20:00 dans ce Projet illisible : Mon-Pommier-Malin.';
    expect(within(region).getByText(skipped)).toBeTruthy();
    const seeAll = within(region).getByRole('button', { name: 'Tout vu' });
    expect(seeAll.getAttribute('aria-disabled')).toBeNull();
    const described = seeAll.getAttribute('aria-describedby')!.split(' ').map((id) => text(document.getElementById(id)!));
    expect(described).toEqual(['La prochaine fois, ne montrer que ce qui s’est passé après le 2 nov. 2026, 20:00', skipped]);

    await user.click(seeAll);

    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBe(AS_OF);
    await waitFor(() => expect(asked(fetchMock)).toEqual([null, AS_OF]));
    expect(text(within(region).getByRole('status', { name: 'Dernière visite' }))).toBe(
      'Visite notée : tout est vu jusqu’au 2 nov. 2026, 20:00. Ce qui s’est passé depuis le 1 nov. 2026, 20:00 dans ce Projet illisible ne sera pas montré : Mon-Pommier-Malin.',
    );
  });

  it('en anglais', async () => {
    setBrowserLanguages(['en-US', 'en']);
    serve(GROUPS, locked);
    renderApp('/', { languageSwitch: true });
    const region = await screen.findByRole('region', { name: 'Since your last visit' });
    await within(region).findByRole('button', { name: /^Reopens/ });

    expect(within(region).getByRole('status', { name: 'One unreadable Project, left out of these figures' })).toBeTruthy();
    expect(text(region)).toContain('“Mark all seen” will leave out what happened since Nov 1, 2026, 20:00 in this unreadable project: Mon-Pommier-Malin.');
  });

  it('sans Projet illisible, rien n’est dit de plus', async () => {
    serve();
    renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });

    expect(within(region).queryByText(/laissera de côté/)).toBeNull();
    expect(within(region).getByRole('button', { name: 'Tout vu' }).getAttribute('aria-describedby')?.split(' ')).toHaveLength(1);
  });
});

describe('« Depuis votre dernière visite », une Dernière visite que la fenêtre ne peut pas suivre', () => {
  it('dans le futur : la section dit la fenêtre réelle, celle de la réponse, pas une date à venir', async () => {
    const FUTURE = '2026-11-05T19:00:00.000Z';
    window.localStorage.setItem(LAST_VISIT_KEY, FUTURE);
    // Le serveur borne la fenêtre : elle commence et finit à l'instant des données.
    const fetchMock = serve(GROUPS, () => response(AS_OF, GROUPS.map((group) => ({ ...group, tickets: [] }) as SinceLastVisitGroup)));
    renderApp('/');

    const region = await section();
    await within(region).findByText('Réouvertures');
    expect(asked(fetchMock)).toEqual([FUTURE]);
    expect(text(region)).toContain('Depuis le 2 nov. 2026, 20:00, dans tous les Projets');
    expect(text(region)).not.toContain('5 nov. 2026');
  });

  it('refusée par le serveur (400) : elle vaut comme pas de visite, sans laisser la section en erreur ni toucher au stockage', async () => {
    const ANCIENT = '0050-01-01T00:00:00.000Z';
    window.localStorage.setItem(LAST_VISIT_KEY, ANCIENT);
    const fetchMock = serve(GROUPS, (since) =>
      since === null
        ? response(null)
        : httpFailure(400, { statusCode: 400, error: 'Bad Request', message: 'refusé', code: 'query-invalid-instant', params: { parameter: 'since', received: since } }),
    );
    renderApp('/');

    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    expect(asked(fetchMock)).toEqual([ANCIENT, null]);
    expect(text(region)).toContain('Ces dernières 24 heures');
    expect(within(region).queryByRole('alert')).toBeNull();
    expect(window.localStorage.getItem(LAST_VISIT_KEY)).toBe(ANCIENT);
  });
});

describe('« Depuis votre dernière visite », une visite notée dans un autre onglet', () => {
  it('l’emporte au retour sur l’accueil quand elle est plus récente : la Dernière visite est celle du navigateur', async () => {
    const LATER = '2026-11-02T19:10:00.000Z';
    const fetchMock = serve();
    const { user, router } = renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    await user.click(within(region).getByRole('button', { name: 'Tout vu' }));
    await waitFor(() => expect(asked(fetchMock)).toEqual([null, AS_OF]));

    // Un autre onglet du même navigateur clique « Tout vu » dix minutes plus tard : le stockage, partagé, porte sa visite.
    window.localStorage.setItem(LAST_VISIT_KEY, LATER);
    await act(async () => void router.navigate('/overview'));
    await screen.findByRole('heading', { level: 1, name: 'Vue globale' });
    await act(async () => void router.navigate('/'));

    await within(await section()).findByRole('button', { name: /^Réouvertures/ });
    expect(asked(fetchMock).at(-1)).toBe(LATER);
  });
});

describe('« Depuis votre dernière visite », stockage indisponible, d’une page à l’autre', () => {
  it('la visite notée tient quand on quitte l’accueil et qu’on y revient', async () => {
    vi.spyOn(window.localStorage, 'getItem').mockImplementation(() => {
      throw new DOMException('Accès refusé', 'SecurityError');
    });
    vi.spyOn(window.localStorage, 'setItem').mockImplementation(() => {
      throw new DOMException('Quota dépassé', 'QuotaExceededError');
    });
    const fetchMock = serve();
    const { user, router } = renderApp('/');
    const region = await section();
    await within(region).findByRole('button', { name: /^Réouvertures/ });
    await user.click(within(region).getByRole('button', { name: 'Tout vu' }));
    await waitFor(() => expect(asked(fetchMock)).toEqual([null, AS_OF]));

    await act(async () => void router.navigate('/p/bdesk/signals'));
    await screen.findByRole('heading', { level: 1, name: 'À regarder' });
    expect(screen.queryByRole('region', { name: 'Depuis votre dernière visite' })).toBeNull();
    await act(async () => void router.navigate('/'));

    const back = await section();
    await within(back).findByRole('button', { name: /^Réouvertures/ });
    expect(text(back)).toContain('Depuis le 2 nov. 2026, 20:00');
    expect(asked(fetchMock).at(-1)).toBe(AS_OF);
  });
});
