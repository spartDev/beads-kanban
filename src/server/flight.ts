import { ReadAborted } from './abort';

export interface FlightOptions {
  /**
   * Délai de grâce, en millisecondes (défaut : aucun). Quand le dernier demandeur part, la lecture n'est abandonnée que si personne
   * ne s'y est joint dans ce délai : une analyse abandonnée puis redemandée aussitôt (l'utilisateur qui parcourt les tickets
   * abandonne la requête du ticket précédent juste avant celle du suivant) n'est ainsi pas relancée à chaque pas.
   *
   * Pendant le délai, une lecture qui attend encore une place la garde dans la file, et peut être lancée pour personne devant les
   * lectures de sa voie. À réserver à celles qui ont leur voie à elles et que la requête suivante redemande (l'historique d'un Projet,
   * voie `analysis`), jamais à une lecture de tickets (voie `normal`) : la fiche que l'utilisateur ouvre en partant attend derrière
   * (bdesk-38k.33, ADR 0003).
   */
  graceMs?: number;
}

/**
 * Délai de grâce des lectures de l'historique d'un Projet (chronologie, métriques) : une seconde. Elle couvre l'intervalle entre
 * l'abandon d'une requête et la requête suivante d'un parcours rapide, et coûte peu parce qu'elle ne retient que ces lectures : une
 * lecture d'historique déjà lancée va au bout de toute façon, et celle qui attend encore une place ne quitte la file qu'à l'expiration du
 * délai, mais dans la voie `analysis`, où elle ne retarde que d'autres historiques. Les lectures de tickets n'en ont pas, même dans les
 * métriques, dont l'analyse lit aussi la liste des tickets de chaque Projet : cette lecture quitte la file avec son dernier demandeur
 * (sinon quitter la Vue globale à froid avec plus de six Projets ferait lire des listes pour personne devant la fiche suivante :
 * bdesk-38k.33, ADR 0003).
 */
export const ANALYSIS_GRACE_MS = 1_000;

/**
 * Une lecture que plusieurs demandeurs attendent ensemble, et qu'aucun ne peut arrêter à lui seul (bdesk-38k.20).
 *
 * - Elle ne lit qu'une fois, quel que soit le nombre de demandeurs (`join`).
 * - Un demandeur qui abandonne (son `signal`) est libéré aussitôt, sans attendre la lecture, et sans la gêner pour les autres.
 * - Le dernier demandeur qui abandonne (après le délai de grâce, s'il y en a un) abandonne la lecture : le signal reçu par `run`
 *   s'abandonne, ce qui retire une lecture Dolt de la file. Un processus déjà lancé, lui, n'est jamais tué : il va au bout et son
 *   résultat est jeté (ADR 0003). Un demandeur sans signal ne part jamais : tant qu'il attend, la lecture continue.
 * - Une lecture abandonnée ne sert plus personne (`abandoned`) : qui arrive ensuite en lance une nouvelle.
 *
 * La lecture ne part qu'à `start()`, pour qu'on puisse la présenter aux demandeurs avant de la lancer.
 */
export class Flight<T> {
  /** Le résultat de la lecture ; son échec, ou `ReadAborted` si elle est abandonnée avant d'avoir été lancée. */
  readonly done: Promise<T>;
  /** Se résout, sans jamais échouer, quand la lecture est finie de quelque façon que ce soit. */
  readonly settled: Promise<void>;

  private readonly controller = new AbortController();
  private resolveDone: (value: T) => void = () => undefined;
  private rejectDone: (error: unknown) => void = () => undefined;
  private waiters = 0;
  private started = false;
  private finished = false;
  private cancelled = false;
  private graceTimer: ReturnType<typeof setTimeout> | undefined;
  private readonly graceMs: number;

  constructor(
    private readonly run: (signal: AbortSignal) => Promise<T>,
    { graceMs = 0 }: FlightOptions = {},
  ) {
    this.graceMs = graceMs;
    this.done = new Promise<T>((resolve, reject) => {
      this.resolveDone = resolve;
      this.rejectDone = reject;
    });
    this.settled = this.done.then(
      () => undefined,
      () => undefined,
    );
  }

  /** Tous ses demandeurs sont partis, et le délai de grâce est écoulé : elle est abandonnée, ou ne sera jamais lancée. */
  get abandoned(): boolean {
    return this.cancelled;
  }

  /** Lance la lecture. Sans effet si elle est déjà lancée ou abandonnée. */
  start(): void {
    if (this.started || this.cancelled) return;
    this.started = true;
    let reading: Promise<T>;
    try {
      reading = this.run(this.controller.signal);
    } catch (error) {
      reading = Promise.reject(error);
    }
    reading.then(
      (value) => {
        this.finished = true;
        this.endGrace();
        this.resolveDone(value);
      },
      (error: unknown) => {
        this.finished = true;
        this.endGrace();
        this.rejectDone(error);
      },
    );
  }

  /**
   * Attend le résultat. Si `signal` est abandonné avant, rejette aussitôt par `ReadAborted` ; quand c'était le dernier
   * demandeur, la lecture est abandonnée (après le délai de grâce, si quelqu'un ne s'y est pas joint entre-temps). Une lecture déjà
   * finie rend son résultat à qui s'y joint ensuite.
   */
  join(signal?: AbortSignal): Promise<T> {
    if (this.cancelled || signal?.aborted) return Promise.reject(new ReadAborted());
    this.waiters++;
    this.endGrace(); // un demandeur est là : la lecture ne sera pas abandonnée
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        reject(new ReadAborted());
        if (--this.waiters === 0 && !this.finished) this.leave();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.done.then(
        (value) => {
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          signal?.removeEventListener('abort', onAbort);
          reject(error);
        },
      );
    });
  }

  /** Le dernier demandeur est parti : abandon aussitôt, ou à la fin du délai de grâce si personne ne s'est joint à la lecture entre-temps. */
  private leave(): void {
    if (this.graceMs <= 0) return this.cancel();
    this.endGrace();
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined;
      if (this.waiters === 0 && !this.finished) this.cancel();
    }, this.graceMs);
    this.graceTimer.unref(); // un délai de grâce ne retient pas le processus
  }

  private endGrace(): void {
    if (this.graceTimer === undefined) return;
    clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private cancel(): void {
    this.cancelled = true;
    this.controller.abort();
    // Lancée, elle échoue d'elle-même quand son signal l'arrête ; sinon personne ne rejettera `done`.
    if (!this.started) this.rejectDone(new ReadAborted());
  }
}
