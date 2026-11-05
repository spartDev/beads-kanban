import { describe, expect, it } from 'vitest';
import { BLANK_TITLES, UNTITLED } from '../test/blankTitles';
import { collapseSpaces, isBlankTitle, ticketTitle } from './helpers';

/**
 * Les règles de titre que toute l'interface partage (bdesk-38k.62) : ce qu'un titre ne dit pas (`isBlankTitle`) et comment il se range sur une ligne
 * (`collapseSpaces`, que `ticketTitle` et `epicName` appellent). Celles qui ne valent que pour une Epic (`shortTitle`, `epicName`, `epicLabels`, dont le titre
 * fait de séparateurs seuls) sont éprouvées avec leurs fonctions, dans `kanban/epics.test.ts`.
 */

/** Ce que l'écran montre d'un texte : sans les caractères sans largeur (catégorie Unicode `Cf`). Écrit ici et non importé de `withoutInvisible` : un test ne doit pas dépendre du code qu'il éprouve. */
const visible = (text: string) => text.replace(/\p{Cf}/gu, '');

describe('isBlankTitle : un titre qui ne dit rien', () => {
  it.each(BLANK_TITLES)('tient pour vide un titre %s', (_kind, title) => {
    expect(isBlankTitle(title)).toBe(true);
  });

  // Un titre de séparateurs seuls (« : », « - ») n'est pas un titre vide : c'est ce que l'auteur a écrit, et un ticket le garde. Seule une Epic n'en tire pas de nom (`epicName`, dans `kanban/epics.ts`).
  it.each([
    [':'],
    ['–'],
    ['—'],
    ['-'],
    [' : '],
    ['::'],
    ['- - -'],
    [': –'],
    ['\u200b : \u200b'],
    ['\u2060-\u200d'],
  ])('ne tient pas pour vide le titre « %s », fait de séparateurs, de blancs et de caractères sans largeur : un ticket le garde tel qu’écrit', (title) => {
    expect(isBlankTitle(title)).toBe(false);
  });

  // Tout le reste dit quelque chose, si peu que ce soit : une ponctuation (« ??? », « … ») est ce que l'auteur a écrit, et une lettre colle au séparateur.
  it.each([
    ['Refonte'],
    ['a'],
    ['0'],
    ['🚀'],
    ['???'],
    ['…'],
    ['...'],
    ['()'],
    ['#'],
    [':)'],
    [':a'],
    ['a:'],
    ['-1'],
    ['--force'],
    ['—a'],
    ['\u200bx\u200b'],
    [': Refonte'],
  ])('ne tient pas pour vide le titre « %s »', (title) => {
    expect(isBlankTitle(title)).toBe(false);
  });
});

