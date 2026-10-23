import { STATUS_CODES } from 'node:http';
import type { FastifyError, FastifyInstance, FastifyReply } from 'fastify';
import type { ApiErrorBody, IssueResponse, IssuesResponse, ProjectsResponse } from '../shared/api';
import {
  IssueNotFoundError,
  ProjectNotFoundError,
  type ProjectService,
  ProjectUnreadableError,
} from './projects/service';

/** Routes `/api/projects…` ; les erreurs du service deviennent des réponses JSON (404, 503). */
export async function registerApi(app: FastifyInstance, projects: ProjectService): Promise<void> {
  app.setErrorHandler((error: FastifyError, _req, reply) => {
    if (error instanceof ProjectNotFoundError || error instanceof IssueNotFoundError) {
      return send(reply, 404, error.message);
    }
    if (error instanceof ProjectUnreadableError) {
      return send(reply, 503, `Projet illisible : ${error.reason}`, error.reason);
    }
    return send(reply, error.statusCode ?? 500, error.message);
  });

  app.get('/api/projects', (): Promise<ProjectsResponse> => projects.list());

  app.get<{ Params: { projectId: string } }>(
    '/api/projects/:projectId/issues',
    async (req): Promise<IssuesResponse> => ({ issues: await projects.issues(req.params.projectId) }),
  );

  app.get<{ Params: { projectId: string; issueId: string } }>(
    '/api/projects/:projectId/issues/:issueId',
    async (req): Promise<IssueResponse> => ({
      issue: await projects.issue(req.params.projectId, req.params.issueId),
    }),
  );
}

function send(reply: FastifyReply, statusCode: number, message: string, reason?: string): FastifyReply {
  const error = STATUS_CODES[statusCode] ?? 'Error';
  const body: ApiErrorBody = reason === undefined ? { statusCode, error, message } : { statusCode, error, message, reason };
  return reply.code(statusCode).send(body);
}
