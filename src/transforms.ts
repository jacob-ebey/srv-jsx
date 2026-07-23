import path from "node:path";

import MagicString from "magic-string";

export type AstNode = {
  type: string;
  start: number;
  end: number;
  [key: string]: unknown;
};

export type AstProgram = AstNode & {
  body: AstNode[];
};

export type UseClientDirective = {
  node: AstNode;
  directive: AstNode;
  name: string;
  parent?: AstNode;
  parentKey?: string;
};

export type UseClientAnalysis = {
  moduleDirective?: AstNode;
  inlineDirectives: UseClientDirective[];
};

export type ClientReference = {
  mod: string;
  deps: string[];
};

export type TransformResult = {
  code: string;
  map: ReturnType<MagicString["generateMap"]>;
};

export type TransformReferenceOptions = {
  id: string;
  root?: string;
  base?: string;
  references?: ReadonlyMap<string, ClientReference>;
  placeholders?: boolean;
};

type BindCapture = {
  code: string;
  nodes: AstNode[];
};

const jsExtensions = new Set([".cjs", ".cts", ".js", ".jsx", ".mjs", ".mts", ".ts", ".tsx"]);
const clientReferenceHelperName = "__srv_jsx_define_client_reference";
const clientReferenceHelperImport = `import { defineClientReference as ${clientReferenceHelperName} } from "srv-jsx";`;

const ignoredAstKeys = new Set([
  "accessibility",
  "declare",
  "decorators",
  "end",
  "loc",
  "optional",
  "range",
  "readonly",
  "returnType",
  "start",
  "static",
  "type",
  "typeAnnotation",
  "typeArguments",
  "typeParameters",
]);

export function analyzeUseClientDirectives(code: string, ast: AstProgram): UseClientAnalysis {
  const moduleDirective = findUseClientDirective(ast.body);
  const inlineDirectives: UseClientDirective[] = [];

  walkAst(ast, (node, parent, parentKey) => {
    if (!isFunctionLike(node)) return;

    const body = node.body as AstNode | undefined;
    if (!body || body.type !== "BlockStatement") return;

    const directive = findUseClientDirective((body.body as AstNode[] | undefined) ?? []);
    if (!directive) return;

    inlineDirectives.push({
      node,
      directive,
      name: "",
      parent,
      parentKey,
    });
  });

  inlineDirectives.sort((left, right) => left.node.start - right.node.start);
  for (const [index, directive] of inlineDirectives.entries()) {
    directive.name = `__srv_jsx_client_${index}`;
  }

  assertValidDirectives(Boolean(moduleDirective), inlineDirectives);

  return {
    moduleDirective,
    inlineDirectives,
  };
}

export function transformUseClientForServer(
  code: string,
  ast: AstProgram,
  options: TransformReferenceOptions,
): TransformResult | null {
  const analysis = analyzeUseClientDirectives(code, ast);
  if (!analysis.moduleDirective && analysis.inlineDirectives.length === 0) return null;

  const magicString = new MagicString(code);
  if (analysis.moduleDirective) {
    magicString.overwrite(0, code.length, moduleReferenceExports(ast, options));
  } else {
    const moduleNames = collectModuleNames(collectModuleScope(ast));
    const declarations = analysis.inlineDirectives
      .map(
        (directive) =>
          `const ${directive.name} = ${clientReferenceCodeForServer(options, directive.name)};`,
      )
      .join("\n");
    const exports = `export { ${analysis.inlineDirectives
      .map((directive) => directive.name)
      .join(", ")} };`;

    magicString.prepend(`${clientReferenceHelperImport}\n${declarations}\n${exports}\n`);

    for (const directive of analysis.inlineDirectives.toReversed()) {
      const bindCaptures = collectBindCaptures(code, directive.node, moduleNames);
      replaceInlineImplementation(
        magicString,
        directive,
        clientReferenceExpression(directive.name, bindCaptures),
      );
    }
  }

  return magicStringResult(magicString, options.id);
}

