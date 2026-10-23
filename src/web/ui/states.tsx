import { CircleAlert, RefreshCw, type LucideIcon } from 'lucide-react';
import type { ReactNode } from 'react';
import { describeError } from '../data/client';
import { cx } from '../lib/cx';
import { Button } from './Button';

export function Skeleton({ className }: { className?: string }) {
  return (
    <div
      aria-hidden="true"
      className={cx('animate-pulse rounded-md bg-press motion-reduce:animate-none', className)}
    />
  );
}

/**
 * État vide ou d'attente : cadre en pointillés, aligné à gauche, avec la marche à suivre.
 * `tone="danger"` pour une erreur.
 */
export function Notice({
  icon: Icon,
  title,
  children,
  action,
  tone = 'neutral',
  className,
}: {
  icon: LucideIcon;
  title: string;
  children?: ReactNode;
  action?: ReactNode;
  tone?: 'neutral' | 'danger';
  className?: string;
}) {
  const danger = tone === 'danger';
  return (
    <div
      role={danger ? 'alert' : 'status'}
      className={cx(
        'flex gap-3 rounded-lg border border-dashed p-4',
        danger ? 'border-danger/40 bg-danger-soft' : 'border-line-strong',
        className,
      )}
    >
      <Icon
        size={16}
        strokeWidth={2}
        aria-hidden="true"
        className={cx('mt-0.5 shrink-0', danger ? 'text-danger' : 'text-ink-3')}
      />
      {/* wrap-anywhere : titre et détails citent des ids, des chemins, des messages sans espace. */}
      <div className="min-w-0 wrap-anywhere">
        <p className="font-medium text-ink">{title}</p>
        {children ? <div className="mt-1 text-ink-2 [&_code]:font-mono [&_code]:text-xs">{children}</div> : null}
        {action ? <div className="mt-3">{action}</div> : null}
      </div>
    </div>
  );
}

/** Erreur de chargement : dit ce qui s'est passé et propose de réessayer. */
export function ErrorNotice({
  error,
  title,
  onRetry,
  className,
}: {
  error: unknown;
  /** Titre de contexte (`Impossible de charger les Projets`) : la cause déduite de l'erreur passe dessous. */
  title?: string;
  onRetry?: () => void;
  className?: string;
}) {
  const described = describeError(error);
  // Une cause précise (Projet illisible) est le meilleur titre ; sinon le titre de contexte passe devant la cause.
  const contextual = title !== undefined && !described.specific;
  return (
    <Notice
      tone="danger"
      icon={CircleAlert}
      title={contextual ? title : described.title}
      className={className}
      action={
        onRetry ? (
          <Button onClick={onRetry}>
            <RefreshCw size={14} aria-hidden="true" />
            Réessayer
          </Button>
        ) : null
      }
    >
      {contextual ? <p>{described.title}</p> : null}
      {described.detail ? <p>{described.detail}</p> : null}
    </Notice>
  );
}
