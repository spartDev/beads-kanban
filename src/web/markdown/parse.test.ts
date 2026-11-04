import { describe, expect, it } from 'vitest';
import { type Block, type Inline, parseInline, parseMarkdown } from './parse';

const text = (value: string): Inline => ({ type: 'text', value });
const code = (value: string): Inline => ({ type: 'code', value });
const em = (...children: Inline[]): Inline => ({ type: 'em', children });
const strong = (...children: Inline[]): Inline => ({ type: 'strong', children });
const del = (...children: Inline[]): Inline => ({ type: 'del', children });
const link = (href: string, ...children: Inline[]): Inline => ({ type: 'link', href, children });
const br: Inline = { type: 'br' };

const paragraph = (...children: Inline[]): Block => ({ type: 'paragraph', children });

describe('parseInline', () => {
  it('garde le texte tel quel', () => {
    expect(parseInline('Un texte simple, avec des accents : é ü ⌘K.')).toEqual([text('Un texte simple, avec des accents : é ü ⌘K.')]);
  });

  it('lit le gras, l’italique et le barré', () => {
    expect(parseInline('un **gras**, un *italique*, un _autre_ et du ~~barré~~')).toEqual([
      text('un '),
      strong(text('gras')),
      text(', un '),
      em(text('italique')),
      text(', un '),
      em(text('autre')),
      text(' et du '),
      del(text('barré')),
    ]);
  });

  it('imbrique le gras et l’italique', () => {
    expect(parseInline('***les deux***')).toEqual([em(strong(text('les deux')))]);
    expect(parseInline('**gras et *italique* dedans**')).toEqual([strong(text('gras et '), em(text('italique')), text(' dedans'))]);
  });

  it('ne met pas en italique les tirets bas d’un identifiant ni les astérisques isolés', () => {
    expect(parseInline('snake_case_name et bdesk_38k_x')).toEqual([text('snake_case_name et bdesk_38k_x')]);
    expect(parseInline('2 * 3 * 4')).toEqual([text('2 * 3 * 4')]);
    expect(parseInline('**non fermé')).toEqual([text('**non fermé')]);
  });

  it('lit le code en ligne, sans rien interpréter dedans', () => {
    expect(parseInline('appelle `bd show **x**` puis `a<b>c`')).toEqual([text('appelle '), code('bd show **x**'), text(' puis '), code('a<b>c')]);
    expect(parseInline('`` un ` backtick ``')).toEqual([code('un ` backtick')]);
    expect(parseInline('un ` seul')).toEqual([text('un ` seul')]);
  });

  it('lit un lien, avec son titre', () => {
    expect(parseInline('voir [la doc](https://example.com/a?b=1&c=2) ici')).toEqual([
      text('voir '),
      link('https://example.com/a?b=1&c=2', text('la doc')),
      text(' ici'),
    ]);
    expect(parseInline('[x](https://example.com "Un titre")')).toEqual([{ type: 'link', href: 'https://example.com', title: 'Un titre', children: [text('x')] }]);
  });

  it('accepte des parenthèses équilibrées dans l’adresse d’un lien, et du gras dans son texte', () => {
    expect(parseInline('[wiki](https://fr.wikipedia.org/wiki/Dolt_(base))')).toEqual([link('https://fr.wikipedia.org/wiki/Dolt_(base)', text('wiki'))]);
    expect(parseInline('[**gras**](https://example.com)')).toEqual([link('https://example.com', strong(text('gras')))]);
  });

  it('ne lit plus comme un lien une adresse ou un titre de plus de 2 000 caractères, ni une adresse à plus de 32 niveaux de parenthèses', () => {
    const far = 'a'.repeat(2_500);
    const nested = (levels: number) => `${'('.repeat(levels)}u${')'.repeat(levels)}`;

    // Un lien ne relit jamais la suite du texte jusqu'à sa fin pour se décider : ces bornes (celles de cmark pour les parenthèses) y veillent.
    expect(parseInline(`[x](${far})`)).toEqual([text(`[x](${far})`)]);
    expect(parseInline(`[x](u "${far}")`)).toEqual([text(`[x](u "${far}")`)]);
    expect(parseInline(`[x](${nested(33)})`)).toEqual([text(`[x](${nested(33)})`)]);
    expect(parseInline(`[x](${nested(32)})`)).toEqual([link(nested(32), text('x'))]);
    expect(parseInline('[x](u "titre")')).toEqual([{ type: 'link', href: 'u', title: 'titre', children: [text('x')] }]);
  });

  it('laisse tel quel un crochet qui n’est pas un lien', () => {
    expect(parseInline('un [crochet] seul et [deux](pas fermé')).toEqual([text('un [crochet] seul et [deux](pas fermé')]);
  });

  it('lit une adresse nue et un lien entre chevrons, sans la ponctuation qui suit', () => {
    expect(parseInline('voir https://example.com/a/b.')).toEqual([text('voir '), link('https://example.com/a/b', text('https://example.com/a/b')), text('.')]);
    expect(parseInline('(https://example.com/x)')).toEqual([text('('), link('https://example.com/x', text('https://example.com/x')), text(')')]);
    expect(parseInline('<https://example.com/y> et <mailto:a@b.fr>')).toEqual([
      link('https://example.com/y', text('https://example.com/y')),
      text(' et '),
      link('mailto:a@b.fr', text('mailto:a@b.fr')),
    ]);
  });

  it('ne lit pas une adresse au milieu d’un mot', () => {
    expect(parseInline('xhttps://example.com')).toEqual([text('xhttps://example.com')]);
  });

  it('laisse le HTML brut en texte : ni balise, ni attribut, ni script ne sont interprétés', () => {
    expect(parseInline('<img src=x onerror=alert(1)> et <script>alert(1)</script>')).toEqual([
      text('<img src=x onerror=alert(1)> et <script>alert(1)</script>'),
    ]);
    expect(parseInline('chemin /p/<projet>/t/<id>')).toEqual([text('chemin /p/<projet>/t/<id>')]);
  });

  it('garde un lien dangereux tel que l’auteur l’a écrit : c’est l’affichage qui décide de ne pas le suivre', () => {
    expect(parseInline('[clic](javascript:alert(1))')).toEqual([link('javascript:alert(1)', text('clic'))]);
  });

  it('garde les retours à la ligne d’un paragraphe', () => {
    expect(parseInline('première ligne\nseconde ligne')).toEqual([text('première ligne'), br, text('seconde ligne')]);
    expect(parseInline('fin avec deux espaces  \nsuite')).toEqual([text('fin avec deux espaces'), br, text('suite')]);
    expect(parseInline('fin avec antislash\\\nsuite')).toEqual([text('fin avec antislash'), br, text('suite')]);
  });

  it('lit les échappements et les entités courantes', () => {
    expect(parseInline('\\*pas gras\\* et \\[pas un lien\\]')).toEqual([text('*pas gras* et [pas un lien]')]);
    expect(parseInline('a &amp; b &lt;c&gt; &quot;d&quot; &#39;e&#39; &#x41;')).toEqual([text('a & b <c> "d" \'e\' A')]);
    expect(parseInline('&inconnue; et AT&T')).toEqual([text('&inconnue; et AT&T')]);
  });

  it('lit une image comme une image : jamais chargée, c’est l’affichage qui en fait un lien', () => {
    expect(parseInline('![logo](https://example.com/logo.png) fin')).toEqual([{ type: 'image', src: 'https://example.com/logo.png', alt: 'logo' }, text(' fin')]);
  });
});

