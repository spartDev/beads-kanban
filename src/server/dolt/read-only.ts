/**
 * Le lecteur Dolt est en lecture seule, deux fois plutôt qu'une :
 *
 * 1. `assertReadOnly` refuse toute requête qui n'est pas une lecture simple, avant de lancer `dolt` ;
 * 2. `READ_ONLY_PREFIX` ouvre chaque appel sur une transaction en lecture seule, où Dolt refuse lui-même INSERT,
 *    UPDATE et DELETE. Elle ne couvre que les écritures de données : Dolt laisse passer, dans une transaction en
 *    lecture seule, `create`, `drop`, `truncate`, `call dolt_*` et `select … into outfile`. Seule la première
 *    ligne de défense les arrête.
 */

import { DoltQueryError } from './errors';

/** Chaque appel s'ouvre sur une transaction en lecture seule. */
export const READ_ONLY_PREFIX = 'start transaction read only; ';

/**
 * La requête n'est pas une lecture simple : le garde-fou l'a refusée. C'est une `DoltQueryError`, donc un Projet
 * illisible (503 avec la raison) pour l'API, et non une erreur interne (500). Son message dit pourquoi sans citer
 * la requête (ni extrait, ni verbe) : elle n'a pas sa place dans une réponse HTTP.
 */
export class ReadOnlyViolation extends DoltQueryError {
  constructor(reason: string) {
    super(`Requête refusée : le lecteur Dolt est en lecture seule (${reason})`);
    this.name = 'ReadOnlyViolation';
  }
}

/**
 * Garde-fou : le lecteur ne lance qu'une seule lecture (SELECT, SHOW, DESCRIBE, EXPLAIN, ou WITH … SELECT),
 * quelle que soit la requête construite. Sinon il lève une `ReadOnlyViolation`.
 *
 * Le garde est une liste blanche : il n'admet que ce que `reader.ts` et `history.ts` écrivent, par `sqlString` et `sqlIdent`. Dolt lit une requête par deux
 * lecteurs, son analyseur et le découpeur d'instructions de `dolt sql -q` (celui qui coupe aux `;`), qui ne lisent pas tout à fait de même. Leurs écarts se sont
 * trouvés un par un (bdesk-38k.56 : `/*!`, `/*M!`, `/*dolt!`, l'antislash entre guillemets doubles, entre accents graves, devant un saut de ligne, et la suite « barre, étoile, barre » ;
 * bdesk-38k.63), chaque fois dans une forme que le lecteur n'écrit pas : plutôt que de courir derrière elles, le garde refuse tout ce que le lecteur n'écrit pas.
 * - Hors des chaînes et des identifiants : des mots et des nombres, l'espace, le saut de ligne, et `( ) , . * + - < = >`. Ni point-virgule (une seule
 *   instruction, que le client joint lui-même aux autres), ni commentaire (`/*`, `-- `, `#`), ni guillemets doubles, ni arobase, ni antislash, ni tabulation, ni
 *   caractère de contrôle ou hors ASCII ; un mot collé à un guillemet est un préfixe de chaîne (`N'…'`, `_utf8'…'`, `x'…'`, `b'…'`) : refusé de même.
 * - Une chaîne s'écrit entre apostrophes, l'apostrophe doublée et l'antislash doublé (voir `endOfQuoted`) ; un identifiant, entre accents graves, sans antislash.
 * - Un appel, c'est un mot ou un identifiant entre accents graves suivi d'une parenthèse : Dolt lit `` `load_file`(…) `` comme `load_file(…)`. Il ne nomme qu'une
 *   fonction de la liste blanche `FUNCTIONS`, ou un mot de structure (`in`, `as`, `over`…) ; la liste de colonnes d'une requête commune (`with nom (a, b) as`) n'est
 *   pas un appel. Ce n'est pas une liste noire : `dolt_query_diff('…', '…')` exécute ses arguments, et ce que les fonctions de Dolt feraient d'autre est inconnu.
 * Leur contenu n'est pas jugé, hors cela : `sqlString` et `sqlIdent` y mettent n'importe quelle valeur, que le garde doit admettre.
 * Ces écarts se mesurent, ils ne se déduisent pas : `read-only.integration.test.ts` (formes hostiles) les lance contre un vrai Dolt.
 *
 * Le garde refuse de même `table t`, où qu'il s'écrive (voir `FORBIDDEN_WORDS`) : une instruction de lecture qui n'est
 * pas un `select`, qu'il n'admet pas plus en tête de requête que glissée dans une sous-requête. Il ne juge pas pour
 * autant l'état lu : `select … from issues` sans `as of 'HEAD'` passe (comme `as of 'WORKING'`, `dolt_diff` ou
 * `dolt_status`), et c'est au filet des tests (`testing/reads-at-head.ts`) de le signaler. Il juge ce que la requête
 * est, non ce qu'elle lit.
 */
