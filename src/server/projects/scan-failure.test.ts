import { mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import type { DoltClient, Row } from '../dolt/client';
import { scratchDir } from '../testing/scratch';
import { createProjectService, ProjectNotFoundError, type ProjectService } from './service';

/**
 * Un scan des Projets qui échoue durablement n'est pas relancé à chaque demande (bdesk-38k.47). Un scan qui échoue ne laissait aucune
 * trace : la demande suivante, quelle qu'elle soit (le sondage du HEAD d'un Projet connu, que son âge ne déclenche pas, comprise),
 * en lançait un autre aussitôt, et tant que l'échec durait les scans s'enchaînaient au rythme des demandes, sans autre borne que les
 * quatre processus de la voie `discovery`. Désormais un scan qui a échoué n'est relancé qu'au bout d'un délai qui croît : 500 ms après
 * le premier échec, le double à chaque échec consécutif, au plus `rescanIntervalMs` (5 s), remis à 500 ms par un scan réussi. Un échec
 * passager est ainsi rattrapé par la nouvelle tentative automatique du client (`shouldRetry`, une seconde plus tard), et un échec
 * durable ne coûte plus qu'un scan par 5 s. Entre-temps, les demandes reçoivent l'erreur du scan, ou, pour un Projet que le dernier scan
 * achevé connaît et dit lisible, sont servies d'après lui (stale-while-revalidate, bdesk-38k.28) sans que rien n'ait changé pour elles.
 *
 * Les durées sont celles d'une horloge simulée : seul `Date` l'est (le service ne date ses scans qu'avec lui), les entrées-sorties et
 * les tours de la boucle d'événements restent réels. Le scan qui échoue est commandé par le test : sa configuration en fait lever
 * la lecture des racines, aussitôt ou quand le test le décide.
 */

let root: string;

beforeEach(() => {
  root = realpathSync(scratchDir('bdesk-failure-'));
  for (const name of ['a', 'b', 'c']) project(name);
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-05T12:00:00Z'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Un Projet Dolt embedded dans `root`. */
function project(name: string): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
}

const SUMMARY = { id: 'x-1', title: 'T', issue_type: 'task', status: 'open', priority: 2, created_at: '2026-10-19 16:46:38', updated_at: '2026-10-19 16:46:38' };

/** Un faux client dolt qui répond partout : le préfixe d'un scan, le HEAD, les tickets. */
const dolt: DoltClient = {
  open: (dir) => ({
    dir,
    async query(sql) {
      if (sql.includes("'issue_prefix'")) return [{ value: 'x' }];
      if (sql.includes("hashof('HEAD')")) return [{ head: 'h1' }];
      if (sql.includes('from labels') || sql.includes('from comments') || sql.includes('from dependencies')) return [];
      return [SUMMARY as Row];
    },
  }),
};

/**
 * La configuration d'un scan commandé : chaque scan lit les racines une fois (`state.scans` les compte), et `state.mode` dit ce qui arrive.
 * `ok` : la lecture réussit ; `fail` : elle lève aussitôt ; `slow` : le scan dure jusqu'à ce que le test appelle `state.failNow()`, qui
 * le fait échouer à cet instant.
 */
function scanConfig() {
  const state = {
    scans: 0,
    mode: 'ok' as 'ok' | 'fail' | 'slow',
    error: new Error('racine illisible'),
    failNow: (() => {
      throw new Error('aucun scan lent en cours');
    }) as () => void,
  };
  const roots = [root];
  roots.map = ((visit: (path: string) => unknown) => {
    state.scans++;
    if (state.mode === 'fail') throw state.error;
    if (state.mode === 'slow') {
      return [
        new Promise((_resolve, reject) => {
          state.failNow = () => reject(state.error);
        }),
      ];
    }
    return [root].map(visit);
  }) as typeof roots.map;
  return { config: { roots, projects: [], hiddenProjects: [] } as Config, state };
}

const advance = (ms: number) => void vi.advanceTimersByTime(ms);

/** Laisse passer assez de tours de la boucle d'événements pour qu'un scan lancé en arrière-plan ait fini d'échouer. */
const settle = async () => {
  for (let turn = 0; turn < 5; turn++) await new Promise<void>((resolve) => setImmediate(resolve));
};

const outcome = <T>(request: Promise<T>) => request.then((value) => ({ value }), (error: unknown) => ({ error }));

/**
 * `rounds` tours de demandes de toute sorte, l'un après l'autre (une demande qui arrive pendant un scan le partage : c'est celle qui
 * arrive après son échec qui le relançait) : le sondage du HEAD d'un Projet connu, la liste de ses tickets, un Projet inconnu, la liste
 * des Projets. Ce que chacune rend, ou l'erreur qu'elle reçoit.
 */
async function burst(service: ProjectService, rounds = 6) {
  const known: unknown[] = [];
  const unknown: unknown[] = [];
  const list: unknown[] = [];
  for (let round = 0; round < rounds; round++) {
    const [head, issues, missing, projects] = await Promise.all([
      outcome(service.head('a')),
      outcome(service.issues('b')),
      outcome(service.head('inconnu')),
      outcome(service.list()),
    ]);
    known.push(head, issues);
    unknown.push(missing);
    list.push(projects);
    await settle(); // un scan lancé en arrière-plan par une demande qui ne l'attend pas a fini d'échouer
  }
  return { known, unknown, list };
}

/** Comme `burst`, mais de demandes que le dernier scan achevé suffit à servir : aucune n'attend un scan. */
async function poll(service: ProjectService, rounds = 6) {
  for (let round = 0; round < rounds; round++) {
    await Promise.all([service.head('a'), service.issues('b'), service.head('c')]);
    await settle();
  }
}

describe('un scan des Projets qui échoue durablement (bdesk-38k.47)', () => {
  it('ne relance pas un scan à chaque demande : une salve, sondage du HEAD compris, n’en lance qu’un', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list(); // le premier scan réussit : de quoi servir les Projets connus
    expect(state.scans).toBe(1);
    state.mode = 'fail';
    advance(31_000); // plus de 30 s : le scan est dû, et c'est la première demande qui le lance

    await burst(service);

    expect(state.scans).toBe(2); // un seul, pour les vingt-quatre demandes de six tours
  });

  it('espace les scans qui échouent : 500 ms après le premier échec, le double à chaque échec consécutif, au plus 5 s, et un seul scan par délai', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);
    await burst(service); // le premier échec : le délai qui suit est de 500 ms
    expect(state.scans).toBe(2);

    let scans = 2;
    for (const delay of [500, 1_000, 2_000, 4_000, 5_000, 5_000, 5_000]) {
      advance(delay - 1); // un ms avant la fin du délai : toujours dans le délai
      await burst(service);
      expect(state.scans).toBe(scans);
      advance(1); // le délai est écoulé
      await burst(service);
      expect(state.scans).toBe(++scans);
    }
  });

  it('rattrape un échec passager à la nouvelle tentative automatique du client, une seconde plus tard (shouldRetry : une 500 est réessayée une fois, après 1 s)', async () => {
    const { config, state } = scanConfig();
    state.mode = 'fail'; // le scan de démarrage (cli.ts), le premier de tous, échoue une fois
    const service = createProjectService(config, { dolt });
    await expect(service.list()).rejects.toBe(state.error);
    state.mode = 'ok'; // la panne est passée

    advance(300); // la page se charge : le délai (500 ms) court encore, la liste reçoit l'erreur du scan sans en lancer un autre
    await expect(service.list()).rejects.toBe(state.error);
    expect(state.scans).toBe(1);

    advance(1_000); // la nouvelle tentative automatique du client : le délai est écoulé, un scan part et réussit
    expect((await service.list()).projects.map((p) => p.id)).toEqual(['a', 'b', 'c']);
    expect(state.scans).toBe(2);
  });

  it('un scan réussi remet le délai à 500 ms : l’échec suivant ne reprend pas où le précédent en était', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);
    await burst(service); // premier échec : 500 ms
    advance(500);
    await burst(service); // deuxième : 1 s
    advance(1_000);
    await burst(service); // troisième : 2 s
    expect(state.scans).toBe(4);

    state.mode = 'ok';
    advance(2_000);
    await service.list(); // le scan réussit : les échecs consécutifs repartent de zéro
    expect(state.scans).toBe(5);

    state.mode = 'fail';
    advance(2_001); // la liste est périmée (2 s) : le scan part, et échoue
    await burst(service);
    expect(state.scans).toBe(6);
    advance(499); // 4 s, le quatrième échec d'une série ininterrompue, ne s'applique pas : 500 ms
    await burst(service);
    expect(state.scans).toBe(6);
    advance(1);
    await burst(service);
    expect(state.scans).toBe(7);
  });

  it('une horloge qui recule ne garde pas l’échec : un écart négatif rend le scan dû', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);
    await burst(service);
    expect(state.scans).toBe(2);

    vi.setSystemTime(Date.now() - 3_600_000); // l'horloge murale recule d'une heure (synchronisation, changement manuel)
    state.mode = 'ok';
    advance(60_000); // une minute plus tard, elle retarde encore de 59 minutes sur l'instant de l'échec
    expect((await service.list()).projects.map((p) => p.id)).toEqual(['a', 'b', 'c']); // un scan est parti, la panne est passée
    expect(state.scans).toBe(3);
  });

  it('une horloge qui recule pendant qu’un scan tourne ne lui en ajoute pas un second : le scan en cours reste partagé', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'slow';
    advance(31_000);
    expect(await service.issues('a')).toMatchObject([{ id: 'x-1' }]); // le scan dû part en arrière-plan, et ne finit pas de lui-même
    await settle();
    expect(state.scans).toBe(2);

    vi.setSystemTime(Date.now() - 3_600_000);
    await poll(service); // servies d'après le dernier scan achevé, elles partagent le scan en cours
    expect(state.scans).toBe(2);
    state.failNow();
  });

  it('une horloge qui recule ne garde pas non plus un scan réussi : la liste n’attend pas que l’horloge rattrape', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    expect(state.scans).toBe(1);

    vi.setSystemTime(Date.now() - 3_600_000);
    await service.list();
    expect(state.scans).toBe(2); // l'âge du scan est inconnu : un scan, qui se date de l'horloge d'à présent
    await service.list();
    expect(state.scans).toBe(2); // puis la fenêtre de 2 s reprend
  });

  it('sert un Projet connu d’après le dernier scan achevé, pendant l’échec comme avant : seuls la liste et un Projet inconnu reçoivent l’erreur', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);

    const { known, unknown, list } = await burst(service);

    expect(known).toHaveLength(12);
    for (const result of known) expect(result).toHaveProperty('value'); // le HEAD « h1 » et la liste des tickets, jamais une erreur
    expect(known[0]).toEqual({ value: 'h1' });
    expect(known[1]).toMatchObject({ value: [{ id: 'x-1' }] });
    for (const result of unknown) expect(result).toEqual({ error: state.error }); // l'erreur du scan, pas un 404 : on ne sait pas s'il existe
    for (const result of list) expect(result).toEqual({ error: state.error });
    expect(state.scans).toBe(2);
  });

  it('le sondage du HEAD d’un Projet connu ne relance pas le scan qui vient d’échouer, lecture après lecture', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(120_000);
    await service.issues('c'); // le scan dû, que le sondage du HEAD ne lance jamais à cause de l'âge (bdesk-38k.8), part et échoue
    await settle();
    expect(state.scans).toBe(2);

    for (let probe = 0; probe < 20; probe++) {
      expect(await service.head('c')).toBe('h1');
      await settle();
    }

    expect(state.scans).toBe(2);
  });

  it('un premier scan qui échoue (aucun scan achevé à servir) n’est pas relancé non plus par les demandes qui l’attendent', async () => {
    const { config, state } = scanConfig();
    state.mode = 'fail';
    const service = createProjectService(config, { dolt });

    const { known, unknown, list } = await burst(service);

    for (const result of [...known, ...unknown, ...list]) expect(result).toEqual({ error: state.error }); // rien n'est connu : toutes l'attendent
    expect(state.scans).toBe(1);
  });

  it('compte le délai depuis la FIN du scan qui échoue, non depuis son début : un scan lent qui échoue ne rouvre pas la porte aussitôt', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'slow';
    advance(31_000);
    expect(await service.issues('a')).toMatchObject([{ id: 'x-1' }]); // le scan dû part en arrière-plan : la demande ne l'attend pas
    await settle();
    expect(state.scans).toBe(2);

    advance(4_000); // le scan dure depuis 4 s
    state.failNow(); // et échoue maintenant
    state.mode = 'fail'; // ceux qui suivent échouent aussitôt
    await settle();
    advance(499); // 4,499 s après son début, 499 ms après sa fin : le délai (500 ms) court encore
    await burst(service);
    expect(state.scans).toBe(2);

    advance(1);
    await burst(service);
    expect(state.scans).toBe(3);
  });

  it('après le délai, la demande d’un Projet connu relance un scan en arrière-plan sans l’attendre : le stale-while-revalidate tient', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);
    await burst(service);
    state.mode = 'slow'; // le prochain scan ne finit pas de lui-même
    advance(500); // le délai qui suit le premier échec

    expect(await service.issues('a')).toMatchObject([{ id: 'x-1' }]); // servie aussitôt, alors que le scan qu'elle a lancé tourne
    await settle();
    expect(state.scans).toBe(3);
    await poll(service); // pendant ce scan, les demandes d'un Projet connu sont servies sans l'attendre, et le partagent : aucun autre
    expect(state.scans).toBe(3);
    advance(60_000); // un scan qui dure plus que toutes les fenêtres (2 s, 30 s) reste le scan en cours : on ne le prend pas pour périmé
    await poll(service);
    expect(state.scans).toBe(3);
    state.failNow();
  });

  it('un scan qui réussit après le délai remplace l’échec : la liste revient, un Projet ajouté est trouvé, la fenêtre de 2 s des listes est celle d’avant', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    state.mode = 'fail';
    advance(31_000);
    await burst(service);
    state.mode = 'ok';
    project('d');
    advance(500);

    expect((await service.list()).projects.map((p) => p.id)).toEqual(['a', 'b', 'c', 'd']);
    expect(state.scans).toBe(3);
    await service.list(); // moins de 2 s après ce scan : il est partagé
    expect(state.scans).toBe(3);
    advance(2_001);
    await service.list();
    expect(state.scans).toBe(4);
    await expect(service.issues('d')).resolves.toMatchObject([{ id: 'x-1' }]);
    await expect(service.issues('inconnu')).rejects.toBeInstanceOf(ProjectNotFoundError); // un scan réussi dit de nouveau qui est inconnu : 404
  });

  it('le délai croît jusqu’à `rescanIntervalMs` : celui qu’on donne, et 0 pour une relance à chaque demande', async () => {
    const short = scanConfig();
    const quick = createProjectService(short.config, { dolt, rescanIntervalMs: 1_000 });
    await quick.list();
    short.state.mode = 'fail';
    advance(31_000);
    await burst(quick);
    expect(short.state.scans).toBe(2);
    let scans = 2;
    for (const delay of [500, 1_000, 1_000]) { // plafonné à 1 s, non 2 s ni 4 s
      advance(delay - 1);
      await burst(quick);
      expect(short.state.scans).toBe(scans);
      advance(1);
      await burst(quick);
      expect(short.state.scans).toBe(++scans);
    }

    const tiny = scanConfig();
    const capped = createProjectService(tiny.config, { dolt, rescanIntervalMs: 200 }); // sous 500 ms : le plafond l'emporte dès le premier échec
    await capped.list();
    tiny.state.mode = 'fail';
    advance(31_000);
    await burst(capped);
    advance(199);
    await burst(capped);
    expect(tiny.state.scans).toBe(2);
    advance(1);
    await burst(capped);
    expect(tiny.state.scans).toBe(3);

    const none = scanConfig();
    const eager = createProjectService(none.config, { dolt, rescanIntervalMs: 0 });
    await eager.list();
    none.state.mode = 'fail';
    advance(31_000);
    await burst(eager, 3);
    expect(none.state.scans).toBe(4); // sans délai : chaque tour relance le scan, comme avant
  });

  it('ne change rien à un scan qui réussit : la fenêtre de 2 s des listes et celle de 30 s des Projets connus', async () => {
    const { config, state } = scanConfig();
    const service = createProjectService(config, { dolt });
    await service.list();
    await service.list();
    expect(state.scans).toBe(1);
    advance(2_001);
    await service.list();
    expect(state.scans).toBe(2);
    advance(29_000);
    await Promise.all([service.head('a'), service.issues('b')]);
    await settle();
    expect(state.scans).toBe(2); // moins de 30 s, et jamais pour le HEAD
    advance(2_000);
    await service.issues('a');
    await settle();
    expect(state.scans).toBe(3); // 31 s : le scan dû part en arrière-plan
  });
});