describe('parseMarkdown : les blocs', () => {
  it('sépare les paragraphes par une ligne vide', () => {
    expect(parseMarkdown('Un.\n\nDeux.\nSuite de deux.\n\n\n\nTrois.')).toEqual([
      paragraph(text('Un.')),
      paragraph(text('Deux.'), br, text('Suite de deux.')),
      paragraph(text('Trois.')),
    ]);
  });

  it('ne produit rien d’un texte vide ou blanc', () => {
    expect(parseMarkdown('')).toEqual([]);
    expect(parseMarkdown('  \n\n \t\n')).toEqual([]);
  });

  it('lit les titres ATX, avec ou sans dièses de fermeture, et refuse un dièse collé', () => {
    expect(parseMarkdown('# Un\n## Deux ##\n###### Six\n####### Sept\n#collé\n#')).toEqual([
      { type: 'heading', depth: 1, children: [text('Un')] },
      { type: 'heading', depth: 2, children: [text('Deux')] },
      { type: 'heading', depth: 6, children: [text('Six')] },
      paragraph(text('####### Sept'), br, text('#collé')),
      { type: 'heading', depth: 1, children: [] },
    ]);
  });

  it('lit les titres soulignés (setext) et distingue la ligne horizontale', () => {
    expect(parseMarkdown('Titre un\n========\n\nTitre deux\n---\n\n---\n\n* * *')).toEqual([
      { type: 'heading', depth: 1, children: [text('Titre un')] },
      { type: 'heading', depth: 2, children: [text('Titre deux')] },
      { type: 'rule' },
      { type: 'rule' },
    ]);
  });

  it('lit un bloc de code clôturé, avec son langage, sans interpréter l’intérieur', () => {
    expect(parseMarkdown('Avant\n```ts\nconst a = "**x**";\n\n# pas un titre\n```\nAprès')).toEqual([
      paragraph(text('Avant')),
      { type: 'code', lang: 'ts', value: 'const a = "**x**";\n\n# pas un titre' },
      paragraph(text('Après')),
    ]);
    expect(parseMarkdown('~~~\nun\n~~~')).toEqual([{ type: 'code', lang: '', value: 'un' }]);
  });

  it('ne ferme un bloc de code que par une clôture au moins aussi longue, et le garde ouvert jusqu’à la fin sinon', () => {
    expect(parseMarkdown('````\n```\ndedans\n```\n````')).toEqual([{ type: 'code', lang: '', value: '```\ndedans\n```' }]);
    expect(parseMarkdown('```\nnon fermé\nsuite')).toEqual([{ type: 'code', lang: '', value: 'non fermé\nsuite' }]);
  });

  it('lit un bloc de code indenté', () => {
    expect(parseMarkdown('Texte\n\n    ligne 1\n\n    ligne 2\n\nFin')).toEqual([
      paragraph(text('Texte')),
      { type: 'code', lang: '', value: 'ligne 1\n\nligne 2' },
      paragraph(text('Fin')),
    ]);
  });

  it('ne prend pas pour du code une ligne indentée qui continue un paragraphe', () => {
    expect(parseMarkdown('Un paragraphe\n    qui continue')).toEqual([paragraph(text('Un paragraphe'), br, text('qui continue'))]);
  });

  it('lit une citation, imbriquée et avec continuation paresseuse', () => {
    expect(parseMarkdown('> Citation\nsuite paresseuse\n>\n> > Imbriquée')).toEqual([
      {
        type: 'quote',
        children: [paragraph(text('Citation'), br, text('suite paresseuse')), { type: 'quote', children: [paragraph(text('Imbriquée'))] }],
      },
    ]);
  });
});

