import { render, screen, within } from '@testing-library/react';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { Markdown } from './Markdown';

const view = (source: string) => {
  const { container } = render(<Markdown source={source} />);
  return container;
};

describe('Markdown : la mise en forme', () => {
  it('ne dessine rien d’un texte vide', () => {
    expect(view('').innerHTML).toBe('');
    expect(view('  \n ').innerHTML).toBe('');
  });

  it('dessine paragraphes, gras, italique, barré et code en ligne avec les éléments qui leur correspondent', () => {
    const root = view('Un **gras**, un *italique*, du ~~barré~~ et du `code`.\n\nSecond paragraphe.');

    expect(root.querySelectorAll('p')).toHaveLength(2);
    expect(root.querySelector('strong')?.textContent).toBe('gras');
    expect(root.querySelector('em')?.textContent).toBe('italique');
    expect(root.querySelector('del')?.textContent).toBe('barré');
    expect(root.querySelector('code')?.textContent).toBe('code');
  });

  it('garde les retours à la ligne d’un paragraphe', () => {
    const root = view('ligne un\nligne deux');

    expect(root.querySelectorAll('p br')).toHaveLength(1);
    expect(root.querySelector('p')?.textContent).toBe('ligne unligne deux');
  });

  it('place les titres sous celui du panneau : « # » est un titre de niveau 4, jamais un niveau 1 ou 2', () => {
    const root = view('# Un\n## Deux\n### Trois\n#### Quatre\n###### Six');

    expect([...root.querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.tagName)).toEqual(['H4', 'H5', 'H6', 'H6', 'H6']);
  });

  it('ne saute jamais un niveau de titre, quels que soient les dièses que l’auteur a écrits (WCAG : l’ordre des titres)', () => {
    const levels = (source: string) => [...view(source).querySelectorAll('h1, h2, h3, h4, h5, h6')].map((h) => h.tagName);

    // Un texte qui commence par « ## » commence quand même au premier niveau disponible sous l'intertitre de la section.
    expect(levels('## Deux\n\ntexte')).toEqual(['H4']);
    // Un saut de « ## » à « #### » est un niveau de plus, pas deux.
    expect(levels('## Deux\n#### Quatre\n### Trois\n## Deux bis')).toEqual(['H4', 'H5', 'H5', 'H4']);
    // Un titre plus haut que le premier remonte d'un cran, jamais au-dessus du premier niveau.
    expect(levels('### Trois\n# Un\n## Deux')).toEqual(['H4', 'H4', 'H5']);
    // Au-delà de h6, il n'y a plus de niveau : le dernier se répète.
    expect(levels('# a\n## b\n### c\n#### d\n##### e\n###### f')).toEqual(['H4', 'H5', 'H6', 'H6', 'H6', 'H6']);
  });

  it('dessine les listes, avec leur premier numéro, leurs niveaux et leurs cases', () => {
    const root = view('1. a\n   - b\n   - c\n2. d\n\n5. e\n\n- [ ] à faire\n- [x] fait');

    const lists = [...root.querySelectorAll('ul, ol')];
    expect(lists.map((list) => list.tagName)).toEqual(['OL', 'UL', 'UL']);
    expect(lists[0]?.querySelectorAll(':scope > li')).toHaveLength(3);
    expect(lists[0]?.querySelector('ul')?.querySelectorAll('li')).toHaveLength(2);
    const tasks = within(lists[2] as HTMLElement).getAllByRole('listitem');
    expect(tasks[0]?.textContent).toContain('À faire');
    expect(tasks[1]?.textContent).toContain('Fait');
  });

  it('dessine un bloc de code tel quel, sans rien interpréter', () => {
    const root = view('```ts\nconst a = "<b>**x**</b>";\n```');

    const code = root.querySelector('pre code');
    expect(code?.textContent).toBe('const a = "<b>**x**</b>";');
    expect(code?.querySelector('b, strong')).toBeNull();
  });

  it('dessine un tableau avec son en-tête et l’alignement de ses colonnes', () => {
    const root = view('| Ticket | Durée |\n|:--|--:|\n| a-1 | 3 j |');

    expect([...root.querySelectorAll('th')].map((cell) => cell.textContent)).toEqual(['Ticket', 'Durée']);
    expect([...root.querySelectorAll('td')].map((cell) => cell.textContent)).toEqual(['a-1', '3 j']);
    expect((root.querySelectorAll('th')[1] as HTMLElement).className).toContain('text-right');
    expect((root.querySelectorAll('th')[0] as HTMLElement).className).toContain('text-left');
  });

  it('dessine une citation et une ligne horizontale', () => {
    const root = view('> citation\n\n---');

    expect(root.querySelector('blockquote')?.textContent).toBe('citation');
    expect(root.querySelector('hr')).toBeTruthy();
  });
});

