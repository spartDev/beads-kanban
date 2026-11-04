import { useMemo } from 'react';
import type { MetricsSlice } from '../../shared/api';
import { TypeGlyph } from '../ui/IssueBadges';
import { ChartCard, DataTable } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { formatCount, formatPercent } from './format';
import { describeTypeMix, type MixRow, type MixSegment, type TypeMixView } from './mix';
import { outlineOf } from './palette';

/** Le type au pluriel quand le compte l'exige (« 7 Bugs », « 1 Fonctionnalité »). */
const counted = (segment: MixSegment) => `${formatCount(segment.count)} ${segment.count > 1 ? `${segment.label}s` : segment.label}`;

/** « Livraisons : 10 Bugs (71 %), 3 Tâches (21 %) » : ce que dit une barre, pour les lecteurs d'écran. */
const spoken = (row: MixRow) =>
  row.total === 0
    ? `${row.label} : aucun ticket`
    : `${row.label} : ${row.segments
        .filter((segment) => segment.count > 0)
        .map((segment) => `${counted(segment)} (${formatPercent(segment.share)})`)
        .join(', ')}`;

/**
 * La carte « Répartition par type » : trois barres à 100 %, les Arrivées, les Livraisons et les tickets en cours, découpées
 * par type dans les couleurs fixes des tickets. La largeur d'un segment est sa part de la barre ; le total de la barre est
 * écrit à côté, et les comptes exacts sont dans le tableau des données.
 */
export function TypeMixPanel({ slices }: { slices: readonly MetricsSlice[] }) {
  const view = useMemo(() => describeTypeMix(slices), [slices]);

  return (
    <ChartCard
      className="h-full"
      title="Répartition par type"
      description="Part de chaque type de ticket parmi les Arrivées, les Livraisons et les tickets en cours."
      legend={
        view.empty ? undefined : (
          <ul aria-label="Légende des types" className="flex flex-wrap gap-x-4 gap-y-1 text-micro text-ink-2">
            {view.types.map((type) => (
              <li key={type.type} className="inline-flex items-center gap-1.5">
                <TypeGlyph type={type.type} size={12} />
                {type.label}
              </li>
            ))}
          </ul>
        )
      }
      data={<TypeMixTable view={view} />}
    >
      {view.empty ? (
        <EmptyChart>Aucune Arrivée, Livraison ni ticket en cours sur cette période.</EmptyChart>
      ) : (
        <ul className="flex min-w-0 flex-col gap-3">
          {view.rows.map((row) => (
            <li key={row.key} data-row={row.key} className="flex min-w-0 flex-col gap-1">
              <div className="flex items-baseline justify-between gap-2 text-ui">
                <span className="font-medium text-ink">{row.label}</span>
                <span data-total="" className="tnum text-ink-2">
                  {formatCount(row.total)}
                </span>
              </div>
              <div role="img" aria-label={spoken(row)} className={row.total === 0 ? 'h-6 rounded-md border border-dashed border-line-strong' : 'flex h-6 w-full overflow-hidden rounded-md'}>
                {row.segments
                  .filter((segment) => segment.count > 0)
                  .map((segment) => (
                    <div
                      key={segment.type}
                      data-type={segment.type}
                      className="h-full min-w-px"
                      style={{ width: `${(segment.share * 100).toFixed(6)}%`, background: segment.color, boxShadow: `inset 0 0 0 1.25px ${outlineOf(segment.color)}` }}
                    />
                  ))}
              </div>
            </li>
          ))}
        </ul>
      )}
    </ChartCard>
  );
}

const share = (segment: MixSegment) => `${formatCount(segment.count)} (${formatPercent(segment.share)})`;

function TypeMixTable({ view }: { view: TypeMixView }) {
  return (
    <DataTable
      caption="Tickets par type : Arrivées, Livraisons et en cours"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Type
          </th>
          {view.rows.map((row) => (
            <th key={row.key} scope="col" className="px-3 py-1.5 text-right font-medium">
              {row.label}
            </th>
          ))}
        </tr>
      }
    >
      {view.types.map((type, index) => (
        <tr key={type.type}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {type.label}
          </th>
          {view.rows.map((row) => (
            <td key={row.key} className="whitespace-nowrap px-3 py-1 text-right">
              {row.segments[index] ? share(row.segments[index]) : '0'}
            </td>
          ))}
        </tr>
      ))}
      <tr className="bg-well font-medium">
        <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-medium text-ink">
          Total
        </th>
        {view.rows.map((row) => (
          <td key={row.key} className="whitespace-nowrap px-3 py-1 text-right">
            {formatCount(row.total)}
          </td>
        ))}
      </tr>
    </DataTable>
  );
}
