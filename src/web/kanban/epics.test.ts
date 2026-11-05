import { describe, expect, it } from 'vitest';
import type { Issue } from '../data/types';
import { issue } from '../test/fixtures';
import { epicChoices, epicLabels, epicName, epicShortName, shortTitle } from './epics';

const at = (id: string, extra: Partial<Issue> = {}) => issue({ id, title: `Titre ${id}`, ...extra });

describe('shortTitle : le titre court d’une Epic', () => {
  it.each([
    ['beads-desktop V1 : suivi des tickets et métriques de flux', 'beads-desktop V1'],
    ['Distribution : publication npm et installation via npx', 'Distribution'],
    ['Prompt content integrity: Verbatim Prompt Mode', 'Prompt content integrity'],
    ['New color palette: semantic light/dark tokens', 'New color palette'],
    ['Page Epic – avancement, Enfants et prévision', 'Page Epic'],
    ['Refonte du shell — thèmes et navigation', 'Refonte du shell'],
    ['Pipeline - release et changelog', 'Pipeline'],
    // L'espace insécable que la typographie française met avant « : ».
    ['Métriques : tuiles et graphiques', 'Métriques'],
  ])('garde l’intitulé qui précède le séparateur : %s', (title, short) => {
    expect(shortTitle(title)).toBe(short);
  });

  it('garde un titre court tel quel', () => {
    expect(shortTitle('Distribution')).toBe('Distribution');
    expect(shortTitle('  Espaces   superflus  ')).toBe('Espaces superflus');
  });

  it('coupe un long titre sans séparateur à la fin d’un mot, avec une ellipse', () => {
    const short = shortTitle('Drop Cursor support in CLI + auto-migrate existing workspaces');
    expect(short).toBe('Drop Cursor support in…');
    expect(short.length).toBeLessThanOrEqual(24);
  });

  it('coupe en plein mot un titre d’un seul mot trop long', () => {
    const short = shortTitle('Epic_' + 'z'.repeat(80));
    expect(short).toHaveLength(24);
    expect(short.endsWith('…')).toBe(true);
  });

  it('ne garde pas un début de titre trop mince pour être lisible', () => {
    expect(shortTitle('V1 : suivi des tickets')).toBe('V1 : suivi des tickets');
  });

  it('respecte la longueur demandée', () => {
    expect(shortTitle('Distribution : publication npm', 8)).toBe('Distrib…');
  });
});

describe('epicChoices : le filtre Epic', () => {
  const issues = [
    at('closed-old', { type: 'epic', status: 'closed', updatedAt: '2026-08-01T09:00:00Z' }),
    at('open-p2', { type: 'epic', priority: 2, updatedAt: '2026-10-20T09:00:00Z' }),
    at('open-p1', { type: 'epic', priority: 1, updatedAt: '2026-10-01T09:00:00Z' }),
    at('closed-new', { type: 'epic', status: 'closed', updatedAt: '2026-10-15T09:00:00Z' }),
    at('task'),
  ];

  it('liste les Epics ouvertes (priorité, puis mise à jour) avant les Epics fermées', () => {
    const { open, closed } = epicChoices(issues);
    expect(open.map((e) => e.id)).toEqual(['open-p1', 'open-p2']);
    expect(closed.map((e) => e.id)).toEqual(['closed-new', 'closed-old']);
  });

  it('ignore les tickets qui ne sont pas des Epics', () => {
    const { open, closed } = epicChoices([at('task'), at('bug', { type: 'bug' })]);
    expect(open).toEqual([]);
    expect(closed).toEqual([]);
  });
});

describe('epicLabels : de quoi reconnaître chaque Epic dans le filtre', () => {
  const epic = (id: string, title: string) => at(id, { type: 'epic', title });
  const labels = (...epics: Issue[]) => Object.fromEntries(epicLabels(epics));

  it('garde le titre seul quand aucune autre Epic ne le porte', () => {
    expect(labels(epic('a', 'Distribution'), epic('b', 'Shell UI'))).toEqual({ a: 'Distribution', b: 'Shell UI' });
  });

  it('ajoute l’identifiant à chaque Epic qui partage son titre avec une autre', () => {
    expect(labels(epic('bdesk-1', 'Refonte'), epic('bdesk-2', 'Refonte'), epic('bdesk-3', 'Autre'))).toEqual({
      'bdesk-1': 'Refonte (bdesk-1)',
      'bdesk-2': 'Refonte (bdesk-2)',
      'bdesk-3': 'Autre',
    });
  });

  it('reconnaît le même titre sans tenir compte de la casse, des espaces autour ni des espaces doublés', () => {
    expect(labels(epic('a', 'Refonte du shell'), epic('b', '  refonte   du SHELL '))).toEqual({
      a: 'Refonte du shell (a)',
      b: 'refonte du SHELL (b)',
    });
  });

  it('garde un titre vide lisible : l’identifiant', () => {
    expect(labels(epic('a', ''), epic('b', 'Autre'))).toEqual({ a: 'a', b: 'Autre' });
  });

  it('garde de même lisible un titre fait uniquement de caractères sans largeur, même partagé : l’identifiant, sans « (identifiant) » en plus', () => {
    expect(labels(epic('a', '\u200b'), epic('b', '\u200b'), epic('c', 'Autre'))).toEqual({ a: 'a', b: 'b', c: 'Autre' });
  });
});

