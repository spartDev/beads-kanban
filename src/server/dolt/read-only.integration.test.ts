import { existsSync, mkdtempSync, realpathSync, rmSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { createDatabase, dolt, hasBinary, isolatedDoltEnv } from '../testing/dolt-fixture';
import { createDoltClient, queryAll } from './client';
import { assertReadOnly, READ_ONLY_PREFIX, ReadOnlyViolation } from './read-only';

/** Le verdict du garde pour cette requête : refusée (`true`) ou admise. */
const refused = (sql: string): boolean => {
  try {
    assertReadOnly(sql);
    return false;
  } catch (err) {
    if (err instanceof ReadOnlyViolation) return true;
    throw err;
  }
};

// Les marques à essayer derrière `/*` : les formes connues, les 16 casses de `dolt`, `mariadb` et chaque caractère de mot suivi de `!`.
const caseVariants = (word: string): string[] =>
  Array.from({ length: 2 ** word.length }, (_, mask) => [...word].map((c, k) => (mask & (1 << k) ? c.toUpperCase() : c)).join(''));
const TAGS = [
  '!',
  '!50000',
  'M!50000',
  'M!100000',
  'DOLT!50000',
  ...[...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789_'].map((c) => `${c}!`),
  ...caseVariants('dolt').map((w) => `${w}!`),
  'mariadb!',
  'MARIADB!',
  'MariaDB!',
  'dolt',
  'M',
  'M !',
  'dolt !',
];

/**
 * Ce que Dolt fait vraiment des formes dont le garde dit se méfier, sur une vraie base (sans bd) : le garde est lexical, il ne vaut que si son
 * découpage est celui de Dolt (bdesk-38k.56). Dolt est lancé directement, hors du garde, pour savoir ce qu'il exécute ; le client, lui, passe par le garde.
 */
describe.skipIf(!hasBinary('dolt'))('garde en lecture seule face à un vrai Dolt', () => {
  let env: NodeJS.ProcessEnv;
  let base: string;
  /** Deux bases au même contenu (commité : c-1 « commite » ; working set : c-1 « modifie » et w-2) ; `ansi` persiste en plus `ANSI_QUOTES`. */
  let dirs: { plain: string; ansi: string };
  let client: ReturnType<typeof createDoltClient>;

  /** Les lignes d'une lecture (CSV, deux lignes par instruction : en-tête puis valeurs), lancée directement par `dolt sql`, sans le garde. */
  const direct = (dir: string, sql: string): string[] =>
    dolt(env, dir, 'sql', '-r', 'csv', '-q', READ_ONLY_PREFIX + sql)
      .split('\n')
      .filter((line) => line !== '');

  beforeAll(() => {
    env = isolatedDoltEnv();
    base = realpathSync(mkdtempSync(join(tmpdir(), 'bdesk-readonly-')));
    dirs = { plain: join(base, 'plain'), ansi: join(base, 'ansi') };
    client = createDoltClient({ rootPath: env.DOLT_ROOT_PATH, retries: 0 });
    for (const dir of Object.values(dirs)) {
      const scratch = createDatabase(env, dir);
      scratch.sql("create table issues (id varchar(20) primary key, title varchar(100)); insert into issues values ('c-1', 'commite');");
      scratch.commit(1, 'état commité');
      scratch.sql("update issues set title = 'modifie' where id = 'c-1'; insert into issues values ('w-2', 'working set');");
    }
    dolt(env, dirs.ansi, 'sql', '-q', "set @@persist.sql_mode = 'ANSI_QUOTES'");
  }, 60_000);

  afterAll(() => {
    rmSync(base, { recursive: true, force: true });
  });

  describe('commentaires exécutables', () => {
    let executed: string[];

    // Les marques dont Dolt exécute le contenu : `select <i> as tag, 1 as n /*<marque> , 2 as two*/` rend la colonne `two` si le contenu s'exécute.
    beforeAll(() => {
      const sql = TAGS.map((tag, i) => `select ${i} as tag, 1 as n /*${tag} , 2 as two*/`).join(';\n');
      const lines = direct(dirs.plain, sql);
      executed = [];
      for (let k = 0; k + 1 < lines.length; k += 2) {
        if (lines[k]?.includes('two')) executed.push(TAGS[Number(lines[k + 1]?.split(',')[0])] ?? '?');
      }
    }, 60_000);

    it('Dolt exécute `/*! */` (MySQL), `/*M! */` (MariaDB, M majuscule) et `/*dolt! */` (toutes casses)', () => {
      expect(executed).toEqual(expect.arrayContaining(['!', '!50000', 'M!50000', 'M!100000', 'dolt!', 'DOLT!', 'Dolt!', 'dOlT!', 'DOLT!50000']));
      expect(executed).not.toContain('m!');
      expect(executed).not.toContain('M');
    });

    it('le garde refuse toute marque que Dolt exécute : le contenu du commentaire n’échappe pas à son découpage', () => {
      const missed = executed.filter((tag) => !refused(`select 1 as n /*${tag} , 2 as two*/`));

      expect(missed).toEqual([]);
    });

    it('le garde refuse aussi ce que Dolt lit comme un simple commentaire (`/* M! */`, `/*M*/`, `/*M !*/`, `/*+ … */`, `-- `, `#`) : il n’en admet aucun', () => {
      const comments = [
        'select 1 as n /* M! , 2 as two */',
        'select 1 as n /*M , 2 as two*/',
        'select 1 as n /*M ! , 2 as two*/',
        'select 1 as n /*+ JOIN_ORDER(a) , 2 as two*/',
        'select 1 as n -- , 2 as two\n',
        'select 1 as n # , 2 as two\n',
      ];
      const lines = direct(dirs.plain, comments.join(';\n'));

      expect(lines.filter((line) => line.includes('two'))).toEqual([]);
      for (const sql of comments) expect(refused(sql)).toBe(true);
    });
  });

  describe('guillemets doubles avec ANSI_QUOTES persisté', () => {
    const sql = 'select 1 as "\\", t.* from (table issues) t -- "';

    it('un antislash entre guillemets doubles ne se lit pas pareil : Dolt y lit un identifiant puis du SQL vivant', () => {
      // Avec ANSI_QUOTES : un identifiant « \ », puis `t.* from (table issues) t` (le working set). Sans : une seule chaîne, rien n'est lu.
      expect(direct(dirs.ansi, sql).join('\n')).toContain('w-2');
      expect(direct(dirs.plain, sql).join('\n')).not.toContain('w-2');
    });

    it('le garde refuse cette requête, quelle que soit la base', () => {
      expect(refused(sql)).toBe(true);
    });
  });

  // Relecture finale de bdesk-38k.56 (B3) : l'analyseur de Dolt lit l'antislash comme un caractère ordinaire entre accents graves, le découpeur d'instructions
  // de `dolt sql -q` comme un échappement. Ils ne voient plus les mêmes identifiants, et le découpeur coupe à un `;` que le garde lit dans un identifiant
  // ou dans un commentaire. La charge est un `select` inoffensif, dont la colonne `zq` dit qu'il s'est exécuté.
  describe('antislash entre accents graves', () => {
    /** Coupée au `;` : le premier morceau est invalide (identifiant non fermé), Dolt s'arrête dessus. */
    const cut = "select 1 as `a\\`, 'x', 2 as `;select * from (table issues) t; -- `";
    /** Le premier morceau finit dans un commentaire `-- ` : il est valide, et le morceau suivant s'exécute. */
    const runs = 'select 1 as `\\`-- `;select 7*11 as zq; -- `';

    it('Dolt coupe l’instruction au point-virgule : erreur sur le premier morceau, qui s’arrête avant l’accent grave de l’identifiant', () => {
      expect(() => direct(dirs.plain, cut)).toThrow(/error on line 1 for query select 1 as `a\\`, 'x', 2 as `\n/);
    });

    it('quand le premier morceau reste valide, le morceau suivant s’exécute : le garde ne voit qu’une instruction', () => {
      const lines = direct(dirs.plain, runs);

      expect(lines).toContain('zq');
      expect(lines).toContain('77');
    });

    it('le garde refuse ces formes', () => {
      expect([refused(cut), refused(runs)]).toEqual([true, true]);
    });

    it('le client les refuse avant de lancer dolt, sur la base par défaut comme sur celle qui persiste ANSI_QUOTES', async () => {
      for (const dir of [dirs.plain, dirs.ansi]) {
        for (const sql of [cut, runs]) await expect(client.open(dir).query(sql)).rejects.toBeInstanceOf(ReadOnlyViolation);
      }
    });

    it('un identifiant sans antislash se lit toujours, point-virgule dedans compris', async () => {
      expect(await client.open(dirs.plain).query("select 1 as `a;b` from issues as of 'HEAD' where id = 'c-1'")).toEqual([{ 'a;b': 1 }]);
    });
  });

  // Autre écart du même découpeur : il compte les antislash qui se suivent sans remettre le compte à zéro au saut de ligne. Dans `'\<saut de ligne>\\'`, un
  // antislash échappe le saut de ligne pour l'analyseur ; pour le découpeur, trois antislash de suite échappent le guillemet, qui ne ferme rien, et la chaîne
  // reste ouverte : le `;` qui suit, dans un commentaire pour l'analyseur, coupe l'instruction.
  describe('antislash devant un saut de ligne, dans une chaîne', () => {
    const runs = "select '\\\n\\\\' -- ';select 7*11 as zq; -- '";
    const cut = "select 'a\\\n\\';select 7*11 as zq;'";
    const doubled = "select 'a\\\\\n\\\\' , ';select 7*11 as zq;'";

    it('quand le premier morceau reste valide, le morceau suivant s’exécute ; sans saut de ligne, ou avec deux antislash devant lui, rien ne coupe', () => {
      expect(direct(dirs.plain, runs)).toContain('77');
      expect(direct(dirs.plain, doubled)).not.toContain('77');
    });

    it('coupée dans la chaîne, la requête échoue sur son premier morceau', () => {
      expect(() => direct(dirs.plain, cut)).toThrow(/error on line 1 for query select 'a\\\n\\'\n/);
    });

    it('le garde et le client refusent les formes qui coupent, et admettent celle qui ne coupe pas', async () => {
      expect([refused(runs), refused(cut), refused(doubled)]).toEqual([true, true, false]);
      for (const sql of [runs, cut]) await expect(client.open(dirs.plain).query(sql)).rejects.toBeInstanceOf(ReadOnlyViolation);
      await expect(client.open(dirs.plain).query(doubled)).resolves.toHaveLength(1);
    });
  });

  // Relecture finale de bdesk-38k.56 (B4) : le découpeur d'instructions de `dolt sql -q` cherche le `*/` à partir de l'étoile de l'ouverture, donc `/*/` est pour
  // lui un commentaire complet ; pour l'analyseur de Dolt et pour l'ancien garde, il en ouvre un qui court jusqu'au `*/` suivant. Un guillemet placé là ouvre une
  // chaîne pour le découpeur seul, et le `;` d'un commentaire `-- ` qui suit coupe l'instruction : le premier morceau reste valide, le morceau suivant s'exécute.
  // Le lecteur n'écrit aucun commentaire : le garde les refuse tous.
  describe('/*/ et les commentaires', () => {
    const P = ';select 7*11 as zq;';
    /** Chaque forme : le premier morceau est valide (il finit dans un commentaire `-- `), le morceau suivant est la charge. */
    const cuts = [
      `select 1 as x /*/ ' */ -- '${P} -- '`,
      `select 1 as x /*/' */ -- '${P} -- '`,
      `select 1 as x /*/ " */ -- "${P} -- "`,
      `select 1 as x /*/ \` */ -- \`${P} -- \``,
      `select 1 as x /*/\n' */ -- '${P} -- '`,
      `with c as (select 1 as x /*/ ' */) select x from c -- '${P} -- '`,
      `show tables /*/ ' */ -- '${P} -- '`,
    ];

    it('Dolt coupe ces instructions au point-virgule, et exécute la charge qui suit', () => {
      for (const sql of cuts) expect(direct(dirs.plain, sql)).toContain('77');
    });

    it('le garde refuse chacune', () => {
      expect(cuts.filter((sql) => !refused(sql))).toEqual([]);
    });

    it('le client les refuse avant de lancer dolt, seules ou dans un lot comme queryAll, sur la base par défaut comme sur celle qui persiste ANSI_QUOTES', async () => {
      for (const dir of [dirs.plain, dirs.ansi]) {
        for (const sql of cuts) await expect(client.open(dir).query(sql)).rejects.toBeInstanceOf(ReadOnlyViolation);
        await expect(queryAll(client.open(dir), ['select 1 as a', `select 2 as b /*/ ' */ -- '${P} -- '`])).rejects.toBeInstanceOf(ReadOnlyViolation);
      }
    });

    it('la requête sans commentaire se lit toujours, marques de commentaire dans une chaîne comprises', async () => {
      expect(await client.open(dirs.plain).query("select '/*/ '' */ -- ' as x from issues as of 'HEAD' limit 1")).toEqual([{ x: "/*/ ' */ -- " }]);
    });
  });

  // Le découpeur d'instructions de `dolt sql -q`, l'analyseur de Dolt et le garde doivent lire les mêmes chaînes, identifiants et commentaires. Chaque forme est
  // une instruction VALIDE pour l'analyseur, au contenu inerte hostile : `;` suivi d'une charge (un `select` inoffensif dont la colonne `zq` dit qu'il s'est
  // exécuté), guillemets de toute sorte, antislash, sauts de ligne, commentaires. Un garde qui l'admet doit la voir lue par Dolt comme UNE instruction.
  // (`fuzz-split.mjs`, dans les preuves, tire ces formes au hasard : il a trouvé l'antislash entre accents graves et l'antislash devant un saut de ligne. `/*/`,
  // lui, n'a été trouvé que par un fuzz ciblé des commentaires, `fuzz-comments.mts` : depuis, aucun commentaire n'est admis : les formes admises n'en contiennent pas, celles qui en contiennent sont listées refusées.)
  describe('formes hostiles', () => {
    const P = ';select 7*11 as zq;';
    /** [forme, admise par le garde ?] Les formes à commentaire sont refusées, que Dolt les lise comme une ou comme plusieurs instructions. */
    const forms: [string, boolean][] = [
      // chaînes, identifiants et marques de commentaire qui n'en sont pas : admis, et Dolt les lit comme une instruction
      [`select 'a${P}b'`, true],
      [`select 'it''s${P}'`, true],
      [`select 'it\\'s${P}'`, true],
      [`select 'a\\\\' , '${P}'`, true],
      [`select 'a\\\\\n\\\\' , '${P}'`, true],
      [`select 'a\n${P}\nb'`, true],
      [`select 1 as \`a${P}b\``, true],
      [`select 1 as \`a\`\`${P}b\``, true],
      [`select 1 as \`a'${P}"b\``, true],
      [`select 1 as \`#\` , '#${P}'`, true],
      [`select "a${P}b"`, true],
      [`select "a""${P}b"`, true],
      [`select "a'${P}\`b"`, true],
      [`select 1 as \`a\`, '\\\`${P}'`, true],
      [`select '-- ${P}\n' , 2`, true],
      [`select '/* ${P} */' , 2`, true],
      [`select '/*/ ' , '*/ -- ${P}'`, true],
      [`select '/*/ '' */ -- ' , '${P}'`, true],
      [`select 1 as \`/*/ ' */ -- ${P}\``, true],
      [`select '#${P}\n' , '*/ /*'`, true],
      // antislash devant un saut de ligne, ou entre accents graves : refusés
      [`select 'a\\\n\\'b' -- '${P} -- '`, false],
      [`select '\\\n\\\\' -- '${P} -- '`, false],
      [`select 'a\\\nb${P}'`, false],
      [`select 1 as \`\\\`-- \`${P} -- \``, false],
      [`select 1 as \`a\\\`, 'x', 2 as \`${P} -- \``, false],
      [`select 1 as \`a\\b${P}\``, false],
      // B4 : `/*/` est complet pour le découpeur, le guillemet qui suit ouvre une chaîne pour lui seul
      [`select 1 as x /*/ ' */ -- '${P} -- '`, false],
      [`select 1 as x /*/' */ -- '${P} -- '`, false],
      [`select 1 as x /*/ " */ -- "${P} -- "`, false],
      [`select 1 as x /*/ \` */ -- \`${P} -- \``, false],
      [`select 1 as x /*/\n' */ -- '${P} -- '`, false],
      [`with c as (select 1 as x /*/ ' */) select x from c -- '${P} -- '`, false],
      [`show tables /*/ ' */ -- '${P} -- '`, false],
      // commentaires que Dolt lit comme une seule instruction : refusés aussi
      [`select 1 -- it's${P}\n, 2`, false],
      [`select 1 -- "${P}\n, 2`, false],
      [`select 1 -- \`${P}\n, 2 as \`x;y\``, false],
      [`select 1 /* it's ${P} */ , 2`, false],
      [`select 1 /* \`${P} */ , 2 as \`x\``, false],
      [`select 1 /* \\ ${P} */ , '\\\\'`, false],
      [`select 1 -- \\\n, '${P}'`, false],
      [`select 1 -- ${P}\n`, false],
      [`select 'a', -- '\n 'b${P}'`, false],
      [`select 1 as x /* ' */ , 'c' /* ' */`, false],
      [`select 1 # ${P.replace(/;/g, '')}\n , 2`, false],
    ];

    it('le garde admet et refuse comme prévu', () => {
      expect(forms.filter(([sql, admitted]) => refused(sql) === admitted).map(([sql]) => sql)).toEqual([]);
    });

    it('les formes admises passent le client en un seul processus, comme queryAll : un résultat chacune, et la charge ne s’exécute jamais', async () => {
      const admitted = forms.filter(([, ok]) => ok).map(([sql]) => sql);

      const results = await queryAll(client.open(dirs.plain), admitted);

      expect(results).toHaveLength(admitted.length);
      expect(results.map((rows) => rows.length)).toEqual(admitted.map(() => 1));
      expect(results.flat().filter((row) => 'zq' in row)).toEqual([]);
    });
  });

  describe('le client (donc le garde) devant ces formes', () => {
    // `%` : le dossier de la base, où `into outfile` écrirait (c'est le `secure_file_priv` de `dolt sql`) ; un fichier par forme, car Dolt n'écrase pas.
    it.each<[string, string, string | undefined]>([
      ['/*M! … */ : into outfile', "select title from issues as of 'HEAD' /*M!into outfile '%/leak-0.txt'*/", 'leak-0.txt'],
      ['/*dolt! … */ : into outfile', "select title from issues as of 'HEAD' /*dolt!into outfile '%/leak-1.txt'*/", 'leak-1.txt'],
      ['/*DOLT! … */ : into outfile', "select title from issues as of 'HEAD' /*DOLT!into outfile '%/leak-2.txt'*/", 'leak-2.txt'],
      ['/*M! … */ : TABLE t', 'select * from (/*M!table issues*/) t', undefined],
      ['/*dolt! … */ : UNION TABLE t', "select * from issues as of 'HEAD' /*dolt!union table issues*/", undefined],
    ])('refuse %s avant de lancer dolt : aucune ligne du working set, aucun fichier écrit', async (_label, template, leak) => {
      const db = client.open(dirs.plain);

      await expect(db.query(template.replace('%', dirs.plain))).rejects.toBeInstanceOf(ReadOnlyViolation);

      if (leak) expect(existsSync(join(dirs.plain, leak))).toBe(false);
    });

    it('refuse l’antislash entre guillemets doubles, sur la base qui persiste ANSI_QUOTES', async () => {
      await expect(client.open(dirs.ansi).query('select 1 as "\\", t.* from (table issues) t -- "')).rejects.toBeInstanceOf(ReadOnlyViolation);
    });

    it('lit toujours le dernier commit', async () => {
      expect(await client.open(dirs.ansi).query("select id, title from issues as of 'HEAD' order by id")).toEqual([{ id: 'c-1', title: 'commite' }]);
    });
  });
});
