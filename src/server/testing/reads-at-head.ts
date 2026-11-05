/**
 * La règle des lectures de l'état des tickets (bdesk-38k.36, ADR 0001), jugée sur le SQL que l'on envoie à Dolt : une table lue sans
 * `as of 'HEAD'` est lue dans le working set, que l'historique (`dolt_history_*`) ne voit pas, et le tableau se met à dire autre chose
 * que les métriques. Elle vaut pour toute lecture, pas pour celles d'un seul module : c'est aux tests qui voient tout le SQL d'un
 * service de s'en servir (`committed.integration.test.ts`), plus qu'à un lecteur de la tenir.
 *
 * Le filet lit le SQL en jetons, comme le fait Dolt (chaînes, identifiants entre guillemets inversés et commentaires compris), et suit
 * les parenthèses : c'est ce qui lui permet de savoir quand une virgule sépare deux tables (celle d'un `from`) et quand elle n'en sépare
 * pas (celle d'un `group by`, d'un appel de fonction), et quelle requête commune (`with`) cache quelle table (bdesk-38k.47). Ce qu'il
 * ne sait pas lire, il le signale plutôt que de le laisser passer : ses erreurs vont dans le sens d'un test qui échoue à tort (le
 * `from` de `extract(day from d)` ou de `trim(… from s)` est lu comme une table, `information_schema.tables` comme la table `tables`,
 * `as of hashof('HEAD')` n'est pas la clause), jamais d'une lecture du working set qui passe en silence.
 */

/** Une table lue par une requête, et si la clause `as of 'HEAD'` la suit. */
export interface TableRead {
  table: string;
  atHead: boolean;
}

/** Un jeton : un mot (en minuscules), un identifiant entre guillemets inversés, une chaîne (entre apostrophes ou guillemets doubles : Dolt les lit pareil) ou un symbole. */
interface Token {
  kind: 'word' | 'name' | 'string' | 'symbol';
  text: string;
}

const isSymbol = (token: Token | undefined, text: string) => token?.kind === 'symbol' && token.text === text;
const isWord = (token: Token | undefined, ...texts: string[]) => token?.kind === 'word' && texts.includes(token.text);
const isName = (token: Token | undefined): token is Token => token?.kind === 'word' || token?.kind === 'name' || token?.kind === 'string';

const WORD_CHAR = /[\p{L}\p{N}_$]/u;

/**
 * Découpe comme Dolt, dont on a mesuré chaque cas (2.5.0) : `#` et `--` ouvrent un commentaire jusqu'à la fin de la ligne, `--` collé
 * au caractère suivant compris (MySQL n'y voit pas un commentaire, Dolt oui) ; un commentaire de bloc est un commentaire, sauf s'il
 * s'ouvre par un point d'exclamation (avec ou sans version) : Dolt l'exécute, son contenu est du SQL. Une chaîne ou un identifiant
 * non terminé va jusqu'à la fin du texte.
 */
function tokenize(sql: string): Token[] {
  const tokens: Token[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql.charAt(i);
    const next = sql.charAt(i + 1);
    if (/\s/.test(c)) {
      i++;
    } else if (c === '#' || (c === '-' && next === '-')) {
      const end = sql.indexOf('\n', i);
      i = end < 0 ? sql.length : end;
    } else if (c === '/' && next === '*') {
      if (sql.charAt(i + 2) === '!') {
        i += 3; // le contenu est du SQL ; sa fin (`*` puis `/`) ne donne que des symboles que rien ne lit
        while (/\d/.test(sql.charAt(i))) i++; // la version : `/*!50000`
      } else {
        const end = sql.indexOf('*/', i + 2);
        i = end < 0 ? sql.length : end + 2;
      }
    } else if (c === "'" || c === '"' || c === '`') {
      const [text, end] = readQuoted(sql, i);
      tokens.push({ kind: c === '`' ? 'name' : 'string', text });
      i = end;
    } else if (WORD_CHAR.test(c)) {
      let end = i + 1;
      while (end < sql.length && WORD_CHAR.test(sql.charAt(end))) end++;
      tokens.push({ kind: 'word', text: sql.slice(i, end).toLowerCase() });
      i = end;
    } else {
      tokens.push({ kind: 'symbol', text: c });
      i++;
    }
  }
  return tokens;
}

