import { FolderSearch } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import type { MetricsResponse } from '../../shared/api';
import { useProjects } from '../data/hooks';
import { cx } from '../lib/cx';
import { paths } from '../paths';
import { ErrorNotice, Notice } from '../ui/states';
import { useMetrics } from './api';
import { AgePanel } from './AgeChart';
import { CfdPanel } from './CfdChart';
import { SectionHeading } from './ChartParts';
import { describeComparison } from './comparison';
import { CycleTimePanel } from './CycleTimeChart';
import { dayInZone } from './format';
import { MetricsSkeleton } from './MetricsSkeleton';
import { AddressNotices, UnreadableProjects } from './Notices';
import { parseMetricsParams, withDimension, withPeriod, type Dimension, type PeriodChoice, type Scope } from './params';
import { SliceTable } from './SliceTable';
import { describeSlices } from './slices';
import { ThroughputPanel } from './ThroughputChart';
import { MetricTiles } from './Tiles';
import { MetricsToolbar } from './Toolbar';
import { useSeriesContext } from './useSeriesContext';
import './metrics.css';

/** Ce que la page mesure : un Projet, ou tous (Vue globale). */
export type MetricsScope = { kind: 'global' } | { kind: 'project'; project: { id: string; name: string } };

/** Aujourd'hui (AAAA-MM-JJ) dans le fuseau du navigateur, qui est celui de l'utilisateur et du serveur. */
const todayHere = (): string => dayInZone(new Date().toISOString(), Intl.DateTimeFormat().resolvedOptions().timeZone);

/**
 * Les métriques de flux d'un Projet ou de la Vue globale : réglages (période, découpage), tuiles, graphiques et tableau du
 * découpage. La période et le découpage vivent dans l'adresse (`?range=`, `?from=&to=`, `?by=`) : un lien les partage.
 * Chaque changement remplace l'entrée de l'historique, comme au kanban : « Retour » quitte la page.
 *
 * Un rafraîchissement qui échoue garde les chiffres à l'écran (TanStack Query conserve `data`) : le bandeau du shell le
 * signale, et l'erreur n'a la parole que faute de chiffres. Les chiffres provisoires d'une période en attente de la
 * suivante sont atténués.
 */
export function MetricsView({ scope }: { scope: MetricsScope }) {
  const kind: Scope = scope.kind;
  const [searchParams, setSearchParams] = useSearchParams();
  const today = todayHere();
  const { period, by, notices } = useMemo(() => parseMetricsParams(searchParams, kind, today), [searchParams, kind, today]);

  const query = useMetrics({ project: scope.kind === 'project' ? scope.project.id : undefined, period });
  const projects = useProjects();
  const data = query.data;
  const ctx = useSeriesContext(data?.projects ?? [], projects.data?.projects);

  const changePeriod = useCallback((next: PeriodChoice) => setSearchParams((current) => withPeriod(current, next), { replace: true }), [setSearchParams]);
  const changeDimension = useCallback((next: Dimension) => setSearchParams((current) => withDimension(current, next, kind), { replace: true }), [setSearchParams, kind]);

  const projectHref = useCallback(
    (id: string) => {
      const search = withPeriod(new URLSearchParams(), period).toString();
      return `${paths.metrics(id)}${search ? `?${search}` : ''}`;
    },
    [period],
  );

  return (
    <div className="@container flex min-w-0 flex-col gap-6">
      <MetricsToolbar
        scope={kind}
        period={period}
        by={by}
        today={today}
        displayed={data ? { from: data.period.from, to: data.period.to } : undefined}
        computed={data ? { at: data.generatedAt, timeZone: data.timeZone } : undefined}
        fetching={query.isFetching}
        onPeriodChange={changePeriod}
        onDimensionChange={changeDimension}
        onRefresh={() => void query.refetch()}
      />

      {/* Un recalcul qui garde les chiffres à l'écran n'a pas d'autre signal pour un lecteur d'écran. */}
      <p aria-live="polite" className="sr-only">
        {query.isFetching && data ? 'Calcul des métriques en cours…' : ''}
      </p>

      {notices.length > 0 ? <AddressNotices notices={notices} /> : null}

      {data ? (
        <div aria-busy={query.isPlaceholderData} className={cx('flex min-w-0 flex-col gap-6 transition-opacity', query.isPlaceholderData && 'opacity-60')}>
          <Content data={data} by={by} ctx={ctx} projectHref={projectHref} />
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} title="Impossible de calculer les métriques" onRetry={() => void query.refetch()} />
      ) : (
        <MetricsSkeleton />
      )}
    </div>
  );
}

function Content({ data, by, ctx, projectHref }: { data: MetricsResponse; by: Dimension; ctx: ReturnType<typeof useSeriesContext>; projectHref: (id: string) => string }) {
  const comparison = useMemo(() => describeComparison(data), [data]);
  const view = useMemo(
    () => describeSlices({ slices: data.slices[by], dimension: by, tiles: data.tiles, ctx, projectHref }),
    [data, by, ctx, projectHref],
  );
  const projectOrder = useMemo(() => data.projects.map((project) => project.id), [data.projects]);
  const span = useMemo(
    () => ({ from: data.period.from, days: data.period.days, start: Date.parse(data.period.start), end: Date.parse(data.asOf) }),
    [data.period, data.asOf],
  );
  const chartsId = useId();
  const showProject = data.projects.length > 1;
  const { median, p85 } = data.tiles.cycleTime;

  return (
    <>
      {data.unreadable.length > 0 ? <UnreadableProjects projects={data.unreadable} /> : null}

      {data.projects.length === 0 ? (
        <Notice icon={FolderSearch} title="Aucun Projet n’a pu être mesuré">
          Les métriques se calculent depuis l’historique Dolt d’un Projet lisible. Réessayez quand sa base sera de nouveau accessible.
        </Notice>
      ) : (
        <>
          <MetricTiles tiles={data.tiles} comparison={comparison} />

          <section aria-labelledby={chartsId} className="flex min-w-0 flex-col gap-3">
            <SectionHeading id={chartsId}>Graphiques</SectionHeading>
            <div className="grid min-w-0 gap-3 @min-[56rem]:grid-cols-2">
              <div className="min-w-0 @min-[56rem]:col-span-2">
                <CfdPanel points={data.cfd} />
              </div>
              <div className="min-w-0">
                <ThroughputPanel buckets={data.buckets} unit={data.bucket} running={comparison.running} asOfTime={comparison.asOfTime} />
              </div>
              <div className="min-w-0">
                <CycleTimePanel
                  points={data.cycleTimeScatter}
                  span={span}
                  dimension={by}
                  ctx={ctx}
                  projectOrder={projectOrder}
                  timeZone={data.timeZone}
                  median={median}
                  p85={p85}
                  showProject={showProject}
                />
              </div>
              <div className="min-w-0 @min-[56rem]:col-span-2">
                <AgePanel tickets={data.inProgress} dimension={by} ctx={ctx} projectOrder={projectOrder} median={median} p85={p85} showProject={showProject} />
              </div>
            </div>
          </section>

          <SliceTable view={view} dimension={by} />
        </>
      )}
    </>
  );
}