describe('parseMarkdown : les listes', () => {
  const item = (...children: Block[]) => ({ checked: null, children });

  it('lit une liste à puces serrée, quel que soit le caractère de puce', () => {
    expect(parseMarkdown('- un\n- deux\n* trois\n+ quatre')).toEqual([
      { type: 'list', ordered: false, start: 1, tight: true, items: [item(paragraph(text('un'))), item(paragraph(text('deux'))), item(paragraph(text('trois'))), item(paragraph(text('quatre')))] },
    ]);
  });

  it('lit une liste numérotée, avec son premier numéro', () => {
    expect(parseMarkdown('3. trois\n4. quatre\n10. dix')).toEqual([
      { type: 'list', ordered: true, start: 3, tight: true, items: [item(paragraph(text('trois'))), item(paragraph(text('quatre'))), item(paragraph(text('dix')))] },
    ]);
  });

  it('commence une autre liste quand le séparateur du numéro change (« 1. » puis « 2) »)', () => {
    const lists = parseMarkdown('1. un\n2) deux');
    expect(lists.map((block) => block.type)).toEqual(['list', 'list']);
  });

  it('dit qu’une liste est lâche quand une ligne vide sépare deux items', () => {
    const [list] = parseMarkdown('- un\n\n- deux');
    expect(list).toMatchObject({ type: 'list', tight: false });
  });

  it('imbrique une liste dans un item, indentée du contenu de l’item', () => {
    expect(parseMarkdown('1. Parent\n   - enfant a\n   - enfant b\n2. Suivant')).toEqual([
      {
        type: 'list',
        ordered: true,
        start: 1,
        tight: true,
        items: [
          item(paragraph(text('Parent')), { type: 'list', ordered: false, start: 1, tight: true, items: [item(paragraph(text('enfant a'))), item(paragraph(text('enfant b')))] }),
          item(paragraph(text('Suivant'))),
        ],
      },
    ]);
  });

  it('imbrique aussi une liste à puces indentée de deux espaces sous un item numéroté, comme l’auteur l’entend', () => {
    const [list] = parseMarkdown('1. Parent\n  - enfant\n2. Suivant');
    expect(list).toMatchObject({ type: 'list', ordered: true });
    expect((list as Extract<Block, { type: 'list' }>).items).toHaveLength(2);
    expect((list as Extract<Block, { type: 'list' }>).items[0]?.children[1]).toMatchObject({ type: 'list', ordered: false });
  });

  it('garde un second paragraphe, un bloc de code et une citation dans un item', () => {
    expect(parseMarkdown('- un\n\n  second paragraphe\n\n  ```\n  code\n  ```')).toEqual([
      {
        type: 'list',
        ordered: false,
        start: 1,
        tight: false,
        items: [item(paragraph(text('un')), paragraph(text('second paragraphe')), { type: 'code', lang: '', value: 'code' })],
      },
    ]);
  });

  it('continue un item sur la ligne suivante, indentée ou non', () => {
    expect(parseMarkdown('- un item\n  qui continue\nsuite paresseuse')).toEqual([
      { type: 'list', ordered: false, start: 1, tight: true, items: [item(paragraph(text('un item'), br, text('qui continue'), br, text('suite paresseuse')))] },
    ]);
  });

  it('lit une liste de tâches', () => {
    const [list] = parseMarkdown('- [ ] à faire\n- [x] fait\n- [X] fait aussi\n- [y] pas une case');
    expect((list as Extract<Block, { type: 'list' }>).items.map((i) => [i.checked, i.children[0]])).toEqual([
      [false, paragraph(text('à faire'))],
      [true, paragraph(text('fait'))],
      [true, paragraph(text('fait aussi'))],
      [null, paragraph(text('[y] pas une case'))],
    ]);
  });

  it('interrompt un paragraphe par une liste à puces, mais seul « 1. » interrompt par une liste numérotée', () => {
    expect(parseMarkdown('Titre\n- un\n- deux')).toEqual([
      paragraph(text('Titre')),
      { type: 'list', ordered: false, start: 1, tight: true, items: [item(paragraph(text('un'))), item(paragraph(text('deux')))] },
    ]);
    expect(parseMarkdown('Vers le 12.\nsuite')).toEqual([paragraph(text('Vers le 12.'), br, text('suite'))]);
    expect(parseMarkdown('Texte\n3. trois')).toEqual([paragraph(text('Texte'), br, text('3. trois'))]);
  });

  it('ne prend pas pour une liste un tiret sans espace, ni une puce vide pour du texte', () => {
    expect(parseMarkdown('-pas une puce\n--aussi')).toEqual([paragraph(text('-pas une puce'), br, text('--aussi'))]);
    const [list] = parseMarkdown('-\n- deux');
    expect(list).toMatchObject({ type: 'list' });
  });
});

