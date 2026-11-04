import { describe, expect, it } from 'vitest';
import { addDays, bucketsOf, calendarElapsed, dayOf, daysOf, InvalidPeriodError, MIN_CUSTOM_DAY, type PeriodSpec, resolvePeriod, startOfDay } from './calendar';

const instant = (iso: string) => new Date(iso).getTime();
const HOUR = 3_600_000;
const PARIS = 'Europe/Paris';

describe('jours du fuseau local', () => {
  it('date un instant dans le jour du fuseau, pas dans celui de UTC', () => {
    const late = instant('2026-10-24T22:30:00Z'); // 00:30 le 25 à Paris (heure d’été), 15:30 le 24 à Los Angeles

    expect(dayOf(late, PARIS)).toBe('2026-10-25');
    expect(dayOf(late, 'UTC')).toBe('2026-10-24');
    expect(dayOf(late, 'America/Los_Angeles')).toBe('2026-10-24');
  });

  it('démarre un jour à son minuit local, heure d’été ou d’hiver', () => {
    expect(startOfDay('2026-07-14', PARIS)).toBe(instant('2026-07-13T22:00:00Z'));
    expect(startOfDay('2026-12-25', PARIS)).toBe(instant('2026-12-24T23:00:00Z'));
  });

  it('compte 25 heures le jour du passage à l’heure d’hiver et 23 le jour du passage à l’heure d’été', () => {
    const length = (day: string) => startOfDay(addDays(day, 1), PARIS) - startOfDay(day, PARIS);

    expect(length('2026-10-25')).toBe(25 * HOUR);
    expect(length('2026-03-29')).toBe(23 * HOUR);
    expect(length('2026-10-26')).toBe(24 * HOUR);
  });

  it('démarre au premier instant existant quand le minuit local saute (changement d’heure à minuit)', () => {
    // Sao Paulo, 4 novembre 2018 : à minuit, les horloges passent à 01:00.
    const start = startOfDay('2018-11-04', 'America/Sao_Paulo');

    expect(start).toBe(instant('2018-11-04T03:00:00Z'));
    expect(dayOf(start, 'America/Sao_Paulo')).toBe('2018-11-04');
    expect(dayOf(start - 1, 'America/Sao_Paulo')).toBe('2018-11-03');
  });

  it('retrouve le minuit local dans un fuseau à l’est de Greenwich dont le changement d’heure tombe entre l’estimation et minuit', () => {
    // Auckland (UTC+12 l'hiver, +13 l'été) : l'heure d'été commence le 27 septembre 2026 et finit le 5 avril 2026.
    // Les valeurs attendues viennent de zoneinfo (Python), pas du code testé.
    expect(startOfDay('2026-09-27', 'Pacific/Auckland')).toBe(instant('2026-09-26T12:00:00Z'));
    expect(startOfDay('2026-09-28', 'Pacific/Auckland')).toBe(instant('2026-09-27T11:00:00Z'));
    expect(startOfDay('2026-04-04', 'Pacific/Auckland')).toBe(instant('2026-04-03T11:00:00Z'));
    expect(startOfDay('2026-04-05', 'Pacific/Auckland')).toBe(instant('2026-04-04T11:00:00Z'));
    expect(startOfDay('2026-04-06', 'Pacific/Auckland')).toBe(instant('2026-04-05T12:00:00Z'));
  });

  it('démarre un jour dont minuit se répète à son premier minuit : l’horloge recule à 01:00, 00:00 revient une heure plus tard', () => {
    // Gaza, 24 octobre 2020 : à 01:00 (heure d'été) les horloges reculent à 00:00. Les heures 00:00 à 01:00 passent deux fois ;
    // le jour commence au premier minuit (21:00Z), pas au second (22:00Z), qui est déjà une heure après le début du jour.
    const start = startOfDay('2020-10-24', 'Asia/Gaza');

    expect(start).toBe(instant('2020-10-23T21:00:00Z'));
    expect(dayOf(start, 'Asia/Gaza')).toBe('2020-10-24');
    expect(dayOf(start - 1, 'Asia/Gaza')).toBe('2020-10-23');
    expect(dayOf(start - HOUR / 2, 'Asia/Gaza')).toBe('2020-10-23'); // 23:30 la veille, et non 00:30 deux fois le même jour
    // Le jour d'avant dure 24 h, ce jour-là 25 h : les deux se suivent sans trou ni recouvrement.
    expect(start - startOfDay('2020-10-23', 'Asia/Gaza')).toBe(24 * HOUR);
    expect(startOfDay('2020-10-25', 'Asia/Gaza') - start).toBe(25 * HOUR);
  });

  it('démarre un jour qui n’existe pas à l’instant où le suivant commence : Samoa a sauté le 30 décembre 2011', () => {
    const skipped = startOfDay('2011-12-30', 'Pacific/Apia');

    expect(skipped).toBe(startOfDay('2011-12-31', 'Pacific/Apia'));
    expect(skipped).toBe(instant('2011-12-30T10:00:00Z')); // 24:00 le 29 à UTC-10 = 00:00 le 31 à UTC+14
    expect(dayOf(skipped - 1, 'Pacific/Apia')).toBe('2011-12-29');
    expect(dayOf(skipped, 'Pacific/Apia')).toBe('2011-12-31');
  });

  it.each([
    ['Europe/Paris', 2026],
    ['Pacific/Auckland', 2026],
    ['Australia/Lord_Howe', 2026], // changement d'heure d'une demi-heure
    ['America/Sao_Paulo', 2018], // minuit saute (00:00 devient 01:00)
    ['America/Havana', 2020], // minuit saute au printemps, se répète à l'automne
    ['Asia/Gaza', 2020], // minuit se répète à l'automne
    ['Asia/Beirut', 2020], // l'horloge recule de 00:00 à 23:00 la veille
    ['America/Santiago', 2020], // minuit saute (24:00 devient 01:00)
    ['Africa/Cairo', 2023], // l'heure d'été revient à minuit
    ['Asia/Tehran', 2020], // changements d'heure à minuit
  ])('%s %i : chaque jour commence à son premier instant, et finit où le suivant commence', (zone, year) => {
    const faults: string[] = [];
    for (let day = `${year}-01-01`; day < `${year + 1}-01-01`; day = addDays(day, 1)) {
      const start = startOfDay(day, zone);
      // Une seconde plus tôt, on est encore la veille ; à `start`, on est ce jour-là.
      if (dayOf(start, zone) !== day || dayOf(start - 1000, zone) >= day) faults.push(`${day} : ${new Date(start).toISOString()}`);
      if (startOfDay(addDays(day, 1), zone) <= start) faults.push(`${day} : le jour suivant ne commence pas après`);
    }

    expect(faults).toEqual([]);
  });

  it('ajoute des jours calendaires, mois, années et 29 février compris', () => {
    expect(addDays('2026-12-31', 1)).toBe('2027-01-01');
    expect(addDays('2028-02-28', 1)).toBe('2028-02-29');
    expect(addDays('2026-03-01', -1)).toBe('2026-02-28');
    expect(addDays('2026-10-23', 0)).toBe('2026-10-23');
  });

  it('liste les jours d’une période', () => {
    const { current } = resolvePeriod({ from: '2026-02-27', to: '2026-03-02' }, instant('2026-10-23T12:00:00Z'), PARIS);

    expect(daysOf(current)).toEqual(['2026-02-27', '2026-02-28', '2026-03-01', '2026-03-02']);
  });
});

