import { mkdirSync, symlinkSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it, vi } from 'vitest';
import { isKnownTimeZone } from '../../domain/time-zone';
import { scratchDir } from '../testing/scratch';
import { resolveMetricsTimeZone, systemTimeZone } from './time-zone';

describe('resolveMetricsTimeZone : le fuseau qui découpe les jours des métriques', () => {
  const none = () => undefined;

  it('garde un fuseau reconnu tel quel, sans avertissement et sans chercher celui du système', () => {
    const system = vi.fn(() => 'Asia/Tokyo');

    expect(resolveMetricsTimeZone('Europe/Paris', system)).toEqual({ timeZone: 'Europe/Paris' });
    expect(resolveMetricsTimeZone('UTC', system)).toEqual({ timeZone: 'UTC' });
    expect(system).not.toHaveBeenCalled();
  });

  it.each(['Etc/Unknown', 'Invalid/Zone', '', undefined, null, 42])('remplace %j par le fuseau du système quand il se lit', (requested) => {
    const { timeZone, warning } = resolveMetricsTimeZone(requested, () => 'Europe/Paris');

    expect(timeZone).toBe('Europe/Paris');
    expect(warning).toContain('Europe/Paris');
    expect(warning).toContain('système');
  });

  it.each(['Etc/Unknown', 'Invalid/Zone', '', undefined, null, 42])('remplace %j par UTC faute de fuseau du système', (requested) => {
    const { timeZone, warning } = resolveMetricsTimeZone(requested, none);

    expect(timeZone).toBe('UTC');
    expect(warning).toContain('UTC');
  });

  it.each(['Nowhere/Land', 'posix/Europe/Paris', 'Etc/Unknown', '', undefined])(
    'ne se fie pas à un fuseau du système qui n’est pas reconnu non plus (%j) : UTC',
    (system) => {
      expect(resolveMetricsTimeZone('Invalid/Zone', () => system).timeZone).toBe('UTC');
    },
  );

  it('cite dans l’avertissement le nom refusé, pour qu’on sache quoi corriger', () => {
    expect(resolveMetricsTimeZone('Etc/Unknown', none).warning).toContain('Etc/Unknown');
    expect(resolveMetricsTimeZone('Europe/Pariss', none).warning).toContain('Europe/Pariss');
  });

  it('dit sa phrase sans nom quand le moteur n’en donne aucun', () => {
    const { warning } = resolveMetricsTimeZone(undefined, none);

    expect(warning).not.toContain('undefined');
    expect(warning).toContain('TZ');
  });

  it('dit comment choisir le fuseau (définir TZ avec un nom IANA), et que les durées n’en dépendent pas', () => {
    for (const system of [none, () => 'Europe/Paris']) {
      const { warning } = resolveMetricsTimeZone('Etc/Unknown', system);

      expect(warning).toContain('définissez TZ avec un nom IANA (TZ=Europe/Paris) pour choisir le fuseau');
      expect(warning).toContain('les durées n\'en dépendent pas');
    }
  });

  // `TZ=EST5` est une notation POSIX valide (cinq heures à l'ouest de Greenwich), mais le moteur n'en tire aucun nom IANA : il ne rend rien (`undefined`).
  // L'avertissement ne dit donc pas « TZ vide ou invalide ? » : il dit ce que le moteur ne fait pas, et donne ces cas en exemples.
  it('ne devine pas la cause : TZ vide, invalide, ou valide mais en notation POSIX sans nom IANA (EST5)', () => {
    for (const requested of ['Etc/Unknown', undefined]) {
      const { warning } = resolveMetricsTimeZone(requested, none);

      expect(warning).toContain('ne donne pas de nom IANA');
      expect(warning).toContain('vide');
      expect(warning).toContain('invalide');
      expect(warning).toContain('notation POSIX sans nom IANA (EST5)');
      expect(warning).not.toContain('vide ou invalide ?');
    }
  });

  it('tient en une seule ligne : le journal du serveur écrit une ligne par avertissement', () => {
    for (const system of [none, () => 'Europe/Paris']) {
      expect(resolveMetricsTimeZone('Etc/Unknown', system).warning).not.toMatch(/[\r\n]/);
    }
  });

  it('est déterministe : mêmes entrées, même résultat', () => {
    const first = resolveMetricsTimeZone('Etc/Unknown', () => 'Europe/Paris');

    expect(resolveMetricsTimeZone('Etc/Unknown', () => 'Europe/Paris')).toEqual(first);
    expect(resolveMetricsTimeZone('Etc/Unknown', none)).toEqual(resolveMetricsTimeZone('Etc/Unknown', none));
  });

  it('rend toujours un fuseau que `Intl` construit, quoi qu’on lui donne', () => {
    const odd = [undefined, null, '', ' ', 'Etc/Unknown', 'Invalid/Zone', '\u0000', 'Europe/Paris/Extra', 12, {}, [], Symbol.iterator];
    for (const requested of odd) {
      for (const system of [none, () => 'Nowhere/Land', () => 'Europe/Paris', () => 'Etc/Unknown']) {
        const { timeZone } = resolveMetricsTimeZone(requested, system);
        expect(() => new Intl.DateTimeFormat('en-US', { timeZone })).not.toThrow();
      }
    }
  });

  it('cherche le fuseau du système dans /etc/localtime, sauf indication contraire', () => {
    expect(() => resolveMetricsTimeZone('Etc/Unknown')).not.toThrow(); // le vrai système de fichiers : un fuseau reconnu ou UTC
    expect(isKnownTimeZone(resolveMetricsTimeZone('Etc/Unknown').timeZone)).toBe(true);
  });
});