describe('parseMarkdown : les tableaux', () => {
  it('lit un tableau GFM, avec l’alignement de ses colonnes', () => {
    expect(parseMarkdown('| Ticket | État | Durée |\n|:--|:-:|--:|\n| a-1 | **fermé** | 3 j |\n| a-2 | ouvert | |')).toEqual([
      {
        type: 'table',
        align: ['left', 'center', 'right'],
        head: [[text('Ticket')], [text('État')], [text('Durée')]],
        rows: [
          [[text('a-1')], [strong(text('fermé'))], [text('3 j')]],
          [[text('a-2')], [text('ouvert')], []],
        ],
      },
    ]);
  });

  it('lit un tableau sans barres aux extrémités, et des barres échappées dans une cellule', () => {
    expect(parseMarkdown('a | b\n--|--\nun \\| deux | trois')).toEqual([
      { type: 'table', align: [null, null], head: [[text('a')], [text('b')]], rows: [[[text('un | deux')], [text('trois')]]] },
    ]);
  });

  it('ramène chaque ligne au nombre de colonnes de l’en-tête', () => {
    const [table] = parseMarkdown('| a | b |\n|---|---|\n| 1 |\n| 1 | 2 | 3 |');
    expect((table as Extract<Block, { type: 'table' }>).rows.map((row) => row.length)).toEqual([2, 2]);
  });

  it('s’arrête à la ligne vide, et ne lit pas de tableau sans ligne de séparation', () => {
    expect(parseMarkdown('| a |\n|---|\n| 1 |\n\nFin')).toEqual([
      { type: 'table', align: [null], head: [[text('a')]], rows: [[[text('1')]]] },
      paragraph(text('Fin')),
    ]);
    expect(parseMarkdown('| pas | un tableau |\n| 1 | 2 |')).toEqual([paragraph(text('| pas | un tableau |'), br, text('| 1 | 2 |'))]);
  });
});