describe('périodes', () => {
  // Vendredi 23 octobre 2026, 20:00 à Paris.
  const now = instant('2026-10-23T18:00:00Z');

  it('prend, pour un préréglage, les N derniers jours aujourd’hui compris, et la période précédente de même durée', () => {
    const { range, current, previous } = resolvePeriod({ range: '7d' }, now, PARIS);

    expect(range).toBe('7d');
    expect(current).toEqual({
      from: '2026-10-17',
      to: '2026-10-23',
      days: 7,
      start: instant('2026-10-16T22:00:00Z'),
      end: instant('2026-10-23T22:00:00Z'),
    });
    expect(previous).toEqual({
      from: '2026-10-10',
      to: '2026-10-16',
      days: 7,
      start: instant('2026-10-09T22:00:00Z'),
      end: instant('2026-10-16T22:00:00Z'),
    });
  });

  it.each([
    ['30d', 30, '2026-09-24', '2026-08-25', '2026-09-23'],
    ['90d', 90, '2026-07-26', '2026-04-27', '2026-07-25'],
  ] as const)('%s : %i jours, précédés d’autant', (range, days, from, previousFrom, previousTo) => {
    const resolved = resolvePeriod({ range }, now, PARIS);

    expect([resolved.current.from, resolved.current.to, resolved.current.days]).toEqual([from, '2026-10-23', days]);
    expect([resolved.previous.from, resolved.previous.to, resolved.previous.days]).toEqual([previousFrom, previousTo, days]);
  });

  it('prend « aujourd’hui » dans le fuseau local : minuit passé à Paris, pas encore en UTC', () => {
    const afterMidnightInParis = instant('2026-10-23T23:30:00Z'); // 01:30 le 24 à Paris

    expect(resolvePeriod({ range: '7d' }, afterMidnightInParis, PARIS).current.to).toBe('2026-10-24');
    expect(resolvePeriod({ range: '7d' }, afterMidnightInParis, 'UTC').current.to).toBe('2026-10-23');
  });

  it('prend une plage personnalisée, bornes incluses', () => {
    const { range, current, previous } = resolvePeriod({ from: '2026-10-01', to: '2026-10-15' }, now, PARIS);

    expect(range).toBe('custom');
    expect([current.from, current.to, current.days]).toEqual(['2026-10-01', '2026-10-15', 15]);
    expect(current.end).toBe(startOfDay('2026-10-16', PARIS));
    expect([previous.from, previous.to, previous.days]).toEqual(['2026-09-16', '2026-09-30', 15]);
  });

  it('accepte une plage d’un seul jour, et une plage qui se termine aujourd’hui', () => {
    expect(resolvePeriod({ from: '2026-10-23', to: '2026-10-23' }, now, PARIS).current.days).toBe(1);
    expect(resolvePeriod({ from: '2026-10-01', to: '2026-10-23' }, now, PARIS).current.days).toBe(23);
  });

  it('regroupe par jour jusqu’à 31 jours, par semaine au-delà', () => {
    const unit = (days: number) => resolvePeriod({ from: addDays('2026-10-23', 1 - days), to: '2026-10-23' }, now, PARIS).unit;

    expect(unit(7)).toBe('day');
    expect(unit(31)).toBe('day');
    expect(unit(32)).toBe('week');
    expect(resolvePeriod({ range: '30d' }, now, PARIS).unit).toBe('day');
    expect(resolvePeriod({ range: '90d' }, now, PARIS).unit).toBe('week');
  });

  it.each([
    ['une date mal formée', { from: '2026-1-5', to: '2026-10-15' }, 'AAAA-MM-JJ'],
    ['un jour qui n’existe pas', { from: '2026-02-30', to: '2026-10-15' }, 'AAAA-MM-JJ'],
    ['un début après la fin', { from: '2026-10-15', to: '2026-10-01' }, 'avant'],
    ['une fin dans le futur', { from: '2026-10-01', to: '2026-10-24' }, 'futur'],
    ['plus d’un an', { from: '2025-10-01', to: '2026-10-23' }, '366'],
  ])('refuse %s', (_, spec, fragment) => {
    expect(() => resolvePeriod(spec, now, PARIS)).toThrow(InvalidPeriodError);
    expect(() => resolvePeriod(spec, now, PARIS)).toThrow(fragment);
  });

  it('accepte exactement 366 jours', () => {
    expect(resolvePeriod({ from: '2025-10-23', to: '2026-10-23' }, now, PARIS).current.days).toBe(366);
  });
});

