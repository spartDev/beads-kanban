import { describe, expect, it } from 'vitest';
import { nameReads, type SentenceKind } from '../test/projectNameReads';

/**
 * Aucune phrase de l'interface n'écrit le nom d'un Projet telle quelle (bdesk-38k.73). Un Projet dont le dossier n'a pas de nom qu'on voie s'écrit « Sans titre » (bdesk-38k.65), et « Les tickets de Sans titre » se
 * lit comme les tickets d'un Projet qui s'appellerait ainsi : une phrase qui nomme un Projet passe par `projectInSentence` (après « de » ou « dans ») ou `projectList` (une liste de Projets), qui disent « ce Projet »
 * ou « un Projet sans nom » quand le nom est un repli. Ce test lit le code et refuse la prochaine phrase qui écrirait le nom d'un Projet sans eux, sans qu'aucun écran ait à la monter.
 *
 * Comment il lit (`test/projectNameReads.ts`) : l'arbre syntaxique de chaque fichier de `src/web`, par l'API du compilateur TypeScript, et non le texte. Une lecture de nom (`x.name` sous toutes ses formes : `p.name`, `liste[0].name`,
 * `x!.name`, `(x as T).name`, `x?.name`, `x['name']` ; `projectName(…)` et `ctx.projectName(…)` ; un nom déstructuré `{ name }` ou `{ name: titre }` ; une variable ou une fonction du fichier qui en porte un) est refusée quand sa valeur finit dans
 * une phrase : un gabarit qui a du texte autour (`…${nom}…`), une concaténation (`'…' + nom`, `+=`, `.concat`), du texte JSX à côté (`<p>Les tickets de {nom}</p>`, `<p>{nom} : {raison}</p>`), ou une liste de noms (`liste.map((x) => x.name)`, à corps
 * de bloc ou déstructurée, `[…].join(' ')`). Sa valeur traverse ce qui la laisse telle quelle ou presque : un gabarit qui ne porte qu'elle (`{`${nom}`}`), les méthodes de chaîne (`.toString()`, `.trim()`, `.split(…)[0]`…), `String(…)`, `??`, une
 * condition, un tableau. Un nom en gras (ou en italique, dans un fragment, un `<a>`, un `<kbd>`, un `<Link>` ou tout autre composant, qu'on suppose rendre un élément de la ligne) est dans la phrase qui l'entoure, qu'il soit écrit là, rendu sous condition, mis entre
 * accolades, rendu par la flèche d'un `.map` ou rangé dans une variable qu'on pose ensuite dans du texte. Un nom seul (un libellé : seul dans son élément, un attribut, un argument, une propriété, une comparaison) passe, et ce que `projectInSentence` et `projectList` écrivent aussi. Les cas qui sont refusés, et ceux qui passent, sont écrits plus bas, un par
 * forme : chacun en est l'essai, et les phrases qu'on ajouterait à de vrais fichiers sont refusées de même (`MUTANTS`).
 *
 * Ce qu'il ne lit pas (`LIMITS`, plus bas, écrit chaque forme : un essai qui passe, et qui passera dans `REFUSED` le jour où on la lira) : un nom qui passe par le paramètre d'une autre fonction ou d'un composant sous un autre nom (`<Phrase libelle={x.name} />`), un
 * composant ou une fonction du fichier qui rend le nom en gras (`<Nom />`), un nom rendu par une fonction d'un autre fichier, un nom confié à une fonction qui en fait du texte (`format.format([x.name])`, `t('…', { nom: x.name })`, `const phrase = (n) => `Dans ${n}``),
 * un tableau qu'on filtre avant de le joindre (`[section, x.name].filter(Boolean).join(' · ')`), un nom rangé dans une propriété d'objet qu'on relit plus loin (`const ligne = { libelle: x.name }` puis `<p>Dans {ligne.libelle}</p>`), un nom que rend
 * `useMemo(() => x.name, …)` posé dans du texte, un nom qui prend la place d'un repère dans une chaîne (`'Les tickets de X'.replace('X', x.name)`), des noms ajoutés à un tableau par `forEach` et `push` avant un `join`, un élément fabriqué par `createElement`,
 * un nom passé en `children` (`<Link to={x} children={x.name} />`), un nom seul dans un élément de la ligne dont le texte voisin vient d'une expression (`<p>{raison} <Link to={x}>{x.name}</Link></p>`),
 * une phrase écrite hors de `src/web`. Ces écritures-là, c'est `data/projectSentences.rendered.test.tsx` qui les voit, pour la plupart : il monte l'application avec un Projet sans nom et cherche « Sans titre » au milieu d'un autre texte, sans lire le code, donc quelle
 * que soit la forme, mais dans les seuls états qu'il monte, et en lisant une à une les parties d'un titre d'onglet joint par « · ». Lui ne lit pas un nom seul dans son élément au milieu d'une phrase (le texte propre de l'élément est le repli seul) : celui-là, c'est ce
 * test qui le lit, d'où les éléments de la ligne (`<Link>` et les autres composants en sont) ; `<Nom />`, qui rend ce nom seul, n'est donc lu par aucun des deux. Les deux se complètent ; ni l'un ni l'autre ne prouve qu'une phrase n'existe nulle part.
 *
 * Les exceptions (`ALLOWED`) sont des lectures qui ne sont pas le nom d'un Projet, ou qui sont un libellé suivi de ce qui le qualifie (l'avis des Projets illisibles, qui nomme ses Projets par `projectLabel`). Une exception qui ne sert plus est refusée à son tour :
 * elle ne reste pas pour rien.
 */

