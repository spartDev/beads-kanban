import { existsSync, mkdirSync, readFileSync, realpathSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketHistory } from '../../domain/flow';
import { createChronologyService } from '../chronology/service';
import { createDoltClient } from '../dolt/client';
import { fakeDolt, fakeDoltRoot } from '../testing/fake-dolt';
import { scratchDir } from '../testing/scratch';
import { createProjectService, type ProjectService } from './service';

/**
 * Un rescan de nombreux Projets (bdesk-38k.28), avec le vrai client et le vrai service devant un faux binaire dont les lectures de
 * préfixe, celles d'un scan, ne finissent que quand le test le décide. Ce que l'on vérifie n'est pas une durée mais une
 * indépendance : une demande pour un Projet déjà connu (HEAD, chronologie à cache chaud, fiche) est servie pendant que le scan est
 * retenu, donc sans attendre sa fin, ni la file de ses lectures de préfixe (voie `discovery`, qui n'est pas celle du HEAD). Avec une
 * seule place par voie, un scan qui avait la voie du HEAD la tenait entière.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
const TICKET = '{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}';
const NAMES = ['p', 'q1', 'q2', 'q3', 'q4', 'q5'];

let root: string;

beforeEach(() => {
  root = realpathSync(scratchDir('bdesk-rescan-voies-'));
  for (const name of NAMES) {
    const beads = join(root, name, '.beads');
    mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
    writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  }
});

afterEach(() => {
  vi.useRealTimers();
});

/** Attend qu'une condition soit vraie (les processus du faux dolt tournent en temps réel). */
async function until(condition: () => boolean, what: string): Promise<void> {
  for (let waited = 0; !condition(); waited += 5) {
    if (waited > 20_000) throw new Error(`jamais vrai : ${what}`);
    await sleep(5);
  }
}

/**
 * Un faux dolt : le HEAD et les tickets répondent aussitôt ; une lecture de préfixe note son départ dans `prefixes`, puis attend (30 s au
 * plus, pour ne jamais traîner si un test échoue) que le fichier `go` existe. `hold()` le retire, `go()` le pose.
 */
function gatedPrefixes() {
  const body = [
    `d="$(dirname "$0")"`,
    `q="\${5#start transaction read only; }"`,
    `case "$q" in`,
    `  *issue_prefix*)`,
    `    echo x >> "$d/prefixes"`,
    `    i=0; while [ ! -e "$d/go" ] && [ $i -lt 600 ]; do sleep 0.05; i=$((i+1)); done`,
    `    printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n';;`,
    `  *"hashof('HEAD')"*) printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n';;`,
    `  *"where id ="*) printf '{}\\n\\n{"rows": [${TICKET}]}\\n{}\\n\\n{}\\n\\n';;`,
    `  *) printf '{}\\n\\n{"rows": [${TICKET}]}\\n{}\\n\\n';;`,
    `esac`,
  ].join('\n');
  const fake = fakeDolt(body);
  const gate = join(fake.dir, 'go');
  const log = join(fake.dir, 'prefixes');
  return {
    ...fake,
    go: () => writeFileSync(gate, ''),
    hold: () => rmSync(gate, { force: true }),
    prefixReads: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0),
  };
}

const DELIVERED: TicketHistory = {
  id: 'x-1',
  type: 'task',
  statusSnapshots: [
    { status: 'open', at: new Date('2026-10-01T09:00:00Z') },
    { status: 'closed', at: new Date('2026-10-03T21:00:00Z') },
  ],
  dependencies: [],
};

describe.skipIf(process.platform === 'win32')('lectures pendant un rescan de nombreux Projets (bdesk-38k.28)', { timeout: 60_000 }, () => {
  it('le HEAD, la chronologie à cache chaud et la fiche d’un Projet connu n’attendent ni le scan ni la file de ses lectures de préfixe', async () => {
    const fake = gatedPrefixes();
    // Une seule place par voie : un scan tient la sienne, les cinq autres lectures de préfixe attendent derrière. Le HEAD doit passer.
    const real = createProjectService(
      { roots: [root], projects: [], hiddenProjects: [] },
      { dolt: createDoltClient({ binary: fake.binary, maxLight: 1, maxDiscovery: 1, rootPath: fakeDoltRoot() }) },
    );
    // L'historique est remplacé (seules les voies du HEAD et des fiches sont en jeu ici) ; le HEAD et les fiches sont les vrais.
    const projects: ProjectService = { ...real, histories: async () => [DELIVERED] };
    const chronologies = createChronologyService(projects);
    fake.go();
    await chronologies.chronology('p', 'x-1'); // premier scan (six lectures de préfixe) puis cache chaud
    expect(fake.prefixReads()).toBe(6);

    fake.hold();
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000); // ce scan est périmé : list() en lance un autre
    let rescanned = false;
    const rescan = projects.list().then(() => {
      rescanned = true;
    });
    await until(() => fake.prefixReads() === 7, 'le rescan a lancé sa première lecture de préfixe, retenue');

    const served = await Promise.race([
      Promise.all([projects.head('p'), chronologies.chronology('p', 'x-1'), projects.issue('p', 'x-1')]),
      sleep(15_000).then(() => 'attend le scan'),
    ]);

    expect(served).not.toBe('attend le scan');
    const [head, chronology, detail] = served as [string, { source: string }, { id: string }];
    expect(head).toBe('h1');
    expect(chronology).toMatchObject({ source: 'history' });
    expect(detail).toMatchObject({ id: 'x-1' });
    expect(rescanned).toBe(false); // le scan est encore retenu
    expect(fake.prefixReads()).toBe(7); // aucune autre lecture de préfixe n'est partie : elles faisaient la queue, ces trois demandes non

    fake.go();
    await rescan;
    expect(fake.prefixReads()).toBe(12); // le rescan a bien lu les six Projets
  });
});
