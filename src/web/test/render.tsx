import { QueryClient, QueryClientProvider } from '@tanstack/react-query';
import { render } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { vi } from 'vitest';
import { createMemoryRouter, RouterProvider } from 'react-router';
import type { Issue, IssueChronology, IssueDetail, IssueRef, ProjectsResponse } from '../data/types';
import { routes } from '../routes';
import { ThemeProvider } from '../theme/ThemeProvider';
import { chronology as defaultChronology, issueDetail } from './fixtures';

/** Réponse d'erreur HTTP scriptée : statut et corps JSON, comme ceux de l'API (même forme que Fastify). */
export interface HttpFailure {
  status: number;
  body: unknown;
}

export const httpFailure = (status: number, body: unknown): HttpFailure => ({ status, body });

/** Ce que l'API répond : les données, une erreur (500, serveur en panne) ou une réponse d'erreur précise. */
type Reply<T> = T | Error | HttpFailure;

interface ApiFixture {
  /** Réponse de /api/projects. */
  projects: Reply<ProjectsResponse>;
  /** Tickets par identifiant de Projet. */
  issues?: Record<string, Reply<Issue[]>>;
  /** Fiche d'un ticket, par `projet/ticket` ; à défaut, elle est tirée de la liste des tickets du Projet. */
  details?: Record<string, Reply<IssueDetail>>;
  /** Chronologie d'un ticket, par `projet/ticket` ; à défaut, celle d'un ticket resté ouvert depuis sa création. */
  chronologies?: Record<string, Reply<IssueChronology>>;
}

const isFailure = (value: unknown): value is HttpFailure =>
  typeof value === 'object' && value !== null && 'status' in value && 'body' in value;

const json = (body: unknown, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { 'Content-Type': 'application/json' } });

function respond<T>(reply: Reply<T>, wrap: (data: T) => unknown = (data) => data): Response {
  if (reply instanceof Error) return json({ message: reply.message }, 500);
  if (isFailure(reply)) return json(reply.body, reply.status);
  return json(wrap(reply));
}

const notFound = (message: string) => json({ statusCode: 404, error: 'Not Found', message }, 404);

const toRef = ({ id, title, type, status, priority }: Issue): IssueRef => ({ id, title, type, status, priority });

/** Les tickets que la fiche d'un ticket de la liste nomme : son parent et ceux qui le bloquent, comme `linked` côté serveur. */
function linkedTo(listed: Issue, list: Issue[]): Record<string, IssueRef> {
  const named = [listed.parentId, ...listed.blockedBy].flatMap((id) => list.find((candidate) => candidate.id === id) ?? []);
  return Object.fromEntries(named.map((other) => [other.id, toRef(other)]));
}

/** Remplace fetch par un faux serveur d'API ; renvoie le mock pour inspecter les appels. */
export function stubApi({ projects, issues = {}, details = {}, chronologies = {} }: ApiFixture) {
  const fetchMock = vi.fn(async (input: RequestInfo | URL) => {
    const { pathname } = new URL(String(input), 'http://localhost');
    if (pathname === '/api/projects') return respond(projects);

    const match = /^\/api\/projects\/([^/]+)\/issues(?:\/([^/]+)(\/chronology)?)?$/.exec(pathname);
    const projectId = match?.[1] ? decodeURIComponent(match[1]) : undefined;
    const issueId = match?.[2] ? decodeURIComponent(match[2]) : undefined;
    const chronologyOnly = match?.[3] !== undefined;
    const list = projectId ? issues[projectId] : undefined;
    if (!projectId || !list) return notFound(`Projet inconnu : ${projectId ?? ''}`);

    if (issueId === undefined) return respond(list, (data) => ({ issues: data }));

    if (chronologyOnly) {
      const scripted = chronologies[`${projectId}/${issueId}`];
      if (scripted) return respond(scripted, (data) => ({ chronology: data }));
      if (list instanceof Error || isFailure(list)) return respond(list);
      return list.some((candidate) => candidate.id === issueId)
        ? json({ chronology: defaultChronology() })
        : notFound(`Ticket inconnu dans ${projectId} : ${issueId}`);
    }

    const detail = details[`${projectId}/${issueId}`];
    if (detail) return respond(detail, (data) => ({ issue: data }));
    // Une liste en échec fait échouer la fiche de la même façon : c'est le même Projet.
    if (list instanceof Error || isFailure(list)) return respond(list);
    const listed = list.find((candidate) => candidate.id === issueId);
    return listed
      ? json({ issue: issueDetail({ ...listed, linked: linkedTo(listed, list) }) })
      : notFound(`Ticket inconnu dans ${projectId} : ${issueId}`);
  });
  vi.stubGlobal('fetch', fetchMock);
  return fetchMock;
}

/**
 * Fait échouer (500, « database is locked ») les requêtes dont l'URL passe `match`, comme un serveur qui
 * flanche après avoir répondu une première fois. Renvoie la fonction qui rétablit le faux serveur.
 */
export function failRequests(fetchMock: ReturnType<typeof stubApi>, match: (url: string) => boolean): () => void {
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('failRequests attend le mock renvoyé par stubApi.');
  fetchMock.mockImplementation(async (input) =>
    match(String(input)) ? json({ message: 'database is locked' }, 500) : healthy(input),
  );
  return () => void fetchMock.mockImplementation(healthy);
}

/** Monte l'application entière (routes, thème, données) sur une URL. */
export function renderApp(initialPath = '/') {
  const queryClient = new QueryClient({ defaultOptions: { queries: { retry: false } } });
  const router = createMemoryRouter(routes, { initialEntries: [initialPath] });
  const user = userEvent.setup();
  const view = render(
    <QueryClientProvider client={queryClient}>
      <ThemeProvider>
        <RouterProvider router={router} />
      </ThemeProvider>
    </QueryClientProvider>,
  );
  return { ...view, router, user, queryClient };
}
