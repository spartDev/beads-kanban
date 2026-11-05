import { appendFileSync, copyFileSync, mkdirSync, readdirSync, realpathSync, renameSync, utimesSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Config } from '../config';
import { type DoltClient, DoltQueryError } from '../dolt/client';
import { buildServer } from '../server';
import { scratchDir } from '../testing/scratch';
import { discoverProjects } from './discovery';
import { createProjectService } from './service';

/**
 * Le scan incrémental des Projets (bdesk-38k.43). Un scan lit le préfixe des tickets de chaque Projet, un processus `dolt` par Projet : 98 %
 * de sa durée (de 2,4 à 3,8 s pour 40 Projets, mesuré), alors que ce préfixe ne change presque jamais. Un scan ne relit donc que le préfixe des
 * Projets nouveaux, illisibles, ou dont la base a changé depuis le scan précédent.
 *
 * « A changé » est jugé sur l'EMPREINTE de la base, jamais sur la date de ses fichiers : nos propres lectures (`dolt sql`) réécrivent la date de
 * `manifest`, de `journal.idx` et du journal à chaque appel (ADR 0002), sans changer un octet. L'empreinte est le contenu de `.dolt/noms/manifest`
 * et la taille des autres fichiers de `.dolt/noms`, sauf le verrou, les fichiers temporaires des lecteurs et `journal.idx` (un lecteur qui le
 * rattrape en change la taille sans que la base ait changé). Une écriture de `bd` en mode embedded change le manifest et le journal ; une écriture
 * par un `dolt sql-server` (mode server) ne change que la taille du journal, le manifest ne bouge pas (mesuré avec Dolt 2.5.0).
 *
 * Ici sur des dossiers de bases fabriqués (les fichiers que Dolt y écrit, que le test modifie comme le ferait une écriture) et un faux client dolt qui
 * compte les lectures de préfixe ; les vraies bases Dolt sont dans `incremental.integration.test.ts`.
 */

let root: string;

beforeEach(() => {
  root = realpathSync(scratchDir('bdesk-incremental-'));
});

afterEach(() => {
  vi.useRealTimers();
});

/** Fait passer `ms` millisecondes pour le service (qui date ses scans avec `Date.now`) : l'horloge saute, puis reste figée. */
function elapse(ms: number): void {
  const now = Date.now();
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(now + ms);
}

const config = (overrides: Partial<Config> = {}): Config => ({ roots: [root], projects: [], hiddenProjects: [], ...overrides });

const JOURNAL = 'vvvvvvvvvvvvvvvvvvvvvvvvvvvvvvvv';
const hash = (n: number) => String(n).padStart(32, '0');
/** Le manifest de Dolt : version, format, verrou, racine, génération, puis le journal et son nombre de chunks. Deux `n` à un chiffre : même longueur. */
const manifest = (n: number) => `5:__DOLT__:${hash(n)}:${hash(n + 100)}:${hash(0)}:${JOURNAL}:${17_000 + n}`;

const databaseOf = (name: string) => join(root, name, '.beads', 'embeddeddolt', name);
const nomsOf = (name: string) => join(databaseOf(name), '.dolt', 'noms');

/**
 * Un Projet Dolt embedded dans `root`, avec le dossier de sa base tel que Dolt le laisse : `manifest`, le journal, `journal.idx` et le verrou.
 * `files: false` : un dossier `.dolt` vide, sans rien de tout cela (aucune empreinte possible).
 */
function project(name: string, { files = true, config: yaml }: { files?: boolean; config?: string } = {}): void {
  const beads = join(root, name, '.beads');
  mkdirSync(beads, { recursive: true });
  writeFileSync(join(beads, 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: name }));
  if (yaml !== undefined) writeFileSync(join(beads, 'config.yaml'), yaml);
  const noms = nomsOf(name);
  mkdirSync(noms, { recursive: true });
  if (!files) return;
  writeFileSync(join(noms, 'manifest'), manifest(1));
  writeFileSync(join(noms, JOURNAL), 'journal initial\n');
  writeFileSync(join(noms, 'journal.idx'), 'index initial\n');
  writeFileSync(join(noms, 'LOCK'), '');
}

