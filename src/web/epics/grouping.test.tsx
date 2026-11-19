import { render, screen, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { epicProgress, groupByColumn } from '../../domain/epics';
import type { Issue } from '../data/types';
import { LanguageProvider } from '../i18n';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';
import { withTimeZone } from '../test/timeZone';
import { ProgressSection } from './ProgressSection';
import { TimeSection } from './TimeSection';
import { NO_DECLARED_STATUSES } from '../../domain/statuses';

/**
 * Les décomptes de mille et plus, écrits par les formateurs de la langue (bdesk-ewr.4) : « 1 000 » (espace insécable) en français,
 * « 1,000 » en anglais, jamais « 1000 ». La liste se monte entière ; l'avancement et la prévision d'une Epic se rendent seuls, sans
 * les mille lignes de ses Enfants.
 */

withAsyncTimeout(8_000);
const NBSP = ' ';
const DAY = 86_400_000;
const NOW = '2026-11-05T11:00:00.000Z';
const ago = (days: number) => new Date(Date.parse(NOW) - days * DAY).toISOString();

withTimeZone('Europe/Paris');
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'], now: new Date(NOW) });
});
afterEach(() => {
  vi.useRealTimers();
});

const EPIC = issue({ id: 'bdesk-e1', title: 'Une Epic', type: 'epic', createdAt: ago(100) });
const delivered = (count: number): Issue[] =>
  Array.from({ length: count }, (_, i) => issue({ id: `bdesk-l${i}`, title: `Livré ${i}`, parentId: EPIC.id, status: 'closed', closedAt: ago(2), updatedAt: ago(2) }));
const open = (count: number): Issue[] => Array.from({ length: count }, (_, i) => issue({ id: `bdesk-o${i}`, title: `Ouvert ${i}`, parentId: EPIC.id }));

describe('la liste des Epics : 1 000 Livraisons sur 2 000 Enfants', () => {
  const list = [EPIC, ...delivered(1000), ...open(1000)];

  it('en français : espace insécable', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: list } });
    renderApp('/p/bdesk/epics');

    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe(`1${NBSP}000 Livraisons sur 2${NBSP}000 Enfants`);
    expect(bar.parentElement?.textContent).toContain(`1${NBSP}000 sur 2${NBSP}000`);
    expect(screen.getByText(/^1 Epic regroupant/).textContent).toBe(`1 Epic regroupant 2${NBSP}000 Enfants`);
  });

  it('en anglais : virgule', async () => {
    setBrowserLanguages(['en-US']);
    stubApi({ projects: projectsResponse, issues: { bdesk: list } });
    renderApp('/p/bdesk/epics', { languageSwitch: true });

    const bar = await screen.findByRole('progressbar');
    expect(bar.getAttribute('aria-valuetext')).toBe('1,000 Deliveries out of 2,000 Children');
    expect(bar.parentElement?.textContent).toContain('1,000 of 2,000 delivered');
    expect(screen.getByText('1 Epic grouping 2,000 Children')).toBeTruthy();
  });
});

describe('l’avancement et la prévision d’une Epic : 4 Livraisons récentes, 1 000 Enfants prêts', () => {
  const children = [...delivered(4), ...open(1000)];

  function renderSections(switchEnabled: boolean) {
    return render(
      <LanguageProvider switchEnabled={switchEnabled}>
        <ProgressSection progress={epicProgress(children)} groups={groupByColumn(children, NO_DECLARED_STATUSES)} />
        <TimeSection epic={EPIC} kids={children} now={Date.parse(NOW)} />
      </LanguageProvider>,
    );
  }

  it('en français : espace insécable, de la phrase à la prévision', () => {
    renderSections(false);

    const progress = screen.getByRole('region', { name: 'Avancement' });
    const sentence = `4 Livraisons sur 1${NBSP}004 Enfants`;
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuetext')).toBe(sentence);
    expect(progress.textContent).toContain(sentence);
    const pills = within(progress).getByRole('list', { name: 'Enfants par colonne' });
    expect(within(pills).getAllByRole('listitem').map((item) => item.textContent)).toEqual([`Prêt 1${NBSP}000`, 'Terminé 4']);
    expect(screen.getByRole('region', { name: 'Lead Time et prévision' }).textContent).toContain(
      `Au rythme de 4 Livraisons en 28 jours, pour 1${NBSP}000 Enfants restants.`,
    );
  });

  it('en anglais : virgule', () => {
    setBrowserLanguages(['en-US']);
    renderSections(true);

    const progress = screen.getByRole('region', { name: 'Progress' });
    expect(within(progress).getByRole('progressbar').getAttribute('aria-valuetext')).toBe('4 Deliveries out of 1,004 Children');
    expect(within(progress).getByRole('list', { name: 'Children by column' }).textContent).toContain('1,000');
    expect(screen.getByRole('region', { name: 'Lead Time and forecast' }).textContent).toContain(
      'At a pace of 4 Deliveries in 28 days, for 1,000 Children remaining.',
    );
  });
});
