import { Outlet, useOutletContext } from 'react-router';
import { KanbanPage } from './KanbanPage';

/**
 * Le kanban du Projet et, par-dessus lui, le panneau du ticket ouvert (`/p/<projet>/t/<id>`, bdesk-38k.9). Le tableau
 * est l'élément de la route mère des deux adresses : passer de `/kanban` à `/t/<id>`, ou d'un ticket à l'autre, ne change
 * que la route fille (le panneau). Le tableau n'est donc jamais remonté : ses réglages, son tiroir « En pause » et sa
 * position restent ceux de l'utilisateur, et le panneau se ferme sur le tableau tel qu'il l'a laissé.
 */
export function KanbanRoute() {
  // Le contexte du Projet (`useProject`) est celui de la route mère : la route fille le reçoit tel quel.
  const context = useOutletContext();
  return (
    <>
      <KanbanPage />
      <Outlet context={context} />
    </>
  );
}
