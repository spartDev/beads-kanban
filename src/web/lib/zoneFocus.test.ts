import { afterEach, describe, expect, it } from 'vitest';
import { focusTitleOf, focusTitleWhenReady, focusZoneOf, keepFocusIn, keepFocusInZone, showsSkeletonTitle, titleOf, zoneOf } from './zoneFocus';

/**
 * Où le focus revient quand ce qui le tenait disparaît parce que sa zone se recharge (bdesk-38k.40) : la zone la plus proche, le panneau d'un ticket
 * ou une région marquée, à défaut le contenu principal ; et le titre de la zone. Le DOM seul, sans React : `keepFocusIn` fait la ref que React
 * détache avant de retirer le nœud du document (voir `retryFocus.test.tsx` pour les pages).
 */

afterEach(() => {
  document.body.innerHTML = '';
});

const html = (markup: string) => {
  document.body.innerHTML = markup;
  return (selector: string) => document.querySelector<HTMLElement>(selector)!;
};

describe('zoneOf : la zone qui contient un élément', () => {
  it('le contenu principal, à défaut de mieux', () => {
    const $ = html('<main><div id="avis"></div></main>');
    expect(zoneOf($('#avis'))).toBe($('main'));
  });

  it('une région marquée comme zone de focus est plus proche que le contenu principal', () => {
    const $ = html('<main><section id="zone" data-focus-zone><div id="avis"></div></section></main>');
    expect(zoneOf($('#avis'))).toBe($('#zone'));
  });

  it('le panneau d’un ticket aussi, même posé dans le contenu principal', () => {
    const $ = html('<main><div id="panneau" data-issue-panel role="dialog"><div id="avis"></div></div></main>');
    expect(zoneOf($('#avis'))).toBe($('#panneau'));
  });

  it('le panneau d’un ticket est une zone par son marqueur, sans dépendre de son rôle de boîte de dialogue', () => {
    const $ = html('<main><div id="panneau" data-issue-panel><div id="avis"></div></div></main>');
    expect(zoneOf($('#avis'))).toBe($('#panneau'));
  });

  it('une région marquée comme zone de focus, dans une boîte de dialogue : la région, plus proche de l’avis que la boîte, l’emporte', () => {
    const $ = html('<main></main><div role="dialog"><section id="zone" data-focus-zone><div id="avis"></div></section></div>');
    expect(zoneOf($('#avis'))).toBe($('#zone'));
  });

  it('la plus proche l’emporte quand elles s’emboîtent', () => {
    const $ = html('<main><div id="dehors" data-focus-zone><div id="dedans" data-focus-zone><div id="avis"></div></div></div></main>');
    expect(zoneOf($('#avis'))).toBe($('#dedans'));
  });

  it('un élément hors du contenu principal et de toute zone (la barre latérale) a le contenu principal', () => {
    const $ = html('<nav><div id="avis"></div></nav><main></main>');
    expect(zoneOf($('#avis'))).toBe($('main'));
  });

  it('une boîte de dialogue (hors du contenu principal, dans un portail) est la zone de ce qu’elle contient : le focus ne sort pas d’une boîte modale', () => {
    const $ = html('<main></main><div id="boite" role="dialog"><div id="avis"></div></div><div id="alerte" role="alertdialog"><div id="avis2"></div></div>');
    expect(zoneOf($('#avis'))).toBe($('#boite'));
    expect(zoneOf($('#avis2'))).toBe($('#alerte'));
  });

  it('le contenu principal qui contient l’élément, plutôt qu’un autre de la page', () => {
    const $ = html('<main id="autre"></main><main id="proche"><div id="avis"></div></main>');
    expect(zoneOf($('#avis'))).toBe($('#proche'));
  });

  it('rien quand la page n’a ni zone ni contenu principal', () => {
    const $ = html('<div id="avis"></div>');
    expect(zoneOf($('#avis'))).toBeNull();
  });
});

