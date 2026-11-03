import { Info, TriangleAlert } from 'lucide-react';
import type { MetricsUnreadableProject } from '../../shared/api';
import { Notice } from '../ui/states';

/** Ce que l'adresse demandait et que la page ne sert pas : dit, au lieu d'afficher en silence d'autres chiffres. */
export function AddressNotices({ notices }: { notices: readonly string[] }) {
  return (
    <Notice icon={Info} title={notices.length > 1 ? 'Réglages de l’adresse ignorés' : 'Réglage de l’adresse ignoré'}>
      <ul className="flex flex-col gap-1">
        {notices.map((notice) => (
          <li key={notice}>{notice}</li>
        ))}
      </ul>
    </Notice>
  );
}

/**
 * Les Projets dont la base n'a pas pu être lue : ils n'entrent pas dans les chiffres, et la page le dit. Les autres
 * Projets sont mesurés quand même ; un Projet illisible ne fait pas échouer la Vue globale.
 */
export function UnreadableProjects({ projects }: { projects: readonly MetricsUnreadableProject[] }) {
  return (
    <div role="status" className="flex gap-3 rounded-lg border border-dashed border-line-strong p-4">
      <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 wrap-anywhere">
        <p className="font-medium text-ink">
          {projects.length > 1 ? `${projects.length} Projets illisibles, absents de ces chiffres` : 'Un Projet illisible, absent de ces chiffres'}
        </p>
        <ul className="mt-1 flex flex-col gap-1 text-ink-2">
          {projects.map((project) => (
            <li key={project.id}>
              <strong className="font-medium text-ink">{project.name}</strong> : {project.reason}
            </li>
          ))}
        </ul>
      </div>
    </div>
  );
}
