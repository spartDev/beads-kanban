import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createHeadWatcher, DEFAULT_MAX_BACKOFF_MS, DEFAULT_POLL_INTERVAL_MS, type HeadChange, type HeadWatcher } from './watcher';

const INTERVAL = 3_000;

beforeEach(() => {
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

/** Un HEAD par Projet, que le test fait avancer comme le ferait un commit, ou fait échouer comme le ferait Dolt. */
function fakeHeads(initial: Record<string, string>) {
  const heads = { ...initial };
  const failures = new Map<string, unknown>();
  const reads: { projectId: string; at: number }[] = [];
  const read = vi.fn(async (projectId: string) => {
    reads.push({ projectId, at: Date.now() });
    if (failures.has(projectId)) throw failures.get(projectId);
    const head = heads[projectId];
    if (head === undefined) throw new Error(`Projet inconnu : ${projectId}`);
    return head;
  });
  return { heads, failures, reads, read };
}

const watcherOver = (read: (projectId: string) => Promise<string>, options: Partial<Parameters<typeof createHeadWatcher>[0]> = {}) =>
  createHeadWatcher({ head: read, intervalMs: INTERVAL, ...options });

/** Un abonné qui note ce qu'on lui annonce. */
function listener(): { changes: HeadChange[]; notify: (change: HeadChange) => void } {
  const changes: HeadChange[] = [];
  return { changes, notify: (change) => void changes.push(change) };
}

const elapse = (ms: number) => vi.advanceTimersByTimeAsync(ms);

describe('valeurs par défaut', () => {
  it('sonde toutes les 3 secondes, et ralentit jusqu’à une minute quand la lecture échoue', () => {
    expect(DEFAULT_POLL_INTERVAL_MS).toBe(3_000);
    expect(DEFAULT_MAX_BACKOFF_MS).toBe(60_000);
  });

  it('utilise l’intervalle par défaut quand aucun n’est donné', async () => {
    const { read, reads } = fakeHeads({ a: 'h1' });
    const watcher = createHeadWatcher({ head: read });
    watcher.subscribe('a', () => undefined);

    await elapse(0);
    expect(reads).toHaveLength(1);
    await elapse(DEFAULT_POLL_INTERVAL_MS - 1);
    expect(reads).toHaveLength(1);
    await elapse(1);
    expect(reads).toHaveLength(2);
    watcher.close();
  });
});

describe('sondage des seuls Projets suivis', () => {
  it('ne lit rien tant que personne ne suit un Projet', async () => {
    const { read } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);

    await elapse(10 * 60_000);

    expect(read).not.toHaveBeenCalled();
    expect(watcher.watched()).toEqual([]);
    watcher.close();
  });

  it('lit le HEAD dès l’abonnement : c’est l’état de départ, rien n’est annoncé', async () => {
    const { read, reads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();

    watcher.subscribe('a', notify);
    await elapse(0);

    expect(reads.map((r) => r.projectId)).toEqual(['a']);
    expect(changes).toEqual([]);
    expect(watcher.watched()).toEqual(['a']);
    watcher.close();
  });

  it('relit à chaque intervalle, ni plus tôt ni plus tard', async () => {
    const { read, reads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);

    await elapse(0);
    await elapse(INTERVAL - 1);
    expect(reads).toHaveLength(1);
    await elapse(1);
    expect(reads).toHaveLength(2);
    await elapse(INTERVAL);
    expect(reads).toHaveLength(3);
    watcher.close();
  });

  it('suit chaque Projet à part : seuls les Projets suivis sont lus', async () => {
    const { read, reads } = fakeHeads({ a: 'h1', b: 'h1', c: 'h1' });
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);
    watcher.subscribe('c', () => undefined);

    await elapse(INTERVAL * 2);

    expect([...new Set(reads.map((r) => r.projectId))].sort()).toEqual(['a', 'c']);
    expect(watcher.watched().sort()).toEqual(['a', 'c']);
    watcher.close();
  });
});

describe('annonce des changements', () => {
  it('annonce un nouveau HEAD une seule fois, avec le Projet et le hash', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);

    expect(changes).toEqual([{ projectId: 'a', head: 'h2' }]);
    await elapse(INTERVAL * 5);
    expect(changes).toHaveLength(1);
    watcher.close();
  });

  it('n’annonce rien tant que HEAD ne bouge pas, même après des heures de sondage (aucune boucle)', async () => {
    const { read, reads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);

    await elapse(2 * 3_600_000);

    expect(changes).toEqual([]);
    // Une lecture par intervalle (3 s) : 2 400 en deux heures, plus la première.
    expect(reads.length).toBe(2 * 3_600_000 / INTERVAL + 1);
    watcher.close();
  });

  it('annonce chaque nouveau commit, un événement par HEAD observé', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);
    heads.a = 'h3';
    await elapse(INTERVAL);

    expect(changes.map((c) => c.head)).toEqual(['h2', 'h3']);
    watcher.close();
  });

  it('regroupe les commits survenus entre deux lectures : seul le dernier HEAD est annoncé', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    heads.a = 'h2';
    heads.a = 'h3';
    heads.a = 'h4';
    await elapse(INTERVAL);

    expect(changes).toEqual([{ projectId: 'a', head: 'h4' }]);
    watcher.close();
  });

  it('un retour à un HEAD déjà vu est un changement comme un autre', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);
    heads.a = 'h1';
    await elapse(INTERVAL);

    expect(changes.map((c) => c.head)).toEqual(['h2', 'h1']);
    watcher.close();
  });

  it('n’annonce un changement qu’aux abonnés du Projet concerné', async () => {
    const { read, heads } = fakeHeads({ a: 'h1', b: 'h1' });
    const watcher = watcherOver(read);
    const onA = listener();
    const onB = listener();
    watcher.subscribe('a', onA.notify);
    watcher.subscribe('b', onB.notify);
    await elapse(0);

    heads.b = 'h2';
    await elapse(INTERVAL);

    expect(onA.changes).toEqual([]);
    expect(onB.changes).toEqual([{ projectId: 'b', head: 'h2' }]);
    watcher.close();
  });

  it('un abonné qui arrive après un changement ne reçoit pas le passé', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);
    await elapse(0);
    heads.a = 'h2';
    await elapse(INTERVAL);

    const late = listener();
    watcher.subscribe('a', late.notify);
    await elapse(INTERVAL * 3);

    expect(late.changes).toEqual([]);
    watcher.close();
  });
});

