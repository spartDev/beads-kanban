import { useId, type ReactNode } from 'react';
import type { MetricsHealth, MetricsTiles } from '../../shared/api';
import { balanceOf } from './balance';
import { SectionHeading } from './ChartParts';
import type { Comparison } from './comparison';
import { formatCount, formatDuration, formatPercent, formatSigned } from './format';
import { HEALTH_GRID, HEALTH_SPANS } from './healthGrid';
import { METRIC_HELP } from './metricHelp';
import { DurationText, SpokenText } from './SpokenText';
import { formatEfficiency, MEASURES, spokenEfficiency } from './trend';
import { plural, Tile, Trend, Value } from './Tiles';

/**
 * Les cinq tuiles de la santé du flux, sous celles des indicateurs : Arrivées vs Débit, Efficacité du flux, Taux de
 * Réouverture, Taux d'abandon, Prêts qui stagnent. Comme celles des indicateurs, chacune donne sa valeur, la taille de son
 * échantillon et sa tendance par rapport à la période précédente (à durée écoulée égale), et dit quand elle n'a rien à mesurer.
 */
export function HealthTiles({ tiles, health, comparison }: { tiles: Pick<MetricsTiles, 'arrivals' | 'throughput'>; health: MetricsHealth; comparison: Comparison }) {
  const titleId = useId();
  return (
    <section aria-labelledby={titleId} className="flex min-w-0 flex-col gap-3">
      <SectionHeading id={titleId}>Santé du flux</SectionHeading>
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
  return (
    <Tile title="Arrivées vs Débit" help={METRIC_HELP.balance} className={className}>
      <Value caption="Arrivées moins Débit">{formatSigned(balance.net)}</Value>
      <Detail>
        <p className="tnum">
          {plural(balance.arrivals, 'Arrivée')} · {plural(balance.throughput, 'Livraison')}
        </p>
      </Detail>
      <Trend trend={balance.trend} measure={MEASURES.balance} comparison={comparison} />
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
  return (
    <Tile title="Efficacité du flux" help={METRIC_HELP.efficiency} sample={plural(efficiency.n, 'Livraison')} className={className}>
      <Value muted={!defined} caption={defined ? 'du Cycle Time hors Blocage' : 'Aucune Livraison démarrée sur la période.'}>
        <SpokenText written={formatEfficiency(efficiency.ratio)} spoken={spokenEfficiency(efficiency.ratio)} />
      </Value>
      {defined ? (
        <>
          <Trend trend={efficiency.trend} measure={MEASURES.efficiency} comparison={comparison} />
          <Detail>
            {efficiency.blockedTime > 0 ? (
              <>
                <p className="tnum">
                  Blocage : <DurationText ms={efficiency.blockedTime} /> sur <DurationText ms={efficiency.cycleTime} /> de Cycle Time
                </p>
                <p className="tnum">{plural(efficiency.blockedDeliveries, 'Livraison')} avec du Blocage</p>
              </>
            ) : (
              <p>Aucun Blocage pendant le travail.</p>
            )}
            <p>
              Souvent proche de 100&nbsp;% : un ticket est démarré une fois débloqué. L’attente d’une dépendance se lit dans la Décomposition du Lead Time (Attente de dépendance).
            </p>
          </Detail>
        </>
      ) : null}
    </Tile>
  );
}

function ReopeningTile({ reopening, comparison, className }: { reopening: MetricsHealth['reopening']; comparison: Comparison; className: string }) {
  const defined = reopening.rate !== null;
  const followed = reopening.closures > 1 ? 'suivies' : 'suivie'; // l'accord se fait avec les clôtures : « 0 sur 1 clôture suivie »
  return (
    <Tile title="Taux de Réouverture" help={METRIC_HELP.reopening} sample={plural(reopening.closures, 'clôture')} className={className}>
      <Value
        muted={!defined}
        caption={defined ? `${formatCount(reopening.reopened)} sur ${plural(reopening.closures, 'clôture')} ${followed} d’une Réouverture` : 'Aucune clôture sur la période.'}
      >
        {formatPercent(reopening.rate, { precise: true })}
      </Value>
      {defined ? <Trend trend={reopening.trend} measure={MEASURES.rate} comparison={comparison} /> : null}
    </Tile>
  );
}

/** « 1 doublon, 1 remplacé » : les causes des Abandons, sans celles qui sont à zéro. */
function causes({ duplicates, superseded }: { duplicates: number; superseded: number }): string {
  return [duplicates > 0 ? plural(duplicates, 'doublon') : '', superseded > 0 ? plural(superseded, 'remplacé') : ''].filter(Boolean).join(', ');
}

/**
 * La part des Abandons parmi les tickets fermés. Sa tendance n'est ni bonne ni mauvaise (fermer des doublons relève de la bonne
 * hygiène). Et sa mesure a une limite que la tuile dit : seuls les liens `duplicates` et `supersedes` font un Abandon.
 */
function AbandonmentTile({ abandonment, comparison, className }: { abandonment: MetricsHealth['abandonment']; comparison: Comparison; className: string }) {
  const defined = abandonment.rate !== null;
  return (
    <Tile title="Taux d’abandon" help={METRIC_HELP.abandonment} sample={plural(abandonment.closed, 'ticket fermé', 'tickets fermés')} className={className}>
      <Value
        muted={!defined}
        caption={defined ? `${formatCount(abandonment.abandoned)} sur ${plural(abandonment.closed, 'ticket fermé', 'tickets fermés')}` : 'Aucun ticket fermé sur la période.'}
      >
        {formatPercent(abandonment.rate, { precise: true })}
      </Value>
      {defined ? <Trend trend={abandonment.trend} measure={MEASURES.abandonment} comparison={comparison} /> : null}
      {defined ? (
        <Detail>
          {abandonment.abandoned > 0 ? <p>{causes(abandonment)}</p> : null}
          <p>Seuls les liens duplicates et supersedes sont reconnus : un ticket fermé «&nbsp;Duplicate: …&nbsp;» sans lien compte comme une Livraison.</p>
        </Detail>
      ) : null}
    </Tile>
  );
}

function ReadyTile({ ready, comparison, className }: { ready: MetricsHealth['readyAges']; comparison: Comparison; className: string }) {
  const any = ready.tickets.length > 0;
  return (
    <Tile title="Prêts qui stagnent" help={METRIC_HELP.ready} sample={plural(ready.tickets.length, 'Prêt')} className={className}>
      <Value muted={!any} caption={any ? `sur ${plural(ready.tickets.length, 'Prêt')}, depuis plus de ${formatDuration(ready.stagnantAfter)}` : 'Aucun ticket Prêt.'}>
        {formatCount(ready.stagnant)}
      </Value>
      {any ? <Trend trend={ready.trend} measure={MEASURES.fewer} comparison={comparison} /> : null}
    </Tile>
  );
}
