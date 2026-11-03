import { describe, expect, expectTypeOf, it } from 'vitest';
import type { MetricsCfdPoint } from '../../shared/api';
import type { Issue } from '../data/types';
import { issue } from '../test/fixtures';
import { withTimeZone } from '../test/timeZone';
import {
  buildBoard,
  closedWithin,
  COLUMN_IDS,
  columnOf,
  compareClosed,
  compareIssues,
  DEFAULT_DONE_DAYS,
  defaultColumn,
  doneSince,
  isBlocked,
  isBoardCard,
  onlyPaused,
  placeClosed,
  type ColumnId,
  type Lane,
} from './columns';

withTimeZone('Europe/Paris');

/** Un instant en heure locale, tel que le navigateur le lit : `local(2026, 10, 23, 12)` est le 23 octobre 2026 à midi. */
const local = (year: number, month: number, day: number, hour = 0, minute = 0, second = 0, ms = 0): number =>
  new Date(year, month - 1, day, hour, minute, second, ms).getTime();
const iso = (ms: number): string => new Date(ms).toISOString();

/** Jeudi 23 octobre 2026, midi, heure de Paris. */
const NOW = local(2026, 10, 23, 12);
const ago = (ms: number) => iso(NOW - ms);
/** À la même heure, `days` jours calendaires plus tôt. */
const daysAgo = (days: number) => iso(local(2026, 10, 23 - days, 12));

const BLOCKERS = ['bdesk-38k.6'];

describe('les colonnes du kanban', () => {
  it('ont les identifiants du CFD : une seule définition des colonnes pour le tableau et le graphique', () => {
    // Vérifié à la compilation (pnpm typecheck) : renommer ou ajouter une colonne d'un seul côté échoue ici.
    expectTypeOf<ColumnId>().toEqualTypeOf<Exclude<keyof MetricsCfdPoint, 'date'>>();
    expect([...COLUMN_IDS]).toEqual(['backlog', 'ready', 'inProgress', 'blocked', 'done']);
  });

  it('gardent par défaut les 14 derniers jours dans Terminé', () => {
    expect(DEFAULT_DONE_DAYS).toBe(14);
  });
});

describe('Blocage', () => {
  it('vient des dépendances non fermées, ou du statut bloqué', () => {
    expect(isBlocked({ status: 'open', blockedBy: [] })).toBe(false);
    expect(isBlocked({ status: 'open', blockedBy: BLOCKERS })).toBe(true);
    expect(isBlocked({ status: 'in_progress', blockedBy: BLOCKERS })).toBe(true);
    expect(isBlocked({ status: 'blocked', blockedBy: [] })).toBe(true);
    expect(isBlocked({ status: 'closed', blockedBy: [] })).toBe(false);
  });
});

