import { type PeriodSpec, resolvePeriod } from '../../domain/calendar';
import { computeHealth } from '../../domain/health';
import { analyzeProject, computeMetrics, type MetricsInput, type ProjectAnalysis } from '../../domain/metrics';
import type { MetricsResponse, MetricsUnreadableProject, Project } from '../../shared/api';
import { ProjectNotFoundError, type ProjectService, ProjectUnreadableError } from '../projects/service';

export interface MetricsQuery {
  /** Identifiants des Projets à mesurer ; vide pour la Vue globale (tous les Projets lisibles). */
  projects: string[];
  period: PeriodSpec;
}

export interface MetricsService {
  /**
   * Les métriques des Projets demandés. Un Projet que la liste des Projets ne connaît pas lève `ProjectNotFoundError`,
   * une période invalide `InvalidPeriodError` ; un Projet illisible, ou qui disparaît entre la liste et sa lecture, est
   * listé dans la réponse sans faire échouer le reste.
   */
  compute(query: MetricsQuery): Promise<MetricsResponse>;
}

export interface MetricsServiceOptions {
  /** L'heure, pour les tests (défaut : l'horloge du système). */
  now?: () => Date;
  /** Fuseau IANA qui découpe les jours (défaut : le fuseau local du serveur, celui de l'utilisateur). */
  timeZone?: string;
}

/**
 * Calcul à la demande, avec cache : l'analyse d'un Projet (historique, Livraisons, Bugs d'origine, Blocage) est lourde
 * et ne dépend que de son historique, donc d'un commit Dolt à l'autre. Clé : Projet + hash du HEAD Dolt, relu à chaque
 * requête (une seule requête légère par Projet). L'agrégation sur la période, elle, se refait à chaque fois : bon
 * marché, et elle dépend de l'heure (jour en cours, WIP actuel, âge des tickets), que le cache ne doit pas figer.
 */
export function createMetricsService(
  projects: ProjectService,
  { now = () => new Date(), timeZone = localTimeZone() }: MetricsServiceOptions = {},
): MetricsService {
  /** Une analyse par Projet : celle du HEAD le plus récent vu. La promesse sert aussi les requêtes simultanées. */
  const cache = new Map<string, { head: string; analysis: Promise<ProjectAnalysis> }>();

  async function analyze(projectId: string): Promise<ProjectAnalysis> {
    const [issues, histories] = await Promise.all([projects.issues(projectId), projects.histories(projectId)]);
    const current = new Map(issues.map((issue) => [issue.id, issue]));
    return analyzeProject(
      histories.flatMap((history) => {
        const issue = current.get(history.id);
        return issue ? [{ ...history, title: issue.title, priority: issue.priority }] : [];
      }),
    );
  }

  /**
   * HEAD du Projet, lu à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : un processus dolt
   * par demande saturerait vite la file des lectures quand des requêtes arrivent ensemble. Une demande qui arrive
   * pendant une lecture ne s'y raccroche pas, car cette lecture a pu précéder un commit tout récent ; elle attend la
   * suivante, que partagent toutes les demandes arrivées entre-temps. Chaque demande est ainsi servie par une
   * lecture lancée après son arrivée, et il n'y a jamais plus de deux lectures par Projet, une en cours et une en attente.
   */
  const headReads = new Map<string, { running: Promise<string>; waiting?: Promise<string> }>();

  function readHead(projectId: string): Promise<string> {
    const read = headReads.get(projectId);
    if (!read) return startHeadRead(projectId);
    read.waiting ??= read.running.then(
      () => startHeadRead(projectId),
      () => startHeadRead(projectId), // l'échec d'une lecture ne condamne pas celles qui attendaient la suivante
    );
    return read.waiting;
  }

  function startHeadRead(projectId: string): Promise<string> {
    const read = { running: projects.head(projectId) };
    headReads.set(projectId, read);
    const finished = () => {
      if (headReads.get(projectId) === read) headReads.delete(projectId);
    };
    read.running.then(finished, finished);
    return read.running;
  }

  /** L'analyse du Projet à son HEAD actuel : relue seulement si HEAD a changé depuis la dernière. */
  async function analysisOf(projectId: string): Promise<ProjectAnalysis> {
    const head = await readHead(projectId); // avant toute lecture : le cache ne peut être qu'en retard sur la base, jamais en avance
    const cached = cache.get(projectId);
    if (cached?.head === head) return cached.analysis;
    const entry = { head, analysis: analyze(projectId) };
    cache.set(projectId, entry);
    entry.analysis.catch(() => {
      if (cache.get(projectId) === entry) cache.delete(projectId); // un échec n'est pas un résultat
    });
    return entry.analysis;
  }

  return {
    async compute({ projects: ids, period }) {
      const at = now();
      resolvePeriod(period, at.getTime(), timeZone); // une période invalide échoue avant de lancer le moindre processus dolt

      const { projects: known } = await projects.list();
      for (const id of cache.keys()) if (!known.some((project) => project.id === id)) cache.delete(id);
      for (const id of ids) if (!known.some((project) => project.id === id)) throw new ProjectNotFoundError(id);
      const selected = ids.length === 0 ? known : known.filter((project) => ids.includes(project.id));

      const unreadable: MetricsUnreadableProject[] = [];
      const measured: MetricsInput[] = [];
      await Promise.all(
        selected.map(async (project) => {
          if (project.status !== 'ok') return void unreadable.push(unreadableProject(project, project.reason));
          try {
            measured.push({ id: project.id, name: project.name, analysis: await analysisOf(project.id) });
          } catch (err) {
            // La liste le connaissait il y a un instant : s'il n'est plus là à la lecture, il a disparu entre-temps (dossier
            // supprimé, déplacé, masqué). Ce n'est pas un identifiant inconnu (404), mais un Projet qu'on ne peut plus lire.
            if (err instanceof ProjectNotFoundError) return void unreadable.push(unreadableProject(project, VANISHED));
            if (!(err instanceof ProjectUnreadableError)) throw err;
            unreadable.push(unreadableProject(project, err.reason));
          }
        }),
      );
      // Les lectures aboutissent dans le désordre : on remet les Projets dans l'ordre de la liste.
      const byList = (a: { id: string }, b: { id: string }) => position(known, a.id) - position(known, b.id);
      measured.sort(byList);
      unreadable.sort(byList);

      return {
        generatedAt: at.toISOString(),
        timeZone,
        projects: measured.map(({ id, name }) => ({ id, name })),
        unreadable,
        ...computeMetrics(measured, { period, now: at, timeZone }),
        health: computeHealth(measured, { period, now: at, timeZone }),
      };
    },
  };
}

const VANISHED = 'Projet disparu pendant le calcul (dossier supprimé, déplacé ou masqué).';

const position = (known: Project[], id: string) => known.findIndex((project) => project.id === id);

const unreadableProject = (project: Project, reason: string | undefined): MetricsUnreadableProject => ({
  id: project.id,
  name: project.name,
  reason: reason ?? 'Projet illisible.',
});

const localTimeZone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
