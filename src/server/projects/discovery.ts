import { readdir, readFile, realpath, stat } from 'node:fs/promises';
import { basename, join, resolve } from 'node:path';
import type { IgnoredFolder, Project, ProjectMode } from '../../shared/api';
import type { Config } from '../config';
import { createDoltClient, type DoltClient } from '../dolt/client';
import { readIssuePrefix } from '../dolt/reader';

/** Un Projet découvert, avec l'emplacement de sa base (absent quand elle est introuvable). */
export interface DiscoveredProject extends Project {
  /** Dossier de la base Dolt, celui où lancer `dolt sql`. */
  databasePath?: string;
}

export interface Discovery {
  projects: DiscoveredProject[];
  /** Dossiers contenant `.beads/` mais qui ne sont pas des Projets Dolt, avec la raison. */
  ignored: IgnoredFolder[];
}

export interface DiscoveryOptions {
  dolt?: DoltClient;
}

/** Profondeur de scan sous une racine : `racine/projet` et `racine/groupe/projet`. */
const MAX_DEPTH = 2;
const SKIPPED_FOLDERS = new Set(['node_modules']);

/**
 * Cherche les Projets : les dossiers contenant `.beads/` sous les racines de la configuration, plus ceux
 * ajoutés à la main, moins ceux masqués. Seuls les workspaces Dolt sont des Projets ; les autres sont
 * listés à part avec la raison pour laquelle ils sont ignorés.
 */
export async function discoverProjects(config: Config, { dolt = createDoltClient() }: DiscoveryOptions = {}): Promise<Discovery> {
  // Masqués par chemin canonique (sur macOS, /var et /tmp sont des liens vers /private/…), comme les dossiers trouvés.
  const hidden = new Set(await Promise.all(config.hiddenProjects.map(canonicalPath)));
  const scanned = (await Promise.all(config.roots.map((root) => findWorkspaces(resolve(root))))).flat();
  const manual = config.projects.map((p) => resolve(p));

  const ignored: IgnoredFolder[] = [];
  const byRealPath = new Map<string, string[]>(); // un même dossier atteint par plusieurs chemins (liens symboliques)
  for (const path of [...new Set([...scanned, ...manual])].sort()) {
    const real = await canonicalPath(path);
    if (hidden.has(path) || hidden.has(real)) continue;
    if (!(await isDirectory(join(path, '.beads')))) {
      ignored.push({ path, reason: 'Aucun dossier .beads dans ce dossier ajouté à la main.' });
      continue;
    }
    byRealPath.set(real, [...(byRealPath.get(real) ?? []), path]);
  }
  const folders = [...byRealPath].map(([real, paths]) => paths.find((p) => p === real) ?? paths[0]).filter((p) => p !== undefined);

  const workspaces = await Promise.all(folders.map(async (path) => ({ path, workspace: await inspectWorkspace(path, dolt) })));

  const projects: Omit<DiscoveredProject, 'id'>[] = [];
  for (const { path, workspace } of workspaces) {
    if (workspace.kind === 'ignored') ignored.push({ path, reason: workspace.reason });
    else projects.push({ ...workspace.project, name: basename(path), path });
  }
  projects.sort((a, b) => a.name.localeCompare(b.name, 'en', { sensitivity: 'base' }) || a.path.localeCompare(b.path));

  return {
    projects: assignIds(projects),
    ignored: ignored.sort((a, b) => a.path.localeCompare(b.path)),
  };
}

type Workspace =
  | { kind: 'ignored'; reason: string }
  | { kind: 'dolt'; project: Omit<DiscoveredProject, 'id' | 'name' | 'path'> };

/** Lit `.beads/` d'un dossier : Projet Dolt (lisible ou non) ou workspace ignoré. */
async function inspectWorkspace(path: string, dolt: DoltClient): Promise<Workspace> {
  const beads = join(path, '.beads');
  const metadata = await readJson(join(beads, 'metadata.json'));
  if (metadata === undefined) {
    return { kind: 'ignored', reason: 'Pas de metadata.json dans .beads : workspace beads incomplet, sans base Dolt.' };
  }
  if (metadata === null) return { kind: 'ignored', reason: 'metadata.json illisible (JSON invalide).' };

  const database = str(metadata.database);
  if (metadata.backend !== 'dolt' && database !== 'dolt') {
    const kind = database.endsWith('.db') || metadata.backend === 'sqlite' ? `SQLite (${database || 'sqlite'})` : `« ${str(metadata.backend) || database || 'inconnu'} »`;
    return { kind: 'ignored', reason: `Workspace ${kind} : seuls les Projets Dolt sont suivis.` };
  }

  const databaseName = str(metadata.dolt_database);
  const declaredMode = str(metadata.dolt_mode);
  const mode: ProjectMode = declaredMode === 'embedded' || (declaredMode === '' && (await isDirectory(join(beads, 'embeddeddolt')))) ? 'embedded' : 'server';
  const fallbackPrefix = (await readConfigPrefix(join(beads, 'config.yaml'))) ?? databaseName;

  const unreadable = (reason: string, databasePath?: string): Workspace => ({
    kind: 'dolt',
    project: { prefix: fallbackPrefix, mode, status: 'unreadable', reason, databasePath },
  });

  if (declaredMode !== '' && declaredMode !== 'embedded' && declaredMode !== 'server') {
    return unreadable(`Mode Dolt « ${declaredMode} » non pris en charge (embedded et server seulement).`);
  }

  const folder = mode === 'embedded' ? 'embeddeddolt' : 'dolt';
  const databasePath = await locateDatabase(join(beads, folder), databaseName);
  if (!databasePath) {
    const where = join('.beads', folder, databaseName || '<base>');
    return unreadable(
      mode === 'server'
        ? `Base Dolt absente de ce poste (${where} introuvable) : le Projet est en mode server, sa base n'est pas disponible localement.`
        : `Base Dolt introuvable (${where}).`,
    );
  }

  try {
    const prefix = await readIssuePrefix(dolt.open(databasePath));
    return { kind: 'dolt', project: { prefix: prefix ?? fallbackPrefix, mode, status: 'ok', databasePath } };
  } catch (err) {
    return unreadable((err as Error).message, databasePath);
  }
}

