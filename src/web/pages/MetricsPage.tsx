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
  useDocumentTitle('Métriques', project.name);

  return (
    <Page title="Métriques" description={`Le flux de livraison de ${project.name}, mesuré depuis l’historique Dolt, comparé à la période précédente.`} wide>
      <LazyMetricsView scope={{ kind: 'project', project }} />
    </Page>
  );
}