describe('columnOf : le classement d’un ticket', () => {
  /**
   * Table de vérité écrite à la main, ticket fermé exclu (voir plus bas) : chaque statut beads, sans puis avec
   * dépendance en suspens. `paused` est le tiroir « En pause ».
   */
  const TABLE: readonly (readonly [status: string, free: Lane, blocked: Lane])[] = [
    ['open', 'ready', 'backlog'],
    ['in_progress', 'inProgress', 'blocked'],
    ['hooked', 'inProgress', 'blocked'],
    ['blocked', 'blocked', 'blocked'],
    ['deferred', 'paused', 'paused'],
    ['pinned', 'paused', 'paused'],
    // Statut personnalisé de beads : comme dans le CFD, rangé « En pause » plutôt que perdu.
    ['review', 'paused', 'paused'],
  ];

  describe.each(TABLE)('statut %s', (status, free, blocked) => {
    it(`hors Blocage : ${free}`, () => {
      expect(columnOf({ status, blockedBy: [], closedAt: null }, { now: NOW })).toBe(free);
    });

    it(`avec une dépendance en suspens : ${blocked}`, () => {
      expect(columnOf({ status, blockedBy: BLOCKERS, closedAt: null }, { now: NOW })).toBe(blocked);
    });

    it('ne dépend pas de closedAt (un ticket rouvert garde l’ancienne date de clôture)', () => {
      expect(columnOf({ status, blockedBy: [], closedAt: daysAgo(1) }, { now: NOW })).toBe(free);
    });
  });

  it('couvre tous les statuts de beads', () => {
    const covered = TABLE.map(([status]) => status);
    for (const status of ['open', 'in_progress', 'blocked', 'deferred', 'closed', 'pinned', 'hooked']) {
      expect(status === 'closed' || covered.includes(status), status).toBe(true);
    }
  });

  it('range plusieurs dépendances en suspens dans le même Blocage', () => {
    expect(columnOf({ status: 'open', blockedBy: ['a', 'b', 'c'], closedAt: null }, { now: NOW })).toBe('backlog');
  });

  describe('Terminé : un ticket fermé ces 14 derniers jours, aujourd’hui compris', () => {
    // NOW est un jeudi à midi : les 14 jours commencent le jeudi 10 octobre, à minuit.
    const closedAt = (at: string | null, blockedBy: string[] = []) => ({ status: 'closed', blockedBy, closedAt: at });
    const lane = (at: string | null, doneDays?: number) => columnOf(closedAt(at), { now: NOW, doneDays });

    it('est dans Terminé', () => {
      expect(lane(daysAgo(3))).toBe('done');
      expect(lane(ago(1_000))).toBe('done');
    });

    it('dès le premier instant du premier jour de la fenêtre : encore dans Terminé', () => {
      expect(lane(iso(local(2026, 10, 10, 0, 0, 0, 0)))).toBe('done');
    });

    it('à la dernière milliseconde de la veille de la fenêtre : hors du tableau', () => {
      expect(lane(iso(local(2026, 10, 9, 23, 59, 59, 999)))).toBeNull();
    });

    it('compte des jours calendaires, pas des tranches de 24 h : 14 jours plus tôt à la même heure est déjà dehors', () => {
      // La fenêtre glissante de 14 × 24 h gardait ce ticket : il a été fermé le 9 octobre, 14 jours avant aujourd'hui.
      expect(lane(daysAgo(14))).toBeNull();
      expect(lane(daysAgo(13))).toBe('done');
    });

    it('tout le jour courant compte : une clôture plus tard dans la journée, ou « dans le futur » (horloges qui divergent)', () => {
      expect(lane(iso(local(2026, 10, 23, 0, 0, 0, 0)))).toBe('done');
      expect(lane(iso(local(2026, 10, 23, 23, 59, 59, 999)))).toBe('done');
      expect(lane(iso(NOW + 5 * 60_000))).toBe('done');
    });

    it('fermé depuis 15 jours ou plus : hors du tableau', () => {
      expect(lane(daysAgo(15))).toBeNull();
      expect(lane(daysAgo(400))).toBeNull();
    });

    it('sans date de clôture lisible, l’ancienneté est inconnue : hors du tableau', () => {
      expect(lane(null)).toBeNull();
      expect(lane('pas une date')).toBeNull();
    });

    it('ne change pas avec une dépendance : un ticket fermé n’est plus bloqué', () => {
      expect(columnOf(closedAt(daysAgo(2), BLOCKERS), { now: NOW })).toBe('done');
    });

    it('la fenêtre est paramétrable, toujours en jours calendaires', () => {
      // 7 jours : du vendredi 17 au jeudi 23.
      expect(lane(iso(local(2026, 10, 17, 0)), 7)).toBe('done');
      expect(lane(iso(local(2026, 10, 16, 23, 59, 59, 999)), 7)).toBeNull();
      // 30 jours : à partir du 24 septembre.
      expect(lane(iso(local(2026, 9, 24, 0)), 30)).toBe('done');
      expect(lane(iso(local(2026, 9, 23, 23, 59, 59, 999)), 30)).toBeNull();
    });

    it('une fenêtre d’un jour est « aujourd’hui »', () => {
      expect(lane(iso(local(2026, 10, 23, 0)), 1)).toBe('done');
      expect(lane(iso(local(2026, 10, 22, 23, 59, 59, 999)), 1)).toBeNull();
    });

    it('une fenêtre infinie garde tout ticket fermé, même sans date', () => {
      expect(lane(daysAgo(4000), Infinity)).toBe('done');
      expect(lane(null, Infinity)).toBe('done');
    });

    it('une fenêtre vide ou invalide ne garde rien', () => {
      for (const doneDays of [0, -3, 0.5, Number.NaN, -Infinity]) {
        expect(lane(ago(1_000), doneDays), String(doneDays)).toBeNull();
        expect(lane(null, doneDays), String(doneDays)).toBeNull();
      }
    });

    it('arrondit une fenêtre fractionnaire au nombre de jours entier du dessous', () => {
      expect(lane(iso(local(2026, 10, 22, 0)), 1.9)).toBeNull();
      expect(lane(iso(local(2026, 10, 22, 0)), 2)).toBe('done');
    });
  });
});

