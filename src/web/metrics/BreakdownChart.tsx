import { useMemo } from 'react';
import type { MetricsLeadTimeBreakdown } from '../../shared/api';
import { type BreakdownPart, describeBreakdown } from './breakdown';
import { ChartCard, DataTable, Swatch } from './ChartParts';
import { EmptyChart } from './CfdChart';
import { formatDuration, formatPercent, spokenDuration } from './format';
import { outlineOf } from './palette';
import { DurationText, SpokenText } from './SpokenText';
import { plural } from './Tiles';

const percent = (share: number | null) => formatPercent(share, { precise: true });

/** Les hachures d'une part : celles de la pastille de la légende (`Swatch`), pour que la barre et la légende se ressemblent. */
const hatchOf = (color: string) => `repeating-linear-gradient(45deg, ${outlineOf(color)} 0 1.5px, transparent 1.5px 4px)`;

/**
 * La carte « Décomposition du Lead Time » : le Lead Time cumulé des Livraisons de la période, en cinq parts qui s'additionnent
 * (Attente de dépendance, Attente en Prêt, autre attente, travail, Blocage), avec ce que l'Attente de dépendance a coûté aux
 * Livraisons qui l'ont subie. Une barre unique plutôt qu'un graphique à axes : la somme des parts est la mesure, et chaque part
 * se lit dans la légende, en durée et en pourcentage, comme dans le tableau des données. Sans Livraison, ou sans Lead Time à
 * répartir, la carte le dit : pas de durée nulle écrite comme une durée, pas de tableau de zéros. Une durée sous la minute s'écrit
 * « < 1 min » et se dit « moins d'une minute » (`SpokenText`) : un lecteur d'écran lirait le chevron tel quel.
 */
export function BreakdownPanel({ breakdown }: { breakdown: MetricsLeadTimeBreakdown }) {
  const view = useMemo(() => describeBreakdown(breakdown), [breakdown]);
  /** Une phrase écrite avec `formatDuration`, et la même dite avec `spokenDuration` : l'une pour l'écran, l'autre pour les lecteurs d'écran. */
  const said = (sentence: (duration: (ms: number | null) => string) => string) => (
    <SpokenText written={sentence(formatDuration)} spoken={sentence((ms) => (ms === null ? formatDuration(null) : spokenDuration(ms)))} />
  );

  return (
    <ChartCard
      className="h-full"
      title="Décomposition du Lead Time"
      description={
        view.empty
          ? 'Le Lead Time cumulé des Livraisons de la période, réparti en cinq parts qui s’additionnent.'
          : said((duration) => `Le Lead Time cumulé de ${plural(view.deliveries, 'Livraison')} (${duration(view.total)}), réparti en cinq parts qui s’additionnent.`)
      }
      data={view.empty ? undefined : <BreakdownTable parts={view.parts} total={view.total} />}
    >
      {view.empty ? (
        <EmptyChart>
          {view.deliveries === 0 ? 'Aucune Livraison sur la période.' : 'Aucun Lead Time à décomposer : les Livraisons de la période ont toutes un Lead Time nul.'}
        </EmptyChart>
      ) : (
        <div className="flex min-w-0 flex-col gap-3">
          <div
            role="img"
            aria-label={`Décomposition du Lead Time : ${view.parts.map((part) => `${part.label} ${percent(part.share)}`).join(', ')}.`}
            className="flex h-8 w-full overflow-hidden rounded-md"
          >
            {view.parts
              .filter((part) => part.duration > 0)
              .map((part) => (
                <div
                  key={part.key}
                  data-part={part.key}
                  className="h-full min-w-px"
                  style={{
                    width: `${((part.share ?? 0) * 100).toFixed(6)}%`,
                    background: part.hatched ? hatchOf(part.color) : part.color,
                    boxShadow: `inset 0 0 0 1.25px ${outlineOf(part.color)}`,
                  }}
                />
              ))}
          </div>

          <ul aria-label="Parts du Lead Time" className="grid gap-x-6 gap-y-1.5 @min-[36rem]:grid-cols-2">
            {view.parts.map((part) => (
              <PartRow key={part.key} part={part} />
            ))}
          </ul>

          <p className="max-w-[90ch] text-micro leading-4 text-ink-3">
            {view.waited === 0
              ? 'Aucune Livraison n’a attendu une dépendance avant de démarrer.'
              : said(
                  (duration) =>
                    `${plural(view.waited, 'Livraison')} sur ${view.deliveries} ${view.waited > 1 ? 'ont' : 'a'} attendu une dépendance avant de démarrer : médiane ${duration(view.waits.median)}, P85 ${duration(view.waits.p85)}.`,
                )}
          </p>
        </div>
      )}
    </ChartCard>
  );
}

function PartRow({ part }: { part: BreakdownPart }) {
  return (
    <li className="flex min-w-0 flex-col gap-0.5 text-ui">
      <span className="flex min-w-0 items-center gap-2">
        <Swatch color={part.color} hatched={part.hatched} />
        <span className="min-w-0 flex-1 text-ink-2">{part.label}</span>
        <span className="tnum font-semibold text-ink">
          <SpokenText written={part.text} spoken={part.spoken} />
        </span>
        <span className="tnum w-14 shrink-0 text-right text-ink-3">{percent(part.share)}</span>
      </span>
      <span className="pl-[18px] text-micro leading-4 text-ink-3">{part.description}</span>
    </li>
  );
}

function BreakdownTable({ parts, total }: { parts: readonly BreakdownPart[]; total: number }) {
  return (
    <DataTable
      caption="Parts du Lead Time cumulé des Livraisons de la période"
      head={
        <tr>
          <th scope="col" className="px-3 py-1.5 font-medium">
            Part
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Durée cumulée
          </th>
          <th scope="col" className="px-3 py-1.5 text-right font-medium">
            Part du Lead Time
          </th>
        </tr>
      }
    >
      {parts.map((part) => (
        <tr key={part.key}>
          <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-normal text-ink-2">
            {part.label}
          </th>
          <td className="whitespace-nowrap px-3 py-1 text-right">
            <SpokenText written={part.text} spoken={part.spoken} />
          </td>
          <td className="px-3 py-1 text-right font-medium">{percent(part.share)}</td>
        </tr>
      ))}
      <tr className="bg-well font-medium">
        <th scope="row" className="whitespace-nowrap px-3 py-1 text-left font-medium text-ink">
          Lead Time cumulé
        </th>
        <td className="whitespace-nowrap px-3 py-1 text-right">
          <DurationText ms={total} />
        </td>
        <td className="px-3 py-1 text-right">{percent(total > 0 ? 1 : null)}</td>
      </tr>
    </DataTable>
  );
}
