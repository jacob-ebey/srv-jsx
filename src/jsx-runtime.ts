const clientReferenceType = Symbol.for("srv-jsx.client-reference");
const nodeMarker = Symbol.for("srv-jsx.node");

const voidElementNames = " area base br col embed hr img input link meta param source track wbr ";
const hoistableHeadElementNames = " base meta title ";
const headMarkerName = "srv-jsx-head";
const attributeNamePattern = /^[A-Za-z_:][A-Za-z0-9:_.-]*$/;
const svgDashCaseAttributeNames =
  " accentHeight alignmentBaseline arabicForm baselineShift capHeight clipPath clipRule colorInterpolation colorInterpolationFilters colorProfile colorRendering dominantBaseline enableBackground fillOpacity fillRule floodColor floodOpacity fontFamily fontSize fontSizeAdjust fontStretch fontStyle fontVariant fontWeight glyphName glyphOrientationHorizontal glyphOrientationVertical horizAdvX horizOriginX imageRendering letterSpacing lightingColor markerEnd markerMid markerStart overlinePosition overlineThickness paintOrder stopColor stopOpacity strikethroughPosition strikethroughThickness strokeDasharray strokeDashoffset strokeLinecap strokeLinejoin strokeMiterlimit strokeOpacity strokeWidth textAnchor textDecoration textRendering underlinePosition underlineThickness unicodeBidi unicodeRange unitsPerEm vAlphabetic vHanging vIdeographic vMathematical vectorEffect vertAdvY vertOriginX vertOriginY wordSpacing writingMode xHeight ";
const svgColonAttributeNames =
  " xlinkActuate xlinkArcrole xlinkHref xlinkRole xlinkShow xlinkTitle xlinkType xmlBase xmlLang xmlSpace xmlnsXlink ";

export const Fragment = Symbol.for("srv-jsx.fragment");

declare const clientReferenceMarker: unique symbol;

declare global {
  interface GlobalEventHandlersEventMap {}
}

export type AttributeValue = string | number | boolean | null | undefined;
export type Component<P extends object = JSXProps> = (props: P) => JSXChild;
type ClientReferenceValue = {
  readonly [clientReferenceMarker]: never;
};
type EventAttributeValue<EventType extends Event = Event> =
  | ClientReferenceValue
  | { bivarianceHack(this: EventTarget, event: EventType): void }["bivarianceHack"]
  | {
      handleEvent(event: EventType): void;
    };
type KnownEventName = Extract<keyof GlobalEventHandlersEventMap, string>;
type KnownEventAttributes = {
  [EventName in KnownEventName as `on${EventName}`]?:
    | AttributeValue
    | EventAttributeValue<GlobalEventHandlersEventMap[EventName]>
    | JSXChild;
};
export type JSXChild =
  | JSXElement
  | string
  | number
  | boolean
  | null
  | undefined
  | PromiseLike<unknown>
  | readonly JSXChild[];

export interface JSXProps extends KnownEventAttributes {
  children?: JSXChild;
  innerHTML?: string;
  [property: `on${string}`]: AttributeValue | EventAttributeValue | JSXChild;
  [property: string]: AttributeValue | EventAttributeValue | JSXChild;
}

export interface SuspenseProps {
  children?: JSXChild;
  fallback?: JSXChild;
}

export interface ErrorBoundaryProps {
  children?: JSXChild;
  fallback?: JSXChild;
}

export interface ClientEvent {
  readonly event: string;
  readonly reference: unknown;
}

export interface RenderOptions {
  encodeClientEvent?: (event: ClientEvent) => string;
  idPrefix?: string;
  nonce?: string;
  onError?: (error: unknown) => void;
  prerender?: boolean;
  signal?: AbortSignal;
}

export type RenderReadableStream = ReadableStream<Uint8Array>;

type ClientReferenceDefinition = {
  readonly bound?: readonly unknown[];
  readonly deps: readonly string[];
  readonly id: string;
  readonly mod: string;
  readonly name: string;
};

