import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { basename, join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReadAborted } from '../abort';
import { createDoltClient, type DoltClient } from '../dolt/client';
import { createMetricsService, type MetricsService } from '../metrics/service';
import { createProjectService } from '../projects/service';
import { fakeDolt } from '../testing/fake-dolt';
import { createChronologyService } from './service';

/**
 * Quitter la Vue globale, puis ouvrir un ticket : les lectures du HEAD que la Vue globale avait encore en file (bdesk-38k.42). Le vrai client, les
 * vrais services et le vrai lecteur du HEAD devant un faux binaire, avec deux places seulement dans la voie `light`.
 *
 * La Vue globale lit le HEAD de chacun de ses Projets (une lecture par Projet, quatre à la fois, plus une file derrière) : c'est la clé de son cache.
 * Ces lectures n'avaient aucun signal, donc ne quittaient jamais la file : à l'abandon de la Vue globale, celles qui n'étaient pas parties partaient
 * toutes, pour personne, et la lecture du HEAD de la chronologie qu'on ouvre en partant, arrivée derrière elles, les attendait (de 0,4 à 0,7 s mesurés
 * sur de vraies copies, ADR 0003). Désormais une lecture du HEAD encore en file quitte la file quand son dernier demandeur part ; une lecture déjà
 * lancée va au bout, sans être tuée.
 *
 * Les lectures du HEAD du faux binaire ne finissent que quand le test le décide (`go`) : ce qui est vérifié est l'ordonnancement, jamais une durée.
 * Le test n'attend jamais un délai : il attend qu'une lecture soit arrivée dans la file du client, ce que le faux binaire ne peut pas dire (une lecture
 * en file n'a lancé aucun processus), et que `observed` relève (`until`).
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend que `condition` soit vraie (20 s au plus) : la condition, jamais un délai fixe, dit que le test peut continuer. */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`jamais vrai : ${what}`);
    await sleep(10);
  }
}

/**
 * Le client Dolt, observé : à chaque lecture du HEAD (voie `light`) qui lui est demandée, le nom du Projet (celui de sa base) est noté dans `requested`.
 * La demande entre dans la file du client (ou rejoint une lecture identique qui y attend) avant que `query` ne rende la main : quand une demande est notée,
 * elle est donc en file ou lancée, jamais en route. Rien n'est changé à ce que le client fait de la lecture.
 */
function observed(client: DoltClient, requested: string[]): DoltClient {
  return {
    open: (dir) => {
      const db = client.open(dir);
      return {
        dir: db.dir,
        query: (sql, options) => {
          if (options?.lane === 'light') requested.push(basename(dir));
          return db.query(sql, options);
        },
        ...(db.queryAll ? { queryAll: db.queryAll.bind(db) } : {}),
      };
    },
  };
}

