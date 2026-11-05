import { spawnSync } from 'node:child_process';
import { realpathSync } from 'node:fs';
import { Writable } from 'node:stream';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { StatusSnapshot, TicketHistory } from '../../domain/flow';
import type { Issue, MetricsResponse, Project } from '../../shared/api';
import type { ProjectService } from '../projects/service';
import { buildServer } from '../server';
import { createMetricsService } from './service';

// `realpathSync` est l'original, espionné : la sonde par défaut du fuseau du système le lit vraiment, et on compte ses lectures de /etc/localtime.
vi.mock('node:fs', async (importOriginal) => {
  const actual = await importOriginal<typeof import('node:fs')>();
  return { ...actual, realpathSync: vi.fn(actual.realpathSync) };
});

/**
 * bdesk-38k.38 : avec la variable `TZ` vide, le moteur nomme le fuseau local « Etc/Unknown », que `Intl` refuse : chaque
 * requête de `/api/metrics` répondait 500 (« Invalid time zone specified »). Avec un `TZ` qu'il ne sait pas nommer
 * (`Invalid/Zone`, `:/etc/localtime`), il ne rend aucun nom : la réponse sortait sans `timeZone`, et les jours se comptaient
 * dans un fuseau que personne ne connaissait. Le service choisit le fuseau une fois, à sa création : celui qu'on lui demande
 * s'il est reconnu, sinon celui du système, sinon UTC, en le disant au journal.
 */

/** Un oracle indépendant du code testé : un nom est un fuseau si `Intl` en construit un. */
function isZone(name: unknown): boolean {
  if (typeof name !== 'string') return false;
  try {
    new Intl.DateTimeFormat('en-US', { timeZone: name });
    return true;
  } catch {
    return false;
  }
}

/** Les lectures de /etc/localtime faites par la sonde par défaut depuis le dernier `resetLocaltimeReads` (le `realpathSync` espionné plus haut). */
const localtimeReads = () => vi.mocked(realpathSync).mock.calls.filter(([path]) => path === '/etc/localtime').length;
const resetLocaltimeReads = () => vi.mocked(realpathSync).mockClear();

const at = (iso: string) => new Date(`${iso}Z`);
const NOW = at('2026-10-23T22:45'); // vendredi 23 octobre 2026, 22:45 UTC : samedi 24 à 00:45 à Paris (UTC+2 jusqu'au 25)
const week = { period: { range: '7d' as const } };

const project: Project = { id: 'p', name: 'P', path: '/p', prefix: 'p', mode: 'embedded', status: 'ok' };

const issueOf = (id: string): Issue => ({
  id,
  title: `Titre de ${id}`,
  type: 'task',
  status: 'closed',
  priority: 2,
  assignee: null,
  parentId: null,
  createdAt: '2026-10-01T00:00:00.000Z',
  updatedAt: '2026-10-01T00:00:00.000Z',
  closedAt: null,
  blockedBy: [],
});

/** Un Projet dont le seul ticket est une Livraison : ses statuts, avec leurs instants UTC. */
function projectsWith(statuses: [string, Date][]): ProjectService {
  const snapshots: StatusSnapshot[] = statuses.map(([status, when]) => ({ status, at: when }));
  const history: TicketHistory = { id: 'p-1', type: 'task', statusSnapshots: snapshots, dependencies: [] };
  return {
    list: async () => ({ projects: [project], ignored: [] }),
    head: async () => 'h1',
    issues: async () => [issueOf('p-1')],
    histories: async () => [history],
    issue: async () => {
      throw new Error('inutile ici');
    },
  };
}

/**
 * Démarré le mercredi 21 à 09:00Z (11:00 à Paris), livré le vendredi 23 à 22:30Z, soit samedi 24 à 00:30 à Paris : la Livraison et
 * NOW (22:45Z) tombent le vendredi en UTC, le samedi à Paris.
 */
const lateFriday = (): ProjectService =>
  projectsWith([
    ['open', at('2026-10-20T08:00')],
    ['in_progress', at('2026-10-21T09:00')],
    ['closed', at('2026-10-23T22:30')],
  ]);

