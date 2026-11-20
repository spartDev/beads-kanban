import type { ReactNode } from 'react';
import { useFormat, useLanguage, useT } from '../i18n';
import { cx } from '../lib/cx';
import type { ColumnId } from './columns';
import type { BoardLayout } from './layout';
import { closedEarlierLabel, closedUndatedLabel, columnMeta, daysLabel, ticketNoun } from './meta';
import { doneDayChoices } from './params';

export const columnTitleId = (id: ColumnId) => `kanban-${id}-title`;
export const columnCountId = (id: ColumnId) => `kanban-${id}-count`;

/**
 * Une colonne : titre, nombre de cartes, la règle qui y range un ticket, puis ses cartes (`children`, des `<li>`).
 * Sur mobile, une seule colonne est affichée à la fois (`shown`) ; dès que le panneau est assez large pour toutes (`layout`, selon leur nombre),
 * toutes le sont. Un titre long passe à la ligne, entre deux mots : la colonne ne rogne rien. Dans une colonne étroite (six à huit côte à côte),
 * l'en-tête se lit comme une phrase (`layout.inlineHeader`) : pictogramme, libellé, compte et choix de Terminé se suivent, séparés d'espaces, et
 * passent à la ligne entre deux mots, comme un texte. Les colonnes y sont des sous-grilles de deux rangées : tous les en-têtes ont la hauteur du plus
 * haut, et ce qui les suit (la liste, la note de Terminé) est réuni dans un bloc (`layout.body`), la seconde rangée, dont la carte lit la largeur.
 */
export function Column({
  id,
  count,
  shown,
  layout,
  columns,
  doneDays,
  since,
  closedEarlier,
  closedUndated,
  onDoneDays,
  children,
}: {
  id: ColumnId;
  count: number;
  /** La colonne affichée quand le panneau est trop étroit pour toutes les colonnes. */
  shown: boolean;
  /** La disposition du tableau, selon son nombre de colonnes : le seuil où elles sont côte à côte. */
  layout: BoardLayout;
  /** Les colonnes du tableau : la règle de Bloqué ne cite que les Statuts de relais qui y ont la leur. */
  columns: readonly ColumnId[];
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
  const { language } = useLanguage();
  const format = useFormat();
  const meta = columnMeta(language)[id];
  const Icon = meta.icon;

  return (
    <section
      aria-labelledby={columnTitleId(id)}
      aria-describedby={columnCountId(id)}
      data-column={id}
      data-shown={shown}
      className={cx('hidden min-w-0 flex-col rounded-xl border border-line bg-well data-[shown=true]:flex', layout.column)}
    >
      <header className={cx('z-[1] flex flex-col gap-0.5 rounded-t-xl bg-well px-2.5 pb-1.5 pt-2.5', layout.header)}>
        <div className={cx('flex min-h-6 min-w-0 items-center gap-2', layout.headerRow)}>
          <Icon
            size={14}
            strokeWidth={2}
            aria-hidden="true"
            className={cx('shrink-0', id === 'blocked' ? 'text-danger' : 'text-ink-3', layout.headerIcon)}
          />
          <h2 id={columnTitleId(id)} className={cx('text-ui font-semibold text-ink', layout.title)}>
            {meta.label}
          </h2>
          {/* Une espace, où la ligne de texte d'une colonne étroite peut passer à la ligne ; une boîte flex l'ignore. */}
          {layout.inlineHeader ? ' ' : null}
          <span id={columnCountId(id)} className="tnum text-xs text-ink-2">
            {format.formatCount(count)}
            <span className="sr-only"> {ticketNoun(count, language)}</span>
          </span>
          {id === 'done' && layout.inlineHeader ? ' ' : null}
          {id === 'done' ? <DoneWindow doneDays={doneDays} onChange={onDoneDays} /> : null}
        </div>
        <p title={meta.rule(doneDays, since, columns)} className="text-xs text-ink-3">
          {meta.hint(doneDays)}
        </p>
      </header>

      <Body className={layout.body}>
        {count > 0 ? (
          // Une seule colonne affichée et le panneau large : les cartes s'y rangent sur deux colonnes (`layout.cards`), plutôt que de s'étirer.
          <ul className={cx('grid grid-cols-1 gap-1.5 px-1.5 pb-1.5', layout.cards)}>{children}</ul>
        ) : (
          <p className="px-2.5 py-5 text-center text-xs text-ink-3">{meta.empty(doneDays)}</p>
        )}

        {id === 'done' && (closedEarlier > 0 || closedUndated > 0) ? (
          // Deux lignes, pas une somme : « plus tôt » ne vaut que pour une clôture datée.
          <div className="flex flex-col gap-0.5 px-2.5 pb-2.5 pt-1 text-xs text-ink-3">
            {closedEarlier > 0 ? <p>{closedEarlierLabel(closedEarlier, language)}</p> : null}
            {closedUndated > 0 ? <p>{closedUndatedLabel(closedUndated, language)}</p> : null}
          </div>
        ) : null}
      </Body>
    </section>
  );
}

/**
 * Ce qui suit l'en-tête d'une colonne : de six à huit colonnes, réuni dans un bloc (`layout.body`), qui tient dans la seconde rangée de la sous-grille
 * et dont la carte lit la largeur ; à cinq (`null`), tel quel, comme avant : le tableau garde son DOM.
 */
function Body({ className, children }: { className: string | null; children: ReactNode }) {
  return className === null ? <>{children}</> : <div data-column-body className={className}>{children}</div>;
}

/** Le réglage de Terminé : combien de jours calendaires les tickets fermés y restent. Une liste native : clavier et mobile pour rien. */
function DoneWindow({ doneDays, onChange }: { doneDays: number; onChange: (days: number) => void }) {
  const { language } = useLanguage();
  const t = useT();
  return (
    <>
      <label htmlFor="kanban-done-days" className="sr-only">
        {t.kanban.board.doneWindow}
      </label>
      <select
        id="kanban-done-days"
        value={doneDays}
        onChange={(event) => onChange(Number(event.target.value))}
        className="ml-auto h-6 min-w-0 rounded-md border border-line-strong bg-panel pl-1.5 pr-0.5 text-xs text-ink"
      >
        {doneDayChoices(doneDays).map((days) => (
          <option key={days} value={days}>
            {daysLabel(days, language)}
          </option>
        ))}
      </select>
    </>
  );
}
