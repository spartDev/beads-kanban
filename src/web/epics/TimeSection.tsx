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
import { formatInstant } from '../lib/instant';
import { SectionTitle } from '../pages/Page';
import { Duration, Figure, FigureNote } from './Figure';
import { beyondAYear, describeSpan, finishWindow } from './forecastText';
import { counted } from './ProgressBar';

/**
 * Ce que la phrase ajoute pour une Epic de moins de 7 jours (`age`, son âge) : la fenêtre du Débit ne descend pas sous 7 jours, elle
 * remonte donc avant sa création. Sans cela, « 3 Livraisons sur les 7 derniers jours » surprend sur une Epic créée il y a 13 h.
 */
function YoungEpic({ age }: { age: number }) {
  return (
    <>
      {' (l’Epic n’a que '}
      <Duration ms={age} />
      {' : la mesure remonte avant sa création)'}
    </>
  );
}

/** Pourquoi la prévision est masquée, en une phrase. `age` : l'âge de l'Epic si elle a moins de 7 jours (`youngEpicAge`). */
function hiddenSentence(
  reason: ForecastHiddenReason,
  { deliveries, needed, days }: { deliveries: number; needed: number; days: number },
  age: number | null,
): ReactNode {
  switch (reason) {
    case 'epic-closed':
      return 'Epic fermée : il n’y a plus de fin à prévoir.';
    case 'no-children':
      return 'Aucun Enfant à livrer.';
    case 'all-delivered':
      return 'Tous les Enfants sont livrés ou abandonnés : l’Epic peut être fermée.';
    case 'low-throughput':
      return (
        <>
          {`Pas assez de Débit : ${counted(deliveries, 'Livraison')} sur les ${Math.round(days)} derniers jours`}
          {age === null ? null : <YoungEpic age={age} />}
          {`, il en faut au moins ${needed}.`}
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
  const created = Date.parse(epic.createdAt);
  const closed = epic.status === 'closed' && epic.closedAt ? Date.parse(epic.closedAt) : Number.NaN;
  const known = !Number.isNaN(created) && !Number.isNaN(closed);

  if (known) {
    return (
      <Figure label="Lead Time" value={<Duration ms={Math.max(0, closed - created)} />}>
        <FigureNote>
          créée le <time dateTime={epic.createdAt}>{formatInstant(epic.createdAt)}</time> · fermée le{' '}
          <time dateTime={epic.closedAt ?? undefined}>{formatInstant(epic.closedAt ?? '')}</time>
        </FigureNote>
      </Figure>
    );
  }
  return (
    <Figure
      label="Lead Time"
      value={
        <>
          <span aria-hidden="true">—</span>
          <span className="sr-only">Indéfini</span>
        </>
      }
    >
      <FigureNote>
        {epic.status === 'closed' ? (
          'sans date de clôture'
        ) : (
          <>
            pas encore fermée · ouverte depuis{' '}
            {Number.isNaN(created) ? 'une date inconnue' : <Duration ms={Math.max(0, now - created)} />}
          </>
        )}
      </FigureNote>
    </Figure>
  );
}

function ForecastFigure({ forecast, age }: { forecast: Forecast; age: number | null }) {
  if (forecast.kind === 'hidden') {
    return (
      <Figure label="Prévision de fin" value={<span className="text-ink-2">Masquée</span>}>
        <FigureNote>{hiddenSentence(forecast.reason, forecast, age)}</FigureNote>
      </Figure>
    );
  }
  const { text, spoken } = describeSpan(forecast.fastest, forecast.slowest);
  return (
    <Figure
      label="Prévision de fin"
      value={
        <>
          <span aria-hidden="true">{text}</span>
          <span className="sr-only">{spoken}</span>
        </>
      }
    >
      {/* « Plus d'un an » ne se date pas : aucun jour n'est écrit. */}
      {beyondAYear(forecast.fastest) ? null : <FigureNote>Fin estimée {finishWindow(forecast.from, forecast.to)}</FigureNote>}
      <FigureNote>
        {`Au rythme de ${counted(forecast.deliveries, 'Livraison')} en ${Math.round(forecast.days)} jours`}
        {age === null ? null : <YoungEpic age={age} />}
        {`, pour ${counted(forecast.remaining, 'Enfant')} ${forecast.remaining > 1 ? 'restants' : 'restant'}.`}
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
  return (
    <section aria-labelledby="epic-time" className="flex flex-col gap-3">
      <SectionTitle id="epic-time">Lead Time et prévision</SectionTitle>
      <dl className="grid gap-2 sm:grid-cols-2">
        <LeadTimeFigure epic={epic} now={now} />
        <ForecastFigure forecast={forecast} age={age} />
      </dl>
      <p className="max-w-[72ch] text-xs leading-5 text-ink-3">
        <strong className="font-medium text-ink-2">Méthode.</strong> Le Débit récent de l’Epic (ses Livraisons des {RECENT_DAYS} derniers
        jours, ou depuis sa création si elle est plus récente, mais jamais sur moins de {MIN_WINDOW_DAYS} jours : la mesure d’une Epic
        de moins de {MIN_WINDOW_DAYS} jours remonte donc avant sa création) donne un rythme, appliqué aux Enfants qui restent à livrer :
        ceux en pause comptent, les Abandons non. La fourchette tient compte du hasard d’un petit nombre de
        Livraisons (plus ou moins la racine de leur nombre). Elle suppose que le rythme se maintient et qu’aucun Enfant n’est ajouté ; ce
        n’est pas un engagement. Sous {MIN_DELIVERIES} Livraisons récentes, elle est masquée.
      </p>
    </section>
  );
}
