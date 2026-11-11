import { screen, waitFor, within } from '@testing-library/react';
import { afterEach, describe, expect, it, vi } from 'vitest';
import type { Project } from '../data/types';
import { stubMetricsApi, warmUpMetricsPages } from '../metrics/testing';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { bdeskIssues } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Les phrases qui nomment le Projet (bdesk-38k.73). Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » (bdesk-38k.65), et « Les tickets de Sans titre, en colonnes… » se lit
 * comme les tickets d'un Projet qui s'appellerait ainsi. Après « de » ou « dans », une phrase dit « ce Projet » quand le nom est un repli, comme le kanban le disait déjà (« Aucune Epic « x » dans ce
 * Projet »). Les Projets dont le nom se voit gardent leurs phrases, mot pour mot : les attendus sont écrits en dur, relevés sur HEAD (173b090). Un dossier qui s'appelle vraiment « Sans titre » a un nom
 * qui se voit : ses phrases le disent, comme avant.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée ; la vue des métriques est un morceau chargé à la demande : voir `warmUpMetricsPages`.
warmUpMetricsPages();
withAsyncTimeout(5_000);

afterEach(() => {
  vi.unstubAllGlobals();
});

const readable = (overrides: Partial<Project>): Project => ({
  id: 'blanc',
  name: 'beads-desktop',
  path: '/dev/blanc',
  prefix: 'bd',
  mode: 'embedded',
  status: 'ok',
  ...overrides,
});
/** Un Projet lisible dont le dossier n'a pas de nom qu'on voie, tel que les données le donnent à l'interface (`useProjects`) : le serveur envoie le nom blanc, l'interface l'écrit « Sans titre ». */
const blank = (name = '\u3164') => readable({ name });
const normal = readable({ name: 'beads-desktop' });
/** Un dossier qui s'appelle vraiment « Sans titre » : un nom qui se voit. */
const named = readable({ name: 'Sans titre' });

/** Le faux serveur d'un Projet `blanc`, dont les métriques ne répondent jamais : la page montre sa phrase et son squelette. */
function open(path: string, subject: Project) {
  stubMetricsApi({ projects: { projects: [subject], ignored: [] }, issues: { blanc: bdeskIssues } }, () => new Promise(() => undefined));
  return renderApp(path);
}

const SENTENCES = [
  ['le kanban', '/p/blanc/kanban', (name: string) => `Les tickets de ${name}, en colonnes, en lecture seule.`],
  ['les Epics', '/p/blanc/epics', (name: string) => `L’avancement de chaque Epic de ${name} : les Livraisons parmi ses Enfants.`],
  ['les métriques', '/p/blanc/metrics', (name: string) => `Le flux de livraison de ${name}, mesuré depuis l’historique Dolt, comparé à la période précédente.`],
] as const;

describe('la phrase sous le titre de la page d’un Projet dont le nom ne se voit pas', () => {
  it.each(SENTENCES)('%s : dit « ce Projet », non « Sans titre »', async (_page, path, sentence) => {
    open(path, blank());

    expect(await screen.findByText(sentence('ce Projet'))).toBeTruthy();
    expect(screen.queryByText(/de Sans titre/)).toBeNull();
  });
});

describe('la phrase sous le titre de la page d’un Projet dont le nom se voit', () => {
  it.each(SENTENCES)('%s : garde le nom du Projet, mot pour mot', async (_page, path, sentence) => {
    open(path, normal);

    expect(await screen.findByText(sentence('beads-desktop'))).toBeTruthy();
  });

  it.each(SENTENCES)('%s : garde « Sans titre » à un dossier qui s’appelle vraiment ainsi', async (_page, path, sentence) => {
    open(path, named);

    expect(await screen.findByText(sentence('Sans titre'))).toBeTruthy();
  });

  // `findByText` rogne les blancs de bord et replie les autres : on lit le texte brut du paragraphe, sous le titre (HTML replie les blancs à l'écran, le texte les garde).
  it.each(SENTENCES)('%s : garde ses blancs de bord à un nom qui en a', async (_page, path, sentence) => {
    open(path, readable({ name: ' lead' }));

    await waitFor(() => expect(document.querySelector('main h1 + p')?.textContent).toBe(sentence(' lead')));
  });
});

