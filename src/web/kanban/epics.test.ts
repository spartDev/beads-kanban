import { describe, expect, it } from 'vitest';
import { ticketTitle, withoutInvisible } from '../data/helpers';
import type { Issue } from '../data/types';
import { SEPARATOR_TITLES } from '../test/blankTitles';
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

  // La limite se compte en unités de texte visibles (un emoji en vaut deux, un « é » écrit en deux morceaux un seul : voir plus bas), mais la coupe tombe entre deux graphèmes (`Intl.Segmenter`),
  // jamais dedans : ce que l'œil lit comme un seul caractère reste entier ou n'est pas gardé du tout. Coupé au milieu, un emoji de famille devenait un autre emoji, un drapeau une lettre isolée,
  // et un « é » écrit en deux morceaux perdait son accent (bdesk-38k.62).
  describe.each([
    ['un emoji de famille (liants sans chasse, six unités)', '👨\u200d👩\u200d👧', 20, 16, 'B'],
    ['un drapeau (deux indicateurs régionaux, quatre unités)', '🇫🇷', 21, 19, ''],
    ['un « é » écrit en deux caractères (e puis son accent, NFD : une unité une fois composé)', 'e\u0301', 23, 22, ''],
  ] as const)('%s', (_kind, cluster, straddling, fitting, tail) => {
    it('reste de l’autre côté de la coupe quand elle tomberait dedans : la pastille garde ce qui le précède', () => {
      expect(shortTitle('A'.repeat(straddling) + cluster + 'BBBB')).toBe('A'.repeat(straddling) + '…');
    });

    it('reste entier quand la coupe tombe après lui', () => {
      expect(shortTitle('A'.repeat(fitting) + cluster + 'BBBB')).toBe('A'.repeat(fitting) + cluster + tail + '…');
    });
  });

  it('coupe un titre d’emojis où il se coupait : chacun compte pour deux unités, comme avant', () => {
    expect(shortTitle('😀'.repeat(13))).toBe('😀'.repeat(11) + '…');
  });

  it('garde au moins le premier graphème, même plus long que la limite : jamais une pastille réduite à l’ellipse', () => {
    const stacked = 'a' + '\u0301'.repeat(30);
    expect(shortTitle(stacked + 'bcdef')).toBe(stacked + '…');
  });

  // Quand le titre n'est que ce graphème, rien n'est coupé : il reste entier, et une ellipse annoncerait une coupe qui n'a pas eu lieu (bdesk-38k.62). Un graphème qui n'a pas de fin :
  // une lettre empilée de marques, ou des emojis liés par des liants sans chasse.
  describe('un titre qui n’est qu’un graphème plus long que la limite reste entier, sans ellipse : rien n’est coupé', () => {
    const stacked = 'x' + '\u0301'.repeat(40);
    const chain = '👨' + '\u200d👩'.repeat(12);

    it.each([
      ['une lettre empilée de 40 marques', stacked],
      ['treize emojis liés par des liants sans chasse', chain],
    ])('%s', (_kind, title) => {
      expect(shortTitle(title)).toBe(title);
    });

    it('en est de même d’une tête qui n’est que ce graphème : ce qui suit le séparateur n’est pas dans la pastille, et rien de la tête n’est coupé', () => {
      expect(shortTitle(stacked + ' : thèmes et navigation')).toBe(stacked);
    });

    // Ce qui suit ce graphème peut ne pas se voir non plus : un caractère sans largeur devant le séparateur n'ajoute rien à l'écran, et la pastille n'a pas plus de raison d'y porter une ellipse
    // que sans lui.
    it('des caractères sans largeur derrière ce graphème ne changent pas la pastille : rien de visible n’est coupé, pas d’ellipse', () => {
      const plain = shortTitle(stacked + ' : thèmes et navigation');
      expect(plain).toBe(stacked);
      expect(withoutInvisible(shortTitle(stacked + '\u200b : thèmes et navigation'))).toBe(plain);
      expect(withoutInvisible(shortTitle(stacked + '\u200b\u2060 – thèmes et navigation'))).toBe(plain);
    });

    it('garde l’ellipse dès qu’une partie du titre est coupée : ce graphème suivi d’autres', () => {
      expect(shortTitle('ab' + stacked)).toBe('ab…');
      expect(shortTitle(stacked + 'bcdef')).toBe(stacked + '…');
      expect(shortTitle(stacked + '\u200b' + 'bcdef')).toBe(stacked + '…');
    });
  });

  // Un « é » s'écrit en un caractère (NFC) ou en deux (NFD : un copier-coller depuis macOS en donne) : l'écran n'en voit pas la différence, la pastille non plus. La limite se mesure en forme composée ;
  // le texte montré reste celui du titre, caractère pour caractère (la pastille d'un titre NFD est en NFD), comme le libellé du filtre Epic (bdesk-38k.62).
  describe('un titre en forme décomposée (NFD) se coupe où le même titre en forme composée (NFC)', () => {
    it.each([
      ['Écran réactivé après la mise à jour du thème', 'Écran réactivé après…'],
      ['Réorganisation des modèles métier', 'Réorganisation des…'],
      ['é'.repeat(25), 'é'.repeat(23) + '…'],
      ['é'.repeat(24), 'é'.repeat(24)],
      // La coupe à la fin d'un mot n'a lieu que si ce qui précède fait la moitié de la limite : huit « é » n'en font que huit, composés ou non, et la coupe reste au milieu du mot.
      ['é'.repeat(8) + ' ' + 'x'.repeat(30), 'é'.repeat(8) + ' ' + 'x'.repeat(14) + '…'],
    ])('%s', (title, short) => {
      expect(shortTitle(title.normalize('NFC'))).toBe(short.normalize('NFC'));
      expect(shortTitle(title.normalize('NFD'))).toBe(short.normalize('NFD'));
    });

    it('mesure aussi le seuil de la tête en forme composée : « Éé » avant « : » reste trop mince, qu’il soit écrit d’une façon ou de l’autre', () => {
      for (const form of ['NFC', 'NFD'] as const) expect(shortTitle('Éé : suivi'.normalize(form)), form).toBe('Éé : suivi'.normalize(form));
    });
  });
});

