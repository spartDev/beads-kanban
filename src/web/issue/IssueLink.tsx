import type { ComponentProps } from 'react';
import { Link, useLocation } from 'react-router';
import { paths } from '../paths';

/**
 * Lien vers un autre ticket depuis le panneau d'un ticket. Il *remplace* l'entrée d'historique du panneau au lieu d'en
 * ajouter une : le panneau est une couche posée sur le tableau, et « Retour » la ferme toujours, quel que soit le nombre
 * de tickets parcourus. Il garde les réglages du tableau portés par l'adresse (`?epic=`, `?done=`, `?col=`).
 */
export function IssueLink({
  projectId,
  id,
  ...props
}: { projectId: string; id: string } & Omit<ComponentProps<typeof Link>, 'to' | 'replace'>) {
  const { search } = useLocation();
  return <Link to={{ pathname: paths.issue(projectId, id), search }} replace {...props} />;
}
