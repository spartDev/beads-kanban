import { describe, expect, it } from 'vitest';
import { formatReadyAge, spokenReadyAge } from './readyAge';

const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;
const THRESHOLD = 14 * DAY;

/** Le texte tel qu'on le lit : les espaces insécables sont des espaces. */
const plain = (text: string) => text.replaceAll(' ', ' ');
const age = (days: number, hours = 0, minutes = 0) => days * DAY + hours * HOUR + minutes * MIN;

/**
 * L'âge d'un Prêt dans la liste « Prêts qui stagnent » : en jours et en heures, pour qu'on lise de quel côté du seuil de 14 jours
 * il tombe. `formatDuration` arrondit au jour dès 10 jours (« 14 j » pour 13 j 14 h comme pour 14 j 10 h) : à côté d'un repère
 * « stagne », deux Prêts écrits pareil se contredisent.
 */
describe('formatReadyAge : l’âge d’un Prêt, lisible au seuil de stagnation', () => {
  it('dit les jours et les heures entières : « 13 j 14 h » ne se confond pas avec « 14 j 10 h »', () => {
    expect(plain(formatReadyAge(age(13, 14), THRESHOLD))).toBe('13 j 14 h');
    expect(plain(formatReadyAge(age(14, 10), THRESHOLD))).toBe('14 j 10 h');
    expect(plain(formatReadyAge(age(146, 5, 40), THRESHOLD))).toBe('146 j 5 h');
  });

  it('n’écrit pas d’heures quand il n’y en a pas : « 14 j » est exactement 14 jours', () => {
    expect(plain(formatReadyAge(age(14), THRESHOLD))).toBe('14 j');
    expect(plain(formatReadyAge(age(3, 0, 59), THRESHOLD))).toBe('3 j');
    expect(plain(formatReadyAge(DAY, THRESHOLD))).toBe('1 j');
  });

  it('arrondit à l’heure vers le bas : un Prêt qui n’a pas 14 jours ne s’écrit jamais « 14 j »', () => {
    expect(plain(formatReadyAge(age(13, 23, 59), THRESHOLD))).toBe('13 j 23 h');
    expect(plain(formatReadyAge(THRESHOLD - 1, THRESHOLD))).toBe('13 j 23 h');
  });

  it('écrit un Prêt qui stagne au-dessus du seuil, même dans l’heure qui suit : « 14 j 1 h », jamais « 14 j »', () => {
    expect(plain(formatReadyAge(THRESHOLD + 1, THRESHOLD))).toBe('14 j 1 h');
    expect(plain(formatReadyAge(age(14, 0, 59), THRESHOLD))).toBe('14 j 1 h');
    expect(plain(formatReadyAge(age(14, 1), THRESHOLD))).toBe('14 j 1 h');
    expect(plain(formatReadyAge(age(14, 1, 59), THRESHOLD))).toBe('14 j 1 h');
    expect(plain(formatReadyAge(age(14, 2), THRESHOLD))).toBe('14 j 2 h');
  });

  it('écrit « plus de 14 j » si et seulement si le Prêt stagne : toutes les minutes de 13 j à 15 j', () => {
    const value = (text: string) => {
      const match = /^(\d+) j(?: (\d+) h)?$/.exec(plain(text));
      if (!match) throw new Error(`« ${text} » n’est pas écrit en jours et heures`);
      return Number(match[1]) * DAY + Number(match[2] ?? 0) * HOUR;
    };
    const wrong: string[] = [];
    for (let minutes = 13 * 24 * 60; minutes <= 15 * 24 * 60; minutes++) {
      const stagnates = minutes * MIN > THRESHOLD;
      const shown = value(formatReadyAge(minutes * MIN, THRESHOLD));
      if ((shown > THRESHOLD) !== stagnates) wrong.push(`${minutes} min : ${formatReadyAge(minutes * MIN, THRESHOLD)}`);
    }
    // Et la milliseconde qui suit le seuil.
    if ((value(formatReadyAge(THRESHOLD + 1, THRESHOLD)) > THRESHOLD) !== true) wrong.push('seuil + 1 ms');
    expect(wrong).toEqual([]);
  });

  it('suit formatDuration sous un jour : heures et minutes, minutes, moins d’une minute', () => {
    expect(plain(formatReadyAge(5 * HOUR, THRESHOLD))).toBe('5 h');
    expect(plain(formatReadyAge(3 * HOUR + 20 * MIN, THRESHOLD))).toBe('3 h 20');
    expect(plain(formatReadyAge(12 * MIN, THRESHOLD))).toBe('12 min');
    expect(plain(formatReadyAge(0, THRESHOLD))).toBe('< 1 min');
    expect(plain(formatReadyAge(DAY - MIN, THRESHOLD))).toBe('23 h 59');
  });

  it('colle le nombre à son unité d’une espace insécable : « 14 j 10 h » ne se coupe pas en fin de ligne', () => {
    expect(formatReadyAge(age(14, 10), THRESHOLD)).toBe('14 j 10 h');
  });

  it('suit le seuil qu’on lui donne : un autre seuil, une autre frontière', () => {
    expect(plain(formatReadyAge(age(7, 0, 30), 7 * DAY))).toBe('7 j 1 h');
    expect(plain(formatReadyAge(age(7), 7 * DAY))).toBe('7 j');
  });
});

describe('spokenReadyAge : l’âge d’un Prêt tel qu’on le dit', () => {
  it('dit les jours et les heures en toutes lettres, au singulier sous deux', () => {
    expect(spokenReadyAge(age(14, 10), THRESHOLD)).toBe('14 jours 10 heures');
    expect(spokenReadyAge(age(1, 1), THRESHOLD)).toBe('1 jour 1 heure');
    expect(spokenReadyAge(age(14), THRESHOLD)).toBe('14 jours');
    expect(spokenReadyAge(DAY, THRESHOLD)).toBe('1 jour');
    expect(spokenReadyAge(age(2, 2), THRESHOLD)).toBe('2 jours 2 heures'); // le pluriel commence à deux, pour les jours comme pour les heures
    expect(spokenReadyAge(age(2, 1), THRESHOLD)).toBe('2 jours 1 heure');
  });

  it('arrondit comme l’écran : même côté du seuil', () => {
    expect(spokenReadyAge(THRESHOLD - 1, THRESHOLD)).toBe('13 jours 23 heures');
    expect(spokenReadyAge(THRESHOLD + 1, THRESHOLD)).toBe('14 jours 1 heure');
  });

  it('suit spokenDuration sous un jour', () => {
    expect(spokenReadyAge(5 * HOUR, THRESHOLD)).toBe('5 heures');
    expect(spokenReadyAge(3 * HOUR + 20 * MIN, THRESHOLD)).toBe('3 heures 20 minutes');
    expect(spokenReadyAge(0, THRESHOLD)).toBe('moins d’une minute');
  });
});
