import { describe, expect, it } from 'vitest';
import type { TicketHistory } from '../../domain/flow';
import type { Issue } from '../../shared/api';
import { ReadAborted } from '../abort';
import { ANALYSIS_GRACE_MS } from '../flight';
import { IssueNotFoundError, ProjectNotFoundError, type ProjectService, ProjectUnreadableError, type ReadOptions } from '../projects/service';
import { createChronologyService } from './service';

const at = (iso: string) => new Date(`${iso}Z`);

function history(id: string, statuses: [string, string][]): TicketHistory {
  return { id, type: 'task', statusSnapshots: statuses.map(([status, when]) => ({ status, at: at(when) })), dependencies: [] };
}

const DELIVERED = history('t-1', [
  ['open', '2026-10-01T09:00'],
  ['in_progress', '2026-10-02T09:00'],
  ['closed', '2026-10-03T21:00'],
]);

function issue(id: string, extra: Partial<Issue> = {}): Issue {
  return {
    id,
    title: id,
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: null,
    parentId: null,
    createdAt: '2026-10-01T09:00:00.000Z',
    updatedAt: '2026-10-01T09:00:00.000Z',
    closedAt: null,
    blockedBy: [],
    ...extra,
  };
}

/** Un faux accès aux Projets : compte les lectures de l'historique et de HEAD. */
function fakeProjects(overrides: Partial<ProjectService> = {}) {
  const calls = { histories: 0, head: 0, issues: 0 };
  const state = { head: 'h1', histories: [DELIVERED] as TicketHistory[], issues: [] as Issue[] };
  const service: ProjectService = {
    list: async () => ({ projects: [], ignored: [] }),
    issue: async () => {
      throw new Error('inutile');
    },
    issues: async () => {
      calls.issues++;
      return state.issues;
    },
    histories: async () => {
      calls.histories++;
      return state.histories;
    },
    head: async () => {
      calls.head++;
      return state.head;
    },
    ...overrides,
  };
  return { service, calls, state };
}