const sources = import.meta.glob<string>(['../**/*.{ts,tsx}', '!../**/*.test.{ts,tsx}', '!../test/**'], { query: '?raw', import: 'default', eager: true });

/** Le chemin du fichier dans le dépôt, d'après sa clé (`import.meta.glob` les écrit relativement à ce fichier, qui est dans `src/web/data`). */
const where = (key: string): string => new URL(key, 'file:///src/web/data/').pathname.slice(1);

/** Les fichiers qui lisent le nom du dossier tel que le serveur le donne, pour le remplacer, ou qui écrivent les phrases par les aides. */
const EXEMPT = new Set(['src/web/data/projectNames.ts']);

/** Ce qui est lu dans une phrase sans être le nom d'un Projet, ou sans en faire une phrase : le fichier, ce qui est lu, et pourquoi on le laisse. */
const ALLOWED = [
  { file: 'src/web/metrics/ActivityMap.tsx', read: 'WEEKDAYS[peak.weekday]?.name', why: 'le nom d’un jour de la semaine' },
  { file: 'src/web/metrics/activity.ts', read: 'WEEKDAYS[weekday]?.name', why: 'le nom d’un jour de la semaine' },
  { file: 'src/web/metrics/Notices.tsx', read: 'projectLabel(project, projects)', why: 'un libellé suivi de sa raison (« Un Projet sans nom : Base Dolt introuvable… »), non une phrase : une ligne par Projet, nommé comme l’alerte de la palette' },
];

const sentencesIn = (source: string, fileName?: string): SentenceKind[] =>
  nameReads(source, fileName).flatMap(({ inSentence }) => (inSentence ? [inSentence] : []));