/*
 * Aucun historique Dolt n'est plus ancien que 1970, et plus tôt les dates ne se calculent plus juste : `Date.UTC(20, …)` lit
 * l'an 20 comme 1920, et `offsetAt` se trompe de 1900 ans pour les instants des années 0 à 99, donc pour le début d'une période
 * qui commence le 1er janvier de l'an 100. Un champ de date tapé au clavier passe par 0002, 0020 puis 0202 avant 2026 : la page
 * (src/web/metrics/params.ts) et le serveur refusent la même plage, et ne comptent rien dessus.
 */
describe('la borne basse d’une plage personnalisée', () => {
  // Vendredi 23 octobre 2026, 20:00 à Paris.
  const now = instant('2026-10-23T18:00:00Z');
  const RULE = 'La plage doit commencer le 1er janvier 1970 ou après';
  const tooEarly = (from: string) => `${RULE} : « from » (${from}) est trop tôt.`;

  /** Le message dont `resolvePeriod` refuse la plage : le refus doit être une `InvalidPeriodError`. */
  const refusal = (spec: PeriodSpec): string => {
    try {
      resolvePeriod(spec, now, PARIS);
    } catch (error) {
      expect(error).toBeInstanceOf(InvalidPeriodError);
      return (error as Error).message;
    }
    throw new Error(`la plage ${JSON.stringify(spec)} aurait dû être refusée`);
  };

  it('est le 1er janvier 1970 (le texte de la règle dit la même date)', () => {
    expect(MIN_CUSTOM_DAY).toBe('1970-01-01');
  });

  it('accepte une plage qui commence le 1er janvier 1970, bord compris, et la mesure juste', () => {
    // Le 1er janvier 1970 est un jeudi. La France est à l'heure d'hiver (UTC+1) : pas de changement d'heure en 1970.
    const resolved = resolvePeriod({ from: '1970-01-01', to: '1970-02-15' }, now, PARIS);

    expect(resolved.range).toBe('custom');
    expect(resolved.current).toEqual({
      from: '1970-01-01',
      to: '1970-02-15',
      days: 46,
      start: instant('1969-12-31T23:00:00Z'),
      end: instant('1970-02-15T23:00:00Z'),
    });
    expect(resolved.previous).toEqual({
      from: '1969-11-16',
      to: '1969-12-31',
      days: 46,
      start: instant('1969-11-15T23:00:00Z'),
      end: instant('1969-12-31T23:00:00Z'),
    });
    expect(resolved.unit).toBe('week');
    expect(bucketsOf(resolved.current, 'week', PARIS).slice(0, 2).map((bucket) => [bucket.from, bucket.to, bucket.days])).toEqual([
      ['1970-01-01', '1970-01-04', 4], // jeudi à dimanche
      ['1970-01-05', '1970-01-11', 7],
    ]);
  });

  it.each([
    ['le 31 décembre 1969, le dernier jour d’avant', '1969-12-31'],
    ['en 1900', '1900-01-01'],
    ['en l’an 999', '0999-12-31'],
    ['en l’an 101', '0101-01-01'],
    ['le 1er janvier de l’an 100, dont la veille se calculait avec 1900 ans d’écart', '0100-01-01'],
    ['le 31 décembre de l’an 99', '0099-12-31'],
    ['en l’an 20', '0020-01-01'],
    ['le 29 février de l’an 4, bissextile', '0004-02-29'],
    ['en l’an 1', '0001-01-01'],
    ['en l’an 0', '0000-01-01'],
  ])('refuse une plage qui commence %s', (_, from) => {
    expect(refusal({ from, to: '1970-01-31' })).toBe(tooEarly(from));
    // Une plage courte, entièrement dans ces années-là : le message est le même.
    expect(refusal({ from, to: from })).toBe(tooEarly(from));
  });

  it('dit que la plage est trop ancienne, et non que le jour n’existe pas, pour les années 0 à 99 qui s’affichent dans la page', () => {
    // Les trois plages que la relecture de bdesk-38k.16 a fait refuser avec un message faux (ou calculer faux).
    expect(refusal({ from: '0020-01-01', to: '0020-01-31' })).toBe(tooEarly('0020-01-01'));
    expect(refusal({ from: '0000-01-01', to: '0000-01-31' })).toBe(tooEarly('0000-01-01'));
    expect(refusal({ from: '0100-01-01', to: '0100-01-31' })).toBe(tooEarly('0100-01-01'));
  });

  it('juge le début avant de compter les jours : une plage trop ancienne n’est jamais dite « trop longue »', () => {
    expect(refusal({ from: '0020-12-12', to: '2026-10-23' })).toBe(tooEarly('0020-12-12'));
    expect(refusal({ from: '1900-01-01', to: '2026-10-23' })).toBe(tooEarly('1900-01-01'));
    // Passé la borne, la longueur compte comme avant.
    expect(refusal({ from: '1970-01-01', to: '2026-10-23' })).toContain('trop longue');
  });

  it('dit d’abord qu’une plage est à l’envers ou dans le futur, avant de parler de la borne basse', () => {
    expect(refusal({ from: '0020-01-31', to: '0020-01-01' })).toContain('commence après sa fin');
    expect(refusal({ from: '0020-01-01', to: '2026-10-24' })).toContain('futur');
  });

  it('vérifie toujours qu’un jour existe dans les années 0 à 99 : le 29 février de l’an 4 existe, pas celui de l’an 100', () => {
    expect(refusal({ from: '0004-02-29', to: '0004-03-01' })).toBe(tooEarly('0004-02-29'));
    expect(refusal({ from: '0100-02-29', to: '0100-03-01' })).toContain('doit être un jour qui existe');
    expect(refusal({ from: '0020-02-30', to: '0020-03-01' })).toContain('doit être un jour qui existe');
    expect(refusal({ from: '0020-13-01', to: '0020-03-01' })).toContain('doit être un jour qui existe');
  });

  it('ne vaut que pour une plage personnalisée : un préréglage part d’aujourd’hui, jamais refusé', () => {
    // Une horloge au tout début de 1970 : les 90 derniers jours remontent avant la borne, ce que personne n'a choisi.
    const resolved = resolvePeriod({ range: '90d' }, instant('1970-01-10T12:00:00Z'), 'UTC');

    expect(resolved.range).toBe('90d');
    expect(resolved.current.days).toBe(90);
    expect(resolved.current.from < MIN_CUSTOM_DAY).toBe(true);
  });
});