describe('closedWithin : les N derniers jours calendaires, aujourd’hui compris', () => {
  const instant = (text: string) => Date.parse(text);

  describe('à Paris, autour des changements d’heure', () => {
    withTimeZone('Europe/Paris');

    it('commence la fenêtre à minuit, heure locale, pas 14 × 24 h avant maintenant', () => {
      // Lundi 26 octobre 2026, 10:00 à Paris (09:00 UTC). L'heure d'hiver est revenue la veille : le 25 a duré 25 h.
      const now = instant('2026-10-26T09:00:00Z');
      // 14 jours : du 13 octobre (minuit, heure d'été : 22:00 UTC la veille) au 26.
      expect(closedWithin('2026-10-12T22:00:00.000Z', now, 14)).toBe(true);
      expect(closedWithin('2026-10-12T21:59:59.999Z', now, 14)).toBe(false);
      // La fenêtre glissante de 14 × 24 h (depuis le 12 à 09:00 UTC) gardait ce ticket, fermé le 12 octobre à 17 h locales.
      expect(closedWithin('2026-10-12T15:00:00Z', now, 14)).toBe(false);
    });

    it('« aujourd’hui » commence à minuit heure locale, pas à minuit UTC', () => {
      const now = instant('2026-10-26T09:00:00Z');
      expect(closedWithin('2026-10-25T23:00:00.000Z', now, 1)).toBe(true);
      expect(closedWithin('2026-10-25T22:59:59.999Z', now, 1)).toBe(false);
    });

    it('à l’heure d’hiver : le jour de 25 h ne décale pas le début des fenêtres qui le contiennent', () => {
      const now = instant('2026-10-26T09:00:00Z');
      // 2 jours : le 25 (25 h) et le 26. Le 25 commence à minuit heure d'été : 22:00 UTC le 24.
      expect(closedWithin('2026-10-24T22:00:00.000Z', now, 2)).toBe(true);
      expect(closedWithin('2026-10-24T21:59:59.999Z', now, 2)).toBe(false);
      // 3 jours : le 24 commence à 22:00 UTC le 23. « Minuit d'aujourd'hui moins 2 × 24 h » tomberait à 23:00 UTC et
      // écarterait ce ticket, fermé le 24 octobre à 00:30 locale.
      expect(closedWithin('2026-10-23T22:30:00Z', now, 3)).toBe(true);
      expect(closedWithin('2026-10-23T21:59:59.999Z', now, 3)).toBe(false);
    });

    it('à l’heure d’été : le jour de 23 h ne décale pas non plus le début de la fenêtre', () => {
      // Lundi 30 mars 2026, 10:00 à Paris (08:00 UTC). Le 29 mars a duré 23 h.
      const now = instant('2026-03-30T08:00:00Z');
      // 3 jours : le 28 mars commence à minuit heure d'hiver, 23:00 UTC le 27. « Minuit d'aujourd'hui moins 2 × 24 h »
      // tomberait à 22:00 UTC et garderait, à tort, un ticket fermé le 27 mars à 23:30 locale.
      expect(closedWithin('2026-03-27T23:00:00.000Z', now, 3)).toBe(true);
      expect(closedWithin('2026-03-27T22:59:59.999Z', now, 3)).toBe(false);
      // 2 jours : le 29 commence à 23:00 UTC le 28.
      expect(closedWithin('2026-03-28T23:00:00.000Z', now, 2)).toBe(true);
      expect(closedWithin('2026-03-28T22:59:59.999Z', now, 2)).toBe(false);
    });

    it('un ticket fermé le jour du changement d’heure, avant ou après, reste du bon jour', () => {
      // Dimanche 29 mars 2026, 12:00 à Paris : « aujourd'hui » commence à 23:00 UTC le 28.
      const now = instant('2026-03-29T10:00:00Z');
      expect(closedWithin('2026-03-28T23:30:00Z', now, 1)).toBe(true); // 00:30 locale, avant le saut de 02:00 à 03:00
      expect(closedWithin('2026-03-29T01:30:00Z', now, 1)).toBe(true); // 03:30 locale, après le saut
      expect(closedWithin('2026-03-28T22:30:00Z', now, 1)).toBe(false); // 23:30 locale la veille
    });
  });

  describe('à La Havane, où le changement d’heure tombe à minuit', () => {
    withTimeZone('America/Havana');

    it('minuit n’existe pas (00:00 saute à 01:00) : le jour commence au saut', () => {
      // Lundi 9 mars 2026, 10:00 locale. Le dimanche 8 mars, l'horloge saute de 00:00 à 01:00 : 05:00 UTC.
      const now = instant('2026-03-09T14:00:00Z');
      expect(closedWithin('2026-03-08T05:00:00.000Z', now, 2)).toBe(true);
      expect(closedWithin('2026-03-08T04:59:59.999Z', now, 2)).toBe(false);
    });

    it('minuit se répète (01:00 revient à 00:00) : le jour commence au premier minuit', () => {
      // Lundi 2 novembre 2026, 10:00 locale. Le dimanche 1er novembre, 00:00 vient deux fois : la première à 04:00 UTC.
      const now = instant('2026-11-02T15:00:00Z');
      expect(closedWithin('2026-11-01T04:00:00.000Z', now, 2)).toBe(true);
      expect(closedWithin('2026-11-01T03:59:59.999Z', now, 2)).toBe(false);
    });
  });

  describe.each([
    'UTC',
    'Europe/Paris',
    'America/New_York',
    'America/Los_Angeles',
    'America/Sao_Paulo',
    'Asia/Kolkata',
    'Asia/Tokyo',
    'Australia/Lord_Howe',
    'Pacific/Auckland',
    'Pacific/Kiritimati',
    'Pacific/Pago_Pago',
  ])('à %s', (zone) => {
    withTimeZone(zone);
    // Lundi 26 octobre 2026, 10:00 locale.
    const now = () => local(2026, 10, 26, 10);

    it.each([7, 14, 30, 90])('%i jours : de minuit le jour de départ à la fin d’aujourd’hui', (days) => {
      // Premier jour = aujourd'hui − (days − 1), en jours du calendrier.
      const first = new Date(2026, 9, 26 - (days - 1));
      const [y, m, d] = [first.getFullYear(), first.getMonth() + 1, first.getDate()];
      expect(closedWithin(iso(local(y, m, d, 0, 0, 0, 0)), now(), days)).toBe(true);
      expect(closedWithin(iso(local(y, m, d - 1, 23, 59, 59, 999)), now(), days)).toBe(false);
      expect(closedWithin(iso(local(2026, 10, 26, 23, 59, 59, 999)), now(), days)).toBe(true);
    });

    it('aujourd’hui seulement : de minuit locale à maintenant', () => {
      expect(closedWithin(iso(local(2026, 10, 26, 0)), now(), 1)).toBe(true);
      expect(closedWithin(iso(local(2026, 10, 25, 23, 59, 59, 999)), now(), 1)).toBe(false);
    });
  });

  it('refuse une date absente ou illisible, hors fenêtre infinie', () => {
    expect(closedWithin(null, NOW, 14)).toBe(false);
    expect(closedWithin('hier soir', NOW, 14)).toBe(false);
    expect(closedWithin(null, NOW, Infinity)).toBe(true);
  });
});

