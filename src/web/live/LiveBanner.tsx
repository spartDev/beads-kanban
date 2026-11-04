import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useState } from 'react';
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

  useEffect(() => {
    setGraceOver(false);
    if (!lost) return;
    const timer = setTimeout(() => setGraceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [lost, graceMs]);

  return (
    // Zone d'annonce présente dès le départ (une zone qui apparaît avec son contenu n'est pas toujours annoncée), comme
    // celle de RefreshFailedBanner : elle reste vide tant que tout va bien.
    <div aria-live="polite" aria-atomic="true">
      {lost && graceOver ? (
        <div className="flex items-center gap-2 border-b border-line bg-well px-4 py-1.5 text-xs text-ink-2">
          <WifiOff size={13} aria-hidden="true" className="shrink-0 text-ink-3" />
          <p className="min-w-0 flex-1 wrap-anywhere">
            Mises à jour en direct interrompues : reconnexion en cours. Ce qui est affiché peut ne plus être à jour.
          </p>
          <button
            type="button"
            onClick={onReconnect}
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
