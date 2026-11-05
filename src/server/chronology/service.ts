import { analyzeChronologies, chronologyFromDates, type ProjectChronologies } from '../../domain/chronology';
import type { IssueChronology } from '../../shared/api';
import { ReadAborted } from '../abort';
import { ANALYSIS_GRACE_MS, Flight } from '../flight';
import { createHeadReader } from '../projects/head-reader';
import { IssueNotFoundError, type ProjectService, type ReadOptions } from '../projects/service';

export interface ChronologyServiceOptions {
  /**
   * Délai de grâce de l'analyse de l'historique (défaut : `ANALYSIS_GRACE_MS`) : quand son dernier demandeur part, elle n'est abandonnée
   * que si personne ne la redemande dans ce délai. Le parcours rapide des tickets abandonne chaque requête juste avant la suivante.
   */
  graceMs?: number;
}

export interface ChronologyService {
  /**
   * La chronologie du ticket. Un ticket qui n'est pas dans le Projet lève `IssueNotFoundError` ; un Projet inconnu ou
   * illisible lève `ProjectNotFoundError` ou `ProjectUnreadableError`, comme toute lecture du Projet. Un demandeur qui part
   * (`options.signal`) est libéré aussitôt (`ReadAborted`) ; la lecture du HEAD qu'il attendait, encore en file, en sort aussitôt si personne d'autre
   * ne l'attend (bdesk-38k.42) ; celle de l'historique n'est abandonnée que si personne d'autre ne l'attend, et seulement après le délai de grâce
   * (un processus déjà lancé va au bout, son résultat est jeté).
   */
  chronology(projectId: string, issueId: string, options?: ReadOptions): Promise<IssueChronology>;
}

/**
 * Calcul à la demande, avec cache : lire l'historique Dolt d'un Projet (un processus `dolt` par requête, des secondes à
 * froid) coûte bien plus que lire un ticket, et ne dépend que du dernier commit. Clé : Projet + hash du HEAD Dolt, relu à
 * chaque demande (une seule requête légère, mais jamais en parallèle : voir `createHeadReader`). HEAD est lu avant l'historique :
 * le cache peut retarder sur la base, jamais la devancer. La chronologie d'un ticket, elle, se construit à la demande dans
 * l'analyse du Projet.
 */
export function createChronologyService(projects: ProjectService, { graceMs = ANALYSIS_GRACE_MS }: ChronologyServiceOptions = {}): ChronologyService {
  /**
   * Une analyse par Projet : celle du HEAD le plus récent vu. La lecture sert aussi les demandes simultanées, qui l'attendent
   * ensemble : elle n'est abandonnée que quand la dernière part, après le délai de grâce (voir `Flight`), et une lecture abandonnée
   * n'est pas gardée.
   */
  const cache = new Map<string, { head: string; analysis: Flight<ProjectChronologies> }>();

  /**
   * HEAD du Projet, lu à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : une lecture est un
   * processus dolt, et trente demandes ensemble n'ont pas à y mettre trente lectures (voir `createHeadReader`).
   */
  const readHead = createHeadReader(projects);

  async function analysisOf(projectId: string, signal: AbortSignal | undefined): Promise<ProjectChronologies> {
    const head = await readHead(projectId, signal);
    const cached = cache.get(projectId);
    if (cached?.head === head && !cached.analysis.abandoned) return cached.analysis.join(signal);
    if (signal?.aborted) throw new ReadAborted(); // parti pendant la lecture du HEAD : inutile de lire l'historique pour personne
    const entry = {
      head,
      analysis: new Flight((flightSignal) => projects.histories(projectId, { signal: flightSignal }).then(analyzeChronologies), { graceMs }),
    };
    cache.set(projectId, entry);
    entry.analysis.start();
    entry.analysis.done.catch(() => {
      if (cache.get(projectId) === entry) cache.delete(projectId); // un échec n'est pas un résultat, ni une lecture abandonnée
    });
    return entry.analysis.join(signal);
  }

  return {
    async chronology(projectId, issueId, { signal } = {}) {
      const known = (await analysisOf(projectId, signal)).of(issueId);
      if (known) return known;
      // Aucun statut dans l'historique : un ticket que Dolt n'a jamais commité, ou qui n'existe pas. Dans le premier cas ses dates font le repli.
      const issue = (await projects.issues(projectId, { signal })).find((candidate) => candidate.id === issueId);
      if (!issue) throw new IssueNotFoundError(projectId, issueId);
      return chronologyFromDates({
        createdAt: new Date(issue.createdAt),
        // La date de clôture d'un ticket rouvert peut subsister : elle ne vaut que pour un ticket fermé.
        closedAt: issue.status === 'closed' && issue.closedAt ? new Date(issue.closedAt) : null,
      });
    },
  };
}
