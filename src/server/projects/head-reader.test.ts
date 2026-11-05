import { describe, expect, it } from 'vitest';
import { ReadAborted } from '../abort';
import { createHeadReader } from './head-reader';
import { type ReadOptions, ProjectUnreadableError } from './service';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/**
 * Un service dont chaque lecture du HEAD est finie à la main par le test, dans l'ordre où elles sont parties. Il garde le signal que la lecture
 * a reçu (celui qui, abandonné, la retire de la file de la voie `light` : bdesk-38k.42) ; il ne l'écoute pas, comme une lecture déjà lancée.
 * `done` : la lecture est finie (le test l'a finie ou l'a fait échouer), donc son processus ne tient plus de place.
 */
function manualHeads() {
  const reads: { projectId: string; signal: AbortSignal | undefined; done: boolean; finish: (head: string) => void; fail: (error: Error) => void }[] = [];
  const projects = {
    head: (projectId: string, options?: ReadOptions) =>
      new Promise<string>((resolve, reject) => {
        const read = {
          projectId,
          signal: options?.signal,
          done: false,
          finish: (head: string) => {
            read.done = true;
            resolve(head);
          },
          fail: (error: Error) => {
            read.done = true;
            reject(error);
          },
        };
        reads.push(read);
      }),
  };
  return { projects, reads };
}

