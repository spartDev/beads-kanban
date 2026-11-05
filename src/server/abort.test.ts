import { getEventListeners } from 'node:events';
import { describe, expect, it } from 'vitest';
import { abortable, isAbortError, ReadAborted } from './abort';

const never = () => new Promise<never>(() => undefined);

describe('lecture abandonnée', () => {
  it('est une AbortError : ce n’est pas une panne de la base', () => {
    const error = new ReadAborted();

    expect(error).toBeInstanceOf(Error);
    expect(error.name).toBe('AbortError');
    expect(isAbortError(error)).toBe(true);
  });

  it('reconnaît aussi l’AbortError de la plateforme, et rien d’autre', () => {
    expect(isAbortError(new DOMException('abandon', 'AbortError'))).toBe(true);
    expect(isAbortError(new Error('autre'))).toBe(false);
    expect(isAbortError('AbortError')).toBe(false);
    expect(isAbortError(undefined)).toBe(false);
  });
});

describe('abortable', () => {
  it('rend le résultat de la lecture tant que personne n’abandonne', async () => {
    const controller = new AbortController();

    await expect(abortable(Promise.resolve(42), controller.signal)).resolves.toBe(42);
    await expect(abortable(Promise.reject(new Error('panne')), controller.signal)).rejects.toThrow('panne');
  });

  it('sans signal, ne change rien', async () => {
    await expect(abortable(Promise.resolve('ok'), undefined)).resolves.toBe('ok');
  });

  it('se détache aussitôt de la lecture quand le signal est abandonné, sans l’attendre', async () => {
    const controller = new AbortController();
    const waiting = abortable(never(), controller.signal);

    controller.abort();

    await expect(waiting).rejects.toBeInstanceOf(ReadAborted);
  });

  it('refuse aussitôt quand le signal est déjà abandonné', async () => {
    const controller = new AbortController();
    controller.abort();

    await expect(abortable(Promise.resolve(1), controller.signal)).rejects.toBeInstanceOf(ReadAborted);
  });

  it('ne laisse aucun écouteur sur le signal une fois la lecture finie', async () => {
    const controller = new AbortController();

    await abortable(Promise.resolve(1), controller.signal);
    await abortable(Promise.reject(new Error('x')), controller.signal).catch(() => undefined);

    expect(getEventListeners(controller.signal, 'abort')).toHaveLength(0);
  });

  it('ne laisse pas la lecture abandonnée, qui échoue plus tard, devenir un rejet non géré', async () => {
    const controller = new AbortController();
    let fail: (error: Error) => void = () => undefined;
    const slow = new Promise<never>((_resolve, reject) => {
      fail = reject;
    });
    const unhandled: unknown[] = [];
    const collect = (reason: unknown) => unhandled.push(reason);
    process.on('unhandledRejection', collect);
    try {
      const waiting = abortable(slow, controller.signal);
      controller.abort();
      await waiting.catch(() => undefined);
      fail(new Error('échec tardif'));
      await new Promise((resolve) => setTimeout(resolve, 20));
    } finally {
      process.off('unhandledRejection', collect);
    }

    expect(unhandled).toEqual([]);
  });
});
