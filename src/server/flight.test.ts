import { getEventListeners } from 'node:events';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ReadAborted } from './abort';
import { Flight } from './flight';

/** Une lecture que le test finit à la main, et qui note le signal qu'elle a reçu. */
function manual<T>() {
  const probe = {
    runs: 0,
    signal: undefined as AbortSignal | undefined,
    finish: (() => {}) as (value: T) => void,
    fail: (() => {}) as (error: unknown) => void,
  };
  const run = (signal: AbortSignal) => {
    probe.runs++;
    probe.signal = signal;
    return new Promise<T>((resolve, reject) => {
      probe.finish = resolve;
      probe.fail = reject;
    });
  };
  return { run, probe };
}

const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

describe('Flight : une lecture que plusieurs demandeurs attendent', () => {
  it('ne lit qu’une fois pour tous ceux qui s’y joignent', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run);
    flight.start();

    const first = flight.join();
    const second = flight.join(new AbortController().signal);
    probe.finish('résultat');

    await expect(first).resolves.toBe('résultat');
    await expect(second).resolves.toBe('résultat');
    expect(probe.runs).toBe(1);
  });

  it('ne lit rien tant qu’on ne la lance pas, et ne la lance qu’une fois', () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run);

    flight.join().catch(() => undefined);
    expect(probe.runs).toBe(0);

    flight.start();
    flight.start();
    expect(probe.runs).toBe(1);
  });

  it('transmet l’échec de la lecture à tous ceux qui l’attendent', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run);
    flight.start();
    const first = flight.join();
    const second = flight.join();

    probe.fail(new Error('base verrouillée'));

    await expect(first).rejects.toThrow('base verrouillée');
    await expect(second).rejects.toThrow('base verrouillée');
  });

  it('traite une lecture qui échoue dès son lancement (exception synchrone) comme un échec', async () => {
    const flight = new Flight<string>(() => {
      throw new Error('impossible de lancer');
    });
    flight.start();

    await expect(flight.join()).rejects.toThrow('impossible de lancer');
  });

  describe('abandon', () => {
    it('un demandeur qui part est libéré aussitôt, sans arrêter la lecture que les autres attendent', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const leaving = new AbortController();
      const staying = new AbortController();
      const gone = flight.join(leaving.signal);
      const kept = flight.join(staying.signal);

      leaving.abort();

      await expect(gone).rejects.toBeInstanceOf(ReadAborted);
      expect(probe.signal?.aborted).toBe(false);
      expect(flight.abandoned).toBe(false);
      probe.finish('pour les autres');
      await expect(kept).resolves.toBe('pour les autres');
    });

    it('le dernier demandeur qui part arrête la lecture : le signal qu’elle a reçu est abandonné', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const first = new AbortController();
      const second = new AbortController();
      const a = flight.join(first.signal);
      const b = flight.join(second.signal);

      first.abort();
      expect(probe.signal?.aborted).toBe(false);
      second.abort();

      await expect(a).rejects.toBeInstanceOf(ReadAborted);
      await expect(b).rejects.toBeInstanceOf(ReadAborted);
      expect(probe.signal?.aborted).toBe(true);
      expect(flight.abandoned).toBe(true);
    });

    it('une lecture abandonnée finit en AbortError pour qui regarde `done`, et rien n’est non géré', async () => {
      const unhandled: unknown[] = [];
      const collect = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', collect);
      try {
        const flight = new Flight((signal) => new Promise<string>((_resolve, reject) => signal.addEventListener('abort', () => reject(new ReadAborted()))));
        flight.start();
        const controller = new AbortController();
        const waiting = flight.join(controller.signal);

        controller.abort();

        await expect(waiting).rejects.toBeInstanceOf(ReadAborted);
        await expect(flight.done).rejects.toBeInstanceOf(ReadAborted);
        await settle();
      } finally {
        process.off('unhandledRejection', collect);
      }
      expect(unhandled).toEqual([]);
    });

    it('un demandeur sans signal ne part jamais : la lecture n’est pas arrêtée tant qu’il l’attend', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const patient = flight.join();
      const leaving = new AbortController();
      const gone = flight.join(leaving.signal);

      leaving.abort();

      await expect(gone).rejects.toBeInstanceOf(ReadAborted);
      expect(probe.signal?.aborted).toBe(false);
      probe.finish('fini');
      await expect(patient).resolves.toBe('fini');
    });

    it('une lecture qui n’est pas encore lancée et que tous abandonnent ne sera jamais lancée', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      const controller = new AbortController();
      const waiting = flight.join(controller.signal);

      controller.abort();
      flight.start();

      await expect(waiting).rejects.toBeInstanceOf(ReadAborted);
      await expect(flight.done).rejects.toBeInstanceOf(ReadAborted);
      expect(probe.runs).toBe(0);
      expect(flight.abandoned).toBe(true);
    });

    it('un signal déjà abandonné refuse aussitôt, sans compter comme demandeur', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const gone = new AbortController();
      gone.abort();
      const stays = flight.join();

      await expect(flight.join(gone.signal)).rejects.toBeInstanceOf(ReadAborted);

      expect(probe.signal?.aborted).toBe(false);
      probe.finish('ok');
      await expect(stays).resolves.toBe('ok');
    });

    it('un abandon après la fin de la lecture ne change rien', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const controller = new AbortController();
      const waiting = flight.join(controller.signal);
      probe.finish('fini');
      await expect(waiting).resolves.toBe('fini');

      controller.abort();

      expect(flight.abandoned).toBe(false);
      expect(probe.signal?.aborted).toBe(false);
      await expect(flight.join()).resolves.toBe('fini'); // le résultat reste servi à qui arrive ensuite
    });

    it('ne laisse aucun écouteur sur les signaux des demandeurs une fois la lecture finie', async () => {
      const { run, probe } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const controllers = [new AbortController(), new AbortController()];
      const all = controllers.map((c) => flight.join(c.signal));

      probe.finish('fini');
      await Promise.all(all);

      for (const controller of controllers) expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
    });

    it('refuse de se joindre à une lecture abandonnée : elle ne servirait personne', async () => {
      const { run } = manual<string>();
      const flight = new Flight(run);
      flight.start();
      const controller = new AbortController();
      flight.join(controller.signal).catch(() => undefined);
      controller.abort();

      expect(flight.abandoned).toBe(true);
      await expect(flight.join()).rejects.toBeInstanceOf(ReadAborted);
    });
  });
});

