import { abortable } from '../abort';
import { createDoltClient, type DoltClient, type DoltClientOptions, type DoltDatabase, DoltQueryError, DoltTextError, type Lane, type QueryOptions, queryAll, type Row, sqlIdent, sqlString } from './client';
import { createTableProblems } from './create-table';

/**
 * Du SQL stocké dans une base, que Dolt exécute quand on la lit (bdesk-38k.69, 38k.74). Le garde de lecture seule (`read-only.ts`) ne voit que le texte de la requête ;
 * or Dolt exécute aussi ce que la base porte, ou lit une autre table que celle que la requête nomme :
 *
 * - une **vue** : `select … from issues` lit `issues` comme une vue si la base en a une de ce nom, et sa définition est du SQL quelconque, `load_file('<fichier>')`
 *   ou `dolt_query_diff('select … into outfile …', …)` compris, qui lit ou écrit un fichier. Lequel ? Quand `dolt sql` lit les fichiers de la base lui-même (un Projet embedded),
 *   un fichier du dossier de la base : c'est son `secure_file_priv`. Mais dès qu'un `dolt sql-server` répond (un Projet en mode server, ou un Projet embedded dont quelqu'un a
 *   lancé un serveur : le CLI s'y connecte de lui-même), `secure_file_priv` est vide, la configuration de bd ne le pose pas : n'importe quel fichier que l'utilisateur peut lire
 *   ou écrire (ADR 0005). La vérification ci-dessous est donc la seule défense dans ce mode. C'est la vue du
 *   **working set** que Dolt exécute, même pour `… as of 'HEAD'` ; une vue qui n'est que dans le commit n'est pas résolue (« table not found ») ;
 * - une **colonne générée** (`generated always as (load_file(…)) virtual`) : son expression est évaluée à chaque lecture, de la table comme de son historique
 *   (`dolt_history_*` l'évalue avec le schéma courant, ligne après ligne) ; une colonne générée stockée l'est à l'écriture, non à la lecture, mais n'a rien à faire
 *   dans une base de tickets, et la refuser est plus simple que de mesurer chaque version de Dolt ;
 * - une **ligne de `dolt_nonlocal_tables`** (Dolt 2.5.0, bdesk-38k.74) : cette table `(table_name, target_ref, ref_table, options)` fait résoudre un nom de table, motif
 *   `*`, `?` ou `%` compris, vers la table `ref_table` d'une autre référence (une branche, un tag, un commit), avant toute autre résolution, vues et tables système comprises.
 *   `dolt_history_issues`, que `history.ts` lit sans `as of`, ou `issues`, lue `as of 'HEAD'`, devient alors une table ordinaire dont une colonne est générée par
 *   `load_file(…)` : aucune assertion sur les noms lus ne le voit, `information_schema` ne parle que des tables physiques et la colonne est sur un nom que personne ne surveille.
 *   Un nom ne se lit donc pas pour savoir où il mène : `select * from dolt_nonlocal_tables` lui-même se laisse rediriger, par une ligne qui vise son propre nom. Ce que
 *   la table contient se lit sans la nommer (`storedViewsAssertion`) ;
 * - un **index fonctionnel** (`create index … on t ((expr))`, Dolt 2.5.0, bdesk-38k.74 round 3, B-FI) : une colonne générée virtuelle *cachée*, évaluée à chaque lecture de la
 *   table (`as of 'HEAD'` et `dolt_history_*` compris), que ni `information_schema.columns` ni `show full columns` ne listent. `information_schema.statistics.expression` la voit
 *   dans le working set (`FUNCTIONAL_INDEXES`, dans la première assertion : Dolt abandonne le groupe avant que la lecture ne parte) ; pour HEAD et pour l'ancre d'une époque, le
 *   `CREATE TABLE` de chaque table lue (`schemaCreateSql`, par `dolt_schema_diff`, jamais par `show create table` que le garde de lecture seule refuse) est confronté à une grammaire
 *   fermée (`create-table.ts`) : tout ce qu'elle ne reconnaît pas est refusé, y compris ce qu'aucune liste de motifs n'aurait prévu.
 *
 * Le contenu d'une base beads vient d'un remote partagé : un collaborateur peut commiter l'une ou l'autre. Mesuré sur dolt 2.5.0 : ni un
 * déclencheur (il ne part que d'une écriture), ni un événement (le planificateur de `dolt sql` ne les lance pas à la lecture), ni une procédure (elle ne part que
 * d'un `call`, que le garde refuse) ne s'exécute à la lecture ; ADR 0005 dit ce que les autres mécanismes de Dolt (`dolt_ignore`, `dolt_query_catalog`, les variables de
 * session, le contrôle des branches…) font ou ne font pas.
 *
 * Ce n'est pas « aucune vue » : bd crée lui-même `ready_issues` et `blocked_issues` dans toutes ses bases, que l'app ne lit jamais. Ce qui compte, ce sont les noms que
 * l'app lit (`reader.ts`, `history.ts`) : `STORED_SQL_NAMES`. Un test (`stored-sql.test.ts`) refait chaque lecture de l'app et vérifie que chaque table qu'elle nomme est
 * dans la liste.
 *
 * **Une règle pour les noms : jamais comparés en JavaScript.** Dolt lit un nom à sa façon, que JavaScript ne reproduit pas : `Issues` est `issues` ; une vue `issueſ`
 * (U+017F, le « s long ») est lue comme `issues` (Dolt replie la casse à l'unicode : `ſ` s'y comporte comme `s`), alors que `'ſ'.toLowerCase()` reste `ſ`. Toute comparaison
 * de nom se fait donc dans Dolt : sa collation (`information_schema`, `dolt_schemas.name`, insensibles à la casse : un balayage de 1 124 caractères dont Unicode fait des
 * lettres de ces noms n'a trouvé aucun nom que Dolt lise comme celui d'une table lue et que ces comparaisons laissent passer), ou sa résolution même (`show full columns from
 * <nom lu> as of 'HEAD'`, qui lit le nom comme la lecture le lira). Le seul nom comparé en JavaScript l'est à une liste fermée, par égalité exacte, et le refus est le cas par
 * défaut : une vue de la base de révision d'une ancre d'époque n'est admise que si c'est exactement `ready_issues` ou `blocked_issues`.
 */
export const STORED_SQL_TABLES = ['issues', 'dependencies', 'labels', 'comments', 'config'] as const;
/** Les tables système que l'app lit : une vue du même nom les masque (mesuré : `create view dolt_log …` est admis, et `select … from dolt_log` lit la vue). */
export const STORED_SQL_SYSTEM_TABLES = ['dolt_history_issues', 'dolt_history_dependencies', 'dolt_log', 'dolt_commit_ancestors'] as const;
export const STORED_SQL_NAMES = [...STORED_SQL_TABLES, ...STORED_SQL_SYSTEM_TABLES] as const;

const inList = (names: readonly string[]) => names.map(sqlString).join(', ');
const NAMES = inList(STORED_SQL_NAMES);
const TABLES = inList(STORED_SQL_TABLES);
/**
 * Les tables système que la vérification lit elle-même : une vue qui porte leur nom la ferait exécuter du SQL avant qu'elle n'ait rien dit (mesuré :
 * `create view dolt_status as select load_file(…)` est admis, et `select … from dolt_status` exécute la vue ; de même `dolt_schemas`, même `as of 'HEAD'` : c'est
 * le working set qui fournit les vues). `information_schema` ne s'y laisse pas prendre : une vue ou une table de la base qui porte le nom d'un de ses objets (`tables`, `columns`,
 * `views`, `information_schema`…) ne change ni ce qu'on y lit ni ce qu'on y exécute (mesuré), et il liste les vues sans les exécuter. Encore faut-il lire la bonne de ses tables :
 * voir `NOT_TABLES_WHERE`.
 */
const OWN_TABLES = ['dolt_schemas', 'dolt_status'] as const;
const VIEW_NAMES = inList([...STORED_SQL_NAMES, ...OWN_TABLES]);

// Les sources de danger, chacune écrite une fois : les assertions les comptent, le diagnostic les relit une à une pour dire ce qu'il y a.
/**
 * Les objets du working set qui portent un nom que l'app (ou la vérification) lit (voir `OWN_TABLES`) et ne sont pas des tables de base : des vues. Lus dans `information_schema.tables`,
 * non dans `information_schema.views` (bdesk-38k.74, B1 de la relecture) : `.views` ne liste que les vues que Dolt sait analyser contre le working set, et omet celle dont le corps nomme une
 * table que HEAD a et que le working set n'a plus. Or `… as of 'HEAD'`, la forme de toutes les lectures de l'app et celle de la seconde assertion (sur `dolt_schemas`), résout cette vue du
 * working set, l'analyse contre HEAD, où la table existe, et l'exécute. `.tables` les liste toutes (`VIEW`), sans les analyser ni les exécuter (mesuré sur 24 formes de vues,
 * cachées ou non, noms repliés compris, avec une charge qui écrit un fichier ou qui dort deux secondes, puis sur 52 bases hostiles où chaque instruction de la vérification est lancée
 * telle que le code l'envoie : aucun fichier créé, aucun `sleep` exécuté, dans les deux modes). `table_name` se compare sans tenir compte de la casse (mesuré). Un type nul
 * serait aussi refusé : tout ce qui n'est pas une table de base l'est.
 */
