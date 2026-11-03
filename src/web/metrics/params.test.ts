import { describe, expect, it } from 'vitest';
import { MAX_PERIOD_DAYS } from '../../domain/calendar';
import {
  DEFAULT_PERIOD,
  defaultDimension,
  dimensionsOf,
  checkRange,
  isCivilDay,
  lastDays,
  MAX_CUSTOM_DAYS,
  metricsPath,
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
  it('demande la Vue globale sans Projet', () => {
    expect(metricsPath({ period: { kind: 'preset', range: '30d' } })).toBe('/api/metrics?range=30d');
  });

  it('demande un Projet, identifiant échappé', () => {
    expect(metricsPath({ project: 'beads-desktop', period: { kind: 'preset', range: '7d' } })).toBe(
      '/api/metrics?project=beads-desktop&range=7d',
    );
    expect(metricsPath({ project: 'a b/c', period: { kind: 'preset', range: '90d' } })).toBe('/api/metrics?project=a+b%2Fc&range=90d');
  });

  it('donne « from » et « to » pour une plage personnalisée, jamais « range » avec', () => {
    expect(metricsPath({ project: 'bdesk', period: { kind: 'custom', from: '2026-10-01', to: '2026-10-15' } })).toBe(
      '/api/metrics?project=bdesk&from=2026-10-01&to=2026-10-15',
    );
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
});