describe('chronologie d’un ticket', () => {
  it('se construit depuis l’historique du Projet', async () => {
    const { service } = fakeProjects();

    const chronology = await createChronologyService(service).chronology('p', 't-1');

    expect(chronology).toMatchObject({
      source: 'history',
      leadTime: 2.5 * 24 * 3_600_000,
      outcome: { kind: 'delivered', at: '2026-10-03T21:00:00.000Z' },
    });
    expect(chronology.transitions.map((t) => t.status)).toEqual(['open', 'in_progress', 'closed']);
  });

  it('ne relit l’historique que lorsque le HEAD du Projet a changé', async () => {
    const { service, calls, state } = fakeProjects();
    const chronologies = createChronologyService(service);

    await chronologies.chronology('p', 't-1');
    await chronologies.chronology('p', 't-1');
    await chronologies.chronology('p', 't-1');
    expect(calls.histories).toBe(1);
    expect(calls.head).toBe(3); // HEAD est relu à chaque demande : c'est lui qui dit si le résultat est périmé

    state.head = 'h2';
    await chronologies.chronology('p', 't-1');
    expect(calls.histories).toBe(2);
  });

  it('tient une analyse par Projet', async () => {
    const { service, calls } = fakeProjects();
    const chronologies = createChronologyService(service);

    await chronologies.chronology('p', 't-1');
    await chronologies.chronology('q', 't-1');
    await chronologies.chronology('p', 't-1');

    expect(calls.histories).toBe(2);
  });

  it('partage une lecture en cours entre des demandes simultanées', async () => {
    const { service, calls } = fakeProjects();
    const chronologies = createChronologyService(service);

    await Promise.all(Array.from({ length: 6 }, () => chronologies.chronology('p', 't-1')));

    expect(calls.histories).toBe(1);
  });

  describe('la lecture de HEAD : jamais plus de deux à la fois par Projet', () => {
    // Chaque demande lit HEAD pour savoir si son résultat est périmé. Une lecture est un processus dolt, qui attend son tour dans la
    // file des lectures du serveur (6 à la fois) : 30 demandes ensemble ne doivent pas y mettre 30 lectures de HEAD.
    it('fait partager une seule lecture de HEAD à toutes les demandes arrivées pendant la précédente', async () => {
      const { service, calls } = fakeProjects();
      const chronologies = createChronologyService(service);

      await Promise.all(Array.from({ length: 30 }, () => chronologies.chronology('p', 't-1')));

      expect(calls.head).toBe(2); // une lecture en cours, une pour toutes celles qui attendaient
      expect(calls.histories).toBe(1);
    });

    it('sert chaque demande par une lecture lancée après son arrivée : un commit tombé pendant une lecture n’est pas manqué', async () => {
      const state = { head: 'h1', histories: [DELIVERED] };
      const reads: string[] = [];
      let release = () => {};
      const gate = new Promise<void>((resolve) => {
        release = resolve;
      });
      const { service } = fakeProjects({
        head: async () => {
          const seen = state.head; // ce que dolt répond à l'instant où la lecture part
          reads.push(seen);
          if (reads.length === 2) await gate; // la seconde lecture traîne dans la file
          return seen;
        },
        histories: async () => state.histories,
      });
      const chronologies = createChronologyService(service);
      await chronologies.chronology('p', 't-1'); // l'analyse de h1 est en cache : le ticket est livré

      const slow = chronologies.chronology('p', 't-1'); // sa lecture part à h1 et traîne
      state.head = 'h2'; // un commit tombe : le ticket est rouvert
      state.histories = [history('t-1', [['open', '2026-10-01T09:00'], ['closed', '2026-10-03T21:00'], ['open', '2026-10-04T09:00']])];
      const after = chronologies.chronology('p', 't-1'); // arrive après le commit : elle ne doit pas prendre la lecture d'avant
      release();

      await slow;
      expect((await after).outcome.kind).toBe('open');
      expect(reads).toEqual(['h1', 'h1', 'h2']);
    });

    it('ne fait pas payer à la demande qui attend la suivante l’échec d’une lecture', async () => {
      let attempts = 0;
      const { service } = fakeProjects({
        head: async () => {
          if (attempts++ === 0) throw new ProjectUnreadableError('p', 'Base Dolt verrouillée');
          return 'h1';
        },
      });
      const chronologies = createChronologyService(service);

      const first = chronologies.chronology('p', 't-1');
      const second = chronologies.chronology('p', 't-1');

      await expect(first).rejects.toBeInstanceOf(ProjectUnreadableError);
      await expect(second).resolves.toMatchObject({ source: 'history' });
    });
  });

  it('ne garde pas un échec : la demande suivante relit l’historique', async () => {
    let failing = true;
    const { service, calls } = fakeProjects({
      histories: async () => {
        if (failing) throw new ProjectUnreadableError('p', 'Base Dolt verrouillée');
        return [DELIVERED];
      },
    });
    const chronologies = createChronologyService(service);

    await expect(chronologies.chronology('p', 't-1')).rejects.toBeInstanceOf(ProjectUnreadableError);
    failing = false;

    await expect(chronologies.chronology('p', 't-1')).resolves.toMatchObject({ source: 'history' });
    expect(calls.head).toBe(2);
  });

  it('laisse passer les erreurs d’accès au Projet : inconnu, illisible', async () => {
    const unknown = fakeProjects({
      head: async () => {
        throw new ProjectNotFoundError('x');
      },
    }).service;
    const unreadable = fakeProjects({
      head: async () => {
        throw new ProjectUnreadableError('x', 'Base verrouillée');
      },
    }).service;

    await expect(createChronologyService(unknown).chronology('x', 't-1')).rejects.toBeInstanceOf(ProjectNotFoundError);
    await expect(createChronologyService(unreadable).chronology('x', 't-1')).rejects.toBeInstanceOf(ProjectUnreadableError);
  });

  it('refuse un ticket qui n’est pas dans le Projet', async () => {
    const { service } = fakeProjects();

    await expect(createChronologyService(service).chronology('p', 'inconnu')).rejects.toBeInstanceOf(IssueNotFoundError);
  });

  it('se rabat sur les dates du ticket quand l’historique ne le connaît pas', async () => {
    const { service, state } = fakeProjects();
    state.histories = [history('t-2', [])];
    state.issues = [issue('t-2', { status: 'closed', closedAt: '2026-10-04T10:00:00.000Z' })];

    const chronology = await createChronologyService(service).chronology('p', 't-2');

    expect(chronology).toMatchObject({
      source: 'dates',
      leadTime: 3 * 24 * 3_600_000 + sixtyMinutes(),
      outcome: { kind: 'closed', at: '2026-10-04T10:00:00.000Z' },
    });
  });

  it('ne date la clôture que d’un ticket fermé : une date de clôture restée sur un ticket rouvert ne compte pas', async () => {
    const { service, state } = fakeProjects();
    state.histories = [history('t-2', [])];
    state.issues = [issue('t-2', { status: 'open', closedAt: '2026-10-04T10:00:00.000Z' })];

    const chronology = await createChronologyService(service).chronology('p', 't-2');

    expect(chronology).toMatchObject({ source: 'dates', outcome: { kind: 'open' }, leadTime: null });
  });

  it('refuse aussi un ticket sans historique qui n’existe pas non plus dans le Projet', async () => {
    const { service, state } = fakeProjects();
    state.histories = [history('t-2', [])];
    state.issues = [];

    await expect(createChronologyService(service).chronology('p', 't-9')).rejects.toBeInstanceOf(IssueNotFoundError);
  });
});

