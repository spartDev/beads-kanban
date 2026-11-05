import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ProjectUnreadableError } from '../projects/service';
import { createWatcherLog } from './log';
import { createHeadWatcher } from './watcher';

/** Un journal qui garde ce qu'on lui écrit. */
function journal() {
  const lines: string[] = [];
  return { lines, log: { warn: (message: string) => void lines.push(message) } };
}

describe('journal du sondage : un message par changement d’état d’un Projet, jamais un par lecture', () => {
  it('ne dit rien tant que rien n’échoue', () => {
    const { lines, log } = journal();

    createWatcherLog(log);

    expect(lines).toEqual([]);
  });

  it('prévient quand un Projet se met à échouer : le Projet et la cause', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('beta');
    expect(lines[0]).toContain('database is locked');
  });

  it('ne répète pas la même panne, quel que soit le nombre de lectures qui échouent', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    for (let i = 0; i < 500; i++) watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(1);
  });

  it('prévient à nouveau quand la cause change', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onError('beta', new Error('Dossier introuvable'));
    watcherLog.onError('beta', new Error('Dossier introuvable'));

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('Dossier introuvable');
  });

  it('dit une fois que le Projet est rétabli', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    watcherLog.onError('beta', new Error('database is locked'));

    watcherLog.onRecover('beta');
    watcherLog.onRecover('beta');

    expect(lines).toHaveLength(2);
    expect(lines[1]).toContain('beta');
    expect(lines[1]).toMatch(/rétabli/);
  });

  it('ne dit rien d’un rétablissement dont il n’a pas signalé la panne', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onRecover('beta');

    expect(lines).toEqual([]);
  });

  it('une nouvelle panne, même avec la même cause, est un nouveau changement d’état : elle est signalée', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('database is locked'));
    watcherLog.onRecover('beta');
    watcherLog.onError('beta', new Error('database is locked'));

    expect(lines).toHaveLength(3);
  });

  it('suit chaque Projet à part', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('alpha', new Error('illisible'));
    watcherLog.onError('beta', new Error('illisible'));
    watcherLog.onError('alpha', new Error('illisible'));
    watcherLog.onRecover('alpha');
    watcherLog.onError('beta', new Error('illisible'));

    expect(lines).toHaveLength(3); // alpha en panne, beta en panne, alpha rétabli
    expect(lines.filter((line) => line.includes('alpha'))).toHaveLength(2);
    expect(lines.filter((line) => line.includes('beta'))).toHaveLength(1);
  });

  it('donne la raison d’un Projet illisible sans répéter « Projet illisible »', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /x/beta'));

    expect(lines[0]).toContain('Dossier introuvable : /x/beta');
    expect(lines[0]).not.toContain('Projet illisible');
  });

  it('décrit aussi ce qui n’est pas une Error', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', 'texte lancé tel quel');

    expect(lines[0]).toContain('texte lancé tel quel');
  });

  it('écrit chaque message à l’avertissement du journal, en un seul texte', () => {
    const warn = vi.fn();
    const watcherLog = createWatcherLog({ warn });

    watcherLog.onError('beta', new Error('Délai dépassé (60000 ms)'));
    watcherLog.onRecover('beta');

    expect(warn).toHaveBeenCalledTimes(2);
    for (const call of warn.mock.calls) {
      expect(call).toHaveLength(1);
      expect(typeof call[0]).toBe('string');
    }
  });
});

/**
 * Ce que dolt écrit d'une base qu'il ne peut pas ouvrir : une ligne de journal au format de logrus, avec l'heure de la lecture
 * (relevé sur une copie de Projet dont le dossier `noms` est rendu illisible, bdesk-38k.51), que `DoltQueryError` garde telle quelle.
 */
const doltWarning = (time: string, error = 'permission denied') =>
  `time="${time}" level=warning msg="failed to load database with error: fslock new /p/.dolt/noms/LOCK: open /p/.dolt/noms/LOCK: ${error}"`;

