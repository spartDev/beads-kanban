import { describe, expect, it } from 'vitest';
import {
  dayInZone,
  formatCount,
  formatDay,
  formatDayRange,
  formatDecimal,
  formatDuration,
  formatPercent,
  formatPoints,
  formatSigned,
  formatSignedDuration,
  formatTime,
  spokenDuration,
  spokenPoints,
  tidy,
} from './format';

/**
 * Les nombres de la page Métriques sont lus par un humain : décimale à la française, espaces insécables entre le nombre
 * et son unité (un « 3,4 » seul en fin de ligne ne veut rien dire), moins typographique. Les mois sont écrits ici, pas
 * lus d'Intl : le texte attendu ne doit pas changer d'une version d'ICU à l'autre.
 */

const NBSP = ' ';
const MIN = 60_000;
const HOUR = 60 * MIN;
const DAY = 24 * HOUR;

describe('formatDuration', () => {
  it('écrit « moins d’une minute » sous 30 secondes, sinon des minutes', () => {
    expect(formatDuration(0)).toBe(`< 1${NBSP}min`);
    expect(formatDuration(29_999)).toBe(`< 1${NBSP}min`);
    expect(formatDuration(30_000)).toBe(`1${NBSP}min`);
    expect(formatDuration(44 * MIN)).toBe(`44${NBSP}min`);
  });

  it('passe en heures et minutes dès 60 minutes, minutes sur deux chiffres', () => {
    expect(formatDuration(HOUR)).toBe(`1${NBSP}h`);
    expect(formatDuration(HOUR + MIN)).toBe(`1${NBSP}h${NBSP}01`);
    expect(formatDuration(8_749_941)).toBe(`2${NBSP}h${NBSP}26`);
    expect(formatDuration(23 * HOUR + 59 * MIN)).toBe(`23${NBSP}h${NBSP}59`);
  });

  it('arrondit avant de choisir l’unité : 59 min 40 s fait une heure, 23 h 59 min 30 s un jour', () => {
    expect(formatDuration(59 * MIN + 40_000)).toBe(`1${NBSP}h`);
    expect(formatDuration(23 * HOUR + 59 * MIN + 30_000)).toBe(`1${NBSP}j`);
  });

  it('compte en jours, avec une décimale sous 10 jours, sans virgule ni zéro inutile', () => {
    expect(formatDuration(DAY)).toBe(`1${NBSP}j`);
    expect(formatDuration(36 * HOUR)).toBe(`1,5${NBSP}j`);
    expect(formatDuration(296_930_437)).toBe(`3,4${NBSP}j`);
    expect(formatDuration(25 * HOUR)).toBe(`1${NBSP}j`);
    expect(formatDuration(995_720_583)).toBe(`12${NBSP}j`);
    expect(formatDuration(189.4 * DAY)).toBe(`189${NBSP}j`);
  });

  it('ne montre jamais « 10,0 j » : 9,96 jours font 10 jours', () => {
    expect(formatDuration(9.96 * DAY)).toBe(`10${NBSP}j`);
    expect(formatDuration(9.94 * DAY)).toBe(`9,9${NBSP}j`);
  });

  it('écrit un tiret quand la durée n’existe pas', () => {
    expect(formatDuration(null)).toBe('—');
    expect(formatDuration(undefined)).toBe('—');
    expect(formatDuration(Number.NaN)).toBe('—');
  });
});

describe('formatSignedDuration', () => {
  it('signe la différence avec le plus et le moins typographiques', () => {
    expect(formatSignedDuration(288_180_496)).toBe(`+3,3${NBSP}j`);
    expect(formatSignedDuration(-HOUR)).toBe(`−1${NBSP}h`);
  });

  it('écrit une différence nulle sans signe', () => {
    expect(formatSignedDuration(0)).toBe(`0${NBSP}min`);
  });
});

