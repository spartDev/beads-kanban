import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { loadConfig } from './config';

const home = '/Users/someone';

describe('loadConfig', () => {
  it('scanne ~/Developer quand aucun fichier de configuration n’existe', () => {
    const config = loadConfig({ home, configPath: join(tmpdir(), 'absent', 'config.json') });

    expect(config.roots).toEqual(['/Users/someone/Developer']);
    expect(config.projects).toEqual([]);
    expect(config.hiddenProjects).toEqual([]);
  });

  it('lit les racines du fichier de configuration et développe le ~', () => {
    const dir = mkdtempSync(join(tmpdir(), 'bdesk-config-'));
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
    const dir = mkdtempSync(join(tmpdir(), 'bdesk-config-'));
    const configPath = join(dir, 'config.json');
    writeFileSync(configPath, '{ roots: oops');

    expect(() => loadConfig({ home, configPath })).toThrow(configPath);
  });
});
