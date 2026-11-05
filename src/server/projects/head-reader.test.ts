import { describe, expect, it } from 'vitest';
import { ReadAborted } from '../abort';
import { createHeadReader } from './head-reader';
import { ProjectUnreadableError } from './service';

const sleep = (ms: number) => new Promise<void>((resolve) => setTimeout(resolve, ms));

/** Un service dont chaque lecture du HEAD est finie à la main par le test, dans l'ordre où elles sont parties. */
function manualHeads() {
  const reads: { projectId: string; finish: (head: string) => void; fail: (error: Error) => void }[] = [];
  const projects = {
    head: (projectId: string) =>
      new Promise<string>((resolve, reject) => {
        reads.push({ projectId, finish: resolve, fail: reject });
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
});
