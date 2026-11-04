/**
 * Le Markdown des tickets (description, notes, commentaires…), lu en un arbre que `Markdown.tsx` dessine en éléments
 * React. Aucun HTML n'est jamais produit ni lu : une balise écrite dans un texte (`<img onerror=…>`, `<script>`, `<projet>`)
 * reste du texte, et c'est React qui l'échappe. Les adresses ne sont pas jugées ici (l'arbre garde `javascript:` tel
 * quel) : c'est l'affichage qui n'en suit aucune hors `http(s):` et `mailto:`.
 *
 * Le sous-ensemble de CommonMark et de GFM que les tickets de beads emploient : titres (ATX et soulignés), paragraphes,
 * citations, listes (imbriquées, de tâches), blocs de code (clôturés ou indentés), tableaux, lignes horizontales ; en
 * ligne, gras, italique, barré, code, liens, adresses nues, images (jamais chargées). Les retours à la ligne d'un
 * paragraphe sont gardés (comme dans un commentaire GitHub) : les notes de beads sont des journaux, une ligne par fait.
 * Ni HTML, ni définitions de liens par référence, ni notes de bas de page : ils restent du texte lisible.
 *
 * Un texte quelconque ne fait jamais échouer la lecture ni ne la fait durer : l'imbrication est plafonnée, la longueur d'un
 * texte aussi (`MAX_SOURCE_LENGTH`), et le travail d'une ligne de texte est proportionnel à sa longueur (`Work`).
 */

export type Inline =
  | { type: 'text'; value: string }
  | { type: 'code'; value: string }
  | { type: 'em' | 'strong' | 'del'; children: Inline[] }
  | { type: 'link'; href: string; title?: string; children: Inline[] }
  | { type: 'image'; src: string; alt: string }
  | { type: 'br' };

export type Align = 'left' | 'center' | 'right' | null;

export interface ListItem {
  /** Case à cocher d'une liste de tâches (`- [x]`) : cochée ou non ; nul pour un item ordinaire. */
  checked: boolean | null;
  children: Block[];
}

export type Block =
  | { type: 'heading'; depth: 1 | 2 | 3 | 4 | 5 | 6; children: Inline[] }
  | { type: 'paragraph'; children: Inline[] }
  | { type: 'code'; lang: string; value: string }
  | { type: 'quote'; children: Block[] }
  | { type: 'list'; ordered: boolean; start: number; tight: boolean; items: ListItem[] }
  | { type: 'table'; align: Align[]; head: Inline[][]; rows: Inline[][][] }
  | { type: 'rule' };

/** Au-delà, une citation ou une liste imbriquée n'est plus lue comme telle : son contenu reste du texte. */
const MAX_BLOCK_DEPTH = 16;
/** Au-delà, des emphases imbriquées ne sont plus lues : leurs marques restent du texte. */
const MAX_INLINE_DEPTH = 12;
/** Au-delà, un texte n'est pas lu comme du Markdown : il s'affiche tel quel, dans un bloc de code. Les plus longs textes réels font 6 ko. */
const MAX_SOURCE_LENGTH = 400_000;
/** Au-delà, une ligne n'est pas lue comme un tableau : chaque ligne qui la suit serait à remplir d'autant de cellules. */
const MAX_TABLE_COLUMNS = 100;
/** Un tableau s'arrête à ce nombre de cellules (l'en-tête compte) : chaque rangée est remplie jusqu'à la largeur de l'en-tête, même vide. */
const MAX_TABLE_CELLS = 20_000;
/** Parenthèses imbriquées permises dans l'adresse d'un lien : CommonMark en exige trois niveaux, cmark et markdown-it en plafonnent trente-deux. */
const MAX_LINK_PARENTHESES = 32;
/** Caractères qu'une adresse, un titre de lien ou une adresse nue peut compter ; une adresse plus longue n'est pas un lien. */
const MAX_LINK_PART = 2000;