describe('journal du sondage : l’heure que dolt écrit dans sa cause ne fait pas une nouvelle panne à chaque lecture (bdesk-38k.51)', () => {
  it('ne signale qu’une fois une panne dont la cause change d’heure à chaque lecture', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    for (let second = 0; second < 50; second++) {
      const time = `2026-11-05T10:37:${String(second).padStart(2, '0')}+01:00`;
      watcherLog.onError('beta', new Error(doltWarning(time)));
    }

    expect(lines).toHaveLength(1);
  });

  it('fait de même pour la raison d’un Projet illisible, qui est la cause que le sondage reçoit en vrai', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new ProjectUnreadableError('beta', doltWarning('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', doltWarning('2026-11-05T10:38:01+01:00')));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', doltWarning('2026-11-05T10:38:13+01:00')));

    expect(lines).toHaveLength(1);
  });

  it('n’écrit pas l’heure de dolt dans la ligne, le journal a la sienne, et garde le reste de la cause', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new Error(doltWarning('2026-11-05T10:37:55+01:00')));

    expect(lines[0]).not.toContain('2026-11-05');
    expect(lines[0]).not.toContain('time=');
    expect(lines[0]).toContain('beta');
    expect(lines[0]).toContain('level=warning');
    expect(lines[0]).toContain('failed to load database with error');
    expect(lines[0]).toContain('permission denied');
    expect(lines[0]).not.toMatch(/ {2}| $/); // l'heure retirée ne laisse ni double espace ni espace de fin
  });

  it.each([
    ['avec un décalage horaire', (s: string) => `2026-11-05T10:37:${s}+01:00`],
    ['en UTC', (s: string) => `2026-11-05T09:37:${s}Z`],
    ['avec des fractions de seconde', (s: string) => `2026-11-05T09:37:${s}.${s}1234567Z`],
    ['sans fuseau', (s: string) => `2026-11-05T09:37:${s}`],
    ['avec une espace au lieu du T', (s: string) => `2026-11-05 09:37:${s}`],
  ])('reconnaît une heure %s', (_name, at) => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(doltWarning(at('05'))));
    watcherLog.onError('beta', new Error(doltWarning(at('11'))));

    expect(lines).toHaveLength(1);
  });

  it('reconnaît une heure sans guillemets', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('time=2026-11-05T09:37:05Z level=warning msg="base illisible"'));
    watcherLog.onError('beta', new Error('time=2026-11-05T09:37:11Z level=warning msg="base illisible"'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('time=');
    expect(lines[0]).toContain('level=warning msg="base illisible"');
  });

  it('retire aussi une heure qui n’est pas dans un champ time=', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('Verrou pris depuis 2026-11-05T10:37:55Z par un autre processus'));
    watcherLog.onError('beta', new Error('Verrou pris depuis 2026-11-05T10:38:01Z par un autre processus'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toBe('Mises à jour en direct, Projet « beta » : Verrou pris depuis par un autre processus');
  });

  it('ne laisse ni espace de tête ni espace de fin à la cause dont on a retiré l’heure', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error('  base verrouillée depuis 2026-11-05T10:37:55Z '));
    watcherLog.onError('beta', new Error('  base verrouillée depuis 2026-11-05T10:38:01Z '));

    expect(lines).toEqual(['Mises à jour en direct, Projet « beta » : base verrouillée depuis']);
  });

  it('ne retire que l’heure : ni la fin d’un autre nom en « time », ni les guillemets d’un autre champ', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('alpha', new Error('uptime=2026-11-05T10:37:55Z'));
    watcherLog.onError('beta', new Error('msg="time=2026-11-05T10:37:55Z" level=warning'));

    expect(lines).toEqual(['Mises à jour en direct, Projet « alpha » : uptime=', 'Mises à jour en direct, Projet « beta » : msg="" level=warning']);
  });

  it('retire toutes les heures d’une cause, pas la première seulement (dolt écrit parfois plusieurs lignes)', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const twice = (first: string, second: string) => `${doltWarning(first)} ${doltWarning(second, 'no such file')}`;

    watcherLog.onError('beta', new Error(twice('2026-11-05T10:37:55+01:00', '2026-11-05T10:37:56+01:00')));
    watcherLog.onError('beta', new Error(twice('2026-11-05T10:38:01+01:00', '2026-11-05T10:38:02+01:00')));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toContain('2026-11-05');
  });

  it('signale une cause réellement différente, même quand elle est horodatée comme la précédente', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:37:55+01:00', 'permission denied')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:01+01:00', 'permission denied')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:07+01:00', 'no such file or directory')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:13+01:00', 'no such file or directory')));
    watcherLog.onError('beta', new Error('corrupt manifest'));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:19+01:00', 'permission denied')));

    expect(lines).toHaveLength(4);
    expect(lines[0]).toContain('permission denied');
    expect(lines[1]).toContain('no such file or directory');
    expect(lines[2]).toContain('corrupt manifest');
    expect(lines[3]).toContain('permission denied');
  });

  it('dit une fois le rétablissement d’une panne horodatée, et signale la panne suivante', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:01+01:00')));
    watcherLog.onRecover('beta');
    watcherLog.onRecover('beta');
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:40:00+01:00')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:40:06+01:00')));

    expect(lines).toHaveLength(3); // panne, rétablissement, nouvelle panne
    expect(lines[1]).toMatch(/rétabli/);
    expect(lines[2]).toContain('permission denied');
  });

  it('suit chaque Projet à part, ses heures aussi', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('alpha', new Error(doltWarning('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('alpha', new Error(doltWarning('2026-11-05T10:38:01+01:00')));
    watcherLog.onError('beta', new Error(doltWarning('2026-11-05T10:38:01+01:00')));

    expect(lines).toHaveLength(2);
  });

  it('écrit telle quelle une cause qui n’a pas d’heure, même avec une date, une durée ou un « time » qui n’en est pas une', () => {
    const { lines, log } = journal();
    const cause = 'Dossier introuvable : /x/2026-11-05/beta, timeout=30s runtime=go1.25 time=5s';

    createWatcherLog(log).onError('beta', new Error(cause));

    expect(lines[0]).toBe(`Mises à jour en direct, Projet « beta » : ${cause}`);
  });

  it('écrit une cause qui n’est qu’une heure plutôt qu’une cause vide', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new Error('time="2026-11-05T10:37:55+01:00"'));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('2026-11-05T10:37:55+01:00');
  });
});

