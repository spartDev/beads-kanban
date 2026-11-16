import { render, screen, waitFor, within } from '@testing-library/react';
import { MemoryRouter } from 'react-router';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epicProgress, groupByColumn } from '../../domain/epics';
import type { Issue } from '../data/types';
import { LanguageProvider } from '../i18n';
import { shownText, spokenText } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { httpFailure, renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';
import { ByColumn } from './ByColumn';
import { TimeSection } from './TimeSection';

/**
 * Les pages des Epics en anglais, suite (bdesk-ewr.4) : les décomptes de mille et plus que grouping.test.tsx ne rend pas (le compte d'un
 * groupe, une Epic imbriquée, le rythme), une Epic fermée et ses dates (`formatInstant`), les raisons de masquer la prévision, une Epic
 * jeune, les états de chargement et d'erreur. Chaque test échoue si le composant garde le texte ou le formateur français.
 */
withAsyncTimeout(8_000);
const DAY = 86_400_000;
const NBSP = ' ';
const NOW = '2026-11-05T11:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

withTimeZone('Europe/Paris');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

const EPIC = issue({ id: 'bdesk-e1', title: 'Une Epic', type: 'epic', priority: 1, createdAt: ago(100) });
const child = (id: string, overrides: Partial<Issue> = {}) => issue({ id, title: `Enfant ${id}`, parentId: EPIC.id, ...overrides });
const closedChild = (id: string, days: number) => child(id, { status: 'closed', closedAt: ago(days), updatedAt: ago(days) });
const delivered = (count: number): Issue[] => Array.from({ length: count }, (_, i) => closedChild(`bdesk-l${i}`, 2));
const opened = (count: number): Issue[] => Array.from({ length: count }, (_, i) => child(`bdesk-o${i}`));

async function openEnglish(path: string, issues: Issue[]) {
  setBrowserLanguages(['en-US']);
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  const app = renderApp(path, { languageSwitch: true });
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).hasAttribute('data-skeleton')).toBe(false));
  return app;
}
const section = (name: string) => screen.getByRole('region', { name });

/** Un faux serveur dont la réponse des tickets attend la fonction rendue, puis échoue (500). */
function slowFailingIssues() {
  const fetchMock = stubApi({
    projects: projectsResponse,
    issues: { bdesk: httpFailure(500, { statusCode: 500, error: 'Internal Server Error', message: 'database is locked' }) },
  });
  const healthy = fetchMock.getMockImplementation();
  if (!healthy) throw new Error('stubApi expected');
  let release = () => {};
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  fetchMock.mockImplementation(async (input) => {
    if (String(input).endsWith('/issues')) await gate;
    return healthy(input);
  });
  return () => release();
}

describe('counts of 1,000 and more that grouping.test.tsx does not render', () => {
  // 1 000 Livraisons des 28 derniers jours, 1 000 Enfants prêts, et une Epic imbriquée qui en a autant.
  const children = [...delivered(1000), ...opened(1000)];
  const nested = issue({ id: 'bdesk-n', title: 'Imbriquée', type: 'epic', parentId: EPIC.id });

  function renderChildren(switchEnabled: boolean) {
    return render(
      <LanguageProvider switchEnabled={switchEnabled}>
        <MemoryRouter>
          {/* Les groupes : les seuls Enfants prêts (les mille lignes de Terminé ne sont pas lues) ; l'Epic imbriquée et la prévision gardent tout. */}
          <ByColumn groups={groupByColumn(opened(1000))} nestedEpics={[nested]} projectId="bdesk" now={Date.parse(NOW)} progressOf={() => epicProgress(children)} />
          <TimeSection epic={EPIC} kids={children} now={Date.parse(NOW)} />
        </MemoryRouter>
      </LanguageProvider>,
    );
  }
  /** Le compte à côté du titre du groupe Prêt : `epic-group-ready-count` (ByColumn.tsx). */
  const readyCount = () => document.getElementById('epic-group-ready-count')?.textContent;

  it('in French: the group count, the nested Epic and the pace', () => {
    renderChildren(false);

    expect(readyCount()).toBe(`1${NBSP}000 tickets`);
    expect(within(section('Epics imbriquées')).getByRole('link').textContent).toContain(`1${NBSP}000 sur 2${NBSP}000 Livraisons`);
    expect(section('Lead Time et prévision').textContent).toContain(`Au rythme de 1${NBSP}000 Livraisons en 28 jours, pour 1${NBSP}000 Enfants restants.`);
  });

  it('in English: the group count, the nested Epic and the pace', () => {
    setBrowserLanguages(['en-US']);
    renderChildren(true);

    expect(readyCount()).toMatch(/^1,000 /);
    expect(within(section('Nested Epics')).getByRole('link').textContent).toContain('1,000 of 2,000 delivered');
    expect(section('Lead Time and forecast').textContent).toContain('At a pace of 1,000 Deliveries in 28 days, for 1,000 Children remaining.');
  });
});

