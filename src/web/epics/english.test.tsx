import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { Issue } from '../data/types';
import { CATALOGS } from '../i18n';
import { shownText, spokenText } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/**
 * Les pages des Epics en anglais (bdesk-ewr.4) : un navigateur anglais, le sélecteur de langue activé comme le fera bdesk-ewr.7.
 * Les termes sont ceux de CONTEXT.md (Progress, Delivery, Child, Dropped, Completion forecast, Recent throughput) ; les nombres
 * et les dates suivent les conventions anglaises (`useFormat()`). Le contenu des tickets n'est pas traduit.
 */

withAsyncTimeout(5_000);

const DAY = 86_400_000;
const NBSP = ' ';
/** Jeudi 5 novembre 2026, midi à Paris. */
const NOW = '2026-11-05T11:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

withTimeZone('Europe/Paris');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
  setBrowserLanguages(['en-US']);
});
afterEach(() => {
  vi.useRealTimers();
});

const EPIC = issue({ id: 'bdesk-e1', title: 'Une Epic', type: 'epic', priority: 1, createdAt: ago(100) });
const child = (id: string, overrides: Partial<Issue> = {}) => issue({ id, title: `Enfant ${id}`, parentId: EPIC.id, ...overrides });
const closedChild = (id: string, days: number, overrides: Partial<Issue> = {}) =>
  child(id, { status: 'closed', closedAt: ago(days), updatedAt: ago(days), ...overrides });

async function open(path: string, issues: Issue[]) {
  stubApi({ projects: projectsResponse, issues: { bdesk: issues } });
  const app = renderApp(path, { languageSwitch: true });
  await waitFor(() => expect(screen.getByRole('heading', { level: 1 }).hasAttribute('data-skeleton')).toBe(false));
  return app;
}

const section = (name: string) => screen.getByRole('region', { name });

