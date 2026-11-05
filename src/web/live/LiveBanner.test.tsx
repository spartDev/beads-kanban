import { act, render, screen } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { LiveBanner, LOST_GRACE_MS } from './LiveBanner';
import type { LiveStatus } from './useLiveUpdates';

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

const MESSAGE = /mises à jour en direct interrompues/i;
const elapse = (ms: number) => act(() => vi.advanceTimersByTime(ms));

function setup(status: LiveStatus, props: { graceMs?: number } = {}) {
  const onReconnect = vi.fn();
  const view = render(<LiveBanner status={status} onReconnect={onReconnect} {...props} />);
  const update = (next: LiveStatus) => view.rerender(<LiveBanner status={next} onReconnect={onReconnect} {...props} />);
  return { ...view, update, onReconnect };
}

describe('LiveBanner : indication discrète d’une connexion perdue', () => {
  it.each<LiveStatus>(['off', 'connecting', 'live'])('ne dit rien quand le statut est « %s »', (status) => {
    setup(status);

    elapse(60_000);

    expect(screen.queryByText(MESSAGE)).toBeNull();
    expect(screen.queryByRole('button')).toBeNull();
  });

  it('garde une zone d’annonce vide dès le départ : une zone qui apparaît avec son contenu n’est pas toujours annoncée', () => {
    const { container } = setup('live');

    const region = container.querySelector('[aria-live="polite"]');
    expect(region).not.toBeNull();
    expect(region?.textContent).toBe('');
  });

  it('attend un instant avant de parler : une coupure brève (redémarrage du serveur) ne fait pas clignoter la page', () => {
    const { update } = setup('live');

    update('lost');
    elapse(LOST_GRACE_MS - 1);
    expect(screen.queryByText(MESSAGE)).toBeNull();

    elapse(1);
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('attend 2,5 secondes par défaut, ou le délai donné', () => {
    expect(LOST_GRACE_MS).toBe(2_500);
    const { update } = setup('live', { graceMs: 100 });

    update('lost');
    elapse(100);

    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('ne montre jamais rien quand la connexion revient avant le délai', () => {
    const { update } = setup('live');

    update('lost');
    elapse(LOST_GRACE_MS - 500);
    update('live');
    elapse(60_000);

    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('disparaît dès que la connexion revient', () => {
    const { update } = setup('lost', { graceMs: 100 });
    elapse(100);
    expect(screen.getByText(MESSAGE)).toBeTruthy();

    update('live');

    expect(screen.queryByText(MESSAGE)).toBeNull();
  });

  it('repart de zéro à chaque perte : le délai est compté depuis la nouvelle coupure', () => {
    const { update } = setup('lost', { graceMs: 1_000 });
    elapse(1_000);
    update('live');
    update('lost');

    elapse(999);
    expect(screen.queryByText(MESSAGE)).toBeNull();
    elapse(1);
    expect(screen.getByText(MESSAGE)).toBeTruthy();
  });

  it('dit ce que cela change pour la page, dans la zone d’annonce, et propose de se reconnecter', async () => {
    vi.useRealTimers();
    const { container, onReconnect } = setup('lost', { graceMs: 0 });

    const message = await screen.findByText(MESSAGE);

    expect(container.querySelector('[aria-live="polite"]')?.contains(message)).toBe(true);
    expect(message.textContent).toMatch(/peut ne plus être à jour|peuvent ne plus être à jour/);
    await userEvent.setup().click(screen.getByRole('button', { name: 'Reconnecter' }));
    expect(onReconnect).toHaveBeenCalledTimes(1);
  });
});

describe('LiveBanner : le focus que son bouton tenait quand le bandeau part (bdesk-38k.40)', () => {
  // Le bandeau est dans le contenu principal, sous lequel la page a son titre. Le bouton qui avait le focus le rend au contenu principal en partant ; le titre
  // de la page le prend seulement quand « Reconnecter » a été pressé et que la connexion est revenue (voir `retryFocus.test.tsx` pour l'application entière).
  const Page = ({ status, failedAttempt }: { status: LiveStatus; failedAttempt?: number }) => (
    <main aria-label="Contenu">
      <h1>Page</h1>
      <LiveBanner status={status} failedAttempt={failedAttempt} onReconnect={() => undefined} graceMs={0} />
    </main>
  );

  function lostBanner() {
    const view = render(<Page status="lost" />);
    elapse(0); // le délai de grâce passe : le bandeau est là
    const button = screen.getByRole('button', { name: 'Reconnecter' });
    act(() => button.focus());
    return { ...view, button, update: (status: LiveStatus, failedAttempt?: number) => view.rerender(<Page status={status} failedAttempt={failedAttempt} />) };
  }

  it('« Reconnecter » est pressé, puis la connexion revient : le titre de la page prend le focus', () => {
    const { button, update } = lostBanner();
    act(() => button.click());

    update('live');

    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
  });

  it('la connexion revient sans que « Reconnecter » soit pressé : le contenu principal garde le focus, pas le titre', () => {
    const { update } = lostBanner();

    update('live');

    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Contenu' }));
  });

  it('« Reconnecter » est pressé, puis le statut devient « connecting » (l’onglet est caché : le flux est fermé, rien n’est rétabli) : le contenu principal garde le focus', () => {
    const { button, update } = lostBanner();
    act(() => button.click());

    update('connecting');

    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Contenu' }));
  });

  it('« Reconnecter » est pressé et le flux reste perdu : le bandeau reste, son bouton garde le focus', () => {
    const { button, update } = lostBanner();
    act(() => button.click());

    update('lost');

    expect(document.activeElement).toBe(screen.getByRole('button', { name: 'Reconnecter' }));
    expect(button.isConnected).toBe(true);
  });

  // Le flux était déjà perdu : un essai qui échoue encore ne change pas le statut (il ne répète pas « perdue »), seul le numéro du dernier essai échoué monte (bdesk-38k.57).
  // C'est l'issue de ce « Reconnecter » : la connexion qui revient plus tard d'elle-même n'est pas une demande de l'utilisateur.
  it('« Reconnecter » est pressé et l’essai échoue (le statut reste « perdue », le numéro du dernier essai échoué monte), puis la connexion revient d’elle-même : le contenu principal garde le focus, le titre ne le prend pas', () => {
    const { button, update } = lostBanner();
    act(() => button.click());

    update('lost', 1); // l'essai échoue
    expect(document.activeElement).toBe(button); // le bandeau reste, avec son bouton
    update('live', 1); // la connexion revient, d'elle-même

    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Contenu' }));
  });

  it('« Reconnecter » est pressé de nouveau après l’échec, puis la connexion revient : c’est cette demande-là, le titre de la page prend le focus', () => {
    const { button, update } = lostBanner();
    act(() => button.click());
    update('lost', 1);
    act(() => button.click());

    update('live', 1);

    expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
  });

  it('plusieurs essais échouent avant que la connexion revienne d’elle-même : aucune demande ne reste armée', () => {
    const { button, update } = lostBanner();
    act(() => button.click());

    update('lost', 1);
    update('lost', 2);
    update('live', 2);

    expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Contenu' }));
  });

  it('le focus est ailleurs quand le bandeau part : il n’est pas repris', () => {
    const view = render(
      <>
        <button type="button">Ailleurs</button>
        <Page status="lost" />
      </>,
    );
    elapse(0);
    act(() => screen.getByRole('button', { name: 'Reconnecter' }).click());
    const elsewhere = screen.getByRole('button', { name: 'Ailleurs' });
    act(() => elsewhere.focus());

    view.rerender(
      <>
        <button type="button">Ailleurs</button>
        <Page status="live" />
      </>,
    );

    expect(document.activeElement).toBe(elsewhere);
  });
});

// « Reconnecter » demande l'essai que `onReconnect` lance (il en rend le numéro) : seul l'échec de cet essai, ou d'un suivant, désarme la demande. Un échec d'un essai d'avant, que React ne rend
// qu'après l'appui parce qu'il est tombé dans le même rendu, n'est pas celui de l'utilisateur : il ne le désarme pas (bdesk-38k.57).
describe('LiveBanner : la demande est celle d’un essai', () => {
  const Page = ({ status, failedAttempt, onReconnect }: { status: LiveStatus; failedAttempt: number; onReconnect: () => number | void }) => (
    <main aria-label="Contenu">
      <h1>Page</h1>
      <LiveBanner status={status} failedAttempt={failedAttempt} onReconnect={onReconnect} graceMs={0} />
    </main>
  );

  /** Le bandeau, le flux perdu (le dernier essai échoué est `failed`), « Reconnecter » pressé : `onReconnect` lance l'essai `attempt` (ou aucun numéro, `undefined`). */
  function pressed({ attempt, failed = 1 }: { attempt: number | undefined; failed?: number }) {
    const onReconnect = vi.fn(() => attempt);
    const view = render(<Page status="lost" failedAttempt={failed} onReconnect={onReconnect} />);
    elapse(0); // le délai de grâce passe : le bandeau est là
    const button = screen.getByRole('button', { name: 'Reconnecter' });
    act(() => button.focus());
    act(() => button.click());
    return { button, onReconnect, update: (status: LiveStatus, failedAttempt: number) => view.rerender(<Page status={status} failedAttempt={failedAttempt} onReconnect={onReconnect} />) };
  }
  const title = () => screen.getByRole('heading', { level: 1, name: 'Page' });
  const main = () => screen.getByRole('main', { name: 'Contenu' });

  it('l’essai demandé est le 2 ; l’échec de l’essai 1, rendu après l’appui, ne désarme pas la demande : l’essai 2 qui aboutit donne le titre au focus', () => {
    const { button, update } = pressed({ attempt: 2, failed: 0 });

    update('lost', 1); // l'échec de l'essai 1, tombé dans le même rendu que l'appui
    expect(document.activeElement).toBe(button);
    update('live', 1);

    expect(screen.queryByRole('button', { name: 'Reconnecter' })).toBeNull();
    expect(document.activeElement).toBe(title());
  });

  it('l’essai demandé est le 2 ; l’essai 2 échoue : la demande est désarmée, la connexion qui revient d’elle-même ensuite laisse le contenu principal', () => {
    const { button, update } = pressed({ attempt: 2, failed: 1 });

    update('lost', 2); // l'essai demandé échoue : le statut reste « perdue », seul le numéro dit l'échec
    expect(document.activeElement).toBe(button);
    update('live', 2);

    expect(document.activeElement).toBe(main());
  });

  it('l’essai demandé est le 2 ; l’essai 3 (que la connexion rouvre d’elle-même) échoue : c’est un essai suivant, la demande est désarmée aussi', () => {
    const { update } = pressed({ attempt: 2, failed: 1 });

    update('lost', 3);
    update('live', 3);

    expect(document.activeElement).toBe(main());
  });

  it('l’échec d’un essai d’avant puis celui de l’essai demandé : la demande n’est désarmée que par le second', () => {
    const { button, update } = pressed({ attempt: 3, failed: 1 });

    update('lost', 2);
    expect(document.activeElement).toBe(button);
    update('lost', 3);
    update('live', 3);

    expect(document.activeElement).toBe(main());
  });

  it('« Reconnecter » ne dit pas quel essai il lance (`onReconnect` ne rend rien) : le premier échec rendu après l’appui désarme, comme avant', () => {
    const { update } = pressed({ attempt: undefined, failed: 1 });

    update('lost', 2);
    update('live', 2);

    expect(document.activeElement).toBe(main());
  });

  it('le statut passe à « connecting » (l’onglet est caché, le flux est fermé) : la demande est désarmée, quel que soit le numéro', () => {
    const { update } = pressed({ attempt: 2, failed: 1 });

    update('connecting', 1);
    update('live', 1);

    expect(document.activeElement).toBe(main());
  });
});