interface ClientReference {
  bind(_this: unknown, ...bound: readonly unknown[]): ClientReference;
  readonly bound?: readonly unknown[];
  readonly deps: readonly string[];
  readonly id: string;
  readonly mod: string;
  readonly name: string;
  readonly type: typeof clientReferenceType;
}

interface InternalClientEvent {
  readonly event: string;
  readonly reference: ClientReference;
}

interface ComponentNode {
  readonly [nodeMarker]: true;
  readonly kind: "component";
  readonly props: JSXProps;
  readonly type: Component;
}

interface ElementNode {
  readonly [nodeMarker]: true;
  readonly kind: "element";
  readonly props: JSXProps;
  readonly tagName: string;
}

interface ErrorBoundaryNode {
  readonly [nodeMarker]: true;
  readonly children: JSXChild;
  readonly fallback: JSXChild;
  readonly kind: "error-boundary";
}

interface SuspenseNode {
  readonly [nodeMarker]: true;
  readonly children: JSXChild;
  readonly fallback: JSXChild;
  readonly kind: "suspense";
}

export type JSXElement = ComponentNode | ElementNode | ErrorBoundaryNode | SuspenseNode;

interface BoundaryResult {
  error?: unknown;
  html: string;
  task: BoundaryTask;
}

interface ErrorHandler {
  fallback: JSXChild;
  name: string;
  path: string;
  state: RenderState;
}

interface BoundaryTask {
  handler: ErrorHandler | undefined;
}

interface Writer {
  flush?(): void;
  write(chunk: string): void;
}

interface BufferedWriter extends Writer {
  html: string;
}

interface ChunkQueueItem {
  done: boolean;
  value?: string;
}

interface HeadScope {
  chunks: string[];
  kind: "root" | "template";
}

type RenderNamespace = "html" | "svg";
type SuspenseRenderMode = "prerender" | "streaming";

interface RenderState {
  deferHead: boolean;
  doc: boolean;
  head: HeadScope;
  inHead: boolean;
  ns: RenderNamespace;
}

class ChunkQueue implements Writer {
  private buffer = "";
  private readonly chunks: string[] = [];
  private closed = false;
  private waiter: PromiseWithResolvers<void> | undefined;

  close() {
    if (this.closed) {
      return;
    }

    this.flush();
    this.closed = true;
    this.resolveWaiter();
  }

  async next(): Promise<ChunkQueueItem> {
    const value = this.chunks.shift();

    if (value !== undefined) {
      return { done: false, value };
    }

    if (this.closed) {
      return { done: true };
    }

    const waiter = Promise.withResolvers<void>();

    this.waiter = waiter;
    await waiter.promise;

    return this.next();
  }

  flush() {
    if (this.buffer.length > 0 && !this.closed) {
      this.chunks.push(this.buffer);
      this.buffer = "";
      this.resolveWaiter();
      return;
    }

    this.resolveWaiter();
  }

  write(chunk: string) {
    if (chunk.length === 0 || this.closed) {
      return;
    }

    this.buffer += chunk;
  }

  private resolveWaiter() {
    const waiter = this.waiter;

    if (waiter === undefined) {
      return;
    }

    this.waiter = undefined;
    waiter.resolve();
  }
}

class RenderContext {
  private abort: (() => void) | undefined;
  private aborted: Promise<never>;
  private rejectBoundary: ((error: unknown) => void) | undefined;
  private resolveBoundary: ((result: BoundaryResult) => void) | undefined;
  private boundaries: BoundaryResult[] = [];
  private flushedHead = false;
  private shellDone = false;
  readonly pending = new Set<BoundaryTask>();
  private readonly handlers: ErrorHandler[] = [];

  constructor(
    readonly encodeEvent: (event: InternalClientEvent) => string,
    private readonly prefix: string,
    private readonly nonce: string | undefined,
    private readonly onError: ((error: unknown) => void) | undefined,
    private readonly signal: AbortSignal,
    private readonly shellReady: PromiseWithResolvers<void>,
    readonly suspenseMode: SuspenseRenderMode,
  ) {
    let rejectAbortPromise!: (error: unknown) => void;
    this.aborted = new Promise<never>((_resolve, reject) => {
      rejectAbortPromise = reject;
    });
    this.aborted.catch(() => {});

    this.abort = () => {
      const reason = getAbortReason(signal);
      rejectAbortPromise(reason);
      this.rejectBoundary?.(reason);
    };

    if (signal.aborted) {
      this.abort();
    } else {
      signal.addEventListener("abort", this.abort, { once: true });
    }
  }