/** Le texte de la chaîne ou de l'identifiant ouvert en `start` (guillemet doublé et antislash compris : `''`, `\'`), et la place qui le suit. */
function readQuoted(sql: string, start: number): [text: string, end: number] {
  const quote = sql.charAt(start);
  let text = '';
  for (let i = start + 1; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (c === '\\' && quote !== '`') {
      text += sql.charAt(++i);
    } else if (c !== quote) {
      text += c;
    } else if (sql.charAt(i + 1) === quote) {
      text += quote;
      i++;
    } else {
      return [text, i + 1];
    }
  }
  return [text, sql.length];
}

/** Une requête commune (`with name as (…)`) : son nom, et si le `with` est récursif. */
interface CommonTable {
  name: string;
  recursive: boolean;
}

/** Où l'on en est dans une paire de parenthèses (ou dans l'instruction, pour la racine) : de quoi savoir ce que le jeton suivant désigne. */
interface Scope {
  /** Dans la liste d'un `from` : une virgule y sépare deux tables. */
  inFrom: boolean;
  /** Le jeton suivant désigne une table : il suit `from`, `join` ou une virgule du `from`. */
  expectTable: boolean;
  /** Les requêtes communes que `with` a définies ici, une fois leur corps refermé : celles que voient la suite de la requête et ses sous-requêtes. */
  commonTables: Set<string>;
  /** Le jeton qui vient est celui qui suit le corps d'une requête commune : une virgule y annonce la suivante (`with a as (…), b as (…)`), et ailleurs, par exemple dans `window w as (…), v as (…)`, non ; et `table` y est une instruction (`with x as (…) table t`). */
  afterBody: boolean;
  /** Ce scope est le corps de cette requête commune. */
  body?: CommonTable;
  /** Le corps d'une requête commune récursive a passé son `union` : sa partie récursive, la seule où son nom est celui de la requête commune. */
  inRecursivePart: boolean;
  /** Le `with` de ce scope est un `with recursive` : il vaut pour chacune de ses requêtes communes. */
  recursiveWith: boolean;
}

const newScope = (inFrom = false): Scope => ({
  inFrom,
  expectTable: inFrom,
  commonTables: new Set(),
  afterBody: false,
  inRecursivePart: false,
  recursiveWith: false,
});

/** Les mots qui ouvrent une requête : ce qui suit un `(` du `from` n'est alors pas une table mais une sous-requête. */
const QUERY_START = new Set(['select', 'with', 'values', 'table']);
/**
 * Les mots qui finissent la liste du `from` et après lesquels une virgule du même niveau ne sépare plus des tables : `group by a, b`,
 * `order by a, b`, `limit a, b`, les `window w as (…), v as (…)`, `for update of a, b`, et les lignes de `union values row(…), row(…)`.
 */
const ENDS_FROM = new Set(['group', 'order', 'limit', 'window', 'for', 'union', 'intersect', 'except']);
/** Ce qui peut précéder `table` quand c'est l'instruction `table t` (`table t` lit t, comme `select * from t`) et non `create table`. */
const BEFORE_TABLE_STATEMENT = new Set(['all', 'distinct', 'union', 'intersect', 'except']);

/** La requête commune annoncée à partir de `start` (`name [(colonnes)] as (`), avec la place de la parenthèse qui ouvre son corps. */
function announcedAt(tokens: readonly Token[], start: number): { name: string; bodyOpen: number } | undefined {
  const name = tokens[start];
  if (name?.kind !== 'word' && name?.kind !== 'name') return undefined;
  let after = start + 1;
  if (isSymbol(tokens[after], '(')) {
    const close = tokens.findIndex((token, at) => at > after && isSymbol(token, ')')); // la liste des colonnes : des noms, sans parenthèse
    after = close < 0 ? tokens.length : close + 1;
  }
  return isWord(tokens[after], 'as') && isSymbol(tokens[after + 1], '(') ? { name: name.text.toLowerCase(), bodyOpen: after + 1 } : undefined;
}

