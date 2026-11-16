/* global window */
/*
 * Les données des cinq maquettes : la Vue globale sur 30 jours (17 oct. – 15 nov. 2026), relevée dans l'application le
 * 15 novembre 2026. Les chiffres sont les vrais. Les noms de Projets et les titres de tickets sont inventés : ce dépôt est
 * public, et les vrais n'ont pas à y figurer.
 * Les durées sont en millisecondes, comme dans l'API.
 */
window.BD = {
  computedAt: '21:55',
  period: { from: '2026-10-17', to: '2026-11-15', days: 30 },
  previous: { from: '2026-09-17', to: '2026-10-16' },

  /* Les Projets, dans l'ordre de la barre latérale. `hue` : la teinte de leur pastille. */
  projects: [
    { id: 'atlas-docs', name: 'atlas-docs', prefix: 'atlas', status: 'ok', hue: 28, throughput: 0, arrivals: 0, leadMedian: null, cycleMedian: null, wip: 0 },
    { id: 'beads-desktop', name: 'beads-desktop', prefix: 'bdesk', status: 'ok', hue: 262, throughput: 101, arrivals: 101, leadMedian: 23422639, cycleMedian: 11562477, wip: 0 },
    {
      id: 'herbier',
      name: 'herbier',
      prefix: 'herb',
      status: 'unreadable',
      hue: 95,
      reason: 'Base Dolt absente de ce poste : le Projet est en mode serveur, sa base n’est pas disponible localement.',
    },
    { id: 'marelle', name: 'marelle', prefix: 'mar', status: 'ok', hue: 340, throughput: 14, arrivals: 15, leadMedian: 2208958, cycleMedian: 2314704, wip: 0 },
    { id: 'mosaique', name: 'mosaïque', prefix: 'mosa', status: 'ok', hue: 150, throughput: 176, arrivals: 169, leadMedian: 65556881.5, cycleMedian: 5696656, wip: 3 },
    { id: 'sextant-api', name: 'sextant-api', prefix: 'sext', status: 'ok', hue: 215, throughput: 0, arrivals: 0, leadMedian: null, cycleMedian: null, wip: 6 },
  ],

  /* Indicateurs : valeur de la période, et celle de la période précédente. */
  debit: { value: 291, prev: 11 },
  arrivals: { value: 285, prev: 33 },
  lead: { median: 54603112, medianPrev: 14826148, p85: 506301526, p85Prev: 286795817, n: 291 },
  cycle: { median: 7832273, medianPrev: 8733180, p85: 86163431.6, p85Prev: 74438548, n: 237 },
  recovery: { median: 12714716, medianPrev: 22904916, p85: 48624519.4, p85Prev: 22904916, n: 9 },
  failure: { significant: false, rate: 0, failed: 0, deliveries: 291, coverage: 0.14864864864864866, linked: 22, bugs: 148, minCoverage: 0.5 },
  wip: { current: 9, avg: 10.675187831522482, avgPrev: 6.672552982675173 },

  /* Santé du flux. */
  efficiency: { ratio: 0.9999997593254624, prev: 1, n: 237, blockedTime: 3516, cycleTime: 14608940500, blockedDeliveries: 1 },
  reopening: { rate: 0.003424657534246575, prev: 0, reopened: 1, closures: 292 },
  abandon: { rate: 0, prev: 0, abandoned: 0, closed: 291 },
  ready: { count: 20, stagnant: 11, stagnantPrev: 11, afterDays: 14 },

  /* Les colonnes du kanban, tous Projets confondus, au dernier jour de la période. */
  stock: { backlog: 0, ready: 20, inProgress: 8, blocked: 1 },

  /* Décomposition du Lead Time cumulé des Livraisons de la période. */
  breakdown: {
    deliveries: 291,
    total: 72512417290,
    dependencyWait: 11349156859,
    readyWait: 45769028032,
    work: 14608936984,
    blocked: 3516,
    otherWait: 785291899,
  },

  /* Un nombre par jour, du 17 octobre au 15 novembre. */
  daily: {
    deliveries: [0, 11, 4, 14, 1, 2, 7, 0, 0, 5, 2, 2, 0, 0, 2, 0, 15, 20, 24, 71, 14, 10, 11, 10, 9, 16, 15, 2, 6, 18],
    arrivals: [0, 6, 18, 17, 0, 0, 12, 1, 0, 3, 4, 0, 0, 2, 3, 5, 12, 20, 19, 58, 11, 17, 4, 7, 11, 9, 22, 0, 0, 24],
    backlog: [0, 0, 9, 12, 9, 8, 6, 6, 6, 5, 5, 5, 5, 5, 5, 5, 6, 2, 4, 5, 5, 5, 5, 2, 3, 1, 1, 1, 0, 0],
    ready: [20, 23, 28, 26, 27, 27, 33, 34, 34, 34, 37, 35, 35, 37, 33, 38, 35, 37, 32, 16, 14, 18, 15, 15, 16, 14, 21, 21, 16, 20],
    inProgress: [16, 8, 8, 10, 11, 10, 11, 11, 11, 10, 9, 9, 9, 9, 14, 14, 11, 13, 11, 13, 12, 15, 11, 11, 11, 9, 9, 7, 7, 8],
    blocked: [0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 0, 1],
  },

  /* Tendance longue : les 12 dernières semaines, du lundi au dimanche. La dernière est en cours. */
  weekly: [
    { from: '2026-08-24', throughput: 0, leadP85: null, reopeningRate: null },
    { from: '2026-08-31', throughput: 0, leadP85: null, reopeningRate: null },
    { from: '2026-09-07', throughput: 0, leadP85: null, reopeningRate: null },
    { from: '2026-09-14', throughput: 0, leadP85: null, reopeningRate: null },
    { from: '2026-09-21', throughput: 1, leadP85: 444383, reopeningRate: 0 },
    { from: '2026-09-28', throughput: 8, leadP85: 86111520.6, reopeningRate: 0 },
    { from: '2026-10-05', throughput: 1, leadP85: 484152770, reopeningRate: 0 },
    { from: '2026-10-12', throughput: 12, leadP85: 1378692361.7, reopeningRate: 0 },
    { from: '2026-10-19', throughput: 28, leadP85: 225836443.85, reopeningRate: 0 },
    { from: '2026-10-26', throughput: 11, leadP85: 777603860, reopeningRate: 0 },
    { from: '2026-11-02', throughput: 165, leadP85: 823398461.2, reopeningRate: 0.006024096385542169 },
    { from: '2026-11-09', throughput: 76, leadP85: 391714937.75, reopeningRate: 0, partial: true },
  ],

  /* Cycle Time des 237 Livraisons démarrées, par tranche. */
  cycleHist: [
    { label: '< 1 h', n: 68 },
    { label: '1 à 4 h', n: 84 },
    { label: '4 à 24 h', n: 52 },
    { label: '1 à 3 j', n: 13 },
    { label: '3 à 7 j', n: 17 },
    { label: '> 7 j', n: 3 },
  ],

  types: [
    { key: 'bug', throughput: 112, wip: 5, leadMedian: 32028930.5, cycleMedian: 11030128 },
    { key: 'task', throughput: 90, wip: 3, leadMedian: 50986301, cycleMedian: 4332045.5 },
    { key: 'feature', throughput: 46, wip: 1, leadMedian: 53481240.5, cycleMedian: 7761557 },
    { key: 'chore', throughput: 41, wip: 0, leadMedian: 58186514, cycleMedian: 5167251 },
    { key: 'decision', throughput: 1, wip: 0, leadMedian: 234801215, cycleMedian: 170438105 },
    { key: 'spike', throughput: 1, wip: 0, leadMedian: 18654944, cycleMedian: 16445301 },
  ],

  /* Carte d'activité : Transitions par jour (lundi → dimanche) et par heure (0 → 23). */
  activity: [
    [0, 0, 0, 0, 0, 0, 0, 0, 0, 1, 4, 0, 0, 0, 6, 7, 0, 7, 7, 13, 3, 0, 2, 5],
    [2, 0, 0, 0, 0, 2, 0, 1, 6, 8, 9, 4, 7, 2, 7, 4, 4, 4, 4, 2, 9, 1, 3, 5],
    [5, 1, 1, 2, 8, 1, 1, 2, 1, 23, 0, 5, 1, 3, 4, 2, 1, 0, 6, 3, 2, 2, 5, 0],
    [1, 6, 2, 2, 5, 0, 3, 5, 3, 8, 6, 17, 8, 6, 10, 1, 7, 6, 4, 13, 17, 7, 12, 8],
    [7, 2, 3, 0, 3, 2, 3, 0, 0, 0, 5, 0, 0, 0, 3, 2, 1, 0, 1, 3, 5, 0, 2, 2],
    [3, 1, 0, 0, 0, 0, 0, 0, 1, 10, 14, 0, 0, 0, 0, 0, 0, 0, 1, 8, 1, 0, 0, 2],
    [1, 0, 0, 0, 0, 0, 0, 0, 11, 1, 8, 3, 3, 5, 1, 0, 0, 4, 1, 10, 14, 2, 0, 1],
  ],

  /* Les tickets en cours, du plus ancien au plus récent (`age` : depuis leur premier démarrage). */
  inProgress: [
    { id: 'sext-4k2', title: 'Les rappels par e-mail partent deux fois le lundi', type: 'bug', priority: 1, project: 'sextant-api', age: 17495592263 },
    { id: 'sext-9zr', title: 'La documentation ne se régénère plus à chaque version', type: 'bug', priority: 2, project: 'sextant-api', age: 16889510091 },
    { id: 'sext-t7m', title: 'Reprendre les retours de revue sur le guide d’installation', type: 'task', priority: 2, project: 'sextant-api', age: 16700295145 },
    { id: 'sext-f3q', title: 'Ajouter l’export CSV des commandes', type: 'feature', priority: 2, project: 'sextant-api', age: 10498987918 },
    { id: 'sext-30b', title: 'Publier la version 3.2', type: 'task', priority: 2, project: 'sextant-api', age: 4531598703 },
    { id: 'sext-78c', title: 'Le tableau de suivi compte les événements de test', type: 'bug', priority: 2, project: 'sextant-api', age: 4068487422 },
    { id: 'mosa-q1w', title: 'Vérifier le nouveau formulaire sur mobile et tablette', type: 'task', priority: 2, project: 'mosaique', age: 374969176, blocked: true },
    { id: 'mosa-u5h', title: 'Le filtre par date oublie le fuseau de l’utilisateur', type: 'bug', priority: 2, project: 'mosaique', age: 15229925 },
    { id: 'mosa-a8v', title: 'La page de connexion boucle après l’expiration de la session', type: 'bug', priority: 1, project: 'mosaique', age: 1649629 },
  ],

  /* Les Signaux de la page « À regarder », dans l'ordre du serveur. */
  signals: [
    {
      kind: 'drift',
      project: 'mosaique',
      ticket: { id: 'mosa-q1w', title: 'Vérifier le nouveau formulaire sur mobile et tablette', type: 'task', priority: 2 },
      cycleTime: 374971458,
      reference: 74438431.3,
    },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-3h1', title: 'Protéger les chemins qui contiennent des espaces dans l’installeur', type: 'task', priority: 3 }, age: 13593760992 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-t3p', title: 'Avertir quand un chemin temporaire est écrit dans la configuration', type: 'task', priority: 2 }, age: 13592873340 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-5m9', title: 'Tester la mise à jour sous Windows avant la prochaine version', type: 'task', priority: 1 }, age: 13592187551 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-d6t', title: 'Derniers ajustements après la revue du module d’import', type: 'task', priority: 3 }, age: 13585167394 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-k0c', title: 'Retirer l’ancien format des fichiers de configuration', type: 'task', priority: 2 }, age: 10705329728 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-p5d', title: 'Mettre la documentation à jour après le retrait de l’ancien format', type: 'task', priority: 2 }, age: 10705329005 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-c0n', title: 'Supprimer le script de migration une fois la bascule terminée', type: 'task', priority: 3 }, age: 10705328320 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-408', title: 'Nettoyer les branches mortes de l’installeur', type: 'task', priority: 2 }, age: 10704924995 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-k3y', title: 'Relire les guides de référence', type: 'task', priority: 3 }, age: 10704923913 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-i5x', title: 'Signaler les fichiers modifiés localement avant de les écraser', type: 'feature', priority: 1 }, age: 10657998162 },
    { kind: 'stagnantReady', project: 'sextant-api', ticket: { id: 'sext-s7j', title: 'Test instable : la vérification de version échoue sous charge', type: 'bug', priority: 3 }, age: 4527622521 },
    { kind: 'unusualWip', project: 'mosaique', wip: 3, threshold: 2 },
  ],
};
