import { act, fireEvent, render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type { PeriodChoice } from './params';
import { MetricsToolbar, type MetricsToolbarProps } from './Toolbar';

const TODAY = '2026-11-02';

const observers: MutationObserver[] = [];
afterEach(() => observers.splice(0).forEach((observer) => observer.disconnect()));

/**
 * Ce qu'un lecteur d'écran a pu annoncer : le texte de chaque région `alert`, `status` ou `aria-live` à l'instant où elle
 * apparaît ou change. Chercher l'alerte après coup ne voit pas celle qu'on a posée puis retirée dans la foulée ; l'observateur,
 * si. Les mutations ne sont livrées qu'en différé : `heard()` les prend tout de suite.
 */
function listenToAnnouncements(): () => string[] {
  const heard: string[] = [];
  const live = '[role="alert"], [role="status"], [aria-live]:not([aria-live="off"])';
  const read = (node: Node) => {
    const text = (node instanceof Element ? node : node.parentElement)?.closest(live)?.textContent?.trim();
    if (text) heard.push(text);
  };
  const collect = (records: MutationRecord[]) => {
    for (const record of records) {
      if (record.type === 'characterData') read(record.target);
      else record.addedNodes.forEach(read);
    }
  };
  const observer = new MutationObserver(collect);
  observer.observe(document.body, { childList: true, characterData: true, subtree: true });
  observers.push(observer);
  return () => {
    collect(observer.takeRecords());
    return [...heard];
  };
}

function setup(overrides: Partial<MetricsToolbarProps> = {}) {
  const handlers = { onPeriodChange: vi.fn(), onDimensionChange: vi.fn(), onRefresh: vi.fn() };
  const props: MetricsToolbarProps = {
    scope: 'project',
    period: { kind: 'preset', range: '30d' },
    by: 'type',
    today: TODAY,
    fetching: false,
    ...handlers,
    ...overrides,
  };
  const view = render(<MetricsToolbar {...props} />);
  return { ...view, ...handlers, user: userEvent.setup(), rerender: (next: Partial<MetricsToolbarProps>) => view.rerender(<MetricsToolbar {...props} {...next} />) };
}

/**
 * La barre avec une adresse qui retient la période appliquée, comme `MetricsView` : la plage qu'un jour valable vient
 * d'appliquer revient aussitôt par les props. Le `setup` plus haut, aux props figées, ne peut pas montrer ce retour.
 */
function Controlled({ initial }: { initial: PeriodChoice }) {
  const [period, setPeriod] = useState<PeriodChoice>(initial);
  return (
    <MetricsToolbar
      scope="project"
      period={period}
      by="type"
      today={TODAY}
      fetching={false}
      onPeriodChange={setPeriod}
      onDimensionChange={() => undefined}
      onRefresh={() => undefined}
    />
  );
}

const period = () => screen.getByRole('group', { name: 'Période' });
const split = () => screen.getByRole('group', { name: 'Découper par' });

describe('MetricsToolbar : la période', () => {
  it('propose 7, 30 et 90 jours et une plage personnalisée, avec la période courante cochée', () => {
    setup({ period: { kind: 'preset', range: '90d' } });

    const radios = within(period()).getAllByRole('radio');
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(['7 jours', '30 jours', '90 jours', 'Personnalisée']);
    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, false, true, false]);
  });

  it('change de période au clic, sans bouton « Appliquer »', async () => {
    const { user, onPeriodChange } = setup();

    await user.click(within(period()).getByRole('radio', { name: '7 jours' }));

    expect(onPeriodChange).toHaveBeenCalledWith({ kind: 'preset', range: '7d' });
  });

  it('se règle aussi au clavier, avec les flèches', async () => {
    const { user, onPeriodChange } = setup({ period: { kind: 'preset', range: '7d' } });

    within(period()).getByRole('radio', { name: '7 jours' }).focus();
    await user.keyboard('{ArrowRight}');

    expect(onPeriodChange).toHaveBeenCalledWith({ kind: 'preset', range: '30d' });
  });

  it('« Personnalisée » part de la période affichée', async () => {
    const { user, onPeriodChange } = setup({ displayed: { from: '2026-10-27', to: '2026-11-02' } });

    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));

    expect(onPeriodChange).toHaveBeenCalledWith({ kind: 'custom', from: '2026-10-27', to: '2026-11-02' });
  });

  it('« Personnalisée » prend les 30 derniers jours quand aucune période n’est encore affichée', async () => {
    const { user, onPeriodChange } = setup();

    await user.click(within(period()).getByRole('radio', { name: 'Personnalisée' }));

    expect(onPeriodChange).toHaveBeenCalledWith({ kind: 'custom', from: '2026-10-04', to: '2026-11-02' });
  });
});

