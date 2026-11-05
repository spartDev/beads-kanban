import type { TicketHistory } from '../../domain/flow';
import type { Issue, IssueDetail, Project, ProjectsResponse } from '../../shared/api';
import { ReadAborted } from '../abort';
import type { Config } from '../config';
import { createDoltClient, type DoltClient, type DoltDatabase, DoltNotFoundError, DoltQueryError, withOptions } from '../dolt/client';
import { readTicketHistories } from '../dolt/history';
import { readHead, readIssueBase, readIssueParts } from '../dolt/reader';
import { type Discovery, type DiscoveredProject, discoverProjects } from './discovery';
import { buildIssueDetail, buildIssues } from './issues';

export class ProjectNotFoundError extends Error {
  constructor(readonly projectId: string) {
    super(`Projet inconnu : ${projectId}`);
    this.name = 'ProjectNotFoundError';
  }
}

export class IssueNotFoundError extends Error {
  constructor(
    readonly projectId: string,
    readonly issueId: string,
  ) {
    super(`Ticket inconnu dans ${projectId} : ${issueId}`);
    this.name = 'IssueNotFoundError';
  }
}

/** Le Projet existe mais sa base ne peut pas être lue ; `reason` dit pourquoi. */
export class ProjectUnreadableError extends Error {
  constructor(
    readonly projectId: string,
    readonly reason: string,
  ) {
    super(`Projet illisible : ${projectId} (${reason})`);
    this.name = 'ProjectUnreadableError';
  }
}

/** Comment une lecture d'un Projet est menée. */
export interface ReadOptions {
  /**
   * Abandon du demandeur (le client HTTP est parti, bdesk-38k.20) : la lecture rejette aussitôt par une `ReadAborted` (jamais
   * par un Projet illisible), ses lectures Dolt encore en file en sortent, et celles dont le processus est lancé vont au bout
   * (jamais tuées : ADR 0003), leur résultat est jeté si personne d'autre ne l'attend.
   */
  signal?: AbortSignal;
}

export interface ProjectService {
  /** Rescanne les racines et renvoie les Projets (lisibles ou non) et les dossiers ignorés. */
  list(): Promise<ProjectsResponse>;
  issues(projectId: string, options?: ReadOptions): Promise<Issue[]>;
  issue(projectId: string, issueId: string, options?: ReadOptions): Promise<IssueDetail>;
  /** Historique complet des tickets, pour `analyzeFlow`. */
  histories(projectId: string, options?: ReadOptions): Promise<TicketHistory[]>;
  /**
   * Hash du dernier commit Dolt du Projet : change à chaque commit, donc clé d'invalidation des calculs. Lecture de la voie `light`, qui ne fait pas la
   * queue derrière les autres (voir `QueryOptions.lane`), et sans abandon : quelques dizaines de millisecondes.
   */
  head(projectId: string): Promise<string>;
}

export interface ProjectServiceOptions {
  dolt?: DoltClient;
  /**
   * Délai minimal entre deux scans provoqués par un Projet inconnu ou illisible (défaut : 5 s). Sans lui, chaque
   * requête vers un identifiant qui n'existe pas relancerait un scan complet : un processus dolt par Projet.
   */
  rescanIntervalMs?: number;
}

/** Les rescans rapprochés partagent le même résultat : chacun lance un processus dolt par Projet. */
const LIST_MAX_AGE_MS = 2_000;
const LOOKUP_MAX_AGE_MS = 30_000;
const RESCAN_MIN_INTERVAL_MS = 5_000;