describe('titleOf : le titre d’une zone', () => {
  it('son premier intertitre : le titre de la page (h1) ou celui d’une section (h2)', () => {
    const $ = html('<main><h1 id="page">Page</h1><section id="zone"><h2 id="section">Section</h2></section></main>');
    expect(titleOf($('main'))).toBe($('#page'));
    expect(titleOf($('#zone'))).toBe($('#section'));
  });

  it('aucun, quand la zone n’en a pas', () => {
    const $ = html('<main><p>Rien</p></main>');
    expect(titleOf($('main'))).toBeNull();
  });

  it('pas le titre d’un squelette (marqué data-skeleton) : la page qui le remplace aura le sien, et le focus tomberait sur le corps de la page quand il partirait', () => {
    const $ = html('<main><h1 id="squelette" data-skeleton><div></div></h1><section><h2 id="section">Section</h2></section></main>');
    expect(titleOf($('main'))).toBe($('#section'));
  });

  it('un squelette qui porte un texte pour les lecteurs d’écran (« Chargement… ») reste un squelette : le marqueur, pas le texte, le dit', () => {
    const $ = html('<main><h1 id="squelette" data-skeleton><span class="sr-only">Chargement…</span><div></div></h1></main>');
    expect(titleOf($('main'))).toBeNull();
    expect(showsSkeletonTitle($('main'))).toBe(true);
  });

  it('un titre sans marqueur est un titre, même vide', () => {
    const $ = html('<main><h1 id="page"></h1></main>');
    expect(titleOf($('main'))).toBe($('#page'));
    expect(showsSkeletonTitle($('main'))).toBe(false);
  });

  it('un squelette et un intertitre de section dans la même zone : la zone a encore le titre d’un squelette', () => {
    const $ = html('<main><h1 data-skeleton></h1><section><h2 id="section">Section</h2></section></main>');
    expect(showsSkeletonTitle($('main'))).toBe(true);
  });
});

describe('focusZoneOf et focusTitleOf', () => {
  it('donnent le focus à la zone, ou à son titre, sans jamais le rendre focalisable en permanence', () => {
    const $ = html(
      '<main><h1 id="titre">Page</h1><section id="zone" data-focus-zone><h2 id="intertitre">Section</h2><div id="avis"></div></section></main><button id="ailleurs">Ailleurs</button>',
    );

    expect(focusZoneOf($('#avis'))).toBe(true);
    expect(document.activeElement).toBe($('#zone'));
    expect($('#zone').getAttribute('tabindex')).toBe('-1');

    expect(focusTitleOf($('#avis'))).toBe(true);
    expect(document.activeElement).toBe($('#intertitre'));
    expect($('#zone').hasAttribute('tabindex')).toBe(false); // la zone l'a rendu en passant le focus au titre

    $('#ailleurs').focus();
    expect($('#intertitre').hasAttribute('tabindex')).toBe(false); // le titre non plus
  });

  it('focusTitleOf donne le focus à la zone quand elle n’a pas de titre', () => {
    const $ = html('<main><div id="avis"></div></main>');

    expect(focusTitleOf($('#avis'))).toBe(true);

    expect(document.activeElement).toBe($('main'));
  });

  it('focusTitleOf ne donne pas le focus au titre d’un squelette : la zone le garde', () => {
    const $ = html('<main><h1 id="squelette" data-skeleton></h1><div id="avis"></div></main>');

    expect(focusTitleOf($('#avis'))).toBe(true);

    expect(document.activeElement).toBe($('main'));
  });

  it('rien ne prend le focus sans zone : il reste où il est', () => {
    const $ = html('<button id="ailleurs">Ailleurs</button><div id="avis"></div>');
    $('#ailleurs').focus();

    expect(focusZoneOf($('#avis'))).toBe(false);
    expect(focusTitleOf($('#avis'))).toBe(false);

    expect(document.activeElement).toBe($('#ailleurs'));
  });
});

