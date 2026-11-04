import { QueryClient, QueryObserver } from '@tanstack/react-query';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { queryKeys } from '../data/hooks';
import { refreshProject, resyncProject } from './refresh';

/**
 * Relecture après un commit (bdesk-38k.8, relecture B2) : une lecture plus longue que l'écart entre deux commits ne doit
 * pas être interrompue par chacun d'eux, sans quoi elle ne s'achève jamais et l'écran reste sur une donnée périmée.
 * Une requête n'a jamais plus d'une lecture en cours ; les commits arrivés pendant celle-ci en font relire UNE après.
 */

let client: QueryClient;

beforeEach(() => {
  client = new QueryClient({ defaultOptions: { queries: { retry: false } } });
});

afterEach(() => {
  vi.useRealTimers();
  client.clear();
});

/** Laisse passer les tâches en attente (notifications de TanStack Query comprises). */
async function flush(): Promise<void> {
  for (let i = 0; i < 3; i++) await new Promise<void>((resolve) => setTimeout(resolve, 0));
}

interface Read {
  n: number;
  aborted: boolean;
  finish: (data: string) => void;
  fail: (message: string) => void;
}

/** Une requête dont chaque lecture reste en cours jusqu'à ce que le test la termine. */
function heldQuery(key: readonly unknown[]) {
  const reads: Read[] = [];
  const running = { now: 0, max: 0 };
  const queryFn = ({ signal }: { signal: AbortSignal }) =>
    new Promise<string>((resolve, reject) => {
      running.max = Math.max(running.max, ++running.now);
      const read: Read = {
        n: reads.length + 1,
        aborted: false,
        finish: (data) => {
          running.now--;
          resolve(data);
        },
        fail: (message) => {
          running.now--;
          reject(new Error(message));
        },
      };
      signal.addEventListener('abort', () => {
        running.now--;
        read.aborted = true;
        reject(signal.reason);
      });
      reads.push(read);
    });
  const observer = new QueryObserver(client, { queryKey: key, queryFn, staleTime: 15_000 });
  const unsubscribe = observer.subscribe(() => undefined);
  const state = () => client.getQueryState<string>(key);
  return { reads, running, observer, unsubscribe, state, data: () => state()?.data };
}

/** Une lecture à laquelle la requête a déjà répondu `first` : la requête a des données, ce qui rend une lecture interruptible. */
async function loaded(key: readonly unknown[], first = 'v1') {
  const held = heldQuery(key);
  await flush();
  held.reads[0]?.finish(first);
  await flush();
  expect(held.data()).toBe(first);
  return held;
}

const LIST = queryKeys.issues('bdesk');
const DETAIL = queryKeys.issue('bdesk', 'bdesk-a');

