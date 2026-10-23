import type { CSSProperties } from 'react';
import type { Project } from '../data/types';
import { cx } from '../lib/cx';

/** Teinte stable (0–359) tirée d'une chaîne : un Projet garde la même pastille d'une session à l'autre. */
export function projectHue(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/** Deux lettres : initiales des deux premiers mots (`My-Prompt-Manager` donne MP), sinon les deux premières lettres. */
export function projectMonogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const [first = '?', second] = words;
  const letters = second ? (first[0] ?? '') + (second[0] ?? '') : first.slice(0, 2);
  return letters.toUpperCase();
}

/** Pastille d'un Projet ; grisée quand il est illisible. */
export function ProjectTile({
  project,
  size = 18,
  className,
}: {
  project: Pick<Project, 'name' | 'prefix' | 'status'>;
  size?: number;
  className?: string;
}) {
  const unreadable = project.status !== 'ok';
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.46),
    '--h': projectHue(project.prefix || project.name),
  } as CSSProperties;
  return (
    <span
      aria-hidden="true"
      style={style}
      className={cx(
        'inline-flex shrink-0 items-center justify-center rounded-[5px] font-semibold leading-none tracking-normal',
        unreadable ? 'bg-press text-ink-2' : 'project-tile',
        className,
      )}
    >
      {projectMonogram(project.name)}
    </span>
  );
}