const NOT_TABLES_WHERE = `table_schema = database() and (table_type is null or table_type <> 'BASE TABLE') and table_name in (${VIEW_NAMES})`;
/** Une vue qui porte le nom d'une table que l'app lit, dans le dernier commit : Dolt ne la résout pas aujourd'hui (« table not found »), mais ce n'est pas à nous de le parier. */
const HEAD_VIEWS = `from dolt_schemas as of 'HEAD' where type = 'view' and name in (${NAMES})`;
/** Une colonne générée, virtuelle ou stockée, d'une table que l'app lit : dans le schéma du working set (`information_schema` ne se lit pas `as of`). */
const GENERATED_COLUMNS = `from information_schema.columns where table_schema = database() and table_name in (${TABLES}) and generation_expression <> ''`;
/**
 * Un **index fonctionnel** (`create index … on t ((expr))`, MySQL 8) sur une table que l'app lit, dans le schéma du working set (bdesk-38k.74, round 3, B-FI de la
 * relecture finale). Dolt le range comme une colonne générée virtuelle *cachée* : ni `information_schema.columns` (`GENERATED_COLUMNS`), ni `show full columns`
 * (que le diagnostic lit pour HEAD) ne la listent, mais Dolt évalue son expression à chaque lecture de la table, `as of 'HEAD'` et `dolt_history_*` compris
 * (mesuré : un index `((sleep(3)))` fait durer 3,3 s une lecture qui en durait 0,4, et `dolt_history_labels` 6,6 s pour deux lignes). `information_schema.statistics.expression`
 * la liste, sans l'évaluer (mesuré : aucun délai, même avec l'index non commité). Elle ne dit rien de HEAD (information_schema ne se lit pas `as of`) : c'est la grammaire
 * fermée (`create-table.ts`), lue dans `show create table … as of 'HEAD'`, qui ferme ce cas-là (voir plus bas, `schemaProblems`).
 */
const FUNCTIONAL_INDEXES = `from information_schema.statistics where table_schema = database() and table_name in (${TABLES}) and expression <> ''`;
// Les lignes de ces quatre dangers, de quoi les nommer : le diagnostic les lit à part, et le dernier essai d'une lecture les porte (`storedSqlEvidence`). Les mêmes `from … where …` que
// les assertions comptent, écrits une fois.
const VIEWS_FOUND = `select table_name as view_name from information_schema.tables where ${NOT_TABLES_WHERE}`;
const GENERATED_FOUND = `select table_name as tbl, column_name as col ${GENERATED_COLUMNS}`;
const FUNCTIONAL_INDEXES_FOUND = `select table_name as tbl, index_name as idx ${FUNCTIONAL_INDEXES}`;
const HEAD_VIEWS_FOUND = `select name ${HEAD_VIEWS}`;
/**
 * Le working set diffère de HEAD (n'importe quelle table, sans comparer de nom : `dolt_status` écrit `Issues` quand la table a été renommée ainsi, et `table_name in ('issues')`
 * n'y voit rien) : le schéma de HEAD, que les lectures `as of 'HEAD'` utilisent, n'est alors pas forcément celui du working set.
 */
const UNCOMMITTED = 'from dolt_status';

/**
 * La table système qui mène un nom de table vers une autre table (voir l'en-tête du fichier). Elle existe, vide, dans les bases que bd 1.x crée : sa migration 0040 y pose quatre lignes
 * (`wisps`, `wisp_*`, `repo_mtimes`, `local_metadata`, vers `main`), une par commit, et la 0041 les retire d'un `delete from` avant de toucher à `dependencies`. `dolt_nonlocal_tables` n'est
 * donc refusée que si elle porte des lignes, jamais parce qu'elle existe. Mesuré sur les copies de cinq Projets réels (109 à 677 commits) : présente et vide dans HEAD et dans le working set
 * de chacune, absente du premier commit (elle apparaît aux commits n° 42 à 293). Une base que bd est en train de migrer, ou dont la migration s'est arrêtée entre les deux, est refusée
 * jusqu'à la prochaine commande bd, qui l'achève.
 */
const NONLOCAL_TABLE = 'dolt_nonlocal_tables';

/**
 * Le nombre de tables `dolt_nonlocal_tables` non vides (0 ou 1) dans la racine `to` (`'WORKING'`, `'HEAD'` ou un commit), lu **sans résoudre aucun nom de table**, donc sans que la
 * table puisse s'en cacher : les fonctions de table `dolt_schema_diff` et `dolt_diff_summary` comparent deux racines physiquement (une ligne de `dolt_nonlocal_tables` ne peut pas les
 * mener ailleurs, et `dolt_ignore` n'agit pas sur `dolt_schema_diff`). `base` est un commit où la table n'existe pas : par rapport à lui, elle est « ajoutée » (`from_table_name` vide), et
 * `data_change` dit si elle porte des lignes. Une table qui n'est pas ajoutée par rapport à `base`, ou que `dolt_diff_summary` ne montre pas (`dolt_ignore` cache les tables ajoutées ou
 * supprimées de ce nom : mesuré), compte comme non vide. (`dolt_diff_stat` dirait les lignes ajoutées sans cette réserve, mais échoue quand la table n'existe pas, et Dolt le
 * découvre avant d'exécuter quoi que ce soit : il ne peut pas suivre un test d'existence.)
 */
function nonlocalCount(base: string, to: string): string {
  const [from, target, table] = [sqlString(base), sqlString(to), sqlString(NONLOCAL_TABLE)];
  // `to_table_name` se compare en `lower(...)` : la colonne est en collation binaire (mesuré, bdesk-38k.74 round 3, R1), alors que Dolt résout `dolt_nonlocal_tables`
  // lui-même sans tenir compte de la casse (`getNonlocalTableEntry` → `resolveUserTable` → `tableInsensitive`, lu dans sa source). Aucun moyen mesuré de faire exister
  // la table sous un autre nom que celui-ci en minuscules (`insert into DOLT_NONLOCAL_TABLES` la range sous le nom canonique ; `create`, `rename`, les imports CSV la
  // refusent, « reserved for internal use ») : une racine ainsi nommée suppose un Dolt modifié ou des chunks fabriqués, non démontré. Le `lower(...)` ne coûte rien
  // de plus et ferme l'écart si une version future en fabriquait une.
  return (
    `select count(*) as c from dolt_schema_diff(${from}, ${target}) s where lower(s.to_table_name) = ${table} and ` +
    `(s.from_table_name <> '' or not exists (select 1 from dolt_diff_summary(${from}, ${target}) d where lower(d.to_table_name) = ${table} and d.data_change = 0))`
  );
}

/** Le relevé de ce que compte `storedViewsAssertion` pour `dolt_nonlocal_tables` : une ligne, `working` et `head`. */
export const storedNonlocalFound = (base: string): string => `select w.c as working, h.c as head from (${nonlocalCount(base, 'WORKING')}) w, (${nonlocalCount(base, 'HEAD')}) h`;

/**
 * Le premier commit de la lignée de HEAD, que la fonction de table `dolt_log` rend sans résoudre aucun nom de table, et la sonde qui dit s'il porte `dolt_nonlocal_tables` :
 * `dolt_diff_stat` d'un commit contre lui-même ne rend aucune ligne s'il l'a, et échoue « table not found » sinon. Ce commit est la base de `nonlocalCount` et de `schemaCreateSql`.
 *
 * **Il doit être sans aucune table** (bdesk-38k.74, round 4) : `dolt_schema_diff` et `dolt_diff_summary` ne rendent que ce qui diffère entre leurs deux racines. Une table que le
 * commit de base porte déjà et que HEAD n'a pas changée n'y figure pas : son `CREATE TABLE` ne serait jamais jugé. Mesuré : `dolt commit --amend` sur le commit d'`init` d'une base y
 * met les tables et leurs index fonctionnels, et `dolt_schema_diff(<ce commit>, 'HEAD')` ne rend alors aucune ligne. `learnBase` vérifie donc que la révision du commit de base
 * (`<base>/<commit>`, `revisionTablesSql`) n'a ni table ni vue, et refuse la base sinon. Les bases de bd la satisfont (mesuré : le commit « Initialize data repository » de cinq copies de
 * Projets réels et d'une base neuve de bd). `show full tables as of '<commit>'`, plus simple, ne convient pas : il liste les vues du working set, `ready_issues` et `blocked_issues`
 * de bd, même pour un commit qui n'en a pas.
 */
