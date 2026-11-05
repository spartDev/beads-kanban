import { existsSync, mkdirSync, mkdtempSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { TicketHistory } from '../../domain/flow';
import { createChronologyService } from '../chronology/service';
import { createDoltClient } from '../dolt/client';
import { fakeDolt } from '../testing/fake-dolt';
import { createProjectService, type ProjectService } from './service';

/**
 * La rafale de la relecture de bdesk-38k.9 (92 fiches et 92 chronologies ensemble : la chronologie la plus lente prenait 21,5 s,
 * la fiche la plus lente 18 s), en petit et sans vrai dolt : le vrai client et le vrai service de Projets devant un faux binaire
 * dont chaque lecture d'un ticket dure 0,15 s, avec deux places seulement. Ce que l'on vérifie n'est pas une durée mais un ordre :
 * le HEAD, et donc la chronologie à cache chaud, ne font plus la queue derrière les fiches.
 */

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));
let root: string;

beforeEach(() => {
  root = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-burst-')));
  const beads = join(root, 'p', '.beads');
  mkdirSync(join(beads, 'embeddeddolt', 'p', '.dolt'), { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'p' }));
});

/**
 * Un faux dolt : le préfixe et le HEAD répondent aussitôt, tout le reste dure 0,15 s. Pour le ticket x-N : sa fiche, ses étiquettes
 * et ses commentaires (un groupe), puis les résumés et les dépendances du Projet (un autre groupe).
 */
