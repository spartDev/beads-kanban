import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { FakeEventSource } from '../test/eventSource';
import { connectLive, type LiveConnection, type LiveConnectionOptions, type LiveState } from './connection';

const URL = '/api/projects/bdesk/events';

beforeEach(() => {
  vi.useFakeTimers();
  FakeEventSource.instances = [];
});

afterEach(() => {
  vi.useRealTimers();
});

/** Une connexion branchée sur des faux flux ; les rappels notent ce qu'on leur annonce. */
function connect(options: Partial<LiveConnectionOptions> = {}) {
  const states: LiveState[] = [];
  const onChange = vi.fn();
  const onOpen = vi.fn();
  const connection = connectLive({
    url: URL,
    onChange,
    onOpen,
    onState: (state) => states.push(state),
    createSource: (url) => new FakeEventSource(url) as unknown as EventSource,
    ...options,
  });
  return { connection, states, onChange, onOpen };
}

const sources = () => FakeEventSource.instances;
const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('ouverture', () => {
  it('ouvre le flux du Projet, et se dit « en connexion » tant que le serveur n’a pas répondu', () => {
    const { states } = connect();

    expect(sources().map((source) => source.url)).toEqual([URL]);
    expect(states).toEqual(['connecting']);
  });

  it('passe en direct à l’ouverture du flux, et le dit à l’appelant, qui relit alors ses données', () => {
    const { states, onOpen, onChange } = connect();

    sources()[0]?.open();

    expect(states).toEqual(['connecting', 'live']);
    expect(onOpen).toHaveBeenCalledTimes(1);
    expect(onChange).not.toHaveBeenCalled();
  });

  it('transmet chaque événement « changed »', () => {
    const { onChange } = connect();
    const source = sources()[0];
    source?.open();

    source?.emit('changed');
    source?.emit('changed');

    expect(onChange).toHaveBeenCalledTimes(2);
  });

  it('ignore les autres événements', () => {
    const { onChange } = connect();
    const source = sources()[0];
    source?.open();

    source?.emit('autre');

    expect(onChange).not.toHaveBeenCalled();
  });
});

