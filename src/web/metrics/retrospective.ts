import type { MetricsTrend, SignalsResponse } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { projectLabel } from '../data/projectNames';
import { SIGNAL_KINDS, signalSentence } from '../lib/signals';
import type { NamedMetricsResponse } from './api';
import { describeComparison } from './comparison';
import { dayInZone, formatCount, formatDay, formatDayRange, formatPercent, formatTime } from './format';
import { describeTrend, MEASURES, type Measure } from './trend';

/**
 * Les Signaux du rapport : la réponse, ou pourquoi il n'y en a pas. Ils sont lus à part des métriques (`GET /api/signals`) : leur absence ne doit pas
 * empêcher de copier le reste.
 */
export type RetrospectiveSignals = { status: 'ok'; response: SignalsResponse } | { status: 'error' };

export interface RetrospectiveInput {
  /** Ce que le rapport mesure, tel que le titre le dit : le nom du Projet, ou « Vue globale ». */
  scopeName: string;
  metrics: NamedMetricsResponse;
  signals: RetrospectiveSignals;
}

const DASH = '—';

/**
 * Un texte venu des données (titre de ticket, nom de Projet) écrit tel quel dans le markdown : ses caractères de mise en forme sont échappés, pour qu'un
 * titre « Fix *config* | auth » ne crée ni italique ni colonne de tableau. Les fins de ligne deviennent des espaces : une ligne de liste ou de tableau ne se
 * coupe pas.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>|#~])/g, '\\$1');
}

const plural = (count: number, singular: string, pluralForm = `${singular}s`) => `${formatCount(count)} ${count <= 1 ? singular : pluralForm}`;

/** L'évolution d'une grandeur, pour la colonne du tableau : « +3 (+33 %), en mieux », « stable », « — » sans comparaison. */
export function evolution(trend: MetricsTrend, measure: Measure): string {
  const view = describeTrend(trend, measure);
  if (view.direction === 'none') return DASH;
  if (view.direction === 'flat') return 'stable';
  const verdict = view.tone === 'good' ? ', en mieux' : view.tone === 'bad' ? ', en moins bien' : '';
  return `${view.delta}${view.ratio ? ` (${view.ratio})` : ''}${verdict}`;
}

const previousOf = (trend: MetricsTrend, measure: Measure): string => (trend.previous === null ? DASH : measure.format(trend.previous));

const row = (cells: string[]) => `| ${cells.join(' | ')} |`;

function indicators({ tiles, health }: NamedMetricsResponse): string[] {
  const { throughput, leadTime, failureRate } = tiles;
  const { reopening } = health;
  const duration = MEASURES.duration;
  const rate = MEASURES.rate;
  const failureValue =
    failureRate.rate === null
      ? DASH
      : `${rate.format(failureRate.rate)} (${formatCount(failureRate.failed)} sur ${plural(failureRate.deliveries, 'Livraison')})${failureRate.significant ? '' : ', non significatif'}`;
  const lines = [
    row(['Indicateur', 'Période', 'Précédente', 'Évolution']),
    row(['---', '---:', '---:', '---']),
    row(['Débit', plural(throughput.total, 'Livraison'), previousOf(throughput.trend, MEASURES.count), evolution(throughput.trend, MEASURES.count)]),
    row(['Lead Time (médiane)', duration.format(leadTime.median ?? Number.NaN), previousOf(leadTime.trend.median, duration), evolution(leadTime.trend.median, duration)]),
    row(['Lead Time (P85)', duration.format(leadTime.p85 ?? Number.NaN), previousOf(leadTime.trend.p85, duration), evolution(leadTime.trend.p85, duration)]),
    row([
      'Taux de Réouverture',
      reopening.rate === null ? DASH : `${rate.format(reopening.rate)} (${formatCount(reopening.reopened)} sur ${plural(reopening.closures, 'clôture')})`,
      previousOf(reopening.trend, rate),
      reopening.rate === null ? DASH : evolution(reopening.trend, rate),
    ]),
    row(['Taux d’échec', failureValue, previousOf(failureRate.trend, rate), failureRate.rate === null ? DASH : evolution(failureRate.trend, rate)]),
  ];
  // Non significatif, le Taux d'échec ne se lit pas sans sa raison (Couverture faible, trop peu de bugs) : elle suit le tableau.
  if (!failureRate.significant && failureRate.reason) lines.push('', `_Taux d’échec non significatif : ${escapeMarkdown(lowerFirst(failureRate.reason))}_`);
  return lines;
}

const lowerFirst = (text: string) => `${text.charAt(0).toLowerCase()}${text.slice(1)}`;

