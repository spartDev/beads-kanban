import { Writable } from 'node:stream';
import { describe, expect, it, vi } from 'vitest';
import { createMetricsService } from './metrics/service';
import type { ProjectService } from './projects/service';
import { buildServer } from './server';

// `identify` (ce que le filet de `registerApi` écrit de l'erreur d'origine) est ici remplacé par une version qui lève. Il ne le peut pas aujourd'hui,
// chacune de ses lectures est gardée ; mais la ligne fixe du filet ne doit pas dépendre de cette promesse : elle s'écrit, sans `original`.
vi.mock('./errorLog', async (importOriginal) => ({
  ...(await importOriginal<typeof import('./errorLog')>()),
  identify: () => {
    throw new Error('identify-qui-leve');
  },
}));

const config = { roots: [], projects: [], hiddenProjects: [] };

describe('API : le filet du gestionnaire d’erreurs, quand identify lève (bdesk-38k.55)', () => {
  it('la ligne fixe est écrite quand même, sans `original`, et sans l’adresse : la réponse est un 500 générique', async () => {
    const chunks: string[] = [];
    const stream = new Writable({
      write(chunk: Buffer, _encoding, done) {
        chunks.push(chunk.toString());
        done();
      },
    });
    // Une erreur que le gestionnaire ne sait pas lire (`instanceof` lève) : le filet la rattrape.
    const thrown = new Proxy(new Error('boum'), {
      getPrototypeOf() {
        throw new Error('prototype-illisible');
      },
    });
    const projects: ProjectService = {
      list: async () => {
        throw thrown;
      },
      issues: async () => [],
      issue: async () => {
        throw thrown;
      },
      histories: async () => [],
      head: async () => 'h1',
    };
    const metrics = createMetricsService(projects, { now: () => new Date('2026-10-23T18:00:00Z'), timeZone: 'Europe/Paris' });
    const app = buildServer({ config, projects, metrics, logger: { level: 'warn', stream } });

    const res = await app.inject({ method: 'GET', url: '/api/projects?token=s3cret', headers: { authorization: 'Bearer s3cret' } });
    await app.close();

    expect(res.statusCode).toBe(500);
    expect(res.json()).toEqual({ statusCode: 500, error: 'Internal Server Error', message: 'Erreur inattendue.' });
    const text = chunks.join('');
    expect(text).not.toContain('s3cret');
    const lines = text
      .split('\n')
      .filter((line) => line.trim() !== '')
      .map((line) => JSON.parse(line) as Record<string, unknown>);
    expect(lines).toMatchObject([{ level: 50, method: 'GET', route: '/api/projects', msg: "Erreur inattendue (le gestionnaire d'erreurs a échoué)", original: {} }]);
  });
});