describe('collapseSpaces : une seule espace entre deux textes, aucune autour', () => {
  it.each([
    ['des espaces autour et doublées', '  Espaces   superflus  ', 'Espaces superflus'],
    ['des tabulations et des sauts de ligne', 'Un\t titre\n sur  deux lignes', 'Un titre sur deux lignes'],
    ['des espaces insécables', 'Un\u00a0\u00a0titre', 'Un titre'],
    ['un titre sans blanc superflu', 'Distribution', 'Distribution'],
    ['un caractère sans largeur au milieu d’un mot', 'Re\u200bfonte du sh\u00adell', 'Re\u200bfonte du sh\u00adell'],
    ['un liant sans chasse entre deux emojis', 'Famille 👨\u200d👩\u200d👧', 'Famille 👨\u200d👩\u200d👧'],
    ['un antiliant dans un mot persan', 'می\u200cخواهم', 'می\u200cخواهم'],
  ])('%s', (_kind, title, folded) => {
    expect(collapseSpaces(title)).toBe(folded);
  });

  // r5 de la relecture de bdesk-38k.54 : un caractère sans largeur n'est pas un blanc pour `\s+`, donc deux espaces qu'il sépare restaient deux à l'écran.
  it('replie deux espaces que sépare un caractère sans largeur : une seule se voit, et le caractère reste', () => {
    const folded = collapseSpaces('A\u200b \u200b B');

    expect(visible(folded)).toBe('A B');
    expect(folded.match(/\u200b/g)).toHaveLength(2);
  });

  it.each([
    ['U+200B', '\u200b'],
    ['un liant sans chasse (U+200D)', '\u200d'],
    ['un lien de mots (U+2060)', '\u2060'],
    ['un trait d’union conditionnel (U+00AD)', '\u00ad'],
  ])('replie de même les espaces séparées par %s, quel que soit leur nombre', (_kind, invisible) => {
    expect(visible(collapseSpaces(`A \t${invisible}\n ${invisible}\u00a0${invisible} B`))).toBe('A B');
  });

  it('ne laisse aucune espace visible au bord du titre, quand seuls des caractères sans largeur la séparent du bord', () => {
    expect(visible(collapseSpaces('\u200b Refonte'))).toBe('Refonte');
    expect(visible(collapseSpaces('Refonte \u200b'))).toBe('Refonte');
    expect(visible(collapseSpaces(' \u200b \u2060 Refonte \u200d \u200b '))).toBe('Refonte');
  });

  it('garde chaque caractère sans largeur, à sa place : un liant ou un antiliant n’est jamais retiré du titre', () => {
    const folded = collapseSpaces(' \u200d A\u200c \u200d B\u2060 ');

    expect(folded.replace(/\s/g, '')).toBe('\u200dA\u200c\u200dB\u2060');
  });

  // Tous les textes d'au plus cinq éléments pris parmi des lettres, des blancs et des caractères sans largeur (9 331 titres) : ce que le titre devient
  // à l'écran est ce que serait son texte visible replié à la main, rien d'invisible n'est perdu ni déplacé, et replier deux fois ne change plus rien.
  it('tient pour chaque combinaison de lettres, de blancs et de caractères sans largeur', () => {
    const alphabet = ['a', ' ', '\n', '\u200b', '\u200d', '\u2060'];
    let texts = [''];
    const every: string[] = [''];
    for (let length = 1; length <= 5; length += 1) {
      texts = texts.flatMap((text) => alphabet.map((element) => text + element));
      every.push(...texts);
    }

    const failures = every.filter((text) => {
      const folded = collapseSpaces(text);
      return (
        visible(folded) !== visible(text).replace(/\s+/g, ' ').trim() ||
        folded.replace(/\s/g, '') !== text.replace(/\s/g, '') ||
        /[^\S ]/.test(folded) ||
        collapseSpaces(folded) !== folded
      );
    });

    expect(every).toHaveLength(9_331);
    expect(failures.map((text) => JSON.stringify(text))).toEqual([]);
  });
});

describe('ticketTitle : le titre d’un ticket là où son identifiant est dit à côté', () => {
  it.each(BLANK_TITLES)('écrit « Sans titre » pour un titre %s', (_kind, title) => {
    expect(ticketTitle({ title })).toBe(UNTITLED);
  });

  it('garde tel qu’écrit un titre fait de séparateurs seuls : « - » reste « - », et non « Sans titre »', () => {
    for (const title of [':', '–', '—', '-', '- - -']) expect(ticketTitle({ title }), title).toBe(title);
    expect(visible(ticketTitle({ title: '\u200b : \u200b' }))).toBe(':');
  });

  it('range les espaces séparées par un caractère sans largeur, comme les autres', () => {
    expect(visible(ticketTitle({ title: 'A\u200b \u200b B' }))).toBe('A B');
  });

  // La pastille d'Epic retire un séparateur de tête de ce qu'elle montre (`shortTitle`) ; un ticket, lui, garde son titre tel qu'il l'a écrit.
  it.each([
    ['À faire :'],
    ['- Corriger le bug'],
    [': Refonte du shell'],
    ['— Refonte'],
    ['--force ne fait rien'],
    ['???'],
    ['Famille 👨\u200d👩\u200d👧 : réunion'],
    ['Écrire les métriques de flux'],
  ])('ne change pas le titre « %s »', (title) => {
    expect(ticketTitle({ title })).toBe(title);
  });
});
