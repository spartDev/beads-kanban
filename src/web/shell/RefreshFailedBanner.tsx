import { useQueryClient, type Query } from '@tanstack/react-query';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useSyncExternalStore, type MouseEvent } from 'react';
import { ApiError } from '../data/client';
import { focusTitleOf, keepFocusInZone, zoneOf } from '../lib/zoneFocus';

/**
 * Une page qui affiche elle-même le 404 de sa requête (« Ticket introuvable », voir `HANDLES_NOT_FOUND`) ne montre plus
 * ses données périmées : un ticket supprimé n'est pas un rafraîchissement raté, et le dire deux fois est faux.
 */
const isHandledNotFound = (query: Query): boolean =>
  query.meta?.handlesNotFound === true && query.state.error instanceof ApiError && query.state.error.status === 404;

/**
 * Requête affichée dont le dernier rafraîchissement a échoué : TanStack Query garde ses données et passe à
 * « error ». La page reste à l'écran ; ce bandeau dit seulement que ce qu'elle montre peut être périmé.
 */
const showsStaleData = (query: Query): boolean =>
  query.state.status === 'error' && query.state.data !== undefined && !isHandledNotFound(query);

/**
 * Bandeau discret, sous la barre du haut. Rien (hors la zone d'annonce, vide) tant que tout se rafraîchit bien. `muted` :
 * un autre message explique déjà l'échec (les mises à jour en direct sont interrompues, voir `LiveUpdates`) ; le dire
 * deux fois est redondant.
 */
export function RefreshFailedBanner({ muted }: { muted: boolean }) {
  const queryClient = useQueryClient();
  const cache = queryClient.getQueryCache();
  const subscribe = useCallback((notify: () => void) => cache.subscribe(notify), [cache]);
  // « active » : des données à l'écran. La palette fermée ne retient pas ses requêtes dans ce décompte.
  const staleCount = () => cache.findAll({ type: 'active', predicate: showsStaleData }).length;
  const stale = useSyncExternalStore(subscribe, staleCount);

  // « Réessayer » : si la relecture rétablit tout, le bandeau part et le titre de la page prend le focus que son bouton tenait, comme après le « Réessayer » d'une
  // page. Le titre ne le prend que sur cette demande-là. Quand le bandeau part sans elle (les mises à jour en direct sont interrompues et il se tait, une relecture
  // automatique réussit), le bouton rend le focus au contenu principal (voir `keepFocusInZone`) : personne n'a demandé qu'on lise le titre. S'il reste des
  // données périmées, le bandeau reste, avec son bouton et son focus. Le bandeau part avant ou après la fin de la relecture : le focus est encore sur le bouton, ou
  // déjà au contenu principal ; s'il est ailleurs, l'utilisateur l'a mis là, et on n'y touche pas.
  const retry = (event: MouseEvent<HTMLButtonElement>) => {
    const button = event.currentTarget;
    const zone = zoneOf(button);
    void queryClient.refetchQueries({ type: 'active', predicate: showsStaleData }).then(() => {
      const focus = document.activeElement;
      if (zone !== null && staleCount() === 0 && (focus === button || focus === zone)) focusTitleOf(zone);
    });
  };

  return (
    // Zone d'annonce présente dès le départ (une zone qui apparaît avec son contenu n'est pas toujours annoncée) ;
    // `aria-live` plutôt que `role="status"` : elle reste vide tant que tout va bien, sans polluer les « status » de la page.
    <div aria-live="polite" aria-atomic="true">
      {stale > 0 && !muted ? (
        // Le bouton part avec le bandeau : le focus qu'il avait passe au contenu principal, pas au corps de la page (voir `keepFocusInZone`).
        <div ref={keepFocusInZone} className="flex items-center gap-2 border-b border-line bg-well px-4 py-1.5 text-xs text-ink-2">
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 wrap-anywhere">
            Actualisation impossible : les données affichées ne sont peut-être plus à jour.
          </p>
          <button
            type="button"
            onClick={retry}
            className="inline-flex shrink-0 items-center gap-1.5 font-medium text-ink hover:underline"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Réessayer
          </button>
        </div>
      ) : null}
    </div>
  );
}
