import { RefreshCw } from 'lucide-react';
import { useId, useState } from 'react';
import { cx } from '../lib/cx';
import {
  checkRange,
  dimensionsOf,
  lastDays,
  PRESET_DAYS,
  PRESETS,
  type Dimension,
  type PeriodChoice,
  type Scope,
} from './params';
import { DIMENSION_LABELS } from './series';
import { formatTime } from './format';

interface Option<T extends string> {
  value: T;
  label: string;
}

/**
 * Un choix parmi quelques-uns, en boutons radio natifs (flèches du clavier, lecteurs d'écran) habillés en commutateur.
 * Le choix est fait quand on le clique : pas de bouton « Appliquer ».
 */
function Segmented<T extends string>({ legend, name, options, value, onChange }: { legend: string; name: string; options: readonly Option<T>[]; value: T; onChange: (value: T) => void }) {
  return (
    <fieldset className="flex min-w-0 flex-col gap-1">
      <legend className="mb-1 text-micro text-ink-3">{legend}</legend>
      <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-lg border border-line bg-well p-0.5">
        {options.map((option) => (
          <label
            key={option.value}
            className="inline-flex h-7 cursor-default items-center rounded-md px-2.5 text-ui font-medium text-ink-2 transition-colors hover:text-ink has-[:checked]:bg-panel has-[:checked]:text-ink has-[:checked]:shadow-panel has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
          >
            <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

const PERIOD_OPTIONS: readonly Option<string>[] = [
  ...PRESETS.map((range) => ({ value: range, label: `${PRESET_DAYS[range]} jours` })),
  { value: 'custom', label: 'Personnalisée' },
];

export interface MetricsToolbarProps {
  scope: Scope;
  period: PeriodChoice;
  by: Dimension;
  /** Aujourd'hui (AAAA-MM-JJ), dans le fuseau de l'utilisateur : la plage ne peut pas le dépasser. */
  today: string;
  /** La période que la réponse affichée couvre : point de départ de « Personnalisée ». */
  displayed?: { from: string; to: string };
  /** Quand et dans quel fuseau les chiffres affichés ont été calculés. */
  computed?: { at: string; timeZone: string };
  fetching: boolean;
  onPeriodChange: (period: PeriodChoice) => void;
  onDimensionChange: (by: Dimension) => void;
  onRefresh: () => void;
}

/** Les réglages de la page : période, découpage, et le bouton qui recalcule (les métriques ne sont pas en direct). */
export function MetricsToolbar({ scope, period, by, today, displayed, computed, fetching, onPeriodChange, onDimensionChange, onRefresh }: MetricsToolbarProps) {
  const periodValue = period.kind === 'custom' ? 'custom' : period.range;

  const choosePeriod = (value: string) => {
    if (value === 'custom') {
      // « Personnalisée » part de la période affichée : les chiffres ne bougent pas tant qu'on n'a pas choisi d'autres jours.
      const range = displayed ?? lastDays(today, 30);
      onPeriodChange({ kind: 'custom', ...range });
    } else {
      const preset = PRESETS.find((candidate) => candidate === value);
      if (preset) onPeriodChange({ kind: 'preset', range: preset });
    }
  };

  return (
    <div className="flex flex-col gap-3">
      <div className="flex flex-wrap items-end gap-x-5 gap-y-3">
        <Segmented legend="Période" name="metrics-period" options={PERIOD_OPTIONS} value={periodValue} onChange={choosePeriod} />
        <Segmented
          legend="Découper par"
          name="metrics-by"
          options={dimensionsOf(scope).map((value) => ({ value, label: DIMENSION_LABELS[value] }))}
          value={by}
          onChange={onDimensionChange}
        />
        <div className="ml-auto flex items-center gap-2 text-micro text-ink-3">
          {computed ? (
            <span title={`Fuseau ${computed.timeZone}`} className="tnum">
              Calculé à {formatTime(computed.at, computed.timeZone)}
            </span>
          ) : null}
          <button
            type="button"
            onClick={onRefresh}
            aria-label="Actualiser les métriques"
            title="Actualiser les métriques"
            className="grid size-8 place-items-center rounded-lg border border-line bg-well text-ink-2 transition-colors hover:text-ink"
          >
            <RefreshCw size={14} aria-hidden="true" className={cx(fetching && 'animate-spin motion-reduce:animate-none')} />
          </button>
        </div>
      </div>
      {period.kind === 'custom' ? <CustomRange from={period.from} to={period.to} today={today} onApply={onPeriodChange} /> : null}
    </div>
  );
}

const DATE_INPUT =
  'h-8 rounded-md border border-line-strong bg-panel px-2 text-ui text-ink aria-[invalid=true]:border-danger';

/**
 * Les deux jours d'une plage personnalisée. Elle s'applique dès qu'elle est valable ; sinon l'erreur est dite sous les champs.
 *
 * Les champs repartent de la plage de l'adresse quand elle change d'ailleurs (un lien, « Retour »). Quand elle change parce que
 * ce composant vient de l'appliquer, ils la montrent déjà et rien ne bouge. Le composant ne doit surtout pas être remonté à chaque
 * plage appliquée (une `key` tirée de la plage) : le champ qu'on tape serait remplacé par un autre, le focus tomberait sur la
 * page et la frappe suivante serait perdue. Pour le 12, « 1 » donne déjà une date valable (le 1er) : c'est elle qui restait.
 */
function CustomRange({ from, to, today, onApply }: { from: string; to: string; today: string; onApply: (period: PeriodChoice) => void }) {
  const [draft, setDraft] = useState({ from, to });
  const [address, setAddress] = useState({ from, to });
  const errorId = useId();

  if (address.from !== from || address.to !== to) {
    setAddress({ from, to });
    setDraft((current) => (current.from === from && current.to === to ? current : { from, to }));
  }

  // Incomplète (un champ vidé en cours de saisie) : on attend, sans reproche. Sinon la raison que donnerait le serveur.
  const complete = draft.from !== '' && draft.to !== '';
  const checked = complete ? checkRange(draft.from, draft.to, today) : null;
  const error = typeof checked === 'string' ? checked : null;

  const change = (next: { from: string; to: string }) => {
    setDraft(next);
    if (next.from === '' || next.to === '') return;
    const result = checkRange(next.from, next.to, today);
    if (typeof result !== 'string' && (next.from !== from || next.to !== to)) onApply(result);
  };

  return (
    <div role="group" aria-label="Plage personnalisée" className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-micro text-ink-3">
          Du
          <input
            type="date"
            value={draft.from}
            max={draft.to || today}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => change({ ...draft, from: event.target.value })}
            className={DATE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-micro text-ink-3">
          Au
          <input
            type="date"
            value={draft.to}
            min={draft.from || undefined}
            max={today}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            onChange={(event) => change({ ...draft, to: event.target.value })}
            className={DATE_INPUT}
          />
        </label>
      </div>
      {error ? (
        <p id={errorId} role="alert" className="text-micro text-danger">
          {error}
        </p>
      ) : null}
    </div>
  );
}
