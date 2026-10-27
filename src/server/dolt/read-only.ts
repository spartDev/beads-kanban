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
 * La requête est découpée en jetons comme le fait Dolt : chaînes et identifiants entre guillemets (opaques),
 * commentaires (ignorés), mots et symboles. Tout ce que Dolt et ce découpage pourraient lire différemment est
 * refusé plutôt que deviné : commentaire exécutable, `--` collé au caractère suivant, caractère de contrôle…
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
 * Mots refusés où qu'ils soient hors chaînes : écritures de données et de schéma, `call` (procédures `dolt_*`),
 * `into` (`select … into outfile` écrit sur le disque), `load` et `load_file`. `for update` et `show create`
 * sont refusés par ricochet : le lecteur n'en a pas l'usage.
 */
const FORBIDDEN_WORDS = new Set(['into', 'insert', 'update', 'delete', 'replace', 'call', 'load', 'load_file', 'create', 'drop', 'alter', 'truncate']);
/** Caractères de contrôle (hors tabulation et saut de ligne) et séparateurs de ligne Unicode : Dolt ne les lit pas comme nous. */
// eslint-disable-next-line no-control-regex -- ce sont justement ces caractères que l'on cherche
const AMBIGUOUS_CHARS = /[\u0000-\u0008\u000b-\u001f\u007f\u0085\u2028\u2029]/;
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
    } else if (c === '#' || (c === '-' && sql.charAt(i + 1) === '-')) {
      i = endOfLineComment(sql, i);
    } else if (c === '/' && sql.charAt(i + 1) === '*') {
      i = endOfBlockComment(sql, i);
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

/** Fin d'une chaîne ou d'un identifiant entre guillemets (antislash et guillemet doublé compris), ouvert en `start`. */
function endOfQuoted(sql: string, start: number): number {
  const quote = sql.charAt(start);
  for (let i = start + 1; i < sql.length; i++) {
    const c = sql.charAt(i);
    if (c === '\\' && quote !== '`') {
      i++;
    } else if (c === quote) {
      if (sql.charAt(i + 1) !== quote) return i + 1;
      i++;
    }
  }
  throw new NotReadOnly('chaîne ou identifiant non terminé');
}

/**
 * Fin d'un commentaire `#` ou `-- ` : le saut de ligne. Dolt lit `--x` comme un commentaire, MySQL non : on refuse.
 * Le découpeur d'instructions de Dolt ignore les commentaires `#` (un `;` y coupe l'instruction, une apostrophe y
 * ouvre une chaîne) alors que son analyseur les lit : on n'admet qu'un `#` dont le texte est sans effet pour les deux.
 */
function endOfLineComment(sql: string, start: number): number {
  const after = sql.charAt(start + 2);
  if (sql.startsWith('--', start) && after !== '' && after !== ' ' && after !== '\t' && after !== '\n') {
    throw new NotReadOnly('« -- » collé au caractère suivant');
  }
  const newline = sql.indexOf('\n', start);
  const end = newline < 0 ? sql.length : newline;
  const comment = sql.slice(start, end);
  if (AMBIGUOUS_CHARS.test(comment)) throw new NotReadOnly('caractère de contrôle dans un commentaire');
  if (comment.startsWith('#') && /[;'"`]|--|\/\*/.test(comment)) throw new NotReadOnly('commentaire # ambigu (; guillemet ou commentaire dedans)');
  return end;
}

/** Fin d'un commentaire de bloc. Dolt exécute le contenu d'un commentaire de bloc qui s'ouvre par un point d'exclamation : refusé. */
function endOfBlockComment(sql: string, start: number): number {
  if (sql.charAt(start + 2) === '!') throw new NotReadOnly('commentaire exécutable /*! … */');
  const close = sql.indexOf('*/', start + 2);
  if (close < 0) throw new NotReadOnly('commentaire non terminé');
  if (AMBIGUOUS_CHARS.test(sql.slice(start, close))) throw new NotReadOnly('caractère de contrôle dans un commentaire');
  return close + 2;
}

/** Instructions séparées par des `;` ; les instructions vides (point-virgule final, commentaire seul) sont écartées. */
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