export function transformUseClientForClient(
  code: string,
  ast: AstProgram,
  options: TransformReferenceOptions,
): TransformResult | null {
  const analysis = analyzeUseClientDirectives(code, ast);
  if (!analysis.moduleDirective && analysis.inlineDirectives.length === 0) return null;

  const magicString = new MagicString(code);

  if (analysis.moduleDirective) {
    magicString.remove(
      analysis.moduleDirective.start,
      endIncludingLineBreak(code, analysis.moduleDirective.end),
    );
    return magicStringResult(magicString, options.id);
  }

  const moduleScope = collectModuleScope(ast);
  const moduleNames = collectModuleNames(moduleScope);
  const neededNames = collectNeededNames(analysis.inlineDirectives, moduleScope);
  const imports = collectNeededImports(moduleScope.imports, neededNames);
  const declarations = collectNeededDeclarations(moduleScope.declarations, neededNames);
  const output = [
    ...imports.map((node) => printImportDeclaration(node, neededNames)),
    ...declarations.map((node) => code.slice(node.start, node.end)),
    ...analysis.inlineDirectives.map((directive) => {
      const bindCaptures = collectBindCaptures(code, directive.node, moduleNames);
      return `export const ${directive.name} = ${sourceWithoutDirective(
        code,
        directive.node,
        directive.directive,
        bindCaptures,
      )};`;
    }),
  ]
    .filter(Boolean)
    .join("\n\n");

  magicString.overwrite(0, code.length, `${output}\n`);

  return magicStringResult(magicString, options.id);
}

function assertValidDirectives(
  hasModuleDirective: boolean,
  inlineDirectives: UseClientDirective[],
) {
  if (hasModuleDirective && inlineDirectives.length > 0) {
    throw new Error('Cannot use module-level and inline "use client" directives in the same file.');
  }

  for (const directive of inlineDirectives) {
    for (const other of inlineDirectives) {
      if (directive === other) continue;
      if (directive.node.start < other.node.start && directive.node.end > other.node.end) {
        throw new Error('Nested inline "use client" directives are not supported.');
      }
    }
  }
}

function findUseClientDirective(body: AstNode[]) {
  for (const statement of body) {
    if (!isExpressionStatement(statement)) break;

    const expression = statement.expression as AstNode | undefined;
    if (!expression || !isStringLiteral(expression)) break;
    if (expression.value === "use client") return statement;
  }

  return undefined;
}

function isExpressionStatement(node: AstNode) {
  return node.type === "ExpressionStatement";
}

function isStringLiteral(node: AstNode) {
  return (
    (node.type === "Literal" || node.type === "StringLiteral") && typeof node.value === "string"
  );
}

function isFunctionLike(node: AstNode) {
  return (
    node.type === "ArrowFunctionExpression" ||
    node.type === "FunctionDeclaration" ||
    node.type === "FunctionExpression"
  );
}

function walkAst(
  node: AstNode,
  enter: (node: AstNode, parent: AstNode | undefined, parentKey: string | undefined) => void,
  parent?: AstNode,
  parentKey?: string,
) {
  enter(node, parent, parentKey);

  for (const [key, value] of Object.entries(node)) {
    if (ignoredAstKeys.has(key)) continue;

    if (Array.isArray(value)) {
      for (const item of value) {
        if (isAstNode(item)) walkAst(item, enter, node, key);
      }
    } else if (isAstNode(value)) {
      walkAst(value, enter, node, key);
    }
  }
}

function isAstNode(value: unknown): value is AstNode {
  return Boolean(value && typeof value === "object" && typeof (value as AstNode).type === "string");
}

function resolveClientReference(options: TransformReferenceOptions): ClientReference {
  const id = cleanId(options.id);
  const reference = options.references?.get(id);
  if (reference) return reference;

  return {
    mod: devModulePath(id, options.root, options.base),
    deps: [],
  };
}

function clientReferenceCodeForServer(options: TransformReferenceOptions, name: string) {
  if (options.placeholders) return clientReferencePlaceholderCode(options.id, name);
  return clientReferenceCode(resolveClientReference(options), name);
}