describe('l’avis « introuvable » d’une Epic ou d’un ticket', () => {
  const NOT_FOUND = [
    ['une Epic', '/p/blanc/epics?epic=nope-1', (name: string) => `Aucune Epic « nope-1 » dans ${name}`],
    ['un ticket', '/p/blanc/t/nope-1', (name: string) => `Aucun ticket « nope-1 » dans ${name}`],
  ] as const;

  it.each(NOT_FOUND)('%s : dit « dans ce Projet » quand le nom du Projet ne se voit pas', async (_what, path, title) => {
    open(path, blank());

    expect(await screen.findByRole('status', { name: title('ce Projet') })).toBeTruthy();
  });

  it.each(NOT_FOUND)('%s : garde le nom du Projet quand il se voit', async (_what, path, title) => {
    open(path, normal);

    expect(await screen.findByRole('status', { name: title('beads-desktop') })).toBeTruthy();
  });

  it.each(NOT_FOUND)('%s : garde « Sans titre » à un dossier qui s’appelle vraiment ainsi', async (_what, path, title) => {
    open(path, named);

    expect(await screen.findByRole('status', { name: title('Sans titre') })).toBeTruthy();
  });
});

describe('l’alerte de la palette quand les tickets d’un Projet sont indisponibles', () => {
  async function failing(projects: Project[]) {
    stubApi({
      projects: { projects, ignored: [] },
      issues: Object.fromEntries(projects.map((subject) => [subject.id, new Error('database is locked')])),
    });
    const app = renderApp('/');
    await screen.findByRole('navigation', { name: 'Navigation principale' });
    await app.user.keyboard('{Control>}k{/Control}');
    const dialog = await screen.findByRole('dialog', { name: 'Palette de commandes' });
    return within(dialog).findByRole('alert');
  }

  it('écrit les noms qui se voient, séparés par une virgule : comme avant', async () => {
    const alert = await failing([normal, readable({ id: 'mpm', name: 'My-Prompt-Manager', prefix: 'mpm' })]);

    expect(alert.textContent).toBe('Tickets indisponibles : beads-desktop, My-Prompt-Manager.');
  });

  it('dit « un Projet sans nom » d’un Projet dont le nom ne se voit pas, non « Sans titre » qui se lirait comme son nom', async () => {
    const alert = await failing([blank()]);

    expect(alert.textContent).toBe('Tickets indisponibles : un Projet sans nom.');
  });

  it('compte les Projets sans nom, après les autres', async () => {
    const alert = await failing([blank('\u3164'), readable({ id: 'mpm', name: 'My-Prompt-Manager', prefix: 'mpm' }), readable({ id: 'autre', name: '\u200b' })]);

    expect(alert.textContent).toBe('Tickets indisponibles : « My-Prompt-Manager », 2 Projets sans nom.');
  });

  // Relecture : avec un dossier qui s'appelle vraiment « Sans titre », l'alerte disait « …, Sans titre, 3 Projets sans titre. », quatre Projets sans titre pour qui la lit. Les noms sont entre guillemets quand la liste
  // compte des Projets sans nom : « Sans titre » y est un nom, et « 3 Projets sans nom » ce qui n'en a pas.
  it('ne confond pas un dossier qui s’appelle vraiment « Sans titre » avec les Projets sans nom : les noms sont entre guillemets', async () => {
    const alert = await failing([readable({ id: 'bdesk', name: 'beads-desktop', prefix: 'bdesk' }), readable({ id: 'sans-titre', name: 'Sans titre', prefix: 'st' }), blank('\u3164'), readable({ id: 'autre', name: '\u200b' }), readable({ id: 'encore', name: ' ' })]);

    expect(alert.textContent).toBe('Tickets indisponibles : « beads-desktop », « Sans titre », 3 Projets sans nom.');
  });

  it('garde « Sans titre » à un dossier qui s’appelle vraiment ainsi', async () => {
    const alert = await failing([named]);

    expect(alert.textContent).toBe('Tickets indisponibles : Sans titre.');
  });
});
