import { type DoltDatabase, DoltQueryError, parseDoltDate, queryAll, type Row, sqlString } from './client';

/** État courant d'un ticket : ce qu'il faut au kanban. */
export interface IssueSummary {
  id: string;
  title: string;
  type: string;
  status: string;
  priority: number;
  assignee: string | null;
  createdAt: Date;
  updatedAt: Date;
  closedAt: Date | null;
}

/** État courant d'un ticket, champs texte compris : ce qu'il faut au détail. */
export interface IssueRecord extends IssueSummary {
  description: string;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  closeReason: string;
}

/** Dépendance courante, normalisée : `from` dépend de `to`. */
export interface DependencyRecord {
  from: string;
  to: string;
  type: string;
  /**
   * Quand le lien a été posé : le `created_at` de sa ligne, que `bd` écrit à la pose. La table ne rend pas ses lignes dans l'ordre
   * de pose ; c'est cette date qui dit quel lien est le premier (l'Abandon d'un ticket qui en porte plusieurs, `abandonOf`).
   * Absente quand la ligne ne la donne pas.
   */
  createdAt?: Date;
}

export interface CommentRecord {
  author: string;
  text: string;
  createdAt: Date;
}

/**
 * Colonnes portant la cible d'une dépendance, selon la version de bd qui a écrit la base :
 * `depends_on_id` (anciennes), `depends_on_issue_id` (récentes, avec en plus un wisp ou une référence externe).
 */
export const TARGET_COLUMNS = ['depends_on_issue_id', 'depends_on_id', 'depends_on_wisp_id', 'depends_on_external'] as const;

/** Normalise une ligne de la table `dependencies` (ou de son historique) ; null si la cible est absente. */
export function toDependency(row: Row): DependencyRecord | null {
  const from = asText(row.issue_id);
  const to = TARGET_COLUMNS.map((column) => asText(row[column])).find((value) => value !== '');
  const createdAt = placedAt(row.created_at);
  return from && to ? { from, to, type: asText(row.type), ...(createdAt ? { createdAt } : {}) } : null;
}

/**
 * Préfixe des tickets (`issue_prefix` dans la table `config`), ou null s'il n'y est pas. Voie `discovery` : c'est la lecture que
 * lance chaque scan des Projets, une par Projet, et la voie du HEAD (`light`) ne doit pas faire la queue derrière elles.
 */
export async function readIssuePrefix(db: DoltDatabase): Promise<string | null> {
  const rows = await db.query("select `value` from config where `key` = 'issue_prefix'", { lane: 'discovery' });
  return asText(rows[0]?.value) || null;
}

/**
 * Hash du dernier commit (HEAD) de la base : il change à chaque nouveau commit Dolt, donc à chaque écriture de bd en
 * auto-commit. Une seule requête légère : de quoi savoir, sans relire l'historique, si un résultat calculé est périmé.
 * Elle passe par la voie `light`, qui ne fait pas la queue derrière les lectures lourdes en cours.
 */
export async function readHead(db: DoltDatabase): Promise<string> {
  const rows = await db.query("select hashof('HEAD') as head", { lane: 'light' });
  const head = asText(rows[0]?.head);
  if (!head) throw new DoltQueryError(`HEAD illisible dans ${db.dir}`, db.dir);
  return head;
}

const SUMMARIES_SQL = 'select id, title, issue_type, status, priority, assignee, created_at, updated_at, closed_at from issues order by created_at, id';
const DEPENDENCIES_SQL = 'select * from dependencies';

const issueSql = (id: string) => `select id, title, description, design, acceptance_criteria, notes, issue_type, status, priority, assignee,
            created_at, updated_at, closed_at, close_reason
     from issues where id = ${sqlString(id)}`;
const labelsSql = (issueId: string) => `select label from labels where issue_id = ${sqlString(issueId)} order by label`;
const commentsSql = (issueId: string) =>
  `select author, \`text\`, created_at from comments where issue_id = ${sqlString(issueId)} order by created_at, id`;

export async function readIssueSummaries(db: DoltDatabase): Promise<IssueSummary[]> {
  return (await db.query(SUMMARIES_SQL)).map(toSummary);
}

/** Le ticket complet, ou null s'il n'existe pas. */
export async function readIssue(db: DoltDatabase, id: string): Promise<IssueRecord | null> {
  return toRecord((await db.query(issueSql(id)))[0]);
}

