import { ArrowLeft } from 'lucide-react';
import { Link } from 'react-router';
import { paths } from '../paths';

/** Le lien en tête d'une page Epic : retour à la liste des Epics du Projet. */
export function BackToEpics({ projectId }: { projectId: string }) {
  return (
    <Link to={paths.epics(projectId)} className="inline-flex items-center gap-1 text-ink-2 transition-colors hover:text-ink">
      <ArrowLeft size={14} strokeWidth={2} aria-hidden="true" />
      Epics
    </Link>
  );
}
