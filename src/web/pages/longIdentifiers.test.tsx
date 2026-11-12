import { screen, waitFor, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import type { Issue, Project } from '../data/types';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/**
 * Un Projet dont le dossier a un nom de 255 caractères, et des tickets aux identifiants de 255 caractères (bdesk-38k.88) : l'adresse de l'application et celles de l'API gardent les
 * identifiants entiers, ASCII ou non. Aucune limite de longueur côté interface : c'est le serveur qui refusait au-delà de 100 caractères (`MAX_PARAM_LENGTH`, src/server/server.ts).
 * Les identifiants de Projet sont des slugs (ASCII) ; ceux de tickets peuvent ne pas l'être, et s'écrivent alors en pourcentages dans l'adresse.
 */
const PROJECT_ID = `${'dossier-au-nom-tres-long-'.repeat(11)}x`.slice(0, 255);
const PROJECT: Project = { id: PROJECT_ID, name: PROJECT_ID, path: `/Users/someone/Developer/${PROJECT_ID}`, prefix: 'bdesk', mode: 'embedded', status: 'ok' };

const EPIC_ID = `${'q'.repeat(240)}-38k`;
const ASCII_ID = `${EPIC_ID}.7`;
const ACCENTED_ID = `é${'à'.repeat(253)}ü`; // 255 caractères, 6 par caractère dans l'adresse
const EMOJI_ID = '😀'.repeat(255); // 510 unités UTF-16, 12 caractères par émoji dans l'adresse

const TICKETS: Issue[] = [
  issue({ id: EPIC_ID, title: 'Une Epic au long identifiant', type: 'epic' }),
  issue({ id: ASCII_ID, title: 'Ticket ASCII', parentId: EPIC_ID }),
  issue({ id: ACCENTED_ID, title: 'Ticket accentué', parentId: EPIC_ID }),
  issue({ id: EMOJI_ID, title: 'Ticket émoji', parentId: EPIC_ID }),
];

const stub = () => stubApi({ projects: { projects: [PROJECT], ignored: [] }, issues: { [PROJECT_ID]: TICKETS } });
const requested = (fetchMock: ReturnType<typeof stubApi>) => fetchMock.mock.calls.map(([input]) => String(input));
const enc = encodeURIComponent;

describe('un Projet et des tickets aux identifiants de 255 caractères (bdesk-38k.88)', () => {
  it('le kanban demande les tickets sous l’identifiant entier du Projet, et chaque carte est un lien qui le garde, avec celui du ticket', async () => {
    const fetchMock = stub();
    renderApp(`/p/${PROJECT_ID}/kanban`);

    const board = await screen.findByRole('region', { name: 'Prêt' });

    expect(requested(fetchMock)).toContain(`/api/projects/${PROJECT_ID}/issues`);
    const hrefs = within(board).getAllByRole('link').map((link) => link.getAttribute('href'));
    expect(hrefs).toEqual(expect.arrayContaining([`/p/${PROJECT_ID}/t/${ASCII_ID}`, `/p/${PROJECT_ID}/t/${enc(ACCENTED_ID)}`, `/p/${PROJECT_ID}/t/${enc(EMOJI_ID)}`]));
  });

  it.each([
    ['ASCII', ASCII_ID, 'Ticket ASCII'],
    ['accentué (6 caractères par lettre dans l’adresse)', ACCENTED_ID, 'Ticket accentué'],
    ['émoji (12 caractères par émoji dans l’adresse)', EMOJI_ID, 'Ticket émoji'],
  ])('une carte ouvre le panneau d’un ticket %s : l’adresse l’écrit, la fiche et la Chronologie le demandent entier', async (_kind, issueId, title) => {
    const fetchMock = stub();
    const { user, router } = renderApp(`/p/${PROJECT_ID}/kanban`);
    const board = await screen.findByRole('region', { name: 'Prêt' });

    await user.click(within(board).getByRole('link', { name: title }));

    const dialog = await screen.findByRole('dialog', { name: new RegExp(title) });
    expect(within(dialog).getByRole('heading', { level: 2, name: new RegExp(title) })).toBeTruthy();
    expect(router.state.location.pathname).toBe(`/p/${PROJECT_ID}/t/${enc(issueId)}`);
    await waitFor(() => expect(requested(fetchMock)).toContain(`/api/projects/${PROJECT_ID}/issues/${enc(issueId)}/chronology`));
    expect(requested(fetchMock)).toContain(`/api/projects/${PROJECT_ID}/issues/${enc(issueId)}`);
  });

  it('le panneau s’ouvre aussi par son adresse (rechargement de la page), identifiants lus à l’identique', async () => {
    const fetchMock = stub();
    renderApp(`/p/${PROJECT_ID}/t/${enc(ACCENTED_ID)}`);

    await screen.findByRole('dialog', { name: /Ticket accentué/ });

    expect(requested(fetchMock)).toContain(`/api/projects/${PROJECT_ID}/issues/${enc(ACCENTED_ID)}`);
  });

  it('la page Epics ouvre l’Epic de 255 caractères : sa page, ses Enfants, et le retour à la liste', async () => {
    const fetchMock = stub();
    renderApp(`/p/${PROJECT_ID}/epics?epic=${enc(EPIC_ID)}`);

    expect(await screen.findByRole('heading', { level: 1, name: 'Une Epic au long identifiant' })).toBeTruthy();

    expect(requested(fetchMock)).toContain(`/api/projects/${PROJECT_ID}/issues`);
    // Le lien de retour à la liste, et l'onglet de la barre latérale : l'un et l'autre portent l'identifiant entier.
    const hrefs = screen.getAllByRole('link', { name: /Epics/ }).map((link) => link.getAttribute('href'));
    expect(hrefs).toContain(`/p/${PROJECT_ID}/epics`);
  });

  it('la page Métriques demande le Projet par son identifiant entier, dans la requête', async () => {
    const fetchMock = stub();
    renderApp(`/p/${PROJECT_ID}/metrics`);

    await screen.findByRole('heading', { level: 1, name: 'Métriques' });

    await waitFor(() => expect(requested(fetchMock).some((url) => url.startsWith('/api/metrics') && new URL(url, 'http://localhost').searchParams.get('project') === PROJECT_ID)).toBe(true));
  });
});