// [la forme, ce qu'elle devient, la source]. Les formes de la relecture de bdesk-38k.73, puis celles qu'on en tire.
const REFUSED: [string, SentenceKind, string][] = [
  ['du texte JSX à côté du nom', 'texte JSX', '<p>Les tickets de {project.name}, en colonnes.</p>'],
  ['une alerte écrite en JSX', 'texte JSX', '<p role="alert">Tickets indisponibles : {project.name}.</p>'],
  ['un nom puis sa raison, en JSX', 'texte JSX', '<p>{project.name} : {project.reason}</p>'],
  ['un nom dans un conditionnel, en JSX', 'texte JSX', "<p>De {cond ? project.name : 'x'}</p>"],
  ['un nom en gras au milieu d’une phrase', 'texte JSX', '<p>Les tickets de <strong>{project.name}</strong>, en colonnes.</p>'],
  ['un nom en gras et en italique au milieu d’une phrase', 'texte JSX', '<p>Les tickets de <strong><em>{project.name}</em></strong>, en colonnes.</p>'],
  ['un libellé en gras suivi de sa raison', 'texte JSX', '<li><strong className="font-medium">{project.name}</strong> : {project.reason}</li>'],
  ['un attribut écrit en gabarit', 'gabarit', '<a aria-label={`Ouvrir ${project.name}`} />'],
  ['un nom suivi de `!`', 'gabarit', 'const s = `Les tickets de ${project!.name}`;'],
  ['un nom d’un objet converti par `as`', 'gabarit', 'const s = `Les tickets de ${(project as Project).name}`;'],
  ['un nom déstructuré', 'gabarit', 'const { name } = project;\nconst s = `Les tickets de ${name}`;'],
  ['un nom déstructuré et renommé', 'gabarit', 'const { name: titre } = project;\nconst s = `Les tickets de ${titre}`;'],
  ['une variable courte, `p.name`', 'gabarit', 'const s = `Les tickets de ${p.name}`;'],
  ['un élément de liste, `projects[0].name`', 'gabarit', 'const s = `Dans ${projects[0].name}`;'],
  ["des crochets, `x['name']`", 'gabarit', "const s = `Dans ${project['name']}`;"],
  ['un nom avec son repli', 'gabarit', 'const s = `Dans ${project?.name ?? projectId}`;'],
  ['un gabarit étiqueté', 'gabarit', 'const s = fmt`de ${project.name}`;'],
  ['`ctx.projectName(…)`', 'gabarit', 'const s = `Cycle Time de ${ctx.projectName(id)}`;'],
  ['`projectName(…)`', 'gabarit', 'const s = `Cycle Time de ${projectName(id)}`;'],
  ['une variable qui porte le nom', 'gabarit', 'const nom = project.name;\nconst s = `Les tickets de ${nom}`;'],
  ['une variable qui porte le nom, avec son repli', 'gabarit', 'const nom = project?.name ?? projectId;\nconst s = `Les tickets de ${nom}`;'],
  ['un gabarit qui ne porte que le nom, mis dans une variable', 'gabarit', 'const nom = `${project.name}`;\nconst s = `Les tickets de ${nom}`;'],
  ['un `String(…)` mis dans une variable', 'gabarit', 'const nom = String(project.name);\nconst s = `Les tickets de ${nom}`;'],
  ['un nom coupé, mis dans une variable', 'gabarit', 'const nom = project.name.trim();\nconst s = `Les tickets de ${nom}`;'],
  ['une fonction du fichier qui rend le nom (flèche)', 'gabarit', 'const nameOf = (id) => projects.find((p) => p.id === id)?.name ?? id;\nconst s = `Les tickets de ${nameOf(id)}`;'],
  ['une fonction du fichier qui rend le nom (déclaration)', 'gabarit', 'function nomDe(p) { return p.name; }\nconst s = `Les tickets de ${nomDe(project)}`;'],
  ['une fonction du fichier qui rend le nom (corps de bloc)', 'gabarit', "const nomDe = (p) => { if (!p) return ''; return p.name; };\nconst s = `Les tickets de ${nomDe(project)}`;"],
  ['une concaténation, le nom à droite', 'concaténation', "const s = 'Les tickets de ' + project.name;"],
  ['une concaténation, le nom à gauche', 'concaténation', "const s = project.name + ' : tickets';"],
  ['un `+=`', 'concaténation', "let s = 'Les tickets de ';\ns += project.name;"],
  ['un `.concat`', 'concaténation', "const s = 'Les tickets de '.concat(project.name);"],
  ['un `String(…)` concaténé', 'concaténation', "const s = 'Les tickets de ' + String(project.name);"],
  ['un nom mis en minuscules, concaténé', 'concaténation', "const s = project.name.toLowerCase() + ' x';"],
  ['une flèche', 'liste', 'const s = failed.map((project) => project.name).join(", ");'],
  ['une flèche à corps de bloc', 'liste', 'const s = failed.map((project) => { return project.name; }).join(", ");'],
  ['une flèche déstructurée', 'liste', 'const s = failed.map(({ name }) => name).join(", ");'],
  ['une liste mise en forme par `Intl.ListFormat`', 'liste', "const s = new Intl.ListFormat('fr').format(failed.map((p) => p.name));"],
  ['un tableau joint', 'liste', "const s = ['Dans', project.name].join(' ');"],
  ['un « /* » dans une chaîne, avant', 'gabarit', "const g = 'src/*';\nconst s = `Les tickets de ${project.name}`;\nconst h = 'a*/b';"],
  ['un « /* » dans un gabarit, avant', 'gabarit', 'const g = `/*`;\nconst s = `Les tickets de ${project.name}`;'],
  // Relecture finale de bdesk-38k.73 : du texte JSX que le balayage laissait passer. Un gabarit qui ne porte que le nom, et une méthode de chaîne qui le rend (`.toString()`), sont le nom lui-même, comme `String(…)` ; un nom en
  // gras que rend un `.map` ou une condition, au milieu d'un texte, est une phrase comme un nom en gras écrit tel quel.
  ['un gabarit qui ne porte que le nom, dans du texte JSX', 'texte JSX', '<p>Créez-en un dans {`${project.name}`} avec <code>bd create</code>.</p>'],
  ['un gabarit dans un gabarit, qui ne porte que le nom', 'texte JSX', '<p>Dans {`${`${project.name}`}`}</p>'],
  ['un gabarit qui ne porte que le nom, mis en minuscules, dans du texte JSX', 'texte JSX', '<p>Dans {`${project.name}`.toLowerCase()}</p>'],
  ['`.toString()` dans du texte JSX', 'texte JSX', '<p>Dans {project.name.toString()}</p>'],
  ['`.valueOf()` dans du texte JSX', 'texte JSX', '<p>Dans {project.name.valueOf()}</p>'],
  ['`.toLocaleUpperCase()` dans du texte JSX', 'texte JSX', '<p>Dans {project.name.toLocaleUpperCase()}</p>'],
  ['`String(…).toString()` dans du texte JSX', 'texte JSX', '<p>Dans {String(project.name).toString()}</p>'],
  ['le premier mot d’un nom coupé, dans du texte JSX', 'texte JSX', "<p>Dans {project.name.split(' ')[0]}</p>"],
  ['`.toString()` dans un gabarit', 'gabarit', 'const s = `Les tickets de ${project.name.toString()}`;'],
  ['`.toString()` mis dans une variable', 'gabarit', 'const nom = project.name.toString();\nconst s = `Les tickets de ${nom}`;'],
  ['un nom en gras que rend un `.map`, dans du texte JSX', 'liste', '<p>Tickets indisponibles : {failed.map((p) => <strong key={p.id}>{p.name}</strong>)}.</p>'],
  ['un nom en gras que rend un `.map`, entre parenthèses', 'liste', '<p>Tickets indisponibles : {failed.map((p) => (<strong key={p.id}>{p.name}</strong>))}.</p>'],
  ['un nom en gras que rend un `.map` à corps de bloc', 'liste', '<p>Tickets indisponibles : {failed.map((p) => { return <strong key={p.id}>{p.name}</strong>; })}.</p>'],
  ['un nom en gras que rend un `.flatMap`', 'liste', "<p>Tickets indisponibles : {failed.flatMap((p) => [<strong key={p.id}>{p.name}</strong>, ', '])}.</p>"],
  ['un nom en gras et en italique que rend un `.map`', 'liste', '<p>Tickets indisponibles : {failed.map((p) => <strong key={p.id}><em>{p.name}</em></strong>)}.</p>'],
  ['un nom dans un `Fragment` à clé que rend un `.map`', 'liste', '<p>Tickets indisponibles : {failed.map((p) => <Fragment key={p.id}>{p.name}</Fragment>)}.</p>'],
  ['un nom en gras rendu sous condition, dans du texte JSX', 'texte JSX', '<p>Dans {showName ? <strong>{project.name}</strong> : null}</p>'],
  ['un nom en gras rendu après `&&`, dans du texte JSX', 'texte JSX', '<p>Dans {showName && <strong>{project.name}</strong>}</p>'],
  ['un nom en gras entre accolades, dans du texte JSX', 'texte JSX', '<p>Dans {<strong>{project.name}</strong>}.</p>'],
  ['un nom dans un fragment, au milieu d’une phrase', 'texte JSX', '<p>Les tickets de <>{project.name}</>, en colonnes.</p>'],
  ['un nom en gras, rangé dans une variable avant d’être posé dans du texte', 'texte JSX', 'const nom = <strong>{project.name}</strong>;\nconst el = <p>Les tickets de {nom}, en colonnes.</p>;'],
  ['une liste de noms en gras, rangée dans une variable avant d’être posée dans du texte', 'texte JSX', 'const noms = failed.map((p) => <strong key={p.id}>{p.name}</strong>);\nconst el = <p>Tickets indisponibles : {noms}.</p>;'],
  // Relecture finale, tour 2 : un composant rend un élément en ligne comme `<a>` (`Link`, `NavLink`, un bouton, une touche…). Ne sachant pas ce que rend un composant, on le suppose en ligne : un nom seul dedans, au milieu d'un texte, est dans la phrase.
  ['un nom dans un `<Link>`, au milieu d’une phrase (le relecteur)', 'texte JSX', '<p>Voir les tickets de <Link to={x}>{project.name}</Link>, en colonnes.</p>'],
  ['un nom dans un `<NavLink>`, au milieu d’une phrase', 'texte JSX', '<p>Voir les tickets de <NavLink to={x}>{project.name}</NavLink>, en colonnes.</p>'],
  ['un nom dans un `<Link>`, au milieu de l’avis d’un composant', 'texte JSX', '<Notice title="x">L’Epic a peut-être été supprimée de <Link to={x}>{project.name}</Link>, ou le lien vient d’un autre Projet.</Notice>'],
  ['un nom dans un bouton de l’application, au milieu d’une phrase', 'texte JSX', '<p>Ouvrir <Button onClick={open}>{project.name}</Button> maintenant.</p>'],
  ['un nom dans une touche (`Kbd`), au milieu d’une phrase', 'texte JSX', '<p>Appuyez sur <Kbd>{project.name}</Kbd> pour ouvrir.</p>'],
  ['un nom dans un composant à point (`Tooltip.Trigger`), au milieu d’une phrase', 'texte JSX', '<p>Dans <Tooltip.Trigger>{project.name}</Tooltip.Trigger>, rien.</p>'],
  ['un nom en gras dans un `<Link>`, au milieu d’une phrase', 'texte JSX', '<p>Voir <Link to={x}><strong>{project.name}</strong></Link>, en colonnes.</p>'],
  ['un nom dans un `<Link>` rendu sous condition, dans du texte JSX', 'texte JSX', '<p>Voir {ok && <Link to={x}>{project.name}</Link>}, en colonnes.</p>'],
  ['des noms dans des `<Link>` que rend un `.map`, dans du texte JSX', 'liste', '<p>Tickets indisponibles : {failed.map((p) => <Link key={p.id} to={x}>{p.name}</Link>)}.</p>'],
  ['un nom dans un `<Link>`, rangé dans une variable avant d’être posé dans du texte', 'texte JSX', 'const lien = <Link to={x}>{project.name}</Link>;\nconst el = <p>Voir les tickets de {lien}, en colonnes.</p>;'],
  ['un nom dans un `<button>`, au milieu d’une phrase', 'texte JSX', '<p>Ouvrir <button onClick={open}>{project.name}</button> maintenant.</p>'],
  ['un nom dans un `<kbd>`, au milieu d’une phrase', 'texte JSX', '<p>Appuyez sur <kbd>{project.name}</kbd> pour ouvrir.</p>'],
  ['un nom dans un `<time>`, au milieu d’une phrase', 'texte JSX', '<p>Ouvert dans <time>{project.name}</time>, hier.</p>'],
  ['un nom dans un composant à point écrit en minuscules (`motion.span`), au milieu d’une phrase', 'texte JSX', '<p>Voir <motion.span>{project.name}</motion.span> ici.</p>'],
  ['un nom dans un élément personnalisé (à tiret), au milieu d’une phrase', 'texte JSX', '<p>Voir <mon-lien>{project.name}</mon-lien> ici.</p>'],
];

