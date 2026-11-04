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