describe('service de métriques : fuseau non reconnu (bdesk-38k.38)', () => {
  const compute = (options: Parameters<typeof createMetricsService>[1]) =>
    createMetricsService(lateFriday(), { now: () => NOW, ...options }).compute({ projects: [], ...week });

  it('compte les jours, les semaines et les heures en UTC quand ni le fuseau demandé ni celui du système ne se reconnaissent', async () => {
    const response = await compute({ timeZone: 'Etc/Unknown', systemTimeZone: () => undefined });

    expect(response.timeZone).toBe('UTC');
    expect(response.period).toMatchObject({ from: '2026-10-17', to: '2026-10-23' }); // vendredi, comme à Greenwich
    expect(response.buckets.at(-1)).toMatchObject({ from: '2026-10-23', deliveries: 1 });
    expect(response.health.activity.cells[2]?.[9]).toBe(1); // démarré le mercredi à 9 h
    expect(response.health.activity.cells[4]?.[22]).toBe(1); // livré le vendredi à 22 h
    expect(response.health.activity.total).toBe(2);
  });

  it('compte dans le fuseau du système quand il se lit : c’est celui de l’utilisateur', async () => {
    const response = await compute({ timeZone: 'Etc/Unknown', systemTimeZone: () => 'Europe/Paris' });

    expect(response.timeZone).toBe('Europe/Paris');
    expect(response.period).toMatchObject({ from: '2026-10-18', to: '2026-10-24' }); // déjà samedi
    expect(response.buckets.at(-1)).toMatchObject({ from: '2026-10-24', deliveries: 1 });
    expect(response.health.activity.cells[2]?.[11]).toBe(1);
    expect(response.health.activity.cells[5]?.[0]).toBe(1); // livré le samedi à 0 h
  });

  it('découpe les semaines dans le fuseau de repli : dimanche à 22:30Z est de la semaine du 12 en UTC, de celle du 19 à Paris', async () => {
    const sundayNight = projectsWith([
      ['open', at('2026-10-01T08:00')],
      ['closed', at('2026-10-18T22:30')],
    ]);
    const weeks = { projects: [], period: { from: '2026-09-01', to: '2026-10-23' } }; // 53 jours : des semaines du lundi au dimanche
    const bucketOfDelivery = async (system: () => string | undefined) => {
      const response = await createMetricsService(sundayNight, { now: () => NOW, timeZone: 'Etc/Unknown', systemTimeZone: system }).compute(weeks);
      expect(response.bucket).toBe('week');
      return response.buckets.find((bucket) => bucket.deliveries === 1)?.from;
    };

    expect(await bucketOfDelivery(() => undefined)).toBe('2026-10-12'); // UTC : encore dimanche 18
    expect(await bucketOfDelivery(() => 'Europe/Paris')).toBe('2026-10-19'); // Paris : déjà lundi 19, 00:30
  });

  it.each([
    ['inconnu', () => 'Nowhere/Land'],
    ['absent', () => undefined],
    ['illisible', () => 'posix/Europe/Paris'],
  ])('retombe sur UTC quand le fuseau du système est %s', async (_why, system) => {
    const response = await compute({ timeZone: 'Invalid/Zone', systemTimeZone: system });

    expect(response.timeZone).toBe('UTC');
  });

  it('dit au journal, une fois à la création, quel fuseau a pris la place de l’autre : jamais à chaque calcul', async () => {
    const warn = vi.fn();
    const metrics = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Etc/Unknown', systemTimeZone: () => 'Europe/Paris', warn });
    expect(warn).toHaveBeenCalledTimes(1); // au démarrage, avant la première requête

    for (let i = 0; i < 5; i++) await metrics.compute({ projects: [], ...week });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Etc/Unknown');
    expect(warn.mock.calls[0]?.[0]).toContain('Europe/Paris');
  });

  it('lit le fuseau du système une seule fois, à la création : jamais à chaque calcul (une lecture de /etc/localtime par requête)', async () => {
    const system = vi.fn(() => 'Europe/Paris');
    const metrics = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Etc/Unknown', systemTimeZone: system });
    expect(system).toHaveBeenCalledTimes(1); // à la création, avant la première requête

    const responses = [];
    for (let i = 0; i < 5; i++) responses.push(await metrics.compute({ projects: [], ...week }));

    expect(system).toHaveBeenCalledTimes(1);
    expect(new Set(responses.map((response) => response.timeZone))).toEqual(new Set(['Europe/Paris'])); // et le même fuseau chaque fois
  });

  // Le test précédent remplace la sonde : il ne garde pas la lecture réelle. Celui-ci laisse la sonde par défaut, qui lit /etc/localtime (bdesk-38k.49).
  it('lit /etc/localtime une seule fois avec la sonde par défaut aussi : à la création, jamais à chaque calcul', async () => {
    resetLocaltimeReads();
    const metrics = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Etc/Unknown' }); // aucune sonde passée : celle du module
    expect(localtimeReads()).toBe(1); // à la création, avant la première requête

    const responses = [];
    for (let i = 0; i < 5; i++) responses.push(await metrics.compute({ projects: [], ...week }));

    expect(localtimeReads()).toBe(1);
    expect(isZone(responses[0]?.timeZone)).toBe(true);
    expect(new Set(responses.map((response) => response.timeZone)).size).toBe(1); // et le même fuseau chaque fois
  });

  it('ne lit pas /etc/localtime quand le fuseau demandé est reconnu, avec la sonde par défaut', async () => {
    resetLocaltimeReads();
    const metrics = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Europe/Paris' });

    for (let i = 0; i < 3; i++) await metrics.compute({ projects: [], ...week });

    expect(localtimeReads()).toBe(0);
  });

  it('dit aussi que c’est UTC qui a pris la place, faute de fuseau du système', () => {
    const warn = vi.fn();

    createMetricsService(lateFriday(), { timeZone: 'Invalid/Zone', systemTimeZone: () => undefined, warn });

    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Invalid/Zone');
    expect(warn.mock.calls[0]?.[0]).toContain('UTC');
  });

  it('ne dit rien d’un fuseau reconnu, et ne cherche pas celui du système', async () => {
    const warn = vi.fn();
    const system = vi.fn(() => 'Asia/Tokyo');

    const response = await compute({ timeZone: 'Europe/Paris', systemTimeZone: system, warn });

    expect(response.timeZone).toBe('Europe/Paris');
    expect(warn).not.toHaveBeenCalled();
    expect(system).not.toHaveBeenCalled();
  });

  it('juge une plage dans le fuseau de repli : demain à Paris est le futur en UTC, et une erreur de période (400), jamais un 500', async () => {
    const tomorrowInParis = { projects: [], period: { from: '2026-10-23', to: '2026-10-24' } };
    const utc = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Etc/Unknown', systemTimeZone: () => undefined });
    const paris = createMetricsService(lateFriday(), { now: () => NOW, timeZone: 'Etc/Unknown', systemTimeZone: () => 'Europe/Paris' });

    await expect(utc.compute(tomorrowInParis)).rejects.toMatchObject({ name: 'InvalidPeriodError' });
    await expect(paris.compute(tomorrowInParis)).resolves.toMatchObject({ timeZone: 'Europe/Paris', period: { from: '2026-10-23', to: '2026-10-24' } });
  });
});

