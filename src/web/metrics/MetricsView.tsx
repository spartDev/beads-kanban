import { FolderSearch } from 'lucide-react';
import { useCallback, useId, useMemo } from 'react';
import { useSearchParams } from 'react-router';
import { isKnownTimeZone } from '../../domain/time-zone';
import type { MetricsResponse } from '../../shared/api';
import { useProjects } from '../data/hooks';
import { browserTimeZone } from '../lib/instant';
import { useDelayed } from '../lib/useDelayed';
import { useRetryFocus } from '../lib/useRetryFocus';
import { keepFocusInZone } from '../lib/zoneFocus';
import { paths } from '../paths';
import { ErrorNotice, Notice } from '../ui/states';
import { useMetrics, useZoneAnswer } from './api';
import { ActivityPanel } from './ActivityMap';
import { AgePanel } from './AgeChart';
import { BalancePanel } from './BalanceChart';
import { BreakdownPanel } from './BreakdownChart';
import { CfdPanel } from './CfdChart';
import { SectionHeading } from './ChartParts';
import { describeComparison } from './comparison';
import { CycleTimePanel } from './CycleTimeChart';
import { dayInZone } from './format';
import { HealthTiles } from './HealthTiles';
import { MetricsSkeleton } from './MetricsSkeleton';
import { AddressNotices, UnreadableProjects, ZoneNotice } from './Notices';
import { parseMetricsParams, withDimension, withPeriod, type Dimension, type PeriodChoice, type Scope } from './params';
import { ReadyAgePanel } from './ReadyAgeChart';
import { SliceTable } from './SliceTable';
import { describeSlices } from './slices';
import { ThroughputPanel } from './ThroughputChart';
import { MetricTiles } from './Tiles';
import { MetricsToolbar } from './Toolbar';
import { TypeMixPanel } from './TypeMixChart';
import { useKeptPlace } from './useKeptPlace';
import { useSeriesContext } from './useSeriesContext';
import './metrics.css';

/** Ce que la page mesure : un Projet, ou tous (Vue globale). */
export type MetricsScope = { kind: 'global' } | { kind: 'project'; project: { id: string; name: string } };

/** Aujourd'hui (AAAA-MM-JJ) dans ce fuseau. */
const todayIn = (timeZone: string): string => dayInZone(new Date().toISOString(), timeZone);

/**
 * Au bout de combien de temps les chiffres gardés d'une période en attente de la suivante le disent à l'écran (la barre de progression et le texte de la barre d'outils) : une réponse plus
 * rapide ne fait rien clignoter. Un lecteur d'écran n'attend pas : `aria-busy` et la zone d'annonce parlent aussitôt.
 */
const SHOW_BUSY_AFTER_MS = 300;

/** Les chiffres qui arrivent après une attente sont exclus de l'ancrage du défilement jusqu'à leur première mesure (`useKeptPlace`). */
const NO_SCROLL_ANCHORING = { overflowAnchor: 'none' } as const;

/**
 * Les métriques de flux d'un Projet ou de la Vue globale : réglages (période, découpage), tuiles, graphiques, santé du flux
 * (cinq tuiles, puis cinq cartes d'analyse : bdesk-38k.13) et tableau du découpage. La période et le découpage vivent dans
 * l'adresse (`?range=`, `?from=&to=`, `?by=`) : un lien les partage.
 * Chaque changement remplace l'entrée de l'historique, comme au kanban : « Retour » quitte la page.
 *
 * Un rafraîchissement qui échoue garde les chiffres à l'écran (TanStack Query conserve `data`) : le bandeau du shell le
 * signale, et l'erreur n'a la parole que faute de chiffres. Les chiffres provisoires d'une période en attente de la
 * suivante ne sont pas atténués : à 60 % d'opacité, texte et graphiques sortaient de WCAG AA (4,5:1 et 3:1 ; axe, bdesk-38k.80). Ils sont marqués `aria-busy`, et ceux qui voient l'écran
 * ont une barre de progression d'accent juste avant eux, que le défilement épingle sous la barre du haut, et « Calcul en cours » dans la barre d'outils, passé un court délai
 * (`SHOW_BUSY_AFTER_MS`) ; ceux d'un autre Projet ou d'un autre fuseau ne sont pas gardés (`useMetrics`), et le squelette qui remplace ces derniers garde leur hauteur (`useKeptPlace`, bdesk-38k.81).
 */
