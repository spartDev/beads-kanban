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
 * dans le sien, l'a nommé dans sa réponse et a dit qu'il n'honorait pas celui qu'on lui demandait (`timeZoneHonoured`). Les chiffres sont justes dans ce fuseau ; la page
 * dit lequel, au lieu d'en écrire les jours et les heures sans le dire (bdesk-38k.48, relecture). Un avis, pas une panne : il n'a ni bouton ni couleur d'alerte. Une région
 * de statut nommée par son titre, comme tout `Notice`.
 *
 * Il se montre tant que la dernière réponse du serveur le dit et que le fuseau du navigateur n'a pas changé (`MetricsView`), y compris pendant qu'une autre période
 * se calcule, quand une période échoue et sous le squelette d'une page qui s'ouvre : retiré puis remis avec la réponse, il faisait sauter la page et laissait passer
 * sans lui les chiffres gardés (bdesk-38k.71). Il n'a donc pas toujours de chiffres à côté de lui : il parle des métriques, et non de « ces chiffres », que la période
 * suivante soit en attente, en échec ou à l'écran. Une seule phrase pour tous ces états : un texte qui change dans une région de statut peut être relu par un lecteur d'écran.
 * Il tient aussi quand la requête de la page échoue plus de cinq minutes, le cache ayant retiré la réponse qui le portait (bdesk-38k.79). Quand le fuseau du navigateur change,
 * il ne dit rien du nouveau tant que le serveur n'a pas répondu, et les chiffres de l'ancien ne restent pas à l'écran sans lui : le squelette les remplace jusqu'à la réponse.
 */
export function ZoneNotice({ asked, counted }: { asked: string; counted: string }) {
  return (
    <Notice icon={Info} title={`Le serveur ne connaît pas votre fuseau, ${asked}`}>
      Les jours, les semaines et les heures des métriques sont comptés en {counted}, le fuseau du serveur.
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