/** `as of 'HEAD'` à partir de `at` : la clause, en toutes casses ; `as of 'HEAD~1'` ou `as of hashof('HEAD')` n'en sont pas. */
const isAsOfHead = (tokens: readonly Token[], at: number) =>
  isWord(tokens[at], 'as') && isWord(tokens[at + 1], 'of') && tokens[at + 2]?.kind === 'string' && tokens[at + 2]?.text.toLowerCase() === 'head';

/** Les tables qu'une requête lit, dans l'ordre : celles du `from`, d'un `join` (de toute sorte) ou d'une virgule du `from`, de `table t`, hors sous-requêtes et requêtes communes. */
export function tableReads(sql: string): TableRead[] {
  const tokens = tokenize(sql);
  // `show [full] tables from <base>` liste les tables d'une base (celle d'une ancre d'époque : `stored-sql.ts`, bdesk-38k.69) : son `from` nomme la base, non une table.
  if (isWord(tokens[0], 'show') && (isWord(tokens[1], 'tables') || (isWord(tokens[1], 'full') && isWord(tokens[2], 'tables')))) return [];
  const reads: TableRead[] = [];
  const stack: Scope[] = [newScope()];

  /** Le nom est celui d'une requête commune, que ce soit celle d'un `with` englobant ou celle dont on lit la partie récursive : ce n'est pas une table. */
  const isCommonTable = (name: string) =>
    stack.some((scope) => scope.commonTables.has(name) || (scope.inRecursivePart && scope.body?.recursive === true && scope.body.name === name));

  /** Lit la table nommée à partir de `start` (`db`.`table` comprise) ; rend la place de son dernier jeton. */
  const readTable = (start: number): number => {
    let end = start;
    let qualified = false;
    while (isSymbol(tokens[end + 1], '.') && isName(tokens[end + 2])) {
      end += 2;
      qualified = true;
    }
    const table = (tokens[end]?.text ?? '').toLowerCase();
    if (qualified || !isCommonTable(table)) reads.push({ table, atHead: isAsOfHead(tokens, end + 1) });
    return end;
  };

  /** Entre dans le corps d'une requête commune annoncée : un scope qui porte son nom ; rend la place de sa parenthèse ouvrante, que la boucle dépasse. */
  const enterBody = ({ name, bodyOpen }: { name: string; bodyOpen: number }, recursive: boolean): number => {
    const body = newScope();
    body.body = { name, recursive };
    stack.push(body);
    return bodyOpen;
  };

  for (let i = 0; i < tokens.length; i++) {
    const token = tokens[i];
    const scope = stack[stack.length - 1];
    if (!token || !scope) break;
    const afterBody = scope.afterBody;
    scope.afterBody = false;

    if (scope.expectTable) {
      if (isSymbol(token, '(')) {
        // Une sous-requête, ou une table (un groupe de jointures) entre parenthèses : celle-ci est encore dans un from.
        scope.expectTable = false;
        const next = tokens[i + 1];
        stack.push(newScope(!(next?.kind === 'word' && QUERY_START.has(next.text))));
        continue;
      }
      if (isWord(token, 'lateral')) continue;
      scope.expectTable = false;
      if (isName(token)) {
        i = readTable(i);
        continue;
      }
    }

    if (isSymbol(token, '(')) {
      stack.push(newScope());
    } else if (isSymbol(token, ')')) {
      const closed = stack.length > 1 ? stack.pop() : undefined;
      const parent = stack[stack.length - 1];
      if (closed?.body && parent) {
        parent.commonTables.add(closed.body.name); // visible à partir d'ici, pas dans son propre corps
        parent.afterBody = true;
      }
    } else if (isSymbol(token, ',')) {
      // Après le corps d'une requête commune, une virgule en annonce une autre ; dans un `from`, une table.
      const announced = afterBody ? announcedAt(tokens, i + 1) : undefined;
      if (announced) i = enterBody(announced, scope.recursiveWith);
      else if (scope.inFrom) scope.expectTable = true;
    } else if (isSymbol(token, ';')) {
      stack.length = 0;
      stack.push(newScope());
    } else if (token.kind === 'word' && !isSymbol(tokens[i - 1], '.')) {
      const word = token.text;
      if (word === 'from' || word === 'join' || word === 'straight_join') {
        scope.inFrom = true;
        scope.expectTable = true;
      } else if (word === 'with') {
        const recursive = isWord(tokens[i + 1], 'recursive');
        const announced = announcedAt(tokens, i + (recursive ? 2 : 1));
        if (announced) {
          scope.recursiveWith = recursive;
          i = enterBody(announced, recursive);
        }
      } else if (word === 'table' && (i === 0 || afterBody || isSymbol(tokens[i - 1], '(') || isSymbol(tokens[i - 1], ';') || isWord(tokens[i - 1], ...BEFORE_TABLE_STATEMENT))) {
        if (isName(tokens[i + 1])) i = readTable(i + 1);
      } else if (ENDS_FROM.has(word)) {
        scope.inFrom = false;
        if (word === 'union') scope.inRecursivePart = true;
      }
    }
  }
  return reads;
}

