import { describe, expect, it } from 'vitest';
import type { SignalsResponse } from '../../shared/api';
import type { NamedMetricsResponse } from './api';
import { buildRetrospective, escapeMarkdown, evolution } from './retrospective';
import { emptyHealthFixture, metricsFixture, plain, trendOf } from './testing';
import { MEASURES } from './trend';

const DAY = 86_400_000;

const signalsResponse = (overrides: Partial<SignalsResponse> = {}): SignalsResponse => ({
  generatedAt: '2026-11-02T19:00:15.242Z',
  timeZone: 'Europe/Paris',
  timeZoneHonoured: true,
  projects: [
    { id: 'bdesk', name: 'beads-desktop' },
    { id: 'mpm', name: 'My-Prompt-Manager' },
  ],
  unreadable: [],
  signals: [
    { kind: 'drift', project: 'bdesk', ticket: { id: 'bdesk-d1', title: 'Refonte | kanban', type: 'feature', priority: 1 }, cycleTime: 9 * DAY, reference: 4 * DAY, scope: 'type' },
    { kind: 'stagnantReady', project: 'mpm', ticket: { id: 'mpm-s1', title: 'Doc *export*', type: 'task', priority: 3 }, since: '2026-10-10T08:00:00.000Z', age: 23 * DAY },
    { kind: 'unusualWip', project: 'mpm', wip: 9, threshold: 6 },
  ],
  ...overrides,
});

const build = (metrics: NamedMetricsResponse = metricsFixture(), signals: SignalsResponse | 'error' = signalsResponse()) =>
  plain(buildRetrospective({ scopeName: 'Vue globale', metrics, signals: signals === 'error' ? { status: 'error' } : { status: 'ok', response: signals }, language: 'fr' }));