describe('refreshProject : une lecture en cours n’est pas interrompue', () => {
  it('sans lecture en cours, relit aussitôt : une lecture, comme avant', async () => {
    const held = await loaded(LIST);

    void refreshProject(client, 'bdesk');
    await flush();

    expect(held.reads).toHaveLength(2);
    held.reads[1]?.finish('v2');
    await flush();
    expect(held.data()).toBe('v2');
  });

  it('un commit pendant une lecture ne l’annule pas : elle s’achève, et ses données s’affichent', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch(); // une lecture en cours (focus de la fenêtre, par exemple), qui a déjà des données à garder
    await flush();
    expect(held.reads).toHaveLength(2);

    void refreshProject(client, 'bdesk'); // un commit annoncé par le flux
    await flush();

    expect(held.reads[1]?.aborted).toBe(false);
    expect(held.reads).toHaveLength(2); // pas de seconde lecture en même temps
    held.reads[1]?.finish('v2');
    await flush();
    expect(held.data()).toBe('v2'); // la lecture en cours a pu s'afficher
  });

  it('relit une seule fois après elle : la lecture en cours a pu précéder le commit', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch();
    await flush();
    void refreshProject(client, 'bdesk');
    await flush();

    held.reads[1]?.finish('v2');
    await flush();

    expect(held.reads).toHaveLength(3); // la relecture qui rattrape le commit
    expect(held.reads[2]?.aborted).toBe(false);
    held.reads[2]?.finish('v3');
    await flush();
    expect(held.data()).toBe('v3');
    await flush();
    expect(held.reads).toHaveLength(3); // et c'est tout : plus rien ne se relit
  });

  it('plusieurs commits pendant la même lecture n’en font relire qu’une', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch();
    await flush();

    for (let i = 0; i < 6; i++) void refreshProject(client, 'bdesk');
    await flush();
    expect(held.reads).toHaveLength(2);
    held.reads[1]?.finish('v2');
    await flush();

    expect(held.reads).toHaveLength(3);
    held.reads[2]?.finish('v3');
    await flush();
    await flush();
    expect(held.reads).toHaveLength(3);
  });

  it('un commit pendant la relecture de rattrapage en programme une autre, jamais deux lectures à la fois', async () => {
    const held = await loaded(LIST);

    void refreshProject(client, 'bdesk'); // R2 : immédiate
    await flush();
    void refreshProject(client, 'bdesk'); // pendant R2 : R3 est programmée
    await flush();
    held.reads[1]?.finish('v2');
    await flush();
    void refreshProject(client, 'bdesk'); // pendant R3 : R4 est programmée
    await flush();
    held.reads[2]?.finish('v3');
    await flush();
    held.reads[3]?.finish('v4');
    await flush();

    expect(held.reads).toHaveLength(4);
    expect(held.reads.some((read) => read.aborted)).toBe(false);
    expect(held.running.max).toBe(1);
    expect(held.data()).toBe('v4');
  });

  it('une relecture qui répond instantanément ne fait pas relire de plus les commits qui l’attendaient', async () => {
    let calls = 0;
    let release: (data: string) => void = () => undefined;
    const queryFn = () => {
      calls++;
      if (calls === 2) return new Promise<string>((resolve) => (release = resolve)); // la seule lecture lente
      return Promise.resolve(`v${calls}`);
    };
    const observer = new QueryObserver(client, { queryKey: LIST, queryFn, staleTime: 15_000 });
    const unsubscribe = observer.subscribe(() => undefined);
    await flush();
    void observer.refetch();
    await flush();
    expect(calls).toBe(2);

    for (let i = 0; i < 5; i++) void refreshProject(client, 'bdesk'); // cinq commits pendant la lecture lente
    await flush();
    expect(calls).toBe(2);
    release('v2');
    await flush();
    await flush();

    expect(calls).toBe(3); // une relecture, pas cinq
    expect(client.getQueryData(LIST)).toBe('v3');
    unsubscribe();
  });

  it('relit aussi après une lecture qui échoue : l’échec ne perd pas le commit', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch();
    await flush();
    void refreshProject(client, 'bdesk');
    await flush();

    held.reads[1]?.fail('serveur coupé');
    await flush();

    expect(held.reads).toHaveLength(3);
    held.reads[2]?.finish('v3');
    await flush();
    expect(held.data()).toBe('v3');
    expect(held.state()?.status).toBe('success');
  });

  it('chaque requête a sa file : une lecture lente ne retarde pas la relecture des autres', async () => {
    const list = await loaded(LIST);
    const detail = await loaded(DETAIL, 'fiche 1');
    void detail.observer.refetch(); // la fiche (ou sa chronologie, plus longue) est en cours de lecture
    await flush();

    void refreshProject(client, 'bdesk');
    await flush();

    expect(list.reads).toHaveLength(2); // la liste est relue aussitôt
    expect(detail.reads).toHaveLength(2); // la fiche attend la fin de sa lecture
    list.reads[1]?.finish('liste 2');
    await flush();
    expect(list.data()).toBe('liste 2');
    detail.reads[1]?.finish('fiche 2');
    await flush();
    expect(detail.reads).toHaveLength(3);
    detail.reads[2]?.finish('fiche 3');
    await flush();
    expect(detail.data()).toBe('fiche 3');
  });

  it('ne relit pas, après coup, ce que plus personne n’affiche : la requête est seulement marquée périmée', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch();
    await flush();
    void refreshProject(client, 'bdesk');
    await flush();

    held.unsubscribe(); // on a quitté la page pendant la lecture
    held.reads[1]?.finish('v2');
    await flush();
    await flush();

    expect(held.reads).toHaveLength(2); // aucune lecture pour personne
    expect(held.state()?.isInvalidated).toBe(true); // elle sera relue au prochain affichage
  });

  it('marque périmées les requêtes que personne n’affiche, sans les lire', async () => {
    const hidden = await loaded(DETAIL);
    hidden.unsubscribe();
    const reads = hidden.reads.length;

    void refreshProject(client, 'bdesk');
    await flush();

    expect(hidden.reads).toHaveLength(reads);
    expect(hidden.state()?.isInvalidated).toBe(true);
  });

  it('ne touche ni aux requêtes d’un autre Projet, ni à la liste des Projets, ni aux métriques', async () => {
    const mine = await loaded(LIST);
    const other = await loaded(queryKeys.issues('mpm'));
    const projects = await loaded(queryKeys.projects);
    const metrics = await loaded(['metrics', 'bdesk', '30d']);

    void refreshProject(client, 'bdesk');
    await flush();

    expect(mine.reads).toHaveLength(2);
    expect(other.reads).toHaveLength(1);
    expect(projects.reads).toHaveLength(1);
    expect(metrics.reads).toHaveLength(1);
    expect(other.state()?.isInvalidated).toBe(false);
  });

  it('résout quand les données du commit sont relues', async () => {
    const held = await loaded(LIST);
    void held.observer.refetch();
    await flush();
    let done = false;
    void refreshProject(client, 'bdesk').then(() => {
      done = true;
    });
    await flush();
    held.reads[1]?.finish('v2');
    await flush();
    expect(done).toBe(false); // la relecture de rattrapage est encore à faire

    held.reads[2]?.finish('v3');
    await flush();
    await flush();

    expect(done).toBe(true);
  });
});

