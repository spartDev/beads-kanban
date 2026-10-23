import { SearchX } from 'lucide-react';
import { Link } from 'react-router';
import { useDocumentTitle } from '../lib/useDocumentTitle';
import { paths } from '../paths';
import { Notice } from '../ui/states';
import { Page } from './Page';

export function NotFoundPage() {
  useDocumentTitle('Page introuvable');
  return (
    <Page title="Page introuvable">
      <Notice
        icon={SearchX}
        title="Cette adresse ne correspond à aucune page"
        action={
          <Link to={paths.global()} className="font-medium text-accent hover:underline">
            Aller à la Vue globale
          </Link>
        }
      >
        Les pages d’un Projet sont de la forme <code>/p/identifiant/kanban</code>.
      </Notice>
    </Page>
  );
}
