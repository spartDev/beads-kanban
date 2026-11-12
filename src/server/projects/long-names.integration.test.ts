import { cpSync, mkdirSync, realpathSync, writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import type { Issue, IssueChronologyResponse, IssueResponse, MetricsResponse, Project, ProjectsResponse } from '../../shared/api';
import { createMetricsService } from '../metrics/service';
import { startServer } from '../server';
import { createDatabase, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { scratchDir } from '../testing/scratch';
import { openStream } from '../testing/sse';
import { createProjectService } from './service';

/**
 * Les Projets dont le dossier a de 101 à 255 caractères (bdesk-38k.88), de bout en bout : découverte des dossiers, vraies bases Dolt, serveur qui écoute et sert l'interface (celui de
 * `pnpm start`), requêtes HTTP de l'interface, une par page : kanban et Epics (`/issues`), panneau d'un ticket (`/issues/:issueId`) et sa Chronologie (`…/chronology`), métriques
 * (`/api/metrics`, l'identifiant est dans la requête) et flux en direct (`…/events`). Fastify refusait tout paramètre d'adresse de plus de 100 caractères (`maxParamLength`) : l'identifiant
 * d'un Projet est le slug du nom de son dossier, jusqu'à 255 caractères (la limite d'un nom de fichier), et celui d'un ticket tient dans `varchar(255)`.
 *
 *   court    préfixe `u` (tickets u-1 à u-3), nom de 101 caractères, de 255 caractères, de 127 « é » (254 octets), de 251 « x » et d'une fusée (255 octets : un émoji vaut quatre octets et
 *            un tiret dans l'identifiant), de 85 caractères japonais (255 octets, sans lettre ASCII : l'identifiant est « projet »), et deux dossiers de même nom (255 caractères) :
 *            le second prend « -2 » (257 caractères)
 *   long     préfixe de 240 caractères (tickets de 242 caractères), dans un dossier de 150 caractères, et dans un dossier au nom court : seul l'identifiant du ticket dépasse 100 caractères
 *
 * Un Projet : u-1 est une Epic, u-2 et u-3 ses Enfants. j1 : les trois créés ; j2 : u-2 en cours ; j3 : u-2 fermé, u-3 en cours.
 */

const NOW = new Date('2026-10-12T12:00:00Z');
const PERIOD = 'from=2026-10-01&to=2026-10-12';

const SCHEMA = `
  create table issues (
    id varchar(255) primary key, title varchar(500) not null, description text not null, design text not null,
    acceptance_criteria text not null, notes text not null, status varchar(32) not null default 'open',
    priority int not null default 2, issue_type varchar(32) not null default 'task', assignee varchar(255),
    created_at datetime not null, updated_at datetime not null, closed_at datetime, close_reason text not null);
  create table dependencies (
    id char(36) primary key, issue_id varchar(255) not null, depends_on_issue_id varchar(255) not null,
    type varchar(32) not null default 'blocks', created_at datetime not null, created_by varchar(255) not null);
  create table labels (issue_id varchar(255) not null, label varchar(255) not null, primary key (issue_id, label));
  create table comments (id char(36) primary key, issue_id varchar(255) not null, author varchar(255) not null,
    text text not null, created_at datetime not null);
  create table config (\`key\` varchar(255) primary key, value text not null);`;

const stamp = (day: number) => `2026-10-${String(day).padStart(2, '0')} 10:00:00`;

/** Le dossier `.beads` d'un Projet de préfixe `prefix`, dans `dir` : une base Dolt qui rejoue trois jours (voir plus haut). */
function buildBeads(dir: string, prefix: string): string {
  const beads = join(dir, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'tdb' }));
  const db = createDatabase(isolatedDoltEnv(), join(beads, 'embeddeddolt', 'tdb'));
  const id = (n: number) => `${prefix}-${n}`;
  const create = (n: number, type: string) =>
    `insert into issues (id, title, description, design, acceptance_criteria, notes, issue_type, created_at, updated_at, close_reason)
     values ('${id(n)}', 'Ticket ${n}', 'Description', '', '', '', '${type}', '${stamp(1)}', '${stamp(1)}', '')`;
  const parentOf = (n: number) =>
    `insert into dependencies (id, issue_id, depends_on_issue_id, type, created_at, created_by) values (uuid(), '${id(n)}', '${id(1)}', 'parent-child', '${stamp(1)}', 'tom')`;
  const move = (n: number, status: string, day: number) =>
    `update issues set status = '${status}', updated_at = '${stamp(day)}', closed_at = ${status === 'closed' ? `'${stamp(day)}'` : 'null'} where id = '${id(n)}'`;
  db.sql(SCHEMA);
  db.sql(`insert into config values ('issue_prefix', '${prefix}')`);
  db.sql([create(1, 'epic'), create(2, 'task'), create(3, 'task'), parentOf(2), parentOf(3)].join(';\n'));
  db.commit(1, 'jour 1');
  db.sql(move(2, 'in_progress', 2));
  db.commit(2, 'jour 2');
  db.sql([move(2, 'closed', 3), move(3, 'in_progress', 3)].join(';\n'));
  db.commit(3, 'jour 3');
  return beads;
}