describe('Markdown : les liens', () => {
  it('ouvre une adresse http(s) dans un nouvel onglet, sans donner la fenêtre d’origine à la page ouverte', () => {
    const root = view('[la doc](https://example.com/a?b=1) et http://example.org/x.');

    const links = [...root.querySelectorAll('a')];
    expect(links.map((a) => a.getAttribute('href'))).toEqual(['https://example.com/a?b=1', 'http://example.org/x']);
    for (const a of links) {
      expect(a.getAttribute('target')).toBe('_blank');
      expect(a.getAttribute('rel')).toBe('noopener noreferrer');
    }
  });

  it('accepte une adresse mailto:', () => {
    const root = view('[écrire](mailto:a@b.fr)');

    expect(root.querySelector('a')?.getAttribute('href')).toBe('mailto:a@b.fr');
  });

  it.each([
    ['javascript:alert(1)'],
    ['JaVaScRiPt:alert(1)'],
    [' javascript:alert(1)'],
    ['java\tscript:alert(1)'],
    ['data:text/html;base64,PHNjcmlwdD4='],
    ['vbscript:x'],
    ['file:///etc/passwd'],
    ['//example.com/x'],
    ['/p/bdesk/kanban'],
    ['docs/adr/0001.md'],
    ['#ancre'],
    [''],
  ])('ne suit pas l’adresse « %s » : le texte du lien reste, sans lien', (href) => {
    const root = view(`[le texte](<${href}>)`);

    expect(root.querySelector('a')).toBeNull();
    expect(root.textContent).toBe('le texte');
  });

  it('ne charge jamais une image : elle devient un lien vers son adresse, avec son texte alternatif', () => {
    const root = view('![le logo](https://example.com/logo.png) et ![x](javascript:alert(1))');

    expect(root.querySelector('img')).toBeNull();
    const link = root.querySelector('a');
    expect(link?.getAttribute('href')).toBe('https://example.com/logo.png');
    expect(link?.textContent).toContain('le logo');
    expect(root.textContent).toContain('x');
  });
});

describe('Markdown : jamais de HTML injecté', () => {
  const attack = [
    '<script>window.pwned = 1</script>',
    '<img src=x onerror="window.pwned = 2">',
    '<a href="javascript:window.pwned = 3" onclick="window.pwned = 4">clic</a>',
    '<iframe src="https://example.com"></iframe>',
    '<style>body { display: none }</style>',
    '<svg onload="window.pwned = 5"></svg>',
    '<details open ontoggle="window.pwned = 6">',
  ].join('\n\n');

  it('montre les balises comme du texte : aucun élément, aucun attribut d’événement ne naît du texte', () => {
    const root = view(attack);

    expect(root.querySelector('script, img, iframe, style, svg, details')).toBeNull();
    // Aucun attribut d'événement sur aucun élément (le texte « onerror=… », lui, s'affiche : c'est du texte).
    const attributes = [...root.querySelectorAll('*')].flatMap((element) => [...element.attributes].map((attribute) => attribute.name));
    expect(attributes.filter((name) => name.startsWith('on'))).toEqual([]);
    // La seule adresse écrite en clair devient un lien, sans le reste de la balise qui l'entoure.
    expect([...root.querySelectorAll('a')].map((a) => a.getAttribute('href'))).toEqual(['https://example.com']);
    expect(root.textContent).toContain('<script>window.pwned = 1</script>');
    expect(root.textContent).toContain('<img src=x onerror="window.pwned = 2">');
    expect((window as unknown as { pwned?: number }).pwned).toBeUndefined();
  });

  it('échappe aussi les balises dans le code, les titres, les tableaux et les citations', () => {
    const root = view('# <b>titre</b>\n\n> <i>citation</i>\n\n| <u>a</u> |\n|---|\n| <s>b</s> |\n\n```\n<em>code</em>\n```\n\n- <mark>item</mark>');

    expect(root.querySelector('b, i, u, s, em, mark')).toBeNull();
    for (const text of ['<b>titre</b>', '<i>citation</i>', '<u>a</u>', '<s>b</s>', '<em>code</em>', '<mark>item</mark>']) {
      expect(root.textContent).toContain(text);
    }
  });

  it('écrit les chemins à chevrons des tickets (« /p/<projet>/t/<id> ») tels quels', () => {
    const root = view('URL /p/<projet>/t/<id>, ouverte par <Entrée>.');

    expect(root.textContent).toBe('URL /p/<projet>/t/<id>, ouverte par <Entrée>.');
    expect(root.querySelector('projet, id, Entrée')).toBeNull();
  });

  it('n’emploie nulle part de quoi injecter du HTML : ni dangerouslySetInnerHTML, ni innerHTML', () => {
    for (const file of ['Markdown.tsx', 'parse.ts']) {
      const source = readFileSync(join(process.cwd(), 'src/web/markdown', file), 'utf8');
      expect(source, file).not.toMatch(/dangerouslySetInnerHTML|\.innerHTML|insertAdjacentHTML|outerHTML|document\.write/);
    }
  });
});

describe('Markdown : l’accessibilité', () => {
  it('ne laisse un tableau ou un bloc de code atteignable au clavier que lorsqu’il défile', () => {
    const root = view('```\ncourt\n```\n\n| a |\n|---|\n| 1 |');

    // jsdom ne mesure rien (largeur nulle) : rien ne défile, aucun arrêt de tabulation superflu.
    expect(root.querySelectorAll('[tabindex]')).toHaveLength(0);
  });

  it('lit une case cochée ou non, en toutes lettres, pour les lecteurs d’écran', () => {
    view('- [x] fait\n- [ ] à faire');

    expect(screen.getByText('Fait :')).toBeTruthy();
    expect(screen.getByText('À faire :')).toBeTruthy();
  });
});
