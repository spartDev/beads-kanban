import type { ReactNode } from 'react';
import { cx } from '../lib/cx';
import type { ColumnId } from './columns';
import { closedEarlierLabel, closedUndatedLabel, COLUMN_META, daysLabel, ticketNoun } from './meta';
import { doneDayChoices } from './params';

export const columnTitleId = (id: ColumnId) => `kanban-${id}-title`;
export const columnCountId = (id: ColumnId) => `kanban-${id}-count`;

/**
 * Une colonne : titre, nombre de cartes, la règle qui y range un ticket, puis ses cartes (`children`, des `<li>`).
 * Sur mobile, une seule colonne est affichée à la fois (`shown`) ; dès que le panneau est assez large, toutes le sont.
 * Un titre long passe à la ligne : la colonne ne rogne rien.
 */
export function Column({
  id,
  count,
  shown,
  doneDays,
  since,
  closedEarlier,
  closedUndated,
  onDoneDays,
  children,
}: {
  id: ColumnId;
  count: number;
  /** La colonne affichée quand le panneau est trop étroit pour les cinq. */
  shown: boolean;
  doneDays: number;
  /** Terminé : minuit du premier jour de la fenêtre (ms epoch), que la règle écrit en toutes lettres. */
  since: number;
  /** Terminé : tickets fermés avant la fenêtre, dont la date de clôture est connue. */
  closedEarlier: number;
  /** Terminé : tickets fermés sans date de clôture lisible, qu'on ne peut pas dire « plus tôt ». */
  closedUndated: number;
  onDoneDays: (days: number) => void;
  children: ReactNode;
}) {
  const meta = COLUMN_META[id];
  const Icon = meta.icon;

  return (
    <section
      aria-labelledby={columnTitleId(id)}
      aria-describedby={columnCountId(id)}
      data-column={id}
      data-shown={shown}
      className="hidden min-w-0 flex-col rounded-xl border border-line bg-well data-[shown=true]:flex @min-[60rem]:flex"
    >
      <header className="z-[1] flex flex-col gap-0.5 rounded-t-xl bg-well px-2.5 pb-1.5 pt-2.5 @min-[60rem]:sticky @min-[60rem]:top-11">
        <div className="flex min-h-6 min-w-0 items-center gap-2">
          <Icon size={14} strokeWidth={2} aria-hidden="true" className={cx('shrink-0', id === 'blocked' ? 'text-danger' : 'text-ink-3')} />
          <h2 id={columnTitleId(id)} className="text-ui font-semibold text-ink">
            {meta.label}
          </h2>
          <span id={columnCountId(id)} className="tnum text-xs text-ink-2">
            {count}
            <span className="sr-only"> {ticketNoun(count)}</span>
          </span>
          {id === 'done' ? <DoneWindow doneDays={doneDays} onChange={onDoneDays} /> : null}
        </div>
        <p title={meta.rule(doneDays, since)} className="text-xs text-ink-3">
          {meta.hint(doneDays)}
        </p>
      </header>

      {count > 0 ? (
        // Une seule colonne affichée et le panneau large : les cartes s'y rangent sur deux colonnes plutôt que de s'étirer.
        <ul className="grid grid-cols-1 gap-1.5 px-1.5 pb-1.5 @min-[36rem]:grid-cols-2 @min-[60rem]:grid-cols-1">{children}</ul>
      ) : (
        <p className="px-2.5 py-5 text-center text-xs text-ink-3">{meta.empty(doneDays)}</p>
      )}

      {id === 'done' && (closedEarlier > 0 || closedUndated > 0) ? (
        // Deux lignes, pas une somme : « plus tôt » ne vaut que pour une clôture datée.
        <div className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-1 text-xs text-ink-3">
          {closedEarlier > 0 ? <p>{closedEarlierLabel(closedEarlier)}</p> : null}
          {closedUndated > 0 ? <p>{closedUndatedLabel(closedUndated)}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

/** Le réglage de Terminé : combien de jours calendaires les tickets fermés y restent. Une liste native : clavier et mobile pour rien. */
function DoneWindow({ doneDays, onChange }: { doneDays: number; onChange: (days: number) => void }) {
  return (
    <>
      <label htmlFor="kanban-done-days" className="sr-only">
        Durée de Terminé
      </label>
      <select
        id="kanban-done-days"
        value={doneDays}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ml-auto h-6 min-w-0 rounded-md border border-line-strong bg-panel pl-1.5 pr-0.5 text-xs text-ink"
      >
        {doneDayChoices(doneDays).map((days) => (
          <option key={days} value={days}>
            {daysLabel(days)}
          </option>
        ))}
      </select>
    </>
  );
}
