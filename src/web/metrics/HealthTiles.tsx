import { useId, type ReactNode } from 'react';
import type { MetricsHealth, MetricsTiles } from '../../shared/api';
import { useFormat, useLanguage, useT } from '../i18n';
import { balanceOf } from './balance';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { HEALTH_GRID, HEALTH_SPANS } from './healthGrid';
import { DurationText, SpokenText } from './SpokenText';
import { Tile, Trend, Value } from './Tiles';
import { formatEfficiency, MEASURES, spokenEfficiency } from './trend';

/**
 * Les cinq tuiles de la santé du flux, sous celles des indicateurs : Arrivées vs Débit, Efficacité du flux, Taux de
 * Réouverture, Taux d'abandon, Prêts qui stagnent. Comme celles des indicateurs, chacune donne sa valeur, la taille de son
 * échantillon et sa tendance par rapport à la période précédente (à durée écoulée égale), et dit quand elle n'a rien à mesurer.
 */
export function HealthTiles({ tiles, health, comparison }: { tiles: Pick<MetricsTiles, 'arrivals' | 'throughput'>; health: MetricsHealth; comparison: Comparison }) {
  const titleId = useId();
  const t = useT();
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <SectionHeading id={titleId}>{t.metrics.healthTiles.heading}</SectionHeading>
      <div className={HEALTH_GRID}>
        <BalanceTile tiles={tiles} comparison={comparison} className={HEALTH_SPANS[0]} />
        <EfficiencyTile efficiency={health.efficiency} comparison={comparison} className={HEALTH_SPANS[1]} />
        <ReopeningTile reopening={health.reopening} comparison={comparison} className={HEALTH_SPANS[2]} />
        <AbandonmentTile abandonment={health.abandonment} comparison={comparison} className={HEALTH_SPANS[3]} />
        <ReadyTile ready={health.readyAges} comparison={comparison} className={HEALTH_SPANS[4]} />
      </div>
    </section>
  );
}

/** Une ligne de détail sous la valeur, séparée d'un filet comme le P85 des durées. */
function Detail({ children }: { children: ReactNode }) {
  return <div className="flex flex-col gap-1 border-t border-line pt-2 text-micro text-ink-3">{children}</div>;
}

function BalanceTile({ tiles, comparison, className }: { tiles: Pick<MetricsTiles, 'arrivals' | 'throughput'>; comparison: Comparison; className: string }) {
  const balance = balanceOf(tiles);
  const t = useT();
  const { formatCount, formatSigned } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.healthTiles;
  return (
    <Tile title={texts.balance} help={t.metrics.metricHelp.balance} className={className}>
      <Value caption={texts.balanceCaption}>{formatSigned(balance.net)}</Value>
      <Detail>
        <p className="tnum">
          {texts.arrivals(balance.arrivals, formatCount(balance.arrivals))} · {t.metrics.tiles.deliveries(balance.throughput, formatCount(balance.throughput))}
        </p>
      </Detail>
      <Trend trend={balance.trend} measure={MEASURES[language].balance} comparison={comparison} />
    </Tile>
  );
}

/**
 * La part du Cycle Time hors Blocage. Elle vaut souvent presque 100 % : les tickets sont démarrés une fois débloqués, et leur
 * attente tombe avant le démarrage, dans l'Attente de dépendance. La tuile le dit, et renvoie à la décomposition du Lead Time.
 * Elle n'écrit « 100 % » que sans le moindre Blocage (`formatEfficiency`), et se dit « plus de 99,9 % » là où elle s'écrit
 * « > 99,9 % » (`SpokenText`), comme « < 1 min » se dit « moins d'une minute » dans la ligne du Blocage.
 */
function EfficiencyTile({ efficiency, comparison, className }: { efficiency: MetricsHealth['efficiency']; comparison: Comparison; className: string }) {
  const defined = efficiency.ratio !== null;
  const t = useT();
  const { formatCount } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.healthTiles;
  const deliveries = (n: number) => t.metrics.tiles.deliveries(n, formatCount(n));
  return (
    <Tile title={texts.efficiency} help={t.metrics.metricHelp.efficiency} sample={deliveries(efficiency.n)} className={className}>
      <Value muted={!defined} caption={defined ? texts.efficiencyCaption : t.metrics.tiles.noStartedDeliveries}>
        <SpokenText written={formatEfficiency(efficiency.ratio, language)} spoken={spokenEfficiency(efficiency.ratio, language)} />
      </Value>
      {defined ? (
        <>
          <Trend trend={efficiency.trend} measure={MEASURES[language].efficiency} comparison={comparison} />
          <Detail>
            {efficiency.blockedTime > 0 ? (
              <>
                <p className="tnum">
                  {texts.blockedLead}
                  <DurationText ms={efficiency.blockedTime} />
                  {texts.blockedOf}
                  <DurationText ms={efficiency.cycleTime} />
                  {texts.blockedTail}
                </p>
                <p className="tnum">{texts.deliveriesWithBlockage(deliveries(efficiency.blockedDeliveries))}</p>
              </>
            ) : (
              <p>{texts.noBlockage}</p>
            )}
            <p>{texts.efficiencyNote}</p>
          </Detail>
        </>
      ) : null}
    </Tile>
  );
}