function clientReferenceCode(reference: ClientReference, name: string) {
  return `${clientReferenceHelperName}({ id: ${JSON.stringify(
    clientReferenceId(reference.mod, name),
  )}, name: ${JSON.stringify(name)}, mod: ${JSON.stringify(reference.mod)}, deps: ${JSON.stringify(
    reference.deps,
  )} })`;
}

function clientReferencePlaceholderCode(id: string, name: string) {
  const placeholders = clientReferencePlaceholders(id);
  return `${clientReferenceHelperName}({ id: ${clientReferenceIdPlaceholder(
    id,
    name,
  )}, name: ${JSON.stringify(name)}, mod: ${placeholders.mod}, deps: ${placeholders.deps} })`;
}

function clientReferenceId(mod: string, name: string) {
  return hashString(`${mod}#${name}`).padStart(6, "0").slice(0, 6);
}

function clientReferenceIdPlaceholder(id: string, name: string) {
  return `__SRV_JSX_CLIENT_REFERENCE_${hashString(cleanId(id))}_ID_${hexEncode(name)}__`;
}

function clientReferencePlaceholders(id: string) {
  const hash = hashString(cleanId(id));
  return {
    mod: `__SRV_JSX_CLIENT_REFERENCE_${hash}_MOD__`,
    deps: `__SRV_JSX_CLIENT_REFERENCE_${hash}_DEPS__`,
  };
}

export function replaceClientReferencePlaceholders(
  code: string,
  references: ReadonlyMap<string, ClientReference>,
) {
  let output = code;

  for (const [id, reference] of references) {
    const placeholders = clientReferencePlaceholders(id);
    const moduleHash = hashString(cleanId(id));
    output = output
      .replaceAll(placeholders.mod, JSON.stringify(reference.mod))
      .replaceAll(placeholders.deps, JSON.stringify(reference.deps))
      .replace(
        new RegExp(`\\b__SRV_JSX_CLIENT_REFERENCE_${moduleHash}_ID_([a-f0-9]+)__\\b`, "g"),
        (_placeholder, encodedName: string) =>
          JSON.stringify(clientReferenceId(reference.mod, hexDecode(encodedName))),
      );
  }

  const leftover = output.match(
    /\b__SRV_JSX_CLIENT_REFERENCE_[a-z0-9]+_(?:MOD|DEPS|ID_[a-f0-9]+)__\b/,
  );
  if (leftover) {
    throw new Error(`Missing client reference for placeholder ${leftover[0]}.`);
  }

  return output;
}

export function patchClientReferencePlaceholdersInBundle(
  bundle: Record<string, unknown>,
  references: ReadonlyMap<string, ClientReference>,
) {
  for (const output of Object.values(bundle)) {
    if (!isOutputChunk(output)) continue;
    output.code = replaceClientReferencePlaceholders(output.code, references);
  }
}

function isOutputChunk(value: unknown): value is { type: "chunk"; code: string } {
  return (
    Boolean(value) &&
    typeof value === "object" &&
    (value as { type?: unknown }).type === "chunk" &&
    typeof (value as { code?: unknown }).code === "string"
  );
}

function moduleReferenceExports(ast: AstProgram, options: TransformReferenceOptions) {
  const exports = collectModuleExports(ast);
  const references = new Map<string, string>();

  const referenceName = (name: string) => {
    const existing = references.get(name);
    if (existing) return existing;

    const local = `__srv_jsx_client_reference_${references.size}`;
    references.set(name, local);
    return local;
  };

  for (const name of exports.named) referenceName(name);
  if (exports.hasDefault) referenceName("default");

  const lines = references.size === 0 ? [] : [clientReferenceHelperImport];

  lines.push(
    ...[...references].map(
      ([name, local]) => `const ${local} = ${clientReferenceCodeForServer(options, name)};`,
    ),
  );

  if (exports.named.length > 0) {
    lines.push(
      `export { ${exports.named
        .map((name) => `${referenceName(name)} as ${formatExportName(name)}`)
        .join(", ")} };`,
    );
  }

  if (exports.hasDefault) {
    lines.push(`export default ${referenceName("default")};`);
  }

  if (exports.named.length === 0 && !exports.hasDefault) {
    lines.push("export {};");
  }

  return `${lines.join("\n")}\n`;
}