  boundaryName(path: string) {
    return `${this.prefix}${hashBoundaryPath(path)}`;
  }

  createRootRenderState(): RenderState {
    return {
      deferHead: false,
      doc: true,
      head: { chunks: [], kind: "root" },
      inHead: false,
      ns: "html",
    };
  }

  createTemplateRenderState(parentState?: RenderState): RenderState {
    return {
      deferHead: false,
      doc: parentState?.doc ?? true,
      head: { chunks: [], kind: "template" },
      inHead: false,
      ns: parentState?.ns ?? "html",
    };
  }

  hasFlushedHead() {
    return this.flushedHead;
  }

  hasShellReady() {
    return this.shellDone;
  }

  flushHead(state: RenderState) {
    this.flushedHead = true;
    const html = `${state.head.chunks.join("")}${renderHeadMarker()}`;
    state.head.chunks = [];
    return html;
  }

  renderHeadTemplate(html: string) {
    return `<template for="${headMarkerName}">${html}${renderHeadMarker()}</template>`;
  }

  renderNonceAttribute() {
    return this.nonce === undefined ? "" : ` nonce="${escapeAttribute(this.nonce)}"`;
  }

  renderScript(content: string) {
    return `<script${this.renderNonceAttribute()}>${escapeScriptContent(content)}</script>`;
  }

  reportError(error: unknown) {
    if (this.onError === undefined || this.isAbortError(error)) {
      return;
    }

    try {
      this.onError(error);
    } catch {
      // Logging failures should not affect rendering.
    }
  }

  scheduleTemplate(name: string, children: JSXChild, path: string, parentState: RenderState) {
    const task: BoundaryTask = { handler: this.currentErrorHandler() };

    this.pending.add(task);

    void (async () => {
      try {
        const state = this.createTemplateRenderState(parentState);
        const html = await renderToBufferedString(children, this, path, state);
        const headHtml = state.head.chunks.join("");

        this.completeBoundary({
          html: `${headHtml.length === 0 ? "" : this.renderHeadTemplate(headHtml)}<template for="${escapeAttribute(
            name,
          )}">${html}</template>`,
          task,
        });
      } catch (error) {
        this.completeBoundary({ error, html: "", task });
      }
    })();
  }

  async nextBoundaryResult() {
    const result = this.boundaries.shift();

    if (result !== undefined) {
      return result;
    }

    this.throwIfAborted();

    return new Promise<BoundaryResult>((resolve, reject) => {
      this.resolveBoundary = (boundaryResult) => {
        this.rejectBoundary = undefined;
        this.resolveBoundary = undefined;
        resolve(boundaryResult);
      };
      this.rejectBoundary = (error) => {
        this.rejectBoundary = undefined;
        this.resolveBoundary = undefined;
        reject(error);
      };
    });
  }

  throwIfAborted() {
    throwIfAborted(this.signal);
  }

  async waitFor<T>(value: PromiseLike<T>) {
    this.throwIfAborted();
    return Promise.race([value, this.aborted]);
  }

  async withErrorHandler<T>(handler: ErrorHandler, run: () => Promise<T>): Promise<T> {
    this.handlers.push(handler);

    try {
      return await run();
    } finally {
      this.handlers.pop();
    }
  }

  isAbortError(error: unknown) {
    return this.signal.aborted && Object.is(error, getAbortReason(this.signal));
  }

  markShellReady() {
    if (this.shellDone) {
      return;
    }

    this.shellDone = true;
    this.shellReady.resolve();
  }

  rejectShellReady(error: unknown) {
    if (this.shellDone) {
      return;
    }

    this.shellDone = true;
    this.shellReady.reject(error);
  }