function slowTickets() {
  const body = [
    `q="\${5#start transaction read only; }"`,
    `case "$q" in`,
    `  *issue_prefix*) printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n';;`,
    `  *"hashof('HEAD')"*) printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n';;`,
    `  *"where id ="*) sleep 0.15; printf '{}\\n\\n{"rows": [{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}]}\\n{}\\n\\n{}\\n\\n';;`,
    `  *) sleep 0.15; printf '{}\\n\\n{"rows": [{"id": "x-1", "title": "T", "issue_type": "task", "status": "open", "priority": 2, "created_at": "2026-10-01 10:00:00", "updated_at": "2026-10-01 10:00:00"}]}\\n{}\\n\\n';;`,
    `esac`,
  ].join('\n');
  return fakeDolt(body);
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

describe.skipIf(process.platform === 'win32')('rafale de fiches (bdesk-38k.20)', { timeout: 60_000 }, () => {
  const config = () => ({ roots: [root], projects: [], hiddenProjects: [] });

  /** Lance `count` fiches de tickets tous différents du même Projet ; `done()` dit combien ont fini. */
  function fiches(projects: ProjectService, count: number) {
    let finished = 0;
    const all = Array.from({ length: count }, (_, i) =>
      projects.issue('p', `x-${i + 1}`).then((detail) => {
        finished++;
        return detail;
      }),
    );
    return { all, done: () => finished };
  }

  it('le HEAD du Projet n’attend pas la file des fiches', async () => {
    const fake = slowTickets();
    // Deux places seulement, et des requêtes toutes différentes d'une fiche à l'autre : rien à partager, la file est longue.
    const projects = createProjectService(config(), {
      dolt: createDoltClient({ binary: fake.binary, maxConcurrent: 2, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }),
    });
    await projects.head('p'); // découverte faite

    const burst = fiches(projects, 30);
    await sleep(50);
    const head = await projects.head('p');

    expect(head).toBe('h1');
    // Moins de la moitié des 30 fiches sont finies : des dizaines de lectures de tickets attendent encore, et le HEAD est déjà là
    // (avant, il n'arrivait qu'après toutes).
    expect(burst.done()).toBeLessThan(15);
    await Promise.all(burst.all);
  });

  it('une chronologie à cache chaud n’attend pas la file des fiches', async () => {
    const fake = slowTickets();
    const real = createProjectService(config(), {
      dolt: createDoltClient({ binary: fake.binary, maxConcurrent: 2, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }),
    });
    // Le HEAD et les fiches sont les vrais ; l'historique, lui, est remplacé : seule la voie du HEAD est en jeu ici.
    const projects: ProjectService = { ...real, histories: async () => [DELIVERED] };
    const chronologies = createChronologyService(projects);
    await chronologies.chronology('p', 'x-1'); // le cache est chaud

    const burst = fiches(projects, 30);
    await sleep(50);
    const chronology = await chronologies.chronology('p', 'x-1');

    expect(chronology).toMatchObject({ source: 'history', outcome: { kind: 'delivered' } });
    expect(burst.done()).toBeLessThan(15); // la moitié des 30 fiches au plus ; avant, toutes (30) avaient fini quand le HEAD arrivait
    await Promise.all(burst.all);
  });

  it('une fiche abandonnée par son client ne lit rien quand elle attendait encore sa place', async () => {
    const fake = slowTickets();
    const projects = createProjectService(config(), {
      dolt: createDoltClient({ binary: fake.binary, maxConcurrent: 1, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }),
    });
    await projects.head('p');
    const before = fake.calls();
    const first = projects.issue('p', 'x-1'); // prend l'unique place
    await sleep(30);
    const controllers = Array.from({ length: 20 }, () => new AbortController());
    const abandoned = controllers.map((controller, i) => projects.issue('p', `x-${i + 2}`, { signal: controller.signal }).catch((e: unknown) => e));
    await sleep(30);

    for (const controller of controllers) controller.abort();
    await first;
    const outcomes = await Promise.all(abandoned);

    expect(outcomes.every((outcome) => outcome instanceof Error && outcome.name === 'AbortError')).toBe(true);
    // Une fiche en cours (deux processus : le ticket, puis le socle commun, qui attendait derrière) ; les vingt abandonnées n'ont rien lancé.
    expect(fake.calls() - before).toBeLessThanOrEqual(2);
  });
});

/**
 * Un rescan de nombreux Projets (relecture de bdesk-38k.20, remarque r3) : chaque scan lit le préfixe de tous les Projets, par la
 * voie `light` qu'il partage avec le HEAD. Le HEAD n'y fait pourtant pas la queue derrière ces lectures : celui d'une demande déjà
 * admise est passé devant (chaque voie est servie dans l'ordre d'arrivée), et une demande qui arrive pendant le scan l'attend avant de
 * lire quoi que ce soit (mesuré sur 40 Projets : une voie à part ne change rien, voir l'ADR 0003). Ce test garde le premier de ces ordres.
 */
describe.skipIf(process.platform === 'win32')('rescan de nombreux Projets (bdesk-38k.20)', { timeout: 60_000 }, () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  /** Un faux dolt dont chaque lecture de préfixe dure 0,25 s et se note dans `prefixes` ; le HEAD répond aussitôt. */
  function slowPrefixes() {
    const body = [
      `q="\${5#start transaction read only; }"`,
      `case "$q" in`,
      `  *issue_prefix*) echo x >> "$(dirname "$0")/prefixes"; sleep 0.25; printf '{}\\n\\n{"rows": [{"value": "x"}]}\\n';;`,
      `  *"hashof('HEAD')"*) printf '{}\\n\\n{"rows": [{"head": "h1"}]}\\n';;`,
      `esac`,
    ].join('\n');
    const fake = fakeDolt(body);
    const log = join(fake.dir, 'prefixes');
    return { ...fake, prefixReads: () => (existsSync(log) ? readFileSync(log, 'utf8').split('\n').filter(Boolean).length : 0) };
  }

  it('le HEAD d’une demande admise avant un rescan passe devant les lectures de préfixe de tous les Projets', async () => {
    for (const name of ['q1', 'q2', 'q3', 'q4', 'q5']) {
      const beads = join(root, name, '.beads');
      mkdirSync(join(beads, 'embeddeddolt', name, '.dolt'), { recursive: true });
      writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
    }
    const fake = slowPrefixes();
    // Une seule place légère : les six lectures de préfixe d'un scan se suivent, et le HEAD ne peut passer qu'en tête.
    const projects = createProjectService(
      { roots: [root], projects: [], hiddenProjects: [] },
      { dolt: createDoltClient({ binary: fake.binary, maxLight: 1, rootPath: join(tmpdir(), 'bdesk-fake-dolt-root') }) },
    );
    await projects.head('p'); // premier scan : six lectures de préfixe, puis le HEAD
    expect(fake.prefixReads()).toBe(6);
    vi.useFakeTimers({ toFake: ['Date'] });
    vi.setSystemTime(Date.now() + 10_000); // ce scan est périmé : `list()` en lance un autre

    const head = projects.head('p'); // le dernier scan connaît le Projet et le dit lisible : pas d'attente
    let rescanned = false;
    const rescan = projects.list().then(() => {
      rescanned = true;
    });

    expect(await head).toBe('h1');
    expect(rescanned).toBe(false); // il reste au moins cinq lectures de préfixe de 0,25 s
    expect(fake.prefixReads() - 6).toBeLessThanOrEqual(1); // le HEAD n'a attendu aucune d'elles (une à peine partie au plus)
    await rescan;
    expect(fake.prefixReads() - 6).toBe(6); // le rescan a bien lu tous les Projets
  });
});
