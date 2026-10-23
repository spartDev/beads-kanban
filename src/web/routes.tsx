import { Navigate, useParams, type RouteObject } from 'react-router';
import { EpicsPage } from './pages/EpicsPage';
import { GlobalPage } from './pages/GlobalPage';
import { IssuePage } from './pages/IssuePage';
import { KanbanPage } from './pages/KanbanPage';
import { MetricsPage } from './pages/MetricsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectGate } from './pages/ProjectGate';
import { RouteError } from './pages/RouteError';
import { paths } from './paths';
import { AppShell } from './shell/AppShell';

function RedirectToKanban() {
  const { projectId = '' } = useParams();
  return <Navigate to={paths.kanban(projectId)} replace />;
}

/**
 * Routes de l'application. Une erreur dans une page n'emporte pas le shell : la route sans chemin
 * qui porte `errorElement` n'en remplace que le contenu, la navigation reste utilisable.
 */
export const routes: RouteObject[] = [
  {
    path: '/',
    element: <AppShell />,
    errorElement: <RouteError standalone />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <GlobalPage /> },
          {
            path: 'p/:projectId',
            element: <ProjectGate />,
            children: [
              { index: true, element: <RedirectToKanban /> },
              { path: 'kanban', element: <KanbanPage /> },
              { path: 'epics', element: <EpicsPage /> },
              { path: 'metrics', element: <MetricsPage /> },
              { path: 't/:issueId', element: <IssuePage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
