import { describe, expect, it } from 'vitest';
import { InvalidPeriodError, MAX_PERIOD_DAYS, resolvePeriod } from '../../domain/calendar';
import {
  DEFAULT_PERIOD,
  defaultDimension,
  dimensionsOf,
  checkRange,
  isCivilDay,
  lastDays,
  MAX_CUSTOM_DAYS,
  metricsPath,
  MIN_CUSTOM_DAY,
  parseMetricsParams,
  periodKey,
  spanInDays,
  withDimension,
  withPeriod,
} from './params';

/**
 * Ce que l'adresse de la page Métriques retient, pour qu'un lien partage la période et le découpage :
 *
 *   ?range=7d|30d|90d       les N derniers jours (30d par défaut)
 *   ?from=AAAA-MM-JJ&to=…   ou une plage personnalisée, bornes incluses (les mêmes noms que l'API)
 *   ?by=type|priority|project  le découpage (type par Projet, Projet en Vue globale)
 */

const TODAY = '2026-11-02';
const parse = (search: string, scope: 'project' | 'global' = 'project') =>
  parseMetricsParams(new URLSearchParams(search), scope, TODAY);

describe('MAX_CUSTOM_DAYS', () => {
  it('est la limite du serveur : au-delà il répond 400', () => {
    expect(MAX_CUSTOM_DAYS).toBe(MAX_PERIOD_DAYS);
  });
});

describe('MIN_CUSTOM_DAY', () => {
  it('est le 1er janvier 1970, le premier jour que le serveur accepte : aucun historique Dolt n’est plus ancien', () => {
    expect(MIN_CUSTOM_DAY).toBe('1970-01-01');
  });
});

describe('parseMetricsParams : la période', () => {
  it('prend les 30 derniers jours quand l’adresse n’en dit rien', () => {
    expect(parse('')).toEqual({ period: { kind: 'preset', range: '30d' }, by: 'type', notices: [] });
    expect(DEFAULT_PERIOD).toEqual({ kind: 'preset', range: '30d' });
  });

  it.each(['7d', '30d', '90d'] as const)('reconnaît le préréglage %s', (range) => {
    expect(parse(`range=${range}`).period).toEqual({ kind: 'preset', range });
  });

  it('reconnaît une plage personnalisée, bornes incluses', () => {
    expect(parse('from=2026-10-01&to=2026-10-15')).toMatchObject({
      period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' },
      notices: [],
    });
    expect(parse('from=2026-11-02&to=2026-11-02').period).toEqual({ kind: 'custom', from: '2026-11-02', to: '2026-11-02' });
  });

  it('accepte une plage de 366 jours, pas de 367', () => {
    expect(parse('from=2025-11-02&to=2026-11-02').period.kind).toBe('custom');
    const tooLong = parse('from=2025-11-01&to=2026-11-02');
    expect(tooLong.period).toEqual(DEFAULT_PERIOD);
    expect(tooLong.notices.join(' ')).toContain('366');
  });

  it('préfère la plage personnalisée à « range » quand l’adresse donne les deux', () => {
    expect(parse('range=7d&from=2026-10-01&to=2026-10-15').period).toEqual({ kind: 'custom', from: '2026-10-01', to: '2026-10-15' });
  });

  it('prévient d’un préréglage inconnu au lieu de retomber en silence sur la période par défaut', () => {
    for (const range of ['14d', '30', 'week', '30D', '']) {
      const parsed = parse(`range=${range}`);
      expect(parsed.period, range).toEqual(DEFAULT_PERIOD);
      expect(parsed.notices[0], range).toContain('7d, 30d ou 90d');
    }
  });

  it('prévient d’une plage incomplète', () => {
    for (const search of ['from=2026-10-01', 'to=2026-10-15']) {
      const parsed = parse(search);
      expect(parsed.period, search).toEqual(DEFAULT_PERIOD);
      expect(parsed.notices.join(' '), search).toContain('« from » et « to »');
    }
  });

  it('prévient d’un jour qui n’existe pas', () => {
    for (const search of ['from=2026-02-30&to=2026-03-05', 'from=hier&to=2026-03-05', 'from=2026-1-5&to=2026-03-05', 'from=2026-10-01&to=demain']) {
      const parsed = parse(search);
      expect(parsed.period, search).toEqual(DEFAULT_PERIOD);
      expect(parsed.notices.join(' '), search).toContain('AAAA-MM-JJ');
    }
  });

  it('prévient d’une plage qui part d’avant le 1er janvier 1970, l’an 20 compris : le jour existe, c’est la plage qui est trop ancienne', () => {
    const parsed = parse('from=0020-01-01&to=0020-01-31');
    expect(parsed.period).toEqual(DEFAULT_PERIOD);
    expect(parsed.notices).toEqual([
      'La plage doit commencer le 1er janvier 1970 ou après : 0020-01-01 est trop tôt. Les 30 derniers jours sont affichés.',
    ]);

    for (const search of ['from=0000-01-01&to=0000-01-31', 'from=0100-01-01&to=0100-01-31', 'from=1969-12-31&to=1970-01-15', 'from=0020-12-12&to=2026-11-02']) {
      const other = parse(search);
      expect(other.period, search).toEqual(DEFAULT_PERIOD);
      expect(other.notices, search).toHaveLength(1);
      expect(other.notices[0], search).toContain('La plage doit commencer le 1er janvier 1970 ou après');
      expect(other.notices[0], search).not.toContain('n’est pas un jour');
    }
  });

  it('accepte une plage qui commence le 1er janvier 1970', () => {
    expect(parse('from=1970-01-01&to=1970-01-31')).toMatchObject({
      period: { kind: 'custom', from: '1970-01-01', to: '1970-01-31' },
      notices: [],
    });
  });

  it('prévient d’une plage à l’envers ou qui dépasse aujourd’hui', () => {
    const reversed = parse('from=2026-10-15&to=2026-10-01');
    expect(reversed.period).toEqual(DEFAULT_PERIOD);
    expect(reversed.notices.join(' ')).toContain('commence après sa fin');

    const future = parse('from=2026-10-15&to=2026-11-03');
    expect(future.period).toEqual(DEFAULT_PERIOD);
    expect(future.notices.join(' ')).toContain('dépasse aujourd’hui');
  });

  it('retombe sur le préréglage de l’adresse quand la plage est refusée', () => {
    const parsed = parse('range=90d&from=2026-10-15&to=2026-10-01');
    expect(parsed.period).toEqual({ kind: 'preset', range: '90d' });
    expect(parsed.notices).toHaveLength(1);
  });
});