/** La base `name` dans `parent`, ou, sans nom déclaré, l'unique base qui s'y trouve. */
async function locateDatabase(parent: string, name: string): Promise<string | undefined> {
  if (name) {
    const path = join(parent, name);
    return (await isDirectory(join(path, '.dolt'))) ? path : undefined;
  }
  const folders = await listFolders(parent);
  const databases = (await Promise.all(folders.map(async (f) => ((await isDirectory(join(parent, f, '.dolt'))) ? join(parent, f) : undefined)))).filter(
    (p): p is string => p !== undefined,
  );
  return databases.length === 1 ? databases[0] : undefined;
}

/** Identifiants d'URL : le slug du nom de dossier, suffixé (`-2`, `-3`…) en cas de collision. */
function assignIds(projects: Omit<DiscoveredProject, 'id'>[]): DiscoveredProject[] {
  const taken = new Set<string>();
  return projects.map((project) => {
    const base = slugify(project.name);
    let id = base;
    for (let n = 2; taken.has(id); n++) id = `${base}-${n}`;
    taken.add(id);
    return { id, ...project };
  });
}

export function slugify(name: string): string {
  const slug = name
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, '-')
    .replace(/^-+|-+$/g, '');
  return slug || 'projet';
}

/** Dossiers contenant `.beads/`, jusqu'à `MAX_DEPTH` niveaux sous `root` (racine comprise). */
async function findWorkspaces(root: string): Promise<string[]> {
  const found: string[] = [];
  async function visit(dir: string, depth: number): Promise<void> {
    if (await isDirectory(join(dir, '.beads'))) found.push(dir);
    if (depth >= MAX_DEPTH) return;
    const children = (await listFolders(dir)).filter((name) => !name.startsWith('.') && !SKIPPED_FOLDERS.has(name));
    await Promise.all(children.map((name) => visit(join(dir, name), depth + 1)));
  }
  await visit(root, 0);
  return found;
}

/** Le chemin sans lien symbolique ; le chemin résolu tel quel quand le dossier n'existe pas. */
async function canonicalPath(path: string): Promise<string> {
  return realpath(path).catch(() => resolve(path));
}

/** Sous-dossiers directs (liens symboliques vers des dossiers compris), vide si le dossier est illisible. */
async function listFolders(dir: string): Promise<string[]> {
  try {
    const entries = await readdir(dir, { withFileTypes: true });
    const folders = await Promise.all(
      entries.map(async (e) => (e.isDirectory() || (e.isSymbolicLink() && (await isDirectory(join(dir, e.name)))) ? e.name : undefined)),
    );
    return folders.filter((name): name is string => name !== undefined);
  } catch {
    return [];
  }
}

async function isDirectory(path: string): Promise<boolean> {
  try {
    return (await stat(path)).isDirectory();
  } catch {
    return false;
  }
}

/** Contenu JSON d'un fichier : undefined s'il est absent, null s'il n'est pas du JSON valide. */
async function readJson(path: string): Promise<Record<string, unknown> | null | undefined> {
  let text: string;
  try {
    text = await readFile(path, 'utf8');
  } catch {
    return undefined;
  }
  try {
    const value: unknown = JSON.parse(text);
    return value && typeof value === 'object' && !Array.isArray(value) ? (value as Record<string, unknown>) : null;
  } catch {
    return null;
  }
}

/** `issue-prefix:` de `config.yaml` (le fichier est surtout fait de commentaires : pas besoin d'un parseur YAML). */
async function readConfigPrefix(path: string): Promise<string | undefined> {
  try {
    return (await readFile(path, 'utf8')).match(/^issue-prefix:\s*["']?([^"'\s#]+)/m)?.[1];
  } catch {
    return undefined;
  }
}

const str = (value: unknown): string => (typeof value === 'string' ? value : '');
