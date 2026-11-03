import { useMemo } from 'react';
import type { MetricsProject } from '../../shared/api';
import type { Project } from '../data/types';
import { projectHue } from '../ui/ProjectTile';
import type { SeriesContext } from './series';

/**
 * De quoi nommer et colorer les Projets d'un graphique. Le nom vient de la réponse des métriques ; la teinte est celle
 * de la pastille du Projet dans la barre latérale, tirée de son préfixe (sans la liste des Projets, de son nom).
 */
export function useSeriesContext(measured: readonly MetricsProject[], known: readonly Project[] | undefined): SeriesContext {
  return useMemo(() => {
    const nameOf = (id: string) => measured.find((project) => project.id === id)?.name ?? known?.find((project) => project.id === id)?.name ?? id;
    return {
      projectName: nameOf,
      projectHue: (id) => {
        const project = known?.find((candidate) => candidate.id === id);
        return projectHue(project?.prefix || project?.name || nameOf(id));
      },
    };
  }, [measured, known]);
}