describe('parseMetricsParams : le découpage', () => {
  it('découpe par type dans un Projet, par Projet en Vue globale', () => {
    expect(defaultDimension('project')).toBe('type');
    expect(defaultDimension('global')).toBe('project');
    expect(parse('', 'global').by).toBe('project');
  });

  it('lit « by »', () => {
    expect(parse('by=priority').by).toBe('priority');
    expect(parse('by=type', 'global').by).toBe('type');
    expect(parse('by=project', 'global')).toMatchObject({ by: 'project', notices: [] });
  });

  it('propose le découpage par Projet seulement en Vue globale : un Projet seul n’a qu’une ligne', () => {
    expect(dimensionsOf('project')).toEqual(['type', 'priority']);
    expect(dimensionsOf('global')).toEqual(['type', 'priority', 'project']);
    const parsed = parse('by=project', 'project');
    expect(parsed.by).toBe('type');
    expect(parsed.notices.join(' ')).toContain('Vue globale');
  });

  it('prévient d’un découpage inconnu', () => {
    for (const by of ['status', 'Type', '', '__proto__']) {
      const parsed = parse(`by=${by}`);
      expect(parsed.by, by).toBe('type');
      expect(parsed.notices[0], by).toContain('n’existe pas');
    }
  });

  it('cumule les avertissements, un par réglage refusé', () => {
    expect(parse('range=2w&by=zzz').notices).toHaveLength(2);
  });
});

describe('isCivilDay et spanInDays', () => {
  it('ne reconnaît que les vrais jours AAAA-MM-JJ', () => {
    expect(isCivilDay('2026-10-04')).toBe(true);
    expect(isCivilDay('2024-02-29')).toBe(true);
    for (const value of ['2026-02-29', '2026-13-01', '2026-00-10', '2026-1-5', '26-10-04', '2026-10-04T10:00', '', ' 2026-10-04']) {
      expect(isCivilDay(value), value).toBe(false);
    }
  });

  it('compte les jours d’une plage, bornes comprises', () => {
    expect(spanInDays('2026-11-02', '2026-11-02')).toBe(1);
    expect(spanInDays('2026-10-04', '2026-11-02')).toBe(30);
    expect(spanInDays('2025-11-02', '2026-11-02')).toBe(366);
  });

  /*
   * `Date.UTC(20, …)` lit l'an 20 comme 1920 : les années 0 à 99 sont décalées de 1900. Un champ de date qu'on tape au clavier
   * passe par 0002, 0020 puis 0202 avant 2026 : ces jours-là existent, et la page doit en dire la vraie longueur.
   */
  it('lit les années 0001 à 0099 telles quelles, sans les décaler de 1900', () => {
    for (const value of ['0001-01-01', '0002-12-12', '0004-02-29', '0020-12-12', '0099-12-31', '0100-01-01']) {
      expect(isCivilDay(value), value).toBe(true);
    }
  });

  it('refuse un jour en trop dans ces années comme dans les autres, bissextiles comprises', () => {
    for (const value of ['0001-02-29', '0020-02-30', '0020-04-31', '0099-13-01', '0099-00-10', '0100-02-29']) {
      expect(isCivilDay(value), value).toBe(false);
    }
  });

  it('compte les jours d’une plage qui part d’une année 0001 à 0099, et de part et d’autre de l’an 100', () => {
    expect(spanInDays('0099-12-31', '0100-01-01')).toBe(2);
    expect(spanInDays('0020-12-12', '0021-12-12')).toBe(366);
    // Référence indépendante (Python) : (date(2026, 11, 2) - date(20, 12, 12)).days + 1
    expect(spanInDays('0020-12-12', '2026-11-02')).toBe(732_637);
  });
});

