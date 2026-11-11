/**
 * Une liste fermée pour `CREATE TABLE` (bdesk-38k.74, relecture finale round 3, B-FI). `show create table <nom> [as of <réf>]` et `dolt_schema_diff(...).to_create_statement`
 * rendent le texte que Dolt ferait exécuter à la lecture s'il contient une colonne générée ou un **index fonctionnel** (`create index … on t ((expr))`, MySQL 8 : une colonne
 * générée virtuelle *cachée*, qu'`information_schema.columns` et `show full columns` ne listent pas, et que Dolt évalue à chaque lecture de la table, `as of 'HEAD'` et
 * `dolt_history_*` compris). Un index fonctionnel hostile (`load_file(…)`, `sleep(…)`) traverse donc les deux assertions existantes sans être vu (bdesk-38k.74, round 3).
 *
 * Plutôt que de chercher ce qui est dangereux dans ce texte (une liste noire, qu'une forme non prévue contourne), cette liste reconnaît ce qui est **admis** : des colonnes
 * ordinaires (un type, des valeurs par défaut littérales), des clés et index ordinaires (des noms de colonnes, une longueur), des clés étrangères, les options de la table, une
 * contrainte `check` d'une grammaire fermée (`checkExpr` : comparaisons, `is [not] null`, `not`, `and`/`or`, `+`/`-`, parenthèses, noms de colonnes et nombres, jamais un appel de
 * fonction) et, entre parenthèses, un défaut littéral, `(json_object())` ou `(uuid())` exactement (`ZERO_ARGUMENT_DEFAULTS`) — ce que bd pose réellement (voir plus bas). Tout le reste — `GENERATED`, un index fonctionnel, un défaut ou une clé avec une autre expression entre parenthèses, une contrainte `check` d'une autre forme, une fonction
 * appelée dans une valeur par défaut — est refusé. Ce n'est pas une suite de motifs cherchés dans le texte : un petit analyseur lexical puis syntaxique, sur une grammaire explicite.
 *
 * **Mesuré sur les CREATE TABLE réels de bd** (cinq copies de Projets réels, identiques entre elles : `issues`, `dependencies`, `labels`, `comments`, `config`) : aucune colonne
 * générée, aucun index fonctionnel (bd n'en pose jamais) ; en revanche, bd pose quatre clés étrangères (`CONSTRAINT … FOREIGN KEY … REFERENCES `issues` (`id`) ON DELETE CASCADE
 * ON UPDATE CASCADE` : deux sur `dependencies`, une sur `labels`, une sur `comments`), une seule contrainte `check` (`ck_dep_one_target` sur `dependencies`, une somme de trois
 * `NOT(… IS NULL)` comparée à 1 — la table n'admet qu'une seule cible), et un défaut entre parenthèses, `` `metadata` json DEFAULT (json_object()) `` (dans `issues` et dans
 * `dependencies`). À l'ancre d'une époque (le dernier commit d'avant la migration 0041 de bd, que l'historique relit), le schéma d'avant : trois copies sur cinq, `comments.id`
 * `DEFAULT (uuid())`, des dates `DEFAULT 'CURRENT_TIMESTAMP'` (une chaîne), des clés étrangères sans `ON UPDATE`. Refuser `check`, les clés étrangères ou les défauts entre parenthèses en
 * bloc aurait refusé tous les Projets bd à jour. Le défaut littéral entre parenthèses
 * (`` `type` varchar(32) DEFAULT ('blocks') ``) n'est pas dans les copies réelles : Dolt l'écrit ainsi après certains `alter table` (mesuré sur une base d'essai) ; il est admis parce
 * qu'il ne porte aucune expression, une valeur seulement.
 */

/**
 * Un jeton du texte d'un `CREATE TABLE` (ou `CREATE VIEW`, refusé dès le premier mot). `quoted` (entre apostrophes inversées) et `word` (un mot nu) sont deux jetons
 * distincts : Dolt n'écrit un nom de colonne, de clé ou de table qu'entre apostrophes inversées, jamais un mot-clé ou un type ainsi (`` `a` `` est une colonne, `varchar`
 * un type) ; les confondre laisserait un mot nu passer pour un nom, ou l'inverse.
 */
