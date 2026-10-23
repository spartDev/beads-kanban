import { useDocumentTitle } from '../lib/useDocumentTitle';
import { ComingSoon, Page, SectionTitle } from './Page';
import { useProject } from './ProjectGate';

/** Termes de CONTEXT.md : ce que la page mesurera. */
export const METRICS: readonly (readonly [term: string, definition: string])[] = [
  ['Débit', 'Nombre de Livraisons sur une période.'],
  ['Lead Time', 'Durée entre la création d’un ticket et sa dernière clôture.'],
  ['Cycle Time', 'Temps cumulé dans les statuts de travail, Blocages inclus.'],
  ['Taux d’échec', 'Part des Livraisons ayant au moins un Bug d’origine.'],
  ['Temps de rétablissement', 'Lead Time des bugs critiques (P0 et P1).'],
  ['WIP', 'Nombre de tickets en cours simultanément.'],
];

export function MetricsPage() {
  const project = useProject();
  useDocumentTitle('Métriques', project.name);

  return (
    <Page title="Métriques" description={`Le flux de livraison de ${project.name}, mesuré depuis l’historique Dolt.`}>
      <ComingSoon ticket="bdesk-38k.12">Les tuiles et les graphiques arrivent avec « Page Métriques ».</ComingSoon>

      <section aria-labelledby="metrics-list" className="flex flex-col gap-3">
        <SectionTitle id="metrics-list">Ce qui sera mesuré</SectionTitle>
        <dl className="grid gap-x-8 gap-y-3 sm:grid-cols-2">
          {METRICS.map(([term, definition]) => (
            <div key={term} className="border-t border-line pt-2.5">
              <dt className="font-medium text-ink">{term}</dt>
              <dd className="mt-0.5 text-ink-2">{definition}</dd>
            </div>
          ))}
        </dl>
      </section>
    </Page>
  );
}