function collectModuleExports(ast: AstProgram) {
  const named = new Set<string>();
  let hasDefault = false;

  for (const statement of ast.body) {
    if (statement.type === "ExportDefaultDeclaration") {
      hasDefault = true;
      continue;
    }

    if (statement.type === "ExportAllDeclaration") {
      throw new Error('Module-level "use client" cannot rewrite export-all declarations.');
    }

    if (statement.type !== "ExportNamedDeclaration") continue;
    if (statement.exportKind === "type") continue;

    const declaration = statement.declaration as AstNode | null | undefined;
    if (declaration) {
      for (const name of declaredNames(declaration)) {
        named.add(name);
      }
      continue;
    }

    const specifiers = (statement.specifiers as AstNode[] | undefined) ?? [];
    for (const specifier of specifiers) {
      if (specifier.exportKind === "type") continue;

      const exported = specifier.exported as AstNode | undefined;
      const name = exportedName(exported);
      if (!name) continue;

      if (name === "default") {
        hasDefault = true;
      } else {
        named.add(name);
      }
    }
  }

  return { named: [...named], hasDefault };
}

function exportedName(node: AstNode | undefined) {
  if (!node) return undefined;
  if (typeof node.name === "string") return node.name;
  if (typeof node.value === "string") return node.value;
  return undefined;
}

function formatExportName(name: string) {
  return isIdentifierName(name) ? name : JSON.stringify(name);
}

function isIdentifierName(name: string) {
  return /^[A-Za-z_$][\w$]*$/.test(name);
}

function clientReferenceExpression(referenceName: string, bindCaptures: BindCapture[]) {
  if (bindCaptures.length === 0) return referenceName;
  return `${referenceName}.bind(null,${bindCaptures.map((capture) => capture.code).join(",")})`;
}

function replaceInlineImplementation(
  magicString: MagicString,
  directive: UseClientDirective,
  replacement: string,
) {
  const parent = directive.parent;

  if (parent?.type === "VariableDeclarator" && directive.parentKey === "init") {
    magicString.overwrite(directive.node.start, directive.node.end, replacement);
    return;
  }

  if (directive.node.type === "FunctionDeclaration") {
    const localName = functionName(directive.node) ?? directive.name;

    if (parent?.type === "ExportNamedDeclaration") {
      magicString.overwrite(
        parent.start,
        parent.end,
        `export const ${localName} = ${replacement};`,
      );
    } else {
      magicString.overwrite(
        directive.node.start,
        directive.node.end,
        `const ${localName} = ${replacement};`,
      );
    }
    return;
  }

  magicString.overwrite(directive.node.start, directive.node.end, replacement);
}

function functionName(node: AstNode) {
  const id = node.id as AstNode | null | undefined;
  return typeof id?.name === "string" ? id.name : undefined;
}

function sourceWithoutDirective(
  code: string,
  node: AstNode,
  directive: AstNode,
  bindCaptures: BindCapture[] = [],
) {
  const magicString = new MagicString(code.slice(node.start, node.end));
  addBindParameters(magicString, code, node, bindCaptures);

  for (const [index, capture] of bindCaptures.entries()) {
    for (const captureNode of capture.nodes.toReversed()) {
      magicString.overwrite(
        captureNode.start - node.start,
        captureNode.end - node.start,
        bindParameterName(index),
      );
    }
  }

  magicString.remove(
    directive.start - node.start,
    endIncludingLineBreak(code, directive.end) - node.start,
  );
  return magicString.toString();
}

