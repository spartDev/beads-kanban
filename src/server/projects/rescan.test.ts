import { existsSync, mkdirSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import { type DoltClient, DoltQueryError, type Row } from '../dolt/client';
import { buildServer } from '../server';
import { scratchDir } from '../testing/scratch';
import { createProjectService, ProjectNotFoundError, ProjectUnreadableError } from './service';

/**
 * Les lectures qui arrivent pendant un rescan des Projets (bdesk-38k.28). Un rescan lit le préfixe de chaque Projet : une centaine
 * de millisecondes par Projet, de l'ordre de 2 s pour 40. Une demande pour un Projet que le dernier scan connaît et dit lisible ne
 * l'attend pas (elle est servie d'après ce scan, le nouveau tourne en arrière-plan) ; une demande pour un Projet que ce scan ne connaît
 * pas, ou dit illisible, attend celui en cours : c'est lui qui dit si le Projet existe ou a été réparé.
 *
 * Le scan est commandé par le test : un faux client dolt dont les lectures de préfixe (celles d'un scan) ne répondent que quand le test
 * les libère. Aucune durée n'est supposée : un scan retenu ne finit jamais de lui-même.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

let root: string;

beforeEach(() => {
  root = realpathSync(scratchDir('bdesk-rescan-'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fait passer `ms` millisecondes pour le service (qui date ses scans avec `Date.now`) : l'horloge saute, puis reste figée. */
function elapse(ms: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] }); // les vrais délais (sleep) restent réels
  vi.setSystemTime(now + ms);
}

/** Un Projet Dolt embedded dans `root`, avec ou sans le dossier de sa base. */
function project(name: string, { database = true } = {}): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  if (database) mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
}