  dispose() {
    if (this.abort !== undefined) {
      this.signal.removeEventListener("abort", this.abort);
      this.abort = undefined;
    }
  }

  private completeBoundary(result: BoundaryResult) {
    if (this.resolveBoundary !== undefined) {
      this.resolveBoundary(result);
      return;
    }

    this.boundaries.push(result);
  }

  private currentErrorHandler() {
    return this.handlers.at(-1);
  }
}

export function defineClientReference(reference: ClientReferenceDefinition): ClientReferenceValue {
  return {
    bind(_this: unknown, ...bound: readonly unknown[]) {
      return defineClientReference({
        ...reference,
        bound: [...(reference.bound ?? []), ...bound],
      });
    },
    bound: reference.bound,
    deps: reference.deps,
    id: reference.id,
    mod: reference.mod,
    name: reference.name,
    type: clientReferenceType,
  } as unknown as ClientReferenceValue;
}

export function jsx(type: string | typeof Fragment | Component, props: JSXProps | null): JSXChild {
  const resolvedProps = props ?? {};

  if (type === Fragment) {
    return resolvedProps.children;
  }

  if (type === Suspense) {
    return createSuspenseNode(resolvedProps as SuspenseProps);
  }

  if (type === ErrorBoundary) {
    return createErrorBoundaryNode(resolvedProps as ErrorBoundaryProps);
  }

  if (typeof type === "function") {
    return {
      [nodeMarker]: true,
      kind: "component",
      props: resolvedProps,
      type,
    };
  }

  if (typeof type !== "string" || type.length === 0) {
    throw new TypeError("JSX element names must be non-empty strings.");
  }

  return {
    [nodeMarker]: true,
    kind: "element",
    props: resolvedProps,
    tagName: type,
  };
}

export const jsxs = jsx;

export function Suspense(props: SuspenseProps): JSXElement {
  return createSuspenseNode(props);
}

export function ErrorBoundary(props: ErrorBoundaryProps): JSXElement {
  return createErrorBoundaryNode(props);
}

export async function renderToReadableStream(
  value: JSXChild,
  options: RenderOptions = {},
): Promise<RenderReadableStream> {
  const abortController = new AbortController();
  const unlinkSignal = linkAbortSignal(options.signal, abortController);
  const shellReady = Promise.withResolvers<void>();
  shellReady.promise.catch(() => {});
  const context = new RenderContext(
    options.encodeClientEvent ?? defaultEncodeClientEvent,
    options.idPrefix ?? "srv-jsx-",
    options.nonce,
    options.onError,
    abortController.signal,
    shellReady,
    options.prerender === true ? "prerender" : "streaming",
  );
  const queue = new ChunkQueue();

  void (async () => {
    try {
      await renderValue(value, context, queue, "0", context.createRootRenderState());
      queue.flush();
      context.markShellReady();
      await drainPending(context, queue);
    } catch (error) {
      if (context.hasShellReady()) {
        context.reportError(error);
      } else {
        context.rejectShellReady(error);
      }
    } finally {
      queue.close();
      unlinkSignal();
      context.dispose();
    }
  })();

  await shellReady.promise;

  const encoder = new TextEncoder();
  let canceled = false;
  const stream = new ReadableStream<Uint8Array>(
    {
      async pull(controller) {
        const next = await queue.next();

        if (canceled) {
          return;
        }

        if (next.done) {
          controller.close();
          unlinkSignal();
          return;
        }

        controller.enqueue(encoder.encode(next.value ?? ""));
      },
      cancel(reason) {
        canceled = true;
        abortController.abort(reason);
        unlinkSignal();
      },
    },
    { highWaterMark: 0 },
  );

  return stream;
}

async function drainPending(context: RenderContext, writer: Writer) {
  while (context.pending.size > 0) {
    const result = await context.nextBoundaryResult();

    context.pending.delete(result.task);

    if (result.error !== undefined) {
      if (context.isAbortError(result.error)) {
        throw result.error;
      }

      if (result.task.handler === undefined) {
        throw result.error;
      }

      const fallbackHtml = await renderErrorFallbackTemplate(result.task.handler, context);
      context.reportError(result.error);
      writer.write(fallbackHtml);
      writer.flush?.();
      continue;
    }

    writer.write(result.html);
    writer.flush?.();
  }
}

