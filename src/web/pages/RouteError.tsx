import { CircleAlert } from 'lucide-react';
import { isRouteErrorResponse, useRouteError } from 'react-router';
import { cx } from '../lib/cx';
import { paths } from '../paths';
import { Notice } from '../ui/states';

/** Erreur d'affichage d'une page : le message, et un chemin de sortie. */
export function RouteError({ standalone = false }: { standalone?: boolean }) {
  const error = useRouteError();
  const message = isRouteErrorResponse(error)
    ? `${error.status} ${error.statusText}`
    : error instanceof Error
      ? error.message
      : String(error);

  return (
    <div className={cx('mx-auto w-full max-w-4xl px-4 py-6 md:px-8 md:py-8', standalone && 'grid min-h-dvh place-items-center')}>
      <Notice
        tone="danger"
        icon={CircleAlert}
        title="Une erreur a interrompu l’affichage de cette page"
        action={
          <a href={paths.global()} className="font-medium text-accent hover:underline">
            Recharger la Vue globale
          </a>
        }
      >
        <p className="font-mono text-xs">{message}</p>
      </Notice>
    </div>
  );
}
