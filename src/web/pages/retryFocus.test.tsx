import { act, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import { metricsFixture, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { FakeEventSource, installFakeEventSource } from '../test/eventSource';
import { renderApp } from '../test/render';

/**
 * Où est le focus quand le bouton « Réessayer » d'une page disparaît (bdesk-38k.40). Le kanban, les métriques, la Vue globale, les Epics, la porte du
 * Projet et la barre latérale posent leur avis d'erreur (et son bouton) là où le squelette vient ensuite : la requête repart, le bouton quitte la page, et
 * le focus qu'il avait tombait sur le corps de la page. Même défaut, même règle que le panneau d'un ticket (bdesk-38k.32, `IssuePanel.focus.test.tsx`) :
 * le focus que tenait ce qui disparaît passe à la zone qui se recharge (le contenu principal, ou la section nommée qui contient l'avis), et à l'arrivée du
 * contenu il passe au titre de la zone, après un « Réessayer » explicite seulement. Jamais de focus repris à qui l'avait mis ailleurs.
 */

// La vue des métriques est chargée à la demande : on lit son module une fois, hors du délai des attentes des tests (et le délai de ces attentes est de 5 s).
warmUpMetricsPages();

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : les minuteries de React Query restent réelles.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

const json = (body: unknown, status = 200) => new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });
const unreadable = () => json({ message: 'database is locked' }, 500);

type Fetch = ReturnType<typeof stubMetricsApi>;
const stubDefaultApi = () => stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues } }, () => metricsFixture());

/** Ce que répond le faux serveur : il fait échouer (500) les requêtes d'une adresse, ou les retient avant de les faire aboutir ou échouer. */
function server(fetchMock: Fetch) {
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('stubMetricsApi devait installer un faux fetch.');
  return {
    fail(pattern: RegExp) {
      fetchMock.mockImplementation(async (input) => (pattern.test(String(input)) ? unreadable() : healthy(input)));
    },
    ok() {
      fetchMock.mockImplementation(healthy);
    },
    /** La réponse attend `release()`, puis aboutit (`ok`) ou échoue (`fail`). */
    hold(pattern: RegExp, outcome: 'ok' | 'fail') {
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      fetchMock.mockImplementation(async (input) => {
        if (!pattern.test(String(input))) return healthy(input);
        await gate;
        return outcome === 'ok' ? healthy(input) : unreadable();
      });
      return release;
    },
  };
}

/** Un écran dont la largeur répond ou non à `(max-width: 767.98px)`, le seuil de `md:` de Tailwind. */
function screenIs(narrow: boolean) {
  window.matchMedia = ((query: string) => ({
    matches: /max-width: 767\.98px/.test(query) ? narrow : false,
    media: query,
    addEventListener: () => undefined,
    removeEventListener: () => undefined,
  })) as unknown as typeof window.matchMedia;
}

// Dans jsdom, seul le panneau d'un ticket lit la largeur (`matchMedia`) : aucune page n'en dépend. Ce que la largeur change pour de bon, le CSS (la barre
// latérale, le bandeau du haut), se mesure dans le navigateur ; on rejoue ici les deux scénarios de base aux deux largeurs, pour qu'un changement qui lirait la
// largeur ne passe pas inaperçu.
const SCREENS = [
  ['sur bureau (1280 px)', false],
  ['sur mobile (375 px)', true],
] as const;

/** Laisse passer les effets et les minuteries de 0 ms : à attendre avant d'affirmer qu'un focus n'a pas bougé. */
const settle = () => act(() => new Promise<void>((resolve) => setTimeout(resolve, 40)));

/** Le navigateur reprend la fenêtre (retour sur l'onglet) : TanStack Query relit ce qui est périmé (`refetchOnWindowFocus`), sans que personne ait rien pressé. */
const windowRegained = () =>
  act(() => {
    window.dispatchEvent(new Event('visibilitychange'));
  });