describe.skipIf(process.platform === 'win32')('Vue globale quittée, puis une lecture du HEAD : les lectures encore en file (bdesk-38k.42)', { timeout: 60_000 }, () => {
  const GLOBAL = Array.from({ length: 6 }, (_, i) => `p${i + 1}`); // les Projets de la Vue globale
  const PLACES = 2;

  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-left-head-')));
    for (const name of [...GLOBAL, 'f']) {
      const beads = join(root, name, '.beads');
      mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
      writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
    }
    // Le préfixe répond aussitôt. Une lecture du HEAD note le Projet qu'elle lit à son lancement (`head <Projet>`), puis attend (30 s au plus, pour ne jamais traîner
    // si un test échoue) que le fichier `go` existe. L'historique et la liste des tickets répondent aussitôt.
    const ticket = `{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}`;
    const body = [
      `d="$(dirname "$0")"`,
      `q="\${5#start transaction read only; }"`,
      `case "$q" in`,
      `  *issue_prefix*) printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n'; exit 0;;`,
      `  *"hashof('HEAD'), 0"*|*dolt_history*|*dolt_log*|*"show columns"*|*"issue_type from issues order by id"*) printf '{}\\n\\n{"rows": []}\\n'; exit 0;;`,
      `  *"hashof('HEAD')"*)`,
      `    echo "head $(basename "$PWD")" >> "$d/log"`,
      `    i=0; while [ ! -e "$d/go" ] && [ $i -lt 600 ]; do sleep 0.05; i=$((i+1)); done`,
      `    printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n'; exit 0;;`,
      `  *) printf '{}\\n\\n{"rows": [${ticket}]}\\n{}\\n\\n';;`,
      `esac`,
    ].join('\n');
    const fake = fakeDolt(body);
    const gate = join(fake.dir, 'go');
    const log = () => (existsSync(join(fake.dir, 'log')) ? readFileSync(join(fake.dir, 'log'), 'utf8').split('\n').filter(Boolean) : []);
    const requested: string[] = []; // les lectures du HEAD demandées au client, dans l'ordre d'arrivée
    const projects = createProjectService(
      { roots: [root], projects: [], hiddenProjects: [] },
      { dolt: observed(createDoltClient({ binary: fake.binary, maxLight: PLACES, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }), requested) },
    );
    const metrics = createMetricsService(projects, { graceMs: 5_000 });
    const chronologies = createChronologyService(projects);
    return { projects, metrics, chronologies, log, requested, go: () => writeFileSync(gate, '') };
  }

  /** Les lectures du HEAD de la Vue globale lancées, dans l'ordre (les deux premières partent ensemble : leurs lignes du journal arrivent dans le désordre, d'où `first`). */
  const launched = (log: () => string[]) => log().filter((line) => line.startsWith('head p'));
  const first = (log: () => string[]) => launched(log).slice(0, PLACES).sort();
  const afterwards = (log: () => string[]) => launched(log).slice(PLACES);

  /** Combien de lectures du HEAD de ce Projet ont été demandées au client (celles qui ont rejoint une lecture en file comprises). */
  const asked = (requested: string[], project: string) => requested.filter((name) => name === project).length;

  /** La Vue globale, demandée puis quittée une fois la voie `light` pleine : deux lectures du HEAD lancées, quatre derrière en file. */
  async function viewGlobal(metrics: MetricsService, log: () => string[], requested: string[]) {
    const controller = new AbortController();
    const computing = metrics.compute({ projects: GLOBAL, period: { range: '7d' } }, { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => launched(log).length === PLACES, 'la voie des lectures légères est pleine');
    await until(() => requested.length >= GLOBAL.length, 'les quatre autres lectures du HEAD sont arrivées dans la file');
    return { leave: () => controller.abort(), computing };
  }

  it('les lectures du HEAD de la Vue globale encore en file ne partent jamais, et la chronologie du ticket qu’on ouvre passe devant', async () => {
    const { projects, metrics, chronologies, log, requested, go } = setup();
    await projects.list();
    const view = await viewGlobal(metrics, log, requested);
    view.leave();
    expect(await view.computing).toBeInstanceOf(ReadAborted);

    const chronology = chronologies.chronology('f', 'x-1');
    await until(() => asked(requested, 'f') >= 1, 'la lecture du HEAD de la chronologie est arrivée dans la file');
    go();
    expect((await chronology).source).toBe('dates'); // x-1 est un ticket de la liste, absent de l'historique vide

    expect(first(log)).toEqual(['head p1', 'head p2']);
    expect(afterwards(log)).toEqual([]); // les quatre autres ne sont jamais parties
    expect(log().indexOf('head f')).toBe(2); // la chronologie a pris la première place libre
  });

  it('une lecture que la Vue globale partageait avec une autre demande reste en file : seule la dernière demande qui part la retire', async () => {
    const { projects, metrics, chronologies, log, requested, go } = setup();
    await projects.list();
    const view = await viewGlobal(metrics, log, requested);

    const chronology = chronologies.chronology('p4', 'x-1'); // la lecture du HEAD de p4 attend encore sa place : la chronologie la rejoint
    await until(() => asked(requested, 'p4') >= 2, 'la chronologie a demandé le HEAD de p4 au client');
    view.leave();
    expect(await view.computing).toBeInstanceOf(ReadAborted);
    go();

    expect((await chronology).source).toBe('dates');
    expect(first(log)).toEqual(['head p1', 'head p2']);
    expect(afterwards(log)).toEqual(['head p4']); // p3, p5 et p6, que personne n'attend plus, ne sont jamais parties
  });

  it('une Vue globale redemandée aussitôt lit chaque HEAD et aboutit : elle ne reprend pas une lecture abandonnée', async () => {
    const { projects, metrics, log, requested, go } = setup();
    await projects.list();
    const view = await viewGlobal(metrics, log, requested);
    view.leave();
    expect(await view.computing).toBeInstanceOf(ReadAborted);

    const again = metrics.compute({ projects: GLOBAL, period: { range: '7d' } });
    await until(() => requested.length >= 2 * GLOBAL.length, 'la Vue globale redemandée a demandé le HEAD de chaque Projet au client');
    go();
    const response = await again;

    expect(response.projects.map((project) => project.id)).toEqual(GLOBAL);
    expect(response.unreadable).toEqual([]);
  });

  it('la lecture du HEAD sans signal (le sondage du direct) n’est jamais retirée par l’abandon de la Vue globale', async () => {
    const { projects, metrics, log, requested, go } = setup();
    await projects.list();
    const view = await viewGlobal(metrics, log, requested);

    const polled = projects.head('p5'); // le sondage du direct : pas de signal
    await until(() => asked(requested, 'p5') >= 2, 'le sondage a demandé le HEAD de p5 au client');
    view.leave();
    expect(await view.computing).toBeInstanceOf(ReadAborted);
    go();

    expect(await polled).toBe('h1');
    expect(first(log)).toEqual(['head p1', 'head p2']);
    expect(afterwards(log)).toEqual(['head p5']); // le sondage garde la lecture de p5 en file ; p3, p4 et p6 n'ont plus de demandeur
  });
});
