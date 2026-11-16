import { RefreshCw } from 'lucide-react';
import { useEffect, useId, useState, type KeyboardEvent, type ReactNode } from 'react';
import { useFormat, useLanguage, useT } from '../i18n';
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
      <div className="inline-flex max-w-full flex-wrap gap-0.5 rounded-xl border border-line bg-panel p-1">
        {options.map((option) => (
          <label
            key={option.value}
            className="inline-flex h-8 cursor-default items-center rounded-lg px-3 text-ui font-semibold text-ink-2 transition-colors hover:text-ink has-[:checked]:bg-mark has-[:checked]:text-mark-ink has-[:focus-visible]:outline-2 has-[:focus-visible]:outline-offset-1 has-[:focus-visible]:outline-accent"
          >
            <input type="radio" name={name} value={option.value} checked={option.value === value} onChange={() => onChange(option.value)} className="sr-only" />
            {option.label}
          </label>
        ))}
      </div>
    </fieldset>
  );
}

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
  /** Ce que la barre offre à côté d'« Actualiser » : le bouton qui copie le rapport de rétrospective. */
  report?: ReactNode;
}

/**
 * Ce que la barre dit du calcul : l'heure du dernier (« Calculé à 20:00 », l'infobulle dit le fuseau), ou « Calcul en cours » tant que les chiffres affichés sont ceux de la période précédente.
 * Chacun des deux réserve la largeur de l'autre (bdesk-38k.80, relecture B1). Remplacé tel quel, le texte changeait la largeur du groupe de droite, qui passe à la ligne à quelques largeurs de
 * fenêtre : avec « Calcul en cours… » (78,4 px) à la place de « Calculé à 02:30 » (73,5 px), la page sautait de 44 px 300 ms après le clic, à 602 et à 862 px de fenêtre, puis remontait. Un texte
 * plus étroit n'y changerait rien : un groupe qui ne tient pas sur la ligne d'un pixel tient quand le texte rétrécit, et la page saute dans l'autre sens. `data-reserve` porte donc l'autre texte, que
 * le style écrit derrière celui-ci, invisible et sans hauteur : la largeur du groupe, la plus grande des deux, ne dépend plus de l'état. « Calcul en cours » (72,3 px, sans les points de suspension)
 * est le plus étroit des deux : la largeur au repos reste celle d'avant, à toute largeur de fenêtre.
 */
function ComputedAt({ computed, provisional }: { computed: { at: string; timeZone: string }; provisional: boolean }) {
  const texts = useT().metrics.metricsToolbar;
  const computedAt = texts.computedAt(formatTime(computed.at, computed.timeZone));
  return (
    <span
      title={texts.timeZone(computed.timeZone)}
      data-reserve={provisional ? computedAt : texts.busy}
      className="tnum after:invisible after:block after:h-0 after:overflow-hidden after:content-[attr(data-reserve)]"
    >
      {provisional ? texts.busy : computedAt}
    </span>
  );
}

/** Les réglages de la page : période, découpage, et le bouton qui recalcule (les métriques ne sont pas en direct). */
export function MetricsToolbar({ scope, period, by, today, displayed, computed, provisional, fetching, onPeriodChange, onDimensionChange, onRefresh, report }: MetricsToolbarProps) {
  const t = useT();
  const texts = t.metrics.metricsToolbar;
  const format = useFormat();
  const periodValue = period.kind === 'custom' ? 'custom' : period.range;
  const periodOptions: readonly Option<string>[] = [
    ...PRESETS.map((range) => ({ value: range, label: texts.presetDays(format.formatCount(PRESET_DAYS[range])) })),
    { value: 'custom', label: texts.custom },
  ];

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
        <Segmented legend={texts.period} name="metrics-period" options={periodOptions} value={periodValue} onChange={choosePeriod} />
        <Segmented
          legend={texts.splitBy}
          name="metrics-by"
          options={dimensionsOf(scope).map((value) => ({ value, label: t.metrics.chartSeries.dimensions[value] }))}
          value={by}
          onChange={onDimensionChange}
        />
        <div className="ml-auto flex items-center gap-2 text-micro text-ink-3">
          {computed ? <ComputedAt computed={computed} provisional={provisional === true} /> : null}
          {report}
          <button
            type="button"
            onClick={onRefresh}
            aria-label={texts.refresh}
            title={texts.refresh}
            className="grid size-9 place-items-center rounded-xl border border-line bg-panel text-ink-2 transition-colors hover:text-ink"
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
  'h-9 rounded-lg border border-line-strong bg-panel px-2.5 text-ui text-ink aria-[invalid=true]:border-danger';

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
  const texts = useT().metrics.metricsToolbar;
  const { language } = useLanguage();
  const [draft, setDraft] = useState({ from, to });
  const [address, setAddress] = useState({ from, to });
  // La plage de la dernière erreur dite. Entre deux annonces, `error` change à chaque chiffre mais `told` garde sa plage : rien ne bouge à
  // l'écran. Le texte s'écrit au rendu, dans la langue affichée : un changement de langue redit la même erreur, traduite, sans attendre.
  const [told, setTold] = useState<{ from: string; to: string } | null>(null);
  const errorId = useId();

  if (address.from !== from || address.to !== to) {
    setAddress({ from, to });
    setDraft((current) => (current.from === from && current.to === to ? current : { from, to }));
  }

  // Incomplète (un champ vidé en cours de saisie) : on attend, sans reproche. Sinon la raison que donnerait le serveur.
  const complete = draft.from !== '' && draft.to !== '';
  const checked = complete ? checkRange(draft.from, draft.to, today, language) : null;
  const error = typeof checked === 'string' ? checked : null;

  // Plus d'erreur : on oublie la dernière dite, sinon la prochaine, un état de passage peut-être, s'afficherait sans attendre.
  if (error === null && told !== null) setTold(null);

  useEffect(() => {
    if (error === null) return undefined;
    const timer = setTimeout(() => setTold({ from: draft.from, to: draft.to }), ANNOUNCE_DELAY_MS);
    return () => clearTimeout(timer);
  }, [error, draft.from, draft.to]);

  const toldText = told === null ? null : checkRange(told.from, told.to, today, language);
  // Une plage dite qui n'est plus refusée (le jour a changé) ne dit plus rien : l'erreur courante attend le silence, comme toute autre.
  const announced = error === null || typeof toldText !== 'string' ? null : toldText;
  // Aucun jour d'avant `MIN_CUSTOM_DAY` n'est offert, et « Au » ne commence pas avant « Du » non plus.
  const earliestEnd = draft.from > MIN_CUSTOM_DAY ? draft.from : MIN_CUSTOM_DAY;
  const tellNow = () => {
    if (error !== null) setTold({ from: draft.from, to: draft.to });
  };
  const tellOnEnter = (event: KeyboardEvent<HTMLInputElement>) => {
    if (event.key === 'Enter') tellNow();
  };

  const change = (next: { from: string; to: string }) => {
    setDraft(next);
    if (next.from === '' || next.to === '') return;
    const result = checkRange(next.from, next.to, today, language);
    if (typeof result !== 'string' && (next.from !== from || next.to !== to)) onApply(result);
  };

  return (
    <div role="group" aria-label={texts.customRange} className="flex flex-col gap-1.5">
      <div className="flex flex-wrap items-end gap-3">
        <label className="flex flex-col gap-1 text-micro text-ink-3">
          {texts.from}
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
          {texts.to}
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