describe('spokenDuration : la durée dite par un lecteur d’écran', () => {
  it('écrit les unités en toutes lettres, au pluriel quand il le faut', () => {
    expect(spokenDuration(10_000)).toBe('moins d’une minute');
    expect(spokenDuration(MIN)).toBe('1 minute');
    expect(spokenDuration(45 * MIN)).toBe('45 minutes');
    expect(spokenDuration(HOUR)).toBe('1 heure');
    expect(spokenDuration(8_749_941)).toBe('2 heures 26 minutes');
    expect(spokenDuration(DAY)).toBe('1 jour');
    expect(spokenDuration(296_930_437)).toBe('3,4 jours');
    expect(spokenDuration(12.3 * DAY)).toBe('12 jours');
  });

  it('dit l’unité des minutes qui suivent les heures : « 7 heures 1 minute », pas « 7 heures 1 »', () => {
    // Un lecteur d'écran lirait « sept heures un » : la médiane du Cycle Time du nuage se lit « 7 heures 1 minute ».
    expect(spokenDuration(7 * HOUR + MIN)).toBe('7 heures 1 minute');
    expect(spokenDuration(HOUR + 2 * MIN)).toBe('1 heure 2 minutes');
    expect(spokenDuration(23 * HOUR + 59 * MIN)).toBe('23 heures 59 minutes');
    // Sans minutes, rien n'est ajouté.
    expect(spokenDuration(7 * HOUR)).toBe('7 heures');
  });

  it('met au singulier ce qui est sous 2, comme le français : « 1,5 jour »', () => {
    expect(spokenDuration(36 * HOUR)).toBe('1,5 jour');
    expect(spokenDuration(2 * DAY)).toBe('2 jours');
  });
});

describe('formatPercent', () => {
  it('garde une décimale sous 10 % et aucune au-delà', () => {
    expect(formatPercent(0.194)).toBe(`19${NBSP}%`);
    expect(formatPercent(0.0156)).toBe(`1,6${NBSP}%`);
    expect(formatPercent(0.095)).toBe(`9,5${NBSP}%`);
    expect(formatPercent(0.5)).toBe(`50${NBSP}%`);
    expect(formatPercent(1)).toBe(`100${NBSP}%`);
    expect(formatPercent(0)).toBe(`0${NBSP}%`);
  });

  it('arrondit sans jamais écrire « 10,0 % »', () => {
    expect(formatPercent(0.0999)).toBe(`10${NBSP}%`);
  });

  it('garde une décimale partout avec `precise` : 12,5 % n’est pas 13 %', () => {
    expect(formatPercent(0.125, { precise: true })).toBe(`12,5${NBSP}%`);
    expect(formatPercent(0.125)).toBe(`13${NBSP}%`);
    expect(formatPercent(0.194, { precise: true })).toBe(`19,4${NBSP}%`);
    expect(formatPercent(0.2, { precise: true })).toBe(`20${NBSP}%`);
    expect(formatPercent(1, { precise: true })).toBe(`100${NBSP}%`);
    expect(formatPercent(0, { precise: true })).toBe(`0${NBSP}%`);
    expect(formatPercent(null, { precise: true })).toBe('—');
  });

  it('écrit un tiret sans valeur', () => {
    expect(formatPercent(null)).toBe('—');
  });
});

describe('formatPoints : une différence de proportions', () => {
  it('l’écrit en points de pourcentage, signés', () => {
    expect(formatPoints(-0.0954861)).toBe(`−9,5${NBSP}pts`);
    expect(formatPoints(0.003)).toBe(`+0,3${NBSP}pts`);
    expect(formatPoints(0.25)).toBe(`+25${NBSP}pts`);
  });
});

describe('spokenPoints : un écart de parts, dit à voix haute', () => {
  it('écrit « points », au singulier sous 2', () => {
    expect(spokenPoints(0.0954861)).toBe('9,5 points');
    expect(spokenPoints(0.2)).toBe('20 points');
    expect(spokenPoints(0.01)).toBe('1 point');
    expect(spokenPoints(0.015)).toBe('1,5 point');
  });
});