const SUMMARY = { id: 'x-1', title: 'T', issue_type: 'task', status: 'open', priority: 2, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' };

/**
 * Un faux client dolt dont on commande les scans. Un scan lit le préfixe de chaque Projet lisible ; tant que `hold()` est actif, ces
 * lectures-là ne répondent pas (le scan dure aussi longtemps que le test le veut), les autres répondent aussitôt. `release()` laisse
 * répondre toutes celles qui attendent. `reached(n)` se résout quand la n-ième lecture de préfixe est arrivée (un scan en fait une par
 * Projet lisible). `breakPrefix(nom)` rend illisible le préfixe d'un Projet dont la base est là (le scan le dit alors illisible, avec le dossier
 * de sa base), `repairPrefix(nom)` le répare. Comme le vrai client, il refuse de lire une base dont le dossier a disparu.
 */
function scanDolt() {
  let held = false;
  const parked: (() => void)[] = [];
  const broken = new Set<string>();
  let prefixReads = 0;
  let watchers: { count: number; resolve: () => void }[] = [];
  const dolt: DoltClient = {
    open: (dir) => ({
      dir,
      async query(sql) {
        if (!existsSync(dir)) throw new DoltQueryError(`Dossier introuvable : ${dir}`, dir);
        if (sql.includes("'issue_prefix'")) {
          prefixReads++;
          for (const watcher of watchers.filter((w) => prefixReads >= w.count)) watcher.resolve();
          watchers = watchers.filter((w) => prefixReads < w.count);
          if (held) await new Promise<void>((resolve) => parked.push(resolve));
          if ([...broken].some((name) => dir.startsWith(join(root, name, '.beads')))) throw new DoltQueryError('table config absente', dir);
          return [{ value: 'x' }];
        }
        if (sql.includes("hashof('HEAD')")) return [{ head: 'h1' }];
        if (sql.includes('from labels') || sql.includes('from comments') || sql.includes('from dependencies')) return [];
        return [SUMMARY as Row];
      },
    }),
  };
  return {
    dolt,
    hold: () => {
      held = true;
    },
    release: () => {
      held = false;
      for (const resume of parked.splice(0)) resume();
    },
    breakPrefix: (name: string) => void broken.add(name),
    repairPrefix: (name: string) => void broken.delete(name),
    prefixReads: () => prefixReads,
    reached: (count: number) => (prefixReads >= count ? Promise.resolve() : new Promise<void>((resolve) => watchers.push({ count, resolve }))),
  };
}

const STILL_WAITING = 'attend toujours le scan' as const;

/**
 * Le résultat de `request` s'il arrive alors que le scan est encore retenu, `STILL_WAITING` si elle n'a pas répondu au bout de `boundMs`.
 * Un scan retenu ne finit jamais de lui-même, donc une demande qui n'a pas répondu l'attend vraiment. Une demande servie d'après le
 * dernier scan, elle, ne dépend d'aucune entrée-sortie du scan : la borne par défaut est large (on ne la paie que quand le test échoue) ;
 * celle d'une demande qui doit attendre est courte (un instant suffit à voir qu'elle ne répond pas).
 */
function whileHeld<T>(request: Promise<T>, boundMs = 3_000): Promise<Awaited<T> | typeof STILL_WAITING> {
  return Promise.race([request, sleep(boundMs).then(() => STILL_WAITING)]);
}

const WAITS = 150;

describe('lectures pendant un rescan des Projets (bdesk-38k.28)', () => {
  let scan: ReturnType<typeof scanDolt>;
  const serviceFor = (rescanIntervalMs?: number, config: Config = { roots: [root], projects: [], hiddenProjects: [] }) =>
    createProjectService(config, { dolt: scan.dolt, rescanIntervalMs });

  beforeEach(() => {
    scan = scanDolt();
    for (const name of ['a', 'b', 'c']) project(name);
  });

  afterEach(() => scan.release()); // un test qui échoue ne laisse aucun scan en suspens

  describe('un Projet que le dernier scan connaît et dit lisible', () => {
    it('est servi sans attendre la fin du scan en cours : HEAD, liste des tickets, fiche', async () => {
      const service = serviceFor();
      await service.list(); // le premier scan : un préfixe lu par Projet
      scan.hold();
      elapse(3_000); // ce scan a plus de 2 s : list() en lance un autre
      let rescanned = false;
      const rescan = service.list().then(() => {
        rescanned = true;
      });
      await scan.reached(6); // le rescan lit les préfixes des trois Projets, retenu

      expect(await whileHeld(service.head('a'))).toBe('h1');
      expect(await whileHeld(service.issues('a'))).toMatchObject([{ id: 'x-1' }]);
      expect(await whileHeld(service.issue('b', 'x-1'))).toMatchObject({ id: 'x-1' });
      expect(rescanned).toBe(false); // elles ont répondu, et le scan n'a pas fini pour autant

      scan.release();
      await rescan;
    });

    it('ne lance pas un second scan : toutes les demandes du rescan en partagent un seul', async () => {
      const service = serviceFor();
      await service.list();
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(6);

      const served = await whileHeld(Promise.all(['a', 'b', 'c', 'a', 'b', 'c', 'a'].map((id) => service.issues(id))));
      const unknown = service.issues('inconnu').catch((error: unknown) => error); // attend le scan en cours, ne lui en ajoute pas un
      expect(served).toHaveLength(7);
      expect(await whileHeld(unknown, WAITS)).toBe(STILL_WAITING);
      scan.release();
      await rescan;
      expect(await unknown).toBeInstanceOf(ProjectNotFoundError);

      expect(scan.prefixReads()).toBe(6); // deux scans de trois Projets : jamais de troisième
    });

    it('est servi aussi quand c’est lui qui constate que le dernier scan est périmé (30 s) : le rescan part en arrière-plan, une seule fois', async () => {
      const service = serviceFor();
      await service.list();
      project('d'); // ajouté depuis : seul un nouveau scan le trouvera
      scan.hold();
      elapse(31_000);

      expect(await whileHeld(service.issues('a'))).toMatchObject([{ id: 'x-1' }]); // il n'attend pas le scan qu'il déclenche
      await scan.reached(7); // le rescan est parti : quatre Projets lus, d compris
      expect(await whileHeld(service.issues('b'))).toMatchObject([{ id: 'x-1' }]);
      const added = service.issues('d'); // inconnu du dernier scan : il attend celui qui tourne
      expect(await whileHeld(added, WAITS)).toBe(STILL_WAITING);
      scan.release();

      expect(await added).toMatchObject([{ id: 'x-1' }]);
      expect(scan.prefixReads()).toBe(7); // 3 + 4 : le rescan n'a pas été relancé par les demandes suivantes
    });

    it('ne coûte aucun scan tant que le dernier n’a pas 30 s, et jamais pour le HEAD, quel que soit l’âge du dernier scan', async () => {
      const service = serviceFor();
      await service.list();
      elapse(29_000);

      await Promise.all([service.issues('a'), service.issue('b', 'x-1'), service.head('c')]);
      elapse(120_000);
      await service.head('a'); // le sondage du direct ne redécouvre rien (bdesk-38k.8)

      expect(scan.prefixReads()).toBe(3);
    });
  });

  describe('un Projet que le dernier scan ne connaît pas, ou dit illisible : le scan en cours fait foi', () => {
    it('attend le scan, qui le trouve s’il existe depuis', async () => {
      const service = serviceFor();
      await service.list();
      project('d');
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(7);

      const added = service.issues('d');
      expect(await whileHeld(added, WAITS)).toBe(STILL_WAITING);
      scan.release();

      expect(await added).toMatchObject([{ id: 'x-1' }]);
      await rescan;
    });

    it('attend le scan, qui dit s’il n’existe pas : 404, jamais une réponse avant lui', async () => {
      const service = serviceFor();
      await service.list();
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(6);

      const unknown = service.head('inconnu').catch((error: unknown) => error);
      expect(await whileHeld(unknown, WAITS)).toBe(STILL_WAITING);
      scan.release();

      expect(await unknown).toBeInstanceOf(ProjectNotFoundError);
      await rescan;
    });

    it('attend le scan, qui dit s’il a été réparé : sa base manquait', async () => {
      project('casse', { database: false });
      const service = serviceFor();
      await expect(service.issues('casse')).rejects.toBeInstanceOf(ProjectUnreadableError);
      mkdirSync(join(root, 'casse', '.beads', 'embeddeddolt', 'casse', '.dolt'), { recursive: true });
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(7); // trois Projets au premier scan, quatre au second : casse est lisible maintenant

      const repaired = service.issues('casse');
      expect(await whileHeld(repaired, WAITS)).toBe(STILL_WAITING);
      scan.release();

      expect(await repaired).toMatchObject([{ id: 'x-1' }]);
      await rescan;
    });

    it('attend le scan, qui dit s’il a été réparé : sa base était là, mais son préfixe illisible (un Projet illisible n’est pas servi d’après le dernier scan, même avec le dossier de sa base)', async () => {
      scan.breakPrefix('b');
      const service = serviceFor();
      expect((await service.list()).projects.find((p) => p.id === 'b')).toMatchObject({ status: 'unreadable', reason: 'table config absente' });
      scan.repairPrefix('b');
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(6); // trois préfixes au premier scan (celui de b échoue), trois au second

      const repaired = service.issues('b');
      expect(await whileHeld(repaired, WAITS)).toBe(STILL_WAITING); // la lecture de sa base aurait réussi aussitôt : seule l'attente du scan le prouve
      scan.release();

      expect(await repaired).toMatchObject([{ id: 'x-1' }]);
      await rescan;
    });
  });

  describe('un Projet supprimé pendant le scan', () => {
    it('est lu comme le dernier scan le connaît, donc illisible tant que son dossier manque, puis inconnu (404) quand le scan l’a retiré', async () => {
      const service = serviceFor();
      await service.list();
      rmSync(join(root, 'c'), { recursive: true });
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(5); // le rescan ne lit plus que a et b

      const during = await whileHeld(service.issues('c').catch((error: unknown) => error));
      expect(during).toBeInstanceOf(ProjectUnreadableError); // aussitôt, sans attendre le scan, et jamais des données inventées
      expect((during as ProjectUnreadableError).reason).toContain('Dossier introuvable');
      scan.release();
      await rescan;

      await expect(service.issues('c')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });

    it('reste lisible tant que sa base existe : masqué ou déplacé sans toucher à la base, il est servi jusqu’à la fin du scan', async () => {
      const config: Config = { roots: [root], projects: [], hiddenProjects: [] };
      const service = serviceFor(undefined, config);
      await service.list();
      config.hiddenProjects.push(join(root, 'c')); // le rescan ne le trouvera plus
      scan.hold();
      elapse(3_000);
      const rescan = service.list();
      await scan.reached(5);

      expect(await whileHeld(service.issues('c'))).toMatchObject([{ id: 'x-1' }]);
      scan.release();
      await rescan;
      await expect(service.issues('c')).rejects.toBeInstanceOf(ProjectNotFoundError);
    });
  });

  describe('erreurs du scan', () => {
    /** Une configuration dont la lecture échoue sur commande : le scan, lui, rejette (il ne le fait jamais pour une base illisible). */
    function flakyConfig() {
      const state = { failing: false, failures: 0 };
      const config = { roots: [root], hiddenProjects: [] } as unknown as Config;
      Object.defineProperty(config, 'projects', {
        enumerable: true,
        get() {
          if (!state.failing) return [];
          state.failures++;
          throw new Error('configuration illisible');
        },
      });
      return { config, state };
    }

    /** Laisse passer assez de tours de la boucle d'événements pour qu'un rejet sans gestionnaire soit signalé. */
    const settle = async () => {
      for (let turn = 0; turn < 5; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
    };

    it('l’échec du rescan arrive à qui l’attend, jamais à qui est servi du dernier scan, et le suivant réessaie', async () => {
      const { config, state } = flakyConfig();
      const service = serviceFor(undefined, config);
      await service.list();
      state.failing = true;
      elapse(3_000);

      const rescan = service.list().catch((error: unknown) => error);
      const unknown = service.issues('inconnu').catch((error: unknown) => error);
      const served = await service.head('a'); // servi d'après le premier scan : le rescan ne le concerne pas

      expect(served).toBe('h1');
      expect(await rescan).toMatchObject({ message: 'configuration illisible' });
      expect(await unknown).toMatchObject({ message: 'configuration illisible' }); // l'attente d'un Projet inconnu reçoit l'erreur du scan
      state.failing = false;
      elapse(500); // un scan raté n'est gardé que 500 ms après le premier échec (bdesk-38k.47) : ensuite le suivant en lance un autre
      const retried = await service.list();
      expect(retried.projects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
      expect(state.failures).toBe(1);
    });

    it('un rescan d’arrière-plan qui échoue ne laisse aucune promesse rejetée, ne gêne personne, et le suivant réessaie', async () => {
      const { config, state } = flakyConfig();
      const service = serviceFor(undefined, config);
      await service.list();
      const unhandled: unknown[] = [];
      const record = (reason: unknown) => void unhandled.push(reason);
      process.on('unhandledRejection', record);
      try {
        state.failing = true;
        elapse(31_000); // périmé : la demande qui suit lance un rescan que personne n'attend
        expect(await service.issues('a')).toMatchObject([{ id: 'x-1' }]);
        while (state.failures === 0) await sleep(1); // le rescan a échoué
        await settle();
        expect(unhandled).toEqual([]);

        state.failing = false;
        elapse(500); // le délai qui suit le premier échec d'un scan (bdesk-38k.47)
        scan.hold();
        expect(await whileHeld(service.issues('b'))).toMatchObject([{ id: 'x-1' }]); // toujours servi
        await scan.reached(6); // et un nouveau rescan est parti : l'échec n'a pas bloqué les suivants
        scan.release();
        await settle();
        expect(unhandled).toEqual([]);
      } finally {
        process.off('unhandledRejection', record);
      }
    });

    it('un rescan réussi remplace la liste servie : le Projet ajouté pendant l’échec précédent est trouvé', async () => {
      const { config, state } = flakyConfig();
      const service = serviceFor(undefined, config);
      await service.list();
      state.failing = true;
      elapse(31_000);
      await service.issues('a'); // son rescan échoue en arrière-plan
      while (state.failures === 0) await sleep(1);
      await settle();
      state.failing = false;
      project('d');
      elapse(500); // le délai qui suit le premier échec d'un scan (bdesk-38k.47)

      expect(await service.issues('d')).toMatchObject([{ id: 'x-1' }]); // inconnu : attend un scan, qui part et réussit
    });
  });

  describe('à travers l’API', () => {
    it('GET /api/projects/:p/issues répond sans attendre le rescan ; un Projet inconnu l’attend, puis 404', async () => {
      const service = serviceFor();
      const app = buildServer({ config: { roots: [root], projects: [], hiddenProjects: [] }, projects: service });
      try {
        await service.list();
        scan.hold();
        elapse(3_000);
        const rescan = service.list();
        await scan.reached(6);

        const known = await whileHeld(app.inject({ url: '/api/projects/a/issues' }));
        const issue = await whileHeld(app.inject({ url: '/api/projects/b/issues/x-1' }));
        const unknown = app.inject({ url: '/api/projects/inconnu/issues' });

        expect(known).toMatchObject({ statusCode: 200 });
        expect(issue).toMatchObject({ statusCode: 200 });
        expect(await whileHeld(unknown, WAITS)).toBe(STILL_WAITING);
        scan.release();
        await rescan;
        expect(await unknown).toMatchObject({ statusCode: 404 });
      } finally {
        await app.close();
      }
    });
  });
});
