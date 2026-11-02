import { describe, expect, it } from 'vitest';
import { InvalidMetricsQueryError, parseMetricsQuery } from './query';

describe('parseMetricsQuery', () => {
  it('prend les 30 derniers jours de la Vue globale quand rien n’est précisé', () => {
    expect(parseMetricsQuery({})).toEqual({ projects: [], period: { range: '30d' } });
  });

  it.each(['7d', '30d', '90d'])('accepte le préréglage %s', (range) => {
    expect(parseMetricsQuery({ range })).toEqual({ projects: [], period: { range } });
  });

  it('accepte une plage personnalisée, dont le domaine vérifie les jours', () => {
    expect(parseMetricsQuery({ from: '2026-10-01', to: '2026-10-15' })).toEqual({
      projects: [],
      period: { from: '2026-10-01', to: '2026-10-15' },
    });
    // Un jour qui n'existe pas n'est pas l'affaire de cette analyse : `resolvePeriod` le refuse avec son propre message.
    expect(parseMetricsQuery({ from: '2026-02-30', to: 'demain' }).period).toEqual({ from: '2026-02-30', to: 'demain' });
  });

  it('accepte un Projet, ou plusieurs (paramètre répété), sans doublon', () => {
    expect(parseMetricsQuery({ project: 'a' }).projects).toEqual(['a']);
    expect(parseMetricsQuery({ project: ['b', 'a', 'b'] }).projects).toEqual(['b', 'a']);
  });

  it('dit quels préréglages existent', () => {
    expect(() => parseMetricsQuery({ range: '1d' })).toThrow('« range » doit valoir 7d, 30d ou 90d : reçu « 1d ».');
  });

  it.each([
    ['un préréglage inconnu', { range: '1d' }, 'range'],
    ['un préréglage vide', { range: '' }, 'range'],
    ['un préréglage sans unité', { range: '7' }, 'range'],
    ['un préréglage répété', { range: ['7d', '30d'] }, 'range'],
    ['un préréglage avec une plage', { range: '7d', from: '2026-10-01', to: '2026-10-15' }, 'pas les deux'],
    ['un préréglage avec « from »', { range: '7d', from: '2026-10-01' }, 'pas les deux'],
    ['« from » sans « to »', { from: '2026-10-01' }, 'ensemble'],
    ['« to » sans « from »', { to: '2026-10-15' }, 'ensemble'],
    ['« from » répété', { from: ['2026-10-01', '2026-10-02'], to: '2026-10-15' }, 'from'],
    ['un Projet vide', { project: '' }, 'project'],
    ['un Projet vide parmi d’autres', { project: ['a', '  '] }, 'project'],
    ['un paramètre inconnu', { projet: 'a' }, 'projet'],
    ['un paramètre inconnu à côté d’un préréglage', { range: '7d', slice: 'type' }, 'slice'],
  ])('refuse %s', (_name, query, fragment) => {
    expect(() => parseMetricsQuery(query)).toThrow(InvalidMetricsQueryError);
    expect(() => parseMetricsQuery(query)).toThrow(fragment);
  });
});
