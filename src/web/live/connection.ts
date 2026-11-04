/**
 * La connexion au flux d'événements d'un Projet (`GET /api/projects/:projectId/events`, voir `shared/api.ts`), sans React :
 * ouverture, reconnexion, pause quand l'onglet est caché.
 *
 * Deux sortes de coupures, que `EventSource` ne traite pas pareil :
 *
 * - la connexion tombe en route (serveur arrêté, réseau) : le navigateur rouvre le flux de lui-même, au bout du délai
 *   `retry:` annoncé par le serveur, et le flux reste en état CONNECTING. On se contente de signaler la perte ;
 * - la réponse est refusée (404 d'un Projet disparu, 502 du proxy de Vite pendant que le serveur redémarre) : le navigateur
 *   renonce, le flux passe à CLOSED pour de bon, sans dire pourquoi. On prévient l'appelant (`onRefused`), qui peut vérifier
 *   ce que le serveur sait encore du Projet, et on rouvre le flux nous-mêmes, de plus en plus tard, jusqu'à un plafond.
 *
 * Chaque ouverture est signalée (`onOpen`) : c'est le moment de relire ce qu'on affiche, car des événements ont pu être
 * manqués tant qu'on n'était pas connecté (la première ouverture comprise : on a pu changer de Projet, ou revenir sur un
 * Projet dont les données datent d'avant).
 */

/** `connecting` : première connexion en cours ; `live` : flux ouvert ; `lost` : perdu, la reconnexion est en cours. */
export type LiveState = 'connecting' | 'live' | 'lost';

export interface LiveConnectionOptions {
  /** Adresse du flux. */
  url: string;
  /** Un événement `changed` est arrivé : le Projet a un nouveau commit. */
  onChange: () => void;
  /** Le flux vient de (ré)ouvrir : l'appelant relit ce qu'il affiche. */
  onOpen: () => void;
  /** L'état de la connexion a changé (jamais deux fois le même d'affilée). */
  onState: (state: LiveState) => void;
  /**
   * Le navigateur a abandonné le flux : la réponse a été refusée (404 d'un Projet disparu, 502 du proxy…), sans qu'`EventSource`
   * dise pourquoi. L'appelant peut vérifier ce que le serveur sait encore du Projet ; la connexion, elle, se rouvre de plus
   * en plus tard tant que l'appelant ne la ferme pas. Pas appelé pour une coupure en route, que le navigateur retente seul.
   */
  onRefused?: () => void;
  /** Fabrique de flux (défaut : `new EventSource(url)`), pour les tests. */
  createSource?: (url: string) => EventSource;
  /** Attente avant de rouvrir un flux refusé : `initialMs` (défaut 1 s), doublée à chaque échec jusqu'à `maxMs` (défaut 10 s). */
  backoff?: { initialMs?: number; maxMs?: number };
  /** Ne rien ouvrir avant `resume()` : l'onglet est caché au départ. */
  paused?: boolean;
}

export interface LiveConnection {
  /** Ferme pour de bon : plus rien n'est ouvert ni signalé. */
  close(): void;
  /** Ferme le flux en gardant la connexion reprenable (onglet caché : ni sondage côté serveur, ni connexion tenue). */
  pause(): void;
  /** Rouvre aussitôt après `pause`. */
  resume(): void;
  /** Rouvre tout de suite, sans attendre le délai (bouton « Reconnecter »). */
  reconnect(): void;
}

const DEFAULT_INITIAL_BACKOFF_MS = 1_000;
const DEFAULT_MAX_BACKOFF_MS = 10_000;
/** `EventSource.CLOSED` : la constante n'existe pas là où `EventSource` est absent (tests, vieux navigateurs). */
const CLOSED = 2;

export function connectLive({
  url,
  onChange,
  onOpen,
  onState,
  onRefused,
  createSource = (address) => new EventSource(address),
  backoff = {},
  paused: startPaused = false,
}: LiveConnectionOptions): LiveConnection {
  const { initialMs = DEFAULT_INITIAL_BACKOFF_MS, maxMs = DEFAULT_MAX_BACKOFF_MS } = backoff;
  let source: EventSource | undefined;
  let timer: ReturnType<typeof setTimeout> | undefined;
  let delay = initialMs;
  let state: LiveState | undefined;
  let paused = startPaused;
  let closed = false;

  function setState(next: LiveState): void {
    if (state === next) return;
    state = next;
    onState(next);
  }

  function forgetSource(): void {
    clearTimeout(timer);
    timer = undefined;
    source?.close();
    source = undefined;
  }

  function open(): void {
    forgetSource();
    if (closed || paused) return;
    const current = createSource(url);
    source = current;
    // Un flux remplacé ou fermé n'a plus rien à nous dire, même s'il parle encore.
    const alive = (): boolean => source === current;

    current.addEventListener('open', () => {
      if (!alive()) return;
      delay = initialMs;
      setState('live');
      onOpen();
    });
    current.addEventListener('changed', () => {
      if (alive()) onChange();
    });
    current.addEventListener('error', () => {
      if (!alive()) return;
      setState('lost');
      if (current.readyState !== CLOSED) return; // le navigateur rouvre le flux de lui-même
      forgetSource();
      timer = setTimeout(open, delay);
      delay = Math.min(delay * 2, maxMs);
      onRefused?.(); // en dernier : l'appelant peut fermer la connexion en étant prévenu
    });
  }

  setState('connecting');
  open();

  return {
    close() {
      closed = true;
      forgetSource();
    },
    pause() {
      if (closed || paused) return;
      paused = true;
      forgetSource();
      setState('connecting'); // personne ne regarde : ce n'est pas une perte à afficher
    },
    resume() {
      if (closed || !paused) return;
      paused = false;
      delay = initialMs;
      open();
    },
    reconnect() {
      if (closed || paused) return;
      delay = initialMs;
      open();
    },
  };
}
