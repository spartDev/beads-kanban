import { describe, expect, it } from 'vitest';
import { withTimeZone } from './timeZone';

/** Le fuseau que `Date` et `Intl` appliquent à cet instant. */
const zone = () => Intl.DateTimeFormat().resolvedOptions().timeZone;
/** L'heure locale de midi UTC le 13 octobre 2026 : 21 à Tokyo, 8 à La Havane. */
const localHourOfNoonUtc = () => new Date(Date.UTC(2026, 9, 13, 12)).getHours();

// Ce que le lanceur a laissé : une variable absente (le fuseau du système, le plus souvent) ou posée (`TZ=UTC pnpm test`).
const launchedWith = process.env.TZ;
const launchedIn = zone();

describe('withTimeZone', () => {
  describe('le temps d’un bloc', () => {
    withTimeZone('Asia/Tokyo');

    it('change le fuseau de Date et d’Intl, pas seulement la variable', () => {
      expect(process.env.TZ).toBe('Asia/Tokyo');
      expect(zone()).toBe('Asia/Tokyo');
      expect(localHourOfNoonUtc()).toBe(21);
    });

    describe('et d’un bloc dans le bloc', () => {
      withTimeZone('America/Havana');

      it('donne au bloc intérieur son propre fuseau', () => {
        expect(zone()).toBe('America/Havana');
        expect(localHourOfNoonUtc()).toBe(8);
      });
    });

    it('rend au bloc extérieur son fuseau quand le bloc intérieur est fini', () => {
      expect(process.env.TZ).toBe('Asia/Tokyo');
      expect(zone()).toBe('Asia/Tokyo');
      expect(localHourOfNoonUtc()).toBe(21);
    });
  });

  // Variable absente au départ : elle est supprimée, et Node remet alors le fuseau du système (c'est ce que ce test vérifie).
  it('rend la variable et le fuseau tels que le lanceur les a laissés, une fois le bloc fini', () => {
    expect('TZ' in process.env).toBe(launchedWith !== undefined);
    expect(process.env.TZ).toBe(launchedWith);
    expect(zone()).toBe(launchedIn);
  });
});