describe('coupure et reconnexion', () => {
  it('se dit « perdue » quand la connexion tombe, sans rouvrir de flux : le navigateur retente de lui-même', async () => {
    const { states } = connect();
    sources()[0]?.open();

    sources()[0]?.fail({ retrying: true });
    await elapse(60_000);

    expect(states).toEqual(['connecting', 'live', 'lost']);
    expect(sources()).toHaveLength(1);
  });

  it('relit ses données quand le navigateur a rouvert le flux : des événements ont pu être manqués', () => {
    const { states, onOpen } = connect();
    const source = sources()[0];
    source?.open();
    source?.fail({ retrying: true });

    source?.open();

    expect(states).toEqual(['connecting', 'live', 'lost', 'live']);
    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('ne répète pas « perdue » tant que la connexion ne revient pas', () => {
    const { states } = connect();
    const source = sources()[0];
    source?.open();

    source?.fail({ retrying: true });
    source?.fail({ retrying: true });
    source?.fail({ retrying: true });

    expect(states).toEqual(['connecting', 'live', 'lost']);
  });

  it('rouvre elle-même un flux que le navigateur a abandonné (réponse refusée : proxy en panne, serveur qui redémarre), de plus en plus tard', async () => {
    const { states } = connect();
    sources()[0]?.open();

    sources()[0]?.fail({ retrying: false });
    expect(states.at(-1)).toBe('lost');
    expect(sources()).toHaveLength(1);

    await elapse(999);
    expect(sources()).toHaveLength(1);
    await elapse(1); // 1 s
    expect(sources()).toHaveLength(2);

    sources()[1]?.fail({ retrying: false });
    await elapse(1_999);
    expect(sources()).toHaveLength(2);
    await elapse(1); // 2 s
    expect(sources()).toHaveLength(3);

    sources()[2]?.fail({ retrying: false });
    await elapse(4_000);
    expect(sources()).toHaveLength(4);
  });

  it('plafonne l’attente à 10 secondes', async () => {
    connect();
    const waits: number[] = [];
    for (let attempt = 0; attempt < 8; attempt++) {
      const before = sources().length;
      sources().at(-1)?.fail({ retrying: false });
      let waited = 0;
      for (let step = 0; step < 100 && sources().length === before; step++) {
        await elapse(500);
        waited += 500;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([1_000, 2_000, 4_000, 8_000, 10_000, 10_000, 10_000, 10_000]);
  });

  it('referme le flux abandonné avant d’en ouvrir un autre', async () => {
    connect();
    const first = sources()[0];
    first?.fail({ retrying: false });
    await elapse(1_000);

    expect(first?.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.alive).toHaveLength(1);
  });

  it('reprend l’attente de 1 seconde après une connexion réussie', async () => {
    connect();
    sources()[0]?.fail({ retrying: false });
    await elapse(1_000);
    sources()[1]?.fail({ retrying: false });
    await elapse(2_000);
    sources()[2]?.open(); // le serveur est revenu

    sources()[2]?.fail({ retrying: false });
    await elapse(1_000);

    expect(sources()).toHaveLength(4);
  });

  it('respecte les délais donnés', async () => {
    connect({ backoff: { initialMs: 100, maxMs: 300 } });
    const waits: number[] = [];
    for (let attempt = 0; attempt < 4; attempt++) {
      const before = sources().length;
      sources().at(-1)?.fail({ retrying: false });
      let waited = 0;
      for (let step = 0; step < 100 && sources().length === before; step++) {
        await elapse(50);
        waited += 50;
      }
      waits.push(waited);
    }

    expect(waits).toEqual([100, 200, 300, 300]);
  });

  it('repasse en direct, et relit ses données, quand le flux rouvert répond', async () => {
    const { states, onOpen } = connect();
    sources()[0]?.fail({ retrying: false });
    await elapse(1_000);

    sources()[1]?.open();

    expect(states).toEqual(['connecting', 'lost', 'live']);
    expect(onOpen).toHaveBeenCalledTimes(1);
  });

  it('ne se dit pas « en connexion » pendant une reconnexion : la perte reste affichée jusqu’au retour', async () => {
    const { states } = connect();
    sources()[0]?.open();
    sources()[0]?.fail({ retrying: false });
    await elapse(1_000);

    expect(states).toEqual(['connecting', 'live', 'lost']);
  });
});

describe('flux refusé (onRefused) : le navigateur abandonne sans dire pourquoi (relecture bdesk-38k.8)', () => {
  // EventSource ne montre pas le code HTTP : un 404 (Projet disparu), un 502 du proxy, une réponse qui n'est pas un flux
  // arrivent tous comme un flux CLOSED. L'appelant peut alors vérifier ce que le serveur sait encore du Projet.
  it('prévient l’appelant, une fois par refus, quand le navigateur abandonne le flux', async () => {
    const onRefused = vi.fn();
    connect({ onRefused });
    sources()[0]?.open();
    expect(onRefused).not.toHaveBeenCalled();

    sources()[0]?.fail({ retrying: false });
    expect(onRefused).toHaveBeenCalledTimes(1);

    await elapse(1_000); // le flux rouvert est refusé à son tour
    sources()[1]?.fail({ retrying: false });
    expect(onRefused).toHaveBeenCalledTimes(2);
  });

  it('prévient aussi quand la toute première connexion est refusée (Projet déjà disparu à l’ouverture)', () => {
    const onRefused = vi.fn();
    connect({ onRefused });

    sources()[0]?.fail({ retrying: false });

    expect(onRefused).toHaveBeenCalledTimes(1);
  });

  it('ne prévient pas d’une coupure en route : le navigateur retente de lui-même, le serveur est joignable ou non, mais le Projet est le même', async () => {
    const onRefused = vi.fn();
    connect({ onRefused });
    sources()[0]?.open();

    sources()[0]?.fail({ retrying: true });
    sources()[0]?.fail({ retrying: true });
    await elapse(60_000);

    expect(onRefused).not.toHaveBeenCalled();
  });

  it('continue de rouvrir le flux, comme avant : c’est l’appelant qui arrête la connexion si le Projet a disparu', async () => {
    connect({ onRefused: () => undefined });
    sources()[0]?.fail({ retrying: false });

    await elapse(1_000);

    expect(sources()).toHaveLength(2);
  });

  it('l’appelant qui ferme la connexion en étant prévenu l’arrête pour de bon : aucun flux rouvert, aucune minuterie', async () => {
    const holder: { connection?: LiveConnection } = {};
    holder.connection = connect({ onRefused: () => holder.connection?.close() }).connection;

    sources()[0]?.fail({ retrying: false });
    expect(vi.getTimerCount()).toBe(0); // pas même une minuterie en attente de se rendre compte que la connexion est fermée
    await elapse(60_000);

    expect(sources()).toHaveLength(1);
    expect(FakeEventSource.alive).toHaveLength(0);
  });

  it('ne prévient pas pour un flux abandonné, fermé ou mis en pause', async () => {
    const onRefused = vi.fn();
    const { connection } = connect({ onRefused });
    const first = sources()[0];
    connection.pause();

    first?.fail({ retrying: false }); // un refus tardif d'un flux que l'on a fermé

    expect(onRefused).not.toHaveBeenCalled();
    connection.close();
    first?.fail({ retrying: false });
    expect(onRefused).not.toHaveBeenCalled();
  });
});

describe('événements d’un flux remplacé', () => {
  it('ignore ce que dit un flux abandonné', async () => {
    const { onChange, onOpen, states } = connect();
    const old = sources()[0];
    old?.fail({ retrying: false });
    await elapse(1_000);

    old?.emit('changed');
    old?.open();

    expect(onChange).not.toHaveBeenCalled();
    expect(onOpen).not.toHaveBeenCalled();
    expect(states).toEqual(['connecting', 'lost']);
  });
});

describe('close', () => {
  it('ferme le flux et ne rouvre rien, ni ne signale plus rien', async () => {
    const { connection, states, onChange } = connect();
    const source = sources()[0];
    source?.open();

    connection.close();
    source?.emit('changed');
    source?.fail({ retrying: false });
    await elapse(60_000);

    expect(source?.readyState).toBe(FakeEventSource.CLOSED);
    expect(sources()).toHaveLength(1);
    expect(onChange).not.toHaveBeenCalled();
    expect(states).toEqual(['connecting', 'live']);
  });

  it('annule une reconnexion en attente', async () => {
    const { connection } = connect();
    sources()[0]?.fail({ retrying: false });

    connection.close();
    await elapse(60_000);

    expect(sources()).toHaveLength(1);
  });

  it('peut être appelé plusieurs fois, et rend pause, resume et reconnect sans effet', async () => {
    const { connection } = connect();
    connection.close();

    expect(() => {
      connection.close();
      connection.pause();
      connection.resume();
      connection.reconnect();
    }).not.toThrow();
    await elapse(10_000);
    expect(sources()).toHaveLength(1);
  });
});

describe('pause et reprise (onglet caché)', () => {
  it('ferme le flux en pause, sans rien signaler comme une perte', () => {
    const { connection, states } = connect();
    sources()[0]?.open();

    connection.pause();

    expect(FakeEventSource.alive).toHaveLength(0);
    expect(states).toEqual(['connecting', 'live', 'connecting']);
  });

  it('annule une reconnexion en attente', async () => {
    const { connection } = connect();
    sources()[0]?.fail({ retrying: false });

    connection.pause();
    await elapse(60_000);

    expect(sources()).toHaveLength(1);
  });

  it('rouvre aussitôt à la reprise : l’appelant relit alors ses données', () => {
    const { connection, onOpen } = connect();
    sources()[0]?.open();
    connection.pause();

    connection.resume();
    expect(sources()).toHaveLength(2);
    sources()[1]?.open();

    expect(onOpen).toHaveBeenCalledTimes(2);
  });

  it('ignore un événement du flux fermé par la pause', () => {
    const { connection, onChange } = connect();
    const source = sources()[0];
    source?.open();
    connection.pause();

    source?.emit('changed');

    expect(onChange).not.toHaveBeenCalled();
  });

  it('démarre en pause quand l’onglet est caché dès le départ : aucun flux avant la reprise', () => {
    const { connection } = connect({ paused: true });
    expect(sources()).toHaveLength(0);

    connection.resume();

    expect(sources()).toHaveLength(1);
  });

  it('une pause répétée, ou une reprise sans pause, ne multiplie pas les flux', () => {
    const { connection } = connect();
    connection.resume(); // pas en pause : rien à reprendre, le flux ouvert n'est pas remplacé
    expect(sources()).toHaveLength(1);
    connection.pause();
    connection.pause();
    connection.resume();
    connection.resume();

    expect(FakeEventSource.alive).toHaveLength(1);
  });

  it('reprend avec l’attente initiale, pas avec celle d’avant la pause', async () => {
    const { connection } = connect();
    sources()[0]?.fail({ retrying: false });
    await elapse(1_000);
    sources()[1]?.fail({ retrying: false });
    connection.pause();
    connection.resume();

    sources().at(-1)?.fail({ retrying: false });
    await elapse(1_000);

    expect(sources().length).toBeGreaterThanOrEqual(4);
  });
});

describe('reconnect (bouton « Reconnecter »)', () => {
  it('rouvre tout de suite, sans attendre le délai, et remet le délai à 1 seconde', async () => {
    const { connection } = connect();
    sources()[0]?.fail({ retrying: false });
    await elapse(1_000);
    sources()[1]?.fail({ retrying: false });
    await elapse(2_000);
    sources()[2]?.fail({ retrying: false }); // la prochaine attente serait de 4 s

    connection.reconnect();
    expect(sources()).toHaveLength(4);
    sources()[3]?.fail({ retrying: false });
    await elapse(1_000);

    expect(sources()).toHaveLength(5);
  });

  it('remplace un flux que le navigateur est en train de retenter', () => {
    const { connection } = connect();
    const retrying = sources()[0];
    retrying?.open();
    retrying?.fail({ retrying: true });

    connection.reconnect();

    expect(retrying?.readyState).toBe(FakeEventSource.CLOSED);
    expect(FakeEventSource.alive).toHaveLength(1);
    expect(sources()).toHaveLength(2);
  });

  it('annule la reconnexion en attente : un seul nouveau flux', async () => {
    const { connection } = connect();
    sources()[0]?.fail({ retrying: false });

    connection.reconnect();
    await elapse(60_000);

    expect(sources()).toHaveLength(2);
  });

  it('ne fait rien en pause', () => {
    const { connection } = connect();
    connection.pause();

    connection.reconnect();

    expect(FakeEventSource.alive).toHaveLength(0);
  });
});

describe('flux par défaut', () => {
  it('utilise EventSource quand aucune fabrique n’est donnée', () => {
    vi.stubGlobal('EventSource', FakeEventSource);
    try {
      connectLive({ url: URL, onChange: vi.fn(), onOpen: vi.fn(), onState: vi.fn() });
      expect(FakeEventSource.latest.url).toBe(URL);
    } finally {
      vi.unstubAllGlobals();
    }
  });
});
