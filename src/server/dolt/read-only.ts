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
 * La requête est découpée en jetons comme le fait Dolt : chaînes et identifiants entre guillemets (opaques), mots et symboles.
 * « Comme le fait Dolt » veut dire deux lecteurs : son analyseur, et le découpeur d'instructions de `dolt sql -q`, qui coupe
 * aux `;` et ne lit pas tout à fait comme lui. Ce que l'un des deux et ce découpage pourraient lire différemment est refusé
 * plutôt que deviné :
 * - tout commentaire hors d'une chaîne ou d'un identifiant : `/*` (exécutable ou non), `-- ` et `#`. Le lecteur n'en écrit aucun,
 *   et c'est là que les deux lisent le plus différemment : Dolt exécute le contenu de `/*!`, de `/*M!` et de `/*dolt!` ; pour le
 *   découpeur, la suite « barre, étoile, barre » est un commentaire complet, pour l'analyseur il n'en ouvre qu'un, qui court jusqu'à la fermeture suivante ;
 * - l'antislash entre guillemets doubles ou accents graves, et celui qui échappe un saut de ligne (voir `endOfQuoted`) ;
 * - le caractère de contrôle, l'antislash et le caractère hors ASCII en dehors des chaînes.
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
 * Mots refusés où qu'ils soient, hors des chaînes et des identifiants entre guillemets. Il n'y a pas d'autre endroit où cacher un mot : aucun commentaire n'est
 * admis (voir `tokenize`), et ce que les chaînes et les identifiants ont d'opaque l'est pour l'analyseur de Dolt comme pour son découpeur d'instructions,
 * dans les seules lectures de l'antislash qu'ils partagent (voir `endOfQuoted`) : écritures de données et de schéma, `call` (procédures `dolt_*`),
 * `into` (`select … into outfile` écrit sur le disque), `load` et `load_file`, et `table`. `table t` est pour Dolt une
 * instruction de lecture (`select * from t`), sans la clause `as of` : elle lit le working set, pas le dernier commit
 * (ADR 0001). Dolt l'accepte partout où une requête peut s'écrire, dans un `from` (`(table t)`), après un `union`
 * (`intersect`, `except`), dans le corps d'une requête commune ou d'un `with` imbriqué : le garde ne l'arrête qu'en la
 * refusant comme mot, non comme instruction qui s'ouvre par lui (bdesk-38k.56). `for update`, `show create` et
 * `show table status` sont refusés par ricochet : le lecteur n'en a pas l'usage.
 */
const FORBIDDEN_WORDS = new Set(['into', 'insert', 'update', 'delete', 'replace', 'call', 'load', 'load_file', 'create', 'drop', 'alter', 'truncate', 'table']);
/** Jeton qui représente une chaîne ou un identifiant entre guillemets. */
const QUOTED = "'";

/**
 * Raison pour laquelle une requête n'est pas une lecture simple. Elle finit dans le message de la `ReadOnlyViolation`,
 * donc dans la réponse HTTP : elle ne reprend rien de la requête, hormis un mot de `FORBIDDEN_WORDS`.
 */
class NotReadOnly extends Error {}

function checkReadOnly(sql: string): void {
  const statements = splitStatements(tokenize(sql));
  const [statement] = statements;
  if (!statement || statements.length > 1) throw new NotReadOnly('une seule instruction attendue');
  const [verb = ''] = statement;
  if (!READ_ONLY_VERBS.has(verb)) throw new NotReadOnly("l'instruction n'est pas une lecture");
  if (verb === 'with' && statementAfterCtes(statement) !== 'select') throw new NotReadOnly("un WITH doit être suivi d'une lecture");
  const forbidden = statement.find((token) => FORBIDDEN_WORDS.has(token));
  if (forbidden) throw new NotReadOnly(`mot interdit « ${forbidden} »`);
}

function tokenize(sql: string): string[] {
  const tokens: string[] = [];
  let i = 0;
  while (i < sql.length) {
    const c = sql.charAt(i);
    if (c === ' ' || c === '\t' || c === '\n') {
      i++;
    } else if (c === "'" || c === '"' || c === '`') {
      i = endOfQuoted(sql, i);
      tokens.push(QUOTED);
    } else if (c === '#' || (c === '-' && sql.charAt(i + 1) === '-') || (c === '/' && sql.charAt(i + 1) === '*')) {
      throw new NotReadOnly("commentaire (le lecteur n'en écrit aucun)");
    } else if (/\w/.test(c)) {
      const start = i;
      while (i < sql.length && /\w/.test(sql.charAt(i))) i++;
      tokens.push(sql.slice(start, i).toLowerCase());
    } else if (c > ' ' && c <= '~' && c !== '\\') {
      tokens.push(c);
      i++;
    } else {
      throw new NotReadOnly('caractère de contrôle, antislash ou caractère hors ASCII en dehors des chaînes');
    }
  }
  return tokens;
}

