import { Navigate, useLocation, useParams, type RouteObject } from 'react-router';
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
import { METRICS_PARAMS, paths } from './paths';
import { AppShell } from './shell/AppShell';

/** L'ancienne adresse de « À regarder » tous Projets confondus, devenue l'accueil. */
function RedirectToHome() {
  return <Navigate to={paths.home()} replace />;
}

/**
 * L'accueil. La Vue globale y était avant d'avoir sa propre adresse : un ancien lien vers elle (`/?range=90d&by=type`, ses paramètres de période et de
 * découpage) y mène encore, paramètres compris.
 */
function Home() {
  const { search, hash } = useLocation();
  const params = new URLSearchParams(search);
  if (Object.values(METRICS_PARAMS).some((name) => params.has(name))) return <Navigate to={{ pathname: paths.global(), search, hash }} replace />;
  return <GlobalSignalsPage />;
}

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
          { index: true, element: <Home /> },
          { path: 'overview', element: <GlobalPage /> },
          { path: 'signals', element: <RedirectToHome /> },
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
