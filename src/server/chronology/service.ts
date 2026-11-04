import { analyzeChronologies, chronologyFromDates, type ProjectChronologies } from '../../domain/chronology';
import type { IssueChronology } from '../../shared/api';
import { IssueNotFoundError, type ProjectService } from '../projects/service';

export interface ChronologyService {
  /**
   * La chronologie du ticket. Un ticket qui n'est pas dans le Projet lève `IssueNotFoundError` ; un Projet inconnu ou
   * illisible lève `ProjectNotFoundError` ou `ProjectUnreadableError`, comme toute lecture du Projet.
   */
  chronology(projectId: string, issueId: string): Promise<IssueChronology>;
}

/**
 * Calcul à la demande, avec cache : lire l'historique Dolt d'un Projet (un processus `dolt` par requête, des secondes à
 * froid) coûte bien plus que lire un ticket, et ne dépend que du dernier commit. Clé : Projet + hash du HEAD Dolt, relu à
 * chaque demande (une seule requête légère, mais jamais en parallèle : voir `readHead`). HEAD est lu avant l'historique :
 * le cache peut retarder sur la base, jamais la devancer. La chronologie d'un ticket, elle, se construit à la demande dans
 * l'analyse du Projet.
 */
export function createChronologyService(projects: ProjectService): ChronologyService {
  /** Une analyse par Projet : celle du HEAD le plus récent vu. La promesse sert aussi les demandes simultanées. */
  const cache = new Map<string, { head: string; analysis: Promise<ProjectChronologies> }>();

  /**
   * HEAD du Projet, lu à chaque demande (c'est lui qui invalide le cache) mais jamais en parallèle : une lecture est un
   * processus dolt qui attend son tour dans la file des lectures du serveur, derrière celles des fiches ; trente demandes
   * ensemble n'ont pas à y mettre trente lectures. Une demande qui arrive pendant une lecture ne s'y raccroche pas, car
   * cette lecture a pu précéder un commit tout récent : elle attend la suivante, que partagent toutes les demandes arrivées
   * entre-temps. Chaque demande est ainsi servie par une lecture lancée après son arrivée, et il n'y a jamais plus de deux
   * lectures par Projet, une en cours et une en attente (comme pour les métriques).
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

  async function analysisOf(projectId: string): Promise<ProjectChronologies> {
    const head = await readHead(projectId);
    const cached = cache.get(projectId);
    if (cached?.head === head) return cached.analysis;
    const entry = { head, analysis: projects.histories(projectId).then(analyzeChronologies) };
    cache.set(projectId, entry);
    entry.analysis.catch(() => {
      if (cache.get(projectId) === entry) cache.delete(projectId); // un échec n'est pas un résultat
    });
    return entry.analysis;
  }

  return {
    async chronology(projectId, issueId) {
      const known = (await analysisOf(projectId)).of(issueId);
      if (known) return known;
      // Aucun statut dans l'historique : un ticket que Dolt n'a jamais commité, ou qui n'existe pas. Dans le premier cas ses dates font le repli.
      const issue = (await projects.issues(projectId)).find((candidate) => candidate.id === issueId);
      if (!issue) throw new IssueNotFoundError(projectId, issueId);
      return chronologyFromDates({
        createdAt: new Date(issue.createdAt),
        // La date de clôture d'un ticket rouvert peut subsister : elle ne vaut que pour un ticket fermé.
        closedAt: issue.status === 'closed' && issue.closedAt ? new Date(issue.closedAt) : null,
      });
    },
  };
}