describe('MetricsToolbar : la plage personnalisée', () => {
  const custom: PeriodChoice = { kind: 'custom', from: '2026-10-01', to: '2026-10-15' };

  it('ne montre les jours que pour une plage personnalisée', () => {
    const preset = setup();
    expect(screen.queryByRole('group', { name: 'Plage personnalisée' })).toBeNull();
    preset.unmount();

    setup({ period: custom });
    const range = screen.getByRole('group', { name: 'Plage personnalisée' });
    expect((within(range).getByLabelText('Du') as HTMLInputElement).value).toBe('2026-10-01');
    expect((within(range).getByLabelText('Au') as HTMLInputElement).value).toBe('2026-10-15');
    expect(within(period()).getByRole('radio', { name: 'Personnalisée' })).toHaveProperty('checked', true);
  });

  it('empêche de choisir un jour futur', () => {
    setup({ period: custom });
    expect(screen.getByLabelText('Au').getAttribute('max')).toBe(TODAY);
  });

  it('n’offre aucun jour d’avant le 1er janvier 1970, le premier que le serveur accepte', () => {
    setup({ period: custom });

    expect(screen.getByLabelText('Du').getAttribute('min')).toBe('1970-01-01');
    // « Au » ne commence pas avant « Du » non plus.
    expect(screen.getByLabelText('Au').getAttribute('min')).toBe('2026-10-01');
  });

  it('« Au » reprend la borne de 1970 quand « Du » est vide ou d’avant, et suit « Du » sinon', () => {
    setup({ period: custom });
    const [from, to] = [screen.getByLabelText('Du'), screen.getByLabelText('Au')];
    const minOfTo = (fromValue: string) => {
      fireEvent.change(from, { target: { value: fromValue } });
      return to.getAttribute('min');
    };

    expect(minOfTo('')).toBe('1970-01-01');
    expect(minOfTo('0020-10-01')).toBe('1970-01-01');
    expect(minOfTo('1969-12-31')).toBe('1970-01-01');
    expect(minOfTo('1970-01-01')).toBe('1970-01-01');
    expect(minOfTo('1970-01-02')).toBe('1970-01-02');
    expect(minOfTo('2026-10-02')).toBe('2026-10-02');
    expect(from.getAttribute('min')).toBe('1970-01-01');
  });

  it('applique la plage dès qu’un jour change et que la plage est valable', async () => {
    const { user, onPeriodChange } = setup({ period: custom });

    const to = screen.getByLabelText('Au');
    await user.clear(to);
    await user.type(to, '2026-10-20');

    expect(onPeriodChange).toHaveBeenLastCalledWith({ kind: 'custom', from: '2026-10-01', to: '2026-10-20' });
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('attend une plage complète : un champ vidé n’est ni une erreur ni une requête', async () => {
    const { user, onPeriodChange } = setup({ period: custom });

    await user.clear(screen.getByLabelText('Au'));

    expect(onPeriodChange).not.toHaveBeenCalled();
    expect(screen.queryByRole('alert')).toBeNull();
  });

  it('dit pourquoi une plage à l’envers n’est pas appliquée', async () => {
    const { user, onPeriodChange } = setup({ period: custom });

    const from = screen.getByLabelText('Du');
    await user.clear(from);
    await user.type(from, '2026-10-20');
    await user.tab(); // quitter le champ : l'alerte n'attend plus la fin de la saisie

    expect(onPeriodChange).not.toHaveBeenCalled();
    const alert = screen.getByRole('alert');
    expect(alert.textContent).toContain('La plage commence après sa fin (2026-10-20 > 2026-10-15).');
    expect(from.getAttribute('aria-invalid')).toBe('true');
    expect(from.getAttribute('aria-describedby')).toBe(alert.id);
  });

  it('dit pourquoi une plage de plus d’un an n’est pas appliquée', async () => {
    const { user, onPeriodChange } = setup({ period: custom });

    const from = screen.getByLabelText('Du');
    await user.clear(from);
    await user.type(from, '2024-01-01');
    await user.tab();

    expect(onPeriodChange).not.toHaveBeenCalled();
    expect(screen.getByRole('alert').textContent).toContain('au plus 366');
  });

  it('garde le champ et son focus quand la plage qu’il vient d’appliquer revient par l’adresse : on peut continuer de taper', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={custom} />);
    const from = screen.getByLabelText('Du') as HTMLInputElement;

    await user.clear(from);
    await user.type(from, '2026-10-02');

    // Le champ n'a pas été remplacé par un autre (remonté), sinon le focus tombe sur la page et la frappe suivante se perd.
    expect(from.isConnected).toBe(true);
    expect(screen.getByLabelText('Du')).toBe(from);
    expect(document.activeElement).toBe(from);
    expect(from.value).toBe('2026-10-02');
  });

  it('garde le champ « Au » et son focus de la même façon', async () => {
    const user = userEvent.setup();
    render(<Controlled initial={custom} />);
    const to = screen.getByLabelText('Au') as HTMLInputElement;

    await user.clear(to);
    await user.type(to, '2026-10-20');

    expect(screen.getByLabelText('Au')).toBe(to);
    expect(document.activeElement).toBe(to);
    expect(to.value).toBe('2026-10-20');
  });

  it('garde la plage refusée que l’on est en train de corriger quand la barre se redessine sans que l’adresse change', async () => {
    const { user, rerender } = setup({ period: custom });
    const from = screen.getByLabelText('Du') as HTMLInputElement;

    await user.clear(from);
    await user.type(from, '2026-10-20');
    await user.keyboard('{Enter}'); // Entrée dit tout de suite ce qui ne va pas, sans quitter le champ
    expect(screen.getByRole('alert')).toBeTruthy();
    expect(document.activeElement).toBe(from);

    // Un calcul d'une autre requête arrive : la barre se redessine, la période de l'adresse est la même.
    rerender({ period: { ...custom }, fetching: true });

    expect(from.value).toBe('2026-10-20');
    expect(screen.getByRole('alert').textContent).toContain('La plage commence après sa fin');
  });

  it('repart de la plage de l’adresse quand elle change d’ailleurs (lien, retour arrière)', () => {
    const { rerender } = setup({ period: custom });
    rerender({ period: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } });

    expect((screen.getByLabelText('Du') as HTMLInputElement).value).toBe('2026-09-01');
    expect((screen.getByLabelText('Au') as HTMLInputElement).value).toBe('2026-09-30');
  });

  /*
   * Un champ de date tapé au clavier émet un événement change à chaque chiffre : pour 2026, les dates 0002, 0020, 0202 puis
   * 2026. Les trois premières ne sont que des états de passage. Les annoncer (`role="alert"` interrompt le lecteur d'écran) à chaque
   * chiffre empêche de taper : l'alerte attend que la saisie se pose — un court silence, la sortie du champ ou Entrée.
   */
  describe('l’annonce d’une plage refusée', () => {
    const elapse = (ms: number) => act(() => void vi.advanceTimersByTime(ms));
    const type = (field: HTMLElement, value: string) => fireEvent.change(field, { target: { value } });
    const field = () => screen.getByLabelText('Du') as HTMLInputElement;

    beforeEach(() => {
      vi.useFakeTimers();
    });
    afterEach(() => {
      vi.useRealTimers();
    });

    it('n’annonce rien pendant qu’une année se tape au clavier : seule la plage finale compte', () => {
      // Du 2 novembre 2025 au 2 novembre 2026 : 366 jours, le maximum. Taper 2026 dans « Du » en fait une plage d'un jour.
      const { onPeriodChange } = setup({ period: { kind: 'custom', from: '2025-11-02', to: TODAY } });
      const heard = listenToAnnouncements();
      act(() => field().focus());

      // Comme au clavier : chaque chiffre est une touche (keydown), puis la date que le champ en tire (change).
      for (const [key, typed] of [['2', '0002-11-02'], ['0', '0020-11-02'], ['2', '0202-11-02']] as const) {
        fireEvent.keyDown(field(), { key });
        type(field(), typed);
        elapse(250);
        expect(screen.queryByRole('alert'), typed).toBeNull();
        expect(field().getAttribute('aria-invalid'), typed).toBeNull();
      }
      expect(onPeriodChange).not.toHaveBeenCalled();

      fireEvent.keyDown(field(), { key: '6' });
      type(field(), '2026-11-02');
      elapse(2_000);

      expect(onPeriodChange).toHaveBeenCalledTimes(1);
      expect(onPeriodChange).toHaveBeenLastCalledWith({ kind: 'custom', from: '2026-11-02', to: TODAY });
      expect(heard()).toEqual([]);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(document.activeElement).toBe(field());
    });

    it('signale une plage refusée une fois la saisie posée, une seule fois', () => {
      setup({ period: custom });
      const heard = listenToAnnouncements();

      type(field(), '2026-10-20');
      elapse(300);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBeNull();

      elapse(1_700);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe('La plage commence après sa fin (2026-10-20 > 2026-10-15).');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().getAttribute('aria-describedby')).toBe(alert.id);
      expect(heard()).toEqual(['La plage commence après sa fin (2026-10-20 > 2026-10-15).']);

      elapse(10_000);
      expect(heard()).toHaveLength(1);
    });

    it('signale tout de suite une plage refusée quand on quitte le champ', () => {
      setup({ period: custom });
      act(() => field().focus());

      type(field(), '2026-10-20');
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => field().blur());

      expect(screen.getByRole('alert').textContent).toBe('La plage commence après sa fin (2026-10-20 > 2026-10-15).');
      expect(field().getAttribute('aria-invalid')).toBe('true');
    });

    it('signale tout de suite une plage refusée sur Entrée, sans quitter le champ', () => {
      setup({ period: custom });
      act(() => field().focus());

      type(field(), '2026-10-20');
      expect(screen.queryByRole('alert')).toBeNull();
      fireEvent.keyDown(field(), { key: 'Enter' });

      expect(screen.getByRole('alert').textContent).toBe('La plage commence après sa fin (2026-10-20 > 2026-10-15).');
      expect(document.activeElement).toBe(field());
    });

    it('fait de même pour le champ « Au »', () => {
      setup({ period: custom });
      const to = screen.getByLabelText('Au');

      type(to, '2026-09-20');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(to.getAttribute('aria-invalid')).toBeNull();
      elapse(2_000);

      expect(screen.getByRole('alert').textContent).toBe('La plage commence après sa fin (2026-10-01 > 2026-09-20).');
      expect(to.getAttribute('aria-invalid')).toBe('true');
    });

    it('retire l’alerte aussitôt que la plage redevient valable', () => {
      setup({ period: custom });
      type(field(), '2026-10-20');
      elapse(2_000);
      expect(screen.getByRole('alert')).toBeTruthy();

      type(field(), '2026-10-10');

      expect(screen.queryByRole('alert')).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBeNull();
      expect(field().getAttribute('aria-describedby')).toBeNull();
    });

    it('laisse de nouveau le temps de taper après une plage valable : l’alerte d’avant ne revient pas d’un coup', () => {
      setup({ period: custom });
      type(field(), '2026-10-20');
      elapse(2_000);
      type(field(), '2026-10-10');

      type(field(), '2026-10-25');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBeNull();

      elapse(2_000);
      expect(screen.getByRole('alert').textContent).toBe('La plage commence après sa fin (2026-10-25 > 2026-10-15).');
    });

    it('ne ré-annonce pas à chaque chiffre une alerte déjà affichée : elle suit une fois la saisie posée', () => {
      setup({ period: custom });
      type(field(), '2026-10-20');
      elapse(2_000);
      const heard = listenToAnnouncements();

      for (const typed of ['0002-10-20', '0020-10-20', '0202-10-20']) {
        type(field(), typed);
        elapse(250);
      }
      expect(heard()).toEqual([]);

      elapse(2_000);
      expect(heard()).toHaveLength(1);
      // Le dernier état de passage, l'an 202, est d'avant le 1er janvier 1970 : c'est ce que dit l'alerte.
      expect(screen.getByRole('alert').textContent).toBe('La plage doit commencer le 1er janvier 1970 ou après : 0202-10-20 est trop tôt.');
    });

    it('annonce, une fois la saisie posée, une plage d’avant le 1er janvier 1970, l’an 20 compris, sans la demander au serveur', () => {
      const { onPeriodChange } = setup({ period: custom });
      const heard = listenToAnnouncements();

      // Une plage tout entière dans l'an 20, tapée comme au clavier : « Au » puis « Du ».
      type(screen.getByLabelText('Au'), '0020-01-31');
      type(field(), '0020-01-01');
      elapse(300);
      expect(screen.queryByRole('alert')).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBeNull();

      elapse(2_000);
      const alert = screen.getByRole('alert');
      expect(alert.textContent).toBe('La plage doit commencer le 1er janvier 1970 ou après : 0020-01-01 est trop tôt.');
      expect(field().getAttribute('aria-invalid')).toBe('true');
      expect(field().getAttribute('aria-describedby')).toBe(alert.id);
      expect(heard()).toEqual(['La plage doit commencer le 1er janvier 1970 ou après : 0020-01-01 est trop tôt.']);
      expect(onPeriodChange).not.toHaveBeenCalled();
    });

    it('annonce tout de suite, en quittant le champ, une plage d’avant le 1er janvier 1970', () => {
      setup({ period: custom });
      act(() => field().focus());

      type(field(), '1969-12-31');
      expect(screen.queryByRole('alert')).toBeNull();
      act(() => field().blur());

      expect(screen.getByRole('alert').textContent).toBe('La plage doit commencer le 1er janvier 1970 ou après : 1969-12-31 est trop tôt.');
    });

    it('applique une plage qui commence le 1er janvier 1970, la borne basse comprise', () => {
      const { onPeriodChange } = setup({ period: custom });

      type(screen.getByLabelText('Au'), '1970-01-31');
      type(field(), '1970-01-01');

      expect(onPeriodChange).toHaveBeenCalledTimes(1);
      expect(onPeriodChange).toHaveBeenLastCalledWith({ kind: 'custom', from: '1970-01-01', to: '1970-01-31' });
      elapse(2_000);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('n’annonce pas une plage incomplète : un champ vidé attend la suite, même en quittant le champ', () => {
      setup({ period: custom });
      act(() => field().focus());

      type(field(), '');
      act(() => field().blur());
      elapse(2_000);

      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('garde le même champ et son focus, sans aucune annonce, quand la plage valable revient par l’adresse comme dans la page', () => {
      render(<Controlled initial={{ kind: 'custom', from: '2025-11-02', to: TODAY }} />);
      const heard = listenToAnnouncements();
      const from = field();
      act(() => from.focus());

      for (const typed of ['0002-11-02', '0020-11-02', '0202-11-02', '2026-11-02']) {
        type(from, typed);
        elapse(250);
        expect(screen.getByLabelText('Du'), typed).toBe(from);
        expect(document.activeElement, typed).toBe(from);
      }
      elapse(2_000);

      expect(from.value).toBe('2026-11-02');
      expect(heard()).toEqual([]);
      expect(screen.queryByRole('alert')).toBeNull();
    });

    it('n’annonce pas une erreur périmée quand l’adresse change avant la fin du silence (lien, « Retour »)', () => {
      const { rerender } = setup({ period: custom });
      type(field(), '2026-10-20');
      elapse(300);

      rerender({ period: { kind: 'custom', from: '2026-09-01', to: '2026-09-30' } });
      elapse(2_000);

      expect(field().value).toBe('2026-09-01');
      expect(screen.queryByRole('alert')).toBeNull();
      expect(field().getAttribute('aria-invalid')).toBeNull();
    });

    it('n’attend plus rien une fois la barre démontée : pas de minuterie qui traîne', () => {
      const { unmount } = setup({ period: custom });
      const idle = vi.getTimerCount();

      type(field(), '2026-10-20');
      expect(vi.getTimerCount()).toBe(idle + 1); // l'annonce attend la fin de la saisie

      unmount();
      expect(vi.getTimerCount()).toBe(idle);
    });
  });
});

describe('MetricsToolbar : le découpage', () => {
  it('propose type et priorité dans un Projet', () => {
    setup({ scope: 'project', by: 'priority' });

    const radios = within(split()).getAllByRole('radio');
    expect(radios.map((radio) => radio.parentElement?.textContent)).toEqual(['Type', 'Priorité']);
    expect(radios.map((radio) => (radio as HTMLInputElement).checked)).toEqual([false, true]);
  });

  it('propose aussi le Projet en Vue globale', () => {
    setup({ scope: 'global', by: 'project' });
    expect(within(split()).getAllByRole('radio').map((radio) => radio.parentElement?.textContent)).toEqual(['Type', 'Priorité', 'Projet']);
  });

  it('change de découpage au clic', async () => {
    const { user, onDimensionChange } = setup({ scope: 'global', by: 'project' });

    await user.click(within(split()).getByRole('radio', { name: 'Priorité' }));

    expect(onDimensionChange).toHaveBeenCalledWith('priority');
  });
});

describe('MetricsToolbar : actualiser', () => {
  it('dit quand les chiffres ont été calculés, dans le fuseau des métriques', () => {
    setup({ computed: { at: '2026-11-02T19:00:15.242Z', timeZone: 'Europe/Paris' } });

    const label = screen.getByText('Calculé à 20:00');
    expect(label.getAttribute('title')).toBe('Fuseau Europe/Paris');
  });

  it('recalcule à la demande', async () => {
    const { user, onRefresh } = setup();

    await user.click(screen.getByRole('button', { name: 'Actualiser les métriques' }));

    expect(onRefresh).toHaveBeenCalledTimes(1);
  });

  it('tourne pendant le calcul', () => {
    setup({ fetching: true });
    expect(screen.getByRole('button', { name: 'Actualiser les métriques' }).querySelector('svg')?.getAttribute('class')).toContain('animate-spin');
  });
});