function addBindParameters(
  magicString: MagicString,
  code: string,
  node: AstNode,
  bindCaptures: BindCapture[],
) {
  if (bindCaptures.length === 0) return;

  const params = bindCaptures.map((_, index) => bindParameterName(index)).join(", ");
  const existingParams = (node.params as AstNode[] | undefined) ?? [];

  if (node.type === "FunctionDeclaration" || node.type === "FunctionExpression") {
    const openParen = code.indexOf("(", node.start);
    if (openParen === -1 || openParen > node.end) return;
    magicString.appendLeft(
      openParen - node.start + 1,
      existingParams.length > 0 ? `${params}, ` : params,
    );
    return;
  }

  if (node.type !== "ArrowFunctionExpression") return;

  if (existingParams.length === 0) {
    const openParen = code.indexOf("(", node.start);
    if (openParen === -1 || openParen > node.end) return;
    magicString.appendLeft(openParen - node.start + 1, params);
    return;
  }

  const firstParam = existingParams[0]!;
  const beforeFirstParam = code.slice(node.start, firstParam.start);
  if (beforeFirstParam.includes("(")) {
    magicString.appendLeft(firstParam.start - node.start, `${params}, `);
    return;
  }

  magicString.prependLeft(firstParam.start - node.start, `(${params}, `);
  magicString.appendRight(firstParam.end - node.start, ")");
}

function bindParameterName(index: number) {
  return `__srv_jsx_bind_${index}`;
}

function endIncludingLineBreak(code: string, end: number) {
  if (code.charCodeAt(end) === 13 && code.charCodeAt(end + 1) === 10) return end + 2;
  if (code.charCodeAt(end) === 10) return end + 1;
  return end;
}

function magicStringResult(magicString: MagicString, source: string): TransformResult {
  return {
    code: magicString.toString(),
    map: magicString.generateMap({
      hires: true,
      includeContent: true,
      source,
    }),
  };
}

type ModuleScope = {
  imports: AstNode[];
  declarations: Map<string, AstNode>;
};

function collectModuleScope(ast: AstProgram): ModuleScope {
  const imports: AstNode[] = [];
  const declarations = new Map<string, AstNode>();

  for (const statement of ast.body) {
    if (statement.type === "ImportDeclaration") {
      imports.push(statement);
      continue;
    }

    const declaration =
      statement.type === "ExportNamedDeclaration"
        ? (statement.declaration as AstNode | null | undefined)
        : statement;
    if (!declaration) continue;

    for (const name of declaredNames(declaration)) {
      declarations.set(name, statement);
    }
  }

  return { imports, declarations };
}

function collectNeededNames(directives: UseClientDirective[], moduleScope: ModuleScope) {
  const neededNames = new Set<string>();
  const includedDeclarations = new Set<AstNode>();
  const queue: string[] = [];

  const addName = (name: string) => {
    if (neededNames.has(name)) return;
    neededNames.add(name);
    queue.push(name);
  };

  for (const directive of directives) {
    for (const name of collectFreeReferences(directive.node)) {
      addName(name);
    }
  }

  for (let name = queue.shift(); name; name = queue.shift()) {
    const declaration = moduleScope.declarations.get(name);
    if (!declaration || includedDeclarations.has(declaration)) continue;

    includedDeclarations.add(declaration);

    for (const reference of collectFreeReferences(declaration)) {
      addName(reference);
    }
  }

  return neededNames;
}

function collectNeededImports(imports: AstNode[], neededNames: Set<string>) {
  return imports.filter((node) => {
    if (node.importKind === "type") return false;

    const specifiers = (node.specifiers as AstNode[] | undefined) ?? [];
    return specifiers.some(
      (specifier) =>
        importSpecifierName(specifier, true) !== undefined &&
        neededNames.has(importSpecifierName(specifier, true)!),
    );
  });
}

function collectNeededDeclarations(declarations: Map<string, AstNode>, neededNames: Set<string>) {
  const neededDeclarations = new Set<AstNode>();

  for (const [name, declaration] of declarations) {
    if (neededNames.has(name)) neededDeclarations.add(declaration);
  }

  return [...neededDeclarations].sort((left, right) => left.start - right.start);
}