async function renderValue(
  value: JSXChild,
  context: RenderContext,
  writer: Writer,
  path: string,
  state: RenderState,
): Promise<void> {
  context.throwIfAborted();

  if (value === null || value === undefined || typeof value === "boolean") {
    return;
  }

  if (typeof value === "string") {
    writer.write(escapeText(value));
    return;
  }

  if (typeof value === "number") {
    writer.write(escapeText(value.toString()));
    return;
  }

  if (isPromiseLike(value)) {
    const resolvedValue = await context.waitFor(value);
    await renderValue(resolvedValue as JSXChild, context, writer, path, state);
    return;
  }

  if (Array.isArray(value)) {
    for (const [index, child] of value.entries()) {
      await renderValue(child, context, writer, `${path}-${index}`, state);
    }

    return;
  }

  if (!isNode(value)) {
    throw new TypeError(`Unsupported JSX child value: ${describeValue(value)}.`);
  }

  if (value.kind === "component") {
    await renderValue(value.type(value.props), context, writer, path, state);
    return;
  }

  if (value.kind === "error-boundary") {
    await renderErrorBoundary(value, context, writer, path, state);
    return;
  }

  if (value.kind === "suspense") {
    await renderSuspense(value, context, writer, path, state);
    return;
  }

  await renderElement(value, context, writer, path, state);
}

async function renderElement(
  node: ElementNode,
  context: RenderContext,
  writer: Writer,
  path: string,
  state: RenderState,
) {
  assertValidElementName(node.tagName);
  const namespace = elementNamespace(state.ns, node.tagName);
  const documentHtml = state.doc && namespace === "html";

  if (documentHtml && !state.inHead && isHoistableHeadElement(node.tagName)) {
    await renderDetachedHeadElement(node, context, writer, path, state);
    return;
  }

  let attributes = "";
  const clientEvents: InternalClientEvent[] = [];

  for (const [name, value] of Object.entries(node.props)) {
    if (isClientEventAttribute(name, value)) {
      clientEvents.push({ event: name.slice(2), reference: value });
      continue;
    }

    if (
      namespace === "html" &&
      name === "nonce" &&
      value === true &&
      isNonceElement(node.tagName)
    ) {
      attributes += context.renderNonceAttribute();
      continue;
    }

    attributes += renderAttribute(name, value, namespace);
  }

  const hasInnerHTML = node.props.innerHTML !== null && node.props.innerHTML !== undefined;
  const hasChildren = hasRenderableChildren(node.props.children);

  if (documentHtml && node.tagName === "html") {
    writer.write("<!DOCTYPE html>");
  }

  if (namespace === "html" && isVoidElement(node.tagName)) {
    if (hasInnerHTML || hasChildren) {
      throw new TypeError(`Void element <${node.tagName}> cannot have children or innerHTML.`);
    }

    writer.write(`<${node.tagName}${attributes}>`);
    await renderClientEventScripts(clientEvents, context, writer);
    return;
  }

  writer.write(`<${node.tagName}${attributes}>`);

  if (hasInnerHTML) {
    if (typeof node.props.innerHTML !== "string") {
      throw new TypeError(`innerHTML for <${node.tagName}> must be a string.`);
    }

    if (hasChildren) {
      throw new TypeError(`<${node.tagName}> cannot use both innerHTML and children.`);
    }

    writer.write(node.props.innerHTML);
    if (documentHtml && node.tagName === "head" && state.head.kind === "root") {
      writer.write(context.flushHead(state));
    }
    writer.write(`</${node.tagName}>`);
    await renderClientEventScripts(clientEvents, context, writer);
    return;
  }

  await renderValue(
    node.props.children,
    context,
    writer,
    `${path}-0`,
    childRenderState(state, namespace, node.tagName),
  );
  if (documentHtml && node.tagName === "head" && state.head.kind === "root") {
    writer.write(context.flushHead(state));
  }
  writer.write(`</${node.tagName}>`);
  await renderClientEventScripts(clientEvents, context, writer);
}

