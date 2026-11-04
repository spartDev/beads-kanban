import { describe, expect, it } from 'vitest';
import { withTimeZone } from '../test/timeZone';
import { beyondAYear, describeSpan, finishWindow } from './forecastText';

const DAY = 86_400_000;
const NBSP = ' ';
/** La fourchette de `lo` à `hi` jours, dite à voix haute et écrite. */
const span = (lo: number, hi: number) => describeSpan(lo * DAY, hi * DAY);

describe('describeSpan : une fourchette de durée, sans fausse précision', () => {
  describe('en jours, tant que la fin la plus lointaine est à moins de deux semaines', () => {
    it('arrondit le début vers le bas et la fin vers le haut : la fourchette contient toujours la valeur calculée', () => {
      expect(span(4.8, 8.1)).toEqual({ text: `4 à 9${NBSP}jours`, spoken: 'entre 4 et 9 jours' });
      expect(span(5, 8)).toEqual({ text: `5 à 8${NBSP}jours`, spoken: 'entre 5 et 8 jours' });
    });

    it('dit « moins de » quand la fin la plus proche est à moins d’un jour', () => {
      expect(span(0.4, 2.2)).toEqual({ text: `moins de 3${NBSP}jours`, spoken: 'moins de 3 jours' });
    });

    it('dit « moins d’un jour » quand même la fin la plus lointaine l’est', () => {
      expect(span(0.2, 0.9)).toEqual({ text: 'moins d’un jour', spoken: 'moins d’un jour' });
      expect(span(0.5, 1)).toEqual({ text: 'moins d’un jour', spoken: 'moins d’un jour' });
    });

    it('dit « environ » quand les deux bouts arrondis tombent sur le même jour', () => {
      expect(span(4, 4)).toEqual({ text: `environ 4${NBSP}jours`, spoken: 'environ 4 jours' });
    });

    it('reste en jours juste sous les deux semaines', () => {
      expect(span(8, 13.4).text).toBe(`8 à 14${NBSP}jours`);
    });
  });

  describe('en semaines, de deux semaines à douze', () => {
    it('passe aux semaines dès que la fin la plus lointaine atteint 14 jours', () => {
      expect(span(8, 14)).toEqual({ text: `1 à 2${NBSP}semaines`, spoken: 'entre 1 et 2 semaines' });
      expect(span(15, 30)).toEqual({ text: `2 à 5${NBSP}semaines`, spoken: 'entre 2 et 5 semaines' });
    });

    it('ne descend jamais sous une semaine', () => {
      expect(span(2, 20).text).toBe(`1 à 3${NBSP}semaines`);
    });

    it('dit « environ » quand les deux bouts arrondis tombent sur la même semaine', () => {
      expect(span(14, 14)).toEqual({ text: `environ 2${NBSP}semaines`, spoken: 'environ 2 semaines' });
    });

    it('reste en semaines juste sous douze', () => {
      expect(span(60, 83).text).toBe(`8 à 12${NBSP}semaines`);
    });
  });

  describe('en mois, au-delà', () => {
    it('passe aux mois de 30 jours dès que la fin la plus lointaine atteint 84 jours', () => {
      expect(span(70, 120)).toEqual({ text: `2 à 4${NBSP}mois`, spoken: 'entre 2 et 4 mois' });
    });

    it('dit « environ » quand les deux bouts arrondis tombent sur le même mois', () => {
      expect(span(90, 90)).toEqual({ text: `environ 3${NBSP}mois`, spoken: 'environ 3 mois' });
    });

    it('n’écrit jamais « 0 mois » : le début ne descend pas sous un mois', () => {
      expect(span(1, 100).text).toBe(`1 à 4${NBSP}mois`);
    });
  });

  it('ne précise rien au-delà d’un an : « plus d’un an »', () => {
    expect(span(400, 900)).toEqual({ text: 'plus d’un an', spoken: 'plus d’un an' });
    // Un début en deçà d'un an, une fin au-delà : la fourchette est écrite telle quelle, en mois.
    expect(span(200, 900).text).toBe(`6 à 30${NBSP}mois`);
  });

  it('dit « plus d’un an » exactement quand la fin la plus proche est à un an ou plus', () => {
    expect(span(364.9, 900).text).toBe(`12 à 30${NBSP}mois`);
    expect(span(365, 900).text).toBe('plus d’un an');
    expect(span(365, 365).text).toBe('plus d’un an');
  });

  it('ne produit jamais de décimale : une durée précise au dixième de jour serait une fausse précision', () => {
    for (const [lo, hi] of [[1.3, 2.7], [6.04, 9.99], [14.2, 20.1], [33.3, 77.7], [90.5, 200.2]] as const) {
      expect(span(lo, hi).text, `${lo}-${hi}`).not.toMatch(/[.,]\d/);
    }
  });
});

describe('beyondAYear : la prévision ne dit plus rien de précis', () => {
  it('est vraie quand la fin la plus proche est à un an (365 jours) ou plus, fausse en deçà', () => {
    expect(beyondAYear(365 * DAY)).toBe(true);
    expect(beyondAYear(900 * DAY)).toBe(true);
    expect(beyondAYear(365 * DAY - 1)).toBe(false);
    expect(beyondAYear(0.5 * DAY)).toBe(false);
  });

  it('est vraie exactement quand describeSpan écrit « plus d’un an » : le texte et les jours ne se contredisent pas', () => {
    for (const [lo, hi] of [[1, 5], [100, 300], [300, 364.9], [364.9, 900], [365, 365], [365, 900], [700, 4000]] as const) {
      expect(beyondAYear(lo * DAY), `${lo}-${hi}`).toBe(span(lo, hi).text === 'plus d’un an');
    }
  });
});

describe('finishWindow : les jours où la fin tombe, dans le fuseau du navigateur', () => {
  describe('à Paris', () => {
    withTimeZone('Europe/Paris');

    it('écrit « entre le … et le … » avec l’année une fois, à la fin', () => {
      expect(finishWindow(Date.UTC(2026, 10, 9, 10), Date.UTC(2026, 10, 12, 10))).toBe('entre le 9 nov. et le 12 nov. 2026');
    });

    it('écrit l’année aux deux bouts quand la fourchette change d’année', () => {
      expect(finishWindow(Date.UTC(2026, 11, 20, 10), Date.UTC(2027, 0, 8, 10))).toBe('entre le 20 déc. 2026 et le 8 janv. 2027');
    });

    it('dit « le … » quand les deux bouts tombent le même jour', () => {
      expect(finishWindow(Date.UTC(2026, 10, 9, 8), Date.UTC(2026, 10, 9, 20))).toBe('le 9 nov. 2026');
    });

    it('lit les jours du calendrier local, pas ceux de l’UTC : 23 h 30 UTC est déjà le lendemain à Paris', () => {
      expect(finishWindow(Date.UTC(2026, 10, 9, 23, 30), Date.UTC(2026, 10, 12, 10))).toBe('entre le 10 nov. et le 12 nov. 2026');
    });
  });

  describe('à Auckland', () => {
    withTimeZone('Pacific/Auckland');

    it('lit le même instant un jour plus tard : UTC+13 en novembre', () => {
      expect(finishWindow(Date.UTC(2026, 10, 9, 12), Date.UTC(2026, 10, 12, 12))).toBe('entre le 10 nov. et le 13 nov. 2026');
    });
  });
});
