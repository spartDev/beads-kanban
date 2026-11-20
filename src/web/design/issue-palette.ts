import { kanban } from '../i18n/catalog/kanban';
import type { Language } from '../i18n/language';

/**
 * Code couleur fixe des tickets : un seul module, partagé par les cartes, les badges et (plus tard)
 * les graphiques. Les valeurs vivent dans styles.css (tokens `--type-*` et `--prio-*`, déclinés en
 * clair et en sombre) ; ici on ne manipule que des références `var(--…)`, qui suivent donc le thème.
 *
 *   <span style={{ color: typeMeta(issue.type).color }} />
 *   <rect fill={priorityMeta(issue.priority).color} />        // SVG : var() fonctionne aussi
 *
 * Pour un contexte qui exige une couleur résolue (canvas), voir `readCssColor`.
 */

export const ISSUE_TYPES = [
  'bug',
  'feature',
  'task',
  'chore',
  'epic',
  'decision',
  'spike',
  'story',
  'milestone',
] as const;

export type IssueType = (typeof ISSUE_TYPES)[number];

export interface TypeMeta {
  /** Valeur beads (`bug`, `epic`…) ; le type inconnu garde sa valeur brute. */
  type: string;
  /** Le nom du type dans la langue demandée (`typeMeta(type, language)`) ; un type personnalisé garde sa valeur brute. */
  label: string;
  /** Nom du token CSS (`--type-bug`). */
  token: string;
  /** Référence CSS prête à l'emploi (`var(--type-bug)`). */
  color: string;
}

const typeEntry = (type: string, label: string): TypeMeta => ({
  type,
  label,
  token: `--type-${type}`,
  color: `var(--type-${type})`,
});

const typeMetaIn = (language: Language): Record<IssueType, TypeMeta> => {
  const labels = kanban[language].types;
  return Object.fromEntries(ISSUE_TYPES.map((type) => [type, typeEntry(type, labels[type])])) as Record<IssueType, TypeMeta>;
};

/** Les types, nommés dans chaque langue (catalogue `kanban.types`). */
const TYPE_META_BY_LANGUAGE: Record<Language, Record<IssueType, TypeMeta>> = { fr: typeMetaIn('fr'), en: typeMetaIn('en') };

/** Les types nommés en français ; `typeMeta(type, language)` pour une autre langue. */
export const TYPE_META: Record<IssueType, TypeMeta> = TYPE_META_BY_LANGUAGE.fr;

export const isIssueType = (value: string): value is IssueType =>
  Object.hasOwn(TYPE_META, value);

/** Métadonnées d'un type, nommé dans `language` ; un type personnalisé de beads reçoit la couleur neutre et garde son nom brut. */
export function typeMeta(type: string, language: Language = 'fr'): TypeMeta {
  return isIssueType(type) ? TYPE_META_BY_LANGUAGE[language][type] : { ...typeEntry('other', type), type };
}

export const PRIORITIES = [0, 1, 2, 3, 4] as const;

export type Priority = (typeof PRIORITIES)[number];

export interface PriorityMeta {
  priority: Priority;
  /** `P0` à `P4`, comme dans la CLI bd. */
  code: string;
  /** Le nom de la priorité dans la langue demandée (`priorityMeta(priority, language)`). */
  label: string;
  token: string;
  color: string;
}

const priorityEntry = (priority: Priority, label: string): PriorityMeta => ({
  priority,
  code: `P${priority}`,
  label,
  token: `--prio-${priority}`,
  color: `var(--prio-${priority})`,
});

const priorityMetaIn = (language: Language): Record<Priority, PriorityMeta> => {
  const labels = kanban[language].priorities;
  return Object.fromEntries(PRIORITIES.map((priority) => [priority, priorityEntry(priority, labels[priority])])) as Record<Priority, PriorityMeta>;
};

/** Les priorités, nommées dans chaque langue (catalogue `kanban.priorities`). */
const PRIORITY_META_BY_LANGUAGE: Record<Language, Record<Priority, PriorityMeta>> = { fr: priorityMetaIn('fr'), en: priorityMetaIn('en') };

/** Les priorités nommées en français ; `priorityMeta(priority, language)` pour une autre langue. */
export const PRIORITY_META: Record<Priority, PriorityMeta> = PRIORITY_META_BY_LANGUAGE.fr;

/** Accepte `1`, `'1'` ou `'P1'` ; renvoie null pour toute autre valeur. */
export function parsePriority(value: unknown): Priority | null {
  const n =
    typeof value === 'number'
      ? value
      : typeof value === 'string'
        ? Number(value.trim().replace(/^p/i, ''))
        : Number.NaN;
  return (PRIORITIES as readonly number[]).includes(n) ? (n as Priority) : null;
}

/** Métadonnées d'une priorité, nommée dans `language` ; une valeur hors 0–4 est ramenée à la plus proche. */
export function priorityMeta(priority: number, language: Language = 'fr'): PriorityMeta {
  const meta = PRIORITY_META_BY_LANGUAGE[language];
  const parsed = parsePriority(priority);
  if (parsed !== null) return meta[parsed];
  return meta[Number.isFinite(priority) && priority < 0 ? 0 : 4];
}

/** Un statut que l'app nomme : un statut de beads ou un Statut de relais, clé du catalogue (qui y ajoute `unknown`, le statut vide). */
type KnownStatus = Exclude<keyof (typeof kanban)['fr']['statuses'], 'unknown'>;

/**
 * Les statuts que beads connaît, et les Statuts de relais, que l'app reconnaît à leur nom dans tous les Projets (ADR 0007) ; le compilateur refuse
 * un statut sans libellé dans le catalogue, comme un libellé sans statut ici.
 */
const KNOWN_STATUSES: Readonly<Record<KnownStatus, true>> = {
  open: true,
  in_progress: true,
  hooked: true,
  in_review: true,
  in_integration: true,
  awaiting_human: true,
  blocked: true,
  deferred: true,
  pinned: true,
  closed: true,
};

/**
 * Libellé d'un statut beads ou d'un Statut de relais dans `language` ; un autre statut personnalisé s'affiche tel quel, un statut vide se dit « inconnu ». Le nom brut ne se
 * cherche pas dans le catalogue au-delà des statuts connus : un statut personnalisé qui s'appellerait `unknown` ou `toString` reste son nom.
 */
export const statusLabel = (status: string, language: Language = 'fr'): string => {
  const labels = kanban[language].statuses;
  if (Object.hasOwn(KNOWN_STATUSES, status)) return labels[status as KnownStatus];
  return status.trim() === '' ? labels.unknown : status;
};

/**
 * Couleur résolue d'un token (`--type-bug`) pour le thème courant, quand `var()` ne peut pas servir
 * (dessin sur canvas). À rappeler au changement de thème.
 */
export function readCssColor(token: string, root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(token).trim();
}
