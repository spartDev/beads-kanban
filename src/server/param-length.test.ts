import { writeFileSync } from 'node:fs';
import type { AddressInfo } from 'node:net';
import { join } from 'node:path';
import type { FastifyInstance } from 'fastify';
import { afterEach, describe, expect, it } from 'vitest';
import type { Issue, IssueDetail, Project } from '../shared/api';
import type { HeadWatcher } from './live/watcher';
import { slugify } from './projects/discovery';
import { ProjectNotFoundError, type ProjectService } from './projects/service';
import { buildServer, MAX_PARAM_LENGTH, startServer } from './server';
import { scratchDir } from './testing/scratch';
import { openStream } from './testing/sse';

/**
 * Les identifiants longs dans l'adresse (bdesk-38k.88). Fastify refuse un paramètre d'adresse de plus de 100 caractères (`maxParamLength`) : sans l'interface
 * servie, le routeur répond 414 (`FST_ERR_MAX_PARAM_LENGTH`) ; avec elle, l'adresse tombe dans la route `/*` des fichiers (@fastify/static), qui répond 404.
 * Or l'identifiant d'un Projet est le slug du nom de son dossier (`slugify`) : jusqu'à 255 caractères, la limite d'un nom de fichier, et deux de plus quand un
 * autre dossier a le même slug (`-2`). Celui d'un ticket tient dans `varchar(255)`, et son préfixe est celui de la base, que rien ne borne à 100 caractères. Un tel
 * Projet était listé, mais le kanban, le ticket, les Epics et le flux en direct répondaient 404 ; la page Métriques, dont l'identifiant est dans la requête et non dans
 * le chemin, se chargeait.
 */

const config = { roots: [], projects: [], hiddenProjects: [] };

/** Un identifiant de Projet de `n` caractères exactement : un slug (minuscules, chiffres, tirets), sans tiret en bout. */
function slug(n: number, tag: string): string {
  return `${tag}-${'nom-de-dossier-tres-long-'.repeat(Math.ceil(n / 25))}`.slice(0, n).replace(/-$/, 'x');
}

/** Un identifiant de ticket de `n` caractères exactement : un long préfixe, un tiret, un hash. */
const ticket = (n: number): string => `${'p'.repeat(n - 4)}-a1b`;

/** Ce que chaque lecture du service a reçu du routeur : l'adresse décodée, telle que le service la lirait. */
interface Received {
  method: 'issues' | 'issue' | 'histories';
  projectId: string;
  issueId?: string;
}

/** Un service qui connaît les Projets `projectIds` et les tickets `ticketIds` (de chacun d'eux), et note ce que ses lectures reçoivent. */
function recording(projectIds: string[], ticketIds: string[] = []) {
  const received: Received[] = [];
  const known: Project[] = projectIds.map((id) => ({ id, name: id, path: `/Users/someone/Developer/${id}`, prefix: 'bdesk', mode: 'embedded', status: 'ok' }));
  const issues: Issue[] = ticketIds.map((id) => ({
    id,
    title: `Ticket de ${id.length} caractères`,
    type: 'task',
    status: 'open',
    priority: 2,
    assignee: null,
    parentId: null,
    createdAt: '2026-10-19T16:46:39.000Z',
    updatedAt: '2026-10-20T10:39:21.000Z',
    closedAt: null,
    blockedBy: [],
  }));
  const service: ProjectService = {
    list: async () => ({ projects: known, ignored: [] }),
    issues: async (projectId) => {
      received.push({ method: 'issues', projectId });
      return issues;
    },
    issue: async (projectId, issueId) => {
      received.push({ method: 'issue', projectId, issueId });
      const issue = issues.find((candidate) => candidate.id === issueId);
      if (!issue) throw new Error(`ticket inconnu : ${issueId}`);
      return { ...issue, description: '', design: '', acceptanceCriteria: '', notes: '', closeReason: '', labels: [], dependencies: [], dependents: [], linked: {}, epic: null, comments: [] } satisfies IssueDetail;
    },
    histories: async (projectId) => {
      received.push({ method: 'histories', projectId });
      return [];
    },
    head: async () => 'h1',
  };
  return { service, received };
}