export function assertReadOnly(sql: string): void {
  try {
    checkReadOnly(sql);
  } catch (err) {
    if (!(err instanceof NotReadOnly)) throw err;
    throw new ReadOnlyViolation(err.message);
  }
}

/** Ce que le lecteur peut lancer ; `with` n'est admis que si l'instruction qui suit ses tables est un `select`. */
const READ_ONLY_VERBS = new Set(['select', 'show', 'describe', 'desc', 'explain', 'with']);
/**
 * Mots refusés où qu'ils soient : nus, ou comme nom d'un identifiant entre accents graves (`` `load_file`(…) `` est l'appel de `load_file`, voir `FUNCTIONS`).
 * Une chaîne n'est pas toujours opaque : `dolt_query_diff('…', '…')` exécute le SQL de ses arguments (un `select … into outfile` écrit un fichier, un `load_file` en
 * lit un), d'où la liste blanche des fonctions, qui refuse aussi ce que cette liste noire n'a pas prévu. Hors des chaînes, il n'y a pas d'autre endroit où cacher un
 * mot : aucun commentaire n'est admis (voir `tokenize`) et les chaînes ne sont opaques que pour qui n'exécute pas leur contenu. Sont refusés : écritures de données
 * et de schéma, `call` (procédures `dolt_*`), `into` (`select … into outfile` écrit sur le disque), `load` et `load_file`, `dolt_query_diff`, et `table`. `table t` est
 * pour Dolt une instruction de lecture (`select * from t`), sans la clause `as of` : elle lit le working set, pas le dernier commit (ADR 0001). Dolt l'accepte
 * partout où une requête peut s'écrire, dans un `from` (`(table t)`), après un `union` (`intersect`, `except`), dans le corps d'une requête commune ou d'un `with`
 * imbriqué : le garde ne l'arrête qu'en la refusant comme mot, non comme instruction qui s'ouvre par lui (bdesk-38k.56). `for update`, `show create` et
 * `show table status` sont refusés par ricochet : le lecteur n'en a pas l'usage. Les autres mots, eux, ne sont pas en liste blanche : les tests, et un jour une autre
 * lecture, écrivent d'autres noms de tables et de colonnes que ceux du lecteur d'aujourd'hui.
 */
const FORBIDDEN_WORDS = new Set(['into', 'insert', 'update', 'delete', 'replace', 'call', 'load', 'load_file', 'dolt_query_diff', 'create', 'drop', 'alter', 'truncate', 'table']);
/**
 * Les fonctions que le lecteur appelle (`reader.ts`, `history.ts`) : `hashof('HEAD')`, `database()`, `lag(…) over (…)`, et celles que les tests du vrai client appellent :
 * `count(*)`, `sleep(…)` (les lectures lentes qu'ils abandonnent). Tout autre appel est refusé, quel que soit son nom et que l'on écrive le mot nu ou l'identifiant entre
 * accents graves. N'y entrent jamais une fonction de table qui exécute du SQL ou touche des fichiers (`dolt_query_diff`, `load_file`…), ni une qui lit autre chose que le
 * dernier commit (`dolt_diff`…).
 */
const FUNCTIONS = new Set(['database', 'hashof', 'lag', 'count', 'sleep']);
/** Les mots qui précèdent une parenthèse sans être un appel : la structure d'une requête (`in (…)`, `as (…)`, `over (…)`, `and (…)`, `join (…)`…). Aucun n'est une fonction. */
const STRUCTURE_WORDS = new Set([
  'select', 'from', 'where', 'having', 'and', 'or', 'not', 'xor', 'in', 'exists', 'any', 'some', 'all', 'distinct', 'as', 'on', 'using', 'join', 'union', 'intersect', 'except', 'case', 'when', 'then', 'else', 'between', 'by', 'over', 'partition',
]);
/** Jeton d'une chaîne. Celui d'un identifiant entre accents graves est `` `nom ``, où nom est son contenu, accents graves doublés défaits, en NFC et en minuscules. */
const QUOTED = "'";

/**
 * Raison pour laquelle une requête n'est pas une lecture simple. Elle finit dans le message de la `ReadOnlyViolation`,
 * donc dans la réponse HTTP : elle ne reprend rien de la requête, hormis un mot de `FORBIDDEN_WORDS`.
 */
class NotReadOnly extends Error {}