describe('une lecture plus longue que l’écart entre deux commits (scénario de la relecture)', () => {
  const READ_MS = 4_000;
  const COMMIT_EVERY_MS = 3_000;
  const COMMITS = 10;

  it('ne manque jamais de données récentes : aucune lecture annulée, des données neuves à chaque lecture, et l’écran finit sur une lecture postérieure au dernier commit', async () => {
    vi.useFakeTimers();
    const t0 = Date.now();
    const now = () => Date.now() - t0;
    const log = { started: [] as number[], completed: [] as number[], aborted: [] as number[], inFlight: 0, maxInFlight: 0 };
    const observer = new QueryObserver(client, {
      queryKey: [...queryKeys.issues('bdesk'), 'bdesk-a', 'chronology'],
      queryFn: ({ signal }) =>
        new Promise<{ startedAt: number }>((resolve, reject) => {
          const startedAt = now();
          log.started.push(startedAt);
          log.maxInFlight = Math.max(log.maxInFlight, ++log.inFlight);
          const timer = setTimeout(() => {
            log.inFlight--;
            log.completed.push(now());
            resolve({ startedAt });
          }, READ_MS);
          signal.addEventListener('abort', () => {
            log.inFlight--;
            log.aborted.push(now());
            clearTimeout(timer);
            reject(signal.reason);
          });
        }),
    });
    const shown: { at: number; startedAt: number }[] = []; // ce que l'écran a affiché, et quand
    const unsubscribe = observer.subscribe((result) => {
      if (result.data && result.data.startedAt !== shown.at(-1)?.startedAt) shown.push({ at: now(), startedAt: result.data.startedAt });
    });

    for (let i = 1; i <= COMMITS; i++) {
      await vi.advanceTimersByTimeAsync(COMMIT_EVERY_MS);
      void refreshProject(client, 'bdesk'); // un commit annoncé par le flux, à i × 3 s
    }
    const lastCommit = now();
    await vi.advanceTimersByTimeAsync(2 * READ_MS + 100); // la lecture en cours finit, puis la relecture qui rattrape le dernier commit
    const reads = log.started.length;
    await vi.advanceTimersByTimeAsync(60_000); // plus aucun commit : plus aucune lecture
    unsubscribe();

    expect(log.aborted).toEqual([]);
    expect(log.maxInFlight).toBe(1);
    // L'écran avance tout le long : jamais plus d'une durée de lecture entre deux affichages (avant : un seul, au tout début).
    const gaps = shown.slice(1).map((entry, i) => entry.at - (shown[i]?.at ?? 0));
    expect(shown.length).toBeGreaterThan(COMMITS / 2);
    expect(Math.max(...gaps)).toBeLessThanOrEqual(READ_MS);
    // Et il finit sur une lecture lancée après le dernier commit.
    expect(shown.at(-1)?.startedAt).toBeGreaterThanOrEqual(lastCommit);
    expect(log.started).toHaveLength(reads);
  });
});

