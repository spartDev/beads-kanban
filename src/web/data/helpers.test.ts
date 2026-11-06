import { describe, expect, it } from 'vitest';
import { BLANK_TITLES, UNTITLED } from '../test/blankTitles';
import { collapseSpaces, isBlankTitle, ticketTitle, withoutInvisible } from './helpers';

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

  // Un caractère que la police ne dessine pas, sans être de catégorie `Cf` (un remplisseur hangul, un blanc braille, un sélecteur de variante seul), se comporte comme un caractère sans largeur :
  // deux espaces qu'il sépare n'en font qu'une, et il reste à sa place (bdesk-38k.70). La classe est celle des textes invisibles (`isInvisibleText`), non la catégorie `Cf`.
  it.each([
    ['un remplisseur hangul (U+3164)', '\u3164'],
    ['sa demi-chasse (U+FFA0)', '\uffa0'],
    ['un blanc braille (U+2800)', '\u2800'],
    ['un joint de graphèmes (U+034F)', '\u034f'],
    ['une voyelle khmère inhérente (U+17B4)', '\u17b4'],
  ])('replie de même les espaces séparées par %s : une seule reste, et le caractère aussi', (_kind, invisible) => {
    expect(collapseSpaces(`A ${invisible} B`)).toBe(`A ${invisible}B`);
    expect(collapseSpaces(`A\t${invisible}\n ${invisible}\u00a0${invisible} B`)).toBe(`A ${invisible}${invisible}${invisible}B`);
    expect(collapseSpaces(`${invisible} Refonte ${invisible}`)).toBe(`${invisible}Refonte${invisible}`);
  });

  // Un sélecteur de variante, lui, n'est jamais d'une série de blancs, seul ou non : il coupe la série comme un caractère qu'on voit, et chaque blanc qui l'entoure se replie de son côté, comme sur HEAD (bdesk-38k.70,
  // revues B1, B2 et B4). Retirer l'espace qui le sépare de ce qui précède le collerait à un signe, à un autre sélecteur, à un liant ; en fondre deux autour de lui ne change rien de plus à l'écran qu'un écart
  // de moins, et en perdait une que HEAD gardait (B4 : l'espace derrière un liant).
  it('ne replie pas les espaces qu’un sélecteur de variante seul (U+FE0F) sépare : il coupe la série, comme sur HEAD', () => {
    expect(collapseSpaces('A \ufe0f B')).toBe('A \ufe0f B');
    expect(collapseSpaces('A\u0009\ufe0f\u000a \ufe0f\u00a0\ufe0f B')).toBe('A \ufe0f \ufe0f \ufe0f B');
    expect(collapseSpaces('\ufe0f Refonte')).toBe('\ufe0f Refonte');
  });

  // U+06DD et ses pareils se dessinent : la catégorie `Cf` les prenait pour des caractères sans largeur, et pliait les espaces qu'ils séparent. Ils se voient, les espaces aussi.
  it.each([
    ['la marque arabe U+06DD', '\u06dd'],
    ['le signe nombre arabe U+0600', '\u0600'],
    ['l’abréviation syriaque U+070F', '\u070f'],
  ])('ne replie pas les espaces que sépare %s : il se dessine', (_kind, drawn) => {
    expect(collapseSpaces(`A ${drawn} B`)).toBe(`A ${drawn} B`);
  });

  // U+0085 est un saut de ligne de contrôle, un blanc pour Unicode (`White_Space`) que `\s` de JavaScript ignore : il se replie avec les autres sauts de ligne (bdesk-38k.70).
  it('replie un saut de ligne de contrôle (U+0085) comme les autres blancs', () => {
    expect(collapseSpaces('A\u0085  B')).toBe('A B');
    expect(collapseSpaces('\u0085Refonte\u0085')).toBe('Refonte');
  });

  // U+FEFF, que JavaScript compte parmi les blancs (`\s`), s'est toujours replié comme eux : la classe commune le compte parmi les caractères sans largeur, il reste un blanc ici.
  it('replie U+FEFF comme un blanc, au milieu comme au bord du titre', () => {
    expect(collapseSpaces('A\ufeff B')).toBe('A B');
    expect(collapseSpaces('\ufeffRefonte')).toBe('Refonte');
  });

  // Un sélecteur de variante ne dessine rien seul, et change le dessin du caractère qu'il suit : « ⚠ » suivi de U+FE0F est le signe en couleurs, « ⚠ » seul le signe noir. Quand un blanc le sépare du signe, en bout
  // de titre, l'espace qui tombe le collerait au signe noir, et le titre le montrerait en couleurs, alors que le titre écrit le montre noir (bdesk-38k.70, revue B1). L'espace reste, seule, comme avant : c'est la
  // seule dérogation à « aucune espace au bord du titre », et le sélecteur n'est pas une chose qu'on voit.
  it.each([
    ['une espace', ' '],
    ['une tabulation', '\u0009'],
    ['un saut de ligne', '\u000a'],
    ['une espace insécable', '\u00a0'],
    ['une espace cadratin', '\u2003'],
    ['un saut de ligne de contrôle (U+0085)', '\u0085'],
    ['une marque d’ordre des octets (U+FEFF), qui se replie comme un blanc', '\ufeff'],
    ['plusieurs blancs de sortes différentes', ' \u0009\u00a0 '],
  ])('garde, seule, l’espace que %s mettait entre « ⚠ » et son sélecteur de variante, en bout de titre', (_kind, blank) => {
    for (const selector of ['\ufe0f', '\ufe0e']) {
      expect(collapseSpaces(`Alerte ⚠${blank}${selector}`), selector).toBe(`Alerte ⚠ ${selector}`);
      expect(collapseSpaces(`Alerte ⚠${blank}${selector}${blank}`), selector).toBe(`Alerte ⚠ ${selector}`);
    }
  });

  it('garde l’espace devant un sélecteur d’idéogramme ou de mongol de même : le caractère qu’il suivrait garde sa forme', () => {
    expect(collapseSpaces('Fix 葛 \u{e0100}')).toBe('Fix 葛 \u{e0100}');
    expect(collapseSpaces('Fix \u1820 \u180b')).toBe('Fix \u1820 \u180b');
  });

  // Pas d'espace de plus que le titre n'en écrit, ni de moins que HEAD n'en gardait : en tête de titre une espace tombe, et c'est tout ; entre deux sélecteurs, chacune reste ; sans blanc devant lui le sélecteur
  // reste où il est.
  it('ne change que les blancs du bord du titre et ceux que le repli en fait : chaque espace entre deux sélecteurs reste, comme sur HEAD', () => {
    expect(collapseSpaces(' \ufe0f⚠')).toBe('\ufe0f⚠');
    expect(collapseSpaces('\ufe0f \ufe0f')).toBe('\ufe0f \ufe0f');
    expect(collapseSpaces('Alerte ⚠ \ufe0f \ufe0f')).toBe('Alerte ⚠ \ufe0f \ufe0f');
    expect(collapseSpaces('Alerte ⚠\u200b\ufe0f')).toBe('Alerte ⚠\u200b\ufe0f');
    expect(collapseSpaces('Alerte ⚠\ufe0f')).toBe('Alerte ⚠\ufe0f');
  });

  // B4 de la dernière revue de bdesk-38k.70 : une série que HEAD coupait au sélecteur de variante ne redevient pas une seule. Le blanc qui suit un liant, derrière un sélecteur seul, tombait avec la série, et le liant
  // se collait à la lettre suivante : dans Chromium la lettre mongole ou syriaque prend sa forme liée. Il reste, comme sur HEAD.
  it.each([
    ['U+FE0F et une lettre mongole', '\ufe0f', '\u1824'],
    ['un sélecteur mongol et une lettre mongole', '\u180b', '\u1824'],
    ['U+FE0F et une lettre syriaque', '\ufe0f', '\u0712'],
  ])('garde l’espace que sépare un liant d’une lettre, derrière un sélecteur seul : %s', (_kind, selector, letter) => {
    const title = `Tache ${selector}\u200d ${letter}${letter}`;
    expect(collapseSpaces(title)).toBe(title);
    expect(collapseSpaces(`Tache ${selector}\u200d  ${letter}${letter}`)).toBe(title);
    expect(ticketTitle({ title })).toBe(title);
  });

  // R1 : le séparateur de la pastille, « espace, tiret, espace », reste lu derrière un sélecteur seul : l'espace qui le précède ne tombe pas avec la série.
  it('garde l’espace devant « - » derrière un sélecteur de variante seul', () => {
    expect(collapseSpaces('Alerte ⚠ \ufe0f - suite')).toBe('Alerte ⚠ \ufe0f - suite');
    expect(collapseSpaces('Alerte ⚠ \ufe0f\u200b - suite')).toBe('Alerte ⚠ \ufe0f\u200b - suite');
  });

  // B2 de la revue finale de bdesk-38k.70 : le correctif de B1 ne gardait l'espace que derrière un caractère qu'on voit. Derrière un sélecteur de variante attaché (une chaîne de sélecteurs), ou quand un caractère
  // invisible qu'on garde s'intercale (un liant U+200D), elle tombait encore, et le sélecteur suivant se collait à la chaîne : dans Chromium, un deuxième sélecteur mongol dessine une boîte pointillée numérotée après la lettre,
  // un liant collé à un sélecteur change la forme de la lettre. HEAD ne retirait jamais le blanc qui précède un sélecteur, hors du début du texte : une série qui finit le texte garde l'espace de son premier blanc
  // quand un sélecteur de variante vient après un blanc.
  it.each([
    ['un deuxième sélecteur mongol', 'A \u1824\u180b \u180c'],
    ['le même sélecteur mongol deux fois', 'A \u1824\u180b \u180b'],
    ['U+180C puis U+180D', 'A \u1824\u180c \u180d'],
    ['U+180B puis U+180F', 'A \u1824\u180b \u180f'],
    ['une autre lettre mongole', 'A \u1820\u180b \u180c'],
    ['un sélecteur de texte puis un sélecteur d’emoji derrière un signe', 'Alerte ⚠\ufe0e \ufe0f'],
    ['un emoji et deux sélecteurs', '😀\ufe0f \ufe0e'],
    ['un idéogramme et deux sélecteurs étendus', '葉\u{e0100} \u{e0101}'],
    ['un signe mathématique et deux sélecteurs', '≨\ufe00 \ufe00'],
    ['un idéogramme de compatibilité et deux sélecteurs', '屮\ufe00 \ufe01'],
    ['un drapeau à étiquettes et un sélecteur', '🏴\u{e0067}\u{e0062}\u{e0073}\u{e0063}\u{e0074}\u{e007f} \ufe0f'],
  ])('garde l’espace devant un sélecteur de variante qu’elle séparait d’un autre, ou d’une chaîne : %s, en bout de titre', (_kind, title) => {
    expect(collapseSpaces(title)).toBe(title);
  });

  it.each([
    ['une tabulation', '\u0009'],
    ['un saut de ligne', '\u000a'],
    ['une espace insécable', '\u00a0'],
    ['une espace cadratin', '\u2003'],
    ['un saut de ligne de contrôle (U+0085)', '\u0085'],
    ['une marque d’ordre des octets (U+FEFF), qui se replie comme un blanc', '\ufeff'],
    ['plusieurs blancs de sortes différentes', ' \u0009\u00a0 '],
  ])('garde, seule, l’espace que %s mettait entre une chaîne de sélecteurs et le sélecteur suivant, en bout de titre', (_kind, blank) => {
    expect(collapseSpaces(`A \u1824\u180b${blank}\u180c`)).toBe('A \u1824\u180b \u180c');
    expect(collapseSpaces(`A \u1824\u180b${blank}\u180c${blank}`)).toBe('A \u1824\u180b \u180c');
    expect(collapseSpaces(`Alerte ⚠\ufe0e${blank}\ufe0f`)).toBe('Alerte ⚠\ufe0e \ufe0f');
  });

  it.each<readonly [string, string, string]>([
    ['un liant (U+200D) devant l’espace : la lettre mongole change de forme quand le sélecteur se colle au liant', 'A \u1824\u200d \u180b', 'A \u1824\u200d \u180b'],
    ['l’espace devant le liant : le liant se collerait à la lettre', 'A \u1824 \u200d\u180b', 'A \u1824 \u200d\u180b'],
    ['un liant d’emoji entre le cœur et l’espace', 'A ❤\u200d \ufe0f', 'A ❤\u200d \ufe0f'],
    ['une espace sans largeur (U+200B) devant l’espace', 'Alerte ⚠\u200b \ufe0f', 'Alerte ⚠\u200b \ufe0f'],
    ['l’espace devant une espace sans largeur', 'Alerte ⚠ \u200b\ufe0f', 'Alerte ⚠ \u200b\ufe0f'],
    ['un séparateur de voyelles mongol (U+180E) devant l’espace', 'A \u1824\u180e \u180b', 'A \u1824\u180e \u180b'],
    ['un remplisseur hangul (U+3164) devant l’espace', 'Alerte ⚠\u3164 \ufe0f', 'Alerte ⚠\u3164 \ufe0f'],
    ['un blanc braille (U+2800) entre deux espaces : elles n’en font qu’une, qui reste devant le sélecteur', 'Alerte ⚠ \u2800 \ufe0f', 'Alerte ⚠ \u2800\ufe0f'],
  ])('garde l’espace que sépare un caractère invisible du sélecteur ou du signe : %s', (_kind, title, expected) => {
    expect(collapseSpaces(title)).toBe(expected);
  });

  it('garde chaque espace que sépare un sélecteur de variante : il coupe la série, comme sur HEAD', () => {
    expect(collapseSpaces('A \u1824\u180b \u180c \u180d')).toBe('A \u1824\u180b \u180c \u180d');
    expect(collapseSpaces('Alerte ⚠ \ufe0f \ufe0e')).toBe('Alerte ⚠ \ufe0f \ufe0e');
    expect(collapseSpaces('Alerte ⚠ \ufe0f \ufe0e ')).toBe('Alerte ⚠ \ufe0f \ufe0e');
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

/**
 * Ce que l'écran occupe d'un texte, pour le mesurer et comparer deux titres (bdesk-38k.70) : sans les caractères qu'on ne voit pas, selon la règle des textes invisibles (`isInvisibleText`) et non
 * la catégorie `Cf` (bdesk-38k.65 : elle se trompe dans les deux sens). Les blancs restent : une espace occupe sa place, et seul `collapseSpaces` en range. Chaque point de code est éprouvé,
 * contre `isInvisibleText`, dans `data/invisibleClass.test.ts`.
 */
describe('withoutInvisible : le texte sans les caractères qu’on ne voit pas', () => {
  it.each([
    ['une espace sans largeur (U+200B)', '\u200b'],
    ['un liant sans chasse (U+200D)', '\u200d'],
    ['un lien de mots (U+2060)', '\u2060'],
    ['un trait d’union conditionnel (U+00AD)', '\u00ad'],
    ['une marque d’ordre des octets (U+FEFF)', '\ufeff'],
    // Ce que la police laisse blanc sans que la catégorie `Cf` le dise.
    ['un remplisseur hangul (U+3164)', '\u3164'],
    ['sa demi-chasse (U+FFA0)', '\uffa0'],
    ['un blanc braille (U+2800)', '\u2800'],
    ['un joint de graphèmes (U+034F)', '\u034f'],
    ['une voyelle khmère inhérente (U+17B4)', '\u17b4'],
  ])('retire %s, au milieu comme aux bords', (_kind, invisible) => {
    expect(withoutInvisible(`Kan${invisible}ban`)).toBe('Kanban');
    expect(withoutInvisible(`${invisible}Kanban${invisible}`)).toBe('Kanban');
  });

  // Ce que la catégorie `Cf` retirait, et que la police dessine : des signes que l'écriture arabe, syriaque ou kaithi pose devant un nombre ou un mot, des contrôles hiéroglyphiques.
  it.each([
    ['la marque arabe U+06DD', '\u06dd'],
    ['le signe nombre arabe U+0600', '\u0600'],
    ['l’abréviation syriaque U+070F', '\u070f'],
    ['le début de nombre kaithi U+110BD', '\u{110bd}'],
    ['un contrôle hiéroglyphique U+13430', '\u{13430}'],
  ])('garde %s, qui se dessine', (_kind, drawn) => {
    expect(withoutInvisible(`Kan${drawn}ban`)).toBe(`Kan${drawn}ban`);
    expect(withoutInvisible(`${drawn}Kanban${drawn}`)).toBe(`${drawn}Kanban${drawn}`);
  });

  it('garde les blancs : une espace occupe sa place', () => {
    expect(withoutInvisible('A \u00a0\t\u3000B\u0085')).toBe('A \u00a0\t\u3000B\u0085');
  });

  // « ⚠ » suivi de U+FE0F est le signe en couleurs : le sélecteur change la façon de dessiner le caractère qui le précède, il n'est invisible que seul.
  it.each([
    ['un signe d’alerte en couleurs', 'Alerte ⚠\ufe0f'],
    ['le recyclage des gitmojis, en tête', '♻\ufe0f Refactor'],
    ['une touche (1, son sélecteur et le cadre combinant)', '1\ufe0f\u20e3'],
    ['un idéogramme et son sélecteur de variante étendu', '葛\u{e0100}'],
    ['un sélecteur de texte (U+FE0E) derrière un signe', '⚠\ufe0e'],
  ])('garde le sélecteur de variante qui suit un caractère qu’on voit : %s', (_kind, title) => {
    expect(withoutInvisible(title)).toBe(title);
  });

  // Un sélecteur de variante n'est invisible que seul : au début du texte, derrière un blanc ou derrière un caractère invisible, il ne suit rien qu'on voie (voir plus haut : derrière un caractère qu'on voit, il reste).
  it.each([
    ['un sélecteur mongol (U+180B)', '\u180b'],
    ['un sélecteur de variante (U+FE0F)', '\ufe0f'],
    ['un sélecteur de variante étendu (U+E0100)', '\u{e0100}'],
  ])('retire %s quand il ne suit rien qu’on voie', (_kind, selector) => {
    expect(withoutInvisible(`${selector}Kanban`)).toBe('Kanban');
    expect(withoutInvisible(`Kan ${selector}ban`)).toBe('Kan ban');
    expect(withoutInvisible(`Kan\u200b${selector}ban`)).toBe('Kanban');
    expect(withoutInvisible(`Kan\u3164${selector}ban`)).toBe('Kanban');
  });

  it('retire un sélecteur de variante qui ne suit rien qu’on voie : au début, derrière un blanc ou derrière un caractère invisible', () => {
    expect(withoutInvisible('\ufe0fKanban')).toBe('Kanban');
    expect(withoutInvisible('Kan \ufe0fban')).toBe('Kan ban');
    expect(withoutInvisible('Kan\u200b\ufe0fban')).toBe('Kanban');
    expect(withoutInvisible('⚠\ufe0f\ufe0f')).toBe('⚠\ufe0f');
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

  // Le titre d'un ticket dit le signe comme le titre écrit le dit : noir quand un blanc sépare le sélecteur de variante du signe, en couleurs quand il le suit (bdesk-38k.70, revue B1).
  it('garde sa forme au signe d’un titre qui finit par « ⚠ », une espace et un sélecteur de variante : l’espace ne tombe pas', () => {
    expect(ticketTitle({ title: 'Tâche ⚠ \ufe0f' })).toBe('Tâche ⚠ \ufe0f');
    expect(ticketTitle({ title: 'Tâche ⚠\ufe0f' })).toBe('Tâche ⚠\ufe0f');
    expect(ticketTitle({ title: 'Rire 😀 \ufe0e' })).toBe('Rire 😀 \ufe0e');
  });

  // B2 : le titre d'un ticket qui finit par une lettre mongole et deux sélecteurs séparés par une espace : la carte ne dessine pas la boîte pointillée du deuxième sélecteur collé à la lettre.
  it('garde l’espace devant un deuxième sélecteur de variante : le titre de la carte dessine ce que le titre écrit', () => {
    expect(ticketTitle({ title: 'Tâche \u1824\u180b \u180c' })).toBe('Tâche \u1824\u180b \u180c');
    expect(ticketTitle({ title: 'Tâche \u1824\u200d \u180b' })).toBe('Tâche \u1824\u200d \u180b');
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
