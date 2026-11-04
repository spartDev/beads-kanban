/**
 * Surveillance du HEAD Dolt des Projets (bdesk-38k.8) : de quoi savoir qu'un Projet a changé, sans rien surveiller sur
 * le disque.
 *
 * Pourquoi un sondage et pas un watcher de fichiers : les lectures de l'app elle-même (`dolt sql`) mettent à jour la
 * date de modification de `noms/manifest`, `noms/journal.idx` et du journal, à chaque lecture. Un watcher sur le
 * dossier de la base se déclencherait donc sur nos propres lectures, en boucle (voir docs/adr/0002). Le hash du HEAD,
 * lui, ne change que par un commit : il est stable tant que personne n'écrit, et un Projet en mode serveur (sans
 * dossier local à surveiller) se sonde de la même façon.
 *
 * Chaque Projet suivi est lu à son propre rythme, une lecture à la fois : l'intervalle court à partir de la fin de la
 * lecture précédente, donc jamais de chevauchement, même quand Dolt est lent. Un Projet que personne ne suit n'est pas
 * lu. Une lecture qui échoue (Projet illisible, disparu, base verrouillée, Dolt absent) ne fait rien tomber : elle est
 * rapportée, puis retentée de plus en plus lentement, jusqu'à un plafond.
 */

/** Un changement de HEAD détecté dans la base d'un Projet. */
export interface HeadChange {
  projectId: string;
  /** Le nouveau hash du HEAD. */
  head: string;
}

export interface HeadWatcherOptions {
  /** Lit le hash du HEAD du Projet (`ProjectService.head`) : une lecture seule, légère. */
  head: (projectId: string) => Promise<string>;
  /** Délai entre la fin d'une lecture et le début de la suivante (défaut : 3 s). */
  intervalMs?: number;
  /** Délai maximal entre deux lectures d'un Projet qui échoue (défaut : 1 min). Le délai double à chaque échec. */
  maxBackoffMs?: number;
  /**
   * Rapport de ce que le sondage avale : une lecture qui échoue, ou un abonné qui lève. Le sondage continue dans les
   * deux cas. Sans effet par défaut ; une erreur levée par le rapport lui-même est ignorée.
   */
  onError?: (projectId: string, error: unknown) => void;
  /**
   * La première lecture réussie d'un Projet dont les lectures échouaient : la panne est finie. Une fois par panne, jamais
   * pour une lecture ordinaire. Avec `onError`, de quoi ne rapporter que les changements d'état. Une erreur levée par ce
   * rapport est ignorée.
   */
  onRecover?: (projectId: string) => void;
}

export interface HeadWatcher {
  /**
   * Suit un Projet : `listener` est appelé à chaque changement de HEAD, avec le dernier HEAD vu. La première lecture
   * (lancée aussitôt) est l'état de départ : elle n'est pas annoncée, pas plus qu'un changement survenu pendant que
   * personne ne suivait le Projet. Renvoie la fonction qui met fin à l'abonnement ; le sondage du Projet s'arrête avec
   * son dernier abonné.
   */
  subscribe(projectId: string, listener: (change: HeadChange) => void): () => void;
  /** Les Projets qui ont au moins un abonné, donc ceux qui sont sondés. */
  watched(): string[];
  /** Arrête tout sondage et oublie les abonnés. Les abonnements suivants sont sans effet. */
  close(): void;
}

export const DEFAULT_POLL_INTERVAL_MS = 3_000;
export const DEFAULT_MAX_BACKOFF_MS = 60_000;

/** Au-delà, `2 ** échecs` ne change plus rien au plafond : on évite seulement un dépassement. */
const MAX_BACKOFF_EXPONENT = 16;

interface Subscription {
  listener: (change: HeadChange) => void;
}

interface Watch {
  projectId: string;
  /** Un objet par abonnement : la même fonction abonnée deux fois compte pour deux. */
  subscriptions: Set<Subscription>;
  /** Dernier HEAD lu, absent avant la première lecture réussie. */
  last: string | undefined;
  /** Échecs de lecture consécutifs. */
  failures: number;
  timer: ReturnType<typeof setTimeout> | undefined;
  /** Une lecture est en cours : il n'y en a jamais deux à la fois. */
  reading: boolean;
}

