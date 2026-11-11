import { screen, within } from '@testing-library/react';
import { describe, expect, it } from 'vitest';
import { withAsyncTimeout } from '../test/asyncTimeout';
import { issue, projectsResponse } from '../test/fixtures';
import { renderApp, stubApi } from '../test/render';

/**
 * Le filtre Epic et la pastille d'Epic du kanban devant un titre qui porte un caractère qu'on ne voit pas, ou un que la catégorie `Cf` disait invisible (bdesk-38k.70). Les deux lisent le titre par
 * la règle des textes invisibles (`isInvisibleText`) : un remplisseur hangul (U+3164) ne se dessine pas, U+06DD se dessine. Les règles se jouent une à une dans `epics.test.ts` ; ici, l'application
 * les montre : les options du filtre, et la pastille de la carte d'un Enfant.
 */

// Monter toute l'application prend plus d'une seconde quand la machine est chargée : voir `withAsyncTimeout`.
withAsyncTimeout(5_000);

/** Un Projet dont les Epics portent ces titres (la première la plus récente, donc la première du filtre), et un Enfant de la première. */
async function openBoard(titles: string[]) {
  const epics = titles.map((title, index) =>
    issue({ id: `bdesk-e${index + 1}`, title, type: 'epic', updatedAt: `2026-10-${String(20 - index).padStart(2, '0')}T09:00:00Z` }),
  );
  stubApi({ projects: projectsResponse, issues: { bdesk: [...epics, issue({ id: 'bdesk-c1', title: 'Un Enfant', parentId: 'bdesk-e1' })] } });
  renderApp('/p/bdesk/kanban');
  await screen.findByRole('region', { name: 'Prêt' });
}

/** Le libellé de chaque option du filtre Epic, dans l'ordre où il les liste. */
const optionLabels = () => [...(screen.getByRole('combobox', { name: 'Epic' }) as HTMLSelectElement).options].map((option) => option.textContent);

/** La pastille d'Epic de la carte de l'Enfant. */
const pillOfChild = () => {
  const card = document.querySelector<HTMLElement>('li[data-card-id="bdesk-c1"]');
  if (!card) throw new Error('carte de « bdesk-c1 » introuvable');
  return within(card).getByRole('link', { name: /^Epic/ });
};