describe('systemTimeZone : le fuseau que le système déclare, au bout de /etc/localtime', () => {
  const resolvesTo = (target: string) => () => target;

  // Ce que `realpathSync` rend, une fois les liens suivis jusqu'au bout : le nom est ce qui suit le dernier dossier `zoneinfo`.
  it.each([
    ['/private/var/db/timezone/tz/2026c.1.0/zoneinfo/Europe/Paris', 'Europe/Paris'], // macOS
    ['/usr/share/zoneinfo/Europe/Paris', 'Europe/Paris'], // Linux
    ['/usr/share/zoneinfo/America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'], // un nom à trois niveaux
    ['/usr/share/zoneinfo/UTC', 'UTC'],
    ['/nix/store/abc-tzdata-2024a/share/zoneinfo/Europe/Paris', 'Europe/Paris'], // Nix
    ['/home/u/zoneinfo/build/zoneinfo/Europe/Paris', 'Europe/Paris'], // le dernier dossier zoneinfo, pas le premier
    ['/usr/share/zoneinfo/posix/Europe/Paris', 'Europe/Paris'], // la copie `posix` de certaines distributions Linux
    ['/usr/share/zoneinfo/right/Europe/Paris', 'Europe/Paris'], // et la copie `right`
    ['/usr/share/zoneinfo/posix/America/Argentina/Buenos_Aires', 'America/Argentina/Buenos_Aires'],
  ])('lit le nom dans %s', (target, name) => {
    expect(systemTimeZone(resolvesTo(target))).toBe(name);
  });

  it('lit /etc/localtime', () => {
    const resolve = vi.fn(() => '/usr/share/zoneinfo/UTC');

    systemTimeZone(resolve);

    expect(resolve).toHaveBeenCalledWith('/etc/localtime');
  });

  it('ne retire `posix` et `right` que devant le nom du fuseau, pas ailleurs', () => {
    expect(systemTimeZone(resolvesTo('/usr/share/zoneinfo/Etc/posix/Paris'))).toBe('Etc/posix/Paris');
    expect(systemTimeZone(resolvesTo('/usr/share/zoneinfo/posixrules'))).toBe('posixrules'); // ce n'est pas un fuseau : `Intl` le refusera
  });

  it('ne trouve rien quand /etc/localtime n’existe pas, boucle, ou n’est pas lisible', () => {
    const fails = (code: string) => () => {
      throw Object.assign(new Error(`${code}: realpath`), { code });
    };

    for (const code of ['ENOENT', 'ELOOP', 'EACCES', 'EPERM']) expect(systemTimeZone(fails(code))).toBeUndefined();
  });

  it('ne trouve rien quand le chemin ne passe pas par un dossier zoneinfo, ou ne nomme rien', () => {
    expect(systemTimeZone(resolvesTo('/etc/localtime'))).toBeUndefined(); // un fichier recopié : realpath le rend tel quel
    expect(systemTimeZone(resolvesTo('/etc/localtime.orig'))).toBeUndefined();
    expect(systemTimeZone(resolvesTo('/usr/share/zoneinfo/'))).toBeUndefined();
    expect(systemTimeZone(resolvesTo('/usr/share/zoneinfo/posix/'))).toBeUndefined();
    expect(systemTimeZone(resolvesTo(''))).toBeUndefined();
  });

  it('ne lève jamais, sur le vrai système comme sur un chemin qui n’a aucun sens', () => {
    expect(() => systemTimeZone()).not.toThrow();
    expect(() => systemTimeZone(resolvesTo('\u0000'))).not.toThrow();
  });
});