// Un séparateur en tête reste ce que l'auteur a écrit : le retirer change le sens (« – 5 °C » perd son signe moins, « — 2024 — Refonte » devient « 2024 »). Une tête faite de blancs ou de caractères sans
// largeur se lit comme une tête vide : la pastille est celle du titre visible, qui commence par ce séparateur (bdesk-38k.62).
describe('shortTitle : un séparateur en tête reste dans la pastille', () => {
  const SIGNS = [':', '–', '—', '-'];
  const HEADS = ['', ' ', '\u200b', '\u200b\u200b\u200b', '\u2060\u00ad\u200c ', ' \u200d\u200b ', '\ufeff'];

  it.each([[': Refonte du shell'], ['– 5 °C ce matin'], ['— 2024 — Refonte'], ['- [ ] tâche'], ['- 1 degré de plus'], [': V1 : suivi']])('garde « %s » : sans son signe, le titre dirait autre chose', (title) => {
    expect(shortTitle(title)).toBe(title);
  });

  it.each(SIGNS)('lit comme une tête vide les blancs et les caractères sans largeur qui précèdent « %s » : la pastille du titre visible', (sign) => {
    for (const head of HEADS) expect(shortTitle(`${head}${sign} Refonte du shell`), JSON.stringify(head)).toBe(`${sign} Refonte du shell`);
  });

  it('lit de même un caractère sans largeur entre le signe et l’espace qui le suit : le titre visible est le même', () => {
    expect(shortTitle(':\u200b Refonte du shell')).toBe(':\u200b Refonte du shell');
    expect(shortTitle('\u200b:\u2060 Refonte du shell').replace(/\p{Cf}/gu, '')).toBe(': Refonte du shell');
  });

  it('lit encore l’intitulé qui précède un séparateur, comme avant', () => {
    expect(shortTitle('Refonte du shell : thèmes et navigation')).toBe('Refonte du shell');
    expect(shortTitle('\u200bRefonte : du shell')).toBe('Refonte');
  });

  // Seule une Epic dont le titre n'est fait que de ces signes (et de blancs, de caractères sans largeur) n'a rien à lire dans sa pastille : `epicShortName` y met son identifiant.
  it.each([
    [':'],
    ['–'],
    [' : '],
    ['::'],
    ['- - -'],
    [': –'],
    ['\u200b : \u200b'],
    ['\u2060-\u200d'],
  ])('ne lit rien d’un titre fait de séparateurs seuls : « %s »', (title) => {
    expect(shortTitle(title)).toBe('');
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
  // Le libellé garde les caractères sans largeur du titre ; deux espaces qu'ils séparent n'en font qu'une (la première : `collapseSpaces`).
  it.each([
    ['en tête', '\u200bRefonte du shell', '\u200bRefonte du shell (a)'],
    ['au milieu d’un mot', 'Refonte du sh\u200bell', 'Refonte du sh\u200bell (a)'],
    ['entre deux mots', 'Refonte \u200b du shell', 'Refonte \u200bdu shell (a)'],
    ['à la fin', 'Refonte du shell\u2060', 'Refonte du shell\u2060 (a)'],
  ])('distingue deux Epics qui ne diffèrent que par un caractère sans largeur %s : chacune porte son identifiant', (_where, title, label) => {
    expect(labels(epic('a', title), epic('b', 'Refonte du shell'), epic('c', 'Autre'))).toEqual({
      a: label,
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

  // Comme `epicName` : une Epic dont le titre n'est fait que de séparateurs n'a pas de nom à lire, le filtre dit son identifiant.
  it.each(SEPARATOR_TITLES)('garde lisible une Epic dont le titre est %s, même partagé : l’identifiant, comme un titre vide', (_kind, title) => {
    expect(labels(epic('a', title), epic('b', title), epic('c', 'Autre'))).toEqual({ a: 'a', b: 'b', c: 'Autre' });
  });

  // Une Epic sans titre se lit par son identifiant (`epicName`) : une autre qui porte ce même texte pour titre aurait la même option, et rien ne les distinguerait (bdesk-38k.62).
  describe('une Epic titrée comme l’identifiant d’une Epic sans titre', () => {
    it('porte son identifiant ; l’Epic sans titre garde le sien, que son titre soit vide ou fait de blancs : deux options qui se lisent différemment', () => {
      expect(labels(epic('bdesk-c', 'bdesk-z'), epic('bdesk-z', ' '))).toEqual({ 'bdesk-c': 'bdesk-z (bdesk-c)', 'bdesk-z': 'bdesk-z' });
      expect(labels(epic('bdesk-z', ''), epic('bdesk-c', 'bdesk-z'))).toEqual({ 'bdesk-z': 'bdesk-z', 'bdesk-c': 'bdesk-z (bdesk-c)' });
    });

    it('le fait sans tenir compte de la casse, des espaces ni des caractères sans largeur', () => {
      expect(labels(epic('bdesk-c', '  BDESK-Z\u200b '), epic('bdesk-z', ''))).toEqual({ 'bdesk-c': 'BDESK-Z\u200b (bdesk-c)', 'bdesk-z': 'bdesk-z' });
    });

    it('le fait pour chacune des Epics qui portent ce titre, et laisse les autres', () => {
      expect(labels(epic('a', 'bdesk-z'), epic('b', 'bdesk-z'), epic('bdesk-z', '\u200b'), epic('c', 'Autre'))).toEqual({
        a: 'bdesk-z (a)',
        b: 'bdesk-z (b)',
        'bdesk-z': 'bdesk-z',
        c: 'Autre',
      });
    });

    it('ne change rien tant que le titre n’est l’identifiant d’aucune Epic sans titre', () => {
      expect(labels(epic('bdesk-c', 'bdesk-z'), epic('bdesk-y', 'Autre'))).toEqual({ 'bdesk-c': 'bdesk-z', 'bdesk-y': 'Autre' });
    });
  });

  // L'option qui retire le filtre se lit « Toutes les Epics » (`EpicFilter`) : une Epic qui s'intitule ainsi aurait la même, et choisir l'une ou l'autre ne se distinguerait pas (review62, F1).
  describe('une Epic titrée comme l’option « Toutes les Epics » du filtre', () => {
    it('porte son identifiant : l’option du filtre garde son libellé', () => {
      expect(labels(epic('lab-kyj', 'Toutes les Epics'))).toEqual({ 'lab-kyj': 'Toutes les Epics (lab-kyj)' });
    });

    it('le fait sans tenir compte de la casse, des espaces ni des caractères sans largeur, et garde sa façon d’écrire', () => {
      expect(labels(epic('a', 'toutes les epics'), epic('b', '  TOUTES   LES EPICS\u200b '), epic('c', 'Toutes les Epic'))).toEqual({
        a: 'toutes les epics (a)',
        b: 'TOUTES LES EPICS\u200b (b)',
        c: 'Toutes les Epic',
      });
    });

    it('le fait aussi quand l’Epic est la seule, ou que son titre s’écrit comme le libellé que reçoit une autre', () => {
      expect(labels(epic('a', 'Toutes les Epics'), epic('b', 'Toutes les Epics (a)'))).toEqual({
        a: 'Toutes les Epics (a)',
        b: 'Toutes les Epics (a) (b)',
      });
    });

    it('suit les libellés réservés qu’on lui donne : d’autres, ou aucun', () => {
      expect(Object.fromEntries(epicLabels([epic('a', 'Tout'), epic('b', 'Toutes les Epics')], ['Tout']))).toEqual({ a: 'Tout (a)', b: 'Toutes les Epics' });
      expect(Object.fromEntries(epicLabels([epic('a', 'Toutes les Epics')], []))).toEqual({ a: 'Toutes les Epics' });
    });
  });

  // Quels que soient les titres, deux options ne se lisent jamais pareil à l'écran, l'option « Toutes les Epics » du filtre comprise. On prend tous les ensembles de quatre Epics (identifiants « a » à « d »)
  // dont les titres viennent de la liste ci-dessous : des titres vides ou de séparateurs seuls, le même titre à la casse, à la forme Unicode ou aux caractères sans largeur près, le titre qui est
  // l'identifiant d'une autre Epic, celui qui s'écrit comme le libellé qu'une autre reçoit (« Refonte (a) », « a (b) ») ou comme l'option du filtre : décorer l'une ferait alors se rejoindre deux libellés.
  it('ne donne jamais deux options qui se lisent pareil, quelles que soient les Epics du Projet', () => {
    const titles = ['', ':', 'Refonte', 'REFONTE', 'Refonte\u200b', 'Cafe\u0301', 'Café', 'a', 'B', 'Refonte (a)', 'a (b)', 'a (b) (c)', 'Toutes les Epics', 'toutes les epics (a)'];
    const ids = ['a', 'b', 'c', 'd'];
    /** Ce que l'œil lit d'un libellé. Écrit ici et non importé de `sameTitleKey` : un test ne doit pas dépendre du code qu'il éprouve. */
    const seen = (label: string) => label.replace(/\p{Cf}/gu, '').replace(/\s+/g, ' ').trim().toLowerCase().normalize('NFC');
    let sets = [[] as string[]];
    for (let rank = 0; rank < ids.length; rank += 1) sets = sets.flatMap((chosen) => titles.map((title) => [...chosen, title]));

    const clashes = sets.filter((chosen) => {
      const epics = chosen.map((title, index) => epic(ids[index] as string, title));
      const read = [seen('Toutes les Epics'), ...[...epicLabels(epics).values()].map(seen)];
      return new Set(read).size !== read.length;
    });

    expect(sets).toHaveLength(titles.length ** ids.length);
    expect(clashes.map((chosen) => JSON.stringify(chosen))).toEqual([]);
  });

  it('donne à chaque Epic un libellé qui la nomme : son titre (suivi de son identifiant au besoin), ou son identifiant sans titre', () => {
    const epics = [epic('a', 'Refonte'), epic('b', 'refonte'), epic('c', ' '), epic('d', 'c'), epic('e', ':')];

    expect(labels(...epics)).toEqual({ a: 'Refonte (a)', b: 'refonte (b)', c: 'c', d: 'c (d)', e: 'e' });
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

  it.each<readonly [string, string]>([
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
    ...SEPARATOR_TITLES,
  ])('nomme par son identifiant une Epic dont le titre est %s', (_kind, title) => {
    expect(epicName(epic(title))).toBe('bdesk-e1');
    expect(epicShortName(epic(title))).toBe('bdesk-e1');
  });

  it('garde un titre qui contient un caractère sans largeur mais aussi du texte : seul un titre fait uniquement de blancs est remplacé', () => {
    expect(epicName(epic('Refonte\u200b du shell'))).toBe('Refonte\u200b du shell');
    expect(epicShortName(epic('Refonte\u200b : du shell'))).toBe('Refonte\u200b');
  });

  // Le nom d'une Epic est dérivé de son titre (l'intitulé avant un séparateur) : sans rien d'autre que des séparateurs il n'y a pas d'intitulé, et l'identifiant la nomme. Le titre d'un ticket, lui, est ce que
  // l'auteur a écrit (« - » reste « - » : `ticketTitle`), et un titre vide reste « Sans titre ».
  it.each(SEPARATOR_TITLES)('nomme une Epic dont le titre est %s par son identifiant, quand le ticket qui a ce titre le garde', (_kind, title) => {
    const kept = ticketTitle({ title });

    expect(epicName(epic(title))).toBe('bdesk-e1');
    expect(kept).not.toBe('Sans titre');
    expect(withoutInvisible(kept)).toBe(withoutInvisible(title).replace(/\s+/g, ' ').trim());
  });

  // Seuls des séparateurs seuls ne nomment rien : une autre ponctuation, un signe collé au mot ou suivi de texte nomment l'Epic de ce que l'auteur a écrit.
  it.each([['???'], ['…'], [':)'], ['-1'], ['--force'], ['– 5 °C'], [': Refonte']])('nomme une Epic dont le titre est « %s » par ce titre, non par son identifiant', (title) => {
    expect(epicName(epic(title))).toBe(title);
    expect(epicShortName(epic(title))).toBe(title);
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

  it.each<readonly [string, string]>([
    ['une espace sans largeur', '\u200b'],
    ['des caractères sans largeur et des espaces', ' \u200c\u200d\u2060 '],
    ...SEPARATOR_TITLES,
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
    ['deux espaces que sépare un caractère sans largeur', 'Un\u200b \u200b titre'],
    ['des caractères sans largeur entre le bord et une espace', '\u200b Un titre \u2060'],
  ])('%s', (_kind, title) => {
    expect(ticketTitle({ title })).toBe(epicName({ id: 'bdesk-e1', title }));
  });

  it('repliant l’un comme l’autre à une seule espace', () => {
    expect(ticketTitle({ title: ' \n Un   titre\t\tà   espaces ' })).toBe('Un titre à espaces');
  });
});