const sixtyMinutes = () => 60 * 60_000;

describe('chronologie abandonnée par son demandeur (bdesk-38k.20)', () => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

  /** Une lecture de l'historique que le test finit à la main ; elle garde le signal reçu et finit en AbortError quand il est abandonné. */
  function slowHistories() {
    const probe = { reads: 0, signals: [] as (AbortSignal | undefined)[], finish: (() => {}) as (histories?: TicketHistory[]) => void };
    const histories = (_projectId: string, options?: ReadOptions) =>
      new Promise<TicketHistory[]>((resolve, reject) => {
        probe.reads++;
        probe.signals.push(options?.signal);
        probe.finish = (value = [DELIVERED]) => resolve(value);
        options?.signal?.addEventListener('abort', () => reject(new ReadAborted()));
      });
    return { histories, probe };
  }

  it('libère aussitôt une demande dont le client est parti, sans attendre l’historique', async () => {
    const { histories } = slowHistories();
    const { service } = fakeProjects({ histories });
    const controller = new AbortController();
    const waiting = createChronologyService(service).chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10); // HEAD lu, l'historique est en cours

    controller.abort();

    expect(await waiting).toBeInstanceOf(ReadAborted);
  });

  it('donne à la lecture de l’historique un signal qui s’abandonne quand son seul demandeur part (sans délai de grâce)', async () => {
    const { histories, probe } = slowHistories();
    const { service } = fakeProjects({ histories });
    const controller = new AbortController();
    const waiting = createChronologyService(service, { graceMs: 0 }).chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    expect(probe.signals[0]?.aborted).toBe(false);

    controller.abort();
    await waiting;

    expect(probe.signals[0]?.aborted).toBe(true);
  });

  it('ne l’abandonne pas tant qu’une autre demande attend la même analyse : la lecture est partagée, et finit pour elle', async () => {
    const { histories, probe } = slowHistories();
    const { service } = fakeProjects({ histories });
    const chronologies = createChronologyService(service);
    const leaving = new AbortController();
    const gone = chronologies.chronology('p', 't-1', { signal: leaving.signal }).catch((e: unknown) => e);
    const stays = chronologies.chronology('p', 't-1', { signal: new AbortController().signal });
    await sleep(10);

    leaving.abort();
    expect(await gone).toBeInstanceOf(ReadAborted);
    expect(probe.signals[0]?.aborted).toBe(false);
    probe.finish();

    await expect(stays).resolves.toMatchObject({ source: 'history' });
    expect(probe.reads).toBe(1);
  });

  it('une analyse abandonnée n’est pas gardée en cache : la demande suivante, au même HEAD, relit l’historique (sans délai de grâce)', async () => {
    const { histories, probe } = slowHistories();
    const { service } = fakeProjects({ histories });
    const chronologies = createChronologyService(service, { graceMs: 0 });
    const controller = new AbortController();
    const abandoned = chronologies.chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    controller.abort();
    await abandoned;

    const next = chronologies.chronology('p', 't-1');
    await sleep(10);
    probe.finish();

    await expect(next).resolves.toMatchObject({ source: 'history' });
    expect(probe.reads).toBe(2);
    expect(probe.signals[1]?.aborted).toBe(false);
  });

  it('une lecture abandonnée qui met du temps à mourir ne fait pas échouer la demande suivante : elle en lance une autre', async () => {
    let reads = 0;
    const { service } = fakeProjects({
      histories: async () => {
        reads++;
        // La première lecture ne réagit pas à l'abandon (son processus met du temps à mourir) : elle ne finit pas.
        if (reads === 1) return new Promise<TicketHistory[]>(() => undefined);
        return [DELIVERED];
      },
    });
    const chronologies = createChronologyService(service, { graceMs: 0 });
    const controller = new AbortController();
    const abandoned = chronologies.chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    controller.abort();
    expect(await abandoned).toBeInstanceOf(ReadAborted);

    await expect(chronologies.chronology('p', 't-1')).resolves.toMatchObject({ source: 'history' });

    expect(reads).toBe(2);
  });

  describe('délai de grâce (bdesk-38k.20, r5) : une analyse abandonnée puis redemandée juste après n’est pas relancée', () => {
    it('la demande qui arrive dans le délai reprend l’analyse en cours : une seule lecture de l’historique', async () => {
      const { histories, probe } = slowHistories();
      const { service } = fakeProjects({ histories });
      const chronologies = createChronologyService(service, { graceMs: 300 });
      const leaving = new AbortController();
      const gone = chronologies.chronology('p', 't-1', { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10); // HEAD lu, l'historique est en cours
      leaving.abort();
      expect(await gone).toBeInstanceOf(ReadAborted); // libérée aussitôt, grâce ou non

      const back = chronologies.chronology('p', 't-1'); // le ticket suivant du parcours, quelques millisecondes plus tard
      await sleep(10);
      expect(probe.signals[0]?.aborted).toBe(false);
      probe.finish();

      await expect(back).resolves.toMatchObject({ source: 'history' });
      expect(probe.reads).toBe(1);
    });

    it('par défaut, le service retient l’abandon pendant ANALYSIS_GRACE_MS : la lecture n’est pas abandonnée aussitôt', async () => {
      const { histories, probe } = slowHistories();
      const { service } = fakeProjects({ histories });
      const controller = new AbortController();
      const abandoned = createChronologyService(service).chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);

      controller.abort();
      await abandoned;
      await sleep(60);

      expect(ANALYSIS_GRACE_MS).toBeGreaterThan(60);
      expect(probe.signals[0]?.aborted).toBe(false);
    });

    it('sans nouvelle demande à l’expiration du délai, la lecture de l’historique est abandonnée', async () => {
      const { histories, probe } = slowHistories();
      const { service } = fakeProjects({ histories });
      const chronologies = createChronologyService(service, { graceMs: 120 });
      const controller = new AbortController();
      const abandoned = chronologies.chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);

      controller.abort();
      await abandoned;
      await sleep(30);
      expect(probe.signals[0]?.aborted).toBe(false); // pendant la grâce
      await sleep(200);

      expect(probe.signals[0]?.aborted).toBe(true); // après
    });

    it('une demande qui arrive après le délai relit l’historique', async () => {
      const { histories, probe } = slowHistories();
      const { service } = fakeProjects({ histories });
      const chronologies = createChronologyService(service, { graceMs: 40 });
      const controller = new AbortController();
      const abandoned = chronologies.chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);
      controller.abort();
      await abandoned;
      await sleep(150);

      const next = chronologies.chronology('p', 't-1');
      await sleep(10);
      probe.finish();

      await expect(next).resolves.toMatchObject({ source: 'history' });
      expect(probe.reads).toBe(2);
    });

    it('un parcours rapide (le ticket précédent abandonné, le suivant demandé aussitôt) ne relance l’historique qu’une fois', async () => {
      const { histories, probe } = slowHistories();
      const { service } = fakeProjects({ histories });
      const chronologies = createChronologyService(service, { graceMs: 300 });
      let previous: AbortController | undefined;
      const requests: Promise<unknown>[] = [];
      for (let i = 0; i < 20; i++) {
        previous?.abort();
        previous = new AbortController();
        requests.push(chronologies.chronology('p', 't-1', { signal: previous.signal }).catch((e: unknown) => e));
        await sleep(15);
      }

      probe.finish(); // l'utilisateur s'arrête sur le dernier ticket
      await expect(requests[19]).resolves.toMatchObject({ source: 'history' });
      expect(probe.reads).toBe(1);
    });
  });

  it('se détache d’une lecture de HEAD en cours sans l’interrompre : les autres demandes la partagent', async () => {
    let releaseHead: (head: string) => void = () => {};
    const gate = new Promise<string>((resolve) => {
      releaseHead = resolve;
    });
    const { service, calls } = fakeProjects({ head: () => gate });
    const chronologies = createChronologyService(service);
    const leaving = new AbortController();
    const gone = chronologies.chronology('p', 't-1', { signal: leaving.signal }).catch((e: unknown) => e);
    const stays = chronologies.chronology('p', 't-1');
    await sleep(10);

    leaving.abort();
    expect(await gone).toBeInstanceOf(ReadAborted); // sans attendre le HEAD
    releaseHead('h1');

    await expect(stays).resolves.toMatchObject({ source: 'history' });
    expect(calls.histories).toBe(1);
  });

  it('un signal déjà abandonné ne lit rien, pas même le HEAD', async () => {
    const { service, calls } = fakeProjects();
    const controller = new AbortController();
    controller.abort();

    await expect(createChronologyService(service).chronology('p', 't-1', { signal: controller.signal })).rejects.toBeInstanceOf(ReadAborted);

    expect(calls).toEqual({ histories: 0, head: 0, issues: 0 });
  });

  it('donne son signal à la lecture des tickets quand l’historique ne connaît pas le ticket', async () => {
    const seen: (AbortSignal | undefined)[] = [];
    const { service, state } = fakeProjects({
      issues: async (_projectId, options) => {
        seen.push(options?.signal);
        return [issue('t-2')];
      },
    });
    state.histories = [history('t-2', [])];
    const controller = new AbortController();

    await createChronologyService(service).chronology('p', 't-2', { signal: controller.signal });

    expect(seen).toEqual([controller.signal]);
  });

  it('un abandon n’est pas une panne : il n’est pas gardé comme un échec du Projet', async () => {
    const { histories } = slowHistories();
    const { service } = fakeProjects({ histories });
    const controller = new AbortController();
    const waiting = createChronologyService(service).chronology('p', 't-1', { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);

    controller.abort();
    const error = await waiting;

    expect(error).not.toBeInstanceOf(ProjectUnreadableError);
  });
});