describe('rapport de rétrospective', () => {
  it('titre la période et dit comment elle est comparée', () => {
    const text = build();
    expect(text).toMatch(/^# Rétrospective : Vue globale, 27 oct. – 2 nov. 2026\n\nPériode en cours/);
  });

  it('donne Débit, Lead Time, Taux de Réouverture et Taux d’échec avec leur évolution', () => {
    const text = build();
    expect(text).toContain('| Débit | 18 Livraisons | 28 | −10 (−36 %), en moins bien |');
    expect(text).toMatch(/\| Lead Time \(médiane\) \| 6,9 j \| [^|]+ \| [^|]+ \|/);
    expect(text).toMatch(/\| Lead Time \(P85\) \| 16 j \| 4 j \| \+12 j \(\+304 %\), en moins bien \|/);
    expect(text).toContain('| Taux de Réouverture | 9,5 % (2 sur 21 clôtures) | 4 % | +5,5 pts, en moins bien |');
    expect(text).toContain('| Taux d’échec | 0 % (0 sur 18 Livraisons), non significatif | 0 % | stable |');
    expect(text).toContain('_Taux d’échec non significatif : couverture insuffisante : 19 % des bugs ont une origine renseignée (minimum 50 %)._');
  });

  it('montre la Tendance longue semaine par semaine, et signale les centiles peu fiables', () => {
    const text = build();
    expect(text).toContain('## Tendance longue (12 semaines)');
    expect(text).toContain('| 17 août | 5 | 1 j | 20 % |');
    expect(text).toContain('| 2 nov. (en cours) | 1 | 12 j \\* | 0 % |');
    expect(text).toContain('| 7 sept. | 0 | — | — |');
    expect(text).toContain('\\* Moins de 4 Livraisons dans la semaine');
  });

  it('liste les tickets en Retravail avec leurs causes, et leur Projet dans la Vue globale', () => {
    const text = build();
    expect(text).toContain('## Retravail (2 tickets)');
    expect(text).toContain('- `bdesk-r1` Palette ⌘K (beads-desktop) : 2 Réouvertures, Bug d’origine `bdesk-b9`');
    expect(text).toContain('- `mpm-r2` Import des prompts (My-Prompt-Manager) : 1 Prise rendue');
  });

  it('dit quand rien n’est revenu sur la période', () => {
    const text = build(metricsFixture({ health: emptyHealthFixture() }));
    expect(text).toContain('## Retravail (0 ticket)\n\nAucun ticket n’est revenu sur la période');
  });

  it('groupe les Signaux en cours par sorte, datés de leur lecture', () => {
    const text = build();
    expect(text).toContain('## Signaux en cours (3 Signaux, au 2 nov. à 20:00)');
    expect(text).toContain('### Dérive\n\n- `bdesk-d1` Refonte \\| kanban (beads-desktop) : 9 j de Cycle Time en cours, au-delà de 4 j, le P85 des Livraisons du même type');
    expect(text).toContain('### Prêt qui stagne\n\n- `mpm-s1` Doc \\*export\\* (My-Prompt-Manager) : Prêt depuis 23 j');
    expect(text).toContain('### WIP inhabituel\n\n- My-Prompt-Manager : 9 tickets en cours, au-delà de 6');
    expect(text.indexOf('### Dérive')).toBeLessThan(text.indexOf('### Prêt qui stagne'));
    expect(text.endsWith('quotidien des 90 derniers jours\n')).toBe(true);
  });

  it('ne nomme pas le Projet d’un ticket quand il n’y en a qu’un', () => {
    const metrics = metricsFixture({ projects: [{ id: 'bdesk', name: 'beads-desktop' }] });
    const text = build(metrics, signalsResponse({ projects: [{ id: 'bdesk', name: 'beads-desktop' }], signals: signalsResponse().signals.slice(0, 1) }));
    expect(text).toContain('- `bdesk-r1` Palette ⌘K : 2 Réouvertures');
    expect(text).toContain('- `bdesk-d1` Refonte \\| kanban : 9 j');
  });

  it('nomme un Projet sans nom comme l’avis des Projets illisibles, jamais « Sans titre »', () => {
    const metrics: NamedMetricsResponse = {
      ...metricsFixture(),
      projects: [
        { id: 'bdesk', name: 'beads-desktop' },
        { id: 'mpm', name: 'Sans titre', unnamed: true },
      ],
    };
    const text = build(metrics);
    expect(text).toContain('- `mpm-r2` Import des prompts (Un Projet sans nom) : 1 Prise rendue');
    expect(text).toContain('- `bdesk-r1` Palette ⌘K (« beads-desktop ») :');
    expect(text).toContain('- Un Projet sans nom : 9 tickets en cours');
  });

  it('dit qu’il n’y a aucun Signal, ou qu’ils n’ont pas pu être lus, sans renoncer au reste', () => {
    expect(build(undefined, signalsResponse({ signals: [] }))).toContain('## Signaux en cours (0 Signal, au 2 nov. à 20:00)\n\nAucune Dérive');
    const failed = build(undefined, 'error');
    expect(failed).toContain('## Signaux en cours\n\n_Les Signaux n’ont pas pu être lus._');
    expect(failed).toContain('## Indicateurs');
  });
});

describe('évolution', () => {
  it('dit l’écart, sa part et s’il est un mieux', () => {
    expect(plain(evolution(trendOf(12, 9), MEASURES.fr.count))).toBe('+3 (+33 %), en mieux');
    expect(plain(evolution(trendOf(2 * DAY, 3 * DAY), MEASURES.fr.duration))).toBe('−1 j (−33 %), en mieux');
    expect(evolution(trendOf(4, 4), MEASURES.fr.count)).toBe('stable');
    expect(evolution(trendOf(4, null), MEASURES.fr.count)).toBe('—');
  });
});

describe('échappement', () => {
  it('neutralise la mise en forme et les fins de ligne d’un texte venu des données', () => {
    expect(escapeMarkdown('Fix *a* | [b](c) <d> `e` #1\nsuite')).toBe('Fix \\*a\\* \\| \\[b\\](c) \\<d\\> \\`e\\` \\#1 suite');
  });
});

describe('en anglais', () => {
  const english = (metrics: NamedMetricsResponse = metricsFixture(), signals: SignalsResponse = signalsResponse()) =>
    plain(buildRetrospective({ scopeName: 'Overview', metrics, signals: { status: 'ok', response: signals }, language: 'en' }));

  it('écrit le rapport complet dans la langue et la notation de l’interface', () => {
    const text = english();
    expect(text).toMatch(/^# Retrospective: Overview, Oct 27 – Nov 2, 2026\n\nPeriod in progress/);
    expect(text).toContain('## Key metrics\n\n| Metric | Period | Previous | Change |');
    expect(text).toContain('| Throughput | 18 Deliveries | 28 | −10 (−36%), worse |');
    expect(text).toContain('| Lead Time (median) | 6.9 d |');
    expect(text).toContain('| Reopen rate | 9.5% (2 of 21 closures) | 4% | +5.5 pts, worse |');
    expect(text).toContain('| Change failure rate | 0% (0 of 18 Deliveries), not significant | 0% | steady |');
    expect(text).toContain('_Change failure rate not significant: Coverage too low: 19% of bugs have a recorded origin (minimum 50%)._');
    expect(text).toContain('## Long trend (12 weeks)\n\n| Week of | Throughput | Lead Time (P85) | Reopen rate |');
    expect(text).toContain('| Aug 24 | 6 | 2 d | 16.7% |');
    expect(text).toContain('| Nov 2 (in progress) | 1 | 12 d \\* | 0% |');
    expect(text).toContain('\\* Fewer than 4 Deliveries in the week');
    expect(text).toContain('## Rework (2 tickets)');
    expect(text).toContain('- `bdesk-r1` Palette ⌘K (beads-desktop): 2 Reopens, Escaped bug `bdesk-b9`');
    expect(text).toContain('- `mpm-r2` Import des prompts (My-Prompt-Manager): 1 Handback');
    expect(text).toContain('## Current Signals (3 Signals, as of Nov 2 at 20:00)');
    // L'échappement markdown ne dépend pas de la langue.
    expect(text).toContain('- `bdesk-d1` Refonte \\| kanban (beads-desktop): ');
    expect(text).toContain('- `mpm-s1` Doc \\*export\\* (My-Prompt-Manager): ');
  });

  it('accorde au singulier pour 1 exactement, et dit l’absence', () => {
    const quiet = english(metricsFixture({ health: emptyHealthFixture() }), signalsResponse({ signals: signalsResponse().signals.slice(0, 1) }));
    expect(quiet).toContain('## Rework (0 tickets)\n\nNo ticket came back in the period');
    expect(quiet).toContain('## Current Signals (1 Signal, as of Nov 2 at 20:00)');
    expect(plain(evolution(trendOf(12, 9), MEASURES.en.count))).toBe('+3 (+33%), better');
    expect(evolution(trendOf(4, 4), MEASURES.en.count)).toBe('steady');
  });
});
