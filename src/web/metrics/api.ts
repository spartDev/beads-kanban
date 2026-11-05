import { queryOptions, useQuery } from '@tanstack/react-query';
import type { MetricsResponse } from '../../shared/api';
import { apiGet } from '../data/client';
import { withProjectLabels, withProjectNames } from '../data/projectNames';
import { metricsPath, periodKey, type PeriodChoice } from './params';

/**
 * Les métriques sont calculées à la demande, pas en direct : une requête à l'ouverture de la page, une autre quand on
 * change de période, et le bouton « Actualiser ». Le serveur ne recalcule que ce qui a changé (son cache est indexé sur
 * le commit Dolt de chaque Projet), donc redemander est bon marché.
 */

export interface MetricsRequest {
  /** Identifiant du Projet ; absent pour la Vue globale (tous les Projets lisibles). */
  project?: string;
  period: PeriodChoice;
  /**
   * Le fuseau IANA dans lequel le serveur compte les jours : celui du navigateur (`browserTimeZone`), dans lequel la page choisit aussi
   * « aujourd'hui ». Une seule source pour les deux : les jours que la page accepte sont ceux que le serveur compte (bdesk-38k.48). S'il ne le
   * connaît pas, il compte dans le sien et la réponse le nomme : la page le dit et compte alors « aujourd'hui » dans celui-là (`MetricsView`).
   */
  timeZone: string;
}

/** Clé de cache : le Projet (`*` pour la Vue globale), la période, puis le fuseau : les chiffres d'un fuseau ne servent pas à un autre. */
export const metricsKey = ({ project, period, timeZone }: MetricsRequest) => ['metrics', project ?? '*', periodKey(period), timeZone] as const;

export function metricsQuery(request: MetricsRequest) {
  return queryOptions({
    queryKey: metricsKey(request),
    queryFn: ({ signal }) => apiGet<MetricsResponse>(metricsPath(request), signal),
    staleTime: 15_000,
    // À la demande, jamais d'elles-mêmes : le client de l'application relance sinon toute requête périmée quand on revient
    // sur l'onglet ou que le réseau revient, soit un calcul de plusieurs secondes dont les chiffres changent sous les yeux.
    refetchOnWindowFocus: false,
    refetchOnReconnect: false,
  });
}

/**
 * La réponse, son Projet partout où elle le nomme sous son nom écrit : « Sans titre » pour un dossier dont on ne verrait pas le nom (voir `data/projectNames`). Le serveur le nomme à trois
 * endroits : les Projets mesurés (`projects`), ceux qui ne se lisent pas (`unreadable`) et le libellé de chaque ligne du découpage par Projet (`slices.project`), que le tableau des métriques par
 * Projet écrit dans le lien de sa ligne. La même réponse quand aucun nom ne change.
 */
function namedMetrics(response: MetricsResponse): MetricsResponse {
  const projects = withProjectNames(response.projects);
  const unreadable = withProjectNames(response.unreadable);
  const byProject = withProjectLabels(response.slices.project);
  if (projects === response.projects && unreadable === response.unreadable && byProject === response.slices.project) return response;
  return { ...response, projects, unreadable, slices: byProject === response.slices.project ? response.slices : { ...response.slices, project: byProject } };
}

/**
 * Les métriques d'un Projet ou de la Vue globale. Changer de période garde les chiffres précédents à l'écran en attendant
 * les suivants (`isPlaceholderData`), pour que la page ne clignote pas ; changer de Projet ne les garde pas : les
 * chiffres d'un autre Projet sous le titre de celui-ci seraient faux.
 */
export function useMetrics(request: MetricsRequest) {
  const scope = request.project ?? '*';
  return useQuery({
    ...metricsQuery(request),
    placeholderData: (previous, previousQuery) => (previousQuery?.queryKey[1] === scope ? previous : undefined),
    select: namedMetrics,
  });
}