describe('parseMarkdown : un texte quelconque ne fait jamais échouer', () => {
  it('termine vite sur des imbrications pathologiques', () => {
    const inputs = [
      '>'.repeat(5000) + ' fin',
      '- '.repeat(3000) + 'x',
      '*'.repeat(5000),
      '['.repeat(5000) + ']'.repeat(5000),
      '*a '.repeat(3000),
      '`'.repeat(5000),
      '| a |\n|---|\n' + '| b |\n'.repeat(2000),
      ('1. a\n' + ' '.repeat(3)).repeat(500),
    ];
    for (const input of inputs) {
      const started = Date.now();
      expect(() => parseMarkdown(input)).not.toThrow();
      expect(Date.now() - started, input.slice(0, 20)).toBeLessThan(1500);
    }
  });

  it('lit tout texte aléatoire sans lever d’erreur', () => {
    const alphabet = ['*', '_', '`', '[', ']', '(', ')', '<', '>', '!', '#', '-', '+', '|', '\\', '~', ' ', ' ', '\n', '\n', '1.', 'a', 'bd', 'https://x.fr', ':', '&amp;', '\t'];
    let seed = 42;
    const next = () => {
      seed = (seed * 1664525 + 1013904223) % 4294967296;
      return seed / 4294967296;
    };
    for (let round = 0; round < 400; round++) {
      let input = '';
      for (let i = 0, n = Math.floor(next() * 60); i < n; i++) input += alphabet[Math.floor(next() * alphabet.length)];
      expect(() => parseMarkdown(input), JSON.stringify(input)).not.toThrow();
    }
  });

  it('lit 130 000 crochets entre deux astérisques sans dépasser la pile : l’italique les contient', () => {
    // `Math.max(...jetons)` déplie le tableau en arguments : au-delà d'une centaine de milliers de jetons, la pile y passe.
    const brackets = '['.repeat(130_000);

    expect(parseMarkdown(`*a${brackets}a*`)).toEqual([paragraph(em(text(`a${brackets}a`)))]);
  });

  it('plafonne à 12 niveaux l’imbrication des emphases : au-delà, les marques restent du texte', () => {
    const depth = (inlines: Inline[]): number =>
      Math.max(0, ...inlines.map((inline) => ('children' in inline && inline.type !== 'link' ? 1 + depth(inline.children) : 0)));
    const nested = `${'*a '.repeat(30)}b${' a*'.repeat(30)}`;

    const [paragraphBlock] = parseMarkdown(nested);

    expect(paragraphBlock?.type).toBe('paragraph');
    expect(depth(paragraphBlock?.type === 'paragraph' ? paragraphBlock.children : [])).toBe(12);
  });

  it('ne lit pas comme du Markdown un texte de plus de 400 000 caractères : il s’affiche tel quel, dans un bloc de code', () => {
    const huge = `# Un titre\n${'une ligne de journal avec **du gras**\n'.repeat(15_000)}`;

    expect(parseMarkdown(huge)).toEqual([{ type: 'code', lang: '', value: huge }]);
  });

  it('arrête un tableau à 20 000 cellules : les rangées de plus restent du texte, au lieu d’être remplies une à une jusqu’à la largeur de l’en-tête', () => {
    const columns = 50;
    const header = `${'|a'.repeat(columns)}|\n${'|-'.repeat(columns)}|\n`;

    const blocks = parseMarkdown(`${header}${'|b\n'.repeat(1_000)}`);

    const [table, rest] = blocks;
    expect(table?.type).toBe('table');
    // L'en-tête compte : (rangées + 1) × colonnes ≤ 20 000, soit 399 rangées de 50 cellules.
    expect(table?.type === 'table' ? table.rows.length : 0).toBe(399);
    expect(rest?.type).toBe('paragraph');
  });

  it('ne lit pas comme un tableau une ligne de plus de 100 colonnes : elle resterait à remplir pour chacune des lignes qui suivent', () => {
    const wide = `${'|a'.repeat(150)}|\n${'|-'.repeat(150)}|\n${'|b'.repeat(150)}|`;

    expect(parseMarkdown(wide).map((block) => block.type)).toEqual(['paragraph']);
  });
});

