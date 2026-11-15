import { useQueryClient } from '@tanstack/react-query';
import { Check, ChevronRight, ClipboardCopy, TriangleAlert } from 'lucide-react';
import { useCallback, useEffect, useState } from 'react';
import { signalsQuery } from '../data/hooks';
import { browserTimeZone } from '../lib/instant';
import type { NamedMetricsResponse } from './api';
import { buildRetrospective, type RetrospectiveSignals } from './retrospective';

/** Combien de temps « Rapport copié » (ou l'échec) reste dit avant que le bouton ne redevienne lui-même. */
const FEEDBACK_MS = 2_500;

/**
 * Le rapport de rétrospective des chiffres affichés, à la demande. Les Signaux n'en font pas partie : ils se lisent à part (`GET /api/signals`), au moment
 * du rapport, depuis le cache quand il est frais. Leur échec ne bloque pas le rapport : il le dit à leur place. Sans chiffres, il n'y a pas de rapport.
 */
export function useRetrospective({ projectId, scopeName, metrics }: { projectId: string | undefined; scopeName: string; metrics: NamedMetricsResponse | undefined }) {
  const client = useQueryClient();
  return useCallback(async (): Promise<string | undefined> => {
    if (!metrics) return undefined;
    let signals: RetrospectiveSignals;
    try {
      signals = { status: 'ok', response: await client.fetchQuery(signalsQuery(projectId, browserTimeZone())) };
    } catch {
      signals = { status: 'error' };
    }
    return buildRetrospective({ scopeName, metrics, signals });
  }, [client, projectId, scopeName, metrics]);
}

/**
 * Copie un texte qui n'est pas encore prêt (les Signaux se lisent d'abord). Safari refuse `writeText` après une attente : le clic qui l'autorise est alors
 * consommé. Un `ClipboardItem` qui reçoit la promesse est écrit pendant le clic, et rempli quand elle se résout ; sans lui, `writeText` à la résolution.
 */
async function copyText(text: Promise<string>): Promise<void> {
  if (typeof ClipboardItem !== 'undefined' && typeof navigator.clipboard.write === 'function') {
    await navigator.clipboard.write([new ClipboardItem({ 'text/plain': text.then((value) => new Blob([value], { type: 'text/plain' })) })]);
    return;
  }
  await navigator.clipboard.writeText(await text);
}

type CopyState = 'idle' | 'copying' | 'copied' | 'failed';

/**
 * « Copier le rapport » : le rapport de rétrospective de la période affichée, en markdown, dans le presse-papiers. Le résultat est dit dans le bouton et à
 * un lecteur d'écran ; si le navigateur refuse la copie, l'aperçu (`RetrospectivePreview`) permet de la faire à la main.
 */
export function CopyRetrospectiveButton({ build, disabled }: { build: () => Promise<string | undefined>; disabled: boolean }) {
  const [state, setState] = useState<CopyState>('idle');

  useEffect(() => {
    if (state !== 'copied' && state !== 'failed') return undefined;
    const timer = setTimeout(() => setState('idle'), FEEDBACK_MS);
    return () => clearTimeout(timer);
  }, [state]);

  const copy = async () => {
    setState('copying');
    try {
      await copyText(
        build().then((text) => {
          if (text === undefined) throw new Error('Pas de chiffres à copier.');
          return text;
        }),
      );
      setState('copied');
    } catch {
      setState('failed');
    }
  };

  const Icon = state === 'copied' ? Check : state === 'failed' ? TriangleAlert : ClipboardCopy;
  const label = state === 'copied' ? 'Rapport copié' : state === 'failed' ? 'Copie impossible' : 'Copier le rapport';

  return (
    <>
      <button
        type="button"
        onClick={() => void copy()}
        disabled={disabled || state === 'copying'}
        title="Copier le rapport de rétrospective de la période, en markdown"
        className="inline-flex h-9 items-center gap-2 rounded-xl border border-line bg-panel px-3 text-ui font-semibold text-ink transition-colors hover:border-line-strong disabled:opacity-60"
      >
        <Icon size={14} aria-hidden="true" className={state === 'failed' ? 'text-danger' : undefined} />
        {label}
      </button>
      <span aria-live="polite" className="sr-only">
        {state === 'copied' ? 'Rapport de rétrospective copié dans le presse-papiers.' : state === 'failed' ? 'Copie impossible : le rapport est dans l’aperçu, à copier à la main.' : ''}
      </span>
    </>
  );
}

/** L'aperçu du rapport, replié : il se construit à l'ouverture, avec les Signaux du moment, et se reconstruit quand les chiffres changent. */
export function RetrospectivePreview({ build }: { build: () => Promise<string | undefined> }) {
  const [open, setOpen] = useState(false);
  const [text, setText] = useState<string | undefined>(undefined);

  useEffect(() => {
    if (!open) return undefined;
    let current = true;
    void build().then((built) => {
      if (current) setText(built);
    });
    return () => {
      current = false;
    };
  }, [open, build]);

  return (
    <details className="group text-micro" onToggle={(event) => setOpen(event.currentTarget.open)}>
      <summary className="-my-1 flex cursor-pointer list-none items-center gap-1 py-1 font-medium text-ink-2 hover:text-ink [&::-webkit-details-marker]:hidden">
        <ChevronRight size={14} aria-hidden="true" className="text-ink-3 transition-transform group-open:rotate-90" />
        Aperçu du rapport de rétrospective
      </summary>
      <div className="mt-2 max-h-96 overflow-auto rounded-md border border-line bg-well" tabIndex={0} role="region" aria-label="Rapport de rétrospective (markdown)">
        <pre className="w-max min-w-full p-3 font-mono text-xs leading-5 whitespace-pre text-ink">{text ?? 'Préparation du rapport…'}</pre>
      </div>
    </details>
  );
}