describe('abonnés partagés', () => {
  it('plusieurs abonnés d’un même Projet partagent une seule lecture par intervalle', async () => {
    const { read, reads, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const first = listener();
    const second = listener();
    watcher.subscribe('a', first.notify);
    watcher.subscribe('a', second.notify);
    watcher.subscribe('a', second.notify); // la même fonction, abonnée deux fois : deux abonnements

    await elapse(INTERVAL * 4);
    expect(reads).toHaveLength(5);

    heads.a = 'h2';
    await elapse(INTERVAL);
    expect(first.changes).toHaveLength(1);
    expect(second.changes).toHaveLength(2);
    watcher.close();
  });

  it('s’arrête quand le dernier abonné part : plus aucune lecture', async () => {
    const { read, reads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const stop = watcher.subscribe('a', () => undefined);
    await elapse(INTERVAL * 2);
    const before = reads.length;

    stop();
    await elapse(INTERVAL * 20);

    expect(reads).toHaveLength(before);
    expect(watcher.watched()).toEqual([]);
    watcher.close();
  });

  it('continue pour les abonnés restants quand l’un d’eux part', async () => {
    const { read, reads, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const staying = listener();
    const leaving = listener();
    const stopLeaving = watcher.subscribe('a', leaving.notify);
    watcher.subscribe('a', staying.notify);
    await elapse(0);

    stopLeaving();
    heads.a = 'h2';
    const before = reads.length;
    await elapse(INTERVAL);

    expect(reads.length).toBe(before + 1);
    expect(staying.changes).toHaveLength(1);
    expect(leaving.changes).toEqual([]);
    expect(watcher.watched()).toEqual(['a']);
    watcher.close();
  });

  it('se désabonner deux fois est sans effet sur les autres abonnés', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const staying = listener();
    const stop = watcher.subscribe('a', () => undefined);
    watcher.subscribe('a', staying.notify);
    await elapse(0);

    stop();
    stop();
    heads.a = 'h2';
    await elapse(INTERVAL);

    expect(staying.changes).toHaveLength(1);
    expect(watcher.watched()).toEqual(['a']);
    watcher.close();
  });

  it('repart de zéro quand quelqu’un suit de nouveau le Projet : un changement survenu entre-temps n’est pas annoncé', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const stop = watcher.subscribe('a', () => undefined);
    await elapse(0);
    stop();

    heads.a = 'h2'; // personne n'écoute : le client relit ses données à la connexion
    const later = listener();
    watcher.subscribe('a', later.notify);
    await elapse(INTERVAL * 3);

    expect(later.changes).toEqual([]);
    watcher.close();
  });
});

describe('une lecture à la fois par Projet', () => {
  it('ne lance pas une seconde lecture tant que la première dure, même au-delà de plusieurs intervalles', async () => {
    let release: (head: string) => void = () => undefined;
    const read = vi.fn(() => new Promise<string>((resolve) => (release = resolve)));
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);

    await elapse(INTERVAL * 10);
    expect(read).toHaveBeenCalledTimes(1);

    release('h1');
    await elapse(INTERVAL - 1);
    expect(read).toHaveBeenCalledTimes(1);
    await elapse(1);
    expect(read).toHaveBeenCalledTimes(2);
    watcher.close();
  });

  it('compte l’intervalle à partir de la fin de la lecture précédente', async () => {
    let calls = 0;
    const read = vi.fn(
      () =>
        new Promise<string>((resolve) => {
          calls++;
          setTimeout(() => resolve('h1'), 2_000); // une lecture lente : 2 s
        }),
    );
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);

    await elapse(0);
    expect(calls).toBe(1);
    await elapse(2_000 + INTERVAL - 1); // lecture finie à 2 s, la suivante part à 5 s
    expect(calls).toBe(1);
    await elapse(1);
    expect(calls).toBe(2);
    watcher.close();
  });

  it('lit des Projets différents en parallèle', async () => {
    const releases: Record<string, (head: string) => void> = {};
    const read = vi.fn((projectId: string) => new Promise<string>((resolve) => (releases[projectId] = resolve)));
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);
    watcher.subscribe('b', () => undefined);

    await elapse(0);

    expect(read.mock.calls.map(([id]) => id).sort()).toEqual(['a', 'b']);
    watcher.close();
  });
});

