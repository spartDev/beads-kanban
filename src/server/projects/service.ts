import type { TicketHistory } from '../../domain/flow';
import type { Issue, IssueDetail, Project, ProjectsResponse } from '../../shared/api';
import type { Config } from '../config';
import { createDoltClient, type DoltClient, type DoltDatabase, DoltNotFoundError, DoltQueryError } from '../dolt/client';
import { readTicketHistories } from '../dolt/history';
import { readComments, readDependencies, readHead, readIssue, readIssueSummaries, readLabels } from '../dolt/reader';
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

export interface ProjectService {
  /** Rescanne les racines et renvoie les Projets (lisibles ou non) et les dossiers ignorés. */
  list(): Promise<ProjectsResponse>;
  issues(projectId: string): Promise<Issue[]>;
  issue(projectId: string, issueId: string): Promise<IssueDetail>;
  /** Historique complet des tickets, pour `analyzeFlow`. */
  histories(projectId: string): Promise<TicketHistory[]>;
  /** Hash du dernier commit Dolt du Projet : change à chaque commit, donc clé d'invalidation des calculs. */
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

  /** Le dernier scan s'il a moins de `maxAgeMs` ou s'il est encore en cours (tous les appelants le partagent). */
  function discover(maxAgeMs: number): Promise<Discovery> {
    if (!latest || (latest.settled && Date.now() - latest.at > maxAgeMs)) {
      const scan = { at: Date.now(), settled: false, discovery: discoverProjects(config, { dolt }) };
      latest = scan;
      scan.discovery.then(
        () => {
          scan.settled = true;
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
   * La base du Projet ; rescanne si le Projet est inconnu ou illisible (ajouté ou réparé depuis), au plus une fois
   * par `rescanIntervalMs` : le scan qui vient d'avoir lieu fait foi. `lookupMaxAgeMs` : l'âge au-delà duquel le scan
   * précédent n'est plus cru pour un Projet qu'il connaît et dit lisible.
   */
  async function open(projectId: string, lookupMaxAgeMs = LOOKUP_MAX_AGE_MS): Promise<DoltDatabase> {
    const find = async (maxAgeMs: number) => (await discover(maxAgeMs)).projects.find((p) => p.id === projectId);
    let project = await find(lookupMaxAgeMs);
    if (project?.status !== 'ok') project = await find(rescanIntervalMs);
    if (!project) throw new ProjectNotFoundError(projectId);
    if (project.status !== 'ok' || !project.databasePath) {
      throw new ProjectUnreadableError(projectId, project.reason ?? 'Base Dolt introuvable.');
    }
    return dolt.open(project.databasePath);
  }

  /** Une base qui échoue à répondre rend le Projet illisible, avec le message de dolt pour raison. */
  async function read<T>(projectId: string, task: (db: DoltDatabase) => Promise<T>, lookupMaxAgeMs?: number): Promise<T> {
    const db = await open(projectId, lookupMaxAgeMs);
    try {
      return await task(db);
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

    issues: (projectId) =>
      read(projectId, async (db) => {
        const [summaries, dependencies] = await Promise.all([readIssueSummaries(db), readDependencies(db)]);
        return buildIssues(summaries, dependencies);
      }),

    issue: (projectId, issueId) =>
      read(projectId, async (db) => {
        // Aucun ticket n'a d'octet nul dans son identifiant, et dolt ne pourrait pas recevoir la requête : inutile de l'envoyer.
        if (issueId.includes('\0')) throw new IssueNotFoundError(projectId, issueId);
        const [record, summaries, dependencies, labels, comments] = await Promise.all([
          readIssue(db, issueId),
          readIssueSummaries(db),
          readDependencies(db),
          readLabels(db, issueId),
          readComments(db, issueId),
        ]);
        const all = buildIssues(summaries, dependencies);
        const issue = record && all.find((i) => i.id === record.id);
        if (!record || !issue) throw new IssueNotFoundError(projectId, issueId);
        return buildIssueDetail(issue, record, dependencies, labels, comments, new Map(all.map((i) => [i.id, i])));
      }),

    histories: (projectId) => read(projectId, readTicketHistories),

    // Le sondage du direct (bdesk-38k.8) lit le HEAD de chaque Projet suivi toutes les quelques secondes : un Projet que le
    // dernier scan connaît et dit lisible n'est pas redécouvert à cause de l'âge du scan (ce serait un processus dolt par
    // Projet, tous les Projets lus pour sonder un seul). Un Projet inconnu ou illisible est cherché comme pour toute lecture.
    head: (projectId) => read(projectId, readHead, Number.POSITIVE_INFINITY),
  };
}

/** Le Projet tel que l'API l'expose : sans l'emplacement interne de la base. */
function toPublic(project: DiscoveredProject): Project {
  const { id, name, path, prefix, mode, status, reason } = project;
  return reason === undefined ? { id, name, path, prefix, mode, status } : { id, name, path, prefix, mode, status, reason };
}