/**
 * Fin d'une chaîne ou d'un identifiant entre guillemets (antislash et guillemet doublé compris), ouvert en `start`.
 *
 * L'antislash n'a le même sens pour l'analyseur de Dolt, pour le découpeur d'instructions de `dolt sql -q` (celui qui coupe aux `;`) et pour nous
 * qu'entre apostrophes, où il échappe. Ailleurs on le refuse plutôt que de choisir un des sens :
 * - entre guillemets doubles, cela dépend de la base : avec `ANSI_QUOTES` dans son `sql_mode` (que `set @@persist.sql_mode` inscrit dans
 *   `.dolt/config.json`, et que `dolt sql` honore), `"…"` est un identifiant où l'antislash n'échappe rien ;
 * - entre accents graves, l'analyseur lit un caractère ordinaire, le découpeur un échappement : pour lui, un accent grave qui suit un antislash n'ouvre
 *   ni ne ferme rien. Les deux ne voient plus les mêmes identifiants, et le découpeur coupe à un `;` que nous lisons dans un identifiant ou dans un
 *   commentaire. Quand le premier morceau reste valide (il finit dans un commentaire `-- `), les morceaux suivants s'exécutent (bdesk-38k.56, B3).
 * - entre apostrophes, tous l'entendent de même, sauf devant un saut de ligne : le découpeur compte les antislash qui se suivent sans remettre le compte à
 *   zéro au saut de ligne, si bien qu'un antislash qui échappe un saut de ligne compte encore pour l'antislash suivant. Le guillemet qui suit
 *   `\<saut de ligne>\` n'est plus échappé pour lui (il ferme la chaîne), il l'est pour l'analyseur et pour nous : même écart, même effet. Un antislash
 *   qui échappe un saut de ligne est refusé ; deux antislash devant un saut de ligne, que `sqlString` écrit pour un antislash de la valeur, ne le sont pas.
 * Le lecteur n'écrit jamais d'antislash entre guillemets doubles ni entre accents graves, ni devant un saut de ligne (`sqlString` double les antislash).
 *
 * Une marque de commentaire (`--`, `#`, `/*`) dans une chaîne ou un identifiant n'est qu'un caractère, que tous lisent de même : c'est hors d'eux qu'aucun
 * commentaire n'est admis.
 */
function endOfQuoted(sql: string, start: number): number {
  const quote = sql.charAt(start);
  for (let i = start + 1; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (c === '\\' && quote !== "'") {
      throw new NotReadOnly('antislash entre guillemets doubles ou accents graves');
    } else if (c === '\\') {
      if (sql.charAt(i + 1) === '\n') throw new NotReadOnly('antislash devant un saut de ligne dans une chaîne');
      i++;
    } else if (c === quote) {
      if (sql.charAt(i + 1) !== quote) return i + 1;
      i++;
    }
  }
  throw new NotReadOnly('chaîne ou identifiant non terminé');
}

/** Instructions séparées par des `;` ; les instructions vides (point-virgule final) sont écartées. */
function splitStatements(tokens: string[]): string[][] {
  let current: string[] = [];
  const statements = [current];
  for (const token of tokens) {
    if (token === ';') {
      current = [];
      statements.push(current);
    } else {
      current.push(token);
    }
  }
  return statements.filter((statement) => statement.length > 0);
}

/** Premier mot de l'instruction qui suit les tables de `with [recursive] nom [(colonnes)] as (…), … `. */
function statementAfterCtes(statement: string[]): string | undefined {
  let i = statement[1] === 'recursive' ? 2 : 1;
  for (;;) {
    const name = statement[i++];
    if (name === undefined || (name !== QUOTED && !/^\w+$/.test(name))) return undefined;
    if (statement[i] === '(') i = afterParentheses(statement, i);
    if (statement[i++] !== 'as' || statement[i] !== '(') return undefined;
    i = afterParentheses(statement, i);
    if (statement[i] !== ',') return statement[i];
    i++;
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