function checkReadOnly(sql: string): void {
  const statement = tokenize(sql);
  const [verb = ''] = statement;
  if (!READ_ONLY_VERBS.has(verb)) throw new NotReadOnly("l'instruction n'est pas une lecture");
  if (verb === 'with' && statementAfterCtes(statement) !== 'select') throw new NotReadOnly("un WITH doit être suivi d'une lecture");
  const forbidden = statement.map(bareName).find((name) => FORBIDDEN_WORDS.has(name));
  if (forbidden) throw new NotReadOnly(`mot interdit « ${forbidden} »`);
  checkCalls(statement);
}

/** Le jeton, sans l'accent grave qui ouvre celui d'un identifiant. */
const bareName = (token: string): string => (token.startsWith('`') ? token.slice(1) : token);

/** Le jeton est-il un nom : un mot, un nombre ou un identifiant entre accents graves ? */
const isName = (token: string | undefined): token is string => token !== undefined && (token.startsWith('`') || /^\w+$/.test(token));

/** Les symboles que le lecteur écrit hors des chaînes et des identifiants, avec les mots, les nombres, l'espace et le saut de ligne. */
const SYMBOLS = '(),.*+-<=>';

/** Les jetons de l'instruction : les mots en minuscules, les symboles, `QUOTED` pour chaque chaîne et `` `nom `` pour chaque identifiant. Tout ce que le lecteur n'écrit pas est refusé. */
function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql.charAt(i);
    if (c === ' ' || c === '\n') {
      i++;
    } else if (c === "'" || c === '`') {
      if (/\w/.test(sql.charAt(i - 1))) throw new NotReadOnly("mot collé à un guillemet (préfixe de chaîne : le lecteur n'en écrit aucun)");
      const end = endOfQuoted(sql, i);
      if (/\w/.test(sql.charAt(end))) throw new NotReadOnly("guillemet collé au mot qui suit (le lecteur n'en écrit aucun)");
      tokens.push(c === '`' ? '`' + sql.slice(i + 1, end - 1).replaceAll('``', '`').normalize('NFC').toLowerCase() : QUOTED);
      i = end;
    } else if (/\w/.test(c)) {
      const start = i;
      while (i < sql.length && /\w/.test(sql.charAt(i))) i++;
      tokens.push(sql.slice(start, i).toLowerCase());
    } else if (SYMBOLS.includes(c) && !(c === '-' && sql.charAt(i + 1) === '-')) {
      tokens.push(c);
      i++;
    } else {
      throw new NotReadOnly(notWritten(sql, i));
    }
  }
  return tokens;
}

/** Pourquoi le caractère en `i`, hors d'une chaîne, n'est pas admis. La raison ne reprend rien de la requête. */
function notWritten(sql: string, i: number): string {
  const c = sql.charAt(i);
  if (c === '#' || (c === '-' && sql.charAt(i + 1) === '-') || (c === '/' && sql.charAt(i + 1) === '*')) return "commentaire (le lecteur n'en écrit aucun)";
  if (c === ';') return "une seule instruction attendue (le lecteur n'écrit aucun point-virgule)";
  if (c === '"') return 'guillemets doubles (le lecteur écrit des chaînes entre apostrophes et des identifiants entre accents graves)';
  if (c === '\\') return "antislash en dehors d'une chaîne";
  return "caractère que le lecteur n'écrit jamais en dehors des chaînes";
}

/**
 * Fin d'une chaîne (entre apostrophes) ou d'un identifiant (entre accents graves), ouvert en `start` ; le guillemet doublé y est un guillemet.
 *
 * L'antislash est le seul endroit où l'analyseur de Dolt, son découpeur d'instructions et nous avons lu de travers, chaque fois autrement (bdesk-38k.56) :
 * - entre accents graves, l'analyseur lit un caractère ordinaire, le découpeur un échappement : pour lui, un accent grave qui suit un antislash n'ouvre
 *   ni ne ferme rien. Les deux ne voient plus les mêmes identifiants, et le découpeur coupe à un `;` que nous lisons dans l'identifiant. Si le premier morceau
 *   reste valide, les morceaux suivants s'exécutent (B3) ;
 * - entre apostrophes, il y échappe pour tous, sauf devant un saut de ligne : le découpeur compte les antislash qui se suivent sans remettre le compte à zéro au
 *   saut de ligne, si bien qu'un antislash qui échappe un saut de ligne compte encore pour le suivant ; le guillemet qui suit `\<saut de ligne>\` n'est plus
 *   échappé pour lui, il l'est pour l'analyseur et pour nous (B3 bis) ;
 * - entre guillemets doubles, cela dépend du `sql_mode` de la base (`ANSI_QUOTES`, que `set @@persist.sql_mode` inscrit dans `.dolt/config.json`) ; le garde
 *   n'admet plus aucun guillemet double (voir `tokenize`).
 * Le lecteur n'écrit jamais d'antislash hors de `sqlString`, qui double chacun : entre apostrophes, seul l'antislash doublé est admis (un antislash qui en échappe
 * un autre, que ni l'analyseur, ni le découpeur ne peuvent lire de travers, quelle que soit la suite) ; entre accents graves, aucun.
 */