describe('parseMarkdown : un texte quelconque ne fait jamais durer', () => {
  const HUNDRED_KB = 100_000;
  const repeated = (unit: string) => unit.repeat(Math.ceil(HUNDRED_KB / unit.length));

  // Chaque entrée a fait travailler le lecteur en temps quadratique : 100 ko prenaient de 2 à 30 secondes, le fil principal figé.
  const pathological: [string, string][] = [
    ['des « [](» à la suite (chaque « ]( » relisait la suite du texte)', repeated('[](')],
    ['des marques fermantes sans ouvrante (« a* »)', repeated('a* ')],
    ['des marques ouvrantes, puis autant de fermantes', '*a '.repeat(16_000) + 'a* '.repeat(16_000)],
    ['des astérisques et des tirets bas en alternance', repeated('*_')],
    ['des paires en gras', repeated('**a** ')],
    ['des titres de lien jamais fermés (« [](a ( »)', repeated('[](a (')],
    ['des adresses suivies de milliers de parenthèses fermantes', ('http://a' + ')'.repeat(1990) + ' ').repeat(50)],
    ['une ligne avec une très longue suite d’espaces', `a${' '.repeat(HUNDRED_KB)}b\nc`],
    ['un tableau de 20 000 colonnes (chaque cellule relisait toute la ligne)', `${'|a'.repeat(20_000)}|\n${'|-'.repeat(20_000)}|\n${'|b'.repeat(20_000)}|`],
    ['un tableau de 100 colonnes suivi de 190 000 rangées vides (chacune était remplie de 100 cellules : 19 millions de cellules)', `${'|a'.repeat(100)}|\n${'|-'.repeat(100)}|\n${'|\n'.repeat(190_000)}`],
  ];

  it.each(pathological)('lit en moins d’une seconde %s', (_name, input) => {
    const started = performance.now();

    expect(() => parseMarkdown(input)).not.toThrow();

    expect(performance.now() - started).toBeLessThan(1000);
  });

  it('rend le texte tel quel quand les marques ne trouvent rien à ouvrir ni à fermer : le même résultat qu’un lecteur qui prend son temps', () => {
    const closers = 'a* '.repeat(30_000);
    const links = '[](a ('.repeat(10_000);

    expect(parseInline(closers)).toEqual([text(closers)]);
    expect(parseInline(links)).toEqual([text(links)]);
  });
});
