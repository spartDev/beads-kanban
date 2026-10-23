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

export const TYPE_META: Record<IssueType, TypeMeta> = {
  bug: typeEntry('bug', 'Bug'),
  feature: typeEntry('feature', 'Fonctionnalité'),
  task: typeEntry('task', 'Tâche'),
  chore: typeEntry('chore', 'Maintenance'),
  epic: typeEntry('epic', 'Epic'),
  decision: typeEntry('decision', 'Décision'),
  spike: typeEntry('spike', 'Spike'),
  story: typeEntry('story', 'Story'),
  milestone: typeEntry('milestone', 'Jalon'),
};

export const isIssueType = (value: string): value is IssueType =>
  Object.hasOwn(TYPE_META, value);

/** Métadonnées d'un type ; un type personnalisé de beads reçoit la couleur neutre. */
export function typeMeta(type: string): TypeMeta {
  return isIssueType(type) ? TYPE_META[type] : { ...typeEntry('other', type), type };
}

export const PRIORITIES = [0, 1, 2, 3, 4] as const;

export type Priority = (typeof PRIORITIES)[number];

export interface PriorityMeta {
  priority: Priority;
  /** `P0` à `P4`, comme dans la CLI bd. */
  code: string;
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

export const PRIORITY_META: Record<Priority, PriorityMeta> = {
  0: priorityEntry(0, 'Critique'),
  1: priorityEntry(1, 'Haute'),
  2: priorityEntry(2, 'Moyenne'),
  3: priorityEntry(3, 'Basse'),
  4: priorityEntry(4, 'Minimale'),
};

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

/** Métadonnées d'une priorité ; une valeur hors 0–4 est ramenée à la plus proche. */
export function priorityMeta(priority: number): PriorityMeta {
  const parsed = parsePriority(priority);
  if (parsed !== null) return PRIORITY_META[parsed];
  return PRIORITY_META[Number.isFinite(priority) && priority < 0 ? 0 : 4];
}

const STATUS_LABELS: Record<string, string> = {
  open: 'ouvert',
  in_progress: 'en cours',
  hooked: 'rattaché à un agent',
  blocked: 'statut bloqué',
  deferred: 'reporté',
  pinned: 'épinglé',
  closed: 'fermé',
};

/** Libellé d'un statut beads ; un statut inconnu s'affiche tel quel. */
export const statusLabel = (status: string): string => STATUS_LABELS[status] ?? status;

/**
 * Couleur résolue d'un token (`--type-bug`) pour le thème courant, quand `var()` ne peut pas servir
 * (dessin sur canvas). À rappeler au changement de thème.
 */
export function readCssColor(token: string, root: Element = document.documentElement): string {
  return getComputedStyle(root).getPropertyValue(token).trim();
}