describe('formatDecimal, formatCount, formatSigned', () => {
  it('écrit la virgule décimale et retire le zéro inutile', () => {
    expect(formatDecimal(9.917)).toBe('9,9');
    expect(formatDecimal(10)).toBe('10');
    expect(formatDecimal(4.57)).toBe('4,6');
    expect(formatDecimal(0.04)).toBe('0');
    expect(formatDecimal(2.345, 2)).toBe('2,35');
  });

  it('groupe les milliers avec une espace insécable', () => {
    expect(formatCount(64)).toBe('64');
    expect(formatCount(1234)).toBe(`1${NBSP}234`);
    expect(formatCount(1_234_567)).toBe(`1${NBSP}234${NBSP}567`);
  });

  it('signe un écart', () => {
    expect(formatSigned(55)).toBe('+55');
    expect(formatSigned(-3)).toBe('−3');
    expect(formatSigned(0)).toBe('0');
    expect(formatSigned(5.3456, 1)).toBe('+5,3');
    expect(formatSigned(-1234)).toBe(`−1${NBSP}234`);
  });
});

describe('jours et heures', () => {
  it('écrit un jour du calendrier sans passer par Intl', () => {
    expect(formatDay('2026-10-04')).toBe('4 oct.');
    expect(formatDay('2026-01-31')).toBe('31 janv.');
    expect(formatDay('2026-03-01')).toBe('1 mars');
    expect(formatDay('2026-08-05')).toBe('5 août');
    expect(formatDay('2026-12-25')).toBe('25 déc.');
  });

  it('ajoute l’année ou le jour de la semaine sur demande', () => {
    expect(formatDay('2026-10-04', { year: true })).toBe('4 oct. 2026');
    expect(formatDay('2026-10-04', { weekday: true })).toBe('dim. 4 oct.');
    expect(formatDay('2026-11-02', { weekday: true, year: true })).toBe('lun. 2 nov. 2026');
  });

  it('écrit une plage, l’année une fois à la fin sauf quand elle change', () => {
    expect(formatDayRange('2026-10-04', '2026-11-02')).toBe('4 oct. – 2 nov. 2026');
    expect(formatDayRange('2026-10-04', '2026-10-04')).toBe('4 oct. 2026');
    expect(formatDayRange('2025-12-28', '2026-01-03')).toBe('28 déc. 2025 – 3 janv. 2026');
  });

  it('lit le jour d’un instant dans le fuseau demandé', () => {
    // 23:30 UTC le 2 novembre : déjà le 3 à Paris (UTC+1), encore le 2 à New York.
    expect(dayInZone('2026-11-02T23:30:00.000Z', 'Europe/Paris')).toBe('2026-11-03');
    expect(dayInZone('2026-11-02T23:30:00.000Z', 'America/New_York')).toBe('2026-11-02');
    expect(dayInZone('2026-11-02T23:30:00.000Z', 'UTC')).toBe('2026-11-02');
  });

  it('lit l’heure d’un instant dans le fuseau demandé, sur 24 heures', () => {
    expect(formatTime('2026-11-02T19:00:17.660Z', 'Europe/Paris')).toBe('20:00');
    expect(formatTime('2026-10-03T19:00:17.660Z', 'Europe/Paris')).toBe('21:00');
    expect(formatTime('2026-11-02T00:05:00.000Z', 'UTC')).toBe('00:05');
  });
});

describe('tidy : la typographie d’une phrase du serveur', () => {
  it('lie le nombre à son « % » par une espace insécable', () => {
    expect(tidy('Couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %).')).toBe(
      `Couverture insuffisante : 19${NBSP}% des bugs ont une origine renseignée (minimum 50${NBSP}%).`,
    );
  });

  it('ne touche à rien d’autre', () => {
    expect(tidy('Trop peu de bugs pour conclure : 3 (minimum 5).')).toBe('Trop peu de bugs pour conclure : 3 (minimum 5).');
    expect(tidy('100 % sûr, mais pas 5 pour cent')).toBe(`100${NBSP}% sûr, mais pas 5 pour cent`);
  });
});
