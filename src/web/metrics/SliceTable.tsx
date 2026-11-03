import { useId } from 'react';
import { Link } from 'react-router';
import type { MetricsDurationStats } from '../../shared/api';
import { cx } from '../lib/cx';
import { Swatch, SectionHeading } from './ChartParts';
import { formatCount, formatDuration, formatPercent } from './format';
import type { Dimension } from './params';
import { DIMENSION_LABELS } from './series';
import type { FailureCell, SliceRow, SliceTableView } from './slices';

/**
 * Le tableau du découpage choisi : une ligne par type, priorité ou Projet, avec Débit, Lead Time, Cycle Time, Taux
 * d'échec et WIP, et en dernière ligne l'ensemble (les tuiles). Large, c'est un tableau ; étroit (un conteneur de moins
 * de 44 rem, donc sur mobile), chaque ligne devient une fiche de deux colonnes : les rôles ARIA sont posés
 * explicitement pour que la sémantique de tableau survive au changement d'affichage.
 */
/*
 * Les classes sont écrites en entier : Tailwind lit le code source à la recherche de noms de classes complets, il ne sait
 * pas reconstituer un nom assemblé par interpolation. Le seuil (`@max-[44rem]`, un conteneur de moins de 704 px) est le
 * même partout.
 */
const CELL =
  'px-3 py-2 text-right align-top @max-[44rem]:flex @max-[44rem]:flex-col @max-[44rem]:p-0 @max-[44rem]:text-left @max-[44rem]:before:block @max-[44rem]:before:text-micro @max-[44rem]:before:font-normal @max-[44rem]:before:text-ink-3 @max-[44rem]:before:content-[attr(data-label)]';

export function SliceTable({ view, dimension }: { view: SliceTableView; dimension: Dimension }) {
  const titleId = useId();
  const noun = DIMENSION_LABELS[dimension].toLowerCase();
  const columns = [
    ['Débit', 'throughput'],
    ['Lead Time', 'leadTime'],
    ['Cycle Time', 'cycleTime'],
    ...(view.failureColumn ? ([['Taux d’échec', 'failure']] as const) : []),
    ['WIP', 'wip'],
  ] as const;

  return (
    <section aria-labelledby={titleId} className="@container flex min-w-0 flex-col gap-3">
      <SectionHeading id={titleId}>Découpage par {noun}</SectionHeading>
      <div className="min-w-0 rounded-lg border border-line bg-panel p-1 @max-[44rem]:border-0 @max-[44rem]:bg-transparent @max-[44rem]:p-0">
        <table role="table" className="w-full border-collapse text-ui tnum @max-[44rem]:block">
          <caption className="sr-only">Métriques de la période par {noun}</caption>
          <thead role="rowgroup" className="@max-[44rem]:sr-only">
            <tr role="row" className="text-micro text-ink-3">
              <th role="columnheader" scope="col" className="px-3 py-2 text-left font-normal">
                {DIMENSION_LABELS[dimension]}
              </th>
              {columns.map(([label]) => (
                <th key={label} role="columnheader" scope="col" className="px-3 py-2 text-right font-normal">
                  {label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody role="rowgroup" className="@max-[44rem]:flex @max-[44rem]:flex-col @max-[44rem]:gap-2">
            {view.rows.map((row) => (
              <Row key={row.key} row={row} failureColumn={view.failureColumn} />
            ))}
          </tbody>
          <tfoot role="rowgroup" className="@max-[44rem]:mt-2 @max-[44rem]:block">
            <Row row={view.overall} failureColumn={view.failureColumn} total />
          </tfoot>
        </table>
      </div>
      {view.coverageNote ? <p className="max-w-[90ch] text-micro leading-4 text-ink-3">{view.coverageNote}</p> : null}
    </section>
  );
}

function Row({ row, failureColumn, total = false }: { row: SliceRow; failureColumn: boolean; total?: boolean }) {
  return (
    <tr
      role="row"
      data-row={row.key}
      className={cx(
        'border-t border-line @max-[44rem]:grid @max-[44rem]:grid-cols-2 @max-[44rem]:gap-x-4 @max-[44rem]:gap-y-2 @max-[44rem]:rounded-lg @max-[44rem]:border @max-[44rem]:p-3',
        total ? 'bg-well font-medium @max-[44rem]:bg-well' : '@max-[44rem]:bg-panel',
      )}
    >
      <th role="rowheader" scope="row" className="px-3 py-2 text-left align-top font-medium text-ink @max-[44rem]:col-span-2 @max-[44rem]:p-0">
        <Label row={row} />
      </th>
      <td role="cell" data-label="Débit" className={CELL}>
        <span className="font-medium text-ink">{formatCount(row.throughput)}</span>
      </td>
      <td role="cell" data-label="Lead Time" className={CELL}>
        <Duration stats={row.leadTime} />
      </td>
      <td role="cell" data-label="Cycle Time" className={CELL}>
        <Duration stats={row.cycleTime} />
      </td>
      {failureColumn ? (
        <td role="cell" data-label="Taux d’échec" className={CELL}>
          <Failure cell={row.failure} />
        </td>
      ) : null}
      <td role="cell" data-label="WIP" className={CELL}>
        <span className="font-medium text-ink">{formatCount(row.wip)}</span>
      </td>
    </tr>
  );
}

function Label({ row }: { row: SliceRow }) {
  const content = (
    <span className="inline-flex min-w-0 items-center gap-2">
      {row.series ? <Swatch color={row.series.color} round /> : null}
      <span className="min-w-0 wrap-anywhere">{row.label}</span>
    </span>
  );
  return row.href ? (
    <Link to={row.href} className="text-accent hover:underline">
      {content}
    </Link>
  ) : (
    content
  );
}

/** La médiane, et le P85 en retrait ; un tiret sans Livraison. */
function Duration({ stats }: { stats: MetricsDurationStats }) {
  if (stats.n === 0 || stats.median === null) return <span className="text-ink-3">—</span>;
  return (
    <span className="flex flex-col @min-[44rem]:items-end">
      <span className="font-medium text-ink">{formatDuration(stats.median)}</span>{' '}
      <span className="text-micro font-normal text-ink-3">P85 {formatDuration(stats.p85)}</span>
    </span>
  );
}

function Failure({ cell }: { cell: FailureCell }) {
  switch (cell.kind) {
    case 'rate':
      return (
        <span className="flex flex-col @min-[44rem]:items-end">
          <span className="font-medium text-ink">{formatPercent(cell.rate, { precise: true })}</span>{' '}
          <span className="text-micro font-normal text-ink-3">
            {cell.failed} sur {cell.deliveries}
          </span>
        </span>
      );
    case 'empty':
      return <span className="text-ink-3">—</span>;
    case 'insignificant':
      return (
        <span className="text-ink-3" title={cell.reason}>
          n. s.
          <span className="sr-only"> : non significatif ({cell.reason})</span>
        </span>
      );
  }
}
