import { describe, expect, it, vi } from 'vitest';
import { lruMemo } from './lru';

describe('lruMemo : une fonction dont le cache a une taille bornée', () => {
  /** Une fonction qui compte ses appels : ce que le cache épargne, et ce qu'il laisse refaire. */
  const counting = () => vi.fn((key: string) => ({ key }));

  it('ne crée qu’une fois la valeur d’une clé demandée plusieurs fois, et rend la même', () => {
    const make = counting();
    const get = lruMemo(3, make);

    const first = get('a');

    expect(get('a')).toBe(first);
    expect(get('a')).toBe(first);
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('jette la moins récemment demandée au-delà de la taille : elle est recréée quand on la redemande', () => {
    const make = counting();
    const get = lruMemo(2, make);
    get('a');
    get('b');
    get('c'); // « a » est la moins récente : jetée
    expect(make).toHaveBeenCalledTimes(3);

    get('b');
    get('c');
    expect(make).toHaveBeenCalledTimes(3); // celles qui restent ne sont pas refaites

    get('a');
    expect(make).toHaveBeenCalledTimes(4); // « a » l'est
  });

  it('compte une demande comme un usage : la clé redemandée n’est pas la prochaine jetée', () => {
    const make = counting();
    const get = lruMemo(2, make);
    get('a');
    get('b');
    get('a'); // « b » est maintenant la moins récente
    get('c'); // jette « b », pas « a »
    make.mockClear();

    get('a');
    expect(make).not.toHaveBeenCalled();
    get('b');
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('ne garde jamais plus de valeurs que la taille : une rafale de clés distinctes laisse les `max` dernières', () => {
    const make = counting();
    const get = lruMemo(4, make);
    for (let i = 0; i < 1000; i++) get(`clé ${i}`);
    expect(make).toHaveBeenCalledTimes(1000);
    make.mockClear();

    for (let i = 996; i < 1000; i++) get(`clé ${i}`); // les quatre dernières : encore là
    expect(make).not.toHaveBeenCalled();
    get('clé 995'); // la cinquième : jetée
    expect(make).toHaveBeenCalledTimes(1);
  });

  it('garde aussi une valeur que `Map#get` ne distinguerait pas d’une clé absente (undefined, 0, vide)', () => {
    const make = vi.fn((key: number) => (key === 0 ? undefined : key === 1 ? 0 : ''));
    const get = lruMemo(5, make);

    expect([get(0), get(1), get(2)]).toEqual([undefined, 0, '']);
    get(0);
    get(1);
    get(2);

    expect(make).toHaveBeenCalledTimes(3);
  });

  it.each([0, -1, 1.5, Number.NaN])('refuse la taille %s : un cache sans place ne garderait rien', (size) => {
    expect(() => lruMemo(size, (key: string) => key)).toThrow(RangeError);
  });
});