function ReopeningTile({ reopening, comparison, className }: { reopening: MetricsHealth['reopening']; comparison: Comparison; className: string }) {
  const defined = reopening.rate !== null;
  const t = useT();
  const { formatCount, formatPercent } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.healthTiles;
  const closures = texts.closures(reopening.closures, formatCount(reopening.closures));
  return (
    <Tile title={texts.reopening} help={t.metrics.metricHelp.reopening} sample={closures} className={className}>
      <Value muted={!defined} caption={defined ? texts.reopenedOf(formatCount(reopening.reopened), reopening.closures, closures) : texts.noClosures}>
        {formatPercent(reopening.rate, { precise: true })}
      </Value>
      {defined ? <Trend trend={reopening.trend} measure={MEASURES[language].rate} comparison={comparison} /> : null}
    </Tile>
  );
}

/** « 1 doublon, 1 remplacé » : les causes des Abandons, sans celles qui sont à zéro. */
function Causes({ duplicates, superseded }: { duplicates: number; superseded: number }) {
  const t = useT();
  const { formatCount } = useFormat();
  const texts = t.metrics.healthTiles;
  return (
    <p>
      {[duplicates > 0 ? texts.duplicates(duplicates, formatCount(duplicates)) : '', superseded > 0 ? texts.superseded(superseded, formatCount(superseded)) : '']
        .filter(Boolean)
        .join(texts.causesSeparator)}
    </p>
  );
}

/**
 * La part des Abandons parmi les tickets fermés. Sa tendance n'est ni bonne ni mauvaise (fermer des doublons relève de la bonne
 * hygiène). Et sa mesure a une limite que la tuile dit : seuls les liens `duplicates` et `supersedes` font un Abandon.
 */
function AbandonmentTile({ abandonment, comparison, className }: { abandonment: MetricsHealth['abandonment']; comparison: Comparison; className: string }) {
  const defined = abandonment.rate !== null;
  const t = useT();
  const { formatCount, formatPercent } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.healthTiles;
  const closed = texts.closedTickets(abandonment.closed, formatCount(abandonment.closed));
  return (
    <Tile title={texts.abandonment} help={t.metrics.metricHelp.abandonment} sample={closed} className={className}>
      <Value muted={!defined} caption={defined ? texts.droppedOf(formatCount(abandonment.abandoned), closed) : texts.noClosedTickets}>
        {formatPercent(abandonment.rate, { precise: true })}
      </Value>
      {defined ? <Trend trend={abandonment.trend} measure={MEASURES[language].abandonment} comparison={comparison} /> : null}
      {defined ? (
        <Detail>
          {abandonment.abandoned > 0 ? <Causes duplicates={abandonment.duplicates} superseded={abandonment.superseded} /> : null}
          <p>{texts.abandonmentNote}</p>
        </Detail>
      ) : null}
    </Tile>
  );
}

function ReadyTile({ ready, comparison, className }: { ready: MetricsHealth['readyAges']; comparison: Comparison; className: string }) {
  const any = ready.tickets.length > 0;
  const t = useT();
  const { formatCount, formatDuration } = useFormat();
  const { language } = useLanguage();
  const texts = t.metrics.healthTiles;
  const tickets = texts.readyTickets(ready.tickets.length, formatCount(ready.tickets.length));
  return (
    <Tile title={texts.ready} help={t.metrics.metricHelp.ready} sample={tickets} className={className}>
      <Value muted={!any} caption={any ? texts.staleOf(tickets, formatDuration(ready.stagnantAfter)) : texts.noReady}>
        {formatCount(ready.stagnant)}
      </Value>
      {any ? <Trend trend={ready.trend} measure={MEASURES[language].fewer} comparison={comparison} /> : null}
    </Tile>
  );
}
