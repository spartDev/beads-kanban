import { Navigate, useParams, type RouteObject } from 'react-router';
import { HistoryTrail } from './issue/HistoryTrail';
import { IssuePanel } from './issue/IssuePanel';
import { EpicsPage } from './pages/EpicsPage';
import { GlobalPage } from './pages/GlobalPage';
import { KanbanRoute } from './pages/KanbanRoute';
import { MetricsPage } from './pages/MetricsPage';
import { NotFoundPage } from './pages/NotFoundPage';
import { ProjectSignalsPage, GlobalSignalsPage } from './pages/SignalsPage';
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
    element: (
      <HistoryTrail>
        <AppShell />
      </HistoryTrail>
    ),
    errorElement: <RouteError standalone />,
    children: [
      {
        errorElement: <RouteError />,
        children: [
          { index: true, element: <GlobalPage /> },
          { path: 'signals', element: <GlobalSignalsPage /> },
          {
            path: 'p/:projectId',
            element: <ProjectGate />,
            children: [
              { index: true, element: <RedirectToKanban /> },
              {
                // Le kanban, et par-dessus lui le panneau du ticket : une seule route mère, donc un tableau qui reste en place.
                element: <KanbanRoute />,
                // `element: null` : le tableau est celui de la route mère, il n'y a rien à ajouter sur `/kanban` (sans lui, React Router avertit).
                children: [{ path: 'kanban', element: null }, { path: 't/:issueId', element: <IssuePanel /> }],
              },
              { path: 'signals', element: <ProjectSignalsPage /> },
              { path: 'epics', element: <EpicsPage /> },
              { path: 'metrics', element: <MetricsPage /> },
            ],
          },
          { path: '*', element: <NotFoundPage /> },
        ],
      },
    ],
  },
];
