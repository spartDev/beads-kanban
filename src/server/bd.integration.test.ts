import { execFile, execFileSync } from 'node:child_process';
import { mkdirSync, realpathSync } from 'node:fs';
import { join } from 'node:path';
import { promisify } from 'node:util';
import { beforeAll, describe, expect, it } from 'vitest';
import { analyzeFlow } from '../domain/flow';
import type { DeclaredStatuses, IssueDetail } from '../shared/api';
import { createDoltClient } from './dolt/client';
import { readTicketHistories } from './dolt/history';
import { readIssueSummaries } from './dolt/reader';
import { discoverProjects } from './projects/discovery';
import { buildServer } from './server';
import { hasBinary } from './testing/dolt-fixture';
import { scratchDir } from './testing/scratch';

const run = promisify(execFile);
const SECOND = 1000;

/**
 * Lecteur Dolt sur une vraie base beads : un workspace temporaire est créé et rempli avec `bd`
 * (le seul endroit où l'on écrit avec bd), puis relu par le lecteur et passé dans `analyzeFlow`.
 * Sauté si `dolt` ou `bd` ne sont pas installés.
 */
describe.skipIf(!hasBinary('dolt') || !hasBinary('bd'))('lecteur Dolt sur un workspace créé par bd', () => {
  let workspace: string;
  let roots: string;
  let env: NodeJS.ProcessEnv;
  const ids: Record<string, string> = {};

  // `bd` asynchrone : le crochet en lance une vingtaine, une à deux secondes chacune sous charge, et le worker de vitest doit garder la main pendant ce temps
  // (bdesk-8g5, voir src/testing/event-loop.ts).
  const bd = async (...args: string[]) => (await run('bd', args, { cwd: workspace, env, encoding: 'utf8' })).stdout.trim();
  const create = async (name: string, ...args: string[]) => (ids[name] = await bd('q', name, ...args));

  beforeAll(async () => {
    roots = realpathSync(scratchDir('bdesk-bd-'));
    workspace = join(roots, 'xx-projet');
    // Aucune variable BEADS_* / BD_* de l'environnement ne doit rediriger bd vers un vrai Projet.
    env = Object.fromEntries(Object.entries(process.env).filter(([key]) => !/^(BEADS_|BD_)/.test(key)));
    env.BEADS_ACTOR = 'testeur';
    mkdirSync(workspace);
    execFileSync('git', ['init', '-q', '.'], { cwd: workspace });
    await bd('init', '--prefix', 'xx', '--non-interactive', '--skip-hooks', '--skip-agents', '-q');
    // La déclaration des Statuts de relais de la chaîne d'agents, telle que l'orchestrateur la pose (ADR 0007, bdesk-pz0.2) : `config set` fait son
    // propre commit (« bd: set (auto-commit) ») : la valeur se lit aussitôt au dernier commit.
    await bd('config', 'set', 'status.custom', 'in_review:wip,in_integration:wip,awaiting_human:wip');

    const epic = await create('Epic', '-t', 'epic');
    const a = await create('Ticket A é "ü" <b>', '-t', 'feature', '-p', '1', '--parent', epic);
    const b = await create('Bloquant B', '-t', 'bug', '-p', '0', '-l', 'urgent');
    const c = await create('Doublon C');
    const d = await create('Rouvert D');
    const f = await create('Bloqué F');
    const g = await create('Bloquant G');

    await bd('dep', 'add', a, b);
    await bd('update', a, '--status', 'in_progress');
    await bd('comments', 'add', a, 'Un commentaire\nsur deux lignes');
    await bd('label', 'add', a, 'foo');
    await bd('close', b, '--reason', 'fait');
    await bd('update', a, '--description', 'Ligne 1\nLigne 2 avec \\ et "guillemets"');
    await bd('close', a, '--reason', 'terminé');
    await bd('duplicate', c, '--of', a);
    await bd('close', d);
    await bd('reopen', d);
    await bd('dep', 'add', f, g);
  }, 180 * SECOND);

  const database = () => createDoltClient().open(join(workspace, '.beads', 'embeddeddolt', 'xx'));

  it('découvre le workspace comme un Projet Dolt embedded, avec son préfixe', async () => {
    const { projects, ignored } = await discoverProjects({ roots: [roots], projects: [], hiddenProjects: [] });

    expect(ignored).toEqual([]);
    expect(projects).toMatchObject([{ id: 'xx-projet', prefix: 'xx', mode: 'embedded', status: 'ok' }]);
  });

  it('sert tickets et détail par l’API', async () => {
    const app = buildServer({ config: { roots: [roots], projects: [], hiddenProjects: [] } });

    const { issues, declaredStatuses } = (await app.inject({ url: '/api/projects/xx-projet/issues' })).json<{
      issues: { id: string; status: string; parentId: string | null; blockedBy: string[] }[];
      declaredStatuses: DeclaredStatuses;
    }>();
    const detail = (await app.inject({ url: `/api/projects/xx-projet/issues/${ids['Ticket A é "ü" <b>']}` })).json<{ issue: IssueDetail }>().issue;

    const byId = new Map(issues.map((i) => [i.id, i]));
    expect(issues).toHaveLength(7);
    expect(byId.get(ids['Bloqué F'] ?? '')).toMatchObject({ status: 'open', blockedBy: [ids['Bloquant G']] });
    expect(byId.get(ids['Ticket A é "ü" <b>'] ?? '')).toMatchObject({ status: 'closed', parentId: ids.Epic, blockedBy: [] });
    expect(detail).toMatchObject({
      title: 'Ticket A é "ü" <b>',
      description: 'Ligne 1\nLigne 2 avec \\ et "guillemets"',
      closeReason: 'terminé',
      labels: ['foo'],
      comments: [{ author: 'testeur', text: 'Un commentaire\nsur deux lignes' }],
      // Avec un vrai bd : le ticket a été créé `--parent` de l'Epic, que la fiche nomme (bdesk-38k.29).
      epic: { id: ids.Epic, title: 'Epic' },
    });
    expect(detail.dependencies).toEqual([
      { to: ids['Bloquant B'], type: 'blocks' },
      { to: ids.Epic, type: 'parent-child' },
    ].sort((x, y) => x.type.localeCompare(y.type)));
    expect(detail.dependents).toEqual([{ from: ids['Doublon C'], type: 'duplicates' }]);
    expect((await app.inject({ url: '/api/projects/xx-projet/issues/xx-absent' })).statusCode).toBe(404);
    // Ce que bd écrit vraiment dans `status.custom` (table `config`), lu au dernier commit avec les tickets du kanban.
    expect(declaredStatuses).toEqual({ handoff: ['in_review', 'in_integration', 'awaiting_human'], others: [] } satisfies DeclaredStatuses);
  });

  it('alimente analyzeFlow avec les Transitions, dépendances et clôtures réelles', async () => {
    const db = database();
    const histories = await readTicketHistories(db);
    const flows = analyzeFlow(histories);
    const summaries = new Map((await readIssueSummaries(db)).map((s) => [s.id, s]));

    const a = flows.get(ids['Ticket A é "ü" <b>'] ?? '');
    expect(a?.transitions.map((t) => t.status)).toEqual(['open', 'in_progress', 'closed']);
    expect(a?.outcome.kind).toBe('delivered');
    expect(a?.cycleTime).toBeGreaterThan(0);
    // A travaille alors que B (ouvert) le bloque encore : du temps bloqué dans le Cycle Time.
    expect(a?.blockedTime).toBeGreaterThan(0);

    // Lead Time de l'historique et dates de la table issues concordent à quelques secondes près.
    for (const [id, flow] of flows) {
      const summary = summaries.get(id);
      if (flow.leadTime === null || !summary?.closedAt) continue;
      expect(Math.abs(flow.leadTime - (summary.closedAt.getTime() - summary.createdAt.getTime()))).toBeLessThan(2 * SECOND);
    }

    expect(flows.get(ids['Doublon C'] ?? '')?.outcome.kind).toBe('abandoned');
    expect(flows.get(ids['Rouvert D'] ?? '')).toMatchObject({ reopenings: 1, outcome: { kind: 'open' }, leadTime: null });
    expect(flows.get(ids.Epic ?? '')?.outcome.kind).toBe('open');
  });

  it('lit sans erreur pendant que bd écrit, et laisse la base cohérente', async () => {
    const db = database();
    const target = ids['Bloquant G'] ?? '';
    const writes = (async () => {
      for (let priority = 3; priority >= 0; priority--) {
        await run('bd', ['update', target, '--priority', String(priority)], { cwd: workspace, env });
        await run('bd', ['comments', 'add', target, `écriture ${priority}`], { cwd: workspace, env });
      }
    })();
    const reads = Array.from({ length: 12 }, async () => {
      await Promise.all([readIssueSummaries(db), readTicketHistories(db)]);
    });

    const results = await Promise.allSettled([writes, ...reads]);

    expect(results.filter((r) => r.status === 'rejected')).toEqual([]);
    const after = (await readIssueSummaries(db)).find((s) => s.id === target);
    expect(after?.priority).toBe(0);
    expect(execFileSync('dolt', ['fsck'], { cwd: join(workspace, '.beads', 'embeddeddolt', 'xx'), encoding: 'utf8' })).toBeTypeOf('string');
  }, 120 * SECOND);
});
