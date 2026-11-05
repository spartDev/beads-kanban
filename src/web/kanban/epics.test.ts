import { describe, expect, it } from 'vitest';
import { ticketTitle, withoutInvisible } from '../data/helpers';
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

  // Une tête faite de caractères sans largeur (catégorie Unicode `Cf`) passe le seuil des trois caractères sans rien nommer : la pastille serait invisible.
  it('ne garde pas pour nom une tête faite uniquement de caractères sans largeur : le titre entier, moins ceux de son bord', () => {
    expect(shortTitle('\u200b\u200b\u200b : Refonte du shell')).toBe(': Refonte du shell');
    expect(shortTitle('\u2060\u00ad\u200c - Refonte')).toBe('- Refonte');
  });

  it('ne compte pas non plus les caractères sans largeur dans le seuil : « V1 » suivi d’un seul reste trop mince', () => {
    expect(shortTitle('V1\u200b : suivi des tickets')).toBe('V1\u200b : suivi des tickets');
  });

  it('garde une tête qui a du texte, même mêlée de caractères sans largeur', () => {
    expect(shortTitle('Refonte\u200b : du shell')).toBe('Refonte\u200b');
    expect(shortTitle('\u200bRefonte : du shell')).toBe('Refonte');
  });

  // La longueur se mesure en caractères visibles, comme le seuil de la tête : un caractère sans largeur n'occupe aucune place dans la pastille.
  it('retire les caractères sans largeur des bords, où ils ne lient rien : trente avant « Refonte » ne laissent pas une pastille d’ellipse', () => {
    expect(shortTitle('\u200b'.repeat(30) + ' Refonte')).toBe('Refonte');
  });

  it('ne coupe pas un titre qui tient dans la limite une fois ses caractères sans largeur mis de côté', () => {
    const title = 'Refonte' + '\u200b'.repeat(30) + ' du shell';
    expect(shortTitle(title)).toBe(title);
  });

  it('retire de même ceux de la fin du titre', () => {
    expect(shortTitle('Refonte \u2060\u200b')).toBe('Refonte');
  });

  it('coupe au dernier caractère visible permis, pas au dernier caractère écrit', () => {
    const short = shortTitle('A'.repeat(10) + '\u200b'.repeat(30) + 'B'.repeat(30));
    expect(short).toBe('A'.repeat(10) + '\u200b'.repeat(30) + 'B'.repeat(13) + '…');
    expect(withoutInvisible(short)).toHaveLength(24);
  });

  it('juge la fin du dernier mot en caractères visibles : une espace trop tôt à l’écran n’autorise pas la coupe', () => {
    expect(shortTitle('ab' + '\u200b'.repeat(30) + ' cdefghijklmnopqrstuvwxyz')).toBe('ab' + '\u200b'.repeat(30) + ' cdefghijklmnopqrstuv…');
  });

  it('ne coupe pas un emoji en deux : la paire de substitution qui dépasserait la limite reste de l’autre côté de la coupe', () => {
    expect(shortTitle('A'.repeat(22) + '😀' + 'B'.repeat(10))).toBe('A'.repeat(22) + '…');
  });

  it('ne laisse aucun caractère sans largeur devant l’ellipse : un liant en bout de coupe ne lie rien', () => {
    expect(shortTitle('A'.repeat(23) + '\u200d' + 'B'.repeat(5))).toBe('A'.repeat(23) + '…');
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

  // Deux options qui s'écrivent pareil à l'écran ne se choisissent pas : un caractère sans largeur ne rend pas un titre différent.
  it.each([
    ['en tête', '\u200bRefonte du shell'],
    ['au milieu d’un mot', 'Refonte du sh\u200bell'],
    ['entre deux mots', 'Refonte \u200b du shell'],
    ['à la fin', 'Refonte du shell\u2060'],
  ])('distingue deux Epics qui ne diffèrent que par un caractère sans largeur %s : chacune porte son identifiant', (_where, title) => {
    expect(labels(epic('a', title), epic('b', 'Refonte du shell'), epic('c', 'Autre'))).toEqual({
      a: `${title.trim().replace(/\s+/g, ' ')} (a)`,
      b: 'Refonte du shell (b)',
      c: 'Autre',
    });
  });

  // « Café » écrit avec le é composé (U+00E9, NFC) ou avec un e suivi de l'accent combinant (U+0301, NFD) s'affiche pareil : deux options identiques sans l'identifiant.
  it('reconnaît le même titre écrit en forme composée (NFC) ou décomposée (NFD) : chacune porte son identifiant, sans que le libellé change', () => {
    expect(labels(epic('a', 'Caf\u00e9'), epic('b', 'Cafe\u0301'), epic('c', 'Cafe'))).toEqual({
      a: 'Caf\u00e9 (a)',
      b: 'Cafe\u0301 (b)',
      c: 'Cafe',
    });
  });

  it('ne laisse pas au libellé un caractère sans largeur de moins : ce que l’Epic écrit, un lecteur le retrouve (ZWJ d’un emoji, ZWNJ)', () => {
    const title = 'Famille 👨\u200d👩\u200d👧';
    expect(labels(epic('a', title))).toEqual({ a: title });
  });

  it('n’ajoute pas d’identifiant à deux titres qui diffèrent par une lettre, caractères sans largeur ou non', () => {
    expect(labels(epic('a', 'Refonte\u200b A'), epic('b', 'Refonte B'))).toEqual({ a: 'Refonte\u200b A', b: 'Refonte B' });
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

/** Un titre de ticket et celui d'une Epic se rangent de même : la règle est une, à deux noms (`ticketTitle`, `epicName`). */
describe('ticketTitle et epicName rangent un titre de la même façon', () => {
  it.each([
    ['des espaces autour', '  Un titre  '],
    ['des espaces doublés', 'Deux   mots'],
    ['des tabulations et des sauts de ligne', 'Un\t titre\n sur  deux lignes'],
    ['des espaces insécables', 'Un\u00a0\u00a0titre'],
    ['un caractère sans largeur au milieu du texte', 'Un titre\u200b avec une césure\u00ad'],
  ])('%s', (_kind, title) => {
    expect(ticketTitle({ title })).toBe(epicName({ id: 'bdesk-e1', title }));
  });

  it('repliant l’un comme l’autre à une seule espace', () => {
    expect(ticketTitle({ title: ' \n Un   titre\t\tà   espaces ' })).toBe('Un titre à espaces');
  });
});