function endOfQuoted(sql: string, start: number): number {
  const quote = sql.charAt(start);
  for (let i = start + 1; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (c === '\\') {
      if (quote === '`') throw new NotReadOnly('antislash entre accents graves');
      if (sql.charAt(i + 1) !== '\\') throw new NotReadOnly("antislash isolé dans une chaîne (sqlString double les antislash)");
      i++;
    } else if (c === quote) {
      if (sql.charAt(i + 1) !== quote) return i + 1;
      i++;
    }
  }
  throw new NotReadOnly('chaîne ou identifiant non terminé');
}

/** Premier mot de l'instruction qui suit les tables de `with [recursive] nom [(colonnes)] as (…), … `. */
function statementAfterCtes(statement: string[]): string | undefined {
  let i = statement[1] === 'recursive' ? 2 : 1;
  for (;;) {
    const name = statement[i++];
    if (!isName(name)) return undefined;
    if (statement[i] === '(') i = afterParentheses(statement, i);
    if (statement[i++] !== 'as' || statement[i] !== '(') return undefined;
    i = afterParentheses(statement, i);
    if (statement[i] !== ',') return statement[i];
    i++;
  }
}

/**
 * Refuse tout appel qui ne nomme pas une fonction de `FUNCTIONS` : un mot ou un identifiant entre accents graves suivi d'une parenthèse. Un mot de structure
 * (`STRUCTURE_WORDS`) n'est pas un appel ; la parenthèse qui suit le nom d'une requête commune (`with nom (a, b) as`) ouvre une liste de colonnes, pas un appel.
 */
function checkCalls(tokens: string[]): void {
  const lists = columnLists(tokens);
  tokens.forEach((token, i) => {
    if (tokens[i + 1] !== '(' || !isName(token) || lists.has(i + 1)) return;
    const name = bareName(token);
    if (FUNCTIONS.has(name) || (!token.startsWith('`') && STRUCTURE_WORDS.has(name))) return;
    throw new NotReadOnly("appel d'une fonction qui n'est pas en liste blanche (le lecteur n'appelle que database, hashof, lag, count et sleep)");
  });
}

/**
 * Les indices des parenthèses qui ouvrent la liste de colonnes d'une requête commune : après `with [recursive]`, ou après la virgule qui suit le corps d'une requête
 * commune, un nom suivi de `(` puis d'autres noms séparés par des virgules, `)`, `as` et le corps entre parenthèses. Un `with` qui n'est pas suivi d'une telle suite
 * (`with rollup`, une liste qui contient autre chose que des noms) n'en désigne aucune : ce qui suit un nom est alors un appel comme un autre.
 */
function columnLists(tokens: string[]): Set<number> {
  const lists = new Set<number>();
  tokens.forEach((token, w) => {
    if (token !== 'with') return;
    let i = tokens[w + 1] === 'recursive' ? w + 2 : w + 1;
    for (;;) {
      if (!isName(tokens[i])) return;
      let list = -1;
      if (tokens[i + 1] === '(') {
        list = i + 1;
        i = afterNames(tokens, list);
        if (i < 0) return;
      } else {
        i++;
      }
      if (tokens[i] !== 'as' || tokens[i + 1] !== '(') return;
      if (list >= 0) lists.add(list);
      i = afterParentheses(tokens, i + 1);
      if (tokens[i++] !== ',') return;
    }
  });
  return lists;
}

/** Indice qui suit la parenthèse fermante de `( nom, nom, … )`, ouverte en `open`, ou -1 si elle contient autre chose que des noms séparés par des virgules. */
function afterNames(tokens: string[], open: number): number {
  let i = open + 1;
  for (;;) {
    if (!isName(tokens[i])) return -1;
    i++;
    if (tokens[i] === ',') i++;
    else return tokens[i] === ')' ? i + 1 : -1;
  }
}

/** Indice qui suit la parenthèse fermante de celle ouverte en `open`. */
function afterParentheses(tokens: string[], open: number): number {
  let depth = 0;
  for (let i = open; i < tokens.length; i++) {
    if (tokens[i] === '(') depth++;
    else if (tokens[i] === ')' && --depth === 0) return i + 1;
  }
  throw new NotReadOnly('parenthèse non fermée');
}