export function createProjectService(
  config: Config,
  { dolt = createDoltClient(), rescanIntervalMs = RESCAN_MIN_INTERVAL_MS }: ProjectServiceOptions = {},
): ProjectService {
  let latest: { at: number; settled: boolean; discovery: Promise<Discovery> } | undefined;
  /** Le dernier scan achevé, même périmé ou remplacé par un scan en cours : de quoi servir un Projet connu pendant qu'un scan le revérifie. */
  let known: Discovery | undefined;

  /** Le dernier scan s'il a moins de `maxAgeMs` ou s'il est encore en cours (tous les appelants le partagent). */
  function discover(maxAgeMs: number): Promise<Discovery> {
    if (!latest || (latest.settled && Date.now() - latest.at > maxAgeMs)) {
      const scan = { at: Date.now(), settled: false, discovery: discoverProjects(config, { dolt }) };
      latest = scan;
      scan.discovery.then(
        (discovery) => {
          scan.settled = true;
          known = discovery;
        },
        () => {
          scan.settled = true;
          if (latest === scan) latest = undefined;
        },
      );
    }
    return latest.discovery;
  }

  /**
   * La base du Projet. Un Projet que le dernier scan achevé connaît et dit lisible est lu aussitôt, sans attendre aucun scan
   * (stale-while-revalidate, bdesk-38k.28) : ni celui qui tourne, que toute demande arrivée pendant ce temps attendait entier (de l'ordre
   * de 2 s pour 40 Projets), ni celui que son âge rend dû (`lookupMaxAgeMs`), qui part alors en arrière-plan. Si ce scan retire le Projet
   * (dossier supprimé, masqué), la lecture réussit tant que sa base existe, ou échoue en Projet illisible ; il devient inconnu (404)
   * quand le scan finit. L'échec d'un scan que personne n'attend ne concerne personne : le suivant réessaie (`discover`).
   *
   * Un Projet inconnu, ou illisible au dernier scan, attend le scan : c'est lui qui dit s'il a été ajouté ou réparé depuis. Il en lance
   * un s'il n'y en a pas, au plus une fois par `rescanIntervalMs` : le scan qui vient d'avoir lieu fait foi.
   */
  async function open(projectId: string, lookupMaxAgeMs = LOOKUP_MAX_AGE_MS): Promise<DoltDatabase> {
    const stale = known?.projects.find((p) => p.id === projectId);
    if (stale?.status === 'ok' && stale.databasePath) {
      void discover(lookupMaxAgeMs).catch(() => undefined);
      return dolt.open(stale.databasePath);
    }
    const find = async (maxAgeMs: number) => (await discover(maxAgeMs)).projects.find((p) => p.id === projectId);
    let project = await find(lookupMaxAgeMs);
    if (project?.status !== 'ok') project = await find(rescanIntervalMs);
    if (!project) throw new ProjectNotFoundError(projectId);
    if (project.status !== 'ok' || !project.databasePath) {
      throw new ProjectUnreadableError(projectId, project.reason ?? 'Base Dolt introuvable.');
    }
    return dolt.open(project.databasePath);
  }

  /**
   * Une base qui échoue à répondre rend le Projet illisible, avec le message de dolt pour raison. Un abandon (`signal`) n'est pas
   * une panne : il passe tel quel. `task` reçoit une base dont toutes les lectures portent le signal.
   */
  async function read<T>(
    projectId: string,
    task: (db: DoltDatabase) => Promise<T>,
    { signal, lookupMaxAgeMs }: ReadOptions & { lookupMaxAgeMs?: number } = {},
  ): Promise<T> {
    if (signal?.aborted) throw new ReadAborted();
    const db = await open(projectId, lookupMaxAgeMs);
    if (signal?.aborted) throw new ReadAborted(); // parti pendant la recherche du Projet (un scan, qui ne s'interrompt pas)
    try {
      return await task(signal ? withOptions(db, { signal }) : db);
    } catch (err) {
      if (err instanceof DoltNotFoundError || err instanceof DoltQueryError) {
        throw new ProjectUnreadableError(projectId, err.message);
      }
      throw err;
    }
  }

  return {
    async list() {
      const { projects, ignored } = await discover(LIST_MAX_AGE_MS);
      return { projects: projects.map(toPublic), ignored };
    },

    issues: async (projectId, { signal } = {}) => {
      const { summaries, dependencies } = await read(projectId, readIssueBase, { signal });
      return buildIssues(summaries, dependencies);
    },

    issue: (projectId, issueId, { signal } = {}) =>
      read(
        projectId,
        async (db) => {
          // Aucun ticket n'a d'octet nul dans son identifiant, et dolt ne pourrait pas recevoir la requête : inutile de l'envoyer.
          if (issueId.includes('\0')) throw new IssueNotFoundError(projectId, issueId);
          // Deux processus en parallèle : le ticket avec ses étiquettes et ses commentaires, et ce que tous les tickets du Projet
          // partagent (résumés et dépendances), que les fiches demandées ensemble lisent ensemble (voir `DoltDatabase`).
          const [{ record, labels, comments }, { summaries, dependencies }] = await Promise.all([readIssueParts(db, issueId), readIssueBase(db)]);
          const all = buildIssues(summaries, dependencies);
          const issue = record && all.find((i) => i.id === record.id);
          if (!record || !issue) throw new IssueNotFoundError(projectId, issueId);
          return buildIssueDetail(issue, record, dependencies, labels, comments, new Map(all.map((i) => [i.id, i])));
        },
        { signal },
      ),

    // L'historique est lu par la voie des analyses : il se partage entre toutes les requêtes du Projet (cache par HEAD) et ne doit
    // pas faire la queue derrière les fiches (voir `QueryOptions.lane`).
    histories: (projectId, { signal } = {}) => read(projectId, (db) => readTicketHistories(withOptions(db, { lane: 'analysis' })), { signal }),

    // Le sondage du direct (bdesk-38k.8) lit le HEAD de chaque Projet suivi toutes les quelques secondes : un Projet que le
    // dernier scan connaît et dit lisible n'est pas redécouvert à cause de l'âge du scan (ce serait un processus dolt par
    // Projet, tous les Projets lus pour sonder un seul). Un Projet inconnu ou illisible est cherché comme pour toute lecture.
    head: (projectId) => read(projectId, readHead, { lookupMaxAgeMs: Number.POSITIVE_INFINITY }),
  };
}

/** Le Projet tel que l'API l'expose : sans l'emplacement interne de la base. */
function toPublic(project: DiscoveredProject): Project {
  const { id, name, path, prefix, mode, status, reason } = project;
  return reason === undefined ? { id, name, path, prefix, mode, status } : { id, name, path, prefix, mode, status, reason };
}