function printImportDeclaration(node: AstNode, neededNames: Set<string>) {
  const specifiers = ((node.specifiers as AstNode[] | undefined) ?? []).filter((specifier) => {
    const local = importSpecifierName(specifier, true);
    return local && neededNames.has(local);
  });

  const defaultSpecifier = specifiers.find(
    (specifier) => specifier.type === "ImportDefaultSpecifier",
  );
  const namespaceSpecifier = specifiers.find(
    (specifier) => specifier.type === "ImportNamespaceSpecifier",
  );
  const namedSpecifiers = specifiers.filter((specifier) => specifier.type === "ImportSpecifier");
  const parts: string[] = [];

  if (defaultSpecifier) {
    parts.push(importSpecifierName(defaultSpecifier, true)!);
  }

  if (namespaceSpecifier) {
    parts.push(`* as ${importSpecifierName(namespaceSpecifier, true)!}`);
  }

  if (namedSpecifiers.length > 0) {
    parts.push(
      `{ ${namedSpecifiers
        .map((specifier) => {
          const imported = importSpecifierName(specifier, false)!;
          const local = importSpecifierName(specifier, true)!;
          return imported === local ? imported : `${imported} as ${local}`;
        })
        .join(", ")} }`,
    );
  }

  const source = node.source as AstNode | undefined;
  const sourceCode =
    typeof source?.raw === "string"
      ? source.raw
      : JSON.stringify(typeof source?.value === "string" ? source.value : "");

  return `import ${parts.join(", ")} from ${sourceCode};`;
}

function importSpecifierName(specifier: AstNode, local: boolean) {
  const node =
    specifier.type === "ImportSpecifier"
      ? ((local ? specifier.local : specifier.imported) as AstNode | undefined)
      : (specifier.local as AstNode | undefined);
  if (typeof node?.name === "string") return node.name;
  if (typeof node?.value === "string") return node.value;
  return undefined;
}

function collectModuleNames(moduleScope: ModuleScope) {
  const names = new Set(moduleScope.declarations.keys());

  for (const node of moduleScope.imports) {
    for (const specifier of (node.specifiers as AstNode[] | undefined) ?? []) {
      const local = importSpecifierName(specifier, true);
      if (local) names.add(local);
    }
  }

  return names;
}

function collectBindCaptures(code: string, root: AstNode, moduleNames: Set<string>) {
  const parents = new WeakMap<AstNode, { parent: AstNode; parentKey: string | undefined }>();
  walkAst(root, (node, parent, parentKey) => {
    if (parent) parents.set(node, { parent, parentKey });
  });

  const captures = new Map<string, BindCapture>();
  const scopes: Set<string>[] = [new Set()];

  const isDeclared = (name: string) => scopes.some((scope) => scope.has(name));
  const declare = (name: string) => scopes[0]!.add(name);

  const addCapture = (node: AstNode) => {
    const captureCode = code.slice(node.start, node.end);
    const capture = captures.get(captureCode);
    if (capture) {
      capture.nodes.push(node);
    } else {
      captures.set(captureCode, { code: captureCode, nodes: [node] });
    }
  };

  const visit = (node: AstNode, parent?: AstNode, parentKey?: string) => {
    if (node.type === "Identifier") {
      if (!isReferenceIdentifier(node, parent, parentKey)) return;

      const name = node.name as string;
      if (!isDeclared(name) && !moduleNames.has(name) && !isKnownGlobal(name)) {
        addCapture(bindExpressionNode(node, parents));
      }
      return;
    }

    if (node.type === "VariableDeclaration") {
      for (const declaration of (node.declarations as AstNode[] | undefined) ?? []) {
        collectPatternNames(declaration.id as AstNode | undefined, scopes[0]!);
        if (isAstNode(declaration.init)) visit(declaration.init, declaration, "init");
      }
      return;
    }

    if (node.type === "FunctionDeclaration") {
      const name = functionName(node);
      if (name) declare(name);
      visitFunctionBody(node);
      return;
    }

    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      visitFunctionBody(node);
      return;
    }

    if (node.type === "ClassDeclaration") {
      const id = node.id as AstNode | null | undefined;
      if (typeof id?.name === "string") declare(id.name);
    }

    for (const [key, value] of Object.entries(node)) {
      if (ignoredAstKeys.has(key)) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item, node, key);
        }
      } else if (isAstNode(value)) {
        visit(value, node, key);
      }
    }
  };

  const visitFunctionBody = (node: AstNode) => {
    const scope = new Set<string>();
    scopes.unshift(scope);

    const id = node.id as AstNode | null | undefined;
    if (typeof id?.name === "string") scope.add(id.name);

    for (const parameter of (node.params as AstNode[] | undefined) ?? []) {
      collectPatternNames(parameter, scope);
    }

    const body = node.body as AstNode | undefined;
    if (body) visit(body, node, "body");

    scopes.shift();
  };

  visit(root);
  return [...captures.values()];
}