type Token =
  | { kind: 'quoted'; value: string }
  | { kind: 'word'; value: string }
  | { kind: 'string'; value: string }
  | { kind: 'number'; value: string }
  | { kind: 'punct'; value: string }
  | { kind: 'eof' };

const PUNCTUATION = ['<>', '<=', '>=', '!=', '(', ')', ',', '=', '.', '<', '>', '+', '-', ';'];

/**
 * Découpe `text` en jetons : un identifiant entre apostrophes inversées (`` ` ``, avec `` `` `` pour une apostrophe inversée littérale) ou un mot nu (lettres, chiffres,
 * `_`, `$`) ; une chaîne entre apostrophes simples (`''` pour une apostrophe littérale, aucun autre échappement — c'est ce que Dolt écrit : mesuré) ; un nombre (chiffres,
 * point décimal, signe `-` devant) ; une ponctuation de `PUNCTUATION` ; les espaces et retours à la ligne sont ignorés. Un caractère qu'aucune de ces règles ne reconnaît
 * fait échouer le découpage : le texte n'est alors pas admis (voir `createTableProblems`), sans qu'on ait besoin de dire pourquoi plus précisément.
 */
function tokenize(text: string): Token[] | undefined {
  const tokens: Token[] = [];
  let i = 0;
  const n = text.length;
  while (i < n) {
    const c = text[i];
    if (c === undefined) break;
    if (/\s/.test(c)) {
      i++;
      continue;
    }
    if (c === '`') {
      let value = '';
      i++;
      for (;;) {
        if (i >= n) return undefined;
        if (text[i] === '`') {
          if (text[i + 1] === '`') {
            value += '`';
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i];
        i++;
      }
      tokens.push({ kind: 'quoted', value });
      continue;
    }
    if (c === "'") {
      let value = '';
      i++;
      for (;;) {
        if (i >= n) return undefined;
        if (text[i] === "'") {
          if (text[i + 1] === "'") {
            value += "'";
            i += 2;
            continue;
          }
          i++;
          break;
        }
        value += text[i];
        i++;
      }
      tokens.push({ kind: 'string', value });
      continue;
    }
    if (/[A-Za-z_$]/.test(c)) {
      let value = c;
      i++;
      while (i < n && /[A-Za-z0-9_$]/.test(text[i] ?? '')) {
        value += text[i];
        i++;
      }
      tokens.push({ kind: 'word', value });
      continue;
    }
    if (/[0-9]/.test(c) || (c === '-' && /[0-9]/.test(text[i + 1] ?? ''))) {
      let value = c;
      i++;
      while (i < n && /[0-9.]/.test(text[i] ?? '')) {
        value += text[i];
        i++;
      }
      tokens.push({ kind: 'number', value });
      continue;
    }
    const two = text.slice(i, i + 2);
    if (PUNCTUATION.includes(two)) {
      tokens.push({ kind: 'punct', value: two });
      i += 2;
      continue;
    }
    if (PUNCTUATION.includes(c)) {
      tokens.push({ kind: 'punct', value: c });
      i++;
      continue;
    }
    return undefined; // un caractère que la grammaire ne reconnaît pas : le texte entier n'est pas admis
  }
  tokens.push({ kind: 'eof' });
  return tokens;
}

/** Un curseur sur les jetons, avec de quoi dire où l'analyse a échoué sans citer le contenu (bdesk-38k.74 : le refus ne doit rien reprendre de la base). */
class Cursor {
  private i = 0;
  /** Le nombre de niveaux d'imbrication ouverts dans l'expression d'un `check` (parenthèses et `not` confondus) : voir `MAX_CHECK_DEPTH`. */
  depth = 0;
  constructor(private readonly tokens: readonly Token[]) {}
  peek(): Token {
    return this.tokens[this.i] ?? { kind: 'eof' };
  }
  next(): Token {
    const t = this.peek();
    if (t.kind !== 'eof') this.i++;
    return t;
  }
  /** Un mot nu (jamais entre apostrophes inversées), comparé sans tenir compte de la casse : les mots-clés de la grammaire (`NOT`, `DEFAULT`, `KEY`…) et les noms de type. */
  keyword(word: string): boolean {
    const t = this.peek();
    if (t.kind === 'word' && t.value.toUpperCase() === word) {
      this.i++;
      return true;
    }
    return false;
  }
  /** Plusieurs mots nus de suite (`SET NULL`), tous ou aucun : un échec ne laisse jamais le curseur à moitié avancé. */
  keywords(...words: string[]): boolean {
    const start = this.i;
    for (const word of words) {
      if (!this.keyword(word)) {
        this.i = start;
        return false;
      }
    }
    return true;
  }
  /** Le mot nu lui-même (un nom de type : `varchar`, `int`, `json`…), quel qu'il soit : seul `columnDef` l'appelle, juste après le nom de la colonne. */
  word(): string | undefined {
    const t = this.peek();
    if (t.kind !== 'word') return undefined;
    this.i++;
    return t.value;
  }
  punct(value: string): boolean {
    const t = this.peek();
    if (t.kind === 'punct' && t.value === value) {
      this.i++;
      return true;
    }
    return false;
  }
  atEof(): boolean {
    return this.peek().kind === 'eof';
  }
}

/** Les actions admises d'une clé étrangère (`ON DELETE`/`ON UPDATE`) : un ensemble fermé de mots-clés, jamais une expression. */
const FOREIGN_KEY_ACTIONS = ['CASCADE', 'RESTRICT', 'SET NULL', 'NO ACTION', 'SET DEFAULT'];

/** `backtickIdent` : un identifiant entre apostrophes inversées (nom de colonne, de clé, de contrainte, de table référencée…). Jamais un mot nu : la grammaire ne lit aucun mot comme un nom. */
function backtickIdent(c: Cursor): string | undefined {
  const t = c.peek();
  if (t.kind !== 'quoted') return undefined;
  c.next();
  return t.value;
}

/** Un nombre, positif ou négatif (la longueur d'un type ou d'une clé, une valeur comparée dans `check`). */
function number(c: Cursor): boolean {
  const t = c.peek();
  if (t.kind !== 'number') return false;
  c.next();
  return true;
}

/** `type(n)` ou `type(n,m)` (facultatif : `bigint unsigned` n'en a pas), puis `unsigned`/`zerofill`, chacun facultatif : jamais une expression, seulement des nombres et ces deux mots. */
function typeArgs(c: Cursor): boolean {
  if (c.punct('(')) {
    if (!number(c)) return false;
    if (c.punct(',') && !number(c)) return false;
    if (!c.punct(')')) return false;
  }
  c.keyword('UNSIGNED');
  c.keyword('ZEROFILL');
  return true;
}

/**
 * Les appels, sans aucun argument, que bd pose entre parenthèses comme valeur par défaut — la liste fermée, mesurée sur des bases bd réelles : `(json_object())` (`metadata`, dans
 * `issues` et `dependencies`, schéma courant) et `(uuid())` (`comments.id`, schéma d'avant la migration 0041 : relevé à l'ancre d'une époque de trois copies de Projets réels). Aucun
 * argument, donc rien d'attaquant-contrôlé ; ni l'un ni l'autre ne lit un fichier ni ne dort. Toute autre fonction, avec ou sans argument, est refusée.
 */
const ZERO_ARGUMENT_DEFAULTS = ['JSON_OBJECT', 'UUID'];

/**
 * Une valeur par défaut : une chaîne (Dolt écrit même un nombre entre apostrophes : mesuré), `NULL`, `CURRENT_TIMESTAMP` (avec une précision optionnelle), une chaîne ou un nombre
 * entre parenthèses (mesuré : Dolt range ainsi un défaut littéral ordinaire après certains `alter table`, `` `type` varchar(32) DEFAULT ('blocks') `` — rien d'autre qu'une valeur
 * littérale n'y entre, jamais un appel), ou un des appels de `ZERO_ARGUMENT_DEFAULTS` entre parenthèses, sans argument. Toute autre forme entre parenthèses (`default (sleep(1))`,
 * `default (load_file(…))`, `default (1+1)`, `default (json_object('a'))`…) est refusée : seules ces formes exactes sont admises. Chaque branche rend son verdict sans repli sur
 * une autre : un mot reconnu à moitié ne laisse jamais le curseur avancé pour une alternative qui lirait la suite autrement.
 */
function defaultValue(c: Cursor): boolean {
  const t = c.peek();
  if (t.kind === 'string' || t.kind === 'number') {
    c.next();
    return true;
  }
  if (c.keyword('NULL')) return true;
  if (c.keyword('CURRENT_TIMESTAMP')) {
    if (c.punct('(')) {
      if (!number(c) || !c.punct(')')) return false;
    }
    return true;
  }
  if (!c.punct('(')) return false;
  const inner = c.peek();
  if (inner.kind === 'string' || inner.kind === 'number') {
    c.next();
    return c.punct(')');
  }
  for (const call of ZERO_ARGUMENT_DEFAULTS) {
    if (c.keyword(call)) return c.punct('(') && c.punct(')') && c.punct(')');
  }
  return false;
}

/**
 * Une définition de colonne : `` `nom` type[(n[,m])] [unsigned] [zerofill] [character set x] [collate x] [not null] [default …] [on update current_timestamp[(n)]] ``.
 * `GENERATED` (une colonne générée, visible ou cachée derrière un index fonctionnel) n'est reconnu par aucune règle ici : son seul mot-clé fait échouer la colonne entière.
 */
function columnDef(c: Cursor): boolean {
  if (backtickIdent(c) === undefined) return false;
  if (c.word() === undefined) return false; // le type : un mot nu (varchar, int, json…), jamais entre apostrophes inversées
  if (!typeArgs(c)) return false;
  if (c.keyword('CHARACTER')) {
    if (!c.keyword('SET') || c.word() === undefined) return false; // le nom du jeu de caractères (ascii, utf8mb4…) : un mot nu
  }
  if (c.keyword('COLLATE') && c.word() === undefined) return false; // le nom de la collation : un mot nu
  if (c.keyword('NOT') && !c.keyword('NULL')) return false;
  if (c.keyword('DEFAULT') && !defaultValue(c)) return false;
  if (c.keyword('ON')) {
    if (!c.keyword('UPDATE') || !c.keyword('CURRENT_TIMESTAMP')) return false;
    if (c.punct('(') && (!number(c) || !c.punct(')'))) return false;
  }
  return true;
}

/** `` `col`[(n)] ``, une seule fois ou en liste : un index fonctionnel (`((expr))`) n'a pas de `` ` `` ici, et échoue à cette règle (voir `keyPartList`). */
function keyPart(c: Cursor): boolean {
  if (backtickIdent(c) === undefined) return false;
  if (c.punct('(')) {
    if (!number(c) || !c.punct(')')) return false;
  }
  return true;
}

function keyPartList(c: Cursor): boolean {
  if (!c.punct('(')) return false;
  if (!keyPart(c)) return false;
  while (c.punct(',')) if (!keyPart(c)) return false;
  return c.punct(')');
}

/** `primary key (…)`, `unique [key] [` `nom` `] (…)`, ou `key `nom` (…)` : des clés et index ordinaires, jamais une expression entre parenthèses pour un de leurs membres. */
function keyItem(c: Cursor): boolean {
  if (c.keyword('PRIMARY')) return c.keyword('KEY') && keyPartList(c);
  if (c.keyword('UNIQUE')) {
    c.keyword('KEY');
    backtickIdent(c); // le nom est facultatif pour UNIQUE
    return keyPartList(c);
  }
  if (c.keyword('KEY')) {
    if (backtickIdent(c) === undefined) return false;
    return keyPartList(c);
  }
  return false;
}

/** Les mots d'une action de clé étrangère (`CASCADE`, `SET NULL`…), lus un à un : `FOREIGN_KEY_ACTIONS` les énumère en mots. */
function foreignKeyAction(c: Cursor): boolean {
  return FOREIGN_KEY_ACTIONS.some((action) => c.keywords(...action.split(' ')));
}

/** `constraint `nom` foreign key (…) references `table` (…) [on delete …] [on update …]` : admise (mesuré dans les cinq copies réelles). */
function foreignKeyItem(c: Cursor): boolean {
  if (!c.keyword('FOREIGN') || !c.keyword('KEY') || !keyPartList(c) || !c.keyword('REFERENCES') || backtickIdent(c) === undefined || !keyPartList(c)) return false;
  for (;;) {
    if (c.keyword('ON')) {
      if ((!c.keyword('DELETE') && !c.keyword('UPDATE')) || !foreignKeyAction(c)) return false;
      continue;
    }
    return true;
  }
}

/**
 * Une expression de `check`, une grammaire fermée : des comparaisons (`=`, `<>`, `!=`, `<`, `>`, `<=`, `>=`), `is [not] null`, `not (…)`, `and`/`or`, une somme ou une
 * différence de termes (`+`/`-`), des parenthèses, un nom de colonne ou un nombre. Jamais un appel de fonction, jamais une chaîne, jamais un nom qualifié (`table.col`) :
 * une contrainte `check` ne porte que sur les colonnes de sa propre table, par un nom nu. C'est la forme exacte que bd pose (`ck_dep_one_target`), et rien de plus large :
 * toute autre forme, même une qui semblerait anodine, est refusée plutôt que mal reconnue.
 */
function checkExpr(c: Cursor): boolean {
  return orExpr(c);
}

/**
 * L'imbrication maximale d'une expression de `check`, parenthèses et `not` confondus (bdesk-38k.74, relecture finale, round 4, m1). L'analyseur descend par récursion : Dolt accepte un `check` de
 * vingt mille `not` à la suite et l'écrit en quelque quarante mille parenthèses imbriquées, que la récursion n'aurait pas supportées (« Maximum call stack size exceeded » : le Projet était bien refusé,
 * mais par une exception de JavaScript, dont le texte n'est pas celui de la vérification). Au-delà de cette limite, l'expression n'est pas admise : le refus générique de la grammaire, comme pour toute
 * autre construction inconnue. La forme que bd pose (`ck_dep_one_target`) imbrique six niveaux ; soixante-quatre laissent de la place à des contraintes plus longues, et tiennent largement dans la pile
 * (six appels par niveau).
 */
export const MAX_CHECK_DEPTH = 64;

/** Une descente d'un niveau (une parenthèse, un `not`) : refusée, sans rien lire de plus, quand la limite est atteinte. */
function nested(c: Cursor, rule: (c: Cursor) => boolean): boolean {
  if (c.depth >= MAX_CHECK_DEPTH) return false;
  c.depth++;
  const admitted = rule(c);
  c.depth--;
  return admitted;
}
function orExpr(c: Cursor): boolean {
  if (!andExpr(c)) return false;
  while (c.keyword('OR')) if (!andExpr(c)) return false;
  return true;
}
function andExpr(c: Cursor): boolean {
  if (!notExpr(c)) return false;
  while (c.keyword('AND')) if (!notExpr(c)) return false;
  return true;
}
function notExpr(c: Cursor): boolean {
  if (c.keyword('NOT')) return nested(c, notExpr);
  return comparisonExpr(c);
}
const COMPARISON_OPS = ['=', '<>', '!=', '<', '>', '<=', '>='];
function comparisonExpr(c: Cursor): boolean {
  if (!addExpr(c)) return false;
  if (c.keyword('IS')) {
    c.keyword('NOT');
    return c.keyword('NULL');
  }
  for (const op of COMPARISON_OPS) if (c.punct(op)) return addExpr(c);
  return true;
}
function addExpr(c: Cursor): boolean {
  if (!primaryExpr(c)) return false;
  for (;;) {
    if (c.punct('+') || c.punct('-')) {
      if (!primaryExpr(c)) return false;
      continue;
    }
    return true;
  }
}
function primaryExpr(c: Cursor): boolean {
  if (c.punct('(')) {
    if (!nested(c, orExpr)) return false;
    return c.punct(')');
  }
  if (number(c)) return true;
  return backtickIdent(c) !== undefined;
}

/** `constraint `nom` check (…)` : la seule forme de contrainte `check` admise. */
function checkItem(c: Cursor): boolean {
  if (!c.keyword('CHECK') || !c.punct('(')) return false;
  if (!checkExpr(c)) return false;
  return c.punct(')');
}

/** `constraint `nom` …` : une clé étrangère ou une contrainte `check`, les deux seules formes de `constraint` admises. */
function constraintItem(c: Cursor): boolean {
  if (!c.keyword('CONSTRAINT') || backtickIdent(c) === undefined) return false;
  const next = c.peek();
  if (next.kind !== 'word') return false;
  if (next.value.toUpperCase() === 'FOREIGN') return foreignKeyItem(c);
  if (next.value.toUpperCase() === 'CHECK') return checkItem(c);
  return false;
}

/** Un membre du corps de la table : une colonne, une clé, ou une contrainte. */
function bodyItem(c: Cursor): boolean {
  const first = c.peek();
  if (first.kind === 'quoted') return columnDef(c); // un nom de colonne
  if (first.kind !== 'word') return false;
  const word = first.value.toUpperCase();
  if (word === 'PRIMARY' || word === 'UNIQUE' || word === 'KEY') return keyItem(c);
  if (word === 'CONSTRAINT') return constraintItem(c);
  return false; // ni colonne, ni clé, ni contrainte : un mot que la grammaire ne connaît pas (GENERATED en tête d'un membre, par exemple)
}

/** Une valeur d'option : un mot nu ou un nombre. Jamais une expression : un nom de moteur, un jeu de caractères ou une collation. */
function optionValue(c: Cursor): boolean {
  return c.word() !== undefined || number(c);
}

/**
 * Une option de la table, après la parenthèse fermante : `engine=innodb`, `default charset=utf8mb4` (deux mots avant le `=`, la seule forme à deux mots mesurée),
 * ou `charset=…`/`collate=…` (un mot). Le mot `default` ne porte jamais de valeur à lui seul : il n'a de sens ici que devant `charset`.
 */
function tableOption(c: Cursor): boolean {
  if (c.keyword('DEFAULT')) return c.keyword('CHARSET') && c.punct('=') && optionValue(c);
  if (c.word() === undefined) return false;
  return c.punct('=') && optionValue(c);
}

/**
 * Les options de la table après la parenthèse fermante : une suite de `tableOption`, toujours la même forme fixe chez Dolt (mesuré), jamais choisie par un collaborateur,
 * puis un point-virgule facultatif (`dolt_schema_diff(...).to_create_statement` en met un ; `show create table` n'en met pas), consommé ici pour que le texte entier
 * soit lu jusqu'au bout.
 */
function tableOptions(c: Cursor): boolean {
  for (;;) {
    if (c.punct(';')) return c.atEof();
    if (c.atEof()) return true;
    if (!tableOption(c)) return false;
  }
}

/**
 * `createTableProblems(text, label)` : `text` est admis (rien n'est rendu) s'il commence par `CREATE TABLE` et que son corps ne contient que des colonnes, clés, clés
 * étrangères et contraintes `check` de la forme ci-dessus, et des options de table ordinaires. Sinon, un problème nommé `label` (jamais le contenu de `text`) :
 *
 * - `text` ne commence pas par `CREATE TABLE` (une vue — `CREATE VIEW` — ou toute autre forme) : refusé, comme une vue ;
 * - une colonne porte `GENERATED` (visible ou, pour un index fonctionnel, cachée derrière `KEY … ((…))`) : refusé, nommé comme une colonne générée ;
 * - toute autre construction que la grammaire ne reconnaît pas (un `check` d'une autre forme, un défaut entre parenthèses qui n'est pas `(json_object())`, un mot-clé
 *   inattendu, un jeton que le découpage ne reconnaît pas) : refusé, nommé génériquement.
 *
 * Rien de `text` n'est répété dans le problème : seul `label` (le nom de la table que l'app a demandée, pas un extrait de la base) y figure.
 */
export function createTableProblems(text: string, label: string): string[] {
  const tokens = tokenize(text);
  if (!tokens) return [`${label} : construction non reconnue dans la définition de la table`];
  const c = new Cursor(tokens);
  if (!c.keyword('CREATE') || !c.keyword('TABLE')) return [`${label} est une vue, ou autre chose qu'une table, que l'app pourrait lire à la place d'une table`];
  if (backtickIdent(c) === undefined) return [`${label} : construction non reconnue dans la définition de la table`];
  if (!c.punct('(')) return [`${label} : construction non reconnue dans la définition de la table`];
  if (!bodyItem(c)) return [`${label} : colonne générée, index fonctionnel, ou autre construction non admise`];
  while (c.punct(',')) if (!bodyItem(c)) return [`${label} : colonne générée, index fonctionnel, ou autre construction non admise`];
  if (!c.punct(')')) return [`${label} : colonne générée, index fonctionnel, ou autre construction non admise`];
  if (!tableOptions(c)) return [`${label} : construction non reconnue dans les options de la table`];
  if (!c.atEof()) return [`${label} : construction non reconnue dans la définition de la table`];
  return [];
}
