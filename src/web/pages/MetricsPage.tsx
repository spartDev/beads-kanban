import { projectInSentence } from '../data/projectNames';
import { useT } from '../i18n';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { LazyMetricsView } from '../metrics/LazyMetricsView';
import { Page } from './Page';
import { useProject } from './ProjectGate';

/**
 * Les métriques de flux du Projet (bdesk-38k.12) : Débit, Lead Time, Cycle Time, Taux d'échec, Temps de rétablissement
 * et WIP avec leur tendance, puis le flux cumulé, l'histogramme du Débit, le nuage de points du Cycle Time et l'âge des
 * tickets en cours. La période et le découpage vivent dans l'adresse.
 */
export function MetricsPage() {
  const project = useProject();
  const texts = useT().metrics.metricsPage;
  useDocumentTitle(texts.title, project.name);

  return (
    <Page title={texts.title} description={texts.description(projectInSentence(project))} wide>
      <LazyMetricsView scope={{ kind: 'project', project }} />
    </Page>
  );
}