/** Toutes les dépendances courantes du Projet. */
export async function readDependencies(db: DoltDatabase): Promise<DependencyRecord[]> {
  return toDependencies(await db.query(DEPENDENCIES_SQL));
}

export async function readLabels(db: DoltDatabase, issueId: string): Promise<string[]> {
  return toLabels(await db.query(labelsSql(issueId)));
}

export async function readComments(db: DoltDatabase, issueId: string): Promise<CommentRecord[]> {
  return toComments(await db.query(commentsSql(issueId)));
}

/** Ce que le kanban et la fiche de n'importe quel ticket du Projet ont en commun : tous les tickets, résumés, et toutes les dépendances. */
export interface IssueBase {
  summaries: IssueSummary[];
  dependencies: DependencyRecord[];
}

/**
 * Les résumés des tickets et les dépendances du Projet, lus dans UN processus `dolt` (et une seule transaction : un seul état de
 * la base) au lieu de deux. Mêmes requêtes que `readIssueSummaries` et `readDependencies`.
 */
export async function readIssueBase(db: DoltDatabase): Promise<IssueBase> {
  const [summaries, dependencies] = await queryAll(db, [SUMMARIES_SQL, DEPENDENCIES_SQL]);
  return { summaries: (summaries ?? []).map(toSummary), dependencies: toDependencies(dependencies ?? []) };
}

/** Ce qui est propre à la fiche d'un ticket : le ticket complet (null s'il n'existe pas), ses étiquettes et ses commentaires. */
export interface IssueParts {
  record: IssueRecord | null;
  labels: string[];
  comments: CommentRecord[];
}

/**
 * Le ticket, ses étiquettes et ses commentaires, lus dans UN processus `dolt` au lieu de trois. Mêmes requêtes que `readIssue`,
 * `readLabels` et `readComments`.
 */
export async function readIssueParts(db: DoltDatabase, id: string): Promise<IssueParts> {
  const [issue, labels, comments] = await queryAll(db, [issueSql(id), labelsSql(id), commentsSql(id)]);
  return { record: toRecord(issue?.[0]), labels: toLabels(labels ?? []), comments: toComments(comments ?? []) };
}

function toRecord(row: Row | undefined): IssueRecord | null {
  if (!row) return null;
  return {
    ...toSummary(row),
    description: asText(row.description),
    design: asText(row.design),
    acceptanceCriteria: asText(row.acceptance_criteria),
    notes: asText(row.notes),
    closeReason: asText(row.close_reason),
  };
}

const toDependencies = (rows: Row[]): DependencyRecord[] => rows.flatMap((row) => toDependency(row) ?? []);

const toLabels = (rows: Row[]): string[] => rows.map((row) => asText(row.label));

const toComments = (rows: Row[]): CommentRecord[] =>
  rows.map((row) => ({
    author: asText(row.author),
    text: asText(row.text),
    createdAt: parseDoltDate(row.created_at),
  }));

function toSummary(row: Row): IssueSummary {
  return {
    id: asText(row.id),
    title: asText(row.title),
    type: asText(row.issue_type),
    status: asText(row.status),
    priority: typeof row.priority === 'number' ? row.priority : 2,
    assignee: asText(row.assignee) || null,
    createdAt: parseDoltDate(row.created_at),
    updatedAt: parseDoltDate(row.updated_at),
    closedAt: row.closed_at ? parseDoltDate(row.closed_at) : null,
  };
}

/** Valeur texte d'une colonne ; NULL (absent de la sortie JSON) donne une chaîne vide. */
export function asText(value: unknown): string {
  return typeof value === 'string' ? value : '';
}

/**
 * La date de pose d'un lien (`created_at` de sa ligne) ; rien si la ligne n'en dit pas ou n'en dit qu'une illisible : un lien
 * mal daté ne rend pas le Projet illisible. Les lignes de l'historique n'ont pas cette colonne, et il y en a des centaines de
 * milliers : sans date, on rend aussitôt, sans rien lire ni lever d'exception.
 */
function placedAt(value: unknown): Date | undefined {
  if (typeof value !== 'string' || value === '') return undefined;
  try {
    return parseDoltDate(value);
  } catch (err) {
    if (err instanceof DoltQueryError) return undefined;
    throw err;
  }
}
