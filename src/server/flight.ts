import { ReadAborted } from './abort';

export interface FlightOptions {
  /**
   * Délai de grâce, en millisecondes (défaut : aucun). Quand le dernier demandeur part, la lecture n'est abandonnée que si personne
   * ne s'y est joint dans ce délai : une analyse abandonnée puis redemandée aussitôt (l'utilisateur qui parcourt les tickets
   * abandonne la requête du ticket précédent juste avant celle du suivant) n'est ainsi pas relancée à chaque pas.
   *
   * Pendant le délai, une lecture Dolt qui attend encore une place reste dans la file, mais après toutes celles qu'on attend (voir
   * `idle`, bdesk-38k.37) : elle n'est lancée que si une place reste libre. Une fois lancée, elle garde sa place jusqu'à sa fin, qu'on
   * l'attende ou non : à réserver à celles que la requête suivante redemande presque toujours (l'historique d'un Projet, voie
   * `analysis`), jamais à une lecture de tickets (voie `normal`), qui ferait attendre la fiche que l'utilisateur ouvre en partant
   * (bdesk-38k.33, ADR 0003).
   */
  graceMs?: number;
}

/**
 * Délai de grâce des lectures de l'historique d'un Projet (chronologie, métriques) : une seconde. Elle couvre l'intervalle entre
 * l'abandon d'une requête et la requête suivante d'un parcours rapide, et coûte peu parce qu'elle ne retient que ces lectures et ne
 * retarde aucune lecture qu'on attend : une lecture d'historique déjà lancée va au bout de toute façon, et celle qui attend encore une
 * place ne quitte la file qu'à l'expiration du délai, mais passe après toutes celles qu'on attend (`Flight.idle` : sans cela, quitter la
 * Vue globale à froid ferait attendre la grâce entière à la chronologie du ticket suivant, bdesk-38k.37). Les lectures de tickets n'en
 * ont pas, même dans les métriques, dont l'analyse lit aussi la liste des tickets de chaque Projet : cette lecture quitte la file avec son
 * dernier demandeur (sinon quitter la Vue globale à froid avec plus de six Projets ferait lire des listes pour personne devant la fiche
 * suivante : bdesk-38k.33, ADR 0003).
 */
export const ANALYSIS_GRACE_MS = 1_000;

/**
 * Les signaux des lectures qui n'ont plus de demandeur et ne vivent que par leur délai de grâce (voir `Flight.leave`). Un `Flight` donne
 * le sien à sa lecture, qui le transmet jusqu'au client Dolt : plutôt qu'un paramètre de plus à chaque couche, le client demande à
 * `Flight.idle` si ceux qui attendent une lecture en file sont de ceux-là.
 */
const graced = new WeakSet<AbortSignal>();

/**
 * Une lecture que plusieurs demandeurs attendent ensemble, et qu'aucun ne peut arrêter à lui seul (bdesk-38k.20).
 *
 * - Elle ne lit qu'une fois, quel que soit le nombre de demandeurs (`join`).
 * - Un demandeur qui abandonne (son `signal`) est libéré aussitôt, sans attendre la lecture, et sans la gêner pour les autres.
 * - Le dernier demandeur qui abandonne (après le délai de grâce, s'il y en a un) abandonne la lecture : le signal reçu par `run`
 *   s'abandonne, ce qui retire une lecture Dolt de la file. Un processus déjà lancé, lui, n'est jamais tué : il va au bout et son
 *   résultat est jeté (ADR 0003). Un demandeur sans signal ne part jamais : tant qu'il attend, la lecture continue.
 * - Une lecture abandonnée ne sert plus personne (`abandoned`) : qui arrive ensuite en lance une nouvelle.
 * - Une lecture que seul un délai de grâce retient est `idle` pour les lectures qui en dépendent : le client Dolt la sert après toutes
 *   celles qu'on attend (bdesk-38k.37).
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
  /** Ceux qui l'attendent encore, avec leur signal : `idle` en juge. */
  private readonly askers = new Set<{ signal: AbortSignal | undefined }>();
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

  /**
   * Personne n'attend vraiment cette lecture : chacun de ses demandeurs est le signal d'une lecture qui n'a plus de demandeur et ne vit
   * que par son délai de grâce, dans l'espoir qu'on la redemande (`graced`). Le client Dolt la sert alors après toutes celles qu'on attend,
   * au lieu de la laisser retarder la chronologie ou les métriques demandées entre-temps (bdesk-38k.37, ADR 0003). Jugée à chaque fois qu'une
   * place se libère : une lecture reprise pendant le délai redevient attendue, et retrouve son rang d'arrivée.
   */
  get idle(): boolean {
    for (const { signal } of this.askers) if (signal === undefined || !graced.has(signal)) return false;
    return true;
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
    const asker = { signal };
    this.askers.add(asker);
    this.endGrace(); // un demandeur est là : la lecture ne sera pas abandonnée
    return new Promise<T>((resolve, reject) => {
      const onAbort = () => {
        this.askers.delete(asker);
        reject(new ReadAborted());
        if (--this.waiters === 0 && !this.finished) this.leave();
      };
      signal?.addEventListener('abort', onAbort, { once: true });
      this.done.then(
        (value) => {
          this.askers.delete(asker);
          signal?.removeEventListener('abort', onAbort);
          resolve(value);
        },
        (error: unknown) => {
          this.askers.delete(asker);
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
    graced.add(this.controller.signal); // jusqu'à la fin du délai, ou à la reprise de la lecture : voir `idle`
    this.graceTimer = setTimeout(() => {
      this.graceTimer = undefined;
      if (this.waiters === 0 && !this.finished) this.cancel();
    }, this.graceMs);
    this.graceTimer.unref(); // un délai de grâce ne retient pas le processus
  }

  private endGrace(): void {
    graced.delete(this.controller.signal);
    if (this.graceTimer === undefined) return;
    clearTimeout(this.graceTimer);
    this.graceTimer = undefined;
  }

  private cancel(): void {
    this.cancelled = true;
    graced.delete(this.controller.signal);
    this.controller.abort();
    // Lancée, elle échoue d'elle-même quand son signal l'arrête ; sinon personne ne rejettera `done`.
    if (!this.started) this.rejectDone(new ReadAborted());
  }
}