describe('doneSince : le début de la fenêtre de Terminé', () => {
  it('est minuit, heure locale, du premier jour : aujourd’hui moins N − 1 jours', () => {
    expect(doneSince(NOW, 14)).toBe(local(2026, 10, 10));
    expect(doneSince(NOW, 1)).toBe(local(2026, 10, 23));
    expect(doneSince(NOW, 365)).toBe(local(2025, 10, 24));
  });

  it('suit le passage à l’heure d’hiver : le début reste un minuit local (22:00 UTC en heure d’été)', () => {
    expect(new Date(doneSince(Date.parse('2026-10-26T09:00:00Z'), 3)).toISOString()).toBe('2026-10-23T22:00:00.000Z');
  });
});

describe('placeClosed : où va un ticket fermé', () => {
  const place = (closedAt: string | null, doneDays?: number) => placeClosed(closedAt, { now: NOW, doneDays });

  it('dans Terminé, fermé plus tôt (date connue), ou sans date lisible', () => {
    expect(place(daysAgo(2))).toBe('done');
    expect(place(daysAgo(30))).toBe('earlier');
    expect(place(null)).toBe('undated');
    expect(place('pas une date')).toBe('undated');
  });

  it('suit la fenêtre demandée', () => {
    expect(place(daysAgo(10), 7)).toBe('earlier');
    expect(place(daysAgo(10), 14)).toBe('done');
  });

  it('garde tout dans Terminé avec une fenêtre infinie, même sans date', () => {
    expect(place(daysAgo(4000), Infinity)).toBe('done');
    expect(place(null, Infinity)).toBe('done');
  });

  it('sans fenêtre (0 jour ou invalide), tout est « plus tôt » quand la date est connue', () => {
    expect(place(daysAgo(0), 0)).toBe('earlier');
    expect(place(null, 0)).toBe('undated');
  });
});

describe('isBoardCard', () => {
  it('exclut les Epics : ce sont des conteneurs, pas du travail (même règle que le CFD)', () => {
    expect(isBoardCard({ type: 'epic' })).toBe(false);
    for (const type of ['task', 'feature', 'bug', 'chore', 'spike', 'decision', 'story', 'milestone', 'autre']) {
      expect(isBoardCard({ type }), type).toBe(true);
    }
  });
});