const ACCEPTED: [string, string][] = [
  ['un nom seul dans son élément', '<span className="truncate">{project.name}</span>'],
  ['un nom seul dans un élément, entre une pastille et un badge', '<li><Icon /> <strong>{project.name}</strong> <Badge /></li>'],
  ['une pastille et un libellé', '<Link><ProjectTile project={p} /> <span>{p.name}</span></Link>'],
  ['un nom seul dans un conditionnel', '{showProject ? <span className={cx("x")}>{project.name}</span> : null}'],
  ['un nom seul dans un élément, dans un élément qui n’est pas du texte', '<div>Introduction <section><div>{project.name}</div></section></div>'],
  ['un nom en gras, sans texte autour', '<li><strong>{project.name}</strong></li>'],
  ['un nom en attribut', '<a title={project.name} aria-label={project.name} />'],
  ['un nom en argument', "useDocumentTitle('Kanban', project.name);"],
  ['un nom en propriété', 'const row = { text: project.name, hint: tabsProject.name };'],
  ['un nom en propriété de ce que la liste rend', 'const s = projects.map((p) => ({ key: p.id, label: p.name }));'],
  ['une comparaison', 'const x = project.prefix !== project.name ? 1 : 2;'],
  ['un nom écrit seul dans un gabarit', 'const s = `${project.name}`;'],
  ['`ctx.projectName(…)` seul dans son élément', '{showProject ? <span>{ctx.projectName(ticket.project)}</span> : null}'],
  ['`ctx.projectName(…)` dans une cellule', '<td className="px-3">{ctx.projectName(point.project)}</td>'],
  ['une fonction du fichier qui rend le nom, en libellé', 'const nameOf = (id) => projects.find((p) => p.id === id)?.name ?? id;\nconst el = <span>{nameOf(id)}</span>;'],
  ['une variable qui porte le nom, en libellé', "const label = projectId ? (project?.name ?? projectId) : 'Vue globale';\nconst el = <span>{label}</span>;"],
  ['`projectInSentence` et `projectList`', 'const s = `Les tickets de ${projectInSentence(project)}`;\nconst t = `Indisponibles : ${projectList(failed)}.`;'],
  ['l’identifiant d’un Projet', 'const s = `Aucune Epic « ${epicId} » dans ${project.id}`;'],
  ['une liste d’identifiants', 'const s = projects.map((project) => project.id).join(", ");'],
  ['un paramètre qui s’appelle `name`, sans rapport avec un Projet', 'const x = names.map((name) => `[role="${name}"]`).join(", ");'],
  ['une affectation', "this.name = 'ApiError';"],
  ['des noms dans des commentaires', '// `Les tickets de ${project.name}`\n/* ${project.name} */\nconst s = 1;'],
  ['des noms en gras que rend un `.map`, seuls dans leur élément', '<p>{failed.map((p) => <strong key={p.id}>{p.name}</strong>)}</p>'],
  ['des éléments de liste qui ne portent que le nom', '<ul>{failed.map((p) => <li key={p.id}>{p.name}</li>)}</ul>'],
  ['des éléments de liste qui ne portent que le nom, sous un texte', '<div>Projets : <ul>{failed.map((p) => <li key={p.id}>{p.name}</li>)}</ul></div>'],
  ['un nom en gras rendu sous condition, sans texte autour', '<span className="x">{a}{showName ? <strong>{project.name}</strong> : null}</span>'],
  ['un gabarit qui ne porte que le nom, en attribut', '<a title={`${project.name}`} />'],
  ['un gabarit qui ne porte que le nom, seul dans son élément', '<td>{`${project.name}`}</td>'],
  ['`.toString()` d’un identifiant, dans du texte JSX', '<p>Dans {project.id.toString()}</p>'],
  ['des noms en gras rangés dans une variable, seuls dans leur élément', 'const noms = failed.map((p) => <strong key={p.id}>{p.name}</strong>);\nconst el = <p>{noms}</p>;'],
  // Relecture finale, tour 2 : un composant est supposé en ligne, et un libellé reste un libellé. Les formes de la barre latérale, du fil d'Ariane et de la palette, telles que le code les écrit.
  ['la ligne de la barre latérale : un `<Link>` qui porte une pastille, le nom et le préfixe', '<li><Link to={paths.kanban(project.id)} className={cx(\'group/row flex\', active ? \'text-ink\' : \'text-ink-2\')}><ProjectTile project={project} /><span className="min-w-0 flex-1 truncate">{project.name}</span>{project.prefix !== project.name ? (<span className="font-mono">{project.prefix}</span>) : null}</Link></li>'],
  ['la ligne d’un Projet illisible dans la barre latérale', '<li><div title={project.reason} className="flex"><ProjectTile project={project} /><div className="min-w-0"><div className="flex"><span className="truncate">{project.name}</span><TriangleAlert size={13} /></div><p><span className="sr-only">Illisible : </span>{project.reason ?? \'Illisible\'}</p></div></div></li>'],
  ['le fil d’Ariane : un `<Link>` qui porte une pastille et le nom, dans un fragment', '<nav aria-label="Fil d\'Ariane">{projectId ? (<><Link to={paths.kanban(projectId)} className="flex">{project ? <ProjectTile project={project} size={16} /> : null}<span className="truncate">{project?.name ?? projectId}</span></Link>{section ? <Separator /> : null}</>) : null}</nav>'],
  ['la ligne de la palette : un `<Command.Item>` qui porte une pastille et le nom', '<Command.Item value={project.id} onSelect={go}><ProjectTile project={project} /><span className="truncate">{project.name}</span><EnterHint /></Command.Item>'],
  ['les lignes de la palette que rend un `.map`', '<Command.Group heading="Projets">{projects.map((project) => (<Command.Item key={project.id}><ProjectTile project={project} /><span>{project.name}</span></Command.Item>))}</Command.Group>'],
  ['la ligne d’un ticket de la palette : un nom de Projet en légende', '<Command.Item><span className="font-mono">{issue.id}</span><span>{title}</span>{showProject ? <span className="text-xs">{project.name}</span> : null}</Command.Item>'],
  ['la ligne de la Vue globale : un `<Link>` qui ne porte que le nom', '<li><Link to={paths.kanban(project.id)}><ProjectTile project={project} /><span className={cx(\'truncate font-medium\', readable ? \'text-ink\' : \'text-ink-2\')}>{project.name}</span></Link></li>'],
  ['un `<Link>` qui ne porte que le nom, dans un élément de liste', '<ul>{projects.map((p) => <li key={p.id}><Link to={x}>{p.name}</Link></li>)}</ul>'],
  ['un `<Link>` qui ne porte que le nom, seul dans son paragraphe', '<p><Link to={x}>{project.name}</Link></p>'],
  ['un `<Link>` qui ne porte que le nom, à côté d’une pastille et d’un badge', '<div><Icon /> <Link to={x}>{project.name}</Link> <Badge /></div>'],
  ['un élément de bloc (`<div>`) qui ne porte que le nom, à côté d’un texte : ce n’est pas un élément de la ligne', '<li>Projets : <div>{project.name}</div></li>'],
];