/**
 * Les tables de Dolt que la règle laisse lire sans la clause : celles de l'historique, `dolt_log`, `dolt_commit_ancestors` et les
 * `dolt_history_*`, qui voient les commits et jamais le working set. Les autres tables de Dolt, elles, ne sont pas toutes de
 * l'historique : `dolt_status` et `dolt_workspace_*` sont le working set, `dolt_diff_*` et `dolt_diff(…)` le montrent contre `WORKING`.
 * Une liste blanche, donc : une table de Dolt dont on aurait besoin s'y ajoute en le disant, elle ne passe pas parce qu'elle commence par `dolt_`.
 */
const DOLT_HISTORY_TABLES = new Set(['dolt_log', 'dolt_commit_ancestors']);
const isDoltHistory = (table: string) => DOLT_HISTORY_TABLES.has(table) || table.startsWith('dolt_history_');

/**
 * Les autres tables qui n'ont pas à porter la clause : le préfixe des tickets (`config`), qui identifie le Projet et ne décrit aucun
 * ticket (ADR 0001). Toute autre table lue, `issues`, `dependencies`, `labels`, `comments` ou une qu'on ajouterait, doit la porter :
 * l'oubli est un échec, pas un silence.
 */
const NOT_TICKET_STATE = new Set(['config']);

/** Ce que la règle reproche à cette lecture, ou rien. */
function reproach({ table, atHead }: TableRead): string | undefined {
  if (isDoltHistory(table) || NOT_TICKET_STATE.has(table)) return undefined;
  if (table.startsWith('dolt_')) return `${table} n'est pas une table de l'historique de Dolt (dolt_log, dolt_commit_ancestors, dolt_history_*)`;
  return atHead ? undefined : `${table} lue sans « as of 'HEAD' »`;
}

/** Les lectures de tables de tickets qui ne portent pas la clause, ou de tables de Dolt hors de l'historique, une phrase chacune : vide quand la règle est tenue. */
export function readsOutsideHead(sqls: readonly string[]): string[] {
  return sqls.flatMap((sql) =>
    tableReads(sql).flatMap((read) => {
      const reason = reproach(read);
      return reason === undefined ? [] : [`${reason} : ${sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`];
    }),
  );
}

/**
 * Les tables que ces requêtes lisent hors de l'historique de Dolt, `config` comprise : de quoi vérifier qu'une règle sur « tout ce qui
 * est lu » a bien vu tout ce qu'elle devait voir, et non rien.
 */
export function tablesRead(sqls: readonly string[]): Set<string> {
  return new Set(sqls.flatMap((sql) => tableReads(sql).map(({ table }) => table)).filter((table) => !isDoltHistory(table)));
}
