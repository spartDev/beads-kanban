import { DECLINED_LABEL } from '../../domain/abandon';
import { declareStatuses, STATUS_CATEGORIES } from '../../domain/statuses';
import type { CustomStatus, DeclaredStatuses } from '../../shared/api';
import { type DoltDatabase, DoltQueryError, parseDoltDate, parseDoltInteger, queryAll, type Row, sqlString } from './client';

/** État d'un ticket au dernier commit : ce qu'il faut au kanban. */
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

/** État d'un ticket au dernier commit, champs texte compris : ce qu'il faut au détail. */
export interface IssueRecord extends IssueSummary {
  description: string;
  design: string;
  acceptanceCriteria: string;
  notes: string;
  closeReason: string;
}

/** Dépendance au dernier commit, normalisée : `from` dépend de `to`. */
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

/** Un label d'un ticket au dernier commit. */
export interface LabelRecord {
  issueId: string;
  label: string;
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
 * La lecture du préfixe des tickets (`issue_prefix` dans la table `config`), dans le working set : il identifie le Projet, il ne décrit aucun
 * ticket (ADR 0001). C'est la seule lecture que le filet des lectures au dernier commit laisse sans `as of 'HEAD'` (`testing/reads-at-head.ts`),
 * et il la reconnaît à ce texte exact : les statuts déclarés (`CUSTOM_STATUSES_SQL`), dans la même table, portent la clause.
 */
export const ISSUE_PREFIX_SQL = "select `value` from config where `key` = 'issue_prefix'";

/**
 * Préfixe des tickets (`ISSUE_PREFIX_SQL`), ou null s'il n'y est pas. Voie `discovery` : c'est la lecture que
 * lance chaque scan des Projets, une par Projet, et la voie du HEAD (`light`) ne doit pas faire la queue derrière elles.
 */
export async function readIssuePrefix(db: DoltDatabase): Promise<string | null> {
  const rows = await db.query(ISSUE_PREFIX_SQL, { lane: 'discovery' });
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

/**
 * Toute lecture d'une table de tickets (`issues`, `dependencies`, `labels`, `comments`) se fait dans l'état du dernier commit
 * (`as of 'HEAD'`), jamais dans le working set : celles d'ici, et la liste des tickets de l'historique (`readTicketHistories`,
 * `history.ts`). C'est l'état que l'historique (`dolt_history_*`, d'où viennent les métriques et les Chronologies), le sondage du
 * direct (`hashof('HEAD')`) et les caches des analyses connaissent, de sorte que le tableau, la fiche, les métriques et la Chronologie
 * disent la même chose du Projet (ADR 0001, bdesk-38k.36). Le working set a en plus ce que bd n'a pas encore commité (auto-commit
 * `batch` ou `off`) : un lien `blocks` posé y rangeait un ticket en Backlog au tableau quand le CFD le disait Prêt, un statut changé
 * le montrait en cours quand le WIP ne le comptait pas. En auto-commit `on`, le défaut de bd, le working set est vide hors d'une
 * commande de bd : la clause ne change rien.
 *
 * Une seule lecture oubliée suffit à ce que le tableau et les métriques se contredisent de nouveau : la liste des tickets de
 * l'historique, lue dans le working set, ferait dire autre chose d'un ticket supprimé ou retypé sans commit. `committed.integration.test.ts`
 * juge donc tout le SQL que le service envoie à Dolt (`testing/reads-at-head.ts`), non les seules lectures de ce fichier. Le préfixe des
 * tickets (`ISSUE_PREFIX_SQL`, table `config`) est la seule lecture sans la clause : il identifie le Projet, il ne décrit aucun ticket. Les
 * statuts que le Projet déclare, dans la même table, la portent (`CUSTOM_STATUSES_SQL`) : ils décident de la lecture des statuts des tickets.
 */
export const AT_HEAD = "as of 'HEAD'";

const SUMMARIES_SQL = `select id, title, issue_type, status, priority, assignee, created_at, updated_at, closed_at from issues ${AT_HEAD} order by created_at, id`;
const DEPENDENCIES_SQL = `select * from dependencies ${AT_HEAD}`;

/**
 * Les labels que lit la règle de clôture (`closureOf`, ADR 0008) : le seul `declined`, qui fait d'un ticket fermé un Renoncement. Une lecture
 * légère : une ligne par ticket qui le porte, au dernier commit comme tout le reste (le label ne se lit pas dans l'historique), et jamais un
 * processus de plus. Le tableau la lit avec les résumés et les dépendances (`readIssueBase`), les métriques et la Chronologie avec la liste des
 * tickets de l'historique (`readTicketHistories`), chacun dans le groupe de requêtes qu'il envoyait déjà.
 */
export const CLOSURE_LABELS_SQL = `select issue_id, label from labels ${AT_HEAD} where label = ${sqlString(DECLINED_LABEL)} order by issue_id`;

/** La clé de la table `config` où bd écrit les statuts personnalisés du Projet (`bd config set status.custom …`, ADR 0007). */
const CUSTOM_STATUSES_KEY = 'status.custom';

/**
 * Les statuts personnalisés que le Projet déclare, au dernier commit comme les tickets dont ils décident de la lecture des statuts (ADR 0001,
 * ADR 0007) : un ticket `in_review` et la déclaration qui en fait un Statut de relais se lisent dans le même état. Le préfixe, dans la même
 * table, se lit dans le working set (`ISSUE_PREFIX_SQL`) : lui n'identifie que le Projet. Une ligne au plus (`key` est la clé primaire), aucune
 * quand le Projet ne déclare rien. Le tableau la lit avec ses tickets (`readIssueBase`), dans le processus qu'il lançait déjà.
 *
 * Une base sans table `config` au dernier commit n'arrive jamais jusqu'ici : la vérification du SQL stocké exige le `CREATE TABLE` des cinq
 * tables lues, `config` comprise, dans HEAD (`schemaCreateProblems`, `stored-sql.ts`), et refuse la base avant toute lecture ; la découverte,
 * elle, échoue à lire le préfixe d'une base sans `config` dans le working set. Le Projet est alors illisible, comme avant cette lecture.
 *
 * Une limite : bd 1.3.1 ne valide pas les statuts des tickets contre cette clé, mais contre sa table `custom_statuses`, que `bd config set
 * status.custom` synchronise, et il ne relit la clé que si cette table est vide. Après un `bd config unset status.custom`, la table garde ses
 * lignes : des tickets peuvent encore porter `in_review` quand cette lecture ne rend plus aucun statut déclaré. On lit pourtant la clé : c'est
 * l'interface documentée de bd. Lire `custom_statuses` ajouterait une table exigée dans HEAD par la vérification du SQL stocké, et rendrait
 * illisibles les bases d'un bd qui ne l'a pas. D'où la règle (ADR 0007) : un Statut de relais se reconnaît à son nom, qu'il soit déclaré ou
 * non, et la déclaration ne compte que pour la catégorie des autres statuts personnalisés (bdesk-pz0.3 l'appliquera).
 */
export const CUSTOM_STATUSES_SQL = `select \`value\` from config ${AT_HEAD} where \`key\` = ${sqlString(CUSTOM_STATUSES_KEY)}`;

/**
 * Les statuts qu'écrit une valeur de `status.custom`, dans son ordre, doublons compris : des noms séparés par des virgules, chacun suivi ou non
 * de `:catégorie` (`in_review:wip,in_integration:wip,awaiting_human:wip`, vérifié avec bd 1.3.1 ; les versions d'avant les catégories n'écrivaient
 * que des noms). bd 1.3.1 refuse d'écrire une valeur mal formée : des majuscules dans un nom (il n'admet que `[a-z][a-z0-9_-]*`), des blancs
 * autour d'un nom ou d'une catégorie, un doublon, une catégorie inconnue. Pour toute valeur qu'il accepte, la lecture est la sienne. Tolérer le
 * reste est un choix de l'app, non une règle de bd : la base vient d'un remote partagé, et une clé écrite à la main ne rend jamais le Projet
 * illisible. Rien ici n'échoue.
 *
 * - Les blancs autour d'une entrée, d'un nom ou d'une catégorie ne comptent pas. Une entrée vide (valeur vide, virgule en trop) ou sans nom
 *   (`:wip`) ne déclare rien.
 * - Le nom est gardé tel qu'il est écrit, casse comprise, et le domaine le compare exactement, comme bd : un `IN_REVIEW` écrit à la main n'est
 *   pas `in_review`.
 * - La catégorie se lit sans tenir compte de la casse (`WIP` est `wip`). Absente, vide (`qa:`), inconnue (`qa:review`) ou en double
 *   (`qa:wip:done` : tout ce qui suit le premier deux-points), elle est inconnue (`null`), et le statut reste déclaré.
 *
 * Ce que la déclaration en fait (Statuts de relais, doublons, statuts de base) est la règle du domaine, `declareStatuses`.
 */
export function parseCustomStatuses(value: string): CustomStatus[] {
  return value.split(',').flatMap((entry) => {
    const colon = entry.indexOf(':');
    const name = (colon < 0 ? entry : entry.slice(0, colon)).trim();
    if (name === '') return [];
    const written = colon < 0 ? '' : entry.slice(colon + 1).trim().toLowerCase();
    return [{ name, category: STATUS_CATEGORIES.find((category) => category === written) ?? null }];
  });
}

/** Les lignes de `CUSTOM_STATUSES_SQL` : la valeur de la clé, s'il y en a une ; NULL (absente de la sortie JSON) ne déclare rien. */
export const toDeclaredStatuses = (rows: Row[]): DeclaredStatuses => declareStatuses(parseCustomStatuses(asText(rows[0]?.value)));

const issueSql = (id: string) => `select id, title, description, design, acceptance_criteria, notes, issue_type, status, priority, assignee,
            created_at, updated_at, closed_at, close_reason
     from issues ${AT_HEAD} where id = ${sqlString(id)}`;
const labelsSql = (issueId: string) => `select label from labels ${AT_HEAD} where issue_id = ${sqlString(issueId)} order by label`;
const commentsSql = (issueId: string) =>
  `select author, \`text\`, created_at from comments ${AT_HEAD} where issue_id = ${sqlString(issueId)} order by created_at, id`;

export async function readIssueSummaries(db: DoltDatabase): Promise<IssueSummary[]> {
  return (await db.query(SUMMARIES_SQL)).map(toSummary);
}

/** Le ticket complet, ou null s'il n'existe pas. */
export async function readIssue(db: DoltDatabase, id: string): Promise<IssueRecord | null> {
  return toRecord((await db.query(issueSql(id)))[0]);
}

/** Toutes les dépendances du Projet au dernier commit. */
export async function readDependencies(db: DoltDatabase): Promise<DependencyRecord[]> {
  return toDependencies(await db.query(DEPENDENCIES_SQL));
}

export async function readLabels(db: DoltDatabase, issueId: string): Promise<string[]> {
  return toLabels(await db.query(labelsSql(issueId)));
}

export async function readComments(db: DoltDatabase, issueId: string): Promise<CommentRecord[]> {
  return toComments(await db.query(commentsSql(issueId)));
}

/** Les labels du Projet au dernier commit que lit la règle de clôture : `declined` (voir `CLOSURE_LABELS_SQL`). */
export async function readClosureLabels(db: DoltDatabase): Promise<LabelRecord[]> {
  return toLabelRecords(await db.query(CLOSURE_LABELS_SQL));
}

/** Les statuts personnalisés que le Projet déclare, au dernier commit (voir `CUSTOM_STATUSES_SQL`). */
export async function readDeclaredStatuses(db: DoltDatabase): Promise<DeclaredStatuses> {
  return toDeclaredStatuses(await db.query(CUSTOM_STATUSES_SQL));
}

/**
 * Ce que le kanban et la fiche de n'importe quel ticket du Projet ont en commun : tous les tickets, résumés, toutes les dépendances, les
 * labels qui décident de ce qu'est un ticket fermé (`CLOSURE_LABELS_SQL`) et les statuts personnalisés que le Projet déclare
 * (`CUSTOM_STATUSES_SQL`), que seul le kanban rend (`ProjectService.board`).
 */
export interface IssueBase {
  summaries: IssueSummary[];
  dependencies: DependencyRecord[];
  labels: LabelRecord[];
  declaredStatuses: DeclaredStatuses;
}

/**
 * Les résumés des tickets, les dépendances, les labels de clôture et les statuts déclarés du Projet, lus dans UN processus `dolt` (et une seule
 * transaction : un seul état de la base) au lieu de quatre. Mêmes requêtes que `readIssueSummaries`, `readDependencies`, `readClosureLabels` et
 * `readDeclaredStatuses`.
 */
export async function readIssueBase(db: DoltDatabase): Promise<IssueBase> {
  const [summaries, dependencies, labels, declared] = await queryAll(db, [SUMMARIES_SQL, DEPENDENCIES_SQL, CLOSURE_LABELS_SQL, CUSTOM_STATUSES_SQL]);
  return {
    summaries: (summaries ?? []).map(toSummary),
    dependencies: toDependencies(dependencies ?? []),
    labels: toLabelRecords(labels ?? []),
    declaredStatuses: toDeclaredStatuses(declared ?? []),
  };
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

/** Les lignes de `CLOSURE_LABELS_SQL` ; une ligne sans ticket ne dit rien. */
export const toLabelRecords = (rows: Row[]): LabelRecord[] =>
  rows.flatMap((row) => {
    const issueId = asText(row.issue_id);
    return issueId ? [{ issueId, label: asText(row.label) }] : [];
  });

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
    priority: parseDoltInteger(row.priority, 'priority') ?? 2, // NULL : P2, le défaut de bd
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