/** Un nom de `n` caractères ASCII exactement, qui est déjà un slug (minuscules, chiffres, tirets), sans tiret en bout. */
const ascii = (n: number, tag: string): string => `${tag}-${'nom-de-dossier-tres-long-'.repeat(Math.ceil(n / 25))}`.slice(0, n).replace(/-$/, 'x');

const SHORT_PREFIX = 'u';
const LONG_PREFIX = 'q'.repeat(240);

/** Les Projets : le nom du dossier (sous la racine), le préfixe de la base, l'identifiant attendu (`null` : plusieurs dossiers de même slug). */
const PROJECTS: { key: string; folder: string[]; prefix: string; id: string | null }[] = [
  { key: 'nom de 101 caractères', folder: [ascii(101, 'a101')], prefix: SHORT_PREFIX, id: ascii(101, 'a101') },
  { key: 'nom de 255 caractères', folder: [ascii(255, 'a255')], prefix: SHORT_PREFIX, id: null },
  { key: 'le même nom, dans un groupe', folder: ['groupe', ascii(255, 'a255')], prefix: SHORT_PREFIX, id: null },
  { key: 'nom de 127 « é » (254 octets)', folder: ['é'.repeat(127)], prefix: SHORT_PREFIX, id: 'e'.repeat(127) },
  { key: 'nom de 251 « x » et une fusée (255 octets)', folder: [`${'x'.repeat(251)}🚀`], prefix: SHORT_PREFIX, id: 'x'.repeat(251) },
  { key: 'nom de 85 caractères japonais (255 octets)', folder: ['プ'.repeat(85)], prefix: SHORT_PREFIX, id: 'projet' },
  { key: 'nom de 150 caractères, préfixe de 240', folder: [ascii(150, 'idl150')], prefix: LONG_PREFIX, id: ascii(150, 'idl150') },
  { key: 'nom court, préfixe de 240', folder: ['court'], prefix: LONG_PREFIX, id: 'court' },
];

