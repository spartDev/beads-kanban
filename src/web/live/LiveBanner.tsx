import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { focusTitleWhenReady, keepFocusInZone, zoneOf } from '../lib/zoneFocus';
import type { LiveStatus } from './useLiveUpdates';

/** Délai de grâce avant de signaler la perte : un serveur qui redémarre (tsx watch, relance) revient bien avant. */
export const LOST_GRACE_MS = 2_500;

/**
 * Indication discrète, sous la barre du haut, que les mises à jour en direct sont interrompues : les données affichées
 * ne bougeront plus d'elles-mêmes tant que la connexion n'est pas revenue (elle se rétablit seule, le bouton ne fait que
 * brusquer le prochain essai). Rien tant que tout va bien, ni pendant les premières secondes d'une coupure.
 */
export function LiveBanner({
  status,
  onReconnect,
  graceMs = LOST_GRACE_MS,
}: {
  status: LiveStatus;
  onReconnect: () => void;
  graceMs?: number;
}) {
  const lost = status === 'lost';
  const [graceOver, setGraceOver] = useState(false);
  // La zone d'où « Reconnecter » a été pressé, tant que la connexion n'est pas revenue.
  const asked = useRef<HTMLElement | null>(null);

  useEffect(() => {
    setGraceOver(false);
    if (!lost) return;
    const timer = setTimeout(() => setGraceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [lost, graceMs]);

  // Quand la connexion revient après « Reconnecter », le bandeau part, son bouton rend le focus au contenu principal (voir `keepFocusInZone`) et le titre de la page le
  // prend : comme après le « Réessayer » d'une page, sur cette demande-là seulement. Si la connexion revient d'elle-même, le contenu principal le garde.
  useEffect(() => {
    const zone = asked.current;
    if (zone === null || status === 'lost') return undefined;
    asked.current = null;
    return status === 'live' ? focusTitleWhenReady(zone) : undefined;
  }, [status]);

  return (
    // Zone d'annonce présente dès le départ (une zone qui apparaît avec son contenu n'est pas toujours annoncée), comme
    // celle de RefreshFailedBanner : elle reste vide tant que tout va bien.
    <div aria-live="polite" aria-atomic="true">
      {lost && graceOver ? (
        // Le bouton part avec le bandeau au retour de la connexion : le focus qu'il avait passe au contenu principal, pas au corps de la page (voir `keepFocusInZone`).
        <div ref={keepFocusInZone} className="flex items-center gap-2 border-b border-line bg-well px-4 py-1.5 text-xs text-ink-2">
          <WifiOff size={13} aria-hidden="true" className="shrink-0 text-ink-3" />
          <p className="min-w-0 flex-1 wrap-anywhere">
            Mises à jour en direct interrompues : reconnexion en cours. Ce qui est affiché peut ne plus être à jour.
          </p>
          <button
            type="button"
            onClick={(event) => {
              asked.current = zoneOf(event.currentTarget);
              onReconnect();
            }}
            className="inline-flex shrink-0 items-center gap-1.5 font-medium text-ink hover:underline"
          >
            <RefreshCw size={12} aria-hidden="true" />
            Reconnecter
          </button>
        </div>
      ) : null}
    </div>
  );
}
