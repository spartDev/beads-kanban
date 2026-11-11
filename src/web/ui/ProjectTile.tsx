import type { CSSProperties } from 'react';
import type { Project } from '../data/types';
import { cx } from '../lib/cx';

/** Teinte stable (0–359) tirée d'une chaîne : un Projet garde la même pastille d'une session à l'autre. */
export function projectHue(key: string): number {
  let hash = 0;
  for (const char of key) hash = (hash * 31 + char.charCodeAt(0)) >>> 0;
  return hash % 360;
}

/**
 * Ce dont la teinte d'un Projet est tirée : son préfixe ; sans préfixe, son nom. Un Projet dont le dossier n'a pas de nom qu'on voie (`unnamed`) s'appelle « Sans titre » comme tous les autres : tirée de ce
 * mot, la teinte serait la même pour tous les Projets sans préfixe. Elle l'est alors du chemin de son dossier : il n'appartient qu'à ce Projet, et il ne change pas quand un autre dossier sans nom apparaît
 * (l'identifiant d'URL, `projet`, `projet-2`…, se renumérote alors). La barre latérale et les graphiques (`useSeriesContext`) tirent la même couleur de la même clé.
 */
export function projectHueKey(project: Pick<Project, 'prefix' | 'name' | 'path' | 'unnamed'>): string {
  return project.prefix || (project.unnamed ? project.path : project.name);
}

/** Deux lettres : initiales des deux premiers mots (`My-Prompt-Manager` donne MP), sinon les deux premières lettres. */
export function projectMonogram(name: string): string {
  const words = name.split(/[^\p{L}\p{N}]+/u).filter(Boolean);
  const [first = '?', second] = words;
  const letters = second ? (first[0] ?? '') + (second[0] ?? '') : first.slice(0, 2);
  return letters.toUpperCase();
}

/**
 * Ce qu'une pastille écrit à la place des initiales d'un Projet sans nom : un signe neutre, celui de tout nom sans lettre ni chiffre (`projectMonogram('-')`). Les initiales de « Sans titre », « ST »,
 * feraient de ce Projet un Projet nommé ST.
 */
const UNNAMED_MONOGRAM = '?';

/** Pastille d'un Projet ; grisée quand il est illisible. */
export function ProjectTile({
  project,
  size = 18,
  className,
}: {
  project: Pick<Project, 'name' | 'prefix' | 'status' | 'path' | 'unnamed'>;
  size?: number;
  className?: string;
}) {
  const unreadable = project.status !== 'ok';
  const style = {
    width: size,
    height: size,
    fontSize: Math.round(size * 0.46),
    '--h': projectHue(projectHueKey(project)),
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
      {project.unnamed ? UNNAMED_MONOGRAM : projectMonogram(project.name)}
    </span>
  );
}
