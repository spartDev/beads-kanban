import { createHash } from 'node:crypto';
import { readdir, readFile, stat } from 'node:fs/promises';
import { join } from 'node:path';

/** Les fichiers de `.dolt/noms` qui n'entrent pas dans l'empreinte par leur taille et leur identité : le manifest (son contenu y est), le verrou et l'index du journal. */
const IGNORED = new Set(['manifest', 'LOCK', 'journal.idx']);

/**
 * L'empreinte d'une base Dolt : ce qui change quand on y écrit (bd, ou un `dolt sql-server`), jamais quand on la lit. Deux scans qui la
 * trouvent égale savent que le préfixe des tickets n'a pas changé entre eux, sans lancer le processus `dolt` qui le lirait (bdesk-38k.43).
 *
 * Elle se compose, dans `.dolt/noms`, du CONTENU de `manifest` et, de chaque autre fichier, de sa TAILLE et de son IDENTITÉ (périphérique et
 * inode). Jamais d'une date de modification : chaque lecture de `dolt sql` réécrit celle de `manifest`, de `journal.idx` et du journal, sans
 * changer un octet (ADR 0002). Et pas du manifest seul : une écriture par un `dolt sql-server` (un Projet en mode server) ne change que la
 * taille du journal, que le serveur prolonge à chaque commit, pas le manifest, qu'il ne réécrit pas (mesuré avec Dolt 2.5.0 :
 * `proofs/bdesk-38k.43.md`, expérience 1). En mode embedded une écriture de bd change les deux, avec ou sans commit. Le journal ne fait que
 * grandir ; ce que Dolt range en fichiers (un `gc`) passe par le manifest : on n'a pas observé d'écriture qui laisse l'un et l'autre intacts.
 *
 * L'identité sépare deux copies qui ont les mêmes octets sans avoir le même contenu (relecture de bdesk-38k.43, B1). En mode server, deux copies
 * d'une base écrites par un serveur d'une valeur de même longueur et copiées serveur en marche ont le même manifest (il ne bouge pas) et un
 * journal de même taille : celle qui remplaçait l'autre au même chemin (restauration, re-synchronisation, copie d'un autre poste) faisait
 * reprendre le préfixe de l'autre. Un fichier neuf a un autre inode, alors que Dolt prolonge le journal en place : ni une lecture ni une écriture
 * (avec ou sans commit, en embedded comme en server) ne change l'identité des fichiers comptés (expérience 2). Le manifest, lui, est réécrit à
 * chaque lecture, par un fichier temporaire renommé : son inode ne se compte pas, son contenu oui. Restent hors de portée un fichier réécrit EN
 * PLACE d'un autre contenu aux mêmes taille et manifest (`cp` sur le fichier existant, `rsync --inplace`), et un fichier recréé qui reçoit le
 * numéro d'inode de l'ancien (un système de fichiers qui les réutilise aussitôt ; pas APFS, où ils croissent).
 *
 * Laissés de côté, parce que nos propres lectures les font changer sans que la base ait changé :
 * - le verrou (`LOCK`) et les fichiers temporaires `nbs_manifest_…` par lesquels `dolt sql` réécrit le manifest (ils n'existent que 5 ms,
 *   mais un scan peut y tomber) ;
 * - l'index du journal (`journal.idx`) : un lecteur qui l'ouvre alors qu'il retarde sur le journal (celui d'un serveur qui ne l'écrit pas à chaque
 *   commit, d'un processus interrompu) le rattrape et en change la taille, sans qu'aucune donnée n'ait bougé (mesuré : 491 793 → 499 711 octets à
 *   la première lecture d'une copie). Il ne dit rien que le journal ne dise : toute écriture prolonge le journal.
 *
 * `undefined` quand l'empreinte ne peut pas être prise (pas de manifest, dossier illisible, un fichier qui disparaît pendant qu'on le lit) :
 * l'appelant relit alors, ce qui ne peut jamais donner un préfixe faux. C'est aussi le cas d'une disposition que ce code ne connaît pas.
 */
export async function databaseFingerprint(databasePath: string): Promise<string | undefined> {
  const noms = join(databasePath, '.dolt', 'noms');
  try {
    const manifest = await readFile(join(noms, 'manifest'));
    const files = (await readdir(noms, { withFileTypes: true })).filter(
      (entry) => entry.isFile() && !IGNORED.has(entry.name) && !entry.name.startsWith('nbs_manifest_'),
    );
    const traits = await Promise.all(
      files.map(async (entry) => {
        const { size, dev, ino } = await stat(join(noms, entry.name), { bigint: true }); // en entiers exacts : un inode de 64 bits ne tient pas dans un nombre
        return `${entry.name}:${size}:${dev}:${ino}`;
      }),
    );
    return createHash('sha256').update(manifest).update('\0').update(traits.sort().join('\n')).digest('hex');
  } catch {
    return undefined;
  }
}
