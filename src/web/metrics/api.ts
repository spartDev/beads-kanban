import { notifyManager, queryOptions, type Query, type QueryClient, useQuery, useQueryClient } from '@tanstack/react-query';
import { useCallback, useSyncExternalStore } from 'react';
import type { MetricsProject, MetricsResponse, MetricsUnreadableProject } from '../../shared/api';
import { apiGet } from '../data/client';
import { withProjectLabels, withProjectNames } from '../data/projectNames';
import type { Written } from '../data/types';
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

/** Ce que le serveur a dit d'un fuseau, avec le rang où la page l'a vu (voir `lastZoneAnswer`). */
interface Remembered {
  rank: number;
  answer: ZoneAnswer;
}

/**
 * Ce qu'un cache a appris du serveur : par fuseau demandé, la dernière réponse vue. Un `WeakMap` par client (`retentionOf`) : elle disparaît avec le cache, et deux caches n'en partagent aucune.
 * Elle ne vit pas pour toujours : ce que le serveur dit de son fuseau ne vaut que tant qu'il n'a pas pu changer, et un serveur ne change de fuseau qu'en redémarrant, ce que la page ne voit pas
 * (voir `FORGET_AFTER_MS`).
 */
interface Retention {
  zones: Map<string, Remembered>;
  /** Combien de vues la lisent (`useZoneAnswer`). À zéro, elle part au bout de `FORGET_AFTER_MS`. */
  readers: number;
  forgetting: ReturnType<typeof setTimeout> | undefined;
}

const retentions = new WeakMap<QueryClient, Retention>();

function retentionOf(client: QueryClient): Retention {
  let retention = retentions.get(client);
  if (retention === undefined) {
    retention = { zones: new Map(), readers: 0, forgetting: undefined };
    retentions.set(client, retention);
  }
  return retention;
}

/**
 * Combien de temps la retenue survit à la dernière vue qui la lit : cinq minutes, le `gcTime` par défaut de TanStack Query. C'est la règle des requêtes (une requête reste tant qu'une vue
 * l'observe, puis cinq minutes) appliquée à ce que la page en a retiré : tant qu'une page de métriques est ouverte, l'avis tient même si sa requête échoue des heures (bdesk-38k.79) ; une page
 * qu'on a quittée depuis plus longtemps ne sait plus rien du serveur, comme à l'ouverture. Le flux en direct, lui, ne suit ni la Vue globale ni les pages de métriques : il ne dirait rien d'un
 * redémarrage du serveur là où l'avis se lit, et lui faire suivre les métriques ferait sonder la base d'un Projet pour rien.
 */
const FORGET_AFTER_MS = 5 * 60_000;

/** Une vue de plus lit la retenue de ce cache ; rend de quoi dire qu'elle ne la lit plus. */
function startReading(client: QueryClient): () => void {
  const retention = retentionOf(client);
  retention.readers += 1;
  clearTimeout(retention.forgetting);
  retention.forgetting = undefined;
  let reading = true;
  return () => {
    if (!reading) return;
    reading = false;
    retention.readers -= 1;
    if (retention.readers > 0) return;
    retention.forgetting = setTimeout(() => {
      retention.zones.clear();
      retention.forgetting = undefined;
    }, FORGET_AFTER_MS);
  };
}

/** Le rang où la page a vu les données d'une requête, et l'état de ces données à ce moment-là (`dataUpdateCount` : une relecture qui dit la même chose en est une aussi). */
const sightings = new WeakMap<Query, { data: unknown; updates: number; rank: number }>();
let lastRank = 0;