describe('compareIssues : l’ordre dans une colonne', () => {
  const sorted = (...issues: Issue[]) => [...issues].sort(compareIssues).map((i) => i.id);

  it('range par priorité (P0 d’abord), puis par date de mise à jour la plus récente', () => {
    const a = issue({ id: 'a', title: 'a', priority: 2, updatedAt: '2026-10-10T09:00:00Z' });
    const b = issue({ id: 'b', title: 'b', priority: 0, updatedAt: '2026-10-01T09:00:00Z' });
    const c = issue({ id: 'c', title: 'c', priority: 2, updatedAt: '2026-10-20T09:00:00Z' });
    const d = issue({ id: 'd', title: 'd', priority: 4, updatedAt: '2026-10-22T09:00:00Z' });
    expect(sorted(a, b, c, d)).toEqual(['b', 'c', 'a', 'd']);
  });

  it('départage les égalités par identifiant, en lisant les nombres (…9 avant …10)', () => {
    const at = '2026-10-10T09:00:00Z';
    const ten = issue({ id: 'bdesk-38k.10', title: '10', updatedAt: at });
    const nine = issue({ id: 'bdesk-38k.9', title: '9', updatedAt: at });
    expect(sorted(ten, nine)).toEqual(['bdesk-38k.9', 'bdesk-38k.10']);
  });

  it('range en dernier une priorité ou une date illisible', () => {
    const fine = issue({ id: 'fine', title: 'fine', priority: 3, updatedAt: '2026-10-10T09:00:00Z' });
    const noPriority = issue({ id: 'np', title: 'np', priority: Number.NaN, updatedAt: '2026-10-10T09:00:00Z' });
    const noDate = issue({ id: 'nd', title: 'nd', priority: 3, updatedAt: 'n’importe quoi' });
    expect(sorted(noPriority, noDate, fine)).toEqual(['fine', 'nd', 'np']);
  });
});

describe('compareClosed : l’ordre de Terminé', () => {
  const sorted = (...issues: Issue[]) => [...issues].sort(compareClosed).map((i) => i.id);
  const closed = (id: string, closedAt: string | null, extra: Partial<Issue> = {}) =>
    issue({ id, title: id, status: 'closed', closedAt, ...extra });

  it('range par date de clôture, la plus récente d’abord', () => {
    expect(sorted(closed('a', daysAgo(5)), closed('b', daysAgo(1)), closed('c', daysAgo(3)))).toEqual(['b', 'c', 'a']);
  });

  it('compare des instants, pas des textes : deux fuseaux, même instant', () => {
    const earlier = closed('earlier', '2026-10-20T23:30:00-05:00'); // 21 octobre 04:30 UTC
    const later = closed('later', '2026-10-21T06:00:00+01:00'); // 21 octobre 05:00 UTC
    expect(sorted(earlier, later)).toEqual(['later', 'earlier']);
  });

  it('range en dernier une date absente ou illisible, puis départage comme une colonne ordinaire', () => {
    expect(sorted(closed('none', null), closed('dated', daysAgo(10)), closed('bad', 'xx'))).toEqual(['dated', 'bad', 'none']);
  });
});