function bindExpressionNode(
  node: AstNode,
  parents: WeakMap<AstNode, { parent: AstNode; parentKey: string | undefined }>,
) {
  let expression = node;
  let current = node;
  let link = parents.get(current);

  while (
    link?.parent.type === "MemberExpression" &&
    link.parentKey === "object" &&
    link.parent.object === current
  ) {
    expression = link.parent;
    current = link.parent;
    link = parents.get(current);
  }

  return expression;
}

const commonGlobalNames = new Set([
  "AbortController",
  "Blob",
  "CustomEvent",
  "Document",
  "Element",
  "Event",
  "EventTarget",
  "File",
  "FormData",
  "HTMLElement",
  "Headers",
  "Location",
  "Request",
  "Response",
  "URL",
  "URLSearchParams",
  "WebSocket",
  "Window",
  "crypto",
  "document",
  "fetch",
  "globalThis",
  "location",
  "navigator",
  "self",
  "window",
]);

function isKnownGlobal(name: string) {
  return name in globalThis || commonGlobalNames.has(name);
}

function collectFreeReferences(root: AstNode) {
  const references = new Set<string>();
  const scopes: Set<string>[] = [new Set()];

  const isDeclared = (name: string) => scopes.some((scope) => scope.has(name));
  const declare = (name: string) => scopes[0]!.add(name);

  const visit = (node: AstNode, parent?: AstNode, parentKey?: string) => {
    if (node.type === "Identifier") {
      if (!isReferenceIdentifier(node, parent, parentKey)) return;

      const name = node.name as string;
      if (!isDeclared(name)) references.add(name);
      return;
    }

    if (node.type === "JSXIdentifier") {
      const name = node.name as string;
      if (isJSXComponentName(name) && !isDeclared(name)) references.add(name);
      return;
    }

    if (node.type === "VariableDeclaration") {
      for (const declaration of (node.declarations as AstNode[] | undefined) ?? []) {
        collectPatternNames(declaration.id as AstNode | undefined, scopes[0]!);
        if (isAstNode(declaration.init)) visit(declaration.init, declaration, "init");
      }
      return;
    }

    if (node.type === "FunctionDeclaration") {
      const name = functionName(node);
      if (name) declare(name);
      visitFunctionBody(node);
      return;
    }

    if (node.type === "FunctionExpression" || node.type === "ArrowFunctionExpression") {
      visitFunctionBody(node);
      return;
    }

    if (node.type === "ClassDeclaration") {
      const id = node.id as AstNode | null | undefined;
      if (typeof id?.name === "string") declare(id.name);
    }

    for (const [key, value] of Object.entries(node)) {
      if (ignoredAstKeys.has(key)) continue;

      if (Array.isArray(value)) {
        for (const item of value) {
          if (isAstNode(item)) visit(item, node, key);
        }
      } else if (isAstNode(value)) {
        visit(value, node, key);
      }
    }
  };

  const visitFunctionBody = (node: AstNode) => {
    const scope = new Set<string>();
    scopes.unshift(scope);

    const id = node.id as AstNode | null | undefined;
    if (typeof id?.name === "string") scope.add(id.name);

    for (const parameter of (node.params as AstNode[] | undefined) ?? []) {
      collectPatternNames(parameter, scope);
    }

    const body = node.body as AstNode | undefined;
    if (body) visit(body, node, "body");

    scopes.shift();
  };

  visit(root);
  return references;
}