describe('Projet illisible, disparu ou erreur Dolt', () => {
  it('ne plante pas et réessaie, de plus en plus lentement, jusqu’au plafond', async () => {
    const { read, reads, failures } = fakeHeads({ a: 'h1' });
    failures.set('a', new Error('base verrouillée'));
    const watcher = watcherOver(read, { maxBackoffMs: 40_000 });
    watcher.subscribe('a', () => undefined);

    await elapse(10 * 60_000);

    // Lectures à 0, puis +6 s, +12 s, +24 s, +40 s (plafond), +40 s…
    const gaps = reads.slice(1, 7).map((r, i) => (r.at - (reads[i]?.at ?? 0)) / 1_000);
    expect(gaps).toEqual([6, 12, 24, 40, 40, 40]);
    watcher.close();
  });

  it('plafonne par défaut à une minute', async () => {
    const { read, reads, failures } = fakeHeads({ a: 'h1' });
    failures.set('a', new Error('illisible'));
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);

    await elapse(30 * 60_000);

    const gaps = reads.slice(1).map((r, i) => r.at - (reads[i]?.at ?? 0));
    expect(Math.max(...gaps)).toBe(60_000);
    expect(gaps.at(-1)).toBe(60_000);
    watcher.close();
  });

  it('reprend le rythme normal dès qu’une lecture réussit', async () => {
    const { read, reads, failures } = fakeHeads({ a: 'h1' });
    failures.set('a', new Error('base verrouillée'));
    const watcher = watcherOver(read);
    watcher.subscribe('a', () => undefined);
    await elapse(6_000 + 12_000); // trois lectures en échec : 0 s, 6 s, 18 s

    failures.delete('a');
    await elapse(24_000); // la quatrième réussit
    const afterRecovery = reads.length;
    await elapse(INTERVAL);

    expect(reads.length).toBe(afterRecovery + 1);
    watcher.close();
  });

  it('annonce, une fois rétabli, ce qui a changé pendant la panne', async () => {
    const { read, heads, failures } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    failures.set('a', new Error('base verrouillée'));
    await elapse(INTERVAL * 10);
    heads.a = 'h2';
    failures.delete('a');
    await elapse(60_000);

    expect(changes).toEqual([{ projectId: 'a', head: 'h2' }]);
    watcher.close();
  });

  it('n’annonce rien si HEAD est le même qu’avant la panne', async () => {
    const { read, failures } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(0);

    failures.set('a', new Error('base verrouillée'));
    await elapse(INTERVAL * 10);
    failures.delete('a');
    await elapse(60_000);

    expect(changes).toEqual([]);
    watcher.close();
  });

  it('prend la première lecture réussie pour état de départ, quand le Projet était illisible dès le début', async () => {
    const { read, heads, failures } = fakeHeads({ a: 'h1' });
    failures.set('a', new Error('illisible'));
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(INTERVAL * 5);

    failures.delete('a');
    await elapse(60_000); // lecture réussie : état de départ
    expect(changes).toEqual([]);
    heads.a = 'h2';
    await elapse(INTERVAL);
    expect(changes).toEqual([{ projectId: 'a', head: 'h2' }]);
    watcher.close();
  });

  it('rapporte chaque échec à onError, avec le Projet et l’erreur', async () => {
    const { read, failures } = fakeHeads({ a: 'h1' });
    const failure = new Error('base verrouillée');
    failures.set('a', failure);
    const onError = vi.fn();
    const watcher = watcherOver(read, { onError });
    watcher.subscribe('a', () => undefined);

    await elapse(0);
    await elapse(INTERVAL * 2);

    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith('a', failure);
    watcher.close();
  });

  describe('onRecover : le rétablissement d’un Projet (relecture bdesk-38k.8 : un seul message par changement d’état)', () => {
    it('annonce, avec le Projet, la première lecture réussie qui suit une panne : une fois par panne', async () => {
      const { read, failures } = fakeHeads({ a: 'h1' });
      const onRecover = vi.fn();
      const watcher = watcherOver(read, { onRecover });
      watcher.subscribe('a', () => undefined);
      await elapse(INTERVAL * 3);
      expect(onRecover).not.toHaveBeenCalled(); // pas de panne : rien à rétablir

      failures.set('a', new Error('base verrouillée'));
      await elapse(60_000);
      expect(onRecover).not.toHaveBeenCalled(); // la panne dure

      failures.delete('a');
      await elapse(60_000);
      expect(onRecover).toHaveBeenCalledTimes(1);
      expect(onRecover).toHaveBeenCalledWith('a');

      await elapse(INTERVAL * 10);
      expect(onRecover).toHaveBeenCalledTimes(1); // les lectures suivantes sont ordinaires

      failures.set('a', new Error('à nouveau'));
      await elapse(60_000);
      failures.delete('a');
      await elapse(60_000);
      expect(onRecover).toHaveBeenCalledTimes(2); // une autre panne, un autre rétablissement
      watcher.close();
    });

    it('annonce aussi le rétablissement d’un Projet illisible dès le début', async () => {
      const { read, failures } = fakeHeads({ a: 'h1' });
      failures.set('a', new Error('illisible'));
      const onRecover = vi.fn();
      const watcher = watcherOver(read, { onRecover });
      watcher.subscribe('a', () => undefined);
      await elapse(INTERVAL * 5);

      failures.delete('a');
      await elapse(60_000);

      expect(onRecover).toHaveBeenCalledTimes(1);
      watcher.close();
    });

    it('ne parle que du Projet rétabli', async () => {
      const { read, failures } = fakeHeads({ a: 'h1', b: 'h1' });
      failures.set('a', new Error('illisible'));
      const onRecover = vi.fn();
      const watcher = watcherOver(read, { onRecover });
      watcher.subscribe('a', () => undefined);
      watcher.subscribe('b', () => undefined);
      await elapse(INTERVAL * 5);

      failures.delete('a');
      await elapse(60_000);

      expect(onRecover.mock.calls).toEqual([['a']]);
      watcher.close();
    });

    it('survit à un onRecover qui lève : le sondage continue et l’annonce du changement n’est pas perdue', async () => {
      const { read, heads, failures } = fakeHeads({ a: 'h1' });
      let recovered = 0;
      const watcher = watcherOver(read, {
        onRecover: () => {
          recovered++;
          throw new Error('journal en panne');
        },
      });
      const { changes, notify } = listener();
      watcher.subscribe('a', notify);
      await elapse(0);
      failures.set('a', new Error('base verrouillée'));
      await elapse(INTERVAL * 3);

      failures.delete('a');
      heads.a = 'h2';
      await elapse(60_000);

      expect(recovered).toBe(1);
      expect(changes).toEqual([{ projectId: 'a', head: 'h2' }]);
      heads.a = 'h3';
      await elapse(INTERVAL);
      expect(changes).toHaveLength(2);
      watcher.close();
    });

    it('n’annonce rien d’un Projet que plus personne ne suit', async () => {
      const { read, failures } = fakeHeads({ a: 'h1' });
      failures.set('a', new Error('illisible'));
      const onRecover = vi.fn();
      const watcher = watcherOver(read, { onRecover });
      const unsubscribe = watcher.subscribe('a', () => undefined);
      await elapse(INTERVAL * 5);

      unsubscribe();
      failures.delete('a');
      await elapse(5 * 60_000);

      expect(onRecover).not.toHaveBeenCalled();
      watcher.close();
    });
  });

  it('survit à un onError qui lève, et à une lecture qui lève sans promesse', async () => {
    const reads: number[] = [];
    const read = vi.fn((): Promise<string> => {
      reads.push(Date.now());
      throw new TypeError('lève au lieu de rejeter');
    });
    const watcher = watcherOver(read, {
      onError: () => {
        throw new Error('journal en panne');
      },
    });
    watcher.subscribe('a', () => undefined);

    await elapse(INTERVAL * 6);

    expect(reads.length).toBeGreaterThan(1); // le sondage continue
    watcher.close();
  });

  it('un Projet en panne n’empêche pas la lecture des autres', async () => {
    const { read, heads, failures } = fakeHeads({ a: 'h1', b: 'h1' });
    failures.set('a', new Error('illisible'));
    const watcher = watcherOver(read);
    const onB = listener();
    watcher.subscribe('a', () => undefined);
    watcher.subscribe('b', onB.notify);
    await elapse(0);

    heads.b = 'h2';
    await elapse(INTERVAL);

    expect(onB.changes).toEqual([{ projectId: 'b', head: 'h2' }]);
    watcher.close();
  });
});

