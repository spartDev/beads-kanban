import { describe, expect, it } from 'vitest';
import { analyzeFlow } from '../../domain/flow';
import { type DoltDatabase, DoltQueryError, type Row } from './client';
import { type Commit, dependencyLifetimes, readTicketHistories } from './history';

const at = (iso: string) => new Date(`${iso}Z`);
const commits: Commit[] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].map((hash, i) => ({ hash, at: at(`2026-10-0${i + 1}T10:00:00`) }));
const seen = (commit: string, from: string, to: string, type = 'blocks') => ({ commit, from, to, type });

describe('dependencyLifetimes', () => {
  it('date l’ajout au premier commit où la dépendance apparaît, le retrait au commit suivant son dernier passage', () => {
    const lifetimes = dependencyLifetimes([seen('c1', 'a', 'b'), seen('c2', 'a', 'b'), seen('c3', 'a', 'b')], commits);

    expect(lifetimes.get('a')).toEqual([
      { type: 'blocks', target: 'b', addedAt: at('2026-10-02T10:00:00'), removedAt: at('2026-10-05T10:00:00') },
    ]);
  });

  it('laisse sans retrait une dépendance encore présente au dernier commit', () => {
    const lifetimes = dependencyLifetimes([seen('c4', 'a', 'b'), seen('c5', 'a', 'b')], commits);

    const [dependency] = lifetimes.get('a') ?? [];
    expect(dependency).toEqual({ type: 'blocks', target: 'b', addedAt: at('2026-10-05T10:00:00') });
    expect(dependency).not.toHaveProperty('removedAt');
  });

  it('compte deux durées de vie pour une dépendance retirée puis rétablie', () => {
    const lifetimes = dependencyLifetimes(
      [seen('c0', 'a', 'b'), seen('c1', 'a', 'b'), seen('c4', 'a', 'b'), seen('c5', 'a', 'b')],
      commits,
    );

    expect(lifetimes.get('a')).toEqual([
      { type: 'blocks', target: 'b', addedAt: at('2026-10-01T10:00:00'), removedAt: at('2026-10-03T10:00:00') },
      { type: 'blocks', target: 'b', addedAt: at('2026-10-05T10:00:00') },
    ]);
  });

  it('distingue les dépendances par ticket, cible et type, et les trie par date d’ajout', () => {
    const lifetimes = dependencyLifetimes(
      [seen('c3', 'a', 'z', 'parent-child'), seen('c1', 'a', 'b'), seen('c2', 'a', 'b', 'relates-to'), seen('c2', 'x', 'b')],
      commits,
    );

    expect(lifetimes.get('a')?.map((d) => [d.type, d.target])).toEqual([
      ['blocks', 'b'],
      ['relates-to', 'b'],
      ['parent-child', 'z'],
    ]);
    expect(lifetimes.get('x')).toHaveLength(1);
  });

  it('ignore les commits inconnus de l’historique', () => {
    expect(dependencyLifetimes([seen('inconnu', 'a', 'b')], commits).size).toBe(0);
  });

  describe('ticket recréé (commit où commence sa vie actuelle, par ticket)', () => {
    const recreatedAtC3 = new Map([['a', 'c3']]);

    it('ne garde que ce qui est observé depuis la recréation, et rien d’autre que pour ce ticket', () => {
      const lifetimes = dependencyLifetimes(
        [seen('c0', 'a', 'b'), seen('c1', 'a', 'b'), seen('c4', 'a', 'b'), seen('c5', 'a', 'b'), seen('c0', 'x', 'b'), seen('c1', 'x', 'b')],
        commits,
        recreatedAtC3,
      );

      // a : la vie précédente (c0-c1) est oubliée, la dépendance rétablie à c4 compte ; x n'a pas été recréé.
      expect(lifetimes.get('a')).toEqual([{ type: 'blocks', target: 'b', addedAt: at('2026-10-05T10:00:00') }]);
      expect(lifetimes.get('x')).toEqual([
        { type: 'blocks', target: 'b', addedAt: at('2026-10-01T10:00:00'), removedAt: at('2026-10-03T10:00:00') },
      ]);
    });

    it('garde une dépendance observée dès le commit de la recréation', () => {
      const lifetimes = dependencyLifetimes([seen('c3', 'a', 'b')], commits, recreatedAtC3);

      expect(lifetimes.get('a')).toEqual([
        { type: 'blocks', target: 'b', addedAt: at('2026-10-04T10:00:00'), removedAt: at('2026-10-05T10:00:00') },
      ]);
    });

    it('date de la recréation une dépendance qui la traverse sans avoir été retirée', () => {
      const lifetimes = dependencyLifetimes(
        [seen('c1', 'a', 'b'), seen('c2', 'a', 'b'), seen('c3', 'a', 'b'), seen('c4', 'a', 'b')],
        commits,
        recreatedAtC3,
      );

      expect(lifetimes.get('a')).toEqual([
        { type: 'blocks', target: 'b', addedAt: at('2026-10-04T10:00:00'), removedAt: at('2026-10-06T10:00:00') },
      ]);
    });

    it('n’écarte rien quand le commit de la recréation est inconnu de l’historique', () => {
      const lifetimes = dependencyLifetimes([seen('c0', 'a', 'b'), seen('c1', 'a', 'b')], commits, new Map([['a', 'inconnu']]));

      expect(lifetimes.get('a')).toEqual([
        { type: 'blocks', target: 'b', addedAt: at('2026-10-01T10:00:00'), removedAt: at('2026-10-03T10:00:00') },
      ]);
    });
  });

  it('ne date jamais un retrait avant l’ajout, même quand l’horloge recule entre deux commits', () => {
    const skewed: Commit[] = [
      { hash: 'c0', at: at('2026-10-05T10:00:00') },
      { hash: 'c1', at: at('2026-10-03T10:00:00') }, // l'horloge est revenue en arrière
      { hash: 'c2', at: at('2026-10-06T10:00:00') },
    ];

    const lifetimes = dependencyLifetimes([seen('c0', 'a', 'b'), seen('c2', 'a', 'b')], skewed);

    expect(lifetimes.get('a')).toEqual([
      { type: 'blocks', target: 'b', addedAt: at('2026-10-05T10:00:00'), removedAt: at('2026-10-05T10:00:00') },
      { type: 'blocks', target: 'b', addedAt: at('2026-10-06T10:00:00') },
    ]);
  });
});