/** Ce que fait une écriture de bd en mode embedded : le manifest est réécrit (autre verrou et autre racine), le journal et son index grossissent. */
function embeddedWrite(name: string, n = 2): void {
  const noms = nomsOf(name);
  writeFileSync(join(noms, 'manifest'), manifest(n));
  appendFileSync(join(noms, JOURNAL), 'écriture\n');
  appendFileSync(join(noms, 'journal.idx'), 'entrée\n');
}

/** Ce que fait une écriture par un `dolt sql-server` (mode server) : seul le journal grossit, le manifest ne bouge pas. */
function serverWrite(name: string): void {
  appendFileSync(join(nomsOf(name), JOURNAL), 'écriture du serveur\n');
}

/**
 * Ce que fait une restauration, une re-synchronisation ou une copie d'un autre poste : la base du Projet est remplacée par une copie, en fichiers neufs
 * (donc d'autres numéros d'inode), aux mêmes octets. L'ancienne reste là, sous un autre nom : ses inodes restent pris, le test ne dépend pas de la
 * réutilisation des numéros par le système de fichiers.
 */
function replaceDatabase(name: string): void {
  const old = `${databaseOf(name)}.ancienne`;
  renameSync(databaseOf(name), old);
  mkdirSync(nomsOf(name), { recursive: true });
  for (const file of readdirSync(join(old, '.dolt', 'noms'))) copyFileSync(join(old, '.dolt', 'noms', file), join(nomsOf(name), file));
}

/** Ce que fait une lecture de dolt : la date de modification de chaque fichier de la base change, jamais leur contenu. */
function readTouch(name: string): void {
  const later = new Date(Date.now() + 60_000);
  for (const file of readdirSync(nomsOf(name))) utimesSync(join(nomsOf(name), file), later, later);
}

/**
 * Un faux client dolt : le préfixe que chaque base rend (par nom de Projet ; `null` : la base n'en a pas), les lectures reçues dans l'ordre
 * (le nom du Projet), et ce que `during` fait pendant une lecture (pour y poser une écriture concurrente).
 */
function prefixDolt(prefixes: Record<string, string | null>) {
  const reads: string[] = [];
  const failing = new Set<string>();
  let during: ((name: string) => void) | undefined;
  const client: DoltClient = {
    open: (dir) => ({
      dir,
      async query(sql: string) {
        if (!sql.includes("'issue_prefix'")) return [];
        const name = dir.split('/').pop() ?? '';
        reads.push(name);
        during?.(name);
        if (failing.has(name)) throw new DoltQueryError('base verrouillée par un autre processus', dir);
        const prefix = prefixes[name];
        return prefix ? [{ value: prefix }] : [];
      },
    }),
  };
  return {
    client,
    reads,
    prefixes,
    fail: (name: string) => void failing.add(name),
    heal: (name: string) => void failing.delete(name),
    during: (hook: ((name: string) => void) | undefined) => {
      during = hook;
    },
    /** Les lectures reçues depuis le dernier appel, par ordre alphabétique : un scan lit les bases en parallèle, dans un ordre qui varie. */
    since: () => reads.splice(0).sort(),
  };
}

const prefixesOf = (projects: { name: string; prefix: string }[]) => projects.map((p) => [p.name, p.prefix]);