describe('resyncProject : l’ouverture du flux ne coupe pas non plus ce qui se lit', () => {
  it('relit ce qui est au repos et laisse finir ce qui se lit', async () => {
    const idle = await loaded(LIST);
    const reading = await loaded(DETAIL);
    void reading.observer.refetch();
    await flush();

    void resyncProject(client, 'bdesk');
    await flush();

    expect(idle.reads).toHaveLength(2);
    expect(reading.reads).toHaveLength(2);
    expect(reading.reads[1]?.aborted).toBe(false);
  });

  describe('la liste des Projets dont le dernier rafraîchissement a échoué (relecture bdesk-38k.8 : un seul message cohérent)', () => {
    // Le serveur était coupé : le rafraîchissement de la liste des Projets (focus de la fenêtre) a échoué. À son retour, le flux
    // se rouvre : tout est relu, sans quoi « Actualisation impossible » survivrait à la reconnexion.
    async function failedProjects() {
      const projects = await loaded(queryKeys.projects);
      void projects.observer.refetch();
      await flush();
      projects.reads[1]?.fail('serveur coupé');
      await flush();
      expect(projects.state()?.status).toBe('error');
      return projects;
    }

    it('est relue à l’ouverture du flux', async () => {
      const projects = await failedProjects();

      void resyncProject(client, 'bdesk');
      await flush();

      expect(projects.reads).toHaveLength(3);
      projects.reads[2]?.finish('liste 3');
      await flush();
      expect(projects.state()?.status).toBe('success');
    });

    it('n’est pas relue quand elle va bien', async () => {
      const projects = await loaded(queryKeys.projects);

      void resyncProject(client, 'bdesk');
      await flush();

      expect(projects.reads).toHaveLength(1);
    });

    it('n’est pas relue si elle se relit déjà', async () => {
      const projects = await failedProjects();
      void projects.observer.refetch();
      await flush();
      expect(projects.reads).toHaveLength(3);

      void resyncProject(client, 'bdesk');
      await flush();

      expect(projects.reads).toHaveLength(3);
      expect(projects.reads[2]?.aborted).toBe(false);
    });

    it('ne touche pas aux autres requêtes en échec (les métriques ne sont pas en direct)', async () => {
      const metrics = await loaded(['metrics', 'bdesk', '30d']);
      void metrics.observer.refetch();
      await flush();
      metrics.reads[1]?.fail('serveur coupé');
      await flush();

      void resyncProject(client, 'bdesk');
      await flush();

      expect(metrics.reads).toHaveLength(2);
    });
  });
});
