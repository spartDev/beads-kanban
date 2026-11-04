import { vi } from 'vitest';

type Listener = (event: Event) => void;

/**
 * Un `EventSource` que le test pilote : jsdom n'en a pas, et un vrai flux n'aurait rien à dire sans serveur.
 * `open()`, `emit()` et `fail()` font ce que feraient le serveur et le réseau ; `readyState` suit la spécification
 * (CONNECTING avant l'ouverture et pendant que le navigateur retente, OPEN, CLOSED après `close()` ou une réponse refusée).
 */
export class FakeEventSource {
  static readonly CONNECTING = 0;
  static readonly OPEN = 1;
  static readonly CLOSED = 2;
  /** Tous les flux créés depuis `installFakeEventSource`, dans l'ordre. */
  static instances: FakeEventSource[] = [];

  readonly CONNECTING = 0;
  readonly OPEN = 1;
  readonly CLOSED = 2;
  readyState = 0;
  readonly url: string;
  readonly withCredentials = false;
  /** `close()` a été appelé : le flux ne change plus d'état. Les `open()` et `emit()` qui suivent miment un événement en retard. */
  private closedByClient = false;
  private readonly listeners = new Map<string, Set<Listener>>();

  constructor(url: string | URL) {
    this.url = String(url);
    FakeEventSource.instances.push(this);
  }

  /** Le dernier flux créé. */
  static get latest(): FakeEventSource {
    const latest = FakeEventSource.instances.at(-1);
    if (!latest) throw new Error("Aucun EventSource n'a été créé.");
    return latest;
  }

  /** Les flux encore ouverts ou en cours d'ouverture. */
  static get alive(): FakeEventSource[] {
    return FakeEventSource.instances.filter((source) => source.readyState !== FakeEventSource.CLOSED);
  }

  addEventListener(type: string, listener: Listener): void {
    const set = this.listeners.get(type) ?? new Set<Listener>();
    set.add(listener);
    this.listeners.set(type, set);
  }

  removeEventListener(type: string, listener: Listener): void {
    this.listeners.get(type)?.delete(listener);
  }

  close(): void {
    this.closedByClient = true;
    this.readyState = FakeEventSource.CLOSED;
  }

  /** Le serveur a répondu 200 : le flux est ouvert. */
  open(): void {
    if (!this.closedByClient) this.readyState = FakeEventSource.OPEN;
    this.dispatch('open', new Event('open'));
  }

  /** Le serveur envoie un événement (par défaut `changed`, avec les données d'un vrai). */
  emit(type = 'changed', data: unknown = { project: 'bdesk', head: 'h2' }): void {
    this.dispatch(type, new MessageEvent(type, { data: JSON.stringify(data) }));
  }

  /**
   * La connexion tombe. `retrying` : le navigateur va la rouvrir de lui-même (CONNECTING, cas d'une coupure en cours
   * de route) ; sinon la réponse a été refusée (404, 502 du proxy) et le flux est fermé pour de bon (CLOSED).
   */
  fail({ retrying }: { retrying: boolean }): void {
    if (!this.closedByClient) this.readyState = retrying ? FakeEventSource.CONNECTING : FakeEventSource.CLOSED;
    this.dispatch('error', new Event('error'));
  }

  private dispatch(type: string, event: Event): void {
    for (const listener of [...(this.listeners.get(type) ?? [])]) listener(event);
  }
}

/** Remplace `EventSource` par le faux pour la durée du test (à défaire avec `vi.unstubAllGlobals`). */
export function installFakeEventSource(): typeof FakeEventSource {
  FakeEventSource.instances = [];
  vi.stubGlobal('EventSource', FakeEventSource);
  return FakeEventSource;
}
