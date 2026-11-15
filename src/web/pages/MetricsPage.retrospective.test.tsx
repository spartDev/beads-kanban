import { fireEvent, screen, waitFor, within } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi, type MockInstance } from 'vitest';
import type { ApiSignal } from '../data/types';
import { metricsFixture, plain, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { bdeskIssues, mpmIssues, projectsResponse } from '../test/fixtures';
import { renderApp } from '../test/render';
import { withTimeZone } from '../test/timeZone';

/** Le rapport de rétrospective (bdesk-3yu) : le bouton de la barre d'outils copie la période affichée en markdown, avec les Signaux du moment. */

const DAY = 86_400_000;

const drift: ApiSignal = {
  kind: 'drift',
  project: 'bdesk',
  ticket: { id: 'bdesk-d1', title: 'Refonte du kanban', type: 'feature', priority: 1 },
  cycleTime: 9 * DAY,
  reference: 4 * DAY,
  scope: 'type',
};

const api = (signals: Record<string, ApiSignal[] | Error> = { bdesk: [drift] }) =>
  stubMetricsApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues, mpm: mpmIssues }, signals }, () =>
    metricsFixture({ projects: [{ id: 'bdesk', name: 'beads-desktop' }] }),
  );

warmUpMetricsPages();
withTimeZone('Europe/Paris');

/** Le presse-papiers est celui que user-event installe au montage de l'application (`renderApp`) : on espionne le sien. */
let writeText: MockInstance<Clipboard['writeText']>;

beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
  vi.restoreAllMocks();
});

async function loaded({ copyFails = false } = {}) {
  renderApp('/p/bdesk/metrics');
  writeText = vi.spyOn(navigator.clipboard, 'writeText');
  if (copyFails) writeText.mockRejectedValue(new Error('NotAllowedError'));
  await screen.findByRole('heading', { level: 2, name: 'Indicateurs' });
}

describe('le rapport de rétrospective', () => {
  it('copie la période affichée, ses indicateurs, son Retravail et les Signaux en cours', async () => {
    const fetchMock = api();
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Copier le rapport' }));
    await screen.findByRole('button', { name: 'Rapport copié' });

    expect(writeText).toHaveBeenCalledTimes(1);
    const text = plain(String(writeText.mock.calls[0]?.[0]));
    expect(text).toMatch(/^# Rétrospective : beads-desktop, 27 oct. – 2 nov. 2026\n/);
    expect(text).toContain('| Débit | 18 Livraisons | 28 |');
    expect(text).toContain('## Retravail (2 tickets)');
    expect(text).toContain('### Dérive\n\n- `bdesk-d1` Refonte du kanban : 9 j de Cycle Time en cours');
    // Les Signaux du Projet seul, pas ceux de la Vue globale.
    expect(fetchMock.mock.calls.map(([input]) => String(input)).filter((url) => url.startsWith('/api/signals'))).toEqual(['/api/signals?project=bdesk&timeZone=Europe%2FParis']);
    expect(screen.getByText('Rapport de rétrospective copié dans le presse-papiers.')).toBeTruthy();
  });

  it('passe par un ClipboardItem qui attend le rapport quand le navigateur en a (Safari refuse writeText après une attente)', async () => {
    const written: Array<Record<string, Promise<Blob>>> = [];
    vi.stubGlobal(
      'ClipboardItem',
      class {
        constructor(readonly items: Record<string, Promise<Blob>>) {
          written.push(items);
        }
      },
    );
    api();
    await loaded();
    const write = vi.spyOn(navigator.clipboard, 'write').mockResolvedValue(undefined);

    fireEvent.click(screen.getByRole('button', { name: 'Copier le rapport' }));
    // L'écriture part pendant le clic, avant que le rapport soit prêt.
    expect(write).toHaveBeenCalledTimes(1);
    await screen.findByRole('button', { name: 'Rapport copié' });
    expect(writeText).not.toHaveBeenCalled();
    const blob = await written[0]?.['text/plain'];
    expect(plain(await blob?.text())).toMatch(/^# Rétrospective : beads-desktop/);
  });

  it('copie quand même les métriques si les Signaux ne se lisent pas', async () => {
    api({ bdesk: new Error('database is locked') });
    await loaded();

    fireEvent.click(screen.getByRole('button', { name: 'Copier le rapport' }));
    await screen.findByRole('button', { name: 'Rapport copié' });
    const text = plain(String(writeText.mock.calls[0]?.[0]));
    expect(text).toContain('## Indicateurs');
    expect(text).toContain('_Les Signaux n’ont pas pu être lus._');
  });

  it('dit que la copie a échoué, et montre le rapport dans l’aperçu pour le copier à la main', async () => {
    api();
    await loaded({ copyFails: true });

    fireEvent.click(screen.getByRole('button', { name: 'Copier le rapport' }));
    await screen.findByRole('button', { name: 'Copie impossible' });

    const summary = screen.getByText('Aperçu du rapport de rétrospective');
    const details = summary.closest('details');
    if (!details) throw new Error('L’aperçu devait être un <details>.');
    details.open = true;
    fireEvent(details, new Event('toggle'));
    const region = screen.getByRole('region', { name: 'Rapport de rétrospective (markdown)' });
    await waitFor(() => expect(plain(region.textContent)).toContain('# Rétrospective : beads-desktop'));
    expect(within(region).getByText(/Signaux en cours \(1 Signal/)).toBeTruthy();
  });
});
