import { describe, expect, it } from 'vitest';
import { DoltQueryError } from './client';
import { assertReadOnly, ReadOnlyViolation } from './read-only';

describe('assertReadOnly', () => {
  it.each<[string, string]>([
    ['insert', 'insert into issues values (1)'],
    ['update', 'update issues set status = "closed"'],
    ['delete', 'delete from issues'],
    ['drop', 'drop table issues'],
    ['call', "call dolt_commit('-am', 'x')"],
    ['create', 'create table t (id int)'],
    ['truncate', 'truncate table issues'],
    ['alter', 'alter table issues add column x int'],
    ['replace', 'replace into issues values (1)'],
    ['load data', "load data infile '/etc/passwd' into table issues"],
    ['set', 'set @@dolt_force_transaction_commit = 1'],
    ['use', 'use autre_base'],
    ['start transaction', 'start transaction'],
    ['commit', 'commit'],
    ['lock', 'lock tables issues write'],
    ['instruction vide', ''],
    ['un commentaire seul', '-- rien'],
    ['lecture puis écriture', 'select 1; delete from issues'],
    ['deux lectures', 'select 1; select 2'],
    ['écriture après une chaîne', "select 'a'; update issues set status = 'x'"],
    // Contournements relevés en revue.
    ['WITH … DELETE', 'with x as (select 1) delete from issues'],
    ['WITH … UPDATE', 'with x as (select 1) update issues set status = 1'],
    ['WITH … INSERT', 'with x as (select 1) insert into issues select * from x'],
    ['WITH récursif à plusieurs tables … DELETE', 'with recursive x (n) as (select 1), y as (select 2) delete from issues'],
    ['WITH sans instruction finale', 'with x as (select 1)'],
    ['WITH mal formé', 'with x (select 1) select 1'],
    ['apostrophe dans un commentaire --', "select 1 -- '\n; insert into issues values (2) -- '"],
    ['apostrophe dans un commentaire #', "select 1 # '\n; insert into issues values (2) # '"],
    ['apostrophes dans des commentaires /* */', "select 1 /* ' */; insert into issues values (2) /* ' */"],
    ['SELECT … INTO DUMPFILE', "select 'x' into dumpfile '/tmp/x'"],
    ['SELECT … INTO OUTFILE', "select 'x' into outfile '/tmp/x'"],
    ['SELECT … INTO variable', 'select 1 into @x'],
    ['SELECT … FOR UPDATE', 'select * from issues for update'],
    ['EXPLAIN ANALYZE … DELETE', 'explain analyze delete from issues'],
    ['SHOW CREATE', 'show create table issues'],
    ['LOAD_FILE', "select load_file('/etc/passwd')"],
    // Constructions que Dolt et le garde-fou pourraient lire différemment : dans le doute, on refuse.
    ['commentaire exécutable /*! */', "select 1 /*!50000 into outfile '/tmp/x' */"],
    ['commentaire exécutable contenant ;', 'select 1 /*! ; delete from issues */'],
    ['-- collé au caractère suivant', 'select 1 --x; delete from issues'],
    // Trouvé par fuzzing : le découpeur d'instructions de Dolt ignore les commentaires #, son analyseur les lit.
    ['point-virgule dans un commentaire #', 'select 1 #; delete from issues'],
    ['point-virgule après un commentaire # sur la même ligne', 'select 1 # fin ; delete from issues #'],
    ['apostrophe dans un commentaire # avec ; sur la même ligne', "select 1 # ' ; delete from issues"],
    ['guillemets dans un commentaire #', 'select 1 # "; delete from issues'],
    ['commentaire /* dans un commentaire #', 'select 1 # /*\n; delete from issues # */'],
    ['retour chariot dans un commentaire --', 'select 1 -- x\r; delete from issues'],
    ['retour chariot dans un commentaire #', 'select 1 # x\r; delete from issues'],
    ['chaîne non terminée', "select 'abc"],
    ['identifiant non terminé', 'select `abc'],
    ['commentaire non terminé', 'select 1 /* abc'],
    ['antislash hors chaîne', 'select 1 \\ delete from issues'],
    ['caractère nul', 'select 1\u0000'],
    ['caractère hors ASCII hors chaîne', 'select é from issues'],
  ])('refuse une requête qui n’est pas en lecture seule : %s', (_label, sql) => {
    expect(() => assertReadOnly(sql)).toThrow('lecture seule');
  });

  it.each<[string, string]>([
    ['SELECT', 'select * from issues'],
    ['SELECT en majuscules', '  SELECT 1'],
    ['SELECT terminé par un point-virgule', 'select 1;'],
    ['SHOW', 'show tables'],
    ['DESCRIBE', 'describe issues'],
    ['DESC', 'desc issues'],
    ['EXPLAIN', 'explain select * from issues'],
    ['WITH … SELECT', 'with t as (select 1) select * from t'],
    ['WITH à plusieurs tables, colonnes nommées', 'with a (x) as (select 1), b as (select 2) select * from a, b'],
    ['WITH RECURSIVE … SELECT', 'with recursive l (n) as (select 1 union all select n + 1 from l where n < 3) select * from l'],
    ['point-virgule dans une chaîne', "select * from issues where title = 'a;b; delete from issues'"],
    ['apostrophe échappée dans une chaîne', "select * from issues where id = 'x\\' ; delete from issues; --'"],
    ['apostrophe doublée dans une chaîne', "select * from issues where id = 'it''s -- /* # ; delete'"],
    ['guillemets doubles', 'select "a /* b */ ; c"'],
    ['mots interdits en identifiants entre guillemets inversés', 'select `into`, `update` from `delete`'],
    ['mots interdits dans des noms plus longs', 'select created_at, updated_at, closed_at, close_reason, description from issues'],
    ['commentaire --', 'select 1 -- un commentaire'],
    ['commentaire -- suivi de la suite de la requête', 'select 1 -- un commentaire\n, 2'],
    ['commentaire #', 'select 1 # un commentaire'],
    ['commentaire /* */', 'select /* un commentaire ; delete */ 1'],
    ['apostrophe seule dans un commentaire', "select 1 -- l'apostrophe"],
    ['commentaire après le point-virgule', 'select 1; -- fin'],
  ])('laisse passer une lecture : %s', (_label, sql) => {
    expect(() => assertReadOnly(sql)).not.toThrow();
  });

  // Le refus part dans la réponse HTTP : typé, il devient un 503 avec sa raison ; ordinaire, un 500 qui citerait la requête.
  describe('erreur du refus', () => {
    /** Ce qui trahit la requête dans un message : le mot « canari » que chaque requête ci-dessous contient, ou du SQL ordinaire. */
    const QUERY_TRACE = /canari|select|issues|read only/i;
    const refusal = (sql: string): unknown => {
      try {
        assertReadOnly(sql);
      } catch (err) {
        return err;
      }
      return undefined;
    };

    it('est une ReadOnlyViolation, donc une DoltQueryError : le service en fait un 503, et non un 500', () => {
      const error = refusal('delete from issues');

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect(error).toBeInstanceOf(DoltQueryError);
      expect((error as Error).name).toBe('ReadOnlyViolation');
    });

    it.each<[string, string]>([
      ['verbe qui n’est pas une lecture', 'canari_ecrit into canari'],
      ['écriture', "delete from canari where id = 'canari'"],
      ['plusieurs instructions', 'select canari; select canari'],
      ['mot interdit', "select canari into outfile '/tmp/canari'"],
      ['WITH qui ne finit pas par une lecture', 'with canari as (select 1) delete from canari'],
      ['WITH mal formé', 'with canari (select canari) select canari'],
      ['parenthèse non fermée', 'with canari as (select canari'],
      ['chaîne non terminée', "select 'canari"],
      ['identifiant non terminé', 'select `canari'],
      ['caractère hors ASCII', 'select canari é'],
      ['antislash hors chaîne', 'select canari \\ canari'],
      ['commentaire exécutable', 'select canari /*!50000 canari */'],
      ['-- collé au caractère suivant', 'select canari --canari'],
      ['commentaire # ambigu', "select canari # '; canari"],
      ['commentaire non terminé', 'select canari /* canari'],
      ['caractère de contrôle dans un commentaire', 'select canari -- canari\u0001'],
    ])('ne cite rien de la requête, ni extrait ni mot : %s', (_label, sql) => {
      const error = refusal(sql);

      expect(error).toBeInstanceOf(ReadOnlyViolation);
      expect((error as Error).message).toContain('lecture seule');
      expect((error as Error).message).not.toMatch(QUERY_TRACE);
    });

    it('dit pourquoi, sans citer la requête : l’instruction en trop, le mot interdit', () => {
      expect((refusal('select 1; select 2') as Error).message).toContain('une seule instruction');
      expect((refusal('select 1 into @x') as Error).message).toContain('« into »');
    });
  });
});
