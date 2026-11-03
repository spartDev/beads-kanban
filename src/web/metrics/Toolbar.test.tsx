import { render, screen, within } from '@testing-library/react';
import userEvent from '@testing-library/user-event';
import { useState } from 'react';
import { describe, expect, it, vi } from 'vitest';
import type { PeriodChoice } from './params';
import { MetricsToolbar, type MetricsToolbarProps } from './Toolbar';

const TODAY = '2026-11-02';

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
    expect(screen.getByRole('alert')).toBeTruthy();

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
