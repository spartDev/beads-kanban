import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { act, render, screen } from '@testing-library/react';
import { afterEach, beforeEach, expect, it, vi } from 'vitest';
import { FakeEventSource, installFakeEventSource } from '../test/eventSource';
import { LiveBanner } from './LiveBanner';
import { useLiveUpdates } from './useLiveUpdates';

/**
 * La course de « Reconnecter » (relecture de bdesk-38k.57, remarque F2). L'échec d'un essai arrive à l'interface au rendu suivant : quand il tombe dans le même rendu que l'appui sur
 * « Reconnecter », l'échec qu'on reçoit est celui d'un essai d'avant, pas de l'essai que l'utilisateur vient de demander. Il ne doit pas désarmer sa demande : l'essai demandé qui aboutit
 * donne le titre de la page au focus, comme après tout « Reconnecter » qui aboutit. Le bandeau est ici branché sur le vrai hook (`useLiveUpdates`), avec le faux `EventSource`.
 */
function Harness() {
  const { status, failedAttempt, reconnect } = useLiveUpdates('bdesk');
  return (
    <main aria-label="Contenu">
      <h1>Page</h1>
      <LiveBanner status={status} failedAttempt={failedAttempt} onReconnect={reconnect} graceMs={0} />
    </main>
  );
}

beforeEach(() => {
  installFakeEventSource();
  vi.stubGlobal('fetch', vi.fn(async () => new Response('{"projects":[]}', { status: 200, headers: { 'Content-Type': 'application/json' } })));
});
afterEach(() => vi.unstubAllGlobals());

it('race : un échec du flux pas encore rendu quand « Reconnecter » est pressé ne désarme pas la demande', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  act(() => FakeEventSource.latest.open());
  act(() => FakeEventSource.latest.fail({ retrying: true }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const button = screen.getByRole('button', { name: 'Reconnecter' });
  act(() => button.focus());
  // Le navigateur rouvre le flux de lui-même et cet essai échoue ; React n'a pas encore rendu cet échec quand l'utilisateur presse « Reconnecter ».
  await act(async () => {
    FakeEventSource.latest.fail({ retrying: true });
    button.click();
  });
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  act(() => FakeEventSource.latest.open()); // l'essai demandé aboutit
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

  // Attendu : le titre (c'est la demande de l'utilisateur qui aboutit).
  expect(document.activeElement).toBe(screen.getByRole('heading', { level: 1, name: 'Page' }));
});

it('l’échec de l’essai demandé, lui, désarme : la connexion qui revient d’elle-même ensuite laisse le contenu principal', async () => {
  const client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  render(
    <QueryClientProvider client={client}>
      <Harness />
    </QueryClientProvider>,
  );
  act(() => FakeEventSource.latest.open());
  act(() => FakeEventSource.latest.fail({ retrying: true }));
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });
  const button = screen.getByRole('button', { name: 'Reconnecter' });
  act(() => button.focus());
  await act(async () => {
    button.click(); // rouvre un flux : l'essai 2
  });
  await act(async () => {
    FakeEventSource.latest.fail({ retrying: true }); // l'essai demandé échoue
    await new Promise((r) => setTimeout(r, 5));
  });
  expect(document.activeElement).toBe(button); // le bandeau est resté, avec son bouton
  act(() => FakeEventSource.latest.open()); // le navigateur retente le même flux, qui aboutit
  await act(async () => {
    await new Promise((r) => setTimeout(r, 5));
  });

  expect(document.activeElement).toBe(screen.getByRole('main', { name: 'Contenu' }));
});
