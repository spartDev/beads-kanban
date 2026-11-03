import { ISSUE_TYPES, priorityMeta, typeMeta } from '../design/issue-palette';
import type { Dimension } from './params';

/**
 * Le découpage choisi (type, priorité, Projet) colore le nuage de points et les âges. Un type ou une priorité garde
 * la couleur que lui donne le code couleur fixe des tickets (design/issue-palette.ts), celle des cartes du kanban et
 * des badges ; un Projet prend la teinte de sa pastille. Les couleurs sont des références `var(--…)` : elles suivent
 * le thème, y compris dans un attribut SVG.
 */

export interface SeriesInfo {
  /** Identifiant dans le découpage : le type, la priorité (`0` à `4`) ou l'identifiant du Projet. */
  key: string;
  label: string;
  color: string;
}

/** Ce qu'il faut savoir des Projets pour les nommer et les colorer. */
export interface SeriesContext {
  projectName: (id: string) => string;
  /** Teinte de 0 à 359 : celle de la pastille du Projet (ui/ProjectTile.tsx). */
  projectHue: (id: string) => number;
}

/** Ce qui range un ticket dans un groupe : son type, sa priorité, son Projet. */
export interface SeriesSubject {
  type: string;
  priority: number;
  project: string;
}

export const DIMENSION_LABELS: Record<Dimension, string> = { type: 'Type', priority: 'Priorité', project: 'Projet' };

/**
 * Couleur d'un Projet : la clarté et la saturation viennent des jetons `--series-l` et `--series-c`, qui changent avec
 * le thème (metrics.css) ; la teinte est celle de sa pastille.
 */
export const projectColor = (hue: number): string => `oklch(var(--series-l) var(--series-c) ${hue})`;

export function seriesOf(dimension: Dimension, subject: SeriesSubject, ctx: SeriesContext): SeriesInfo {
  switch (dimension) {
    case 'type': {
      const meta = typeMeta(subject.type);
      return { key: subject.type, label: meta.label, color: meta.color };
    }
    case 'priority': {
      const meta = priorityMeta(subject.priority);
      return { key: String(meta.priority), label: `${meta.code} · ${meta.label}`, color: meta.color };
    }
    case 'project':
      return { key: subject.project, label: ctx.projectName(subject.project), color: projectColor(ctx.projectHue(subject.project)) };
  }
}

/**
 * Les groupes présents dans les tickets d'un graphique, sans doublon, dans un ordre stable : types dans l'ordre du code
 * couleur puis types personnalisés par ordre alphabétique, priorités de P0 à P4, Projets dans l'ordre de la réponse.
 */
export function legendOf(
  dimension: Dimension,
  subjects: Iterable<SeriesSubject>,
  ctx: SeriesContext,
  projectOrder: readonly string[],
): SeriesInfo[] {
  const entries = new Map<string, SeriesInfo>();
  for (const subject of subjects) {
    const info = seriesOf(dimension, subject, ctx);
    if (!entries.has(info.key)) entries.set(info.key, info);
  }
  return [...entries.values()].sort((a, b) => rank(dimension, a.key, projectOrder) - rank(dimension, b.key, projectOrder) || compare(a.key, b.key));
}

/** Rang d'un groupe dans l'ordre de la légende ; les inconnus passent après les connus. */
function rank(dimension: Dimension, key: string, projectOrder: readonly string[]): number {
  switch (dimension) {
    case 'priority':
      return Number(key);
    case 'type': {
      const index = (ISSUE_TYPES as readonly string[]).indexOf(key);
      return index < 0 ? ISSUE_TYPES.length : index;
    }
    case 'project': {
      const index = projectOrder.indexOf(key);
      return index < 0 ? projectOrder.length : index;
    }
  }
}

/** Ordre des unités de code : le même sur toutes les machines. */
const compare = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);
