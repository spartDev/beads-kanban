/* global window, document, console, ResizeObserver, requestAnimationFrame */
/*
 * Outils communs aux cinq maquettes. Rien ici ne décide du design : chaque variante garde sa structure et ses styles.
 *   - formats : les règles de src/web/metrics/format.ts (virgule décimale, espace insécable, moins typographique) ;
 *   - indicateurs : valeur, période précédente, écart et ton (mieux, moins bien, neutre), comme src/web/metrics/trend.ts ;
 *   - liaisons : `data-b="chemin"` écrit une donnée, `data-trend="indicateur"` sa tendance, `data-icon="nom"` une icône ;
 *   - graphiques SVG, infobulle, tableau jumeau ;
 *   - bandeau pour passer d'une variante à l'autre (flèches gauche et droite du clavier).
 */
(function () {
  'use strict';

  const BD = window.BD;
  const NBSP = ' ';
  const NARROW = ' ';
  const MINUS = '−';
  const DASH = '—';
  const MIN = 60000;
  const HOUR = 60 * MIN;
  const DAY = 24 * HOUR;

  /* ---------- Formats ------------------------------------------------------------------------------------------- */

  const isNum = (value) => typeof value === 'number' && Number.isFinite(value);

  function group(text) {
    const parts = text.split(',');
    const grouped = parts[0].replace(/\B(?=(\d{3})+(?!\d))/g, NBSP);
    return parts.length > 1 ? grouped + ',' + parts[1] : grouped;
  }

  function dec(value, digits) {
    if (!isNum(value)) return DASH;
    const fixed = value.toFixed(digits === undefined ? 1 : digits);
    if (Number(fixed) === 0) return '0';
    const trimmed = fixed.includes('.') ? fixed.replace(/\.?0+$/, '') : fixed;
    return trimmed.replace('.', ',').replace('-', MINUS);
  }

  function int(value) {
    if (!isNum(value)) return DASH;
    const rounded = Math.round(value);
    return (rounded < 0 ? MINUS : '') + group(String(Math.abs(rounded)));
  }

  function signed(value, digits) {
    if (!isNum(value)) return DASH;
    const d = digits || 0;
    const rounded = Number(value.toFixed(d));
    if (rounded === 0) return '0';
    const magnitude = d === 0 ? int(Math.abs(rounded)) : group(dec(Math.abs(rounded), d));
    return (rounded > 0 ? '+' : MINUS) + magnitude;
  }

  function daysText(value) {
    const tenths = Math.round(value * 10) / 10;
    return tenths < 10 ? dec(tenths, 1) : String(Math.round(value));
  }

  /** « 37 min », « 15 h 10 », « 5,9 j » : arrondi à la minute avant de choisir l'unité. */
  function dur(ms) {
    if (!isNum(ms)) return DASH;
    const value = Math.max(0, ms);
    const minutes = Math.round(value / MIN);
    if (minutes < 1) return '<' + NBSP + '1' + NBSP + 'min';
    if (minutes < 60) return minutes + NBSP + 'min';
    if (minutes < 24 * 60) {
      const hours = Math.floor(minutes / 60);
      const rest = minutes % 60;
      return rest === 0 ? hours + NBSP + 'h' : hours + NBSP + 'h' + NBSP + String(rest).padStart(2, '0');
    }
    return daysText(value / DAY) + NBSP + 'j';
  }

  function sdur(ms) {
    if (!isNum(ms)) return DASH;
    if (Math.round(Math.abs(ms) / MIN) < 1) return '0' + NBSP + 'min';
    return (ms > 0 ? '+' : MINUS) + dur(Math.abs(ms));
  }

  function percentNumber(percent) {
    const rounded = Math.round(percent * 10) / 10;
    return rounded < 10 ? dec(rounded, 1) : String(Math.round(percent));
  }

  /** « 63 % » ; avec `precise`, une décimale partout (« 0,3 % »). */
  function pct(ratio, precise) {
    if (!isNum(ratio)) return DASH;
    return (precise ? dec(Math.round(ratio * 1000) / 10, 1) : percentNumber(ratio * 100)) + NBSP + '%';
  }

  function points(delta) {
    if (!isNum(delta)) return DASH;
    const value = delta * 100;
    if (Math.round(Math.abs(value) * 10) === 0) return '0' + NBSP + 'pt';
    const text = percentNumber(Math.abs(value));
    return (value > 0 ? '+' : MINUS) + text + NBSP + (Number(text.replace(',', '.')) >= 2 ? 'pts' : 'pt');
  }

  /** L'Efficacité du flux n'écrit « 100 % » que sans le moindre Blocage. */
  function efficiency(ratio) {
    const text = pct(ratio, true);
    return isNum(ratio) && ratio < 1 && text === '100' + NBSP + '%' ? '>' + NBSP + '99,9' + NBSP + '%' : text;
  }

  /** « 26 fois », « 3,7 fois » : un rapport dit simplement. */
  function times(ratio) {
    return dec(ratio, ratio >= 10 ? 0 : 1) + NBSP + 'fois';
  }

  const plural = (count, singular, many) => int(count) + NBSP + (count > 1 ? many || singular + 's' : singular);

  const MONTHS = ['janv.', 'févr.', 'mars', 'avr.', 'mai', 'juin', 'juil.', 'août', 'sept.', 'oct.', 'nov.', 'déc.'];
  const MONTHS_LONG = ['janvier', 'février', 'mars', 'avril', 'mai', 'juin', 'juillet', 'août', 'septembre', 'octobre', 'novembre', 'décembre'];
  const WEEKDAYS = ['dim.', 'lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.'];
  const WEEKDAYS_LONG = ['dimanche', 'lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi'];

  function dayParts(iso) {
    const [y, m, d] = iso.split('-').map(Number);
    return { y, m, d, wd: new Date(Date.UTC(y, m - 1, d)).getUTCDay() };
  }

  /** « 5 nov. », « jeu. 5 nov. », « jeudi 5 novembre », « 5 nov. 2026 ». */
  function day(iso, options) {
    const o = options || {};
    const p = dayParts(iso);
    return [
      o.weekday ? (o.long ? WEEKDAYS_LONG : WEEKDAYS)[p.wd] : '',
      o.long && p.d === 1 ? '1er' : String(p.d),
      (o.long ? MONTHS_LONG : MONTHS)[p.m - 1],
      o.year ? String(p.y) : '',
    ]
      .filter(Boolean)
      .join(' ');
  }

  function addDays(iso, count) {
    const p = dayParts(iso);
    return new Date(Date.UTC(p.y, p.m - 1, p.d + count)).toISOString().slice(0, 10);
  }

  /* ---------- DOM ----------------------------------------------------------------------------------------------- */

  const SVG_NS = 'http://www.w3.org/2000/svg';

  function setAttrs(node, attrs) {
    if (!attrs) return;
    Object.keys(attrs).forEach((key) => {
      const value = attrs[key];
      if (value === null || value === undefined || value === false) return;
      if (key === 'text') node.textContent = value;
      else node.setAttribute(key, value === true ? '' : String(value));
    });
  }

  const usable = (kid) => kid !== null && kid !== undefined && kid !== false;

  function h(tag, attrs, ...kids) {
    const node = document.createElement(tag);
    setAttrs(node, attrs);
    node.append(...kids.flat().filter(usable));
    return node;
  }

  function s(tag, attrs, ...kids) {
    const node = document.createElementNS(SVG_NS, tag);
    setAttrs(node, attrs);
    node.append(...kids.flat().filter(usable));
    return node;
  }

  /**
   * Un nombre avec ses unités (« 15 h 10 », « 63 % ») : les unités sont dans des `span.u`, que chaque variante peut écrire
   * plus petit. Entre un nombre et son unité, une espace fine insécable.
   */
  function withUnits(text) {
    const fragment = document.createDocumentFragment();
    text.split(NBSP).forEach((token, index) => {
      if (index > 0) fragment.append(NARROW);
      if (/^(h|j|min|%|pts?|<|>)$/.test(token)) fragment.append(h('span', { class: 'u', text: token }));
      else fragment.append(token);
    });
    return fragment;
  }

  const ICONS = {
    search: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    grid: '<rect x="3" y="3" width="7" height="7" rx="1.5"/><rect x="14" y="3" width="7" height="7" rx="1.5"/><rect x="3" y="14" width="7" height="7" rx="1.5"/><rect x="14" y="14" width="7" height="7" rx="1.5"/>',
    eye: '<path d="M2 12s3.6-7 10-7 10 7 10 7-3.6 7-10 7-10-7-10-7Z"/><circle cx="12" cy="12" r="3"/>',
    refresh: '<path d="M21 12a9 9 0 1 1-2.64-6.36"/><path d="M21 3v6h-6"/>',
    copy: '<rect x="9" y="9" width="12" height="12" rx="2"/><path d="M5 15H4a2 2 0 0 1-2-2V4a2 2 0 0 1 2-2h9a2 2 0 0 1 2 2v1"/>',
    right: '<path d="m9 18 6-6-6-6"/>',
    down: '<path d="m6 9 6 6 6-6"/>',
    up: '<path d="M12 19V5"/><path d="m5 12 7-7 7 7"/>',
    drop: '<path d="M12 5v14"/><path d="m19 12-7 7-7-7"/>',
    flat: '<path d="M5 12h14"/>',
    check: '<path d="M20 6 9 17l-5-5"/>',
    alert: '<path d="M10.3 3.9 1.8 18a2 2 0 0 0 1.7 3h17a2 2 0 0 0 1.7-3L13.7 3.9a2 2 0 0 0-3.4 0Z"/><path d="M12 9v4"/><path d="M12 17h.01"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 16v-4"/><path d="M12 8h.01"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.2a2.6 2.6 0 0 1 5 .8c0 1.7-2.5 2.3-2.5 4"/><path d="M12 17.2h.01"/>',
    clock: '<circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2"/><path d="M12 20v2"/><path d="m4.9 4.9 1.4 1.4"/><path d="m17.7 17.7 1.4 1.4"/><path d="M2 12h2"/><path d="M20 12h2"/><path d="m6.3 17.7-1.4 1.4"/><path d="m19.1 4.9-1.4 1.4"/>',
    moon: '<path d="M12 3a6 6 0 0 0 9 9 9 9 0 1 1-9-9Z"/>',
    screen: '<rect x="2" y="4" width="20" height="13" rx="2"/><path d="M8 21h8"/><path d="M12 17v4"/>',
    keyboard: '<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01"/><path d="M10 10h.01"/><path d="M14 10h.01"/><path d="M18 10h.01"/><path d="M7 14h10"/>',
    columns: '<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M9 3v18"/><path d="M15 3v18"/>',
    pause: '<path d="M9 5v14"/><path d="M15 5v14"/>',
    menu: '<path d="M4 7h16"/><path d="M4 12h16"/><path d="M4 17h16"/>',
  };

  function icon(name, size) {
    const px = Number(size) || 18;
    const node = s('svg', {
      class: 'ic ic-' + name,
      viewBox: '0 0 24 24',
      width: px,
      height: px,
      fill: 'none',
      stroke: 'currentColor',
      'stroke-width': 2,
      'stroke-linecap': 'round',
      'stroke-linejoin': 'round',
      'aria-hidden': 'true',
    });
    node.innerHTML = ICONS[name] || '';
    return node;
  }

  /* ---------- Indicateurs : valeur, période précédente, écart, ton --------------------------------------------- */

  /** Ton d'un écart : `good`, `bad`, `neutral` (une grandeur sans bon ni mauvais sens) ou `flat` (stable). */
  function toneOf(delta, polarity, eps) {
    if (!isNum(delta) || Math.abs(delta) < eps) return 'flat';
    if (polarity === 'neutral') return 'neutral';
    return (polarity === 'up' ? delta > 0 : delta < 0) ? 'good' : 'bad';
  }

  function metric(def) {
    const delta = isNum(def.now) && isNum(def.prev) ? def.now - def.prev : null;
    const tone = toneOf(delta, def.polarity, def.eps);
    const dir = tone === 'flat' ? 'flat' : delta > 0 ? 'up' : 'down';
    const words = def.words || ['en hausse', 'en baisse'];
    return Object.assign({}, def, {
      delta,
      tone,
      dir,
      /* La direction, en mots : « en hausse », « plus lent », « stable ». */
      word: tone === 'flat' ? 'stable' : dir === 'up' ? words[0] : words[1],
      /* Le jugement, quand la grandeur a un bon sens : « mieux », « moins bien ». */
      judgment: tone === 'good' ? 'mieux' : tone === 'bad' ? 'moins bien' : '',
      verdict: tone === 'good' ? 'En progrès' : tone === 'bad' ? 'En recul' : tone === 'flat' ? 'Stable' : dir === 'up' ? 'En hausse' : 'En baisse',
      t: { now: def.f(def.now), prev: def.f(def.prev), delta: tone === 'flat' ? 'stable' : def.fd(delta) },
    });
  }

  const FASTER = ['plus lent', 'plus rapide'];
  const DURATION = { f: dur, fd: sdur, polarity: 'down', eps: MIN / 2, words: FASTER };
  const RATE = { f: (v) => pct(v, true), fd: points, polarity: 'down', eps: 0.0005 };

  const balanceNow = BD.arrivals.value - BD.debit.value;
  const balancePrev = BD.arrivals.prev - BD.debit.prev;

  const M = {
    debit: metric({ name: 'Débit', help: 'Les tickets livrés sur la période.', now: BD.debit.value, prev: BD.debit.prev, f: int, fd: signed, polarity: 'up', eps: 0.5 }),
    arrivals: metric({ name: 'Arrivées', help: 'Les tickets créés sur la période.', now: BD.arrivals.value, prev: BD.arrivals.prev, f: int, fd: signed, polarity: 'neutral', eps: 0.5 }),
    balance: metric({
      name: 'Arrivées moins Débit',
      help: 'Tickets créés moins tickets livrés. Négatif, le stock de travail se résorbe.',
      now: balanceNow,
      prev: balancePrev,
      f: signed,
      fd: signed,
      polarity: 'neutral',
      eps: 0.5,
    }),
    leadMedian: metric(Object.assign({ name: 'Lead Time', help: 'De la création d’un ticket à sa Livraison, attentes comprises.', now: BD.lead.median, prev: BD.lead.medianPrev }, DURATION)),
    leadP85: metric(Object.assign({ name: 'Lead Time, P85', help: '85 % des tickets sont livrés en moins de temps que cela.', now: BD.lead.p85, prev: BD.lead.p85Prev }, DURATION)),
    cycleMedian: metric(Object.assign({ name: 'Cycle Time', help: 'Le temps de travail, du premier démarrage à la Livraison.', now: BD.cycle.median, prev: BD.cycle.medianPrev }, DURATION)),
    cycleP85: metric(Object.assign({ name: 'Cycle Time, P85', help: '85 % des tickets demandent moins de travail que cela.', now: BD.cycle.p85, prev: BD.cycle.p85Prev }, DURATION)),
    recoveryMedian: metric(
      Object.assign({ name: 'Temps de rétablissement', help: 'Le Lead Time des bugs critiques (P0 et P1).', now: BD.recovery.median, prev: BD.recovery.medianPrev }, DURATION),
    ),
    recoveryP85: metric(Object.assign({ name: 'Temps de rétablissement, P85', help: '85 % des bugs critiques sont rétablis plus vite.', now: BD.recovery.p85, prev: BD.recovery.p85Prev }, DURATION)),
    wipAvg: metric({
      name: 'WIP',
      help: 'Les tickets en cours en même temps, en moyenne sur la période.',
      now: BD.wip.avg,
      prev: BD.wip.avgPrev,
      f: (v) => dec(v, 1),
      fd: (v) => signed(v, 1),
      polarity: 'neutral',
      eps: 0.05,
    }),
    efficiency: metric({
      name: 'Efficacité du flux',
      help: 'La part du Cycle Time passée hors Blocage.',
      now: BD.efficiency.ratio,
      prev: BD.efficiency.prev,
      f: efficiency,
      fd: points,
      polarity: 'up',
      eps: 0.0005,
    }),
    reopening: metric(Object.assign({ name: 'Taux de Réouverture', help: 'La part des clôtures suivies d’une Réouverture.', now: BD.reopening.rate, prev: BD.reopening.prev }, RATE)),
    abandon: metric(
      Object.assign({ name: 'Taux d’abandon', help: 'La part des tickets fermés comme doublon ou remplacés.', now: BD.abandon.rate, prev: BD.abandon.prev }, RATE, { polarity: 'neutral' }),
    ),
    stagnant: metric({
      name: 'Prêts qui stagnent',
      help: 'Les tickets Prêts depuis plus de 14 jours sans être démarrés.',
      now: BD.ready.stagnant,
      prev: BD.ready.stagnantPrev,
      f: int,
      fd: signed,
      polarity: 'down',
      eps: 0.5,
    }),
  };

  /* ---------- Valeurs dérivées, pour les phrases ---------------------------------------------------------------- */

  const year = BD.period.to.slice(0, 4);
  const peakIndex = BD.daily.deliveries.indexOf(Math.max(...BD.daily.deliveries));
  const peakWeek = BD.weekly.reduce((best, week) => (week.throughput > best.throughput ? week : best), BD.weekly[0]);
  const b = BD.breakdown;
  const readable = BD.projects.filter((project) => project.status === 'ok');
  const countKind = (kind) => BD.signals.filter((signal) => signal.kind === kind).length;

  const X = {
    periodLabel: day(BD.period.from) + ' – ' + day(BD.period.to, { year: true }),
    periodLong: 'du ' + day(BD.period.from, { long: true }) + ' au ' + day(BD.period.to, { long: true }) + ' ' + year,
    prevLabel: day(BD.previous.from) + ' – ' + day(BD.previous.to),
    readable: readable.length,
    unreadable: BD.projects.length - readable.length,
    projectCount: BD.projects.length,
    debitTimes: times(BD.debit.value / BD.debit.prev),
    leadTimes: times(BD.lead.median / BD.lead.medianPrev),
    shares: {
      dependency: b.dependencyWait / b.total,
      ready: b.readyWait / b.total,
      work: b.work / b.total,
      blocked: b.blocked / b.total,
      other: b.otherWait / b.total,
    },
    waitShare: (b.dependencyWait + b.readyWait + b.otherWait) / b.total,
    peakDay: { index: peakIndex, value: BD.daily.deliveries[peakIndex], iso: addDays(BD.period.from, peakIndex) },
    peakWeek: { value: peakWeek.throughput, iso: peakWeek.from },
    signals: {
      total: BD.signals.length,
      drift: countKind('drift'),
      longBlockage: countKind('longBlockage'),
      stagnantReady: countKind('stagnantReady'),
      unusualWip: countKind('unusualWip'),
    },
    tones: Object.keys(M).reduce((counts, key) => {
      counts[M[key].tone] = (counts[M[key].tone] || 0) + 1;
      return counts;
    }, {}),
  };
  X.peakDay.label = day(X.peakDay.iso, { weekday: true, long: true });
  X.peakWeek.label = day(X.peakWeek.iso, { long: true });

  BD.x = X;
  BD.m = M;

  /* ---------- Listes : Projets, tickets, Signaux ----------------------------------------------------------------- */

  const project = (id) => BD.projects.find((candidate) => candidate.id === id) || { id, name: id, prefix: id, hue: 255 };

  /** Les deux lettres de la pastille d'un Projet. */
  function initials(name) {
    const words = name.split(/[-_\s.]+/).filter(Boolean);
    const letters = words.length > 1 ? words[0][0] + words[1][0] : (words[0] || '?').slice(0, 2);
    return letters.toUpperCase();
  }

  const SIGNAL_KINDS = [
    { kind: 'drift', label: 'Dérive', many: 'Dérives', help: 'Un ticket en cours depuis plus longtemps que la normale.' },
    { kind: 'longBlockage', label: 'Blocage long', many: 'Blocages longs', help: 'Un ticket bloqué en cours de travail depuis plus de 3 jours.' },
    { kind: 'stagnantReady', label: 'Prêt qui stagne', many: 'Prêts qui stagnent', help: 'Un ticket Prêt depuis plus de 14 jours sans être démarré.' },
    { kind: 'unusualWip', label: 'WIP inhabituel', many: 'WIP inhabituels', help: 'Plus de tickets en cours que d’habitude dans un Projet.' },
  ];

  /** Ce que dit un Signal : de combien il dépasse la normale. */
  function signalText(signal) {
    if (signal.kind === 'drift') return dur(signal.cycleTime) + ' de travail en cours, au-delà de ' + dur(signal.reference) + ', le P85 des Livraisons du même type';
    if (signal.kind === 'longBlockage') return 'bloqué en cours de travail depuis ' + dur(signal.duration);
    if (signal.kind === 'stagnantReady') return 'Prêt depuis ' + dur(signal.age);
    return signal.wip + ' tickets en cours, au-delà de ' + dec(signal.threshold, 1) + ', le P85 du WIP quotidien des 90 derniers jours';
  }

  /** Les Signaux groupés par sorte, sans les sortes vides. */
  function signalGroups() {
    return SIGNAL_KINDS.map((entry) => Object.assign({}, entry, { items: BD.signals.filter((signal) => signal.kind === entry.kind) })).filter((entry) => entry.items.length > 0);
  }

  /** Les champs d'un Signal pour un gabarit : titre, identifiant, Projet, phrase. */
  function signalFields(signal) {
    const owner = project(signal.project);
    return {
      title: signal.ticket ? signal.ticket.title : owner.name,
      id: signal.ticket ? signal.ticket.id : null,
      project: signal.ticket ? owner.name : null,
      detail: signalText(signal),
      kind: SIGNAL_KINDS.find((entry) => entry.kind === signal.kind).label,
      type: signal.ticket ? signal.ticket.type : null,
      prio: signal.ticket ? 'P' + signal.ticket.priority : null,
    };
  }

  /* ---------- Liaisons ------------------------------------------------------------------------------------------- */

  const FORMATS = {
    int,
    signed,
    dec1: (v) => dec(v, 1),
    dur: (v) => withUnits(dur(v)),
    sdur: (v) => withUnits(sdur(v)),
    pct: (v) => withUnits(pct(v)),
    pct1: (v) => withUnits(pct(v, true)),
    efficiency: (v) => withUnits(efficiency(v)),
    units: (v) => withUnits(String(v)),
    text: (v) => String(v),
  };

  function lookup(path) {
    return path.split('.').reduce((value, key) => (value === null || value === undefined ? undefined : value[key]), BD);
  }

  /** La tendance d'un indicateur : flèche, écart, valeur d'avant, et le ton en attribut pour les styles. */
  function trend(node, key) {
    const m = M[key];
    if (!m) {
      console.warn('[maquette] indicateur inconnu :', key);
      return;
    }
    node.classList.add('trend');
    node.dataset.tone = m.tone;
    node.dataset.dir = m.dir;
    const arrow = m.dir === 'up' ? 'up' : m.dir === 'down' ? 'drop' : 'flat';
    const kids = [h('span', { class: 'trend-ic' }, icon(arrow, 14))];
    if (node.dataset.word !== undefined) {
      // En mots : « plus lent de 11 h 03 », « en hausse de 4 », « stable ».
      kids.push(h('span', { class: 'trend-word', text: m.word }));
      if (m.tone !== 'flat') kids.push(h('span', { class: 'trend-delta' }, 'de' + NBSP, withUnits(m.t.delta.replace(/^[+\u2212]/, ''))));
    } else {
      kids.push(h('span', { class: 'trend-delta' }, withUnits(m.t.delta)));
    }
    if (m.judgment) kids.push(h('span', { class: 'sr-only', text: ' (' + m.judgment + ')' }));
    if (node.dataset.prev !== 'none') kids.push(h('span', { class: 'trend-prev' }, 'avant' + NBSP, withUnits(m.t.prev)));
    node.replaceChildren(...kids);
  }

  /** Écrit les données, les tendances et les icônes déclarées dans `root`. */
  function hydrate(root) {
    const scope = root || document;
    scope.querySelectorAll('[data-icon]').forEach((node) => node.replaceWith(icon(node.dataset.icon, node.dataset.size)));
    scope.querySelectorAll('[data-b]').forEach((node) => {
      const value = lookup(node.dataset.b);
      if (value === undefined) {
        console.warn('[maquette] donnée introuvable :', node.dataset.b);
        node.textContent = DASH;
        return;
      }
      const format = FORMATS[node.dataset.f || (typeof value === 'number' ? 'int' : 'text')];
      if (!format) {
        console.warn('[maquette] format inconnu :', node.dataset.f);
        return;
      }
      node.replaceChildren(format(value));
    });
    scope.querySelectorAll('[data-trend]').forEach((node) => trend(node, node.dataset.trend));
  }

  /**
   * Répète un gabarit (`<template>`) pour chaque élément d'une liste. `fill(item, index)` rend les champs : chaque
   * `[data-t="champ"]` reçoit son texte (ou un nœud, ou une liste de nœuds), et disparaît si le champ est vide ; chaque `[data-v="champ"]` reçoit
   * la variable CSS `--v`. Le champ `$` pose des attributs sur la racine.
   */
  function repeat(target, template, items, fill) {
    const host = typeof target === 'string' ? document.querySelector(target) : target;
    const source = typeof template === 'string' ? document.getElementById(template) : template;
    if (!host || !source) {
      console.warn('[maquette] gabarit ou cible introuvable :', target, template);
      return;
    }
    items.forEach((item, index) => {
      const node = source.content.firstElementChild.cloneNode(true);
      const fields = fill(item, index) || {};
      [node, ...node.querySelectorAll('[data-t], [data-v]')].forEach((part) => {
        if (part.dataset.v !== undefined && fields[part.dataset.v] !== undefined) part.style.setProperty('--v', fields[part.dataset.v]);
        if (part.dataset.t === undefined) return;
        const value = fields[part.dataset.t];
        if (!usable(value) || value === '') part.remove();
        else if (value instanceof window.Node) part.replaceChildren(value);
        else if (Array.isArray(value)) part.replaceChildren(...value.filter(usable));
        else part.textContent = value;
      });
      Object.keys(fields.$ || {}).forEach((name) => {
        if (usable(fields.$[name])) node.setAttribute(name, fields.$[name]);
      });
      hydrate(node);
      host.append(node);
    });
  }

  /* ---------- Graphiques ----------------------------------------------------------------------------------------- */

  /** Dessine dans `node` à sa largeur, et redessine quand elle change : le texte garde sa taille. */
  function mount(target, render) {
    const node = typeof target === 'string' ? document.querySelector(target) : target;
    if (!node) {
      console.warn('[maquette] graphique sans cible :', target);
      return;
    }
    let last = 0;
    const draw = () => {
      const width = Math.floor(node.clientWidth);
      if (!width || width === last) return;
      last = width;
      node.replaceChildren(render(width));
    };
    draw();
    if ('ResizeObserver' in window) new ResizeObserver(() => requestAnimationFrame(draw)).observe(node);
  }

  function niceStep(max, count) {
    const raw = max / count;
    const power = Math.pow(10, Math.floor(Math.log10(raw)));
    const fraction = raw / power;
    return Math.max(1, (fraction <= 1 ? 1 : fraction <= 2 ? 2 : fraction <= 5 ? 5 : 10) * power);
  }

  const r1 = (value) => Math.round(value * 10) / 10;

  /** Garde une étiquette sur `every`, en partant de `start`. */
  const sparse = (labels, every, start) => labels.map((label, index) => ((index - (start || 0)) % every === 0 && index >= (start || 0) ? label : ''));

  function scaleY(values, height, pad, ticks, forcedMax) {
    const top = forcedMax || Math.max(1, ...values);
    const step = niceStep(top, ticks || 3);
    const max = Math.ceil(top / step) * step;
    const inner = height - pad.t - pad.b;
    return { max, step, y: (value) => r1(pad.t + inner - (value / max) * inner) };
  }

  function drawGrid(root, scale, pad, width) {
    for (let value = scale.step; value <= scale.max + 1e-9; value += scale.step) {
      root.append(s('line', { class: 'bd-grid', x1: pad.l, x2: width - pad.r, y1: scale.y(value), y2: scale.y(value) }));
      if (pad.l >= 20) root.append(s('text', { class: 'bd-tick', x: pad.l - 8, y: scale.y(value) + 4, 'text-anchor': 'end', text: int(value) }));
    }
    if (pad.l >= 20) root.append(s('text', { class: 'bd-tick', x: pad.l - 8, y: scale.y(0) + 4, 'text-anchor': 'end', text: '0' }));
  }

  /**
   * Colonnes : une série, une teinte. Bout arrondi côté donnée, pied carré sur l'axe, 24 px d'épaisseur au plus.
   * `o.values`, `o.labels` (une par colonne, vide pour la taire), `o.tips`, `o.cls(index)` (classe de plus : `is-partial`,
   * `is-quiet`), `o.marks` (index des colonnes dont la valeur est écrite).
   */
  function columns(width, o) {
    const height = o.height || 200;
    const pad = Object.assign({ t: o.marks ? 22 : 10, r: 2, b: 26, l: 32 }, o.pad);
    const scale = scaleY(o.values, height, pad, o.ticks, o.max);
    const band = (width - pad.l - pad.r) / o.values.length;
    const thick = Math.max(2, Math.min(o.barMax || 24, band - (o.gap === undefined ? 2 : o.gap)));
    const root = s('svg', { viewBox: '0 0 ' + width + ' ' + height, width, height, role: 'img', 'aria-label': o.label || '' });
    if (o.grid !== false) drawGrid(root, scale, pad, width);
    const base = scale.y(0);
    o.values.forEach((value, index) => {
      const left = pad.l + band * index;
      const x = r1(left + (band - thick) / 2);
      const col = s('g', { class: 'bd-col', 'data-tip': o.tips ? o.tips[index] : null });
      col.append(s('rect', { class: 'bd-hit', x: r1(left), y: pad.t, width: r1(band), height: base - pad.t }));
      if (value > 0) {
        const top = Math.min(scale.y(value), base - 2);
        const radius = Math.min(o.radius === undefined ? 4 : o.radius, thick / 2, base - top);
        const right = r1(x + thick);
        col.append(
          s('path', {
            class: 'bd-bar' + (o.cls && o.cls(index) ? ' ' + o.cls(index) : ''),
            d: 'M' + x + ',' + base + 'V' + r1(top + radius) + 'Q' + x + ',' + top + ' ' + r1(x + radius) + ',' + top + 'H' + r1(right - radius) + 'Q' + right + ',' + top + ' ' + right + ',' + r1(top + radius) + 'V' + base + 'Z',
          }),
        );
        if (o.marks && o.marks.includes(index)) col.append(s('text', { class: 'bd-mark', x: r1(x + thick / 2), y: top - 7, 'text-anchor': 'middle', text: int(value) }));
      }
      root.append(col);
      if (o.labels && o.labels[index]) root.append(s('text', { class: 'bd-xlabel', x: r1(left + band / 2), y: height - 7, 'text-anchor': 'middle', text: o.labels[index] }));
    });
    root.append(s('line', { class: 'bd-axis', x1: pad.l, x2: width - pad.r, y1: base, y2: base }));
    return root;
  }

  /** Courbe d'une série, avec son aplat léger et un point au bout. Le survol trouve le jour, pas la ligne. */
  function areaLine(width, o) {
    const height = o.height || 160;
    const pad = Object.assign({ t: 12, r: 8, b: 26, l: 32 }, o.pad);
    const scale = scaleY(o.values, height, pad, o.ticks, o.max);
    const count = o.values.length;
    const inner = width - pad.l - pad.r;
    const x = (index) => r1(pad.l + (inner * index) / (count - 1));
    const base = scale.y(0);
    const points = o.values.map((value, index) => x(index) + ',' + scale.y(value));
    const root = s('svg', { viewBox: '0 0 ' + width + ' ' + height, width, height, role: 'img', 'aria-label': o.label || '' });
    if (o.grid !== false) drawGrid(root, scale, pad, width);
    root.append(s('path', { class: 'bd-area', d: 'M' + points.join('L') + 'L' + x(count - 1) + ',' + base + 'L' + x(0) + ',' + base + 'Z' }));
    root.append(s('path', { class: 'bd-line', d: 'M' + points.join('L') }));
    root.append(s('circle', { class: 'bd-dot', cx: x(count - 1), cy: scale.y(o.values[count - 1]), r: 4.5 }));
    const band = inner / (count - 1);
    o.values.forEach((value, index) => {
      const col = s('g', { class: 'bd-col', 'data-tip': o.tips ? o.tips[index] : null });
      col.append(s('rect', { class: 'bd-hit', x: r1(x(index) - band / 2), y: pad.t, width: r1(band), height: base - pad.t }));
      root.append(col);
      if (o.labels && o.labels[index]) root.append(s('text', { class: 'bd-xlabel', x: x(index), y: height - 7, 'text-anchor': 'middle', text: o.labels[index] }));
    });
    root.append(s('line', { class: 'bd-axis', x1: pad.l, x2: width - pad.r, y1: base, y2: base }));
    return root;
  }

  /** Petite courbe sans axes, à côté d'un chiffre. */
  function spark(values, options) {
    const o = options || {};
    const width = o.w || 120;
    const height = o.h || 36;
    const pad = 4;
    const max = Math.max(1, ...values);
    const x = (index) => r1(pad + ((width - 2 * pad) * index) / (values.length - 1));
    const y = (value) => r1(height - pad - ((height - 2 * pad) * value) / max);
    const points = values.map((value, index) => x(index) + ',' + y(value));
    const last = values.length - 1;
    return s(
      'svg',
      { class: 'bd-spark', viewBox: '0 0 ' + width + ' ' + height, width, height, 'aria-hidden': 'true' },
      o.area === false ? null : s('path', { class: 'bd-area', d: 'M' + points.join('L') + 'L' + x(last) + ',' + (height - pad) + 'L' + x(0) + ',' + (height - pad) + 'Z' }),
      s('path', { class: 'bd-line', d: 'M' + points.join('L') }),
      s('circle', { class: 'bd-dot', cx: x(last), cy: y(values[last]), r: 4 }),
    );
  }

  /**
   * Barre segmentée : un tout découpé en parts (`{ key, label, value, text }`). Chaque part écrit sa proportion si elle en
   * a la place ; l'infobulle et la légende de la variante disent le reste.
   */
  function segments(parts, options) {
    const o = options || {};
    const total = parts.reduce((sum, part) => sum + part.value, 0);
    const root = h('div', { class: 'bd-seg', role: 'img', 'aria-label': o.label || '' });
    parts.forEach((part) => {
      const share = part.value / total;
      if (share < 0.002) return;
      const node = h('div', { class: 'bd-seg-part', 'data-key': part.key, style: 'flex:' + (share * 1000).toFixed(1) + ' 1 0', 'data-tip': part.text + '\n' + part.label });
      if (share >= (o.minLabelShare || 0.09)) node.append(h('span', null, withUnits(pct(share))));
      root.append(node);
    });
    return root;
  }

  /** Les cinq parts du Lead Time, dans l'ordre du parcours d'un ticket. */
  function breakdownParts() {
    const share = X.shares;
    const part = (key, label, value, ratio) => ({ key, label, value, share: ratio, text: pct(ratio) + ', soit ' + dur(value) });
    return [
      part('dependency', 'Attente de dépendance', b.dependencyWait, share.dependency),
      part('ready', 'Attente en Prêt', b.readyWait, share.ready),
      part('other', 'Autre attente', b.otherWait, share.other),
      part('work', 'Travail', b.work, share.work),
      part('blocked', 'Blocage', b.blocked, share.blocked),
    ];
  }

  /** Carte d'activité : 7 jours par 24 heures, une seule teinte. La racine carrée laisse voir les petites valeurs. */
  function heat(cells, options) {
    const o = options || {};
    const max = Math.max(1, ...cells.flat());
    const names = ['lun.', 'mar.', 'mer.', 'jeu.', 'ven.', 'sam.', 'dim.'];
    const full = ['lundi', 'mardi', 'mercredi', 'jeudi', 'vendredi', 'samedi', 'dimanche'];
    const root = h('div', { class: 'bd-heat', role: 'img', 'aria-label': o.label || '' });
    cells.forEach((row, d) => {
      root.append(h('span', { class: 'bd-heat-day', text: names[d] }));
      row.forEach((value, hour) => {
        root.append(h('i', { class: 'bd-heat-cell', style: '--v:' + Math.sqrt(value / max).toFixed(3), 'data-tip': plural(value, 'Transition') + '\n' + full[d] + ', ' + hour + NBSP + 'h' }));
      });
    });
    root.append(h('span'));
    [0, 3, 6, 9, 12, 15, 18, 21].forEach((hour) => root.append(h('span', { class: 'bd-heat-hour', text: hour + NBSP + 'h' })));
    return root;
  }

  /** Le tableau jumeau d'un graphique, replié : les valeurs sans survol. */
  function dataTable(headers, rows) {
    return h(
      'details',
      { class: 'bd-data' },
      h('summary', { text: 'Données du graphique' }),
      h(
        'div',
        { class: 'bd-data-scroll' },
        h(
          'table',
          null,
          h('thead', null, h('tr', null, headers.map((text) => h('th', { scope: 'col', text })))),
          h('tbody', null, rows.map((row) => h('tr', null, row.map((text, index) => h(index === 0 ? 'th' : 'td', index === 0 ? { scope: 'row', text } : { text }))))),
        ),
      ),
    );
  }

  /* Les séries prêtes à dessiner, avec leurs étiquettes. */
  const dailyDays = BD.daily.deliveries.map((_, index) => addDays(BD.period.from, index));
  const series = {
    daily: {
      days: dailyDays,
      /** Une étiquette par lundi : « 19 oct. ». */
      mondays: dailyDays.map((iso) => (dayParts(iso).wd === 1 ? day(iso) : '')),
      tips: (values, noun, many) => values.map((value, index) => plural(value, noun, many) + '\n' + day(dailyDays[index], { weekday: true }) + (index === values.length - 1 ? ', jour en cours' : '')),
      rows: () => dailyDays.map((iso, index) => [day(iso, { weekday: true }), int(BD.daily.deliveries[index]), int(BD.daily.arrivals[index])]),
      wip: BD.daily.inProgress.map((value, index) => value + BD.daily.blocked[index]),
    },
    weekly: {
      throughput: BD.weekly.map((week) => week.throughput),
      labels: BD.weekly.map((week) => day(week.from)),
      tips: BD.weekly.map((week) => plural(week.throughput, 'Livraison') + '\nsemaine du ' + day(week.from) + (week.partial ? ', en cours' : '')),
      rows: () => BD.weekly.map((week) => ['Semaine du ' + day(week.from) + (week.partial ? ' (en cours)' : ''), int(week.throughput), week.leadP85 === null ? DASH : dur(week.leadP85)]),
    },
  };

  /* ---------- Infobulle ------------------------------------------------------------------------------------------ */

  const tip = h('div', { class: 'bd-tip', role: 'tooltip', hidden: true });
  let tipOwner = null;

  function placeTip(x, y) {
    const box = tip.getBoundingClientRect();
    const left = Math.min(Math.max(8, x + 14), window.innerWidth - box.width - 8);
    const top = y + 18 + box.height > window.innerHeight - 8 ? y - box.height - 12 : y + 18;
    tip.style.left = left + 'px';
    tip.style.top = Math.max(8, top) + 'px';
  }

  function showTip(owner, x, y) {
    if (owner !== tipOwner) {
      tipOwner = owner;
      const lines = owner.getAttribute('data-tip').split('\n');
      tip.replaceChildren(h('strong', { text: lines[0] }), ...lines.slice(1).map((text) => h('span', { text })));
      tip.hidden = false;
    }
    placeTip(x, y);
  }

  function hideTip() {
    tipOwner = null;
    tip.hidden = true;
  }

  function startTips() {
    document.body.append(tip);
    document.addEventListener('pointermove', (event) => {
      const owner = event.target instanceof window.Element ? event.target.closest('[data-tip]') : null;
      if (owner) showTip(owner, event.clientX, event.clientY);
      else if (tipOwner) hideTip();
    });
    document.documentElement.addEventListener('mouseleave', hideTip);
    document.addEventListener('focusin', (event) => {
      const owner = event.target instanceof window.Element ? event.target.closest('[data-tip]') : null;
      if (!owner) return;
      const box = owner.getBoundingClientRect();
      showTip(owner, box.left + box.width / 2, box.bottom - 12);
    });
    document.addEventListener('focusout', hideTip);
    window.addEventListener('scroll', hideTip, true);
  }

  /* ---------- Bandeau des variantes ------------------------------------------------------------------------------ */

  const VARIANTS = [
    { file: '1-le-fil.html', name: 'Le fil' },
    { file: '2-grands-chiffres.html', name: 'Grands chiffres' },
    { file: '3-le-point.html', name: 'Le point' },
    { file: '4-bilan.html', name: 'Bilan' },
    { file: '5-nuit.html', name: 'Nuit' },
  ];

  function startSwitch() {
    const current = Number(document.body.dataset.variant) - 1;
    if (!(current >= 0)) return;
    // Dans la page de comparaison, la variante est dans un cadre : c'est la page qui change de variante, et les flèches du clavier lui sont transmises.
    if (window.self !== window.top) {
      document.addEventListener('keydown', (event) => {
        if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
        if (event.key === 'ArrowRight' || event.key === 'ArrowLeft' || event.key === 'Escape') window.parent.postMessage({ maquette: event.key }, '*');
      });
      return;
    }
    // Ouverte seule depuis un panneau qui la lit comme une image du fichier (adresse « data: »), la page n'a pas de voisines où aller.
    if (window.location.protocol === 'data:') return;
    const nav = h(
      'nav',
      { class: 'bd-switch', 'aria-label': 'Variantes de design' },
      h('a', { href: 'index.html', text: 'Toutes' }),
      h('span', { class: 'bd-switch-sep' }),
      VARIANTS.map((variant, index) =>
        h(
          'a',
          { href: variant.file, title: variant.name, 'aria-current': index === current ? 'page' : null },
          String(index + 1),
          index === current ? h('span', { class: 'bd-switch-name', text: NBSP + variant.name }) : null,
        ),
      ),
    );
    document.body.append(nav);
    document.body.classList.add('has-switch');

    document.addEventListener('keydown', (event) => {
      if (event.altKey || event.ctrlKey || event.metaKey || event.shiftKey) return;
      if (event.target instanceof window.Element && event.target.closest('input, textarea, select, [contenteditable]')) return;
      const step = event.key === 'ArrowRight' ? 1 : event.key === 'ArrowLeft' ? -1 : 0;
      if (step === 0) return;
      window.location.href = VARIANTS[(current + step + VARIANTS.length) % VARIANTS.length].file;
    });

    // La police est le sujet de ces maquettes : si elle n'a pas pu être chargée (hors ligne), le bandeau le dit.
    const wanted = (document.body.dataset.fonts || '').split('|').filter(Boolean);
    if (wanted.length === 0 || !document.fonts) return;
    document.fonts.ready.then(() => {
      const loaded = new Set();
      document.fonts.forEach((face) => {
        if (face.status === 'loaded') loaded.add(face.family.replace(/["']/g, ''));
      });
      const missing = wanted.filter((family) => !loaded.has(family));
      if (missing.length > 0) nav.append(h('span', { class: 'bd-switch-warn', text: 'Police non chargée : ' + missing.join(', ') }));
    });
  }

  /* ---------- Démarrage ------------------------------------------------------------------------------------------ */

  window.BDK = {
    fmt: { int, dec, signed, dur, sdur, pct, points, efficiency, times, plural, day, addDays },
    h,
    s,
    icon,
    withUnits,
    hydrate,
    repeat,
    trend,
    mount,
    columns,
    areaLine,
    spark,
    segments,
    breakdownParts,
    heat,
    dataTable,
    sparse,
    series,
    project,
    initials,
    signalGroups,
    signalFields,
    signalText,
    M,
    X,
  };

  hydrate(document);
  startTips();
  startSwitch();
})();