describe('le filtre Epic lit les titres par la règle des textes invisibles', () => {
  it('porte l’identifiant de « U+3164 Kanban » et de « Kanban » : elles ne diffèrent que par un remplisseur hangul, que la police ne dessine pas', async () => {
    await openBoard(['\u3164Kanban', 'Kanban']);

    expect(optionLabels()).toEqual(['Toutes les Epics', '\u3164Kanban (bdesk-e1)', 'Kanban (bdesk-e2)']);
  });

  // « U+FFF9 Kanban » et « Kanban » se lisent pareil à l'écran (Chromium ne dessine pas l'ancre d'annotation) : sans identifiant, deux options identiques ne se choisissent pas. La règle commune gardait ces trois
  // caractères comme des signes qui se dessinent, comme elle gardait U+3164 avant bdesk-38k.70 (bdesk-38k.77).
  it('porte l’identifiant de « U+FFF9 Kanban » et de « Kanban » : elles ne diffèrent que par une ancre d’annotation, que Chromium ne dessine pas', async () => {
    await openBoard(['\ufff9Kanban', 'Kanban']);

    expect(optionLabels()).toEqual(['Toutes les Epics', '\ufff9Kanban (bdesk-e1)', 'Kanban (bdesk-e2)']);
  });
  it('porte l’identifiant d’une Epic qui ne diffère de l’autre que par un blanc braille (U+2800) ou un joint de graphèmes (U+034F)', async () => {
    await openBoard(['Kan\u2800ban', 'Kan\u034fban', 'Kanban']);

    expect(optionLabels()).toEqual(['Toutes les Epics', 'Kan\u2800ban (bdesk-e1)', 'Kan\u034fban (bdesk-e2)', 'Kanban (bdesk-e3)']);
  });

  it('ne porte aucun identifiant pour « U+06DD Kanban » et « Kanban » : U+06DD se dessine, les deux options se lisent différemment', async () => {
    await openBoard(['\u06ddKanban', 'Kanban']);

    expect(optionLabels()).toEqual(['Toutes les Epics', '\u06ddKanban', 'Kanban']);
  });

  it('ne porte aucun identifiant pour un signe d’alerte en couleurs (U+26A0 puis U+FE0F) et le signe noir : le sélecteur de variante fait corps avec le signe', async () => {
    await openBoard(['Alerte ⚠\ufe0f', 'Alerte ⚠']);

    expect(optionLabels()).toEqual(['Toutes les Epics', 'Alerte ⚠\ufe0f', 'Alerte ⚠']);
  });

  // « Alerte ⚠ », une espace et U+FE0F : le signe reste noir, le sélecteur suit une espace. « Alerte ⚠ » suivi de U+FE0F est le signe en couleurs. Deux options qui se lisent différemment, sans identifiant, et l'option garde
  // son espace : le libellé la perdait en bout de titre, le sélecteur se collait au signe, et le filtre tenait les deux Epics pour la même (bdesk-38k.70, revue B1).
  it('ne porte aucun identifiant pour « Alerte ⚠ », une espace et un sélecteur de variante, et le signe en couleurs : l’option garde son espace, donc le signe noir', async () => {
    await openBoard(['Alerte ⚠ \ufe0f', 'Alerte ⚠\ufe0f']);

    expect(optionLabels()).toEqual(['Toutes les Epics', 'Alerte ⚠ \ufe0f', 'Alerte ⚠\ufe0f']);
  });

  // B2 : « A », une lettre mongole, son sélecteur, une espace et un deuxième sélecteur. L'option garde l'espace : sans elle le deuxième sélecteur se collerait au premier, et Chromium dessinerait après la lettre une
  // boîte pointillée numérotée que le titre écrit ne montre pas (bdesk-38k.70, revue finale).
  it('garde l’espace de l’option d’une Epic dont le titre finit par une lettre mongole et deux sélecteurs : le deuxième ne se colle pas au premier', async () => {
    await openBoard(['A \u1824\u180b \u180c', 'Autre']);

    expect(optionLabels()[1]).toBe('A \u1824\u180b \u180c');
  });

  // B4 : une espace, un sélecteur de variante seul, un liant, une espace, deux lettres mongoles : l'espace derrière le liant ne tombe pas, la première lettre ne prend pas sa forme liée.
  it('garde l’espace derrière un liant qui suit un sélecteur de variante seul : le liant ne se colle pas à la lettre qui suit', async () => {
    await openBoard(['Tache \ufe0f\u200d \u1824\u1824', 'Autre']);

    expect(optionLabels()[1]).toBe('Tache \ufe0f\u200d \u1824\u1824');
  });
});

describe('la pastille d’Epic de la carte d’un Enfant lit le titre de l’Epic par la même règle', () => {
  it('dit « Alerte ⚠ », le signe noir, pour un titre qui finit par une espace et un sélecteur de variante : comme son option du filtre', async () => {
    await openBoard(['Alerte ⚠ \ufe0f', 'Autre']);

    expect(pillOfChild().textContent).toBe('Epic : Alerte ⚠');
    expect(optionLabels()[1]).toBe('Alerte ⚠ \ufe0f');
  });

  it('dit la lettre mongole et son premier sélecteur : la pastille rogne l’espace et le deuxième sélecteur, qui ne tiennent à rien', async () => {
    await openBoard(['A \u1824\u180b \u180c', 'Autre']);

    expect(pillOfChild().textContent).toBe('Epic : A \u1824\u180b');
  });

  it('ne montre pas le remplisseur hangul (U+3164) qui précède « Kanban »', async () => {
    await openBoard(['\u3164Kanban', 'Autre']);

    const pill = pillOfChild();
    expect(pill.textContent).toBe('Epic : Kanban');
    expect(screen.getByRole('link', { name: 'Epic : Kanban' })).toBe(pill);
  });

  it('ne montre pas l’ancre d’annotation (U+FFF9) qui précède « Kanban » : Chromium n’en dessine rien, mais lui laissait un retrait de 7 px', async () => {
    await openBoard(['\ufff9Kanban', 'Autre']);

    const pill = pillOfChild();
    expect(pill.textContent).toBe('Epic : Kanban');
    expect(screen.getByRole('link', { name: 'Epic : Kanban' })).toBe(pill);
  });
  it('garde U+06DD, qui se dessine, devant « Kanban »', async () => {
    await openBoard(['\u06ddKanban', 'Autre']);

    expect(pillOfChild().textContent).toBe('Epic : \u06ddKanban');
  });
});