export function createHeadWatcher({
  head,
  intervalMs = DEFAULT_POLL_INTERVAL_MS,
  maxBackoffMs = DEFAULT_MAX_BACKOFF_MS,
  onError,
  onRecover,
}: HeadWatcherOptions): HeadWatcher {
  const watches = new Map<string, Watch>();
  let closed = false;

  function report(projectId: string, error: unknown): void {
    try {
      onError?.(projectId, error);
    } catch {
      // Un rapport en panne ne doit pas arrêter le sondage.
    }
  }

  function reportRecovery(projectId: string): void {
    try {
      onRecover?.(projectId);
    } catch {
      // Un rapport en panne ne doit pas arrêter le sondage.
    }
  }

  /** L'intervalle, puis le double, le quadruple… à chaque échec de suite, sans dépasser le plafond (ni passer sous l'intervalle). */
  function delayAfter(watch: Watch): number {
    if (watch.failures === 0) return intervalMs;
    const backoff = intervalMs * 2 ** Math.min(watch.failures, MAX_BACKOFF_EXPONENT);
    return Math.min(backoff, Math.max(maxBackoffMs, intervalMs));
  }

  function schedule(watch: Watch, delayMs: number): void {
    const timer = setTimeout(() => {
      poll(watch).catch((error: unknown) => report(watch.projectId, error));
    }, delayMs);
    timer.unref(); // le serveur HTTP tient le processus en vie, pas le sondage
    watch.timer = timer;
  }

  function notify(watch: Watch, latest: string): void {
    for (const subscription of [...watch.subscriptions]) {
      if (!watch.subscriptions.has(subscription)) continue; // parti pendant qu'on prévenait les précédents
      try {
        subscription.listener({ projectId: watch.projectId, head: latest });
      } catch (error) {
        report(watch.projectId, error);
      }
    }
  }

  async function poll(watch: Watch): Promise<void> {
    watch.timer = undefined;
    watch.reading = true;
    let latest = '';
    let failure: { error: unknown } | undefined;
    try {
      latest = await head(watch.projectId);
    } catch (error) {
      failure = { error };
    }
    watch.reading = false;

    // Le dernier abonné est parti (ou le watcher fermé) pendant la lecture : son résultat n'intéresse plus personne.
    if (closed || watch.subscriptions.size === 0) {
      if (watches.get(watch.projectId) === watch) watches.delete(watch.projectId);
      return;
    }

    if (failure) {
      watch.failures++;
      report(watch.projectId, failure.error);
    } else {
      const previous = watch.last;
      const recovered = watch.failures > 0;
      watch.failures = 0;
      watch.last = latest;
      if (recovered) reportRecovery(watch.projectId);
      if (previous !== undefined && previous !== latest) notify(watch, latest);
    }

    // Un abonné a pu tout arrêter en étant prévenu.
    if (!closed && watches.get(watch.projectId) === watch) schedule(watch, delayAfter(watch));
  }

  /** Le dernier abonné est parti : plus de minuterie ; la lecture en cours, si elle y est, oublie le Projet en finissant. */
  function stop(watch: Watch): void {
    if (watch.timer) clearTimeout(watch.timer);
    watch.timer = undefined;
    if (!watch.reading) watches.delete(watch.projectId);
  }

  return {
    subscribe(projectId, listener) {
      if (closed) return () => undefined;
      let watch = watches.get(projectId);
      if (!watch) {
        watch = { projectId, subscriptions: new Set(), last: undefined, failures: 0, timer: undefined, reading: false };
        watches.set(projectId, watch);
        schedule(watch, 0);
      }
      // Sinon : soit le Projet est déjà sondé, soit une lecture lancée par un abonné parti est encore en cours, et c'est elle qui relancera le sondage.
      const subscription: Subscription = { listener };
      watch.subscriptions.add(subscription);
      const target = watch;
      return () => {
        if (!target.subscriptions.delete(subscription)) return;
        if (target.subscriptions.size === 0) stop(target);
      };
    },

    watched: () => [...watches.values()].filter((watch) => watch.subscriptions.size > 0).map((watch) => watch.projectId),

    close() {
      closed = true;
      for (const watch of watches.values()) {
        if (watch.timer) clearTimeout(watch.timer);
        watch.subscriptions.clear();
      }
      watches.clear();
    },
  };
}
