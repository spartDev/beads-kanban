import { useQueryClient, type Query } from '@tanstack/react-query';
import { RefreshCw, TriangleAlert } from 'lucide-react';
import { useCallback, useSyncExternalStore } from 'react';
import { ApiError } from '../data/client';

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
  const stale = useSyncExternalStore(subscribe, () => cache.findAll({ type: 'active', predicate: showsStaleData }).length);

  return (
    // Zone d'annonce présente dès le départ (une zone qui apparaît avec son contenu n'est pas toujours annoncée) ;
    // `aria-live` plutôt que `role="status"` : elle reste vide tant que tout va bien, sans polluer les « status » de la page.
    <div aria-live="polite" aria-atomic="true">
      {stale > 0 && !muted ? (
        <div className="flex items-center gap-2 border-b border-line bg-well px-4 py-1.5 text-xs text-ink-2">
          <TriangleAlert size={13} aria-hidden="true" className="shrink-0 text-danger" />
          <p className="min-w-0 flex-1 wrap-anywhere">
            Actualisation impossible : les données affichées ne sont peut-être plus à jour.
          </p>
          <button
            type="button"
            onClick={() => void queryClient.refetchQueries({ type: 'active', predicate: showsStaleData })}
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