describe('abonnés défaillants', () => {
  it('un abonné qui lève n’empêche ni les autres d’être prévenus, ni le sondage de continuer', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const onError = vi.fn();
    const watcher = watcherOver(read, { onError });
    const healthy = listener();
    watcher.subscribe('a', () => {
      throw new Error('abonné cassé');
    });
    watcher.subscribe('a', healthy.notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);
    heads.a = 'h3';
    await elapse(INTERVAL);

    expect(healthy.changes.map((c) => c.head)).toEqual(['h2', 'h3']);
    // Le défaut n'est pas passé sous silence : il est rapporté comme tout ce que le sondage avale.
    expect(onError).toHaveBeenCalledTimes(2);
    expect(onError).toHaveBeenCalledWith('a', expect.objectContaining({ message: 'abonné cassé' }));
    watcher.close();
  });

  it('un abonné peut se désabonner pendant qu’on le prévient', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const other = listener();
    let stop: () => void = () => undefined;
    stop = watcher.subscribe('a', () => stop());
    watcher.subscribe('a', other.notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);

    expect(other.changes).toHaveLength(1);
    watcher.close();
  });
});

describe('le dernier abonné part en étant prévenu', () => {
  it('le sondage s’arrête : ni minuterie ni lecture ne survivent à son départ', async () => {
    const { read, reads, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    let stop: () => void = () => undefined;
    stop = watcher.subscribe('a', () => stop());
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL); // annoncé : l'abonné se désabonne
    const after = reads.length;
    await elapse(INTERVAL * 20);

    expect(reads).toHaveLength(after);
    expect(watcher.watched()).toEqual([]);
    expect(vi.getTimerCount()).toBe(0);
    watcher.close();
  });
});

