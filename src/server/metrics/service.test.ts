import { afterEach, describe, expect, it, vi } from 'vitest';
import { InvalidPeriodError } from '../../domain/calendar';
import type { StatusSnapshot, TicketHistory } from '../../domain/flow';
import type { Issue, Project } from '../../shared/api';
import { ReadAborted } from '../abort';
import { ANALYSIS_GRACE_MS } from '../flight';
import { ProjectNotFoundError, type ProjectService, ProjectUnreadableError, type ReadOptions } from '../projects/service';
import { createMetricsService } from './service';

const NOW = new Date('2026-10-23T18:00:00Z'); // vendredi 23 octobre 2026, 20:00 à Paris
const at = (iso: string) => new Date(`${iso}Z`);
const DAY = 86_400_000;

/** Un ticket fermé : créé puis fermé, donc une Livraison. */
function delivered(id: string, created: string, closedAt: string): TicketHistory {
  const snapshots: StatusSnapshot[] = [
    { status: 'open', at: at(created) },
    { status: 'closed', at: at(closedAt) },
  ];
  return { id, type: 'task', statusSnapshots: snapshots, dependencies: [] };
}

const issueOf = (id: string, title = `Titre de ${id}`, priority = 2): Issue => ({
  id,
  title,
  type: 'task',
  status: 'closed',
  priority,
  assignee: null,
  parentId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  closedAt: null,
  blockedBy: [],
});

interface FakeProject {
  name?: string;
  status?: 'ok' | 'unreadable';
  reason?: string;
  head?: string;
  histories?: TicketHistory[];
  issues?: Issue[];
  /** Fait échouer la lecture de l'historique. */
  failure?: Error;
  /** Retarde la lecture de l'historique. */
  delayMs?: number;
  /** Retarde la réponse sur HEAD ; HEAD est lu au début de l'appel, comme le fait une vraie lecture. */
  headDelayMs?: number;
}

/** Un service de Projets factice, qui compte les lectures. `world` peut changer entre deux appels. */
function fakeProjects(world: Record<string, FakeProject>) {
  const calls = { list: 0, head: [] as string[], issues: [] as string[], histories: [] as string[] };
  const find = (id: string): FakeProject => {
    const project = world[id];
    if (!project) throw new ProjectNotFoundError(id);
    if (project.status === 'unreadable') throw new ProjectUnreadableError(id, project.reason ?? 'illisible');
    return project;
  };
  const service: ProjectService = {
    async list() {
      calls.list++;
      const projects = Object.entries(world).map(([id, p]): Project => {
        const base: Project = { id, name: p.name ?? `Nom de ${id}`, path: `/p/${id}`, prefix: id, mode: 'embedded', status: p.status ?? 'ok' };
        return p.status === 'unreadable' ? { ...base, reason: p.reason ?? 'illisible' } : base;
      });
      return { projects, ignored: [] };
    },
    async head(id) {
      calls.head.push(id);
      const project = find(id);
      const head = project.head ?? 'h1';
      if (project.headDelayMs) await new Promise((resolve) => setTimeout(resolve, project.headDelayMs));
      return head;
    },
    async issues(id) {
      calls.issues.push(id);
      return find(id).issues ?? [];
    },
    async histories(id) {
      calls.histories.push(id);
      const project = find(id);
      if (project.delayMs) await new Promise((resolve) => setTimeout(resolve, project.delayMs));
      if (project.failure) throw project.failure;
      return project.histories ?? [];
    },
    async issue() {
      throw new Error('inutile ici');
    },
  };
  return { service, calls };
}

const options = { now: () => NOW, timeZone: 'Europe/Paris' };
const week = { period: { range: '7d' as const } };

/** Deux Projets : a livre deux tickets (2 j et 4 j), b en livre un (10 j). */
const twoProjects = (): Record<string, FakeProject> => ({
  a: {
    histories: [delivered('a-1', '2026-10-18T12:00', '2026-10-20T12:00'), delivered('a-2', '2026-10-16T12:00', '2026-10-20T13:00')],
    issues: [issueOf('a-1', 'Premier', 1), issueOf('a-2')],
  },
  b: { histories: [delivered('b-1', '2026-10-11T12:00', '2026-10-21T12:00')], issues: [issueOf('b-1')] },
});

