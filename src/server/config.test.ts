import { writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';
import { scratchDir } from './testing/scratch';

const home = '/Users/someone';

describe('loadConfig', () => {
  it('scanne ~/Developer quand aucun fichier de configuration n’existe', () => {
    const config = loadConfig({ home, configPath: join(tmpdir(), 'absent', 'config.json') });

    expect(config.roots).toEqual(['/Users/someone/Developer']);
    expect(config.projects).toEqual([]);
    expect(config.hiddenProjects).toEqual([]);
  });

  it('lit les racines du fichier de configuration et développe le ~', () => {
    const dir = scratchDir('bdesk-config-');
    const configPath = join(dir, 'config.json');
    writeFileSync(
      configPath,
      JSON.stringify({ roots: ['~/code', '/opt/work'], projects: ['~/elsewhere/app', '/srv/api'], hiddenProjects: ['~/code/old'] }),
    );

    const config = loadConfig({ home, configPath });

    expect(config.roots).toEqual(['/Users/someone/code', '/opt/work']);
    expect(config.projects).toEqual(['/Users/someone/elsewhere/app', '/srv/api']);
    expect(config.hiddenProjects).toEqual(['/Users/someone/code/old']);
  });

  it('signale un fichier de configuration invalide plutôt que de l’ignorer', () => {
    const dir = scratchDir('bdesk-config-');
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, '{ roots: oops');

    expect(() => loadConfig({ home, configPath })).toThrow(configPath);
  });
});

describe('loadConfig : pollIntervalMs (intervalle du sondage des mises à jour en direct)', () => {
  const configWith = (content: unknown) => {
    const dir = scratchDir('bdesk-config-');
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, JSON.stringify(content));
    return { configPath, load: () => loadConfig({ home, configPath }) };
  };

  it('est absent par défaut : le serveur prend alors 3 secondes', () => {
    const config = loadConfig({ home, configPath: join(tmpdir(), 'absent', 'config.json') });

    expect(config.pollIntervalMs).toBeUndefined();
    expect(Object.keys(config)).not.toContain('pollIntervalMs');
  });

  it('se lit dans le fichier de configuration', () => {
    expect(configWith({ pollIntervalMs: 1500 }).load().pollIntervalMs).toBe(1500);
  });

  it.each([500, 3_600_000])('accepte les bornes (%i ms)', (value) => {
    expect(configWith({ pollIntervalMs: value }).load().pollIntervalMs).toBe(value);
  });

  it.each([['0', 0], ['négatif', -3000], ['sous la borne', 499], ['au-delà d’une heure', 3_600_001], ['une chaîne', '3000'], ['un booléen', true], ['null', null], ['un tableau', [3000]], ['un objet', {}]])(
    'refuse %s, en nommant le fichier et la règle',
    (_label, value) => {
      const { configPath, load } = configWith({ pollIntervalMs: value });

      expect(load).toThrow(configPath);
      expect(load).toThrow(/pollIntervalMs/);
      expect(load).toThrow(/500/);
    },
  );

  it('ne touche pas au reste de la configuration', () => {
    const config = configWith({ roots: ['/opt/work'], pollIntervalMs: 2000 }).load();

    expect(config).toEqual({ roots: ['/opt/work'], projects: [], hiddenProjects: [], pollIntervalMs: 2000 });
  });
});
