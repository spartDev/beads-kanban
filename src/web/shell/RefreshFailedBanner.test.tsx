import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import type { ReactNode } from 'react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import { RefreshFailedBanner } from './RefreshFailedBanner';

afterEach(() => {
  vi.restoreAllMocks();
});

/**
 * Le focus que le bouton « Réessayer » du bandeau « Actualisation impossible » rend quand la relecture rétablit tout : le titre de la page, dès qu'il existe (bdesk-38k.40,
 * bdesk-38k.57). `retryFocus.test.tsx` le vérifie avec l'application entière, où le bandeau est déjà parti quand la relecture se termine (mesuré dans Chromium, Firefox et WebKit :
 * au retour de `refetchQueries`, le bouton n'est plus dans le document et le focus est au contenu principal). Ici, le magasin de requêtes est un faux que le test mène : il permet
 * aussi l'autre ordre, que le code d'avant tenait et que celui-ci tient encore, un bandeau toujours là, son bouton ayant le focus, quand la relecture se termine.
 */
function setup(page: (ready: boolean) => ReactNode = () => <h1>Page</h1>) {
  const client = new QueryClient();
  const cache = client.getQueryCache();
  let stale = 1; // une requête affichée est périmée tant que la relecture n'a pas abouti
  let tell: () => void = () => undefined;
  let finish: () => void = () => undefined;
  vi.spyOn(cache, 'findAll').mockImplementation(() => (stale > 0 ? [{} as never] : []));
  vi.spyOn(cache, 'subscribe').mockImplementation((listener) => {
    tell = listener as () => void;
    return () => undefined;
  });
  vi.spyOn(client, 'refetchQueries').mockImplementation(
    () =>
      new Promise<void>((resolve) => {
        finish = resolve;
      }),
  );
  // La page que montre le contenu principal (`data-location`, que `AppShell` écrit) et si son titre est arrivé : `ready` et `goTo` les changent sans toucher à l'autre.
  const shown = { ready: false, location: '/p/bdesk/epics?epic=a' };
  const Shell = () => (
    <QueryClientProvider client={client}>
      <button type="button">Ailleurs</button>
      <main aria-label="Contenu" data-location={shown.location}>
        {page(shown.ready)}
        <RefreshFailedBanner muted={false} />
      </main>
    </QueryClientProvider>
  );
  const view = render(<Shell />);
  return {
    retry: () => screen.getByRole('button', { name: 'Réessayer' }),
    elsewhere: () => screen.getByRole('button', { name: 'Ailleurs' }),
    main: () => screen.getByRole('main', { name: 'Contenu' }),
    ready: () => {
      shown.ready = true;
      view.rerender(<Shell />);
    },
    /** L'utilisateur va sur une autre page (un lien, « Retour », un raccourci) : le contenu principal en montre une autre. */
    goTo: (location: string) => {
      shown.location = location;
      view.rerender(<Shell />);
    },
    /** La relecture se termine. `stillStale` : une requête est encore en échec. Le magasin ne le dit à ses abonnés que par `notify`. */
    refetchEnds: async ({ stillStale = false } = {}) => {
      stale = stillStale ? 1 : 0;
      await act(async () => finish());
    },
    /** Le magasin prévient ses abonnés : s'il ne reste rien de périmé, le bandeau, qui n'a plus de quoi parler, part. */
    notify: () => act(() => tell()),
    setStale: (count: number) => void (stale = count),
  };
}

