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

  // bdesk-38k.48 : la page envoie le fuseau de son navigateur ; le serveur compte les jours dedans, et non dans le sien.
  it('accepte le fuseau des jours, un nom IANA que le serveur connaît', () => {
    expect(parseMetricsQuery({ range: '7d', timeZone: 'Europe/Paris' })).toEqual({ projects: [], period: { range: '7d' }, timeZone: 'Europe/Paris' });
    expect(parseMetricsQuery({ from: '2026-10-01', to: '2026-10-15', timeZone: 'Asia/Tokyo' }).timeZone).toBe('Asia/Tokyo');
    expect(parseMetricsQuery({ timeZone: 'UTC' }).timeZone).toBe('UTC');
  });

  it('ne donne pas de fuseau quand la requête n’en demande pas : le service compte alors dans le sien', () => {
    expect('timeZone' in parseMetricsQuery({ range: '7d' })).toBe(false);
  });

  // Relecture de bdesk-38k.48, bug 2 : `Intl` accepte un nom quelle que soit sa casse. Reprendre le nom tel quel, c'était le renvoyer tel quel dans la
  // réponse, et garder des formateurs par orthographe (2^n casses par nom) : le fuseau qui sort d'ici est celui que le moteur donne à celui qui entre.
  it('donne au fuseau le nom que le moteur lui donne : toutes les casses d’un fuseau n’en font qu’un', () => {
    for (const name of ['eUrOpE/pArIs', 'EUROPE/PARIS', 'europe/paris']) expect(parseMetricsQuery({ timeZone: name }).timeZone).toBe('Europe/Paris');
    for (const name of ['utc', 'Etc/UTC', 'etc/utc']) expect(parseMetricsQuery({ timeZone: name }).timeZone).toBe('UTC');
  });

  // Relecture de bdesk-38k.48, bug 1 : Chromium connaît `America/Coyhaique` (tz 2025b), Node 22.13 non. Refuser (400) mettait la page hors service pour de bon.
  // Un nom bien formé que le serveur ne connaît pas n'est plus une erreur : il compte dans son fuseau, et la réponse le nomme.
  it.each(['Mars/Phobos', 'Etc/Unknown', 'Europe/Pariss'])('ne donne pas de fuseau pour %s, que le serveur ne connaît pas : le service compte dans le sien, sans erreur', (name) => {
    expect(parseMetricsQuery({ range: '7d', timeZone: name })).toEqual({ projects: [], period: { range: '7d' } });
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
    ['un fuseau vide', { timeZone: '' }, 'ne peut pas être vide'],
    ['un fuseau répété', { timeZone: ['UTC', 'Europe/Paris'] }, 'une fois'],
    ['un fuseau qui n’est pas un texte', { timeZone: { zone: 'UTC' } }, 'doit être un texte'],
    ['un paramètre inconnu', { projet: 'a' }, 'projet'],
    ['un paramètre inconnu à côté d’un préréglage', { range: '7d', slice: 'type' }, 'slice'],
  ])('refuse %s', (_name, query, fragment) => {
    expect(() => parseMetricsQuery(query)).toThrow(InvalidMetricsQueryError);
    expect(() => parseMetricsQuery(query)).toThrow(fragment);
  });
});
