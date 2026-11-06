import { queryOptions, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
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
   * connaît pas, il compte dans le sien, la réponse le nomme et dit qu'elle n'a pas honoré celui-ci (`timeZoneHonoured`) : la page le dit et compte
   * alors « aujourd'hui » dans celui du serveur (`MetricsView`).
   */
  timeZone: string;
}

/** Clé de cache : le Projet (`*` pour la Vue globale), la période, puis le fuseau : les chiffres d'un fuseau ne servent pas à un autre. */
export const metricsKey = ({ project, period, timeZone }: MetricsRequest) => ['metrics', project ?? '*', periodKey(period), timeZone] as const;

/** Ce que le serveur a répondu, la dernière fois, au fuseau que la page lui demandait (voir `lastZoneAnswer`). */
export interface ZoneAnswer {
  /** Le fuseau dans lequel il a compté (`MetricsResponse.timeZone`). */
  counted: string;
  /** Il a compté dans le fuseau demandé (`MetricsResponse.timeZoneHonoured`) ; sinon il ne le connaît pas, et `counted` est le sien. */
  honoured: boolean;
}

/**
 * La dernière réponse du serveur au fuseau `timeZone` que la page lui demandait, lue dans le cache des requêtes : chaque réponse de métriques dit dans quel fuseau elle a
 * été comptée et si c'est celui qu'on demandait, et le serveur le dit de la même façon à tous, quels que soient le Projet et la période. Celle d'un autre Projet, de la
 * Vue globale ou de la période précédente vaut donc autant que celle qu'on attend. Le cache survit à la vue : de la page d'un Projet à la Vue globale, la page sait déjà.
 * La plus récente l'emporte (un serveur mis à jour entre-temps connaît le fuseau) ; à égalité de date, la dernière arrivée dans le cache. Les réponses à un autre fuseau
 * demandé ne comptent pas : le fuseau est le quatrième élément de la clé (`metricsKey`), et un navigateur qui a changé de fuseau n'hérite pas de la réponse du précédent.
 */
export function lastZoneAnswer(client: QueryClient, timeZone: string): ZoneAnswer | undefined {
  let latest: { at: number; answer: ZoneAnswer } | undefined;
  for (const query of client.getQueryCache().findAll({ queryKey: ['metrics'] })) {
    const response = query.state.data as MetricsResponse | undefined;
    if (response === undefined || query.queryKey[3] !== timeZone) continue;
    if (latest === undefined || query.state.dataUpdatedAt >= latest.at) {
      latest = { at: query.state.dataUpdatedAt, answer: { counted: response.timeZone, honoured: response.timeZoneHonoured } };
    }
  }
  return latest?.answer;
}

/**
 * `lastZoneAnswer` du cache de l'application. Lu sans abonnement : la vue qui s'en sert observe déjà sa propre requête, et c'est la réponse de celle-ci qui, la première,
 * change ce que le cache sait de ce fuseau.
 */
export function useZoneAnswer(timeZone: string): ZoneAnswer | undefined {
  return lastZoneAnswer(useQueryClient(), timeZone);
}

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
