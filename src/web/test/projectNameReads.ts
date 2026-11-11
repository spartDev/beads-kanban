import ts from 'typescript';

/**
 * Où le nom d'un Projet est lu dans une source, et ce qu'il devient (bdesk-38k.73, relecture) : l'outil de `data/projectSentences.test.ts`. Il lit l'arbre syntaxique que construit TypeScript (`ts.createSourceFile`),
 * et non le texte : un `/*` dans une chaîne ou un gabarit, un type (`!`, `as`), des parenthèses ou un retour à la ligne ne le trompent pas.
 *
 * Une **lecture de nom** est :
 * - `x.name`, `x?.name`, `x!.name`, `(x as T).name`, `liste[0].name`, `x['name']` : quel que soit `x` (on ne connaît pas son type : `p.name` vaut `project.name`) ;
 * - un appel à `projectName(…)`, `ctx.projectName(…)`, ou à une fonction du même fichier qui rend un nom (`const nameOf = (id) => … ?.name`, `function nomDe(p) { return p.name; }`) ;
 * - un nom déstructuré (`const { name } = x`, `({ name }) => …`, `{ name: titre }`) ou une variable qui en porte un (`const nom = x.name ?? y`), là où on la relit.
 *
 * Elle est **dans une phrase** quand sa valeur finit :
 * - dans un gabarit qui a du texte ou d'autres morceaux autour d'elle (`…${nom}…`, étiqueté aussi) : `gabarit` ;
 * - dans une concaténation (`'…' + nom`, `+=`, `.concat`) : `concaténation` ;
 * - à côté de texte JSX (`<p>Les tickets de {nom}</p>`, `<p>{nom} : {raison}</p>`), ou seule dans un élément de la ligne (`<strong>`, `<span>`, `<a>`, `<kbd>`, un fragment, ou un composant : `<Link>`, `<NavLink>`, `<Button>`, `<Kbd>`,
 *   `<Command.Item>`) lui-même au milieu d'un texte (`<p>Les tickets de <strong>{nom}</strong>, en colonnes.</p>`, `<p>Voir les tickets de <Link to={x}>{nom}</Link>, en colonnes.</p>`), que cet élément soit écrit là, rendu sous
 *   condition (`{ok && <strong>{nom}</strong>}`), mis entre accolades, rendu par la flèche d'un `.map` ou d'un `.flatMap` (`<p>Indisponibles : {liste.map((x) => <strong key={x.id}>{x.name}</strong>)}.</p>`), ou rangé dans une
 *   variable qu'on pose ensuite dans du texte : `texte JSX`, ou `liste` pour ce que rend un `.map` ;
 * - dans une liste que la page écrira d'un trait (`liste.map((x) => x.name)`, à corps de bloc ou déstructurée, `['…', x.name].join(' ')`) : `liste`.
 * Sa valeur traverse ce qui la laisse telle quelle ou presque : parenthèses, `!`, `as`, `??`, `||`, `? :`, `String(…)`, un gabarit qui ne porte qu'elle (`${nom}`), un tableau qui la contient, et les méthodes de chaîne
 * qui la rendent encore, entière ou en partie (`.toString()`, `.trim()`, `.toLowerCase()`, `.split(…)[0]`…).
 * Elle n'est pas dans une phrase quand elle reste seule : seule dans son élément, un attribut, un argument, une propriété d'objet, une comparaison, une affectation : c'est un libellé.
 *
 * Un **élément de la ligne** est un élément de HTML qu'on écrit au fil du texte (`INLINE_TAGS` : la sémantique de niveau texte de la norme, `a`, `span`, `strong`, `em`, `code`, `kbd`, `time`…, et `button`, `label`, `output`), ou un composant,
 * dont on ne lit pas la définition : un nom en majuscule (`Link`, `NavLink`, `Button`, `Kbd`, `Fragment`), un nom à point (`Command.Item`, `Tooltip.Trigger`) ou à tiret (un élément personnalisé). Un lien, une touche, un bouton, une pastille rendent
 * un élément de la ligne, et c'est une liste de noms de balises qui a laissé passer `<Link>` (relecture finale, tour 2) : on suppose donc qu'un composant en rend un, quitte à refuser à tort un composant de bloc qui ne porterait qu'un nom
 * au milieu d'un texte (aucun ne le fait dans `src/web`). Les éléments de bloc de HTML (`<div>`, `<p>`, `<li>`, `<td>`, `<nav>`…) n'en sont pas : un nom seul dans l'un d'eux reste un libellé, quoi qu'il y ait autour.
 *
 * Ce que l'outil ne voit pas (`LIMITS`, dans `data/projectSentences.test.ts`, écrit chaque forme, un essai par ligne) : un nom qui passe par le paramètre d'une autre fonction ou d'un composant sous un autre nom (`<Phrase libelle={x.name} />`,
 * `<Nom />` qui rend `<strong>{x.name}</strong>`), une fonction importée d'un autre fichier qui le rend, un nom confié à une fonction qui en fait du texte (`format.format([x.name])`, `t('…', { nom: x.name })`), puisque rien n'y dit que c'est
 * une phrase ; un tableau qu'on filtre avant de le joindre (`[a, x.name].filter(Boolean).join(' · ')`), une propriété d'objet relue plus loin (`const ligne = { libelle: x.name }` puis `<p>Dans {ligne.libelle}</p>`), un nom que rend
 * `useMemo(() => x.name, …)` posé dans du texte, un nom qui prend la place d'un repère dans une chaîne (`'Les tickets de X'.replace('X', x.name)`), des noms ajoutés à un tableau par `forEach` et `push` avant un `join`, un élément fabriqué
 * par `createElement` plutôt qu'écrit en JSX, un nom passé en `children` (`<Link to={x} children={x.name} />`), un nom seul dans un élément de la ligne dont le texte voisin vient d'une expression et non du JSX
 * (`<p>{raison} <Link to={x}>{x.name}</Link></p>` : seul un texte écrit à côté compte, car une ligne de la barre latérale porte un nom seul à côté d'expressions qui rendent des éléments). Ce que le rendu écrit, lui, est éprouvé par `data/projectSentences.rendered.test.tsx`, sans lire le code, dans les états qu'il monte ; mais il ne lit pas un nom seul dans son élément au milieu d'une
 * phrase (le texte propre de l'élément est le repli seul) : celui-là, c'est ce balayage qui le lit, et `<Nom />` n'est donc lu par aucun des deux.
 */