describe('abonnés qui se désabonnent entre eux', () => {
  it('un abonné désabonné par un autre pendant la même annonce n’est plus prévenu', async () => {
    const { read, heads } = fakeHeads({ a: 'h1' });
    const watcher = watcherOver(read);
    const second = listener();
    let stopSecond: () => void = () => undefined;
    watcher.subscribe('a', () => stopSecond());
    stopSecond = watcher.subscribe('a', second.notify);
    await elapse(0);

    heads.a = 'h2';
    await elapse(INTERVAL);

    expect(second.changes).toEqual([]);
    watcher.close();
  });
});

describe('désabonnement pendant une lecture', () => {
  it('n’annonce rien de ce que la lecture rapporte après le départ du dernier abonné, et ne relit plus', async () => {
    let release: (head: string) => void = () => undefined;
    let first = true;
    const read = vi.fn((): Promise<string> => {
      if (first) {
        first = false;
        return Promise.resolve('h1');
      }
      return new Promise((resolve) => (release = resolve));
    });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    const stop = watcher.subscribe('a', notify);
    await elapse(INTERVAL); // la seconde lecture est en cours

    stop();
    release('h2');
    await elapse(INTERVAL * 10);

    expect(changes).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
    expect(watcher.watched()).toEqual([]);
    watcher.close();
  });

  it('un abonné qui revient pendant la lecture reprend celle-ci : jamais deux lectures en même temps', async () => {
    let release: (head: string) => void = () => undefined;
    let inFlight = 0;
    let peak = 0;
    let first = true;
    const read = vi.fn((): Promise<string> => {
      if (first) {
        first = false;
        return Promise.resolve('h1');
      }
      inFlight++;
      peak = Math.max(peak, inFlight);
      return new Promise((resolve) => {
        release = (head) => {
          inFlight--;
          resolve(head);
        };
      });
    });
    const watcher = watcherOver(read);
    const stop = watcher.subscribe('a', () => undefined);
    await elapse(INTERVAL); // lecture lente en cours

    stop();
    const back = listener();
    watcher.subscribe('a', back.notify);
    await elapse(INTERVAL * 5);
    expect(read).toHaveBeenCalledTimes(2);

    release('h1');
    await elapse(INTERVAL);
    expect(peak).toBe(1);
    expect(read).toHaveBeenCalledTimes(3);
    watcher.close();
  });
});