export function MetricsView({ scope }: { scope: MetricsScope }) {
  const kind: Scope = scope.kind;
  const [searchParams, setSearchParams] = useSearchParams();
  // Le fuseau du navigateur, celui de l'utilisateur, est la seule source des jours de la page : « aujourd'hui », que les plages ne peuvent pas
  // dépasser, et les jours que le serveur compte pour elle (`timeZone` de la requête, bdesk-38k.48). Un autre fuseau côté serveur ferait refuser
  // une plage valable, ou arrêter « 7 derniers jours » à la veille, entre minuit et l'heure de l'écart.
  const asked = browserTimeZone();
  // Sauf si le serveur ne le connaît pas (un fuseau plus récent que son ICU) : il compte alors dans le sien, le nomme dans sa réponse et dit qu'il n'a pas honoré le fuseau demandé
  // (`timeZoneHonoured`, bdesk-38k.71). « Aujourd'hui » se compte dans ce fuseau-là, celui des jours que la page reçoit, pour que les plages qu'elle accepte soient celles que le
  // serveur sert ; la page continue pourtant de demander le fuseau du navigateur, qu'un serveur à jour comptera. Avant la première réponse, rien ne dit que le serveur ne le
  // connaît pas : on compte dans le fuseau demandé. Honoré, c'est le même fuseau, quel que soit le nom que la réponse lui donne : la page ne compare pas de noms.
  //
  // C'est la dernière réponse du serveur à ce fuseau qui le dit, celle du cache des requêtes, et non celle des chiffres affichés : pendant qu'une période se calcule, ces
  // chiffres sont ceux de la précédente (`isPlaceholderData`), comptés dans le même fuseau du serveur ; et le cache survit à la vue, d'une page de métriques à l'autre. La page
  // retient cette réponse même quand le cache la retire (cinq minutes sans vue qui l'observe) : si sa propre requête échoue plus longtemps, l'avis ne s'en va pas (bdesk-38k.79).
  // Quand le fuseau du navigateur change, ni la réponse du précédent ni ses chiffres ne valent pour le nouveau : `useMetrics` ne les garde pas en attendant, le squelette tient leur place.
  const lastAnswer = useZoneAnswer(asked);
  const elsewhere = lastAnswer !== undefined && !lastAnswer.honoured ? lastAnswer : undefined;
  const counted = elsewhere !== undefined && isKnownTimeZone(elsewhere.counted) ? elsewhere.counted : asked;
  const today = todayIn(counted);
  const { period, by, notices } = useMemo(() => parseMetricsParams(searchParams, kind, today), [searchParams, kind, today]);

  const query = useMetrics({ project: scope.kind === 'project' ? scope.project.id : undefined, period, timeZone: asked });
  // Les chiffres gardés (`isPlaceholderData`) sont ceux de la période précédente : tant qu'ils le sont, et que l'attente se remarque, l'écran le dit.
  const waiting = useDelayed(query.isPlaceholderData, SHOW_BUSY_AFTER_MS);
  const retry = useRetryFocus(query);
  const projects = useProjects();
  const data = query.data;
  // Quand le fuseau du navigateur change, le squelette remplace les chiffres de l'ancien (`useMetrics`) : il garde leur hauteur le temps de la réponse (bdesk-38k.81), pour que la page ne rétrécisse pas
  // et que le défilement de qui lisait plus bas ne soit pas perdu ; et les chiffres qui arrivent ne laissent pas l'ancrage du défilement suivre leur première mise en page. La hauteur est mesurée sur
  // l'enveloppe des chiffres, par Projet ou Vue globale : celle d'un autre Projet ne vaut pas pour celui-ci.
  const place = useKeptPlace<HTMLDivElement>(!data && !query.isError, scope.kind === 'project' ? scope.project.id : '*');
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
        provisional={waiting}
        fetching={query.isFetching}
        onPeriodChange={changePeriod}
        onDimensionChange={changeDimension}
        onRefresh={() => void query.refetch()}
      />

      {/* Un recalcul qui garde les chiffres à l'écran n'a pas d'autre signal pour un lecteur d'écran. */}
      <p aria-live="polite" className="sr-only">
        {query.isFetching && data ? 'Calcul des métriques en cours…' : ''}
      </p>

      {/* L'avis suit la dernière réponse du serveur, pas les chiffres affichés : pendant que la période suivante se calcule, les chiffres gardés sont encore ceux de la
          précédente, comptés dans le même fuseau du serveur (jamais ceux d'un autre fuseau demandé : bdesk-38k.79). Retiré puis remis avec la réponse, il faisait sauter la page (bdesk-38k.71). */}
      {elsewhere !== undefined ? <ZoneNotice asked={asked} counted={elsewhere.counted} /> : null}

      {notices.length > 0 ? <AddressNotices notices={notices} /> : null}

      {data ? (
        // Les chiffres partent, et le squelette les remplace, quand le fuseau du navigateur change (`useMetrics` ne garde pas ceux de l'ancien) ; le focus qu'ils tenaient (une puce de tendance,
        // un lien, un résumé) revient alors au contenu principal, au lieu de tomber sur le corps de la page (`keepFocusInZone`, comme pour l'avis d'erreur que le squelette remplace). Le
        // changement de fuseau n'est vu qu'à un rendu que rien dans les chiffres n'a demandé (un autre réglage de l'adresse, la liste des Projets relue au retour sur l'onglet).
        // Gardés pour une autre période, ils ne sont ni atténués ni voilés (bdesk-38k.80) : `aria-busy`, et une barre de progression d'accent juste avant eux (`.metrics-busy`, metrics.css), que le
        // défilement épingle sous la barre du haut : on la voit où que l'on lise. Elle est posée à côté des chiffres, dans le même parent, et non dedans : leur conteneur a un écart (`gap-6`) qu'un
        // enfant de plus, même de hauteur nulle, augmenterait de 24 px.
        <div ref={place.ref} style={place.settling ? NO_SCROLL_ANCHORING : undefined} className="min-w-0">
          {waiting ? <div aria-hidden="true" className="metrics-busy" /> : null}
          <div ref={keepFocusInZone} aria-busy={query.isPlaceholderData} className="flex min-w-0 flex-col gap-6">
            <Content data={data} by={by} ctx={ctx} projectHref={projectHref} />
          </div>
        </div>
      ) : query.isError ? (
        <ErrorNotice error={query.error} title="Impossible de calculer les métriques" onRetry={retry} />
      ) : (
        <MetricsSkeleton minHeight={place.height} />
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
  const flowId = useId();
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

          <HealthTiles tiles={data.tiles} health={data.health} comparison={comparison} />

          <section aria-labelledby={flowId} className="flex min-w-0 flex-col gap-3">
            <SectionHeading id={flowId}>Analyse du flux</SectionHeading>
            <div className="grid min-w-0 gap-3 @min-[56rem]:grid-cols-2">
              <div className="min-w-0">
                <BalancePanel buckets={data.buckets} unit={data.bucket} running={comparison.running} asOfTime={comparison.asOfTime} />
              </div>
              <div className="min-w-0">
                <BreakdownPanel breakdown={data.health.leadTimeBreakdown} />
              </div>
              <div className="min-w-0">
                <TypeMixPanel slices={data.slices.type} />
              </div>
              <div className="min-w-0">
                <ActivityPanel activity={data.health.activity} timeZone={data.timeZone} />
              </div>
              <div className="min-w-0 @min-[56rem]:col-span-2">
                <ReadyAgePanel
                  ages={data.health.readyAges}
                  dimension={by}
                  ctx={ctx}
                  projectOrder={projectOrder}
                  showProject={showProject}
                  timeZone={data.timeZone}
                  moment={comparison.running ? `à ${comparison.asOfTime}` : 'à la fin de la période'}
                />
              </div>
            </div>
          </section>

          <SliceTable view={view} dimension={by} />
        </>
      )}
    </>
  );
}
