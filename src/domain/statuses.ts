/**
 * Les statuts personnalisés qu'un Projet déclare (ADR 0007), et les règles qui les rangent : les Statuts de relais d'un côté, reconnus par leur
 * nom exact, les autres statuts personnalisés de l'autre, avec leur catégorie. Le lecteur (`parseCustomStatuses`, `src/server/dolt/reader.ts`)
 * dit ce qu'une déclaration écrit ; `declareStatuses` dit ce qu'elle déclare.
 *
 * Un Statut de relais est un statut de travail, qu'il soit déclaré ou non : sa déclaration peut manquer à des tickets qui le portent (voir
 * `CUSTOM_STATUSES_SQL`). Un autre statut personnalisé de catégorie `wip` compte comme en cours (`isDeclaredWip`) ; les autres restent « En pause ».
 * C'est ce qu'appliquent `isWork` (`flow.ts`) et `columnFor` (`columns.ts`). La déclaration fait aussi exister une colonne de relais encore vide
 * (`visibleHandoffStatuses`).
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

/** Un Statut de relais, par son nom exact. */
export const isHandoffStatus = (name: string): name is HandoffStatus => (HANDOFF_STATUSES as readonly string[]).includes(name);

/**
 * Ce que déclare une suite de statuts personnalisés, dans l'ordre où le Projet les écrit. Un Statut de relais l'est par son nom exact,
 * quelle que soit sa catégorie : c'est le nom que l'app reconnaît (ADR 0007). La comparaison exacte suit bd, qui n'écrit que des noms en
 * minuscules (`[a-z][a-z0-9_-]*`) : un `IN_REVIEW`, qu'il refuse, ne peut venir que d'une clé écrite à la main, et n'est pas un Statut de relais.
 * bd refuse aussi les doublons et les statuts de base ; les tolérer ici est un choix de l'app, pour ne jamais casser sur une clé écrite à la
 * main : un statut déclaré deux fois ne compte qu'une, à sa première déclaration, et un statut de base n'est pas un statut personnalisé.
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

/** Ce que déclare un Projet qui ne déclare rien ; aussi ce qu'on suppose d'un historique qui ne dit pas ce que son Projet déclare. */
export const NO_DECLARED_STATUSES: DeclaredStatuses = { handoff: [], others: [] };

/**
 * Un autre statut personnalisé que le Projet déclare de catégorie `wip` : il compte comme en cours (ADR 0007). Ni un Statut de relais (il l'est
 * par son nom, quelle que soit sa catégorie), ni un statut de base (le Projet ne peut pas en changer la catégorie), même dans une déclaration qui
 * n'est pas passée par `declareStatuses`.
 */
export function isDeclaredWip(status: string, declared: DeclaredStatuses): boolean {
  if (isHandoffStatus(status) || BUILT_IN_STATUSES.includes(status)) return false;
  return declared.others.some((custom) => custom.name === status && custom.category === 'wip');
}

/**
 * Les Statuts de relais qui ont leur colonne dans un Projet : ceux qu'il déclare, même qu'aucun ticket ne porte encore, et ceux que porte un de
 * ses tickets, déclarés ou non. Aucun ticket ne se perd : un Statut de relais qu'un ticket porte a toujours sa colonne. Dans l'ordre de
 * `HANDOFF_STATUSES`, quel que soit celui des statuts reçus.
 *
 * `carried` : les statuts que portent les tickets. Le kanban donne ceux du Dernier commit ; le CFD, tous ceux de l'historique (`analyzeProject`).
 */
export function visibleHandoffStatuses(declared: readonly HandoffStatus[], carried: Iterable<string>): HandoffStatus[] {
  const visible = new Set<string>(declared);
  for (const status of carried) if (isHandoffStatus(status)) visible.add(status);
  return HANDOFF_STATUSES.filter((status) => visible.has(status));
}
