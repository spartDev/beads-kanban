import { type PeriodSpec, resolvePeriod } from '../../domain/calendar';
import type { TicketHistory } from '../../domain/flow';
import { driftsOf } from '../../domain/drift';
import { computeHealth } from '../../domain/health';
import { analyzeProject, computeMetrics, type MetricsInput, type ProjectAnalysis } from '../../domain/metrics';
import type { DriftsResponse, MetricsResponse, MetricsUnreadableProject, Project } from '../../shared/api';
import { ReadAborted } from '../abort';
import { ANALYSIS_GRACE_MS, Flight } from '../flight';
import { createHeadReader } from '../projects/head-reader';
import { ProjectNotFoundError, type ProjectService, ProjectUnreadableError, type ReadOptions } from '../projects/service';
import { resolveMetricsTimeZone } from './time-zone';

export interface MetricsQuery {
  /** Identifiants des Projets à mesurer ; vide pour la Vue globale (tous les Projets lisibles). */
  projects: string[];
  period: PeriodSpec;
  /**
   * Le fuseau IANA qui découpe les jours de cette requête : celui du navigateur qui la pose (bdesk-38k.48), pour que « aujourd'hui » soit le
   * même jour pour la page et pour le serveur. Absent, celui du service (`MetricsServiceOptions.timeZone`) : la requête n'en demandait pas, ou
   * demandait un fuseau que ce serveur ne connaît pas (`parseMetricsQuery` l'écarte), et la réponse nomme celui qui a servi et dit qu'elle n'a pas honoré
   * le fuseau demandé (`MetricsResponse.timeZoneHonoured`, bdesk-38k.71). Sous le nom que le moteur lui donne (`canonicalTimeZone`), que `Intl` connaît :
   * le domaine lève une `RangeError` sur un autre.
   */
  timeZone?: string;
}

export interface MetricsService {
  /**
   * Les métriques des Projets demandés. Un Projet que la liste des Projets ne connaît pas lève `ProjectNotFoundError`,
   * une période invalide `InvalidPeriodError` ; un Projet illisible, ou qui disparaît entre la liste et sa lecture, est
   * listé dans la réponse sans faire échouer le reste. Un demandeur qui part (`options.signal`) est libéré aussitôt par une
   * `ReadAborted` ; les lectures qu'il attendait ne sont abandonnées que si personne d'autre ne les attend : celles du HEAD et des tickets
   * aussitôt, celle de l'historique après le délai de grâce (un processus déjà lancé va au bout, son résultat est jeté).
   */
  compute(query: MetricsQuery, options?: ReadOptions): Promise<MetricsResponse>;
  /**
   * Les Dérives d'un Projet à l'instant présent, tirées de la même analyse que les métriques (même cache, par HEAD). Un Projet inconnu lève
   * `ProjectNotFoundError`, un Projet illisible `ProjectUnreadableError`.
   */
  drifts(projectId: string, options?: ReadOptions): Promise<DriftsResponse>;
}

export interface MetricsServiceOptions {
  /** L'heure, pour les tests (défaut : l'horloge du système). */
  now?: () => Date;
  /**
   * Fuseau IANA qui découpe les jours des requêtes qui n'en demandent pas (`MetricsQuery.timeZone` : la page envoie celui du navigateur) ;
   * défaut : le fuseau local du serveur. Un nom que `Intl` ne reconnaît pas (le moteur rend `Etc/Unknown` pour un TZ vide, et rien pour un
   * TZ qu'il ne sait pas nommer) ne fait jamais échouer une requête : le service le remplace dès sa création par le fuseau du système, à
   * défaut par UTC, et le dit à `warn` (voir `resolveMetricsTimeZone`).
   */
  timeZone?: string;
  /** Où lire le fuseau du système quand `timeZone` n'est pas reconnu (défaut : ce que désigne `/etc/localtime`, lien ou chaîne de liens). */
  systemTimeZone?: () => string | undefined;
  /** Où le service dit, une seule fois et à sa création, qu'il a dû remplacer le fuseau (défaut : nulle part). */
  warn?: (message: string) => void;
  /**
   * Délai de grâce de la lecture de l'historique d'un Projet (défaut : `ANALYSIS_GRACE_MS`) : quand son dernier demandeur part, elle
   * n'est abandonnée que si personne ne la redemande dans ce délai. La lecture des tickets, elle, n'en a pas : elle quitte la file aussitôt.
   */
  graceMs?: number;
}