describe('instant de mesure et période précédente à durée écoulée égale', () => {
  // Mardi 27 octobre 2026, 08:00 à Paris : la période en cours n'est qu'aux deux tiers de sa dernière journée.
  const morning = instant('2026-10-27T07:00:00Z');

  it('mesure une période qui court jusqu’à aujourd’hui à l’instant présent, et la précédente à la même durée écoulée', () => {
    const { current, previous, asOf, previousAsOf } = resolvePeriod({ range: '7d' }, morning, PARIS);

    expect(asOf).toBe(morning);
    expect(asOf - current.start).toBe(153 * HOUR); // 6 j 9 h, dont les 25 h du 25 octobre
    expect(previousAsOf - previous.start).toBe(153 * HOUR);
    expect(previousAsOf).toBe(instant('2026-10-20T07:00:00Z'));
    expect(previousAsOf).toBeLessThan(previous.end); // la précédente entière compterait 15 h de plus
  });

  it('traite pareil une plage personnalisée dont la fin est aujourd’hui', () => {
    const { current, previous, asOf, previousAsOf } = resolvePeriod({ from: '2026-10-14', to: '2026-10-27' }, morning, PARIS);

    expect(asOf).toBe(morning);
    expect(previousAsOf - previous.start).toBe(asOf - current.start);
  });

  it('mesure une période terminée à sa fin, et la compare à la précédente entière', () => {
    const { current, previous, asOf, previousAsOf } = resolvePeriod({ from: '2026-10-01', to: '2026-10-15' }, morning, PARIS);

    expect(asOf).toBe(current.end);
    expect(previousAsOf).toBe(previous.end);
  });

  it('ne dépasse jamais la fin de la période précédente : la période courante dure 169 h, la précédente 168 h', () => {
    // Le 25 octobre dure 25 h : du 23 au 29 octobre, 169 h ; du 16 au 22, 168 h. À 23:30 le 29, il s'est écoulé 168 h 30.
    const { current, previous, asOf, previousAsOf } = resolvePeriod({ range: '7d' }, instant('2026-10-29T22:30:00Z'), PARIS);

    expect(current.end - current.start).toBe(169 * HOUR);
    expect(previous.end - previous.start).toBe(168 * HOUR);
    expect(asOf - current.start).toBe(168.5 * HOUR);
    expect(previousAsOf).toBe(previous.end);
  });

  it('ne tronque pas la précédente d’une heure quand la période terminée contient un jour de 23 h', () => {
    // Du 25 au 31 mars, avec le passage à l'heure d'été du 29 : 167 h, contre 168 h du 18 au 24 mars.
    const { current, previous, asOf, previousAsOf } = resolvePeriod({ from: '2026-03-25', to: '2026-03-31' }, instant('2026-04-05T12:00:00Z'), PARIS);

    expect(current.end - current.start).toBe(167 * HOUR);
    expect(previous.end - previous.start).toBe(168 * HOUR);
    expect(asOf).toBe(current.end);
    expect(previousAsOf).toBe(previous.end);
  });

  it('commence la comparaison à vide quand la période commence à l’instant même', () => {
    const midnight = startOfDay('2026-10-27', PARIS);

    const { previous, asOf, previousAsOf } = resolvePeriod({ from: '2026-10-27', to: '2026-10-27' }, midnight, PARIS);

    expect(asOf).toBe(midnight);
    expect(previousAsOf).toBe(previous.start);
  });
});

