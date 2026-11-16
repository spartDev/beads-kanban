import type { ReactNode } from 'react';
import {
  type EpicTicket,
  type Forecast,
  type ForecastHiddenReason,
  forecastEnd,
  MIN_DELIVERIES,
  MIN_WINDOW_DAYS,
  RECENT_DAYS,
  youngEpicAge,
} from '../../domain/epics';
import type { Issue } from '../data/types';
import { useFormat, useT, type DisplayFormat, type Messages } from '../i18n';
import { SectionTitle } from '../pages/Page';
import { Duration, Figure, FigureNote } from './Figure';
import { beyondAYear, describeSpan, finishWindow } from './forecastText';

/**
 * Ce que la phrase ajoute pour une Epic de moins de 7 jours (`age`, son âge) : la fenêtre du Débit ne descend pas sous 7 jours, elle
 * remonte donc avant sa création. Sans cela, « 3 Livraisons sur les 7 derniers jours » surprend sur une Epic créée il y a 13 h.
 */
function YoungEpic({ age }: { age: number }) {
  const words = useT().epics.time;
  return (
    <>
      {words.youngEpicStart}
      <Duration ms={age} />
      {words.youngEpicEnd}
    </>
  );
}

/** Pourquoi la prévision est masquée, en une phrase. `age` : l'âge de l'Epic si elle a moins de 7 jours (`youngEpicAge`). */
function hiddenSentence(
  reason: ForecastHiddenReason,
  { deliveries, needed, days }: { deliveries: number; needed: number; days: number },
  age: number | null,
  t: Messages,
  { formatCount }: Pick<DisplayFormat, 'formatCount'>,
): ReactNode {
  const words = t.epics.time;
  switch (reason) {
    case 'epic-closed':
      return words.epicClosed;
    case 'no-children':
      return words.noChildren;
    case 'all-delivered':
      return words.allDelivered;
    case 'low-throughput':
      return (
        <>
          {words.lowThroughput(t.epics.counted.deliveries(deliveries, formatCount(deliveries)), formatCount(Math.round(days)))}
          {age === null ? null : <YoungEpic age={age} />}
          {words.lowThroughputEnd(formatCount(needed))}
        </>
      );
  }
}

/**
 * Le Lead Time de l'Epic : la Durée écoulée entre sa création et sa dernière clôture, comme pour tout ticket (CONTEXT.md). Il
 * n'existe qu'une fois l'Epic fermée ; tant qu'elle est ouverte on dit depuis quand, et que le Lead Time reste à venir. Calculé
 * ici de ses deux dates plutôt que lu dans la chronologie du ticket : c'est la même définition (à la seconde près, celle des
 * colonnes `created_at` et `closed_at`), sans attendre la lecture de l'historique du Projet.
 */
function LeadTimeFigure({ epic, now }: { epic: Issue; now: number }) {
  const words = useT().epics.time;
  const { formatInstant } = useFormat();
  const created = Date.parse(epic.createdAt);
  const closed = epic.status === 'closed' && epic.closedAt ? Date.parse(epic.closedAt) : Number.NaN;
  const known = !Number.isNaN(created) && !Number.isNaN(closed);

  if (known) {
    return (
      <Figure label={words.leadTime} value={<Duration ms={Math.max(0, closed - created)} />}>
        <FigureNote>
          {words.createdOn} <time dateTime={epic.createdAt}>{formatInstant(epic.createdAt)}</time> · {words.closedOn}{' '}
          <time dateTime={epic.closedAt ?? undefined}>{formatInstant(epic.closedAt ?? '')}</time>
        </FigureNote>
      </Figure>
    );
  }
  return (
    <Figure
      label={words.leadTime}
      value={
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">{words.undefined}</span>
        </>
      }
    >
      <FigureNote>
        {epic.status === 'closed' ? (
          words.noCloseDate
        ) : (
          <>
            {words.openSince}{' '}
            {Number.isNaN(created) ? words.unknownDate : <Duration ms={Math.max(0, now - created)} />}
          </>
        )}
      </FigureNote>
    </Figure>
  );
}

function ForecastFigure({ forecast, age }: { forecast: Forecast; age: number | null }) {
  const t = useT();
  const format = useFormat();
  const { time: words, counted, span } = t.epics;
  if (forecast.kind === 'hidden') {
    return (
      <Figure label={words.forecast} value={<span className="text-ink-2">{words.hidden}</span>}>
        <FigureNote>{hiddenSentence(forecast.reason, forecast, age, t, format)}</FigureNote>
      </Figure>
    );
  }
  const { text, spoken } = describeSpan(forecast.fastest, forecast.slowest, span, format);
  return (
    <Figure
      label={words.forecast}
      value={
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{spoken}</span>
        </>
      }
    >
      {/* « Plus d'un an » ne se date pas : aucun jour n'est écrit. */}
      {beyondAYear(forecast.fastest) ? null : <FigureNote>{words.estimatedEnd(finishWindow(forecast.from, forecast.to, span, format))}</FigureNote>}
      <FigureNote>
        {words.pace(counted.deliveries(forecast.deliveries, format.formatCount(forecast.deliveries)), format.formatCount(Math.round(forecast.days)))}
        {age === null ? null : <YoungEpic age={age} />}
        {words.paceEnd(forecast.remaining, counted.children(forecast.remaining, format.formatCount(forecast.remaining)))}
      </FigureNote>
    </Figure>
  );
}

/**
 * Le Lead Time de l'Epic et la prévision de sa fin, avec la méthode écrite sous les deux cases : la prévision n'est lisible
 * que si l'on sait d'où elle vient, et elle ne prétend pas à plus que ce que son rythme permet (une fourchette arrondie, masquée
 * sans assez de Débit). `kids` : les Enfants de l'Epic hors Epics imbriquées, ceux d'`epicChildren` ; la prévision n'y compte pas
 * les Abandons.
 */
export function TimeSection({ epic, kids, now }: { epic: Issue; kids: readonly EpicTicket[]; now: number }) {
  const forecast = forecastEnd(epic, kids, now);
  const age = youngEpicAge(epic.createdAt, now);
  const words = useT().epics.time;
  const { formatCount } = useFormat();
  return (
    <section aria-labelledby="epic-time" className="flex flex-col gap-3">
      <SectionTitle id="epic-time">{words.title}</SectionTitle>
      <dl className="grid gap-2 sm:grid-cols-2">
        <LeadTimeFigure epic={epic} now={now} />
        <ForecastFigure forecast={forecast} age={age} />
      </dl>
      <p className="max-w-[72ch] text-xs leading-5 text-ink-3">
        <strong className="font-medium text-ink-2">{words.methodTitle}</strong>{' '}
        {words.method(formatCount(RECENT_DAYS), formatCount(MIN_WINDOW_DAYS), formatCount(MIN_DELIVERIES))}
      </p>
    </section>
  );
}
