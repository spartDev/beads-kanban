/**
 * La règle des lectures de l'état des tickets (bdesk-38k.36, ADR 0001), jugée sur le SQL que l'on envoie à Dolt : une table lue sans
 * `as of 'HEAD'` est lue dans le working set, que l'historique (`dolt_history_*`) ne voit pas, et le tableau se met à dire autre chose
 * que les métriques. Elle vaut pour toute lecture, pas pour celles d'un seul module : c'est aux tests qui voient tout le SQL d'un
 * service de s'en servir (`committed.integration.test.ts`), plus qu'à un lecteur de la tenir.
 */

/** Une table lue par une requête, et si la clause `as of 'HEAD'` la suit. */
export interface TableRead {
  table: string;
  atHead: boolean;
}

/** Remplace la clause avant que les chaînes ne soient vidées : `'HEAD'` en est une. Le même texte est écrit dans l'expression de `tableReads`. */
const AT_HEAD_MARK = '<<at-head>>';

/** Les tables qu'une requête lit, dans l'ordre : celles qui suivent `from` ou `join`, hors sous-requêtes et tables d'une requête (`with`). */
export function tableReads(sql: string): TableRead[] {
  const text = sql.replace(/\bas\s+of\s+'HEAD'/gi, AT_HEAD_MARK).replace(/'(?:[^'\\]|\\[\s\S]|'')*'/g, "''");
  const own = new Set<string>(); // les tables d'une requête commune : `with recursive lineage (…) as (…), autre as (…)`
  for (const [, name] of text.matchAll(/(?:\bwith\s+(?:recursive\s+)?|\)\s*,\s*)([A-Za-z_]\w*)\s*(?:\([^)]*\))?\s*as\s*\(/gi)) own.add((name ?? '').toLowerCase());
  const reads: TableRead[] = [];
  // Un nom qualifié (`base/commit`.table) garde sa table ; une sous-requête (`from (`) n'en est pas une.
  for (const [, name, mark] of text.matchAll(/\b(?:from|join)\s+(?:`[^`]*`\s*\.\s*)?`?([A-Za-z_][\w$]*)`?(\s*<<at-head>>)?/gi)) {
    const table = (name ?? '').toLowerCase();
    if (!own.has(table)) reads.push({ table, atHead: mark !== undefined });
  }
  return reads;
}

/**
 * Les tables qui n'ont pas à porter la clause : celles de Dolt (`dolt_log`, `dolt_history_issues`…, qui sont l'historique) et le
 * préfixe des tickets (`config`), qui identifie le Projet et ne décrit aucun ticket (ADR 0001). Toute autre table lue, `issues`,
 * `dependencies`, `labels`, `comments` ou une qu'on ajouterait, doit la porter : l'oubli est un échec, pas un silence.
 */
const NOT_TICKET_STATE = new Set(['config']);
const isTicketState = (table: string) => !table.startsWith('dolt_') && !NOT_TICKET_STATE.has(table);

/** Les lectures de tables de tickets qui ne portent pas la clause, une phrase chacune : vide quand la règle est tenue. */
export function readsOutsideHead(sqls: readonly string[]): string[] {
  return sqls.flatMap((sql) =>
    tableReads(sql)
      .filter(({ table, atHead }) => isTicketState(table) && !atHead)
      .map(({ table }) => `${table} lue sans « as of 'HEAD' » : ${sql.replace(/\s+/g, ' ').trim().slice(0, 140)}`),
  );
}

/**
 * Les tables que ces requêtes lisent hors de Dolt, `config` comprise : de quoi vérifier qu'une règle sur « tout ce qui est lu » a bien
 * vu tout ce qu'elle devait voir, et non rien.
 */
export function tablesRead(sqls: readonly string[]): Set<string> {
  return new Set(sqls.flatMap((sql) => tableReads(sql).map(({ table }) => table)).filter((table) => !table.startsWith('dolt_')));
}