describe('journal du sondage, avec le vrai sondage : une panne dont dolt date chaque lecture reste une ligne (bdesk-38k.51)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-05T10:37:00+01:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit une ligne pour toute la panne, une pour le rétablissement', async () => {
    const { lines, log } = journal();
    let healthy = false;
    // Comme dolt : l'heure de la lecture est dans la cause, donc la cause change à chaque lecture.
    const head = vi.fn(async () => {
      if (healthy) return 'h1';
      throw new Error(doltWarning(new Date().toISOString().replace(/\.\d+Z$/, 'Z')));
    });
    const watcher = createHeadWatcher({ head, intervalMs: 3_000, ...createWatcherLog(log) });
    watcher.subscribe('beta', () => undefined);

    await vi.advanceTimersByTimeAsync(10 * 60_000); // le recul (3, 6, 12, 24, 48 s, puis 1 min) donne une douzaine de lectures
    const readsDuringOutage = head.mock.calls.length;
    expect(readsDuringOutage).toBeGreaterThan(10);
    expect(lines).toHaveLength(1);

    healthy = true;
    await vi.advanceTimersByTimeAsync(60_000);
    watcher.close();

    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/rétabli/);
  });
});

/**
 * Ce que dolt écrit d'une base dont le dossier `noms` est en lecture seule (relevé sur une copie de Projet en `chmod 555`,
 * bdesk-38k.51) : pour une simple lecture il crée son manifeste temporaire sous un nom tiré au sort, et l'erreur le nomme.
 * Ce nom change à chaque lecture, comme l'heure.
 */
const manifestError = (suffix: number | string, error = 'permission denied') => `open /p/.dolt/noms/nbs_manifest_${suffix}: ${error}`;