/**
 * La dernière réponse du serveur au fuseau `timeZone` que la page lui demandait. Chaque réponse de métriques dit dans quel fuseau elle a été comptée et si c'est celui qu'on demandait, et
 * le serveur le dit de la même façon à tous, quels que soient le Projet et la période : celle d'un autre Projet, de la Vue globale ou de la période précédente vaut donc autant que celle
 * qu'on attend. Elle se lit dans le cache des requêtes, qui survit à la vue (de la page d'un Projet à la Vue globale, la page sait déjà), et dans ce qu'elle a retenu elle-même : le cache
 * retire une requête cinq minutes après que plus aucune vue ne l'observe (`gcTime`), et une page dont la requête échoue plus longtemps lit l'avis dans la réponse d'une autre, déjà
 * partie (bdesk-38k.79). La retenue a sa durée de vie (`FORGET_AFTER_MS`). Les réponses à un autre fuseau demandé ne comptent pas : le fuseau est le quatrième élément de la clé
 * (`metricsKey`), et un navigateur qui a changé de fuseau n'hérite pas de la réponse du précédent. Elle rend le même objet tant que le serveur ne dit rien de nouveau, pour que la vue
 * qui la lit (`useZoneAnswer`) ne se redessine pas sans raison.
 *
 * La plus récente l'emporte (un serveur mis à jour entre-temps connaît le fuseau), et « plus récente » n'est pas une date. `dataUpdatedAt` est `Date.now()` : une correction d'horloge
 * (NTP, réglage manuel, machine virtuelle reprise) la fait reculer, et comparer des dates faisait alors ignorer toute réponse pendant l'écart, celle de la requête qu'on affiche comprise
 * (relecture de bdesk-38k.79, B1). Chaque réponse prend le rang où la page la voit la première fois (`sightings`), un compteur qui ne lit aucune horloge, et la plus haute l'emporte, la
 * retenue comprise. La page est abonnée au cache (`useZoneAnswer`) : elle voit les réponses dans l'ordre où elles arrivent. Une requête dont les données changent est vue de nouveau
 * (`dataUpdateCount`, même quand la relecture dit la même chose : c'est une réponse de plus). « La requête dont les données ont changé l'emporte toujours » ne réglerait que la requête
 * relue, pas une autre qui répondrait après le recul. Des réponses vues d'un coup (une vue qui s'ouvre sur un cache déjà rempli, des réponses semées par un test) n'ont pas d'ordre
 * d'arrivée : elles prennent leurs rangs par date, puis par l'ordre du cache, celui de la création des requêtes (une requête relue garde sa place), donc à date égale la requête créée en
 * dernier l'emporte.
 */
export function lastZoneAnswer(client: QueryClient, timeZone: string): ZoneAnswer | undefined {
  const { zones } = retentionOf(client);
  const seen: Array<{ rank: number; response: MetricsResponse }> = [];
  const fresh: Array<Query> = [];
  for (const query of client.getQueryCache().findAll({ queryKey: ['metrics'] })) {
    const data = query.state.data as MetricsResponse | undefined;
    if (data === undefined || query.queryKey[3] !== timeZone) continue;
    const sighting = sightings.get(query);
    if (sighting !== undefined && sighting.data === data && sighting.updates === query.state.dataUpdateCount) seen.push({ rank: sighting.rank, response: data });
    else fresh.push(query);
  }
  fresh.sort((a, b) => a.state.dataUpdatedAt - b.state.dataUpdatedAt);
  for (const query of fresh) {
    const data = query.state.data as MetricsResponse;
    const rank = ++lastRank;
    sightings.set(query, { data, updates: query.state.dataUpdateCount, rank });
    seen.push({ rank, response: data });
  }
  const [latest] = seen.sort((a, b) => b.rank - a.rank);
  const known = zones.get(timeZone);
  if (latest === undefined || (known !== undefined && latest.rank <= known.rank)) return known?.answer;
  const { timeZone: counted, timeZoneHonoured: honoured } = latest.response;
  const answer = known?.answer.counted === counted && known.answer.honoured === honoured ? known.answer : { counted, honoured };
  zones.set(timeZone, { rank: latest.rank, answer });
  return answer;
}