describe('Flight : un délai de grâce avant d’arrêter une lecture sans demandeur (bdesk-38k.20)', () => {
  // Seules les minuteries sont simulées : les promesses restent réelles.
  beforeEach(() => {
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
  });

  it('le dernier demandeur qui part est libéré aussitôt, mais la lecture n’est arrêtée qu’à l’expiration du délai', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    flight.start();
    const controller = new AbortController();
    const waiting = flight.join(controller.signal);

    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(ReadAborted);
    expect(probe.signal?.aborted).toBe(false);
    expect(flight.abandoned).toBe(false); // pendant la grâce, elle accepte encore un demandeur
    vi.advanceTimersByTime(499);
    expect(probe.signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(probe.signal?.aborted).toBe(true);
    expect(flight.abandoned).toBe(true);
  });

  it('un demandeur qui arrive pendant le délai reprend la lecture : elle n’est jamais arrêtée, ni relancée', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    flight.start();
    const leaving = new AbortController();
    const gone = flight.join(leaving.signal);
    leaving.abort();
    await expect(gone).rejects.toBeInstanceOf(ReadAborted);

    const back = flight.join(new AbortController().signal);
    expect(vi.getTimerCount()).toBe(0); // la reprise retire la minuterie du délai : il n'y a plus rien à attendre
    vi.advanceTimersByTime(60_000);

    expect(probe.signal?.aborted).toBe(false);
    expect(flight.abandoned).toBe(false);
    probe.finish('résultat');
    await expect(back).resolves.toBe('résultat');
    expect(probe.runs).toBe(1);
  });

  it('chaque départ du dernier demandeur fait repartir le délai de zéro', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    flight.start();
    const first = new AbortController();
    flight.join(first.signal).catch(() => undefined);
    first.abort();
    vi.advanceTimersByTime(300);
    const second = new AbortController();
    flight.join(second.signal).catch(() => undefined);
    vi.advanceTimersByTime(100);
    second.abort(); // le délai repart ici, à 400 ms du premier départ

    vi.advanceTimersByTime(499);
    expect(probe.signal?.aborted).toBe(false);
    vi.advanceTimersByTime(1);
    expect(probe.signal?.aborted).toBe(true);
  });

  it('une lecture finie pendant le délai n’est pas arrêtée à son expiration, et sert encore qui arrive ensuite', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    flight.start();
    const controller = new AbortController();
    flight.join(controller.signal).catch(() => undefined);
    controller.abort();

    probe.finish('fini');
    await settleMicrotasks();
    vi.advanceTimersByTime(10_000);

    expect(flight.abandoned).toBe(false);
    expect(probe.signal?.aborted).toBe(false);
    await expect(flight.join()).resolves.toBe('fini');
  });

  it('ne laisse aucune minuterie une fois la lecture finie', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    flight.start();
    const controller = new AbortController();
    flight.join(controller.signal).catch(() => undefined);
    controller.abort();
    expect(vi.getTimerCount()).toBe(1);

    probe.finish('fini');
    await settleMicrotasks();

    expect(vi.getTimerCount()).toBe(0);
  });

  it('une lecture pas encore lancée, abandonnée jusqu’à l’expiration du délai, ne sera jamais lancée', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 500 });
    const controller = new AbortController();
    flight.join(controller.signal).catch(() => undefined);
    controller.abort();
    vi.advanceTimersByTime(500);

    flight.start();

    expect(probe.runs).toBe(0);
    expect(flight.abandoned).toBe(true);
    await expect(flight.done).rejects.toBeInstanceOf(ReadAborted);
  });

  it('sans délai de grâce (le défaut), le dernier départ arrête la lecture aussitôt', async () => {
    const { run, probe } = manual<string>();
    const flight = new Flight(run, { graceMs: 0 });
    flight.start();
    const controller = new AbortController();
    flight.join(controller.signal).catch(() => undefined);

    controller.abort();

    expect(probe.signal?.aborted).toBe(true);
    expect(flight.abandoned).toBe(true);
    expect(vi.getTimerCount()).toBe(0);
  });
});

const settleMicrotasks = async () => {
  for (let i = 0; i < 5; i++) await Promise.resolve();
};
