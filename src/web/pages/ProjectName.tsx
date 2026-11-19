import { useCallback } from 'react';
import { useProjects } from '../data/hooks';
import { projectLabel } from '../data/projectNames';
import { useLanguage } from '../i18n';

/** Un Projet d'une réponse de l'API, tel qu'une ligne de liste le nomme. */
export type NamedProject = { id: string; name: string; unnamed?: true };

/**
 * Nomme les Projets d'une réponse (Signaux, « Depuis votre dernière visite ») comme les phrases les nomment : ceux de la liste des Projets (`namedProjects`, qui
 * dit qui n'a pas de nom qu'on voie), à défaut ceux de la réponse.
 */
export function useProjectNamer(): <T extends { id: string; name: string }>(project: T) => T & { unnamed?: true } {
  const known = useProjects().data?.projects;
  return useCallback(
    <T extends { id: string; name: string }>(project: T): T & { unnamed?: true } => {
      const listed = known?.find((candidate) => candidate.id === project.id);
      return listed ? { ...project, name: listed.name, ...(listed.unnamed ? { unnamed: true as const } : {}) } : project;
    },
    [known],
  );
}

/** Le Projet d'une ligne, comme une liste le nomme : un libellé, que ce qui le qualifie suit. */
export function ProjectName({ id, projects }: { id: string; projects: NamedProject[] }) {
  const project = projects.find((candidate) => candidate.id === id) ?? { id, name: id };
  const { language } = useLanguage();
  return <>{projectLabel(project, projects, language)}</>;
}
