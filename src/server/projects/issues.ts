import type { Issue, IssueDetail, IssueRef } from '../../shared/api';
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

/**
 * La fiche d'un ticket. `known` donne les tickets du Projet par identifiant (ceux de `buildIssues`) : c'est d'eux que
 * `linked` tire les titres et les statuts des tickets que la fiche nomme.
 */
export function buildIssueDetail(
  issue: Issue,
  record: IssueRecord,
  dependencies: DependencyRecord[],
  labels: string[],
  comments: CommentRecord[],
  known: ReadonlyMap<string, Issue>,
): IssueDetail {
  const byType = (a: { type: string }, b: { type: string }) => a.type.localeCompare(b.type);
  const outgoing = dependencies.filter((d) => d.from === record.id);
  const incoming = dependencies.filter((d) => d.to === record.id);
  const linked: Record<string, IssueRef> = {};
  for (const id of [issue.parentId, ...outgoing.map((d) => d.to), ...incoming.map((d) => d.from)]) {
    const other = id === null || id === record.id ? undefined : known.get(id);
    if (other) linked[other.id] = { id: other.id, title: other.title, type: other.type, status: other.status, priority: other.priority };
  }
  return {
    ...issue,
    description: record.description,
    design: record.design,
    acceptanceCriteria: record.acceptanceCriteria,
    notes: record.notes,
    closeReason: record.closeReason,
    labels,
    dependencies: outgoing.map(({ to, type }) => ({ to, type })).sort((a, b) => byType(a, b) || a.to.localeCompare(b.to)),
    dependents: incoming.map(({ from, type }) => ({ from, type })).sort((a, b) => byType(a, b) || a.from.localeCompare(b.from)),
    linked,
    comments: comments.map((c) => ({ author: c.author, text: c.text, createdAt: c.createdAt.toISOString() })),
  };
}
