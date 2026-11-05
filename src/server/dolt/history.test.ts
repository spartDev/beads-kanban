import { describe, expect, it } from 'vitest';
import { analyzeChronologies } from '../../domain/chronology';
import { analyzeFailures } from '../../domain/failures';
import { analyzeFlow } from '../../domain/flow';
import { readsOutsideHead, tablesRead } from '../testing/reads-at-head';
import { type DoltDatabase, DoltQueryError, type Row } from './client';
import { type Commit, dependencyLifetimes, readTicketHistories } from './history';

const at = (iso: string) => new Date(`${iso}Z`);
const commits: Commit[] = ['c0', 'c1', 'c2', 'c3', 'c4', 'c5'].map((hash, i) => ({ hash, at: at(`2026-10-0${i + 1}T10:00:00`) }));
const seen = (commit: string, from: string, to: string, type = 'blocks') => ({ commit, from, to, type });
/** Une dépendance vue à un commit avec le `created_at` de sa ligne (l'historique ne le donne que pour les liens d'Abandon). */
const seenWith = (commit: string, from: string, to: string, type: string, created: string) => ({ ...seen(commit, from, to, type), createdAt: at(created) });

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

  describe('created_at de la ligne (la date de pose d’un lien d’Abandon)', () => {
    it('le donne à la durée de vie, tel que son dernier commit le voit, sans toucher à addedAt', () => {
      const lifetimes = dependencyLifetimes(
        [seenWith('c1', 'a', 'b', 'supersedes', '2026-04-25T23:34:56'), seenWith('c2', 'a', 'b', 'supersedes', '2026-04-25T23:34:56')],
        commits,
      );

      expect(lifetimes.get('a')).toEqual([
        { type: 'supersedes', target: 'b', addedAt: at('2026-10-02T10:00:00'), removedAt: at('2026-10-04T10:00:00'), createdAt: at('2026-04-25T23:34:56') },
      ]);
    });

    it('donne à chaque durée de vie d’un lien retiré puis rétabli la date de sa propre ligne', () => {
      const lifetimes = dependencyLifetimes(
        [
          seenWith('c0', 'a', 'b', 'duplicates', '2026-09-30T08:00:00'),
          seenWith('c1', 'a', 'b', 'duplicates', '2026-09-30T08:00:00'),
          seenWith('c4', 'a', 'b', 'duplicates', '2026-10-04T09:30:00'),
          seenWith('c5', 'a', 'b', 'duplicates', '2026-10-04T09:30:00'),
        ],
        commits,
      );

      expect(lifetimes.get('a')).toEqual([
        { type: 'duplicates', target: 'b', addedAt: at('2026-10-01T10:00:00'), removedAt: at('2026-10-03T10:00:00'), createdAt: at('2026-09-30T08:00:00') },
        { type: 'duplicates', target: 'b', addedAt: at('2026-10-05T10:00:00'), createdAt: at('2026-10-04T09:30:00') },
      ]);
    });

    it('suit la ligne telle qu’elle est à la fin de la durée de vie : c’est celle que lit l’état présent', () => {
      const lifetimes = dependencyLifetimes(
        [seenWith('c1', 'a', 'b', 'duplicates', '2026-10-01T09:00:00'), seenWith('c2', 'a', 'b', 'duplicates', '2026-10-02T09:00:00')],
        commits,
      );

      expect(lifetimes.get('a')?.map((d) => d.createdAt)).toEqual([at('2026-10-02T09:00:00')]);
    });

    it('n’invente rien pour une dépendance dont les lignes n’en donnent pas', () => {
      const [dependency] = dependencyLifetimes([seen('c1', 'a', 'b', 'blocks'), seen('c2', 'a', 'b', 'blocks')], commits).get('a') ?? [];

      expect(dependency).not.toHaveProperty('createdAt');
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

  it('lit la liste des tickets et leur type à l’état de HEAD, comme le tableau (bdesk-38k.36)', async () => {
    const db = fakeDb(base());

    await readTicketHistories(db);

    // Un ticket supprimé, ou dont le type a changé, sans commit : l'historique le dit tel qu'il est au dernier commit, comme le tableau.
    expect(readsOutsideHead(db.queries)).toEqual([]);
    // La liste des tickets est la seule table de bd que le lecteur lit hors de l'historique : le filet l'a bien vue.
    expect(tablesRead(db.queries)).toEqual(new Set(['issues']));
  });

  it('ne lit que les colonnes utiles de l’historique des dépendances, pas toutes (select *)', async () => {
    const db = fakeDb(base());

    await readTicketHistories(db);

    // Ni `metadata`, ni `thread_id`, ni `created_by`… : l'historique répète chaque ligne à chaque commit.
    expect(reads(db)).toEqual(['select `commit_hash`, `issue_id`, `type`, `depends_on_issue_id` from dolt_history_dependencies']);
  });

  describe('created_at des liens d’Abandon', () => {
    const WITH_CREATED_AT = [...CURRENT_COLUMNS, 'created_at'];
    const withCreatedAt = (dependencies: Row[]) => [
      { match: /from issues/, rows: tickets },
      { match: /lag\(/, rows: statuses },
      { match: /select l\.commit_hash/, rows: log },
      columns(WITH_CREATED_AT),
      { match: /^select .* from dolt_history_dependencies$/s, rows: dependencies },
    ];

    it('ne lit created_at que pour les liens d’Abandon (doublon, remplacé) : l’historique répète chaque ligne à chaque commit', async () => {
      const db = fakeDb(withCreatedAt([]));

      await readTicketHistories(db);

      expect(reads(db)).toEqual([
        "select `commit_hash`, `issue_id`, `type`, `depends_on_issue_id`, case when `type` in ('duplicates', 'supersedes') then `created_at` end as `created_at` from dolt_history_dependencies",
      ]);
    });

    it('le donne à la dépendance de l’historique, pour la départager d’un autre lien apparu au même commit', async () => {
      const db = fakeDb(
        withCreatedAt([
          { commit_hash: 'c1', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'supersedes', created_at: '2026-04-25 23:34:56' },
          { commit_hash: 'c1', issue_id: 'p-1', depends_on_issue_id: 'p-3', type: 'blocks' },
          { commit_hash: 'c2', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'supersedes', created_at: '2026-04-25 23:34:56' },
          { commit_hash: 'c2', issue_id: 'p-1', depends_on_issue_id: 'p-3', type: 'blocks' },
        ]),
      );

      const [first] = await readTicketHistories(db);

      expect(first?.dependencies).toEqual([
        { type: 'supersedes', target: 'p-2', addedAt: at('2026-10-02T10:00:00'), removedAt: at('2026-10-04T10:00:00'), createdAt: at('2026-04-25T23:34:56') },
        { type: 'blocks', target: 'p-3', addedAt: at('2026-10-02T10:00:00'), removedAt: at('2026-10-04T10:00:00') },
      ]);
    });

    it('laisse le lien sans created_at quand la ligne n’en donne qu’un illisible : un lien mal daté ne rend pas le Projet illisible', async () => {
      const db = fakeDb(
        withCreatedAt([{ commit_hash: 'c3', issue_id: 'p-1', depends_on_issue_id: 'p-2', type: 'duplicates', created_at: 'hier soir' }]),
      );

      const [first] = await readTicketHistories(db);

      expect(first?.dependencies).toEqual([{ type: 'duplicates', target: 'p-2', addedAt: at('2026-10-04T10:00:00') }]);
    });

    it('ne le demande pas à un schéma qui n’a pas cette colonne', async () => {
      const db = fakeDb(base());

      await readTicketHistories(db);

      expect(reads(db).every((query) => !query.includes('created_at'))).toBe(true);
    });
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
    expect(readsOutsideHead(db.queries)).toEqual([]); // les lectures d'époque, `ma_base/c1`.dolt_history_dependencies, sont de l'historique
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

/**
 * Un Projet factice dont la lignée est `lineage` (`[commit, date]`, du plus ancien au plus récent, la date telle que `dolt_log` la
 * donne) : `steps` dit quel ticket prend quel statut à quel commit, `links` quelles dépendances apparaissent à quel commit (et
 * restent jusqu'au commit `until`, ou jusqu'à la fin de la lignée).
 */
function projectDb(
  lineage: [commit: string, date: string][],
  steps: [commit: string, ticket: string, status: string][],
  links: { from: string; to: string; since: string; until?: string; type?: string }[] = [],
  bugs: string[] = [],
) {
  const sql = (date: string) => `${date}:00.000`;
  const dateOf = new Map(lineage.map(([commit, date]) => [commit, date]));
  const ids = [...new Set(steps.map(([, ticket]) => ticket))];
  const seenTickets = new Set<string>();
  const statuses = ids.flatMap((id) =>
    steps
      .filter(([, ticket]) => ticket === id)
      .map(([commit, , status]) => {
        const restart = seenTickets.has(id) ? 0 : 1;
        seenTickets.add(id);
        return { id, status, changed_at: sql(dateOf.get(commit) as string), restart, commit_hash: commit };
      }),
  );
  const order = lineage.map(([commit]) => commit);
  const dependencies = links.flatMap(({ from, to, since, until, type = 'blocks' }) =>
    order
      .slice(order.indexOf(since), until === undefined ? undefined : order.indexOf(until) + 1)
      .map((commit) => ({ commit_hash: commit, issue_id: from, depends_on_issue_id: to, type })),
  );
  return fakeDb([
    { match: /from issues/, rows: ids.map((id) => ({ id, issue_type: bugs.includes(id) ? 'bug' : 'task' })) },
    { match: /lag\(/, rows: statuses },
    { match: /select l\.commit_hash/, rows: lineage.map(([commit_hash, date]) => ({ commit_hash, date: sql(date) })) },
    columns(CURRENT_COLUMNS),
    { match: /^select .* from dolt_history_dependencies$/s, rows: dependencies },
  ]);
}

const HOUR = 3_600_000;
const sinceDay = (iso: string) => at(`${iso}:00`);

describe('readTicketHistories : l’horloge d’un commit recule ou avance (bdesk-38k.26)', () => {
  // L'horloge d'une machine peut reculer ou avancer d'un commit à l'autre, et Dolt ne s'y oppose pas. Le lecteur met alors d'accord les
  // dates de toute la lignée, celles des statuts de tous les tickets comme celles des dépendances, en changeant le moins de commits
  // possible (`ascendingDates`) : le Blocage d'un ticket par un autre, le Bug d'origine, tout ce qui compare deux tickets lit des dates
  // qui respectent l'ordre des commits. Ces scénarios sont les trois constats de la relecture de bdesk-38k.22 (R1, R2, R3).

  it('R2 : une dépendance posée par un commit en retard, après le démarrage dans la lignée, n’est pas posée avant', async () => {
    // c0 09:00 `b` créé · c1 10:00 `t` créé · c2 14:00 `t` en cours · c3 « 11:00 » (horloge en retard) `t` bloqué par `b`, resté ouvert · c4 20:00 `t` fermé.
    const db = projectDb(
      [['c0', '2026-10-01 09:00'], ['c1', '2026-10-01 10:00'], ['c2', '2026-10-01 14:00'], ['c3', '2026-10-01 11:00'], ['c4', '2026-10-01 20:00']],
      [['c0', 'b', 'open'], ['c1', 't', 'open'], ['c2', 't', 'in_progress'], ['c4', 't', 'closed']],
      [{ from: 't', to: 'b', since: 'c3' }],
    );

    const histories = await readTicketHistories(db);

    expect(histories.find((h) => h.id === 't')?.dependencies).toEqual([{ type: 'blocks', target: 'b', addedAt: sinceDay('2026-10-01T14:00') }]);
    expect(analyzeFlow(histories).get('t')).toMatchObject({ dependencyWait: 0, blockedTime: 6 * HOUR });
    const phases = analyzeChronologies(histories).of('t')?.blockages.flatMap((blockage) => blockage.phases.map((phase) => phase.kind));
    expect(phases).toEqual(['work']);
  });

  it('R3 : un bloqueur fermé par un commit en retard, après le démarrage de `t` dans la lignée, n’est pas fermé avant', async () => {
    // c0 09:00 `b` et `t` créés, `t` bloqué par `b` · c1 12:00 `t` en cours · c2 « 10:00 » (horloge en retard) `b` fermé · c3 15:00 `t` fermé.
    const db = projectDb(
      [['c0', '2026-10-01 09:00'], ['c1', '2026-10-01 12:00'], ['c2', '2026-10-01 10:00'], ['c3', '2026-10-01 15:00']],
      [['c0', 'b', 'open'], ['c0', 't', 'open'], ['c1', 't', 'in_progress'], ['c2', 'b', 'closed'], ['c3', 't', 'closed']],
      [{ from: 't', to: 'b', since: 'c0' }],
    );

    const histories = await readTicketHistories(db);

    expect(histories.find((h) => h.id === 'b')?.statusSnapshots.map((s) => s.at.toISOString().slice(11, 16))).toEqual(['09:00', '12:00']);
    expect(analyzeFlow(histories).get('t')?.dependencyWait).toBe(3 * HOUR); // b a bloqué t de 09:00 à son démarrage, 12:00
  });

  it('R1 : la Livraison dont l’horloge de clôture a reculé précède le bug créé ensuite, dans la lignée', async () => {
    // c0 09:00 `d` créé · c1 12:00 `d` en cours · c2 « 10:00 » `d` fermé · c3 11:00 `bug` créé, découvert à partir de `d`.
    // Trois commits (09:00, 10:00, 11:00) s'accordent contre un seul (12:00) : c'est le démarrage de `d` qui est daté trop tard.
    const db = projectDb(
      [['c0', '2026-10-01 09:00'], ['c1', '2026-10-01 12:00'], ['c2', '2026-10-01 10:00'], ['c3', '2026-10-01 11:00']],
      [['c0', 'd', 'open'], ['c1', 'd', 'in_progress'], ['c2', 'd', 'closed'], ['c3', 'bug', 'open']],
      [{ from: 'bug', to: 'd', since: 'c3', type: 'discovered-from' }],
      ['bug'],
    );

    const histories = await readTicketHistories(db);

    const flows = analyzeFlow(histories);
    expect(flows.get('d')?.outcome).toEqual({ kind: 'delivered', at: sinceDay('2026-10-01T10:00') }); // avant la création du bug, 11:00
    expect(flows.get('d')?.leadTime).toBe(1 * HOUR);
    expect(analyzeFailures(histories, flows).originBugs.get('d')).toEqual(['bug']);
  });

  it('une horloge en avance ne déplace que son commit : les commits qui le suivent gardent leurs dates', async () => {
    // c3 est daté un mois trop tard (2 novembre). Borner chaque commit par le plus tardif des précédents daterait au 2 novembre tout ce
    // que les commits suivants ont changé, c4 et c5 compris, jusqu'à ce que les dates le rattrapent.
    const db = projectDb(
      [['c0', '2026-10-01 10:00'], ['c1', '2026-10-02 10:00'], ['c2', '2026-10-03 10:00'], ['c3', '2026-11-02 10:00'], ['c4', '2026-10-05 10:00'], ['c5', '2026-10-06 10:00']],
      [['c0', 'a', 'open'], ['c1', 'b', 'open'], ['c2', 'a', 'in_progress'], ['c3', 'b', 'in_progress'], ['c4', 'c', 'open'], ['c5', 'a', 'closed']],
    );

    const histories = await readTicketHistories(db);

    const dates = (id: string) => histories.find((h) => h.id === id)?.statusSnapshots.map((s) => [s.status, s.at.toISOString().slice(0, 10)]);
    expect(dates('a')).toEqual([['open', '2026-10-01'], ['in_progress', '2026-10-03'], ['closed', '2026-10-06']]);
    expect(dates('b')).toEqual([['open', '2026-10-02'], ['in_progress', '2026-10-05']]); // c3 prend la date de c4, qui le suit
    expect(dates('c')).toEqual([['open', '2026-10-05']]);
  });

  it('ne retire pas une dépendance avant ce que les commits précédents ont fait, quel que soit le ticket', async () => {
    // c1 10-02 `t` bloqué par `b` · c2 10-04 `b` en cours · c3 « 10-03 » (horloge en retard) la dépendance disparaît · c4 10-05 `t` fermé.
    const db = projectDb(
      [['c0', '2026-10-01 10:00'], ['c1', '2026-10-02 10:00'], ['c2', '2026-10-04 10:00'], ['c3', '2026-10-03 10:00'], ['c4', '2026-10-05 10:00']],
      [['c0', 'b', 'open'], ['c0', 't', 'open'], ['c2', 'b', 'in_progress'], ['c4', 't', 'closed']],
      [{ from: 't', to: 'b', since: 'c1', until: 'c2' }],
    );

    const histories = await readTicketHistories(db);

    expect(histories.find((h) => h.id === 't')?.dependencies).toEqual([
      { type: 'blocks', target: 'b', addedAt: sinceDay('2026-10-02T10:00'), removedAt: sinceDay('2026-10-04T10:00') }, // et non le 3
    ]);
  });

  describe('un commit daté du futur (revue de bdesk-38k.26, B1)', () => {
    // Un commit n'est pas fait dans le futur : une date postérieure à l'instant de la lecture est forcément fausse. Elle n'est pas gardée,
    // même quand elle ouvre une suite aussi longue qu'un seul commit à l'heure qui la suit.
    const readAt = () => sinceDay('2026-11-05T12:00');

    it('ne date pas dans le futur le seul commit à l’heure qui la suit : la Livraison garde sa date et son Lead Time', async () => {
      // c0 10-01 · c1 10-02 `a` en cours · c2 « 12-05 » (machine en avance de 30 jours) `b` créé · c3 11-04 `a` fermé. On lit le 5 novembre.
      const db = projectDb(
        [['c0', '2026-10-01 10:00'], ['c1', '2026-10-02 10:00'], ['c2', '2026-12-05 10:00'], ['c3', '2026-11-04 10:00']],
        [['c0', 'a', 'open'], ['c1', 'a', 'in_progress'], ['c2', 'b', 'open'], ['c3', 'a', 'closed']],
      );

      const histories = await readTicketHistories(db, { now: readAt });

      const flow = analyzeFlow(histories).get('a');
      expect(flow?.outcome).toEqual({ kind: 'delivered', at: sinceDay('2026-11-04T10:00') });
      expect(flow?.leadTime).toBe(34 * 24 * HOUR);
      expect(histories.find((h) => h.id === 'b')?.statusSnapshots).toEqual([{ status: 'open', at: sinceDay('2026-11-04T10:00') }]); // le commit en avance prend la date de celui qui le suit
    });

    it('date de l’instant de la lecture le dernier commit de la lignée quand il est daté du futur : il vient d’être fait', async () => {
      const db = projectDb(
        [['c0', '2026-10-01 10:00'], ['c1', '2026-10-02 10:00'], ['c2', '2026-12-05 10:00']],
        [['c0', 'a', 'open'], ['c1', 'a', 'in_progress'], ['c2', 'a', 'closed']],
      );

      const histories = await readTicketHistories(db, { now: readAt });

      expect(histories[0]?.statusSnapshots.map((s) => s.at.toISOString())).toEqual(['2026-10-01T10:00:00.000Z', '2026-10-02T10:00:00.000Z', '2026-11-05T12:00:00.000Z']);
    });

    it('lit l’horloge de la machine quand on ne lui en donne pas', async () => {
      const db = projectDb(
        [['c0', '2026-10-01 10:00'], ['c1', '2100-01-01 10:00']],
        [['c0', 'a', 'open'], ['c1', 'a', 'closed']],
      );

      const before = Date.now();
      const [history] = await readTicketHistories(db);
      const after = Date.now();

      const closedAt = history?.statusSnapshots[1]?.at.getTime() as number;
      expect(closedAt).toBeGreaterThanOrEqual(before);
      expect(closedAt).toBeLessThanOrEqual(after); // et non le 1er janvier 2100
    });
  });

  it('date d’après `dolt_log` un instantané dont le commit est arrivé entre les deux lectures : la lignée lue plus tôt ne le connaît pas', async () => {
    const db = fakeDb([
      { match: /from issues/, rows: [{ id: 'a', issue_type: 'task' }] },
      {
        match: /lag\(/,
        rows: [
          { id: 'a', status: 'open', changed_at: '2026-10-01 10:00:00.000', restart: 1, commit_hash: 'c0' },
          { id: 'a', status: 'closed', changed_at: '2026-10-03 10:00:00.000', restart: 0, commit_hash: 'c9' }, // absent de la lignée ci-dessous
        ],
      },
      {
        match: /select l\.commit_hash/,
        rows: [
          { commit_hash: 'c0', date: '2026-10-01 10:00:00.000' },
          { commit_hash: 'c1', date: '2026-10-02 10:00:00.000' },
        ],
      },
      columns(CURRENT_COLUMNS),
      { match: /^select .* from dolt_history_dependencies$/s, rows: [] },
    ]);

    const [history] = await readTicketHistories(db);

    expect(history?.statusSnapshots).toEqual([
      { status: 'open', at: sinceDay('2026-10-01T10:00') },
      { status: 'closed', at: sinceDay('2026-10-03T10:00') },
    ]);
  });
});