describe('withPeriod et withDimension : écrire dans l’adresse', () => {
  it('n’écrit pas le préréglage par défaut', () => {
    expect(withPeriod(new URLSearchParams('range=7d'), { kind: 'preset', range: '30d' }).toString()).toBe('');
    expect(withPeriod(new URLSearchParams(''), { kind: 'preset', range: '7d' }).toString()).toBe('range=7d');
  });

  it('remplace une plage personnalisée par un préréglage, et inversement, sans laisser de reste', () => {
    expect(withPeriod(new URLSearchParams('from=2026-10-01&to=2026-10-15'), { kind: 'preset', range: '90d' }).toString()).toBe('range=90d');
    expect(withPeriod(new URLSearchParams('range=7d'), { kind: 'custom', from: '2026-10-01', to: '2026-10-15' }).toString()).toBe(
      'from=2026-10-01&to=2026-10-15',
    );
  });

  it('garde les autres réglages de l’adresse', () => {
    expect(withPeriod(new URLSearchParams('by=priority&range=7d'), { kind: 'preset', range: '90d' }).toString()).toBe('by=priority&range=90d');
  });

  it('n’écrit pas le découpage par défaut du Projet ou de la Vue globale', () => {
    expect(withDimension(new URLSearchParams('by=priority'), 'type', 'project').toString()).toBe('');
    expect(withDimension(new URLSearchParams('by=priority'), 'project', 'global').toString()).toBe('');
    expect(withDimension(new URLSearchParams(''), 'type', 'global').toString()).toBe('by=type');
    expect(withDimension(new URLSearchParams('range=7d'), 'priority', 'project').toString()).toBe('range=7d&by=priority');
  });

  it('ne modifie pas les paramètres reçus', () => {
    const params = new URLSearchParams('range=7d');
    withPeriod(params, { kind: 'preset', range: '90d' });
    withDimension(params, 'priority', 'project');
    expect(params.toString()).toBe('range=7d');
  });
});

