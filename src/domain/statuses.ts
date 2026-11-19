/**
 * Les statuts personnalisés qu'un Projet déclare (ADR 0007), et la règle qui les range : les Statuts de relais d'un côté, reconnus par leur
 * nom exact, les autres statuts personnalisés de l'autre, avec leur catégorie. Le lecteur (`parseCustomStatuses`, `src/server/dolt/reader.ts`)
 * dit ce qu'une déclaration écrit ; `declareStatuses` dit ce qu'elle déclare.
 *
 * Rien ne s'en sert encore pour ranger un ticket : le kanban reçoit ces statuts avec ses tickets (`IssuesResponse.declaredStatuses`), mais
 * `columnFor` (`columns.ts`) et `isWork` (`flow.ts`) ne les connaissent pas. bdesk-pz0.3 les y branchera : un Statut de relais compte comme
 * statut de travail, un autre statut personnalisé de catégorie `wip` comme en cours, les autres restent « En pause ».
 */
import type { CustomStatus, DeclaredStatuses, HandoffStatus, StatusCategory } from '../shared/api';

/**
 * Les Statuts de relais (CONTEXT.md) : En relecture, En intégration, À valider. Leurs noms sont un contrat, les mêmes dans tous les Projets.
 * Leur ordre est celui où un ticket les traverse d'habitude, et celui où on les rend ; il n'impose rien au ticket.
 */
export const HANDOFF_STATUSES = ['in_review', 'in_integration', 'awaiting_human'] as const satisfies readonly HandoffStatus[];

/** Les catégories qu'un Projet peut donner à un statut personnalisé. */
export const STATUS_CATEGORIES = ['active', 'wip', 'done', 'frozen'] as const satisfies readonly StatusCategory[];

/** Les statuts de base de l'outil de tickets, qui refuse d'en déclarer un sous ce nom : ils ne sont jamais personnalisés. */
const BUILT_IN_STATUSES: readonly string[] = ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked'];

const isHandoffStatus = (name: string): name is HandoffStatus => (HANDOFF_STATUSES as readonly string[]).includes(name);

/**
 * Ce que déclare une suite de statuts personnalisés, dans l'ordre où le Projet les écrit. Un Statut de relais l'est par son nom exact,
 * quelle que soit sa catégorie : c'est le nom que l'app reconnaît (ADR 0007), et une autre casse est un autre statut, celui que porteraient
 * alors les tickets. Un statut déclaré deux fois ne compte qu'une, à sa première déclaration ; un statut de base n'est pas un statut
 * personnalisé, et le déclarer ne change rien à ce qu'il est.
 */
export function declareStatuses(declared: readonly CustomStatus[]): DeclaredStatuses {
  const seen = new Set<string>();
  const others: CustomStatus[] = [];
  for (const { name, category } of declared) {
    if (seen.has(name)) continue;
    seen.add(name);
    if (!isHandoffStatus(name) && !BUILT_IN_STATUSES.includes(name)) others.push({ name, category });
  }
  return { handoff: HANDOFF_STATUSES.filter((name) => seen.has(name)), others };
}