describe('service de métriques : le fuseau local tel que le moteur le rend', () => {
  afterEach(() => {
    vi.unstubAllEnvs();
    vi.restoreAllMocks();
  });

  const compute = (options: Parameters<typeof createMetricsService>[1]) =>
    createMetricsService(lateFriday(), { now: () => NOW, ...options }).compute({ projects: [], ...week });

  // Les tests de ce bloc posent TZ en cours de route (`vi.stubEnv`) ; le serveur, lui, le reçoit au lancement. Les deux donnent au moteur le même fuseau.
  it('un TZ posé en cours de route donne au moteur le même fuseau qu’un TZ reçu au lancement : ces tests reproduisent bien la panne', () => {
    for (const tz of ['', 'Invalid/Zone', 'Europe/Paris']) {
      const launched = spawnSync(process.execPath, ['-p', 'String(Intl.DateTimeFormat().resolvedOptions().timeZone)'], {
        env: { ...process.env, TZ: tz },
        encoding: 'utf8',
      }).stdout.trim();

      vi.stubEnv('TZ', tz);

      expect(String(Intl.DateTimeFormat().resolvedOptions().timeZone), `TZ=${JSON.stringify(tz)}`).toBe(launched);
    }
  }, 30_000);

  it('TZ vide : le moteur nomme « Etc/Unknown », le service répond en UTC (faute de fuseau du système) et prévient une fois', async () => {
    vi.stubEnv('TZ', '');
    // La panne de départ : le moteur nomme le fuseau « Etc/Unknown » (Node 18 à 25, sur macOS), et `Intl` refuse ce nom.
    expect(isZone(Intl.DateTimeFormat().resolvedOptions().timeZone)).toBe(false);
    const warn = vi.fn();

    const response = await compute({ systemTimeZone: () => undefined, warn });

    expect(response.timeZone).toBe('UTC');
    expect(response.period).toMatchObject({ to: '2026-10-23' });
    expect(warn).toHaveBeenCalledTimes(1);
    expect(warn.mock.calls[0]?.[0]).toContain('Etc/Unknown');
  });

  it('TZ vide : le fuseau du système, quand il se lit, passe avant UTC', async () => {
    vi.stubEnv('TZ', '');

    const response = await compute({ systemTimeZone: () => 'Europe/Paris' });

    expect(response.timeZone).toBe('Europe/Paris');
    expect(response.period).toMatchObject({ to: '2026-10-24' });
  });

  it('un moteur qui ne nomme aucun fuseau (il rend undefined, et non « Etc/Unknown ») ne laisse pas la réponse sans timeZone', async () => {
    // `TZ=Invalid/Zone` ou `TZ=:/etc/localtime` : le moteur ne dit rien. Le type de `resolvedOptions().timeZone` est pourtant `string`.
    vi.spyOn(Intl.DateTimeFormat.prototype, 'resolvedOptions').mockReturnValue({ timeZone: undefined } as unknown as Intl.ResolvedDateTimeFormatOptions);
    const warn = vi.fn();

    const response = await compute({ systemTimeZone: () => undefined, warn });

    expect(typeof response.timeZone).toBe('string');
    expect(response.timeZone).toBe('UTC');
    expect(warn).toHaveBeenCalledTimes(1);
  });

  it.each(['Invalid/Zone', ':/etc/localtime', ':', 'EST5', 'JST-9'])('TZ=%j : un nom reconnu est gardé, sinon la réponse a un fuseau de repli, et un seul avertissement', async (tz) => {
    vi.stubEnv('TZ', tz);
    const engine = Intl.DateTimeFormat().resolvedOptions().timeZone; // selon le moteur : un nom, « Etc/Unknown » ou rien
    const warn = vi.fn();

    const response = await compute({ systemTimeZone: () => undefined, warn });

    expect(isZone(response.timeZone)).toBe(true);
    expect(response.timeZone).toBe(isZone(engine) ? engine : 'UTC');
    expect(warn).toHaveBeenCalledTimes(isZone(engine) ? 0 : 1);
  });

  it.each(['Europe/Paris', 'UTC', 'Asia/Kolkata'])('TZ=%s : le fuseau du moteur est gardé, sans avertissement', async (tz) => {
    vi.stubEnv('TZ', tz);
    const warn = vi.fn();

    const response = await compute({ systemTimeZone: () => 'Asia/Tokyo', warn });

    expect(response.timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(warn).not.toHaveBeenCalled();
  });
});

describe('GET /api/metrics avec un fuseau local que le moteur ne reconnaît pas', () => {
  const config = { roots: [], projects: [], hiddenProjects: [] };
  const apps: { close(): Promise<unknown> }[] = [];
  afterEach(async () => {
    vi.unstubAllEnvs();
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  /** Ce que le serveur écrit à son journal (Fastify, via pino : une ligne JSON par message). */
  function journal() {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    const lines = () =>
      chunks
        .join('')
        .split('\n')
        .filter((line) => line.trim() !== '')
        .map((line) => JSON.parse(line) as { level: number; msg: string });
    return { stream, lines };
  }

  /** Livré il y a une heure : une Transition dans la fenêtre, donc la Carte d'activité lit un jour et une heure dans le fuseau. */
  const delivered = () => {
    const closed = new Date(Date.now() - 3_600_000);
    return projectsWith([
      ['open', new Date(closed.getTime() - 3 * 86_400_000)],
      ['closed', closed],
    ]);
  };

  function serve(projects: ProjectService, stream: Writable) {
    const app = buildServer({ config, projects, logger: { level: 'warn', stream } });
    apps.push(app);
    return app;
  }

  it.each(['', ':', 'Invalid/Zone', ':/etc/localtime', 'EST5', 'JST-9'])('TZ=%j : répond 200 (et non 500, ni sans fuseau) dans un fuseau reconnu, les jours et la Carte d’activité compris', async (tz) => {
    vi.stubEnv('TZ', tz);
    const { stream } = journal();
    const app = serve(delivered(), stream);

    const res = await app.inject({ method: 'GET', url: '/api/metrics?range=7d' });

    expect(res.statusCode).toBe(200);
    const body = res.json<MetricsResponse>();
    expect(isZone(body.timeZone)).toBe(true);
    expect(body.timeZone).not.toBe('Etc/Unknown');
    expect(body.health.activity.total).toBe(1);
    expect(body.tiles.throughput.total).toBe(1);
  });

  it('TZ vide : le Projet, la Vue globale, une plage de jours et une plage de semaines répondent tous, au même fuseau', async () => {
    vi.stubEnv('TZ', '');
    const { stream } = journal();
    const app = serve(delivered(), stream);

    const zones = new Set<string>();
    const units = new Set<string>();
    for (const url of [
      '/api/metrics?project=p&range=30d',
      '/api/metrics',
      '/api/metrics?range=90d',
      '/api/metrics?from=2025-03-01&to=2025-03-31', // 31 jours : des jours
      '/api/metrics?from=2025-01-01&to=2025-06-30', // 181 jours : des semaines
    ]) {
      const res = await app.inject({ method: 'GET', url });
      expect(res.statusCode, url).toBe(200);
      const body = res.json<MetricsResponse>();
      zones.add(body.timeZone);
      units.add(body.bucket);
    }
    expect(zones.size).toBe(1);
    expect([...units].sort()).toEqual(['day', 'week']);
  });

  it('TZ vide : un seul avertissement au journal, écrit au démarrage, que le serveur reçoive une requête ou dix', async () => {
    vi.stubEnv('TZ', '');
    const { stream, lines } = journal();
    const app = serve(delivered(), stream);
    const warned = () => lines().filter((line) => line.level >= 40);
    expect(warned()).toHaveLength(1); // avant toute requête

    for (let i = 0; i < 10; i++) expect((await app.inject({ method: 'GET', url: '/api/metrics?range=7d' })).statusCode).toBe(200);

    expect(warned()).toHaveLength(1);
    expect(warned()[0]?.msg).toContain('Etc/Unknown');
    expect(warned()[0]?.msg).toContain('définissez TZ avec un nom IANA (TZ=Europe/Paris)');
    expect(warned()[0]?.msg).not.toContain('vide ou invalide ?'); // la cause n'est pas devinée : EST5 est valide, et n'a pas de nom IANA
  });

  it('TZ vide : le serveur lit /etc/localtime une seule fois, à sa construction, quelles que soient les requêtes qu’il reçoit (bdesk-38k.49)', async () => {
    vi.stubEnv('TZ', '');
    resetLocaltimeReads();
    const { stream } = journal();
    const app = serve(delivered(), stream);
    expect(localtimeReads()).toBe(1); // avant toute requête : la sonde du serveur est celle du module, sans rien d'injecté

    for (const url of ['/api/metrics?project=p&range=30d', '/api/metrics', '/api/metrics?range=90d', '/api/metrics?from=2025-03-01&to=2025-03-31', '/api/metrics?from=2025-01-01&to=2025-06-30']) {
      expect((await app.inject({ method: 'GET', url })).statusCode, url).toBe(200);
    }

    expect(localtimeReads()).toBe(1);
  });

  it.each(['Europe/Paris', 'UTC'])('TZ=%s : rien au journal', async (tz) => {
    vi.stubEnv('TZ', tz);
    const { stream, lines } = journal();
    const app = serve(delivered(), stream);

    const res = await app.inject({ method: 'GET', url: '/api/metrics?range=7d' });

    expect(res.statusCode).toBe(200);
    expect(res.json<MetricsResponse>().timeZone).toBe(Intl.DateTimeFormat().resolvedOptions().timeZone);
    expect(lines()).toEqual([]);
  });

  it('un service de métriques fourni au serveur garde son propre fuseau, sans rien écrire', async () => {
    vi.stubEnv('TZ', '');
    const { stream, lines } = journal();
    const metrics = createMetricsService(delivered(), { timeZone: 'Asia/Tokyo' });
    const app = buildServer({ config, projects: delivered(), metrics, logger: { level: 'warn', stream } });
    apps.push(app);

    const res = await app.inject({ method: 'GET', url: '/api/metrics?range=7d' });

    expect(res.json<MetricsResponse>().timeZone).toBe('Asia/Tokyo');
    expect(lines()).toEqual([]);
  });
});
