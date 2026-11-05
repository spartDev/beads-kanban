import { abandonOf, type AbandonLink } from '../../domain/abandon';
import type { Issue, IssueDetail, IssueRef } from '../../shared/api';
import type { CommentRecord, DependencyRecord, IssueRecord, IssueSummary } from '../dolt/reader';

/** Un lien dont la ligne ne dit pas quand il a été posé passe avant tous les autres : ceux-là se départagent par leur cible. */
const UNDATED = new Date(0);

/**
 * Tickets du Projet au format de l'API. `blockedBy` liste les cibles des dépendances `blocks` qui ne sont pas
 * encore fermées ; un ticket fermé n'est plus bloqué. Une cible hors Projet (référence externe) ne peut pas
 * être évaluée : elle n'y figure pas.
 *
 * `abandon` marque un ticket fermé que ses liens déclarent doublon d'un autre ticket ou remplacé par lui, sauf une Epic, qui
 * n'est jamais une Livraison et donc pas non plus un Abandon. C'est la règle du domaine (`abandonOf`), celle des métriques :
 * ici sur les liens d'aujourd'hui, datés de leur pose (`createdAt`), quel que soit l'ordre des lignes. Un lien compte même
 * quand sa cible n'est pas un ticket du Projet.
 *
 * L'état présent ne dit rien des commits : le `created_at` de la ligne y fait `addedAt` et départage seul les liens d'un ticket
 * (puis la cible), là où les métriques le lisent après le commit où chaque lien apparaît. Les deux ne divergent que si ces
 * deux ordres diffèrent, dans les cas que `abandonOf` énumère (même seconde, fuseau d'une ancienne version de bd).
 */
export function buildIssues(summaries: IssueSummary[], dependencies: DependencyRecord[]): Issue[] {
  const statusById = new Map(summaries.map((s) => [s.id, s.status]));
  const parents = new Map<string, string>();
  const blockers = new Map<string, string[]>();
  const links = new Map<string, AbandonLink[]>();

  for (const { from, to, type, createdAt } of dependencies) {
    const link = { type, target: to, addedAt: createdAt ?? UNDATED, createdAt };
    const own = links.get(from);
    if (own) own.push(link);
    else links.set(from, [link]);
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

  return summaries.map((s) => {
    const abandon = s.status === 'closed' && s.type !== 'epic' ? abandonOf(links.get(s.id) ?? []) : undefined;
    return {
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
      ...(abandon ? { abandon } : {}),
    };
  });
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