describe('discoverProjects avec le scan précédent', () => {
  beforeEach(() => {
    for (const name of ['a', 'b', 'c']) project(name);
  });

  it('ne relit pas le préfixe d’une base dont rien n’a changé depuis le scan précédent', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    expect(dolt.since()).toEqual(['a', 'b', 'c']);

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual([]);
    expect(second.projects).toEqual(first.projects);
    expect(prefixesOf(second.projects)).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc']]);
  });

  it('relit la base qu’une écriture de bd (mode embedded : manifest, journal, index) a changée, et elle seule', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    embeddedWrite('b');
    dolt.prefixes.b = 'pb-renomme'; // bd rename-prefix

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['b']);
    expect(prefixesOf(second.projects)).toEqual([['a', 'pa'], ['b', 'pb-renomme'], ['c', 'pc']]);
  });

  it('relit la base qu’un dolt sql-server a écrite : le journal grossit, le manifest ne bouge pas', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    serverWrite('c');
    dolt.prefixes.c = 'pc-renomme';

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['c']);
    expect(prefixesOf(second.projects)).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc-renomme']]);
  });

  it('relit la base dont seul le contenu du manifest a changé, à tailles de fichiers égales', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    writeFileSync(join(nomsOf('a'), 'manifest'), manifest(2)); // même longueur, autre verrou et autre racine

    await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['a']);
  });

  it('ne relit pas une base dont seule la date des fichiers a changé : c’est ce que fait chacune de nos lectures', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    for (const name of ['a', 'b', 'c']) readTouch(name);

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual([]);
    expect(second.projects).toEqual(first.projects);
  });

  it('ne relit pas une base dont seul l’index du journal a changé : un lecteur qui le rattrape le réécrit, sans qu’aucune donnée n’ait bougé', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    appendFileSync(join(nomsOf('a'), 'journal.idx'), 'entrées rattrapées à la première lecture\n'); // mesuré : 491 793 → 499 711 octets sur une copie de base

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual([]);
    expect(second.projects).toEqual(first.projects);
  });

  it('ne tient compte ni du verrou ni du fichier temporaire d’un lecteur en cours (nbs_manifest_…)', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    // un lecteur de l'app (la sonde du HEAD, une fiche) a son fichier temporaire à l'instant du scan ; un verrou apparaît ou change
    writeFileSync(join(nomsOf('a'), 'nbs_manifest_x1y2z3'), manifest(1));
    writeFileSync(join(nomsOf('b'), 'LOCK'), 'pid 4242\n');

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual([]);
    expect(second.projects).toEqual(first.projects);
  });

  it('relit toujours une base dont on ne peut pas prendre l’empreinte (pas de manifest)', async () => {
    project('nu', { files: false });
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc', nu: 'pnu' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['nu']);
    expect(second.projects.find((p) => p.name === 'nu')).toMatchObject({ prefix: 'pnu', status: 'ok' });
  });

  it('relit un Projet que le scan précédent a dit illisible, même si sa base n’a pas changé', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    dolt.fail('b'); // base verrouillée un instant par bd
    const first = await discoverProjects(config(), { dolt: dolt.client });
    expect(first.projects.find((p) => p.name === 'b')).toMatchObject({ status: 'unreadable' });
    dolt.since();
    dolt.heal('b');

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['b']);
    expect(second.projects.find((p) => p.name === 'b')).toMatchObject({ status: 'ok', prefix: 'pb' });
  });

  it('rend toujours le préfixe de config.yaml quand la base n’en a pas, même si elle n’a pas changé', async () => {
    project('repli', { config: 'issue-prefix: ancien\n' });
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc', repli: null });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    expect(first.projects.find((p) => p.name === 'repli')?.prefix).toBe('ancien');
    dolt.since();
    writeFileSync(join(root, 'repli', '.beads', 'config.yaml'), 'issue-prefix: nouveau\n'); // config.yaml n'est pas dans la base

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual([]);
    expect(second.projects.find((p) => p.name === 'repli')?.prefix).toBe('nouveau');
  });

  it('prend l’empreinte avant de lire : une écriture pendant la lecture est vue par le scan suivant', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    // pendant la première lecture de `a`, bd écrit ; la lecture, elle, rend encore l'ancien préfixe
    dolt.during((name) => {
      if (name === 'a') {
        dolt.during(undefined);
        embeddedWrite('a');
      }
    });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    expect(prefixesOf(first.projects)[0]).toEqual(['a', 'pa']);
    dolt.since();
    dolt.prefixes.a = 'pa-apres-l-ecriture';

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['a']);
    expect(prefixesOf(second.projects)[0]).toEqual(['a', 'pa-apres-l-ecriture']);
  });

  it('relit une base qu’une autre copie a remplacée au même chemin, même aux mêmes octets (restauration, re-synchronisation)', async () => {
    // deux copies divergentes d'une base en mode server, écrites d'une valeur de même longueur et copiées serveur en marche, ont les mêmes octets :
    // le manifest ne bouge pas en mode server, et le journal grandit du même nombre d'octets (relecture de bdesk-38k.43, B1)
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    replaceDatabase('a');
    dolt.prefixes.a = 'pa-autre-copie';

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['a']);
    expect(prefixesOf(second.projects)).toEqual([['a', 'pa-autre-copie'], ['b', 'pb'], ['c', 'pc']]);
  });

  it('relit une base dont le seul journal a été remplacé par un fichier neuf aux mêmes octets, mais pas celle dont on réécrit les octets en place', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    const journal = (name: string) => join(nomsOf(name), JOURNAL);
    writeFileSync(`${journal('a')}.neuf`, 'journal initial\n');
    renameSync(`${journal('a')}.neuf`, journal('a')); // un fichier neuf (rsync, restauration) prend la place du journal : un autre inode
    writeFileSync(journal('b'), 'journal initial\n'); // les mêmes octets réécrits dans le même fichier : rien n'a changé, ni l'inode ni le contenu
    dolt.prefixes.a = 'pa-neuf';

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['a']);
    expect(prefixesOf(second.projects)).toEqual([['a', 'pa-neuf'], ['b', 'pb'], ['c', 'pc']]);
  });

  it('garde la mémoire de chaque base, pas celle d’un contenu : deux bases aux fichiers identiques gardent chacune leur préfixe', async () => {
    // des copies de bases (comme les 40 du banc de mesure) : mêmes octets, mais ce sont deux Projets
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(prefixesOf(second.projects)).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc']]);
    expect(dolt.since()).toEqual([]);
  });

  it('relit une base que le Projet désigne maintenant par un autre dossier, même aux fichiers identiques', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc', a2: 'pa2' });
    const first = await discoverProjects(config(), { dolt: dolt.client });
    dolt.since();
    // `a` désigne désormais `a2`, une copie de sa base : mêmes octets, un autre dossier
    const copy = join(root, 'a', '.beads', 'embeddeddolt', 'a2', '.dolt', 'noms');
    mkdirSync(copy, { recursive: true });
    for (const file of readdirSync(nomsOf('a'))) copyFileSync(join(nomsOf('a'), file), join(copy, file));
    writeFileSync(join(root, 'a', '.beads', 'metadata.json'), JSON.stringify({ backend: 'dolt', database: 'dolt', dolt_mode: 'embedded', dolt_database: 'a2' }));

    const second = await discoverProjects(config(), { dolt: dolt.client, previous: first });

    expect(dolt.since()).toEqual(['a2']);
    expect(second.projects.find((p) => p.name === 'a')).toMatchObject({ prefix: 'pa2', status: 'ok' });
  });
});