describe('keepFocusIn : le nœud qui part rend le focus qu’il tenait', () => {
  it('rien à faire pour le nœud nul : React n’a rien attaché', () => {
    expect(keepFocusInZone(null)).toBeUndefined();
  });

  it('le focus est dans le nœud (lui-même ou un descendant) : il passe à ce que `give` choisit', () => {
    const $ = html('<main><div id="avis"><button id="bouton">Réessayer</button></div></main>');
    const cleanup = keepFocusInZone($('#avis'));
    $('#bouton').focus();

    cleanup?.();

    expect(document.activeElement).toBe($('main'));
  });

  it('le focus est ailleurs : on n’y touche pas', () => {
    const $ = html('<main><div id="avis"><button id="bouton">Réessayer</button></div></main><button id="ailleurs">Ailleurs</button>');
    const cleanup = keepFocusInZone($('#avis'));
    $('#ailleurs').focus();

    cleanup?.();

    expect(document.activeElement).toBe($('#ailleurs'));
  });

  it('le focus est sur le corps de la page : on n’y touche pas non plus', () => {
    const $ = html('<main><div id="avis"><button id="bouton">Réessayer</button></div></main>');
    const cleanup = keepFocusInZone($('#avis'));
    expect(document.activeElement).toBe(document.body);

    cleanup?.();

    expect(document.activeElement).toBe(document.body);
  });

  it('une ref pour une autre règle : le nœud donne le focus à ce que `give` désigne', () => {
    const $ = html('<main><div id="avis"><button id="bouton">Réessayer</button></div><button id="cible">Cible</button></main>');
    const cleanup = keepFocusIn(() => {
      $('#cible').focus();
      return true;
    })($('#avis'));
    $('#bouton').focus();

    cleanup?.();

    expect(document.activeElement).toBe($('#cible'));
  });
});

describe('focusTitleWhenReady : le titre prend le focus de la zone, quand la page qui le porte est là', () => {
  const nextTask = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** La page chargée prend la place du squelette, d'un coup (comme React le fait : le nœud du squelette part). */
  const arrive = ($: (selector: string) => HTMLElement) => {
    $('#squelette').remove();
    $('main').insertAdjacentHTML('afterbegin', '<h1 id="titre">Epic</h1>');
  };
  const SKELETON_PAGE = '<main><h1 id="squelette" data-skeleton><span class="sr-only">Chargement…</span></h1></main><button id="ailleurs">Ailleurs</button>';

  it('la zone a un vrai titre : il prend le focus tout de suite', () => {
    const $ = html('<main><h1 id="titre">Page</h1></main>');
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();

    focusTitleWhenReady($('main'));

    expect(document.activeElement).toBe($('#titre'));
  });

  it('la zone n’a que le titre d’un squelette : il ne prend rien, la zone garde le focus ; le titre de la page qui arrive le prend', async () => {
    const $ = html(SKELETON_PAGE);
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();

    focusTitleWhenReady($('main'));
    await nextTask();
    expect(document.activeElement).toBe($('main')); // ni le squelette, ni le corps de la page

    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('#titre'));
  });

  it('un intertitre de section est déjà là, mais le titre de la page est un squelette : on attend le titre de la page, pas l’intertitre', async () => {
    const $ = html('<main><h1 id="squelette" data-skeleton></h1><section><h2 id="section">Section</h2></section></main>');
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();

    focusTitleWhenReady($('main'));
    await nextTask();
    expect(document.activeElement).toBe($('main'));

    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('#titre'));
  });

  it('l’utilisateur a mis le focus ailleurs pendant l’attente : la page qui arrive ne le reprend pas, et l’attente s’arrête', async () => {
    const $ = html(SKELETON_PAGE);
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();
    focusTitleWhenReady($('main'));
    $('#ailleurs').focus();

    $('main').insertAdjacentHTML('beforeend', '<p>Un changement de plus</p>');
    await nextTask();
    arrive($);
    $('#ailleurs').blur();
    $('main').focus(); // et la zone le reprend, plus tard : ce n'est plus ce réessai
    await nextTask();

    expect(document.activeElement).toBe($('main'));
  });

  it('la fonction rendue arrête l’attente : le titre de la page qui arrive ne prend rien', async () => {
    const $ = html(SKELETON_PAGE);
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();
    const stop = focusTitleWhenReady($('main'));

    stop();
    arrive($);
    await nextTask();

    expect(document.activeElement).toBe($('main'));
  });

  it('le squelette part sans titre à la place : la zone garde le focus', async () => {
    const $ = html(SKELETON_PAGE);
    $('main').setAttribute('tabindex', '-1');
    $('main').focus();
    focusTitleWhenReady($('main'));

    $('#squelette').remove();
    await nextTask();

    expect(document.activeElement).toBe($('main'));
  });
});
