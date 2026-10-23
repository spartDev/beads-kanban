import { readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';

export interface Config {
  /** Dossiers racines scannés à la recherche de Projets. */
  roots: string[];
  /** Projets ajoutés manuellement, hors des racines (chemins de dossiers contenant `.beads/`). */
  projects: string[];
  /** Projets masqués manuellement (chemins absolus). */
  hiddenProjects: string[];
}

export function defaultConfigPath(home = homedir()): string {
  return join(home, '.config', 'beads-desktop', 'config.json');
}

export function loadConfig({ home = homedir(), configPath = defaultConfigPath(home) } = {}): Config {
  const raw = readJson(configPath);
  const expand = (p: string) => (p === '~' || p.startsWith('~/') ? join(home, p.slice(1)) : p);
  return {
    roots: (raw.roots ?? ['~/Developer']).map(expand),
    projects: (raw.projects ?? []).map(expand),
    hiddenProjects: (raw.hiddenProjects ?? []).map(expand),
  };
}

function readJson(path: string): Partial<Config> {
  let text: string;
  try {
    text = readFileSync(path, 'utf8');
  } catch (err) {
    if ((err as NodeJS.ErrnoException).code === 'ENOENT') return {};
    throw err;
  }
  try {
    return JSON.parse(text) as Partial<Config>;
  } catch (err) {
    throw new Error(`Configuration invalide dans ${path} : ${(err as Error).message}`);
  }
}