describe('the Epic page, in English', () => {
  const someChildren = [
    EPIC,
    closedChild('bdesk-a', 3),
    child('bdesk-b'),
    closedChild('bdesk-c', 2, { abandon: { cause: 'duplicate', of: 'bdesk-a' } }),
  ];

  it('says the Progress in Deliveries of Children, with the Dropped ones apart', async () => {
    await open('/p/bdesk/epics?epic=bdesk-e1', someChildren);

    const progress = section('Progress');
    expect(within(progress).getByText('1 Delivery out of 2 Children')).toBeTruthy();
    expect(within(progress).getByText('50%')).toBeTruthy();
    const bar = within(progress).getByRole('progressbar', { name: 'Progress of the Epic' });
    expect(bar.getAttribute('aria-valuetext')).toBe('1 Delivery out of 2 Children');
    expect(within(progress).getByRole('list', { name: 'Children by column' }).textContent).toContain('including 1 Dropped');
    expect(progress.textContent).toContain('1 Dropped ticket (duplicate or superseded) counts neither as a Delivery nor as a Child to deliver.');
  });

  it('names the header, the links and the Children display in English', async () => {
    const { user } = await open('/p/bdesk/epics?epic=bdesk-e1', someChildren);

    const terms = [...document.querySelectorAll('dt')].map((term) => term.textContent);
    expect(terms).toEqual(expect.arrayContaining(['Type', 'ID', 'Priority', 'Status']));

    expect(screen.getByRole('link', { name: 'Open the ticket' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See on the kanban' })).toBeTruthy();
    const children = section('Children');
    const display = within(children).getByRole('group', { name: 'Children display' });
    await user.click(within(display).getByRole('button', { name: 'Tree' }));
    expect(within(children).getByRole('list', { name: 'Tree' })).toBeTruthy();
    expect(within(display).getByRole('button', { name: 'Tree' }).getAttribute('aria-pressed')).toBe('true');
  });

  it('writes the Children rows and groups in English, by column and as a tree', async () => {
    const nested = issue({ id: 'bdesk-n', title: 'Une Epic imbriquée', type: 'epic', parentId: EPIC.id });
    const rows = [
      EPIC,
      child('bdesk-w', { blockedBy: ['bdesk-x', 'bdesk-y', 'bdesk-z'] }),
      child('bdesk-s', { status: 'blocked' }),
      child('bdesk-p', { status: 'deferred' }),
      closedChild('bdesk-a', 3),
      closedChild('bdesk-c', 2, { abandon: { cause: 'duplicate', of: 'bdesk-a' } }),
      nested,
      issue({ id: 'bdesk-g', title: 'Petit-enfant', parentId: nested.id, status: 'closed', closedAt: ago(1) }),
      issue({ id: 'bdesk-h', title: 'Petit-enfant', parentId: nested.id }),
    ];
    const { user } = await open('/p/bdesk/epics?epic=bdesk-e1', rows);

    const children = section('Children');
    const row = (id: string) => children.querySelector(`a[href$="${id}"]`) as HTMLElement;
    expect(within(children).getByRole('region', { name: 'Paused' })).toBeTruthy();
    expect(within(children).getByRole('region', { name: 'Nested Epics' })).toBeTruthy();
    expect(children.textContent).toContain('including 1 Dropped');
    expect(row('bdesk-w').textContent).toContain('Waiting on bdesk-x, bdesk-y +1');
    expect(row('bdesk-s').textContent).toContain('Blocked status');
    expect(row('bdesk-a').textContent).toMatch(/Closed 3 days ago/);
    expect(row('bdesk-a').querySelector('time')?.getAttribute('title')).toMatch(/^November 2, 2026/);
    expect(row('epic=bdesk-n').textContent).toContain('1 of 2 delivered');

    await user.click(within(children).getByRole('button', { name: 'Tree' }));
    expect(row('bdesk-p').textContent).toContain('Paused');
  });

  it('writes durations in English, short for the eyes and in words for screen readers', async () => {
    await open('/p/bdesk/epics?epic=bdesk-e1', someChildren);

    const leadTime = within(section('Lead Time and forecast')).getByText('Lead Time').closest('div') as HTMLElement;
    expect(shownText(leadTime)).toContain(`open for 100${NBSP}d`);
    expect(spokenText(leadTime)).toContain('open for 100 days');
  });

  it('says the Lead Time of an open Epic is still to come', async () => {
    await open('/p/bdesk/epics?epic=bdesk-e1', someChildren);

    const time = section('Lead Time and forecast');
    expect(time.textContent).toContain('not closed yet · open for');
    expect(within(time).getByText('Undefined').className).toContain('sr-only');
  });

  describe('the Completion forecast', () => {
    /** `shipped` Livraisons réparties sur les 26 derniers jours, `left` Enfants ouverts. */
    const withThroughput = (shipped: number, left: number): Issue[] => [
      EPIC,
      ...Array.from({ length: shipped }, (_, i) => closedChild(`bdesk-l${i}`, 1 + (i * 25) / Math.max(1, shipped - 1))),
      ...Array.from({ length: left }, (_, i) => child(`bdesk-o${i}`)),
    ];
    const forecast = () => within(section('Lead Time and forecast')).getByText('Completion forecast').closest('div') as HTMLElement;

    it('writes the range, the days it falls on and the pace, in English', async () => {
      await open('/p/bdesk/epics?epic=bdesk-e1', withThroughput(8, 6));

      expect(shownText(forecast())).toContain(`2 to 5${NBSP}weeks`);
      expect(spokenText(forecast())).toContain('between 2 and 5 weeks');
      expect(forecast().textContent).toContain('Estimated end between Nov 21 and Dec 7, 2026');
      expect(forecast().textContent).toContain('At a pace of 8 Deliveries in 28 days, for 6 Children remaining.');
    });

    it('says why it is hidden without enough Throughput, and explains its method', async () => {
      await open('/p/bdesk/epics?epic=bdesk-e1', withThroughput(3, 5));

      expect(forecast().textContent).toContain('Hidden');
      expect(forecast().textContent).toContain('Not enough Throughput: 3 Deliveries over the last 28 days; at least 4 are needed.');
      const method = within(section('Lead Time and forecast')).getByText('Method.').closest('p')?.textContent ?? '';
      expect(method).toContain('Recent throughput');
      expect(method).toContain('never over fewer than 7 days');
      expect(method).toContain('Below 4 recent Deliveries, it is hidden.');
    });
  });
});

describe('the counted nouns, in English: singular at 1 only, plural at 0', () => {
  const { counted } = CATALOGS.en.epics;

  it.each([
    [0, '0 Deliveries', '0 Children', '0 Dropped'],
    [1, '1 Delivery', '1 Child', '1 Dropped'],
    [2, '2 Deliveries', '2 Children', '2 Dropped'],
  ])('%i', (n, deliveries, children, dropped) => {
    expect(counted.deliveries(n, String(n))).toBe(deliveries);
    expect(counted.children(n, String(n))).toBe(children);
    expect(counted.dropped(n, String(n))).toBe(dropped);
  });

  it('keeps the French rule apart: singular under 2', () => {
    expect(CATALOGS.fr.epics.counted.deliveries(0, '0')).toBe('0 Livraison');
  });
});

describe('the Epics list, in English', () => {
  it('counts the Epics and their Children, and says each Epic’s Progress', async () => {
    await open('/p/bdesk/epics', [EPIC, closedChild('bdesk-a', 3), child('bdesk-b')]);

    const openEpics = await screen.findByRole('list', { name: 'Open Epics' });
    expect(screen.getByText('1 Epic grouping 2 Children')).toBeTruthy();
    expect(within(openEpics).getByRole('progressbar', { name: 'Progress of Une Epic' }).getAttribute('aria-valuetext')).toBe('1 Delivery out of 2 Children');
    expect(within(openEpics).getByText(/^1 of 2/).textContent).toBe('1 of 2 delivered · 50%');
  });

  it('says there is no Epic yet, and how to make one', async () => {
    await open('/p/bdesk/epics', [issue({ id: 'bdesk-a', title: 'Un ticket' })]);

    expect(await screen.findByText('No Epics in this Project')).toBeTruthy();
    expect(screen.getByText(/An Epic is a ticket of type epic; this Project’s Epics will show up here/)).toBeTruthy();
  });

  it('says an Epic without Children to deliver has none, and how many are Dropped', async () => {
    await open('/p/bdesk/epics', [EPIC, closedChild('bdesk-c', 2, { abandon: { cause: 'duplicate', of: 'bdesk-x' } })]);

    expect(await screen.findByText('No Children to deliver (1 Dropped)')).toBeTruthy();
  });

  it('says a ticket that is not an Epic is not one', async () => {
    await open('/p/bdesk/epics?epic=bdesk-a', [EPIC, child('bdesk-a')]);

    expect(screen.getByRole('heading', { level: 1, name: 'This isn’t an Epic' })).toBeTruthy();
    expect(screen.getByText('Only a ticket of type epic groups Children and has a Progress page.')).toBeTruthy();
  });

  it('says an unknown Epic is not found', async () => {
    await open('/p/bdesk/epics?epic=bdesk-zzz', [EPIC]);

    expect(screen.getByRole('heading', { level: 1, name: 'Epic not found' })).toBeTruthy();
    expect(screen.getByRole('link', { name: 'See the Project’s Epics' })).toBeTruthy();
  });
});