function longTrend({ longTrend: trend }: NamedMetricsResponse): string[] {
  if (trend.weeks.length === 0) return [];
  const lines = [
    `## Tendance longue (${trend.weeks.length} semaines)`,
    '',
    row(['Semaine du', 'Débit', 'Lead Time (P85)', 'Taux de Réouverture']),
    row(['---', '---:', '---:', '---:']),
  ];
  for (const week of trend.weeks) {
    const p85 = week.leadTimeP85 === null ? DASH : `${MEASURES.duration.format(week.leadTimeP85)}${week.reliable ? '' : ' \\*'}`;
    lines.push(
      row([
        `${formatDay(week.from)}${week.partial ? ' (en cours)' : ''}`,
        formatCount(week.throughput),
        p85,
        week.reopeningRate === null ? DASH : formatPercent(week.reopeningRate, { precise: true }),
      ]),
    );
  }
  if (trend.weeks.some((week) => week.leadTimeP85 !== null && !week.reliable)) {
    lines.push('', `\\* Moins de ${trend.minDeliveries} Livraisons dans la semaine : le centile ne dit pas grand-chose.`);
  }
  return lines;
}

function rework({ health, projects }: NamedMetricsResponse, projectName: (id: string) => string): string[] {
  const { tickets } = health.rework;
  const lines = [`## Retravail (${plural(tickets.length, 'ticket')})`, ''];
  if (tickets.length === 0) return [...lines, 'Aucun ticket n’est revenu sur la période : ni Réouverture, ni Prise rendue, ni Bug d’origine.'];
  const showProject = projects.length > 1;
  for (const ticket of tickets) {
    const causes: string[] = [];
    if (ticket.reopenings > 0) causes.push(plural(ticket.reopenings, 'Réouverture'));
    if (ticket.returns > 0) causes.push(plural(ticket.returns, 'Prise rendue', 'Prises rendues'));
    if (ticket.originBugs.length > 0) causes.push(`${ticket.originBugs.length === 1 ? 'Bug d’origine' : 'Bugs d’origine'} ${ticket.originBugs.map((id) => `\`${id}\``).join(', ')}`);
    const where = showProject ? ` (${escapeMarkdown(projectName(ticket.project))})` : '';
    lines.push(`- \`${ticket.id}\` ${escapeMarkdown(ticketTitle(ticket))}${where} : ${causes.join(', ')}`);
  }
  return lines;
}

function signals(input: RetrospectiveSignals, timeZone: string, projectName: (id: string) => string, showProject: boolean): string[] {
  if (input.status === 'error') return ['## Signaux en cours', '', '_Les Signaux n’ont pas pu être lus._'];
  const { response } = input;
  const at = `${formatDay(dayInZone(response.generatedAt, timeZone))} à ${formatTime(response.generatedAt, timeZone)}`;
  const lines = [`## Signaux en cours (${plural(response.signals.length, 'Signal', 'Signaux')}, au ${at})`, ''];
  if (response.signals.length === 0) return [...lines, 'Aucune Dérive, aucun Blocage long, aucun Prêt qui stagne ni aucun WIP inhabituel en ce moment.'];
  for (const { kind, label } of SIGNAL_KINDS) {
    const group = response.signals.filter((signal) => signal.kind === kind);
    if (group.length === 0) continue;
    lines.push(`### ${label}`, '');
    for (const signal of group) {
      const where = escapeMarkdown(projectName(signal.project));
      if (signal.kind === 'unusualWip') {
        lines.push(`- ${where} : ${signalSentence(signal)}`);
      } else {
        lines.push(`- \`${signal.ticket.id}\` ${escapeMarkdown(ticketTitle(signal.ticket))}${showProject ? ` (${where})` : ''} : ${signalSentence(signal)}`);
      }
    }
    lines.push('');
  }
  if (lines.at(-1) === '') lines.pop();
  return lines;
}

/**
 * Le rapport de rétrospective d'une période, en markdown à copier : Débit, Lead Time, Taux de Réouverture et Taux d'échec avec leur évolution par rapport à
 * la période précédente (la même comparaison que les tuiles), la Tendance longue, les tickets en Retravail et les Signaux en cours. Les Signaux disent
 * maintenant, pas la période : le rapport le dit dans leur titre.
 */
export function buildRetrospective({ scopeName, metrics, signals: signalsInput }: RetrospectiveInput): string {
  const comparison = describeComparison(metrics);
  // Les Projets des métriques passent en dernier, donc l'emportent : ils portent leur nom écrit et `unnamed` (« Sans titre » est un repli). Chaque ligne nomme le sien
  // comme l'avis des Projets illisibles : « Un Projet sans nom » pour un repli, les autres entre guillemets dès que la liste en compte un.
  const known = new Map<string, { name: string; unnamed?: true }>(
    [...(signalsInput.status === 'ok' ? signalsInput.response.projects : []), ...metrics.projects].map((project) => [project.id, project]),
  );
  const among = [...known.values()];
  const projectName = (id: string) => {
    const project = known.get(id);
    return project ? projectLabel(project, among) : id;
  };
  const showProject = metrics.projects.length > 1 || (signalsInput.status === 'ok' && signalsInput.response.projects.length > 1);

  const sections = [
    [`# Rétrospective : ${escapeMarkdown(scopeName)}, ${formatDayRange(metrics.period.from, metrics.period.to)}`, '', comparison.summary],
    ['## Indicateurs', '', ...indicators(metrics)],
    longTrend(metrics),
    rework(metrics, projectName),
    signals(signalsInput, metrics.timeZone, projectName, showProject),
  ];
  return `${sections
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'))
    .join('\n\n')}\n`;
}
