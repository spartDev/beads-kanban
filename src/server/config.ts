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
  /**
   * Intervalle, en millisecondes, du sondage du HEAD Dolt qui alimente les mises à jour en direct (entre 500 et
   * 3 600 000). Absent : 3 s. Chaque Projet ouvert dans un onglet coûte une lecture (un processus `dolt`, une
   * centaine de millisecondes) par intervalle.
   */
  pollIntervalMs?: number;
}

export const MIN_POLL_INTERVAL_MS = 500;
export const MAX_POLL_INTERVAL_MS = 3_600_000;

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
    ...('pollIntervalMs' in raw ? { pollIntervalMs: checkedPollInterval(raw.pollIntervalMs, configPath) } : {}),
  };
}

/** Une valeur hors des bornes (ou qui n'est pas un nombre) est signalée, comme un JSON invalide : jamais ignorée en silence. */
function checkedPollInterval(value: unknown, configPath: string): number {
  if (typeof value === 'number' && value >= MIN_POLL_INTERVAL_MS && value <= MAX_POLL_INTERVAL_MS) return value;
  throw new Error(
    `Configuration invalide dans ${configPath} : pollIntervalMs doit être un nombre de millisecondes entre ${MIN_POLL_INTERVAL_MS} et ${MAX_POLL_INTERVAL_MS}.`,
  );
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