describe('journal du sondage : le nom tiré au sort du manifeste temporaire de dolt ne fait pas une nouvelle panne à chaque lecture (bdesk-38k.51)', () => {
  it('ne signale qu’une fois un dossier en lecture seule, dont le nom du manifeste change à chaque lecture', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    for (let read = 0; read < 50; read++) watcherLog.onError('beta', new Error(manifestError(1_933_868_292 + read * 7_919)));

    expect(lines).toHaveLength(1);
  });

  it('écrit le nom sans son nombre, qui ne dit rien et change à chaque lecture', () => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new Error(manifestError(1_933_868_292)));

    expect(lines).toEqual(['Mises à jour en direct, Projet « beta » : open /p/.dolt/noms/nbs_manifest_*: permission denied']);
  });

  it('fait de même pour la raison d’un Projet illisible, qui est la cause que le sondage reçoit en vrai', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new ProjectUnreadableError('beta', manifestError(3_172_773_100)));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', manifestError(3_705_600_172)));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', manifestError(1_346_425_919)));

    expect(lines).toHaveLength(1);
  });

  it('quel que soit le nombre de chiffres du nombre tiré au sort', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    for (const suffix of ['7', '42', '227534164', '1933868292', '4294967295']) watcherLog.onError('beta', new Error(manifestError(suffix)));

    expect(lines).toHaveLength(1);
  });

  it('retire les deux ensemble quand l’heure et le nom changent à la fois', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const cause = (time: string, suffix: number) =>
      `time="${time}" level=warning msg="failed to load database with error: ${manifestError(suffix)}"`;

    watcherLog.onError('beta', new Error(cause('2026-11-05T10:37:55+01:00', 3_172_773_100)));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:01+01:00', 3_705_600_172)));

    expect(lines).toHaveLength(1);
    expect(lines[0]).toContain('level=warning msg="failed to load database with error: open /p/.dolt/noms/nbs_manifest_*: permission denied"');
    expect(lines[0]).not.toMatch(/time=|\d{6}/);
  });

  it('retire tous les noms tirés au sort d’une cause, pas le premier seulement', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const cause = (first: number, second: number) => `${manifestError(first)}\n${manifestError(second, 'no such file or directory')}`;

    watcherLog.onError('beta', new Error(cause(1_933_868_292, 227_534_164)));
    watcherLog.onError('beta', new Error(cause(3_172_773_100, 3_705_600_172)));

    expect(lines).toHaveLength(1);
    expect(lines[0]).not.toMatch(/\d{6}/);
  });

  it('signale une cause réellement différente, même quand elle porte un nom de manifeste', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(manifestError(1, 'permission denied')));
    watcherLog.onError('beta', new Error(manifestError(2, 'permission denied')));
    watcherLog.onError('beta', new Error(manifestError(3, 'no space left on device')));
    watcherLog.onError('beta', new Error(manifestError(4, 'no space left on device')));
    watcherLog.onError('beta', new Error('open /p/.dolt/noms/manifest: permission denied'));

    expect(lines).toHaveLength(3);
    expect(lines[0]).toContain('permission denied');
    expect(lines[1]).toContain('no space left on device');
    expect(lines[2]).toContain('noms/manifest: permission denied');
  });

  it('ne retire que le nombre du nom tiré au sort : un autre nom, ou un nom sans nombre, est écrit tel quel', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const causes = [
      'open /p/.dolt/noms/nbs_manifest_: permission denied',
      'open /p/.dolt/noms/nbs_manifest_12abc: permission denied',
      'open /p/.dolt/noms/xnbs_manifest_12: permission denied',
      'open /p/.dolt/noms/other_manifest_12: permission denied',
      'open /p/.dolt/noms/nbs_manifest: permission denied',
    ];

    for (const cause of causes) watcherLog.onError('beta', new Error(cause));

    expect(lines).toEqual(causes.map((cause) => `Mises à jour en direct, Projet « beta » : ${cause}`));
  });

  it('suit chaque Projet à part, leur nom de manifeste aussi', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('alpha', new Error(manifestError(1)));
    watcherLog.onError('beta', new Error(manifestError(2)));
    watcherLog.onError('alpha', new Error(manifestError(3)));
    watcherLog.onError('beta', new Error(manifestError(4)));

    expect(lines).toHaveLength(2);
  });
});