// Le contenu principal est une région nommée : le lecteur d'écran dit où le focus est tombé.
const main = () => screen.getByRole('main', { name: 'Contenu' });
const sidebar = () => within(screen.getByRole('navigation', { name: 'Navigation principale' }));
const inMain = () => within(main());
const retryIn = (scope: () => ReturnType<typeof within>) => () => scope().getByRole('button', { name: /Réessayer/ });

interface Site {
  name: string;
  path: string;
  /** Les requêtes qui échouent. */
  failing: RegExp;
  /** La zone qui se recharge : le focus y reste tant que le contenu n'est pas là. */
  zone: () => HTMLElement;
  /** Le bouton « Réessayer » de l'avis d'erreur. */
  retry: () => HTMLElement;
  /** Le squelette, qui remplace l'avis pendant le rechargement. */
  loading: () => Promise<HTMLElement>;
  /** Le contenu, une fois arrivé. */
  arrived: () => Promise<HTMLElement>;
  /** Le titre de la zone : il prend le focus à l'arrivée du contenu, après un « Réessayer » explicite. */
  title: () => HTMLElement;
  /** La page se relit d'elle-même au retour sur l'onglet (`refetchOnWindowFocus`) : les métriques sont à la demande, jamais d'elles-mêmes. */
  automatic: boolean;
}

const ISSUES = /\/api\/projects\/bdesk\/issues$/;
const PROJECTS = /\/api\/projects$/;
const METRICS = /\/api\/metrics/;

