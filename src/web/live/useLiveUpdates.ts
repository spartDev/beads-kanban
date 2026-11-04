import { useQueryClient } from '@tanstack/react-query';
import { useCallback, useEffect, useRef, useState } from 'react';
import { queryKeys } from '../data/hooks';
import { connectLive, type LiveConnection, type LiveState } from './connection';
import { refreshProject, resyncProject } from './refresh';

/** `off` : rien à suivre (Vue globale, Projet inconnu ou illisible) ou navigateur sans `EventSource`. */
export type LiveStatus = LiveState | 'off';

/** Adresse du flux d'un Projet (`GET /api/projects/:projectId/events`). */
export const liveUrl = (projectId: string): string => `/api/projects/${encodeURIComponent(projectId)}/events`;

const isHidden = (): boolean => typeof document !== 'undefined' && document.visibilityState === 'hidden';

/**
 * Tient la connexion au flux du Projet (si on en suit un) et relit ses tickets à chaque commit. Le flux est fermé
 * quand l'onglet est caché : le serveur ne sonde alors rien pour lui, et la connexion ne compte pas parmi les six
 * qu'un navigateur accorde à `localhost` (HTTP/1.1) ; au retour, on se reconnecte et on relit.
 *
 * `reconnect` rouvre tout de suite un flux perdu, sans attendre le prochain essai.
 */
export function useLiveUpdates(projectId: string | undefined): { status: LiveStatus; reconnect: () => void } {
  const queryClient = useQueryClient();
  const [status, setStatus] = useState<LiveStatus>('off');
  const connection = useRef<LiveConnection | undefined>(undefined);

  useEffect(() => {
    if (!projectId || typeof EventSource === 'undefined') {
      setStatus('off');
      return;
    }
    const live = connectLive({
      url: liveUrl(projectId),
      onChange: () => void refreshProject(queryClient, projectId),
      onOpen: () => void resyncProject(queryClient, projectId),
      onState: setStatus,
      // Le flux est refusé sans que le navigateur dise pourquoi (404 d'un Projet disparu, 502 du proxy). On relit la liste des
      // Projets : s'il n'y est plus, ou n'y est plus lisible, `LiveUpdates` cesse de le suivre et la page dit pourquoi, au lieu
      // de reconnecter indéfiniment.
      onRefused: () => void queryClient.invalidateQueries({ queryKey: queryKeys.projects, exact: true }),
      paused: isHidden(),
    });
    connection.current = live;
    const followVisibility = () => (isHidden() ? live.pause() : live.resume());
    document.addEventListener('visibilitychange', followVisibility);
    return () => {
      document.removeEventListener('visibilitychange', followVisibility);
      live.close();
      connection.current = undefined;
    };
  }, [projectId, queryClient]);

  const reconnect = useCallback(() => connection.current?.reconnect(), []);
  return { status, reconnect };
}
