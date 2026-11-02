import { type DoltDatabase, DoltQueryError, parseDoltDate, type Row, sqlString } from './client';

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
  return from && to ? { from, to, type: asText(row.type) } : null;
}

/** Préfixe des tickets (`issue_prefix` dans la table `config`), ou null s'il n'y est pas. */
export async function readIssuePrefix(db: DoltDatabase): Promise<string | null> {
  const rows = await db.query("select `value` from config where `key` = 'issue_prefix'");
  return asText(rows[0]?.value) || null;
}

/**
 * Hash du dernier commit (HEAD) de la base : il change à chaque nouveau commit Dolt, donc à chaque écriture de bd en
 * auto-commit. Une seule requête légère : de quoi savoir, sans relire l'historique, si un résultat calculé est périmé.
 */
export async function readHead(db: DoltDatabase): Promise<string> {
  const rows = await db.query("select hashof('HEAD') as head");
  const head = asText(rows[0]?.head);
  if (!head) throw new DoltQueryError(`HEAD illisible dans ${db.dir}`, db.dir);
  return head;
}

export async function readIssueSummaries(db: DoltDatabase): Promise<IssueSummary[]> {
  const rows = await db.query(
    'select id, title, issue_type, status, priority, assignee, created_at, updated_at, closed_at from issues order by created_at, id',
  );
  return rows.map(toSummary);
}

/** Le ticket complet, ou null s'il n'existe pas. */
export async function readIssue(db: DoltDatabase, id: string): Promise<IssueRecord | null> {
  const rows = await db.query(
    `select id, title, description, design, acceptance_criteria, notes, issue_type, status, priority, assignee,
            created_at, updated_at, closed_at, close_reason
     from issues where id = ${sqlString(id)}`,
  );
  const row = rows[0];
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

/** Toutes les dépendances courantes du Projet. */
export async function readDependencies(db: DoltDatabase): Promise<DependencyRecord[]> {
  const rows = await db.query('select * from dependencies');
  return rows.flatMap((row) => toDependency(row) ?? []);
}

export async function readLabels(db: DoltDatabase, issueId: string): Promise<string[]> {
  const rows = await db.query(`select label from labels where issue_id = ${sqlString(issueId)} order by label`);
  return rows.map((row) => asText(row.label));
}

export async function readComments(db: DoltDatabase, issueId: string): Promise<CommentRecord[]> {
  const rows = await db.query(
    `select author, \`text\`, created_at from comments where issue_id = ${sqlString(issueId)} order by created_at, id`,
  );
  return rows.map((row) => ({
    author: asText(row.author),
    text: asText(row.text),
    createdAt: parseDoltDate(row.created_at),
  }));
}

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
