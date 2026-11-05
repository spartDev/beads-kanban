import { mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReadAborted } from '../abort';
import { createDoltClient } from '../dolt/client';
import { createMetricsService, type MetricsService } from '../metrics/service';
import { createProjectService } from '../projects/service';
import { fakeDolt } from '../testing/fake-dolt';
import { createChronologyService } from './service';

/**
 * Quitter la Vue globale à froid, puis ouvrir un ticket (bdesk-38k.37, remarque R1 de la relecture de bdesk-38k.33) : le vrai client, le
 * vrai lecteur d'historique et les vrais services devant un faux binaire, avec deux places seulement dans la voie des historiques.
 *
 * Les métriques de chaque Projet lisent son historique (cinq processus, dont quatre en même temps), et la lecture de l'historique garde un
 * délai de grâce quand son dernier demandeur part : à l'abandon de la Vue globale, les historiques de tous ses Projets restent en file,
 * retenus par la seule grâce, pour le cas où elle serait redemandée aussitôt. La requête qui arrive entre-temps, la chronologie du ticket
 * qu'on ouvre en partant ou les métriques d'un seul Projet, ne doit pas les attendre : elle passe devant (ADR 0003). Sans cela, elle
 * attendait la fin de la grâce, soit une seconde de plus en production.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend que `condition` soit vraie (20 s au plus). */
async function until(condition: () => boolean, what: string): Promise<void> {
  const deadline = Date.now() + 20_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error(`jamais vrai : ${what}`);
    await sleep(10);
  }
}

describe.skipIf(process.platform === 'win32')('Vue globale quittée à froid, puis une requête qui lit un historique (bdesk-38k.37)', { timeout: 60_000 }, () => {
  const GLOBAL = Array.from({ length: 6 }, (_, i) => `p${i + 1}`); // les Projets de la Vue globale
  const PLACES = 2;

  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-left-chrono-')));
    for (const name of [...GLOBAL, 'f']) {
      const beads = join(root, name, '.beads');
      mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
      writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
    }
    // Le préfixe répond aussitôt. Le HEAD répond aussitôt aussi, et le note à sa fin. Toute autre lecture note le Projet qu'elle lit à son lancement
    // (`hist` pour l'historique, `list` pour la liste des tickets), puis dure 0,15 s : le nombre de lectures lancées ne dépend que de l'ordonnancement.
    const ticket = `{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}`;
    const body = [
      `q="\${5#start transaction read only; }"`,
      `log="$(dirname "$0")/log"`,
      `case "$q" in`,
      `  *issue_prefix*) printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n'; exit 0;;`,
      `  *"hashof('HEAD'), 0"*|*dolt_history*|*dolt_log*|*"show columns"*|*"issue_type from issues order by id"*) kind=hist;;`,
      `  *"hashof('HEAD')"*) printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n'; echo "head $(basename "$PWD")" >> "$log"; exit 0;;`,
      `  *) kind=list;;`,
      `esac`,
      `echo "$kind $(basename "$PWD")" >> "$log"`,
      `sleep 0.15`,
      `case "$kind" in`,
      `  hist) printf '{}\\n\\n{"rows": []}\\n';;`,
      `  *) printf '{}\\n\\n{"rows": [${ticket}]}\\n{}\\n\\n';;`,
      `esac`,
    ].join('\n');
    const fake = fakeDolt(body);
    const log = () => {
      try {
        return readFileSync(join(fake.dir, 'log'), 'utf8').split('\n').filter(Boolean);
      } catch {
        return [];
      }
    };
    const projects = createProjectService(
      { roots: [root], projects: [], hiddenProjects: [] },
      { dolt: createDoltClient({ binary: fake.binary, maxAnalysis: PLACES, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }) },
    );
    // Une grâce de cinq secondes : la fin de la grâce ne peut pas servir la requête suivante (le test dure moins longtemps).
    const metrics = createMetricsService(projects, { graceMs: 5_000 });
    const chronologies = createChronologyService(projects);
    return { projects, metrics, chronologies, log };
  }

  /** La Vue globale, demandée à froid puis quittée une fois les historiques de six Projets en file derrière les deux places de la voie. */
  async function leaveGlobalView(metrics: MetricsService, log: () => string[]) {
    const controller = new AbortController();
    const computing = metrics.compute({ projects: GLOBAL, period: { range: '7d' } }, { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => log().filter((line) => line.startsWith('head p')).length === GLOBAL.length, 'le HEAD de chaque Projet est lu');
    await until(() => log().filter((line) => line.startsWith('hist ')).length >= PLACES, 'la voie des historiques est pleine');
    controller.abort();
    expect(await computing).toBeInstanceOf(ReadAborted);
  }

  /** Les historiques d'autres Projets lancés entre la lecture du HEAD de `f` et la fin de la lecture de son historique. */
  function launchedForNobody(log: () => string[]): number {
    const lines = log();
    const from = lines.indexOf('head f');
    const to = lines.lastIndexOf('hist f');
    expect(from).toBeGreaterThanOrEqual(0);
    expect(to).toBeGreaterThan(from);
    return lines.slice(from, to).filter((line) => line.startsWith('hist ') && line !== 'hist f').length;
  }

  // Sans le passe-droit : le HEAD de f lu, il reste vingt lectures et plus d'historiques de la Vue globale en file, lancées deux par deux avant celles de f.
  const AT_MOST = 8;

  it('la chronologie du ticket qu’on ouvre ne fait pas la queue derrière les historiques que seule la grâce retient', async () => {
    const { projects, metrics, chronologies, log } = setup();
    await projects.list();
    await leaveGlobalView(metrics, log);

    const chronology = await chronologies.chronology('f', 'x-1');

    expect(chronology.source).toBe('dates'); // x-1 est un ticket de la liste, absent de l'historique vide
    expect(launchedForNobody(log)).toBeLessThanOrEqual(AT_MOST);
  });

  it('les métriques d’un seul Projet, demandées aussitôt, non plus', async () => {
    const { projects, metrics, log } = setup();
    await projects.list();
    await leaveGlobalView(metrics, log);

    const response = await metrics.compute({ projects: ['f'], period: { range: '7d' } });

    expect(response.projects.map((project) => project.id)).toEqual(['f']);
    expect(launchedForNobody(log)).toBeLessThanOrEqual(AT_MOST);
  });
});