describe('buildBoard', () => {
  const at = (id: string, status: string, extra: Partial<Issue> = {}) =>
    issue({ id, title: `Ticket ${id}`, status, ...extra });
  const ids = (issues: Issue[]) => issues.map((i) => i.id);

  const ISSUES: Issue[] = [
    at('epic', 'open', { type: 'epic' }),
    at('ready-p2', 'open', { priority: 2, parentId: 'epic' }),
    at('ready-p0', 'open', { priority: 0 }),
    at('backlog', 'open', { blockedBy: ['ready-p0'], parentId: 'epic' }),
    at('doing', 'in_progress', { parentId: 'epic' }),
    at('agent', 'hooked'),
    at('stuck', 'in_progress', { blockedBy: ['backlog'] }),
    at('status-blocked', 'blocked'),
    at('recent', 'closed', { closedAt: daysAgo(2), updatedAt: daysAgo(2) }),
    at('old', 'closed', { closedAt: daysAgo(40) }),
    at('later', 'deferred'),
    at('pin', 'pinned'),
  ];

  it('répartit les tickets dans les cinq colonnes et le tiroir En pause', () => {
    const board = buildBoard(ISSUES, { now: NOW });
    expect(ids(board.columns.backlog)).toEqual(['backlog']);
    expect(ids(board.columns.ready)).toEqual(['ready-p0', 'ready-p2']);
    // Même priorité, même date : l'identifiant départage.
    expect(ids(board.columns.inProgress)).toEqual(['agent', 'doing']);
    expect(ids(board.columns.blocked)).toEqual(['status-blocked', 'stuck']);
    expect(ids(board.columns.done)).toEqual(['recent']);
    expect(ids(board.paused)).toEqual(['later', 'pin']);
  });

  it('n’affiche ni les Epics ni les tickets fermés depuis plus de 14 jours', () => {
    const board = buildBoard(ISSUES, { now: NOW });
    const shown = [...Object.values(board.columns).flat(), ...board.paused].map((i) => i.id);
    expect(shown).not.toContain('epic');
    expect(shown).not.toContain('old');
    expect(board.total).toBe(shown.length);
    expect(board.total).toBe(10);
  });

  it('compte à part les tickets fermés plus tôt que la fenêtre de Terminé', () => {
    expect(buildBoard(ISSUES, { now: NOW }).closedEarlier).toBe(1);
    expect(buildBoard(ISSUES, { now: NOW, doneDays: 60 }).closedEarlier).toBe(0);
    expect(buildBoard(ISSUES, { now: NOW, doneDays: 60 }).columns.done.map((i) => i.id).sort()).toEqual(['old', 'recent']);
  });

  it('compte à part, et non parmi les fermés plus tôt, ceux qui n’ont pas de date de clôture lisible', () => {
    const issues = [
      at('recent', 'closed', { closedAt: daysAgo(1) }),
      at('older', 'closed', { closedAt: daysAgo(30) }),
      at('older-too', 'closed', { closedAt: daysAgo(60) }),
      at('no-date', 'closed', { closedAt: null }),
      at('bad-date', 'closed', { closedAt: 'pas une date' }),
    ];
    const board = buildBoard(issues, { now: NOW });
    expect(board.closedEarlier).toBe(2);
    expect(board.closedUndated).toBe(2);
    expect(ids(board.columns.done)).toEqual(['recent']);
    expect(board.total).toBe(1);
  });

  it('ne compte pas parmi eux une Epic fermée, ni un ticket hors du filtre Epic', () => {
    const issues = [
      at('E', 'closed', { type: 'epic', closedAt: daysAgo(90) }),
      at('mine', 'closed', { parentId: 'E', closedAt: daysAgo(90) }),
      at('mine-undated', 'closed', { parentId: 'E', closedAt: null }),
      at('theirs', 'closed', { closedAt: daysAgo(90) }),
      at('theirs-undated', 'closed', { closedAt: null }),
    ];
    const all = buildBoard(issues, { now: NOW });
    expect([all.closedEarlier, all.closedUndated]).toEqual([2, 2]);
    const mine = buildBoard(issues, { now: NOW, epicId: 'E' });
    expect([mine.closedEarlier, mine.closedUndated]).toEqual([1, 1]);
  });

  it('range Terminé par date de clôture, la plus récente d’abord, quelles que soient priorité et mise à jour', () => {
    const board = buildBoard(
      [
        // La plus ancienne des trois est la plus prioritaire et la plus récemment mise à jour : elle passe quand même la dernière.
        at('old-p0', 'closed', { priority: 0, closedAt: daysAgo(9), updatedAt: daysAgo(0) }),
        at('mid-p3', 'closed', { priority: 3, closedAt: daysAgo(4), updatedAt: daysAgo(12) }),
        at('new-p4', 'closed', { priority: 4, closedAt: ago(60_000), updatedAt: daysAgo(13) }),
      ],
      { now: NOW },
    );
    expect(ids(board.columns.done)).toEqual(['new-p4', 'mid-p3', 'old-p0']);
  });

  it('départage deux clôtures simultanées par priorité, puis mise à jour, puis identifiant', () => {
    const closedAt = daysAgo(2);
    const board = buildBoard(
      [
        at('c', 'closed', { closedAt, priority: 3 }),
        at('b', 'closed', { closedAt, priority: 1, updatedAt: '2026-10-01T09:00:00Z' }),
        at('a', 'closed', { closedAt, priority: 1, updatedAt: '2026-10-05T09:00:00Z' }),
      ],
      { now: NOW },
    );
    expect(ids(board.columns.done)).toEqual(['a', 'b', 'c']);
  });

  it('ne trie que Terminé par clôture : les autres colonnes et le tiroir gardent priorité puis mise à jour', () => {
    const board = buildBoard(
      [
        at('ready-low-new', 'open', { priority: 3, updatedAt: '2026-10-22T09:00:00Z' }),
        at('ready-high-old', 'open', { priority: 0, updatedAt: '2026-10-01T09:00:00Z' }),
        at('paused-low-new', 'deferred', { priority: 3, updatedAt: '2026-10-22T09:00:00Z' }),
        at('paused-high-old', 'pinned', { priority: 0, updatedAt: '2026-10-01T09:00:00Z' }),
      ],
      { now: NOW },
    );
    expect(ids(board.columns.ready)).toEqual(['ready-high-old', 'ready-low-new']);
    expect(ids(board.paused)).toEqual(['paused-high-old', 'paused-low-new']);
  });

  it('range en dernier, dans Terminé, un ticket sans date de clôture (fenêtre infinie)', () => {
    const board = buildBoard(
      [at('none', 'closed', { closedAt: null, priority: 0 }), at('dated', 'closed', { closedAt: daysAgo(500), priority: 4 })],
      { now: NOW, doneDays: Infinity },
    );
    expect(ids(board.columns.done)).toEqual(['dated', 'none']);
    expect(board.closedUndated).toBe(0);
  });

  it('trie chaque colonne par priorité puis mise à jour', () => {
    const board = buildBoard(
      [
        at('c', 'open', { priority: 3, updatedAt: '2026-10-22T09:00:00Z' }),
        at('b', 'open', { priority: 1, updatedAt: '2026-10-01T09:00:00Z' }),
        at('a', 'open', { priority: 1, updatedAt: '2026-10-05T09:00:00Z' }),
      ],
      { now: NOW },
    );
    expect(ids(board.columns.ready)).toEqual(['a', 'b', 'c']);
  });

  it('applique la fenêtre de Terminé demandée', () => {
    const issues = [at('d3', 'closed', { closedAt: daysAgo(3) }), at('d10', 'closed', { closedAt: daysAgo(10) })];
    expect(ids(buildBoard(issues, { now: NOW, doneDays: 7 }).columns.done)).toEqual(['d3']);
    expect(ids(buildBoard(issues, { now: NOW, doneDays: 14 }).columns.done).sort()).toEqual(['d10', 'd3']);
  });

  it('rend des colonnes vides pour un Projet sans ticket', () => {
    const board = buildBoard([], { now: NOW });
    expect(board.total).toBe(0);
    for (const id of COLUMN_IDS) expect(board.columns[id], id).toEqual([]);
    expect(board.paused).toEqual([]);
  });

  describe('filtre Epic', () => {
    const TREE: Issue[] = [
      at('E1', 'open', { type: 'epic' }),
      at('E2', 'open', { type: 'epic', parentId: 'E1' }),
      at('E3', 'open', { type: 'epic' }),
      at('direct', 'open', { parentId: 'E1' }),
      at('grandchild', 'open', { parentId: 'direct' }),
      at('under-nested-epic', 'open', { parentId: 'E2' }),
      at('other', 'open', { parentId: 'E3' }),
      at('orphan', 'open'),
      at('done-child', 'closed', { parentId: 'E1', closedAt: daysAgo(1) }),
      at('paused-child', 'deferred', { parentId: 'E1' }),
    ];

    it('limite le tableau aux Enfants de l’Epic', () => {
      const board = buildBoard(TREE, { now: NOW, epicId: 'E3' });
      expect(ids(board.columns.ready)).toEqual(['other']);
      expect(board.total).toBe(1);
    });

    it('garde les Enfants indirects : sous un ticket ou sous une Epic imbriquée', () => {
      const board = buildBoard(TREE, { now: NOW, epicId: 'E1' });
      expect(ids(board.columns.ready).sort()).toEqual(['direct', 'grandchild', 'under-nested-epic']);
      expect(ids(board.columns.done)).toEqual(['done-child']);
      expect(ids(board.paused)).toEqual(['paused-child']);
    });

    it('ne compte jamais une Epic comme carte, même Enfant de l’Epic choisie', () => {
      const board = buildBoard(TREE, { now: NOW, epicId: 'E1' });
      expect(Object.values(board.columns).flat().map((i) => i.id)).not.toContain('E2');
    });

    it('termine malgré une boucle de parentés', () => {
      const loop = [at('x', 'open', { parentId: 'y' }), at('y', 'open', { parentId: 'x' }), at('E', 'open', { type: 'epic' })];
      expect(buildBoard(loop, { now: NOW, epicId: 'x' }).total).toBe(1);
    });

    it('une Epic inconnue ne garde aucun ticket', () => {
      expect(buildBoard(TREE, { now: NOW, epicId: 'fantome' }).total).toBe(0);
    });

    it('sans filtre : tous les tickets (null ou absent)', () => {
      const all = buildBoard(TREE, { now: NOW });
      expect(buildBoard(TREE, { now: NOW, epicId: null }).total).toBe(all.total);
      expect(all.total).toBe(7);
    });
  });
});