describe('buckets', () => {
  const now = instant('2026-10-23T18:00:00Z');
  const bucketsFor = (spec: Parameters<typeof resolvePeriod>[0], at = now) => {
    const { current, unit } = resolvePeriod(spec, at, PARIS);
    return bucketsOf(current, unit, PARIS);
  };

  it('fait un bucket par jour jusqu’à 31 jours', () => {
    const buckets = bucketsFor({ range: '7d' });

    expect(buckets.map((b) => [b.from, b.to, b.days])).toEqual([
      ['2026-10-17', '2026-10-17', 1],
      ['2026-10-18', '2026-10-18', 1],
      ['2026-10-19', '2026-10-19', 1],
      ['2026-10-20', '2026-10-20', 1],
      ['2026-10-21', '2026-10-21', 1],
      ['2026-10-22', '2026-10-22', 1],
      ['2026-10-23', '2026-10-23', 1],
    ]);
  });

  it('fait un bucket par semaine commençant le lundi, tronqué aux bords de la période', () => {
    const buckets = bucketsFor({ range: '90d' }); // du dimanche 26 juillet au vendredi 23 octobre

    expect(buckets).toHaveLength(14);
    expect(buckets[0]).toMatchObject({ from: '2026-07-26', to: '2026-07-26', days: 1 }); // le dimanche, seul
    expect(buckets[1]).toMatchObject({ from: '2026-07-27', to: '2026-08-02', days: 7 }); // lundi à dimanche
    expect(buckets.at(-1)).toMatchObject({ from: '2026-10-19', to: '2026-10-23', days: 5 }); // lundi à vendredi
    expect(buckets.slice(1, -1).every((b) => b.days === 7)).toBe(true);
  });

  it('couvre la période sans trou ni recouvrement, à l’instant près', () => {
    for (const spec of [{ range: '7d' }, { range: '90d' }, { from: '2025-10-23', to: '2026-10-23' }] as const) {
      const { current } = resolvePeriod(spec, now, PARIS);
      const buckets = bucketsOf(current, resolvePeriod(spec, now, PARIS).unit, PARIS);

      expect(buckets[0]?.start).toBe(current.start);
      expect(buckets.at(-1)?.end).toBe(current.end);
      buckets.slice(1).forEach((bucket, i) => expect(bucket.start).toBe(buckets[i]?.end));
      expect(buckets.reduce((total, b) => total + b.days, 0)).toBe(current.days);
    }
  });

  it('mesure en heures réelles la semaine du changement d’heure : 169 h à Paris', () => {
    // Six semaines pleines, du lundi 21 septembre au dimanche 1er novembre : regroupées par semaine.
    const buckets = bucketsFor({ from: '2026-09-21', to: '2026-11-01' }, instant('2026-11-05T12:00:00Z'));
    const week = buckets.find((b) => b.from === '2026-10-19');

    expect(buckets).toHaveLength(6);
    expect(week).toMatchObject({ to: '2026-10-25', days: 7 });
    expect(((week?.end ?? 0) - (week?.start ?? 0)) / HOUR).toBe(169);
  });
});