/**
 * Ce que la garde du code ne lit pas, écrit forme par forme (relecture finale, tour 2) : le nom y passe par une méthode de tableau, une propriété d'objet, un hook ou une fonction qu'on ne suit pas, avant d'être posé dans une phrase.
 * La garde du rendu les voit dans les états qu'elle monte (pas dans un titre d'onglet joint par « · »). Si la garde du code apprend à les lire, ces essais le diront : ils passeront alors dans `REFUSED`.
 */
const LIMITS: [string, string][] = [
  ['un tableau filtré, puis joint', "const s = [section, project.name].filter(Boolean).join(' · ');"],
  ['une propriété d’objet, relue plus loin', 'const row = { label: project.name };\nconst el = <p>Dans {row.label}</p>;'],
  ['un nom que rend `useMemo`, posé dans du texte', 'const nom = useMemo(() => project.name, [project]);\nconst el = <p>Dans {nom}</p>;'],
  ['un nom qui remplace un repère dans une chaîne', "const s = 'Les tickets de X'.replace('X', project.name);"],
  ['`forEach` et `push`, puis `join`', "const out = [];\nfailed.forEach((p) => out.push(p.name));\nconst s = out.join(', ');"],
  ['un élément fabriqué par `createElement`', "const el = createElement('p', null, 'Les tickets de ', project.name);"],
  ['un nom passé en `children`', '<p>Voir <Link to={x} children={project.name} /> ici</p>'],
  ['un nom seul dans un `<Link>`, à côté d’un texte qui vient d’une expression', '<p>{raison} <Link to={x}>{project.name}</Link></p>'],
  ['un nom confié à une fonction du fichier qui en fait du texte', 'const phrase = (n) => `Dans ${n}`;\nconst s = phrase(project.name);'],
  ['un composant du fichier qui rend le nom en gras', 'const Nom = ({ p }) => <strong>{p.name}</strong>;\nconst el = <p>Dans <Nom p={project} />, rien.</p>;'],
];