describe('defaultColumn : la colonne affichée à l’ouverture sur mobile', () => {
  const boardWith = (columns: Partial<Record<ColumnId, number>>) =>
    buildBoard(
      Object.entries(columns).flatMap(([column, count]) =>
        Array.from({ length: count ?? 0 }, (_, i) => {
          const base = { id: `${column}-${i}`, title: column };
          switch (column) {
            case 'backlog':
              return issue({ ...base, blockedBy: ['x'] });
            case 'ready':
              return issue(base);
            case 'inProgress':
              return issue({ ...base, status: 'in_progress' });
            case 'blocked':
              return issue({ ...base, status: 'blocked' });
            default:
              return issue({ ...base, status: 'closed', closedAt: daysAgo(1) });
          }
        }),
      ),
      { now: NOW },
    );

  it('préfère ce qui est en cours', () => {
    expect(defaultColumn(boardWith({ backlog: 4, ready: 6, inProgress: 2, done: 9 }))).toBe('inProgress');
  });

  it('puis ce qui est prêt, puis ce qui est bloqué, puis le Backlog, puis Terminé', () => {
    expect(defaultColumn(boardWith({ backlog: 4, ready: 6, done: 9 }))).toBe('ready');
    expect(defaultColumn(boardWith({ backlog: 4, blocked: 1, done: 9 }))).toBe('blocked');
    expect(defaultColumn(boardWith({ backlog: 4, done: 9 }))).toBe('backlog');
    expect(defaultColumn(boardWith({ done: 9 }))).toBe('done');
  });

  it('retombe sur Prêt quand le tableau est vide', () => {
    expect(defaultColumn(boardWith({}))).toBe('ready');
  });

  it('ouvre sur Terminé quand il n’y a que des tickets fermés plus tôt : le décompte « fermés plus tôt » y est', () => {
    const board = buildBoard([issue({ id: 'old', title: 'Ancien', status: 'closed', closedAt: daysAgo(90) })], { now: NOW });
    expect(board.total).toBe(0);
    expect(defaultColumn(board)).toBe('done');
  });

  it('ouvre sur Terminé aussi quand les seuls tickets fermés n’ont pas de date de clôture', () => {
    const board = buildBoard([issue({ id: 'nd', title: 'Sans date', status: 'closed', closedAt: null })], { now: NOW });
    expect(defaultColumn(board)).toBe('done');
  });

  it('préfère une colonne qui a des cartes à des tickets fermés plus tôt', () => {
    const board = buildBoard(
      [issue({ id: 'old', title: 'Ancien', status: 'closed', closedAt: daysAgo(90) }), issue({ id: 'r', title: 'Prêt' })],
      { now: NOW },
    );
    expect(defaultColumn(board)).toBe('ready');
  });
});