/**
 * Comment l’interface nomme une Epic là où elle la désigne (pastille de la carte, lien Parent et lien « Page Epic » du panneau, infobulle de
 * ce lien) : par son titre, ou par son identifiant quand elle n’en a pas (bdesk-38k.39). Une seule règle, que tous ces endroits appellent.
 */
describe('epicName et epicShortName : le nom d’une Epic', () => {
  const epic = (title: string, id = 'bdesk-e1') => ({ id, title });

  it('nomme une Epic par son titre, entier ou court', () => {
    expect(epicName(epic('Shell UI : thèmes, navigation et raccourcis'))).toBe('Shell UI : thèmes, navigation et raccourcis');
    expect(epicShortName(epic('Shell UI : thèmes, navigation et raccourcis'))).toBe('Shell UI');
  });

  it('range les espaces du titre comme le titre court', () => {
    expect(epicName(epic('  Espaces   superflus  '))).toBe('Espaces superflus');
    expect(epicShortName(epic('  Espaces   superflus  '))).toBe('Espaces superflus');
  });

  it.each([
    ['vide', ''],
    ['fait d’espaces', '   '],
    ['fait d’espaces insécables', '\u00a0\u00a0'],
    ['fait de tabulations et de retours à la ligne', '\t\n \r\n'],
    ['fait d’une espace sans largeur (U+200B)', '\u200b'],
    ['fait d’une marque d’ordre des octets (U+FEFF)', '\ufeff'],
    ['fait d’un antiliant et d’un liant sans chasse (U+200C, U+200D)', '\u200c\u200d'],
    ['fait d’un lien de mots (U+2060)', '\u2060'],
    ['fait d’un trait d’union conditionnel (U+00AD)', '\u00ad'],
    ['mêlé d’espaces et de caractères sans largeur', ' \u200b\t\u2060\u00a0'],
  ])('nomme par son identifiant une Epic dont le titre est %s', (_kind, title) => {
    expect(epicName(epic(title))).toBe('bdesk-e1');
    expect(epicShortName(epic(title))).toBe('bdesk-e1');
  });

  it('garde un titre qui contient un caractère sans largeur mais aussi du texte : seul un titre fait uniquement de blancs est remplacé', () => {
    expect(epicName(epic('Refonte\u200b du shell'))).toBe('Refonte\u200b du shell');
    expect(epicShortName(epic('Refonte\u200b : du shell'))).toBe('Refonte\u200b');
  });

  it('n’abrège jamais l’identifiant : coupé, il ne nommerait plus rien', () => {
    const long = 'sanofi-ai-standards-cross-project-h3w';
    expect(long.length).toBeGreaterThan(24);
    expect(epicShortName(epic('', long))).toBe(long);
    expect(epicName(epic('   ', long))).toBe(long);
  });

  it('dit la même chose que le filtre Epic pour une Epic sans titre', () => {
    const untitled = at('bdesk-vide', { type: 'epic', title: '' });
    expect(epicName(untitled)).toBe(epicLabels([untitled]).get('bdesk-vide'));
  });

  it.each([
    ['une espace sans largeur', '\u200b'],
    ['des caractères sans largeur et des espaces', ' \u200c\u200d\u2060 '],
  ])('dit la même chose que le filtre Epic pour une Epic dont le titre est fait de %s', (_kind, title) => {
    const untitled = at('bdesk-invisible', { type: 'epic', title });
    expect(epicName(untitled)).toBe('bdesk-invisible');
    expect(epicLabels([untitled]).get('bdesk-invisible')).toBe('bdesk-invisible');
  });
});