describe('systemTimeZone sur de vrais liens (le `realpathSync` par défaut, dans un faux système de fichiers)', () => {
  /**
   * Un faux système de fichiers : `usr/share/zoneinfo` avec Antarctica/Troll (un fuseau que la machine qui lance les tests n'a aucune chance de déclarer :
   * lire le vrai `/etc/localtime` ne donnerait pas le bon nom), et ses copies `posix/` et `right/` (Linux), un `etc/` pour les liens, et un
   * `var/db/timezone` à la macOS, où `zoneinfo` est lui-même un lien vers `tz/2026c.1.0/zoneinfo`.
   */
  function system() {
    const root = scratchDir('bdesk-zoneinfo-');
    const zoneinfo = join(root, 'usr', 'share', 'zoneinfo');
    for (const copy of ['', 'posix', 'right']) {
      mkdirSync(join(zoneinfo, copy, 'Antarctica'), { recursive: true });
      writeFileSync(join(zoneinfo, copy, 'Antarctica', 'Troll'), 'TZif2');
    }
    const versioned = join(root, 'var', 'db', 'timezone', 'tz', '2026c.1.0', 'zoneinfo');
    mkdirSync(join(versioned, 'Antarctica'), { recursive: true });
    writeFileSync(join(versioned, 'Antarctica', 'Troll'), 'TZif2');
    symlinkSync(join('tz', '2026c.1.0', 'zoneinfo'), join(root, 'var', 'db', 'timezone', 'zoneinfo'));
    mkdirSync(join(root, 'etc', 'alternatives'), { recursive: true });
    return { root, zoneinfo, localtime: join(root, 'etc', 'localtime') };
  }
  const read = (localtime: string) => systemTimeZone(undefined, localtime);

  it('suit un lien vers le fichier du fuseau', () => {
    const { zoneinfo, localtime } = system();
    symlinkSync(join(zoneinfo, 'Antarctica', 'Troll'), localtime);

    expect(read(localtime)).toBe('Antarctica/Troll');
  });

  it('suit un lien relatif', () => {
    const { localtime } = system();
    symlinkSync('../usr/share/zoneinfo/Antarctica/Troll', localtime);

    expect(read(localtime)).toBe('Antarctica/Troll');
  });

  it('suit une chaîne de liens : /etc/localtime → /etc/alternatives/localtime → zoneinfo', () => {
    const { root, zoneinfo, localtime } = system();
    const alternative = join(root, 'etc', 'alternatives', 'localtime');
    symlinkSync(join(zoneinfo, 'Antarctica', 'Troll'), alternative);
    symlinkSync(alternative, localtime);

    expect(read(localtime)).toBe('Antarctica/Troll');
  });

  it('retire le dossier posix ou right d’une copie de zoneinfo', () => {
    const { root, zoneinfo, localtime } = system();
    symlinkSync(join(zoneinfo, 'posix', 'Antarctica', 'Troll'), localtime);
    expect(read(localtime)).toBe('Antarctica/Troll');

    const right = join(root, 'etc', 'localtime-right');
    symlinkSync(join(zoneinfo, 'right', 'Antarctica', 'Troll'), right);
    expect(read(right)).toBe('Antarctica/Troll');
  });

  it('suit aussi le dossier zoneinfo quand il est lui-même un lien (macOS : zoneinfo → tz/2026c.1.0/zoneinfo)', () => {
    const { root, localtime } = system();
    symlinkSync(join(root, 'var', 'db', 'timezone', 'zoneinfo', 'Antarctica', 'Troll'), localtime);

    expect(read(localtime)).toBe('Antarctica/Troll');
  });

  it('ne trouve rien pour un fichier recopié, un lien cassé, une boucle de liens ou un lien hors de zoneinfo', () => {
    const { root, zoneinfo, localtime } = system();
    writeFileSync(localtime, 'TZif2'); // un conteneur qui a copié le fichier du fuseau
    expect(read(localtime)).toBeUndefined();

    const broken = join(root, 'etc', 'broken');
    symlinkSync(join(zoneinfo, 'Antarctica', 'Nowhere'), broken);
    expect(read(broken)).toBeUndefined();

    const loop = join(root, 'etc', 'loop');
    symlinkSync(loop, loop);
    expect(read(loop)).toBeUndefined();

    const elsewhere = join(root, 'etc', 'elsewhere');
    writeFileSync(join(root, 'etc', 'alternatives', 'Troll'), 'TZif2');
    symlinkSync(join(root, 'etc', 'alternatives', 'Troll'), elsewhere);
    expect(read(elsewhere)).toBeUndefined();

    expect(read(join(root, 'etc', 'absent'))).toBeUndefined();
  });
});
