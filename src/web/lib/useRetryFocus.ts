import type { UseQueryResult } from '@tanstack/react-query';
import { useCallback, useEffect, useRef } from 'react';
import { focusContainer, focusIsAdrift } from './focus';
import { focusTitleWhenReady, zoneOf } from './zoneFocus';

/** Ce que le hook lit d'une requête : la page n'a ni donnée ni erreur le temps du rechargement, puis la donnée arrive ou l'échec revient. */
type Reloadable = Pick<UseQueryResult<unknown>, 'data' | 'isPending' | 'errorUpdateCount' | 'refetch'>;

/**
 * Le « Réessayer » d'une zone dont la requête a échoué : renvoie le rappel à donner à `ErrorNotice` (`onRetry`), qui relance la requête et tient
 * le focus de l'utilisateur jusqu'à l'arrivée du contenu.
 *
 * Le squelette remplace l'avis d'erreur le temps du rechargement : le bouton, qui a le focus, quitte la page, et le focus tomberait sur le corps de
 * la page. L'avis le rend à la zone qui se recharge dès qu'il part, quelle que soit la cause (voir `keepFocusInZone`). Ici, le rappel donne aussi le
 * focus à la zone quand le bouton ne l'a pas pris (un toucher, un lecteur d'écran, Safari), mais seulement si le focus n'est nulle part : le focus qu'un
 * utilisateur a mis ailleurs reste où il est. Et quand le contenu arrive, le titre de la zone prend le focus, ce que le lecteur d'écran lit : après un
 * « Réessayer » seulement. Si la page qui arrive n'a encore que le titre d'un squelette (la porte du Projet ouvre la page d'une Epic, dont les tickets se
 * chargent encore), la zone garde le focus et le titre de l'Epic le prend à son arrivée (`focusTitleWhenReady`). Un nouvel échec laisse le focus à la
 * zone (l'alerte dit déjà l'échec), et si l'utilisateur a mis le focus ailleurs entre-temps, on n'y touche pas. Le réessai se désarme à toute issue :
 * une relecture qui réussirait plus tard, au retour sur l'onglet, n'est pas une demande de l'utilisateur.
 *
 * (`errorUpdateCount` : un échec qui revient aussitôt peut ne jamais dessiner le rechargement, ni `isPending` ni la donnée ne changent alors.)
 */
export function useRetryFocus(query: Reloadable): (event: { currentTarget: Element }) => void {
  const { data, isPending, errorUpdateCount, refetch } = query;
  const arrived = data !== undefined;
  // La zone d'où « Réessayer » a été activé, tant que son issue n'est pas arrivée.
  const asked = useRef<HTMLElement | null>(null);

  useEffect(() => {
    const zone = asked.current;
    if (zone === null || isPending) return undefined;
    asked.current = null;
    // La porte du Projet rend la main à la page de l'Epic, qui charge ses tickets sous un titre de squelette : le titre de l'Epic prend le focus quand il arrive.
    return arrived ? focusTitleWhenReady(zone) : undefined;
  }, [isPending, arrived, errorUpdateCount]);

  return useCallback(
    (event) => {
      const zone = zoneOf(event.currentTarget);
      asked.current = zone;
      if (zone !== null && focusIsAdrift()) focusContainer(zone);
      void refetch();
    },
    [refetch],
  );
}