export const STORED_ROOT_COMMIT = "select commit_hash from dolt_log('HEAD') order by commit_order asc limit 1";
export const storedNonlocalProbe = (commit: string): string => `select count(*) as c from dolt_diff_stat(${sqlString(commit)}, ${sqlString(commit)}, ${sqlString(NONLOCAL_TABLE)})`;

/**
 * Le `CREATE TABLE` de chacune des tables lues, dans la racine `to` (`'WORKING'` ou `'HEAD'`), lu par `dolt_schema_diff` (bdesk-38k.74, round 3, B-FI de la relecture finale) :
 * comme `nonlocalCount`, il ne résout aucun nom de table (la ligne vient d'une comparaison de deux racines par leurs noms physiques, pas d'une lecture de `issues` ou `labels` qui se
 * laisserait rediriger). Confronté à une grammaire fermée (`createTableProblems`, `create-table.ts`), il ferme ce qu'`information_schema` ne peut pas dire : une contrainte `check` ou
 * une clé étrangère d'une autre forme que celle que bd pose, un défaut entre parenthèses qui n'est pas `(json_object())`, et toute construction que la grammaire n'a pas prévue — en
 * plus d'une vue ou d'une colonne générée (déjà refusées par `storedViewsAssertion` et `storedSqlAssertion`, s'il y en a : cette lecture-ci ne les refuse qu'une seconde fois, après le fait,
 * sans la garantie d'un abandon par Dolt avant que la lecture ne parte — voir l'en-tête du fichier) et d'un index fonctionnel au repos dans HEAD seulement (`FUNCTIONAL_INDEXES` ne voit
 * que le working set). Elle ne dépend ni de `pinnedHead` ni d'un diagnostic : le texte est déjà la réponse, pas besoin de chercher pourquoi.
 */
export function schemaCreateSql(base: string, to: string): string {
  // `stmt`, pas `sql` : mesuré, `sql` est un mot réservé de Dolt comme alias nu (« syntax error »), admis seulement entre accents graves.
  // `lower(d.to_table_name)`, pas `d.to_table_name` : la colonne est en collation binaire, alors que Dolt résout un nom de table sans tenir compte de la casse. Mesuré (dolt 2.5.0, une base
  // sans `issues` mais avec une table `Issues`, `ISSUES` ou `İssues` portant un index fonctionnel) : `select … from issues` lit chacune d'elles, `information_schema.statistics` la
  // rend sous `table_name in ('issues')`, et `dolt_schema_diff` la nomme telle quelle : seule la comparaison en `lower(…)` la retrouve (`İ`, U+0130, y devient `i`, comme dans la
  // résolution des noms). `issueſ` (U+017F) n'est pas lue comme `issues` par Dolt : mesuré aussi, et `lower('issueſ')` reste `issueſ`, les deux sont d'accord.
  // **Une ligne par table attendue** (relecture finale, round 4, m2) : une jointure à gauche depuis les noms que la requête écrit elle-même (`expected`), dont `tbl` et `stmt` sont absents quand la
  // comparaison n'a aucune ligne pour la table. Une comparaison qui omettrait une table lue serait sinon acceptée sans rien dire : la solidité ne reposerait que sur le commit de base vide.
  return `select n.expected as expected, d.to_table_name as tbl, d.to_create_statement as stmt from ${EXPECTED_TABLES} left join dolt_schema_diff(${sqlString(base)}, ${sqlString(to)}) d on lower(d.to_table_name) = n.expected`;
}

/** Les cinq noms que `schemaCreateSql` attend, une ligne chacun (une table dérivée, `n`) : `select 'issues' as expected union all select 'dependencies' …`. */
const EXPECTED_TABLES = `(${STORED_SQL_TABLES.map((name, i) => `select ${sqlString(name)}${i === 0 ? ' as expected' : ''}`).join(' union all ')}) n`;

/** Ce que la raison dit d'une table que la comparaison ne rend pas, après son nom : « « labels » (dans HEAD) : … ». */
const NO_DEFINITION = 'aucune définition de table lue par la comparaison : la table manque, ou la comparaison est incomplète';

/**
 * À l'ancre d'une époque, l'app ne lit que l'historique des dépendances (`<base>/<commit>.dolt_history_dependencies`, `history.ts`) : seule `dependencies` doit avoir une ligne dans la
 * comparaison. Les autres, qu'une histoire ancienne peut ne pas avoir, sont jugées si la comparaison les rend, sans être exigées.
 */
const ERA_REQUIRED: readonly string[] = ['dependencies'];

/**
 * Les problèmes qu'une liste de `(expected, tbl, stmt)` rendue par `schemaCreateSql` révèle, `where` disant dans quelle racine (` (dans HEAD)`) comme pour `nonlocalProblem`. Dans l'ordre des
 * tables lues : chaque table qu'une ligne a `expected` pour nom (cette valeur est celle que la requête a écrite : égalité exacte avec la liste fermée des cinq noms, jamais un nom de la base) a
 * son `CREATE TABLE` jugé par la grammaire fermée, une fois par ligne (deux tables dont la casse diffère sont jugées toutes deux) ; une table **exigée** (`required`, les cinq par défaut) dont
 * aucune ligne n'a de texte est refusée, qu'une ligne la nomme sans texte ou qu'aucune ne l'ait (une sortie vide, tronquée) : c'est m2, la table sans définition lue n'est jamais admise faute de ligne.
 */
const schemaCreateProblems = (rows: readonly Row[], where = '', required: readonly string[] = STORED_SQL_TABLES): string[] =>
  STORED_SQL_TABLES.flatMap((name) => {
    const defined = rows.filter((row) => text(row.expected) === name && text(row.stmt) !== '');
    if (defined.length === 0) return required.includes(name) ? [`${named(name)}${where} : ${NO_DEFINITION}`] : [];
    return defined.flatMap((row) => createTableProblems(text(row.stmt), `${named(text(row.tbl))}${where}`));
  });

/**
 * Les deux instructions qui précèdent chaque lecture, dans le même processus et la même transaction : l'une ou l'autre échoue (« the subquery returned more than 1 row »)
 * s'il y a du SQL stocké, et `dolt sql` s'arrête alors à la première erreur, avant que la lecture ne parte. Une sous-requête scalaire qui rend plusieurs lignes est l'erreur
 * dont on dispose : `dolt sql` n'a ni `signal` ni `assert`. Aucun délai ne sépare donc la vérification de la lecture (un commit qui arrive entre les deux, ce que ferait une
 * vérification dans un processus à part) : la base est vérifiée dans l'état exact où elle est lue.
 *
 * Chaque balayage est compté dans une table dérivée du `from`, et la sous-requête scalaire, qui ne lit que ce compte, rend une seconde ligne s'il n'est pas nul : le même
 * balayage dans la sous-requête coûte le double (mesuré : `information_schema.columns` passe de 8 à 15 ms de CPU).
 *
 * 1. `storedViewsAssertion` : un objet du working set qui porte un nom lu, ou un nom que la deuxième instruction lit, et n'est pas une table de base (`NOT_TABLES_WHERE`) ; un index
 *    fonctionnel sur une table lue, dans le working set (`FUNCTIONAL_INDEXES`, bdesk-38k.74 round 3, B-FI) ; ou une table `dolt_nonlocal_tables` qui n'est pas vide, dans le working set
 *    comme dans HEAD (`nonlocalCount`). Elle ne lit que `information_schema.tables` et `.statistics`, où Dolt liste toute vue et tout index fonctionnel, y compris
 *    celle qu'il ne sait pas analyser dans le working set et qu'`information_schema.views` omet, et des fonctions de table qui comparent deux racines sans résoudre aucun nom de table.
 *    C'est ce qui la fait passer en premier : les tables système de la deuxième pourraient être des vues, que `… as of 'HEAD'` exécute, ou des noms que `dolt_nonlocal_tables` mène ailleurs.
 *    Sans commit de base (`base`, que le diagnostic retient pour chaque base), elle échoue toujours : on ne sait pas encore ce que cette table porte.
 * 2. `storedSqlAssertion` : une vue de HEAD qui porte un nom lu ; une colonne générée dans le schéma du working set ; un working set modifié sans commit (une table
 *    quelconque) alors que HEAD n'est pas celui dont le schéma a été vérifié (`pinnedHead`) : le schéma de HEAD est celui que lisent les lectures `as of 'HEAD'`, et
 *    `information_schema` ne dit que celui du working set. Un working set propre (le cas de bd en auto-commit, le défaut) n'y passe jamais : il n'y a ni diagnostic ni
 *    état à retenir.
 *
 * Un index fonctionnel sur une table lue, à HEAD seulement (le working set n'en a pas, ou pas le même), échappe à ces deux assertions comme `information_schema` échappe toujours à HEAD :
 * c'est la grammaire fermée (`schemaProblems`, plus bas) qui le ferme, à chaque lecture, sans la garantie d'un abandon par Dolt avant que la lecture ne parte (voir son en-tête).
 *
 * Elles passent le garde de lecture seule (aucune fonction hors de la liste blanche, aucun caractère interdit) : le client les lui soumet comme toute lecture.
 */
