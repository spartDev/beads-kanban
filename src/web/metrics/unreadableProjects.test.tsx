import { render, screen } from '@testing-library/react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { withProjectNames } from '../data/projectNames';
import type { Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues } from '../test/fixtures';
import { renderApp } from '../test/render';
import { withTimeZone } from '../test/timeZone';
import { UnreadableProjects } from './Notices';
import { metricsOf, stubChartWidth, stubMetricsApi, warmUpMetricsPages } from './testing';

/**
 * L'avis « Projets illisibles » des métriques écrit une ligne par Projet, avec sa raison (« beads-desktop : Base Dolt verrouillée ») : un libellé suivi de ce qui le qualifie, sans pastille à côté.
 * Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » (bdesk-38k.65), et avec un dossier qui s'appelle vraiment « Sans titre » deux lignes se lisaient de la même façon
 * (« Sans titre : verrou » deux fois), sans rien pour dire laquelle est laquelle. La liste est nommée comme l'alerte de la palette nomme les Projets qui sont en panne (`projectList`,
 * bdesk-38k.73, relecture finale) : les noms qui se voient entre guillemets, « Un Projet sans nom » pour ce qui n'en a pas ; une liste de noms seulement s'écrit comme avant.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée ; la vue des métriques est un morceau chargé à la demande : voir `warmUpMetricsPages`.
warmUpMetricsPages();
withAsyncTimeout(8_000);
withTimeZone('Europe/Paris');

// Seule `Date` est figée (le 2 novembre 2026, 20:00 à Paris, l'instant des fixtures) : la Vue globale lit la date du jour.
beforeEach(() => {
  vi.useFakeTimers({ toFake: ['Date'] });
  vi.setSystemTime(new Date('2026-11-02T19:00:15.242Z'));
  stubChartWidth(640);
});
afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

/** Le nom que le serveur donne à un dossier dont le nom ne se voit pas : un remplisseur hangul. */
const BLANK = String.fromCodePoint(0x3164);
const entry = (id: string, name: string, reason: string) => ({ id, name, reason });

const textOf = async (title: string) => (await screen.findByRole('status', { name: title })).textContent;

describe('l’avis des Projets illisibles, un composant', () => {
  it('des Projets dont le nom se voit : chacun sous son nom, comme avant', async () => {
    render(<UnreadableProjects projects={withProjectNames([entry('bdesk', 'beads-desktop', 'Base Dolt verrouillée'), entry('mpm', 'My-Prompt-Manager', 'Base Dolt absente')])} />);

    expect(await textOf('2 Projets illisibles, absents de ces chiffres')).toBe('2 Projets illisibles, absents de ces chiffresbeads-desktop : Base Dolt verrouilléeMy-Prompt-Manager : Base Dolt absente');
  });

  it('un dossier qui s’appelle vraiment « Sans titre », seul : « Sans titre », comme avant', async () => {
    render(<UnreadableProjects projects={withProjectNames([entry('st', 'Sans titre', 'verrou')])} />);

    expect(await textOf('Un Projet illisible, absent de ces chiffres')).toBe('Un Projet illisible, absent de ces chiffresSans titre : verrou');
  });

  it('un Projet sans nom, seul : « Un Projet sans nom », non « Sans titre » qui se lirait comme son nom', async () => {
    render(<UnreadableProjects projects={withProjectNames([entry('blanc', BLANK, 'verrou')])} />);

    expect(await textOf('Un Projet illisible, absent de ces chiffres')).toBe('Un Projet illisible, absent de ces chiffresUn Projet sans nom : verrou');
  });

  // La relecture : « Sans titre : verrou » deux fois, sans pastille pour dire laquelle est le dossier qui s'appelle vraiment ainsi.
  it('un dossier qui s’appelle vraiment « Sans titre » et un Projet sans nom : deux lignes qui ne se lisent pas de la même façon', async () => {
    render(<UnreadableProjects projects={withProjectNames([entry('st', 'Sans titre', 'verrou'), entry('blanc', BLANK, 'verrou')])} />);

    expect(await textOf('2 Projets illisibles, absents de ces chiffres')).toBe('2 Projets illisibles, absents de ces chiffres« Sans titre » : verrouUn Projet sans nom : verrou');
  });

  it('les noms qui se voient sont entre guillemets dès qu’un Projet est sans nom, et chaque Projet sans nom a sa ligne', async () => {
    render(
      <UnreadableProjects
        projects={withProjectNames([entry('bdesk', 'beads-desktop', 'Base Dolt verrouillée'), entry('a', BLANK, 'verrou'), entry('mpm', 'My-Prompt-Manager', 'Base Dolt absente'), entry('b', BLANK, 'absente')])}
      />,
    );

    expect(await textOf('4 Projets illisibles, absents de ces chiffres')).toBe(
      '4 Projets illisibles, absents de ces chiffres« beads-desktop » : Base Dolt verrouilléeUn Projet sans nom : verrou« My-Prompt-Manager » : Base Dolt absenteUn Projet sans nom : absente',
    );
  });

  it('un dossier qui s’appelle « Un Projet sans nom » ne se lit pas comme un Projet sans nom : son nom est entre guillemets', async () => {
    render(<UnreadableProjects projects={withProjectNames([entry('un', 'Un Projet sans nom', 'verrou'), entry('blanc', BLANK, 'verrou')])} />);

    expect(await textOf('2 Projets illisibles, absents de ces chiffres')).toBe('2 Projets illisibles, absents de ces chiffres« Un Projet sans nom » : verrouUn Projet sans nom : verrou');
  });
});

describe('l’avis des Projets illisibles, dans la Vue globale', () => {
  const project = (overrides: Partial<Project>): Project => ({ id: 'x', name: 'x', path: '/dev/x', prefix: '', mode: 'embedded', status: 'ok', ...overrides });

  it('un dossier qui s’appelle vraiment « Sans titre » et un Projet sans nom, tous deux illisibles : « Sans titre » entre guillemets, et « Un Projet sans nom »', async () => {
    const projects = [
      project({ id: 'bdesk', name: 'beads-desktop', prefix: 'bdesk' }),
      project({ id: 'st', name: 'Sans titre', path: '/dev/Sans titre', status: 'unreadable', reason: 'verrou' }),
      project({ id: 'blanc', name: BLANK, path: '/dev/blanc', status: 'unreadable', reason: 'verrou' }),
    ];
    stubMetricsApi({ projects: { projects, ignored: [] }, issues: { bdesk: bdeskIssues } }, () =>
      metricsOf([{ id: 'bdesk', name: 'beads-desktop' }], { unreadable: [entry('st', 'Sans titre', 'verrou'), entry('blanc', BLANK, 'verrou')] }),
    );
    renderApp('/');

    expect(await textOf('2 Projets illisibles, absents de ces chiffres')).toBe('2 Projets illisibles, absents de ces chiffres« Sans titre » : verrouUn Projet sans nom : verrou');
  });
});