describe('RefreshFailedBanner : « Réessayer » rend le focus au titre de la page, dans les deux ordres', () => {
  it('la relecture se termine alors que le bandeau est encore là, son bouton ayant le focus : la page le prend à son titre, et le bandeau part sans le lui reprendre', async () => {
    const { retry, refetchEnds, notify } = setup();
    act(() => retry().focus());
    act(() => retry().click());

    await refetchEnds();

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
    notify();
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
  });

  it('le bandeau part avant la fin de la relecture (le cas mesuré dans les navigateurs) : le contenu principal a le focus, et la page le prend à son titre à la fin', async () => {
    const { retry, main, refetchEnds, notify, setStale } = setup();
    act(() => retry().focus());
    act(() => retry().click());

    setStale(0);
    notify(); // le magasin prévient : le bandeau part tant que la relecture dure
    expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
    expect(document.activeElement).toBe(main());
    await refetchEnds();

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
  });

  describe('la page n’a encore que le titre d’un squelette quand la relecture se termine (la page d’une Epic dont les tickets arrivent)', () => {
    const epic = (isReady: boolean) => (isReady ? <h1>Epic</h1> : <h1 data-skeleton aria-label="Chargement…" />);

    it('le bandeau est encore là : le contenu principal prend le focus du bouton, puis le titre de la page qui arrive', async () => {
      const { retry, main, refetchEnds, notify, ready } = setup(epic);
      act(() => retry().focus());
      act(() => retry().click());

      await refetchEnds();

      expect(document.activeElement).toBe(main()); // ni le squelette, ni le bouton qui part, ni le corps de la page
      notify();
      expect(document.activeElement).toBe(main());
      ready();
      await act(async () => undefined);
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Epic' }));
    });

    it('le bandeau est déjà parti : le contenu principal garde le focus, puis le titre de la page qui arrive le prend', async () => {
      const { retry, main, refetchEnds, notify, ready, setStale } = setup(epic);
      act(() => retry().focus());
      act(() => retry().click());
      setStale(0);
      notify();

      await refetchEnds();

      expect(document.activeElement).toBe(main());
      ready();
      await act(async () => undefined);
      expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Epic' }));
    });
  });

  it('il reste des données périmées à la fin de la relecture : le bandeau reste, son bouton garde le focus', async () => {
    const { retry, refetchEnds } = setup();
    act(() => retry().focus());
    act(() => retry().click());

    await refetchEnds({ stillStale: true });

    expect(screen.getByRole('button', { name: 'Réessayer' })).toBe(retry());
    expect(document.activeElement).toBe(retry());
  });

  // Entre l'appui et la fin de la relecture, la demande est celle de la page où le bouton a été pressé : l'utilisateur qui va ailleurs ne demande pas qu'on lise le titre de la page où il arrive
  // (bdesk-38k.57). Le bandeau, lui, part quand même, avec le focus de son bouton, vers le contenu principal.
  describe('l’utilisateur va sur une autre page entre l’appui et la fin de la relecture', () => {
    it('le bandeau est encore là à la fin de la relecture : elle ne touche pas au focus, que le bouton tient ; le bandeau part ensuite avec lui vers le contenu principal, pas vers le titre', async () => {
      const { retry, main, refetchEnds, notify, goTo } = setup();
      act(() => retry().focus());
      act(() => retry().click());
      goTo('/p/bdesk/kanban');

      await refetchEnds();

      expect(document.activeElement).toBe(retry());
      notify();
      expect(screen.queryByRole('button', { name: 'Réessayer' })).toBeNull();
      expect(document.activeElement).toBe(main());
    });

    it('le bandeau est déjà parti à la fin de la relecture : le contenu principal garde le focus, le titre de la page où l’on est arrivé ne le prend pas', async () => {
      const { retry, main, refetchEnds, notify, goTo, setStale } = setup();
      act(() => retry().focus());
      act(() => retry().click());
      goTo('/p/bdesk/kanban');
      setStale(0);
      notify();
      expect(document.activeElement).toBe(main());

      await refetchEnds();

      expect(document.activeElement).toBe(main());
    });

    it('la page qui arrive n’a encore que le titre d’un squelette : le titre qui arrive ensuite ne prend pas le focus non plus', async () => {
      const { retry, main, refetchEnds, notify, goTo, ready, setStale } = setup((isReady) => (isReady ? <h1>Kanban</h1> : <h1 data-skeleton aria-label="Chargement…" />));
      act(() => retry().focus());
      act(() => retry().click());
      goTo('/p/bdesk/kanban');
      setStale(0);
      notify();

      await refetchEnds();
      ready();
      await act(async () => undefined);

      expect(document.activeElement).toBe(main());
    });
  });

  it('le focus est ailleurs quand la relecture se termine : il n’est pas repris', async () => {
    const { retry, elsewhere, refetchEnds, notify } = setup();
    act(() => retry().click()); // l'activation n'a pas mis le focus sur le bouton
    act(() => elsewhere().focus());

    await refetchEnds();
    notify();

    expect(document.activeElement).toBe(elsewhere());
  });
});