export function storedViewsAssertion(base?: string): string {
  const views = `(select count(*) as c from information_schema.tables where ${NOT_TABLES_WHERE}) t`;
  const indexes = `(select count(*) as c ${FUNCTIONAL_INDEXES}) x`;
  if (base === undefined) return `select (select 1 union all select 1 from dual where t.c + x.c + 1 > 0) as stored_views from ${views}, ${indexes}`;
  return `select (select 1 union all select 1 from dual where t.c + x.c + w.c + h.c > 0) as stored_views from ${views}, ${indexes}, (${nonlocalCount(base, 'WORKING')}) w, (${nonlocalCount(base, 'HEAD')}) h`;
}

export function storedSqlAssertion(pinnedHead = ''): string {
  return (
    'select (select 1 union all select 1 from dual where a.c + b.c + d.c > 0) as stored_sql from ' +
    `(select count(*) as c ${HEAD_VIEWS}) a, (select count(*) as c ${GENERATED_COLUMNS}) b, ` +
    `(select count(*) as c ${UNCOMMITTED} where hashof('HEAD') <> ${sqlString(pinnedHead)}) d`
  );
}

/**
 * Les deux instructions de `schemaCreateSql` (working set, HEAD), à la fin du groupe : sans base (le tout premier essai d'une base, avant que `learnOnce` n'ait fini), aucune —
 * la première assertion échoue alors toujours, et le groupe n'atteint jamais sa fin.
 */
const schemaProbe = (base?: string): string[] => (base === undefined ? [] : [schemaCreateSql(base, 'WORKING'), schemaCreateSql(base, 'HEAD')]);

/** Ce qui précède chaque lecture, dans l'ordre : les deux assertions, puis le `CREATE TABLE` de chaque table lue (B-FI). */
export const storedSqlPrelude = (pinnedHead = '', base?: string): string[] => [storedViewsAssertion(base), storedSqlAssertion(pinnedHead), ...schemaProbe(base)];

/**
 * Ce qui précède le dernier essai d'une lecture (bdesk-38k.74) : les deux assertions, avec devant elles les relevés de ce qu'elles comptent, puis le `CREATE TABLE` de chaque table lue
 * (B-FI, comme `storedSqlPrelude`). Quand une assertion échoue, Dolt s'arrête (le client garde alors les lignes des instructions d'avant : `DoltQueryError.completed`) : les relevés
 * disent ce qu'elle a vu, dans le même processus et la même transaction. Le diagnostic, lui, relit la base dans un autre processus, où une vue qui va et vient n'est plus : sans cela, une
 * lecture dont la vue est là à chaque essai et partie à chaque diagnostic finissait sur « La base change plus vite… » au lieu de la nommer. Ils coûtent un deuxième balayage de
 * `information_schema` : le dernier essai seul les paie, jamais la lecture ordinaire.
 *
 * 1. `VIEWS_FOUND`, `GENERATED_FOUND` et `FUNCTIONAL_INDEXES_FOUND` : `information_schema` seule (que la base n'a pas de quoi masquer, et `.tables` liste toute vue : voir
 *    `NOT_TABLES_WHERE`), comme la première assertion, donc devant elle ;
 * 2. `storedViewsAssertion` : s'arrête ici s'il y a une vue du working set, un index fonctionnel, ou une table `dolt_nonlocal_tables` non vide, que le relevé d'après (qui lit `dolt_schemas`) ne doit pas suivre ;
 * 3. `HEAD_VIEWS_FOUND` : les vues de HEAD, après l'assertion des vues pour la même raison ;
 * 4. `storedSqlAssertion` : la seconde assertion, avec le HEAD retenu ;
 * 5. `schemaProbe` : le `CREATE TABLE` de chaque table, working set puis HEAD.
 */
export const storedSqlEvidence = (pinnedHead = '', base?: string): string[] => [
  VIEWS_FOUND,
  GENERATED_FOUND,
  FUNCTIONAL_INDEXES_FOUND,
  storedViewsAssertion(base),
  HEAD_VIEWS_FOUND,
  storedSqlAssertion(pinnedHead),
  ...schemaProbe(base),
];

/** L'erreur que Dolt rend quand l'assertion trouve du SQL stocké. */
const ASSERTION_FAILED = /subquery returned more than 1 row/i;

/** Ce que Dolt répond à `show full columns from <table> as of 'HEAD'` quand HEAD n'a pas la table. */
const TABLE_NOT_FOUND = /table not found/i;

/** Un hash de commit de Dolt : trente-deux caractères en base 32 (`0-9a-v`). */
const COMMIT_HASH = /^[0-9a-v]{32}$/;

/** Le résultat d'un groupe du diagnostic, ou rien si son assertion des vues l'a arrêté (une vue est arrivée depuis le premier temps) ; toute autre erreur passe. */
async function changed(read: () => Promise<Row[][]>): Promise<Row[][] | undefined> {
  try {
    return await read();
  } catch (err) {
    if (err instanceof DoltQueryError && ASSERTION_FAILED.test(err.message)) return undefined;
    throw err;
  }
}

/**
 * Nombre de fois qu'une lecture est tentée quand l'assertion échoue sans que le diagnostic trouve rien (HEAD a changé, une vue est partie entre-temps) : au-delà, la base change plus
 * vite que la vérification. Le dernier essai porte ses propres relevés (`storedSqlEvidence`) : il nomme ce que son assertion a vu, quoi que le diagnostic ait trouvé.
 */
const MAX_ATTEMPTS = 3;

/**
 * Combien d'objets la raison d'un refus nomme au plus : une base en porte autant qu'on veut (des centaines de colonnes générées, des centaines de vues dans une ancre d'époque), et
 * la raison part telle quelle dans la réponse 503. Les suivants sont comptés (« et K autres »). Avec les noms bornés (`named`), la raison ne dépasse jamais quelques milliers de caractères.
 */
export const MAX_NAMED_OBJECTS = 5;

/** Les objets d'un refus, `MAX_NAMED_OBJECTS` au plus, et combien d'autres. */
function listed(objects: readonly string[]): string {
  const shown = objects.slice(0, MAX_NAMED_OBJECTS).join(' ; ');
  const others = objects.length - MAX_NAMED_OBJECTS;
  return others > 0 ? `${shown} ; et ${others} autre${others > 1 ? 's' : ''}` : shown;
}

/** Du SQL stocké dans la base : elle n'est pas lue. Un Projet illisible, dont `reason` (ce message) dit pourquoi : les premiers objets, puis combien d'autres (`MAX_NAMED_OBJECTS`) ; `objects` les a tous. */
export class StoredSqlError extends DoltQueryError {
  constructor(
    readonly objects: readonly string[],
    dir = '',
  ) {
    super(`SQL stocké dans la base, que Dolt exécuterait à la lecture : ${listed(objects)}. La base n'est pas lue.`, dir);
    this.name = 'StoredSqlError';
  }
}

/** Longueur maximale d'un nom tiré de la base dans un message, en points de code. */
const MAX_NAME_LENGTH = 64;

/** Les `count` premiers points de code de `text` : une paire de substitution (un caractère hors du plan de base, comme un émoji, sur deux unités UTF-16) n'est jamais coupée en deux. */
function firstCodePoints(text: string, count: number): string {
  let end = 0;
  let taken = 0;
  for (const codePoint of text) {
    if (taken++ === count) break;
    end += codePoint.length;
  }
  return text.slice(0, end);
}

/**
 * Un nom tiré de la base, mis dans un message : les caractères de contrôle ne passent pas (`\p{C}` : contrôle, format, moitié de paire de substitution restée seule ; `\p{Zl}` et `\p{Zp}` : les
 * séparateurs de ligne et de paragraphe d'Unicode, U+2028 et U+2029, que `\p{C}` ne range pas et qui casseraient une ligne de journal ou de raison), et la longueur est bornée à `MAX_NAME_LENGTH`
 * points de code, non à autant d'unités UTF-16 (`slice` coupait une paire en deux). Un point de code, non un graphème : la borne tient sans condition (un graphème peut porter autant de
 * marques combinantes qu'on veut), et couper un graphème en deux n'a pas de conséquence.
 */
export const named = (name: string) => `« ${firstCodePoints(name, MAX_NAME_LENGTH).replace(/[\p{C}\p{Zl}\p{Zp}]/gu, '?')} »`;