describe('close', () => {
  it('arrête tout : plus de lecture, plus d’annonce', async () => {
    const { read, reads, heads } = fakeHeads({ a: 'h1', b: 'h1' });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    watcher.subscribe('b', notify);
    await elapse(0);
    const before = reads.length;

    watcher.close();
    heads.a = 'h2';
    await elapse(INTERVAL * 20);

    expect(reads).toHaveLength(before);
    expect(changes).toEqual([]);
    expect(watcher.watched()).toEqual([]);
  });

  it('ignore le résultat d’une lecture qui se termine après la fermeture', async () => {
    let release: (head: string) => void = () => undefined;
    let first = true;
    const read = vi.fn((): Promise<string> => {
      if (first) {
        first = false;
        return Promise.resolve('h1');
      }
      return new Promise((resolve) => (release = resolve));
    });
    const watcher = watcherOver(read);
    const { changes, notify } = listener();
    watcher.subscribe('a', notify);
    await elapse(INTERVAL);

    watcher.close();
    release('h2');
    await elapse(INTERVAL * 5);

    expect(changes).toEqual([]);
    expect(read).toHaveBeenCalledTimes(2);
  });

  it('refuse les nouveaux abonnements : rien n’est lu', async () => {
    const { read } = fakeHeads({ a: 'h1' });
    const watcher: HeadWatcher = watcherOver(read);
    watcher.close();

    const stop = watcher.subscribe('a', () => undefined);
    await elapse(INTERVAL * 5);
    stop();

    expect(read).not.toHaveBeenCalled();
    expect(watcher.watched()).toEqual([]);
  });

  it('peut être appelé plusieurs fois', () => {
    const watcher = watcherOver(fakeHeads({}).read);
    watcher.close();
    expect(() => watcher.close()).not.toThrow();
  });
});