describe.skipIf(!hasBinary('dolt'))('Projets au nom de dossier long, de bout en bout (bdesk-38k.88)', () => {
  let app: FastifyInstance;
  let base: string;
  let port: number;
  /** Les Projets découverts, par clé d'essai. */
  const found = new Map<string, Project>();

  const get = async <T>(path: string): Promise<{ status: number; body: T }> => {
    const res = await fetch(`${base}${path}`, { headers: { accept: 'application/json' } });
    return { status: res.status, body: (await res.json()) as T };
  };

  beforeAll(async () => {
    const root = realpathSync(scratchDir('bdesk-long-names-'));
    const models = realpathSync(scratchDir('bdesk-long-models-'));
    const short = buildBeads(join(models, 'court'), SHORT_PREFIX);
    const long = buildBeads(join(models, 'long'), LONG_PREFIX);
    for (const { folder, prefix } of PROJECTS) {
      const dir = join(root, ...folder);
      mkdirSync(dir, { recursive: true });
      cpSync(prefix === SHORT_PREFIX ? short : long, join(dir, '.beads'), { recursive: true });
    }
    const webRoot = scratchDir('bdesk-long-web-');
    writeFileSync(join(webRoot, 'index.html'), '<!doctype html><title>beads-desktop</title>');

    const config = { roots: [root], projects: [], hiddenProjects: [] };
    const projects = createProjectService(config);
    const metrics = createMetricsService(projects, { now: () => NOW, timeZone: 'UTC' });
    app = await startServer({ config, projects, metrics, webRoot, port: 0 });
    port = (app.server.address() as AddressInfo).port;
    base = `http://127.0.0.1:${port}`;

    const { projects: listed } = (await get<ProjectsResponse>('/api/projects')).body;
    for (const { key, folder } of PROJECTS) {
      const project = listed.find((candidate) => candidate.path.normalize('NFC') === join(root, ...folder).normalize('NFC'));
      if (!project) throw new Error(`Projet introuvable : ${key} (${folder.join('/')})`);
      found.set(key, project);
    }
  }, 180_000);

  afterAll(async () => {
    await app?.close();
  });

  it('liste les Projets lisibles, sous l’identifiant que dit leur nom', () => {
    for (const { key, id } of PROJECTS) {
      const project = found.get(key);
      expect(project, key).toMatchObject({ status: 'ok' });
      if (id !== null) expect(project?.id, key).toBe(id);
    }
    // Les deux dossiers de même nom : un slug de 255 caractères, et le même suivi de « -2 ».
    const twins = [found.get('nom de 255 caractères')?.id, found.get('le même nom, dans un groupe')?.id].sort();
    expect(twins.map((twin) => twin?.length)).toEqual([255, 257]);
    expect(twins[1]).toBe(`${twins[0]}-2`);
  });

  it.each(PROJECTS.map(({ key, prefix }) => [key, prefix] as const))('%s : kanban, panneau d’un ticket, Chronologie, Epic, métriques et flux en direct se chargent', async (key, prefix) => {
    const { id } = found.get(key) as Project;
    const [epic, child] = [`${prefix}-1`, `${prefix}-2`];
    const project = encodeURIComponent(id);

    // Kanban et page Epics : la liste des tickets du Projet.
    const issues = await get<{ issues: Issue[] }>(`/api/projects/${project}/issues`);
    expect(issues.status).toBe(200);
    expect(issues.body.issues.map((issue) => [issue.id, issue.type, issue.status, issue.parentId])).toEqual([
      [epic, 'epic', 'open', null],
      [child, 'task', 'closed', epic],
      [`${prefix}-3`, 'task', 'in_progress', epic],
    ]);

    // Panneau d'un ticket : sa fiche, avec l'Epic qui le porte, et sa Chronologie lue dans l'historique Dolt.
    const issue = await get<IssueResponse>(`/api/projects/${project}/issues/${encodeURIComponent(child)}`);
    expect(issue.status).toBe(200);
    expect(issue.body.issue).toMatchObject({ id: child, status: 'closed', epic: { id: epic, title: 'Ticket 1' } });
    const chronology = await get<IssueChronologyResponse>(`/api/projects/${project}/issues/${encodeURIComponent(child)}/chronology`);
    expect(chronology.status).toBe(200);
    expect(chronology.body.chronology).toMatchObject({ source: 'history', outcome: { kind: 'delivered' } });

    // Métriques : l'identifiant du Projet est dans la requête.
    const metrics = await get<MetricsResponse>(`/api/metrics?${PERIOD}&project=${project}`);
    expect(metrics.status).toBe(200);
    expect(metrics.body.projects).toEqual([{ id, name: found.get(key)?.name }]);
    expect(metrics.body.unreadable).toEqual([]);
    expect(metrics.body.tiles.throughput.total).toBe(1); // u-2, la seule Livraison

    // Flux en direct : le premier événement est la consigne de reconnexion.
    const stream = await openStream(port, `/api/projects/${project}/events`);
    try {
      expect(stream.status).toBe(200);
      expect(stream.headers['content-type']).toContain('text/event-stream');
      await stream.waitFor('retry:', 15_000);
    } finally {
      stream.close();
    }
  }, 60_000);
});