describe('lecteur du HEAD', () => {
  it('lit le HEAD de chaque Projet, et le rend', async () => {
    const readHead = createHeadReader({ head: async (projectId) => `head-de-${projectId}` });

    expect(await readHead('a')).toBe('head-de-a');
    expect(await readHead('b')).toBe('head-de-b');
  });

  it('relit pour une demande qui arrive après la fin de la lecture précédente', async () => {
    let head = 'h1';
    let reads = 0;
    const readHead = createHeadReader({
      head: async () => {
        reads++;
        return head;
      },
    });

    expect(await readHead('a')).toBe('h1');
    head = 'h2';
    expect(await readHead('a')).toBe('h2');
    expect(reads).toBe(2);
  });

  it('trente demandes ensemble : une lecture en cours, une pour toutes celles qui attendaient', async () => {
    const { projects, reads } = manualHeads();
    const readHead = createHeadReader(projects);

    const all = Array.from({ length: 30 }, () => readHead('a'));
    await sleep(5);
    expect(reads).toHaveLength(1);
    reads[0]?.finish('h1');
    await sleep(5);
    expect(reads).toHaveLength(2);
    reads[1]?.finish('h2');

    const heads = await Promise.all(all);
    expect(heads[0]).toBe('h1'); // la première demande, servie par la première lecture
    expect(new Set(heads.slice(1))).toEqual(new Set(['h2'])); // les 29 autres, par une lecture lancée après leur arrivée
  });

  it('ne partage rien entre deux Projets', async () => {
    const { projects, reads } = manualHeads();
    const readHead = createHeadReader(projects);

    void readHead('a');
    void readHead('b');
    await sleep(5);

    expect(reads.map((read) => read.projectId)).toEqual(['a', 'b']);
  });

  it('l’échec d’une lecture ne condamne pas les demandes qui attendaient la suivante', async () => {
    const { projects, reads } = manualHeads();
    const readHead = createHeadReader(projects);
    const first = readHead('a');
    const second = readHead('a');
    await sleep(5);

    reads[0]?.fail(new ProjectUnreadableError('a', 'verrou'));
    await expect(first).rejects.toBeInstanceOf(ProjectUnreadableError);
    await sleep(5);
    reads[1]?.finish('h1');

    await expect(second).resolves.toBe('h1');
  });

  describe('demandes abandonnées', () => {
    it('une demande abandonnée est libérée aussitôt, sans attendre la lecture', async () => {
      const { projects } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      const waiting = readHead('a', controller.signal).catch((e: unknown) => e);
      await sleep(5);

      controller.abort();

      expect(await waiting).toBeInstanceOf(ReadAborted);
    });

    it('elle n’interrompt pas la lecture que les autres partagent', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const leaving = new AbortController();
      const gone = readHead('a', leaving.signal).catch((e: unknown) => e);
      const stays = readHead('a');
      await sleep(5);

      leaving.abort();
      expect(await gone).toBeInstanceOf(ReadAborted);
      reads[0]?.finish('h1');
      await sleep(5);
      reads[1]?.finish('h2');

      expect(await stays).toBe('h2');
    });

    it('un signal déjà abandonné ne lance aucune lecture', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      controller.abort();

      await expect(readHead('a', controller.signal)).rejects.toBeInstanceOf(ReadAborted);

      expect(reads).toHaveLength(0);
    });

    it('la lecture abandonnée par tous qui échoue ensuite ne fait aucun rejet non géré', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      const unhandled: unknown[] = [];
      const collect = (reason: unknown) => unhandled.push(reason);
      process.on('unhandledRejection', collect);
      try {
        const waiting = readHead('a', controller.signal).catch(() => undefined);
        await sleep(5);
        controller.abort();
        await waiting;
        reads[0]?.fail(new Error('échec tardif'));
        await sleep(20);
      } finally {
        process.off('unhandledRejection', collect);
      }

      expect(unhandled).toEqual([]);
    });
  });
  describe('lectures encore en file (bdesk-38k.42)', () => {
    it('la lecture reçoit un signal, abandonné quand son dernier demandeur part : encore en file, elle en sort', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      const waiting = readHead('a', controller.signal).catch((e: unknown) => e);
      await sleep(5);
      expect(reads[0]?.signal?.aborted).toBe(false);

      controller.abort();

      expect(reads[0]?.signal?.aborted).toBe(true);
      expect(await waiting).toBeInstanceOf(ReadAborted);
    });

    it('une lecture que plusieurs demandes attendent ensemble n’est abandonnée que par la dernière qui part', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      void readHead('a'); // la lecture en cours : les deux suivantes attendent la lecture d'après, qu'elles partagent
      const first = new AbortController();
      const second = new AbortController();
      const gone = readHead('a', first.signal).catch((e: unknown) => e);
      const last = readHead('a', second.signal).catch((e: unknown) => e);
      await sleep(5);
      reads[0]?.finish('h1');
      await sleep(5);
      expect(reads).toHaveLength(2);

      first.abort();
      expect(reads[1]?.signal?.aborted).toBe(false);
      second.abort();
      expect(reads[1]?.signal?.aborted).toBe(true);

      expect(await gone).toBeInstanceOf(ReadAborted);
      expect(await last).toBeInstanceOf(ReadAborted);
    });

    it('une demande sans signal garde la lecture en vie : seuls ceux qui ont un signal peuvent la retirer', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      void readHead('a');
      const leaving = new AbortController();
      void readHead('a', leaving.signal).catch(() => undefined);
      const stays = readHead('a'); // le sondage du direct n'a pas de signal
      await sleep(5);
      reads[0]?.finish('h1');
      await sleep(5);

      leaving.abort();
      expect(reads[1]?.signal?.aborted).toBe(false);
      reads[1]?.finish('h2');

      expect(await stays).toBe('h2');
    });

    it('une lecture qui attend la précédente, quittée par tous ses demandeurs, n’est jamais lancée', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      void readHead('a');
      const controller = new AbortController();
      const gone = readHead('a', controller.signal).catch((e: unknown) => e);
      await sleep(5);

      controller.abort();
      reads[0]?.finish('h1');
      await sleep(10);

      expect(await gone).toBeInstanceOf(ReadAborted);
      expect(reads).toHaveLength(1);
    });

    it('une demande qui arrive après l’abandon de la lecture en cours ne l’attend pas : cette lecture ne sert plus personne', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      void readHead('a', controller.signal).catch(() => undefined);
      await sleep(5);
      controller.abort();

      const next = readHead('a');
      await sleep(5);
      expect(reads).toHaveLength(2); // sans attendre la fin de la première, que son processus mène à terme sans personne
      reads[1]?.finish('h2');

      expect(await next).toBe('h2');
      reads[0]?.finish('h1'); // la lecture abandonnée finit après coup : rien ne s'en trouve changé
      await sleep(5);
      const after = readHead('a');
      await sleep(5);
      expect(reads).toHaveLength(3);
      reads[2]?.finish('h3');
      expect(await after).toBe('h3');
    });

    it('la lecture d’après devient la lecture en cours : une demande qui arrive pendant elle attend la suivante, jamais plus de deux lectures à la fois', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      const first = readHead('a', controller.signal);
      const second = readHead('a', controller.signal);
      await sleep(5);
      reads[0]?.finish('h1');
      await first;
      await sleep(5);
      expect(reads).toHaveLength(2); // la lecture d'après est partie

      const third = readHead('a', controller.signal); // elle arrive pendant la lecture d'après : celle-ci a pu précéder un commit
      await sleep(5);
      expect(reads).toHaveLength(2);
      reads[1]?.finish('h2');
      await second;
      await sleep(5);
      expect(reads).toHaveLength(3);
      reads[2]?.finish('h3');

      expect(await third).toBe('h3');
    });

    it('une demande qui arrive dès la fin de la lecture en cours rejoint la lecture d’après : pas de troisième lecture, jamais plus d’une en vol', async () => {
      // Le trou : `running` finit, le Projet n'a plus d'entrée, et la lecture d'après (qui n'attend que `running.settled`) n'a pas encore pris sa place.
      // Une demande arrivée dans cet intervalle ne voyait aucune lecture et en lançait une, que le lecteur ne suivait plus.
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const running = readHead('a');
      const waiting = readHead('a'); // elle attend la lecture d'après
      let again: Promise<string> | undefined;
      void running.then(() => {
        again = readHead('a'); // redemandé à l'instant où le résultat arrive : la lecture d'après n'a pas encore commencé
      });
      await sleep(5);
      expect(reads).toHaveLength(1);

      reads[0]?.finish('h1');
      await sleep(5);

      expect(reads).toHaveLength(2); // la lecture d'après, partagée par `waiting` et `again` ; pas une troisième
      expect(reads.filter((read) => !read.done)).toHaveLength(1); // celle-ci seule est en vol
      reads[1]?.finish('h2');
      expect(await waiting).toBe('h2');
      expect(await again).toBe('h2'); // servie par une lecture lancée après son arrivée
      expect(reads).toHaveLength(2);
    });

    it.each([1, 2, 3])('une demande qui arrive %i microtâche(s) plus tard attend la lecture suivante : jamais deux lectures en vol pour un Projet', async (ticks) => {
      // Les instants voisins du trou ci-dessus, pour qu'un changement de l'ordre des microtâches de `Flight` ne rende pas le test sans objet.
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const running = readHead('a');
      const waiting = readHead('a');
      let again: Promise<string> | undefined;
      void running.then(async () => {
        for (let tick = 0; tick < ticks; tick++) await Promise.resolve();
        again = readHead('a');
      });
      await sleep(5);

      reads[0]?.finish('h1');
      await sleep(5);

      expect(reads).toHaveLength(2);
      expect(reads.filter((read) => !read.done)).toHaveLength(1);
      reads[1]?.finish('h2');
      expect(await waiting).toBe('h2');
      await sleep(5);
      expect(reads.filter((read) => !read.done).length).toBeLessThanOrEqual(1);
      reads[2]?.finish('h3'); // la demande arrivée après le départ de la lecture d'après attend la suivante, qui ne part qu'à sa fin
      expect(await again).toBe(reads.length === 3 ? 'h3' : 'h2');
      expect(reads.length).toBeLessThanOrEqual(3);
    });

    it('la lecture abandonnée qui finit après coup n’efface pas la lecture qui l’a remplacée : une demande arrivée pendant celle-ci l’attend', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      void readHead('a', controller.signal).catch(() => undefined);
      await sleep(5);
      controller.abort();
      const second = readHead('a'); // la lecture abandonnée, déjà lancée, ne sert plus personne : celle-ci la remplace aussitôt
      await sleep(5);
      expect(reads).toHaveLength(2);

      reads[0]?.finish('h1'); // le processus de la lecture abandonnée finit après coup
      await sleep(5);
      const third = readHead('a'); // elle arrive pendant la seconde lecture : celle-ci a pu précéder un commit, elle attend la suivante
      await sleep(5);
      expect(reads).toHaveLength(2); // pas de lecture en parallèle de la seconde
      reads[1]?.finish('h2');
      expect(await second).toBe('h2');
      await sleep(5);
      expect(reads).toHaveLength(3);
      reads[2]?.finish('h3');

      expect(await third).toBe('h3');
    });

    it('un Projet n’en retire pas un autre', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      const controller = new AbortController();
      void readHead('a', controller.signal).catch(() => undefined);
      const other = readHead('b');
      await sleep(5);

      controller.abort();

      expect(reads.find((read) => read.projectId === 'b')?.signal?.aborted).toBe(false);
      reads.find((read) => read.projectId === 'b')?.finish('hb');
      expect(await other).toBe('hb');
    });

    it('la lecture en attente qu’on abandonne ne retarde pas la suivante : une nouvelle demande la remplace', async () => {
      const { projects, reads } = manualHeads();
      const readHead = createHeadReader(projects);
      void readHead('a');
      const controller = new AbortController();
      void readHead('a', controller.signal).catch(() => undefined);
      await sleep(5);
      controller.abort();

      const fresh = readHead('a'); // arrive après l'abandon de la lecture en attente : elle est servie par une lecture lancée après son arrivée
      await sleep(5);
      reads[0]?.finish('h1');
      await sleep(5);
      expect(reads).toHaveLength(2);
      reads[1]?.finish('h2');

      expect(await fresh).toBe('h2');
    });
  });
});
