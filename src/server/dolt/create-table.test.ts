import { describe, expect, it } from 'vitest';
import { createTableProblems, MAX_CHECK_DEPTH } from './create-table';

/** Les cinq `CREATE TABLE` réels de bd (relevés sur cinq copies de Projets réels, bdesk-38k.74 round 3) : doivent tous être admis, sans exception. */
const REAL_ISSUES = `CREATE TABLE \`issues\` (
  \`id\` varchar(255) NOT NULL,
  \`content_hash\` varchar(64),
  \`title\` varchar(500) NOT NULL,
  \`description\` longtext NOT NULL,
  \`status\` varchar(32) NOT NULL DEFAULT 'open',
  \`priority\` int NOT NULL DEFAULT '2',
  \`assignee\` varchar(255),
  \`estimated_minutes\` int,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`updated_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP ON UPDATE CURRENT_TIMESTAMP,
  \`closed_at\` datetime,
  \`metadata\` json DEFAULT (json_object()),
  \`timeout_ns\` bigint DEFAULT '0',
  \`ephemeral\` tinyint(1) DEFAULT '0',
  PRIMARY KEY (\`id\`),
  KEY \`idx_issues_assignee\` (\`assignee\`),
  KEY \`idx_issues_is_blocked\` (\`is_blocked\`,\`status\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

const REAL_DEPENDENCIES = `CREATE TABLE \`dependencies\` (
  \`id\` char(36) NOT NULL,
  \`issue_id\` varchar(255) NOT NULL,
  \`type\` varchar(32) NOT NULL DEFAULT 'blocks',
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  \`created_by\` varchar(255) NOT NULL,
  \`metadata\` json DEFAULT (json_object()),
  \`depends_on_issue_id\` varchar(255),
  \`depends_on_wisp_id\` varchar(255),
  \`depends_on_external\` varchar(255),
  PRIMARY KEY (\`id\`),
  KEY \`idx_dep_issue_target\` (\`depends_on_issue_id\`),
  UNIQUE KEY \`uk_dep_issue_target\` (\`issue_id\`,\`depends_on_issue_id\`),
  CONSTRAINT \`fk_dep_issue\` FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`fk_dep_issue_target\` FOREIGN KEY (\`depends_on_issue_id\`) REFERENCES \`issues\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE,
  CONSTRAINT \`ck_dep_one_target\` CHECK (((((NOT(\`depends_on_issue_id\` IS NULL)) + (NOT(\`depends_on_wisp_id\` IS NULL))) + (NOT(\`depends_on_external\` IS NULL))) = 1))
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;`; // le point-virgule final : celui de `dolt_schema_diff(...).to_create_statement` (pas `show create table`)

const REAL_LABELS = `CREATE TABLE \`labels\` (
  \`issue_id\` varchar(255) NOT NULL,
  \`label\` varchar(255) NOT NULL,
  PRIMARY KEY (\`issue_id\`,\`label\`),
  KEY \`idx_labels_label\` (\`label\`),
  CONSTRAINT \`fk_labels_issue\` FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

const REAL_COMMENTS = `CREATE TABLE \`comments\` (
  \`id\` char(36) NOT NULL,
  \`issue_id\` varchar(255) NOT NULL,
  \`text\` longtext NOT NULL,
  \`created_at\` datetime NOT NULL DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (\`id\`),
  KEY \`idx_comments_issue_created_id\` (\`issue_id\`,\`created_at\`,\`id\`),
  CONSTRAINT \`fk_comments_issue\` FOREIGN KEY (\`issue_id\`) REFERENCES \`issues\` (\`id\`) ON DELETE CASCADE ON UPDATE CASCADE
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

const REAL_CONFIG = "CREATE TABLE `config` (\n  `key` varchar(255) NOT NULL,\n  `value` text NOT NULL,\n  PRIMARY KEY (`key`)\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin";

/** Les tables système que Dolt rend lui-même (mesuré, bdesk-38k.74 round 3) : des formes fixes, jamais choisies par un collaborateur, mais que la grammaire doit aussi admettre. */
const SYSTEM_DOLT_LOG = `CREATE TABLE \`dolt_log\` (
  \`commit_hash\` text NOT NULL,
  \`date\` datetime(3) NOT NULL,
  \`commit_order\` bigint unsigned NOT NULL,
  \`parents\` text,
  PRIMARY KEY (\`commit_hash\`),
  UNIQUE KEY \`commit_hash\` (\`commit_hash\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

const SYSTEM_DOLT_HISTORY_ISSUES_TAIL = `CREATE TABLE \`dolt_history_issues\` (
  \`id\` varchar(255) NOT NULL,
  \`commit_hash\` char(32) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`committer\` varchar(1024) CHARACTER SET ascii COLLATE ascii_bin NOT NULL,
  \`commit_date\` datetime(3) NOT NULL,
  PRIMARY KEY (\`id\`),
  KEY \`commit_hash\` (\`commit_hash\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

const SYSTEM_DOLT_SCHEMAS = `CREATE TABLE \`dolt_schemas\` (
  \`type\` varchar(64) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  \`name\` varchar(64) COLLATE utf8mb4_0900_ai_ci NOT NULL,
  \`fragment\` longtext,
  \`extra\` json,
  PRIMARY KEY (\`type\`,\`name\`)
) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin`;