export type SentenceKind = 'gabarit' | 'concaténation' | 'texte JSX' | 'liste';

export interface NameRead {
  /** Ce qui est lu : `project.name`, `ctx.projectName(id)`… */
  text: string;
  /** La ligne, de 1 à n. */
  line: number;
  /** Ce qu'il devient s'il est dans une phrase ; `undefined` quand il reste seul. */
  inSentence: SentenceKind | undefined;
}

/**
 * Les éléments de HTML qu'on écrit au fil d'un texte, pour mettre un mot en forme, le lier, le poser en touche ou en bouton : un nom seul dedans est encore dans la phrase qui l'entoure. Ce sont ceux de la sémantique de niveau texte
 * de la norme (`a`, `abbr`, `b`, `bdi`, `bdo`, `cite`, `code`, `data`, `dfn`, `em`, `i`, `kbd`, `mark`, `q`, `rp`, `rt`, `ruby`, `s`, `samp`, `small`, `span`, `strong`, `sub`, `sup`, `time`, `u`, `var`), les éditions (`del`, `ins`),
 * les contrôles qui se posent dans une ligne (`button`, `label`, `output`) et le `tspan` du SVG. Les éléments de bloc (`div`, `p`, `li`, `td`, `nav`…) n'y sont pas : ils font leur propre ligne.
 */
const INLINE_TAGS = new Set(
  'a abbr b bdi bdo button cite code data del dfn em i ins kbd label mark output q rp rt ruby s samp small span strong sub sup time tspan u var'.split(' '),
);
/**
 * Cette balise met-elle en forme un mot au fil du texte ? Un élément de HTML (nom en minuscules, sans point ni tiret) : s'il est dans `INLINE_TAGS`. Un composant (`<Link>`, `<NavLink>`, `<Kbd>`, `<Button>`, `<Fragment>`, `<Command.Item>`,
 * `<motion.span>`, un élément personnalisé `<mon-lien>`) : toujours, car on ne lit pas sa définition et qu'un lien, une touche, un bouton rendent un élément de la ligne ; c'est la liste de balises seule, qui ne nommait pas `Link`, qui a
 * laissé passer `<p>Voir les tickets de <Link to={x}>{nom}</Link>, en colonnes.</p>`.
 */