describe('la garde des phrases sait lire ce qu’elle garde', () => {
  it.each(REFUSED)('refuse %s', (_form, kind, source) => {
    expect(sentencesIn(source)).toEqual([kind]);
  });

  it.each(ACCEPTED)('accepte %s', (_form, source) => {
    expect(sentencesIn(source)).toEqual([]);
  });

  it.each(LIMITS)('ne lit pas %s : une limite écrite en tête de ce fichier', (_form, source) => {
    expect(sentencesIn(source)).toEqual([]);
  });

  it('lit un fichier `.ts` comme un fichier `.ts` : une assertion `<T>x` n’y est pas du JSX', () => {
    expect(sentencesIn('const s = `Les tickets de ${(<Project>project).name}`;', 'x.ts')).toEqual(['gabarit']);
  });

  it('ne se trompe pas de lecture quand la source est cassée : ce qu’elle comprend, elle le garde', () => {
    expect(sentencesIn('const s = `Les tickets de ${project.name}`;\nconst = <<< ;')).toEqual(['gabarit']);
  });
});

describe('les phrases du code de l’interface', () => {
  const files = Object.entries(sources)
    .map(([key, source]) => ({ file: where(key), source }))
    .filter(({ file }) => !EXEMPT.has(file));
  const reads = files.flatMap(({ file, source }) => nameReads(source, file).map((read) => ({ file, ...read })));
  const isAllowed = (read: { file: string; text: string }) => ALLOWED.some((rule) => rule.file === read.file && rule.read === read.text);

  it('sont retrouvées : le test lit bien le code (pages, panneau, palette, graphiques)', () => {
    expect(files.length).toBeGreaterThan(100);
    // Les libellés (un nom lu qui reste seul) sont la plupart des lectures : le balayage les voit.
    expect(reads.filter(({ inSentence }) => !inSentence).length).toBeGreaterThanOrEqual(30);
    const calling = (helper: string) => files.filter(({ source }) => source.includes(`${helper}(`)).map(({ file }) => file);
    expect(calling('projectInSentence')).toEqual(
      expect.arrayContaining(['src/web/pages/KanbanPage.tsx', 'src/web/pages/EpicsPage.tsx', 'src/web/pages/MetricsPage.tsx', 'src/web/issue/IssuePanel.tsx']),
    );
    expect(calling('projectList')).toEqual(expect.arrayContaining(['src/web/palette/CommandPalette.tsx']));
  });

  it('n’écrivent le nom d’un Projet que par `projectInSentence` ou `projectList`', () => {
    const raw = reads.filter((read) => read.inSentence && !isAllowed(read)).map(({ file, line, text, inSentence }) => `${file}:${line} : ${text} (${inSentence})`);

    expect(raw).toEqual([]);
  });

  // Relecture finale, tour 2 : la barre latérale, le fil d'Ariane, la palette et la Vue globale écrivent le nom seul, dans un `<Link>` ou une ligne de la palette : ces lectures sont vues (le test ne passe pas faute de les lire), et ce sont des libellés.
  it.each(['src/web/shell/Sidebar.tsx', 'src/web/shell/TopBar.tsx', 'src/web/palette/PaletteGroups.tsx', 'src/web/palette/usePaletteSections.ts', 'src/web/pages/GlobalPage.tsx'])('lit le nom de %s, seul, et l’accepte : un libellé', (file) => {
    const own = reads.filter((read) => read.file === file);

    expect(own.length).toBeGreaterThan(0);
    expect(own.filter((read) => read.inSentence)).toEqual([]);
  });

  it.each(ALLOWED)('garde l’exception de $file ($read : $why) tant qu’elle sert', ({ file, read }) => {
    expect(reads.some((candidate) => candidate.file === file && candidate.text === read && candidate.inSentence)).toBe(true);
  });

  // Une phrase ajoutée à un vrai fichier, comme le fait un relecteur : la garde la refuse. Chaque fragment existe une fois dans le fichier, qu'on n'écrit pas : le test mute le texte en mémoire.
  const MUTANTS: [string, string, string, string][] = [
    ['le gabarit du relecteur de bdesk-38k.73, dans l’avis « Aucun ticket dans ce Projet »', 'src/web/pages/KanbanPage.tsx', 'Créez-en un avec <code>bd create</code>', 'Créez-en un dans {`${project.name}`} avec <code>bd create</code>'],
    ['`.toString()` dans le même avis', 'src/web/pages/KanbanPage.tsx', 'Créez-en un avec <code>bd create</code>', 'Créez-en un dans {project.name.toString()} avec <code>bd create</code>'],
    ['des noms en gras que rend un `.map`, dans l’alerte de la palette', 'src/web/palette/CommandPalette.tsx', 'Tickets indisponibles : {projectList(failedProjects)}.', 'Tickets indisponibles : {failedProjects.map((project) => <strong key={project.id}>{project.name}</strong>)}.'],
    // Relecture finale, tour 2 : le nom dans un `<Link>`, au milieu de la phrase de l'avis d'une Epic absente (le relecteur), de celui du kanban vide, de l'alerte de la palette.
    ['le `<Link>` du relecteur, dans l’avis d’une Epic absente', 'src/web/pages/EpicsPage.tsx', 'L’Epic a peut-être été supprimée, ou le lien vient d’un autre Projet.', 'L’Epic a peut-être été supprimée de <Link to={paths.epics(project.id)}>{project.name}</Link>, ou le lien vient d’un autre Projet.'],
    ['un `<NavLink>` dans l’avis « Aucun ticket dans ce Projet »', 'src/web/pages/KanbanPage.tsx', 'Créez-en un avec <code>bd create</code>', 'Créez-en un dans <NavLink to="/">{project.name}</NavLink> avec <code>bd create</code>'],
    ['des noms dans des `<Link>` que rend un `.map`, dans l’alerte de la palette', 'src/web/palette/CommandPalette.tsx', 'Tickets indisponibles : {projectList(failedProjects)}.', 'Tickets indisponibles : {failedProjects.map((project) => <Link key={project.id} to="/">{project.name}</Link>)}.'],
  ];

  it.each(MUTANTS)('refuse la phrase écrite à la main dans un vrai fichier : %s', (_what, file, from, to) => {
    const source = files.find((candidate) => candidate.file === file)?.source ?? '';
    const refused = (text: string) => nameReads(text, file).filter((read) => read.inSentence && !isAllowed({ file, text: read.text }));

    expect(source.split(from)).toHaveLength(2);
    expect(refused(source)).toEqual([]);
    expect(refused(source.replace(from, to)).length).toBeGreaterThan(0);
  });
});
