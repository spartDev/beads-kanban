import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { SEPARATOR_TITLES } from '../test/blankTitles';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * La pastille d'Epic d'une carte du kanban (bdesk-38k.62) : ce qu'elle lit de l'Epic (son titre court, `shortTitle`), le nom qu'elle prend pour un lecteur d'écran
 * (« Epic : … ») et son infobulle (le titre entier, `epicName`). Les règles du titre court se jouent une à une dans `epics.test.ts` ; ici, l'application les montre sur la carte.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/** Ce que l'écran montre d'un texte : sans les caractères sans largeur (catégorie Unicode `Cf`). */
const visible = (text: string | null) => (text ?? '').replace(/\p{Cf}/gu, '');

/** Le tableau d'un Projet qui n'a qu'une Epic, au titre donné, et un Enfant : la pastille de la carte de l'Enfant. */
async function pillOf(title: string) {
  const epic = issue({ id: 'bdesk-e1', title, type: 'epic' });
  stubApi({ projects: projectsResponse, issues: { bdesk: [epic, issue({ id: 'bdesk-c1', title: 'Un Enfant', parentId: epic.id })] } });
  renderApp('/p/bdesk/kanban');
  await screen.findByRole('region', { name: 'Prêt' });
  const card = document.querySelector<HTMLElement>('li[data-card-id="bdesk-c1"]');
  if (!card) throw new Error('carte de « bdesk-c1 » introuvable');
  return within(card).getByRole('link', { name: /^Epic/ });
}

describe('la pastille d’Epic lit le titre court de l’Epic', () => {
  it.each([
    ['un intitulé suivi d’un séparateur', 'beads-desktop V1 : suivi des tickets et métriques de flux', 'beads-desktop V1'],
    ['un titre court, sans séparateur', 'Refonte du shell', 'Refonte du shell'],
    ['un long titre, coupé à la fin d’un mot', 'Drop Cursor support in CLI + auto-migrate existing workspaces', 'Drop Cursor support in…'],
    ['un séparateur qui ouvre le titre : il reste, sans lui le titre dirait autre chose', '– 5 °C ce matin', '– 5 °C ce matin'],
    ['un « : » qui ouvre le titre', ': Refonte du shell', ': Refonte du shell'],
    ['une tête de caractères sans largeur avant « : », lue comme une tête vide', '\u200b\u200b\u200b : Refonte du shell', ': Refonte du shell'],
    ['un emoji de famille que la coupe franchirait', 'A'.repeat(20) + '👨\u200d👩\u200d👧' + 'BBBB', 'A'.repeat(20) + '…'],
    ['un drapeau que la coupe franchirait', 'A'.repeat(21) + '🇫🇷' + 'BBBB', 'A'.repeat(21) + '…'],
    ['un « é » écrit en deux caractères que la coupe franchirait', 'A'.repeat(23) + 'e\u0301' + 'BBBB', 'A'.repeat(23) + '…'],
    ['un « é » écrit en deux caractères, que la coupe laisse passer : l’accent reste', 'A'.repeat(22) + 'e\u0301' + 'BBBB', 'A'.repeat(22) + 'e\u0301…'],
    ['un emoji de famille que la coupe laisse passer', 'A'.repeat(16) + '👨\u200d👩\u200d👧' + 'BBBB', 'A'.repeat(16) + '👨\u200d👩\u200d👧' + 'B…'],
    ['un titre qui n’est qu’un graphème plus long que la limite : rien n’est coupé, pas d’ellipse', 'x' + '\u0301'.repeat(40), 'x' + '\u0301'.repeat(40)],
    // Ce que la police ne dessine pas se retire des bords de la pastille, ce qu'elle dessine y reste : la règle des textes invisibles, non la catégorie `Cf` (bdesk-38k.70).
    ['un remplisseur hangul (U+3164) devant le nom', '\u3164Kanban', 'Kanban'],
    ['une demi-chasse hangul (U+FFA0) derrière le nom', 'Kanban\uffa0', 'Kanban'],
    ['des blancs braille (U+2800) devant un intitulé suivi d’un séparateur', '\u2800\u2800\u2800 : Refonte du shell', ': Refonte du shell'],
    ['une marque arabe qui se dessine (U+06DD) devant le nom', '\u06ddKanban', '\u06ddKanban'],
    ['un signe d’alerte en couleurs : son sélecteur de variante (U+FE0F) fait corps avec lui', 'Alerte ⚠\ufe0f', 'Alerte ⚠\ufe0f'],
    // La tête d'un titre à séparateur : elle perd les sélecteurs qu'une espace sépare de ce qui précède, avec cette espace, et rien d'autre (bdesk-38k.70, revue finale : B3 et R2).
    ['une espace et un sélecteur de variante (U+FE0F) qui finissent la tête : ni l’un ni l’autre n’est montré', 'Alerte ⚠ \ufe0f : suite du titre', 'Alerte ⚠'],
    ['une espace et la marque droite-gauche (U+200F) derrière un mot hébreu : elle reste, le « ! » ne change pas de côté', 'שלום! \u200f : המשך', 'שלום! \u200f'],
    ['« V1 », une espace et U+200B : la tête se mesure telle qu’elle est écrite, elle passe le seuil de trois', 'V1 \u200b : suite', 'V1 \u200b'],
  ])('pour %s', async (_kind, title, short) => {
    const pill = await pillOf(title);

    expect(pill.textContent).toBe(`Epic : ${short}`);
    expect(screen.getByRole('link', { name: `Epic : ${short}` })).toBe(pill);
  });

  // Le même titre en forme composée (NFC) ou décomposée (NFD, un copier-coller depuis macOS) se lit pareil et se coupe pareil ; la pastille montre les caractères du titre, dans la forme où ils sont écrits.
  it.each(['NFC', 'NFD'] as const)('coupe un titre écrit en %s là où l’autre forme : « Écran réactivé après… »', async (form) => {
    const pill = await pillOf('Écran réactivé après la mise à jour du thème'.normalize(form));

    expect(pill.textContent).toBe(`Epic : ${'Écran réactivé après…'.normalize(form)}`);
  });

  it('range deux espaces que sépare un caractère sans largeur en une seule, pour la pastille comme pour l’infobulle', async () => {
    const pill = await pillOf('Refonte\u200b \u200b du shell');

    expect(visible(pill.textContent)).toBe('Epic : Refonte du shell');
    expect(visible(pill.getAttribute('title'))).toBe('Refonte du shell');
  });

  it('garde en infobulle le titre entier de l’Epic, dont la pastille n’est que le début', async () => {
    const pill = await pillOf('\u200bRefonte du shell : thèmes et navigation');

    expect(pill.textContent).toBe('Epic : Refonte du shell');
    expect(visible(pill.getAttribute('title'))).toBe('Refonte du shell : thèmes et navigation');
  });
});

// Le nom d'une Epic est dérivé de son titre : sans rien d'autre que des séparateurs (ou des blancs, des caractères sans largeur) il n'y a pas d'intitulé à lire, et l'identifiant la nomme.
describe('la pastille d’une Epic dont le titre ne dit rien', () => {
  it.each<readonly [string, string]>([
    ['vide', ''],
    ['fait d’une espace sans largeur', '\u200b'],
    ...SEPARATOR_TITLES,
  ])('est nommée de l’identifiant de l’Epic quand son titre est %s', async (_kind, title) => {
    const pill = await pillOf(title);

    expect(pill.textContent).toBe('Epic : bdesk-e1');
    expect(pill.getAttribute('title')).toBe('bdesk-e1');
  });
});
