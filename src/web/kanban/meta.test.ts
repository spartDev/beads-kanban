import { describe, expect, it } from 'vitest';
import { withTimeZone } from '../test/timeZone';
import { COLUMN_IDS } from './columns';
import {
  COLUMN_META,
  COLUMNS,
  closedEarlierLabel,
  closedUndatedLabel,
  countLabel,
  daysLabel,
  onlyPausedNotice,
  ticketNoun,
} from './meta';

// Le premier jour de la fenêtre s'écrit dans le fuseau du navigateur : on le choisit, on ne subit pas celui de la machine.
withTimeZone('Europe/Paris');

describe('les colonnes affichées', () => {
  it('portent les noms du ticket, dans l’ordre du flux', () => {
    expect(COLUMNS.map((column) => column.label)).toEqual(['Backlog', 'Prêt', 'En cours', 'Bloqué', 'Terminé']);
    expect(COLUMNS.map((column) => column.id)).toEqual([...COLUMN_IDS]);
  });

  it('disent en une ligne ce qui y range un ticket, et la règle entière en infobulle', () => {
    for (const { id, hint, rule } of COLUMNS) {
      expect(hint(14).length, id).toBeGreaterThan(0);
      expect(hint(14).length, `${id} : un indice tient sur une ligne de colonne`).toBeLessThanOrEqual(30);
      expect(rule(14).length, id).toBeGreaterThan(hint(14).length - 1);
    }
  });

  it('montrent la durée de Terminé dans son indice', () => {
    expect(COLUMN_META.done.hint(14)).toBe('Fermé ces 14 derniers jours');
    expect(COLUMN_META.done.hint(90)).toBe('Fermé ces 90 derniers jours');
    expect(COLUMN_META.done.hint(365).length).toBeLessThanOrEqual(30);
  });

  it('disent « aujourd’hui » plutôt que « 1 derniers jours » pour une fenêtre d’un jour', () => {
    expect(COLUMN_META.done.hint(1)).toBe('Fermé aujourd’hui');
    expect(COLUMN_META.done.empty(1)).toBe('Aucun ticket fermé aujourd’hui');
    expect(COLUMN_META.done.rule(1)).toContain('aujourd’hui');
  });

  it('écrivent en infobulle la règle réelle : des jours calendaires, aujourd’hui compris, à partir de minuit', () => {
    const rule = COLUMN_META.done.rule(14, new Date(2026, 9, 13).getTime());
    expect(rule).toContain('14 derniers jours');
    expect(rule).toContain('aujourd’hui compris');
    expect(rule).toContain('mardi 13 octobre');
    expect(rule).toContain('minuit');
    // La fenêtre glissante d'avant : « depuis moins de 14 jours ».
    expect(rule).not.toContain('moins de');
  });

  it('dit la règle de la même façon sans date de début', () => {
    expect(COLUMN_META.done.rule(30)).toContain('30 derniers jours');
    expect(COLUMN_META.done.rule(30)).toContain('aujourd’hui compris');
  });

  it('disent « Aucun ticket » pour une colonne vide, et la durée pour Terminé', () => {
    for (const { id, empty } of COLUMNS) {
      if (id !== 'done') expect(empty(14), id).toBe('Aucun ticket');
    }
    expect(COLUMN_META.done.empty(14)).toBe('Aucun ticket fermé ces 14 derniers jours');
  });
});

describe('Terminé écrit son premier jour dans le fuseau courant, pas dans celui du chargement du module', () => {
  // Minuit de Paris, le 13 octobre : le jour qu'écrit un navigateur dépend de son fuseau. Attendus de `zoneinfo` (Python).
  const since = Date.parse('2026-10-12T22:00:00Z');
  const FIRST_DAY: Array<[zone: string, day: string]> = [
    ['UTC', 'lundi 12 octobre'],
    ['Europe/Paris', 'mardi 13 octobre'],
    ['Asia/Tokyo', 'mardi 13 octobre'],
    ['America/Los_Angeles', 'lundi 12 octobre'],
    ['Pacific/Chatham', 'mardi 13 octobre'],
  ];

  describe.each(FIRST_DAY)('dans le fuseau %s', (zone, day) => {
    withTimeZone(zone);

    it(`écrit « ${day} »`, () => {
      expect(COLUMN_META.done.rule(14, since)).toContain(`depuis le ${day} à minuit`);
    });
  });
});

describe('daysLabel', () => {
  it('accorde « jour » : un seul est au singulier', () => {
    expect([1, 2, 7, 14].map(daysLabel)).toEqual(['1 jour', '2 jours', '7 jours', '14 jours']);
  });
});

describe('les fermés laissés de côté', () => {
  it('« plus tôt » ne parle que de tickets dont la date est connue, accordé au nombre', () => {
    expect(closedEarlierLabel(1)).toBe('1 autre fermé plus tôt');
    expect(closedEarlierLabel(27)).toBe('27 autres fermés plus tôt');
  });

  it('les tickets sans date de clôture ont leur propre formule, accordée au nombre', () => {
    expect(closedUndatedLabel(1)).toBe('1 fermé sans date de clôture');
    expect(closedUndatedLabel(3)).toBe('3 fermés sans date de clôture');
  });
});

describe('countLabel', () => {
  it('accorde « ticket » : zéro et un sont au singulier', () => {
    expect(countLabel(0)).toBe('0 ticket');
    expect(countLabel(1)).toBe('1 ticket');
    expect(countLabel(2)).toBe('2 tickets');
    expect([0, 1, 2].map(ticketNoun)).toEqual(['ticket', 'ticket', 'tickets']);
  });
});

describe('onlyPausedNotice : l’état vide d’un tableau dont tous les tickets sont en pause', () => {
  it('dit combien de tickets sont en pause, accordé au nombre', () => {
    expect(onlyPausedNotice(1).title).toBe('Le seul ticket du tableau est en pause');
    expect(onlyPausedNotice(2).title).toBe('Les 2 tickets du tableau sont tous en pause');
    expect(onlyPausedNotice(27).title).toBe('Les 27 tickets du tableau sont tous en pause');
  });

  it('explique pourquoi aucune colonne ne les montre, et où ils sont : le tiroir « En pause »', () => {
    expect(onlyPausedNotice(3).detail).toBe(
      'Reportés, épinglés ou d’un statut inconnu, ils ne sont dans aucune colonne : ils attendent dans le tiroir « En pause ».',
    );
    expect(onlyPausedNotice(1).detail).toBe(
      'Reporté, épinglé ou d’un statut inconnu, il n’est dans aucune colonne : il attend dans le tiroir « En pause ».',
    );
  });
});