describe('Âge calendaire entre deux instants', () => {
  // Les attendus viennent de zoneinfo (Python) : l'écart des heures du mur, pas le code testé.
  const DAY = 24 * HOUR;
  const elapsed = (from: string, to: string, timeZone = PARIS) => calendarElapsed(instant(from), instant(to), timeZone);

  it('vaut la durée réelle quand aucun changement d’heure ne s’intercale, et toujours en UTC et dans un fuseau à décalage fractionnaire', () => {
    expect(elapsed('2026-10-12T08:00:00Z', '2026-10-14T20:30:15.250Z')).toBe(2 * DAY + 12 * HOUR + 30 * 60_000 + 15_250);
    expect(elapsed('2026-10-20T10:00:00Z', '2026-11-03T11:00:00Z', 'UTC')).toBe(14 * DAY + HOUR);
    expect(elapsed('2026-10-20T10:00:00Z', '2026-11-03T11:00:00Z', 'Asia/Kolkata')).toBe(14 * DAY + HOUR); // UTC+5:30, sans changement d’heure
  });

  it('ne compte pas l’heure en plus du passage à l’heure d’hiver : du mardi 20 octobre 12:00 au mardi 3 novembre 12:00, 14 jours pile', () => {
    // 12:00 CEST (10:00Z) puis 12:00 CET (11:00Z) : 14 j 1 h sur l'horloge réelle.
    expect(elapsed('2026-10-20T10:00:00Z', '2026-11-03T11:00:00Z')).toBe(14 * DAY);
    expect(elapsed('2026-10-20T10:00:00Z', '2026-11-03T11:00:00.001Z')).toBe(14 * DAY + 1); // et la milliseconde suivante dépasse
  });

  it('ne retire pas l’heure en moins du passage à l’heure d’été : du mardi 17 mars 12:00 au mardi 31 mars 12:00, 14 jours pile', () => {
    // 12:00 CET (11:00Z) puis 12:00 CEST (10:00Z) : 13 j 23 h seulement sur l'horloge réelle.
    expect(elapsed('2026-03-17T11:00:00Z', '2026-03-31T10:00:00Z')).toBe(14 * DAY);
    expect(elapsed('2026-03-28T11:00:00Z', '2026-03-29T10:00:00Z')).toBe(DAY); // le jour de 23 h compte pour un jour
  });

  it('lit l’heure du mur des deux bouts, y compris le jour même du changement d’heure', () => {
    // Le dimanche 25 octobre dure 25 h : de minuit (CEST) à midi (CET), 12 h de mur pour 13 h réelles.
    expect(elapsed('2026-10-24T22:00:00Z', '2026-10-25T11:00:00Z')).toBe(12 * HOUR);
    // Du dimanche 25 octobre 12:00 CET au dimanche 8 novembre 12:00 CET : aucun changement d'heure entre les deux.
    expect(elapsed('2026-10-25T11:00:00Z', '2026-11-08T11:00:00Z')).toBe(14 * DAY);
    expect(elapsed('2026-10-25T11:00:00Z', '2026-11-08T11:30:00Z')).toBe(14 * DAY + 30 * 60_000);
  });

  it('suit le fuseau demandé, pas celui de l’environnement : Los Angeles change d’heure le 1er novembre', () => {
    // 25 octobre 12:00 PDT (19:00Z) au 8 novembre 12:00 PST (20:00Z).
    expect(elapsed('2026-10-25T19:00:00Z', '2026-11-08T20:00:00Z', 'America/Los_Angeles')).toBe(14 * DAY);
    expect(elapsed('2026-10-25T19:00:00Z', '2026-11-08T20:00:00Z', PARIS)).toBe(14 * DAY + HOUR); // à Paris : 20:00 puis 21:00 CET, sans changement d’heure entre les deux
  });

  it('suit un changement d’heure d’une demi-heure : Lord Howe, le 5 avril', () => {
    // 4 avril 12:00 (UTC+11) au 6 avril 12:00 (UTC+10:30) : 2 jours de mur, 2 j 30 min réelles.
    expect(elapsed('2026-04-04T01:00:00Z', '2026-04-06T01:30:00Z', 'Australia/Lord_Howe')).toBe(2 * DAY);
  });

  it('n’est jamais négatif : dans l’heure répétée de l’automne, 02:15 CET suit 02:45 CEST de 30 minutes réelles', () => {
    expect(elapsed('2026-10-25T00:45:00Z', '2026-10-25T01:15:00Z')).toBe(0);
    expect(elapsed('2026-10-25T12:00:00Z', '2026-10-24T12:00:00Z')).toBe(0); // et à l'envers
  });

  it('n’est pas croissant pendant l’heure répétée de l’automne : l’âge perd une heure quand les horloges reculent, puis la regagne', () => {
    // Devenu Prêt le dimanche 11 octobre à 02:30 CEST (00:30Z), mesuré la nuit du 25 octobre, où 03:00 CEST redevient 02:00 CET.
    const since = '2026-10-11T00:30:00Z';

    expect(elapsed(since, '2026-10-25T00:20:00Z')).toBe(14 * DAY - 10 * 60_000); // 02:20 CEST : pas encore 14 jours
    expect(elapsed(since, '2026-10-25T00:50:00Z')).toBe(14 * DAY + 20 * 60_000); // 02:50 CEST : 14 jours et 20 minutes
    expect(elapsed(since, '2026-10-25T01:10:00Z')).toBe(14 * DAY - 20 * 60_000); // 02:10 CET, 20 minutes réelles plus tard : 40 minutes de moins
    expect(elapsed(since, '2026-10-25T01:40:00Z')).toBe(14 * DAY + 10 * 60_000); // 02:40 CET : plus de 14 jours de nouveau
  });
});