const text = (value: unknown): string => (typeof value === 'string' ? value : '');

const viewProblem = (name: string) => `${named(name)} est une vue, que l'app pourrait lire à la place d'une table`;
const columnProblem = (table: string, column: string) => `colonne générée ${named(column)} de ${named(table)}`;
/** Un index fonctionnel (bdesk-38k.74, round 3, B-FI) : une colonne générée cachée, que ni `information_schema.columns` ni `show full columns` ne listent. */
const indexProblem = (table: string, index: string) => `index fonctionnel ${named(index)} de ${named(table)}`;
/**
 * La table qui mène des noms ailleurs porte des lignes : `where` dit dans quelle racine (` (époque du commit abc12345)` pour l'ancre d'une époque ; vide pour le working set et HEAD, dont
 * `nonlocalFound` ne dit qu'une raison), et rien de ce qu'elle porte n'est cité. bdesk-38k.74, round 3, R3 (relecture finale) : la raison disait deux fois « n'est pas vide », une pour le
 * working set et une pour HEAD, avec une explication technique (« Dolt y lit des noms de tables menés vers d'autres tables ») qui alarme pour ce qui est le plus souvent une migration de bd
 * en cours (§ `NONLOCAL_TABLE`). Dite une fois, sans jargon, avec quoi faire : réessayer, ou laisser une commande bd l'achever.
 */
const nonlocalProblem = (where = ''): string =>
  `${named(NONLOCAL_TABLE)} n'est pas vide${where} : bd semble être en train de migrer cette base ; réessayez dans un instant, ou lancez n'importe quelle commande bd, qui achèvera la migration`;

// Ce que disent les lignes des relevés (`VIEWS_FOUND`, `GENERATED_FOUND`, `FUNCTIONAL_INDEXES_FOUND`, `HEAD_VIEWS_FOUND`), que le diagnostic et le dernier essai d'une lecture lisent de même.
const viewsFound = (rows: readonly Row[]): string[] => [...new Set(rows.map((row) => viewProblem(text(row.view_name))))];
const generatedFound = (rows: readonly Row[]): string[] => rows.map((row) => columnProblem(text(row.tbl), text(row.col)));
const functionalIndexesFound = (rows: readonly Row[]): string[] => rows.map((row) => indexProblem(text(row.tbl), text(row.idx)));
const headViewsFound = (rows: readonly Row[]): string[] => [...new Set(rows.map((row) => `${viewProblem(text(row.name))} (dans HEAD)`))];
/** `storedNonlocalFound` : une ligne, les comptes du working set et de HEAD (un nombre, ou une chaîne derrière un serveur : tout ce qui n'est pas « 0 » compte). */
// R3 : une seule raison, que la table soit non vide dans le working set, dans HEAD, ou les deux — jamais deux fois la même phrase.
const nonlocalFound = (rows: readonly Row[]): string[] => {
  const [row] = rows;
  const counted = (value: unknown): boolean => String(value ?? '0') !== '0';
  return counted(row?.working) || counted(row?.head) ? [nonlocalProblem()] : [];
};

/**
 * Pourquoi le dernier essai d'une lecture a échoué (bdesk-38k.74). Il n'est pas suivi d'un diagnostic, qui relirait la base dans un autre processus : il porte ses relevés
 * (`storedSqlEvidence`), et c'est ce que son assertion a vu, dans la même transaction, qui nomme l'objet (`err.completed` : les lignes des instructions d'avant celle qui a échoué,
 * dans l'ordre des relevés ; l'assertion des vues arrête le groupe avant celui de HEAD). Si rien n'est nommé (le working set est modifié et HEAD a changé entre deux essais, ou la sortie
 * de Dolt ne s'est pas lue), la base change plus vite que la vérification.
 */
function exhausted(err: DoltQueryError, dir: string): DoltQueryError {
  const [views = [], generated = [], functionalIndexes = [], , headViews = []] = err.completed ?? [];
  const seen = [...viewsFound(views), ...generatedFound(generated), ...functionalIndexesFound(functionalIndexes), ...headViewsFound(headViews)];
  if (seen.length > 0) return new StoredSqlError(seen, dir);
  return new DoltQueryError(`La base change plus vite que la vérification du SQL qu'elle porte (${MAX_ATTEMPTS} essais) : réessayez dans un instant.`, dir);
}

/** `Extra` d'une colonne (`show columns`) : générée par une expression, virtuelle ou stockée (`DEFAULT_GENERATED` est un défaut ordinaire, que bd utilise). */
const isGenerated = (extra: unknown): boolean => /^(virtual|stored) generated/i.test(text(extra));

/**
 * Les seules vues qu'une base de révision (l'ancre d'une époque du schéma) peut porter : celles de bd, que l'app ne lit jamais. Relevé : sur les 1 633 commits des cinq copies
 * de bases réelles, ce sont les deux seules vues qu'un commit ait jamais portées.
 */
const BD_VIEWS: readonly string[] = ['ready_issues', 'blocked_issues'];

/** Le nom d'une ligne de `show full tables` : la valeur de la colonne qui n'est pas `Table_type` (son nom, `Tables_in_<base>`, change avec la base). */
const tableName = (row: Row): string => text(Object.entries(row).find(([column]) => column !== 'Table_type')?.[1]);

/**
 * Ce que porte une source d'historique que l'app lit, de ses colonnes (`show columns from <source>`) et, pour la base de révision d'une ancre d'époque, des tables et
 * vues de cette base (`revisionTablesSql`). `label` dit de quelle source il s'agit (« historique des dépendances », « époque du commit abc12345 »). L'ancre est un commit :
 * ni l'un ni l'autre ne peut changer entre ces lectures et celle de la source.
 *
 * Aucun nom n'y est comparé à ceux que l'app lit : Dolt lit `dolt_history_dependencieſ` comme `dolt_history_dependencies` (voir l'en-tête du fichier), et un nom qu'on ne sait
 * pas reconnaître est un nom qu'on ne sait pas refuser. Toute vue de la base de révision est refusée, sauf les deux de bd, admises par égalité exacte avec leur nom.
 */
export function storedSqlInSource(columns: readonly Row[], tables: readonly Row[] = [], label = 'historique des dépendances'): string[] {
  return [
    ...tables
      .filter((row) => text(row.Table_type) !== 'BASE TABLE' && !BD_VIEWS.includes(tableName(row)))
      .map((row) => `${viewProblem(tableName(row))} (${label})`),
    ...columns.filter((row) => isGenerated(row.Extra)).map((row) => `colonne générée ${named(text(row.Field))} de l'historique des dépendances (${label})`),
  ];
}

/**
 * Les tables et vues de la base de révision `revision` (déjà citée comme identifiant : `sqlIdent`) : `show full tables` les liste sans exécuter aucune vue. Lire
 * `<révision>.dolt_schemas` serait une erreur : une vue de ce nom, dans le commit d'ancre, masquerait la table système et s'exécuterait (mesuré).
 */
export const revisionTablesSql = (revision: string): string => `show full tables from ${revision}`;

/**
 * Une lecture qui ne nomme aucune table (`select hashof('HEAD')`, `select database()`) n'exécute aucun SQL stocké : le HEAD, que le sondage du direct lit toutes les
 * quelques secondes pour chaque Projet, n'a pas à porter l'assertion. Sans `from`, un `select` ne lit aucune table (`join` et les sous-requêtes en ont un) ; un mot
 * `from` dans une chaîne la fait seulement vérifier.
 */
export const readsNoTable = (sql: string): boolean => /^\s*select\b/i.test(sql) && !/\bfrom\b/i.test(sql);

/**
 * Dolt a refusé une instruction (« error on line N for query […] : cause ») : ni le client (délai, binaire absent, sortie illisible), ni un verrou, dont le texte n'est pas celui de Dolt. Seul le texte
 * d'une instruction refusée peut citer ce que la base lui a fait lire : `json_extract(load_file(f), '$')` rend « Invalid JSON text … "<contenu>" », `uuid_to_bin` « unable to parse '<contenu>' to
 * UUID », `st_srid` le contenu en octets (mesuré sur trente fonctions) ; et **sans aucune citation** : `from_base64` rend « illegal base64 data at input byte 4407630 », où le nombre
 * est un octet du fichier (bdesk-38k.74, round 3, B-FI). Aucune coupe par citation ne retient ce dernier : ce texte-là n'est donc jamais repris (voir `readFailure`).
 */
const REFUSED_BY_DOLT = /error on line \d+ for query/;

/** Ce que la raison dit quand une instruction de la vérification échoue autrement que par son assertion : le texte de Dolt n'y est pas. */
const CHECK_REFUSED =
  "La vérification du SQL stocké n'a pas pu s'achever : Dolt a refusé l'une de ses propres requêtes, dont le message n'est pas repris (il pourrait citer ce que la base lui fait lire). La base n'est pas lue.";

