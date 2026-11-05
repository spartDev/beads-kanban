import { afterEach, describe, expect, it, vi } from 'vitest';
import { focusTitleOf, focusTitleWhenReady, focusZoneOf, keepFocusIn, keepFocusInContent, keepFocusInZone, showsSkeletonTitle, titleOf, zoneOf } from './zoneFocus';

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

/**
 * Dans quel ordre le navigateur exécute les deux micro-tâches du retrait : la vérification qu'un `focusout` met en file (Chromium l'envoie au retrait), et l'observateur
 * de mutations, mis en file à la première mutation du tour. Quand le retrait est la première mutation du tour, la vérification passe avant ; quand une autre
 * mutation le précède dans le même tour (React en fait plusieurs par commit), l'observateur passe avant. La règle tient dans les deux ordres.
 */
describe.each([
  ['le retrait est la première mutation du tour : la vérification du `focusout` passe avant l’observateur', true],
  ['une mutation précède le retrait dans le même tour : l’observateur passe avant la vérification du `focusout`', false],
] as const)('keepFocusInContent : ce qui part du contenu d’un nœud qui reste rend le focus qu’il tenait (bdesk-38k.46) : %s', (_order, firstMutation) => {
  /** Laisse passer les micro-tâches (l'observateur de mutations, la vérification d'un `focusout`) et les minuteries de 0 ms. */
  const settle = () => new Promise<void>((resolve) => setTimeout(resolve, 0));

  /** Le contenu d'un état stable (`#contenu`) dans la zone d'un panneau : des liens à plat et dans un groupe, un bouton ailleurs dans la zone, un autre hors d'elle. */
  const PAGE =
    '<main><div id="zone" data-issue-panel><button id="fermer">Fermer</button><div id="contenu"><p id="texte">Texte</p><a id="un" href="#un">Un</a><div id="groupe"><a id="deux" href="#deux">Deux</a><a id="trois" href="#trois">Trois</a></div></div></div></main><button id="ailleurs">Ailleurs</button>';

  /**
   * La page, avec la ref posée sur le contenu : `give` donne le focus à la zone, et dit combien de fois on le lui a demandé. Écrire la page est une mutation
   * (jsdom y met en file l'observateur de mutations, comme tout document qui en a un) : tant qu'on ne laisse pas passer le tour, c'est elle la première du tour.
   */
  async function mount() {
    const $ = html(PAGE);
    const give = vi.fn((from: Element) => focusZoneOf(from));
    const detach = keepFocusInContent(give)($('#contenu'));
    if (firstMutation) await settle();
    return { $, give, detach };
  }

  it('rien à faire pour le nœud nul : React n’a rien attaché', () => {
    expect(keepFocusInContent(focusZoneOf)(null)).toBeUndefined();
  });

  it('l’élément qui a le focus est retiré, le nœud reste : le focus passe à la zone, pas au corps de la page', async () => {
    const { $, give } = await mount();
    $('#un').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('son parent est retiré (le sous-arbre part d’un coup) : de même', async () => {
    const { $, give } = await mount();
    $('#deux').focus();

    $('#groupe').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('remplacé par un autre (le contenu est écrit de nouveau) : le focus n’est pas sur le nouveau, il passe à la zone', async () => {
    const { $ } = await mount();
    $('#deux').focus();

    $('#groupe').replaceChildren(Object.assign(document.createElement('a'), { id: 'neuf', href: '#neuf', textContent: 'Neuf' }));
    await settle();

    expect(document.activeElement).toBe($('#zone'));
  });

  it('le focus a passé d’un lien à l’autre (Tab) : c’est celui qui l’a maintenant qui, retiré, le rend', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#deux').focus();

    $('#deux').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('le focus a passé d’un lien à l’autre, puis le premier est retiré : le second le garde', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#deux').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#deux'));
    expect(give).not.toHaveBeenCalled();
  });

  it('le focus est ailleurs dans la zone (le bouton « Fermer ») : ce qui part du contenu ne le lui prend pas', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#fermer').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#fermer'));
    expect(give).not.toHaveBeenCalled();
  });

  it('le focus est hors de la zone (un lien de la barre latérale, une carte du tableau) : de même', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#ailleurs').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#ailleurs'));
    expect(give).not.toHaveBeenCalled();
  });

  it('l’utilisateur a mis le focus sur le corps de la page (un clic dans le vide), puis l’élément part : le corps de la page le garde', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#un').blur(); // un clic dans le vide : le lien perd le focus, rien ne le prend
    await settle();
    expect(document.activeElement).toBe(document.body);

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  it('rien n’avait le focus dans le contenu : ce qui part n’en rend aucun', async () => {
    const { $, give } = await mount();

    $('#groupe').remove();
    $('#texte').remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  it('un élément déplacé (retiré puis réinséré dans le même tour) n’est pas un élément retiré : la règle ne le reprend pas', async () => {
    const { $, give } = await mount();
    $('#un').focus();

    $('#contenu').append($('#un')); // le navigateur lui retire le focus : il est toujours dans le document
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  /*
   * Un élément retenu qui perd le focus SANS `focusout` et reste dans le document n'a plus rien à rendre : le corps de la page a le focus, et le retrait de cet élément, plus tard,
   * ne doit pas le lui prendre. C'est un élément déplacé sous Firefox 137 et WebKit 18.2, qui ne disent rien (Chromium 156 envoie `blur` et `focusout`) : jsdom non plus.
   */
  it('l’élément retenu perd le focus sans `focusout` (déplacé : Firefox, Safari et jsdom n’envoient rien), puis il part : le corps de la page, qui a le focus depuis, le garde', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#contenu').append($('#un')); // déplacé : le focus est perdu sans un événement, l'élément est toujours dans le document
    await settle(); // un autre commit passe : l'observateur a vu l'élément déplacé
    expect(document.activeElement).toBe(document.body);

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  it('déplacé hors du contenu, puis retiré : un autre changement du contenu, plus tard, ne reprend pas le focus du corps de la page', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#zone').append($('#un')); // hors du contenu veillé, toujours dans la zone : le focus est perdu sans un événement
    await settle();
    $('#un').remove(); // le contenu veillé ne voit pas ce retrait ...
    $('#texte').remove(); // ... mais le changement qui suit est vu
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  it('un autre élément du contenu change pendant que le lien garde le focus : il reste retenu, et son retrait rend le focus à la zone', async () => {
    const { $, give } = await mount();
    $('#un').focus();

    $('#texte').remove(); // un commit qui ne touche pas à l'élément qui a le focus
    await settle();
    expect(document.activeElement).toBe($('#un'));
    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('la fenêtre est au second plan (le lien reste l’élément actif du document) pendant qu’un commit ne le retire pas : le commit suivant, qui le retire, rend le focus à la zone', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#un').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // la fenêtre passe au second plan : le document garde son élément actif
    await settle();

    $('#texte').remove(); // un commit que personne ne voit, qui ne touche pas au lien
    await settle();
    expect(document.activeElement).toBe($('#un'));
    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('Chromium envoie `blur` et `focusout` au retrait, l’élément encore dans le document et le corps de la page déjà actif : le retrait est reconnu, le focus passe à la zone', async () => {
    const { $, give } = await mount();
    $('#un').focus();

    $('#un').blur(); // ce que le navigateur envoie en retirant l'élément qui a le focus (comme à un clic dans le vide) ...
    $('#un').remove(); // ... puis il le retire, dans le même tour
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('la fenêtre perd le focus (un `focusout` sans que le focus du document change), puis l’élément part : le focus du document passe à la zone', async () => {
    const { $, give } = await mount();
    $('#un').focus();

    $('#un').dispatchEvent(new FocusEvent('focusout', { bubbles: true })); // la fenêtre passe au second plan : le document garde son élément actif
    await settle();
    expect(document.activeElement).toBe($('#un'));
    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('la règle ne s’use pas : le focus rendu à la zone, l’utilisateur le met sur un autre lien, qui part à son tour', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#un').remove();
    await settle();
    expect(document.activeElement).toBe($('#zone'));

    $('#trois').focus();
    $('#trois').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(2);
  });

  it('le focus rendu à la zone, l’utilisateur clique dans le vide : un autre élément qui part ensuite ne le lui reprend pas', async () => {
    const { $, give } = await mount();
    $('#un').focus();
    $('#un').remove();
    await settle();
    expect(document.activeElement).toBe($('#zone'));
    $('#zone').blur(); // un clic dans le vide : la zone perd le focus, rien ne le prend
    await settle();

    $('#trois').remove(); // un autre commit retire un autre élément du contenu
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).toHaveBeenCalledTimes(1);
  });

  it('un seul rendu par départ, même quand plusieurs éléments partent ensemble', async () => {
    const { $, give } = await mount();
    $('#deux').focus();

    $('#groupe').remove();
    $('#un').remove();
    $('#texte').remove();
    await settle();

    expect(give).toHaveBeenCalledTimes(1);
  });

  it('le nœud lui-même part (l’état change) : il rend le focus avant de partir, comme `keepFocusIn`, et une seule fois', async () => {
    const { $, give, detach } = await mount();
    $('#un').focus();

    detach?.(); // React détache la ref avant de retirer le nœud du document, le focus y est encore
    expect(document.activeElement).toBe($('#zone'));
    $('#contenu').remove();
    await settle();

    expect(give).toHaveBeenCalledTimes(1);
  });

  it('détachée, la ref ne veille plus : ce qui part du contenu ensuite ne rend rien', async () => {
    const { $, give, detach } = await mount();
    detach?.();
    $('#un').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe(document.body);
    expect(give).not.toHaveBeenCalled();
  });

  it('détachée, elle retire ses écouteurs (rien ne reste sur le nœud)', () => {
    const $ = html(PAGE);
    const added = vi.spyOn($('#contenu'), 'addEventListener');
    const removed = vi.spyOn($('#contenu'), 'removeEventListener');

    keepFocusInContent(focusZoneOf)($('#contenu'))?.();

    expect(added.mock.calls.length).toBeGreaterThan(0);
    expect(removed.mock.calls.map(([type, listener]) => [type, listener])).toEqual(added.mock.calls.map(([type, listener]) => [type, listener]));
  });

  it('détachée, elle coupe son observateur de mutations', () => {
    const $ = html(PAGE);
    const disconnect = vi.spyOn(MutationObserver.prototype, 'disconnect');
    try {
      const cleanup = keepFocusInContent(focusZoneOf)($('#contenu'));
      expect(disconnect).not.toHaveBeenCalled();

      cleanup?.();

      expect(disconnect).toHaveBeenCalledTimes(1);
    } finally {
      disconnect.mockRestore();
    }
  });

  it('attachée deux fois (StrictMode, en développement : attache, détache, attache) : un seul rendu au retrait, et rien à l’attache', async () => {
    const $ = html(PAGE);
    const give = vi.fn((from: Element) => focusZoneOf(from));
    const ref = keepFocusInContent(give);
    ref($('#contenu'))?.();
    const detach = ref($('#contenu'));
    expect(document.activeElement).toBe(document.body); // l'attache ne prend le focus à personne
    $('#un').focus();

    $('#un').remove();
    await settle();

    expect(document.activeElement).toBe($('#zone'));
    expect(give).toHaveBeenCalledTimes(1);
    detach?.();
  });

  it('le nœud qui part rend le focus qu’il tenait, comme `keepFocusIn`, quelle que soit la cause', () => {
    const $ = html('<main><div id="avis"><button id="bouton">Réessayer</button></div></main>');
    const cleanup = keepFocusInContent(focusZoneOf)($('#avis'));
    $('#bouton').focus();

    cleanup?.();

    expect(document.activeElement).toBe($('main'));
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
