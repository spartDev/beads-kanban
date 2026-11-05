import { RefreshCw, WifiOff } from 'lucide-react';
import { useEffect, useRef, useState } from 'react';
import { focusTitleWhenReady, keepFocusInZone, locationOf, zoneOf } from '../lib/zoneFocus';
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
  failedAttempt = 0,
  onReconnect,
  graceMs = LOST_GRACE_MS,
}: {
  status: LiveStatus;
  /** Le numéro du dernier essai de connexion qui a échoué (voir `useLiveUpdates` ; 0 : aucun) : il monte à chaque essai qui échoue, même quand `status` reste « lost », qu'il ne répète pas. */
  failedAttempt?: number;
  /** Rouvre le flux tout de suite, et rend le numéro de l'essai ainsi lancé : c'est l'échec de cet essai, ou d'un suivant, qui désarme la demande de l'utilisateur. */
  onReconnect: () => number | void;
  graceMs?: number;
}) {
  const lost = status === 'lost';
  const [graceOver, setGraceOver] = useState(false);
  // Ce que « Reconnecter » demande, tant que l'issue n'est pas arrivée : la zone d'où il a été pressé, la page qu'elle montrait alors, et le numéro de l'essai qu'il a lancé.
  const asked = useRef<{ zone: HTMLElement; page: string | null; attempt: number } | null>(null);

  useEffect(() => {
    setGraceOver(false);
    if (!lost) return;
    const timer = setTimeout(() => setGraceOver(true), graceMs);
    return () => clearTimeout(timer);
  }, [lost, graceMs]);

  // Quand la connexion revient après « Reconnecter », le bandeau part, son bouton rend le focus au contenu principal (voir `keepFocusInZone`) et le titre de la page le
  // prend : comme après le « Réessayer » d'une page, sur cette demande-là seulement. Si la connexion revient d'elle-même, le contenu principal le garde. Et comme le
  // réessai d'une page (voir `useRetryFocus`), « Reconnecter » se désarme à toute issue : la connexion revient, ou l'essai échoue (le flux était déjà perdu, le statut reste
  // « lost » et ne dit rien : c'est le numéro du dernier essai échoué qui monte), ou le statut passe à « connecting » (l'onglet est caché, le flux est fermé : rien n'est rétabli).
  // Une connexion qui revient d'elle-même plus tard, après un essai qui a échoué, n'est pas une demande de l'utilisateur.
  // L'échec qui désarme est celui de l'essai demandé, ou d'un suivant (la connexion en rouvre un d'elle-même) : un échec d'un essai d'avant, qui n'arrive au bandeau qu'après l'appui
  // parce qu'il est tombé dans le même rendu, n'est pas l'issue de cette demande, et le statut « lost » qui le suit ne la désarme pas. Et la demande est celle de la page où « Reconnecter »
  // a été pressé : si l'utilisateur est allé sur une autre pendant l'essai, le titre de celle-ci ne prend pas le focus (voir `focusTitleWhenReady`).
  useEffect(() => {
    const request = asked.current;
    if (request === null) return undefined;
    if (failedAttempt >= request.attempt) {
      asked.current = null;
      return undefined;
    }
    if (status === 'lost') return undefined;
    asked.current = null;
    return status === 'live' ? focusTitleWhenReady(request.zone, request.page) : undefined;
  }, [status, failedAttempt]);

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
              const zone = zoneOf(event.currentTarget);
              // Sans numéro (`onReconnect` ne dit pas quel essai il lance), la demande est celle du prochain échec que le bandeau verra.
              const attempt = onReconnect() ?? failedAttempt + 1;
              asked.current = zone === null ? null : { zone, page: locationOf(zone), attempt };
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