/**
 * `lastZoneAnswer` du cache de l'application, pour la vue qui l'affiche : elle se redessine quand ce que le serveur a dit change. C'est un abonnement au cache des requêtes, comme
 * `useIsFetching` (les notifications passent par `notifyManager`, qui les groupe), et non à la requête qui porte la réponse : un observateur retiendrait aussi la lecture en cours de
 * cette requête, que TanStack Query n'annule que lorsque son dernier observateur part. La relecture d'une période que l'on quitte aussitôt continuerait, et le serveur la calculerait
 * pour personne. Que la réponse survive à sa requête, `lastZoneAnswer` s'en charge. Les vues abonnées sont comptées : la retenue vit tant que l'une d'elles est là, puis `FORGET_AFTER_MS`.
 */
export function useZoneAnswer(timeZone: string): ZoneAnswer | undefined {
  const client = useQueryClient();
  const cache = client.getQueryCache();
  const subscribe = useCallback(
    (onChange: () => void) => {
      const stopReading = startReading(client);
      const unsubscribe = cache.subscribe(notifyManager.batchCalls(onChange));
      return () => {
        unsubscribe();
        stopReading();
      };
    },
    [client, cache],
  );
  return useSyncExternalStore(subscribe, () => lastZoneAnswer(client, timeZone));
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

/** `GET /api/metrics` tel que l'interface le lit : ses Projets, mesurés et illisibles, sous leur nom écrit (`namedMetrics`). */
export type NamedMetricsResponse = Omit<MetricsResponse, 'projects' | 'unreadable'> & {
  projects: Written<MetricsProject>[];
  unreadable: Written<MetricsUnreadableProject>[];
};

/**
 * La réponse, son Projet partout où elle le nomme sous son nom écrit : « Sans titre » pour un dossier dont on ne verrait pas le nom (voir `data/projectNames`). Le serveur le nomme à trois
 * endroits : les Projets mesurés (`projects`), ceux qui ne se lisent pas (`unreadable`) et le libellé de chaque ligne du découpage par Projet (`slices.project`), que le tableau des métriques par
 * Projet écrit dans le lien de sa ligne. La même réponse quand aucun nom ne change. Les Projets mesurés et illisibles dont le nom a été remplacé portent `unnamed` (bdesk-38k.73) : la couleur du Projet
 * dans les graphiques (`useSeriesContext`) ne se tire pas du mot « Sans titre ».
 */
function namedMetrics(response: MetricsResponse): NamedMetricsResponse {
  const projects = withProjectNames(response.projects);
  const unreadable = withProjectNames(response.unreadable);
  const byProject = withProjectLabels(response.slices.project);
  if (projects === response.projects && unreadable === response.unreadable && byProject === response.slices.project) return response as NamedMetricsResponse;
  return { ...response, projects, unreadable, slices: byProject === response.slices.project ? response.slices : { ...response.slices, project: byProject } };
}

/**
 * Les métriques d'un Projet ou de la Vue globale. Changer de période garde les chiffres précédents à l'écran en attendant
 * les suivants (`isPlaceholderData`), pour que la page ne clignote pas ; changer de Projet ne les garde pas : les
 * chiffres d'un autre Projet sous le titre de celui-ci seraient faux. Changer de fuseau non plus (bdesk-38k.79) : les jours, les semaines
 * et les heures de l'ancien fuseau ne sont pas ceux du nouveau, et l'avis de fuseau (`useZoneAnswer`) ne parle que du fuseau demandé
 * maintenant : ces chiffres-là passeraient à l'écran sans lui. Le squelette tient leur place jusqu'à la réponse.
 */
export function useMetrics(request: MetricsRequest) {
  const scope = request.project ?? '*';
  return useQuery({
    ...metricsQuery(request),
    // La clé dit le Projet (élément 1) et le fuseau (élément 3) : les chiffres précédents ne servent que s'ils sont du même Projet, comptés dans le même fuseau.
    placeholderData: (previous, previousQuery) =>
      previousQuery?.queryKey[1] === scope && previousQuery.queryKey[3] === request.timeZone ? previous : undefined,
    select: namedMetrics,
  });
}
