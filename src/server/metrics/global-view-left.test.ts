import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { ReadAborted } from '../abort';
import { createDoltClient } from '../dolt/client';
import { createProjectService, type ProjectService } from '../projects/service';
import { fakeDolt } from '../testing/fake-dolt';
import { createMetricsService } from './service';

/**
 * Quitter la Vue globale à froid (bdesk-38k.33, remarque r1 de la relecture finale de bdesk-38k.20), en petit et sans vrai dolt : le
 * vrai client et le vrai service de Projets devant un faux binaire, avec deux places seulement pour huit Projets. Les métriques de
 * chaque Projet lisent sa liste de tickets (voie `normal`) et son historique (voie `analysis`) ; le délai de grâce ne retient que
 * l'historique, que la requête suivante redemande aussitôt. Une liste de tickets qui attend encore sa place doit quitter la file
 * quand le client part, sans quoi elle est lue pour personne, devant la fiche que l'utilisateur ouvre ensuite.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Attend que `condition` soit vraie (10 s au plus). */
async function until(condition: () => boolean): Promise<void> {
  const deadline = Date.now() + 10_000;
  while (!condition()) {
    if (Date.now() > deadline) throw new Error('condition jamais remplie');
    await sleep(10);
  }
}

describe.skipIf(process.platform === 'win32')('Vue globale quittée à froid (bdesk-38k.33)', { timeout: 60_000 }, () => {
  const PROJECTS = Array.from({ length: 8 }, (_, i) => `p${i + 1}`);
  const PLACES = 2;

  function setup() {
    const root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-left-')));
    for (const name of [...PROJECTS, 'f']) {
      const beads = join(root, name, '.beads');
      mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
      writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
    }
    // Le préfixe et le HEAD répondent aussitôt. Toute autre lecture (les tickets d'un Projet) note le Projet qu'elle lit dans `started`,
    // puis attend que le test la libère : le nombre de lectures lancées ne dépend ainsi que de l'ordonnancement, pas de la vitesse de la machine.
    const ticket = `{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}`;
    const body = [
      `q="\${5#start transaction read only; }"`,
      `case "$q" in`,
      `  *issue_prefix*) printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n';;`,
      `  *"hashof('HEAD')"*) printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n';;`,
      `  *) basename "$PWD" >> "$(dirname "$0")/started"`,
      `     while [ ! -e "$(dirname "$0")/release" ]; do sleep 0.02; done`,
      `     case "$q" in`,
      `       *"where id ="*) printf '{}\\n\\n{"rows": [${ticket}]}\\n{}\\n\\n{}\\n\\n';;`,
      `       *) printf '{}\\n\\n{"rows": [${ticket}]}\\n{}\\n\\n';;`,
      `     esac;;`,
      `esac`,
    ].join('\n');
    const fake = fakeDolt(body);
    const started = () => (existsSync(join(fake.dir, 'started')) ? readFileSync(join(fake.dir, 'started'), 'utf8').split('\n').filter(Boolean) : []);
    const release = () => writeFileSync(join(fake.dir, 'release'), '');
    const real = createProjectService(
      { roots: [root], projects: [], hiddenProjects: [] },
      { dolt: createDoltClient({ binary: fake.binary, maxConcurrent: PLACES, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }) },
    );
    // L'historique est hors de la voie des tickets : ici il répond aussitôt, seules les lectures de tickets sont en jeu.
    const projects: ProjectService = { ...real, histories: async () => [] };
    return { projects, started, release };
  }

  /** La Vue globale demandée à froid, avec un délai de grâce qui dépasse largement le test (sans lui, rien ne distinguerait les deux versions). */
  async function openGlobalView(projects: ProjectService, started: () => string[]) {
    await projects.list();
    const metrics = createMetricsService(projects, { graceMs: 60_000 });
    const controller = new AbortController();
    const computing = metrics.compute({ projects: PROJECTS, period: { range: '7d' } }, { signal: controller.signal }).catch((e: unknown) => e);
    await until(() => started().length === PLACES); // les places sont prises, les six autres listes font la queue
    return {
      leave: async () => {
        controller.abort();
        expect(await computing).toBeInstanceOf(ReadAborted);
      },
    };
  }

  it('les listes de tickets qui attendaient encore une place ne sont jamais lues, même pendant le délai de grâce de l’historique', async () => {
    const { projects, started, release } = setup();
    try {
      const view = await openGlobalView(projects, started);

      await view.leave();
      release(); // les deux lectures lancées finissent ; une place se libère pour la suivante, si elle attendait encore
      await sleep(600);

      expect(started()).toHaveLength(PLACES);
    } finally {
      release();
    }
  });

  it('la fiche ouverte aussitôt après n’attend que les deux lectures déjà lancées, pas les six listes de la file', async () => {
    const { projects, started, release } = setup();
    try {
      const view = await openGlobalView(projects, started);
      await view.leave();

      const fiche = projects.issue('f', 'x-1');
      release();

      await expect(fiche).resolves.toMatchObject({ id: 'x-1' });
      // Avant la fiche : les deux lectures de la Vue globale qui avaient leur place, et rien d'autre.
      expect(started().filter((name) => name !== 'f')).toHaveLength(PLACES);
    } finally {
      release();
    }
  });
});