describe('le service garde le dernier scan pour le suivant', () => {
  beforeEach(() => {
    for (const name of ['a', 'b', 'c']) project(name);
  });

  it('un rescan voit un Projet ajouté (lu) et une base écrite (relue), et ne lit pas les autres', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc', d: 'pd' });
    const service = createProjectService(config(), { dolt: dolt.client });
    await service.list();
    expect(dolt.since()).toEqual(['a', 'b', 'c']);
    elapse(3_000); // ce scan a plus de 2 s : le prochain list() en lance un autre
    project('d');
    embeddedWrite('b');
    dolt.prefixes.b = 'pb-renomme';

    const { projects } = await service.list();

    expect(dolt.since()).toEqual(['b', 'd']);
    expect(prefixesOf(projects)).toEqual([['a', 'pa'], ['b', 'pb-renomme'], ['c', 'pc'], ['d', 'pd']]);
  });

  it('un rescan sans écriture ne lance aucune lecture de préfixe, mais voit tout de même un Projet masqué', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const hidden = { value: [] as string[] };
    const service = createProjectService({ roots: [root], projects: [], hiddenProjects: hidden.value }, { dolt: dolt.client });
    await service.list();
    dolt.since();
    elapse(3_000);
    hidden.value.push(join(root, 'b')); // la configuration est celle d'un scan à l'autre : le scan suivant la relit

    const { projects } = await service.list();

    expect(dolt.since()).toEqual([]);
    expect(projects.map((p) => p.name)).toEqual(['a', 'c']);
  });

  it('un scan qui échoue ne fait pas perdre ce que le dernier scan achevé avait lu', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    let broken = false;
    const service = createProjectService(
      {
        get roots() {
          if (broken) throw new Error('racine illisible');
          return [root];
        },
        projects: [],
        hiddenProjects: [],
      },
      { dolt: dolt.client },
    );
    await service.list();
    dolt.since();
    elapse(3_000);
    broken = true;
    await expect(service.list()).rejects.toThrow('racine illisible');
    broken = false;
    elapse(500); // un scan qui a échoué n'est relancé qu'au bout de 500 ms, après le premier échec (bdesk-38k.47)

    const { projects } = await service.list();

    expect(dolt.since()).toEqual([]); // le scan suivant repart du dernier scan achevé, pas de rien
    expect(prefixesOf(projects)).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc']]);
  });

  it('GET /api/projects rend le préfixe à jour après une écriture, sans relire les bases inchangées', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const app = buildServer({ config: config(), projects: createProjectService(config(), { dolt: dolt.client }) });
    const get = async () => ((await app.inject({ method: 'GET', url: '/api/projects' })).json() as { projects: { name: string; prefix: string }[] }).projects;
    expect(prefixesOf(await get())).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc']]);
    dolt.since();
    elapse(3_000);

    expect(prefixesOf(await get())).toEqual([['a', 'pa'], ['b', 'pb'], ['c', 'pc']]);
    expect(dolt.since()).toEqual([]);

    elapse(3_000);
    serverWrite('a');
    dolt.prefixes.a = 'pa-renomme';

    expect(prefixesOf(await get())).toEqual([['a', 'pa-renomme'], ['b', 'pb'], ['c', 'pc']]);
    expect(dolt.since()).toEqual(['a']);
    await app.close();
  });

  it('un scan qui dure plus de 2 s sert de cache à la demande faite aussitôt après sa fin : la fenêtre compte depuis la fin du scan, pas depuis son début', async () => {
    // sans empreinte (dossier .dolt vide), chaque scan lit le préfixe : une lecture = un scan
    project('seul', { files: false });
    const dolt = prefixDolt({ seul: 'ps' });
    dolt.during(() => {
      dolt.during(undefined);
      elapse(2_500); // la lecture du préfixe dure 2,5 s pour le service, qui date ses scans avec Date.now
    });
    const service = createProjectService({ roots: [join(root, 'seul')], projects: [], hiddenProjects: [] }, { dolt: dolt.client });
    await service.list();
    expect(dolt.since()).toEqual(['seul']);

    await service.list(); // demandée aussitôt après la fin du premier scan

    expect(dolt.since()).toEqual([]); // le dernier scan vient de finir : pas de second scan
  });

  it('l’API n’expose rien de la mémoire du scan : ni empreinte, ni dossier de base', async () => {
    const dolt = prefixDolt({ a: 'pa', b: 'pb', c: 'pc' });
    const app = buildServer({ config: config(), projects: createProjectService(config(), { dolt: dolt.client }) });

    const body = (await app.inject({ method: 'GET', url: '/api/projects' })).body;

    expect(body).not.toMatch(/fingerprint|empreinte|prefixRead|databasePath|manifest/i);
    await app.close();
  });
});