describe('createTableProblems (bdesk-38k.74, round 3, B-FI : liste fermée pour CREATE TABLE)', () => {
  describe('admis : les CREATE TABLE réels de bd et les tables système de Dolt', () => {
    it.each([
      ['issues', REAL_ISSUES],
      ['dependencies (clé étrangère, check, défaut json_object())', REAL_DEPENDENCIES],
      ['labels', REAL_LABELS],
      ['comments', REAL_COMMENTS],
      ['config', REAL_CONFIG],
      ['dolt_log', SYSTEM_DOLT_LOG],
      ['dolt_history_issues (CHARACTER SET / COLLATE par colonne)', SYSTEM_DOLT_HISTORY_ISSUES_TAIL],
      ['dolt_schemas', SYSTEM_DOLT_SCHEMAS],
    ])('%s', (_label, sql) => {
      expect(createTableProblems(sql, 'x')).toEqual([]);
    });

    it('un CREATE TABLE avec point-virgule final (dolt_schema_diff.to_create_statement)', () => {
      expect(createTableProblems(`${REAL_CONFIG};`, 'x')).toEqual([]);
    });

    it('une apostrophe dans une valeur par défaut, doublée comme Dolt l’écrit', () => {
      const sql = "CREATE TABLE `t` (`a` varchar(20) DEFAULT 'it''s a test') ENGINE=InnoDB";
      expect(createTableProblems(sql, 'x')).toEqual([]);
    });

    it('une colonne nullable sans aucun défaut', () => {
      expect(createTableProblems('CREATE TABLE `t` (`a` varchar(20)) ENGINE=InnoDB', 'x')).toEqual([]);
    });

    // Mesuré : Dolt range ainsi un défaut littéral ordinaire après certains `alter table` (bdesk-38k.74, round 3, B-FI : un index fonctionnel ajouté puis retiré d'une table qui a des lignes).
    it('une chaîne ou un nombre entre parenthèses comme défaut (ce que Dolt écrit après certains ALTER TABLE)', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` varchar(32) NOT NULL DEFAULT ('blocks')) ENGINE=InnoDB", 'x')).toEqual([]);
      expect(createTableProblems("CREATE TABLE `t` (`a` int DEFAULT (2)) ENGINE=InnoDB", 'x')).toEqual([]);
    });

    // Mesuré à l'ancre d'une époque (le dernier commit d'avant la migration 0041 de bd) de trois copies de Projets réels : `comments.id` a `DEFAULT (uuid())`, et les dates
    // `DEFAULT 'CURRENT_TIMESTAMP'` entre apostrophes (une chaîne : admise comme toute chaîne). Sans cela, l'historique de ces trois Projets était refusé : une fausse alerte.
    it('l’ancre d’une époque d’avant la migration 0041 de bd : `DEFAULT (uuid())` et un nom de défaut entre apostrophes', () => {
      const old =
        "CREATE TABLE `comments` (\n  `id` char(36) NOT NULL DEFAULT (uuid()),\n  `issue_id` varchar(255) NOT NULL,\n  `created_at` datetime NOT NULL DEFAULT 'CURRENT_TIMESTAMP',\n  PRIMARY KEY (`id`),\n" +
        "  KEY `idx_comments_created_at` (`created_at`),\n  CONSTRAINT `fk_comments_issue` FOREIGN KEY (`issue_id`) REFERENCES `issues` (`id`) ON DELETE CASCADE\n) ENGINE=InnoDB DEFAULT CHARSET=utf8mb4 COLLATE=utf8mb4_0900_bin;";
      expect(createTableProblems(old, 'comments')).toEqual([]);
    });

    it.each(['CASCADE', 'RESTRICT', 'SET NULL', 'NO ACTION', 'SET DEFAULT'])('une clé étrangère `ON DELETE %s` (les cinq actions de MySQL, lues d’un seul tenant)', (action) => {
      expect(createTableProblems(`CREATE TABLE \`t\` (\`a\` int, CONSTRAINT \`f\` FOREIGN KEY (\`a\`) REFERENCES \`u\` (\`id\`) ON DELETE ${action} ON UPDATE ${action}) ENGINE=InnoDB`, 'x')).toEqual([]);
    });
  });

  describe('refusé : une vue ou autre chose qu’une table', () => {
    it.each([
      ['CREATE VIEW', "CREATE VIEW `ready_issues` AS select id, title from issues where status = 'open'"],
      ['texte vide', ''],
      ['charabia', 'n’importe quoi'],
    ])('%s', (_label, sql) => {
      const problems = createTableProblems(sql, 'x');
      expect(problems).toHaveLength(1);
      expect(problems[0]).not.toContain(sql.slice(0, 5) || 'rien'); // le texte original n'est jamais repris tel quel (sauf chevauchement trivial impossible ici)
    });
  });

  describe('refusé : une colonne générée (visible)', () => {
    it.each([
      ['virtual', "CREATE TABLE `t` (`a` varchar(500) GENERATED ALWAYS AS (load_file('/x')) VIRTUAL) ENGINE=InnoDB"],
      ['stored', "CREATE TABLE `t` (`a` varchar(500) GENERATED ALWAYS AS (load_file('/x')) STORED) ENGINE=InnoDB"],
    ])('%s', (_label, sql) => {
      const problems = createTableProblems(sql, 'labels');
      expect(problems).toHaveLength(1);
      expect(problems[0]).not.toContain('load_file');
      expect(problems[0]).not.toContain('/x');
    });
  });

  describe('refusé : un index fonctionnel (la colonne générée cachée de B-FI)', () => {
    it.each([
      ['sleep', "CREATE TABLE `labels` (`issue_id` varchar(255) NOT NULL, PRIMARY KEY (`issue_id`), KEY `fi` ((sleep(3)))) ENGINE=InnoDB"],
      ['from_base64/load_file (l’oracle du round 3)', "CREATE TABLE `labels` (`issue_id` varchar(255) NOT NULL, PRIMARY KEY (`issue_id`), KEY `fi` ((from_base64(load_file('/private/x/canary.txt'))))) ENGINE=InnoDB"],
    ])('%s', (_label, sql) => {
      const problems = createTableProblems(sql, 'labels');
      expect(problems).toHaveLength(1);
      expect(problems[0]).not.toMatch(/sleep|from_base64|load_file|canary/i);
    });
  });

  describe('refusé : un défaut entre parenthèses qui n’est pas (json_object())', () => {
    it.each([
      ['sleep(1)', "CREATE TABLE `t` (`a` int DEFAULT (sleep(1))) ENGINE=InnoDB"],
      ['load_file', "CREATE TABLE `t` (`a` varchar(500) DEFAULT (load_file('/x'))) ENGINE=InnoDB"],
      ['une expression arithmétique', "CREATE TABLE `t` (`a` int DEFAULT (1+1)) ENGINE=InnoDB"],
      ['json_object avec un argument (pas la forme exacte admise)', "CREATE TABLE `t` (`a` json DEFAULT (json_object('k', 1))) ENGINE=InnoDB"],
      // Un appel reconnu à moitié ne laisse pas le curseur avancé pour une autre branche : un seul argument littéral ne le fait pas admettre.
      ['json_object avec un seul argument littéral', "CREATE TABLE `t` (`a` json DEFAULT (json_object('a'))) ENGINE=InnoDB"],
      ['json_object avec un seul argument numérique', "CREATE TABLE `t` (`a` json DEFAULT (json_object(1))) ENGINE=InnoDB"],
      ['uuid avec un argument', "CREATE TABLE `t` (`a` char(36) DEFAULT (uuid(1))) ENGINE=InnoDB"],
      ['uuid dans une somme', "CREATE TABLE `t` (`a` char(36) DEFAULT (uuid()+1)) ENGINE=InnoDB"],
      ['uuid_short (pas uuid)', "CREATE TABLE `t` (`a` bigint DEFAULT (uuid_short())) ENGINE=InnoDB"],
      // La liste des appels sans argument est fermée : une fonction sans argument n'y entre pas parce qu'elle n'en a pas.
      ['sleep sans argument', "CREATE TABLE `t` (`a` int DEFAULT (sleep())) ENGINE=InnoDB"],
      ['load_file sans argument', "CREATE TABLE `t` (`a` text DEFAULT (load_file())) ENGINE=InnoDB"],
      ['now sans argument', "CREATE TABLE `t` (`a` datetime DEFAULT (now())) ENGINE=InnoDB"],
      ['un nom de colonne entre parenthèses', "CREATE TABLE `t` (`a` int, `b` int DEFAULT (`a`)) ENGINE=InnoDB"],
      ['des parenthèses doubles autour d’un littéral', "CREATE TABLE `t` (`a` int DEFAULT ((2))) ENGINE=InnoDB"],
    ])('%s', (_label, sql) => {
      expect(createTableProblems(sql, 'x')).toHaveLength(1);
    });
  });

  describe('refusé : du texte après la fin de la définition', () => {
    it.each([
      ['une autre instruction après le point-virgule', "CREATE TABLE `t` (`a` int) ENGINE=InnoDB; CREATE VIEW `v` AS select 1"],
      ['un mot de trop dans les options', "CREATE TABLE `t` (`a` int) ENGINE=InnoDB EVIL"],
      ['une option dont la valeur est une expression', "CREATE TABLE `t` (`a` int) ENGINE=InnoDB COMMENT=(select 1)"],
    ])('%s', (_label, sql) => {
      expect(createTableProblems(sql, 'x')).toHaveLength(1);
    });
  });

  describe('le point-virgule ferme le texte', () => {
    it('ce qui le suit est refusé par la lecture des options elle-même, avant toute autre vérification : la raison le dit', () => {
      const sql = "CREATE TABLE `t` (`a` int) ENGINE=InnoDB; CREATE VIEW `v` AS select 1";

      expect(createTableProblems(sql, 'x')).toEqual(['x : construction non reconnue dans les options de la table']);
    });
  });

  describe('refusé : un membre du corps lu comme autre chose que ce qu’il est (aucun repli après un échec à moitié lu)', () => {
    it.each([
      ['NOT KEY (une colonne qui échoue à moitié, puis une clé qui lirait la suite)', "CREATE TABLE `t` (`a` int NOT KEY `x` (`b`)) ENGINE=InnoDB"],
      ['une contrainte qui n’est ni une clé étrangère ni un check', "CREATE TABLE `t` (`a` int, CONSTRAINT `c` UNIQUE (`a`)) ENGINE=InnoDB"],
      ['une clé étrangère dont l’action n’est pas l’une des cinq', "CREATE TABLE `t` (`a` int, CONSTRAINT `f` FOREIGN KEY (`a`) REFERENCES `u` (`id`) ON DELETE EVAL) ENGINE=InnoDB"],
      ['un mot inconnu en tête de membre', "CREATE TABLE `t` (`a` int, FULLTEXT KEY `x` (`a`)) ENGINE=InnoDB"],
    ])('%s', (_label, sql) => {
      expect(createTableProblems(sql, 'x')).toHaveLength(1);
    });
  });

  describe('refusé : une contrainte check d’une forme qui n’est pas celle de bd', () => {
    it.each([
      ['un appel de fonction', "CREATE TABLE `t` (`a` int, CONSTRAINT `c` CHECK (sleep(1) = 0)) ENGINE=InnoDB"],
      ['une chaîne', "CREATE TABLE `t` (`a` varchar(10), CONSTRAINT `c` CHECK (`a` = 'x')) ENGINE=InnoDB"],
      ['un nom qualifié (table.colonne)', "CREATE TABLE `t` (`a` int, CONSTRAINT `c` CHECK (`t`.`a` = 1)) ENGINE=InnoDB"],
    ])('%s', (_label, sql) => {
      expect(createTableProblems(sql, 'x')).toHaveLength(1);
    });
  });

  describe('la forme exacte du check de bd, et de légères variations, pour cerner la grammaire', () => {
    it('admis : la forme réelle', () => {
      const sql = "CREATE TABLE `t` (`a` varchar(10), `b` varchar(10), CONSTRAINT `c` CHECK (((NOT(`a` IS NULL)) + (NOT(`b` IS NULL))) = 1)) ENGINE=InnoDB";
      expect(createTableProblems(sql, 'x')).toEqual([]);
    });
    it('admis : une comparaison simple sur une colonne', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, CONSTRAINT `c` CHECK (`a` > 0)) ENGINE=InnoDB", 'x')).toEqual([]);
    });
    it('admis : OR et IS NOT NULL', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, `b` int, CONSTRAINT `c` CHECK (`a` IS NOT NULL OR `b` IS NULL)) ENGINE=InnoDB", 'x')).toEqual([]);
    });
  });

  describe('refusé : un index fonctionnel ou une colonne générée atteints par un autre chemin que les cas ci-dessus', () => {
    it('une clé dont un membre est entre parenthèses sans backtick (forme générale d’un index fonctionnel)', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, KEY `k` ((`a` + 1))) ENGINE=InnoDB", 'x')).toHaveLength(1);
    });
    it('un mot-clé GENERATED au milieu d’une colonne par ailleurs ordinaire', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int GENERATED ALWAYS AS (1) VIRTUAL) ENGINE=InnoDB", 'x')).toHaveLength(1);
    });
    it('une clé étrangère qui référence un appel de fonction plutôt qu’une table', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, CONSTRAINT `c` FOREIGN KEY (`a`) REFERENCES sleep(1) (`a`)) ENGINE=InnoDB", 'x')).toHaveLength(1);
    });
    it('un index fonctionnel qui se fait passer pour une longueur de préfixe', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` varchar(10), KEY `k` (`a`(sleep(1)))) ENGINE=InnoDB", 'x')).toHaveLength(1);
    });
    it('une sous-requête dans un check', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, CONSTRAINT `c` CHECK (`a` IN (SELECT 1))) ENGINE=InnoDB", 'x')).toHaveLength(1);
    });
  });

  describe('admis : des formes un peu différentes, toujours dans la grammaire', () => {
    it('un type sans aucune précision (int tout nu)', () => {
      expect(createTableProblems('CREATE TABLE `t` (`a` int, PRIMARY KEY (`a`)) ENGINE=InnoDB', 'x')).toEqual([]);
    });
    it('UNIQUE sans nom', () => {
      expect(createTableProblems('CREATE TABLE `t` (`a` int, UNIQUE (`a`)) ENGINE=InnoDB', 'x')).toEqual([]);
    });
    it('une longueur de préfixe sur une clé ordinaire', () => {
      expect(createTableProblems('CREATE TABLE `t` (`a` varchar(255), KEY `k` (`a`(10))) ENGINE=InnoDB', 'x')).toEqual([]);
    });
    it('plusieurs AND/OR dans un check, avec des nombres négatifs', () => {
      expect(createTableProblems("CREATE TABLE `t` (`a` int, `b` int, CONSTRAINT `c` CHECK ((`a` > -1 AND `b` < 5) OR `a` = 0)) ENGINE=InnoDB", 'x')).toEqual([]);
    });
  });

  // bdesk-38k.74, relecture finale, round 4, m1. Dolt accepte un `check` de vingt mille `not` à la suite et l'écrit en quelque quarante mille parenthèses imbriquées : l'analyseur descend par
  // récursion, et la pile débordait (« Maximum call stack size exceeded »). Le refus doit être celui de la grammaire, jamais une exception.
  describe('l’imbrication d’un check est bornée : une limite explicite, le refus générique au-delà', () => {
    const GENERIC = 'x : colonne générée, index fonctionnel, ou autre construction non admise';
    const withCheck = (expression: string) => `CREATE TABLE \`t\` (\`a\` int, CONSTRAINT \`c\` CHECK (${expression})) ENGINE=InnoDB`;
    /** `depth` parenthèses ouvertes autour de `a > 0`, comme Dolt les écrit. */
    const nestedParentheses = (depth: number) => `${'('.repeat(depth)}\`a\` > 0${')'.repeat(depth)}`;
    /** `count` `NOT` à la suite, comme Dolt écrit un `not not not … a` : `NOT(` par `not`. */
    const chainedNots = (count: number) => `${'NOT('.repeat(count)}\`a\` IS NULL${')'.repeat(count)}`;

    it.each([
      ['vingt mille NOT à la suite, écrits NOT(NOT(…))', withCheck(chainedNots(20_000))],
      ['vingt mille NOT nus à la suite', withCheck(`${'NOT '.repeat(20_000)}\`a\` IS NULL`)],
      ['quarante mille parenthèses imbriquées', withCheck(nestedParentheses(40_000))],
      ['des NOT et des parenthèses mêlés', withCheck(`${'(NOT '.repeat(10_000)}\`a\` IS NULL${')'.repeat(10_000)}`)],
    ])('%s : refusé par la grammaire, sans exception', (_label, sql) => {
      expect(() => createTableProblems(sql, 'x')).not.toThrow();
      expect(createTableProblems(sql, 'x')).toEqual([GENERIC]);
    });

    it('la limite elle-même : MAX_CHECK_DEPTH parenthèses sont admises, une de plus est refusée', () => {
      expect(createTableProblems(withCheck(nestedParentheses(MAX_CHECK_DEPTH)), 'x')).toEqual([]);
      expect(createTableProblems(withCheck(nestedParentheses(MAX_CHECK_DEPTH + 1)), 'x')).toEqual([GENERIC]);
    });

    it('la limite compte aussi les NOT : MAX_CHECK_DEPTH NOT nus sont admis, un de plus est refusé', () => {
      const nots = (count: number) => withCheck(`${'NOT '.repeat(count)}\`a\` IS NULL`);

      expect(createTableProblems(nots(MAX_CHECK_DEPTH), 'x')).toEqual([]);
      expect(createTableProblems(nots(MAX_CHECK_DEPTH + 1), 'x')).toEqual([GENERIC]);
    });

    it('les parenthèses et les NOT se cumulent : la moitié de chaque, au total à la limite, passe ; un NOT de plus, non', () => {
      const half = MAX_CHECK_DEPTH / 2;
      const mixed = (nots: number) => withCheck(`${'('.repeat(half)}${'NOT '.repeat(nots)}\`a\` IS NULL${')'.repeat(half)}`);

      expect(createTableProblems(mixed(half), 'x')).toEqual([]);
      expect(createTableProblems(mixed(half + 1), 'x')).toEqual([GENERIC]);
    });

    it('la forme que bd pose (six niveaux) est admise, bien en deçà de la limite', () => {
      expect(MAX_CHECK_DEPTH).toBeGreaterThan(6 * 4);
      expect(createTableProblems(`CREATE TABLE \`t\` (\`a\` int, \`b\` int, \`c\` int, CONSTRAINT \`ck\` CHECK (((((NOT(\`a\` IS NULL)) + (NOT(\`b\` IS NULL))) + (NOT(\`c\` IS NULL))) = 1))) ENGINE=InnoDB`, 'x')).toEqual([]);
    });

    it('des parenthèses côte à côte ne s’imbriquent pas : deux cents termes reliés par AND sont admis, la profondeur étant rendue à chaque fermeture', () => {
      const siblings = Array.from({ length: 200 }, () => '(`a` > 0)').join(' AND ');

      expect(createTableProblems(withCheck(siblings), 'x')).toEqual([]);
    });

    it('un check qui échoue en profondeur ne laisse pas la profondeur ouverte : le suivant, dans une autre table, est jugé comme neuf', () => {
      createTableProblems(withCheck(nestedParentheses(MAX_CHECK_DEPTH + 10)), 'x');

      expect(createTableProblems(withCheck(nestedParentheses(3)), 'x')).toEqual([]);
    });
  });

  describe('le problème nomme la table, jamais le contenu de la base', () => {
    it('le nom donné (label) apparaît dans le problème', () => {
      const problems = createTableProblems("CREATE TABLE `t` (`a` int, KEY `fi` ((sleep(3)))) ENGINE=InnoDB", 'labels (dans HEAD)');
      expect(problems[0]).toContain('labels (dans HEAD)');
    });
  });
});