describe('defaultColumn : quand des tickets sont en pause', () => {
  it('ouvre sur une colonne qui a des cartes, même si des tickets sont en pause', () => {
    const board = buildBoard(
      [issue({ id: 'p', title: 'En pause', status: 'deferred' }), issue({ id: 'b', title: 'Backlog', blockedBy: ['x'] })],
      { now: NOW },
    );
    expect(defaultColumn(board)).toBe('backlog');
  });

  it('n’a aucune colonne à proposer quand tout est en pause : Prêt, que la page complète d’un état vide (onlyPaused)', () => {
    const board = buildBoard([issue({ id: 'p', title: 'En pause', status: 'deferred' })], { now: NOW });
    expect(defaultColumn(board)).toBe('ready');
    expect(onlyPaused(board)).toBe(true);
  });
});

describe('onlyPaused : un tableau dont tous les tickets sont dans le tiroir « En pause »', () => {
  const paused = (id: string, status = 'deferred') => issue({ id, title: id, status });

  it('est vrai quand le tableau n’a que des tickets en pause : différés, épinglés, d’un statut inconnu ou vide', () => {
    const board = buildBoard([paused('a'), paused('b', 'pinned'), paused('c', 'review'), paused('d', '')], { now: NOW });
    expect(board.paused).toHaveLength(4);
    expect(onlyPaused(board)).toBe(true);
  });

  it.each([
    ['prêt', issue({ id: 'x', title: 'x' })],
    ['en Blocage', issue({ id: 'x', title: 'x', blockedBy: ['y'] })],
    ['en cours', issue({ id: 'x', title: 'x', status: 'in_progress' })],
    ['bloqué', issue({ id: 'x', title: 'x', status: 'blocked' })],
    ['terminé', issue({ id: 'x', title: 'x', status: 'closed', closedAt: daysAgo(1) })],
  ])('est faux dès qu’une colonne a une carte : un ticket %s', (_name, other) => {
    expect(onlyPaused(buildBoard([paused('a'), other], { now: NOW }))).toBe(false);
  });

  it('est faux quand rien n’est en pause : un tableau vide n’a rien à montrer dans le tiroir', () => {
    expect(onlyPaused(buildBoard([], { now: NOW }))).toBe(false);
    const old = issue({ id: 'old', title: 'Ancien', status: 'closed', closedAt: daysAgo(90) });
    expect(onlyPaused(buildBoard([old], { now: NOW }))).toBe(false);
  });

  it('reste vrai quand des tickets fermés plus tôt sont laissés de côté : ils ne sont pas des cartes', () => {
    const old = issue({ id: 'old', title: 'Ancien', status: 'closed', closedAt: daysAgo(90) });
    const board = buildBoard([old, paused('a')], { now: NOW });
    expect(board.closedEarlier).toBe(1);
    expect(onlyPaused(board)).toBe(true);
  });

  it('suit le filtre Epic : seuls comptent les Enfants de l’Epic choisie', () => {
    const tickets = [
      issue({ id: 'e', title: 'Epic', type: 'epic' }),
      issue({ id: 'c', title: 'Enfant en pause', status: 'deferred', parentId: 'e' }),
      issue({ id: 'r', title: 'Prêt, hors de l’Epic' }),
    ];
    expect(onlyPaused(buildBoard(tickets, { now: NOW }))).toBe(false);
    expect(onlyPaused(buildBoard(tickets, { now: NOW, epicId: 'e' }))).toBe(true);
  });
});
