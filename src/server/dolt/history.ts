import type { DependencyHistory, StatusSnapshot, TicketHistory } from '../../domain/flow';
import { type DoltDatabase, parseDoltDate, sqlIdent } from './client';
import { asText, TARGET_COLUMNS, toDependency } from './reader';

/** Un commit de l'historique Dolt, tel que listé par `dolt_log`. */
export interface Commit {
  hash: string;
  at: Date;
}

/** Une dépendance vue dans l'état du Projet à un commit donné. */
export interface DependencyAppearance {
  commit: string;
  from: string;
  to: string;
  type: string;
}

/**
 * Les commits de la lignée du premier parent, de HEAD (`seq` 0) vers le premier commit. Une fusion a deux parents :
 * suivre toute l'ascendance mélangerait les états de deux branches parallèles (même `commit_order`, ordre arbitraire)
 * et fabriquerait des changements de statut et des retraits de dépendance qui n'ont jamais eu lieu. La lignée est une
 * chaîne : son ordre est total, sans égalité, et ne dépend d'aucune horloge. Les changements faits sur une branche
 * fusionnée y apparaissent à la date de la fusion.
 */
const LINEAGE = `with recursive lineage (commit_hash, seq) as (
    select hashof('HEAD'), 0
    union all
    select a.parent_hash, lineage.seq + 1
      from lineage join dolt_commit_ancestors a on a.commit_hash = lineage.commit_hash and a.parent_index = 0
     where a.parent_hash is not null
  )`;

/**
 * Statuts successifs de chaque ticket : un seul instantané par changement de statut, daté du commit
 * qui l'a enregistré (UTC). Dolt rejoue l'état du ticket à chaque commit ; on ne garde que les changements.
 *
 * `restart` vaut 1 sur le premier instantané d'une vie du ticket : sa création, ou sa réapparition après un trou
 * (un ticket supprimé puis recréé avec le même identifiant). Les commits de la lignée se suivent de 1 en 1 en `seq` :
 * un écart de plus de 1 entre deux apparitions du ticket est un trou, que `lag` enjamberait sans le voir.
 * `seq` croît vers le passé : `order by seq desc` range les commits du plus ancien au plus récent.
 * `commit_hash` est le commit de l'instantané : pour un `restart`, celui où commence la vie du ticket.
 */
const STATUS_CHANGES_SQL = `${LINEAGE}
  select id, status, changed_at, restart, commit_hash from (
    select id, status, changed_at, commit_hash, seq, previous,
           case when previous_seq is null or previous_seq - seq > 1 then 1 else 0 end as restart
    from (
      select h.id as id, h.status as status, l.date as changed_at, h.commit_hash as commit_hash, ln.seq as seq,
             lag(h.status) over (partition by h.id order by ln.seq desc) as previous,
             lag(ln.seq) over (partition by h.id order by ln.seq desc) as previous_seq
      from dolt_history_issues h
      join lineage ln on ln.commit_hash = h.commit_hash
      join dolt_log l on l.commit_hash = h.commit_hash
    ) lagged
  ) s
  where restart = 1 or previous <> status
  order by id, seq desc`;

/** Les commits de la lignée, du plus ancien au plus récent. */
const COMMITS_SQL = `${LINEAGE}
  select l.commit_hash, l.date from lineage ln join dolt_log l on l.commit_hash = ln.commit_hash order by ln.seq desc`;

/** Garde-fou : une base ne change pas de schéma de dépendances plus de quelques fois. */
const MAX_SCHEMA_ERAS = 4;

/**
 * Historique complet des tickets du Projet, au format attendu par `analyzeFlow` : statuts datés par les
 * commits Dolt, dépendances avec leur date d'ajout et de retrait. Seuls les tickets existants sont renvoyés.
 */
export async function readTicketHistories(db: DoltDatabase): Promise<TicketHistory[]> {
  const commitsRequest = db.query(COMMITS_SQL).then((rows) =>
    rows.map((row): Commit => ({ hash: asText(row.commit_hash), at: parseDoltDate(row.date) })),
  );
  const [tickets, statusChanges, commits, appearances] = await Promise.all([
    db.query('select id, issue_type from issues order by id'),
    db.query(STATUS_CHANGES_SQL),
    commitsRequest,
    readDependencyAppearances(db, commitsRequest),
  ]);

  const snapshots = new Map<string, StatusSnapshot[]>();
  const recreations = new Map<string, string>(); // tickets recréés : le commit où commence leur vie actuelle
  for (const row of statusChanges) {
    const id = asText(row.id);
    const restart = row.restart === 1;
    // Une nouvelle vie du ticket (recréation après un trou) fait oublier la précédente, dépendances comprises.
    if (restart && snapshots.has(id)) recreations.set(id, asText(row.commit_hash));
    const list = restart ? [] : (snapshots.get(id) ?? []);
    list.push({ status: asText(row.status), at: parseDoltDate(row.changed_at) });
    snapshots.set(id, list);
  }

  const dependencies = dependencyLifetimes(appearances, commits, recreations);

  return tickets.map((row) => {
    const id = asText(row.id);
    return {
      id,
      type: asText(row.issue_type),
      statusSnapshots: snapshots.get(id) ?? [],
      dependencies: dependencies.get(id) ?? [],
    };
  });
}