const SITES: Site[] = [
  {
    name: 'le kanban',
    path: '/p/bdesk/kanban',
    failing: ISSUES,
    zone: main,
    retry: retryIn(inMain),
    loading: () => screen.findByRole('status', { name: 'Chargement des tickets' }),
    arrived: () => screen.findByRole('region', { name: 'En cours' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Kanban' }),
    automatic: true,
  },
  {
    name: 'les métriques d’un Projet',
    path: '/p/bdesk/metrics',
    failing: METRICS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => screen.findByRole('status', { name: 'Chargement des métriques' }),
    arrived: () => screen.findByRole('heading', { level: 2, name: 'Indicateurs' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Métriques' }),
    automatic: false,
  },
  {
    name: 'les métriques de la Vue globale',
    path: '/',
    failing: METRICS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => screen.findByRole('status', { name: 'Chargement des métriques' }),
    arrived: () => screen.findByRole('heading', { level: 2, name: 'Indicateurs' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Vue globale' }),
    automatic: false,
  },
  {
    name: 'les Projets suivis de la Vue globale',
    path: '/',
    failing: PROJECTS,
    zone: () => screen.getByRole('region', { name: 'Projets suivis' }),
    retry: retryIn(() => within(screen.getByRole('region', { name: 'Projets suivis' }))),
    loading: () => within(screen.getByRole('region', { name: 'Projets suivis' })).findByRole('status', { name: 'Chargement des Projets' }),
    arrived: () => within(screen.getByRole('region', { name: 'Projets suivis' })).findByRole('link', { name: /My-Prompt-Manager/ }),
    title: () => screen.getByRole('heading', { level: 2, name: 'Projets suivis' }),
    automatic: true,
  },
  {
    name: 'la liste des Epics',
    path: '/p/bdesk/epics',
    failing: ISSUES,
    zone: main,
    retry: retryIn(inMain),
    loading: () => screen.findByRole('status', { name: 'Chargement des Epics' }),
    arrived: () => screen.findByRole('list', { name: 'Epics ouvertes' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Epics' }),
    automatic: true,
  },
  {
    name: 'la page d’une Epic',
    path: '/p/bdesk/epics?epic=bdesk-38k',
    failing: ISSUES,
    zone: main,
    retry: retryIn(inMain),
    loading: () => screen.findByRole('status', { name: 'Chargement de l’Epic' }),
    arrived: () => screen.findByRole('heading', { level: 1, name: /^beads-desktop V1/ }),
    title: () => screen.getByRole('heading', { level: 1, name: /^beads-desktop V1/ }),
    automatic: true,
  },
  // La porte du Projet garde toutes les routes `/p/:projectId/…` : sa page de chargement remplace la page, et la page qu'elle ouvre n'a pas toujours un titre à
  // l'arrivée (celle d'une Epic charge ses tickets sous un titre de squelette). La Vue globale (`/`) est hors de la porte : ses Projets suivis sont un site à part.
  {
    name: 'la porte du Projet, sur le kanban',
    path: '/p/bdesk/kanban',
    failing: PROJECTS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => within(main()).findByRole('status', { name: 'Chargement du Projet' }),
    arrived: () => screen.findByRole('region', { name: 'En cours' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Kanban' }),
    automatic: true,
  },
  {
    name: 'la porte du Projet, sur la liste des Epics',
    path: '/p/bdesk/epics',
    failing: PROJECTS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => within(main()).findByRole('status', { name: 'Chargement du Projet' }),
    arrived: () => screen.findByRole('list', { name: 'Epics ouvertes' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Epics' }),
    automatic: true,
  },
  {
    name: 'la porte du Projet, sur la page d’une Epic',
    path: '/p/bdesk/epics?epic=bdesk-38k',
    failing: PROJECTS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => within(main()).findByRole('status', { name: 'Chargement du Projet' }),
    arrived: () => screen.findByRole('heading', { level: 1, name: /^beads-desktop V1/ }),
    title: () => screen.getByRole('heading', { level: 1, name: /^beads-desktop V1/ }),
    automatic: true,
  },
  {
    name: 'la porte du Projet, sur les métriques',
    path: '/p/bdesk/metrics',
    failing: PROJECTS,
    zone: main,
    retry: retryIn(inMain),
    loading: () => within(main()).findByRole('status', { name: 'Chargement du Projet' }),
    arrived: () => screen.findByRole('heading', { level: 2, name: 'Indicateurs' }),
    title: () => screen.getByRole('heading', { level: 1, name: 'Métriques' }),
    automatic: true,
  },
  {
    name: 'la liste des Projets de la barre latérale',
    path: '/p/bdesk/kanban',
    failing: PROJECTS,
    zone: () => sidebar().getByRole('region', { name: /^Projets/ }), // « Projets 2 » une fois la liste arrivée : le nombre s'ajoute au titre
    retry: retryIn(sidebar),
    loading: () => sidebar().findByRole('status', { name: 'Chargement des Projets' }),
    arrived: () => sidebar().findByRole('link', { name: /My-Prompt-Manager/ }),
    title: () => sidebar().getByRole('heading', { level: 2, name: /^Projets/ }),
    automatic: true,
  },
];

/** La page, avec ce qui échoue ; l'avis d'erreur est à l'écran. */
async function open(site: Site) {
  const fetchMock = stubDefaultApi();
  const srv = server(fetchMock);
  srv.fail(site.failing);
  const app = renderApp(site.path);
  await waitFor(() => expect(site.retry()).toBeTruthy());
  return { ...app, srv, fetchMock };
}

/** Active « Réessayer » au clavier : le bouton a le focus (Tab), puis Entrée. */
async function pressRetry(site: Site, user: Awaited<ReturnType<typeof open>>['user']) {
  act(() => site.retry().focus());
  await user.keyboard('{Enter}');
}

/** Le squelette est à l'écran, et le bouton est parti. */
async function reloading(site: Site) {
  await site.loading();
  expect(within(site.zone()).queryByRole('button', { name: /Réessayer/ })).toBeNull();
}

describe.each(SCREENS)('« Réessayer » d’une page qui ne se charge pas : %s', (_screen, narrow) => {
  describe.each(SITES)('$name', (site) => {
    it('le bouton disparaît quand la page se recharge : le focus reste dans la zone, puis le titre le prend à l’arrivée du contenu', async () => {
      screenIs(narrow);
      const { user, srv } = await open(site);
      const release = srv.hold(site.failing, 'ok'); // le serveur est rétabli, mais lent

      await pressRetry(site, user);

      await reloading(site);
      expect(document.activeElement).toBe(site.zone()); // ni le corps de la page, ni rien : la zone qui se recharge

      release();
      await site.arrived();
      // Le lecteur d'écran lit l'élément qui prend le focus : le contenu arrive, son titre est dit.
      await waitFor(() => expect(document.activeElement).toBe(site.title()));
    });

    it('le serveur échoue encore : le focus reste dans la zone, qui propose de nouveau « Réessayer »', async () => {
      screenIs(narrow);
      const { user, srv } = await open(site);
      const release = srv.hold(site.failing, 'fail'); // toujours en panne, et lent

      await pressRetry(site, user);
      await reloading(site);
      expect(document.activeElement).toBe(site.zone());
      release();

      await waitFor(() => expect(site.retry()).toBeTruthy());
      await settle();
      // L'alerte dit l'échec : le titre n'a pas à le redire en prenant le focus.
      expect(document.activeElement).toBe(site.zone());
    });
  });
});

describe.each(SITES)('« Réessayer » : $name', (site) => {
  it('la réponse revient aussitôt, sans rien à attendre : le focus passe du bouton au titre sans passer par le corps de la page', async () => {
    const { user, srv } = await open(site);
    srv.ok(); // le serveur est rétabli et répond tout de suite : le rechargement n'est peut-être jamais dessiné

    await pressRetry(site, user);

    await site.arrived();
    await waitFor(() => expect(document.activeElement).toBe(site.title()));
  });

  it('le bouton n’a pas pris le focus (toucher, lecteur d’écran, Safari) : la zone le prend, puis le titre', async () => {
    const { user, srv } = await open(site);
    await user.click(document.body); // le focus est sur le corps de la page
    expect(document.activeElement).toBe(document.body);
    const release = srv.hold(site.failing, 'ok');

    act(() => site.retry().click()); // l'activation n'a pas mis le focus sur le bouton

    await reloading(site);
    expect(document.activeElement).toBe(site.zone());
    release();
    await site.arrived();
    await waitFor(() => expect(document.activeElement).toBe(site.title()));
  });

  describe('ce que l’utilisateur a décidé', () => {
    const OTHER = /^Vue globale/; // un lien de la barre latérale : hors de l'avis, hors du contenu principal
    const other = () => within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: OTHER });

    it('le focus est sur un autre contrôle quand « Réessayer » est activé sans lui : il y reste, la zone et le titre ne le prennent pas', async () => {
      const { srv } = await open(site);
      const release = srv.hold(site.failing, 'ok');
      act(() => other().focus());

      act(() => site.retry().click()); // l'activation n'a pas mis le focus sur le bouton

      await reloading(site);
      expect(document.activeElement).toBe(other());
      release();
      await site.arrived();
      await settle();
      expect(document.activeElement).toBe(other());
    });

    it('il met le focus ailleurs pendant le rechargement : ni la zone ni le titre ne le reprennent', async () => {
      const { user, srv } = await open(site);
      const release = srv.hold(site.failing, 'ok');
      await pressRetry(site, user);
      await reloading(site);
      act(() => other().focus());

      release();
      await site.arrived();
      await settle();

      expect(document.activeElement).toBe(other());
    });

    it('il clique dans le vide pendant le rechargement : le focus est sur le corps de la page, personne ne le reprend', async () => {
      const { user, srv } = await open(site);
      const release = srv.hold(site.failing, 'ok');
      await pressRetry(site, user);
      await reloading(site);
      await user.click(document.body);
      expect(document.activeElement).toBe(document.body);

      release();
      await site.arrived();
      await settle();

      expect(document.activeElement).toBe(document.body);
    });
  });

  if (site.automatic) {
    describe('la page se relit d’elle-même (retour sur l’onglet), sans que personne ait pressé « Réessayer »', () => {
      it('« Réessayer » a le focus : le bouton part, le focus reste dans la zone et le titre ne le prend pas', async () => {
        const { srv } = await open(site);
        act(() => site.retry().focus());
        const release = srv.hold(site.failing, 'ok'); // le serveur est rétabli, mais lent

        windowRegained(); // personne n'a pressé « Réessayer »

        await reloading(site);
        expect(document.activeElement).toBe(site.zone());
        release();
        await site.arrived();
        await settle();
        // Personne n'a demandé ce succès : la zone garde le focus.
        expect(document.activeElement).toBe(site.zone());
      });

      it('le focus est ailleurs : il n’est pas repris', async () => {
        const { srv } = await open(site);
        const link = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Vue globale/ });
        act(() => link.focus());
        const release = srv.hold(site.failing, 'ok');

        windowRegained();
        await reloading(site);
        release();
        await site.arrived();
        await settle();

        expect(document.activeElement).toBe(link);
      });

      it('après un « Réessayer » dont l’échec revient aussitôt (le rechargement n’est peut-être jamais dessiné), un succès automatique plus tard : le réessai ne reste pas armé non plus', async () => {
        const { user, queryClient, fetchMock } = await open(site);
        const failures = () => fetchMock.mock.calls.filter(([input]) => site.failing.test(String(input))).length;
        const before = failures();

        await pressRetry(site, user); // la réponse est un échec de plus, tout de suite
        await waitFor(() => expect(failures()).toBeGreaterThan(before));
        await waitFor(() => expect(queryClient.isFetching()).toBe(0));
        await settle();
        expect(within(site.zone()).getByRole('button', { name: /Réessayer/ })).toBeTruthy(); // l'avis d'erreur est toujours là

        stubDefaultApi(); // le serveur est rétabli
        windowRegained(); // l'utilisateur revient sur l'onglet : la page se relit toute seule

        await site.arrived();
        await settle();
        // Personne n'a demandé ce succès : le titre ne prend pas le focus (le bouton est parti, la zone l'a pris).
        expect(document.activeElement).toBe(site.zone());
      });

      it('après un « Réessayer » qui échoue encore, un succès automatique plus tard : le réessai ne reste pas armé, le titre ne prend pas le focus', async () => {
        const { user, srv } = await open(site);
        const release = srv.hold(site.failing, 'fail'); // la réponse est un échec de plus
        await pressRetry(site, user);
        await reloading(site); // l'ancien bouton est parti : le « Réessayer » qu'on retrouve ensuite est celui du nouvel échec
        release();
        await waitFor(() => expect(site.retry()).toBeTruthy());
        await settle();
        expect(document.activeElement).toBe(site.zone());

        srv.ok(); // le serveur est rétabli
        windowRegained(); // l'utilisateur revient sur l'onglet : la page se relit toute seule

        await site.arrived();
        await settle();
        expect(document.activeElement).toBe(site.zone());
      });
    });
  }
});

describe('la porte du Projet, sur la page d’une Epic dont les tickets ne sont pas encore là', () => {
  // La porte rend la main à la page de l'Epic, qui charge ses tickets sous un titre de squelette : ce titre est vide, et la page qui le remplace le retire du
  // document. Le focus reste au contenu principal, puis le titre de l'Epic le prend à l'arrivée, si l'utilisateur ne l'a pas mis ailleurs entre-temps.
  const gate = SITES.find((site) => site.name === 'la porte du Projet, sur la page d’une Epic')!;

  /** « Réessayer » de la porte, Projets rétablis tout de suite et tickets retenus : le squelette de l'Epic est à l'écran. */
  async function retryWithIssuesHeld() {
    const app = await open(gate);
    const release = app.srv.hold(ISSUES, 'ok'); // les Projets reviennent aussitôt (le serveur sain), les tickets attendent `release()`
    await pressRetry(gate, app.user);
    await screen.findByRole('status', { name: 'Chargement de l’Epic' });
    await settle();
    return { ...app, release };
  }

  it('le titre du squelette de l’Epic, vide, ne prend pas le focus : le contenu principal le garde, pas le corps de la page', async () => {
    await retryWithIssuesHeld();

    expect(document.activeElement).toBe(main());
    expect(main().querySelector('h1[data-skeleton]')).toBeTruthy(); // le squelette est bien à l'écran, et il n'a rien pris
    expect(main().querySelector('h1[data-skeleton]')?.hasAttribute('tabindex')).toBe(false);
  });

  it('les tickets arrivent : le titre de l’Epic prend le focus, sans passer par le corps de la page', async () => {
    const { release } = await retryWithIssuesHeld();

    release();

    await gate.arrived();
    await waitFor(() => expect(document.activeElement).toBe(gate.title()));
  });

  it('il met le focus ailleurs pendant le chargement de l’Epic : l’Epic qui arrive ne le reprend pas', async () => {
    const { release } = await retryWithIssuesHeld();
    const other = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Vue globale/ });
    act(() => other.focus());

    release();
    await gate.arrived();
    await settle();

    expect(document.activeElement).toBe(other);
  });

  it('il clique dans le vide pendant le chargement de l’Epic : le focus est sur le corps de la page, personne ne le reprend', async () => {
    const { user, release } = await retryWithIssuesHeld();
    await user.click(document.body);
    expect(document.activeElement).toBe(document.body);

    release();
    await gate.arrived();
    await settle();

    expect(document.activeElement).toBe(document.body);
  });

  it('les tickets ne se lisent pas : la page dit « Epic indisponible », le focus n’est pas tombé sur le corps de la page', async () => {
    const app = await open(gate);
    const release = app.srv.hold(ISSUES, 'fail');
    await pressRetry(gate, app.user);
    await screen.findByRole('status', { name: 'Chargement de l’Epic' });

    release();

    await screen.findByRole('heading', { level: 1, name: 'Epic indisponible' });
    await settle();
    expect(document.activeElement).not.toBe(document.body);
    expect(main().contains(document.activeElement)).toBe(true);
  });

  it('le titre de l’Epic a pris le focus, la page se relit plus tard d’elle-même : le réessai n’est plus armé, rien ne reprend le focus', async () => {
    const { user, release } = await retryWithIssuesHeld();
    release();
    await waitFor(() => expect(document.activeElement).toBe(gate.title()));
    await user.click(document.body); // l'utilisateur lâche le titre
    expect(document.activeElement).toBe(document.body);

    windowRegained(); // retour sur l'onglet : les Projets et les tickets se relisent
    await settle();

    expect(document.activeElement).toBe(document.body);
  });
});

describe('la porte du Projet, sur le panneau d’un ticket', () => {
  it('« Réessayer » ouvre la page : le panneau du ticket prend le focus, ni le titre du kanban ni le corps de la page', async () => {
    const fetchMock = stubDefaultApi();
    const srv = server(fetchMock);
    srv.fail(PROJECTS);
    const { user } = renderApp('/p/bdesk/t/bdesk-38k.6');
    await waitFor(() => expect(retryIn(inMain)()).toBeTruthy());
    srv.ok();

    act(() => retryIn(inMain)().focus());
    await user.keyboard('{Enter}');

    const panel = await screen.findByRole('dialog', { name: /^bdesk-38k\.6 Shell UI façon Linear/ });
    await settle();
    expect(panel.contains(document.activeElement)).toBe(true);
    expect(document.activeElement).not.toBe(screen.getByRole('heading', { level: 1, name: 'Kanban' }));
  });
});

describe('le titre qui prend le focus', () => {
  it('garde un contour de focus au clavier, et n’est focalisable que le temps qu’il a le focus : un clic dans le vide ne le focalise pas', async () => {
    const site = SITES[0]!;
    const { user, srv } = await open(site);
    srv.ok();

    await pressRetry(site, user);
    await site.arrived();

    const title = await waitFor(() => {
      expect(document.activeElement).toBe(site.title());
      return site.title();
    });
    // jsdom ne calcule pas le contour (le navigateur le vérifie) : on s'assure qu'aucune classe ne le retire.
    expect(title.className).not.toMatch(/\boutline-(none|hidden)\b/);
    expect(title.getAttribute('tabindex')).toBe('-1'); // focalisable par programme, le temps qu'il a le focus
    expect(main().hasAttribute('tabindex')).toBe(false); // le contenu principal a rendu le sien en le lui passant

    act(() => within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Vue globale/ }).focus());

    expect(title.hasAttribute('tabindex')).toBe(false); // plus de focalisation permanente : il n'est pas dans l'ordre de Tab, et un clic ne le prend pas
    expect(main().hasAttribute('tabindex')).toBe(false);
  });
});

describe('le bandeau « actualisation impossible » : son « Réessayer » disparaît au rétablissement', () => {
  /**
   * La page du Projet est à l'écran, puis la relecture de la liste des Projets échoue : le bandeau dit que les données peuvent être périmées. `live` : le flux
   * des mises à jour en direct est ouvert (il peut ensuite tomber, ce qui fait taire le bandeau).
   */
  async function staleBanner({ live = false } = {}) {
    const fetchMock = stubDefaultApi();
    if (live) installFakeEventSource();
    const srv = server(fetchMock);
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'En cours' });
    if (live) {
      await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
      act(() => FakeEventSource.latest.open());
      await waitFor(() => expect(app.queryClient.isFetching()).toBe(0));
    }
    srv.fail(PROJECTS);
    await act(() => app.queryClient.refetchQueries({ queryKey: queryKeys.projects, exact: true }).catch(() => undefined));
    await waitFor(() => expect(app.queryClient.getQueryState(queryKeys.projects)?.status).toBe('error'));
    await screen.findByText(/Actualisation impossible/);
    const retry = () => screen.getByRole('button', { name: /Réessayer/ });
    return { ...app, srv, retry };
  }
  const bannerGone = () => waitFor(() => expect(screen.queryByText(/Actualisation impossible/)).toBeNull());

  it('le serveur est rétabli : le bandeau part avec le focus que son bouton tenait, et la page le prend à son titre, pas le corps de la page', async () => {
    const { user, srv, retry } = await staleBanner();
    srv.ok();
    act(() => retry().focus());

    await user.keyboard('{Enter}');

    await bannerGone();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Kanban' }));
  });

  it('la relecture échoue encore : le bandeau reste, son bouton garde le focus', async () => {
    const { user, srv, retry } = await staleBanner();
    const release = srv.hold(PROJECTS, 'fail');
    act(() => retry().focus());

    await user.keyboard('{Enter}');
    release();
    await settle();

    expect(screen.getByText(/Actualisation impossible/)).toBeTruthy();
    expect(document.activeElement).toBe(retry());
  });

  it('le focus est ailleurs quand le bandeau part : il n’est pas repris', async () => {
    const { srv, retry } = await staleBanner();
    srv.ok();
    const link = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Vue globale/ });
    act(() => link.focus());

    act(() => retry().click()); // l'activation n'a pas mis le focus sur le bouton

    await bannerGone();
    await settle();
    expect(document.activeElement).toBe(link);
  });

  // Le bandeau part aussi sans que personne ait rien demandé : le titre ne prend le focus qu'après un « Réessayer » explicite, comme sur les pages ; sinon le bouton
  // qui avait le focus le rend au contenu principal, qui se lit comme « Contenu, main ».
  it('les mises à jour en direct sont interrompues pendant que le bouton a le focus : le bandeau se tait, le focus reste dans le contenu principal, le titre ne le prend pas', async () => {
    const { retry } = await staleBanner({ live: true });
    act(() => retry().focus());

    act(() => FakeEventSource.latest.fail({ retrying: true })); // la connexion tombe : « interrompues » explique déjà tout, « actualisation impossible » se tait

    await bannerGone();
    await settle();
    expect(document.activeElement).toBe(main());
  });

  it('la page se relit d’elle-même (retour sur l’onglet) et réussit pendant que le bouton a le focus, sans que personne l’ait pressé : le focus reste dans le contenu principal', async () => {
    const { srv, retry } = await staleBanner();
    act(() => retry().focus());
    srv.ok();

    windowRegained();

    await bannerGone();
    await settle();
    expect(document.activeElement).toBe(main());
  });

  it('un « Réessayer » qui échoue encore, puis un rétablissement automatique : le réessai n’est plus armé, le titre ne prend pas le focus', async () => {
    const { user, srv, retry } = await staleBanner();
    const release = srv.hold(PROJECTS, 'fail');
    act(() => retry().focus());
    await user.keyboard('{Enter}');
    release();
    await settle();
    expect(document.activeElement).toBe(retry()); // le bandeau est resté, avec son bouton

    srv.ok();
    windowRegained(); // personne n'a pressé « Réessayer » cette fois-ci

    await bannerGone();
    await settle();
    expect(document.activeElement).toBe(main());
  });

  it('les mises à jour en direct tombent pendant que « Réessayer » relit, et la relecture échoue : le bandeau se tait, le focus reste dans le contenu principal', async () => {
    const { user, srv, retry } = await staleBanner({ live: true });
    const release = srv.hold(PROJECTS, 'fail');
    act(() => retry().focus());
    await user.keyboard('{Enter}');
    act(() => FakeEventSource.latest.fail({ retrying: true })); // la connexion tombe avant que la relecture revienne
    await bannerGone();

    release();
    await settle();

    expect(document.activeElement).toBe(main());
  });

  it('les mises à jour en direct tombent pendant que « Réessayer » relit, et la relecture réussit : c’est un rétablissement après un « Réessayer », le titre prend le focus', async () => {
    const { user, srv, retry } = await staleBanner({ live: true });
    const release = srv.hold(PROJECTS, 'ok');
    act(() => retry().focus());
    await user.keyboard('{Enter}');
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    await bannerGone();
    expect(document.activeElement).toBe(main());

    release();

    await waitFor(() => expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Kanban' })));
  });
});

describe('le bandeau « mises à jour en direct interrompues » : son « Reconnecter » disparaît au retour de la connexion', () => {
  /** Le flux du Projet s'ouvre, puis tombe : le bandeau propose « Reconnecter » une fois le délai de grâce passé. */
  async function lostBanner() {
    stubDefaultApi();
    installFakeEventSource();
    const app = renderApp('/p/bdesk/kanban');
    await screen.findByRole('region', { name: 'En cours' });
    await waitFor(() => expect(FakeEventSource.alive).toHaveLength(1));
    act(() => FakeEventSource.latest.open());
    await waitFor(() => expect(app.queryClient.isFetching()).toBe(0));
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'], shouldAdvanceTime: true });
    act(() => FakeEventSource.latest.fail({ retrying: true }));
    act(() => void vi.advanceTimersByTime(2_600));
    await screen.findByRole('button', { name: 'Reconnecter' });
    return app;
  }

  it('« Reconnecter » est pressé, puis la connexion revient : le bandeau part avec le focus que son bouton tenait, et la page le prend à son titre, pas le corps de la page', async () => {
    await lostBanner();
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).focus());
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).click()); // rouvre le flux tout de suite

    act(() => FakeEventSource.latest.open()); // le serveur est revenu

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull());
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Kanban' }));
  });

  it('la connexion revient d’elle-même, sans que « Reconnecter » soit pressé : le bouton rend le focus au contenu principal, le titre ne le prend pas', async () => {
    await lostBanner();
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).focus());

    act(() => FakeEventSource.latest.open()); // le navigateur a rouvert le flux de lui-même

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull());
    await settle();
    expect(document.activeElement).toBe(main());
  });

  it('« Reconnecter » est pressé et le flux retombe aussitôt : le bandeau est resté, son bouton garde le focus', async () => {
    await lostBanner();
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).focus());
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).click());

    act(() => FakeEventSource.latest.fail({ retrying: true }));
    await settle();

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reconnecter' }));
  });

  it('le focus est ailleurs quand le bandeau part : il n’est pas repris', async () => {
    await lostBanner();
    const link = within(screen.getByRole('navigation', { name: 'Navigation principale' })).getByRole('link', { name: /^Vue globale/ });
    act(() => link.focus());

    act(() => FakeEventSource.latest.open());

    await waitFor(() => expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull());
    expect(document.activeElement).toBe(link);
  });
});