/** Les noms (identifiants d'au moins trois caractères) que les instructions envoyées écrivent elles-mêmes. */
function ownNames(sent: readonly string[]): ReadonlySet<string> {
  const names = new Set<string>();
  for (const sql of sent) for (const [word] of sql.matchAll(/[A-Za-z_][A-Za-z0-9_$]*/g)) if (word.length >= 3) names.add(word);
  return names;
}

/** Une citation vide, ou un nom (éventuellement qualifié, `base.table`) dont chaque partie est écrite par les instructions envoyées. */
const isOwnName = (quoted: string, own: ReadonlySet<string>): boolean =>
  quoted === '' || (/^[A-Za-z_][A-Za-z0-9_$]*(\.[A-Za-z_][A-Za-z0-9_$]*)*$/.test(quoted) && quoted.split('.').every((part) => own.has(part)));

/**
 * Ce que dit la raison quand Dolt refuse une instruction de la **lecture** de l'app (bdesk-38k.74, round 3, relecture finale : « ne jamais rendre le texte d'une erreur de Dolt »).
 * Avant ce round, ce texte était repris jusqu'à la première citation qui n'est pas un nom écrit par la requête : une liste noire de ce qui peut s'y cacher, que `from_base64` a
 * traversée (« illegal base64 data at input byte 4407630 » ne porte aucune citation à couper, et le nombre est un octet d'un fichier). Une liste blanche, à la place : deux classes
 * de causes que l'app sait dire sans rien reprendre de la base, chacune par un nom que **la requête elle-même écrit** (`isOwnName` : `issues`, `title`, jamais un contenu), et un
 * message fixe pour tout le reste. Le texte de Dolt n'est ni rendu ni consigné.
 *
 * - `table not found: <nom>` : la table que l'app lit manque (un Projet qui n'est pas une base bd, un schéma d'avant) ;
 * - `column "<nom>" could not be found in any table in scope` : la colonne manque de même ;
 * - toute autre cause : `READ_REFUSED`.
 */
const READ_REFUSED = "Dolt a refusé une lecture de l'app : le texte de son erreur n'est pas repris (il pourrait citer ce que la base lui fait lire).";
const MISSING_TABLE = /: table not found: (\S+)\s*$/;
const MISSING_COLUMN = /: column "([^"]+)" could not be found in any table in scope\s*$/;

function readFailure(err: DoltQueryError, sent: readonly string[]): DoltQueryError {
  const own = ownNames(sent);
  const table = MISSING_TABLE.exec(err.message)?.[1];
  if (table !== undefined && isOwnName(table, own)) return new DoltQueryError(`Dolt ne trouve pas la table ${named(table)} que l'app lit.`, err.dir, err.locked);
  const column = MISSING_COLUMN.exec(err.message)?.[1];
  if (column !== undefined && isOwnName(column, own)) return new DoltQueryError(`Dolt ne trouve pas la colonne ${named(column)} que l'app lit.`, err.dir, err.locked);
  return new DoltQueryError(READ_REFUSED, err.dir, err.locked);
}

/**
 * L'erreur d'un groupe de lectures, sans ce que la base a pu y faire citer. Une instruction de la vérification (les `checkLength` premières du groupe ; `completed` dit combien ont abouti avant celle
 * qui a échoué) n'a aucune raison d'échouer autrement que par son assertion : si Dolt la refuse, c'est que du SQL stocké s'y est exécuté, et son texte n'est pas repris (`CHECK_REFUSED`). Celui d'une
 * instruction de la lecture ne l'est pas davantage : `readFailure` le remplace par un message fixe par classe de cause (bdesk-38k.74, round 3 : il était repris jusqu'à la première citation, ce
 * que `from_base64` contourne). Sans `completed`, on ne sait pas laquelle a échoué : le message fixe de la lecture, qui ne dit rien de plus. Seules les erreurs qui ne sont pas du texte de Dolt
 * (délai, binaire absent, code de sortie sans message : `REFUSED_BY_DOLT` ne les reconnaît pas) passent telles quelles ; un texte de Dolt qui n'a pas cette forme (`DoltTextError`) est remplacé
 * à la sortie du client (`withoutDoltText`, m4).
 *
 * **Aucune instruction n'est envoyée à une autre base** (bdesk-38k.74, relecture finale, round 4) : la raison est le message fixe, rien de plus. Une recherche de la base voisine responsable
 * (R5 du round 3) lançait `` select count(*) from `<voisine>`.dolt_nonlocal_tables `` par le client brut, sans la vérification : une voisine qui définit une vue de ce nom en faisait exécuter le
 * corps (`dolt_query_diff('select … into outfile …')` écrit un fichier hors de toute base ; `stored-sql.neighbour.integration.test.ts`). Elle est supprimée, non réparée : elle n'améliorait qu'un message.
 */
function guarded(err: DoltQueryError, sent: readonly string[], checkLength: number): DoltQueryError {
  if (!REFUSED_BY_DOLT.test(err.message)) return err;
  const failed = err.completed?.length;
  if (failed !== undefined && failed < checkLength) return new DoltQueryError(CHECK_REFUSED, err.dir);
  return readFailure(err, sent);
}

/**
 * Ce que le client vérifié dit d'un texte de Dolt (`DoltTextError` : sa sortie d'erreur, ou le fragment de sa sortie qu'on n'a pas su lire), jamais ce texte (bdesk-38k.74, relecture finale,
 * round 4, m4). `guarded` ne remplaçait que celui qui a la forme « error on line N for query » ; un verrou, une permission refusée, un plantage, ou `illegal base64 data at input byte N` quand la
 * requête n'est pas citée, passaient tels quels dans la raison d'un Projet illisible. Un message fixe par classe de cause ; une classe de plus n'a rien à gagner à citer ce que Dolt écrit.
 */
const DOLT_LOCKED = 'La base est tenue par un autre processus dolt : réessayez dans un instant.';
const DOLT_PERMISSION = 'Dolt ne peut pas ouvrir les fichiers de la base : permission refusée.';
const DOLT_UNREADABLE = 'La sortie de dolt est illisible.';
const DOLT_FAILED = "Dolt n'a pas pu lire la base : le texte de son erreur n'est pas repris (il pourrait citer ce que la base lui fait lire).";

/**
 * L'erreur qui sort du client vérifié : celle du client elle-même, sauf un texte de Dolt, remplacé par le message fixe de sa classe (le verrou garde son drapeau `locked`). Le texte n'est ni
 * rendu ni consigné (aucune `cause`). Les classes ne servent qu'à choisir parmi des messages fixes : se tromper de classe ne cite rien.
 */
function withoutDoltText(err: unknown): unknown {
  if (!(err instanceof DoltTextError)) return err;
  let message = DOLT_FAILED;
  if (err.kind === 'output') message = DOLT_UNREADABLE;
  else if (err.locked) message = DOLT_LOCKED;
  else if (/permission denied/i.test(err.message)) message = DOLT_PERMISSION;
  return new DoltQueryError(message, err.dir, err.locked);
}

/**
 * Le client qui vérifie chaque lecture (voir `storedViewsAssertion`). Les deux assertions sont les premières instructions du groupe de lectures, dont elles ne rendent pas les lignes.
 * Quand l'une échoue, un diagnostic dit quoi (`StoredSqlError`, la base n'est pas lue) ; quand il ne trouve rien, c'est que le working set est modifié sans commit,
 * et le diagnostic vérifie alors le schéma de HEAD (`show full columns … as of 'HEAD'` et le `CREATE TABLE` de chaque table lue, dans le même processus que `hashof('HEAD')`) et retient ce HEAD : les lectures
 * suivantes le font valoir dans leur assertion, qui échoue de nouveau dès que HEAD change. Le dernier de trois essais, lui, porte devant ses assertions les relevés de ce
 * qu'elles comptent (`storedSqlEvidence`) et nomme ce que son assertion a vu, sans diagnostic : une vue qui va et vient n'échappe pas à son nom.
 */