/**
 * Le travail qu'une ligne de texte peut coûter, pour que rien ne la fasse durer : chaque recherche en arrière ou en avant
 * (un lien, une marque d'emphase, un code en ligne) se paie dessus, au caractère ou au jeton parcouru. Elle est proportionnelle
 * à la longueur du texte, avec de la marge pour un texte réel (les textes réels en usent moins d'un centième) ; une entrée
 * construite pour faire relire le même texte des milliers de fois la vide, et la lecture cesse alors d'interpréter ce qui
 * reste : ses marques restent du texte. Le temps de lecture est ainsi proportionnel à la longueur du texte, quelle que soit l'entrée.
 */
interface Work {
  left: number;
}

const WORK_PER_CHARACTER = 64;
const WORK_FLOOR = 50_000;

/* -------------------------------------------------------------------------------------------------------------------
 * En ligne
 * ---------------------------------------------------------------------------------------------------------------- */

const PUNCTUATION = /[\p{P}\p{S}]/u;
const WHITESPACE = /\s/u;
const ASCII_PUNCTUATION = /[!-/:-@[-`{-~]/;
const WORD_CHARACTER = /[\p{L}\p{N}]/u;

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
  hellip: '…',
  mdash: '—',
  ndash: '–',
  laquo: '«',
  raquo: '»',
  copy: '©',
  reg: '®',
  times: '×',
  rarr: '→',
  larr: '←',
};

const ENTITY = /^&(#[xX][0-9a-fA-F]{1,6}|#[0-9]{1,7}|[a-zA-Z][a-zA-Z0-9]{1,31});/;

/** La référence de caractère lue à `at` : son texte et sa longueur dans la source ; nulle si ce n'en est pas une. */
function entityAt(text: string, at: number): { value: string; length: number } | null {
  const match = ENTITY.exec(text.slice(at, at + 40));
  const body = match?.[1];
  if (!match || !body) return null;
  if (body.startsWith('#')) {
    const code = body[1] === 'x' || body[1] === 'X' ? parseInt(body.slice(2), 16) : parseInt(body.slice(1), 10);
    return code > 0 && code <= 0x10ffff && !(code >= 0xd800 && code <= 0xdfff) ? { value: String.fromCodePoint(code), length: match[0].length } : null;
  }
  const value = NAMED_ENTITIES[body];
  return value === undefined ? null : { value, length: match[0].length };
}

/** Les échappements (`\*`) et les références (`&amp;`) d'une adresse ou d'un titre. */
function unescape(text: string): string {
  let out = '';
  for (let i = 0; i < text.length; i++) {
    const char = text[i] as string;
    const next = text[i + 1];
    if (char === '\\' && next !== undefined && ASCII_PUNCTUATION.test(next)) {
      out += next;
      i++;
    } else if (char === '&') {
      const entity = entityAt(text, i);
      if (entity) {
        out += entity.value;
        i += entity.length - 1;
      } else out += char;
    } else out += char;
  }
  return out;
}

type Delimiter = { kind: 'delim'; char: '*' | '_' | '~'; count: number; canOpen: boolean; canClose: boolean };
type Token =
  | { kind: 'node'; node: Inline; depth: number }
  | Delimiter
  /** Un `[` ou un `![` qui attend son `]` ; actif tant qu'il peut devenir un lien (un lien n'en contient pas un autre). */
  | { kind: 'open'; image: boolean; active: boolean };

const node = (inline: Inline, depth = 0): Token => ({ kind: 'node', node: inline, depth });

/** Les jetons rendus en arbre : une marque qui n'a rien trouvé à fermer redevient le texte qu'elle était. */
function toInlines(tokens: Token[]): Inline[] {
  const out: Inline[] = [];
  const push = (inline: Inline) => {
    const last = out.at(-1);
    if (inline.type === 'text' && last?.type === 'text') last.value += inline.value;
    else out.push(inline.type === 'text' ? { ...inline } : inline);
  };
  for (const token of tokens) {
    if (token.kind === 'node') push(token.node);
    else if (token.kind === 'delim') push({ type: 'text', value: token.char.repeat(token.count) });
    else push({ type: 'text', value: token.image ? '![' : '[' });
  }
  return out;
}

/** Le texte brut d'un morceau d'arbre (l'alternative d'une image). */
export function plainText(inlines: Inline[]): string {
  return inlines
    .map((inline) => {
      switch (inline.type) {
        case 'text':
        case 'code':
          return inline.value;
        case 'br':
          return ' ';
        case 'image':
          return inline.alt;
        default:
          return plainText(inline.children);
      }
    })
    .join('');
}

/** Les marques d'emphase qui s'ouvrent et se ferment : la règle de CommonMark, plafonnée en profondeur et en travail. */
function processEmphasis(tokens: Token[], work: Work): void {
  let closer = 0;
  while (closer < tokens.length) {
    const end = tokens[closer];
    if (end?.kind !== 'delim' || !end.canClose) {
      closer++;
      continue;
    }
    let opener = closer - 1;
    for (; opener >= 0; opener--) {
      const start = tokens[opener];
      if (start?.kind !== 'delim' || start.char !== end.char || !start.canOpen) continue;
      if (end.char === '~') break;
      // « Règle des multiples de 3 » : *foo**bar* ne referme pas sur le « ** » du milieu.
      const sum = start.count + end.count;
      if ((start.canClose || end.canOpen) && sum % 3 === 0 && !(start.count % 3 === 0 && end.count % 3 === 0)) continue;
      break;
    }
    work.left -= closer - opener;
    if (work.left < 0) return;
    const start = tokens[opener];
    if (opener < 0 || start?.kind !== 'delim') {
      closer++;
      continue;
    }
    const inner = tokens.slice(opener + 1, closer);
    // Une boucle, pas `Math.max(...jetons)` : le dépliage en arguments fait dépasser la pile au-delà d'une centaine de milliers de jetons.
    let depth = 0;
    for (const token of inner) if (token.kind === 'node' && token.depth > depth) depth = token.depth;
    depth++;
    work.left -= inner.length + (tokens.length - opener) / 8;
    if (depth > MAX_INLINE_DEPTH) {
      closer++;
      continue;
    }
    const used = end.char === '~' ? 2 : start.count >= 2 && end.count >= 2 ? 2 : 1;
    const type = end.char === '~' ? 'del' : used === 2 ? 'strong' : 'em';
    start.count -= used;
    end.count -= used;
    tokens.splice(opener + 1, closer - opener - 1, node({ type, children: toInlines(inner) }, depth));
    closer = opener + 2;
    if (start.count === 0) {
      tokens.splice(opener, 1);
      closer--;
    }
    if (end.count === 0) tokens.splice(closer, 1);
  }
}

/**
 * `(adresse "titre")` après un crochet fermant : l'adresse, le titre et l'endroit où le lien se termine ; nul si ce n'est pas
 * un lien. L'adresse, le titre et les blancs entre eux ont chacun une longueur plafonnée (`MAX_LINK_PART`), et les parenthèses
 * de l'adresse une profondeur (`MAX_LINK_PARENTHESES`) : un `](` n'a jamais à relire la suite du texte jusqu'à sa fin. Ce qui est
 * parcouru se paie sur `work`.
 */
function linkTail(text: string, start: number, work: Work): { href: string; title?: string; end: number } | null {
  if (work.left <= 0) return null;
  let i = start;
  let reached = start;
  const done = <T>(result: T): T => {
    work.left -= Math.max(i, reached) - start + 1;
    return result;
  };
  const skipSpace = () => {
    const limit = Math.min(text.length, i + MAX_LINK_PART);
    while (i < limit && /[ \t\n]/.test(text[i] as string)) i++;
  };
  skipSpace();
  let href: string;
  if (text[i] === '<') {
    const limit = Math.min(text.length, i + MAX_LINK_PART);
    let close = i + 1;
    while (close < limit && text[close] !== '>' && text[close] !== '\n' && text[close] !== '<') close++;
    reached = close;
    if (close >= limit || text[close] !== '>') return done(null);
    href = text.slice(i + 1, close);
    i = close + 1;
  } else {
    const begin = i;
    let depth = 0;
    while (i < text.length && i - begin < MAX_LINK_PART) {
      const char = text[i] as string;
      if (char === '\\' && ASCII_PUNCTUATION.test(text[i + 1] ?? '')) {
        i += 2;
        continue;
      }
      if (/\s/.test(char) || char.charCodeAt(0) < 32) break;
      if (char === '(') {
        if (++depth > MAX_LINK_PARENTHESES) return done(null);
      } else if (char === ')') {
        if (depth === 0) break;
        depth--;
      }
      i++;
    }
    if (depth !== 0 || i - begin >= MAX_LINK_PART) return done(null);
    href = text.slice(begin, i);
  }
  skipSpace();
  let title: string | undefined;
  const quote = text[i];
  if (quote === '"' || quote === "'" || quote === '(') {
    const closing = quote === '(' ? ')' : quote;
    const limit = Math.min(text.length, i + MAX_LINK_PART);
    let j = i + 1;
    while (j < limit && text[j] !== closing) j += text[j] === '\\' ? 2 : 1;
    reached = j;
    if (j >= limit) return done(null);
    title = unescape(text.slice(i + 1, j));
    i = j + 1;
    skipSpace();
  }
  if (text[i] !== ')') return done(null);
  return done(title === undefined ? { href: unescape(href), end: i + 1 } : { href: unescape(href), title, end: i + 1 });
}

/** Une marque `*`, `_` ou `~~` peut-elle ouvrir ou fermer une emphase, selon ce qui l'entoure (règles de CommonMark). */
function flanking(char: string, before: string, after: string): { canOpen: boolean; canClose: boolean } {
  const spaceBefore = WHITESPACE.test(before);
  const spaceAfter = WHITESPACE.test(after);
  const punctuationBefore = PUNCTUATION.test(before);
  const punctuationAfter = PUNCTUATION.test(after);
  const left = !spaceAfter && (!punctuationAfter || spaceBefore || punctuationBefore);
  const right = !spaceBefore && (!punctuationBefore || spaceAfter || punctuationAfter);
  if (char === '_') return { canOpen: left && (!right || punctuationBefore), canClose: right && (!left || punctuationAfter) };
  return { canOpen: left, canClose: right };
}

/** Une adresse nue (`https://…`) lue à `at` : sans la ponctuation et les parenthèses de fermeture qui ne lui appartiennent pas. */
function bareUrlAt(text: string, at: number): string | null {
  const match = /^https?:\/\/[^\s<>"`]+/i.exec(text.slice(at, at + 2000));
  if (!match) return null;
  // Les comptes se tiennent à jour quand on retire un caractère : les refaire à chacun coûte la longueur de l'adresse au carré.
  const count = (char: string) => match[0].split(char).length - 1;
  let parentheses = count(')') - count('(');
  let brackets = count(']') - count('[');
  let end = match[0].length;
  while (end > 0) {
    const last = match[0][end - 1] as string;
    if (/[?!.,:;*_~'"’”]/.test(last)) end--;
    else if (last === ')' && parentheses > 0) {
      parentheses--;
      end--;
    } else if (last === ']' && brackets > 0) {
      brackets--;
      end--;
    } else break;
  }
  const url = match[0].slice(0, end);
  return /^https?:\/\/[^\s/?#]+/i.test(url) && url.length > url.indexOf('//') + 2 ? url : null;
}

/** Le texte sans les espaces et tabulations de fin (pas par une expression régulière : `/[ \t]+$/` relit une longue suite d'espaces au carré). */
function trimEnd(text: string): string {
  let end = text.length;
  while (end > 0 && (text[end - 1] === ' ' || text[end - 1] === '\t')) end--;
  return end === text.length ? text : text.slice(0, end);
}

export function parseInline(text: string): Inline[] {
  const work: Work = { left: WORK_PER_CHARACTER * text.length + WORK_FLOOR };
  const tokens: Token[] = [];
  /** Positions dans `tokens` des `[` et `![` qui attendent leur `]`. */
  const brackets: number[] = [];
  let buffer = '';
  const flush = () => {
    if (buffer) tokens.push(node({ type: 'text', value: buffer }));
    buffer = '';
  };
  let i = 0;
  while (i < text.length) {
    const char = text[i] as string;

    if (char === '\\') {
      const next = text[i + 1];
      if (next === '\n') {
        flush();
        tokens.push(node({ type: 'br' }));
        i += 2;
        while (text[i] === ' ' || text[i] === '\t') i++;
      } else if (next !== undefined && ASCII_PUNCTUATION.test(next)) {
        buffer += next;
        i += 2;
      } else {
        buffer += char;
        i++;
      }
    } else if (char === '\n') {
      buffer = trimEnd(buffer);
      flush();
      tokens.push(node({ type: 'br' }));
      i++;
      while (text[i] === ' ' || text[i] === '\t') i++;
    } else if (char === '`') {
      let run = 1;
      while (text[i + run] === '`') run++;
      let close = -1;
      const from = i + run;
      let j = from;
      // Une suite d'accents graves sans pareille relit tout le texte qui la suit : ce qui est parcouru se paie sur `work`.
      while (j < text.length && j - from <= work.left) {
        if (text[j] !== '`') {
          j++;
          continue;
        }
        let length = 1;
        while (text[j + length] === '`') length++;
        if (length === run) {
          close = j;
          break;
        }
        j += length;
      }
      work.left -= j - from;
      if (close < 0) {
        buffer += '`'.repeat(run);
        i += run;
      } else {
        flush();
        let value = text.slice(i + run, close).replace(/\n/g, ' ');
        if (value.startsWith(' ') && value.endsWith(' ') && value.trim() !== '') value = value.slice(1, -1);
        tokens.push(node({ type: 'code', value }));
        i = close + run;
      }
    } else if (char === '<') {
      const auto = /^<((?:https?:\/\/|mailto:)[^\s<>]*)>/i.exec(text.slice(i, i + 2000));
      if (auto?.[1]) {
        flush();
        tokens.push(node({ type: 'link', href: auto[1], children: [{ type: 'text', value: auto[1] }] }));
        i += auto[0].length;
      } else {
        buffer += char;
        i++;
      }
    } else if (char === '!' && text[i + 1] === '[') {
      flush();
      brackets.push(tokens.length);
      tokens.push({ kind: 'open', image: true, active: true });
      i += 2;
    } else if (char === '[') {
      flush();
      brackets.push(tokens.length);
      tokens.push({ kind: 'open', image: false, active: true });
      i++;
    } else if (char === ']') {
      flush();
      const at = brackets.pop();
      const open = at === undefined ? undefined : tokens[at];
      const tail = open?.kind === 'open' && open.active && text[i + 1] === '(' ? linkTail(text, i + 2, work) : null;
      if (at === undefined || open?.kind !== 'open' || !tail) {
        buffer += ']';
        i++;
      } else {
        const inner = tokens.splice(at + 1);
        tokens.pop(); // le crochet ouvrant
        processEmphasis(inner, work);
        const children = toInlines(inner);
        if (open.image) tokens.push(node({ type: 'image', src: tail.href, alt: plainText(children) }));
        else {
          tokens.push(node(tail.title === undefined ? { type: 'link', href: tail.href, children } : { type: 'link', href: tail.href, title: tail.title, children }));
          // Un lien n'en contient pas un autre : les crochets qui l'entourent ne peuvent plus en devenir un.
          for (const pending of brackets) {
            const earlier = tokens[pending];
            if (earlier?.kind === 'open' && !earlier.image) earlier.active = false;
          }
        }
        i = tail.end;
      }
    } else if (char === '*' || char === '_' || char === '~') {
      let run = 1;
      while (text[i + run] === char) run++;
      if (char === '~' && run !== 2) {
        buffer += char.repeat(run);
        i += run;
      } else {
        flush();
        tokens.push({ kind: 'delim', char, count: run, ...flanking(char, text[i - 1] ?? ' ', text[i + run] ?? ' ') });
        i += run;
      }
    } else if (char === '&') {
      const entity = entityAt(text, i);
      buffer += entity ? entity.value : char;
      i += entity ? entity.length : 1;
    } else if (char === 'h' && (text[i - 1] === undefined || !WORD_CHARACTER.test(text[i - 1] as string)) && brackets.length === 0) {
      const url = bareUrlAt(text, i);
      if (url) {
        flush();
        tokens.push(node({ type: 'link', href: url, children: [{ type: 'text', value: url }] }));
        i += url.length;
      } else {
        buffer += char;
        i++;
      }
    } else {
      buffer += char;
      i++;
    }
  }
  flush();
  processEmphasis(tokens, work);
  return toInlines(tokens);
}

/* -------------------------------------------------------------------------------------------------------------------
 * Blocs
 * ---------------------------------------------------------------------------------------------------------------- */

const ATX_HEADING = /^ {0,3}(#{1,6})(?:[ \t]+(.*?))?(?:[ \t]+#+)?[ \t]*$/;
const THEMATIC_BREAK = /^ {0,3}([-*_])(?:[ \t]*\1){2,}[ \t]*$/;
const FENCE = /^( {0,3})(`{3,}|~{3,})[ \t]*(.*)$/;
const QUOTE = /^ {0,3}>/;
const SETEXT_UNDERLINE = /^ {0,3}(=+|-+)[ \t]*$/;
const TABLE_DELIMITER = /^ {0,3}\|?[ \t]*:?-+:?[ \t]*(?:\|[ \t]*:?-+:?[ \t]*)*\|?[ \t]*$/;

const isBlank = (line: string): boolean => line.trim() === '';
const leading = (line: string): number => /^ */.exec(line)?.[0].length ?? 0;

function expandTabs(line: string): string {
  if (!line.includes('\t')) return line;
  let out = '';
  for (const char of line) out += char === '\t' ? ' '.repeat(4 - (out.length % 4)) : char;
  return out;
}

interface Marker {
  indent: number;
  ordered: boolean;
  number: number;
  delimiter: string;
  /** Colonne où commence le contenu de l'item : ce qui est plus indenté lui appartient. */
  contentOffset: number;
  /** Rien après la puce. */
  empty: boolean;
}

function listMarker(line: string): Marker | null {
  const match = /^( {0,3})(?:([-*+])|(\d{1,9})([.)]))( +|$)/.exec(line);
  if (!match) return null;
  const indent = (match[1] as string).length;
  const width = match[2] ? 1 : (match[3] as string).length + 1;
  const spaces = (match[5] as string).length;
  const empty = line.slice(match[0].length).trim() === '';
  // Cinq espaces ou plus après la puce : le contenu est un bloc de code indenté, la puce n'en prend qu'une.
  const gap = empty || spaces > 4 ? 1 : spaces;
  return {
    indent,
    ordered: !match[2],
    number: match[3] ? parseInt(match[3], 10) : 1,
    delimiter: match[2] ?? (match[4] as string),
    contentOffset: indent + width + gap,
    empty,
  };
}

function splitRow(line: string): string[] {
  let row = line.trim();
  if (row.startsWith('|')) row = row.slice(1);
  if (row.endsWith('|') && !row.endsWith('\\|')) row = row.slice(0, -1);
  const cells: string[] = [];
  let cell = '';
  for (let i = 0; i < row.length; i++) {
    const char = row[i] as string;
    if (char === '\\' && row[i + 1] === '|') {
      cell += '|';
      i++;
    } else if (char === '|') {
      cells.push(cell.trim());
      cell = '';
    } else cell += char;
  }
  cells.push(cell.trim());
  return cells;
}

/** Un tableau commence à `at` : une ligne d'en-tête, puis une ligne de séparation de même largeur, avec des barres. */
function isTableStart(lines: string[], at: number): boolean {
  const header = lines[at];
  const delimiter = lines[at + 1];
  if (header === undefined || delimiter === undefined || !delimiter.includes('|') || !TABLE_DELIMITER.test(delimiter)) return false;
  const columns = splitRow(header).length;
  return columns <= MAX_TABLE_COLUMNS && columns === splitRow(delimiter).length;
}

const openFence = (line: string): RegExpExecArray | null => {
  const match = FENCE.exec(line);
  // L'info d'une clôture en accents graves n'en contient pas : ```a`b n'ouvre rien.
  return match && !((match[2] as string).startsWith('`') && (match[3] as string).includes('`')) ? match : null;
};

/** Cette ligne commence-t-elle un bloc qui interrompt un paragraphe (ou une continuation paresseuse) ? */
function interrupts(lines: string[], at: number): boolean {
  const line = lines[at] as string;
  if (openFence(line) || ATX_HEADING.test(line) || THEMATIC_BREAK.test(line) || QUOTE.test(line) || isTableStart(lines, at)) return true;
  const marker = listMarker(line);
  // Une puce vide n'interrompt rien ; une liste numérotée ne le fait que si elle commence à 1.
  return marker !== null && !marker.empty && (!marker.ordered || marker.number === 1);
}

function parseBlocks(lines: string[], depth: number): Block[] {
  const blocks: Block[] = [];
  const nests = depth < MAX_BLOCK_DEPTH;
  let i = 0;
  while (i < lines.length) {
    const line = lines[i] as string;
    if (isBlank(line)) {
      i++;
      continue;
    }

    // Code indenté
    if (leading(line) >= 4) {
      const body: string[] = [];
      let j = i;
      while (j < lines.length) {
        const current = lines[j] as string;
        if (isBlank(current)) {
          let k = j;
          while (k < lines.length && isBlank(lines[k] as string)) k++;
          if (k < lines.length && leading(lines[k] as string) >= 4) {
            for (let blank = j; blank < k; blank++) body.push('');
            j = k;
            continue;
          }
          break;
        }
        if (leading(current) < 4) break;
        body.push(current.slice(4));
        j++;
      }
      blocks.push({ type: 'code', lang: '', value: body.join('\n') });
      i = j;
      continue;
    }

    // Code clôturé
    const fence = openFence(line);
    if (fence) {
      const [, spaces, marks, info] = fence as unknown as [string, string, string, string];
      const close = new RegExp(`^ {0,3}${marks.startsWith('`') ? '`' : '~'}{${marks.length},}[ \\t]*$`);
      const body: string[] = [];
      let j = i + 1;
      while (j < lines.length && !close.test(lines[j] as string)) {
        const current = lines[j] as string;
        body.push(current.slice(Math.min(spaces.length, leading(current))));
        j++;
      }
      blocks.push({ type: 'code', lang: info.trim().split(/\s+/)[0] ?? '', value: body.join('\n') });
      i = j < lines.length ? j + 1 : j;
      continue;
    }

    const heading = ATX_HEADING.exec(line);
    if (heading) {
      blocks.push({ type: 'heading', depth: (heading[1] as string).length as 1 | 2 | 3 | 4 | 5 | 6, children: parseInline(heading[2] ?? '') });
      i++;
      continue;
    }

    if (THEMATIC_BREAK.test(line)) {
      blocks.push({ type: 'rule' });
      i++;
      continue;
    }

    if (nests && QUOTE.test(line)) {
      const inner: string[] = [];
      let j = i;
      while (j < lines.length) {
        const current = lines[j] as string;
        if (QUOTE.test(current)) {
          inner.push(current.replace(/^ {0,3}> ?/, ''));
          j++;
        } else if (!isBlank(current) && inner.length > 0 && !isBlank(inner.at(-1) as string) && !interrupts(lines, j)) {
          inner.push(current); // continuation paresseuse
          j++;
        } else break;
      }
      blocks.push({ type: 'quote', children: parseBlocks(inner, depth + 1) });
      i = j;
      continue;
    }

    if (nests && listMarker(line)) {
      const { block, end } = parseList(lines, i, depth);
      blocks.push(block);
      i = end;
      continue;
    }

    if (isTableStart(lines, i)) {
      const align = splitRow(lines[i + 1] as string).map((cell): Align => {
        const left = cell.startsWith(':');
        const right = cell.endsWith(':');
        return left && right ? 'center' : right ? 'right' : left ? 'left' : null;
      });
      const width = align.length;
      const row = (source: string) => {
        const cells = splitRow(source);
        return Array.from({ length: width }, (_, column) => parseInline(cells[column] ?? ''));
      };
      const head = row(lines[i] as string);
      const rows: Inline[][][] = [];
      const maxRows = Math.max(0, Math.floor(MAX_TABLE_CELLS / width) - 1);
      let j = i + 2;
      while (j < lines.length && rows.length < maxRows && !isBlank(lines[j] as string) && (lines[j] as string).includes('|') && !interrupts(lines, j)) {
        rows.push(row(lines[j] as string));
        j++;
      }
      blocks.push({ type: 'table', align, head, rows });
      i = j;
      continue;
    }

    // Paragraphe, ou titre souligné
    let j = i + 1;
    let setext: 1 | 2 | null = null;
    while (j < lines.length) {
      const current = lines[j] as string;
      if (isBlank(current)) break;
      const underline = SETEXT_UNDERLINE.exec(current);
      if (underline) {
        setext = (underline[1] as string).startsWith('=') ? 1 : 2;
        break;
      }
      if (interrupts(lines, j)) break;
      j++;
    }
    const content = lines
      .slice(i, j)
      .map((current) => current.trim())
      .join('\n');
    blocks.push(setext ? { type: 'heading', depth: setext, children: parseInline(content) } : { type: 'paragraph', children: parseInline(content) });
    i = setext ? j + 1 : j;
  }
  return blocks;
}

function parseList(lines: string[], start: number, depth: number): { block: Block; end: number } {
  const first = listMarker(lines[start] as string) as Marker;
  const items: ListItem[] = [];
  let loose = false;
  let i = start;

  while (i < lines.length) {
    const marker = listMarker(lines[i] as string);
    if (!marker || marker.ordered !== first.ordered || (marker.ordered && marker.delimiter !== first.delimiter)) break;

    const content: string[] = [marker.empty ? '' : (lines[i] as string).slice(marker.contentOffset)];
    let j = i + 1;
    while (j < lines.length) {
      const current = lines[j] as string;
      if (isBlank(current)) {
        // Une ligne vide ne ferme pas l'item si ce qui la suit lui appartient (assez indenté).
        let k = j;
        while (k < lines.length && isBlank(lines[k] as string)) k++;
        if (k < lines.length && leading(lines[k] as string) >= marker.contentOffset) {
          for (let blank = j; blank < k; blank++) content.push('');
          j = k;
          continue;
        }
        break;
      }
      if (leading(current) >= marker.contentOffset) {
        content.push(current.slice(marker.contentOffset));
        j++;
        continue;
      }
      const sibling = listMarker(current);
      // Une liste d'un autre genre, plus indentée que la puce de l'item : l'auteur l'imbrique (« 1. a » puis « - b » sur deux espaces).
      if (sibling && sibling.indent > marker.indent && sibling.ordered !== marker.ordered) {
        content.push(current.slice(sibling.indent));
        j++;
        continue;
      }
      if (sibling || interrupts(lines, j)) break;
      if (!isBlank(lines[j - 1] as string)) {
        content.push(current.trim()); // continuation paresseuse
        j++;
        continue;
      }
      break;
    }

    let checked: boolean | null = null;
    const task = /^\[([ xX])\][ \t]+/.exec(content[0] as string);
    if (task) {
      checked = task[1] !== ' ';
      content[0] = (content[0] as string).slice(task[0].length);
    }
    const children = parseBlocks(content, depth + 1);
    // Une ligne vide entre deux blocs de l'item rend la liste lâche, comme entre deux items.
    if (children.length > 1 && content.some(isBlank)) loose = true;
    items.push({ checked, children });

    let next = j;
    while (next < lines.length && isBlank(lines[next] as string)) next++;
    const following = next < lines.length ? listMarker(lines[next] as string) : null;
    if (following && following.ordered === first.ordered && following.indent < marker.contentOffset) {
      if (next > j) loose = true;
      i = next;
    } else {
      i = j;
      break;
    }
  }

  return { block: { type: 'list', ordered: first.ordered, start: first.number, tight: !loose, items }, end: i };
}

/** Lit un texte Markdown. Ne lève jamais d'erreur. Au-delà de `MAX_SOURCE_LENGTH`, le texte n'est pas lu : il reste tel quel, dans un bloc de code. */
export function parseMarkdown(source: string): Block[] {
  if (source.length > MAX_SOURCE_LENGTH) return [{ type: 'code', lang: '', value: source }];
  return parseBlocks(source.replace(/\r\n?/g, '\n').split('\n').map(expandTabs), 0);
}
