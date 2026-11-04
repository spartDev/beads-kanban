import { describe, expect, it } from 'vitest';
import type { TicketHistory } from '../../domain/flow';
import type { Issue } from '../../shared/api';
import { IssueNotFoundError, ProjectNotFoundError, type ProjectService, ProjectUnreadableError } from '../projects/service';
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