describe('metricsPath : la requête à l’API', () => {
  const timeZone = 'Europe/Paris';

  it('demande la Vue globale sans Projet', () => {
    expect(metricsPath({ period: { kind: 'preset', range: '30d' }, timeZone })).toBe('/api/metrics?range=30d&timeZone=Europe%2FParis');
  });

  it('demande un Projet, identifiant échappé', () => {
    expect(metricsPath({ project: 'beads-desktop', period: { kind: 'preset', range: '7d' }, timeZone })).toBe(
      '/api/metrics?project=beads-desktop&range=7d&timeZone=Europe%2FParis',
    );
    expect(metricsPath({ project: 'a b/c', period: { kind: 'preset', range: '90d' }, timeZone })).toBe(
      '/api/metrics?project=a+b%2Fc&range=90d&timeZone=Europe%2FParis',
    );
  });

  it('donne « from » et « to » pour une plage personnalisée, jamais « range » avec', () => {
    expect(metricsPath({ project: 'bdesk', period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' }, timeZone })).toBe(
      '/api/metrics?project=bdesk&from=2026-10-01&to=2026-10-15&timeZone=Europe%2FParis',
    );
  });

  // bdesk-38k.48 : le serveur compte les jours dans le fuseau que la page lui donne, celui dans lequel elle a choisi « aujourd'hui ».
  it('donne le fuseau dans lequel le serveur compte les jours, quel qu’il soit', () => {
    const period = { kind: 'preset', range: '7d' } as const;

    expect(new URL(metricsPath({ period, timeZone: 'Asia/Tokyo' }), 'http://localhost').searchParams.get('timeZone')).toBe('Asia/Tokyo');
    expect(new URL(metricsPath({ period, timeZone: 'UTC' }), 'http://localhost').searchParams.get('timeZone')).toBe('UTC');
  });
});

describe('periodKey : l’identité d’une période pour le cache', () => {
  it('distingue les préréglages et les plages', () => {
    const keys = [
      periodKey({ kind: 'preset', range: '7d' }),
      periodKey({ kind: 'preset', range: '30d' }),
      periodKey({ kind: 'custom', from: '2026-10-01', to: '2026-10-15' }),
      periodKey({ kind: 'custom', from: '2026-10-01', to: '2026-10-16' }),
    ];
    expect(new Set(keys).size).toBe(4);
  });
});

describe('lastDays et checkRange : la plage du sélecteur', () => {
  it('lastDays donne les N derniers jours, aujourd’hui compris', () => {
    expect(lastDays(TODAY, 30)).toEqual({ from: '2026-10-04', to: '2026-11-02' });
    expect(lastDays(TODAY, 1)).toEqual({ from: '2026-11-02', to: '2026-11-02' });
    expect(lastDays('2026-03-01', 7)).toEqual({ from: '2026-02-23', to: '2026-03-01' });
  });

  it('checkRange rend la plage, ou la raison pour laquelle le serveur la refuserait', () => {
    expect(checkRange('2026-10-01', '2026-10-15', TODAY)).toEqual({ kind: 'custom', from: '2026-10-01', to: '2026-10-15' });
    expect(checkRange('2026-10-15', '2026-10-01', TODAY)).toContain('commence après sa fin');
    expect(checkRange('2026-10-15', '2026-11-03', TODAY)).toContain('dépasse aujourd’hui');
    expect(checkRange('2024-01-01', '2026-10-01', TODAY)).toContain('366');
    expect(checkRange('2026-02-30', '2026-03-01', TODAY)).toContain('AAAA-MM-JJ');
    expect(checkRange(null, '2026-03-01', TODAY)).toContain('« from » et « to »');
  });

  describe('la borne basse : le 1er janvier 1970', () => {
    const tooEarly = (from: string) => `La plage doit commencer le 1er janvier 1970 ou après : ${from} est trop tôt.`;

    it('checkRange accepte une plage qui commence le 1er janvier 1970, bord compris', () => {
      expect(checkRange('1970-01-01', '1970-01-31', TODAY)).toEqual({ kind: 'custom', from: '1970-01-01', to: '1970-01-31' });
      expect(checkRange(MIN_CUSTOM_DAY, MIN_CUSTOM_DAY, TODAY)).toEqual({ kind: 'custom', from: '1970-01-01', to: '1970-01-01' });
    });

    it.each(['1969-12-31', '1900-01-01', '0999-12-31', '0101-01-01', '0100-01-01', '0099-12-31', '0020-01-01', '0004-02-29', '0001-01-01', '0000-01-01'])(
      'checkRange refuse une plage qui commence le %s, et le dit',
      (from) => {
        expect(checkRange(from, '1970-01-31', TODAY)).toBe(tooEarly(from));
        // Une plage courte, tout entière dans ces années-là : même message, et non « ce jour n'existe pas ».
        expect(checkRange(from, from, TODAY)).toBe(tooEarly(from));
      },
    );

    it('checkRange juge le début avant de compter les jours : une plage trop ancienne n’est jamais dite « trop longue »', () => {
      expect(checkRange('0020-12-12', TODAY, TODAY)).toBe(tooEarly('0020-12-12'));
      expect(checkRange('0002-12-12', '2026-11-02', TODAY)).toBe(tooEarly('0002-12-12'));
      // Passé la borne, la longueur compte comme avant.
      expect(checkRange('1970-01-01', TODAY, TODAY)).toMatch(/^La plage est trop longue : \d+ jours, au plus 366\.$/);
    });

    it('checkRange dit d’abord qu’une plage est à l’envers ou dans le futur, avant de parler de la borne basse', () => {
      expect(checkRange('0020-01-31', '0020-01-01', TODAY)).toContain('commence après sa fin');
      expect(checkRange('0020-01-01', '2026-11-03', TODAY)).toContain('dépasse aujourd’hui');
    });

    it('checkRange vérifie toujours qu’un jour existe dans les années 0 à 99 : le 29 février de l’an 4 existe, pas celui de l’an 100', () => {
      expect(checkRange('0004-02-29', '0004-03-01', TODAY)).toBe(tooEarly('0004-02-29'));
      expect(checkRange('0100-02-29', '0100-03-01', TODAY)).toContain('n’est pas un jour');
      expect(checkRange('0020-02-30', '0020-03-01', TODAY)).toContain('n’est pas un jour');
    });
  });
});

/*
 * Le défaut de bdesk-38k.16 : la page acceptait une plage dans l'an 20 que le serveur refusait ensuite, avec un message faux. La page
 * ne doit accepter que ce que le serveur accepte, et le refuser pour la même raison : on le vérifie sur une grille de plages, en
 * passant le même « aujourd'hui » aux deux.
 */
describe('checkRange et le serveur (resolvePeriod) disent la même chose', () => {
  // Le 2 novembre 2026, 13:00 à Paris : c'est TODAY pour la page comme pour le serveur.
  const NOW = new Date('2026-11-02T12:00:00Z').getTime();

  const serverSays = (from: string, to: string): string | null => {
    try {
      resolvePeriod({ from, to }, NOW, 'Europe/Paris');
      return null;
    } catch (error) {
      if (error instanceof InvalidPeriodError) return error.message;
      throw error;
    }
  };

  /** La raison d'un refus, sans les mots exacts (la page parle à l'utilisateur, le serveur à l'API). */
  const reasonOf = (message: string): string => {
    if (message.includes('1er janvier 1970')) return 'trop ancienne';
    if (message.includes('trop longue')) return 'trop longue';
    if (message.includes('commence après sa fin')) return 'à l’envers';
    if (/dépasse aujourd’hui|dans le futur/.test(message)) return 'dans le futur';
    if (/n’est pas un jour|jour qui existe/.test(message)) return 'jour inexistant';
    return `inconnue : ${message}`;
  };

  const GRID: Array<[string, string]> = [
    // acceptées
    ['2026-10-01', '2026-10-15'],
    ['2025-11-02', '2026-11-02'], // 366 jours
    ['1970-01-01', '1970-01-31'], // la borne basse
    ['1970-01-01', '1970-12-31'],
    ['1972-01-01', '1972-12-31'], // 366 jours, année bissextile
    ['1971-01-01', '1971-01-01'],
    // trop longues
    ['2025-11-01', '2026-11-02'], // 367 jours
    ['1970-01-01', '2026-11-02'],
    ['1972-01-01', '1973-01-01'], // 367 jours
    // d'avant la borne
    ['1969-12-31', '1970-01-15'],
    ['1900-01-01', '1900-01-31'],
    ['1000-01-01', '1000-01-31'],
    ['0999-12-31', '0999-12-31'],
    ['0101-01-01', '0101-01-31'],
    ['0100-01-01', '0100-01-31'], // l'an 100, dont la veille est dans l'an 99
    ['0099-12-31', '0100-01-01'],
    ['0020-01-01', '0020-01-31'],
    ['0020-12-12', '2026-11-02'],
    ['0004-02-29', '0004-03-01'],
    ['0002-11-02', '2026-11-02'], // un état de passage de la frappe de « 2026 »
    ['0020-11-02', '2026-11-02'],
    ['0202-11-02', '2026-11-02'],
    ['0001-01-01', '0001-01-02'],
    ['0000-01-01', '0000-01-31'],
    // à l'envers, dans le futur
    ['2026-10-15', '2026-10-01'],
    ['0020-01-31', '0020-01-01'],
    ['2026-10-15', '2026-11-03'],
    ['0020-01-01', '2026-11-03'],
    // des jours qui n'existent pas
    ['2026-02-30', '2026-03-01'],
    ['2026-1-5', '2026-01-10'],
    ['0100-02-29', '0100-03-01'], // 100 n'est pas bissextile
    ['0020-02-30', '0020-03-01'],
    ['0020-13-01', '0020-03-01'],
  ];

  it.each(GRID)('%s → %s : même verdict, pour la même raison', (from, to) => {
    const page = checkRange(from, to, TODAY);
    const server = serverSays(from, to);

    expect(typeof page === 'string', `la page ${typeof page === 'string' ? `refuse (${page})` : 'accepte'}, le serveur ${server === null ? 'accepte' : `refuse (${server})`}`).toBe(server !== null);
    if (typeof page === 'string' && server !== null) {
      expect(reasonOf(page)).toBe(reasonOf(server));
      expect(reasonOf(page)).not.toContain('inconnue');
    }
  });

  it('dit la règle de la borne basse avec les mêmes mots que le serveur', () => {
    const rule = 'La plage doit commencer le 1er janvier 1970 ou après';
    expect(checkRange('0020-01-01', '0020-01-31', TODAY)).toContain(rule);
    expect(serverSays('0020-01-01', '0020-01-31')).toContain(rule);
  });
});