describe('service de métriques', () => {
  afterEach(() => vi.unstubAllEnvs());

  it('mesure la Vue globale : tous les Projets lisibles, dans l’ordre de la liste, sur l’union de leurs Livraisons', async () => {
    const { service } = fakeProjects(twoProjects());

    const response = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(response.projects).toEqual([
      { id: 'a', name: 'Nom de a' },
      { id: 'b', name: 'Nom de b' },
    ]);
    expect(response.unreadable).toEqual([]);
    expect(response.tiles.throughput.total).toBe(3);
    // Union de a (2 j, 4 j + 1 h) et b (10 j) : trois Lead Times, la médiane est celui du milieu
    expect(response.tiles.leadTime.n).toBe(3);
    expect(response.tiles.leadTime.median).toBe(4 * DAY + 1 * 3_600_000);
    expect(response.slices.project.map((s) => [s.key, s.throughput])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
  });

  it('garde l’ordre de la liste des Projets même quand leurs lectures aboutissent dans le désordre', async () => {
    const world = twoProjects();
    world.a = { ...world.a, delayMs: 40 }; // a, le premier de la liste, est lu en dernier
    world.verrou = { name: 'Verrou', failure: new ProjectUnreadableError('verrou', 'base verrouillée'), delayMs: 0 };
    world.zzz = { name: 'ZZZ', status: 'unreadable', reason: 'absent' };
    const { service } = fakeProjects(world);

    const response = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(response.projects.map((p) => p.id)).toEqual(['a', 'b']);
    expect(response.slices.project.map((s) => s.key)).toEqual(['a', 'b']);
    expect(response.unreadable.map((p) => p.id)).toEqual(['verrou', 'zzz']);
  });

  it('date la réponse et donne le fuseau des jours', async () => {
    const { service } = fakeProjects(twoProjects());

    const response = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(response.generatedAt).toBe(NOW.toISOString());
    expect(response.timeZone).toBe('Europe/Paris');
    expect(response.period).toMatchObject({ from: '2026-10-17', to: '2026-10-23' });
  });

  it('mesure la période en cours jusqu’à maintenant : une Livraison que l’historique date plus tard n’est pas encore arrivée', async () => {
    const world = twoProjects();
    // a-3 est fermé à 20:00Z, 2 h après NOW et avant minuit : l'horloge de ce commit avance sur celle du serveur
    world.a = {
      ...world.a,
      histories: [...(world.a?.histories ?? []), delivered('a-3', '2026-10-22T08:00', '2026-10-23T20:00')],
      issues: [...(world.a?.issues ?? []), issueOf('a-3')],
    };
    const { service } = fakeProjects(world);

    const response = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(response.asOf).toBe(NOW.toISOString());
    expect(response.tiles.throughput.total).toBe(3); // a-1, a-2 et b-1, pas a-3
    expect(response.slices.project.map((s) => [s.key, s.throughput])).toEqual([
      ['a', 2],
      ['b', 1],
    ]);
    expect(response.buckets.at(-1)).toMatchObject({ from: '2026-10-23', deliveries: 0 });
  });

  it('prend par défaut le fuseau local du serveur', async () => {
    vi.stubEnv('TZ', 'Asia/Tokyo'); // celui que le moteur donne, quel que soit le fuseau de la machine (et même un TZ vide : voir unknown-time-zone.test.ts)
    const { service } = fakeProjects(twoProjects());

    const response = await createMetricsService(service, { now: () => NOW }).compute({ projects: [], ...week });

    expect(response.timeZone).toBe('Asia/Tokyo');
  });

  it('ne mesure que les Projets demandés', async () => {
    const { service } = fakeProjects(twoProjects());

    const response = await createMetricsService(service, options).compute({ projects: ['b'], ...week });

    expect(response.projects).toEqual([{ id: 'b', name: 'Nom de b' }]);
    expect(response.tiles.throughput.total).toBe(1);
  });

  it('mesure ensemble plusieurs Projets demandés, sans compter deux fois un Projet répété', async () => {
    const { service, calls } = fakeProjects(twoProjects());

    const response = await createMetricsService(service, options).compute({ projects: ['b', 'a', 'b'], ...week });

    expect(response.projects.map((p) => p.id)).toEqual(['a', 'b']); // dans l'ordre de la liste, pas celui de la demande
    expect(response.tiles.throughput.total).toBe(3);
    expect(calls.histories.sort()).toEqual(['a', 'b']);
  });

  it('refuse un Projet inconnu, sans rien lire', async () => {
    const { service, calls } = fakeProjects(twoProjects());

    await expect(createMetricsService(service, options).compute({ projects: ['a', 'nope'], ...week })).rejects.toBeInstanceOf(ProjectNotFoundError);
    expect(calls.histories).toEqual([]);
  });

  it('refuse une période invalide avant de lire quoi que ce soit', async () => {
    const { service, calls } = fakeProjects(twoProjects());

    await expect(
      createMetricsService(service, options).compute({ projects: [], period: { from: '2026-10-23', to: '2026-10-01' } }),
    ).rejects.toBeInstanceOf(InvalidPeriodError);
    expect(calls.list).toBe(0);
    expect(calls.head).toEqual([]);
  });

  describe('Projets illisibles', () => {
    it('liste dans la réponse un Projet que la découverte sait illisible, sans faire échouer le reste', async () => {
      const { service, calls } = fakeProjects({
        ...twoProjects(),
        hcp: { status: 'unreadable', reason: 'Base Dolt absente de ce poste', name: 'HCP' },
      });

      const response = await createMetricsService(service, options).compute({ projects: [], ...week });

      expect(response.unreadable).toEqual([{ id: 'hcp', name: 'HCP', reason: 'Base Dolt absente de ce poste' }]);
      expect(response.projects.map((p) => p.id)).toEqual(['a', 'b']);
      expect(response.tiles.throughput.total).toBe(3);
      expect(calls.head).not.toContain('hcp'); // inutile d'interroger ce qu'on sait illisible
    });

    it('liste un Projet dont la lecture échoue pendant le calcul', async () => {
      const { service } = fakeProjects({
        ...twoProjects(),
        verrou: { name: 'Verrou', failure: new ProjectUnreadableError('verrou', 'base verrouillée par un autre processus') },
      });

      const response = await createMetricsService(service, options).compute({ projects: [], ...week });

      expect(response.unreadable).toEqual([{ id: 'verrou', name: 'Verrou', reason: 'base verrouillée par un autre processus' }]);
      expect(response.tiles.throughput.total).toBe(3);
    });

    it('rend une réponse vide mais valide quand le seul Projet demandé est illisible', async () => {
      const { service } = fakeProjects({ hcp: { status: 'unreadable', reason: 'Base absente', name: 'HCP' } });

      const response = await createMetricsService(service, options).compute({ projects: ['hcp'], ...week });

      expect(response.projects).toEqual([]);
      expect(response.unreadable).toEqual([{ id: 'hcp', name: 'HCP', reason: 'Base absente' }]);
      expect(response.tiles.throughput.total).toBe(0);
      expect(response.cfd).toHaveLength(7);
    });

    describe('Projet qui disparaît pendant le calcul', () => {
      // La liste des Projets est rendue (la première fois), puis le dossier disparaît (supprimé, déplacé, masqué) avant la lecture.
      const vanishingAfterList = (world: Record<string, FakeProject>, id: string): ProjectService => {
        const { service } = fakeProjects(world);
        let vanished = false;
        return {
          ...service,
          async list() {
            const listed = await service.list();
            if (!vanished) delete world[id];
            vanished = true;
            return listed;
          },
        };
      };

      it('le traite en Projet illisible dans la Vue globale, au lieu de répondre « Projet inconnu »', async () => {
        const world = twoProjects();

        const response = await createMetricsService(vanishingAfterList(world, 'b'), options).compute({ projects: [], ...week });

        expect(response.projects.map((p) => p.id)).toEqual(['a']);
        expect(response.unreadable).toEqual([{ id: 'b', name: 'Nom de b', reason: expect.stringContaining('disparu') }]);
        expect(response.tiles.throughput.total).toBe(2); // les deux Livraisons de a
      });

      it('le traite de même quand il est demandé explicitement : il était connu au début de la demande', async () => {
        const world = twoProjects();

        const response = await createMetricsService(vanishingAfterList(world, 'b'), options).compute({ projects: ['b'], ...week });

        expect(response.projects).toEqual([]);
        expect(response.unreadable.map((p) => p.id)).toEqual(['b']);
        expect(response.tiles.throughput.total).toBe(0);
      });

      it('le traite de même quand il disparaît après la lecture de HEAD, entre HEAD et la lecture de l’historique', async () => {
        const world = twoProjects();
        const { service } = fakeProjects(world);
        const racing: ProjectService = {
          ...service,
          async head(id) {
            const head = await service.head(id);
            if (id === 'b') delete world.b;
            return head;
          },
        };

        const response = await createMetricsService(racing, options).compute({ projects: [], ...week });

        expect(response.projects.map((p) => p.id)).toEqual(['a']);
        expect(response.unreadable.map((p) => p.id)).toEqual(['b']);
      });

      it('ne garde rien de la disparition : le Projet revenu est mesuré à la requête suivante', async () => {
        const world = twoProjects();
        const b = world.b;
        const metrics = createMetricsService(vanishingAfterList(world, 'b'), options);
        await metrics.compute({ projects: [], ...week });

        if (b) world.b = b;
        const after = await metrics.compute({ projects: [], ...week });

        expect(after.projects.map((p) => p.id)).toEqual(['a', 'b']);
        expect(after.unreadable).toEqual([]);
      });

      it('répond toujours « Projet inconnu » pour un Projet que la liste ne connaissait pas', async () => {
        const { service } = fakeProjects(twoProjects());

        await expect(createMetricsService(service, options).compute({ projects: ['nope'], ...week })).rejects.toBeInstanceOf(ProjectNotFoundError);
      });
    });

    it('laisse passer une erreur qui n’est pas une lecture impossible : c’est un bogue', async () => {
      const { service } = fakeProjects({ ...twoProjects(), casse: { failure: new TypeError('boum') } });

      await expect(createMetricsService(service, options).compute({ projects: [], ...week })).rejects.toThrow('boum');
    });
  });

  describe('titre et priorité', () => {
    it('joint le titre et la priorité courants de chaque ticket à son historique', async () => {
      const { service } = fakeProjects({
        a: {
          histories: [
            {
              id: 'a-1',
              type: 'bug',
              statusSnapshots: [
                { status: 'open', at: at('2026-10-18T12:00') },
                { status: 'in_progress', at: at('2026-10-19T12:00') },
                { status: 'closed', at: at('2026-10-20T12:00') },
              ],
              dependencies: [],
            },
          ],
          issues: [issueOf('a-1', 'Un titre précis', 0)],
        },
      });

      const response = await createMetricsService(service, options).compute({ projects: ['a'], ...week });

      expect(response.cycleTimeScatter).toEqual([
        { id: 'a-1', title: 'Un titre précis', type: 'bug', priority: 0, project: 'a', deliveredAt: '2026-10-20T12:00:00.000Z', cycleTime: DAY },
      ]);
      expect(response.tiles.recoveryTime.n).toBe(1); // P0 et bug : un bug critique livré
    });

    it('ignore un ticket de l’historique que les tickets courants ne connaissent plus', async () => {
      const { service } = fakeProjects({
        a: { histories: [delivered('a-1', '2026-10-18T12:00', '2026-10-20T12:00'), delivered('a-fantome', '2026-10-18T12:00', '2026-10-20T12:00')], issues: [issueOf('a-1')] },
      });

      const response = await createMetricsService(service, options).compute({ projects: ['a'], ...week });

      expect(response.tiles.throughput.total).toBe(1);
    });
  });

  describe('cache : clé = Projet + HEAD Dolt', () => {
    it('ne relit pas l’historique tant que HEAD ne change pas, mais interroge HEAD à chaque requête', async () => {
      const { service, calls } = fakeProjects(twoProjects());
      const metrics = createMetricsService(service, options);

      await metrics.compute({ projects: [], ...week });
      await metrics.compute({ projects: [], ...week });
      await metrics.compute({ projects: ['a'], period: { range: '30d' } });

      expect(calls.histories.sort()).toEqual(['a', 'b']); // une lecture par Projet, pour trois requêtes
      expect(calls.issues.sort()).toEqual(['a', 'b']);
      expect(calls.head).toHaveLength(5); // 2 + 2 + 1 : HEAD est relu à chaque requête, c'est lui qui invalide
    });

    it('relit l’historique d’un Projet quand HEAD change, sans toucher aux autres', async () => {
      const world = twoProjects();
      const { service, calls } = fakeProjects(world);
      const metrics = createMetricsService(service, options);
      await metrics.compute({ projects: [], ...week });

      world.a = { ...world.a, head: 'h2', histories: [delivered('a-3', '2026-10-18T12:00', '2026-10-19T12:00')], issues: [issueOf('a-3')] };
      const response = await metrics.compute({ projects: [], ...week });

      expect(calls.histories.sort()).toEqual(['a', 'a', 'b']);
      expect(response.tiles.throughput.total).toBe(2); // a-3 et b-1 : le nouvel historique de a remplace l'ancien
    });

    it('partage le calcul en cours entre des requêtes simultanées', async () => {
      const world = twoProjects();
      world.a = { ...world.a, delayMs: 30 };
      const { service, calls } = fakeProjects(world);
      const metrics = createMetricsService(service, options);

      const responses = await Promise.all(Array.from({ length: 5 }, () => metrics.compute({ projects: [], ...week })));

      expect(calls.histories.sort()).toEqual(['a', 'b']);
      expect(new Set(responses.map((r) => r.tiles.throughput.total))).toEqual(new Set([3]));
    });

    it('ne garde pas en cache un calcul qui a échoué', async () => {
      const world = twoProjects();
      world.a = { ...world.a, failure: new ProjectUnreadableError('a', 'verrou') };
      const { service, calls } = fakeProjects(world);
      const metrics = createMetricsService(service, options);

      const first = await metrics.compute({ projects: [], ...week });
      world.a = { ...world.a, failure: undefined };
      const second = await metrics.compute({ projects: [], ...week });

      expect(first.unreadable.map((p) => p.id)).toEqual(['a']);
      expect(second.unreadable).toEqual([]);
      expect(second.tiles.throughput.total).toBe(3);
      expect(calls.histories.filter((id) => id === 'a')).toHaveLength(2);
    });

    it('ne fige pas le temps : la période suit l’heure, même quand HEAD n’a pas changé', async () => {
      const { service, calls } = fakeProjects(twoProjects());
      let now = NOW;
      const metrics = createMetricsService(service, { now: () => now, timeZone: 'Europe/Paris' });

      const today = await metrics.compute({ projects: [], ...week });
      now = new Date(NOW.getTime() + 10 * DAY); // dix jours plus tard : les Livraisons sont sorties des 7 derniers jours
      const later = await metrics.compute({ projects: [], ...week });

      expect(today.tiles.throughput.total).toBe(3);
      expect(later.period.to).toBe('2026-11-02');
      expect(later.tiles.throughput.total).toBe(0);
      expect(later.generatedAt).toBe(now.toISOString());
      expect(calls.histories.sort()).toEqual(['a', 'b']); // aucune relecture
    });

    describe('lectures de HEAD simultanées', () => {
      it('regroupe les requêtes simultanées : au plus deux lectures de HEAD par Projet, pas une par requête', async () => {
        const world = twoProjects();
        world.a = { ...world.a, headDelayMs: 20 };
        world.b = { ...world.b, headDelayMs: 20 };
        const { service, calls } = fakeProjects(world);
        const metrics = createMetricsService(service, options);

        const responses = await Promise.all(Array.from({ length: 8 }, () => metrics.compute({ projects: [], ...week })));

        expect(responses.every((r) => r.tiles.throughput.total === 3)).toBe(true);
        expect(calls.head.filter((id) => id === 'a').length).toBeLessThanOrEqual(2);
        expect(calls.head.filter((id) => id === 'b').length).toBeLessThanOrEqual(2);
      });

      it('sert à une requête arrivée pendant une lecture de HEAD un HEAD lu après son arrivée : un commit tout récent n’est pas manqué', async () => {
        const world = twoProjects();
        world.a = { ...world.a, headDelayMs: 40 };
        const { service, calls } = fakeProjects(world);
        const metrics = createMetricsService(service, options);

        const first = metrics.compute({ projects: ['a'], ...week }); // lit HEAD « h1 »...
        await new Promise((resolve) => setTimeout(resolve, 10));
        world.a = { ...world.a, head: 'h2', histories: [delivered('a-9', '2026-10-18T12:00', '2026-10-19T12:00')], issues: [issueOf('a-9')] }; // ...puis un commit...
        const second = metrics.compute({ projects: ['a'], ...week }); // ...avant l'arrivée de cette requête
        const [, after] = await Promise.all([first, second]);

        expect(after.tiles.throughput.total).toBe(1); // l'état d'après le commit : a-9 seul
        // Deux lectures : celle de la première requête, et une seconde, lancée après l'arrivée de la deuxième. Une seule
        // lecture partagée aurait servi à la deuxième requête un HEAD d'avant son arrivée.
        expect(calls.head.filter((id) => id === 'a')).toHaveLength(2);
      });

      it('relit HEAD pour une requête qui arrive après la fin de la lecture précédente', async () => {
        const { service, calls } = fakeProjects(twoProjects());
        const metrics = createMetricsService(service, options);

        await metrics.compute({ projects: ['a'], ...week });
        await metrics.compute({ projects: ['a'], ...week });

        expect(calls.head).toEqual(['a', 'a']);
      });

      it('ne laisse pas l’échec d’une lecture de HEAD condamner les requêtes qui attendaient la suivante', async () => {
        const world = twoProjects();
        const { service } = fakeProjects(world);
        let failNext = true;
        const flaky: ProjectService = {
          ...service,
          async head(id) {
            await new Promise((resolve) => setTimeout(resolve, 20));
            if (failNext) {
              failNext = false;
              throw new ProjectUnreadableError(id, 'verrou');
            }
            return service.head(id);
          },
        };
        const metrics = createMetricsService(flaky, options);

        const first = metrics.compute({ projects: ['a'], ...week });
        await new Promise((resolve) => setTimeout(resolve, 5));
        const second = metrics.compute({ projects: ['a'], ...week });

        expect((await first).unreadable.map((p) => p.id)).toEqual(['a']);
        expect((await second).projects.map((p) => p.id)).toEqual(['a']);
      });
    });

    it('oublie un Projet qui a disparu de la liste : s’il revient, il est relu', async () => {
      const world = twoProjects();
      const { service, calls } = fakeProjects(world);
      const metrics = createMetricsService(service, options);
      await metrics.compute({ projects: [], ...week });

      const b = world.b;
      delete world.b;
      await metrics.compute({ projects: [], ...week });
      if (b) world.b = b;
      await metrics.compute({ projects: [], ...week });

      expect(calls.histories.filter((id) => id === 'b')).toHaveLength(2);
      expect(calls.histories.filter((id) => id === 'a')).toHaveLength(1);
    });
  });
});

describe('service de métriques : santé du flux', () => {
  /** Un historique à la main : ses statuts et ses liens. */
  const history = (id: string, statuses: [string, string][], extra: Partial<TicketHistory> = {}): TicketHistory => ({
    id,
    type: 'task',
    statusSnapshots: statuses.map(([status, iso]) => ({ status, at: at(iso) })),
    dependencies: [],
    ...extra,
  });

  /**
   * a : a-1 livré (le 21), a-2 son doublon fermé (Abandon), a-3 ouvert et Prêt depuis le 22 à 12:00Z.
   * b : b-1 démarré le 20 et livré le 21 (24 h de Cycle Time, sans Blocage), b-2 ouvert et Prêt depuis le 22 à 20:00Z.
   */
  const healthWorld = (): Record<string, FakeProject> => ({
    a: {
      histories: [
        history('a-1', [['open', '2026-10-20T08:00'], ['closed', '2026-10-21T08:00']]),
        history('a-2', [['open', '2026-10-20T09:00'], ['closed', '2026-10-21T09:00']], {
          dependencies: [{ type: 'duplicates', target: 'a-1', addedAt: at('2026-10-21T09:00') }],
        }),
        history('a-3', [['open', '2026-10-22T12:00']]),
      ],
      issues: [issueOf('a-1'), issueOf('a-2'), issueOf('a-3')],
    },
    b: {
      histories: [
        history('b-1', [['open', '2026-10-19T10:00'], ['in_progress', '2026-10-20T10:00'], ['closed', '2026-10-21T10:00']]),
        history('b-2', [['open', '2026-10-22T20:00']]),
      ],
      issues: [issueOf('b-1'), issueOf('b-2')],
    },
  });

  it('mesure la santé de la Vue globale sur l’union des Projets, avec la période et le fuseau des autres métriques', async () => {
    const { service } = fakeProjects(healthWorld());

    const { health, asOf } = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(asOf).toBe(NOW.toISOString());
    // Fermés : a-1 et b-1 (Livraisons), a-2 (doublon) → 1 Abandon sur 3.
    expect(health.abandonment).toMatchObject({ closed: 3, abandoned: 1, duplicates: 1, superseded: 0, rate: 1 / 3 });
    expect(health.efficiency).toMatchObject({ n: 1, cycleTime: DAY, blockedTime: 0, ratio: 1 });
    expect(health.reopening).toMatchObject({ closures: 3, reopened: 0, rate: 0 });
    // Lead Times : a-1 24 h (le 20 à 08:00Z au 21 à 08:00Z), b-1 48 h (le 19 à 10:00Z au 21 à 10:00Z).
    // Prêt de bout en bout, sauf le travail de b-1 : a-1 24 h Prêt, b-1 24 h Prêt avant son démarrage puis 24 h de travail.
    expect(health.leadTimeBreakdown).toMatchObject({ deliveries: 2, total: 3 * DAY, readyWait: 2 * DAY, work: DAY, otherWait: 0 });
    // Les Prêts de chaque Projet, du plus ancien au plus récent : a-3 (depuis le 22 à 12:00Z), puis b-2 (20:00Z).
    expect(health.readyAges.tickets.map((t) => [t.project, t.id, t.age])).toEqual([
      ['a', 'a-3', NOW.getTime() - at('2026-10-22T12:00').getTime()],
      ['b', 'b-2', NOW.getTime() - at('2026-10-22T20:00').getTime()],
    ]);
    // Transitions hors création : a-1 (1), a-2 (1), b-1 (2).
    expect(health.activity.total).toBe(4);
  });

  it('ne mesure que les Projets demandés', async () => {
    const { service } = fakeProjects(healthWorld());

    const { health } = await createMetricsService(service, options).compute({ projects: ['b'], ...week });

    expect(health.abandonment).toMatchObject({ closed: 1, abandoned: 0, rate: 0 });
    expect(health.readyAges.tickets.map((t) => t.id)).toEqual(['b-2']);
  });

  it('lit les jours et les heures de la carte d’activité dans le fuseau du service', async () => {
    const { service } = fakeProjects(healthWorld());

    const paris = await createMetricsService(service, { now: () => NOW, timeZone: 'Europe/Paris' }).compute({ projects: ['b'], ...week });
    const utc = await createMetricsService(service, { now: () => NOW, timeZone: 'UTC' }).compute({ projects: ['b'], ...week });

    // b-1 passe en cours le mardi 20 à 10:00Z (12:00 à Paris), et se ferme le mercredi 21 à 10:00Z (12:00).
    expect(paris.health.activity.cells[1]?.[12]).toBe(1);
    expect(utc.health.activity.cells[1]?.[10]).toBe(1);
    expect(paris.health.activity.cells[2]?.[12]).toBe(1);
  });

  it('vieillit les Prêts avec l’heure sans relire l’historique : le cache ne fige que l’analyse, pas le temps', async () => {
    const { service, calls } = fakeProjects(healthWorld());
    let clock = NOW;
    const metrics = createMetricsService(service, { now: () => clock, timeZone: 'Europe/Paris' });

    const first = await metrics.compute({ projects: ['a'], ...week });
    clock = new Date(NOW.getTime() + 3_600_000);
    const later = await metrics.compute({ projects: ['a'], ...week });

    expect(later.health.readyAges.tickets[0]?.age).toBe((first.health.readyAges.tickets[0]?.age ?? 0) + 3_600_000);
    expect(calls.histories).toEqual(['a']);
  });

  it('laisse un Projet illisible hors de la santé du flux, sans la faire échouer', async () => {
    const { service } = fakeProjects({ ...healthWorld(), hcp: { status: 'unreadable', reason: 'Base absente', name: 'HCP' } });

    const { health, unreadable } = await createMetricsService(service, options).compute({ projects: [], ...week });

    expect(unreadable.map((p) => p.id)).toEqual(['hcp']);
    expect(health.abandonment.closed).toBe(3);
  });

  it('rend une santé vide mais valide quand aucun Projet n’a pu être mesuré', async () => {
    const { service } = fakeProjects({ hcp: { status: 'unreadable', reason: 'Base absente', name: 'HCP' } });

    const { health } = await createMetricsService(service, options).compute({ projects: ['hcp'], ...week });

    expect(health.efficiency.ratio).toBeNull();
    expect(health.readyAges.tickets).toEqual([]);
    expect(health.activity.cells).toHaveLength(7);
  });
});

describe('service de métriques : demandes abandonnées (bdesk-38k.20)', () => {
  const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
  /** Sans délai de grâce : la lecture est abandonnée dès que son dernier demandeur part. */
  const noGrace = { ...options, graceMs: 0 };

  /** Des Projets dont la lecture de l'historique ne finit que quand le test le décide ; elle finit en AbortError si son signal est abandonné. */
  function slowHistories(world: Record<string, FakeProject> = twoProjects()) {
    const { service, calls } = fakeProjects(world);
    const probe = { signals: [] as (AbortSignal | undefined)[], finish: [] as (() => void)[], histories: [] as string[], issues: [] as (AbortSignal | undefined)[] };
    const fast = service.histories;
    service.histories = (id: string, readOptions?: ReadOptions) =>
      new Promise((resolve, reject) => {
        probe.histories.push(id);
        probe.signals.push(readOptions?.signal);
        probe.finish.push(() => void fast(id).then(resolve, reject));
        readOptions?.signal?.addEventListener('abort', () => reject(new ReadAborted()));
      });
    const issues = service.issues;
    service.issues = (id: string, readOptions?: ReadOptions) => {
      probe.issues.push(readOptions?.signal);
      return issues(id);
    };
    return { service, calls, probe };
  }

  it('libère aussitôt une requête dont le client est parti, sans attendre les historiques', async () => {
    const { service } = slowHistories();
    const controller = new AbortController();
    const waiting = createMetricsService(service, options).compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);

    controller.abort();

    expect(await waiting).toBeInstanceOf(ReadAborted);
  });

  it('abandonne les lectures de tous les Projets quand son seul demandeur part, et donne le signal à la lecture des tickets (sans délai de grâce)', async () => {
    const { service, probe } = slowHistories();
    const controller = new AbortController();
    const waiting = createMetricsService(service, noGrace).compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    expect(probe.signals).toHaveLength(2);
    expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]);

    controller.abort();
    await waiting;

    expect(probe.signals.map((signal) => signal?.aborted)).toEqual([true, true]);
    expect(probe.issues).toHaveLength(2);
    expect(probe.issues.every((signal) => signal !== undefined)).toBe(true);
  });

  it('ne les abandonne pas tant qu’une autre requête attend la même analyse', async () => {
    const { service, calls, probe } = slowHistories();
    const metrics = createMetricsService(service, options);
    const leaving = new AbortController();
    const gone = metrics.compute({ projects: [], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
    const stays = metrics.compute({ projects: [], ...week });
    await sleep(10);

    leaving.abort();
    expect(await gone).toBeInstanceOf(ReadAborted);
    expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]);
    for (const finish of probe.finish) finish();

    const response = await stays;
    expect(response.tiles.throughput.total).toBe(3);
    expect(calls.histories.sort()).toEqual(['a', 'b']);
  });

  it('ne garde pas une analyse abandonnée : la requête suivante, au même HEAD, relit l’historique (sans délai de grâce)', async () => {
    const { service, probe } = slowHistories();
    const metrics = createMetricsService(service, noGrace);
    const controller = new AbortController();
    const abandoned = metrics.compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    controller.abort();
    await abandoned;

    const next = metrics.compute({ projects: [], ...week });
    await sleep(10);
    for (const finish of probe.finish.slice(2)) finish();

    expect((await next).tiles.throughput.total).toBe(3);
    expect(probe.histories.sort()).toEqual(['a', 'a', 'b', 'b']);
  });

  it('une lecture abandonnée qui met du temps à mourir ne fait pas échouer la requête suivante : elle en lance une autre', async () => {
    const { service } = slowHistories();
    const metrics = createMetricsService(service, noGrace);
    const stuck = service.histories;
    let first = true;
    service.histories = (id: string, readOptions?: ReadOptions) => {
      // Les premières lectures ne réagissent pas à l'abandon (leurs processus mettent du temps à mourir) : elles ne finissent pas.
      if (first) return new Promise(() => undefined);
      return stuck(id, readOptions);
    };
    const controller = new AbortController();
    const abandoned = metrics.compute({ projects: ['a'], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);
    controller.abort();
    expect(await abandoned).toBeInstanceOf(ReadAborted);
    first = false;

    const next = metrics.compute({ projects: ['a'], ...week });
    await sleep(10);

    // La demande suivante a lancé sa propre lecture (en attente, comme les autres de ce groupe) au lieu d'échouer sur celle qu'on avait abandonnée.
    await expect(Promise.race([next.then(() => 'fini', (e: unknown) => (e instanceof ReadAborted ? 'abandon' : 'échec')), sleep(50).then(() => 'en cours')])).resolves.toBe('en cours');
  });

  describe('délai de grâce (r5) : des lectures abandonnées puis redemandées juste après ne sont pas relancées', () => {
    it('la requête qui arrive dans le délai reprend les lectures en cours : une lecture d’historique par Projet', async () => {
      const { service, probe } = slowHistories();
      const metrics = createMetricsService(service, { ...options, graceMs: 300 });
      const leaving = new AbortController();
      const gone = metrics.compute({ projects: [], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10);
      leaving.abort();
      expect(await gone).toBeInstanceOf(ReadAborted); // libérée aussitôt, grâce ou non

      const back = metrics.compute({ projects: [], ...week });
      await sleep(10);
      expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]);
      for (const finish of probe.finish) finish();

      expect((await back).tiles.throughput.total).toBe(3);
      expect(probe.histories.sort()).toEqual(['a', 'b']); // et non quatre lectures
    });

    it('une lecture d’historique achevée pendant le délai sert la requête qui arrive ensuite : elle n’est pas relancée (bdesk-38k.33)', async () => {
      const { service, probe } = slowHistories();
      const metrics = createMetricsService(service, { ...options, graceMs: 300 });
      const leaving = new AbortController();
      const gone = metrics.compute({ projects: [], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10);
      leaving.abort();
      await gone;
      for (const finish of probe.finish) finish(); // les historiques finissent pendant le délai, devant personne
      await sleep(20);

      const response = await metrics.compute({ projects: [], ...week });

      expect(response.tiles.throughput.total).toBe(3);
      expect(probe.histories.sort()).toEqual(['a', 'b']);
    });

    it('une lecture d’historique qui a échoué pendant le délai n’est pas gardée : la requête suivante la relance (bdesk-38k.33)', async () => {
      const world = twoProjects();
      const { service, probe } = slowHistories({ ...world, a: { ...world.a, failure: new ProjectUnreadableError('a', 'base verrouillée') } });
      const metrics = createMetricsService(service, { ...options, graceMs: 300 });
      const leaving = new AbortController();
      const gone = metrics.compute({ projects: ['a'], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10);
      leaving.abort();
      await gone;
      for (const finish of probe.finish) finish(); // l'historique échoue pendant le délai, devant personne
      await sleep(20);

      const next = metrics.compute({ projects: ['a'], ...week });
      await sleep(10);
      for (const finish of probe.finish.slice(1)) finish();

      expect((await next).unreadable).toEqual([{ id: 'a', name: 'Nom de a', reason: 'base verrouillée' }]);
      expect(probe.histories).toEqual(['a', 'a']);
    });

    it('un commit pendant le délai : la requête suivante lit l’historique du nouveau HEAD, jamais celui que l’abandon avait laissé en vie (bdesk-38k.33)', async () => {
      const world = twoProjects();
      const { service, probe } = slowHistories(world);
      const metrics = createMetricsService(service, { ...options, graceMs: 300 });
      const leaving = new AbortController();
      const gone = metrics.compute({ projects: ['a'], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10);
      leaving.abort();
      await gone;
      world.a = { ...world.a, head: 'h2' };

      const next = metrics.compute({ projects: ['a'], ...week });
      await sleep(10);
      for (const finish of probe.finish.slice(1)) finish();

      expect((await next).tiles.throughput.total).toBe(2);
      expect(probe.histories).toEqual(['a', 'a']);
    });

    it('par défaut, le service retient l’abandon pendant ANALYSIS_GRACE_MS : les lectures ne sont pas abandonnées aussitôt', async () => {
      const { service, probe } = slowHistories();
      const controller = new AbortController();
      const abandoned = createMetricsService(service, options).compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);

      controller.abort();
      await abandoned;
      await sleep(60);

      expect(ANALYSIS_GRACE_MS).toBeGreaterThan(60);
      expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]);
    });

    it('seul l’historique attend le délai : la lecture des tickets quitte la file aussitôt que le dernier demandeur part (bdesk-38k.33)', async () => {
      const { service, probe } = slowHistories();
      const controller = new AbortController();
      const abandoned = createMetricsService(service, options).compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);
      expect(probe.issues).toHaveLength(2);
      expect(probe.issues.map((signal) => signal?.aborted)).toEqual([false, false]);

      controller.abort();
      await abandoned;

      // Les tickets : abandonnés tout de suite, pour que la fiche suivante ne fasse pas la queue derrière des listes que personne ne lit.
      expect(probe.issues.map((signal) => signal?.aborted)).toEqual([true, true]);
      // L'historique, lui, que la requête suivante redemandera aussitôt, attend la fin du délai.
      expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]);
    });

    it('la requête qui arrive dans le délai reprend l’historique en cours, relit les tickets (que l’abandon avait retirés) et obtient un résultat juste (bdesk-38k.33)', async () => {
      const { service, probe } = slowHistories();
      const metrics = createMetricsService(service, { ...options, graceMs: 300 });
      const leaving = new AbortController();
      const gone = metrics.compute({ projects: [], ...week }, { signal: leaving.signal }).catch((e: unknown) => e);
      await sleep(10);
      leaving.abort();
      expect(await gone).toBeInstanceOf(ReadAborted);

      const back = metrics.compute({ projects: [], ...week });
      await sleep(10);
      for (const finish of probe.finish) finish();

      const response = await back;
      expect(response.tiles.throughput.total).toBe(3);
      expect(response.projects.map((p) => p.id)).toEqual(['a', 'b']);
      expect(probe.histories.sort()).toEqual(['a', 'b']); // l'historique n'est pas relancé
      // Les tickets : une lecture abandonnée par Projet, puis celle qui sert.
      expect(probe.issues.map((signal) => signal?.aborted)).toEqual([true, true, false, false]);
    });

    it('sans nouvelle requête à l’expiration du délai, les lectures des Projets sont abandonnées', async () => {
      const { service, probe } = slowHistories();
      const metrics = createMetricsService(service, { ...options, graceMs: 120 });
      const controller = new AbortController();
      const abandoned = metrics.compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
      await sleep(10);

      controller.abort();
      await abandoned;
      await sleep(30);
      expect(probe.signals.map((signal) => signal?.aborted)).toEqual([false, false]); // pendant la grâce
      await sleep(200);

      expect(probe.signals.map((signal) => signal?.aborted)).toEqual([true, true]); // après
    });
  });

  /**
   * Suit les tableaux d'historique que lit le service sans les retenir (`WeakRef`) : `retenus()` demande à V8 de ramasser, puis compte ceux
   * qui sont encore joignables. `gc` vient de l'option `--expose-gc` que `vite.config.ts` donne à tous les processus de tests (ceux de `web`
   * aussi), avec le pool `forks` ; sous un autre pool (`--pool=threads`) il manque, et le test échoue avec un message qui le dit.
   */
  function trackHistories(service: ProjectService) {
    const collectGarbage = (globalThis as { gc?: () => void }).gc;
    if (!collectGarbage) throw new Error('`gc` n’est pas exposé : lancez vitest avec la configuration du dépôt (pool « forks » et poolOptions.forks.execArgv de vite.config.ts), pas avec --pool=threads.');
    const tracked: WeakRef<TicketHistory[]>[] = [];
    const read = service.histories;
    service.histories = async (id: string, readOptions?: ReadOptions) => {
      const rows = [...(await read(id, readOptions))];
      tracked.push(new WeakRef(rows));
      return rows;
    };
    const reachable = () => tracked.filter((ref) => ref.deref() !== undefined).length;
    return {
      reads: () => tracked.length,
      retenus: async () => {
        for (let i = 0; i < 20 && reachable() > 0; i++) {
          await sleep(5);
          collectGarbage();
        }
        return reachable();
      },
    };
  }

  it('une fois l’analyse faite, le cache ne retient pas l’historique brut (bdesk-38k.33)', async () => {
    const { service } = fakeProjects(twoProjects());
    const { reads, retenus } = trackHistories(service);
    const metrics = createMetricsService(service, options);

    const response = await metrics.compute({ projects: [], ...week });

    expect(response.tiles.throughput.total).toBe(3);
    expect(reads()).toBe(2);
    // Le cache garde le résultat de l'analyse, pas les tickets de l'historique dont elle est faite.
    expect(await retenus()).toBe(0);
    expect((await metrics.compute({ projects: [], ...week })).tiles.throughput.total).toBe(3); // et il sert encore
  });

  it('un Projet qui disparaît ne garde pas l’historique que personne n’avait recueilli (bdesk-38k.33)', async () => {
    const world = twoProjects();
    const { service, probe } = slowHistories(world);
    const { reads, retenus } = trackHistories(service);
    const metrics = createMetricsService(service, { ...options, graceMs: 60_000 });
    const leaving = new AbortController();
    // L'erreur d'abandon n'est pas gardée : la trace de pile d'une erreur retient les fonctions de ses appels, donc la lecture qu'elles citent.
    const gone = metrics.compute({ projects: ['a'], ...week }, { signal: leaving.signal }).catch(() => undefined);
    await sleep(10);
    leaving.abort();
    await gone;
    for (const finish of probe.finish) finish(); // l'historique de a finit pendant le délai, devant personne
    await sleep(20);
    // Précondition, qui ne suppose rien de ce que le service fait de la lecture : un historique a bien été lu. Sans elle, « rien n'est retenu »
    // serait vrai à vide, par exemple si aucun historique n'était jamais lu.
    expect(reads()).toBeGreaterThanOrEqual(1);

    delete world.a; // le Projet disparaît de la liste
    const next = metrics.compute({ projects: ['b'], ...week });
    await sleep(10);
    probe.finish[1]?.();
    await next;

    // On lâche aussi les signaux que la sonde a gardés : la raison d'un abandon retient, par sa trace de pile, les fonctions qui l'ont levé.
    probe.signals.length = 0;
    probe.issues.length = 0;
    expect(await retenus()).toBe(0);
  });

  it('un signal déjà abandonné ne lit rien', async () => {
    const { service, calls } = fakeProjects(twoProjects());
    const controller = new AbortController();
    controller.abort();

    await expect(createMetricsService(service, options).compute({ projects: [], ...week }, { signal: controller.signal })).rejects.toBeInstanceOf(ReadAborted);

    expect(calls).toEqual({ list: 0, head: [], issues: [], histories: [] });
  });

  it('un abandon n’est pas un Projet illisible : il n’est pas rangé dans la réponse, il fait échouer la requête abandonnée', async () => {
    const { service } = slowHistories();
    const controller = new AbortController();
    const waiting = createMetricsService(service, options).compute({ projects: [], ...week }, { signal: controller.signal }).catch((e: unknown) => e);
    await sleep(10);

    controller.abort();
    const result = await waiting;

    expect(result).toBeInstanceOf(ReadAborted);
    expect(result).not.toHaveProperty('unreadable');
  });
});
