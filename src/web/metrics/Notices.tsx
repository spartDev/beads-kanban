import { Info, TriangleAlert } from 'lucide-react';
import { useId } from 'react';
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
 * Le serveur ne connaît pas le fuseau du navigateur (un fuseau plus récent que son ICU : Chromium sait `America/Coyhaique`, Node 22.13 non) : il a compté
 * dans le sien et l'a nommé dans sa réponse. Les chiffres sont justes dans ce fuseau ; la page dit lequel, au lieu d'en écrire les jours et les heures sans le
 * dire (bdesk-38k.48, relecture). Un avis, pas une panne : il n'a ni bouton ni couleur d'alerte. Une région de statut nommée par son titre, comme tout `Notice`.
 */
export function ZoneNotice({ asked, counted }: { asked: string; counted: string }) {
  return (
    <Notice icon={Info} title={`Le serveur ne connaît pas votre fuseau, ${asked}`}>
      Les jours, les semaines et les heures de ces chiffres sont comptés en {counted}, le fuseau du serveur.
    </Notice>
  );
}

/**
 * Les Projets dont la base n'a pas pu être lue : ils n'entrent pas dans les chiffres, et la page le dit. Les autres
 * Projets sont mesurés quand même ; un Projet illisible ne fait pas échouer la Vue globale. Une région de statut comme un avis (`Notice`), nommée de même par son titre.
 */
export function UnreadableProjects({ projects }: { projects: readonly MetricsUnreadableProject[] }) {
  const titleId = useId();
  return (
    <div role="status" aria-labelledby={titleId} className="flex gap-3 rounded-lg border border-dashed border-line-strong p-4">
      <TriangleAlert size={16} strokeWidth={2} aria-hidden="true" className="mt-0.5 shrink-0 text-danger" />
      <div className="min-w-0 wrap-anywhere">
        <p id={titleId} className="font-medium text-ink">
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