const isInlineTag = (tag: string): boolean => !/^[a-z]/.test(tag) || /[.-]/.test(tag) || INLINE_TAGS.has(tag);
/** Les méthodes de chaîne qui rendent encore le nom, entier ou en partie, transformé ou non (`.toString()` le rend tel quel ; `.split(…)` en rend les mots, dont on prend un). */
const STRING_METHODS_THAT_KEEP_THE_NAME = new Set([
  'toString',
  'valueOf',
  'toLowerCase',
  'toUpperCase',
  'toLocaleLowerCase',
  'toLocaleUpperCase',
  'toLocaleString',
  'trim',
  'trimStart',
  'trimEnd',
  'normalize',
  'slice',
  'substring',
  'substr',
  'padStart',
  'padEnd',
  'replace',
  'replaceAll',
  'repeat',
  'at',
  'charAt',
  'split',
]);

export function nameReads(source: string, fileName = 'x.tsx'): NameRead[] {
  const file = ts.createSourceFile(fileName, source, ts.ScriptTarget.Latest, true, fileName.endsWith('.tsx') ? ts.ScriptKind.TSX : ts.ScriptKind.TS);
  const aliases = new Set<string>();
  const nameFunctions = new Set<string>();

  /** L'expression sans ce qui l'enveloppe sans la changer : parenthèses, `!`, `as`, `<T>`, `satisfies`. */
  const unwrap = (node: ts.Node): ts.Node =>
    ts.isParenthesizedExpression(node) || ts.isNonNullExpression(node) || ts.isAsExpression(node) || ts.isTypeAssertionExpression(node) || ts.isSatisfiesExpression(node) ? unwrap(node.expression) : node;

  /** Un identifiant qui est lu, et non déclaré ni écrit comme clé ou comme propriété. */
  const isReference = (id: ts.Identifier): boolean => {
    const parent = id.parent;
    if (ts.isPropertyAccessExpression(parent) && parent.name === id) return false;
    if ((ts.isPropertyAssignment(parent) || ts.isPropertyDeclaration(parent) || ts.isPropertySignature(parent) || ts.isMethodDeclaration(parent)) && parent.name === id) return false;
    if (ts.isBindingElement(parent) && (parent.name === id || parent.propertyName === id)) return false;
    if ((ts.isParameter(parent) || ts.isVariableDeclaration(parent)) && parent.name === id) return false;
    if (ts.isJsxAttribute(parent) && parent.name === id) return false;
    return !ts.isQualifiedName(parent) && !ts.isTypeReferenceNode(parent);
  };

  const isNameRead = (node: ts.Node): boolean => {
    if (ts.isPropertyAccessExpression(node)) return node.name.text === 'name';
    if (ts.isElementAccessExpression(node)) return ts.isStringLiteralLike(node.argumentExpression) && node.argumentExpression.text === 'name';
    if (ts.isCallExpression(node)) {
      const callee = node.expression;
      return (ts.isIdentifier(callee) && (callee.text === 'projectName' || callee.text === 'projectLabel' || nameFunctions.has(callee.text))) || (ts.isPropertyAccessExpression(callee) && callee.name.text === 'projectName');
    }
    return ts.isIdentifier(node) && aliases.has(node.text) && isReference(node);
  };

  /** La valeur de l'expression peut-elle être un nom lu, à travers ce qui la laisse passer (`??`, `||`, `&&` à droite, `? :`) ? */
  const carriesName = (node: ts.Node): boolean => {
    const inner = unwrap(node);
    if (isNameRead(inner)) return true;
    if (ts.isConditionalExpression(inner)) return carriesName(inner.whenTrue) || carriesName(inner.whenFalse);
    // Un morceau d'un nom : `nom[0]`, `nom.split(' ')[0]`.
    if (ts.isElementAccessExpression(inner)) return carriesName(inner.expression);
    // `${nom}` seul, `String(nom)`, `nom.trim()` : le nom, encore.
    if (ts.isTemplateExpression(inner)) return inner.head.text === '' && inner.templateSpans.length === 1 && inner.templateSpans[0]?.literal.text === '' && carriesName(inner.templateSpans[0].expression);
    if (ts.isCallExpression(inner)) {
      if (ts.isIdentifier(inner.expression) && inner.expression.text === 'String') return inner.arguments[0] !== undefined && carriesName(inner.arguments[0]);
      if (ts.isPropertyAccessExpression(inner.expression) && STRING_METHODS_THAT_KEEP_THE_NAME.has(inner.expression.name.text)) return carriesName(inner.expression.expression);
    }
    if (ts.isBinaryExpression(inner)) {
      const operator = inner.operatorToken.kind;
      if (operator === ts.SyntaxKind.QuestionQuestionToken || operator === ts.SyntaxKind.BarBarToken) return carriesName(inner.left) || carriesName(inner.right);
      if (operator === ts.SyntaxKind.AmpersandAmpersandToken) return carriesName(inner.right);
    }
    return false;
  };

  const isFunction = (node: ts.Node): node is ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration =>
    ts.isArrowFunction(node) || ts.isFunctionExpression(node) || ts.isFunctionDeclaration(node);

  /** La fonction rend-elle ce que `carries` reconnaît (par une expression, ou par un `return`) ? */
  const returns = (fn: ts.Node, carries: (node: ts.Node) => boolean): boolean => {
    if (!isFunction(fn)) return false;
    if (ts.isArrowFunction(fn) && !ts.isBlock(fn.body)) return carries(fn.body);
    let found = false;
    const look = (node: ts.Node): void => {
      if (ts.isReturnStatement(node) && node.expression && carries(node.expression)) found = true;
      if (node !== fn && isFunction(node)) return;
      ts.forEachChild(node, look);
    };
    look(fn);
    return found;
  };
  const returnsName = (fn: ts.Node): boolean => returns(fn, carriesName);

  /** L'élément (ou le fragment) est-il de la ligne, comme `<strong>` ou `<Link>` (`isInlineTag`) ? Ce qu'il enveloppe est le mot qu'il met en forme, au milieu de ce qui l'entoure. */
  const isWrapper = (node: ts.Node): node is ts.JsxElement | ts.JsxFragment => ts.isJsxFragment(node) || (ts.isJsxElement(node) && isInlineTag(node.openingElement.tagName.getText()));
  const isListCall = (node: ts.Node): node is ts.CallExpression => ts.isCallExpression(node) && ts.isPropertyAccessExpression(node.expression) && ['map', 'flatMap'].includes(node.expression.name.text);

  /**
   * La valeur de l'expression est-elle un élément de mise en forme qui ne porte qu'un nom (`<strong>{x.name}</strong>`), ou une liste de tels éléments (ce que rend `liste.map(…)`) ? La variable qui la reçoit
   * est lue comme un nom, là où on la pose : `const noms = liste.map(…)` puis `<p>… {noms}.</p>`.
   */
  const carriesElement = (node: ts.Node): boolean => {
    const inner = unwrap(node);
    if (isWrapper(inner)) {
      const content = inner.children.filter((child) => !(ts.isJsxText(child) && child.text.trim() === ''));
      const only = content.length === 1 ? content[0] : undefined;
      if (only === undefined) return false;
      return ts.isJsxExpression(only) ? only.expression !== undefined && (carriesName(only.expression) || carriesElement(only.expression)) : carriesElement(only);
    }
    if (ts.isConditionalExpression(inner)) return carriesElement(inner.whenTrue) || carriesElement(inner.whenFalse);
    if (ts.isBinaryExpression(inner) && inner.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken) return carriesElement(inner.right);
    if (ts.isArrayLiteralExpression(inner)) return inner.elements.some(carriesElement);
    if (isListCall(inner)) {
      const callback = inner.arguments[0];
      return callback !== undefined && returns(callback, carriesElement);
    }
    return false;
  };

  // Les noms déstructurés : `const { name } = x`, `({ name }) => …`, `{ name: titre }`.
  const collectDestructured = (node: ts.Node): void => {
    if (ts.isBindingElement(node) && ts.isObjectBindingPattern(node.parent)) {
      const key = node.propertyName ?? node.name;
      if ((ts.isIdentifier(key) || ts.isStringLiteralLike(key)) && key.text === 'name' && ts.isIdentifier(node.name)) aliases.add(node.name.text);
    }
    ts.forEachChild(node, collectDestructured);
  };
  collectDestructured(file);

  // Ce qui en porte un : `const nom = x.name ?? y`, `nom = x.name`, `const nameOf = (id) => … ?.name`. Trois passes : une variable peut en porter une autre.
  for (let pass = 0; pass < 3; pass++) {
    const known = aliases.size + nameFunctions.size;
    const carry = (node: ts.Node): void => {
      if (ts.isFunctionDeclaration(node) && node.name && returnsName(node)) nameFunctions.add(node.name.text);
      if (ts.isVariableDeclaration(node) && ts.isIdentifier(node.name) && node.initializer) {
        if (returnsName(unwrap(node.initializer))) nameFunctions.add(node.name.text);
        else if (carriesName(node.initializer) || carriesElement(node.initializer)) aliases.add(node.name.text);
      }
      if (ts.isBinaryExpression(node) && node.operatorToken.kind === ts.SyntaxKind.EqualsToken && ts.isIdentifier(node.left) && (carriesName(node.right) || carriesElement(node.right))) aliases.add(node.left.text);
      ts.forEachChild(node, carry);
    };
    carry(file);
    if (aliases.size + nameFunctions.size === known) break;
  }

  const enclosingFunction = (node: ts.Node): ts.ArrowFunction | ts.FunctionExpression | ts.FunctionDeclaration | undefined => {
    for (let current: ts.Node | undefined = node.parent; current; current = current.parent) if (isFunction(current)) return current;
    return undefined;
  };

  /** La fonction est l'argument d'un `.map(…)` ou d'un `.flatMap(…)` : ce qu'elle rend est un élément de liste. */
  const isListCallback = (fn: ts.Node): boolean => {
    const call = fn.parent;
    return isListCall(call) && call.arguments.includes(fn as ts.Expression);
  };

  /** Du texte JSX qui se lit à côté : pas que des blancs (une espace seule entre deux éléments n'en est pas). */
  const hasText = (child: ts.Node): boolean => ts.isJsxText(child) && child.text.trim() !== '';
  /** Une autre expression à côté : pas `{' '}`. */
  const hasExpression = (child: ts.Node): boolean => ts.isJsxExpression(child) && child.expression !== undefined && !(ts.isStringLiteralLike(child.expression) && child.expression.text.trim() === '');

  /** Ce qui laisse passer la valeur de `node` sans la changer : parenthèses, `!`, `as`, un tableau qui la contient, `??`, `||`, `&&` à droite, les deux branches d'une condition. */
  const passes = (parent: ts.Node, node: ts.Node): boolean =>
    ts.isParenthesizedExpression(parent) ||
    ts.isNonNullExpression(parent) ||
    ts.isAsExpression(parent) ||
    ts.isTypeAssertionExpression(parent) ||
    ts.isSatisfiesExpression(parent) ||
    ts.isArrayLiteralExpression(parent) ||
    ts.isSpreadElement(parent) ||
    (ts.isConditionalExpression(parent) && parent.condition !== node) ||
    (ts.isBinaryExpression(parent) &&
      (parent.operatorToken.kind === ts.SyntaxKind.QuestionQuestionToken || parent.operatorToken.kind === ts.SyntaxKind.BarBarToken || (parent.operatorToken.kind === ts.SyntaxKind.AmpersandAmpersandToken && parent.right === node)));

  /**
   * Un élément de mise en forme qui ne porte qu'un nom est-il lui-même au milieu d'un texte ? On le suit là où il va : l'élément qui le contient (un autre élément de mise en forme, tant qu'il n'y a pas de texte à côté),
   * une expression `{…}`, une condition, la flèche d'un `.map` ou d'un `.flatMap` (ce qu'on pose alors dans le texte est une liste de ces éléments). Le texte à côté, lui, est du texte JSX : une autre expression ne fait pas une phrase.
   */
  const wrapperSentence = (wrapper: ts.Node): SentenceKind | undefined => {
    let kind: SentenceKind = 'texte JSX';
    let node: ts.Node = wrapper;
    for (;;) {
      const parent = node.parent;
      if (!parent) return undefined;
      if (passes(parent, node)) {
        node = parent;
        continue;
      }
      if (ts.isJsxExpression(parent) || ts.isJsxElement(parent) || ts.isJsxFragment(parent)) {
        const holder = ts.isJsxExpression(parent) ? parent.parent : parent;
        if (!ts.isJsxElement(holder) && !ts.isJsxFragment(holder)) return undefined;
        const mine = ts.isJsxExpression(parent) ? parent : node;
        if (holder.children.some((child) => child !== mine && hasText(child))) return kind;
        if (!isWrapper(holder)) return undefined;
        node = holder;
        continue;
      }
      if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === node)) {
        const fn = ts.isArrowFunction(parent) ? parent : enclosingFunction(parent);
        if (!fn || !isListCallback(fn)) return undefined;
        node = fn.parent;
        kind = 'liste';
        continue;
      }
      return undefined;
    }
  };

  /** Le nom écrit entre accolades est-il à côté d'un texte ? Seul dans son élément, regarde l'élément, tant que c'est un élément de mise en forme, et ce qui l'entoure (`wrapperSentence`). */
  const besideText = (expression: ts.JsxExpression): SentenceKind | undefined => {
    const holder = expression.parent;
    if (!ts.isJsxElement(holder) && !ts.isJsxFragment(holder)) return undefined;
    if (holder.children.some((child) => child !== expression && (hasText(child) || hasExpression(child)))) return 'texte JSX';
    return isWrapper(holder) ? wrapperSentence(holder) : undefined;
  };

  const sentenceOf = (read: ts.Node): SentenceKind | undefined => {
    let node: ts.Node = read;
    for (;;) {
      const parent = node.parent;
      if (!parent) return undefined;
      // Ce qui laisse passer la valeur.
      if (passes(parent, node)) {
        node = parent;
        continue;
      }
      if (ts.isBinaryExpression(parent)) {
        const operator = parent.operatorToken.kind;
        return operator === ts.SyntaxKind.PlusToken || operator === ts.SyntaxKind.PlusEqualsToken ? 'concaténation' : undefined;
      }
      // Un morceau du nom : `nom[0]`, `nom.split(' ')[0]`.
      if (ts.isElementAccessExpression(parent) && parent.expression === node) {
        node = parent;
        continue;
      }
      // Ce qui en fait une partie de phrase.
      if (ts.isTemplateSpan(parent)) {
        const template = parent.parent;
        if (template.head.text !== '' || template.templateSpans.length > 1 || parent.literal.text !== '') return 'gabarit';
        // `${nom}` seul : le nom, encore.
        node = template;
        continue;
      }
      if (ts.isJsxExpression(parent)) return besideText(parent);
      if (ts.isPropertyAccessExpression(parent) && parent.expression === node && ts.isCallExpression(parent.parent) && parent.parent.expression === parent) {
        const method = parent.name.text;
        if (method === 'join') return 'liste';
        if (method === 'concat') return 'concaténation';
        if (!STRING_METHODS_THAT_KEEP_THE_NAME.has(method)) return undefined;
        node = parent.parent;
        continue;
      }
      if (ts.isCallExpression(parent) && ts.isPropertyAccessExpression(parent.expression) && parent.expression.name.text === 'concat' && parent.arguments.includes(node as ts.Expression)) return 'concaténation';
      if (ts.isCallExpression(parent) && ts.isIdentifier(parent.expression) && parent.expression.text === 'String' && parent.arguments[0] === node) {
        node = parent;
        continue;
      }
      if (ts.isReturnStatement(parent) || (ts.isArrowFunction(parent) && parent.body === node)) {
        const fn = ts.isArrowFunction(parent) ? parent : enclosingFunction(parent);
        return fn && isListCallback(fn) ? 'liste' : undefined;
      }
      return undefined;
    }
  };

  const found: NameRead[] = [];
  const visit = (node: ts.Node): void => {
    if (isNameRead(node)) {
      found.push({ text: node.getText(file).replace(/\s+/g, ' '), line: file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1, inSentence: sentenceOf(node) });
    }
    ts.forEachChild(node, visit);
  };
  visit(file);
  return found;
}