describe('journal du sondage : une date dans un chemin n’est pas l’heure de la lecture (bdesk-38k.51)', () => {
  it.each([
    ['au milieu du chemin', 'Dossier introuvable : /backups/2026-11-05T10:37:55Z/beta'],
    ['avec une espace au lieu du T', 'Dossier introuvable : /snap/2026-11-05 10:00:00/x'],
    ['avec un décalage horaire', 'Dossier introuvable : /snap/2026-11-05T10:37:55+01:00/x'],
    ['avec des fractions de seconde', 'Dossier introuvable : /snap/2026-11-05T10:37:55.123Z/x'],
    ['dernier élément du chemin', 'Dossier introuvable : /backups/2026-11-05T10:37:55Z'],
    ['collée à un préfixe', 'Dossier introuvable : /backups/snap-2026-11-05T10:37:55Z'],
    ['collée à un suffixe', 'Dossier introuvable : /backups/2026-11-05T10:37:55Z-old/beta'],
    ['suivie d’une extension', 'open /backups/2026-11-05T10:37:55Z.bak: no such file or directory'],
    ['collée à un mot, sans dossier', 'Fichier introuvable : snap_2026-11-05T10:37:55Z'],
    ['précédée d’un point, sans dossier', 'Fichier introuvable : backup.2026-11-05T10:37:55Z'],
    ['suivie d’un suffixe, sans dossier', 'Fichier introuvable : snap 2026-11-05T10:37:55Z-old'],
    ['suivie d’une extension, sans dossier', 'Fichier introuvable : snap 2026-11-05T10:37:55Z.bak'],
    ['précédée d’une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05 10:00:00/beta'],
    ['sous Windows', 'Dossier introuvable : C:\\snap\\2026-11-05T10:37:55Z\\beta'],
    // Le fuseau et les fractions sont facultatifs : sans garde contre le retour arrière, l'heure se raccourcirait jusqu'à
    // une heure « sans fuseau » que suit `+`, `,` ou `-`, et le chemin perdrait cette partie (`Time Machine +01:00/beta`).
    ['avec un décalage horaire, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta'],
    ['avec un décalage négatif, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55-05:00/beta'],
    ['avec un décalage sans deux-points, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55+0100/beta'],
    ['avec des fractions à virgule, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55,123/beta'],
    ['avec des fractions à point, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55.123/beta'],
    ['avec des fractions à virgule et un décalage, après une espace dans un nom de dossier', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55,123+01:00/beta'],
    ['avec un décalage suivi d’un suffixe, après une espace', 'Fichier introuvable : snap 2026-11-05T10:37:55+01:00-old'],
    ['avec un décalage suivi d’une extension, après une espace', 'Fichier introuvable : snap 2026-11-05T10:37:55+01:00.bak'],
    ['avec un décalage, sous Windows', 'Dossier introuvable : C:\\Users\\me\\Time Machine 2026-11-05T10:37:55+01:00\\beta'],
  ])('écrit intact un chemin dont un dossier porte une date et une heure : %s', (_name, cause) => {
    const { lines, log } = journal();

    createWatcherLog(log).onError('beta', new ProjectUnreadableError('beta', cause));

    expect(lines).toEqual([`Mises à jour en direct, Projet « beta » : ${cause}`]);
  });

  it('deux raisons qui ne diffèrent que par la date d’un dossier restent deux causes, chacune avec sa date', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /snap/2026-11-05 10:00:00/x'));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /snap/2026-11-04 09:00:00/x'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('/snap/2026-11-05 10:00:00/x');
    expect(lines[1]).toContain('/snap/2026-11-04 09:00:00/x');
  });

  it('retire l’heure de dolt sans toucher à la date d’un chemin de la même ligne', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const cause = (time: string) =>
      `time="${time}" level=warning msg="failed to load database with error: fslock new /backups/2026-11-05T10:37:55Z/beta/.dolt/noms/LOCK: permission denied"`;

    watcherLog.onError('beta', new Error(cause('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:01+01:00')));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:13+01:00')));

    expect(lines).toEqual([
      'Mises à jour en direct, Projet « beta » : level=warning msg="failed to load database with error: fslock new /backups/2026-11-05T10:37:55Z/beta/.dolt/noms/LOCK: permission denied"',
    ]);
  });

  it('deux raisons qui ne diffèrent que par l’heure d’un dossier daté avec décalage restent deux causes, chacune avec son heure', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta'));
    watcherLog.onError('beta', new ProjectUnreadableError('beta', 'Dossier introuvable : /Users/me/Time Machine 2026-11-04T09:00:00+01:00/beta'));

    expect(lines).toHaveLength(2);
    expect(lines[0]).toContain('/Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta');
    expect(lines[1]).toContain('/Users/me/Time Machine 2026-11-04T09:00:00+01:00/beta');
  });

  it('retire l’heure de dolt sans toucher à l’heure, avec son décalage, d’un chemin à espace de la même ligne', () => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);
    const cause = (time: string) =>
      `time="${time}" level=warning msg="failed to load database with error: fslock new /Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta/.dolt/noms/LOCK: permission denied"`;

    watcherLog.onError('beta', new Error(cause('2026-11-05T10:37:55+01:00')));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:01+01:00')));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:13+01:00')));

    expect(lines).toEqual([
      'Mises à jour en direct, Projet « beta » : level=warning msg="failed to load database with error: fslock new /Users/me/Time Machine 2026-11-05T10:37:55+01:00/beta/.dolt/noms/LOCK: permission denied"',
    ]);
  });

  it.each([
    ['entre parenthèses', (time: string) => `Verrou pris (${time}) par un autre processus`, 'Verrou pris () par un autre processus'],
    ['entre guillemets', (time: string) => `Verrou pris "${time}" par un autre processus`, 'Verrou pris "" par un autre processus'],
    ['en fin de phrase', (time: string) => `Verrou pris depuis ${time}.`, 'Verrou pris depuis .'],
    ['après un deux-points', (time: string) => `Verrou pris :${time}`, 'Verrou pris :'],
    ['dans un champ autre que time=', (time: string) => `since=${time} owner=bd`, 'since=owner=bd'],
  ])('retire encore une heure seule : %s', (_name, cause, written) => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(cause('2026-11-05T10:37:55Z')));
    watcherLog.onError('beta', new Error(cause('2026-11-05T10:38:01Z')));

    expect(lines).toEqual([`Mises à jour en direct, Projet « beta » : ${written}`]);
  });

  // La garde contre le retour arrière (`+`, `,` et `.` collés à l'heure) ne doit pas laisser une heure seule : celle de dolt,
  // `time=2026-11-05T10:37:55+01:00`, ou celle qui termine une phrase, avec son décalage ou ses fractions.
  const standalone = [
    ['un décalage horaire', (second: string) => `2026-11-05T10:37:${second}+01:00`],
    ['un décalage négatif', (second: string) => `2026-11-05T10:37:${second}-05:00`],
    ['un décalage sans deux-points', (second: string) => `2026-11-05T10:37:${second}+0100`],
    ['des fractions à virgule', (second: string) => `2026-11-05T10:37:${second},123`],
    ['des fractions à point et un décalage', (second: string) => `2026-11-05T10:37:${second}.123+01:00`],
    ['des fractions à virgule et un décalage', (second: string) => `2026-11-05T10:37:${second},123-05:00`],
  ] as const;
  const standaloneContexts = [
    ['dans un champ time= sans guillemets', (time: string) => `time=${time} level=warning msg="base illisible"`, 'level=warning msg="base illisible"'],
    ['dans un champ time= entre guillemets', (time: string) => `time="${time}" level=warning msg="base illisible"`, 'level=warning msg="base illisible"'],
    ['en fin de cause, après une espace', (time: string) => `Verrou pris depuis ${time}`, 'Verrou pris depuis'],
    ['en fin de phrase', (time: string) => `Verrou pris depuis ${time}.`, 'Verrou pris depuis .'],
    ['avant une virgule', (time: string) => `Verrou pris depuis ${time}, puis rendu`, 'Verrou pris depuis , puis rendu'],
    ['avant un deux-points', (time: string) => `Verrou pris depuis ${time}: base illisible`, 'Verrou pris depuis : base illisible'],
    ['entre parenthèses', (time: string) => `Verrou pris (${time}) par un autre processus`, 'Verrou pris () par un autre processus'],
  ] as const;

  it.each(
    standaloneContexts.flatMap(([context, cause, written]) =>
      standalone.map(([shape, at]) => [`${context}, avec ${shape}`, (second: string) => cause(at(second)), written] as const),
    ),
  )('retire encore une heure seule, avec son fuseau ou ses fractions : %s', (_name, cause, written) => {
    const { lines, log } = journal();
    const watcherLog = createWatcherLog(log);

    watcherLog.onError('beta', new Error(cause('05')));
    watcherLog.onError('beta', new Error(cause('11')));

    expect(lines).toEqual([`Mises à jour en direct, Projet « beta » : ${written}`]);
  });
});

describe('journal du sondage, avec le vrai sondage : une panne de dossier en lecture seule reste une ligne (bdesk-38k.51)', () => {
  beforeEach(() => {
    vi.useFakeTimers({ now: new Date('2026-11-05T10:37:00+01:00') });
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it('écrit une ligne pour toute la panne, une pour le rétablissement', async () => {
    const { lines, log } = journal();
    let healthy = false;
    let reads = 0;
    // Comme dolt : chaque lecture crée son manifeste temporaire sous un nom tiré au sort, que l'erreur nomme.
    const head = vi.fn(async () => {
      if (healthy) return 'h1';
      throw new Error(manifestError(1_933_868_292 + reads++ * 104_729));
    });
    const watcher = createHeadWatcher({ head, intervalMs: 3_000, ...createWatcherLog(log) });
    watcher.subscribe('beta', () => undefined);

    await vi.advanceTimersByTimeAsync(10 * 60_000);
    expect(head.mock.calls.length).toBeGreaterThan(10);
    expect(lines).toHaveLength(1);

    healthy = true;
    await vi.advanceTimersByTimeAsync(60_000);
    watcher.close();

    expect(lines).toHaveLength(2);
    expect(lines[1]).toMatch(/rétabli/);
  });
});