/**
 * Dépendances vues à chaque commit. Une montée de version de bd peut renommer la colonne cible
 * (`depends_on_id` → `depends_on_issue_id`) : `dolt_history_dependencies` ne montre alors que les colonnes du
 * schéma courant, et les commits antérieurs à la migration n'ont plus de cible. On les relit tels que
 * le dernier d'entre eux les voyait (`<base>/<commit>.dolt_history_dependencies`), époque après époque.
 *
 * Le « dernier » commit sans cible est le plus récent de la lignée (`commits`, du plus ancien au plus récent) :
 * lu tel que le voyait un commit plus ancien, l'historique perdrait les commits qui le suivent. Les dates ne
 * disent rien de cet ordre : une horloge peut reculer.
 */
async function readDependencyAppearances(db: DoltDatabase, commits: Promise<Commit[]>): Promise<DependencyAppearance[]> {
  const appearances: DependencyAppearance[] = [];
  let source = 'dolt_history_dependencies';
  let anchor: string | undefined;
  let pending: Set<string> | undefined;

  for (let era = 0; era < MAX_SCHEMA_ERAS; era++) {
    const rows = await db.query(`select ${await dependencyColumns(db, source)} from ${source}`);
    const found: DependencyAppearance[] = [];
    const unresolved = new Set<string>();
    for (const row of rows) {
      const commit = asText(row.commit_hash);
      if (pending && !pending.has(commit)) continue; // déjà résolu à une époque plus récente
      const dependency = toDependency(row);
      if (dependency) found.push({ commit, ...dependency });
      else unresolved.add(commit);
    }
    for (const appearance of found) if (!unresolved.has(appearance.commit)) appearances.push(appearance);

    const latest = latestCommit(unresolved, await commits);
    if (!latest || latest === anchor) break; // plus rien à résoudre, ou aucun progrès
    anchor = latest;
    pending = unresolved;
    const name = asText((await db.query('select database() as name'))[0]?.name);
    source = `${sqlIdent(`${name}/${anchor}`)}.dolt_history_dependencies`;
  }
  return appearances;
}

/**
 * Les colonnes dont on a besoin dans `source` : le commit, le ticket, le type et la ou les colonnes de cible
 * que ce schéma possède. L'historique répète chaque ligne à chaque commit : on ne lit pas `metadata` et consorts.
 */
async function dependencyColumns(db: DoltDatabase, source: string): Promise<string> {
  const existing = new Set((await db.query(`show columns from ${source}`)).map((row) => asText(row.Field)));
  return ['commit_hash', 'issue_id', 'type', ...TARGET_COLUMNS]
    .filter((column) => existing.has(column))
    .map(sqlIdent)
    .join(', ');
}

/** Le plus récent des commits de `hashes` dans la lignée ; ceux qui n'en font pas partie ne comptent pas. */
function latestCommit(hashes: Set<string>, lineage: Commit[]): string | undefined {
  return lineage.findLast((commit) => hashes.has(commit.hash))?.hash;
}

/**
 * Durée de vie des dépendances : `addedAt` est le premier commit où elle apparaît, `removedAt` le commit
 * suivant le dernier où elle figure (absent si elle est encore là au dernier commit). Une dépendance retirée
 * puis rétablie donne deux entrées.
 *
 * `recreations` donne, pour chaque ticket supprimé puis recréé, le commit où commence sa vie actuelle. Comme ses
 * statuts, ses dépendances ne sont comptées que depuis ce commit : celles de sa vie précédente sont oubliées, et
 * une dépendance qui a survécu à son absence est datée de la recréation.
 */
export function dependencyLifetimes(
  appearances: DependencyAppearance[],
  commits: Commit[],
  recreations: ReadonlyMap<string, string> = new Map(),
): Map<string, DependencyHistory[]> {
  const position = new Map(commits.map((commit, i) => [commit.hash, i]));
  // Un commit de recréation absent de la lignée (arrivé entre deux lectures) n'écarte rien.
  const lifeStart = (ticket: string) => position.get(recreations.get(ticket) ?? '') ?? 0;
  const byDependency = new Map<string, { from: string; to: string; type: string; positions: number[] }>();
  for (const { commit, from, to, type } of appearances) {
    const i = position.get(commit);
    if (i === undefined || i < lifeStart(from)) continue;
    const key = JSON.stringify([from, to, type]);
    const entry = byDependency.get(key) ?? { from, to, type, positions: [] };
    entry.positions.push(i);
    byDependency.set(key, entry);
  }

  const lifetimes = new Map<string, DependencyHistory[]>();
  for (const { from, to, type, positions } of byDependency.values()) {
    const list = lifetimes.get(from) ?? [];
    for (const [first, last] of runs([...new Set(positions)].sort((a, b) => a - b))) {
      const addedAt = commits[first]?.at;
      if (!addedAt) continue;
      const next = commits[last + 1]?.at;
      // Une horloge qui recule peut dater le commit suivant avant le premier : le retrait ne précède jamais l'ajout.
      const removedAt = next && next.getTime() < addedAt.getTime() ? addedAt : next;
      list.push(removedAt ? { type, target: to, addedAt, removedAt } : { type, target: to, addedAt });
    }
    lifetimes.set(from, list);
  }
  for (const list of lifetimes.values()) {
    list.sort((a, b) => a.addedAt.getTime() - b.addedAt.getTime() || a.target.localeCompare(b.target));
  }
  return lifetimes;
}

/** Séquences d'entiers consécutifs, sous forme [premier, dernier]. */
function runs(sorted: number[]): [number, number][] {
  const result: [number, number][] = [];
  for (const n of sorted) {
    const last = result.at(-1);
    if (last && n === last[1] + 1) last[1] = n;
    else result.push([n, n]);
  }
  return result;
}