export function withStoredSqlCheck(client: DoltClient): DoltClient {
  /** Par base : le HEAD dont le schéma a été vérifié, pour un working set modifié sans commit. */
  const pinned = new Map<string, string>();
  /** Par base : le commit, sans `dolt_nonlocal_tables`, par rapport auquel `nonlocalCount` compte ce que la table porte (voir `learnBase`). */
  const bases = new Map<string, string>();
  /** Les diagnostics en cours, un par base : les lectures qui échouent ensemble n'en font qu'un. */
  const diagnosing = new Map<string, Promise<void>>();
  /** Les recherches du commit de base en cours, une par base. */
  const learning = new Map<string, Promise<string>>();

  /**
   * Le commit de base d'une base (`STORED_ROOT_COMMIT`), vérifié : il n'a pas `dolt_nonlocal_tables` (la sonde échoue « table not found »), et n'a ni table ni vue (la liste de sa
   * révision est vide). Un premier commit qui porte déjà `dolt_nonlocal_tables` ne laisse aucun moyen de dire si elle est vide ; un premier commit qui porte déjà des tables, aucun moyen de
   * juger leur `CREATE TABLE` : la base est refusée dans les deux cas. Rien ici ne résout un nom de table qu'une redirection pourrait mener ailleurs : `dolt_log` et `dolt_diff_stat` sont des
   * fonctions de table, que la base ne peut pas rediriger, et la liste de la révision d'un commit qui n'a pas `dolt_nonlocal_tables` (la sonde, avant elle) n'a pas de redirection à suivre. Ces trois
   * groupes sont les seuls que la vérification envoie à une racine qu'elle n'a pas encore vérifiée, et tous visent la base qu'elle vérifie (la révision `<base>/<commit>` en est une de la même base) :
   * mesuré, la liste ne s'exécute aucune vue, même sur un premier commit qui ne porte que des vues nommées `dolt_schemas`, `dolt_nonlocal_tables`, `issues`… dont le corps écrit un fichier
   * (`stored-sql.root.integration.test.ts`, « hostile »). Aucun ne nomme une autre base (`stored-sql.audit.test.ts`).
   */
  async function learnBase(db: DoltDatabase, lane: Lane | undefined): Promise<string> {
    const options: QueryOptions = lane ? { lane } : {};
    try {
      // Avec le nom de la base, que la révision du commit de base (`<base>/<commit>`) demande plus bas.
      const [roots = [], names = []] = await queryAll(db, [STORED_ROOT_COMMIT, 'select database() as name'], options);
      const root = text(roots[0]?.commit_hash);
      if (!root) throw new DoltQueryError(`Aucun commit dans ${db.dir} : ce que ${NONLOCAL_TABLE} porte ne peut pas se vérifier.`, db.dir);
      const present = await queryAll(db, [storedNonlocalProbe(root)], options).then(
        () => true,
        (err: unknown) => {
          if (err instanceof DoltQueryError && TABLE_NOT_FOUND.test(err.message)) return false;
          throw err;
        },
      );
      if (present) throw new StoredSqlError([`${named(NONLOCAL_TABLE)} existe déjà dans le premier commit : sans commit où elle manque, on ne peut pas dire qu'elle est vide`], db.dir);
      // Round 4 : un commit de base qui a déjà des tables ne dit rien de celles que HEAD n'a pas changées depuis (voir `STORED_ROOT_COMMIT`) : le `CREATE TABLE` de celles-là ne serait jamais jugé.
      const [inBase = []] = await queryAll(db, [revisionTablesSql(sqlIdent(`${text(names[0]?.name)}/${root}`))], options);
      if (inBase.length > 0) throw new StoredSqlError(inBase.map((row) => `${named(tableName(row))} existe déjà dans le premier commit : sans commit où elle manque, on ne peut pas juger son CREATE TABLE`), db.dir);
      bases.set(db.dir, root);
      return root;
    } catch (err) {
      // Une instruction de la vérification que Dolt refuse : son texte n'est pas repris (voir `guarded`).
      if (err instanceof DoltQueryError && !(err instanceof StoredSqlError) && REFUSED_BY_DOLT.test(err.message)) throw new DoltQueryError(CHECK_REFUSED, err.dir);
      throw err;
    }
  }

  function learnOnce(db: DoltDatabase, lane: Lane | undefined): Promise<string> {
    let flight = learning.get(db.dir);
    if (!flight) {
      flight = learnBase(db, lane).finally(() => learning.delete(db.dir));
      learning.set(db.dir, flight);
    }
    return flight;
  }

  /**
   * Les colonnes que HEAD donne aux tables lues, leur `CREATE TABLE` (`schemaCreateSql`), et le hash de HEAD, le tout lu dans le même processus. Chaque table est lue **par son
   * nom**, que Dolt résout comme la lecture le fera (`Issues` pour `issues`) : aucun nom n'est comparé ici. Une table que HEAD n'a pas (« table not found », ce qu'une lecture
   * `as of 'HEAD'` dirait aussi) n'a pas de colonne à lire : on les sonde alors une à une. `undefined` : une vue est arrivée (l'assertion des vues, en tête du groupe, s'est
   * arrêtée), ou HEAD a changé entre deux sondes.
   *
   * Le `CREATE TABLE` est ce qui dit un index fonctionnel de HEAD (B-FI) : `show full columns` ne le liste pas, et ce n'est pas à lui de lire la table, qu'il n'évalue pas. Lu ici,
   * avant que `pinned` ne retienne ce HEAD, il arrête la lecture qui suit : sans lui, la première lecture d'un HEAD dont le working set modifié a retiré l'index l'exécuterait
   * (l'assertion ne voit que le working set), et le verdict de `checked` n'arriverait qu'après.
   */
  async function headColumns(
    db: DoltDatabase,
    base: string,
    options: QueryOptions,
  ): Promise<{ head: string; columns: { table: string; rows: Row[] }[]; schema: Row[] } | undefined> {
    const probe = async (tables: readonly string[]): Promise<Row[][] | undefined | 'absent'> => {
      try {
        return await changed(() =>
          queryAll(
            db,
            [storedViewsAssertion(base), "select hashof('HEAD') as head", ...tables.map((table) => `show full columns from ${table} as of 'HEAD'`), schemaCreateSql(base, 'HEAD')],
            options,
          ),
        );
      } catch (err) {
        if (err instanceof DoltQueryError && TABLE_NOT_FOUND.test(err.message)) return 'absent';
        throw err;
      }
    };
    const answer = (tables: readonly string[], answers: Row[][]) => ({
      head: text(answers[1]?.[0]?.head),
      columns: tables.map((table, i) => ({ table, rows: answers[i + 2] ?? [] })),
      schema: answers[tables.length + 2] ?? [],
    });
    const together = await probe(STORED_SQL_TABLES);
    if (together !== 'absent') return together && answer(STORED_SQL_TABLES, together);
    const each = await Promise.all(STORED_SQL_TABLES.map(async (table) => ({ table, answers: await probe([table]) })));
    if (each.some(({ answers }) => answers === undefined)) return undefined;
    const found = each.flatMap(({ table, answers }) => (answers === undefined || answers === 'absent' ? [] : [answer([table], answers)]));
    const heads = new Set(found.map(({ head }) => head));
    if (heads.size > 1) return undefined; // HEAD a changé entre deux sondes : le schéma lu n'est pas celui d'un seul HEAD
    // Le même HEAD pour toutes les sondes : leur `CREATE TABLE` est le même, la première suffit.
    return { head: found[0]?.head ?? '', columns: found.flatMap(({ columns }) => columns), schema: found[0]?.schema ?? [] };
  }

  /**
   * Dit ce que la base porte, ou, s'il n'y a rien, retient le HEAD dont le schéma est sain. Trois temps, chacun dans un processus : ce qu'`information_schema` dit (vues du
   * working set, colonnes générées, index fonctionnels) et ce que `dolt_nonlocal_tables` porte dans le working set et dans HEAD, lu sans résoudre aucun nom ; puis, ce qui lit des
   * tables système (les vues de HEAD, le working set modifié ou non, le hash de HEAD et, dans le même instantané, les colonnes générées) ; puis, si le working set est modifié, le
   * schéma de HEAD : ses colonnes et son `CREATE TABLE` (`headColumns`), jugé avant que ce HEAD ne soit retenu. Les deux derniers commencent par l'assertion des vues, qui arrête le
   * groupe si une vue masque ce qu'ils lisent, ou si `dolt_nonlocal_tables` mène leurs noms ailleurs : une vue ou des lignes arrivées depuis le premier temps.
   */
  async function diagnoseNow(db: DoltDatabase, lane: Lane | undefined, relearned = false): Promise<void> {
    const options: QueryOptions = lane ? { lane } : {};
    const base = bases.get(db.dir) ?? (await learnOnce(db, lane));
    let first: Row[][];
    try {
      first = await queryAll(db, [VIEWS_FOUND, GENERATED_FOUND, FUNCTIONAL_INDEXES_FOUND, storedNonlocalFound(base)], options);
    } catch (err) {
      // Le commit de base a disparu (l'historique a été réécrit) : le relevé de `dolt_nonlocal_tables`, le dernier du groupe, échoue. On en cherche un autre, une fois.
      if (!relearned && err instanceof DoltQueryError && err.completed?.length === 3 && REFUSED_BY_DOLT.test(err.message)) {
        bases.delete(db.dir);
        return diagnoseNow(db, lane, true);
      }
      throw err;
    }
    const [views = [], generated = [], functionalIndexes = [], nonlocal = []] = first;
    const seen = [...nonlocalFound(nonlocal), ...viewsFound(views), ...generatedFound(generated), ...functionalIndexesFound(functionalIndexes)];
    if (seen.length > 0) throw new StoredSqlError(seen, db.dir);

    const state = await changed(() =>
      queryAll(db, [storedViewsAssertion(base), HEAD_VIEWS_FOUND, `select count(*) as n ${UNCOMMITTED}`, "select hashof('HEAD') as head", GENERATED_FOUND], options),
    );
    if (!state) return; // une vue ou des lignes sont arrivées depuis le premier temps : la lecture reprend, et son assertion les dira
    const [, headViews = [], uncommitted = [], headNow = [], generatedNow = []] = state;
    if (headViews.length > 0) throw new StoredSqlError(headViewsFound(headViews), db.dir);
    if (generatedNow.length > 0) throw new StoredSqlError(generatedFound(generatedNow), db.dir);
    // Un compte que Dolt rend en nombre ou en chaîne (derrière un serveur) : tout ce qui n'est pas « 0 » est un working set modifié.
    if (String(uncommitted[0]?.n ?? '0') === '0') {
      // Propre : le working set est HEAD, et cet instantané, celui du hash que l'on vient de lire, n'a ni vue, ni colonne générée, ni vue de HEAD : ce HEAD est sain. On le retient : une
      // lecture qui part sale ensuite, tant que HEAD ne change pas, passe sans nouveau diagnostic. Un working set qui passe de sale à propre entre une lecture et son diagnostic (un
      // écrivain qui renomme une table, puis la rétablit) épuisait sinon les essais, HEAD n'ayant pas bougé (bdesk-38k.74).
      const head = text(headNow[0]?.head);
      if (head) pinned.set(db.dir, head);
      else pinned.delete(db.dir);
      return;
    }
    const atHead = await headColumns(db, base, options);
    if (!atHead) return; // une vue est arrivée, ou HEAD a changé : la lecture reprend, et son assertion le dira
    const problems = [
      ...atHead.columns.flatMap(({ table, rows }) => rows.filter((row) => isGenerated(row.Extra)).map((row) => `${columnProblem(table, text(row.Field))} (dans HEAD)`)),
      ...schemaCreateProblems(atHead.schema, ' (dans HEAD)'),
    ];
    if (problems.length > 0) throw new StoredSqlError(problems, db.dir);
    if (!atHead.head) throw new DoltQueryError(`HEAD illisible dans ${db.dir}`, db.dir);
    pinned.set(db.dir, atHead.head);
  }

  /** Une instruction du diagnostic est une instruction de la vérification : si Dolt la refuse, son texte n'est pas repris (voir `guarded`). */
  async function diagnose(db: DoltDatabase, lane: Lane | undefined): Promise<void> {
    try {
      await diagnoseNow(db, lane);
    } catch (err) {
      if (err instanceof DoltQueryError && !(err instanceof StoredSqlError) && REFUSED_BY_DOLT.test(err.message)) throw new DoltQueryError(CHECK_REFUSED, err.dir);
      throw err;
    }
  }

  function diagnoseOnce(db: DoltDatabase, options: QueryOptions | undefined): Promise<void> {
    let flight = diagnosing.get(db.dir);
    if (!flight) {
      // Sans le signal du demandeur : le diagnostic est partagé, et l'abandon de l'un ne doit pas faire échouer les autres. Un demandeur qui part est libéré aussitôt.
      flight = diagnose(db, options?.lane).finally(() => diagnosing.delete(db.dir));
      diagnosing.set(db.dir, flight);
    }
    return abortable(flight, options?.signal);
  }

  async function checked(db: DoltDatabase, sqls: readonly string[], options: QueryOptions | undefined): Promise<Row[][]> {
    if (sqls.every(readsNoTable)) return queryAll(db, sqls, options);
    // Le commit de base d'abord : sans lui, la première assertion échouerait à coup sûr (voir `storedViewsAssertion`).
    if (!bases.has(db.dir)) await learnOnce(db, options?.lane);
    for (let attempt = 1; ; attempt++) {
      const last = attempt >= MAX_ATTEMPTS;
      const base = bases.get(db.dir);
      const prelude = last ? storedSqlEvidence(pinned.get(db.dir), base) : storedSqlPrelude(pinned.get(db.dir), base);
      try {
        const results = await queryAll(db, [...prelude, ...sqls], options);
        // B-FI (bdesk-38k.74, round 3) : le `CREATE TABLE` de chaque table, les deux derniers relevés du groupe quand `base` est connu (`schemaProbe`). Dolt ne s'arrête pas pour eux
        // (ce ne sont pas des assertions qui lèvent) : la lecture a déjà pu s'exécuter. Ses lignes ne sont donc rendues qu'une fois ce relevé jugé propre ; sinon, elles sont jetées.
        if (base !== undefined) {
          const problems = [...schemaCreateProblems(results[prelude.length - 2] ?? []), ...schemaCreateProblems(results[prelude.length - 1] ?? [], ' (dans HEAD)')];
          if (problems.length > 0) throw new StoredSqlError(problems, db.dir);
        }
        return results.slice(prelude.length);
      } catch (err) {
        if (!(err instanceof DoltQueryError)) throw err;
        if (!ASSERTION_FAILED.test(err.message)) {
          // Le commit de base a disparu (l'historique a été réécrit) : la première instruction échoue, avant tout le reste. On en cherche un autre.
          if (base !== undefined && !last && err.completed?.length === 0 && REFUSED_BY_DOLT.test(err.message)) {
            bases.delete(db.dir);
            await learnOnce(db, options?.lane);
            continue;
          }
          throw guarded(err, [...prelude, ...sqls], prelude.length);
        }
        if (last) throw exhausted(err, db.dir);
        await diagnoseOnce(db, options);
      }
    }
  }

  /**
   * Ce que `dolt_nonlocal_tables` porte dans le commit `commit`, et le `CREATE TABLE` de `dependencies` à ce même commit (bdesk-38k.74, round 3, B-FI) : une époque du schéma de
   * dépendances, que `history.ts` relit dans la base de révision de son ancre, où Dolt résout les noms avec la table de ce commit-là. Dits comme `nonlocalCount` et `schemaCreateSql`
   * le disent de HEAD et du working set, sans résoudre aucun nom (`dolt_schema_diff(base, commit)` compare deux racines par leurs noms physiques) ; la lecture passe par `checked`, qui
   * garde le reste. **Pas `show create table <révision>.dependencies`** : le garde de lecture seule refuse `create` et `table` comme mots nus, où qu'ils s'écrivent (`FORBIDDEN_WORDS`,
   * `read-only.ts`) — `SHOW CREATE TABLE` en est une lecture pour Dolt, mais pas pour ce garde, qui ne distingue pas le contexte. `dolt_schema_diff` n'écrit ni l'un ni l'autre.
   */
  async function nonlocalAt(db: DoltDatabase, commit: string, options: QueryOptions | undefined): Promise<string[]> {
    if (!COMMIT_HASH.test(commit)) throw new DoltQueryError(`Commit d'époque illisible dans ${db.dir}`, db.dir);
    const base = bases.get(db.dir) ?? (await learnOnce(db, options?.lane));
    const where = ` (époque du commit ${commit.slice(0, 8)})`;
    const [nonlocalRows = [], schemaRows = []] = await checked(db, [nonlocalCount(base, commit), schemaCreateSql(base, commit)], options);
    const nonlocal = String(nonlocalRows[0]?.c ?? '0') === '0' ? [] : [nonlocalProblem(where)];
    return [...nonlocal, ...schemaCreateProblems(schemaRows, where, ERA_REQUIRED)];
  }

  return {
    open(dir) {
      const db = client.open(dir);
      /** Toute erreur qui sort passe par `withoutDoltText` : la recherche du commit de base, le diagnostic, la lecture, ou l'ancre d'une époque, quelle que soit l'instruction qui a échoué (m4). */
      const noDoltText = <T>(read: Promise<T>): Promise<T> =>
        read.catch((err: unknown) => {
          throw withoutDoltText(err);
        });
      return {
        dir,
        query: async (sql, options) => (await noDoltText(checked(db, [sql], options)))[0] ?? [],
        queryAll: (sqls, options) => noDoltText(checked(db, sqls, options)),
        storedSqlAt: (commit, options) => noDoltText(nonlocalAt(db, commit, options)),
      };
    },
  };
}

/** Le client Dolt des Projets de l'app : `createDoltClient`, qui vérifie chaque lecture (voir `withStoredSqlCheck`). */
export const createCheckedDoltClient = (options?: DoltClientOptions): DoltClient => withStoredSqlCheck(createDoltClient(options));