/**
 * Calcul à la demande, avec cache : l'analyse d'un Projet (historique, Livraisons, Bugs d'origine, Blocage) est lourde
 * et ne dépend que de son historique, donc d'un commit Dolt à l'autre. Clé : Projet + hash du HEAD Dolt, relu à chaque
 * requête (une seule requête légère par Projet). L'agrégation sur la période, elle, se refait à chaque fois : bon
 * marché, et elle dépend de l'heure (jour en cours, WIP actuel, âge des tickets), que le cache ne doit pas figer.
 */
export function createMetricsService(
  projects: ProjectService,
  { now = () => new Date(), timeZone: requested = localTimeZone(), systemTimeZone, warn, graceMs = ANALYSIS_GRACE_MS }: MetricsServiceOptions = {},
): MetricsService {
  // Le fuseau se choisit ici, une fois : c'est le seul endroit où le nom d'un fuseau entre dans le calcul des jours, avec ce que le moteur
  // en dit (bdesk-38k.38). Tout ce qui suit, `compute` et la réponse, ne voit qu'un nom que `Intl` construit.
  const { timeZone, warning } = resolveMetricsTimeZone(requested, systemTimeZone);
  if (warning !== undefined) warn?.(warning);

  /**
   * Une analyse par Projet : celle du HEAD le plus récent vu. Elle sert aussi les requêtes simultanées, qui l'attendent ensemble :
   * elle est abandonnée dès que la dernière part (voir `Flight`), et une analyse abandonnée n'est pas gardée.
   */
  const cache = new Map<string, { head: string; analysis: Flight<ProjectAnalysis> }>();

  /**
   * La lecture de l'historique du Projet à son HEAD, que les analyses qui se succèdent se partagent. Elle seule a le délai de grâce :
   * lourde (voie `analysis`), elle est redemandée presque aussitôt par la requête qui suit un abandon. La lecture des tickets (voie
   * `normal`) appartient à l'analyse et part avec son dernier demandeur : retenue pendant le délai, elle serait lue pour personne
   * devant la fiche que l'utilisateur ouvre en quittant la Vue globale (bdesk-38k.33). Une lecture achevée pendant le délai, que
   * personne n'a recueillie, reste là pour la requête qui arrive ensuite ; celle qui échoue ou qu'on abandonne n'est pas gardée, ni
   * celle d'une analyse achevée (son résultat suffit).
   */
  const historyReads = new Map<string, { head: string; read: Flight<TicketHistory[]> }>();

  function historyOf(projectId: string, head: string): Flight<TicketHistory[]> {
    const known = historyReads.get(projectId);
    if (known?.head === head && !known.read.abandoned) return known.read;
    const entry = { head, read: new Flight((flightSignal) => projects.histories(projectId, { signal: flightSignal }), { graceMs }) };
    historyReads.set(projectId, entry);
    entry.read.start();
    entry.read.done.catch(() => {
      if (historyReads.get(projectId) === entry) historyReads.delete(projectId); // un échec n'est pas un résultat, ni une lecture abandonnée
    });
    return entry.read;
  }

  async function analyze(projectId: string, head: string, signal: AbortSignal): Promise<ProjectAnalysis> {
    // Prise ici, dans l'instant où l'analyse est lancée (`Flight.start`) : le délai de grâce de la lecture ne peut pas expirer entre-temps.
    // Et l'analyse ne la retient pas : sa fonction de lancement, que le cache garde, ne cite que le Projet et le HEAD.
    const history = historyOf(projectId, head);
    const [issues, rows] = await Promise.all([projects.issues(projectId, { signal }), history.join(signal)]);
    if (historyReads.get(projectId)?.read === history) historyReads.delete(projectId); // l'historique est recueilli : seul le résultat de l'analyse reste en cache
    const current = new Map(issues.map((issue) => [issue.id, issue]));
    return analyzeProject(
      rows.flatMap((row) => {
        const issue = current.get(row.id);
        return issue ? [{ ...row, title: issue.title, priority: issue.priority }] : [];
      }),
    );
  }

  /**
   * HEAD du Projet, lu à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : un processus dolt
   * par demande saturerait vite la file des lectures quand des requêtes arrivent ensemble (voir `createHeadReader`).
   */
  const readHead = createHeadReader(projects);

  /** L'analyse du Projet à son HEAD actuel : relue seulement si HEAD a changé depuis la dernière. */
  async function analysisOf(projectId: string, signal: AbortSignal | undefined): Promise<ProjectAnalysis> {
    const head = await readHead(projectId, signal); // avant toute lecture : le cache ne peut être qu'en retard sur la base, jamais en avance
    const cached = cache.get(projectId);
    if (cached?.head === head && !cached.analysis.abandoned) return cached.analysis.join(signal);
    if (signal?.aborted) throw new ReadAborted(); // parti pendant la lecture du HEAD : inutile de lire l'historique pour personne
    const entry = { head, analysis: new Flight((flightSignal) => analyze(projectId, head, flightSignal)) };
    cache.set(projectId, entry);
    entry.analysis.start();
    entry.analysis.done.catch(() => {
      if (cache.get(projectId) === entry) cache.delete(projectId); // un échec n'est pas un résultat, ni une analyse abandonnée
    });
    return entry.analysis.join(signal);
  }

  return {
    async drifts(projectId, { signal } = {}) {
      if (signal?.aborted) throw new ReadAborted();
      const analysis = await analysisOf(projectId, signal);
      const at = now();
      const drifts = [...driftsOf(analysis, at.getTime())]
        .map(([id, drift]) => ({ id, ...drift }))
        .sort((a, b) => (a.id < b.id ? -1 : a.id > b.id ? 1 : 0));
      return { generatedAt: at.toISOString(), drifts };
    },
    async compute({ projects: ids, period, timeZone: asked }, { signal } = {}) {
      if (signal?.aborted) throw new ReadAborted();
      const at = now();
      // Les jours se comptent dans le fuseau de la requête, puis dans celui du service : l'analyse d'un Projet, elle, n'en dépend pas (ce sont des
      // instants), et un fuseau de plus ne coûte ni une lecture ni une entrée du cache.
      const zone = asked ?? timeZone;
      resolvePeriod(period, at.getTime(), zone); // une période invalide échoue avant de lancer le moindre processus dolt

      const { projects: known } = await projects.list();
      for (const id of [...cache.keys(), ...historyReads.keys()]) {
        if (!known.some((project) => project.id === id)) {
          cache.delete(id);
          historyReads.delete(id);
        }
      }
      for (const id of ids) if (!known.some((project) => project.id === id)) throw new ProjectNotFoundError(id);
      const selected = ids.length === 0 ? known : known.filter((project) => ids.includes(project.id));

      const unreadable: MetricsUnreadableProject[] = [];
      const measured: MetricsInput[] = [];
      await Promise.all(
        selected.map(async (project) => {
          if (project.status !== 'ok') return void unreadable.push(unreadableProject(project, project.reason));
          try {
            measured.push({ id: project.id, name: project.name, analysis: await analysisOf(project.id, signal) });
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
        timeZone: zone,
        // Honoré : la requête demandait un fuseau, `parseMetricsQuery` ne l'a gardé que s'il est reconnu, et c'est lui qui a servi. Le serveur sait ce qu'il a fait de la demande ; la page
        // n'a pas à le deviner en comparant le nom qu'elle a envoyé à celui de la réponse (bdesk-38k.71).
        timeZoneHonoured: asked !== undefined,
        projects: measured.map(({ id, name }) => ({ id, name })),
        unreadable,
        ...computeMetrics(measured, { period, now: at, timeZone: zone }),
        health: computeHealth(measured, { period, now: at, timeZone: zone }),
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

/** Le fuseau local d'après le moteur. Typé `string`, il vaut `undefined` quand le moteur ne sait pas le nommer : d'où le type ici. */
const localTimeZone = (): string | undefined => Intl.DateTimeFormat().resolvedOptions().timeZone;