/** Une base factice qui répond selon la requête reçue. */
function fakeDb(answers: { match: RegExp; rows: Row[] }[]): DoltDatabase & { queries: string[] } {
  const queries: string[] = [];
  return {
    dir: '/projet',
    queries,
    async query(sql) {
      queries.push(sql);
      const answer = answers.find((a) => a.match.test(sql));
      if (!answer) throw new Error(`requête inattendue : ${sql}`);
      return answer.rows;
    },
  };
}

/** Colonnes de `dolt_history_dependencies` selon le schéma de bd : cible dans `depends_on_issue_id` (récent) ou `depends_on_id` (ancien). */
const CURRENT_COLUMNS = ['issue_id', 'type', 'depends_on_issue_id', 'metadata', 'thread_id', 'created_by', 'commit_hash', 'committer', 'commit_date'];
const OLD_COLUMNS = ['issue_id', 'depends_on_id', 'type', 'metadata', 'created_by', 'commit_hash', 'committer', 'commit_date'];
/** La réponse à `show columns from <source>.dolt_history_dependencies`. */
const columns = (fields: string[], source = '') => ({
  match: new RegExp(`^show columns from ${source.replace(/[/`]/g, '\\$&')}\\.?dolt_history_dependencies$`),
  rows: fields.map((Field) => ({ Field, Type: 'varchar(64)' })),
});
const reads = (db: { queries: string[] }) => db.queries.filter((q) => /^select .*from .*dolt_history_dependencies/s.test(q));

describe('readTicketHistories', () => {
  const log = [
    { commit_hash: 'c0', date: '2026-10-01 10:00:00.000' },
    { commit_hash: 'c1', date: '2026-10-02 10:00:00.000' },
    { commit_hash: 'c2', date: '2026-10-03 10:00:00.000' },
    { commit_hash: 'c3', date: '2026-10-04 10:00:00.000' },
  ];
  const tickets = [
    { id: 'p-1', issue_type: 'task' },
    { id: 'p-2', issue_type: 'epic' },
  ];
  const statuses = [
    { id: 'p-1', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1 },
    { id: 'p-1', status: 'closed', changed_at: '2026-10-03 10:00:00.000', restart: 0 },
    { id: 'p-2', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1 },
  ];
  /** Les réponses communes : tickets, statuts, commits et schéma courant des dépendances. */
  const base = (dependencies: Row[] = []) => [
    { match: /from issues/, rows: tickets },
    { match: /lag\(/, rows: statuses },
    { match: /select l\.commit_hash/, rows: log },
    columns(CURRENT_COLUMNS),
    { match: /^select .* from dolt_history_dependencies$/s, rows: dependencies },
  ];

  it('assemble les statuts datés par les commits et les dépendances en un TicketHistory par ticket', async () => {
    const db = fakeDb(
      base([
        { commit_hash: 'c1', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
        { commit_hash: 'c2', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
      ]),
    );

    const histories = await readTicketHistories(db);

    expect(histories).toEqual([
      {
        id: 'p-1',
        type: 'task',
        statusSnapshots: [
          { status: 'open', at: at('2026-10-01T10:00:00') },
          { status: 'closed', at: at('2026-10-03T10:00:00') },
        ],
        dependencies: [
          { type: 'blocks', target: 'p-2', addedAt: at('2026-10-02T10:00:00'), removedAt: at('2026-10-04T10:00:00') },
        ],
      },
      { id: 'p-2', type: 'epic', statusSnapshots: [{ status: 'open', at: at('2026-10-01T10:00:00') }], dependencies: [] },
    ]);
    expect(analyzeFlow(histories).get('p-1')?.leadTime).toBe(2 * 24 * 3_600_000);
  });

  it('ne lit que les colonnes utiles de l’historique des dépendances, pas toutes (select *)', async () => {
    const db = fakeDb(base());

    await readTicketHistories(db);

    // Ni `metadata`, ni `thread_id`, ni `created_by`… : l'historique répète chaque ligne à chaque commit.
    expect(reads(db)).toEqual(['select `commit_hash`, `issue_id`, `type`, `depends_on_issue_id` from dolt_history_dependencies']);
  });

  it('retrouve les cibles des commits antérieurs à une migration du schéma des dépendances', async () => {
    const db = fakeDb([
      { match: /from issues/, rows: tickets },
      { match: /lag\(/, rows: statuses },
      { match: /select l\.commit_hash/, rows: log },
      { match: /select database\(\)/, rows: [{ name: 'ma_base' }] },
      // Époque du schéma d'origine, relue comme la voyait le commit c1 : cible dans depends_on_id.
      columns(OLD_COLUMNS, '`ma_base/c1`'),
      {
        match: /^select `commit_hash`, `issue_id`, `type`, `depends_on_id` from `ma_base\/c1`\.dolt_history_dependencies$/,
        rows: [
          { commit_hash: 'c0', issue_id: 'p-1', depends_on_id: 'p-2', type: 'blocks' },
          { commit_hash: 'c1', issue_id: 'p-1', depends_on_id: 'p-2', type: 'blocks' },
        ],
      },
      // Schéma courant : les commits c0 et c1 n'ont plus de cible, c2 et c3 en ont une.
      columns(CURRENT_COLUMNS),
      {
        match: /^select .* from dolt_history_dependencies$/s,
        rows: [
          { commit_hash: 'c0', issue_id: 'p-1', type: 'blocks' },
          { commit_hash: 'c1', issue_id: 'p-1', type: 'blocks' },
          { commit_hash: 'c2', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
          { commit_hash: 'c3', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
        ],
      },
    ]);

    const [first] = await readTicketHistories(db);

    // Une seule durée de vie, du premier commit d'avant la migration jusqu'à aujourd'hui.
    expect(first?.dependencies).toEqual([{ type: 'blocks', target: 'p-2', addedAt: at('2026-10-01T10:00:00') }]);
    expect(reads(db).every((q) => !q.includes('*'))).toBe(true);
  });

  it('choisit l’ancre de la reconstitution par la place des commits dans l’historique, pas par leur date', async () => {
    // L'horloge a reculé : c1 est daté après c2, mais c2 vient après c1 dans l'historique.
    const skewedLog = [
      { commit_hash: 'c0', date: '2026-10-01 10:00:00.000' },
      { commit_hash: 'c1', date: '2026-10-05 10:00:00.000' },
      { commit_hash: 'c2', date: '2026-10-03 10:00:00.000' },
      { commit_hash: 'c3', date: '2026-10-06 10:00:00.000' },
    ];
    const db = fakeDb([
      { match: /from issues/, rows: tickets },
      { match: /lag\(/, rows: statuses },
      { match: /select l\.commit_hash/, rows: skewedLog },
      { match: /select database\(\)/, rows: [{ name: 'ma_base' }] },
      // Relu comme le voyait c2, le dernier commit sans cible, l'historique voit aussi c1 (lu comme c1, il perdrait c2).
      columns(OLD_COLUMNS, '`ma_base/c2`'),
      {
        match: /^select .* from `ma_base\/c2`\.dolt_history_dependencies$/s,
        rows: [
          { commit_hash: 'c1', issue_id: 'p-1', depends_on_id: 'p-2', type: 'blocks' },
          { commit_hash: 'c2', issue_id: 'p-1', depends_on_id: 'p-2', type: 'blocks' },
        ],
      },
      columns(CURRENT_COLUMNS),
      {
        match: /^select .* from dolt_history_dependencies$/s,
        rows: [
          { commit_hash: 'c1', issue_id: 'p-1', type: 'blocks' },
          { commit_hash: 'c2', issue_id: 'p-1', type: 'blocks' },
          { commit_hash: 'c3', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
        ],
      },
    ]);

    const [first] = await readTicketHistories(db);

    expect(first?.dependencies).toEqual([{ type: 'blocks', target: 'p-2', addedAt: at('2026-10-05T10:00:00') }]);
  });

  it('abandonne la reconstitution quand un commit reste sans cible, sans boucler', async () => {
    const withoutTarget = [{ commit_hash: 'c3', issue_id: 'p-1', type: 'blocks' }];
    const db = fakeDb([
      { match: /from issues/, rows: tickets },
      { match: /lag\(/, rows: statuses },
      { match: /select l\.commit_hash/, rows: log },
      { match: /select database\(\)/, rows: [{ name: 'ma_base' }] },
      columns(CURRENT_COLUMNS, '`ma_base/c3`'),
      { match: /^select .* from `ma_base\/c3`\.dolt_history_dependencies$/s, rows: withoutTarget },
      columns(CURRENT_COLUMNS),
      { match: /^select .* from dolt_history_dependencies$/s, rows: withoutTarget },
    ]);

    const [first] = await readTicketHistories(db);

    expect(first?.dependencies).toEqual([]);
    expect(reads(db)).toHaveLength(2);
  });

  it('repart de zéro après un trou : seule la dernière vie d’un ticket supprimé puis recréé est conservée', async () => {
    const db = fakeDb([
      { match: /from issues/, rows: tickets },
      {
        match: /lag\(/,
        rows: [
          // `restart` marque le premier instantané d'une vie : création, ou réapparition après un trou.
          { id: 'p-1', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1 },
          { id: 'p-1', status: 'in_progress', changed_at: '2026-10-02 10:00:00.000', restart: 0 },
          { id: 'p-1', status: 'open', changed_at: '2026-10-05 10:00:00.000', restart: 1 },
          { id: 'p-1', status: 'closed', changed_at: '2026-10-06 10:00:00.000', restart: 0 },
          { id: 'p-2', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1 },
        ],
      },
      { match: /select l\.commit_hash/, rows: log },
      columns(CURRENT_COLUMNS),
      { match: /^select .* from dolt_history_dependencies$/s, rows: [] },
    ]);

    const [first, second] = await readTicketHistories(db);

    expect(first?.statusSnapshots).toEqual([
      { status: 'open', at: at('2026-10-05T10:00:00') },
      { status: 'closed', at: at('2026-10-06T10:00:00') },
    ]);
    expect(second?.statusSnapshots).toEqual([{ status: 'open', at: at('2026-10-01T10:00:00') }]);
  });

  it('oublie les dépendances de la vie précédente d’un ticket recréé, sans toucher à celles des autres', async () => {
    const db = fakeDb([
      { match: /from issues/, rows: tickets },
      {
        match: /lag\(/,
        rows: [
          { id: 'p-1', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1, commit_hash: 'c0' },
          { id: 'p-1', status: 'open', changed_at: '2026-10-03 10:00:00.000', restart: 1, commit_hash: 'c2' }, // recréé au commit c2
          { id: 'p-2', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1, commit_hash: 'c0' },
        ],
      },
      { match: /select l\.commit_hash/, rows: log },
      columns(CURRENT_COLUMNS),
      {
        match: /^select .* from dolt_history_dependencies$/s,
        rows: [
          { commit_hash: 'c0', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' }, // vie précédente de p-1
          { commit_hash: 'c1', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' },
          { commit_hash: 'c3', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'blocks' }, // depuis la recréation
          { commit_hash: 'c0', issue_id: 'p-2', depends_on_issue_id: 'p-1', type: 'blocks' }, // p-2 n'a jamais été recréé
          { commit_hash: 'c1', issue_id: 'p-2', depends_on_issue_id: 'p-1', type: 'blocks' },
        ],
      },
    ]);

    const [first, second] = await readTicketHistories(db);

    expect(first?.dependencies).toEqual([{ type: 'blocks', target: 'p-2', addedAt: at('2026-10-04T10:00:00') }]);
    expect(second?.dependencies).toEqual([
      { type: 'blocks', target: 'p-1', addedAt: at('2026-10-01T10:00:00'), removedAt: at('2026-10-03T10:00:00') },
    ]);
  });

  it('lit statuts et commits le long de la lignée du premier parent, jamais selon les horloges ni commit_order', async () => {
    const db = fakeDb(base());

    await readTicketHistories(db);

    const statusQuery = db.queries.find((q) => q.includes('lag(')) ?? '';
    const commitQuery = db.queries.find((q) => q.includes('select l.commit_hash')) ?? '';
    for (const query of [statusQuery, commitQuery]) {
      expect(query).toContain('dolt_commit_ancestors');
      expect(query).toContain('a.parent_index = 0');
      expect(query).not.toContain('commit_order');
      expect(query).not.toMatch(/order by[^)]*\bl\.date/);
    }
    expect(commitQuery).toMatch(/order by ln\.seq desc$/); // du plus ancien au plus récent
  });

  it('ne masque pas les autres erreurs de lecture', async () => {
    const db = fakeDb([{ match: /from issues/, rows: tickets }]);
    db.query = async (sql) => {
      if (sql.includes('lag(')) throw new DoltQueryError('table not found: dolt_history_issues', '/projet');
      return [];
    };

    await expect(readTicketHistories(db)).rejects.toThrow('table not found');
  });

  it('ne lit l’historique des dépendances qu’une fois quand le schéma n’a pas changé', async () => {
    const db = fakeDb(base());

    await readTicketHistories(db);

    expect(reads(db)).toHaveLength(1);
    expect(db.queries.some((q) => /^\s*(insert|update|delete)/i.test(q))).toBe(false);
  });
});
