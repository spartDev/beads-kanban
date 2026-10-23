import type { Issue, IssueDetail } from '../../shared/api';
import type { CommentRecord, DependencyRecord, IssueRecord, IssueSummary } from '../dolt/reader';

/**
 * Tickets du Projet au format de l'API. `blockedBy` liste les cibles des dépendances `blocks` qui ne sont pas
 * encore fermées ; un ticket fermé n'est plus bloqué. Une cible hors Projet (référence externe) ne peut pas
 * être évaluée : elle n'y figure pas.
 */
export function buildIssues(summaries: IssueSummary[], dependencies: DependencyRecord[]): Issue[] {
  const statusById = new Map(summaries.map((s) => [s.id, s.status]));
  const parents = new Map<string, string>();
  const blockers = new Map<string, string[]>();

  for (const { from, to, type } of dependencies) {
    const targetStatus = statusById.get(to);
    if (targetStatus === undefined) continue;
    if (type === 'parent-child') {
      // Plusieurs parents : le plus petit identifiant, quel que soit l'ordre dans lequel la base rend les lignes.
      const parent = parents.get(from);
      if (parent === undefined || to < parent) parents.set(from, to);
    } else if (type === 'blocks' && targetStatus !== 'closed') {
      blockers.set(from, [...(blockers.get(from) ?? []), to]);
    }
  }

  return summaries.map((s) => ({
    id: s.id,
    title: s.title,
    type: s.type,
    status: s.status,
    priority: s.priority,
    assignee: s.assignee,
    parentId: parents.get(s.id) ?? null,
    createdAt: s.createdAt.toISOString(),
    updatedAt: s.updatedAt.toISOString(),
    closedAt: s.closedAt?.toISOString() ?? null,
    blockedBy: s.status === 'closed' ? [] : (blockers.get(s.id) ?? []).sort(),
  }));
}

export function buildIssueDetail(
  issue: Issue,
  record: IssueRecord,
  dependencies: DependencyRecord[],
  labels: string[],
  comments: CommentRecord[],
): IssueDetail {
  const byType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  return {
    ...issue,
    description: record.description,
    design: record.design,
    acceptanceCriteria: record.acceptanceCriteria,
    notes: record.notes,
    closeReason: record.closeReason,
    labels,
    dependencies: dependencies
      .filter((d) => d.from === record.id)
      .map(({ to, type }) => ({ to, type }))
      .sort((a, b) => byType(a, b) || a.to.localeCompare(b.to)),
    dependents: dependencies
      .filter((d) => d.to === record.id)
      .map(({ from, type }) => ({ from, type }))
      .sort((a, b) => byType(a, b) || a.from.localeCompare(b.from)),
    comments: comments.map((c) => ({ author: c.author, text: c.text, createdAt: c.createdAt.toISOString() })),
  };
}