async function renderErrorBoundary(
  node: ErrorBoundaryNode,
  context: RenderContext,
  writer: Writer,
  path: string,
  state: RenderState,
) {
  const name = context.boundaryName(path);
  const handler: ErrorHandler = { fallback: node.fallback, name, path: `${path}-f`, state };

  writer.write(`<?start name="${escapeAttribute(name)}">`);

  await context.withErrorHandler(handler, async () => {
    const childState = createChildHeadState(state);

    try {
      await renderValue(node.children, context, writer, `${path}-0`, childState);
      await emitDetachedHeadHtml(childState.head.chunks.join(""), context, writer, state);
      writer.write("<?end>");
    } catch (error) {
      if (context.isAbortError(error)) {
        throw error;
      }

      writer.write("<?end>");
      const fallbackHtml = await renderErrorFallbackTemplate(handler, context);
      context.reportError(error);
      writer.write(fallbackHtml);
    }
  });
}

async function renderErrorFallbackTemplate(handler: ErrorHandler, context: RenderContext) {
  const state = context.createTemplateRenderState(handler.state);
  const html = await renderToBufferedString(handler.fallback, context, handler.path, state);
  const headHtml = state.head.chunks.join("");
  return `${headHtml.length === 0 ? "" : context.renderHeadTemplate(headHtml)}<template for="${escapeAttribute(
    handler.name,
  )}">${html}</template>`;
}

async function renderSuspense(
  node: SuspenseNode,
  context: RenderContext,
  writer: Writer,
  path: string,
  state: RenderState,
) {
  if (context.suspenseMode === "prerender") {
    await renderValue(node.children, context, writer, `${path}-0`, state);
    return;
  }

  const name = context.boundaryName(path);
  context.scheduleTemplate(name, node.children, `${path}-0`, state);
  writer.write(`<?start name="${escapeAttribute(name)}">`);
  await renderValue(node.fallback, context, writer, `${path}-f`, state);
  writer.write("<?end>");
}

async function renderToBufferedString(
  value: JSXChild,
  context: RenderContext,
  path: string,
  state: RenderState,
) {
  const writer = createStringWriter();
  await renderValue(value, context, writer, path, state);
  return writer.html;
}

async function renderDetachedHeadElement(
  node: ElementNode,
  context: RenderContext,
  writer: Writer,
  path: string,
  state: RenderState,
) {
  const html = await renderToBufferedElementString(node, context, path, {
    ...state,
    inHead: true,
  });

  await emitDetachedHeadHtml(html, context, writer, state);
}

async function emitDetachedHeadHtml(
  html: string,
  context: RenderContext,
  writer: Writer,
  state: RenderState,
) {
  if (html.length === 0) {
    return;
  }

  if (state.deferHead || state.head.kind === "template" || !context.hasFlushedHead()) {
    state.head.chunks.push(html);
    return;
  }

  writer.write(context.renderHeadTemplate(html));
}

function createChildHeadState(state: RenderState): RenderState {
  return {
    ...state,
    deferHead: true,
    head: {
      chunks: [],
      kind: state.head.kind,
    },
  };
}

function childRenderState(
  state: RenderState,
  namespace: RenderNamespace,
  tagName: string,
): RenderState {
  const childNamespace = childNamespaceFor(namespace, tagName);
  const documentHtml = state.doc && childNamespace === "html";

  return {
    ...state,
    doc: documentHtml,
    inHead: documentHtml && (state.inHead || tagName === "head"),
    ns: childNamespace,
  };
}

function elementNamespace(parentNamespace: RenderNamespace, tagName: string): RenderNamespace {
  if (parentNamespace === "html" && tagName === "svg") {
    return "svg";
  }

  return parentNamespace;
}

function childNamespaceFor(namespace: RenderNamespace, tagName: string): RenderNamespace {
  if (namespace === "svg" && tagName === "foreignObject") {
    return "html";
  }

  return namespace;
}

