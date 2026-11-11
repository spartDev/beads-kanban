import { useMemo } from 'react';
import type { MetricsProject } from '../../shared/api';
import type { Project, Written } from '../data/types';
import { projectHue, projectHueKey } from '../ui/ProjectTile';
import type { SeriesContext } from './series';

/**
 * De quoi nommer et colorer les Projets d'un graphique. Le nom vient de la réponse des métriques ; la teinte est celle
 * de la pastille du Projet dans la barre latérale, tirée de sa clé (`projectHueKey` : son préfixe, sinon son nom, sinon le chemin de son dossier quand il n'a pas de nom qu'on voie).
 * Sans la liste des Projets, qui seule donne le préfixe et le chemin, elle l'est du nom que la réponse des métriques lui donne et, pour un Projet sans nom, de son identifiant : jamais du mot « Sans titre »,
 * qui ferait la même couleur de tous les Projets sans nom.
 */
export function useSeriesContext(measured: readonly Written<MetricsProject>[], known: readonly Project[] | undefined): SeriesContext {
  return useMemo(() => {
    const nameOf = (id: string) => measured.find((project) => project.id === id)?.name ?? known?.find((project) => project.id === id)?.name ?? id;
    return {
      projectName: nameOf,
      projectHue: (id) => {
        const project = known?.find((candidate) => candidate.id === id);
        const unnamed = measured.find((candidate) => candidate.id === id)?.unnamed;
        return projectHue((project && projectHueKey(project)) || (unnamed ? id : nameOf(id)));
      },
    };
  }, [measured, known]);
}
