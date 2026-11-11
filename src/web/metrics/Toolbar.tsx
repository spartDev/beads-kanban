import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent } from 'react';
import { cx } from '../lib/cx';
import {
  checkRange,
  dimensionsOf,
  lastDays,
  MIN_CUSTOM_DAY,
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
  /**
   * Les chiffres affichés sont ceux de la période précédente, gardés en attendant ceux de la période choisie : la barre le dit, en texte, à la place de l'heure de leur calcul. Ils ne
   * sont pas atténués (leur contraste tomberait sous WCAG AA, bdesk-38k.80), et le tourniquet de « Actualiser » s'arrête quand le mouvement est réduit : un texte reste.
   */
  provisional?: boolean;
  fetching: boolean;
  onPeriodChange: (period: PeriodChoice) => void;
  onDimensionChange: (by: Dimension) => void;
  onRefresh: () => void;
}

const BUSY_TEXT = 'Calcul en cours';

/**
 * Ce que la barre dit du calcul : l'heure du dernier (« Calculé à 20:00 », l'infobulle dit le fuseau), ou « Calcul en cours » tant que les chiffres affichés sont ceux de la période précédente.
 * Chacun des deux réserve la largeur de l'autre (bdesk-38k.80, relecture B1). Remplacé tel quel, le texte changeait la largeur du groupe de droite, qui passe à la ligne à quelques largeurs de
 * fenêtre : avec « Calcul en cours… » (78,4 px) à la place de « Calculé à 02:30 » (73,5 px), la page sautait de 44 px 300 ms après le clic, à 602 et à 862 px de fenêtre, puis remontait. Un texte
 * plus étroit n'y changerait rien : un groupe qui ne tient pas sur la ligne d'un pixel tient quand le texte rétrécit, et la page saute dans l'autre sens. `data-reserve` porte donc l'autre texte, que
 * le style écrit derrière celui-ci, invisible et sans hauteur : la largeur du groupe, la plus grande des deux, ne dépend plus de l'état. « Calcul en cours » (72,3 px, sans les points de suspension)
 * est le plus étroit des deux : la largeur au repos reste celle d'avant, à toute largeur de fenêtre.
 */
function ComputedAt({ computed, provisional }: { computed: { at: string; timeZone: string }; provisional: boolean }) {
  const computedAt = `Calculé à ${formatTime(computed.at, computed.timeZone)}`;
  return (
    <span
      title={`Fuseau ${computed.timeZone}`}
      data-reserve={provisional ? computedAt : BUSY_TEXT}
      className="tnum after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-reserve)]"
    >
      {provisional ? BUSY_TEXT : computedAt}
    </span>
  );
}

/** Les réglages de la page : période, découpage, et le bouton qui recalcule (les métriques ne sont pas en direct). */
export function MetricsToolbar({ scope, period, by, today, displayed, computed, provisional, fetching, onPeriodChange, onDimensionChange, onRefresh }: MetricsToolbarProps) {
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
          {computed ? <ComputedAt computed={computed} provisional={provisional === true} /> : null}
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
 * Le silence, après le dernier chiffre tapé, au bout duquel une plage refusée est dite. Un champ de date tapé au clavier émet
 * une date à chaque chiffre : pour 2026, 0002, 0020 et 0202 d'abord. Ce ne sont que des états de passage, et une alerte
 * interrompt le lecteur d'écran : la dire à chaque chiffre empêcherait de taper.
 */
const ANNOUNCE_DELAY_MS = 800;

/**
 * Les deux jours d'une plage personnalisée. Elle s'applique dès qu'elle est valable ; sinon l'erreur est dite sous les champs,
 * une fois la saisie posée : après un silence (`ANNOUNCE_DELAY_MS`), ou tout de suite quand on quitte le champ ou tape Entrée.
 * Une plage qui redevient valable retire l'erreur aussitôt, et la suivante attend de nouveau.
 *
 * Les champs n'offrent que les jours du 1er janvier 1970 à aujourd'hui (`min` et `max`). Un jour tapé au clavier peut sortir de ces
 * bornes (taper 2026 passe par 0002, 0020 et 0202) : la plage est alors refusée, et dite, comme n'importe quelle autre, sans rien
 * demander au serveur.
 *
 * Les champs repartent de la plage de l'adresse quand elle change d'ailleurs (un lien, « Retour »). Quand elle change parce que
 * ce composant vient de l'appliquer, ils la montrent déjà et rien ne bouge. Le composant ne doit surtout pas être remonté à chaque
 * plage appliquée (une `key` tirée de la plage) : le champ qu'on tape serait remplacé par un autre, le focus tomberait sur la
 * page et la frappe suivante serait perdue. Pour le 12, « 1 » donne déjà une date valable (le 1er) : c'est elle qui restait.
 */
function CustomRange({ from, to, today, onApply }: { from: string; to: string; today: string; onApply: (period: PeriodChoice) => void }) {
  const [draft, setDraft] = useState({ from, to });
  const [address, setAddress] = useState({ from, to });
  // La dernière erreur dite. Entre deux annonces, `error` change à chaque chiffre mais `told` garde son texte : rien ne bouge à l'écran.
  const [told, setTold] = useState<string | null>(null);
  const errorId = useId();

  if (address.from !== from || address.to !== to) {
    setAddress({ from, to });
    setDraft((current) => (current.from === from && current.to === to ? current : { from, to }));
  }

  // Incomplète (un champ vidé en cours de saisie) : on attend, sans reproche. Sinon la raison que donnerait le serveur.
  const complete = draft.from !== '' && draft.to !== '';
  const checked = complete ? checkRange(draft.from, draft.to, today) : null;
  const error = typeof checked === 'string' ? checked : null;

  // Plus d'erreur : on oublie la dernière dite, sinon la prochaine, un état de passage peut-être, s'afficherait sans attendre.
  if (error === null && told !== null) setTold(null);

  useEffect(() => {
    if (error === null) return undefined;
    const timer = setTimeout(() => setTold(error), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [error]);

  const announced = error === null ? null : told;
  // Aucun jour d'avant `MIN_CUSTOM_DAY` n'est offert, et « Au » ne commence pas avant « Du » non plus.
  const earliestEnd = draft.from > MIN_CUSTOM_DAY ? draft.from : MIN_CUSTOM_DAY;
  const tellNow = () => {
    if (error !== null) setTold(error);
  };
  const tellOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') tellNow();
  };

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
            min={MIN_CUSTOM_DAY}
            max={draft.to || today}
            aria-invalid={announced ? true : undefined}
            aria-describedby={announced ? errorId : undefined}
            onChange={(event) => change({ ...draft, from: event.target.value })}
            onBlur={tellNow}
            onKeyDown={tellOnEnter}
            className={DATE_INPUT}
          />
        </label>
        <label className="flex flex-col gap-1 text-micro text-ink-3">
          Au
          <input
            type="date"
            value={draft.to}
            min={earliestEnd}
            max={today}
            aria-invalid={announced ? true : undefined}
            aria-describedby={announced ? errorId : undefined}
            onChange={(event) => change({ ...draft, to: event.target.value })}
            onBlur={tellNow}
            onKeyDown={tellOnEnter}
            className={DATE_INPUT}
          />
        </label>
      </div>
      {announced ? (
        <p id={errorId} role="alert" className="text-micro text-danger">
          {announced}
        </p>
      ) : null}
    </div>
  );
}