async function renderToBufferedElementString(
  node: ElementNode,
  context: RenderContext,
  path: string,
  state: RenderState,
) {
  const writer = createStringWriter();
  await renderElement(node, context, writer, path, state);
  return writer.html;
}

function createStringWriter(): BufferedWriter {
  return {
    html: "",
    write(chunk) {
      this.html += chunk;
    },
  };
}

async function renderClientEventScripts(
  events: readonly InternalClientEvent[],
  context: RenderContext,
  writer: Writer,
) {
  for (const event of events) {
    writer.write(context.renderScript(context.encodeEvent(event)));
  }
}

function createSuspenseNode(props: SuspenseProps): JSXElement {
  return {
    [nodeMarker]: true,
    children: props.children,
    fallback: props.fallback,
    kind: "suspense",
  };
}

function createErrorBoundaryNode(props: ErrorBoundaryProps): JSXElement {
  return {
    [nodeMarker]: true,
    children: props.children,
    fallback: props.fallback,
    kind: "error-boundary",
  };
}

function renderAttribute(name: string, value: unknown, namespace: RenderNamespace) {
  if (name === "children" || name === "innerHTML" || name === "key") {
    return "";
  }

  if (value === null || value === undefined || (namespace === "html" && value === false)) {
    return "";
  }

  const attributeName = normalizeAttributeName(name, namespace);
  assertValidAttributeName(attributeName);

  if (isClientReference(value)) {
    throw new TypeError(
      `Attribute "${attributeName}" received a client reference. Client references can only be passed to event attributes.`,
    );
  }

  if (value === true) {
    if (namespace === "svg") {
      return ` ${attributeName}="true"`;
    }

    return ` ${attributeName}`;
  }

  if (value === false) {
    return ` ${attributeName}="false"`;
  }

  if (typeof value === "string") {
    return ` ${attributeName}="${escapeAttribute(value)}"`;
  }

  if (typeof value === "number") {
    return ` ${attributeName}="${escapeAttribute(value.toString())}"`;
  }

  if (typeof value === "function") {
    throw new TypeError(
      `Attribute "${attributeName}" received a function; event callbacks must be transformed to client references.`,
    );
  }

  if (typeof value === "object") {
    throw new TypeError(`Attribute "${attributeName}" must be a string, number, or boolean.`);
  }

  throw new TypeError(`Attribute "${attributeName}" cannot render value ${describeValue(value)}.`);
}

function normalizeAttributeName(name: string, namespace: RenderNamespace) {
  if (name === "className") {
    return "class";
  }

  if (name === "htmlFor") {
    return "for";
  }

  if (namespace === "svg" && isSvgAttributeAlias(name)) {
    return normalizeSvgAttributeName(name);
  }

  return name;
}

function normalizeSvgAttributeName(name: string) {
  if (name === "xmlnsXlink") {
    return "xmlns:xlink";
  }

  if (name.startsWith("xlink")) {
    return `xlink:${name[5]?.toLowerCase() ?? ""}${name.slice(6)}`;
  }

  if (name.startsWith("xml")) {
    return `xml:${name[3]?.toLowerCase() ?? ""}${name.slice(4)}`;
  }

  return name.replace(/[A-Z]/g, (char) => `-${char.toLowerCase()}`);
}

function isSvgAttributeAlias(name: string) {
  return (
    svgDashCaseAttributeNames.includes(` ${name} `) || svgColonAttributeNames.includes(` ${name} `)
  );
}

function isVoidElement(name: string) {
  return voidElementNames.includes(` ${name} `);
}

function isHoistableHeadElement(name: string) {
  return hoistableHeadElementNames.includes(` ${name} `);
}

function isNonceElement(name: string) {
  return name === "script" || name === "link" || name === "style";
}

function hasRenderableChildren(value: JSXChild): boolean {
  if (value === null || value === undefined || typeof value === "boolean") {
    return false;
  }

  if (Array.isArray(value)) {
    return value.some(hasRenderableChildren);
  }

  return true;
}

