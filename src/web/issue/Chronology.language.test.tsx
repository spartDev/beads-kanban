import { screen } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { bdeskIssues, projectsResponse } from '../test/fixtures';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { setBrowserLanguages } from '../test/languages';
import { renderApp, stubApi } from '../test/render';

/**
 * bdesk-ewr.6 : la chronologie indisponible écrit le détail de son erreur dans la langue affichée, par son code (`errorText`), jamais le message
 * français du serveur. Un 400 : l'interface ne le réessaie pas.
 */
// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

describe('Chronologie indisponible : le détail de l’erreur dans la langue affichée', () => {
  const failure = {
    status: 400,
    body: { statusCode: 400, error: 'Bad Request', message: 'message du serveur', code: 'unexpected', params: {} },
  };

  it('en anglais quand l’interface l’est', async () => {
    setBrowserLanguages(['en-US']);
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues }, chronologies: { 'bdesk/bdesk-38k.6': failure } });
    renderApp('/p/bdesk/t/bdesk-38k.6', { languageSwitch: true });

    expect(await screen.findByText('Unexpected error.')).toBeTruthy();
    expect(screen.queryByText('message du serveur')).toBeNull();
  });

  it('en français : la phrase du catalogue, pas le message du serveur', async () => {
    stubApi({ projects: projectsResponse, issues: { bdesk: bdeskIssues }, chronologies: { 'bdesk/bdesk-38k.6': failure } });
    renderApp('/p/bdesk/t/bdesk-38k.6', { languageSwitch: true });

    expect(await screen.findByText('Erreur inattendue.')).toBeTruthy();
    expect(screen.queryByText('message du serveur')).toBeNull();
  });
});
