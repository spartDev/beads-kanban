import type { MetricsTrend, SignalsResponse } from '../../shared/api';
import { ticketTitle } from '../data/helpers';
import { projectLabel } from '../data/projectNames';
import { CATALOGS } from '../i18n/catalog';
import type { Language } from '../i18n/language';
import { signalKinds, signalSentence } from '../lib/signals';
import type { NamedMetricsResponse } from './api';
import { describeComparison } from './comparison';
import { failureRateReason } from './failureReason';
import { dayInZone, FORMATS, formatTime } from './format';
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
  /** La langue du rapport : celle de l'interface. */
  language: Language;
}

const textsIn = (language: Language) => CATALOGS[language].metrics.retrospective;

const DASH = '—';

/**
 * Un texte venu des données (titre de ticket, nom de Projet) écrit tel quel dans le markdown : ses caractères de mise en forme sont échappés, pour qu'un
 * titre « Fix *config* | auth » ne crée ni italique ni colonne de tableau. Les fins de ligne deviennent des espaces : une ligne de liste ou de tableau ne se
 * coupe pas.
 */
export function escapeMarkdown(text: string): string {
  return text.replace(/[\r\n]+/g, ' ').replace(/([\\`*_[\]<>|#~])/g, '\\$1');
}

/** Un nombre accordé : `text` reçoit le nombre écrit dans la langue, puis le nombre lui-même pour le pluriel. */
const counted = (language: Language, count: number, text: (written: string, n: number) => string) => text(FORMATS[language].formatCount(count), count);

/** L'évolution d'une grandeur, pour la colonne du tableau : « +3 (+33 %), en mieux », « stable », « — » sans comparaison. */
export function evolution(trend: MetricsTrend, measure: Measure): string {
  const texts = textsIn(measure.language);
  const view = describeTrend(trend, measure);
  if (view.direction === 'none') return DASH;
  if (view.direction === 'flat') return texts.stable;
  const verdict = view.tone === 'good' ? texts.better : view.tone === 'bad' ? texts.worse : '';
  return `${view.delta}${view.ratio ? ` (${view.ratio})` : ''}${verdict}`;
}

const previousOf = (trend: MetricsTrend, measure: Measure): string => (trend.previous === null ? DASH : measure.format(trend.previous));

const row = (cells: string[]) => `| ${cells.join(' | ')} |`;

function indicators({ tiles, health }: NamedMetricsResponse, language: Language): string[] {
  const texts = textsIn(language);
  const { formatCount } = FORMATS[language];
  const { throughput, leadTime, failureRate } = tiles;
  const { reopening } = health;
  const { count, duration, rate } = MEASURES[language];
  const failureValue =
    failureRate.rate === null
      ? DASH
      : `${rate.format(failureRate.rate)} (${texts.outOf(formatCount(failureRate.failed), counted(language, failureRate.deliveries, texts.deliveries))})${failureRate.significant ? '' : texts.notSignificant}`;
  const lines = [
    row([texts.indicator, texts.period, texts.previous, texts.evolution]),
    row(['---', '---:', '---:', '---']),
    row([texts.throughput, counted(language, throughput.total, texts.deliveries), previousOf(throughput.trend, count), evolution(throughput.trend, count)]),
    row([texts.leadTimeMedian, duration.format(leadTime.median ?? Number.NaN), previousOf(leadTime.trend.median, duration), evolution(leadTime.trend.median, duration)]),
    row([texts.leadTimeP85, duration.format(leadTime.p85 ?? Number.NaN), previousOf(leadTime.trend.p85, duration), evolution(leadTime.trend.p85, duration)]),
    row([
      texts.reopenRate,
      reopening.rate === null ? DASH : `${rate.format(reopening.rate)} (${texts.outOf(formatCount(reopening.reopened), counted(language, reopening.closures, texts.closures))})`,
      previousOf(reopening.trend, rate),
      reopening.rate === null ? DASH : evolution(reopening.trend, rate),
    ]),
    row([texts.failureRate, failureValue, previousOf(failureRate.trend, rate), failureRate.rate === null ? DASH : evolution(failureRate.trend, rate)]),
  ];
  // Non significatif, le Taux d'échec ne se lit pas sans sa raison (Couverture faible, trop peu de bugs) : elle suit le tableau. Le motif est écrit ici, dans la
  // langue du rapport, à partir des codes de l'API (`failureRateReason`) : celui du serveur (`reason`) est en français.
  const reason = failureRate.significant ? null : failureRateReason(failureRate, language);
  if (reason !== null) lines.push('', `_${texts.failureNote(escapeMarkdown(reason))}_`);
  return lines;
}


function longTrend({ longTrend: trend }: NamedMetricsResponse, language: Language): string[] {
  if (trend.weeks.length === 0) return [];
  const texts = textsIn(language);
  const { formatCount, formatDay, formatPercent } = FORMATS[language];
  const lines = [
    `## ${texts.longTrend(formatCount(trend.weeks.length), trend.weeks.length)}`,
    '',
    row([texts.weekOf, texts.throughput, texts.leadTimeP85, texts.reopenRate]),
    row(['---', '---:', '---:', '---:']),
  ];
  for (const week of trend.weeks) {
    const p85 = week.leadTimeP85 === null ? DASH : `${MEASURES[language].duration.format(week.leadTimeP85)}${week.reliable ? '' : ' \\*'}`;
    lines.push(
      row([
        `${formatDay(week.from)}${week.partial ? texts.running : ''}`,
        formatCount(week.throughput),
        p85,
        week.reopeningRate === null ? DASH : formatPercent(week.reopeningRate, { precise: true }),
      ]),
    );
  }
  if (trend.weeks.some((week) => week.leadTimeP85 !== null && !week.reliable)) {
    lines.push('', `\\* ${texts.unreliable(formatCount(trend.minDeliveries))}`);
  }
  return lines;
}

function rework({ health, projects }: NamedMetricsResponse, projectName: (id: string) => string, language: Language): string[] {
  const texts = textsIn(language);
  const { tickets } = health.rework;
  const lines = [`## ${texts.rework(counted(language, tickets.length, texts.tickets))}`, ''];
  if (tickets.length === 0) return [...lines, texts.noRework];
  const showProject = projects.length > 1;
  for (const ticket of tickets) {
    const causes: string[] = [];
    if (ticket.reopenings > 0) causes.push(counted(language, ticket.reopenings, texts.reopens));
    if (ticket.returns > 0) causes.push(counted(language, ticket.returns, texts.handbacks));
    if (ticket.originBugs.length > 0) causes.push(texts.originBugs(ticket.originBugs.length, ticket.originBugs.map((id) => `\`${id}\``).join(', ')));
    const where = showProject ? ` (${escapeMarkdown(projectName(ticket.project))})` : '';
    lines.push(`- ${texts.item(`\`${ticket.id}\` ${escapeMarkdown(ticketTitle(ticket))}${where}`, causes.join(', '))}`);
  }
  return lines;
}

function signals(input: RetrospectiveSignals, timeZone: string, projectName: (id: string) => string, showProject: boolean, language: Language): string[] {
  const texts = textsIn(language);
  if (input.status === 'error') return [`## ${texts.signalsHeading}`, '', `_${texts.signalsUnreadable}_`];
  const { response } = input;
  const at = CATALOGS[language].metrics.comparison.at(FORMATS[language].formatDay(dayInZone(response.generatedAt, timeZone)), formatTime(response.generatedAt, timeZone));
  const lines = [`## ${texts.signalsHeadingAt(counted(language, response.signals.length, texts.signals), at)}`, ''];
  if (response.signals.length === 0) return [...lines, texts.noSignals];
  for (const { kind, label } of signalKinds(language)) {
    const group = response.signals.filter((signal) => signal.kind === kind);
    if (group.length === 0) continue;
    lines.push(`### ${label}`, '');
    for (const signal of group) {
      const where = escapeMarkdown(projectName(signal.project));
      if (signal.kind === 'unusualWip') {
        lines.push(`- ${texts.item(where, signalSentence(signal, language))}`);
      } else {
        lines.push(`- ${texts.item(`\`${signal.ticket.id}\` ${escapeMarkdown(ticketTitle(signal.ticket))}${showProject ? ` (${where})` : ''}`, signalSentence(signal, language))}`);
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
export function buildRetrospective({ scopeName, metrics, signals: signalsInput, language }: RetrospectiveInput): string {
  const texts = textsIn(language);
  const comparison = describeComparison(metrics, language);
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
    [`# ${texts.title(escapeMarkdown(scopeName), FORMATS[language].formatDayRange(metrics.period.from, metrics.period.to))}`, '', comparison.summary],
    [`## ${texts.indicators}`, '', ...indicators(metrics, language)],
    longTrend(metrics, language),
    rework(metrics, projectName, language),
    signals(signalsInput, metrics.timeZone, projectName, showProject, language),
  ];
  return `${sections
    .filter((section) => section.length > 0)
    .map((section) => section.join('\n'))
    .join('\n\n')}\n`;
}