/** Une interface compilée minimale, comme celle que `pnpm start` sert : c'est elle qui fait tomber l'adresse trop longue dans le repli des fichiers (404). */
function webRoot(): string {
  const root = scratchDir('bdesk-web-');
  writeFileSync(join(root, 'index.html'), '<!doctype html><title>beads-desktop</title>');
  return root;
}

const enc = encodeURIComponent;

describe.each([
  ['sans l’interface (pnpm dev : l’API seule)', undefined],
  ['avec l’interface servie (pnpm start)', 'served'],
] as const)('adresses à identifiants longs, %s (bdesk-38k.88)', (_title, served) => {
  const server = (service: ProjectService) => buildServer({ config, projects: service, ...(served ? { webRoot: webRoot() } : {}) });

  // 101 : le premier refusé par la limite de Fastify ; 150 et 180 : ceux que l'on a constatés ; 255 : un nom de fichier au plus long ; 257 : ce nom avec « -2 ».
  it.each([101, 150, 180, 255, 257])('GET …/issues charge le kanban d’un Projet dont l’identifiant fait %i caractères', async (n) => {
    const projectId = slug(n, 'projet');
    const { service, received } = recording([projectId], [ticket(20)]);

    const res = await server(service).inject({ method: 'GET', url: `/api/projects/${enc(projectId)}/issues` });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ issues: Issue[] }>().issues.map((issue) => issue.id)).toEqual([ticket(20)]);
    expect(received).toEqual([{ method: 'issues', projectId }]);
  });

  it.each([101, 255])('GET …/issues/:issueId ouvre le ticket d’un Projet dont l’identifiant fait %i caractères', async (n) => {
    const projectId = slug(n, 'projet');
    const { service, received } = recording([projectId], ['bdesk-38k.7']);

    const res = await server(service).inject({ method: 'GET', url: `/api/projects/${enc(projectId)}/issues/bdesk-38k.7` });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ issue: Issue }>().issue.id).toBe('bdesk-38k.7');
    expect(received).toEqual([{ method: 'issue', projectId, issueId: 'bdesk-38k.7' }]);
  });

  it.each([101, 126, 255])('GET …/issues/:issueId ouvre un ticket dont l’identifiant fait %i caractères, dans un Projet de nom court', async (n) => {
    const issueId = ticket(n);
    const { service, received } = recording(['court'], [issueId]);

    const res = await server(service).inject({ method: 'GET', url: `/api/projects/court/issues/${enc(issueId)}` });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ issue: Issue }>().issue.id).toBe(issueId);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId }]);
  });

  it('GET …/issues/:issueId/chronology sert la Chronologie, le Projet et le ticket ayant 255 caractères chacun', async () => {
    const projectId = slug(255, 'projet');
    const issueId = ticket(255);
    const { service, received } = recording([projectId], [issueId]);

    const res = await server(service).inject({ method: 'GET', url: `/api/projects/${enc(projectId)}/issues/${enc(issueId)}/chronology` });

    expect(res.statusCode).toBe(200);
    expect(res.json<{ chronology: { source: string } }>().chronology.source).toBe('dates');
    expect(received.map((read) => read.projectId)).toEqual([projectId, projectId]); // l'historique, puis les tickets (repli sur les dates)
  });

  it('transmet l’identifiant décodé : 255 caractères non ASCII font plus de 1 500 caractères dans l’adresse', async () => {
    const issueId = `é${'à'.repeat(253)}ü`; // 255 caractères, 510 octets, 255 × 6 caractères une fois encodés (« %C3%A9 »)
    const { service, received } = recording(['court'], [issueId]);
    const url = `/api/projects/court/issues/${enc(issueId)}`;
    expect(url.length).toBeGreaterThan(1_500);

    const res = await server(service).inject({ method: 'GET', url });

    expect(res.statusCode).toBe(200);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId }]);
  });

  it('compte les caractères du texte décodé : 255 émojis, deux unités UTF-16 chacun, passent', async () => {
    const issueId = '😀'.repeat(255); // 510 unités UTF-16 : la plus grande valeur d'un `varchar(255)`
    const { service, received } = recording(['court'], [issueId]);

    const res = await server(service).inject({ method: 'GET', url: `/api/projects/court/issues/${enc(issueId)}` });

    expect(res.statusCode).toBe(200);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId }]);
  });

  it('GET …/issues d’un Projet inconnu à l’identifiant long : 404 de l’API (JSON, message du Projet), sans lecture', async () => {
    const projectId = slug(200, 'inconnu');
    const { service, received } = recording(['beads-desktop']);
    const unknown: ProjectService = {
      ...service,
      issues: async (id) => {
        throw new ProjectNotFoundError(id);
      },
    };

    const res = await server(unknown).inject({ method: 'GET', url: `/api/projects/${enc(projectId)}/issues` });

    expect(res.statusCode).toBe(404);
    expect(res.json()).toEqual({ statusCode: 404, error: 'Not Found', message: `Projet inconnu : ${projectId}` });
    expect(received).toEqual([]);
  });

  // La limite est celle du routeur : en deçà, la route ; au-delà, pas de route (414 pour l'API seule, 404 quand l'interface est servie), et le service n'est pas appelé.
  it('un identifiant de Projet de MAX_PARAM_LENGTH caractères passe, un de plus n’a pas de route', async () => {
    const [at, over] = [slug(MAX_PARAM_LENGTH, 'projet'), slug(MAX_PARAM_LENGTH + 1, 'projet')];
    const { service, received } = recording([at, over], [ticket(20)]);
    const app = server(service);

    const accepted = await app.inject({ method: 'GET', url: `/api/projects/${at}/issues` });
    const refused = await app.inject({ method: 'GET', url: `/api/projects/${over}/issues` });

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(served ? 404 : 414);
    expect(received).toEqual([{ method: 'issues', projectId: at }]);
  });

  it('un identifiant de ticket de MAX_PARAM_LENGTH caractères passe, un de plus n’a pas de route', async () => {
    const [at, over] = [ticket(MAX_PARAM_LENGTH), ticket(MAX_PARAM_LENGTH + 1)];
    const { service, received } = recording(['court'], [at, over]);
    const app = server(service);

    const accepted = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${at}` });
    const refused = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${over}` });

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(served ? 404 : 414);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId: at }]);
  });

  // Le plafond en chiffres, sans passer par la constante. Les deux tests ci-dessus la prennent pour référence : un plafond cohérent mais démesuré (`MAX_PARAM_LENGTH =
  // 1_000_000`, ou 1 024) s'y adapterait et leur échapperait. Ici, 512 caractères passent et 513 n'ont pas de route (414 pour l'API seule, 404 quand l'interface est servie), sans lecture :
  // avec ces tests et ceux d'en haut, la constante vaut 512, ni plus, ni moins.
  it('un identifiant de Projet de 512 caractères passe, un de 513 est refusé : le plafond est 512, quelle que soit la constante', async () => {
    const [at, over] = [slug(512, 'projet'), slug(513, 'projet')];
    const { service, received } = recording([at, over], [ticket(20)]);
    const app = server(service);

    const accepted = await app.inject({ method: 'GET', url: `/api/projects/${at}/issues` });
    const refused = await app.inject({ method: 'GET', url: `/api/projects/${over}/issues` });

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(served ? 404 : 414);
    expect(received).toEqual([{ method: 'issues', projectId: at }]);
  });

  it('un identifiant de ticket de 512 caractères passe, un de 513 est refusé : le plafond est 512, quelle que soit la constante', async () => {
    const [at, over] = [ticket(512), ticket(513)];
    const { service, received } = recording(['court'], [at, over]);
    const app = server(service);

    const accepted = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${at}` });
    const refused = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${over}` });

    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(served ? 404 : 414);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId: at }]);
  });

  it('le plafond compte des unités UTF-16 du texte décodé : 256 émojis (512 unités) passent, 256 émojis et une lettre (513) sont refusés', async () => {
    const [at, over] = ['😀'.repeat(256), `${'😀'.repeat(256)}a`];
    const { service, received } = recording(['court'], [at, over]);
    const app = server(service);

    const accepted = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${enc(at)}` });
    const refused = await app.inject({ method: 'GET', url: `/api/projects/court/issues/${enc(over)}` });

    expect([at.length, over.length]).toEqual([512, 513]);
    expect(accepted.statusCode).toBe(200);
    expect(refused.statusCode).toBe(served ? 404 : 414);
    expect(received).toEqual([{ method: 'issue', projectId: 'court', issueId: at }]);
  });

  describe('les contrôles qui précèdent la route s’appliquent aux adresses longues comme aux autres', () => {
    const url = `/api/projects/${slug(255, 'projet')}/issues`;

    it('refuse un en-tête Host qui n’est pas local (DNS rebinding) : 403, sans lecture', async () => {
      const { service, received } = recording([slug(255, 'projet')]);

      const res = await server(service).inject({ method: 'GET', url, headers: { host: 'evil.example' } });

      expect(res.statusCode).toBe(403);
      expect(received).toEqual([]);
    });

    it('refuse une requête qu’une page d’un autre site a fait partir (Sec-Fetch-Site) : 403, sans lecture', async () => {
      const { service, received } = recording([slug(255, 'projet')]);

      const res = await server(service).inject({ method: 'GET', url, headers: { 'sec-fetch-site': 'cross-site' } });

      expect(res.statusCode).toBe(403);
      expect(received).toEqual([]);
    });
  });
});

describe('les pages de l’interface à identifiant long (bdesk-38k.88)', () => {
  // Recharger la page d'un Projet, ouvrir un signet : l'adresse de l'application n'est pas une route de l'API, c'est le repli `index.html` (voir `isAppRoute`), même quand `stat` refuse le nom (255 caractères
  // au plus pour un fichier : `ENAMETOOLONG`). Cela ne dépendait pas de la limite des paramètres : rien ne doit changer.
  it.each([101, 257, 600, 3_000])('/p/<identifiant de %i caractères>/kanban et /t/<ticket de 255 caractères> servent l’interface, sans rien lire', async (n) => {
    const projectId = slug(n, 'projet');
    const { service, received } = recording([projectId], [ticket(255)]);
    const app = buildServer({ config, projects: service, webRoot: webRoot() });

    const kanban = await app.inject({ method: 'GET', url: `/p/${enc(projectId)}/kanban`, headers: { accept: 'text/html' } });
    const issue = await app.inject({ method: 'GET', url: `/p/${enc(projectId)}/t/${enc(ticket(255))}`, headers: { accept: 'text/html' } });

    expect([kanban.statusCode, issue.statusCode]).toEqual([200, 200]);
    expect([kanban.body, issue.body]).toEqual(Array(2).fill('<!doctype html><title>beads-desktop</title>'));
    expect(received).toEqual([]);
  });
});

describe('flux en direct d’un Projet à l’identifiant long (bdesk-38k.88)', () => {
  const servers: FastifyInstance[] = [];
  const streams: Awaited<ReturnType<typeof openStream>>[] = [];
  afterEach(async () => {
    for (const stream of streams.splice(0)) stream.close();
    for (const app of servers.splice(0)) await app.close();
  });

  const watcher: HeadWatcher = { subscribe: () => () => undefined, watched: () => [], close: () => undefined };

  it.each([101, 255, 257])('GET …/events s’ouvre pour un identifiant de %i caractères (sans lui, l’interface affiche « Mises à jour en direct interrompues »)', async (n) => {
    const projectId = slug(n, 'projet');
    const { service } = recording([projectId]);
    const app = await startServer({ config, projects: service, port: 0, live: { watcher } });
    servers.push(app);
    const port = (app.server.address() as AddressInfo).port;

    const stream = await openStream(port, `/api/projects/${enc(projectId)}/events`);
    streams.push(stream);

    expect(stream.status).toBe(200);
    expect(stream.headers['content-type']).toContain('text/event-stream');
    await stream.waitFor('retry:', 15_000);
  });
});

describe('l’identifiant d’un Projet tient dans MAX_PARAM_LENGTH (bdesk-38k.88)', () => {
  // Le nom d'un dossier fait 255 caractères au plus : 255 octets sous Linux, 255 unités UTF-16 sous macOS et Windows (APFS accepte 255 « é », soit 510 octets, et refuse 256 « a » comme 128 émojis).
  // Le slug n'en a jamais plus que le nom (`NFD` sépare l'accent de sa lettre, que `slugify` retire ; tout ce qui n'est ni lettre ni chiffre ASCII devient un tiret, que l'on ne répète pas) :
  // à la longueur du nom s'ajoute au plus « -2 », « -3 »… d'une collision, jamais de quoi dépasser `MAX_PARAM_LENGTH`.
  const NAMES: [string, string][] = [
    ['255 caractères ASCII', 'a'.repeat(255)],
    ['255 lettres accentuées (510 octets)', 'é'.repeat(255)],
    ['une lettre ASCII et son accent combinant (« e » + U+0301), 127 fois', 'e\u0301'.repeat(127)],
    ['le I majuscule pointé (U+0130, dont la minuscule a deux unités) et le signe Kelvin (U+212A), 127 fois', '\u0130\u212a'.repeat(127)],
    ['251 lettres et un émoji', `${'y'.repeat(251)}🚀`],
    ['255 caractères japonais (765 octets), qui ne laissent que le repli « projet »', 'プ'.repeat(255)],
    ['des tirets, des espaces et des chiffres', '1 -'.repeat(85)],
  ];

  it.each(NAMES)('%s : au plus 255 caractères', (_label, name) => {
    expect(name.length).toBeLessThanOrEqual(255); // des unités UTF-16 : ce que macOS et Windows bornent, et jamais plus que les octets que Linux borne
    expect(slugify(name).length).toBeLessThanOrEqual(255);
    expect(slugify(name).length + '-99999'.length).toBeLessThanOrEqual(MAX_PARAM_LENGTH);
  });

  it('chaque caractère du plan multilingue de base, seul, donne au plus un caractère (« projet » pour un nom sans lettre ni chiffre)', () => {
    const longer: string[] = [];
    for (let code = 0; code <= 0xffff; code++) {
      if (code >= 0xd800 && code <= 0xdfff) continue; // moitiés de paires de substitution
      const name = String.fromCodePoint(code);
      const id = slugify(name);
      if (id !== 'projet' && id.length > name.length) longer.push(`U+${code.toString(16)}`);
    }
    expect(longer).toEqual([]);
  });
});

describe('le réglage du routeur (bdesk-38k.88)', () => {
  it('passe par `routerOptions` : Fastify n’avertit pas qu’une option de premier niveau est obsolète (FSTDEP022)', async () => {
    const codes: string[] = [];
    const onWarning = (warning: Error & { code?: string }) => {
      if (warning.code?.startsWith('FSTDEP')) codes.push(warning.code);
    };
    process.on('warning', onWarning);
    try {
      buildServer({ config });
      await new Promise((resolve) => setTimeout(resolve, 20)); // `process.emitWarning` livre ses avertissements au tour suivant
    } finally {
      process.off('warning', onWarning);
    }

    expect(codes).toEqual([]);
  });
});