describe('English that english.test.tsx does not read', () => {
  const forecast = () => within(section('Lead Time and forecast')).getByText('Completion forecast').closest('div') as HTMLElement;

  it('a closed Epic: its Lead Time and its two dates (formatInstant)', async () => {
    const closed = issue({
      id: 'bdesk-e1',
      title: 'Une Epic',
      type: 'epic',
      status: 'closed',
      createdAt: '2026-10-01T09:00:00.000Z',
      closedAt: '2026-10-04T13:00:00.000Z',
    });
    await openEnglish('/p/bdesk/epics?epic=bdesk-e1', [closed, closedChild('bdesk-a', 3)]);

    const leadTime = within(section('Lead Time and forecast')).getByText('Lead Time').closest('div') as HTMLElement;
    expect(shownText(leadTime)).toContain(`3.2${NBSP}d`);
    expect(leadTime.textContent).toContain('created Oct 1, 2026, 11:00 · closed Oct 4, 2026, 15:00');
    expect(forecast().textContent).toContain('Epic closed: there is no end left to forecast.');
  });

  it('why the forecast is hidden: all delivered', async () => {
    await openEnglish('/p/bdesk/epics?epic=bdesk-e1', [EPIC, closedChild('bdesk-a', 3)]);
    expect(forecast().textContent).toContain('All Children are Delivered or Dropped: the Epic can be closed.');
  });

  it('why the forecast is hidden: no Children to deliver', async () => {
    await openEnglish('/p/bdesk/epics?epic=bdesk-e1', [EPIC]);
    expect(forecast().textContent).toContain('No Children to deliver.');
  });

  it('a young Epic: the measurement reaches back before its creation', async () => {
    const young = [{ ...EPIC, createdAt: ago(13 / 24) }, ...Array.from({ length: 3 }, (_, i) => closedChild(`bdesk-l${i}`, 0.5 + i)), ...opened(5)];
    await openEnglish('/p/bdesk/epics?epic=bdesk-e1', young);

    expect(shownText(forecast())).toContain(
      `Not enough Throughput: 3 Deliveries over the last 7 days (the Epic is only 13${NBSP}h old: the measurement reaches back before its creation); at least 4 are needed.`,
    );
    expect(spokenText(forecast())).toContain('the Epic is only 13 hours old: the measurement reaches back before its creation');
  });

  it('the list page: its description, the name of its loading state, its error', async () => {
    setBrowserLanguages(['en-US']);
    const release = slowFailingIssues();
    renderApp('/p/bdesk/epics', { languageSwitch: true });

    expect(await screen.findByRole('status', { name: 'Loading Epics' })).toBeTruthy();
    expect(screen.getByText('The Progress of each Epic in beads-desktop: the Deliveries among its Children.')).toBeTruthy();
    release();
    expect(await screen.findByText('Couldn’t load the tickets')).toBeTruthy();
  });

  it('the Epic page: the name of its loading state, its error page', async () => {
    setBrowserLanguages(['en-US']);
    const release = slowFailingIssues();
    renderApp('/p/bdesk/epics?epic=bdesk-e1', { languageSwitch: true });

    expect(await screen.findByRole('status', { name: 'Loading Epic' })).toBeTruthy();
    release();
    expect(await screen.findByRole('heading', { level: 1, name: 'Epic unavailable' })).toBeTruthy();
    expect(screen.getByText('Couldn’t load the tickets')).toBeTruthy();
  });
});