function isReferenceIdentifier(node: AstNode, parent?: AstNode, parentKey?: string) {
  if (!parent) return true;
  if (parentKey === "id") return false;
  if (parentKey === "params") return false;
  if (parent.type === "ImportSpecifier" || parent.type === "ImportDefaultSpecifier") return false;
  if (parent.type === "ImportNamespaceSpecifier" || parent.type === "ExportSpecifier") return false;
  if (parent.type === "LabeledStatement" || parent.type === "BreakStatement") return false;
  if (parent.type === "ContinueStatement") return false;
  if (parent.type === "MemberExpression" && parentKey === "property" && !parent.computed)
    return false;
  if (parent.type === "Property" && parentKey === "key" && !parent.computed) return false;
  if (parent.type === "MethodDefinition" && parentKey === "key") return false;
  return node.type === "Identifier";
}

function isJSXComponentName(name: string) {
  return /^[A-Z_$]/.test(name);
}

function declaredNames(node: AstNode) {
  const names = new Set<string>();

  if (node.type === "FunctionDeclaration" || node.type === "ClassDeclaration") {
    const id = node.id as AstNode | null | undefined;
    if (typeof id?.name === "string") names.add(id.name);
    return names;
  }

  if (node.type === "VariableDeclaration") {
    for (const declaration of (node.declarations as AstNode[] | undefined) ?? []) {
      collectPatternNames(declaration.id as AstNode | undefined, names);
    }
  }

  return names;
}

function collectPatternNames(pattern: AstNode | undefined, names: Set<string>) {
  if (!pattern) return;

  if (pattern.type === "Identifier") {
    names.add(pattern.name as string);
    return;
  }

  if (pattern.type === "RestElement") {
    collectPatternNames(pattern.argument as AstNode | undefined, names);
    return;
  }

  if (pattern.type === "AssignmentPattern") {
    collectPatternNames(pattern.left as AstNode | undefined, names);
    return;
  }

  if (pattern.type === "ArrayPattern") {
    for (const element of (pattern.elements as Array<AstNode | null> | undefined) ?? []) {
      if (element) collectPatternNames(element, names);
    }
    return;
  }

  if (pattern.type === "ObjectPattern") {
    for (const property of (pattern.properties as AstNode[] | undefined) ?? []) {
      if (property.type === "RestElement") {
        collectPatternNames(property.argument as AstNode | undefined, names);
      } else {
        collectPatternNames(property.value as AstNode | undefined, names);
      }
    }
  }
}

export function cleanId(id: string) {
  return normalizePath(id.replace(/[?#].*$/, ""));
}

export function isJavaScriptId(id: string) {
  return jsExtensions.has(path.extname(id));
}

function devModulePath(id: string, root = process.cwd(), base = "/") {
  const relative = normalizePath(path.relative(root, id));
  const publicPath = relative.startsWith("..") ? `/@fs/${id}` : `/${relative}`;
  return joinPublicBase(publicPath, base);
}

export function publicOutputPath(fileName: string, base = "/") {
  return joinPublicBase(`/${normalizePath(fileName)}`, base);
}

function joinPublicBase(publicPath: string, base: string) {
  if (base === "" || base === "/" || base === "./") return publicPath;
  return `${base.replace(/\/$/, "")}${publicPath}`;
}

function normalizePath(file: string) {
  return file.replaceAll(path.sep, "/");
}

function hexEncode(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index++) {
    output += value.charCodeAt(index).toString(16).padStart(4, "0");
  }
  return output;
}

function hexDecode(value: string) {
  let output = "";
  for (let index = 0; index < value.length; index += 4) {
    output += String.fromCharCode(Number.parseInt(value.slice(index, index + 4), 16));
  }
  return output;
}

function hashString(value: string) {
  let hash = 5381;
  for (let index = 0; index < value.length; index++) {
    hash = (hash * 33) ^ value.charCodeAt(index);
  }
  return (hash >>> 0).toString(36);
}