function isClientEventAttribute(name: string, value: unknown): value is ClientReference {
  return name.startsWith("on") && name.length > 2 && isClientReference(value);
}

function isClientReference(value: unknown): value is ClientReference {
  return (
    typeof value === "object" &&
    value !== null &&
    (value as ClientReference).type === clientReferenceType
  );
}

function isNode(value: unknown): value is JSXElement {
  return typeof value === "object" && value !== null && nodeMarker in value;
}

function isPromiseLike(value: unknown): value is PromiseLike<unknown> {
  return (
    typeof value === "object" &&
    value !== null &&
    "then" in value &&
    typeof value.then === "function"
  );
}

function describeValue(value: unknown) {
  if (value === null) {
    return "null";
  }

  if (Array.isArray(value)) {
    return "array";
  }

  return typeof value;
}

function assertValidElementName(name: string) {
  if (!attributeNamePattern.test(name)) {
    throw new Error(`Invalid JSX element name "${name}".`);
  }
}

function assertValidAttributeName(name: string) {
  if (!attributeNamePattern.test(name)) {
    throw new Error(`Invalid JSX attribute name "${name}".`);
  }
}

function linkAbortSignal(signal: AbortSignal | undefined, controller: AbortController) {
  if (signal === undefined) {
    return () => {};
  }

  if (signal.aborted) {
    controller.abort(getAbortReason(signal));
    return () => {};
  }

  const abort = () => {
    controller.abort(getAbortReason(signal));
  };

  signal.addEventListener("abort", abort, { once: true });

  return () => {
    signal.removeEventListener("abort", abort);
  };
}

function throwIfAborted(signal: AbortSignal) {
  if (signal.aborted) {
    throw getAbortReason(signal);
  }
}

function getAbortReason(signal: AbortSignal) {
  return signal.reason;
}

function escapeText(value: string) {
  return escapeHtml(value, false);
}

function escapeAttribute(value: string) {
  return escapeHtml(value, true);
}

function escapeHtml(value: string, attribute: boolean) {
  let escaped = "";
  let lastIndex = 0;

  for (let index = 0; index < value.length; index += 1) {
    let entity: string | undefined;

    switch (value.charCodeAt(index)) {
      case 34:
        if (attribute) {
          entity = "&quot;";
        }
        break;
      case 38:
        entity = "&amp;";
        break;
      case 60:
        entity = "&lt;";
        break;
      case 62:
        entity = "&gt;";
        break;
    }

    if (entity === undefined) {
      continue;
    }

    escaped += value.slice(lastIndex, index) + entity;
    lastIndex = index + 1;
  }

  if (lastIndex === 0) {
    return value;
  }

  return escaped + value.slice(lastIndex);
}

function escapeScriptContent(value: string) {
  return value.replaceAll(/<\/script/gi, "<\\/script");
}

function defaultEncodeClientEvent({ event, reference }: InternalClientEvent) {
  return `(() => {let el=document.currentScript?.previousSibling;import(${JSON.stringify(
    reference.mod,
  )}).then((mod)=>el?.addEventListener(${JSON.stringify(
    event,
  )},mod[${JSON.stringify(reference.name)}].bind(null,...${JSON.stringify(
    reference.bound ?? [],
  )})));document.currentScript?.remove();})();`;
}

function renderHeadMarker() {
  return `<?marker name="${headMarkerName}">`;
}

function hashBoundaryPath(path: string) {
  let hash = 0xcbf29ce484222325n;

  for (const char of path) {
    hash ^= BigInt(char.codePointAt(0) ?? 0);
    hash = BigInt.asUintN(64, hash * 0x100000001b3n);
  }

  return (hash % 36n ** 6n).toString(36).padStart(6, "0");
}

export namespace JSX {
  export type Element = JSXElement;
  export type ElementType = string | typeof Fragment | Component;

  export interface ElementChildrenAttribute {
    children: {};
  }

  export interface IntrinsicAttributes {
    key?: string;
  }

  export interface IntrinsicElements {
    [elementName: string]: JSXProps;
  }
}
